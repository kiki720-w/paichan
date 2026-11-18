import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {apsOrders} from './mes-order-sync.mjs';
import {mergeMesLocalOrders} from '../app/server/mes-local-orders.ts';
import {openCatalog,catalogFactories} from './mes-catalog-store.mjs';
import {buildMesDraft,changeMesDraft,applyPublishedMesDraft} from './mes-catalog-draft.mjs';
import {loadSchedulerModule} from './mes-scheduler-loader.mjs';

process.env.TZ='Asia/Shanghai';
const {normalizeState}=loadSchedulerModule('scheduler-app');
const path=process.env.MES_CATALOG_DB||(process.env.STATE_DIRECTORY&&join(process.env.STATE_DIRECTORY,'orders.sqlite'));
const envPath=process.argv[2];
const origin=process.env.MES_APS_ORIGIN||'http://127.0.0.1:3227';
const publicOrigin=process.env.MES_CATALOG_PUBLIC_ORIGIN||origin;
const port=Number(process.env.MES_CATALOG_API_PORT||3229);
const linkUpdates=process.env.MES_CATALOG_LINK_UPDATES!=='0';
const config=envPath?Object.fromEntries(readFileSync(envPath,'utf8').split(/\r?\n/).filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)])):process.env;
if(!path||!Number.isInteger(port)||port<1||port>65535||new URL(publicOrigin).origin!==publicOrigin)throw Error('MES 目录服务配置无效');
const aps=apsOrders(origin,config.APP_SESSION_TOKEN);
const catalog=openCatalog(path), drafts={};
const draftFile=factory=>join(dirname(path),'draft-'+factory+'.json');
for(const factory of catalogFactories){
 const file=await readFile(draftFile(factory),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return 'null';});
 drafts[factory]=JSON.parse(file);
}

async function saveDraft(factory,draft){
 const file=draftFile(factory);
 await writeFile(file+'.tmp',JSON.stringify(draft),{mode:0o600});
 await rename(file+'.tmp',file);
 drafts[factory]=draft;
}

async function refreshDraft(factory){
 const checkpoint=catalog.progress(factory);
 if(!checkpoint.complete||!catalog.statusesChecked(factory))return;
 let {state,revision}=await aps.read(factory);
 const current=drafts[factory];
 if(current?.status==='confirmed'&&state.planSnapshotId===current.id){
  await saveDraft(factory,{...current,status:'published',baseRevision:revision,publishedAt:state.planUpdatedAt,publishedBy:state.planUpdatedBy});
  return;
 }
 if(current?.sourceVersion===checkpoint.version&&current.baseRevision===revision)return;
 const linked=linkUpdates?catalog.linkedRows(factory,state.orders.flatMap(order=>order.mesOperationId?[order.mesOperationId]:[])):[];
 const synced=mergeMesLocalOrders(factory,state,linked);
 if(synced.state!==state){
  if(!await aps.write(factory,revision,synced.state,'同步关联工序数量，保留现有派工','本地全量 MES 同步订单'))return;
  ({state,revision}=await aps.read(factory));
 }
 const normalized=normalizeState(state,factory);
 const codes=normalized.parts.filter(part=>part.unit>0&&part.processMode!=='external').map(part=>part.code);
 const rows=catalog.planningRows(factory,codes);
 const draft=buildMesDraft(factory,normalized,rows,checkpoint.version,revision);
 draft.matchedOperations=rows.length;
 await saveDraft(factory,draft);
 console.log(JSON.stringify({factory,sourceVersion:draft.sourceVersion,draft:draft.id,allocations:draft.allocations.length,blocked:draft.blocked}));
}

let pending=Promise.resolve(),refreshing=false;
function serialize(action){
 const run=pending.then(action);
 pending=run.catch(()=>{});
 return run;
}
async function tick(){
 if(refreshing)return;
 refreshing=true;
 try{for(const factory of catalogFactories)await serialize(()=>refreshDraft(factory));}
 catch(error){console.error('本地 MES 草稿自动更新失败',error.message);}
 finally{refreshing=false;}
}

const counted=new Map();
function statusTotals(factory,version,complete){
 if(!complete)return {};
 const cached=counted.get(factory);
 if(cached?.version===version)return cached.data;
 const data=catalog.totals(factory);
 counted.set(factory,{version,data});
 return data;
}
function reply(response,status,data){
 response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 response.end(JSON.stringify(data));
}

createServer(async(req,res)=>{
 const target=new URL(req.url,origin);
 if(target.pathname!=='/api/mes-catalog')return reply(res,404,{error:'找不到本地 MES 页面'});
 try{
  const auth=await fetch(origin+'/api/auth/session',{headers:{cookie:req.headers.cookie||''},signal:AbortSignal.timeout(5000)});
  const session=await auth.json();
  if(!session.authenticated)return reply(res,401,{error:'请先登录隔离测试站'});
  const factory=target.searchParams.get('factory');
  if(!catalogFactories.includes(factory)||session.role==='factory'&&session.factory!==factory)return reply(res,403,{error:'无权访问该工厂'});
  if(req.method==='GET'){
   const status=target.searchParams.get('status')||'';
   if(status&&!['complete','pending','review'].includes(status))return reply(res,400,{error:'请选择有效的工单状态'});
   const search=(target.searchParams.get('q')||'').trim().slice(0,80),after=target.searchParams.get('after')?.slice(0,150);
   const checkpoint=catalog.progress(factory),{version,jobs,seen_at}=checkpoint;
   const complete=Boolean(checkpoint.complete)&&catalog.statusesChecked(factory);
   const draft=complete?drafts[factory]:null;
   const compact=target.searchParams.get('view')==='orders';
   const publicDraft=draft&&{...draft,orders:undefined,allocations:compact?[]:draft.allocations,unpublishedRows:compact?[]:draft.unpublishedRows,allocationCount:draft.allocations.length};
   return reply(res,200,{factory,complete:Boolean(complete),jobs,version,syncedAt:seen_at,totals:statusTotals(factory,version,complete),draft:publicDraft,...catalog.list(factory,status,search,after)});
  }
  if(req.method!=='POST')return reply(res,405,{error:'暂不支持该操作'});
  if(req.headers.origin!==publicOrigin)return reply(res,403,{error:'请在序衡站点内确认或发布'});
  const action=target.searchParams.get('action'),id=target.searchParams.get('draft');
  if(!['confirm','publish'].includes(action)||!id)return reply(res,400,{error:'草稿操作无效'});
  const outcome=await serialize(()=>catalog.holdVersion(async()=>{
   const draft=drafts[factory];
   if(!catalog.statusesChecked(factory))throw Error('本厂历史状态仍在核对。');
   if(draft?.id!==id)throw Error('已有新版草稿，请刷新后操作。');
   const {state,revision}=await aps.read(factory);
   const {version}=catalog.progress(factory);
   const actor=session.displayName||session.username;
   const next=changeMesDraft(draft,action,state,version,revision,actor);
   if(action==='publish'){
    const published=applyPublishedMesDraft(state,next,actor);
    if(!await aps.write(factory,revision,published,'保留既有派工并人工发布新增派工','发布 MES 自动草稿'))throw Error('序衡资料已变化，请刷新后重新确认。');
    next.baseRevision=revision+1;
   }
   await saveDraft(factory,next);
   return {status:next.status};
  }));
  return reply(res,200,outcome);
 }catch(error){return reply(res,req.method==='POST'?409:503,{error:error.message});}
}).listen(port,'127.0.0.1',()=>console.log('MES 工单与草稿服务启动，端口 '+port));

void tick();
setInterval(tick,5000);
