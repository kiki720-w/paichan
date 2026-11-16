import type {ApprovalRequest} from '../approval-types';
import type {AppState} from '../scheduler-app';

export function executeApproval(state:AppState,approval:ApprovalRequest,sourceOrderId:string|null){
 const {id,kind,orderNo,partCode,quantity,due}=approval;
 const part=state.parts.find(item=>item.code===partCode);
 if(!part||part.processMode==='external')throw Error('请先维护该物料的内部加工资料。');
 const orderId='approval-'+id;
 const matches=state.orders.filter(order=>order.orderNo===orderNo&&order.partCode===partCode);
 if(kind==='urgent'){
  if(matches.length)throw Error('订单号和物料编码已存在，请先核对现有订单。');
  const order={id:orderId,orderNo,partCode,name:part.name,drawingNo:part.drawingNo,customer:'',qty:quantity,done:0,due,priority:1,status:'待排',approvalExecutionId:id};
  return {state:{...state,orders:[...state.orders,order]},orderId,orderNo};
 }
 const source=sourceOrderId?matches.find(order=>order.id===sourceOrderId):matches.length===1?matches[0]:undefined;
 if(!source||source.outsourcingParentId||source.status==='已完成'||quantity>source.qty-source.done)throw Error('原内部订单已变化，无法转出批准数量。请核对订单和剩余量。');
 if(Object.values(state.mesSync?.links||{}).some(link=>link.orderId===source.id))throw Error('该订单已关联 MES，请先确认拆分数量如何与 MES 同步。');
 const isSource=(row:{orderId?:string;orderNo:string;partCode:string})=>
  row.orderId?row.orderId===source.id:row.orderNo===orderNo&&row.partCode===partCode;
 const planned=state.allocations.filter(isSource);
 const qty=source.qty-quantity, remaining=qty-source.done;
 if(planned.length&&(!Number.isFinite(part.unit)||part.unit<=0||planned.some(row=>!Number.isFinite(row.amount)||row.amount<0)||
    planned.reduce((sum,row)=>sum+row.amount,0)>remaining*part.unit+0.000001)){
  const label=state.planStatus==='已发布'?'已发布派工':'当前派工';
  throw Error(`${label}与本次外协数量冲突：转出后内部剩余 ${remaining} 件。请先人工调整派工，再执行申请。`);
 }
 if(matches.length!==1&&planned.some(row=>!row.orderId))throw Error('已有派工无法唯一对应原订单，请先核对。');
 const externalNo=`${orderNo}-外协-${id}`;
 if(state.orders.some(order=>order.id===orderId||order.orderNo===externalNo))throw Error('外协任务已经存在，请刷新审批记录。');
 const internal={...source,qty,outsourcedQuantity:(source.outsourcedQuantity||0)+quantity,
  status:remaining===0?'已完成':source.status};
 const external={id:orderId,orderNo:externalNo,partCode,name:source.name,drawingNo:source.drawingNo,customer:source.customer,
  qty:quantity,done:0,due,priority:source.priority,status:'待外协',outsourcingParentId:source.id,approvalExecutionId:id};
 const scheduleShortages=state.scheduleShortages?.flatMap(row=>{
  if(!isSource(row))return [row];
  const remainingWork=Math.max(0,remaining*part.unit-row.scheduledWork);
  return remainingWork>0.001?[{...row,requiredWork:remaining*part.unit,remainingWork,remainingQty:remainingWork/part.unit,estimatedFinish:undefined}]:[];
 });
 return {state:{...state,orders:[...state.orders.map(order=>order.id===source.id?internal:order),external],scheduleShortages},orderId,orderNo:externalNo};
}
