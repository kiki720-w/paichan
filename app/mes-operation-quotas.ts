import type {Order,Part} from './scheduler-app';

export type MesOperationQuota={
 operationId:string;workOrder:string;operationNo:string;partCode:string;drawingNo:string;name:string;unit:number;evidence?:string;
};

export function partWithMesOperationQuota(order:Order,part:Part|undefined,quotas:MesOperationQuota[]):Part|undefined{
 if(!order.mesOperationId||part?.processMode==='external')return part;
 const quota=quotas.find(item=>item.operationId===order.mesOperationId&&item.workOrder===order.orderNo&&item.operationNo===order.mesOperationNo&&
  item.partCode===order.partCode&&item.drawingNo===order.drawingNo&&Number.isFinite(item.unit)&&item.unit>0);
 if(!quota)return part;
 return {...(part||{id:'mes-quota:'+quota.operationId,code:quota.partCode,name:quota.name,category:quota.name,drawingNo:quota.drawingNo,workers:[],processMode:'internal'}),unit:quota.unit};
}
