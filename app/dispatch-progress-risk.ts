import type {AppState,Allocation} from './scheduler-app';
import {partWithMesOperationQuota} from './mes-operation-quotas';
import {validCalendarDate} from './production-calendar';

const factoryClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'});

type DispatchSubject={
 id:string;orderId?:string;orderNo:string;partCode:string;operation?:string;planned:number;actual:number;due?:string;
 source:string;reportedAt?:string;hold?:string;unit?:number;
};
type RiskBase=Pick<DispatchSubject,'orderId'|'orderNo'|'partCode'|'operation'|'source'|'reportedAt'>&{key:string;version:string;detectedAt:string};
type ProgressGap=RiskBase&{expected:number;actual:number;gap:number};
type ProgressBlock=RiskBase&{reason:string};
type PredictedDelay=RiskBase&{due:string;expectedFinish:string;remaining:number};

export function dispatchProgressRisks(state:AppState,at:string,tolerance=state.progressTolerance??0){
 const [day,clock]=factoryClock.format(new Date(at)).split(' ');
 const elapsed=(row:Allocation)=>row.date<day||(row.date===day&&!!row.endTime&&row.endTime<=clock);
 const snapshot=state.history?.find(item=>item.id===state.planSnapshotId);
 const regularRows=snapshot?.status==='已发布'?snapshot.allocations
  :state.planStatus==='已发布'&&(!snapshot||snapshot.status===undefined)?state.allocations:[];
 const version=state.planSnapshotId||state.planUpdatedAt||state.lastRun||'旧版派工';
 const groups=new Map<string,{base:RiskBase;subject:DispatchSubject;quantity:number;invalid:boolean;future:{date:string;quantity:number}[]}>();
 const blocked=new Map<string,ProgressBlock>();
 const ordersById=new Map(state.orders.map(order=>[order.id,order]));
 const partByCode=new Map(state.parts.map(part=>[part.code,part]));
 const mesLinks=state.mesSync?.links||{};
 const sourceConflicts=new Set(Object.keys(state.mesSync?.manualConflicts||{}).map(key=>mesLinks[key]?.orderId).filter(Boolean));
 const ordersByKey=new Map<string,AppState['orders']>();
 for(const order of state.orders){
  const key=JSON.stringify([order.orderNo,order.partCode]);
  const matches=ordersByKey.get(key)||[];
  matches.push(order);
  ordersByKey.set(key,matches);
 }
 function collect(row:Allocation,plan:string,subject?:DispatchSubject){
  const identity=subject?.id||row.orderId||row.taskId||[row.orderNo,row.partCode];
  const key=JSON.stringify([plan,identity,subject?'进度落后':'无法对应订单']);
  const base={key,version:plan,detectedAt:at,orderId:subject?.orderId,orderNo:row.orderNo,partCode:row.partCode,operation:subject?.operation,source:subject?.source||'待核对',reportedAt:subject?.reportedAt};
  if(!subject){blocked.set(key,{...base,reason:'无法唯一对应订单'});return;}
  const group=groups.get(key)||{base,subject,quantity:0,invalid:false,future:[]};
  const qty=row.quantity??(row.amount/(subject.unit||NaN));
  group.invalid||=!Number.isFinite(qty)||qty<0;
  if(elapsed(row))group.quantity+=qty;
  else group.future.push({date:row.date,quantity:qty});
  groups.set(key,group);
 }
 for(const row of regularRows){
  const candidates=ordersByKey.get(JSON.stringify([row.orderNo,row.partCode]));
  const order=row.orderId?ordersById.get(row.orderId):candidates?.length===1?candidates[0]:undefined;
  if(!order||order.orderNo!==row.orderNo||order.partCode!==row.partCode){collect(row,version);continue;}
  const part=partWithMesOperationQuota(order,partByCode.get(order.partCode),state.mesOperationQuotas||[]);
  const manual=order.manualCompletion;
  const isMes=!!order.mesOperationId;
  const source=manual?'人工完工更正':isMes?'MES':'序衡订单进度';
  const hold=order.mesOrderHold||(sourceConflicts.has(order.id)?'MES 与人工完工量待确认':undefined);
  collect(row,version,{id:order.id,orderId:order.id,orderNo:order.orderNo,partCode:order.partCode,operation:order.mesOperationNo,
   planned:order.qty,actual:manual?.done??order.done,due:order.due,source,reportedAt:manual?.at||(isMes?state.mesOrderSync?.lastChangedAt:state.importedAt),unit:part?.unit,hold});
 }
 const millingById=new Map((state.processTasks||[]).map(task=>[task.id,task]));
 for(const release of state.millingReleases||[]){
  for(const row of release.rows.filter(row=>row.planStatus==='已发布')){
   const task=millingById.get(row.taskId||'');
   const millingVersion='铣工已发布';
   if(!task||task.workOrderNo!==row.orderNo||task.partCode!==row.partCode){collect(row,millingVersion);continue;}
   const source=task.millingReports?.length?'人工完工登记':'工序进度';
   collect(row,millingVersion,{id:task.id,orderNo:task.workOrderNo,partCode:task.partCode,operation:task.operationName,
    planned:task.plannedQty,actual:task.completedQty,due:task.due,source,reportedAt:task.lastReportAt});
  }
 }
 const gaps:ProgressGap[]=[];
 const predicted:PredictedDelay[]=[];
 for(const {base,subject,quantity,invalid,future} of groups.values()){
  const {actual,planned,due}=subject;
  const reason=subject.hold||(invalid?'缺少有效派工数量或单件工时':!Number.isFinite(actual)||!Number.isFinite(planned)||actual<0||planned<=0||actual>planned?'计划量或完工量待核对':'');
  if(reason){
   const key=JSON.stringify([base.version,subject.id,'进度资料待确认']);
   blocked.set(key,{...base,key,reason});
   continue;
  }
  const expected=Math.min(planned,quantity);
  const gap=expected-actual;
  const allowed=Number.isFinite(tolerance)?Math.max(0,tolerance):0;
  if(gap>allowed+0.000001)gaps.push({...base,expected,actual,gap});
  const remaining=planned-actual;
  if(!due||!validCalendarDate(due)||remaining<=.000001)continue;
  let allocated=0;
  for(const slot of future.sort((a,b)=>a.date.localeCompare(b.date))){
   allocated+=slot.quantity;
   if(allocated+.000001<remaining)continue;
   if(slot.date>due)predicted.push({...base,key:JSON.stringify([base.version,subject.id,'预计延期']),due,expectedFinish:slot.date,remaining});
   break;
  }
 }
 return {gaps:gaps.sort((a,b)=>b.gap-a.gap),blocked:[...blocked.values()],predicted};
}
