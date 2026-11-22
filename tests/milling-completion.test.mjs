import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {millingBatches,millingDispatchKey,recordMillingCompletion}=loadUi('milling-completion');
const route={workOrderNo:'W1',partCode:'P',planNo:'P1',route:'车铣',plannedQty:10};
const turn={...route,id:'turn',operationName:'车工',predecessorId:null,completedQty:10,inspection:{passed:5,failed:5}};
const mill={...route,id:'mill',operationName:'铣工',predecessorId:'turn',completedQty:2,remainingQty:8};
const row={taskId:'mill',orderNo:'W1',partCode:'P',date:'2026-11-17',worker:'甲',machineId:'M',startTime:'08:00',endTime:'09:00',quantity:3,planStatus:'已发布'};
const dispatchKey=millingDispatchKey(row);
const state={processTasks:[turn,mill],millingReleases:[{rows:[row],through:{mill:5}}],allocations:[],history:[]};
const record=(previous,quantity,batchId,reason,id='batch-1')=>recordMillingCompletion(previous,{dispatchKey,quantity,batchId,reason},'登记员','2026-11-17T08:00:00Z',id).state;

test('milling additions and corrections update only the selected dispatch batch and process totals',()=>{
 const first=record(state,2);
 const second=record(first,1,undefined,undefined,'batch-2');
 assert.equal(second.processTasks[1].completedQty,5);
 assert.throws(()=>record(second,1),/派工量/);
 assert.throws(()=>record(second,1,'batch-1'),/更正原因/);
 const corrected=record(second,1,'batch-1','清点更正');
 const task=corrected.processTasks[1];
 assert.equal(task.completedQty,4);
 assert.equal(task.remainingQty,6);
 assert.deepEqual(Array.from(millingBatches(task,dispatchKey),batch=>batch.quantity),[1,1]);
 assert.equal(task.millingReports.length,3);
 assert.equal(task.millingReports[2].previous,2);
 assert.equal(corrected.millingReleases,state.millingReleases);
 assert.equal(corrected.history,state.history);
});

test('milling completion respects the current release and retains already inspected pieces',()=>{
 const limited={...state,processTasks:[{...turn,inspection:{passed:3}},mill]};
 assert.throws(()=>record(limited,2),/质检放行/);
 const recorded=record(state,2);
 const task={...recorded.processTasks[1],inspection:{passed:4,failed:0}};
 assert.throws(()=>record({...recorded,processTasks:[turn,task]},1,'batch-1','重新清点'),/已质检数量/);
 assert.throws(()=>record({...state,millingReleases:[]},1),/已发布/);
});
