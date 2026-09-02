// Customer feedback rules for drawing lookup, completion and order assignment.
export type CompletionRecord={done:number;at:string;by:string;reason:string};
export type WorkerAssignment={workerId:string;at:string;by:string;reason:string};
type Job={id:string;orderNo:string;partCode:string;name:string;qty:number;done:number;status:string;customer?:string;due?:string;drawingNo?:string;manualCompletion?:CompletionRecord;workerAssignment?:WorkerAssignment};
type SkillWorker={id:string;active:boolean;skills:string[]};
type SkillPart={name:string;category:string;workers:string[];processMode?:string};
const text=(v:unknown)=>String(v??'').trim();
export function drawingFromRow(row:Record<string,unknown>){
 const names=new Set(['图号','图纸编号','图纸号','零件图号','产品图号','图号(drawingno)','图号(drawingnumber)']);
 for(const [key,value] of Object.entries(row))if(names.has(key.replace(/\s/g,'').toLowerCase())&&text(value))return text(value);
 return '';
}
const normalized=(s:string)=>s.replace(/\s/g,'').trim();
export function matchWorkers<T extends SkillWorker>(part:SkillPart,workers:T[]):T[]{
 if(part.processMode==='external')return [];
 if(part.workers.length)return workers.filter(w=>w.active&&part.workers.includes(w.id));
 const labels=[normalized(part.name),normalized(part.category)].filter(Boolean);
 if(!labels.length)return [];
 // Customer-confirmed special product lines must never fall through to 拉杆.
 const line=['格里森','珩齿'].find(x=>labels.some(label=>label.includes(x)));
 const matches=(skill:string)=>{
  const s=normalized(skill);if(!s)return false;
  if(line&&!s.includes(line))return false;
  if(!line&&['格里森','珩齿'].some(x=>s.includes(x)))return false;
  return labels.some(label=>label===s||label.endsWith(s)||
   // Keep existing combined-category spellings, without widening special skills.
   (s==='上下顶尖'&&/^(上|下)?顶尖$/.test(label))||
   (s==='上下拉杆'&&/^(上|下)?拉杆$/.test(label))||
   (s.startsWith('各类')&&label.endsWith(s.slice(2))));
 };
 return workers.filter(w=>w.active&&w.skills.some(matches));
}
export function completionStatus(order:Pick<Job,'qty'|'done'>){return order.qty>0&&order.done>=order.qty?'已完工':order.done>0?'部分完成':'未开工';}
export function orderCandidates<T extends SkillWorker>(order:Pick<Job,'workerAssignment'>,part:SkillPart,workers:T[]):T[]{
 if(part.processMode==='external')return [];
 const id=order.workerAssignment?.workerId;
 return id?workers.filter(w=>w.active&&w.id===id):matchWorkers(part,workers);
}
export function matchesOrderSearch(order:Pick<Job,'drawingNo'|'orderNo'|'partCode'|'name'>,partDrawing:string|undefined,query:string){
 const q=query.trim().toLocaleLowerCase();
 return !q||[order.drawingNo||partDrawing,order.orderNo,order.partCode,order.name].some(v=>String(v||'').toLocaleLowerCase().includes(q));
}
export function assignmentAwareIssues<T extends {key:string;reason:string}>(issues:T[],orders:Job[],parts:(SkillPart&{code:string})[],workers:SkillWorker[]):T[]{
 return issues.flatMap(issue=>{
  const order=orders.find(o=>o.id===issue.key),part=parts.find(p=>p.code===order?.partCode);
  if(!order?.workerAssignment?.workerId||!part||!orderCandidates(order,part,workers).length)return [issue];
  const reason=issue.reason.split('；').filter(r=>r!=='无人员匹配：未配置工件—人员关系').join('；');
  return reason?[{...issue,reason}]:[];
 });
}
export function assignOrderWorker<J extends Job,A extends {orderId?:string;orderNo:string;partCode:string;date:string;worker:string;amount:number;capacity:number;reason?:string;candidates?:string[]}>(order:J,orders:J[],rows:A[],workers:(SkillWorker&{name:string;overtime:number})[],workerId:string,reason:string,by:string,at:string,transfer:boolean){
 if(order.status==='已完成'||order.done>=order.qty)throw new Error('已完工订单无需指定加工人员');
 if(!reason.trim())throw new Error('请填写指定或调整原因');
 const worker=workers.find(w=>w.id===workerId&&w.active);
 if(workerId&&!worker)throw new Error('指定人员不在当前工厂的在岗名单内');
 if(transfer&&!worker)throw new Error('恢复自动匹配时不转派已有任务，请后续重新排产');
 let allocations=rows;
 if(transfer&&worker){
  if(!(worker.overtime>0)&&rows.some(a=>allocationBelongsTo(a,order,orders)))throw new Error('指定人员缺少有效日产能');
  if(rows.some(a=>!a.orderId&&a.orderNo===order.orderNo&&a.partCode===order.partCode&&!allocationBelongsTo(a,order,orders)))throw new Error('旧派工无法唯一对应订单，请先核对订单编号');
  const dates=new Set(rows.filter(a=>allocationBelongsTo(a,order,orders)).map(a=>a.date));
  for(const date of dates){
   const total=rows.filter(a=>a.date===date&&(allocationBelongsTo(a,order,orders)||a.worker===worker.name)).reduce((n,a)=>n+a.amount,0);
   if(total>worker.overtime+.001)throw new Error(`${date} 转派后工作量 ${total.toFixed(1)} 超过 ${worker.name} 的含加班上限 ${worker.overtime}；可取消同步转派，再重新排产`);
  }
  allocations=rows.map(a=>allocationBelongsTo(a,order,orders)?{...a,worker:worker.name,capacity:worker.overtime,candidates:[worker.name],reason:`订单人工指定：${reason.trim()}；确认人：${by}`} :a);
 }
 return {order:{...order,workerAssignment:{workerId,reason:reason.trim(),by,at}},allocations};
}
// Rebuild only this order's unfinished work; all other allocations stay untouched.
export function planOrderTransfer<A extends {orderId?:string;orderNo:string;partCode:string;date:string;worker:string;amount:number;capacity:number;name:string;due:string;status:string}>(order:Job,orders:Job[],rows:A[],workers:(SkillWorker&{name:string;capacity:number})[],workerId:string,unit:number,startDate:string){
 const worker=workers.find(w=>w.id===workerId&&w.active);
 if(!worker||!Number.isFinite(worker.capacity)||worker.capacity<=0)throw new Error('所选员工缺少有效的正常日产能，请先确认人员能力');
 if(!Number.isFinite(unit)||unit<=0)throw new Error('缺少有效单件定额，无法顺延，请先补齐工件资料');
 const required=(order.qty-order.done)*unit;
 if(order.status==='已完成'||!Number.isFinite(required)||required<=0)throw new Error('该订单没有可安排的剩余工作量');
 const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!validDate(startDate)||!order.due||!validDate(order.due))throw new Error('开始日期或订单交期无效，请先补齐日期');
 if(rows.some(a=>!a.orderId&&a.orderNo===order.orderNo&&a.partCode===order.partCode&&!allocationBelongsTo(a,order,orders)))throw new Error('旧派工无法唯一对应订单，请先核对订单编号');
 const others=rows.filter(a=>!allocationBelongsTo(a,order,orders));
 const loads=new Map<string,number>();
 for(const row of others.filter(a=>a.worker===worker.name)){
  if(!Number.isFinite(row.amount)||row.amount<0)throw new Error('目标员工已有工作量无效，请先核对派工');
  loads.set(row.date,(loads.get(row.date)||0)+row.amount);
 }
 const planned:{orderId:string;orderNo:string;partCode:string;name:string;drawingNo?:string;date:string;worker:string;amount:number;capacity:number;due:string;status:string;reason:string;candidates:string[]}[]=[];
 let remaining=required;
 const date=new Date(startDate+'T00:00:00Z');
 for(let days=0;remaining>0&&days<3660;days++,date.setUTCDate(date.getUTCDate()+1)){
  if(date.getUTCDay()===0)continue;
  const day=date.toISOString().slice(0,10),available=Math.max(0,worker.capacity-(loads.get(day)||0));
  if(available<=0)continue;
  const amount=Math.min(remaining,available);
  planned.push({orderId:order.id,orderNo:order.orderNo,partCode:order.partCode,name:order.name,drawingNo:order.drawingNo,date:day,worker:worker.name,amount,capacity:worker.capacity,due:order.due,status:day<=order.due?'按期':'延期',reason:'订单人工指定；按正常班剩余产能顺延',candidates:[worker.name]});
  remaining=amount===remaining?0:remaining-amount;
 }
 if(remaining>0)throw new Error('十年内无法安排完剩余工作量，请核对定额及人员能力；未保存任何调整');
 return {allocations:[...others,...planned].sort((a,b)=>a.date.localeCompare(b.date)||a.worker.localeCompare(b.worker)),planned,required,finish:planned.at(-1)!.date,late:planned.at(-1)!.date>order.due};
}
export function recordCompletion<T extends Job>(order:T,done:number,by:string,reason:string,at:string):T{
 if(!(order.qty>0))throw new Error('订单数量须大于0，请先核实订单');
 if(!Number.isFinite(done)||done<0||done>order.qty)throw new Error('累计完成数量须在0至订单数量之间');
 if(!reason.trim())throw new Error('请填写登记或更正说明');
 return {...order,done,status:done>=order.qty?'已完成':done>0?'部分完成':'待排',manualCompletion:{done,at,by,reason:reason.trim()}};
}
export function preserveImportedCompletion<T extends Job>(previous:T[],incoming:T[]):T[]{
 const retained=new Set<string>();
 const result=incoming.map(order=>{
  let matches=previous.filter(old=>old.id===order.id&&old.partCode===order.partCode);
  if(!matches.length)matches=previous.filter(old=>old.orderNo===order.orderNo&&old.partCode===order.partCode);
  // Row-number generated identifiers may move when a snapshot is re-sorted.
  if(!matches.length&&order.orderNo.startsWith('MES-'))matches=previous.filter(old=>old.orderNo.startsWith('MES-')&&old.partCode===order.partCode&&old.customer===order.customer&&old.due===order.due&&old.qty===order.qty&&(!old.drawingNo||!order.drawingNo||old.drawingNo===order.drawingNo));
  if(matches.length>1&&matches.some(old=>old.manualCompletion||old.workerAssignment))throw new Error(`${order.orderNo} 有多条人工记录，无法唯一对应；本次导入未保存，请使用唯一订单号`);
  const old=matches.length===1?matches[0]:undefined;
  if(!old?.manualCompletion&&!old?.workerAssignment)return order;
  if(retained.has(old.id))throw new Error(`${order.orderNo} 重复对应人工完工记录；本次导入未保存`);
  retained.add(old.id);
  if(old.manualCompletion&&old.done>order.qty)throw new Error(`${order.orderNo} 导入数量小于已登记完成数量；请先核实，本次导入未保存`);
  return {...order,...(old.manualCompletion?{done:old.done,status:old.done>=order.qty?'已完成':old.done>0?'部分完成':'待排',manualCompletion:old.manualCompletion}:{}),workerAssignment:old.workerAssignment,drawingNo:order.drawingNo||old.drawingNo};
 });
 // A weekly snapshot must not erase a manual completion/correction record.
 for(const old of previous)if((old.manualCompletion||old.workerAssignment)&&!retained.has(old.id)&&!result.some(o=>o.id===old.id))result.push(old);
 return result;
}
export function allocationBelongsTo(a:{orderId?:string;orderNo:string;partCode:string},order:Job,orders:Job[]){
 return a.orderId?a.orderId===order.id:a.orderNo===order.orderNo&&a.partCode===order.partCode&&orders.filter(o=>o.orderNo===a.orderNo&&o.partCode===a.partCode).length===1;
}
export function remainingAllocations<T extends {orderId?:string;orderNo:string;partCode:string;date:string;amount:number}>(rows:T[],order:Job,updated:Job,orders:Job[],unit:number):T[]{
 const matching=rows.filter(a=>allocationBelongsTo(a,order,orders));
 if(rows.some(a=>!a.orderId&&a.orderNo===order.orderNo&&a.partCode===order.partCode&&!allocationBelongsTo(a,order,orders)))throw new Error('旧计划存在同号同物料的多项任务，请重新生成排产后登记，以免影响其他任务');
 if(!unit&&matching.length&&updated.done<updated.qty)throw new Error('缺少单件定额，无法核算剩余计划，请先补齐定额');
 let consumed=Math.max(0,updated.done-order.done)*unit,budget=Math.max(0,updated.qty-updated.done)*unit;
 const replacement=new Map<T,T|null>();
 for(const a of [...matching].sort((a,b)=>a.date.localeCompare(b.date))){const take=Math.min(a.amount,consumed);consumed-=take;const amount=Math.min(Math.max(0,a.amount-take),budget);budget-=amount;replacement.set(a,amount>.001?{...a,amount}:null)}
 return rows.flatMap(a=>replacement.has(a)?(replacement.get(a)?[replacement.get(a)!]:[]):[a]);
}
