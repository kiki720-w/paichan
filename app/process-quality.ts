export type Inspection={passed:number;failed:number;by:string;at:string};
export type ProcessTask={
 drawingNo?:string;id:string;workOrderNo:string;planNo:string;partCode:string;partName:string;route:string;
 operationNo:string;operationName:string;plannedQty:number;completedQty:number;remainingQty:number;due:string;
 status:string;lastReportAt?:string;producers?:string[];unitTime?:number;
 predecessorId?:string|null;inspection?:Inspection;
};
type ProcessOrder={id:string;qty:number;done:number;partCode:string;processTaskId?:string};
const slug=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'-');
const legacyOrderId=(task:ProcessTask)=>'mes-process-order|'+slug(task.workOrderNo)+'|'+slug(task.operationNo);
const sameRoute=(a:ProcessTask,b:ProcessTask)=>a.workOrderNo===b.workOrderNo&&a.partCode===b.partCode&&a.planNo===b.planNo&&a.route===b.route;

export function processOrderTask(order:ProcessOrder,tasks:ProcessTask[]){
 const matches=tasks.filter(task=>task.partCode===order.partCode&&(order.processTaskId?order.processTaskId===task.id:legacyOrderId(task)===order.id));
 return matches.length===1?matches[0]:undefined;
}

export function processRelease(task:ProcessTask,tasks:ProcessTask[],visited=new Set<string>()):number{
 if(visited.has(task.id)||!Number.isFinite(task.plannedQty)||task.plannedQty<=0)return 0;
 if(task.predecessorId===null)return task.plannedQty;
 const upstream=tasks.find(item=>item.id===task.predecessorId&&sameRoute(item,task));
 if(!upstream?.inspection)return 0;
 visited.add(task.id);
 return Math.max(0,Math.min(task.plannedQty,upstream.inspection.passed,upstream.completedQty,processRelease(upstream,tasks,visited)));
}

export function releasedOrder<T extends ProcessOrder>(order:T,tasks:ProcessTask[]=[]):T{
 const task=processOrderTask(order,tasks);
 if(!task&&!order.processTaskId&&!order.id.startsWith('mes-process-order|'))return order;
 if(!task)return {...order,qty:0};
 return {...order,qty:Math.min(order.qty,Math.max(0,processRelease(task,tasks)-Math.max(0,task.completedQty-order.done)))};
}

export function earlierTasks(task:ProcessTask,tasks:ProcessTask[]){
 return tasks.filter(item=>item.id!==task.id&&sameRoute(item,task));
}

export function setProcessPredecessor(task:ProcessTask,tasks:ProcessTask[],predecessorId:string|null){
 if(tasks.some(item=>item.id!==task.id&&sameRoute(item,task)&&item.predecessorId===predecessorId))throw Error('同一路线只能有一道首工序，每道工序只能接一道下一工序。');
 if(predecessorId!==null){
  let current=earlierTasks(task,tasks).find(item=>item.id===predecessorId);
  if(!current)throw Error('前序必须属于同一工单、计划、物料和工艺路线。');
  const visited=new Set([task.id]);
  while(current){
   if(visited.has(current.id))throw Error('前序关系不能成环。');
   visited.add(current.id);
   current=tasks.find(item=>item.id===current?.predecessorId);
  }
 }
 return tasks.map(item=>item.id===task.id?{...item,predecessorId}:item);
}

export function inspectProcess(task:ProcessTask,tasks:ProcessTask[],passed:number,failed:number,by:string,at:string){
 if(!Number.isFinite(passed)||!Number.isFinite(failed)||passed<0||failed<0)throw Error('合格和不合格数量须为非负数。');
 const limit=Math.min(task.completedQty,processRelease(task,tasks));
 if(!Number.isFinite(limit)||passed+failed>limit+0.000001)throw Error('合格与不合格合计不能超过已完工且已放行的数量。');
 return tasks.map(item=>item.id===task.id?{...item,inspection:{passed,failed,by,at}}:item);
}
