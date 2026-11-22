import type {Allocation,AppState} from './scheduler-app';
import {checkOrderForSchedule,PLAN_DAYS,schedule} from './scheduling-engine';
import {prepareSchedulingScenario,simulateSchedulingScenario,type SchedulingScenario,type SchedulingScenarioResult} from './scheduling-scenarios';
import {reviewScenarioPolicy,type ScenarioPolicy} from './scenario-policy';
import {capacityOn,factoryWorksOn,productionDays,validCalendarDate} from './production-calendar';
import {machineSlotAvailable} from './equipment-capacity';
import {partWithMesOperationQuota} from './mes-operation-quotas';

export type ScenarioOption='normal'|'overtime'|'alternate';
type Stamp={actor:string;at:string};
type DraftEvent=Stamp&{kind:'创建'|'编辑'|'确认'|'发布'|'恢复';reason?:string};
export type DraftAdjustment={rowIndex:number;workerId:string;date:string};
export type ScenarioDraft={
 id:string;factory:string;baseRevision:number;day:string;engineVersion:number;revision:number;policyVersion?:number;
 input:SchedulingScenario;option:ScenarioOption;status:'draft'|'confirmed'|'published'|'restored';
 rows:Allocation[];adjustments?:DraftAdjustment[];deliveries:SchedulingScenarioResult['deliveries'];stats:{retained:number;conflicts:number;late:number;sixDayGap:number;overtimeWork:number};
 events:DraftEvent[];
};

const ENGINE_VERSION=1;

function calculate(state:AppState,factory:string,revision:number,day:string,input:SchedulingScenario,option:ScenarioOption){
 const result=simulateSchedulingScenario(state,input,factory,revision,day,schedule);
 return selectedScenario(result,option);
}
function selectedScenario(result:SchedulingScenarioResult,option:ScenarioOption){
 const proposal=option==='normal'?result.normal:option==='overtime'?result.overtime:result.alternate;
 if(!proposal)throw Error('该候选方案当前不可用，请重新试算。');
 return {rows:proposal.sixDays,shortages:proposal.sixDayShortages,blocked:proposal.blocked.length,deliveries:option==='normal'?result.deliveries:result.otherDeliveries,stats:{
  retained:result.retained.length,conflicts:result.conflicts.length,late:proposal.late,
  sixDayGap:proposal.sixDayGap,overtimeWork:proposal.overtimeWork,
 }};
}

export function createAutomaticScenarioDraft(state:AppState,factory:string,baseRevision:number,day:string,id:string,input:SchedulingScenario,policy:ScenarioPolicy,updatedAt:string,stamp:Stamp):ScenarioDraft{
 if(!policy.enabled)throw Error('本厂自动保存策略尚未启用。');
 const result=simulateSchedulingScenario(state,input,factory,baseRevision,day,schedule);
 const option:ScenarioOption=policy.allowOvertime&&result.overtime&&result.overtime.late<result.normal.late?'overtime':'normal';
 const {rows,stats,deliveries,blocked}=selectedScenario(result,option);
 const changedOrderIds=new Set(result.comparison.filter(item=>option==='overtime'?item.overtimeChanged:item.normalChanged).map(item=>item.id));
 const usesMes=state.orders.some(order=>changedOrderIds.has(order.id)&&order.mesOperationId);
 const savedAt=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(updatedAt)?updatedAt.replace(' ','T')+'Z':updatedAt;
 const decision=reviewScenarioPolicy(policy,{event:input.kind,planStatus:state.planStatus||'草稿',
  sourceAt:usesMes?state.mesOrderSync?.lastChangedAt||'':savedAt,now:Date.parse(stamp.at),rows:rows.length,blocked,
  conflicts:stats.conflicts,overtimeWork:stats.overtimeWork,
  comparison:result.comparison.map(row=>option==='overtime'?{...row,finish:row.overtimeFinish,normalChanged:row.overtimeChanged}:row),
 });
 if(!decision.allowed)throw Error(decision.reasons.join('、'));
 return {id,factory,baseRevision,day,input,option,engineVersion:ENGINE_VERSION,revision:1,status:'draft',
  rows,stats,deliveries,policyVersion:decision.version,events:[{...stamp,kind:'创建',reason:`按自动保存策略第 ${decision.version} 版创建，待人工确认`}]};
}

export function createScenarioDraft(state:AppState,factory:string,baseRevision:number,day:string,id:string,input:SchedulingScenario,option:ScenarioOption,stamp:Stamp):ScenarioDraft{
 const {rows,stats,deliveries}=calculate(state,factory,baseRevision,day,input,option);
 return {id,factory,baseRevision,day,input,option,engineVersion:ENGINE_VERSION,revision:1,status:'draft',
  rows,stats,deliveries,events:[{...stamp,kind:'创建'}]};
}

export function reviseScenarioDraft(state:AppState,draft:ScenarioDraft,baseRevision:number,day:string,input:SchedulingScenario,option:ScenarioOption,stamp:Stamp):ScenarioDraft{
 if(draft.status!=='draft'&&draft.status!=='confirmed')throw Error('已发布的方案必须另建草稿。');
 const {rows,stats,deliveries}=calculate(state,draft.factory,baseRevision,day,input,option);
 return {...draft,baseRevision,day,input,option,engineVersion:ENGINE_VERSION,revision:draft.revision+1,status:'draft',
  rows,stats,deliveries,adjustments:undefined,events:[...draft.events,{...stamp,kind:'编辑'}]};
}

function applyAdjustments(state:AppState,draft:ScenarioDraft,generated:Allocation[],adjustments=draft.adjustments||[]){
 if(!adjustments.length)return generated;
 const rows=[...generated];
 const {modified,retained,milling}=prepareSchedulingScenario(state,draft.input,draft.day);
 const calendar=modified.productionCalendar,windows=modified.workingWindows;
 const dates=new Set(productionDays(draft.day,PLAN_DAYS,calendar));
 for(const move of adjustments){
  const row=rows[move.rowIndex],worker=state.workers.find(item=>item.id===move.workerId&&item.active);
  if(!row||!Number.isSafeInteger(move.rowIndex))throw Error('请选择一条有效的拟派工。');
  if(!validCalendarDate(move.date)||!factoryWorksOn(move.date,calendar))throw Error('生产日历不允许这一天派工。');
  if(!dates.has(move.date))throw Error('日期必须在六个工作日的发布窗口内。');
  const order=modified.orders.find(item=>item.id===row.orderId);
  if(!order||!worker)throw Error('原订单或人员已失效。');
  const part=partWithMesOperationQuota(order,state.parts.find(item=>item.code===order.partCode),state.mesOperationQuotas||[]);
  const {problems,ranked}=checkOrderForSchedule(order,part,state.workers,state.hourTierRules);
  if(problems.length||!ranked?.workers.some(item=>item.id===worker.id))throw Error('人员能力或订单限制不符合该工件。');
  const capacity=capacityOn(worker,move.date,calendar,draft.option==='overtime',windows);
  const otherRows=[...retained,...milling,...rows.filter((_,index)=>index!==move.rowIndex)];
  const occupied=otherRows.filter(item=>item.date===move.date&&item.worker===worker.name).reduce((sum,item)=>sum+item.amount,0);
  if(occupied+row.amount>capacity+.001)throw Error('选定人员在这一天的剩余产能不足。');
  const next={...row,date:move.date,worker:worker.name,capacity,status:move.date<=row.due?'按期':'延期',reason:'手动调整情景草稿'};
  if(row.machineId&&!machineSlotAvailable(next,state.machines||[],worker,otherRows,windows,calendar))throw Error('设备、工作时段或停机存在冲突。');
  if(!row.machineId&&otherRows.some(item=>item.machineId&&item.worker===worker.name&&item.date===move.date))throw Error('人员当天已有分时设备派工。');
  rows[move.rowIndex]=next;
 }
 return rows;
}

export function adjustScenarioDraft(state:AppState,draft:ScenarioDraft,revision:number,day:string,move:DraftAdjustment,stamp:Stamp):ScenarioDraft{
 if(draft.status!=='draft'&&draft.status!=='confirmed')throw Error('请在待发布的草稿内调整。');
 const calculated=validateScenarioDraft(state,draft,revision,day);
 if(draft.input.kind==='split')throw Error('分批交付请编辑批次后重新试算，以同时更新各批预计完工日。');
 const next={...draft,revision:draft.revision+1,status:'draft' as const,adjustments:[...draft.adjustments||[],move]};
 const rows=applyAdjustments(state,next,calculated.rows,[move]);
 return {...next,rows,events:[...draft.events,{...stamp,kind:'编辑',reason:`调整第 ${move.rowIndex+1} 条拟派工`}]};
}

export function validateScenarioDraft(state:AppState,draft:ScenarioDraft,revision:number,day:string){
 if(draft.baseRevision!==revision||draft.day!==day||draft.engineVersion!==ENGINE_VERSION)throw Error('排产基准已更新，请重新试算并保存草稿。');
 const latest=calculate(state,draft.factory,revision,day,draft.input,draft.option);
 latest.rows=applyAdjustments(state,draft,latest.rows);
 if(latest.stats.conflicts)throw Error('请先处理与已发布或已确认派工的冲突。');
 if(!latest.rows.length)throw Error('当前草稿没有可执行派工。');
 if(JSON.stringify(latest.rows)!==JSON.stringify(draft.rows))throw Error('派工结果已变化，请重新保存草稿。');
 return latest;
}

export function confirmScenarioDraft(state:AppState,draft:ScenarioDraft,revision:number,day:string,reason:string,stamp:Stamp):ScenarioDraft{
 if(draft.status!=='draft')throw Error('请先选择待确认的草稿。');
 validateScenarioDraft(state,draft,revision,day);
 if((draft.option==='overtime'||draft.input.kind==='due'||draft.input.kind==='split')&&!reason.trim())throw Error('使用加班或变更交付安排需要填写确认原因。');
 return {...draft,revision:draft.revision+1,status:'confirmed',events:[...draft.events,{...stamp,kind:'确认',reason:reason.trim()||undefined}]};
}

export function publishScenarioDraft(state:AppState,draft:ScenarioDraft,revision:number,day:string,stamp:Stamp){
 if(draft.status!=='confirmed')throw Error('请先确认草稿。');
 const {rows,shortages}=validateScenarioDraft(state,draft,revision,day);
 if(draft.input.kind==='due'){
  const orderId=draft.input.orderId;
  if(state.orders.some(order=>order.id===orderId&&order.mesOperationId))throw Error('该订单的交期由 MES 同步，请在 MES 确认新交期并同步后重新试算。');
 }
 const {modified,retained,deliveries}=prepareSchedulingScenario(state,draft.input,day);
 const releaseId='scenario:'+draft.id;
 const mapId=(orderId?:string)=>draft.input.kind==='insert'&&orderId==='scenario-new-order'?releaseId:orderId;
 const allocations=[...retained,...rows.map(row=>({...row,orderId:mapId(row.orderId)}))];
 const input=draft.input;
 const orders=input.kind==='split'?state.orders.map(order=>order.id===input.orderId?{...order,deliveryBatches:deliveries}:order):
  modified.orders.map(order=>mapId(order.id)!==order.id?{...order,id:mapId(order.id)!}:order);
 const productionCalendar=draft.input.kind==='leave'?
  (modified.productionCalendar||[]).map((entry,index,entries)=>index===entries.length-1?{...entry,id:releaseId,note:'情景确认后生效'}:entry):state.productionCalendar;
 const snapshot={id:releaseId,createdAt:stamp.at,label:'情景派工 · '+stamp.at,status:'已发布' as const,allocations,
  confirmedBy:draft.events.at(-1)?.actor,publishedAt:stamp.at,publishedBy:stamp.actor};
 return {draft:{...draft,revision:draft.revision+1,status:'published' as const,events:[...draft.events,{...stamp,kind:'发布' as const}]},
  state:{...state,orders,productionCalendar,allocations,scheduleShortages:shortages.map(row=>({...row,orderId:mapId(row.orderId)})),
   lastRun:stamp.at,history:[snapshot,...(state.history||[])],planStatus:'已发布' as const,planSnapshotId:releaseId,
   planUpdatedAt:stamp.at,planUpdatedBy:stamp.actor,planChangeNote:undefined}};
}

export function restoreScenarioRelease(state:AppState,before:AppState,draft:ScenarioDraft,revision:number,reason:string,stamp:Stamp){
 if(draft.status!=='published'||state.planSnapshotId!=='scenario:'+draft.id||revision!==draft.baseRevision+1)throw Error('发布后数据已更新，请保留现有进度并另建情景。');
 if(!reason.trim())throw Error('请填写恢复原因。');
 const history=state.history?.map(item=>item.id===state.planSnapshotId?
  {...item,status:'已撤回' as const,withdrawnAt:stamp.at,withdrawnBy:stamp.actor,changeNote:reason.trim()}:item);
 return {draft:{...draft,revision:draft.revision+1,status:'restored' as const,events:[...draft.events,{...stamp,kind:'恢复' as const,reason:reason.trim()}]},
  state:{...before,history}};
}
