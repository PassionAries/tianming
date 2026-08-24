#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tm-perf.js'), 'utf8');
const listeners = Object.create(null);
let clock = 0;
const context = {
  window: null,
  document: {
    readyState: 'complete',
    addEventListener(name, fn) { listeners[name] = fn; },
    getElementById() { return null; }
  },
  performance: { now() { clock += 2; return clock; } },
  console,
  setTimeout,
  clearTimeout,
  Date,
  Promise,
  Error,
  Object,
  Number,
  Math
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'tm-perf.js' });

const perf = context.TM.perf;
let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error('[smoke-perf-work-counters] ' + label);
  passed += 1;
  console.log('  PASS - ' + label);
}

perf.count('semantic.sourceRowsVisited', 10);
perf.count('semantic.sourceRowsVisited', 2);
perf.gauge('semantic.batchSize', 32);
check(perf.workReport().counters['semantic.sourceRowsVisited'] === 12
  && perf.workReport().gauges['semantic.batchSize'] === 32,
  'count and gauge expose deterministic structural work');

const syncValue = perf.withSpan('memory.rank', () => 7, { hits: 10 });
check(syncValue === 7 && perf.reportByName('memory.rank').count === 1,
  'withSpan closes and records synchronous functions');

(async function main() {
  const asyncValue = await perf.withSpan('semantic.embed', async () => 9, { texts: 2 });
  check(asyncValue === 9 && perf.reportByName('semantic.embed').count === 1,
    'withSpan closes and records fulfilled promises');

  let rejected = false;
  try { await perf.withSpan('save.idbCommit', async () => { throw new Error('injected'); }); }
  catch (error) { rejected = error.message === 'injected'; }
  check(rejected && perf.reportByName('save.idbCommit').count === 1
    && perf.workReport().activeSpans.length === 0,
  'rejected promises close spans and preserve the original error');

  let threw = false;
  try { perf.count('bad', Number.NaN); } catch (error) { threw = /finite/.test(error.message); }
  check(threw, 'invalid counter deltas fail explicitly');

  perf.reset();
  check(Object.keys(perf.workReport().counters).length === 0
    && Object.keys(perf.report()).length === 0,
  'reset clears samples and structural work without stale exported objects');

  perf.enabled = false;
  perf.count('disabled.counter', 1);
  perf.gauge('disabled.gauge', 2);
  const disabledValue = await perf.withSpan('disabled.span', async () => 11);
  check(disabledValue === 11
    && Object.keys(perf.workReport().counters).length === 0
    && Object.keys(perf.workReport().gauges).length === 0
    && perf.workReport().activeSpans.length === 0
    && Object.keys(perf.report()).length === 0,
  'enabled=false disables timing spans and deterministic workload sampling together');

  perf.enabled = true;
  perf.timingEnabled = false;
  perf.workloadEnabled = true;
  perf.count('workload.only', 3);
  perf.withSpan('timing.disabled', () => 12);
  check(perf.workReport().counters['workload.only'] === 3
    && !perf.report()['timing.disabled'],
  'timing and workload sampling can be controlled independently');
  perf.timingEnabled = true;

  console.log('[smoke-perf-work-counters] pass=' + passed);
}()).catch((error) => {
  console.error(error);
  process.exit(1);
});
