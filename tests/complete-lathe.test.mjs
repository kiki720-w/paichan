import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {loadUi} from './load-ui.mjs';

test('the blank order template round-trips with exactly the importer headers',()=>{
 const {buildOrderTemplate}=loadUi('order-template');
 const workbook=buildOrderTemplate();
 const reopened=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 assert.deepEqual(reopened.SheetNames,['订单导入','填写说明']);
 assert.deepEqual(XLSX.utils.sheet_to_json(reopened.Sheets['订单导入'],{header:1}),[
  ['订单号','物料编码','名称','图号','数量','已完成数量','交期','单件工时','客户','优先级','工厂'],
 ]);
});

const order={id:'o1',orderNo:'WO-1',partCode:'P',name:'底座',due:'2026-11-18',qty:12,done:0,drawingNo:'D1',status:'待排',priority:1};
const row={orderId:'o1',orderNo:'WO-1',partCode:'P',name:'底座',date:'2026-11-12',worker:'甲',amount:4,capacity:6,due:order.due,status:'按期'};
const gap={orderId:'o1',orderNo:'WO-1',partCode:'P',name:'底座',due:order.due,requiredWork:12,scheduledWork:4,remainingWork:8,remainingQty:8,reason:'缺口'};
test('batch preview adds only missing work, honors occupied days and leaves other gaps intact',()=>{
 const {previewBatchGaps}=loadUi('scheduling-operations');
 const other={...gap,orderId:'o2',orderNo:'WO-2'};
 const state={orders:[order],parts:[{code:'P',name:'底座',category:'底座',unit:1,workers:['w1']}],
  workers:[{id:'w1',name:'甲',capacity:6,overtime:50,active:true,skills:[]}],allocations:[row],scheduleShortages:[gap,other]};
 const preview=previewBatchGaps(state,['o1'],'2026-11-12');
 assert.equal(preview.allocations[0],row);
 assert.deepEqual(preview.allocations.slice(1).map(item=>[item.date,item.amount]),[['2026-11-12',2],['2026-11-13',6]]);
 assert.deepEqual(preview.shortages,[other]);
 assert.equal(preview.items[0].added,8);
 assert.equal(state.allocations.length,1);
 assert.throws(()=>previewBatchGaps(state,['not-a-gap'],'2026-11-12'),/缺口/);
});

test('slot movement preserves duration and cannot cross a lunch break or another dispatch',()=>{
 const {setDispatchSlot,shiftDispatchSlot}=loadUi('scheduling-operations');
 const windows='08:00-12:00,13:00-17:00';
 const other={...row,orderId:'o2',startTime:'10:30',endTime:'11:30'};
 const rows=setDispatchSlot([row,other],0,windows,'08:30',60);
 const shifted=shiftDispatchSlot(rows,0,windows,60);
 assert.deepEqual([shifted[0].startTime,shifted[0].endTime],['09:30','10:30']);
 assert.equal(shifted[1],other);
 assert.throws(()=>shiftDispatchSlot(shifted,0,windows,60),/重叠/);
 assert.throws(()=>setDispatchSlot(rows,0,windows,'11:45',30),/工作时段/);
 assert.throws(()=>setDispatchSlot(rows,0,'08:00-12:00,11:00-17:00','09:00',30),/重叠/);
 assert.equal(row.startTime,undefined);
});

test('batch preview leaves an ambiguous legacy dispatch for manual reconciliation',()=>{
 const {previewBatchGaps}=loadUi('scheduling-operations');
 const state={orders:[order,{...order,id:'o2'}],parts:[{code:'P',name:'底座',category:'底座',unit:1,workers:['w1']}],
  workers:[{id:'w1',name:'甲',capacity:6,active:true,skills:[]}],allocations:[{...row,orderId:undefined}],scheduleShortages:[gap]};
 const preview=previewBatchGaps(state,['o1'],'2026-11-12');
 assert.deepEqual(preview.allocations,state.allocations);
 assert.deepEqual(preview.shortages,[gap]);
 assert.match(preview.items[0].note,/旧派工/);
});
