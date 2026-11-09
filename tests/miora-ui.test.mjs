import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const shellUrl = new URL('../app/miora-shell.tsx', import.meta.url);

function loadShell() {
  assert.ok(existsSync(shellUrl), 'the Miora shell must be implemented');
  const {outputText} = ts.transpileModule(readFileSync(shellUrl, 'utf8'), {
    compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS},
  });
  const exports = {};
  new Function('require', 'exports', outputText)(require, exports);
  return exports;
}

function renderShell(page, role) {
  const {MioraShell} = loadShell();
  return renderToStaticMarkup(React.createElement(MioraShell, {
    page, role, factory: 'xingping', account: '计划员',
    onNavigate() {}, onSwitchFactory() {}, onPassword() {}, onLogout() {},
    children: React.createElement('p', null, '本厂业务数据'),
  }));
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
