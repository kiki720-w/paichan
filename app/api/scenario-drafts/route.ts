import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
import {adjustScenarioDraft,confirmScenarioDraft,createAutomaticScenarioDraft,createScenarioDraft,publishScenarioDraft,restoreScenarioRelease,reviseScenarioDraft,type ScenarioDraft,type ScenarioOption} from '../../scenario-drafts';
import {defaultScenarioPolicy,normalizeScenarioPolicy,type ScenarioPolicy} from '../../scenario-policy';
import {simulateSchedulingScenario,type SchedulingScenario} from '../../scheduling-scenarios';
import {schedule} from '../../scheduling-engine';
import {recordApsMetric} from '../../aps-metrics';
import type {AppState} from '../../scheduler-app';

type SavedDraft={data:string;restore_state:string|null};
type FactoryState={data:string;revision:number;updated_at:string};
const clock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'});
const conflict=()=>Response.json({message:'计划或草稿已更新，请刷新后再操作。'},{status:409});
const invalid=(message:string)=>Response.json({message},{status:422});

async function ensureDrafts(){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scenario_drafts (
  factory TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL,
  updated_at TEXT NOT NULL, restore_state TEXT, PRIMARY KEY(factory,id)
 )`).run();
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scenario_policy (
  factory TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, actor TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(factory,version)
 )`).run();
}

async function readPolicy(factory:string):Promise<ScenarioPolicy>{
 const row=await env.DB.prepare('SELECT data FROM scenario_policy WHERE factory=? ORDER BY version DESC LIMIT 1').bind(factory).first<{data:string}>();
 return row?JSON.parse(row.data):defaultScenarioPolicy;
}

async function savePolicy(factory:string,input:unknown,expected:unknown,actor:string,at:string){
 if(typeof expected!=='number'||!Number.isInteger(expected)||expected<0)return invalid('请刷新策略版本再保存。');
 let policy:ScenarioPolicy;
 try{policy={version:expected+1,...normalizeScenarioPolicy(input)};}
 catch(error){return invalid((error as Error).message);}
 const saved=await env.DB.prepare(`INSERT INTO scenario_policy(factory,version,data,actor,updated_at)
  SELECT ?,?,?,?,? WHERE (SELECT COALESCE(MAX(version),0) FROM scenario_policy WHERE factory=?)=?`)
  .bind(factory,policy.version,JSON.stringify(policy),actor,at,factory,expected).run();
 return saved.meta.changes===1?Response.json({policy}):conflict();
}

async function automaticId(factory:string,revision:number,version:number,day:string,input:SchedulingScenario){
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([factory,revision,version,day,input])));
 return 'auto-'+Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}

function text(value:unknown){
 return typeof value==='string'&&value.length<=200?value.trim():'';
}

function parseScenario(value:Record<string,unknown>|undefined):SchedulingScenario{
 if(value?.kind==='insert'&&Number.isFinite(value.quantity)&&Number(value.quantity)>0){
  return {kind:'insert',orderNo:text(value.orderNo),partCode:text(value.partCode),quantity:Number(value.quantity),due:text(value.due)};
 }
 if(value?.kind==='due')return {kind:'due',orderId:text(value.orderId),due:text(value.due)};
 if(value?.kind==='leave')return {kind:'leave',workerId:text(value.workerId),start:text(value.start),end:text(value.end)};
 if(value?.kind==='split'&&Array.isArray(value.batches)&&value.batches.length<=30){
  return {kind:'split',orderId:text(value.orderId),batches:value.batches.map(batch=>({
   label:text(batch?.label),due:text(batch?.due),quantity:typeof batch?.quantity==='number'?batch.quantity:NaN,
  }))};
 }
 throw Error('请提供有效的情景。');
}

export async function GET(req:Request){
 const session=getSession(req);
 if(!session)return Response.json({message:'请先登录。'},{status:401});
 try{
  await ensureDrafts();
  const factory=resolveFactory(req,session),id=new URL(req.url).searchParams.get('id');
  if(id){
   const row=await env.DB.prepare('SELECT data FROM scenario_drafts WHERE factory=? AND id=?').bind(factory,id).first<SavedDraft>();
   return row?Response.json({draft:JSON.parse(row.data)},{headers:{'Cache-Control':'private, no-store'}}):
    Response.json({message:'本厂没有该草稿。'},{status:404});
  }
  const {results}=await env.DB.prepare(
   "SELECT json_remove(data,'$.rows','$.events') AS data FROM scenario_drafts WHERE factory=? ORDER BY updated_at DESC,id LIMIT 30"
  ).bind(factory).all<SavedDraft>();
  return Response.json({drafts:results.map(row=>JSON.parse(row.data)),policy:await readPolicy(factory)},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({message:'情景草稿暂时无法读取。'},{status:500});}
}

export async function POST(req:Request){
 const session=getSession(req);
 if(!session)return Response.json({message:'请先登录。'},{status:401});
 const body=await req.json().catch(()=>null);
 const action=body?.action;
 if(!['policy','preview','automatic','create','edit','adjust','confirm','publish','restore'].includes(action)||
  (action!=='policy'&&!Number.isSafeInteger(body.baseRevision))){
  return Response.json({message:'草稿操作参数无效。'},{status:400});
 }
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(reason.length>500)return invalid('原因最多 500 字。');
 try{
  await ensureDrafts();
  const db=env.DB,factory=resolveFactory(req,session),now=new Date(),day=clock.format(now),at=now.toISOString();
  const stamp={actor:session.displayName,at};
  if(action==='policy')return savePolicy(factory,body.policy,body.policyVersion,stamp.actor,at);
  const current=await db.prepare('SELECT data,revision,updated_at FROM factory_state WHERE factory=?').bind(factory).first<FactoryState>();
  if(!current||current.revision!==body.baseRevision)return conflict();
  const state=JSON.parse(current.data) as AppState;
  if(action==='preview'){
   if(body.day!==day)return invalid('工厂工作日已变化，请刷新后重新试算。');
   try{
    const input=parseScenario(body.input);
    const result=simulateSchedulingScenario(state,input,factory,current.revision,day,schedule);
    if(!req.signal.aborted){
     const fingerprint=await automaticId(factory,current.revision,0,day,input);
     await recordApsMetric(db,factory,{kind:'方案生成',subject:fingerprint,baseVersion:String(current.revision),actor:stamp.actor,at});
    }
    return Response.json({preview:result},{headers:{'Cache-Control':'private, no-store'}});
   }catch(error){return invalid((error as Error).message);}
  }
  if(action==='automatic'){
   if(body.day!==day)return invalid('工厂工作日已变化，请重新试算。');
   const policy=await readPolicy(factory);
   let draft:ScenarioDraft;
   try{
    const input=parseScenario(body.input);
    const id=await automaticId(factory,current.revision,policy.version,day,input);
    draft=createAutomaticScenarioDraft(state,factory,current.revision,day,id,input,policy,current.updated_at||'',stamp);
   }catch(error){return invalid((error as Error).message);}
   const saved=await db.prepare(`INSERT OR IGNORE INTO scenario_drafts(factory,id,revision,data,updated_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM factory_state WHERE factory=? AND revision=?)
    AND (SELECT MAX(version) FROM scenario_policy WHERE factory=?)=?`)
    .bind(factory,draft.id,draft.revision,JSON.stringify(draft),at,factory,current.revision,factory,policy.version).run();
   if(saved.meta.changes===1)return Response.json({draft},{status:201});
   const existing=await db.prepare('SELECT data FROM scenario_drafts WHERE factory=? AND id=?').bind(factory,draft.id).first<SavedDraft>();
   return existing?Response.json({draft:JSON.parse(existing.data)}):conflict();
  }
  const id=action==='create'?crypto.randomUUID():text(body.id);
  const saved=action==='create'?null:
   await db.prepare('SELECT data,restore_state FROM scenario_drafts WHERE factory=? AND id=?').bind(factory,id).first<SavedDraft>();
  if(action!=='create'&&!saved)return Response.json({message:'本厂没有该草稿。'},{status:404});
  const before=saved?JSON.parse(saved.data) as ScenarioDraft:null;
  if(before&&before.revision!==body.draftRevision)return conflict();
  let draft:ScenarioDraft,nextState:AppState|undefined,restoreState=saved?.restore_state||null;
  try{
   if(action==='create'||action==='edit'){
    if(body.day!==day)return invalid('工厂工作日已变化，请重新试算。');
    if(!['normal','overtime','alternate'].includes(body.option))return invalid('请选择要保存的方案。');
    const input=parseScenario(body.input),option=body.option as ScenarioOption;
    draft=before?reviseScenarioDraft(state,before,current.revision,day,input,option,stamp):
     createScenarioDraft(state,factory,current.revision,day,id,input,option,stamp);
   }else if(action==='adjust'){
    if(!Number.isSafeInteger(body.move?.rowIndex)||body.move.rowIndex<0)return invalid('请选择一条拟派工。');
    draft=adjustScenarioDraft(state,before!,current.revision,day,
     {rowIndex:body.move.rowIndex,workerId:text(body.move.workerId),date:text(body.move.date)},stamp);
   }else if(action==='confirm'){
    draft=confirmScenarioDraft(state,before!,current.revision,day,reason,stamp);
   }else if(action==='publish'){
    ({draft,state:nextState}=publishScenarioDraft(state,before!,current.revision,day,stamp));
    restoreState=current.data;
   }else{
    if(!restoreState)return invalid('该版本没有可恢复的发布前快照。');
    ({draft,state:nextState}=restoreScenarioRelease(state,JSON.parse(restoreState),before!,current.revision,reason,stamp));
   }
  }catch(error){return invalid((error as Error).message);}
  const expect=current.revision,encoded=JSON.stringify(draft);
  if(!before){
   const result=await db.prepare(`INSERT INTO scenario_drafts(factory,id,revision,data,updated_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM factory_state WHERE factory=? AND revision=?)`)
    .bind(factory,id,draft.revision,encoded,at,factory,expect).run();
   return result.meta.changes===1?Response.json({draft},{status:201}):conflict();
  }
  const updateDraft=db.prepare(`UPDATE scenario_drafts SET revision=?,data=?,updated_at=?,restore_state=?
   WHERE factory=? AND id=? AND revision=? AND EXISTS(SELECT 1 FROM factory_state WHERE factory=? AND revision=?)`)
   .bind(draft.revision,encoded,at,restoreState,factory,id,before.revision,factory,expect);
  if(!nextState){
   const result=await updateDraft.run();
   return result.meta.changes===1?Response.json({draft}):conflict();
  }
  const marker=crypto.randomUUID(),auditAction=action==='publish'?'发布情景派工':'恢复情景计划';
  const matchDraft=`EXISTS(SELECT 1 FROM scenario_drafts WHERE factory=? AND id=? AND revision=?)`;
  // Use a unique audit marker and acquire the draft and state revisions in
  // the same transaction. A stale request cannot save any of the four rows.
  const [audit,,updated,write]=await db.batch([
   db.prepare(`INSERT INTO factory_audit(id,factory,actor,action,summary,revision,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${matchDraft} AND EXISTS(SELECT 1 FROM factory_state WHERE factory=? AND revision=?)`)
    .bind(marker,factory,stamp.actor,auditAction,reason||id,expect+1,at,factory,id,before.revision,factory,expect),
   db.prepare(`INSERT INTO factory_state_backup(id,factory,data,revision,actor,action,created_at)
    SELECT ?,factory,data,revision,?,?,? FROM factory_state WHERE factory=? AND revision=?
    AND EXISTS(SELECT 1 FROM factory_audit WHERE id=?)`)
    .bind(crypto.randomUUID(),stamp.actor,auditAction,at,factory,expect,marker),
   updateDraft,
   db.prepare(`UPDATE factory_state SET data=?,revision=?,updated_at=? WHERE factory=? AND revision=?
    AND EXISTS(SELECT 1 FROM factory_audit WHERE id=?)`).bind(JSON.stringify(nextState),expect+1,at,factory,expect,marker),
  ]);
  if(audit.meta.changes!==1||updated.meta.changes!==1||write.meta.changes!==1)return conflict();
  return Response.json({draft,baseRevision:expect+1});
 }catch{return Response.json({message:'情景草稿保存失败，请刷新后重试。'},{status:500});}
}
