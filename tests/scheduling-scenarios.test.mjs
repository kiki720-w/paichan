import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {schedule}=loadUi('scheduler-app');
const {simulateSchedulingScenario}=loadUi('scheduling-scenarios');
const day='2026-11-16';
const part={id:'p',code:'P1',name:'压盖',drawingNo:'D1',category:'压盖',unit:1,workers:['w']};
const worker={id:'w',name:'甲',active:true,capacity:10,overtime:20,skills:[]};
const order={id:'o',orderNo:'APS-1',customer:'',partCode:'P1',name:'压盖',drawingNo:'D1',qty:75,done:0,due:'2026-11-27',priority:3,status:'待排'};
const state={parts:[part],workers:[worker],orders:[order],allocations:[],history:[],lastRun:''};

test('insert trial is isolated, compares normal and overtime and retains work after the six-day window',()=>{
 const before=JSON.stringify(state);
 const scenario={kind:'insert',orderNo:'APS-NEW',partCode:'P1',quantity:10,due:day};
 const output=simulateSchedulingScenario(state,scenario,'xingping',2,day,schedule);
 assert.equal(JSON.stringify(state),before);
 assert.equal(output.revision,2);
 assert.equal(output.normal.rows.filter(row=>row.orderNo==='APS-NEW').reduce((sum,row)=>sum+row.amount,0),10);
 assert.ok(output.normal.sixDays.every(row=>row.date<='2026-11-21'));
 assert.ok(output.normal.rows.some(row=>row.date>'2026-11-21'));
 assert.equal(output.normal.sixDayGap,25);
 assert.equal(output.baseline.sixDayGap,15);
 assert.ok(output.overtime&&output.overtime.overtimeWork>0);
});

test('temporary leave preserves published work, flags a conflict and keeps new work off the leave date',()=>{
 const saved={orderId:'o',orderNo:'APS-1',partCode:'P1',name:'压盖',due:order.due,status:'按期',date:day,worker:'甲',amount:4,capacity:10};
 const input={...state,allocations:[saved],planStatus:'已发布'};
 const output=simulateSchedulingScenario(input,{kind:'leave',workerId:'w',start:day,end:day},'xian',3,day,schedule);
 assert.deepEqual(output.retained,[saved]);
 assert.deepEqual(output.conflicts,[saved]);
 assert.ok(output.normal.rows.every(row=>row.date!==day));
 assert.equal(output.normal.rows.reduce((sum,row)=>sum+row.amount,0),71);
 assert.deepEqual(input.allocations,[saved]);
});

test('due-date simulation reports before and after and hides finish dates beyond 30 working days',()=>{
 const input={...state,orders:[{...order,qty:400}]};
 const output=simulateSchedulingScenario(input,{kind:'due',orderId:'o',due:day},'xian',10,day,schedule);
 const row=output.comparison.find(item=>item.id==='o');
 assert.equal(row.beforeDue,order.due);
 assert.equal(row.due,day);
 assert.equal(row.finish,null);
 assert.equal(output.normal.unfinished,1);
 assert.throws(()=>simulateSchedulingScenario({...input,parts:[]},{kind:'due',orderId:'o',due:day},'xian',10,day,schedule),/单件工时/);
});

test('elapsed published work is retained and does not count toward future completion',()=>{
 const old={orderId:'o',orderNo:order.orderNo,partCode:part.code,name:part.name,due:order.due,status:'按期',date:'2026-11-14',worker:'甲',amount:4,capacity:10};
 const input={...state,allocations:[old],planStatus:'已发布'};
 const result=simulateSchedulingScenario(input,{kind:'due',orderId:'o',due:day},'xian',10,day,schedule);
 assert.deepEqual(result.retained,[old]);
 assert.equal(result.normal.rows.reduce((sum,row)=>sum+row.amount,0),order.qty);
 assert.ok(result.normal.rows.every(row=>row.date>=day));
});

test('six-day and thirty-day calculations handle 500 orders and 50 workers deterministically',()=>{
 const workers=Array.from({length:50},(_,index)=>({...worker,id:'w'+index,name:'工人'+index}));
 const parts=[{...part,workers:workers.map(item=>item.id)}];
 const orders=Array.from({length:500},(_,index)=>({...order,id:'o'+index,orderNo:'MO-'+index,qty:20+index%7}));
 const input={...state,workers,parts,orders};
 const attempt={kind:'leave',workerId:'w0',start:day,end:day};
 const times=[];
 let first;
 for(let i=0;i<6;i++){
  const started=performance.now();
  const result=simulateSchedulingScenario(input,attempt,'xian',3,day,schedule);
  times.push(performance.now()-started);
  assert.ok(result.normal.sixDays.every(row=>row.date<='2026-11-21'));
  assert.ok(result.normal.rows.every(row=>row.date!==day||row.worker!=='工人0'));
  if(first)assert.deepEqual(result.normal.rows,first);
  else first=result.normal.rows;
 }
 assert.ok(Math.max(...times)<10000,'scenario computation exceeds ten seconds');
});

test('without usable overtime the same capacity can offer a different feasible normal shift plan',()=>{
 const people=[{...worker,overtime:10},{...worker,id:'w2',name:'乙',overtime:10}];
 const input={...state,workers:people,parts:[{...part,workers:['w','w2']}],orders:[]};
 const result=simulateSchedulingScenario(input,{kind:'insert',orderNo:'NEW',partCode:part.code,quantity:4,due:day},'xian',1,day,schedule);
 assert.equal(result.overtime,null);
 assert.equal(result.alternate.rows.reduce((sum,row)=>sum+row.amount,0),4);
 assert.notEqual(result.alternate.rows[0].worker,result.normal.rows[0].worker);
});
