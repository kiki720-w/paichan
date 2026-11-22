import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {loadUi} from './load-ui.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE factory_state(factory TEXT PRIMARY KEY,data TEXT,revision INTEGER,updated_at TEXT);
 CREATE TABLE factory_state_backup(id TEXT PRIMARY KEY,factory TEXT,data TEXT,revision INTEGER,actor TEXT,action TEXT,created_at TEXT);
 CREATE TABLE factory_audit(id TEXT PRIMARY KEY,factory TEXT,actor TEXT,action TEXT,summary TEXT,revision INTEGER,created_at TEXT);`);
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
 const state={orders:[],allocations:[],history:[],lastRun:'',parts:[{id:'p',code:'P1',name:'压盖',drawingNo:'D1',category:'压盖',unit:1,workers:['w']}],
  workers:[{id:'w',name:'甲',active:true,capacity:8,overtime:10,skills:[]}]};
 const setup=sql.prepare('INSERT INTO factory_state(factory,data,revision,updated_at) VALUES (?,?,1,CURRENT_TIMESTAMP)');
 for(const factory of ['xian','xingping'])setup.run(factory,JSON.stringify(state));
 let fail=false;
 const db={
  prepare(query){
   let args=[];
   return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},
    async all(){return {results:sql.prepare(query).all(...args)};},
    execute(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};},
    async run(){return this.execute();}};
  },
  async batch(steps){
   sql.exec('BEGIN IMMEDIATE');
   try{
    const results=steps.map((step,index)=>{
     if(fail&&index===3)throw Error('injected commit error');
     return step.execute();
    });
    sql.exec('COMMIT');
    return results;
   }catch(error){sql.exec('ROLLBACK');throw error;}
  },
 };
 const exports={};
 const {outputText}=ts.transpileModule(readFileSync(new URL('../app/api/scenario-drafts/route.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 vm.runInNewContext(outputText,{exports,Request,Response,URL,crypto,TextEncoder,require(name){
  if(name==='cloudflare:workers')return {env:{DB:db}};
  if(name==='../auth/access')return {getSession:req=>req.headers.has('x-test-factory')?{displayName:'本厂人员',factory:req.headers.get('x-test-factory')}:null,resolveFactory:(_req,session)=>session.factory};
  return loadUi(name.split('/').at(-1));
 }});
 const req=(body,factory='xian',id='')=>new Request('http://local/api/scenario-drafts?factory=xian&id='+id,{
  method:body?'POST':'GET',headers:{...(factory?{'x-test-factory':factory}:{}),'content-type':'application/json'},body:body&&JSON.stringify(body),
 });
 const read=(factory='xian')=>sql.prepare('SELECT data,revision FROM factory_state WHERE factory=?').get(factory);
 return {sql,day,state,req,read,fail(value){fail=value;},...exports};
}

test('publish and restore are explicit, atomic, and isolated by factory',async()=>{
 const f=fixture();
 try{
  const create={action:'create',baseRevision:1,day:f.day,option:'normal',input:{kind:'insert',orderNo:'URG-1',partCode:'P1',quantity:4,due:f.day}};
  assert.equal((await f.POST(f.req(create,''))).status,401);
  const created=await f.POST(f.req(create));
  assert.equal(created.status,201);
  const {draft}=await created.json();
  assert.equal((await f.GET(f.req(null,'xingping',draft.id))).status,404);
  assert.deepEqual(JSON.parse(f.read().data),f.state);
  const confirm={action:'confirm',id:draft.id,baseRevision:1,draftRevision:1};
  assert.equal((await f.POST(f.req(confirm,'xingping'))).status,404);
  assert.equal((await f.POST(f.req(confirm))).status,200);
  const publish={...confirm,action:'publish',draftRevision:2};
  f.fail(true);
  assert.equal((await f.POST(f.req(publish))).status,500);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM factory_audit').get().n,0);
  assert.equal((await (await f.GET(f.req(null,'xian',draft.id))).json()).draft.status,'confirmed');
  assert.deepEqual(JSON.parse(f.read().data),f.state);
  f.fail(false);
  const race=await Promise.all([f.POST(f.req(publish)),f.POST(f.req(publish))]);
  assert.deepEqual(race.map(response=>response.status).sort(),[200,409]);
  assert.equal(JSON.parse(f.read().data).allocations.length,1);
  assert.deepEqual(JSON.parse(f.read('xingping').data),f.state);
  const restore={...publish,action:'restore',draftRevision:3,baseRevision:2,reason:'验证恢复'};
  assert.equal((await f.POST(f.req(restore))).status,200);
  const after=JSON.parse(f.read().data);
  assert.deepEqual(after.orders,[]);
  assert.deepEqual(after.allocations,[]);
  assert.equal(after.history[0].status,'已撤回');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM factory_audit').get().n,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM factory_state_backup').get().n,2);
 }finally{f.sql.close();}
});

test('automatic drafts are disabled by default, match a versioned policy and stay unconfirmed',async()=>{
 const f=fixture();
 try{
  const event={action:'automatic',baseRevision:1,day:f.day,input:{kind:'insert',orderNo:'AUTO-1',partCode:'P1',quantity:4,due:f.day}};
  assert.equal((await f.POST(f.req(event))).status,422);
  const policy={enabled:true,eventTypes:['insert'],maxChanged:1,maxDelayDays:1,maxAgeHours:24,allowOvertime:false,excludedStatuses:['已发布']};
  const saved=await f.POST(f.req({action:'policy',policyVersion:0,policy}));
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).policy.version,1);
  assert.equal((await f.POST(f.req(event,'xingping'))).status,422);
  const results=await Promise.all([f.POST(f.req(event)),f.POST(f.req(event))]);
  assert.deepEqual(results.map(response=>response.status).sort(),[200,201]);
  const drafts=await Promise.all(results.map(response=>response.json()));
  assert.equal(drafts[0].draft.id,drafts[1].draft.id);
  assert.equal(drafts[0].draft.policyVersion,1);
  assert.equal(drafts[0].draft.status,'draft');
  assert.deepEqual(JSON.parse(f.read().data),f.state);
  f.sql.prepare("UPDATE factory_state SET updated_at='2000-01-01 00:00:00' WHERE factory='xian'").run();
  const stale=await f.POST(f.req({...event,input:{...event.input,orderNo:'AUTO-2'}}));
  assert.equal(stale.status,422);
  assert.match((await stale.json()).message,/过期/);
 }finally{f.sql.close();}
});

test('preview records a single metric and changes neither production state nor saved drafts',async()=>{
 const f=fixture();
 try{
  const preview={action:'preview',baseRevision:1,day:f.day,input:{kind:'insert',orderNo:'PREVIEW',partCode:'P1',quantity:2,due:f.day}};
  for(let attempt=0;attempt<2;attempt++){
   const response=await f.POST(f.req(preview));
   assert.equal(response.status,200);
   assert.equal((await response.json()).preview.normal.sixDays[0].amount,2);
  }
  const event=f.sql.prepare('SELECT * FROM aps_metric_events').get();
  assert.equal(event.kind,'方案生成');
  assert.equal(event.base_version,'1');
  assert.ok(!event.subject.includes('PREVIEW'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM aps_metric_events').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM scenario_drafts').get().n,0);
  assert.deepEqual(JSON.parse(f.read().data),f.state);
 }finally{f.sql.close();}
});
