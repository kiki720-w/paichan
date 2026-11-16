import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {recordOutsourcing,outsourcingTotals}=loadUi('outsourcing-progress');
const initial={qty:10,done:0,status:'待外协'};
const entry=(id)=>({id,by:'验收员',at:'2026-11-16T12:00:00Z'});

test('outsourcing tracks two partial returns and updates completion only for accepted items',()=>{
 const sent=recordOutsourcing(initial,{kind:'send',quantity:8},entry('s'));
 const first=recordOutsourcing(sent,{kind:'return',quantity:3},entry('r1'));
 const second=recordOutsourcing(first,{kind:'return',quantity:5},entry('r2'));
 assert.equal(second.done,0);
 assert.equal(outsourcingTotals(first).outstanding,5);
 assert.equal(outsourcingTotals(first).notReturned,7);
 assert.equal(outsourcingTotals(second).unsent,2);
 const inspected=recordOutsourcing(second,{kind:'inspect',batchId:'r1',passed:2},entry('i1'));
 assert.equal(inspected.done,2);
 assert.equal(outsourcingTotals(inspected).rejected,1);
 assert.equal(outsourcingTotals(inspected).pending,5);
 assert.throws(()=>recordOutsourcing(inspected,{kind:'inspect',batchId:'r1',passed:3},entry('i2')),/已验收/);
 assert.throws(()=>recordOutsourcing(second,{kind:'return',quantity:1},entry('r3')),/已送未回/);
 assert.throws(()=>recordOutsourcing(second,{kind:'send',quantity:3},entry('s2')),/待送出/);
});

test('fully accepted tasks complete and legacy completed tasks retain their progress',()=>{
 const sent=recordOutsourcing(initial,{kind:'send',quantity:10},entry('s'));
 const returned=recordOutsourcing(sent,{kind:'return',quantity:10},entry('r'));
 assert.equal(outsourcingTotals(returned).notReturned,0);
 assert.equal(returned.status,'待外协');
 assert.throws(()=>recordOutsourcing(returned,{kind:'inspect',batchId:'r',passed:11},entry('i')),/本批回厂数量/);
 const accepted=recordOutsourcing(returned,{kind:'inspect',batchId:'r',passed:10},entry('i'));
 assert.equal(accepted.status,'已完成');
 assert.equal(outsourcingTotals({...initial,status:'已完成'}).accepted,10);
});
