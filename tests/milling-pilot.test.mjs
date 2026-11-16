import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {generateMillingPlan,validateMillingPlan,millingDispatchConflict}=loadUi('milling-pilot');
const date='2026-11-16';
const predecessor={id:'turn',partCode:'P',workOrderNo:'WO',planNo:'PL',route:'TURN-MILL',operationName:'车工',plannedQty:10,completedQty:10,predecessorId:null,inspection:{passed:6,failed:4}};
const milling={...predecessor,id:'mill',operationName:'铣工',completedQty:2,due:'2026-11-20',predecessorId:'turn',inspection:undefined};
const worker={id:'worker',name:'铣工甲',active:true,capacity:32};
const machine={id:'machine',name:'铣床',active:true,capacity:32,partCodes:[],stops:[{date,start:'10:00',end:'11:00'}]};
const allocation={date,partCode:'X',worker:worker.name,machineId:machine.id,startTime:'08:00',endTime:'09:00',amount:8};
const state={workers:[worker],parts:[],machines:[machine],workingWindows:'08:00-12:00',processTasks:[predecessor,milling],allocations:[allocation],millingRules:[{partCode:'P',workerId:worker.id,machineId:machine.id,unit:4}]};

test('milling schedules only released and unfinished pieces around existing work and downtime',()=>{
 const plan=generateMillingPlan(state,date,7);
 assert.deepEqual(Array.from(plan.rows,row=>[row.date,row.startTime,row.endTime,row.quantity,row.amount]),[
  [date,'09:00','10:00',2,8],[date,'11:00','12:00',2,8],
 ]);
 assert.ok(plan.rows.every(row=>row.worker===worker.name&&row.machineId===machine.id));
 assert.equal(plan.gaps[0].quantity,4);
 assert.deepEqual(state.allocations,[allocation]);
});

test('milling holds uninspected work and reports missing resources without using lathe defaults',()=>{
 const blocked=generateMillingPlan({...state,processTasks:[{...predecessor,inspection:undefined},milling]},date,8);
 assert.equal(blocked.rows.length,0);
 assert.equal(blocked.gaps[0].quantity,8);
 const unrelated={...milling,id:'grind',operationName:'磨工'};
 const missing=generateMillingPlan({...state,processTasks:[predecessor,milling,unrelated],millingRules:[]},date,8);
 assert.equal(missing.rows.length,0);
 assert.equal(missing.gaps.length,2);
 assert.match(missing.gaps[1].reason,/铣工单件定额.*铣工人员.*铣工设备/);
});

test('publication rechecks reduced release, personnel overlap and newly scheduled downtime',()=>{
 const plan=generateMillingPlan(state,date,7);
 const released=validateMillingPlan(state,plan,date);
 assert.equal(released.through.mill,6);
 assert.equal(released.rows[0].planStatus,'已发布');
 assert.throws(()=>validateMillingPlan({...state,processTasks:[{...predecessor,inspection:{passed:5}},milling]},plan,date),/放行余量/);
 const changed={...allocation,startTime:'09:15',endTime:'09:45',machineId:'other'};
 assert.throws(()=>validateMillingPlan({...state,allocations:[allocation,changed]},plan,date),/冲突/);
 assert.throws(()=>validateMillingPlan({...state,machines:[{...machine,stops:[{date,start:'09:00',end:'10:00'}]}]},plan,date),/冲突/);
 assert.equal(millingDispatchConflict([changed],released.rows),changed);
 assert.equal(generateMillingPlan({...state,millingReleases:[released]},date,8).rows.length,0);
});
