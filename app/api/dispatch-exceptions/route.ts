import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
import {dispatchProgressRisks} from '../../dispatch-progress-risk';
import {validateExceptionTransition,type DispatchExceptionEvent,type ExceptionStage} from '../../dispatch-exceptions';
import type {AppState} from '../../scheduler-app';
import {recordApsMetric} from '../../aps-metrics';

const fields='id, exception_key AS key, order_no AS orderNo, part_code AS partCode, operation, version, stage, reason, actor, recorded_at AS at, sequence';
const initialized=new WeakMap<object,Promise<unknown>>();
function ensureTable(){
 const db=env.DB;
 const ready=initialized.get(db);
 if(ready)return ready;
 const pending:Promise<unknown>=db.prepare(`CREATE TABLE IF NOT EXISTS dispatch_exception_events (
   factory TEXT NOT NULL CHECK(factory IN ('xian','xingping')), exception_key TEXT NOT NULL,
   sequence INTEGER NOT NULL, id TEXT NOT NULL, order_no TEXT NOT NULL, part_code TEXT NOT NULL,
   operation TEXT, version TEXT NOT NULL, stage TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL,
   recorded_at TEXT NOT NULL, PRIMARY KEY(factory,exception_key,sequence)
  )`).run().catch((error:unknown)=>{initialized.delete(db);throw error;});
 initialized.set(db,pending);
 return pending;
}

async function collectCurrentExceptions(factory:string,at:string){
 const db=env.DB;
 const saved=await db.prepare('SELECT data FROM factory_state WHERE factory=?').bind(factory).first<{data:string}>();
 const state=saved?JSON.parse(saved.data) as AppState:undefined;
 if(!state?.orders||!state?.parts||!state.allocations)return;
 const {gaps,blocked,predicted}=dispatchProgressRisks(state,at);
 const subjects=[...gaps,...blocked,...predicted];
 if(!subjects.length)return;
 await db.prepare(`INSERT OR IGNORE INTO dispatch_exception_events
  (factory,exception_key,sequence,id,order_no,part_code,operation,version,stage,reason,actor,recorded_at)
  SELECT ?,json_extract(value,'$.key'),0,json_extract(value,'$.id'),json_extract(value,'$.orderNo'),
   json_extract(value,'$.partCode'),json_extract(value,'$.operation'),json_extract(value,'$.version'),
   '待处理','','序衡预警',? FROM json_each(?)
   WHERE NOT EXISTS(SELECT 1 FROM dispatch_exception_events WHERE factory=? AND exception_key=json_extract(value,'$.key'))`)
  .bind(factory,at,JSON.stringify(subjects.map(subject=>({...subject,id:crypto.randomUUID()}))),factory).run();
}

export async function GET(req:Request){
 const session=getSession(req);
 if(!session)return Response.json({message:'请先登录。'},{status:401});
 try{
  await ensureTable();
  const factory=resolveFactory(req,session),key=new URL(req.url).searchParams.get('key');
  const at=new Date().toISOString();
  if(!key)await collectCurrentExceptions(factory,at);
  const query=key?
   env.DB.prepare(`SELECT ${fields} FROM dispatch_exception_events WHERE factory=? AND exception_key=? ORDER BY sequence DESC`).bind(factory,key):
   env.DB.prepare(`SELECT ${fields} FROM dispatch_exception_events AS latest WHERE factory=?
    AND sequence=(SELECT MAX(sequence) FROM dispatch_exception_events WHERE factory=latest.factory AND exception_key=latest.exception_key)
    ORDER BY recorded_at DESC, exception_key`).bind(factory);
  const {results}=await query.all<DispatchExceptionEvent>();
  if(key&&results[0])await recordApsMetric(env.DB,factory,{kind:'首次查看',subject:key,baseVersion:results[0].version,actor:session.displayName,at});
  return Response.json({events:results},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({message:'异常记录暂时无法读取。'},{status:500});}
}

export async function POST(req:Request){
 const session=getSession(req);
 if(!session)return Response.json({message:'请先登录。'},{status:401});
 const input=await req.json().catch(()=>null);
 if(typeof input?.key!=='string'||!input.key||input.key.length>800||!Number.isSafeInteger(input.sequence)||input.sequence<0||
    typeof input.reason!=='string'||typeof input.stage!=='string'){
  return Response.json({message:'异常处理信息无效。'},{status:400});
 }
 try{
  await ensureTable();
  const factory=resolveFactory(req,session),key=input.key as string;
  const current=await env.DB.prepare(`SELECT ${fields} FROM dispatch_exception_events WHERE factory=? AND exception_key=? ORDER BY sequence DESC LIMIT 1`)
   .bind(factory,key).first<DispatchExceptionEvent>();
  const sequence=current?.sequence||0;
  const conflict=()=>Response.json({message:'异常记录已更新，请刷新后重试。'},{status:409});
  if(sequence!==input.sequence)return conflict();
  const reason=input.reason.trim(),stage=input.stage as ExceptionStage;
  try{validateExceptionTransition(current?.stage||'待处理',stage,reason);}
  catch(error){return Response.json({message:(error as Error).message},{status:422});}
  const at=new Date().toISOString(),actor=session.displayName;
  let subject:Pick<DispatchExceptionEvent,'orderNo'|'partCode'|'operation'|'version'>|null|undefined=current;
  if(!subject){
   const saved=await env.DB.prepare('SELECT data FROM factory_state WHERE factory=?').bind(factory).first<{data:string}>();
   const state=saved?JSON.parse(saved.data) as AppState:undefined;
   const detected=state?.orders&&state?.parts&&state.allocations?dispatchProgressRisks(state,at):undefined;
   subject=[...(detected?.gaps||[]),...(detected?.blocked||[]),...(detected?.predicted||[])].find(item=>item.key===key);
   if(!subject)return Response.json({message:'已无法在本厂当前计划中核对到该异常，请重新检查。'},{status:409});
  }
  const {orderNo,partCode,operation,version}=subject;
  const event:DispatchExceptionEvent={id:crypto.randomUUID(),key,orderNo,partCode,operation,version,stage,reason,actor,at,sequence:sequence+1};
  const result=await env.DB.prepare(`INSERT INTO dispatch_exception_events
    (factory,exception_key,sequence,id,order_no,part_code,operation,version,stage,reason,actor,recorded_at)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?
   WHERE (SELECT COALESCE(MAX(sequence),0) FROM dispatch_exception_events WHERE factory=? AND exception_key=?)=?`)
   .bind(factory,key,event.sequence,event.id,orderNo,partCode,operation||null,version,stage,reason,actor,at,factory,key,sequence).run();
  if(!result.meta.changes)return conflict();
  return Response.json({event});
 }catch{return Response.json({message:'异常处理保存失败，请重新检查。'},{status:500});}
}
