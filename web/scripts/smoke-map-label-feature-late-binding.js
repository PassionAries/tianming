#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const mapSource = fs.readFileSync(path.join(WEB, 'phase8-formal-map.js'), 'utf8');
const geoSource = fs.readFileSync(path.join(WEB, 'tm-map-label-geo.js'), 'utf8');
const timers = [];
let ensureCalls = 0;

const state = { mapView: { scale: 1, tx: 0, ty: 0 }, mapScale: 'region' };
const bridge = {
  _state: state,
  map: {},
  _esc: String,
  _attr: String,
  _isGameVisible() { return false; }
};
const document = {
  getElementById() { return null; },
  querySelector() { return null; },
  addEventListener() {},
  elementsFromPoint() { return []; }
};
const root = {
  console: { warn() {}, error() {}, log() {} },
  document,
  TMPhase8FormalBridge: bridge,
  TM_PHASE8_FORMAL: state,
  TM: { Features: { ensure(name) { ensureCalls += 1; assert.strictEqual(name, 'formalMapLabels'); return Promise.resolve({ ok: true }); } } },
  setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
  clearTimeout() {},
  setInterval() {},
  clearInterval() {},
  addEventListener() {},
  getComputedStyle() { return {}; },
  Map,
  WeakMap,
  Set,
  Promise,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  RegExp,
  isFinite
};
root.window = root;
root.globalThis = root;
const context = vm.createContext(root);
vm.runInContext(mapSource, context, { filename: 'phase8-formal-map.js' });

const triangle = { points: [[0, 0], [10, 0], [0, 10]] };
assert.strictEqual(bridge.map.__regionTrueArea(triangle), 100, 'before the optional provider loads, formal map uses the bbox fallback');
bridge.map.renderFormalMap();
bridge.map.renderFormalMap();
assert.strictEqual(ensureCalls, 1, 'repeated map renders request the label feature once');

vm.runInContext(geoSource, context, { filename: 'tm-map-label-geo.js' });
assert(root.TMMapLabelGeo, 'production geometry provider loads after the map module');
assert.strictEqual(bridge.map.__regionTrueArea(triangle), 50, 'fallback area was not permanently cached before the provider arrived');

const beforeTimers = timers.length;
bridge.map.onMapLabelFeatureReady();
assert.strictEqual(state._lastFormalMapSig, null, 'late provider invalidates the formal map signature');
assert(timers.length >= beforeTimers + 2, 'late provider schedules both rerender and collision layout');

console.log('[smoke-map-label-feature-late-binding] PASS assertions=6');
