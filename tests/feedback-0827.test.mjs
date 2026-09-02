import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const code=readFileSync(new URL('../app/feedback-rules.ts',import.meta.url),'utf8');
const rulesModule={exports:{}};
vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:rulesModule.exports,module:rulesModule});
const {drawingFromRow,matchWorkers,orderCandidates,recordCompletion,preserveImportedCompletion,remainingAllocations,completionStatus}=rulesModule.exports;
const plain=x=>JSON.parse(JSON.stringify(x));
const workers=[{id:'normal',active:true,skills:['顶尖','本体','拉杆']},{id:'special',active:true,skills:['格里森拉杆','珩齿拉杆']},{id:'off',active:false,skills:['顶尖']}];
const part=(name,ids=[])=>({name,category:name,workers:ids,processMode:'internal'});
const ids=x=>plain(x.map(w=>w.id));
const order={id:'o1',orderNo:'WO-1',partCode:'P1',name:'顶尖',qty:10,done:0,status:'待排',customer:'A',due:'2026-09-01'};
test('drawing aliases preserve exact drawing, missing data stays empty',()=>{assert.equal(drawingFromRow({'图号':' 130H-01 '}),'130H-01');assert.equal(drawingFromRow({'图纸编号':'A-02'}),'A-02');assert.equal(drawingFromRow({'物料编码':'P1'}),'');});
test('ordinary category matches top/bottom/alloy/tailstock centers and prefixed bodies',()=>{for(const n of ['顶尖','上顶尖','下顶尖','合金顶尖','尾架顶尖','夹具本体'])assert.deepEqual(ids(matchWorkers(part(n),workers)),['normal']);});
test('special lines do not fall through to generic rod operators',()=>{for(const n of ['格里森拉杆','珩齿拉杆'])assert.deepEqual(ids(matchWorkers(part(n),workers)),['special']);assert.deepEqual(ids(matchWorkers(part('拉杆'),workers)),['normal']);assert.deepEqual(ids(matchWorkers(part('格里森拉杆'),[workers[0]])),[]);});
test('explicit worker restriction is preserved and external/blank labels never match',()=>{assert.deepEqual(ids(matchWorkers(part('格里森拉杆',['normal']),workers)),['normal']);assert.deepEqual(ids(matchWorkers(part('顶尖',['off']),workers)),[]);assert.deepEqual(ids(matchWorkers({...part('顶尖'),processMode:'external'},workers)),[]);assert.deepEqual(ids(matchWorkers(part(''),workers)),[]);});
test('completion handles partial/full/correction, rejects invalid totals and records actor',()=>{const partial=recordCompletion(order,4,'负责人','登记','now');assert.equal(completionStatus(partial),'部分完成');const full=recordCompletion(partial,10,'负责人','完成','now');assert.equal(full.status,'已完成');assert.equal(recordCompletion(full,2,'负责人','更正','now').done,2);for(const n of [-1,11,NaN,Infinity])assert.throws(()=>recordCompletion(order,n,'人','说明','now'));assert.throws(()=>recordCompletion(order,1,'人',' ','now'));assert.equal(partial.manualCompletion.by,'负责人');assert.equal(order.done,0);});
test('MES reimport preserves manual totals rather than summing or overwriting',()=>{const old=recordCompletion(order,4,'人','说明','now');for(const done of [0,4,8]){const merged=preserveImportedCompletion([old],[{...order,done}]);assert.equal(merged[0].done,4);assert.deepEqual(plain(preserveImportedCompletion(merged,[{...order,done}])),plain(merged));}assert.equal(preserveImportedCompletion([recordCompletion(order,10,'人','完成','now')],[order])[0].status,'已完成');});
test('import does not discard manual records absent from snapshot; invalid quantity fails',()=>{const old=recordCompletion(order,4,'人','说明','now');assert.equal(preserveImportedCompletion([old],[]).length,1);assert.throws(()=>preserveImportedCompletion([old],[{...order,qty:3}]));});
test('partial/full completion affects only chosen order and never changes input',()=>{const rows=[{orderId:'o1',orderNo:'WO-1',partCode:'P1',date:'2026-08-27',amount:50},{orderId:'o2',orderNo:'WO-2',partCode:'P1',date:'2026-08-27',amount:60},{orderId:'o1',orderNo:'WO-1',partCode:'P1',date:'2026-08-28',amount:50}];const updated=recordCompletion(order,4,'人','说明','now'),out=remainingAllocations(rows,order,updated,[order],10);assert.equal(out.filter(a=>a.orderId==='o1').reduce((n,a)=>n+a.amount,0),60);assert.equal(out.find(a=>a.orderId==='o2'),rows[1]);assert.equal(rows[0].amount,50);const full=remainingAllocations(rows,order,{...updated,done:10},[order],10);assert.deepEqual(plain(full),plain([rows[1]]));});
test('ambiguous old allocations are blocked instead of editing another task',()=>{const rows=[{orderNo:'WO-1',partCode:'P1',date:'2026-08-27',amount:100}];assert.throws(()=>remainingAllocations(rows,order,{...order,done:5},[order,{...order,id:'o2'}],10));});
test('decreasing completed total does not invent allocations or alter other jobs',()=>{const old={...order,done:6},updated={...order,done:2},rows=[{orderId:'o1',orderNo:'WO-1',partCode:'P1',date:'2026-08-28',amount:40}];assert.equal(remainingAllocations(rows,old,updated,[old],10)[0].amount,40);});

const appSource=readFileSync(new URL('../app/scheduler-app.tsx',import.meta.url),'utf8');
const engineSource=appSource.slice(appSource.indexOf('function schedule('),appSource.indexOf('export default function SchedulerApp'));
const engineContext={matchWorkers,orderCandidates,matchingWorkers:matchWorkers,isExternal:p=>p?.processMode==='external',PLAN_DAYS:6,today:()=> '2026-08-27',addDay:s=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)},workday:s=>{let d=new Date(s+'T00:00:00Z');while(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}};
vm.createContext(engineContext);vm.runInContext(ts.transpileModule(engineSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,engineContext);
test('actual scheduler preserves six workdays, explicit assignment, quantity and drawing',()=>{const state={workers:[{...workers[0],capacity:50,overtime:60,name:'测试员'}],parts:[{...part('顶尖',['normal']),code:'P1',unit:10,drawingNo:'D-01'}],orders:[{...order,drawingNo:'ORDER-D'}]};const result=engineContext.schedule(state,false);assert.equal(result.allocations.length,2);assert.equal(result.allocations.reduce((n,a)=>n+a.amount,0),100);assert.ok(result.allocations.every(a=>a.worker==='测试员'&&a.drawingNo==='ORDER-D'&&a.orderId==='o1'));assert.equal(result.shortages.length,0);});
test('actual scheduler only schedules remaining quantity and excludes fully completed jobs',()=>{const state={workers:[{...workers[0],capacity:50,overtime:60,name:'测试员'}],parts:[{...part('顶尖'),code:'P1',unit:10}],orders:[recordCompletion(order,4,'人','登记','now')]};assert.equal(engineContext.schedule(state).allocations.reduce((n,a)=>n+a.amount,0),60);state.orders=[recordCompletion(order,10,'人','登记','now')];assert.equal(engineContext.schedule(state).allocations.length,0);assert.equal(engineContext.schedule(state).shortages.length,0);});
test('actual scheduler keeps shortage reporting and daily capacity bounds',()=>{const state={workers:[{...workers[0],capacity:10,overtime:12,name:'测试员'}],parts:[{...part('顶尖'),code:'P1',unit:10}],orders:[order]};const result=engineContext.schedule(state);assert.equal(result.allocations.length,6);assert.ok(result.allocations.every(a=>a.amount<=10));assert.equal(result.shortages[0].remainingWork,40);assert.equal(result.shortages[0].remainingQty,4);});
const ui={React,useRef:React.useRef,completionStatus,allocationBelongsTo:rulesModule.exports.allocationBelongsTo,PLAN_DAYS:6,formatLocalDate:d=>d.toISOString().slice(0,10),addDay:(s,n=1)=>{const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}};
 vm.createContext(ui);vm.runInContext(ts.transpileModule(appSource.slice(appSource.indexOf('function ShortagePanel(')),{fileName:'components.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,ui);
test('weekly and daily tables render drawing and completion controls without changing history controls',()=>{
 const rows=[{orderId:'o1',orderNo:'WO-1',partCode:'P1',name:'顶尖',drawingNo:'D-001',date:'2026-08-27',worker:'测试员',amount:40,capacity:50,due:'2026-09-01',status:'按期'}];
 for(const C of [ui.WeeklySchedule,ui.GroupedSchedule]){const html=renderToStaticMarkup(React.createElement(C,{rows,orders:[order],onEdit:()=>{},onComplete:()=>{}}));assert.match(html,/D-001/);assert.match(html,/登记完工/);assert.match(html,/未开工/);assert.match(html,/人工调整/);assert.match(html,/aria-label="人员排产明细" tabindex="0"/);assert.match(html,/人员排产明细向右滚动/);}
 for(const C of [ui.WeeklySchedule,ui.GroupedSchedule]){const html=renderToStaticMarkup(React.createElement(C,{rows,onAssign:()=>{}}));assert.match(html,/更换员工/);assert.match(html,/schedule-worker-cell/);}
 const history=renderToStaticMarkup(React.createElement(ui.GroupedSchedule,{rows}));assert.doesNotMatch(history,/登记完工|人工调整|更换员工/);assert.match(history,/D-001/);
});

test('order search renders a compact labelled field, result count, clear action and empty matches',()=>{
 for(const [value,matched] of [['',12],['D-001',3],['not-found',0]]){
  const html=renderToStaticMarkup(React.createElement(ui.OrderSearch,{value,total:12,matched,onChange:()=>{}}));
  assert.match(html,/role="search"/);
  assert.match(html,/for="order-search-input"/);
  assert.match(html,/aria-live="polite"/);
  if(value){assert.match(html,/aria-label="清除搜索"/);assert.ok(html.includes(`<strong>${matched}</strong>`));}
  else{assert.doesNotMatch(html,/aria-label="清除搜索"/);assert.match(html,/共 <strong>12<\/strong> 项订单/);}
 }
});
test('scroll buttons move the table viewport both ways and respect reduced motion',()=>{
 const calls=[];
 const element={clientWidth:800,scrollBy:options=>calls.push(options)};
 ui.useRef=()=>({current:element});
 let reduced=false;
 ui.window={matchMedia:()=>({matches:reduced})};
 try{
  const tree=ui.ScrollableTable({label:'人员排产明细',children:null});
  const buttons=tree.props.children[0].props.children[1].props.children;
  buttons[0].props.onClick();buttons[1].props.onClick();
  assert.deepEqual(calls.map(x=>x.left),[-600,600]);
  assert.equal(calls[0].behavior,'smooth');
  reduced=true;buttons[1].props.onClick();assert.equal(calls[2].behavior,'instant');
 }finally{ui.useRef=React.useRef;}
});
test('clearing the order search resets the filter and restores input focus',()=>{
 let value='D-001',focused=false;
 ui.useRef=()=>({current:{focus:()=>{focused=true;}}});
 try{
  const tree=ui.OrderSearch({value,total:12,matched:3,onChange:next=>{value=next;}});
  tree.props.children[0].props.children[1].props.children[2].props.onClick();
  assert.equal(value,'');assert.equal(focused,true);
 }finally{ui.useRef=React.useRef;}
});
