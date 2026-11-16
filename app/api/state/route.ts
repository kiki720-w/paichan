import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
import type {MesSyncState} from '../../server/mes-source';

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
  let stateAdjusted=false;
  if(mesSync){
   const submitted=nextState as Partial<MesSyncState>;
   const orderIds=new Set(Array.isArray(submitted.orders)?submitted.orders.map(order=>order?.id):[]);
   if(Object.values(mesSync.links).some(link=>!orderIds.has(link.orderId))){
    return Response.json({error:'mes_linked_order_missing',message:'本次操作会移除已关联的 MES 订单，请先核对订单，数据未保存。'},{status:422});
   }
   const serverSync=body.action==='生成排产'&&submitted.mesSync?.planNeedsReview===false?{...mesSync,planNeedsReview:false}:mesSync;
   stateAdjusted=JSON.stringify(submitted.mesSync)!==JSON.stringify(serverSync);
   nextState={...submitted,mesSync:serverSync};
  }else if(typeof nextState==='object'&&'mesSync' in nextState){
   const {...sanitized}=nextState as Partial<MesSyncState>;
   delete sanitized.mesSync;
   nextState=sanitized;
   stateAdjusted=true;
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
