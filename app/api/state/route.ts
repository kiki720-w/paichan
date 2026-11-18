import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
import type {MesSyncState} from '../../server/mes-source';
import type {AppState} from '../../scheduler-app';
import {millingDispatch,millingDispatchConflict,validateMillingPlan} from '../../milling-pilot';

type StateRow={data:string;revision:number};
type SaveBody={state?:unknown;expectedRevision?:number;action?:string;summary?:string;restoreBackupId?:string};

const initialized=new WeakMap<object,Promise<void>>();
function ensure(){
 const db=env.DB;
 let pending=initialized.get(db);
 if(!pending){pending=initialize().catch(error=>{initialized.delete(db);throw error});initialized.set(db,pending)}
 return pending;
}
async function initialize(){
 const db=env.DB;
 await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS factory_state (factory TEXT PRIMARY KEY CHECK(factory IN ('xian','xingping')), data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revision INTEGER NOT NULL DEFAULT 1)`),
  db.prepare(`CREATE TABLE IF NOT EXISTS factory_state_backup (id TEXT PRIMARY KEY, factory TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
  db.prepare(`CREATE TABLE IF NOT EXISTS factory_audit (id TEXT PRIMARY KEY, factory TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_factory_backup_factory_created ON factory_state_backup(factory,created_at DESC)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_factory_audit_factory_created ON factory_audit(factory,created_at DESC)`),
 ]);
 await db.prepare(`ALTER TABLE factory_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`).run().catch(()=>null);
 const old=await db.prepare(`SELECT data FROM app_state WHERE id=1`).first<{data:string}>().catch(()=>null);
 if(old)await db.prepare(`INSERT OR IGNORE INTO factory_state(factory,data,updated_at,revision) VALUES('xingping',?,CURRENT_TIMESTAMP,1)`).bind(old.data).run();
}

async function extras(factory:string,includeBackups=true){
 const [audit,backups]=await Promise.all([
  env.DB.prepare(`SELECT id,actor,action,summary,revision,created_at AS createdAt FROM factory_audit WHERE factory=? ORDER BY created_at DESC LIMIT 30`).bind(factory).all(),
  includeBackups?env.DB.prepare(`SELECT id,actor,action,revision,created_at AS createdAt FROM factory_state_backup WHERE factory=? ORDER BY created_at DESC LIMIT 12`).bind(factory).all():Promise.resolve({results:[]}),
 ]);
 return {audit:audit.results,backups:backups.results};
}

export async function GET(req:Request){
 const session=getSession(req);if(!session)return Response.json({error:'unauthorized'},{status:401});
 try{await ensure();const factory=resolveFactory(req,session),row=await env.DB.prepare(`SELECT data,revision FROM factory_state WHERE factory=?`).bind(factory).first<StateRow>();return Response.json({state:row?JSON.parse(row.data):null,factory,revision:row?.revision||0,...await extras(factory)})}catch(e){return Response.json({error:String(e),state:null},{status:500})}
}

export async function PUT(req:Request){
 const session=getSession(req);if(!session)return Response.json({error:'unauthorized'},{status:401});
 try{
  await ensure();const factory=resolveFactory(req,session),body=await req.json() as SaveBody,actor=session.displayName||'未知用户';
  const current=await env.DB.prepare(`SELECT data,revision FROM factory_state WHERE factory=?`).bind(factory).first<StateRow>();
  const expected=Number(body.expectedRevision||0);
  if(expected!==(current?.revision||0))return Response.json({error:'conflict',message:'数据已被其他用户更新',currentRevision:current?.revision||0},{status:409});
  const mesSync=current?(JSON.parse(current.data) as Partial<MesSyncState>)?.mesSync:undefined;
  if(body.restoreBackupId&&mesSync)return Response.json({error:'mes_restore_requires_reconciliation',message:'本厂已关联 MES 订单，恢复备份前须先核对同步位置和订单。'},{status:422});
  let nextState=body.state;
  if(body.restoreBackupId){const backup=await env.DB.prepare(`SELECT data FROM factory_state_backup WHERE id=? AND factory=?`).bind(body.restoreBackupId,factory).first<{data:string}>();if(!backup)return Response.json({error:'backup_not_found'},{status:404});nextState=JSON.parse(backup.data)}
  if(!nextState)return Response.json({error:'missing_state'},{status:400});
  const previous=current?JSON.parse(current.data) as AppState:undefined;
  let millingChanged=false;
  if(body.action==='确认铣工草稿'||body.action==='发布铣工派工'){
   const plan=previous?.millingPlan,publish=body.action==='发布铣工派工';
   try{
    if(!previous||!plan||plan.publishedAt||Boolean(plan.confirmedAt)!==publish)throw Error('铣工草稿状态已变化，请刷新后重试。');
    const at=new Date(),today=at.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
    const release=validateMillingPlan(previous,plan,today);
    const millingPlan={...plan,revision:expected+1,...(publish?{publishedAt:at.toISOString()}:{confirmedAt:at.toISOString()})};
    nextState={...previous,millingPlan,...(publish?{millingReleases:[...(previous.millingReleases||[]),release]}:{})};
    millingChanged=true;
   }catch(error){return Response.json({error:'milling_plan_conflict',message:error instanceof Error?error.message:'铣工派工复核失败。'},{status:422})}
  }else if(!body.restoreBackupId){
   const submitted=nextState as AppState;
   const previousPlan=previous?.millingPlan;
   if(JSON.stringify(submitted.millingReleases)!==JSON.stringify(previous?.millingReleases)||
    ((submitted.millingPlan?.confirmedAt||submitted.millingPlan?.publishedAt)&&JSON.stringify(submitted.millingPlan)!==JSON.stringify(previousPlan))){
    return Response.json({error:'milling_transition_required',message:'请通过铣工草稿的确认和发布操作更新派工。'},{status:422});
   }
   if(previous?.millingReleases?.length){
    const existing=new Set((previous.allocations||[]).map(row=>JSON.stringify(row)));
    const conflict=millingDispatchConflict((submitted.allocations||[]).filter(row=>!existing.has(JSON.stringify(row))),millingDispatch(previous));
    if(conflict)return Response.json({error:'milling_resource_conflict',message:conflict.orderNo+' 与已发布铣工派工冲突，请核对人员、设备和日期。'},{status:422});
   }
  }
  const previousOrders=(current?JSON.parse(current.data)?.orders:[]) as {id:string;qty:number;partCode:string;orderNo:string;outsourcedQuantity?:number;approvalExecutionId?:string;outsourcingParentId?:string}[]|undefined;
  const executedOrders=(Array.isArray(previousOrders)?previousOrders:[]).filter(order=>order.approvalExecutionId||order.outsourcedQuantity);
  if(executedOrders.length){
   const proposed=(nextState as {orders?:typeof previousOrders}).orders;
   const byId=new Map((Array.isArray(proposed)?proposed:[]).map(order=>[order.id,order]));
   if(executedOrders.some(order=>{
    const replacement=byId.get(order.id);
    return !replacement||replacement.qty!==order.qty||replacement.partCode!==order.partCode||
     replacement.orderNo!==order.orderNo||replacement.outsourcedQuantity!==order.outsourcedQuantity||
     replacement.approvalExecutionId!==order.approvalExecutionId||replacement.outsourcingParentId!==order.outsourcingParentId;
   }))return Response.json({error:'approval_execution_order_changed',message:'本次操作会覆盖已执行审批关联的订单或数量。请先核对拆分和已执行记录，数据未保存。'},{status:422});
  }
  let stateAdjusted=millingChanged;
  if(mesSync){
   const submitted=nextState as Partial<MesSyncState>;
   const orderIds=new Set(Array.isArray(submitted.orders)?submitted.orders.map(order=>order?.id):[]);
   if(Object.values(mesSync.links).some(link=>!orderIds.has(link.orderId))){
    return Response.json({error:'mes_linked_order_missing',message:'本次操作会移除已关联的 MES 订单，请先核对订单，数据未保存。'},{status:422});
   }
   const serverSync=body.action==='生成排产'&&submitted.mesSync?.planNeedsReview===false?{...mesSync,planNeedsReview:false}:mesSync;
   stateAdjusted=stateAdjusted||JSON.stringify(submitted.mesSync)!==JSON.stringify(serverSync);
   nextState={...submitted,mesSync:serverSync};
  }else if(typeof nextState==='object'&&'mesSync' in nextState){
   const {...sanitized}=nextState as Partial<MesSyncState>;
   delete sanitized.mesSync;
   nextState=sanitized;
   stateAdjusted=true;
  }
  const mesOrderWrite=body.action==='同步 MES 工单';
  const mesDraftPublish=body.action==='发布 MES 自动草稿';
  const mesQuotaWrite=body.action==='补充 MES 工序定额';
  if((mesOrderWrite||mesDraftPublish||mesQuotaWrite)&&(session.role!=='main'||new URL(req.url).hostname!=='127.0.0.1'||body.restoreBackupId))return Response.json({error:'mes_sync_local_only'},{status:403});
  const proposed=nextState as Partial<AppState>;
  const submittedOrders=Array.isArray(proposed.orders)?proposed.orders:[];
  if(mesOrderWrite){
   const preserved=['parts','workers','machines','productionCalendar','workingWindows','allocations','history','planStatus','planSnapshotId','planUpdatedAt','planUpdatedBy','planChangeNote','lastRun','scheduleShortages','processTasks','millingPlan','millingReleases'] as const;
   if(previous&&preserved.some(key=>JSON.stringify(previous[key])!==JSON.stringify(proposed[key])))return Response.json({error:'mes_plan_write_forbidden'},{status:422});
  }else if(mesDraftPublish){
   const old=previous?.allocations||[], rows=proposed.allocations||[];
   const priorHistory=previous?.history||[], history=proposed.history||[];
   const existing=new Map(submittedOrders.map(order=>[order.id,order]));
   const preserved=['parts','workers','machines','productionCalendar','workingWindows','processTasks','millingPlan','millingReleases','mesOrderSync'] as const;
   const validPlan=proposed.planStatus==='已发布'&&history[0]?.id===proposed.planSnapshotId&&history[0]?.status==='已发布'&&
    Boolean(history[0]?.confirmedBy&&history[0]?.publishedBy)&&JSON.stringify(history[0]?.allocations)===JSON.stringify(rows);
   if(!validPlan||rows.length<=old.length||JSON.stringify(rows.slice(0,old.length))!==JSON.stringify(old)||
    JSON.stringify(history.slice(1))!==JSON.stringify(priorHistory)||
    (previous?.orders||[]).some(order=>{const next=existing.get(order.id);return !next||next.orderNo!==order.orderNo||next.partCode!==order.partCode;})||
    preserved.some(key=>JSON.stringify(previous?.[key])!==JSON.stringify(proposed[key])))
    return Response.json({error:'mes_draft_cannot_replace_plan',message:'MES 草稿必须保留已有订单、派工和历史计划。'},{status:422});
  }else{
   const before=new Map((previous?.orders||[]).filter(order=>order.mesOperationId).map(order=>[order.id,order]));
   const after=new Map(submittedOrders.filter(order=>order.mesOperationId).map(order=>[order.id,order]));
   if(before.size!==after.size||[...before].some(([id,old])=>{
    const order=after.get(id);
    return !order||(['orderNo','partCode','qty','done','mesOperationId','mesOperationNo','mesOrderHold'] as const).some(key=>old[key]!==order[key]);
   }))return Response.json({error:'mes_linked_order_changed',message:'当前操作会覆盖 MES 同步订单，请先核对。'},{status:422});
   if(JSON.stringify(proposed.mesOrderSync)!==JSON.stringify(previous?.mesOrderSync)){
    nextState={...proposed,mesOrderSync:previous?.mesOrderSync};stateAdjusted=true;
   }
  }
  if(mesQuotaWrite){
   const quotas=proposed.mesOperationQuotas;
   const changedFields=Object.keys({...previous,...proposed}).filter(key=>key!=='mesOperationQuotas');
   if(!previous||changedFields.some(key=>JSON.stringify(previous[key as keyof AppState])!==JSON.stringify(proposed[key as keyof AppState])))
    return Response.json({error:'mes_quota_unrelated_change',message:'补充工序定额时须保留原订单、派工和其他资料。'},{status:422});
   if(!Array.isArray(quotas)||new Set(quotas.map(row=>row?.operationId)).size!==quotas.length||quotas.some(row=>
    !row||[row.operationId,row.workOrder,row.operationNo,row.partCode,row.drawingNo,row.name].some(value=>typeof value!=='string'||!value.trim())||
    !Number.isFinite(row.unit)||row.unit<=0))return Response.json({error:'invalid_mes_operation_quota',message:'MES 工序定额不完整或重复。'},{status:422});
  }else if(JSON.stringify(proposed.mesOperationQuotas)!==JSON.stringify(previous?.mesOperationQuotas)){
   nextState={...proposed,mesOperationQuotas:previous?.mesOperationQuotas};stateAdjusted=true;
  }
  const action=body.action||'更新数据',summary=body.summary||action,nextRevision=(current?.revision||0)+1,now=new Date().toISOString();
  if(current){
   await env.DB.prepare(`INSERT INTO factory_state_backup(id,factory,data,revision,actor,action,created_at) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),factory,current.data,current.revision,actor,action,now).run();
   const updated=await env.DB.prepare(`UPDATE factory_state SET data=?,updated_at=CURRENT_TIMESTAMP,revision=? WHERE factory=? AND revision=?`).bind(JSON.stringify(nextState),nextRevision,factory,current.revision).run();
   if(!updated.meta.changes)return Response.json({error:'conflict',message:'数据已被其他用户更新'},{status:409});
  }else await env.DB.prepare(`INSERT INTO factory_state(factory,data,updated_at,revision) VALUES(?,?,CURRENT_TIMESTAMP,?)`).bind(factory,JSON.stringify(nextState),nextRevision).run();
  await env.DB.prepare(`INSERT INTO factory_audit(id,factory,actor,action,summary,revision,created_at) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),factory,actor,action,summary,nextRevision,now).run();
  await env.DB.prepare(`DELETE FROM factory_state_backup WHERE factory=? AND id NOT IN (SELECT id FROM factory_state_backup WHERE factory=? ORDER BY created_at DESC LIMIT 20)`).bind(factory,factory).run();
  // Old clients retain the full response. New clients already have the exact
  // submitted state and need only a durable-write acknowledgement and audit.
  const minimal=req.headers.get('prefer')==='return=minimal'&&!body.restoreBackupId&&!stateAdjusted;
  return Response.json({ok:true,factory,...(minimal?{}:{state:nextState}),revision:nextRevision,...await extras(factory,!minimal)},{headers:{'Cache-Control':'private, no-store',...(minimal?{'Preference-Applied':'return=minimal'}:{})}});
 }catch(e){return Response.json({error:String(e)},{status:500})}
}
