import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const day='2026-11-13';
const calendar=[
 {kind:'holiday',start:day,end:day},
 {kind:'workday',start:'2026-11-15',end:'2026-11-15'},
 {kind:'leave',start:'2026-11-14',end:'2026-11-14',workerIds:['a']},
 {kind:'downtime',start:'2026-11-16',end:'2026-11-17',workerIds:['a'],note:'车床维修'},
 {kind:'downtime',start:'2026-11-18',end:'2026-11-18',workerIds:[],note:'车间停机'},
];
const worker={id:'a',name:'甲',capacity:10,overtime:15,active:true,skills:['车工']};
const order={id:'o',orderNo:'A',partCode:'P',name:'车工',drawingNo:'D',due:'2026-12-01',qty:30,done:0,status:'待排',priority:1};
const part={code:'P',name:'车工',category:'车工',unit:1,workers:['a']};

test('calendar closes holidays, opens makeup Sundays and scopes unavailability',()=>{
 const {productionDays,capacityOn}=loadUi('production-calendar');
 assert.deepEqual(productionDays(day,6,calendar),['2026-11-14','2026-11-15','2026-11-16','2026-11-17','2026-11-19','2026-11-20']);
 assert.equal(capacityOn(worker,'2026-11-14',calendar,true),0);
 assert.equal(capacityOn({...worker,id:'b'},'2026-11-16',calendar),10);
 assert.equal(capacityOn(worker,'2026-11-15',calendar,true),15);
 assert.equal(capacityOn({...worker,id:'b'},'2026-11-18',calendar),0);
});

test('transfer and gap filling use the same factory and personnel exceptions',()=>{
 const {planOrderTransfer}=loadUi('feedback-rules');
 const {previewBatchGaps}=loadUi('scheduling-operations');
 const expected=['2026-11-15','2026-11-19','2026-11-20'];
 const plan=planOrderTransfer(order,[order],[],[worker],'a',1,day,calendar);
 assert.deepEqual(plan.planned.map(row=>row.date),expected);
 const gap={orderId:'o',orderNo:'A',partCode:'P',remainingWork:30};
 const state={orders:[order],parts:[part],workers:[worker],allocations:[],scheduleShortages:[gap],productionCalendar:calendar};
 const preview=previewBatchGaps(state,['o'],day);
 assert.deepEqual(preview.allocations.map(row=>row.date),expected);
 assert.equal(preview.shortages.length,0);
});
