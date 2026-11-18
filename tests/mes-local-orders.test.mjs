import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const baseRow={operationId:'op1',workOrder:'WO-1',operationNo:'10',operationName:'车工',partCode:'P1',partName:'底座',drawingNo:'D1',due:'2026-11-30',planned:10,completed:2,pendingReports:0,requiresReview:false};
const baseState={orders:[],allocations:[{orderId:'old-dispatch'}],history:[{id:'released'}],planStatus:'已发布',planSnapshotId:'released'};

test('first sync creates one MES operation per factory and a replay updates the same order',()=>{
 const {mergeMesLocalOrders}=loadUi('server/mes-local-orders');
 for(const factory of ['xian','xingping']){
  const first=mergeMesLocalOrders(factory,baseState,[baseRow,baseRow]);
  assert.equal(first.added,1);
  const [id]=first.state.orders.map(order=>order.id);
  assert.ok(id.includes(factory));
  const changed=mergeMesLocalOrders(factory,first.state,[{...baseRow,planned:14,completed:5}]);
  assert.equal(changed.updated,1);
  assert.deepEqual(changed.state.orders.map(order=>[order.id,order.qty,order.done]),[[id,14,5]]);
  assert.equal(changed.state.allocations,baseState.allocations);
  assert.equal(changed.state.history,baseState.history);
  assert.equal(changed.state.planStatus,'已发布');
  const replay=mergeMesLocalOrders(factory,changed.state,[{...baseRow,planned:14,completed:5}]);
  assert.equal(replay.state,changed.state);
 }
});

test('pending reports and anomalous quantities never create an order or replace confirmed counts',()=>{
 const {mergeMesLocalOrders}=loadUi('server/mes-local-orders');
 const pending={...baseRow,pendingReports:1,completed:0};
 const invalid={...baseRow,planned:1};
 const noPlan={...baseRow,planned:null};
 for(const row of [pending,invalid,noPlan]) assert.equal(mergeMesLocalOrders('xian',baseState,[row]).state,baseState);
 const {state}=mergeMesLocalOrders('xian',baseState,[baseRow]);
 const held=mergeMesLocalOrders('xian',state,[pending]);
 assert.deepEqual(held.state.orders.map(o=>[o.qty,o.done,o.mesOrderHold]),[[10,2,'MES 报工待确认']]);
 const clear=mergeMesLocalOrders('xian',held.state,[baseRow]);
 assert.equal(clear.state.orders[0].mesOrderHold,undefined);
});

test('exact existing process matches keep their IDs, and ambiguous or manually completed orders are protected',()=>{
 const {mergeMesLocalOrders}=loadUi('server/mes-local-orders');
 const second={...baseRow,operationId:'op2',operationNo:'20'};
 const job={id:'existing-order',partCode:'P1',orderNo:'WO-1',name:'底座',due:'2026-11-30',qty:10,done:4,priority:1,processTaskId:'existing-task'};
 const state={...baseState,orders:[job],processTasks:[{id:'existing-task',workOrderNo:'WO-1',operationNo:'10',partCode:'P1'}]};
 const combined=mergeMesLocalOrders('xian',state,[baseRow,second]);
 assert.equal(combined.added,1);
 assert.equal(combined.state.orders[0].id,job.id);
 assert.equal(combined.state.orders[0].priority,1);
 const legacy={...job,processTaskId:undefined,manualCompletion:{done:4}};
 assert.equal(mergeMesLocalOrders('xian',{...state,orders:[legacy]},[baseRow,second]).added,0);
 const approved={...job,approvalExecutionId:'approved',outsourcedQuantity:2};
 assert.equal(mergeMesLocalOrders('xian',{...state,orders:[approved]},[baseRow]).updated,0);
 const result=mergeMesLocalOrders('xian',{...state,orders:[{...job,manualCompletion:{done:4}}]},[baseRow]);
 assert.equal(result.state.orders[0].done,4);
 assert.match(result.state.orders[0].mesOrderHold,/人工完工/);
});

test('replica preview supplies planned material before first report and holds duplicate or conflicting report rows',()=>{
 const {readMesOperationPreview}=loadUi('server/mes-operation-preview');
 const hex=value=>Buffer.from(value).toString('hex');
 const line=(values)=>['xian','WO-1','op1','10',hex('车工'),'10',...values,hex('P1'),hex('底座'),hex('D1'),'2026-11-30',hex('客户'),hex('底座'),hex('D1'),'1'].join('\t');
 const planned=readMesOperationPreview(line(['NULL','NULL','NULL','NULL','NULL','NULL','NULL']))[0];
 assert.equal(planned.readyForReview,true);
 assert.equal(planned.reported,0);
 assert.deepEqual(planned.orderMetadata,{partCode:'P1',partName:'底座',drawingNo:'D1',due:'2026-11-30',customer:'客户',recent:true});
 const report=(part,id)=>line([part,id,'2026-11-18 10:00:00','3','0','0','NULL']);
 const duplicate=readMesOperationPreview([report('P1','r1'),report('P1','r2')].join('\n'))[0];
 assert.equal(duplicate.readyForReview,false);
 assert.equal(duplicate.reported,0);
 const conflict=readMesOperationPreview(report('P2','r1'))[0];
 assert.equal(conflict.readyForReview,false);
});
