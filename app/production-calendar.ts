export const calendarLabels={
 holiday:'节假日',workday:'调休上班',leave:'人员请假',downtime:'设备停机',
};

export type CalendarEntry={
 id:string;kind:keyof typeof calendarLabels;start:string;end:string;workerIds:string[];note:string;
};

type DayRule=Pick<CalendarEntry,'kind'|'start'|'end'> & Partial<Pick<CalendarEntry,'workerIds'>>;
type Calendar=readonly DayRule[];

export function validCalendarDate(date:string){
 const parsed=new Date(date+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}

export function factoryWorksOn(date:string,calendar:Calendar=[]){
 let working=new Date(date+'T00:00:00Z').getUTCDay()!==0;
 for(const entry of calendar){
  if(date<entry.start||date>entry.end)continue;
  if(entry.kind==='holiday'||(entry.kind==='downtime'&&!entry.workerIds?.length))return false;
  if(entry.kind==='workday')working=true;
 }
 return working;
}

export function workerBlockedOn(id:string,date:string,calendar:Calendar=[]){
 return !factoryWorksOn(date,calendar)||calendar.some(entry=>
  (entry.kind==='leave'||entry.kind==='downtime')&&date>=entry.start&&date<=entry.end&&entry.workerIds?.includes(id)
 );
}

export function capacityOn(worker:{id:string;capacity:number;overtime?:number;active:boolean},date:string,calendar:Calendar=[],overtime=false){
 if(!worker.active||workerBlockedOn(worker.id,date,calendar))return 0;
 return Math.max(0,(overtime?worker.overtime:worker.capacity)||0);
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

export function validateCalendarEntry(entry:CalendarEntry,entries:readonly CalendarEntry[],workerIds:readonly string[]){
 if(!validCalendarDate(entry.start)||!validCalendarDate(entry.end)||entry.end<entry.start)throw Error('请填写有效的起止日期，结束日期不能早于开始日期。');
 if(entry.kind==='leave'&&!entry.workerIds.length)throw Error('请至少选择一名请假人员。');
 if(entry.kind==='downtime'&&!entry.note.trim())throw Error('请填写停机设备或停机范围。');
 if(entry.workerIds.some(id=>!workerIds.includes(id)))throw Error('人员名单已变化，请重新选择。');
 const opposite=entry.kind==='holiday'?'workday':entry.kind==='workday'?'holiday':null;
 if(opposite&&entries.some(other=>other.id!==entry.id&&other.kind===opposite&&other.start<=entry.end&&other.end>=entry.start)){
  throw Error('同一天不能同时设为节假日和调休上班，请先修改已有记录。');
 }
}
