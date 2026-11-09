import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadUi} from './load-ui.mjs';

test('the APS home entry renders a neutral loading state before session resolution', () => {
  const {default: Home} = loadUi('page');
  const html = renderToStaticMarkup(React.createElement(Home));
  assert.match(html, /role="status">正在加载序衡 APS/);
  assert.doesNotMatch(html, /切换工厂|订单号|Building your site/);
});
