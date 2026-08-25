#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const LOADER = fs.readFileSync(path.join(WEB, 'tm-feature-loader.js'), 'utf8');
const MANIFEST = fs.readFileSync(path.join(WEB, 'feature-manifest.js'), 'utf8');

function tick() { return new Promise((resolve) => setImmediate(resolve)); }
async function settle(rounds = 8) { for (let i = 0; i < rounds; i++) await tick(); }

function makeEnvironment(options = {}) {
  const loads = [];
  const loadHandlers = [];
  const idleHandlers = [];
  const lifecycle = { desktopInit: 0, desktopDispose: 0, onlineInit: 0, onlineDispose: 0 };
  const failures = Object.assign({}, options.failures || {});
  let context;

  const document = {
    readyState: options.readyState || 'loading',
    createElement(tag) { return { tagName: String(tag).toUpperCase(), dataset: {}, async: true, onload: null, onerror: null }; },
    head: { appendChild: appendScript },
    documentElement: { appendChild: appendScript }
  };

  function clean(src) { return String(src).replace(/[?#].*$/, ''); }
  function appendScript(script) {
    const src = clean(script.src);
    loads.push(src);
    Promise.resolve().then(() => {
      if (failures[src] > 0) {
        failures[src] -= 1;
        if (script.onerror) script.onerror(new Error('injected load failure'));
        return;
      }
      if (src === 'feature-manifest.js') vm.runInContext(MANIFEST, context, { filename: src });
      else if (src === 'tm-test-harness.js') context.TM.test = { run() {} };
      else if (src === 'tm-update-card.js') context.TMUpdateCard = {};
      else if (src === 'tm-desktop-update.js') {
        context.TMDesktopUpdate = {
          init() { lifecycle.desktopInit += 1; },
          dispose() { lifecycle.desktopDispose += 1; }
        };
      } else if (src === 'tm-online-update.js') {
        context.TM_OnlineUpdate = {
          init() { lifecycle.onlineInit += 1; },
          dispose() { lifecycle.onlineDispose += 1; }
        };
      } else if (src === 'tm-map-label-geo.js') context.TMMapLabelGeo = {};
      else if (src === 'tm-map-label-collide.js') context.TMMapLabelCollide = {};
      else if (src === 'retry-once.js') context.RetryOnce = {};
      else if (src === 'always-fail.js') {
        if (script.onerror) script.onerror(new Error('always fails'));
        return;
      }
      if (script.onload) script.onload();
    });
    return script;
  }

  const root = {
    console: { warn() {}, log() {}, error() {} },
    Promise,
    Map,
    Object,
    Array,
    Error,
    Number,
    String,
    RegExp,
    Date,
    setTimeout,
    clearTimeout,
    document,
    location: { search: options.search || '' },
    TM: { platform: { kind: options.platform || 'web' } },
    addEventListener(type, fn) { if (type === 'load') loadHandlers.push(fn); },
    requestIdleCallback(fn) { idleHandlers.push(fn); return idleHandlers.length; }
  };
  root.window = root;
  root.globalThis = root;
  context = vm.createContext(root);
  vm.runInContext(LOADER, context, { filename: 'tm-feature-loader.js' });
  return {
    root,
    loads,
    lifecycle,
    fireLoad() { document.readyState = 'complete'; loadHandlers.splice(0).forEach((fn) => fn()); },
    fireIdle() { idleHandlers.splice(0).forEach((fn) => fn()); }
  };
}

(async function main() {
  const desktop = makeEnvironment({ platform: 'electron' });
  assert.strictEqual(desktop.root.TM.test, undefined, 'normal production startup does not expose TM.test');
  const concurrent = Array.from({ length: 10 }, () => desktop.root.TM.Features.ensure('desktopUpdate'));
  const results = await Promise.all(concurrent);
  assert(results.every((row) => row.ok), 'ten concurrent ensure calls resolve successfully');
  assert.strictEqual(desktop.loads.filter((src) => src === 'feature-manifest.js').length, 1, 'manifest script loads once');
  assert.strictEqual(desktop.loads.filter((src) => src === 'tm-update-card.js').length, 1, 'first feature script loads once');
  assert.strictEqual(desktop.loads.filter((src) => src === 'tm-desktop-update.js').length, 1, 'second feature script loads once');
  assert(desktop.loads.indexOf('tm-update-card.js') < desktop.loads.indexOf('tm-desktop-update.js'), 'classic scripts load in declared sequence');
  assert.strictEqual(desktop.lifecycle.desktopInit, 1, 'feature init executes once');
  await desktop.root.TM.Features.dispose('desktopUpdate');
  await desktop.root.TM.Features.dispose('desktopUpdate');
  assert.strictEqual(desktop.lifecycle.desktopDispose, 1, 'feature dispose is idempotent');
  await desktop.root.TM.Features.ensure('desktopUpdate');
  assert.strictEqual(desktop.lifecycle.desktopInit, 2, 'disposed feature can initialize again without reloading scripts');
  assert.strictEqual(desktop.loads.filter((src) => src === 'tm-desktop-update.js').length, 1, 'reinitialization reuses loaded script');

  const mismatch = await desktop.root.TM.Features.ensure('onlineUpdate');
  assert.strictEqual(mismatch.code, 'not-applicable', 'desktop rejects web-only feature with a structured result');

  desktop.root.TM.Features.define('missingProvider', {
    scripts: ['missing-provider.js'], dependsOn: [], platform: 'any', provides: ['NeverDefined']
  });
  await assert.rejects(desktop.root.TM.Features.ensure('missingProvider'), (error) => error.code === 'feature-provider-missing');

  const retry = makeEnvironment({ platform: 'web', failures: { 'retry-once.js': 1 } });
  retry.root.TM.Features.define('retryOnce', {
    scripts: ['retry-once.js'], dependsOn: [], platform: 'any', provides: ['RetryOnce']
  });
  await assert.rejects(retry.root.TM.Features.ensure('retryOnce'), (error) => error.code === 'feature-script-load-failed');
  await assert.rejects(retry.root.TM.Features.ensure('retryOnce'), (error) => error.code === 'feature-retry-required');
  const retried = await retry.root.TM.Features.retry('retryOnce');
  assert.strictEqual(retried.ok, true, 'one explicit retry can recover a failed feature');
  assert.strictEqual(retry.loads.filter((src) => src === 'retry-once.js').length, 2, 'retry inserts the failed script exactly once more');

  retry.root.TM.Features.define('alwaysFail', {
    scripts: ['always-fail.js'], dependsOn: [], platform: 'any', provides: ['Never']
  });
  await assert.rejects(retry.root.TM.Features.ensure('alwaysFail'));
  await assert.rejects(retry.root.TM.Features.retry('alwaysFail'));
  await assert.rejects(retry.root.TM.Features.retry('alwaysFail'), (error) => error.code === 'feature-retry-limit');

  const normal = makeEnvironment({ platform: 'web' });
  normal.fireLoad();
  await settle();
  assert.strictEqual(normal.root.TM.test, undefined, 'window load without a test query still does not load the harness');
  assert(!normal.loads.includes('tm-online-update.js'), 'web update waits for the idle boundary');
  normal.fireIdle();
  await settle();
  assert(normal.loads.includes('tm-online-update.js'), 'web idle boundary loads online update');
  assert.strictEqual(normal.lifecycle.onlineInit, 1, 'web update lifecycle initializes once');

  const harness = makeEnvironment({ platform: 'web', search: '?devHarness=1' });
  harness.fireLoad();
  await settle();
  assert(harness.root.TM.test && typeof harness.root.TM.test.run === 'function', 'development query loads the browser harness after window load');
  assert.strictEqual(harness.loads.filter((src) => src === 'tm-test-harness.js').length, 1, 'query path loads the harness once');

  const touch = makeEnvironment({ platform: 'capacitor' });
  const mapLabels = await touch.root.TM.Features.ensure('formalMapLabels');
  assert.strictEqual(mapLabels.ok, true, 'platform any feature loads on touch/capacitor');
  assert(touch.root.TMMapLabelGeo && touch.root.TMMapLabelCollide, 'touch branch receives both map label providers');
  assert.strictEqual((await touch.root.TM.Features.ensure('desktopUpdate')).code, 'not-applicable', 'touch branch rejects desktop-only feature');

  console.log('[smoke-feature-loader-v2] PASS assertions=27');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
