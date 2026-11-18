import {randomUUID} from 'node:crypto';
import {mergeMesLocalOrders} from '../app/server/mes-local-orders.ts';
import {loadSchedulerModule} from './mes-scheduler-loader.mjs';

const {schedule}=loadSchedulerModule('scheduler-app');
const {allocationBelongsTo}=loadSchedulerModule('feedback-rules');
const {partWithMesOperationQuota}=loadSchedulerModule('mes-operation-quotas');

function existingPlanPublished(state){
 const current=state.history?.find(snapshot=>snapshot.id===state.planSnapshotId);
 return state.planStatus==='已发布'||current?.status==='已发布';
}

export function buildMesDraft(factory,state,rows,sourceVersion,baseRevision){
 const saved=state.allocations;
 const source=new Set(rows.map(row=>row.operationId));
 const {state:merged}=mergeMesLocalOrders(factory,state,rows);
 const parts=new Map(state.parts.map(part=>[part.code,part]));
 const original=new Map(merged.orders.map(order=>[order.id,order]));
 const orders=merged.orders.flatMap(order=>{
  if(!source.has(order.mesOperationId)||order.mesOrderHold||order.qty<=order.done)return [];
  const unit=partWithMesOperationQuota(order,parts.get(order.partCode),state.mesOperationQuotas||[])?.unit;
  if(!Number.isFinite(unit)||unit<=0)return [];
  const dispatch=saved.filter(row=>row.orderNo===order.orderNo&&row.partCode===order.partCode);
  if(dispatch.some(row=>!row.orderId&&!allocationBelongsTo(row,order,merged.orders)))return [];
  const used=dispatch.filter(row=>allocationBelongsTo(row,order,merged.orders)).reduce((sum,row)=>sum+row.amount,0);
  const done=order.done+used/unit;
  return done<order.qty?[{...order,done}]:[];
 });
 const result=schedule({...merged,orders,allocations:saved},false,true);
 const affected=new Set(result.allocations.map(row=>row.orderId));
 return {id:randomUUID(),factory,sourceVersion,baseRevision,generatedAt:new Date().toISOString(),status:'draft',
  retained:saved.length,allocations:result.allocations,shortages:result.shortages.slice(0,100),shortageCount:result.shortages.length,blocked:result.blocked.length,
  orders:[...affected].map(id=>original.get(id)),unpublishedRows:existingPlanPublished(state)?[]:saved,
  withdrawnPlan:state.planStatus==='已撤回'&&saved.length>0};
}

export function changeMesDraft(draft,action,state,sourceVersion,revision,actor){
 if(!draft||draft.sourceVersion!==sourceVersion||draft.baseRevision!==revision)throw Error('MES 或序衡资料已变化，请查看新草稿后重新确认。');
 if(draft.withdrawnPlan||state.planStatus==='已撤回'&&state.allocations.length>0)throw Error('当前计划已经撤回，请先核对撤回的派工。');
 if(!draft.allocations.length)throw Error('当前无可发布的新增派工。');
 const at=new Date().toISOString();
 if(action==='confirm'&&draft.status==='draft')return {...draft,status:'confirmed',confirmedAt:at,confirmedBy:actor};
 if(action==='publish'&&draft.status==='confirmed')return {...draft,status:'published',publishedAt:at,publishedBy:actor};
 throw Error('请先人工确认当前草稿，每版只可发布一次。');
}

export function applyPublishedMesDraft(state,draft,actor){
 if(draft.status!=='published')throw Error('MES 草稿尚未完成发布确认。');
 const orders=new Map(state.orders.map(order=>[order.id,order]));
 for(const order of draft.orders)orders.set(order.id,order);
 const allocations=[...state.allocations,...draft.allocations];
 const history=[{id:draft.id,createdAt:draft.generatedAt,label:'MES 更新排产 · '+draft.generatedAt,allocations,status:'已发布',
  confirmedBy:draft.confirmedBy,publishedBy:actor,publishedAt:draft.publishedAt},...state.history||[]];
 return {...state,orders:[...orders.values()],allocations,history,lastRun:draft.generatedAt,planStatus:'已发布',planSnapshotId:draft.id,
  planUpdatedAt:draft.publishedAt,planUpdatedBy:actor,planChangeNote:'人工发布 MES 更新草稿，保留已有派工'};
}
