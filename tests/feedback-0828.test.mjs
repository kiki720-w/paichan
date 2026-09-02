import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const rulesModule={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/feedback-rules.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:rulesModule.exports,module:rulesModule,Error});
const {matchesOrderSearch,orderCandidates,assignOrderWorker,preserveImportedCompletion}=rulesModule.exports;
const workers=[{id:'a',name:'A',active:true,skills:['拉杆'],capacity:100,overtime:120},{id:'b',name:'B',active:true,skills:['专线拉杆'],capacity:100,overtime:120}];
const order={id:'o1',orderNo:'WO1',partCode:'P1',name:'拉杆',drawingNo:'001-Ab',qty:10,done:0,status:'待排'};
const part={code:'P1',name:'拉杆',category:'拉杆',workers:[],unit:10};
const rows=[{orderId:'o1',orderNo:'WO1',partCode:'P1',date:'2026-09-01',worker:'A',amount:40,capacity:100},{orderId:'o2',orderNo:'WO2',partCode:'P1',date:'2026-09-01',worker:'B',amount:30,capacity:100}];
const assign=(id='b',transfer=false,inputRows=rows)=>assignOrderWorker(order,[order],inputRows,workers,id,'人工核对图纸','负责人','now',transfer);
test('valid assignment clears only obsolete worker issue, preserving unrelated missing data',()=>{const out=rulesModule.exports.assignmentAwareIssues([{key:'o1',reason:'基础数据缺失：单件定额；无人员匹配：未配置工件—人员关系'},{key:'o2',reason:'无人员匹配：未配置工件—人员关系'}],[assign().order],[part],workers);assert.equal(out[0].reason,'基础数据缺失：单件定额');assert.equal(out[1].reason,'无人员匹配：未配置工件—人员关系')});
test('search supports drawing, leading zeros, case, partial match and empty query',()=>{for(const q of ['001','ab','WO1','p1','拉杆',' '])assert.equal(matchesOrderSearch(order,'other',q),true);assert.equal(matchesOrderSearch(order,'other','other'),false);assert.equal(matchesOrderSearch({...order,drawingNo:''},'FALLBACK','fall'),true);assert.equal(matchesOrderSearch(order,'','notfound'),false)});
test('order assignment overrides category only for this order; disabled/missing staff never fall back',()=>{assert.equal(orderCandidates(order,part,workers)[0].id,'a');const updated=assign().order;assert.equal(orderCandidates(updated,part,workers)[0].id,'b');assert.equal(orderCandidates(updated,part,[workers[0]]).length,0);assert.equal(orderCandidates(updated,part,[{...workers[1],active:false}]).length,0);assert.equal(orderCandidates(updated,{...part,processMode:'external'},workers).length,0);assert.equal(order.workerAssignment,undefined)});
test('future-only assignment preserves existing rows; transfer changes only matching job',()=>{assert.equal(assign().allocations,rows);const result=assign('b',true);assert.equal(result.allocations[0].worker,'B');assert.equal(result.allocations[0].amount,40);assert.equal(result.allocations[0].date,rows[0].date);assert.equal(result.allocations[1],rows[1]);assert.equal(rows[0].worker,'A');assert.equal(result.order.workerAssignment.by,'负责人')});
test('transfer enforces aggregate daily upper bound and does not double count existing owner',()=>{assert.throws(()=>assign('b',true,[rows[0],{...rows[1],amount:100}]),/超过/);assert.doesNotThrow(()=>assign('b',true,[{...rows[0],worker:'B',amount:90}]));assert.throws(()=>assign('missing'),/当前工厂/);assert.throws(()=>assign('',true),/恢复自动/)});
test('ambiguous legacy rows and empty reason are rejected',()=>{assert.throws(()=>assignOrderWorker(order,[order,{...order,id:'o2'}],[{...rows[0],orderId:undefined}],workers,'b','原因','人','now',true),/唯一/);assert.throws(()=>assignOrderWorker(order,[order],rows,workers,'b',' ','人','now',false),/原因/)});
test('reimport preserves assignment but accepts MES progress without manual completion',()=>{const old=assign().order;const result=preserveImportedCompletion([old],[{...order,done:3}]);assert.equal(result[0].done,3);assert.equal(result[0].workerAssignment.workerId,'b');assert.equal(preserveImportedCompletion(result,[{...order,done:4}])[0].done,4);assert.equal(preserveImportedCompletion([old],[])[0],old);const cleared=assign('').order;assert.equal(orderCandidates(preserveImportedCompletion([cleared],[order])[0],part,workers)[0].id,'a')});
const source=readFileSync(new URL('../app/scheduler-app.tsx',import.meta.url),'utf8');
function assignmentUi(){
 const ui={Error,data:{workers,parts:[part],orders:[order],allocations:rows,history:[{allocations:rows}]},rescheduleAssignment:false,setRescheduleAssignment:value=>{ui.rescheduleAssignment=value;},drawingFor:o=>o.drawingNo,assignmentSaving:false,assignmentForm:{workerId:'',reason:'',transfer:false},assigning:null,sessionInfo:{displayName:'负责人'},today:()=> '2026-08-28',window:{confirm:()=>true},isExternal:()=>false,...rulesModule.exports,
  setAssigning:value=>{ui.assigning=value;},setAssignmentForm:value=>{ui.assignmentForm=value;},setAssignmentError:value=>{ui.error=value;},setAssignmentSaving:value=>{ui.assignmentSaving=value;},persist:async next=>{ui.stored=JSON.stringify(next);return true;}};
 vm.createContext(ui);
 vm.runInContext(ts.transpileModule(source.slice(source.indexOf(' function beginAssignment('),source.indexOf(' function beginCompletion(')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ui);
 return ui;
}
test('order assignment defaults to immediate transfer when an existing plan is present',()=>{
 const ui=assignmentUi();ui.beginAssignment(order);
 assert.equal(ui.assignmentForm.transfer,true);assert.equal(ui.assignmentForm.workerId,'a');
 ui.data.allocations=[];ui.beginAssignment(order);assert.equal(ui.assignmentForm.transfer,false);
});
test('save handler serializes immediate transfer so reloaded state retains worker and history',async()=>{
 const ui=assignmentUi();ui.beginAssignment(order);ui.assignmentForm={...ui.assignmentForm,workerId:'b',reason:'人员调整'};
 await ui.saveAssignment({preventDefault(){}});
 assert.equal(ui.error,'');assert.equal(ui.assigning,null);
 const reloaded=JSON.parse(ui.stored);
 assert.equal(reloaded.orders[0].workerAssignment.workerId,'b');
 assert.equal(reloaded.allocations[0].worker,'B');assert.equal(reloaded.allocations[0].date,rows[0].date);assert.equal(reloaded.allocations[0].amount,40);
 assert.deepEqual(reloaded.allocations[1],rows[1]);assert.equal(reloaded.history[0].allocations[0].worker,'A');
});
test('future-only mode requires explicit confirmation and never claims current plan was updated',async()=>{
 const ui=assignmentUi();ui.beginAssignment(order);ui.assignmentForm={workerId:'b',reason:'下次调整',transfer:false};
 let prompt='';ui.window.confirm=message=>{prompt=message;return false;};
 await ui.saveAssignment({preventDefault(){}});assert.match(prompt,/当前排产中的员工不会改变/);assert.equal(ui.stored,undefined);
 ui.window.confirm=()=>true;await ui.saveAssignment({preventDefault(){}});
 const reloaded=JSON.parse(ui.stored);assert.equal(reloaded.orders[0].workerAssignment.workerId,'b');assert.equal(reloaded.allocations[0].worker,'A');
});
test('failed save or over-capacity transfer stays open and never silently falls back to future-only',async()=>{
 const ui=assignmentUi();ui.beginAssignment(order);ui.assignmentForm={workerId:'b',reason:'调整',transfer:true};
 ui.persist=async()=>false;await ui.saveAssignment({preventDefault(){}});assert.match(ui.error,/未保存/);assert.notEqual(ui.assigning,null);
 ui.data.workers=workers.map(w=>({...w,overtime:10}));await ui.saveAssignment({preventDefault(){}});assert.match(ui.error,/超过/);assert.equal(ui.assignmentForm.transfer,true);
});
test('single-row edit resolves displayed copy to stored row and saves correct employee',async()=>{
 const state={workers,parts:[part],orders:[order],allocations:rows,scheduleShortages:[]};const displayed=rows.map(r=>({...r,drawingNo:'001-Ab'}));let saved;
 const answers=['图纸已核对','负责人','2026-09-01','B','40'];
 const ui={currentRows:displayed,data:state,today:()=> '2026-08-28',window:{confirm:()=>true},ask:async()=>answers.shift(),sessionInfo:{displayName:'负责人'},drawingFor:()=> '001-Ab',allocationBelongsTo:rulesModule.exports.allocationBelongsTo,setNotice:s=>{throw Error(s)},setTimeout:()=>{},persist:async next=>{saved=next}};
 vm.createContext(ui);vm.runInContext(ts.transpileModule(source.split(/\r?\n/).find(l=>l.includes('async function editAllocation(')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ui);
 await ui.editAllocation(displayed[0]);assert.equal(saved.allocations[0].worker,'B');assert.equal(saved.allocations[0].amount,40);assert.equal(saved.allocations[1],rows[1]);assert.equal(rows[0].worker,'A');
});
const context={orderCandidates,isExternal:p=>p?.processMode==='external',PLAN_DAYS:6,today:()=> '2026-09-01',addDay:s=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)},workday:s=>{const d=new Date(s+'T00:00:00Z');while(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}};
vm.createContext(context);vm.runInContext(ts.transpileModule(source.slice(source.indexOf('function schedule('),source.indexOf('export default function SchedulerApp')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
test('actual scheduler retains order-specific choice across replan without changing same-part jobs',()=>{const result=context.schedule({workers,parts:[part],orders:[{...assign().order,due:'2026-09-10'},{...order,id:'o2',orderNo:'WO2',due:'2026-09-10'}]},false);assert.ok(result.allocations.some(a=>a.orderId==='o1'));assert.ok(result.allocations.filter(a=>a.orderId==='o1').every(a=>a.worker==='B'));assert.ok(result.allocations.filter(a=>a.orderId==='o2').every(a=>a.worker==='A'));assert.equal(result.allocations.reduce((n,a)=>n+a.amount,0),200)});
test('actual six-day scheduler includes Saturday between Friday and Monday',()=>{
 context.today=()=> '2026-09-04';const result=context.schedule({workers:[{...workers[0],capacity:50,name:'A'}],parts:[{...part,workers:['a']}],orders:[{...order,qty:15,due:'2026-09-20'}]},false);
 assert.equal(result.allocations.slice(0,3).map(a=>a.date).join(','),'2026-09-04,2026-09-05,2026-09-07');assert.ok(result.allocations.every(a=>a.date!=='2026-09-06'));
});

const transferRows=rows.map(r=>({...r,name:'拉杆',due:'2026-09-02',status:'按期'}));
const transfer=(overrides={})=>rulesModule.exports.planOrderTransfer({...order,due:'2026-09-02',...overrides},[order],transferRows,workers,'b',10,'2026-09-01');
test('deferred transfer fills only free normal capacity and preserves other orders',()=>{
 const result=transfer();assert.equal(result.required,100);assert.equal(result.planned[0].amount,70);assert.equal(result.planned[1].amount,30);assert.equal(result.finish,'2026-09-02');assert.equal(result.late,false);
 assert.equal(result.allocations.find(a=>a.orderId==='o2'),transferRows[1]);assert.equal(result.allocations.filter(a=>a.orderId==='o1').reduce((n,a)=>n+a.amount,0),100);
 assert.equal(transferRows[0].worker,'A');assert.ok(result.planned.every(a=>a.worker==='B'&&a.capacity===100));
});
test('deferred transfer covers shortages beyond six days and marks overdue rows',()=>{
 const result=transfer({qty:100});assert.equal(result.planned.reduce((n,a)=>n+a.amount,0),1000);assert.ok(result.planned.length>6);assert.equal(result.late,true);assert.ok(result.planned.some(a=>a.status==='延期'));
 assert.ok(result.planned.every(a=>new Date(a.date+'T00:00:00Z').getUTCDay()!==0));
});
test('Saturday is a normal production day and Sunday remains closed',()=>{
 const plan=rulesModule.exports.planOrderTransfer({...order,qty:25,due:'2026-09-12'},[order],[],workers,'b',10,'2026-09-04');
 assert.equal(plan.planned.slice(0,3).map(a=>a.date).join(','),'2026-09-04,2026-09-05,2026-09-07');
 assert.ok(plan.planned.some(a=>a.date==='2026-09-05'));assert.ok(plan.planned.every(a=>a.date!=='2026-09-06'));
});
test('partial completion and assigning the same employee do not double count old allocations',()=>{
 const result=rulesModule.exports.planOrderTransfer({...order,done:6,due:'2026-09-02'},[order],transferRows,workers,'a',10,'2026-08-29');
 assert.equal(result.required,40);assert.equal(result.planned.length,1);assert.equal(result.planned[0].date,'2026-08-29');assert.equal(result.planned[0].amount,40);
});
test('fully occupied or already overloaded days are skipped without moving existing work',()=>{
 const occupied=transferRows.map(r=>r.orderId==='o2'?{...r,amount:130}:r);
 const result=rulesModule.exports.planOrderTransfer({...order,due:'2026-09-01'},[order],occupied,workers,'b',10,'2026-09-01');
 assert.equal(result.planned[0].date,'2026-09-02');assert.equal(result.late,true);
 assert.equal(result.allocations.find(a=>a.orderId==='o2'),occupied[1]);
});
test('invalid inputs and ambiguous legacy rows fail without returning partial plans',()=>{
 const plan=rulesModule.exports.planOrderTransfer;
 for(const unit of [0,NaN,Infinity])assert.throws(()=>plan({...order,due:'2026-09-02'},[order],transferRows,workers,'b',unit,'2026-09-01'));
 assert.throws(()=>plan({...order,due:'2026-02-30'},[order],transferRows,workers,'b',10,'2026-09-01'),/日期/);
 assert.throws(()=>plan({...order,due:'2026-09-02'},[order],transferRows,workers,'missing',10,'2026-09-01'),/日产能/);
 assert.throws(()=>plan({...order,due:'2026-09-02'},[order,{...order,id:'dup'}],transferRows.map(r=>({...r,orderId:undefined})),workers,'b',10,'2026-09-01'),/唯一/);
 assert.throws(()=>transfer({qty:1e10}),/十年/);
});
test('deferred save requires confirmation and persists complete plan without changing historical snapshots',async()=>{
 const ui=assignmentUi();ui.data.allocations=transferRows;ui.data.orders=[{...order,due:'2026-09-02'}];ui.data.scheduleShortages=[{orderId:'o1'},{orderId:'o2'}];
 ui.beginAssignment(ui.data.orders[0]);ui.rescheduleAssignment=true;ui.assignmentForm={workerId:'b',reason:'仅此员工可加工',transfer:true};
 ui.window.confirm=()=>false;await ui.saveAssignment({preventDefault(){}});assert.equal(ui.stored,undefined);
 let message='';ui.window.confirm=text=>{message=text;return true;};await ui.saveAssignment({preventDefault(){}});
 assert.equal(ui.error,'');assert.match(message,/预计/);
 const reloaded=JSON.parse(ui.stored);assert.equal(reloaded.orders[0].workerAssignment.workerId,'b');assert.equal(reloaded.allocations.filter(a=>a.orderId==='o1').reduce((n,a)=>n+a.amount,0),100);assert.ok(reloaded.allocations.filter(a=>a.orderId==='o1').every(a=>a.worker==='B'));
 assert.deepEqual(reloaded.scheduleShortages,[{orderId:'o2'}]);assert.equal(reloaded.history[0].allocations[0].worker,'A');
});
