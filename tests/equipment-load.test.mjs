import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {machineDailyLoad}=loadUi('equipment-capacity');
const date='2026-11-16',windows='08:00-12:00,13:00-17:00';
const stop=(start,end)=>({date,start,end});
const machine={id:'lathe',name:'车床 A',capacity:80,active:true,partCodes:['P1'],stops:[stop('11:00','14:00'),stop('13:00','15:00')]};
const row={date,machineId:machine.id,worker:'甲',partCode:'P1',startTime:'08:00',endTime:'10:00',amount:12};

test('equipment load accounts for overlapping stops, lunch gaps, and machine time separately from work units',()=>{
 const load=machineDailyLoad(machine,date,[row,{...row,startTime:'09:00',endTime:'11:00',amount:20},{...row,machineId:'other'}],windows);
 assert.equal(load.occupiedMinutes,180);
 assert.equal(load.occupiedWork,32);
 assert.equal(load.availableMinutes,300);
 assert.equal(load.remainingWork,20);
});

test('equipment load applies factory downtime and identifies legacy dispatch with no equipment assignment',()=>{
 const calendar=[{id:'stop',kind:'downtime',start:date,end:date,workerIds:[],note:'全厂检修',startTime:'15:00',endTime:'17:00'}];
 const full=machineDailyLoad(machine,date,[{...row,endTime:'11:00'}],windows,calendar);
 assert.equal(full.remainingWork,0);
 assert.ok(full.downtime.includes('15:00–17:00（全厂）'));
 const unknown=machineDailyLoad(machine,date,[{...row,machineId:undefined}],windows);
 assert.equal(unknown.unassigned,1);
 assert.equal(unknown.occupiedWork,0);
 assert.equal(unknown.remainingWork,0);
 assert.equal(machineDailyLoad(machine,date,[],undefined).remainingWork,null);
});
