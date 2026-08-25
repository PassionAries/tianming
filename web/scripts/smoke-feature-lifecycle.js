#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');

function testDesktopLifecycle() {
  const source = fs.readFileSync(path.join(WEB, 'tm-desktop-update.js'), 'utf8');
  let hotSubscriptions = 0;
  let installerSubscriptions = 0;
  const tianming = {
    checkHotUpdate() { return Promise.resolve({ success: true, hasUpdate: false }); },
    hotUpdateStatus() { return Promise.resolve({ success: true, status: { isPackaged: true } }); },
    onHotUpdateStatus() {
      hotSubscriptions += 1;
      let active = true;
      return function dispose() { if (active) { active = false; hotSubscriptions -= 1; } };
    },
    onUpdateStatus() {
      installerSubscriptions += 1;
      let active = true;
      return function dispose() { if (active) { active = false; installerSubscriptions -= 1; } };
    }
  };
  const window = { tianming, performance: { now: Date.now }, console: { warn() {}, log() {} } };
  const document = { getElementById() { return null; }, querySelector() { return null; } };
  new Function('window', 'document', 'localStorage', 'setTimeout', 'setInterval', source)(
    window, document, { getItem() { return null; }, setItem() {} }, setTimeout, setInterval
  );
  assert(window.TMDesktopUpdate, 'desktop provider is defined without initializing');
  assert.strictEqual(hotSubscriptions + installerSubscriptions, 0, 'module evaluation installs no IPC subscription');
  window.TMDesktopUpdate.init();
  window.TMDesktopUpdate.init();
  assert.strictEqual(hotSubscriptions, 1, 'repeated init retains one hot-update subscription');
  assert.strictEqual(installerSubscriptions, 1, 'repeated init retains one installer subscription');
  assert.strictEqual(window.TMDesktopUpdate.state().subscriptions, 2, 'provider reports its exact subscriptions');
  window.TMDesktopUpdate.dispose();
  window.TMDesktopUpdate.dispose();
  assert.strictEqual(hotSubscriptions + installerSubscriptions, 0, 'repeated dispose removes exact IPC listeners once');
}

function testOnlineLifecycle() {
  const source = fs.readFileSync(path.join(WEB, 'tm-online-update.js'), 'utf8');
  const timers = new Map();
  const intervals = new Map();
  const listeners = new Map();
  let nextId = 1;
  const document = {
    hidden: false,
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement() { return { addEventListener() {}, appendChild() {}, classList: { add() {} } }; },
    getElementById() { return null; },
    querySelector(selector) {
      if (selector === 'meta[name="tm-version"]') return { getAttribute() { return '1.3.4.11'; } };
      return null;
    },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); }
  };
  const window = { location: { search: '', pathname: '/', replace() {}, reload() {} } };
  function setTimeoutStub(fn, ms) { const id = nextId++; timers.set(id, { fn, ms }); return id; }
  function clearTimeoutStub(id) { timers.delete(id); }
  function setIntervalStub(fn, ms) { const id = nextId++; intervals.set(id, { fn, ms }); return id; }
  function clearIntervalStub(id) { intervals.delete(id); }
  new Function('window', 'document', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', source)(
    window,
    document,
    { getItem() { return null; }, setItem() {} },
    function fetchStub() { return Promise.resolve({ ok: false }); },
    setTimeoutStub,
    clearTimeoutStub,
    setIntervalStub,
    clearIntervalStub
  );
  assert(window.TM_OnlineUpdate, 'online update provider is defined without initializing');
  assert.strictEqual(timers.size + intervals.size, 0, 'module evaluation schedules no update timer');
  assert.strictEqual((listeners.get('visibilitychange') || new Set()).size, 0, 'module evaluation installs no visibility listener');
  window.TM_OnlineUpdate.init();
  window.TM_OnlineUpdate.init();
  assert.strictEqual(timers.size, 1, 'repeated init retains one first-check timer');
  assert.strictEqual(intervals.size, 1, 'repeated init retains one recheck interval');
  assert.strictEqual(listeners.get('visibilitychange').size, 1, 'repeated init retains one visibility listener');
  window.TM_OnlineUpdate.dispose();
  window.TM_OnlineUpdate.dispose();
  assert.strictEqual(timers.size + intervals.size, 0, 'dispose clears all update timers');
  assert.strictEqual(listeners.get('visibilitychange').size, 0, 'dispose removes the exact visibility listener');
}

testDesktopLifecycle();
testOnlineLifecycle();
console.log('[smoke-feature-lifecycle] PASS assertions=14');
