import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
import {validCalendarDate} from '../../production-calendar';
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
type FactoryOrder={id:string;orderNo:string;partCode:string;qty:number;done:number;status:string};

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
  const result=await env.DB.prepare(`SELECT ${columns} FROM production_approval WHERE factory=?
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
  let orderNo=clean(body.orderNo),partCode=clean(body.partCode);
  if(kind==='outsourcing'){
   const row=await env.DB.prepare('SELECT data FROM factory_state WHERE factory=?').bind(factory).first<{data:string}>();
   const state=row?JSON.parse(row.data) as {orders?:FactoryOrder[];parts?:{code:string;processMode?:string}[]}:null;
   const order=state?.orders?.find(item=>item.id===clean(body.orderId));
   if(!order||order.status==='已完成'||quantity>order.qty-order.done||state?.parts?.some(part=>part.code===order.partCode&&part.processMode==='external')){
    return problem('请选择本厂未完工的内部订单，申请数量不能超过剩余量。',422);
   }
   orderNo=order.orderNo;
   partCode=order.partCode;
  }
  if(!orderNo||!partCode||orderNo.length>100||partCode.length>100)return problem('请填写订单号和物料编码，各最多 100 字。');
  await env.DB.prepare(`INSERT INTO production_approval
   (factory,id,kind,order_no,part_code,quantity,due,reason,submitted_by,submitted_at)
   VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(factory,id) DO NOTHING`).bind(
    factory,id,kind,orderNo,partCode,quantity,due,reason,session.displayName,new Date().toISOString()
   ).run();
  return reply({ok:true},201);
 }catch{return problem('申请保存失败，请重试。',500)}
}

export async function PATCH(request:Request){
 const session=getSession(request);
 if(!session)return problem('请重新登录。',401);
 if(session.role!=='main')return problem('只有总负责人可以审批。',403);
 try{
  const body=await readBody(request);
  if(!body)return problem('审批格式无效。');
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
