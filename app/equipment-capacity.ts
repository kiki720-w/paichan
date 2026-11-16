import {clockMinutes,factoryWorksOn,workingWindows,workerAvailableWindows,type CalendarEntry} from './production-calendar';

export type Machine={id:string;name:string;capacity:number;active:boolean;partCodes:string[];stops:{date:string;start:string;end:string}[]};
export type MachineSlot={machineId:string;machineName:string;startTime:string;endTime:string;amount:number;capacity:number};
type Occupation={amount?:number;capacity?:number;date:string;worker:string;partCode:string;machineId?:string;startTime?:string;endTime?:string};
type Interval={start:number;end:number};
type Person={id:string;name:string;capacity:number;overtime?:number;active:boolean};

function subtract(windows:Interval[],blocked:Interval){
 return windows.flatMap(slot=>{
  if(blocked.end<=slot.start||blocked.start>=slot.end)return [slot];
  return [{start:slot.start,end:blocked.start},{start:blocked.end,end:slot.end}].filter(piece=>piece.end>piece.start);
 });
}
const textTime=(minute:number)=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');

export function machineDailyLoad(machine:Machine,date:string,rows:Occupation[],windows?:string,calendar:Calendar[]=[]){
 const reservations=rows.filter(row=>row.date===date);
 const assigned=reservations.filter(row=>row.machineId===machine.id);
 const unassigned=reservations.filter(row=>!row.machineId&&machine.partCodes.includes(row.partCode)).length;
 const occupiedWork=assigned.reduce((total,row)=>total+(row.amount||0),0);
 const stops=machine.stops.filter(stop=>stop.date===date);
 const factoryStops=calendar.filter(entry=>entry.kind==='downtime'&&!entry.workerIds.length&&date>=entry.start&&date<=entry.end);
 const downtime=[...stops.map(stop=>`${stop.start}–${stop.end}`),...factoryStops.map(entry=>entry.startTime&&entry.endTime?`${entry.startTime}–${entry.endTime}（全厂）`:'全天停机（全厂）')];
 const working=factoryWorksOn(date,calendar);
 const missingTimes=assigned.filter(row=>!row.startTime||!row.endTime).length;
 const totalMinutes=(intervals:Interval[])=>intervals.reduce((sum,slot)=>sum+slot.end-slot.start,0);
 const timed=assigned.filter(row=>row.startTime&&row.endTime).map(row=>({start:clockMinutes(row.startTime!),end:clockMinutes(row.endTime!,true)}));
 const occupiedMinutes=1440-totalMinutes(timed.reduce(subtract,[{start:0,end:1440}]));
 const free=working&&windows?stops.reduce((slots,stop)=>subtract(slots,{start:clockMinutes(stop.start),end:clockMinutes(stop.end,true)}),workerAvailableWindows('',date,calendar,windows)):[];
 const freeMinutes=totalMinutes(timed.reduce(subtract,free));
 const availableMinutes=totalMinutes(free);
 const shiftMinutes=windows?totalMinutes(workingWindows(windows)):0;
 const remainingWork=!machine.active||!working||!machine.capacity||unassigned||missingTimes?0:shiftMinutes?freeMinutes*machine.capacity/shiftMinutes:null;
 return {occupiedWork,occupiedMinutes,remainingWork,downtime,working,unassigned,missingTimes,availableMinutes,availableWork:shiftMinutes?availableMinutes*machine.capacity/shiftMinutes:null};
}

export function jointMachineSlots(options:{
 machines:Machine[];partCode:string;worker:Person;date:string;calendar?:CalendarEntry[];windows?:string;
 overtime?:boolean;rows:Occupation[];remaining:number;workerRemaining:number;
}):MachineSlot[]{
 const {machines,partCode,worker,date,calendar,windows,overtime,rows}=options;
 if(!windows||!worker.active)return [];
 const nominal=(overtime?worker.overtime:worker.capacity)||0;
 const shift=workingWindows(windows);
 const dayMinutes=shift.reduce((sum,slot)=>sum+slot.end-slot.start,0);
 const workerWindows=workerAvailableWindows(worker.id,date,calendar,windows);
 const reservations=rows.filter(row=>row.date===date);
 const candidates=machines.filter(machine=>machine.active&&machine.capacity>0&&machine.partCodes.includes(partCode));
 const result:MachineSlot[]=[];
 let available=Math.min(options.remaining,options.workerRemaining);
 for(const machine of candidates){
  const rate=Math.min(nominal,machine.capacity)/dayMinutes;
  if(rate<=0)continue;
  let free=workerWindows;
  for(const stop of machine.stops.filter(item=>item.date===date)){
   free=subtract(free,{start:clockMinutes(stop.start),end:clockMinutes(stop.end,true)});
  }
  for(const row of [...reservations,...result.map(slot=>({...slot,date,worker:worker.name,partCode}))]){
   const unknownMachine=!row.machineId&&machine.partCodes.includes(row.partCode);
   if(row.worker!==worker.name&&row.machineId!==machine.id&&!unknownMachine)continue;
   const occupied=row.startTime&&row.endTime&&!unknownMachine
    ?{start:clockMinutes(row.startTime),end:clockMinutes(row.endTime,true)}:{start:0,end:1440};
   free=subtract(free,occupied);
  }
  for(const slot of free){
   if(available<=.001)break;
   const start=Math.ceil(slot.start),end=Math.floor(slot.end);
   if(end<=start)continue;
   const amount=Math.min(available,(end-start)*rate);
   if(amount<=.001)continue;
   const duration=Math.min(end-start,Math.ceil(amount/rate-1e-9));
   result.push({machineId:machine.id,machineName:machine.name,startTime:textTime(start),endTime:textTime(start+duration),amount,capacity:nominal});
   available-=amount;
  }
 }
 return result.sort((a,b)=>a.startTime.localeCompare(b.startTime));
}

export function machineSlotAvailable(row:Occupation,machines:Machine[],worker:Person|undefined,rows:Occupation[],windows?:string,calendar?:CalendarEntry[]){
 const machine=machines.find(item=>item.id===row.machineId);
 if(!worker?.active||!machine||!row.startTime||!row.endTime||!windows)return false;
 const start=clockMinutes(row.startTime),end=clockMinutes(row.endTime,true);
 if(!machine.active||!machine.partCodes.includes(row.partCode)||end<=start)return false;
 const shiftMinutes=workingWindows(windows).reduce((sum,slot)=>sum+slot.end-slot.start,0);
 const rate=Math.min((row.capacity===worker.overtime?worker.overtime:worker.capacity)||0,machine.capacity)/shiftMinutes;
 if(row.amount!==undefined&&row.amount>(end-start)*rate+.001)return false;
 if(!workerAvailableWindows(worker.id,row.date,calendar,windows).some(slot=>slot.start<=start&&slot.end>=end))return false;
 if(machine.stops.some(stop=>stop.date===row.date&&clockMinutes(stop.start)<end&&clockMinutes(stop.end,true)>start))return false;
 return !rows.some(other=>other!==row&&other.date===row.date&&(other.machineId===row.machineId||other.worker===row.worker||
  (!other.machineId&&machine.partCodes.includes(other.partCode)))&&(!other.startTime||!other.endTime||
  (!other.machineId&&machine.partCodes.includes(other.partCode))||clockMinutes(other.startTime)<end&&clockMinutes(other.endTime,true)>start));
}
