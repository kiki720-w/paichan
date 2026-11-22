import type {Allocation,AppState,ImportIssue,Order,Part,ScheduleShortage,Worker} from './scheduler-app';
import {capacityOn,productionDays,type CalendarEntry} from './production-calendar';
import {orderDataProblems,rankedOrderCandidates,type HourTierRule} from './feedback-rules';
import {jointMachineSlots,type MachineSlot} from './equipment-capacity';
import {partWithMesOperationQuota} from './mes-operation-quotas';
import {releasedOrder} from './process-quality';

const formatLocalDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>formatLocalDate(new Date());
const addDay=(s:string,n=1)=>{const [year,month,day]=s.split('-').map(Number);const d=new Date(year,month-1,day);d.setDate(d.getDate()+n);return formatLocalDate(d)};
export const isExternal=(part?:Part,order?:Order)=>part?.processMode==='external'||Boolean(order?.outsourcingParentId||order?.outsourcingProgress);
export const PLAN_DAYS=6;

export function schedule(state:AppState,useOvertime=false,preserveExisting=false,windowDays=PLAN_DAYS,startDate=today(),strategy:'earliest'|'balance'='earliest'){
 const loads=new Map<string,number>(),out:Allocation[]=[],shortages:ScheduleShortage[]=[],blocked:ImportIssue[]=[];
 const reserved=[...(state.millingReleases||[]).flatMap(release=>release.rows),...(preserveExisting?state.allocations:[])];
 const loadTotals=new Map<string,number>(),occupiedDays=new Map<string,Allocation[]>();
 const machineDays=new Set<string>(),capacities=new Map<string,number>();
 function recordLoad(row:Allocation,worker?:Worker){
  const rows=occupiedDays.get(row.date)||[];
  rows.push(row);occupiedDays.set(row.date,rows);
  if(row.machineId)machineDays.add(JSON.stringify([row.worker,row.date]));
  if(worker){
   const key=worker.id+'|'+row.date;
   loads.set(key,(loads.get(key)||0)+row.amount);
   loadTotals.set(worker.id,(loadTotals.get(worker.id)||0)+row.amount);
  }
 }
 for(const row of reserved)recordLoad(row,state.workers.find(item=>item.name===row.worker));
 const days=productionDays(startDate,windowDays,state.productionCalendar);
 const partFor=(order:Order)=>{
  const part=state.parts.find(item=>item.code===order.partCode);
  return state.mesOperationQuotas?.length?partWithMesOperationQuota(order,part,state.mesOperationQuotas):part;
 };
 const workOf=(o:Order)=>Math.max(0,o.qty-o.done)*(partFor(o)?.unit||0);
 const orders=state.orders.map(order=>releasedOrder(order,state.processTasks)).filter(o=>!orderIsComplete(o)&&!isExternal(partFor(o),o)&&(!(o.processTaskId||o.id.startsWith('mes-process-order|'))||o.qty>o.done)).sort((a,b)=>a.priority-b.priority||(a.due||'').localeCompare(b.due||'')||workOf(a)-workOf(b));
 for(const order of orders){
  const part=partFor(order);
  const {problems,ranked}=checkOrderForSchedule(order,part,state.workers,state.hourTierRules);
  if(problems.length){blocked.push(toReviewIssue(order,problems));continue}
  if(!part||!ranked)continue;
  const requiredWork=(order.qty-order.done)*part.unit;
  const equipment=state.machines?.filter(machine=>machine.partCodes.includes(part.code))||[];
  // Explicitly selected workers are a hard constraint. Category skills are
  // only a fallback for legacy parts that have no selected workers.
   const candidates=strategy==='balance'?[...ranked.workers].reverse():ranked.workers;
   let best:{w:Worker,finish:string,plan:({date:string,amount:number,capacity:number}&Partial<MachineSlot>)[],remaining:number,preferred:boolean,existingLoadRatio:number,finishRatio:number}|null=null;
   for(const w of candidates){
    let remain=requiredWork,finish=days.at(-1)||today();
    const plan:({date:string;amount:number;capacity:number}&Partial<MachineSlot>)[]=[];
    for(const date of days){
     const key=w.id+'|'+date;
     let capacity=capacities.get(key);
     if(capacity===undefined){capacity=capacityOn(w,date,state.productionCalendar,useOvertime,state.workingWindows);capacities.set(key,capacity);}
     const workerRemaining=Math.max(0,capacity-(loads.get(key)||0));
     if(!workerRemaining)continue;
     if(equipment.length){
      const slots=jointMachineSlots({machines:equipment,partCode:part.code,worker:w,date,calendar:state.productionCalendar,windows:state.workingWindows,rows:occupiedDays.get(date)||[],remaining:remain,workerRemaining, overtime:useOvertime});
      plan.push(...slots.map(slot=>({...slot,date})));
      remain-=slots.reduce((sum,slot)=>sum+slot.amount,0);
      if(remain<=.001){finish=date;break}
      continue;
     }
     if(machineDays.has(JSON.stringify([w.name,date])))continue;
     const amount=Math.min(remain,workerRemaining);
     if(amount<=0)continue;
     plan.push({date,amount,capacity});
     remain-=amount;
     if(remain<=.001){finish=date;break}
    }
    const preferred=ranked.preferredIds.has(w.id),last=plan.at(-1);
    const finishRatio=last?((loads.get(w.id+'|'+last.date)||0)+last.amount)/last.capacity:Number.POSITIVE_INFINITY;
    const nominalCapacity=useOvertime?w.overtime:w.capacity;
    const existingLoadRatio=(loadTotals.get(w.id)||0)/Math.max(1,nominalCapacity);
    const earlier=best&&(finish<best.finish||(finish===best.finish&&(finishRatio<best.finishRatio||(finishRatio===best.finishRatio&&existingLoadRatio<best.existingLoadRatio))));
    const betterOrder=strategy==='balance'&&best&&existingLoadRatio!==best.existingLoadRatio?existingLoadRatio<best.existingLoadRatio:earlier;
    if(!best||remain<best.remaining||(remain===best.remaining&&((preferred&&!best.preferred)||(preferred===best.preferred&&betterOrder)))){
     best={w,finish,plan,remaining:remain,preferred,existingLoadRatio,finishRatio};
    }
   }
   if(!best)continue;
   const candidateNames=candidates.map(w=>w.name);
   let matchBasis='按加工类别匹配';
   if(order.workerAssignment?.workerId)matchBasis='订单人工指定';
   else if(part.workers.length)matchBasis='工件指定人员';
   else if(ranked.rule)matchBasis=ranked.rule.mode==='exclusive'?'工时分档限定人员':best.preferred?'工时分档首选人员':'工时分档产能不足启用候补';
   const selection=candidates.length===1?'唯一可加工人员':strategy==='balance'?'候选人中优先平衡负荷':'候选人中预计最早完成',due=order.due.trim();
   for(const slot of best.plan){
    const row:Allocation={...slot,orderId:order.id,drawingNo:order.drawingNo?.trim()||part.drawingNo?.trim(),
     worker:best.w.name,orderNo:order.orderNo,partCode:order.partCode,name:order.name,due,
     status:slot.date<=due?'按期':'延期',reason:`${matchBasis}；${selection}${useOvertime?'；加班产能待主管批准':''}`,candidates:candidateNames};
    recordLoad(row,best.w);out.push(row);
   }
   if(best.remaining>.001){
    const estimated=equipment.length||windowDays>PLAN_DAYS?undefined:
     estimateCalendarFinish(best.w,addDay(days.at(-1)||today()),best.remaining,state.productionCalendar,useOvertime,state.workingWindows);
    let reason='六工作日计划窗口内产能不足';
    if(windowDays>PLAN_DAYS)reason='预测窗口内剩余产能不足';
    else if(equipment.length)reason='六工作日内人员与设备共同可用产能不足，请核对设备、停机和工作时段';
    shortages.push({orderId:order.id,drawingNo:order.drawingNo||part.drawingNo,orderNo:order.orderNo,partCode:order.partCode,
     name:order.name,due,requiredWork,scheduledWork:requiredWork-best.remaining,remainingWork:best.remaining,
     remainingQty:best.remaining/part.unit,suggestedWorker:best.w.name,estimatedFinish:estimated,reason});
   }
 }
 return {allocations:out.sort((a,b)=>a.date.localeCompare(b.date)||a.worker.localeCompare(b.worker)),shortages,blocked};
}

export function orderIsComplete(order:Order){
 return order.status==='已完成'||(order.qty>0&&order.done===order.qty);
}
function estimateCalendarFinish(worker:Worker,start:string,work:number,calendar:CalendarEntry[]|undefined,overtime:boolean,windows?:string){
 if(!(overtime?worker.overtime:worker.capacity))return undefined;
 let day=start;
 for(let i=0;i<3660;i++,day=addDay(day)){
  work-=capacityOn(worker,day,calendar,overtime,windows);
  if(work<=.001)return day;
 }
 return undefined;
}

export function checkOrderForSchedule(order:Order,part:Part|undefined,workers:Worker[],rules:HourTierRule[]=[]){
 const problems=orderDataProblems(order,part);
 if(order.mesOrderHold)problems.unshift(order.mesOrderHold);
 const ranked=part?rankedOrderCandidates(order,part,workers,rules):undefined;
 if(part&&!ranked?.workers.length)problems.push('无可加工人员');
 return {problems,ranked};
}
export function toReviewIssue(order:Order,problems:string[]):ImportIssue{
 return {key:order.id,orderNo:order.orderNo,partCode:order.partCode,name:order.name,reason:problems.join('；')};
}
