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

test('timed downtime and half-day leave subtract only their union within working windows',()=>{
 const {capacityOn,productionDays,slotBlockedByCalendar}=loadUi('production-calendar');
 const windows='08:00-11:00,12:00-17:00';
 const timed=[
  {kind:'leave',start:day,end:day,half:'first',workerIds:['a']},
  {kind:'downtime',start:day,end:day,startTime:'10:00',endTime:'14:00',workerIds:[]},
 ];
 assert.equal(capacityOn(worker,day,timed,false,windows),3.75);
 assert.equal(capacityOn(worker,day,timed,true,windows),5.625);
 assert.equal(capacityOn({...worker,id:'b'},day,timed,false,windows),6.25);
 assert.equal(productionDays(day,1,timed)[0],day);
 assert.equal(slotBlockedByCalendar('a',day,timed,windows,'12:30','13:30'),true);
 assert.equal(slotBlockedByCalendar('a',day,timed,windows,'14:00','15:00'),false);
 assert.equal(capacityOn(worker,day,[{kind:'downtime',start:day,end:day,startTime:'11:00',endTime:'12:00'}],false,windows),10);
});

test('transfer and gap filling consume the prorated normal capacity',()=>{
 const {planOrderTransfer}=loadUi('feedback-rules');
 const {previewBatchGaps}=loadUi('scheduling-operations');
 const timed=[{kind:'leave',start:day,end:day,half:'second',workerIds:['a']}];
 const workingWindows='08:00-12:00,13:00-17:00';
 const result=planOrderTransfer(order,[order],[],[worker],'a',1,day,timed,workingWindows);
 assert.equal(result.planned[0].amount,5);
 const state={orders:[order],parts:[part],workers:[worker],allocations:[],scheduleShortages:[{orderId:'o',remainingWork:30}],productionCalendar:timed,workingWindows};
 assert.equal(previewBatchGaps(state,['o'],day).allocations[0].amount,5);
});

test('calendar changes flag existing timed or overloaded dispatch without changing it',()=>{
 const {calendarDispatchConflicts}=loadUi('production-calendar');
 const windows='08:00-12:00,13:00-17:00';
 const timed=[{kind:'downtime',start:day,end:day,startTime:'08:00',endTime:'10:00',workerIds:['a']}];
 const rows=[{worker:'甲',date:day,amount:1,startTime:'09:00',endTime:'10:00'},{worker:'甲',date:day,amount:1,startTime:'10:00',endTime:'11:00'}];
 assert.deepEqual(calendarDispatchConflicts(rows,[worker],timed,windows,day),[rows[0]]);
 const untimed=[{worker:'甲',date:day,amount:12}];
 assert.deepEqual(calendarDispatchConflicts(untimed,[worker],timed,windows,day),untimed);
 assert.equal(rows[0].startTime,'09:00');
});
