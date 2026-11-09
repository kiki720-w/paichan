import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {loadUi} from './load-ui.mjs';

test('daily dispatch workbook contains only the selected date, with factory and plan status', () => {
  const {buildDailyDispatch} = loadUi('dispatch-export');
  const row = {date:'2026-11-10',worker:'车工甲',orderNo:'WO-1',partCode:'P-1',drawingNo:'D-1',name:'底座',amount:12.5,capacity:30,due:'2026-11-13',status:'按期'};
  const other = {...row,date:'2026-11-11',orderNo:'WO-2'};
  const output = buildDailyDispatch('西安工厂','2026-11-11','草稿',[row,other]);
  assert.equal(output.filename,'西安工厂-当日派工单-2026-11-11.xlsx');
  const reopened = XLSX.read(XLSX.write(output.workbook,{bookType:'xlsx',type:'buffer'}),{type:'buffer'});
  assert.deepEqual(reopened.SheetNames,['当日派工']);
  const rows = XLSX.utils.sheet_to_json(reopened.Sheets['当日派工']);
  assert.equal(rows.length,1);
  assert.deepEqual([rows[0]['工厂'],rows[0]['加工日期'],rows[0]['订单号'],rows[0]['当天工作量'],rows[0]['计划状态']],['西安工厂','2026-11-11','WO-2',12.5,'草稿']);
  assert.equal(buildDailyDispatch('西安工厂','2026-11-12','草稿',[row,other]),null);
});
