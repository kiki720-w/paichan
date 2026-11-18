import type {AppState,Order} from '../scheduler-app';
import type {MesFactory} from './mes-source';

export type MesLocalOrderRow={
 operationId:string;workOrder:string;operationNo:string;operationName:string;partCode?:string;partName?:string;
 drawingNo?:string;due?:string;customer?:string;planned:number|null;completed:number;pendingReports:number;requiresReview:boolean;
};

const turning=/^(车工|粗车|精车|数控车|车削)$/;
const workKey=(orderNo:string,partCode:string)=>JSON.stringify([orderNo,partCode]);

export function mergeMesLocalOrders<S extends Pick<AppState,'orders'|'processTasks'>>(factory:MesFactory,state:S,rows:readonly MesLocalOrderRow[]){
 const orders=[...state.orders];
 const byOperation=new Map(orders.filter(order=>order.mesOperationId).map(order=>[order.mesOperationId,order]));
 const byWork=new Map<string,Order[]>();
 for(const order of orders){
  const key=workKey(order.orderNo,order.partCode);
  byWork.set(key,[...byWork.get(key)||[],order]);
 }
 const tasks=new Map(state.processTasks?.map(task=>[task.id,task]));
 const distinct=[...new Map(rows.map(row=>[row.operationId,row])).values()];
 const operationCount=new Map<string,number>();
 for(const row of distinct){
  if(!row.partCode||!turning.test(row.operationName))continue;
  const key=workKey(row.workOrder,row.partCode);
  operationCount.set(key,(operationCount.get(key)||0)+1);
 }
 let added=0,updated=0,held=0;
 for(const row of distinct){
  const {operationId,workOrder,operationNo,operationName,partCode,planned,completed}=row;
  const linked=byOperation.get(operationId);
  let old=linked;
  if(!old&&partCode&&turning.test(operationName)){
   const key=workKey(workOrder,partCode);
   const related=byWork.get(key)||[];
   const exact=related.filter(order=>!order.mesOperationId&&order.processTaskId&&tasks.get(order.processTaskId)?.operationNo===operationNo);
   const legacy=related.filter(order=>!order.mesOperationId&&!order.processTaskId);
   if(exact.length>1||(!exact.length&&legacy.length&&(legacy.length!==1||operationCount.get(key)!==1||related.length!==1))){held++;continue;}
   old=exact[0]||legacy[0];
  }
  if(!turning.test(operationName)&&!old)continue;
  const issue=row.pendingReports>0?'MES 报工待确认':planned===null||!Number.isFinite(planned)||planned<=0?'MES 计划量待确认':!Number.isFinite(completed)||completed<0||completed>planned?'MES 完工量待确认':row.requiresReview?'MES 工序待确认':!operationId||!operationNo||!workOrder||!partCode||!turning.test(operationName)||linked&&(linked.orderNo!==workOrder||linked.partCode!==partCode||linked.mesOperationNo!==operationNo)?'MES 工序或物料待确认':old?.manualCompletion&&old.manualCompletion.done!==completed?'MES 与人工完工不一致':'';
  // Keep the approval split and its quantities owned by the approval workflow.
  if(old?.approvalExecutionId||old?.outsourcedQuantity||old?.outsourcingParentId){held++;continue;}
  if(issue||planned===null||!partCode){
   held++;
   if(old&&old.mesOrderHold!==issue)orders[orders.indexOf(old)]={...old,mesOrderHold:issue};
   continue;
  }
  const next:Order={...old,id:old?.id??`mes-local:${factory}:${operationId}`,mesOperationId:operationId,mesOperationNo:operationNo,mesOrderHold:undefined,orderNo:workOrder,
   partCode,name:row.partName||old?.name||partCode,drawingNo:row.drawingNo||old?.drawingNo,due:row.due||old?.due||'',customer:row.customer||old?.customer||'',
   qty:planned,done:completed,priority:old?.priority??3,status:planned===completed?'已完成':completed>0?'部分完成':'待排'};
  if(!old){orders.push(next);added++;}
  else if(Object.keys(next).some(key=>next[key as keyof Order]!==old[key as keyof Order])){orders[orders.indexOf(old)]=next;updated++;}
 }
 const changed=orders.length!==state.orders.length||orders.some((order,index)=>order!==state.orders[index]);
 return {state:changed?{...state,orders}:state,added,updated,held};
}
