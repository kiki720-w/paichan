import assert from 'node:assert/strict';
import test from 'node:test';
import {loadUi} from './load-ui.mjs';
import * as XLSX from 'xlsx';

const {buildScenarioTemplate,readScenarioWorkbook,scanScenarioFields,scenarioFromFields}=loadUi('scenario-intake');
const state={orders:[{id:'1',orderNo:'WO-1',partCode:'X'},{id:'2',orderNo:'WO-1',partCode:'Y'}],
 workers:[{id:'w',name:'甲',active:true}]};

test('Excel scenario template round-trips with exact input and factory isolation',()=>{
 const book=buildScenarioTemplate('xian');
 const sheet=book.Sheets[book.SheetNames[0]];
 XLSX.utils.sheet_add_aoa(sheet,[['西安','调整交期','WO-1','Y','','','2026-11-24']],{origin:'A2'});
 const source=XLSX.write(book,{bookType:'xlsx',type:'array'});
 const fields=readScenarioWorkbook(source,'xian');
 assert.deepEqual(scenarioFromFields(fields,state,'xian'),{kind:'due',orderId:'2',due:'2026-11-24'});
 assert.throws(()=>readScenarioWorkbook(source,'xingping'),/工厂/);
});

test('recognition preserves confidence and maps only exact fields without guessing matching orders',()=>{
 const fields=scanScenarioFields('情景：调整交期\n工单号：WO-1\n交期：2026/11/24\n工厂：西安',63);
 assert.equal(fields.find(field=>field.key==='工单号').confidence,63);
 assert.throws(()=>scenarioFromFields(fields,state,'xian'),/唯一/);
 const withPart=scanScenarioFields('情景：调整交期\n工单号：WO-1\n物料编码：X\n交期：2026/11/24\n工厂：西安',63);
 assert.deepEqual(scenarioFromFields(withPart,state,'xian'),{kind:'due',orderId:'1',due:'2026-11-24'});
});
