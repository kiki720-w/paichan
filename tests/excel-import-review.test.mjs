import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {reviewExcelImport}=loadUi('excel-import-review');
const order={id:'order-1',orderNo:'WO-1',partCode:'P1',qty:20,done:0,due:'2026-12-05'};
const row={orderId:order.id,orderNo:order.orderNo,partCode:order.partCode,worker:'测试员'};
const state={orders:[order],workers:[],parts:[],allocations:[row,{...row}],planStatus:'已发布',history:[{id:'plan',allocations:[row]}]};

test('Excel preview lists new orders and quantity, progress and deadline changes on a published plan',()=>{
 const updated={...order,qty:18,done:8,due:'2026-12-01'};
 const added={...order,id:'order-2',orderNo:'WO-2'};
 const review=reviewExcelImport(state,{...state,orders:[updated,added]});
 assert.deepEqual(Array.from(review.changes,change=>change.kind),['变更','新增']);
 assert.equal(review.conflicts.length,1);
 assert.equal(review.conflicts[0].orderNo,'WO-1');
 assert.equal(review.conflicts[0].reason,'订单数量 20 → 18；已完成 0 → 8；交期 2026-12-05 → 2026-12-01');
 assert.equal(state.orders[0].done,0);
});

test('snapshot removal is visible and marked for dispatch review',()=>{
 const next={...state,orders:[]};
 const review=reviewExcelImport(state,next);
 assert.equal(review.changes[0].kind,'移出');
 assert.match(review.conflicts[0].reason,/无法对应原派工订单/);
 assert.equal(reviewExcelImport({...next,excelImportConflicts:review.openConflicts},next).openConflicts.length,1);
});
