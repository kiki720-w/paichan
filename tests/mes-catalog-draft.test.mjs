import assert from 'node:assert/strict';
import test from 'node:test';
import {openCatalog,catalogStatus} from '../scripts/mes-catalog-store.mjs';
import {buildMesDraft,changeMesDraft,applyPublishedMesDraft} from '../scripts/mes-catalog-draft.mjs';

const row={jobId:'job-id',operationId:'op-id',workOrder:'JOB-01',operationNo:'20',operationName:'车工',partCode:'P',partName:'试件',planned:8,completed:2,pendingReports:0,requiresReview:false,due:'2026-12-01',drawingNo:'D1'};
const worker={id:'w',name:'人员',team:'车工',capacity:100,overtime:100,skills:['试件'],active:true};
const part={id:'p',code:'P',name:'试件',category:'试件',unit:10,workers:[worker.id],drawingNo:'D1'};

test('a closed MES job or operation with unbalanced quantities stays out of the pending pool',()=>{
 assert.equal(catalogStatus({...row,jobStatus:'3'}),'review');
 assert.equal(catalogStatus({...row,operationStatus:'2'}),'review');
 assert.equal(catalogStatus({...row,jobStatus:'3',completed:8}),'complete');
});

test('catalog keeps completed history apart from a factory-specific pending pool and review queue',()=>{
 const store=openCatalog(':memory:');
 try{
  const snapshot={cursor:'',cutoff:null,seen_at:null,complete:true,jobs:1,version:0};
  assert.equal(store.commit('xian',snapshot,[row.jobId],[row,{...row,operationId:'completed',completed:8},{...row,operationId:'bad',pendingReports:1}]),3);
  assert.equal(store.commit('xian',snapshot,[row.jobId],[row,{...row,operationId:'completed',completed:8},{...row,operationId:'bad',pendingReports:1}]),0);
  assert.equal(store.progress('xian').version,1);
  assert.equal(store.list('xian','complete','JOB-',null).rows.length,1);
  assert.deepEqual(store.planningRows('xian',['P']),[row]);
  assert.equal(store.list('xingping',null,'JOB-',null).rows.length,0);
 }finally{store.close();}
});

test('draft reserves published quantity and cannot publish once source or plan has changed',()=>{
 const order={id:'original',orderNo:'JOB-01',partCode:'P',name:'试件',qty:8,done:2,due:'2026-12-01',priority:1,status:'部分完成',mesOperationId:'op-id',mesOperationNo:'20'};
 const published={orderId:'original',orderNo:order.orderNo,partCode:'P',date:'2026-11-18',worker:'人员',amount:20,capacity:100,name:'试件',due:order.due,status:'按期'};
 const state={orders:[order],workers:[worker],parts:[part],allocations:[published],history:[{id:'old-plan',status:'已发布',allocations:[published]}],lastRun:'old',planStatus:'已发布',planSnapshotId:'old-plan'};
 const draft=buildMesDraft('xian',state,[row],5,3);
 assert.equal(draft.allocations.reduce((sum,allocation)=>sum+allocation.amount,0),40);
 assert.equal(state.history.length,1);
 assert.throws(()=>changeMesDraft(draft,'publish',state,5,3,'负责人'),/确认/);
 const confirmed=changeMesDraft(draft,'confirm',state,5,3,'负责人');
 assert.throws(()=>changeMesDraft(confirmed,'publish',state,6,3,'负责人'),/已变化/);
 assert.throws(()=>changeMesDraft(confirmed,'publish',state,5,4,'负责人'),/已变化/);
 const outcome=changeMesDraft(confirmed,'publish',state,5,3,'负责人');
 const saved=applyPublishedMesDraft(state,outcome,'负责人');
 assert.deepEqual(saved.allocations[0],published);
 assert.deepEqual(saved.history[1],state.history[0]);
 assert.equal(saved.orders[0].id,'original');
 assert.equal(saved.orders[0].done,2);
 const scratch={...state,planStatus:'草稿',planSnapshotId:undefined};
 const combined=buildMesDraft('xian',scratch,[row],7,4);
 assert.deepEqual(combined.unpublishedRows,[published]);
 assert.equal(combined.allocations.reduce((sum,allocation)=>sum+allocation.amount,0),40);
 const accepted=changeMesDraft(combined,'confirm',scratch,7,4,'负责人');
 const publishedCombined=applyPublishedMesDraft(scratch,changeMesDraft(accepted,'publish',scratch,7,4,'负责人'),'负责人');
 assert.deepEqual(publishedCombined.allocations[0],published);
});
