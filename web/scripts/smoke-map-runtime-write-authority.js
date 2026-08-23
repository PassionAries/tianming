#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const mapSource = fs.readFileSync(path.join(WEB, 'tm-map-system.js'), 'utf8');
const feudalSource = fs.readFileSync(path.join(WEB, 'tm-feudal-warfare.js'), 'utf8');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return value;
}
function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing function: ' + marker);
  let pos = source.indexOf('{', start);
  let depth = 0;
  for (; pos < source.length; pos += 1) {
    if (source[pos] === '{') depth += 1;
    else if (source[pos] === '}' && --depth === 0) return source.slice(start, pos + 1);
  }
  throw new Error('unterminated function: ' + marker);
}
function sharesObject(left, right, seen = new Set()) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (left === right) return true;
  if (seen.has(left)) return false;
  seen.add(left);
  const rightObjects = new Set();
  (function collect(value) {
    if (!value || typeof value !== 'object' || rightObjects.has(value)) return;
    rightObjects.add(value);
    Object.keys(value).forEach((key) => collect(value[key]));
  }(right));
  let shared = false;
  (function scan(value) {
    if (shared || !value || typeof value !== 'object') return;
    if (rightObjects.has(value)) { shared = true; return; }
    Object.keys(value).forEach((key) => scan(value[key]));
  }(left));
  return shared;
}

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error('[smoke-map-runtime-write-authority] ' + label);
  passed += 1;
  console.log('  PASS - ' + label);
}

const scenario = deepFreeze({
  id: 'frozen-map-scenario',
  map: {
    id: 'map-template',
    width: 800,
    height: 600,
    factions: {
      court: { label: '朝廷', scenarioFactionId: 'fac-court', color: '#123456' },
      rebel: { label: '义军', scenarioFactionId: 'fac-rebel', color: '#654321' }
    },
    regions: [{
      id: 'region-capital', name: '京畿', owner: 'court', development: 40, troops: 1000,
      points: [[0, 0], [100, 0], [100, 100], [0, 100]], neighbors: []
    }]
  }
});
const P = deepFreeze({ map: clone(scenario.map), factions: [
  { id: 'fac-court', name: '朝廷', color: '#123456' },
  { id: 'fac-rebel', name: '义军', color: '#654321' }
] });
const pBefore = JSON.stringify(P);
const scenarioBefore = JSON.stringify(scenario);
const changes = [];
const context = {
  console: { log() {}, warn() {}, error: console.error },
  window: null,
  globalThis: null,
  P,
  GM: { sid: scenario.id, facs: clone(P.factions), turn: 4, turnChanges: { map: [] } },
  findScenarioById(id) { return id === scenario.id ? scenario : null; },
  deepClone: clone,
  _dbg() {},
  clamp(value, min, max) { return Math.max(min, Math.min(max, value)); },
  recordChange(kind, name, field, before, after) { changes.push({ kind, name, field, before, after }); },
  random() { return 0.99; },
  document: { getElementById() { return null; }, addEventListener() {}, createElement() { return { getContext() { return null; } }; } },
  setTimeout,
  clearTimeout
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(mapSource, context, { filename: 'tm-map-system.js' });
vm.runInContext(extractFunction(feudalSource, 'function updateMap(timeRatio)'), context, { filename: 'feudal-update-map.js' });

const readView = context.getMapAIContextData();
check(readView && readView.regions[0].id === 'region-capital' && !context.GM.mapData,
  'AI context normalizes a detached read view without binding or mutating a template');
check(JSON.stringify(P) === pBefore && JSON.stringify(scenario) === scenarioBefore,
  'read-only provider leaves frozen P and scenario sources byte-equivalent');

const runtime = context.normalizeGameMapRuntime(P.map);
check(runtime === context.GM.mapData && runtime !== P.map,
  'normalize entry clones a template into the world-owned GM.mapData');
check(!sharesObject(runtime, P.map) && !sharesObject(runtime, scenario.map),
  'runtime map shares no mutable nested references with either template');

context.setMapRegionOwner('region-capital', 'fac-rebel', { reason: 'authority-smoke' });
context.updateMapRegionFields('region-capital', { development: 55, troops: 900 }, { reason: 'authority-smoke' });
context.applyRuntimeAIMapChanges({ map_changes: { development_changes: [{ region_id: 'region-capital', delta: 5 }] } });
context.updateMap(1);
check(context.GM.mapData.regions[0].development >= 60 && context.GM.mapData.regions[0].troops <= 900,
  'owner, field, AI and feudal write paths all mutate only GM.mapData');
check(JSON.stringify(P) === pBefore && JSON.stringify(scenario) === scenarioBefore,
  'all production mutations preserve frozen P and scenario registry bytes');
check(changes.every((entry) => entry.before !== entry.after),
  'map change ledger receives genuine before/after values');

const gameA = clone(context.GM.mapData);
context.GM = { sid: scenario.id, facs: clone(P.factions), turn: 1 };
const gameB = context.ensureWritableRuntimeMap();
check(gameB.regions[0].development === 40 && gameA.regions[0].development !== gameB.regions[0].development,
  'new world B clones the immutable template and inherits no world A changes');

const frozenLegacyMap = deepFreeze(clone(scenario.map));
const frozenLegacyBytes = JSON.stringify(frozenLegacyMap);
context.GM = { sid: scenario.id, facs: clone(P.factions), turn: 2, map: frozenLegacyMap };
const migratedLegacyMap = context.normalizeGameMapRuntime(context.GM.map);
check(migratedLegacyMap === context.GM.mapData && migratedLegacyMap !== context.GM.map
  && JSON.stringify(context.GM.map) === frozenLegacyBytes,
'legacy GM.map is also a clone source, never an in-place normalization target');

const rollback = clone(gameB);
context.updateMapRegionFields('region-capital', { troops: 1 }, { reason: 'rollback-injection' });
context.GM.mapData = rollback;
check(context.GM.mapData.regions[0].troops === 1000,
  'detached transaction restoration can restore the original runtime map without touching templates');

console.log('[smoke-map-runtime-write-authority] pass=' + passed);
