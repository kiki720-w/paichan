import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {inspectProcess,processRelease,releasedOrder,setProcessPredecessor}=loadUi('process-quality');
const base={workOrderNo:'WO',planNo:'PLAN',partCode:'P',route:'R',plannedQty:10,completedQty:8};
const first={...base,id:'a',operationNo:'010',predecessorId:null};
const next={...base,id:'b',operationNo:'020',predecessorId:first.id,completedQty:1};
const third={...base,id:'c',operationNo:'030',predecessorId:next.id,completedQty:0};

test('a partial inspection only releases passed pieces and deducts reported downstream work',()=>{
 const before=[first,next,third];
 assert.equal(processRelease(next,before),0);
 const tasks=inspectProcess(first,before,5,2,'质检员','2026-11-16');
 assert.equal(processRelease(next,tasks),5);
 assert.equal(processRelease(third,tasks),0);
 const order={id:'mes-process-order|wo|020',partCode:'P',qty:10,done:0};
 assert.equal(releasedOrder(order,tasks).qty,4);
 assert.equal(order.qty,10);
 assert.equal(tasks[0].inspection.by,'质检员');
 assert.throws(()=>inspectProcess(first,before,8,1,'质检员','now'),/不能超过/);
 const failed=inspectProcess(first,before,0,8,'质检员','now');
 assert.equal(processRelease(next,failed),0);
});

test('missing, cross-route and cyclic links fail closed, and ordinary orders keep original quantities',()=>{
 const tasks=[first,next,third];
 assert.equal(processRelease({...next,predecessorId:undefined},tasks),0);
 assert.throws(()=>setProcessPredecessor({...next,route:'OTHER'},tasks,first.id),/同一工单/);
 assert.throws(()=>setProcessPredecessor(first,tasks,third.id),/成环/);
 assert.throws(()=>setProcessPredecessor(third,tasks,first.id),/只能接/);
 const ordinary={id:'ordinary',partCode:'P',qty:10,done:0};
 assert.equal(releasedOrder(ordinary,tasks),ordinary);
});
