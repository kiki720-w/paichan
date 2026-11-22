import type {Allocation,AppState,Order,ScheduleShortage,schedule as scheduleEngine} from './scheduler-app';
import {allocationBelongsTo,orderDataProblems,rankedOrderCandidates} from './feedback-rules';
import {capacityOn,productionDays,validCalendarDate} from './production-calendar';
import {partWithMesOperationQuota} from './mes-operation-quotas';
import {releasedOrder} from './process-quality';
import {millingDispatch} from './milling-pilot';
import {forecastDeliveryBatches,validateDeliveryBatches,type DeliveryBatch} from './delivery-batches';

export type SchedulingScenario=
 | {kind:'insert';orderNo:string;partCode:string;quantity:number;due:string}
 | {kind:'leave';workerId:string;start:string;end:string}
 | {kind:'due';orderId:string;due:string}
 | {kind:'split';orderId:string;batches:DeliveryBatch[]};

const FORECAST_DAYS=30;
const RELEASE_DAYS=6;
const EPSILON=.001;
const partFor=(state:AppState,order:Order)=>partWithMesOperationQuota(order,state.parts.find(part=>part.code===order.partCode),state.mesOperationQuotas||[]);
const external=(order:Order,mode?:string)=>mode==='external'||!!(order.outsourcingParentId||order.outsourcingProgress);

function conflictingOrders(state:AppState){
 const links=state.mesSync?.links||{};
 return new Set(Object.keys(state.mesSync?.manualConflicts||{}).map(key=>links[key]?.orderId).filter(Boolean));
}

export function prepareSchedulingScenario(state:AppState,scenario:SchedulingScenario,start:string){
 if(!validCalendarDate(start))throw Error('基准日期无效。');
 const active=state.history?.find(item=>item.id===state.planSnapshotId);
 const frozen=state.planStatus==='已发布'||state.planStatus==='已确认'||active?.status==='已发布'||active?.status==='已确认';
 const milling=millingDispatch(state);
 let retained=frozen?state.allocations:[] as Allocation[],conflicts:Allocation[]=[];
 let modified=state;
 let deliveries:DeliveryBatch[]|undefined;
 if(scenario.kind==='leave'){
  const worker=state.workers.find(item=>item.id===scenario.workerId&&item.active);
  if(!worker||!validCalendarDate(scenario.start)||!validCalendarDate(scenario.end)||scenario.end<scenario.start||scenario.end<start)throw Error('请选择启用的人员和有效的请假日期。');
  const affected=(row:Allocation)=>row.worker===worker.name&&row.date>=scenario.start&&row.date<=scenario.end;
  conflicts=[...(frozen?state.allocations:[]),...milling].filter(affected);
  if(!frozen)retained=state.allocations.filter(row=>!affected(row));
  modified={...state,productionCalendar:[...(state.productionCalendar||[]),{id:'scenario-leave',kind:'leave',start:scenario.start,end:scenario.end,workerIds:[worker.id],note:'情景试算'}]};
 }else{
  let subject:Order;
  if(scenario.kind==='insert'){
   const orderNo=scenario.orderNo.trim();
   const part=state.parts.find(item=>item.code===scenario.partCode);
   if(!orderNo||state.orders.some(order=>order.orderNo===orderNo)||!part)throw Error('请填写未使用的工单号并选择工件。');
   subject={id:'scenario-new-order',orderNo,customer:'',partCode:part.code,name:part.name,drawingNo:part.drawingNo,qty:scenario.quantity,done:0,due:scenario.due,priority:1,status:'待排'};
   modified={...state,orders:[...state.orders,subject]};
  }else{
   const order=state.orders.find(item=>item.id===scenario.orderId);
   if(!order||order.done>=order.qty)throw Error('请选择本厂待加工订单。');
   if(scenario.kind==='split')deliveries=validateDeliveryBatches(scenario.batches,order.qty,order.done);
   subject={...order,due:scenario.kind==='due'?scenario.due:deliveries?.[0].due||order.due};
   modified={...state,orders:state.orders.map(item=>item.id===order.id?subject:item)};
  }
  if(!validCalendarDate(subject.due))throw Error('请填写有效交期。');
  const part=partFor(modified,subject),problems=orderDataProblems(subject,part);
  if(subject.mesOrderHold)problems.push(subject.mesOrderHold);
  else if(conflictingOrders(state).has(subject.id))problems.push('MES 与人工完工量待确认');
  if(external(subject,part?.processMode))problems.push('外协工序');
  if(part&&!rankedOrderCandidates(subject,part,state.workers,state.hourTierRules).workers.length)problems.push('无可加工人员');
  if(problems.length)throw Error(problems.join('、'));
 }

 return {modified,retained,conflicts,milling,deliveries};
}

export function simulateSchedulingScenario(state:AppState,scenario:SchedulingScenario,factory:string,revision:number,start:string,run:typeof scheduleEngine){
 const {modified,retained,conflicts,milling,deliveries}=prepareSchedulingScenario(state,scenario,start);
 const sourceConflicts=conflictingOrders(state);
 function forecast(data:AppState,overtime:boolean,strategy:'earliest'|'balance'='earliest'){
  const end=productionDays(start,RELEASE_DAYS,data.productionCalendar).at(-1)||start;
  const horizonEnd=productionDays(start,FORECAST_DAYS,data.productionCalendar).at(-1)||start;
  const heldByOrder=new Map<string,Allocation[]>();
  const prepared=data.orders.flatMap(input=>{
   if(input.mesOrderHold||sourceConflicts.has(input.id)){
    return [{...input,mesOrderHold:input.mesOrderHold||'MES 与人工完工量待确认'}];
   }
   if(input.status==='已完成'||(input.qty>0&&input.done===input.qty))return [];
   const order=releasedOrder(input,data.processTasks),part=partFor(data,order);
   if(external(order,part?.processMode))return [];
   if((order.processTaskId||order.id.startsWith('mes-process-order|'))&&order.qty<=order.done){
    return [{...input,mesOrderHold:'等待前序质检放行'}];
   }
   const old=retained.filter(row=>row.date>=start&&allocationBelongsTo(row,order,data.orders));
   heldByOrder.set(order.id,old);
   if(retained.some(row=>row.date>=start&&!row.orderId&&row.orderNo===order.orderNo&&row.partCode===order.partCode&&!old.includes(row)))return [{...order,mesOrderHold:order.mesOrderHold||'已有派工无法唯一对应订单'}];
   if(!part?.unit||orderDataProblems(order,part).length)return [order];
   const amount=old.reduce((sum,row)=>sum+row.amount,0);
   return [{...order,done:Math.min(order.qty,order.done+amount/part.unit)}];
  });
  const result=run({...data,orders:prepared,allocations:retained},overtime,true,FORECAST_DAYS,start,strategy);
  const excluded=new Set(result.blocked.map(item=>item.key));
  const shortage=new Set(result.shortages.map(item=>item.orderId));
  const allocations=new Map<string,Allocation[]>();
  for(const row of result.allocations){
   if(!row.orderId)continue;
   const rows=allocations.get(row.orderId)||[];
   rows.push(row);
   allocations.set(row.orderId,rows);
  }
  let sixDayGap=0,unfinished=0,late=0;
  const sixDayShortages:ScheduleShortage[]=[];
  const items=prepared.map(order=>{
   const rows=allocations.get(order.id)||[],old=heldByOrder.get(order.id)||[];
   const part=partFor(data,order);
   const notReady=excluded.has(order.id)||!!order.mesOrderHold;
   const last=[...old,...rows].map(row=>row.date).sort().at(-1);
   const finish=notReady||shortage.has(order.id)||!last||last>horizonEnd?null:last;
   if(!notReady){
    const within=rows.filter(row=>row.date<=end).reduce((sum,row)=>sum+row.amount,0);
    const retainedAfterWindow=old.filter(row=>row.date>end).reduce((sum,row)=>sum+row.amount,0);
    const remainingWork=Math.max(0,(order.qty-order.done)*(part?.unit||0)-within+retainedAfterWindow);
    sixDayGap+=remainingWork;
    if(part?.unit&&remainingWork>EPSILON){
     const keptWork=old.reduce((sum,row)=>sum+row.amount,0);
     const requiredWork=(order.qty-order.done)*part.unit+keptWork;
     sixDayShortages.push({orderId:order.id,orderNo:order.orderNo,partCode:order.partCode,drawingNo:order.drawingNo,
      name:order.name,due:order.due,requiredWork,remainingWork,scheduledWork:requiredWork-remainingWork,
      remainingQty:remainingWork/part.unit,estimatedFinish:finish||undefined,reason:'六工作日内剩余产能不足'});
    }
    if(!finish)unfinished++;
    if(!finish||finish>order.due)late++;
   }
   const signature=rows.map(row=>[row.date,row.worker,row.machineId,row.startTime,row.endTime,row.amount]);
   return {id:order.id,orderNo:order.orderNo,partCode:order.partCode,due:order.due,finish,notReady,signature,workers:[...new Set([...old,...rows].map(row=>row.worker))]};
  });
  const byDay=new Map<string,{worker:string;date:string;planned:number;locked:number}>();
  for(const [locked,rows] of [[true,[...retained,...milling]],[false,result.allocations]] as const)for(const row of rows){
   const key=JSON.stringify([row.worker,row.date]),item=byDay.get(key)||{worker:row.worker,date:row.date,planned:0,locked:0};
   if(locked)item.locked+=row.amount;else item.planned+=row.amount;
   byDay.set(key,item);
  }
  const workers=new Map(data.workers.map(worker=>[worker.name,worker]));
  const overtimeWork=[...byDay.values()].reduce((sum,item)=>{
   const worker=workers.get(item.worker);
   if(!worker||!item.planned)return sum;
   const limit=capacityOn(worker,item.date,data.productionCalendar,false,data.workingWindows);
   return sum+Math.max(0,item.planned+item.locked-limit)-Math.max(0,item.locked-limit);
  },0);
  const blocked=[...result.blocked,...prepared.filter(order=>order.mesOrderHold&&!excluded.has(order.id))
   .map(order=>({key:order.id,orderNo:order.orderNo,partCode:order.partCode,reason:order.mesOrderHold!}))];
  return {rows:result.allocations,sixDays:result.allocations.filter(row=>row.date<=end),sixDayGap,sixDayShortages,unfinished,late,items,blocked,overtimeWork,
   loads:[...byDay.values()].filter(item=>item.date>=start&&item.date<=end).sort((a,b)=>a.date.localeCompare(b.date)||a.worker.localeCompare(b.worker,'zh-CN'))};
 }
 const baseline=forecast(state,false),normal=forecast(modified,false),extra=forecast(modified,true);
 const signature=(value:typeof normal)=>JSON.stringify(value.items.map(item=>[item.id,item.signature]));
 const overtime=extra.overtimeWork>EPSILON&&signature(extra)!==signature(normal)?extra:null;
 const balanced=overtime?null:forecast(modified,false,'balance');
 const alternate=balanced&&signature(balanced)!==signature(normal)?balanced:null;
 const old=new Map(baseline.items.map(item=>[item.id,item]));
 const comparison=normal.items.flatMap(item=>{
  const before=old.get(item.id);
  const withOvertime=overtime?.items.find(row=>row.id===item.id);
  const other=(overtime||alternate)?.items.find(row=>row.id===item.id);
  const normalChanged=!before||before.due!==item.due||before.finish!==item.finish||JSON.stringify(before.signature)!==JSON.stringify(item.signature);
  if(!normalChanged&&(!other||JSON.stringify(item.signature)===JSON.stringify(other.signature)))return [];
  const overtimeChanged=!!withOvertime&&(!before||before.due!==item.due||before.finish!==withOvertime.finish||JSON.stringify(before.signature)!==JSON.stringify(withOvertime.signature));
  return [{...item,normalChanged,overtimeChanged,beforeDue:before?.due||null,beforeFinish:before?.finish||null,beforeWorkers:before?.workers||[],
   overtimeFinish:withOvertime?.finish||null,otherFinish:other?.finish||null,otherWorkers:other?.workers||[]}];
 });
 const deliveryForecast=(plan:typeof normal)=>{
  if(scenario.kind!=='split'||!deliveries)return [];
  const order=state.orders.find(item=>item.id===scenario.orderId)!;
  if(plan.items.find(item=>item.id===order.id)?.notReady)return deliveries.map(batch=>({...batch,finish:null,scheduled:0}));
  const end=productionDays(start,FORECAST_DAYS,state.productionCalendar).at(-1)||start;
  const rows=[...retained.filter(row=>row.date>=start&&row.date<=end&&allocationBelongsTo(row,order,state.orders)),
   ...plan.rows.filter(row=>row.orderId===order.id)];
  const part=partFor(state,order);
  return forecastDeliveryBatches(deliveries,part?.unit||0,rows);
 };
 return {factory,revision,scenario,start,forecastDays:FORECAST_DAYS,retained:[...retained,...milling],conflicts,baseline,normal,overtime,alternate,comparison,
  deliveries:deliveryForecast(normal),otherDeliveries:overtime||alternate?deliveryForecast((overtime||alternate)!):[]};
}

export type SchedulingScenarioResult=ReturnType<typeof simulateSchedulingScenario>;
