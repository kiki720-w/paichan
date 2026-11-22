import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const {validateExceptionTransition,exceptionNextStages}=loadUi('dispatch-exceptions');
test('exception handling has a closed workflow and cannot silently close or ignore',()=>{
 assert.deepEqual(exceptionNextStages('待处理'),['分析中','已忽略']);
 assert.doesNotThrow(()=>validateExceptionTransition('分析中','待确认','核对进度'));
 assert.throws(()=>validateExceptionTransition('待确认','已解决','   '),/原因/);
 assert.throws(()=>validateExceptionTransition('待处理','已忽略',''),/原因/);
 assert.doesNotThrow(()=>validateExceptionTransition('待确认','已解决','现场补录并核对'));
 assert.throws(()=>validateExceptionTransition('已解决','分析中',''),/不可/);
});

test('server verifies the live risk, scopes events to the account factory and records each transition once',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  const state={orders:[{id:'job',orderNo:'MO-1',partCode:'P',qty:10,done:0}],parts:[{code:'P',unit:1}],planStatus:'已发布',planSnapshotId:'live',
   allocations:[{orderId:'job',orderNo:'MO-1',partCode:'P',date:'2020-01-01',amount:4}]};
  sqlite.exec('CREATE TABLE factory_state(factory TEXT, data TEXT)');
  sqlite.prepare("INSERT INTO factory_state VALUES('xingping',?)").run(JSON.stringify(state));
  const db={prepare(sql){
   let args=[];
   return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};
  }};
  const exports={};
  const source=readFileSync(new URL('../app/api/dispatch-exceptions/route.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Request,Response,URL,crypto,require(name){
    if(name==='cloudflare:workers')return {env:{DB:db}};
    if(name==='../auth/access')return {getSession:req=>req.headers.has('x-factory')?{displayName:'验收人员',factory:req.headers.get('x-factory')}:null,resolveFactory:(_req,session)=>session.factory};
    return loadUi(name.split('/').at(-1));
   }});
  const {dispatchProgressRisks}=loadUi('dispatch-progress-risk');
  const [risk]=dispatchProgressRisks(state,new Date().toISOString()).gaps;
  const req=(body,factory='xingping',key)=>new Request('http://aps.test/api/dispatch-exceptions?factory=xian'+(key?'&key='+encodeURIComponent(key):''),{
   method:body?'POST':'GET',headers:{...(factory?{'x-factory':factory}:{}),'content-type':'application/json'},body:body&&JSON.stringify(body),
  });
  assert.equal((await exports.GET(req(null,''))).status,401);
  for(let attempt=0;attempt<2;attempt++){
   const listed=await (await exports.GET(req())).json();
   assert.equal(listed.events.length,1);
   assert.equal(listed.events[0].stage,'待处理');
   assert.equal(listed.events[0].sequence,0);
   assert.equal((await exports.GET(req(null,'xingping',risk.key))).status,200);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM aps_metric_events').get().n,1);
  const start={key:risk.key,sequence:0,stage:'分析中',reason:''};
  assert.equal((await exports.POST(req(start,'xian'))).status,409);
  assert.equal((await exports.POST(req({...start,key:'fake'}))).status,409);
  const simultaneous=await Promise.all([exports.POST(req(start)),exports.POST(req(start))]);
  assert.deepEqual(simultaneous.map(response=>response.status).sort(),[200,409]);
  assert.equal((await exports.POST(req({...start,sequence:1,stage:'已解决'}))).status,422);
  assert.equal((await exports.POST(req({...start,sequence:1,stage:'已解决',reason:'核对并补报工'}))).status,200);
  const {events}=await (await exports.GET(req(null,'xingping',risk.key))).json();
  assert.deepEqual(events.map(event=>[event.sequence,event.stage,event.actor,event.reason]),[[2,'已解决','验收人员','核对并补报工'],[1,'分析中','验收人员',''],[0,'待处理','序衡预警','']]);
  assert.ok(events.every(event=>event.at&&event.version==='live'));
  assert.equal((await (await exports.GET(req())).json()).events.length,1);
  assert.deepEqual((await (await exports.GET(req(null,'xian',risk.key))).json()).events,[]);
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT data FROM factory_state').get().data),state);
 }finally{sqlite.close();}
});
