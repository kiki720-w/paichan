import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {loadUi} from './load-ui.mjs';

const base={
 parts:[{id:'p1',code:'001',name:'底座',category:'底座',drawingNo:'D-1',unit:5,workers:['w1'],processMode:'internal',operationCode:'TURN'}],
 workers:[{id:'w1',name:'张三',team:'一班',capacity:100,overtime:120,skills:['底座'],active:true}],
 orders:[{id:'o1',orderNo:'A-1',partCode:'001',qty:20,done:3}],
 allocations:[{orderId:'o1',amount:40}],scheduleShortages:[{orderId:'o1',remainingWork:15}],
 history:[{id:'plan-1',status:'已发布'}],planStatus:'已发布',planSnapshotId:'plan-1',lastRun:'2026-11-10',
};

function bookFor(kind,rows){
 const {buildMasterDataTemplate}=loadUi('master-data-import');
 const book=buildMasterDataTemplate(kind);
 XLSX.utils.sheet_add_aoa(book.Sheets[book.SheetNames[0]],rows,{origin:'A2'});
 return XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
}

test('the part template adds and updates by text material code without touching orders or plans',()=>{
 const {applyMasterDataWorkbook}=loadUi('master-data-import');
 const book=bookFor('parts',[['001','','','',7.25,'西安'],[],['002','顶尖','D-2','顶尖',2,'西安']]);
 const {next,added,updated}=applyMasterDataWorkbook(base,'parts',book,'西安');
 assert.deepEqual([added,updated],[1,1]);
 assert.deepEqual(next.parts[0],{...base.parts[0],unit:7.25});
 assert.deepEqual(next.parts[1].workers,[]);
 assert.equal(next.parts[1].code,'002');
 assert.equal(base.parts[0].unit,5);
 for(const key of ['workers','orders','allocations','scheduleShortages','history','planStatus','planSnapshotId','lastRun'])assert.equal(next[key],base[key]);
});

test('the personnel template updates existing identities and accepts a name-only list as pending',()=>{
 const {applyMasterDataWorkbook}=loadUi('master-data-import');
 const book=bookFor('workers',[['张三','',110,'','底座、顶尖','西安'],['李四']]);
 const {next,added,updated}=applyMasterDataWorkbook(base,'workers',book,'西安');
 assert.deepEqual([added,updated],[1,1]);
 assert.deepEqual(next.workers[0],{...base.workers[0],capacity:110,skills:['底座','顶尖']});
 assert.equal(next.workers[1].name,'李四');
 assert.equal(next.workers[1].active,false);
 assert.equal(next.workers[1].capacity,0);
 assert.equal(next.parts,base.parts);
 assert.equal(next.orders,base.orders);
 assert.equal(next.allocations,base.allocations);
 assert.equal(next.history,base.history);
});

test('wrong templates, duplicate keys, invalid rows and other factories do not update any data',()=>{
 const {applyMasterDataWorkbook}=loadUi('master-data-import');
 const apply=(rows)=>applyMasterDataWorkbook(base,'parts',bookFor('parts',rows),'西安');
 assert.throws(()=>applyMasterDataWorkbook(base,'parts',bookFor('workers',[['张三']]),'西安'),/物料编码/);
 const orderBook=loadUi('order-template').buildOrderTemplate();
 assert.throws(()=>applyMasterDataWorkbook(base,'parts',orderBook,'西安'),/订单号/);
 assert.throws(()=>apply([['001','','','',8],[],['001','','','',9]]),/第 4 行.*重复/);
 assert.throws(()=>apply([['001','','','','无效']]),/第 2 行.*单件工时/);
 assert.throws(()=>apply([['001','','','',8,'兴平']]),/第 2 行.*西安/);
 assert.throws(()=>apply([]),/没有可导入/);
 assert.throws(()=>applyMasterDataWorkbook({...base,workers:[...base.workers,{...base.workers[0],id:'w2'}]},'workers',bookFor('workers',[['张三']]),'西安'),/同名/);
 assert.equal(base.parts[0].unit,5);
});
