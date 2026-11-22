import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {validateDeliveryBatches,forecastDeliveryBatches}=loadUi('delivery-batches');
const batches=[{label:'第二批',quantity:3,due:'2026-11-19'},{label:'第一批',quantity:4,due:'2026-11-17'}];

test('delivery commitments validate remaining quantity and unique batch labels',()=>{
 const result=validateDeliveryBatches(batches,9,2);
 assert.deepEqual(result.map(batch=>batch.label),['第一批','第二批']);
 assert.equal(result.reduce((sum,batch)=>sum+batch.quantity,0),7);
 assert.throws(()=>validateDeliveryBatches(batches,9,3),/剩余/);
 assert.throws(()=>validateDeliveryBatches([batches[0],batches[0]],9,2),/批次号/);
 assert.throws(()=>validateDeliveryBatches([batches[0],{...batches[1],due:'2026-11-31'}],9,2),/交期/);
});

test('batch forecasts allocate actual scheduled work once, give separate completion dates and expose unfinished quantities',()=>{
 const result=forecastDeliveryBatches(validateDeliveryBatches(batches,9,2),2,[
  {date:'2026-11-18',amount:2},{date:'2026-11-17',amount:6},{date:'2026-11-20',amount:4},
 ]);
 assert.deepEqual(result.map(row=>[row.label,row.finish,row.scheduled,row.quantity-row.scheduled]),[
  ['第一批','2026-11-18',4,0],['第二批',null,2,1],
 ]);
});
