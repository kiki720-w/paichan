import type {Allocation,AppState} from './scheduler-app';
import {isMillingTask,millingDispatch} from './milling-pilot';
import {processRelease,type ProcessTask} from './process-quality';

export type MillingCompletion={dispatchKey:string;quantity:number;batchId?:string;reason?:string};
export type MillingReport={dispatchKey:string;batchId:string;quantity:number;previous?:number;by:string;at:string;reason?:string};

export function millingDispatchKey(row:Allocation){
 return JSON.stringify([row.taskId,row.date,row.worker,row.machineId,row.startTime,row.endTime]);
}

export function millingBatches(task:ProcessTask|undefined,key:string){
 const batches=new Map<string,MillingReport>();
 for(const report of task?.millingReports||[])if(report.dispatchKey===key)batches.set(report.batchId,report);
 return [...batches.values()];
}

export function recordMillingCompletion(state:AppState,input:MillingCompletion,actor:string,at:string,id:string){
 const matches=millingDispatch(state).filter(row=>row.planStatus==='已发布'&&millingDispatchKey(row)===input.dispatchKey);
 const row=matches[0];
 if(matches.length!==1||!row?.taskId||!Number.isSafeInteger(row.quantity)||!row.quantity)throw Error('未找到唯一的已发布铣工派工。');
 const tasks=state.processTasks||[],task=tasks.find(item=>item.id===row.taskId&&isMillingTask(item)&&item.partCode===row.partCode&&item.workOrderNo===row.orderNo);
 if(!task||!Number.isFinite(task.completedQty)||!Number.isFinite(task.plannedQty))throw Error('铣工工序已变化，请核对最新数据。');
 const batches=millingBatches(task,input.dispatchKey);
 const previous=input.batchId?batches.find(batch=>batch.batchId===input.batchId):undefined;
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(input.batchId&&(!previous||!reason))throw Error('请选择有效批次并填写更正原因。');
 if(!Number.isSafeInteger(input.quantity)||input.quantity<(previous?0:1))throw Error('请输入有效的整件数量。');
 const difference=input.quantity-(previous?.quantity||0);
 if(!difference)throw Error('更正数量与该批原数量相同。');
 if(batches.reduce((sum,batch)=>sum+batch.quantity,0)+difference>row.quantity)throw Error('登记后累计数量不能超过该条派工量。');
 const completedQty=task.completedQty+difference;
 const released=task.predecessorId?processRelease(task,tasks):0;
 if(difference>0&&(completedQty>task.plannedQty||completedQty>released))throw Error('登记后工序完工量不能超过当前质检放行数量。');
 if(completedQty<(task.inspection?.passed||0)+(task.inspection?.failed||0))throw Error('更正后完工量不能低于本工序已质检数量，请先核对质检记录。');
 const report:MillingReport={dispatchKey:input.dispatchKey,batchId:previous?.batchId||id,quantity:input.quantity,previous:previous?.quantity,by:actor,at,reason:reason||undefined};
 const remainingQty=Math.max(0,task.plannedQty-completedQty);
 const updated={...task,completedQty,remainingQty,status:remainingQty===0?'已完成':completedQty>0?'进行中':'待前序确认',lastReportAt:at,millingReports:[...(task.millingReports||[]),report]};
 return {state:{...state,processTasks:tasks.map(item=>item.id===task.id?updated:item)},summary:`${row.orderNo} · ${row.date} · ${previous?`${previous.quantity} → `:''}${input.quantity} 件${reason?' · '+reason:''}`};
}
