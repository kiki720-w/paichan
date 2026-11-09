import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadUi} from './load-ui.mjs';
const loadShell = () => loadUi('miora-shell');

function renderShell(page, role) {
  const {MioraShell} = loadShell();
  return renderToStaticMarkup(React.createElement(MioraShell, {
    page, role, factory: 'xingping', account: '计划员',
    onNavigate() {}, onSwitchFactory() {}, onPassword() {}, onLogout() {},
  }, React.createElement('p', null, '本厂业务数据')));
}

test('the manager can switch factories on the dashboard and nowhere else', () => {
  const dashboard = renderShell('看板', 'main');
  assert.match(dashboard, /aria-label="切换工厂"/);
  assert.match(dashboard, /aria-pressed="true">兴平/);
  const orders = renderShell('订单管理', 'main');
  assert.doesNotMatch(orders, /aria-label="切换工厂"/);
  assert.match(orders, /当前工厂[\s\S]*兴平/);
  assert.match(orders, /aria-current="page"[^>]*>[\s\S]*订单管理/);
});

test('a factory manager sees a scoped dashboard without a switch', () => {
  const html = renderShell('看板', 'factory');
  assert.doesNotMatch(html, /aria-label="切换工厂"/);
  assert.match(html, /仅本厂/);
  assert.match(html, /本厂业务数据/);
});

test('the login shell uses account credentials and no simulated role switch', () => {
  const {MioraLogin} = loadShell();
  const html = renderToStaticMarkup(React.createElement(MioraLogin, {
    username: '', password: '', error: '账号或密码不正确',
    onUsername() {}, onPassword() {}, onSubmit() {},
  }));
  assert.match(html, /autocomplete="username"/i);
  assert.match(html, /autocomplete="current-password"/i);
  assert.match(html, /type="submit">登录系统/);
  assert.match(html, /role="alert">账号或密码不正确/);
  assert.doesNotMatch(html, /role=plant|data-role|选择身份/);
});

const shortage = {orderId: 'o1', orderNo: 'WO-009', partCode: 'P-1', name: '底座', due: '2026-11-12', remainingWork: 18, remainingQty: 6, requiredWork: 45, scheduledWork: 27, reason: '六工作日产能不足'};
const allocation = {date: '2026-11-10', worker: '示例员工', orderNo: 'WO-009', partCode: 'P-1', name: '底座', drawingNo: 'D-009', amount: 27, capacity: 30, due: '2026-11-12', status: '按期'};

test('capacity gaps and missing data stay visible even when nothing was allocated', () => {
  const {MioraPlan} = loadUi('miora-plan');
  const html = renderToStaticMarkup(React.createElement(MioraPlan, {
    rows: [], dates: ['2026-11-10'], status: '草稿', shortages: [shortage],
    issues: [{key: 'o2', partCode: 'P-2', name: '刀杆', reason: '缺少标准工时'}],
    view: 'week', day: '2026-11-10', onView() {}, onDay() {}, onIssues() {},
  }));
  assert.match(html, /尚未生成派工/);
  assert.match(html, /产能缺口清单[\s\S]*WO-009[\s\S]*18\.0[\s\S]*六工作日产能不足/);
  assert.match(html, /资料不全未排入[\s\S]*P-2[\s\S]*缺少标准工时/);
  assert.doesNotMatch(html, /<details/);
});

test('weekly plan groups real allocations by person and date without mixing the plan and order status', () => {
  const {MioraPlan} = loadUi('miora-plan');
  const html = renderToStaticMarkup(React.createElement(MioraPlan, {
    rows: [allocation], dates: ['2026-11-10', '2026-11-11'], status: '已确认', shortages: [], issues: [],
    view: 'week', day: '2026-11-10', onView() {}, onDay() {}, onIssues() {},
    onEdit() {}, onAssign() {}, onComplete() {}, progress: () => '完工 0/15',
  }));
  assert.match(html, /计划状态[\s\S]*已确认/);
  assert.match(html, /11-10[\s\S]*11-11[\s\S]*示例员工[\s\S]*WO-009[\s\S]*按期/);
  assert.match(html, /人工调整/);
  assert.match(html, /整单转派/);
  assert.match(html, /登记完工/);
  assert.match(html, /D-009/);
  assert.match(html, /完工 0\/15/);
});
