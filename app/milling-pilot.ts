import type {Allocation,AppState} from './scheduler-app';
import {jointMachineSlots,machineSlotAvailable} from './equipment-capacity';
import {capacityOn,clockMinutes,productionDays,validCalendarDate} from './production-calendar';
import {processRelease,type ProcessTask} from './process-quality';

export type MillingRule={partCode:string;workerId:string;machineId:string;unit:number};
type MillingRow={taskId:string;workOrderNo:string;partCode:string;date:string;worker:string;machineId:string;machineName:string;startTime:string;endTime:string;quantity:number;amount:number};
type MillingGap={taskId:string;workOrderNo:string;partCode:string;quantity:number;reason:string};
export type MillingPlan={rows:MillingRow[];gaps:MillingGap[];date:string;revision:number;confirmedAt?:string;publishedAt?:string};
export type MillingRelease={rows:Allocation[];through:Record<string,number>};

export const isMillingTask=(task:ProcessTask)=>task.operationName.trim()==='铣工';

function committed(state:AppState,task:ProcessTask){
 return Math.max(task.completedQty,...(state.millingReleases||[]).map(release=>release.through[task.id]||0));
}

export function millingDispatch(state:AppState){return (state.millingReleases||[]).flatMap(release=>release.rows)}

export function millingDispatchConflict(rows:Allocation[],reserved:Allocation[]){
 return rows.find(row=>reserved.some(other=>row.date===other.date&&(row.worker===other.worker||row.machineId===other.machineId||(!row.machineId&&row.partCode===other.partCode))&&
  (!row.startTime||!row.endTime||clockMinutes(row.startTime)<clockMinutes(other.endTime!,true)&&clockMinutes(other.startTime!)<clockMinutes(row.endTime,true))));
}

export function validateMillingPlan(state:AppState,plan:MillingPlan,today:string):MillingRelease{
 if(!plan.rows.length)throw Error('草稿没有可发布的铣工安排。');
 const tasks=state.processTasks||[],reserved=[...state.allocations,...millingDispatch(state)];
 const through:Record<string,number>=Object.create(null);
 const rows:Allocation[]=[];
 for(const row of plan.rows){
  const label=row.workOrderNo+' · '+row.partCode;
  const task=tasks.find(item=>item.id===row.taskId&&isMillingTask(item)&&item.workOrderNo===row.workOrderNo&&item.partCode===row.partCode);
  if(!task||!task.predecessorId||!Number.isSafeInteger(row.quantity)||row.quantity<=0)throw Error(label+'：工序或放行资料已变化。');
  const next=(through[task.id]??committed(state,task))+row.quantity;
  if(!Number.isFinite(next)||next>processRelease(task,tasks))throw Error(label+'：安排数量超过当前质检放行余量。');
  const rule=state.millingRules?.find(item=>item.partCode===row.partCode);
  const worker=state.workers.find(item=>item.id===rule?.workerId&&item.name===row.worker&&item.active);
  const machine=state.machines?.find(item=>item.id===rule?.machineId&&item.id===row.machineId&&item.active);
  if(!rule||!worker||!machine||!Number.isFinite(rule.unit)||rule.unit<=0||!Number.isFinite(row.amount)||row.amount<=0||Math.abs(row.amount-row.quantity*rule.unit)>.001||state.parts.some(part=>part.code===row.partCode&&part.processMode==='external'))throw Error(label+'：人员、设备或单件定额已变化。');
  if(!validCalendarDate(row.date)||row.date<today||!validCalendarDate(task.due))throw Error(label+'：派工日期或交期已失效。');
  const allocation:Allocation={...row,orderNo:row.workOrderNo,name:task.partName,drawingNo:task.drawingNo,due:task.due,machineName:machine.name,capacity:worker.capacity,status:row.date>task.due?'延期':'按期',operation:'铣工',planStatus:'已发布'};
  const occupied=reserved.filter(item=>item.date===row.date&&item.worker===row.worker).reduce((total,item)=>total+item.amount,0);
  const capacity=capacityOn(worker,row.date,state.productionCalendar,false,state.workingWindows);
  const equipment={...machine,partCodes:[...new Set([...machine.partCodes,row.partCode])]};
  if(occupied+row.amount>capacity+.001||!machineSlotAvailable(allocation,[equipment],worker,reserved,state.workingWindows,state.productionCalendar))throw Error(label+'：'+row.date+' 人员或设备产能、派工时段或停机有冲突。');
  through[task.id]=next;
  reserved.push(allocation);
  rows.push(allocation);
 }
 return {rows,through};
}

export function generateMillingPlan(state:AppState,date:string,revision:number):MillingPlan{
 const rows:MillingRow[]=[],gaps:MillingGap[]=[];
 const tasks=state.processTasks||[];
 const pending=tasks.filter(task=>isMillingTask(task)&&task.plannedQty>task.completedQty)
  .sort((a,b)=>a.due.localeCompare(b.due)||a.workOrderNo.localeCompare(b.workOrderNo));
 const days=productionDays(date,6,state.productionCalendar);
 for(const task of pending){
  const taskId=task.id,{workOrderNo,partCode}=task;
  const gap=(quantity:number,reason:string)=>gaps.push({taskId,workOrderNo,partCode,quantity,reason});
  const alreadyCommitted=committed(state,task);
  const outstanding=Math.max(0,task.plannedQty-alreadyCommitted);
  const released=task.predecessorId?processRelease(task,tasks):0;
  let quantity=Math.max(0,Math.floor(Math.min(task.plannedQty,released)-alreadyCommitted+1e-8));
  if(outstanding>quantity)gap(outstanding-quantity,task.predecessorId?'前序质检未放行或放行余量不足一件':'请关联前序工序');
  if(quantity===0)continue;
  if(state.parts.some(part=>part.code===partCode&&part.processMode==='external')){gap(quantity,'该物料为外协加工');continue;}
  const rule=state.millingRules?.find(item=>item.partCode===partCode);
  const worker=state.workers.find(item=>item.id===rule?.workerId&&item.active&&item.capacity>0);
  const machine=state.machines?.find(item=>item.id===rule?.machineId&&item.active&&item.capacity>0);
  const missing=[!validCalendarDate(task.due)&&'交期',(!rule||!Number.isFinite(rule.unit)||rule.unit<=0)&&'铣工单件定额',!worker&&'可用铣工人员',!machine&&'可用铣工设备',!state.workingWindows&&'工作时段'].filter(Boolean);
  if(!rule||!worker||!machine||missing.length){gap(quantity,'待补资料：'+missing.join('、'));continue;}
  const equipment={...machine,partCodes:[...new Set([...machine.partCodes,partCode])]};
  for(const day of days){
   if(quantity===0)break;
   const reservations=[...state.allocations,...millingDispatch(state),...rows];
   const occupied=reservations.filter(row=>row.date===day&&row.worker===worker.name).reduce((sum,row)=>sum+row.amount,0);
   const capacity=capacityOn(worker,day,state.productionCalendar,false,state.workingWindows);
   const slots=jointMachineSlots({machines:[equipment],partCode,worker,date:day,calendar:state.productionCalendar,windows:state.workingWindows,rows:reservations,remaining:quantity*rule.unit,workerRemaining:Math.max(0,capacity-occupied),unit:rule.unit});
   for(const slot of slots){
    const count=Math.min(quantity,Math.round(slot.amount/rule.unit));
    if(count<=0)continue;
    const {machineId,machineName,startTime,endTime}=slot;
    rows.push({taskId,workOrderNo,partCode,date:day,worker:worker.name,machineId,machineName,startTime,endTime,quantity:count,amount:count*rule.unit});
    quantity-=count;
   }
  }
  if(quantity>0)gap(quantity,'六个工作日内人员与设备的共同空闲产能不足');
 }
 return {rows,gaps,date,revision};
}
