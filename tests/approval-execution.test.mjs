import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {executeApproval}=loadUi('server/approval-execution');
const source={id:'source',orderNo:'ORDER',partCode:'P',name:'工件',qty:10,done:2,status:'部分完成',priority:3};
const other={...source,id:'other',orderNo:'OTHER',done:0};
const approval={id:'application',kind:'outsourcing',orderNo:source.orderNo,partCode:source.partCode,quantity:3,due:'2026-12-20'};
const state={orders:[source,other],parts:[{code:'P',unit:2,name:'工件'}],allocations:[],history:[{id:'published'}],planStatus:'已发布'};

test('partial outsourcing moves the approved quantity without changing shared material or dispatch history',()=>{
 const active={...state,allocations:[{orderId:source.id,amount:8}]};
 const result=executeApproval(active,approval,source.id).state;
 assert.equal(result.orders[0].qty,7);
 assert.equal(result.orders[0].done,2);
 assert.equal(result.orders[1],other);
 assert.equal(result.orders[2].qty,3);
 assert.equal(result.orders[2].outsourcingParentId,source.id);
 assert.equal(result.parts,state.parts);
 assert.equal(result.allocations,active.allocations);
 assert.equal(result.history,state.history);
 assert.equal(result.planStatus,'已发布');
});

test('published over-allocation, stale target and duplicate urgent orders are rejected before any write',()=>{
 assert.throws(()=>executeApproval({...state,allocations:[{orderId:source.id,amount:11}]},approval,source.id),/已发布派工/);
 assert.throws(()=>executeApproval(state,approval,other.id),/原内部订单/);
 assert.throws(()=>executeApproval(state,{...approval,kind:'urgent'},null),/已存在/);
 const urgent=executeApproval(state,{...approval,kind:'urgent',orderNo:'NEW'},null);
 assert.equal(urgent.state.orders.at(-1).priority,1);
 assert.equal(urgent.state.orders.at(-1).approvalExecutionId,approval.id);
 assert.equal(urgent.state.allocations,state.allocations);
});
