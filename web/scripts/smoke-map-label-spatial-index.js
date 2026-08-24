#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = { console, Math, Number, Object, Array, Date, JSON, performance, window: {} };
sandbox.window.window = sandbox.window;
sandbox.window.globalThis = sandbox.window;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'tm-perf.js'), 'utf8'), sandbox.window, { filename: 'tm-perf.js' });
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'tm-map-label-collide.js'), 'utf8'), sandbox.window, { filename: 'tm-map-label-collide.js' });

const api = sandbox.window.TMMapLabelCollide;
const perf = sandbox.window.TM.perf;
assert(api && typeof api.placeGreedy === 'function', 'spatial label collision provider should load');

function oracle(items) {
  const hidden = new Array(items.length);
  const placed = [];
  let checks = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let hit = false;
    for (let j = 0; j < placed.length; j++) {
      checks++;
      const old = placed[j];
      if (Math.abs(item.cx - old.cx) < item.hw + old.hw && Math.abs(item.cy - old.cy) < item.hh + old.hh) {
        hit = true;
        break;
      }
    }
    hidden[i] = hit;
    if (!hit) placed.push(item);
  }
  return { hidden, checks };
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeItems(count, seed) {
  const random = makeRng(seed);
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      pr: count - i,
      cx: Math.floor(random() * 12000) - 6000,
      cy: Math.floor(random() * 8000) - 4000,
      hw: 8 + Math.floor(random() * 44),
      hh: 5 + Math.floor(random() * 24),
    });
  }
  return rows;
}

const metrics = [];
[100, 1000, 5000].forEach((size) => {
  const items = makeItems(size, 20260824 + size);
  const expected = oracle(items);
  perf.reset();
  const actual = api.placeGreedy(items, { cellSize: 64 });
  assert.deepStrictEqual(Array.from(actual), expected.hidden, `${size} labels should preserve the quadratic oracle's hidden output exactly`);
  const work = perf.workReport().counters;
  metrics.push({ size, oraclePairChecks: expected.checks, spatialPairChecks: work['map.labelPairChecks'] || 0, gridLookups: work['map.labelGridLookups'] || 0 });
  assert((work['map.labelGridLookups'] || 0) > 0, `${size} labels should use grid lookups`);
  assert((work['map.labelPairChecks'] || 0) <= expected.checks, `${size} labels should not exceed the oracle's exact pair checks`);
  if (size === 5000) {
    assert(work['map.labelPairChecks'] < expected.checks * 0.08, '5000-label spatial hash should remove more than 92% of quadratic pair checks');
  }
});

const touching = [
  { cx: 0, cy: 0, hw: 10, hh: 10 },
  { cx: 20, cy: 0, hw: 10, hh: 10 },
  { cx: 19.999, cy: 0, hw: 10, hh: 10 },
];
assert.deepStrictEqual(Array.from(api.placeGreedy(touching, { cellSize: 10 })), oracle(touching).hidden, 'strict overlap boundary semantics should remain unchanged');

console.log('smoke-map-label-spatial-index ok ' + JSON.stringify(metrics));
