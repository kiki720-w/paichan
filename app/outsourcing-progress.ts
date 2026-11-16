type Entry={id:string;quantity:number;by:string;at:string};
type ReturnBatch=Entry & {inspection?:{passed:number;by:string;at:string}};
export type OutsourcingProgress={previousAccepted:number;sent:Entry[];returned:ReturnBatch[]};
type Task={qty:number;done:number;status:string;outsourcingProgress?:OutsourcingProgress};
export type OutsourcingAction={kind:'send'|'return';quantity:number}|{kind:'inspect';batchId:string;passed:number};
const sum=(entries:Entry[])=>entries.reduce((total,entry)=>total+entry.quantity,0);
const remaining=(value:number)=>value>1e-8?value:0;

export function outsourcingTotals(task:Task){
 const progress=task.outsourcingProgress||{
  previousAccepted:task.status==='已完成'?task.qty:Math.min(task.qty,Math.max(0,task.done)),sent:[],returned:[],
 };
 const sent=progress.previousAccepted+sum(progress.sent),returned=progress.previousAccepted+sum(progress.returned);
 const accepted=progress.previousAccepted+progress.returned.reduce((total,batch)=>total+(batch.inspection?.passed||0),0);
 const rejected=progress.returned.reduce((total,batch)=>total+(batch.inspection?batch.quantity-batch.inspection.passed:0),0);
 const unsent=remaining(task.qty-sent),outstanding=remaining(sent-returned),pending=remaining(returned-accepted-rejected);
 return {progress,sent,returned,accepted,rejected,unsent,outstanding,pending,notReturned:remaining(task.qty-returned),complete:task.qty>0&&remaining(task.qty-accepted)===0};
}

export function recordOutsourcing<T extends Task>(task:T,action:OutsourcingAction,entry:Omit<Entry,'quantity'>):T{
 const totals=outsourcingTotals(task);
 let progress=totals.progress;
 if(action.kind==='inspect'){
  const batch=progress.returned.find(item=>item.id===action.batchId);
  if(!batch||batch.inspection)throw Error('该批次不存在或已验收，请刷新后核对。');
  if(!Number.isFinite(action.passed)||action.passed<0||action.passed>batch.quantity)throw Error('合格数量必须在 0 与本批回厂数量之间。');
  progress={...progress,returned:progress.returned.map(item=>item===batch?{...item,inspection:{passed:action.passed,by:entry.by,at:entry.at}}:item)};
 }else{
  const limit=action.kind==='send'?totals.unsent:totals.outstanding;
  if(!Number.isFinite(action.quantity)||action.quantity<=0||limit<=0||action.quantity>limit+1e-8)throw Error(action.kind==='send'?'送出数量须大于 0，且不能超过待送出数量。':'回厂数量须大于 0，且不能超过已送未回数量。');
  const key=action.kind==='send'?'sent':'returned';
  progress={...progress,[key]:[...progress[key],{...entry,quantity:Math.min(action.quantity,limit)}]};
 }
 const result=outsourcingTotals({...task,outsourcingProgress:progress});
 return {...task,outsourcingProgress:progress,done:result.complete?task.qty:result.accepted,status:result.complete?'已完成':'待外协'};
}
