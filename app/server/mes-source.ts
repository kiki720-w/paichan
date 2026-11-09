import type {CompletionRecord, WorkerAssignment} from '../feedback-rules';

export type MesFactory='xian'|'xingping';
export type MesSnapshot={
 factory:MesFactory;key:string;version:number;orderNo:string;partCode:string;name:string;
 qty:number;done:number;due:string;drawingNo?:string;customer?:string;
};
export interface MesReadSource{
 readonly id:string;
 read(factory:MesFactory,cursor:string|null):Promise<{records:readonly MesSnapshot[];nextCursor:string|null}>;
}
type MesOrder={
 id:string;orderNo:string;partCode:string;name:string;qty:number;done:number;due:string;drawingNo?:string;
 customer:string;priority:number;status:string;manualCompletion?:CompletionRecord;workerAssignment?:WorkerAssignment;
};
type Link={orderId:string;version:number;fingerprint:string};
export type MesSyncState={
 orders:MesOrder[];
 mesSync?:{
  sourceId:string;cursor:string|null;links:Record<string,Link>;
  manualConflicts?:Record<string,{mesDone:number;apsDone:number}>;
  planNeedsReview?:boolean;
 };
};
export interface MesSyncStore<S extends MesSyncState>{
 read(factory:MesFactory):Promise<{revision:number;state:S}>;
 /** Persist the whole factory state (including the cursor) in a single compare-and-swap. */
 commit(factory:MesFactory,expectedRevision:number,state:S):Promise<boolean>;
}

export async function syncMesPage<S extends MesSyncState>(factory:MesFactory,source:MesReadSource,store:MesSyncStore<S>){
 if(factory!=='xian'&&factory!=='xingping')throw Error('工厂无效');
 if(typeof source.id!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(source.id))throw Error('MES 来源标识无效');
 const {revision,state}=await store.read(factory);
 const previous=state.mesSync;
 if(previous&&previous.sourceId!==source.id)throw Error('MES 来源已变化，须先核对同步位置');
 const cursor=previous?.cursor??null;
 const page=await source.read(factory,cursor);
 if(!Array.isArray(page.records)||page.records.length>1000||(page.nextCursor!==null&&(typeof page.nextCursor!=='string'||page.nextCursor.length>4096)))throw Error('MES 同步分页无效');
 const orders=[...state.orders],links={...previous?.links},conflicts={...previous?.manualConflicts};
 let applied=0,manualConflicts=0;
 for(const raw of page.records){
  if(!raw||raw.factory!==factory)throw Error('MES 数据工厂与请求不一致');
  if(typeof raw.key!=='string'||!raw.key.trim()||raw.key.length>250||!Number.isSafeInteger(raw.version)||raw.version<=0)throw Error('MES 工单标识或版本无效');
  const orderNo=typeof raw.orderNo==='string'?raw.orderNo.trim():'',partCode=typeof raw.partCode==='string'?raw.partCode.trim():'';
  if(!orderNo||!partCode||!Number.isFinite(raw.qty)||raw.qty<=0||!Number.isFinite(raw.done)||raw.done<0||raw.done>raw.qty)throw Error('MES 工单数量或标识无效');
  const drawingNo=typeof raw.drawingNo==='string'?raw.drawingNo.trim():'',due=typeof raw.due==='string'?raw.due.trim():'';
  const name=typeof raw.name==='string'?raw.name.trim():'',customer=typeof raw.customer==='string'?raw.customer.trim():undefined;
  const key=JSON.stringify([source.id,raw.key]);
  const known=links[key];
  const fingerprint=JSON.stringify([orderNo,partCode,name,drawingNo,due,raw.qty,raw.done,customer]);
  if(known&&raw.version<known.version)continue;
  if(known&&raw.version===known.version){
   if(known.fingerprint!==fingerprint)throw Error('MES 同版本记录内容冲突');
   continue;
  }
  const matches=orders.filter(order=>order.orderNo===orderNo&&order.partCode===partCode);
  if(matches.length>1)throw Error('MES 工单对应多条序衡订单，请先核对');
  const old=known?orders.find(order=>order.id===known.orderId):matches[0];
  if(known&&!old)throw Error('已关联序衡订单不存在，请先核对');
  if(matches[0]&&matches[0].id!==old?.id)throw Error('MES 工单与其他订单冲突');
  if(old&&Object.entries(links).some(([other,link])=>other!==key&&link.orderId===old.id))throw Error('多条 MES 工单不能覆盖同一序衡订单');
  const manual=old?.manualCompletion;
  if(manual&&manual.done>raw.qty)throw Error('MES 总量小于人工完工数量，请先核对');
  const done=manual?.done??raw.done;
  if(manual&&manual.done!==raw.done){conflicts[key]={mesDone:raw.done,apsDone:manual.done};manualConflicts++}
  else delete conflicts[key];
  const order:MesOrder={...old,id:old?.id??`mes:${encodeURIComponent(source.id)}:${encodeURIComponent(raw.key)}`,orderNo,partCode,
   name:name||old?.name||partCode,customer:customer??old?.customer??'',drawingNo:drawingNo||old?.drawingNo,due,
   qty:raw.qty,done,priority:old?.priority??3,status:done===raw.qty?'已完成':'待排'};
  if(old)orders[orders.indexOf(old)]=order;else orders.push(order);
  links[key]={orderId:order.id,version:raw.version,fingerprint};
  applied++;
 }
 if(applied===0&&page.nextCursor===cursor)return {applied,manualConflicts,cursor};
 const next={...state,orders,mesSync:{sourceId:source.id,cursor:page.nextCursor,links,manualConflicts:conflicts,planNeedsReview:previous?.planNeedsReview||applied>0}};
 if(!await store.commit(factory,revision,next))throw Error('序衡数据版本冲突，同步位置未提交，请重试');
 return {applied,manualConflicts,cursor:page.nextCursor};
}
