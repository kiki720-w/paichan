import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/auth/access.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
});

function authInMode(mode) {
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, process: {env: {NODE_ENV: mode}},
    require: () => ({env: {}}),
  });
  return exports;
}

test('local HTTP development can set and clear a session cookie without Secure', () => {
  const {sessionCookie} = authInMode('development');
  for (const host of ['127.0.0.1', 'localhost']) {
    const request = new Request(`http://${host}:3188/api/auth/login`);
    assert.equal(sessionCookie('test-token', request), 'xuheng_session=test-token; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800');
    assert.equal(sessionCookie('', request, 0), 'xuheng_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  }
});

test('production, HTTPS, and non-loopback development always retain Secure', () => {
  const cases = [
    ['production', 'http://127.0.0.1:3188'],
    ['production', 'https://xuheng-aps.com'],
    ['development', 'https://localhost:3188'],
    ['development', 'http://localhost.example.test'],
    ['development', 'http://192.168.1.8:3188'],
  ];
  for (const [mode, origin] of cases) {
    const {sessionCookie} = authInMode(mode);
    const request = new Request(origin + '/api/auth/login');
    assert.match(sessionCookie('test-token', request), /; Secure; SameSite=Strict;/, origin);
  }
});
