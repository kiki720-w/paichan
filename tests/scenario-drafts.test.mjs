import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {createScenarioDraft,reviseScenarioDraft,adjustScenarioDraft,confirmScenarioDraft,publishScenarioDraft,restoreScenarioRelease}=loadUi('scenario-drafts');
const day='2026-11-16';
const stamp={actor:'西安负责人',at:day+'T00:00:00Z'};
const worker={id:'w',name:'甲',active:true,capacity:8,overtime:10,skills:[]};
const part={id:'p',code:'P1',name:'压盖',drawingNo:'D1',category:'压盖',unit:1,workers:['w']};
const state={orders:[],parts:[part],workers:[worker],allocations:[],history:[],lastRun:''};
const input={kind:'insert',orderNo:'URG-1',partCode:'P1',quantity:9,due:day};

test('a saved draft has independently calculated six-day rows and never mutates factory state',()=>{
 const draft=createScenarioDraft(state,'xian',4,day,'d1',input,'normal',stamp);
 assert.equal(draft.status,'draft');
 assert.equal(draft.rows.length,2);
 assert.equal(draft.rows.reduce((sum,row)=>sum+row.amount,0),9);
 assert.deepEqual(state.orders,[]);
 assert.deepEqual(state.allocations,[]);
 assert.equal(draft.baseRevision,4);
 assert.equal(draft.events[0].actor,stamp.actor);
});

test('editing recalculates the result and clears confirmation, and a changed baseline blocks approval',()=>{
 const draft=createScenarioDraft(state,'xian',4,day,'d1',input,'normal',stamp);
 const confirmed=confirmScenarioDraft(state,draft,4,day,'',stamp);
 assert.equal(confirmed.status,'confirmed');
 const revised=reviseScenarioDraft(state,confirmed,5,day,{...input,quantity:6},'normal',stamp);
 assert.equal(revised.status,'draft');
 assert.equal(revised.rows[0].amount,6);
 assert.equal(revised.events.length,3);
 assert.throws(()=>confirmScenarioDraft(state,revised,6,day,'',stamp),/基准/);
});

test('overtime and a delivery change need a reason, while frozen dispatch conflicts cannot be confirmed',()=>{
 const draft=createScenarioDraft(state,'xian',4,day,'d1',input,'overtime',stamp);
 assert.throws(()=>confirmScenarioDraft(state,draft,4,day,'',stamp),/原因/);
 assert.equal(confirmScenarioDraft(state,draft,4,day,'客户急件',stamp).status,'confirmed');
 const existing={...state,planStatus:'已发布',allocations:[{worker:'甲',date:day,amount:4,orderNo:'OLD',partCode:'P1'}]};
 const leave=createScenarioDraft(existing,'xian',4,day,'d2',{kind:'leave',workerId:'w',start:day,end:day},'normal',stamp);
 assert.throws(()=>confirmScenarioDraft(existing,leave,4,day,'',stamp),/已发布|已确认/);
});

test('publishing preserves active and historical work, records the release and guards recovery',()=>{
 const old={id:'old',orderNo:'OLD',partCode:'P1',name:part.name,qty:4,done:0,due:day,priority:3,status:'待排'};
 const retained={orderId:'old',worker:'甲',date:day,amount:4,orderNo:'OLD',partCode:'P1',due:day};
 const snapshot={id:'old-version',status:'已发布',allocations:[retained]};
 const before={...state,planStatus:'已发布',planSnapshotId:snapshot.id,orders:[old],allocations:[retained],history:[snapshot],mesSync:{sourceId:'mes',cursor:'cursor',links:{}}};
 const draft=createScenarioDraft(before,'xian',7,day,'d2',{...input,quantity:4},'normal',stamp);
 assert.throws(()=>publishScenarioDraft(before,draft,7,day,stamp),/确认/);
 const confirmed=confirmScenarioDraft(before,draft,7,day,'',stamp);
 assert.throws(()=>publishScenarioDraft(before,confirmed,8,day,stamp),/基准/);
 const published=publishScenarioDraft(before,confirmed,7,day,stamp);
 assert.equal(published.draft.status,'published');
 assert.deepEqual(published.state.allocations[0],retained);
 assert.deepEqual(published.state.history[1],snapshot);
 assert.equal(published.state.orders.length,2);
 assert.equal(published.state.allocations[1].orderId,published.state.orders[1].id);
 assert.deepEqual(published.state.mesSync,before.mesSync);
 assert.throws(()=>restoreScenarioRelease(published.state,before,published.draft,9,'回退',stamp),/已更新/);
 assert.throws(()=>restoreScenarioRelease(published.state,before,published.draft,8,'',stamp),/原因/);
 const recovered=restoreScenarioRelease(published.state,before,published.draft,8,'回退',stamp);
 assert.deepEqual(recovered.state.allocations,before.allocations);
 assert.equal(recovered.state.history.length,published.state.history.length);
 assert.equal(recovered.state.history[0].status,'已撤回');
 assert.equal(recovered.draft.events.at(-1).kind,'恢复');
});

test('a draft row can move within its window only when the worker and calendar permit the same quantity',()=>{
 const other={...worker,id:'v',name:'乙'};
 const inputState={...state,workers:[worker,other],parts:[{...part,workers:['w','v']}]};
 const draft=createScenarioDraft(inputState,'xian',5,day,'d3',{...input,quantity:3},'normal',stamp);
 const move={rowIndex:0,workerId:'v',date:'2026-11-17'};
 const updated=adjustScenarioDraft(inputState,draft,5,day,move,stamp);
 assert.deepEqual(updated.rows.map(row=>[row.worker,row.date,row.amount]),[['乙','2026-11-17',3]]);
 assert.equal(confirmScenarioDraft(inputState,updated,5,day,'',stamp).status,'confirmed');
 assert.throws(()=>adjustScenarioDraft(inputState,draft,5,day,{...move,date:'2026-11-25'},stamp),/六/);
 const disabled={...inputState,workers:[worker,{...other,active:false}]};
 const disabledDraft=createScenarioDraft(disabled,'xian',5,day,'d4',{...input,quantity:3},'normal',stamp);
 assert.throws(()=>adjustScenarioDraft(disabled,disabledDraft,5,day,move,stamp),/人员/);
 const holiday={...inputState,productionCalendar:[{kind:'holiday',start:move.date,end:move.date,workerIds:[]}]};
 assert.throws(()=>adjustScenarioDraft(holiday,draft,5,day,move,stamp),/日历/);
});
