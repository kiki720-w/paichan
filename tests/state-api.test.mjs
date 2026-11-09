import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../app/api/state/route.ts',import.meta.url),'utf8');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');let batches=0,fail=false;
 const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}};},async batch(statements){batches++;if(fail){fail=false;throw Error('temporary storage failure')}return Promise.all(statements.map(s=>s.run()));}};
 const routeModule={exports:{}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:routeModule,exports:routeModule.exports,Response,Request,crypto,require(name){if(name==='cloudflare:workers')return {env:{DB:db}};return {getSession:req=>req.headers.get('x-test-auth')?{displayName:'test'}:null,resolveFactory:()=> 'xingping'};}});
 const req=(method='GET',body,compact=false)=>new Request('http://local/api/state?factory=xingping',{method,headers:{'x-test-auth':'yes','content-type':'application/json',...(compact?{prefer:'return=minimal'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {...routeModule.exports,req,sqlite,get batches(){return batches},failNext(){fail=true;}};
}
test('compact acknowledgement retains durable state, backup, audit and revision conflict protection',async()=>{
 const f=fixture();try{
  const state={orders:[{id:'a',workerAssignment:{workerId:'yang'}}],allocations:[{worker:'杨超'}],payload:'x'.repeat(350000)};
  let response=await f.PUT(f.req('PUT',{state,expectedRevision:0},true));let ack=await response.json();
  assert.equal(response.status,200);assert.equal(ack.ok,true);assert.equal(ack.state,undefined);assert.equal(ack.revision,1);assert.ok(JSON.stringify(ack).length<2000);
  assert.equal(response.headers.get('preference-applied'),'return=minimal');assert.match(response.headers.get('cache-control'),/no-store/);
  const reloaded=await (await f.GET(f.req())).json();assert.deepEqual(reloaded.state,state);
  const next={...state,allocations:[{worker:'另一个员工'}]};response=await f.PUT(f.req('PUT',{state:next,expectedRevision:1},true));assert.equal(response.status,200);
  const backup=f.sqlite.prepare('select data from factory_state_backup').get();assert.deepEqual(JSON.parse(backup.data),state);
  assert.equal(f.sqlite.prepare('select count(*) as n from factory_audit').get().n,2);
  response=await f.PUT(f.req('PUT',{state,expectedRevision:1},true));assert.equal(response.status,409);
  assert.deepEqual((await (await f.GET(f.req())).json()).state,next);assert.equal(f.batches,1);
 }finally{f.sqlite.close()}
});
test('legacy full responses and restoring a backup keep their original semantics',async()=>{
 const f=fixture();try{
  const first={orders:[1]},second={orders:[2]};
  assert.deepEqual((await (await f.PUT(f.req('PUT',{state:first,expectedRevision:0}))).json()).state,first);
  await f.PUT(f.req('PUT',{state:second,expectedRevision:1}));
  const id=f.sqlite.prepare('select id from factory_state_backup').get().id;
  const restored=await (await f.PUT(f.req('PUT',{restoreBackupId:id,expectedRevision:2},true))).json();assert.deepEqual(restored.state,first);
 }finally{f.sqlite.close()}
});
test('initialization retries after failure and unauthorized requests do not initialize storage',async()=>{
 const f=fixture();try{
  assert.equal((await f.GET(new Request('http://local/api/state'))).status,401);assert.equal(f.batches,0);
  f.failNext();assert.equal((await f.GET(f.req())).status,500);
  assert.equal((await f.GET(f.req())).status,200);assert.equal(f.batches,2);
 }finally{f.sqlite.close()}
});
test('ordinary state saves cannot remove MES linked orders, rewind the cursor or restore a pre-sync backup',async()=>{
 const f=fixture();try{
  const order={id:'mes-order',qty:12,done:3};
  const mesSync={sourceId:'mes-replica',cursor:'after-sync',links:{key:{orderId:order.id,version:2,fingerprint:'v2'}},planNeedsReview:true};
  const state={orders:[order],mesSync};
  await f.GET(f.req());
  f.sqlite.prepare("INSERT INTO factory_state(factory,data,revision) VALUES('xingping',?,2)").run(JSON.stringify(state));
  f.sqlite.prepare("INSERT INTO factory_state_backup(id,factory,data,revision,actor,action) VALUES('old','xingping','{}',1,'test','before MES')").run();
  const clear=await f.PUT(f.req('PUT',{state:{orders:[]},expectedRevision:2},true));
  assert.equal(clear.status,422);
  assert.match((await clear.json()).message,/MES/);
  const restore=await f.PUT(f.req('PUT',{restoreBackupId:'old',expectedRevision:2},true));
  assert.equal(restore.status,422);
  assert.deepEqual((await (await f.GET(f.req())).json()).state,state);
  const edit=await f.PUT(f.req('PUT',{state:{orders:[{...order,priority:2}],mesSync:{...mesSync,cursor:'old',planNeedsReview:false}},expectedRevision:2},true));
  assert.equal(edit.status,200);
  assert.deepEqual((await edit.json()).state.mesSync,mesSync);
  const run=await f.PUT(f.req('PUT',{state:{...state,mesSync:{...mesSync,planNeedsReview:false}},expectedRevision:3,action:'生成排产'},true));
  assert.equal(run.status,200);
  assert.deepEqual((await (await f.GET(f.req())).json()).state.mesSync,{...mesSync,planNeedsReview:false});
 }finally{f.sqlite.close()}
});
test('client waits for durable acknowledgement and does not update state on failure',async()=>{
 const app=readFileSync(new URL('../app/scheduler-app.tsx',import.meta.url),'utf8');
 const line=app.split(/\r?\n/).find(l=>l.includes('async function persist('));
 let resolveFetch,displayed,request;
 const ui={activeFactory:'xingping',stateRevision:4,pendingSaves:{current:0},factoryName:()=> '工厂',setNotice(){},setTimeout(){},normalizeState:s=>s,summaryOf:()=>({}),setData:s=>{displayed=s;},setStateRevision(){},setAuditLog(){},setFactorySummaries(){},fetch:async(url,options)=>{request=options;return new Promise(resolve=>{resolveFetch=resolve;});}};
 vm.createContext(ui);vm.runInContext(ts.transpileModule(line,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ui);
 const next={allocations:[{worker:'杨超'}]};let saving=ui.persist(next);
 assert.equal(displayed,undefined);assert.equal(request.headers.prefer,'return=minimal');assert.equal(ui.pendingSaves.current,1);
 resolveFetch(Response.json({ok:true,revision:5,audit:[]}));assert.equal(await saving,true);assert.equal(displayed,next);
 displayed=undefined;saving=ui.persist(next);resolveFetch(Response.json({error:'storage_failure'},{status:500}));assert.equal(await saving,false);assert.equal(displayed,undefined);assert.equal(ui.pendingSaves.current,0);
});
