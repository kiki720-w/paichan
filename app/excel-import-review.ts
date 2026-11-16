import type {AppState} from './scheduler-app';
import {releasedOrder} from './process-quality';

export type ExcelImportConflict = {key:string;orderNo:string;partCode:string;reason:string};
type Change = {key:string;label:string;kind:'新增'|'变更'|'移出';detail:string};

export function reviewExcelImport(previous:AppState,next:AppState){
 const changes:Change[]=[];
 function compare<T extends {id:string}>(before:T[],after:T[],label:(item:T)=>string,describe:(old:T,item:T)=>string,initial:(item:T)=>string){
  const oldById=new Map(before.map(item=>[item.id,item]));
  for(const item of after){
   const old=oldById.get(item.id);
   const detail=old?describe(old,item):initial(item);
   if(!old||detail)changes.push({key:item.id,label:label(item),kind:old?'变更':'新增',detail});
   oldById.delete(item.id);
  }
  for(const item of oldById.values())changes.push({key:item.id,label:label(item),kind:'移出',detail:'本次文件未包含此记录'});
 }
 function fields<T>(old:T,item:T,labels:[keyof T,string][]){
  const display=(value:unknown)=>value===undefined||value===null||value===''?'—':String(value);
  return labels.filter(([key])=>display(old[key])!==display(item[key])).map(([key,label])=>`${label} ${display(old[key])} → ${display(item[key])}`).join('；');
 }
 compare(previous.orders,next.orders,o=>`${o.orderNo} · ${o.partCode}`,(a,b)=>fields(a,b,[['qty','订单数量'],['done','已完成'],['due','交期'],['partCode','物料'],['drawingNo','图号'],['customer','客户'],['name','工件'],['priority','优先级'],['status','状态']]),o=>`数量 ${o.qty}，已完成 ${o.done}，交期 ${o.due||'—'}`);
 compare(previous.processTasks||[],next.processTasks||[],t=>`${t.workOrderNo} · ${t.operationName||t.operationNo}`,(a,b)=>fields(a,b,[['plannedQty','计划数量'],['completedQty','累计完成'],['due','交期'],['partCode','物料'],['operationName','工序'],['status','状态']]),t=>`计划 ${t.plannedQty}，累计完成 ${t.completedQty}`);

 const beforeOrders=new Map(previous.orders.map(o=>[o.id,o]));
 const afterOrders=new Map(next.orders.map(o=>[o.id,o]));
 const oldParts=new Map(previous.parts.map(p=>[p.code,p]));
 const newParts=new Map(next.parts.map(p=>[p.code,p]));
 const oldWorkers=new Map(previous.workers.map(w=>[w.name,w]));
 const newWorkers=new Map(next.workers.map(w=>[w.name,w]));
 const open=new Map((previous.excelImportConflicts||[]).map(issue=>[issue.key,issue]));
 const conflicts=new Map<string,ExcelImportConflict>();
 const detailsChanged=new Set(next.issues?.map(issue=>issue.key));
 const oldIssues=new Set(previous.issues?.map(issue=>issue.key));
 for(const row of previous.allocations){
  const key=row.orderId||JSON.stringify([row.orderNo,row.partCode]);
  const match=(state:AppState,byId:typeof beforeOrders)=>row.orderId?byId.get(row.orderId):state.orders.find(o=>o.orderNo===row.orderNo&&o.partCode===row.partCode);
  const old=match(previous,beforeOrders),order=match(next,afterOrders);
  const part=newParts.get(row.partCode),oldPart=oldParts.get(row.partCode);
  const worker=newWorkers.get(row.worker),oldWorker=oldWorkers.get(row.worker);
  const reason=[];
  if(old&&!order)reason.push('文件更新后无法对应原派工订单');
  if(old&&order){
   const compared=fields(old,order,[['qty','订单数量'],['done','已完成'],['due','交期'],['partCode','物料']]);
   if(compared)reason.push(compared);
   const from=releasedOrder(old,previous.processTasks).qty,to=releasedOrder(order,next.processTasks).qty;
   if(from!==to&&(from!==old.qty||to!==order.qty))reason.push(`工序放行量 ${from} → ${to}`);
   if(detailsChanged.has(order.id)&&!oldIssues.has(old.id))reason.push('资料待确认');
  }
  if(part?.unit!==oldPart?.unit)reason.push('单件定额变化');
  if(part?.processMode!==oldPart?.processMode)reason.push('加工方式变化');
  if(worker?.capacity!==oldWorker?.capacity||worker?.overtime!==oldWorker?.overtime)reason.push(`${row.worker} 的产能变化`);
  if(reason.length){
   const prior=conflicts.get(key)?.reason;
   conflicts.set(key,{key,orderNo:row.orderNo,partCode:row.partCode,reason:[...new Set([...(prior?.split('；')||[]),...reason.flatMap(item=>item.split('；'))])].join('；')});
  }
 }
 for(const [key,issue] of conflicts)open.set(key,issue);
 return {changes,conflicts:[...conflicts.values()],openConflicts:[...open.values()]};
}
