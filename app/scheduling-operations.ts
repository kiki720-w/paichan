import {capacityOn,productionDays} from './production-calendar';
import {allocationBelongsTo, orderDataProblems, rankedOrderCandidates} from './feedback-rules';
import type {Allocation, AppState, ScheduleShortage} from './scheduler-app';

const epsilon=.001;

export function gapKey(row:ScheduleShortage){
 return row.orderId||JSON.stringify([row.orderNo,row.partCode]);
}

export function previewBatchGaps(state:Pick<AppState,'orders'|'parts'|'workers'|'allocations'|'scheduleShortages'|'hourTierRules'|'productionCalendar'>,selected:readonly string[],startDate:string){
 const from=new Date(startDate+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(from.getTime())||from.toISOString().slice(0,10)!==startDate)throw Error('请选择有效的补排日期');
 if(!selected.length)throw Error('请选择至少一个产能缺口');
 const days=productionDays(startDate,6,state.productionCalendar);
 const keys=new Set(selected),gaps=state.scheduleShortages||[];
 const chosen=gaps.filter(gap=>keys.has(gapKey(gap)));
 if(chosen.length!==keys.size)throw Error('缺口记录已变化，请重新选择');
 const allocations=[...state.allocations],shortages=gaps.filter(gap=>!keys.has(gapKey(gap)));
 const loads=new Map<string,number>();
 const slot=(worker:string,day:string)=>JSON.stringify([worker,day]);
 for(const row of allocations){
  const key=slot(row.worker,row.date);
  if(!Number.isFinite(row.amount)||row.amount<0)throw Error('已有派工工作量无效，请先核对');
  loads.set(key,(loads.get(key)||0)+row.amount);
 }
 const items:{key:string;orderNo:string;added:number;remaining:number;note:string}[]=[];
 for(const gap of chosen){
  const matched=state.orders.filter(o=>gap.orderId?o.id===gap.orderId:o.orderNo===gap.orderNo&&o.partCode===gap.partCode);
  const order=matched.length===1?matched[0]:undefined;
  const part=state.parts.find(p=>p.code===order?.partCode);
  const blocked=order?orderDataProblems(order,part):['无法唯一对应订单'];
  if(order&&allocations.some(row=>!row.orderId&&row.orderNo===order.orderNo&&row.partCode===order.partCode&&!allocationBelongsTo(row,order,state.orders))){
   blocked.push('旧派工无法唯一对应订单，请先核对订单编号');
  }
  if(!order||!part||blocked.length||order.status==='已完成'||part.processMode==='external'){
   shortages.push(gap);
   items.push({key:gapKey(gap),orderNo:gap.orderNo,added:0,remaining:gap.remainingWork,note:blocked.join('；')||'不属于未完成内部订单'});
   continue;
  }
  const required=Math.max(0,order.qty-order.done)*part.unit;
  const scheduled=allocations.filter(row=>allocationBelongsTo(row,order,state.orders)).reduce((total,row)=>total+row.amount,0);
  const needed=Math.max(0,required-scheduled);
  const ranked=rankedOrderCandidates(order,part,state.workers,state.hourTierRules);
  let best:{rows:Allocation[];remaining:number;preferred:boolean}|undefined;
  for(const worker of ranked.workers){
   if(!Number.isFinite(worker.capacity)||worker.capacity<=0)continue;
   const rows:Allocation[]=[];
   let remaining=needed;
   for(const date of days){
    if(remaining<=epsilon)break;
    const capacity=capacityOn(worker,date,state.productionCalendar);
    const amount=Math.min(remaining,Math.max(0,capacity-(loads.get(slot(worker.name,date))||0)));
    if(amount<=epsilon)continue;
    rows.push({orderId:order.id,orderNo:order.orderNo,partCode:order.partCode,name:order.name,drawingNo:order.drawingNo?.trim()||part.drawingNo?.trim(),date,worker:worker.name,amount,capacity,due:order.due,status:date<=order.due?'按期':'延期',reason:'产能缺口批量补排 · 正常班剩余产能'});
    remaining-=amount;
   }
   const preferred=ranked.preferredIds.has(worker.id);
   if(!best||remaining<best.remaining-epsilon||(Math.abs(remaining-best.remaining)<=epsilon&&preferred&&!best.preferred))best={rows,remaining,preferred};
  }
  const remaining=best?.remaining??needed,added=needed-remaining;
  for(const row of best?.rows||[]){
   allocations.push(row);
   const key=slot(row.worker,row.date);loads.set(key,(loads.get(key)||0)+row.amount);
  }
  const note=remaining>epsilon?(ranked.workers.length?'补排窗口内正常班产能仍不足':'没有可加工人员'):needed<=epsilon?'当前已无未排工作量':'已补排';
  if(remaining>epsilon)shortages.push({...gap,requiredWork:required,scheduledWork:scheduled+added,remainingWork:remaining,remainingQty:remaining/part.unit,reason:note,estimatedFinish:undefined});
  items.push({key:gapKey(gap),orderNo:gap.orderNo,added,remaining,note});
 }
 return {allocations,shortages,items};
}

type TimedRow={worker:string;date:string;startTime?:string;endTime?:string};

function clockMinutes(value:string,allowEnd=false){
 if(allowEnd&&value==='24:00')return 1440;
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('时间格式应为 HH:mm');
 const [h,m]=value.split(':').map(Number);return h*60+m;
}
function clockText(minutes:number){
 return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}
function workingWindows(value:string){
 if(!value.trim())throw Error('请先填写工作时段');
 const windows=value.split(/[,，;；]/).map(window=>{
  const [a,b,...rest]=window.trim().split(/\s*[-–—]\s*/);
  if(!a||!b||rest.length)throw Error('工作时段格式：HH:mm-HH:mm');
  const start=clockMinutes(a),end=clockMinutes(b,true);
  if(end<=start)throw Error('工作时段结束时间须晚于开始时间');
  return {start,end};
 }).sort((a,b)=>a.start-b.start);
 if(windows.some((window,i)=>i>0&&window.start<windows[i-1].end))throw Error('工作时段不能重叠');
 return windows;
}
export function validateWorkingWindows(rows:readonly TimedRow[],value:string){
 const windows=workingWindows(value);
 for(const row of rows){
  if(!row.startTime||!row.endTime)continue;
  const start=clockMinutes(row.startTime),end=clockMinutes(row.endTime,true);
  if(end<=start||!windows.some(window=>start>=window.start&&end<=window.end))throw Error('新工作时段与已有派工不兼容，请先调整该派工');
 }
}
export function setDispatchSlot<T extends TimedRow>(rows:readonly T[],index:number,windowsText:string,startTime:string,duration:number){
 const row=rows[index];
 if(!row)throw Error('该派工已变更，请刷新后重试');
 if(!Number.isInteger(duration)||duration<=0)throw Error('时长必须为正整数分钟');
 const start=clockMinutes(startTime),end=start+duration,windows=workingWindows(windowsText);
 if(!windows.some(window=>start>=window.start&&end<=window.end))throw Error('派工须完整落在一个工作时段内');
 for(const [i,other] of rows.entries()){
  if(i===index||other.date!==row.date||other.worker!==row.worker||!other.startTime||!other.endTime)continue;
  if(start<clockMinutes(other.endTime,true)&&end>clockMinutes(other.startTime))throw Error('与该人员当日已设置的派工时段重叠');
 }
 return rows.map((item,i)=>i===index?{...item,startTime,endTime:clockText(end)}:item);
}
export function shiftDispatchSlot<T extends TimedRow>(rows:readonly T[],index:number,windows:string,minutes:number){
 const row=rows[index];
 if(!row?.startTime||!row.endTime)throw Error('请先设置派工时段');
 const start=clockMinutes(row.startTime),newStart=start+minutes;
 if(newStart<0||newStart>=1440)throw Error('调整后的时段不在当天工作时段内');
 return setDispatchSlot(rows,index,windows,clockText(newStart),clockMinutes(row.endTime,true)-start);
}
