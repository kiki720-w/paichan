export function clockMinutes(value:string,allowEnd=false){
 if(allowEnd&&value==='24:00')return 1440;
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('时间格式应为 HH:mm');
 const [h,m]=value.split(':').map(Number);return h*60+m;
}
export function workingWindows(value:string){
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
export const calendarLabels={
 holiday:'节假日',workday:'调休上班',leave:'人员请假',downtime:'设备停机',
};

export type CalendarEntry={
 id:string;kind:keyof typeof calendarLabels;start:string;end:string;workerIds:string[];note:string;
 half?:'first'|'second';startTime?:string;endTime?:string;
};

type DayRule=Pick<CalendarEntry,'kind'|'start'|'end'> & Partial<Pick<CalendarEntry,'workerIds'|'half'|'startTime'|'endTime'>>;
type Calendar=readonly DayRule[];

export function validCalendarDate(date:string){
 const parsed=new Date(date+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}

export function factoryWorksOn(date:string,calendar:Calendar=[]){
 let working=new Date(date+'T00:00:00Z').getUTCDay()!==0;
 for(const entry of calendar){
  if(date<entry.start||date>entry.end)continue;
  if(entry.kind==='holiday'||(entry.kind==='downtime'&&!entry.workerIds?.length&&!isPartial(entry)))return false;
  if(entry.kind==='workday')working=true;
 }
 return working;
}

export function workerBlockedOn(id:string,date:string,calendar:Calendar=[]){
 return !factoryWorksOn(date,calendar)||calendar.some(entry=>
  (entry.kind==='leave'||entry.kind==='downtime')&&!isPartial(entry)&&date>=entry.start&&date<=entry.end&&entry.workerIds?.includes(id)
 );
}

function isPartial(entry:DayRule){
 return Boolean(entry.half||entry.startTime||entry.endTime);
}

function partialRules(id:string,date:string,calendar:Calendar){
 return calendar.filter(entry=>isPartial(entry)&&date>=entry.start&&date<=entry.end&&
  (entry.workerIds?.includes(id)||(entry.kind==='downtime'&&!entry.workerIds?.length)));
}

type Interval={start:number;end:number};
const minutes=(interval:Interval)=>interval.end-interval.start;

function unavailable(windows:Interval[],rules:DayRule[]){
 const total=windows.reduce((sum,window)=>sum+minutes(window),0);
 let elapsed=0;
 return windows.flatMap(window=>{
  const midpoint=Math.min(window.end,Math.max(window.start,window.start+total/2-elapsed));
  elapsed+=minutes(window);
  return rules.flatMap(rule=>{
   if(rule.half==='first')return [{start:window.start,end:midpoint}];
   if(rule.half==='second')return [{start:midpoint,end:window.end}];
   return [{start:Math.max(window.start,clockMinutes(rule.startTime||'')),end:Math.min(window.end,clockMinutes(rule.endTime||'',true))}];
  }).filter(interval=>minutes(interval)>0);
 }).sort((a,b)=>a.start-b.start);
}

export function capacityOn(worker:{id:string;capacity:number;overtime?:number;active:boolean},date:string,calendar:Calendar=[],overtime=false,windowsText?:string){
 if(!worker.active||workerBlockedOn(worker.id,date,calendar))return 0;
 const nominal=Math.max(0,(overtime?worker.overtime:worker.capacity)||0);
 const rules=partialRules(worker.id,date,calendar);
 if(!rules.length)return nominal;
 // Timed rules cannot be safely scheduled without the configured shift.
 if(!windowsText)return 0;
 const windows=workingWindows(windowsText);
 const total=windows.reduce((sum,window)=>sum+minutes(window),0);
 let lost=0,lastEnd=0;
 for(const interval of unavailable(windows,rules)){
  lost+=Math.max(0,interval.end-Math.max(interval.start,lastEnd));
  lastEnd=Math.max(lastEnd,interval.end);
 }
 return nominal*(total-lost)/total;
}

export function slotBlockedByCalendar(id:string,date:string,calendar:Calendar=[],windowsText?:string,startTime?:string,endTime?:string){
 if(workerBlockedOn(id,date,calendar))return true;
 const rules=partialRules(id,date,calendar);
 if(!rules.length||!startTime||!endTime)return false;
 if(!windowsText)return true;
 const start=clockMinutes(startTime),end=clockMinutes(endTime,true);
 return unavailable(workingWindows(windowsText),rules).some(interval=>start<interval.end&&end>interval.start);
}

export function calendarDispatchConflicts<T extends {worker:string;date:string;amount:number;startTime?:string;endTime?:string}>(
 rows:T[],workers:{id:string;name:string;active:boolean;capacity:number;overtime?:number}[],calendar:Calendar|undefined,windows:string|undefined,from:string
){
 const totals=new Map<string,number>();
 const key=(row:T)=>JSON.stringify([row.worker,row.date]);
 for(const row of rows)totals.set(key(row),(totals.get(key(row))||0)+row.amount);
 const byName=new Map(workers.map(worker=>[worker.name,worker]));
 return rows.filter(row=>{
  if(row.date<from)return false;
  const worker=byName.get(row.worker);
  if(slotBlockedByCalendar(worker?.id||'',row.date,calendar,windows,row.startTime,row.endTime))return true;
  if(!worker)return false;
  const remaining=capacityOn(worker,row.date,calendar,true,windows);
  return remaining<(worker.overtime||0)&&(totals.get(key(row))||0)>remaining+0.001;
 });
}

export function productionDays(start:string,count:number,calendar:Calendar=[]){
 const days:string[]=[];
 const date=new Date(start+'T00:00:00Z');
 for(let offset=0;days.length<count&&offset<3660;offset++,date.setUTCDate(date.getUTCDate()+1)){
  const day=date.toISOString().slice(0,10);
  if(factoryWorksOn(day,calendar))days.push(day);
 }
 return days;
}

export function remainingProductionDays(from:string,to:string,calendar:Calendar=[]){
 if(!validCalendarDate(to)||to<=from)return 0;
 let count=0;
 const date=new Date(from+'T00:00:00Z');
 for(let offset=0;offset<400;offset++){
  date.setUTCDate(date.getUTCDate()+1);
  const day=date.toISOString().slice(0,10);
  if(day>to)break;
  if(factoryWorksOn(day,calendar))count++;
 }
 return count;
}

export function validateCalendarEntry(entry:CalendarEntry,entries:readonly CalendarEntry[],workerIds:readonly string[],windowsText?:string){
 if(!validCalendarDate(entry.start)||!validCalendarDate(entry.end)||entry.end<entry.start)throw Error('请填写有效的起止日期，结束日期不能早于开始日期。');
 if(entry.kind==='leave'&&!entry.workerIds.length)throw Error('请至少选择一名请假人员。');
 if(entry.kind==='downtime'&&!entry.note.trim())throw Error('请填写停机设备或停机范围。');
 if(entry.workerIds.some(id=>!workerIds.includes(id)))throw Error('人员名单已变化，请重新选择。');
 if(isPartial(entry)){
  if(!windowsText)throw Error('请先在排产结果设置本厂工作时段。');
  workingWindows(windowsText);
  if(entry.kind==='downtime'){
   if(!entry.startTime||!entry.endTime||clockMinutes(entry.endTime,true)<=clockMinutes(entry.startTime))throw Error('请填写同一天内的停机起止时间。跨午夜请分开登记。');
  }
 }
 const opposite=entry.kind==='holiday'?'workday':entry.kind==='workday'?'holiday':null;
 if(opposite&&entries.some(other=>other.id!==entry.id&&other.kind===opposite&&other.start<=entry.end&&other.end>=entry.start)){
  throw Error('同一天不能同时设为节假日和调休上班，请先修改已有记录。');
 }
}

export function workerAvailableWindows(id:string,date:string,calendar:Calendar=[],windowsText?:string){
 if(!windowsText||workerBlockedOn(id,date,calendar))return [];
 const windows=workingWindows(windowsText);
 const blocked=unavailable(windows,partialRules(id,date,calendar));
 return blocked.reduce((free,interval)=>free.flatMap(slot=>{
  if(interval.end<=slot.start||interval.start>=slot.end)return [slot];
  return [{start:slot.start,end:interval.start},{start:interval.end,end:slot.end}].filter(piece=>piece.end>piece.start);
 }),windows);
}
