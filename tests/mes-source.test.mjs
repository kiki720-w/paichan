import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {loadUi} from './load-ui.mjs';

const event=(version=1,overrides={})=>({factory:'xian',key:'work-1/turn',version,orderNo:'WO-1',partCode:'P1',name:'底座',qty:10,done:0,due:'2026-11-20',drawingNo:'D1',...overrides});
const snapshot=()=>({orders:[],allocations:[{orderNo:'older'}],history:[{id:'published'}],planStatus:'已发布'});
function memoryStore(state=snapshot()){
 let current={revision:1,state},writes=0;
 return {read:async()=>current,commit:async(factory,revision,next)=>{
  assert.equal(factory,'xian');if(revision!==current.revision)return false;
  current={revision:revision+1,state:next};writes++;return true;
 },get current(){return current},get writes(){return writes}};
}
function source(records,nextCursor){
 return {id:'mes-replica',read:async()=>({records,nextCursor})};
}

test('MES read-only source updates orders and cursor without changing a published plan',async()=>{
 const {syncMesPage}=loadUi('server/mes-source');
 const store=memoryStore();
 const before=store.current.state;
 assert.equal((await syncMesPage('xian',source([event()],'first'),store)).applied,1);
 const first=store.current.state.orders[0];
 assert.equal(first.done,0);
 const next=source([event(2,{qty:12,done:4}),event(1)],'next');
 assert.equal((await syncMesPage('xian',next,store)).applied,1);
 const after=store.current.state;
 assert.deepEqual(after.orders.map(row=>[row.id,row.qty,row.done]),[[first.id,12,4]]);
 assert.equal(after.mesSync.cursor,'next');
 assert.equal(after.allocations,before.allocations);
 assert.equal(after.history,before.history);
 assert.equal(after.planStatus,'已发布');
 await syncMesPage('xian',next,store);
 assert.equal(store.writes,2);
});

test('MES batch is rejected without moving the cursor on invalid scope or save conflict',async()=>{
 const {syncMesPage}=loadUi('server/mes-source');
 const store=memoryStore();
 await assert.rejects(syncMesPage('xian',source([event(),event(2,{factory:'xingping'})],'bad'),store),/工厂/);
 assert.equal(store.writes,0);
 const conflicting={...store,commit:async()=>false};
 await assert.rejects(syncMesPage('xian',source([event()],'uncommitted'),conflicting),/版本冲突/);
 assert.equal(store.current.state.mesSync,undefined);
 await assert.rejects(syncMesPage('xian',{id:'mes-replica',read:async()=>{throw Error('offline')}},store),/offline/);
 assert.equal(store.writes,0);
});

test('MES merges a uniquely matched Excel order, preserves human edits, and rejects impossible completion',async()=>{
 const {syncMesPage}=loadUi('server/mes-source');
 const manualCompletion={done:6,at:'now',by:'主管',reason:'现场核对'};
 const workerAssignment={workerId:'w1',at:'now',by:'主管',reason:'指定'};
 const store=memoryStore({...snapshot(),orders:[{id:'excel-1',orderNo:'WO-1',partCode:'P1',name:'底座',due:'2026-11-20',qty:10,done:6,status:'待排',priority:1,manualCompletion,workerAssignment}]});
 const result=await syncMesPage('xian',source([event(1,{qty:15,done:3})],'one'),store);
 assert.equal(result.manualConflicts,1);
 const item=store.current.state.orders[0];
 assert.deepEqual([item.id,item.qty,item.done,item.priority],['excel-1',15,6,1]);
 assert.equal(item.manualCompletion,manualCompletion);
 assert.equal(item.workerAssignment,workerAssignment);
 await assert.rejects(syncMesPage('xian',source([event(2,{qty:5})],'two'),store),/人工完工/);
 assert.equal(store.current.state.mesSync.cursor,'one');
});

test('MES D1 adapter atomically commits the factory state, cursor, backup and audit',async()=>{
 const {createMesStateStore}=loadUi('server/mes-state-store');
 const {syncMesPage}=loadUi('server/mes-source');
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`
  CREATE TABLE factory_state(factory TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT);
  CREATE TABLE factory_state_backup(id TEXT PRIMARY KEY,factory TEXT,data TEXT,revision INTEGER,actor TEXT,action TEXT,created_at TEXT);
  CREATE TABLE factory_audit(id TEXT PRIMARY KEY,factory TEXT,actor TEXT,action TEXT,summary TEXT,revision INTEGER,created_at TEXT);
 `);
 const db={
  prepare(sql){return {bind(...args){
   return {async first(){return sqlite.prepare(sql).get(...args)||null},
    execute(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}};
  }}},
  async batch(statements){
   sqlite.exec('BEGIN');
   try{const result=statements.map(statement=>statement.execute());sqlite.exec('COMMIT');return result}
   catch(error){sqlite.exec('ROLLBACK');throw error}
  },
 };
 try{
  const store=createMesStateStore(db,snapshot);
  const calls=[];
  const upstream={id:'mes-replica',read:async(factory,cursor)=>{
   calls.push([factory,cursor]);
   return cursor===null?{records:[event()],'nextCursor':'one'}:{records:[event(2,{done:3})],nextCursor:'two'};
  }};
  await syncMesPage('xian',upstream,store);
  await syncMesPage('xian',upstream,store);
  assert.deepEqual(calls,[['xian',null],['xian','one']]);
  const current=await store.read('xian');
  assert.equal(current.revision,2);
  assert.equal(current.state.orders[0].done,3);
  assert.equal(current.state.mesSync.cursor,'two');
  assert.equal((await store.read('xingping')).revision,0);
  assert.equal(await store.commit('xian',1,snapshot()),false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM factory_audit').get().n,2);
  const backup=sqlite.prepare('SELECT data FROM factory_state_backup WHERE factory = ?').get('xian');
  assert.equal(JSON.parse(backup.data).mesSync.cursor,'one');
  assert.deepEqual(await store.read('xian'),current);
  sqlite.exec("CREATE TRIGGER reject_mes_update BEFORE UPDATE ON factory_state BEGIN SELECT RAISE(ABORT,'write failed'); END");
  await assert.rejects(store.commit('xian',2,snapshot()),/write failed/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM factory_audit').get().n,2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM factory_state_backup').get().n,1);
  assert.deepEqual(await store.read('xian'),current);
 }finally{sqlite.close()}
});
