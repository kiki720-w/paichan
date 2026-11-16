import type {AppState} from './scheduler-app';
import {jointMachineSlots} from './equipment-capacity';
import {capacityOn,productionDays,validCalendarDate} from './production-calendar';
import {processRelease,type ProcessTask} from './process-quality';

export type MillingRule={partCode:string;workerId:string;machineId:string;unit:number};
type MillingRow={taskId:string;workOrderNo:string;partCode:string;date:string;worker:string;machineId:string;machineName:string;startTime:string;endTime:string;quantity:number;amount:number};
type MillingGap={taskId:string;workOrderNo:string;partCode:string;quantity:number;reason:string};
export type MillingPlan={rows:MillingRow[];gaps:MillingGap[];date:string;revision:number};

export const isMillingTask=(task:ProcessTask)=>task.operationName.trim()==='铣工';

export function generateMillingPlan(state:AppState,date:string,revision:number):MillingPlan{
 const rows:MillingRow[]=[],gaps:MillingGap[]=[];
 const tasks=state.processTasks||[];
 const pending=tasks.filter(task=>isMillingTask(task)&&task.plannedQty>task.completedQty)
  .sort((a,b)=>a.due.localeCompare(b.due)||a.workOrderNo.localeCompare(b.workOrderNo));
 const days=productionDays(date,6,state.productionCalendar);
 for(const task of pending){
  const taskId=task.id,{workOrderNo,partCode}=task;
  const gap=(quantity:number,reason:string)=>gaps.push({taskId,workOrderNo,partCode,quantity,reason});
  const outstanding=task.plannedQty-task.completedQty;
  const released=task.predecessorId?processRelease(task,tasks):0;
  let quantity=Math.max(0,Math.floor(Math.min(task.plannedQty,released)-task.completedQty+1e-8));
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
   const reservations=[...state.allocations,...rows];
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
