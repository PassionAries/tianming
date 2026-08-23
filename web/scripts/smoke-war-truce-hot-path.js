#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(WEB, 'tm-feudal-warfare.js'), 'utf8');
const start = source.indexOf('var WarWeightSystem = {');
const end = source.indexOf('// D1. 宣战理由', start);
assert(start >= 0 && end > start, 'WarWeightSystem source slice should exist');

const counters = Object.create(null);
const context = {
  console,
  Math,
  Number,
  String,
  Object,
  Array,
  Date,
  Error,
  JSON,
  clamp(value, min, max) { return Math.max(min, Math.min(max, value)); },
  _dbg() {},
  TM: {
    perf: {
      count(name, delta) { counters[name] = (counters[name] || 0) + (delta == null ? 1 : delta); }
    }
  },
  GM: null,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context, { filename: 'tm-feudal-warfare.js#WarWeightSystem' });

const metrics = [];
let world;
[100, 1000].forEach((size) => {
  Object.keys(counters).forEach((name) => { delete counters[name]; });
  const truces = {};
  for (let i = 0; i < size; i++) truces[`势力${i}|势力${i + 1}`] = 50000;
  world = {
    turn: 10,
    _campaignId: 'truce-hot-world-' + size,
    _timelineId: 'truce-hot-timeline-' + size,
    _warTruces: { version: 1, truces },
  };
  context.GM = world;

  const originalDictionary = world._warTruces.truces;
  assert.strictEqual(context.WarWeightSystem.hasTruce('势力10', '势力11', world), true, 'first truce lookup should remain correct');
  const normalizedDictionary = world._warTruces.truces;
  for (let i = 1; i < 10000; i++) {
    assert.strictEqual(context.WarWeightSystem.hasTruce('势力10', '势力11', world), true, 'hot truce lookup should remain correct');
  }
  assert((counters['truce.normalizeCount'] || 0) <= 1, '10000 hot lookups should normalize the world state at most once');
  assert.strictEqual(world._warTruces.truces, normalizedDictionary, 'queries after the first normalization must preserve the dictionary identity');
  assert.notStrictEqual(normalizedDictionary, originalDictionary, 'the first legacy read should normalize into one safe dictionary');
  metrics.push({ truces: size, lookups: 10000, normalizeCount: counters['truce.normalizeCount'] || 0 });
});

const detached = context.WarWeightSystem.serialize(world);
world._warTruces.truces['势力10|势力11'] = 99999;
assert.notStrictEqual(detached.truces['势力10|势力11'], 99999, 'serialized truce output should remain detached');

const sameNameA = { id: 'faction-a-1', name: '同名势力' };
const sameNameB = { id: 'faction-a-2', name: '同名势力' };
const target = { id: 'faction-target', name: '目标势力' };
world.facs = [sameNameA, sameNameB, target];
context.WarWeightSystem.addTruce(sameNameA, target, 20, world);
assert.strictEqual(context.WarWeightSystem.hasTruce(sameNameA, target, world), true, 'object callers should use stable faction IDs');
assert.strictEqual(context.WarWeightSystem.hasTruce(sameNameB, target, world), false, 'same-name distinct faction IDs should not share a truce');

const legacyWorld = {
  turn: 3,
  facs: [{ id: 'old-a', name: '旧甲' }, { id: 'old-b', name: '旧乙' }],
  _warTruces: { version: 1, truces: { '旧乙|旧甲': 30 } },
};
assert.strictEqual(context.WarWeightSystem.hasTruce('旧甲', '旧乙', legacyWorld), true, 'unique legacy name keys should remain readable');
assert(Object.keys(legacyWorld._warTruces.truces).some((key) => key.includes('id:old-a')), 'unique legacy name key should migrate to stable faction IDs on first read');

console.log('smoke-war-truce-hot-path ok ' + JSON.stringify(metrics));
