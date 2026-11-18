import assert from 'node:assert/strict';
import test from 'node:test';
import {buildMesDraft} from '../scripts/mes-catalog-draft.mjs';

const sample={operationId:'a',workOrder:'W',operationNo:'10',operationName:'粗车',partCode:'P',partName:'弹性夹头',drawingNo:'D1',due:'2026-12-30',planned:4,completed:1,requiresReview:false,pendingReports:0};
const quota=(row,unit)=>({operationId:row.operationId,workOrder:row.workOrder,operationNo:row.operationNo,partCode:row.partCode,drawingNo:row.drawingNo,name:row.partName,unit});

test('a confirmed operation quota schedules only the matching operation and does not overwrite the material master',()=>{
 const finishing={...sample,operationId:'b',operationNo:'20',operationName:'精车'};
 const unverified={...sample,operationId:'c',operationNo:'30'};
 const unrelated={...sample,operationId:'d',operationNo:'40',pendingReports:1};
 const state={orders:[],allocations:[],history:[],parts:[],lastRun:'',workers:[{id:'p',name:'测试车工',active:true,capacity:250,overtime:250,skills:['弹性夹头']}],
  mesOperationQuotas:[quota(sample,8),quota(finishing,5),quota({...unverified,drawingNo:'D2'},19),quota(unrelated,50)]};
 const result=buildMesDraft('xian',state,[sample,finishing,unverified,unrelated],1,1);
 assert.deepEqual(result.allocations.map(a=>[a.orderId,a.amount]).sort(),[['mes-local:xian:a',24],['mes-local:xian:b',15]]);
 assert.deepEqual(state.parts,[]);
 assert.deepEqual(state.allocations,[]);
});
