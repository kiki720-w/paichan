import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
import {validCalendarDate} from '../../production-calendar';
import {executeApproval} from '../../server/approval-execution';
import type {AppState} from '../../scheduler-app';
import type {ApprovalRequest} from '../../approval-types';

const initialized=new WeakMap<object,Promise<unknown>>();

function ensure(){
 const db=env.DB;
 let pending=initialized.get(db);
 if(!pending){
  pending=db.batch([
   db.prepare(`CREATE TABLE IF NOT EXISTS production_approval (
    factory TEXT NOT NULL CHECK(factory IN ('xian','xingping')), id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('urgent','outsourcing')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    order_no TEXT NOT NULL, part_code TEXT NOT NULL, quantity REAL NOT NULL, due TEXT NOT NULL, reason TEXT NOT NULL,
    submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
    decided_by TEXT, decided_at TEXT, decision_note TEXT, PRIMARY KEY(factory,id)
   )`),
   db.prepare(`CREATE INDEX IF NOT EXISTS production_approval_listing ON production_approval(factory,submitted_at DESC,id DESC)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS production_approval_source (
    factory TEXT NOT NULL,id TEXT NOT NULL,order_id TEXT NOT NULL,PRIMARY KEY(factory,id)
   )`),
   db.prepare(`CREATE TABLE IF NOT EXISTS production_approval_execution (
    factory TEXT NOT NULL,id TEXT NOT NULL,token TEXT NOT NULL,order_id TEXT NOT NULL,order_no TEXT NOT NULL,
    actor TEXT NOT NULL,executed_at TEXT NOT NULL,PRIMARY KEY(factory,id)
   )`),
  ]).catch(error=>{initialized.delete(db);throw error});
  initialized.set(db,pending);
 }
 return pending;
}

const columns=`id,kind,status,order_no AS orderNo,part_code AS partCode,quantity,due,reason,
 submitted_by AS submittedBy,submitted_at AS submittedAt,decided_by AS decidedBy,
 decided_at AS decidedAt,decision_note AS decisionNote`;
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const problem=(message:string,status=400)=>reply({message},status);
const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
const isId=(value:string)=>/^[a-f0-9-]{36}$/i.test(value);
type FactoryOrder={outsourcingProgress?:unknown;outsourcingParentId?:string;id:string;orderNo:string;partCode:string;qty:number;done:number;status:string};

async function readBody(request:Request){
 const raw=await request.text();
 if(raw.length>8192)return null;
 try{
  const value=JSON.parse(raw);
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
 }catch{return null}
}

export async function GET(request:Request){
 const session=getSession(request);
 if(!session)return problem('请重新登录。',401);
 try{
  await ensure();
  const factory=resolveFactory(request,session);
  const result=await env.DB.prepare(`SELECT ${columns},
   (SELECT actor FROM production_approval_execution e WHERE e.factory=a.factory AND e.id=a.id) AS executedBy,
   (SELECT executed_at FROM production_approval_execution e WHERE e.factory=a.factory AND e.id=a.id) AS executedAt,
   (SELECT order_no FROM production_approval_execution e WHERE e.factory=a.factory AND e.id=a.id) AS executedOrderNo
   FROM production_approval a WHERE factory=?
   ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, submitted_at DESC,id DESC`).bind(factory).all<ApprovalRequest>();
  return reply({requests:result.results});
 }catch{return problem('暂时无法读取审批记录，请重试。',500)}
}

export async function POST(request:Request){
 const session=getSession(request);
 if(!session)return problem('请重新登录。',401);
 if(session.role!=='factory')return problem('请由工厂负责人提交本厂申请。',403);
 try{
  const body=await readBody(request);
  if(!body)return problem('申请格式无效。');
  const id=clean(body.id),kind=body.kind,reason=clean(body.reason),due=clean(body.due),quantity=body.quantity;
  if(!isId(id)||(kind!=='urgent'&&kind!=='outsourcing'))return problem('请选择有效的申请类型。');
  if(!reason||reason.length>500)return problem('请填写申请原因，最多 500 字。');
  if(!validCalendarDate(due)||typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<=0)return problem('请填写有效的要求日期和正数数量。');
  await ensure();
  const factory=resolveFactory(request,session);
  const duplicate=await env.DB.prepare('SELECT 1 FROM production_approval WHERE factory=? AND id=?').bind(factory,id).first();
  if(duplicate)return reply({ok:true});
  let orderNo=clean(body.orderNo),partCode=clean(body.partCode),sourceId:string|undefined;
  if(kind==='outsourcing'){
   const row=await env.DB.prepare('SELECT data FROM factory_state WHERE factory=?').bind(factory).first<{data:string}>();
   const state=row?JSON.parse(row.data) as {orders?:FactoryOrder[];parts?:{code:string;processMode?:string}[]}:null;
   const order=state?.orders?.find(item=>item.id===clean(body.orderId));
   if(!order||order.outsourcingParentId||order.outsourcingProgress||order.status==='已完成'||quantity>order.qty-order.done||state?.parts?.some(part=>part.code===order.partCode&&part.processMode==='external')){
    return problem('请选择本厂未完工的内部订单，申请数量不能超过剩余量。',422);
   }
   orderNo=order.orderNo;
   partCode=order.partCode;
   sourceId=order.id;
  }
  if(!orderNo||!partCode||orderNo.length>100||partCode.length>100)return problem('请填写订单号和物料编码，各最多 100 字。');
  const insert=env.DB.prepare(`INSERT INTO production_approval
   (factory,id,kind,order_no,part_code,quantity,due,reason,submitted_by,submitted_at)
   VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(factory,id) DO NOTHING`).bind(
    factory,id,kind,orderNo,partCode,quantity,due,reason,session.displayName,new Date().toISOString()
   );
  if(sourceId){
   await env.DB.batch([insert,env.DB.prepare(`INSERT INTO production_approval_source(factory,id,order_id)
    SELECT ?,?,? WHERE changes()=1`).bind(factory,id,sourceId)]);
  }else await insert.run();
  return reply({ok:true},201);
 }catch{return problem('申请保存失败，请重试。',500)}
}

export async function PATCH(request:Request){
 const session=getSession(request);
 if(!session)return problem('请重新登录。',401);

 try{
  const body=await readBody(request);
  if(!body)return problem('审批格式无效。');
  if(body.action==='execute')return await runExecution(request,clean(body.id),session.displayName);
  if(session.role!=='main')return problem('只有总负责人可以审批。',403);
  const id=clean(body.id),status=body.status,note=clean(body.note);
  if(!isId(id)||(status!=='approved'&&status!=='rejected'))return problem('请选择有效的审批结果。');
  if(!note||note.length>500)return problem('请填写审批意见，最多 500 字。');
  await ensure();
  const factory=resolveFactory(request,session);
  const updated=await env.DB.prepare(`UPDATE production_approval SET status=?,decision_note=?,decided_by=?,decided_at=?
   WHERE factory=? AND id=? AND status='pending'`).bind(status,note,session.displayName,new Date().toISOString(),factory,id).run();
  if(!updated.meta.changes){
   const existing=await env.DB.prepare('SELECT status FROM production_approval WHERE factory=? AND id=?').bind(factory,id).first();
   return existing?problem('这条申请已处理，请查看最新结果。',409):problem('当前工厂没有这条申请。',404);
  }
  return reply({ok:true});
 }catch{return problem('审批保存失败，请重试。',500)}
}

async function runExecution(request:Request,id:string,actor:string){
 const session=getSession(request);
 if(!session||!isId(id))return problem('请选择有效的申请。');
 await ensure();
 const factory=resolveFactory(request,session),db=env.DB;
 const approval=await db.prepare(`SELECT ${columns} FROM production_approval WHERE factory=? AND id=?`).bind(factory,id).first<ApprovalRequest>();
 if(!approval)return problem('当前工厂没有这条申请。',404);
 if(approval.status!=='approved')return problem('只有已通过的申请可以执行。',409);
 const executed=await db.prepare('SELECT 1 FROM production_approval_execution WHERE factory=? AND id=?').bind(factory,id).first();
 if(executed)return problem('这条申请已经执行，请刷新记录。',409);
 const row=await db.prepare('SELECT data,revision FROM factory_state WHERE factory=?').bind(factory).first<{data:string;revision:number}>();
 if(!row)return problem('请先保存本厂工件和订单资料。',422);
 const source=await db.prepare('SELECT order_id FROM production_approval_source WHERE factory=? AND id=?').bind(factory,id).first<{order_id:string}>();
 let result:ReturnType<typeof executeApproval>;
 try{result=executeApproval(JSON.parse(row.data) as AppState,approval,source?.order_id??null);}
 catch(error){return problem(error instanceof Error?error.message:'无法执行申请。',422)}
 const token=crypto.randomUUID(),now=new Date().toISOString(),revision=row.revision,action='执行生产审批';
 const guard='EXISTS(SELECT 1 FROM production_approval_execution WHERE factory=? AND id=? AND token=?)';
 const [claim,,write]=await db.batch([
  db.prepare(`INSERT INTO production_approval_execution(factory,id,token,order_id,order_no,actor,executed_at)
   SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM factory_state WHERE factory=? AND revision=?)
   AND EXISTS(SELECT 1 FROM production_approval WHERE factory=? AND id=? AND status='approved')
   ON CONFLICT(factory,id) DO NOTHING`)
   .bind(factory,id,token,result.orderId,result.orderNo,actor,now,factory,revision,factory,id),
  db.prepare(`INSERT INTO factory_state_backup(id,factory,data,revision,actor,action,created_at)
   SELECT ?,factory,data,revision,?,?,? FROM factory_state WHERE factory=? AND revision=? AND ${guard}`)
   .bind(crypto.randomUUID(),actor,action,now,factory,revision,factory,id,token),
  db.prepare(`UPDATE factory_state SET data=?,revision=revision+1,updated_at=? WHERE factory=? AND revision=? AND ${guard}`)
   .bind(JSON.stringify(result.state),now,factory,revision,factory,id,token),
  db.prepare(`INSERT INTO factory_audit(id,factory,actor,action,summary,revision,created_at)
   SELECT ?,?,?,?,?,?,? WHERE ${guard}`)
   .bind(crypto.randomUUID(),factory,actor,action,result.orderNo,revision+1,now,factory,id,token),
 ]);
 if(!claim.meta.changes||!write.meta.changes)return problem('申请或工厂数据已更新，请刷新后核对执行状态。',409);
 return reply({ok:true,orderNo:result.orderNo});
}
