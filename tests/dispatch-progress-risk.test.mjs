import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {dispatchProgressRisks}=loadUi('dispatch-progress-risk');
const order={id:'order',orderNo:'MO-1',partCode:'P1',qty:20,done:3,mesOperationId:'op',mesOperationNo:'10',drawingNo:'D1'};
const part={code:'P1',unit:3};
const quota={operationId:'op',workOrder:'MO-1',operationNo:'10',partCode:'P1',drawingNo:'D1',unit:2};
const row={orderId:'order',orderNo:'MO-1',partCode:'P1',amount:6,date:'2026-11-09'};
const at='2026-11-10T02:00:00Z';
const endAtCutoff={...row,date:'2026-11-10',endTime:'10:00'};
const untimedToday={...row,date:'2026-11-10'};
const state={orders:[order],parts:[part],mesOperationQuotas:[quota],history:[],planStatus:'已发布',planSnapshotId:'p1',
 allocations:[row,endAtCutoff,untimedToday,{...endAtCutoff,endTime:'10:01'}]};

test('dispatch progress uses elapsed work in the plant timezone and the exact operation quota',()=>{
 const {gaps}=dispatchProgressRisks(state,at,2);
 assert.equal(gaps.length,1);
 assert.equal(gaps[0].expected,6);
 assert.equal(gaps[0].actual,3);
 assert.equal(gaps[0].gap,3);
 assert.equal(gaps[0].source,'MES');
 assert.equal(gaps[0].version,'p1');
 assert.deepEqual(dispatchProgressRisks(state,at,3).gaps,[]);
});

test('draft and withdrawn rows are excluded and unresolved source or matching prevents a numeric risk',()=>{
 assert.deepEqual(dispatchProgressRisks({...state,planStatus:'草稿'},at).gaps,[]);
 const {gaps,blocked}=dispatchProgressRisks({...state,
  orders:[{...order,mesOrderHold:'报工疑似重复'},{...order,id:'another'}],
  allocations:[row,{...row,orderId:undefined}]},at);
 assert.deepEqual(gaps,[]);
 assert.deepEqual(blocked.map(item=>item.reason),['无法唯一对应订单','报工疑似重复']);
});

test('milling uses the released piece count and confirmed manual changes take precedence for an order',()=>{
 const task={id:'task',workOrderNo:'MILL',partCode:'P2',operationName:'铣工',plannedQty:15,completedQty:4,millingReports:[{at}]};
 const milling={id:'m1',rows:[{taskId:'task',orderNo:'MILL',partCode:'P2',quantity:7,date:row.date,planStatus:'已发布'}]};
 const input={...state,orders:[{...order,done:4,manualCompletion:{done:4,at}}],processTasks:[task],millingReleases:[milling]};
 const {gaps}=dispatchProgressRisks(input,at);
 assert.deepEqual(gaps.map(item=>[item.source,item.expected,item.actual,item.gap]),[['人工完工登记',7,4,3],['人工完工更正',6,4,2]]);
});

test('projected delivery is late only when future published work supports a completion date',()=>{
 const future={...row,date:'2026-11-12',amount:0,quantity:8};
 const input={...state,orders:[{...order,qty:10,done:2,due:'2026-11-11'}],allocations:[future]};
 assert.deepEqual(dispatchProgressRisks(input,at).predicted.map(item=>[item.expectedFinish,item.due]),[['2026-11-12','2026-11-11']]);
 assert.deepEqual(dispatchProgressRisks({...input,allocations:[{...future,quantity:6}]},at).predicted,[]);
 assert.deepEqual(dispatchProgressRisks({...input,allocations:[{...future,date:'2026-11-11'}]},at).predicted,[]);
});
