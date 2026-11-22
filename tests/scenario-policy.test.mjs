import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';

const {reviewScenarioPolicy}=loadUi('scenario-policy');
const at=Date.parse('2026-11-20T10:00:00Z');
const policy={version:2,enabled:true,eventTypes:['due'],maxChanged:1,maxDelayDays:2,maxAgeHours:12,allowOvertime:false,excludedStatuses:['已发布']};
const comparison=[{id:'o',beforeDue:'2026-11-20',due:'2026-11-21',beforeFinish:'2026-11-20',finish:'2026-11-21',normalChanged:true,notReady:false}];
const review={event:'due',planStatus:'草稿',sourceAt:'2026-11-20T09:00:00Z',now:at,conflicts:0,blocked:0,comparison,
 rows:1,overtimeWork:0};

test('automatic draft policy requires every rule and cites its saved version',()=>{
 assert.deepEqual(reviewScenarioPolicy(policy,review),{allowed:true,version:2,reasons:[]});
 for(const [override,reason] of [
  [{event:'leave'},'情景类型'],[{planStatus:'已发布'},'计划状态'],[{sourceAt:'2026-11-19T16:00:00Z'},'过期'],
  [{sourceAt:''},'来源时间'],[{conflicts:1},'派工冲突'],[{blocked:1},'待确认'],[{overtimeWork:1},'加班'],
  [{comparison:[...comparison,{...comparison[0],id:'o2'}]},'任务数'],
  [{comparison:[{...comparison[0],finish:'2026-11-24'}]},'顺延'],[{comparison:[{...comparison[0],finish:null}]},'顺延'],
 ]){
  const result=reviewScenarioPolicy(policy,{...review,...override});
  assert.equal(result.allowed,false,reason);
  assert.match(result.reasons.join('、'),new RegExp(reason));
 }
 assert.equal(reviewScenarioPolicy({...policy,enabled:false},review).allowed,false);
});
