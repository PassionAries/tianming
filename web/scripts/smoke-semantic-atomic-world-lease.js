#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let source = fs.readFileSync(path.resolve(__dirname, '..', 'tm-semantic-recall.js'), 'utf8');
source = source.replace(
  '  // ────── Worker RPC（perf round5）',
  '  global.__semanticState = STATE;\n\n  // ────── Worker RPC（perf round5）'
);
source = source.replace(
  '  // ────── 增量索引 ──────',
  '  global.__semanticHooks = {\n' +
  '    getEmbedBatch: function() { return _embedBatch; },\n' +
  '    setEmbedBatch: function(fn) { _embedBatch = fn; }\n' +
  '  };\n\n  // ────── 增量索引 ──────'
);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function controlledIndexedDB() {
  const rows = new Map();
  let hasStore = false;
  const control = {
    failNextWrite: false,
    failAfterPut: 0,
    throwAfterPut: 0,
    pauseNextRead: false,
    pausedReads: [],
  };

  function requestResult(result, pause) {
    const req = {};
    const finish = () => {
      req.result = clone(result);
      if (req.onsuccess) req.onsuccess({ target: req });
    };
    if (pause) control.pausedReads.push(finish);
    else setTimeout(finish, 0);
    return req;
  }

  function storeApi(tx, pending) {
    return {
      indexNames: { contains(name) { return name === 'worldModel'; } },
      createIndex() {},
      put(value) {
        tx.putCount += 1;
        if (control.throwAfterPut && tx.putCount === control.throwAfterPut) {
          control.throwAfterPut = 0;
          throw new Error('injected semantic put throw');
        }
        if (control.failAfterPut && tx.putCount === control.failAfterPut) {
          control.failAfterPut = 0;
          tx.shouldAbort = true;
          tx.error = new Error('injected vector put failure');
        }
        pending.push(() => rows.set(String(value.id), clone(value)));
        return {};
      },
      getAll() {
        const pause = control.pauseNextRead;
        control.pauseNextRead = false;
        return requestResult(Array.from(rows.values()), pause);
      },
      index(name) {
        if (name !== 'worldModel') throw new Error('unknown index');
        return {
          getAll(key) {
            const pause = control.pauseNextRead;
            control.pauseNextRead = false;
            return requestResult(Array.from(rows.values()).filter((row) => row
              && row.campaignId === key[0]
              && row.timelineId === key[1]
              && row.modelVersion === key[2]), pause);
          }
        };
      }
    };
  }

  const db = {
    objectStoreNames: { contains(name) { return hasStore && name === 'idx'; } },
    createObjectStore() { hasStore = true; return storeApi({ putCount: 0 }, []); },
    transaction(_name, mode) {
      const pending = [];
      const tx = {
        mode,
        error: null,
        putCount: 0,
        shouldAbort: mode === 'readwrite' && control.failNextWrite,
        aborted: false,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort() { this.aborted = true; },
      };
      if (mode === 'readwrite') control.failNextWrite = false;
      tx.objectStore = () => storeApi(tx, pending);
      setTimeout(() => {
        if (tx.aborted || tx.shouldAbort) {
          if (tx.onabort) tx.onabort({ target: { error: tx.error || new Error('injected transaction abort') } });
          return;
        }
        pending.forEach((apply) => apply());
        if (tx.oncomplete) tx.oncomplete({ target: tx });
      }, 0);
      return tx;
    }
  };

  return {
    open() {
      const req = {};
      setTimeout(() => {
        if (!hasStore && req.onupgradeneeded) {
          req.onupgradeneeded({
            target: {
              result: db,
              transaction: { objectStore() { return storeApi({ putCount: 0 }, []); } }
            },
            oldVersion: 0
          });
        }
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    },
    control,
    seed(value) { rows.set(String(value.id), clone(value)); },
    releaseReads() {
      const pending = control.pausedReads.splice(0);
      pending.forEach((finish) => finish());
    },
    rowsFor(campaignId, timelineId) {
      return Array.from(rows.values()).filter((row) => row
        && row.campaignId === campaignId && row.timelineId === timelineId);
    }
  };
}

const idb = controlledIndexedDB();
const diagnostics = [];
const context = {
  window: null,
  globalThis: null,
  console: { log() {}, warn() {}, error: console.error },
  indexedDB: idb,
  Worker: function Worker() { throw new Error('worker disabled in smoke'); },
  fetch: undefined,
  setTimeout,
  clearTimeout,
  setInterval() { return 1; },
  clearInterval() {},
  addEventListener() {},
  Promise,
  Date,
  Math,
  Number,
  Object,
  Array,
  Set,
  Error,
  JSON,
  encodeURIComponent,
  _tmLoadGen: 1,
  _tmGetDesktopAutoSaveSessionToken() { return 'semantic-session-' + context._tmLoadGen; },
  TM: {
    errors: { capture(error, label) { diagnostics.push({ error, label }); } },
    perf: { count() {}, withSpan(_name, fn) { return fn(); } }
  },
  GM: null,
  P: { conf: {} },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'tm-semantic-recall.js' });

function embedding(text) {
  const value = String(text || '');
  let sum = 0;
  for (let i = 0; i < value.length; i += 1) sum = (sum + value.charCodeAt(i)) % 997;
  return [value.length / 100, sum / 997];
}

const hooks = context.__semanticHooks;
const state = context.__semanticState;
const normalEmbed = async (texts) => texts.map(embedding);
hooks.setEmbedBatch(normalEmbed);
state.enabled = true;
state.modelReady = true;

function world(id, count) {
  return {
    running: true,
    turn: count || 1,
    _campaignId: 'campaign-' + id,
    _timelineId: 'timeline-' + id,
    shijiHistory: Array.from({ length: count || 1 }, (_, index) => ({
      id: id + '-shiji-' + index,
      turn: index + 1,
      shilu: id + '第' + index + '条足够长的历史记录文本内容。'
    })),
    _foreshadows: [],
    _chronicleTracks: [],
    _memTables: { eventHistory: { rows: [] } }
  };
}

function switchWorld(next) {
  context._tmLoadGen += 1;
  context.GM = next;
  context.SemanticRecall.status();
}

async function rejects(promise, code) {
  let caught = null;
  try { await promise; } catch (error) { caught = error; }
  assert(caught, 'operation should reject');
  if (code) assert.strictEqual(caught.code, code);
  return caught;
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('timed out waiting for ' + label);
}

(async function main() {
  switchWorld(world('short-vector', 3));
  hooks.setEmbedBatch(async (texts) => texts.slice(0, -1).map(embedding));
  await rejects(context.SemanticRecall.buildIndex({ batchSize: 16 }));
  assert.strictEqual(state.index.length, 0, 'short vector batch must not publish index rows');
  assert.strictEqual(Object.keys(state.cursors).length, 0, 'short vector batch must not advance cursors');
  hooks.setEmbedBatch(normalEmbed);
  let result = await context.SemanticRecall.buildIndex({ batchSize: 16 });
  assert.strictEqual(result.added, 3, 'retry after short vector batch processes all pending rows');

  switchWorld(world('batch-failure', 33));
  let batchCalls = 0;
  hooks.setEmbedBatch(async (texts) => {
    batchCalls += 1;
    if (batchCalls === 2) throw new Error('injected second embedding batch failure');
    return texts.map(embedding);
  });
  await rejects(context.SemanticRecall.buildIndex({ batchSize: 16 }));
  assert.strictEqual(state.index.length, 0, 'later embedding failure must not publish earlier batches');
  assert.strictEqual(Object.keys(state.cursors).length, 0, 'later embedding failure must not advance cursors');
  hooks.setEmbedBatch(normalEmbed);
  result = await context.SemanticRecall.buildIndex({ batchSize: 16 });
  assert.strictEqual(result.added, 33, 'retry after later batch failure reprocesses every row');

  switchWorld(world('idb-abort', 2));
  idb.control.failNextWrite = true;
  await rejects(context.SemanticRecall.buildIndex({ batchSize: 16 }));
  assert.strictEqual(state.index.length, 0, 'IDB abort must leave in-memory index unchanged');
  assert.strictEqual(Object.keys(state.cursors).length, 0, 'IDB abort must leave cursors unchanged');
  assert.strictEqual(idb.rowsFor('campaign-idb-abort', 'timeline-idb-abort').length, 0,
    'IDB abort must not partially persist metadata or vectors');
  result = await context.SemanticRecall.buildIndex({ batchSize: 16 });
  assert.strictEqual(result.added, 2, 'retry after IDB abort processes the same rows');

  switchWorld(world('vector-put-failure', 2));
  idb.control.failAfterPut = 2;
  await rejects(context.SemanticRecall.buildIndex({ batchSize: 16 }));
  assert.strictEqual(state.index.length, 0, 'vector put failure must leave in-memory index unchanged');
  assert.strictEqual(idb.rowsFor('campaign-vector-put-failure', 'timeline-vector-put-failure').length, 0,
    'metadata put followed by vector failure must abort the whole transaction');
  result = await context.SemanticRecall.buildIndex({ batchSize: 16 });
  assert.strictEqual(result.added, 2, 'retry after vector put failure remains complete and duplicate-free');

  switchWorld(world('put-throw', 2));
  idb.control.throwAfterPut = 2;
  await rejects(context.SemanticRecall.buildIndex({ batchSize: 16 }));
  assert.strictEqual(state.index.length, 0, 'synchronous vector put error must leave in-memory index unchanged');
  assert.strictEqual(idb.rowsFor('campaign-put-throw', 'timeline-put-throw').length, 0,
    'synchronous vector put error must abort metadata and vector writes together');
  result = await context.SemanticRecall.buildIndex({ batchSize: 16 });
  assert.strictEqual(result.added, 2, 'retry after synchronous put error processes the same rows');

  const worldA = world('lease-A', 1);
  switchWorld(worldA);
  let releaseEmbedding;
  let embeddingStarted = false;
  hooks.setEmbedBatch((texts) => new Promise((resolve) => {
    embeddingStarted = true;
    releaseEmbedding = () => resolve(texts.map(embedding));
  }));
  const staleBuild = context.SemanticRecall.buildIndex({ batchSize: 16 });
  await waitFor(() => embeddingStarted, 'world A embedding');
  const worldB = world('lease-B', 1);
  switchWorld(worldB);
  releaseEmbedding();
  await rejects(staleBuild, 'semantic_world_changed');
  assert.strictEqual(state.index.length, 0, 'stale world A task must not modify world B memory state');
  assert.strictEqual(idb.rowsFor('campaign-lease-A', 'timeline-lease-A').length, 0,
    'stale world A task must not persist after its lease expires');
  hooks.setEmbedBatch(normalEmbed);
  result = await context.SemanticRecall.buildIndex({ batchSize: 16 });
  assert.strictEqual(result.added, 1, 'world B builds normally after stale world A task exits');
  assert(state.index.every((item) => item.campaignId === 'campaign-lease-B'), 'world B index contains no world A rows');

  const modelVersion = state.modelVersion;
  const loadCampaign = 'campaign-load-A';
  const loadTimeline = 'timeline-load-A';
  idb.seed({
    id: '__meta__:' + encodeURIComponent(loadCampaign) + ':' + encodeURIComponent(loadTimeline) + ':' + encodeURIComponent(modelVersion),
    campaignId: loadCampaign,
    timelineId: loadTimeline,
    modelVersion,
    count: 1,
    lastIndexedTurn: 7,
    cursors: {}
  });
  idb.seed({
    id: loadCampaign + ':' + loadTimeline + ':shiji:load-A-row',
    sourceId: 'load-A-row',
    campaignId: loadCampaign,
    timelineId: loadTimeline,
    modelVersion,
    source: 'shiji',
    turn: 7,
    text: '读档租约测试历史',
    vec: [0.1, 0.2]
  });
  switchWorld(Object.assign(world('load-A', 1), { _campaignId: loadCampaign, _timelineId: loadTimeline }));
  idb.control.pauseNextRead = true;
  const staleLoad = context.SemanticRecall.loadIndex();
  await waitFor(() => idb.control.pausedReads.length === 1, 'paused world A load');
  switchWorld(world('load-B', 1));
  idb.releaseReads();
  await rejects(staleLoad, 'semantic_world_changed');
  assert.strictEqual(state.index.length, 0, 'late world A load result must not overwrite world B state');

  switchWorld(world('single-flight', 2));
  let singleFlightCalls = 0;
  let releaseSingleFlight;
  hooks.setEmbedBatch((texts) => new Promise((resolve) => {
    singleFlightCalls += 1;
    releaseSingleFlight = () => resolve(texts.map(embedding));
  }));
  const first = context.SemanticRecall.buildIndex({ batchSize: 16 });
  const second = context.SemanticRecall.buildIndex({ batchSize: 16 });
  await waitFor(() => singleFlightCalls === 1, 'single-flight embedding');
  releaseSingleFlight();
  const both = await Promise.all([first, second]);
  assert.strictEqual(singleFlightCalls, 1, 'same-world concurrent builds share one embedding flight');
  assert.strictEqual(both[0].added, 2);
  assert.strictEqual(both[1].added, 2);
  assert.strictEqual(state.index.length, 2, 'single-flight publishes each row once');

  switchWorld(world('single-flight-failure', 1));
  let rejectFlight;
  hooks.setEmbedBatch(() => new Promise((_resolve, reject) => { rejectFlight = reject; }));
  const failedFirst = context.SemanticRecall.buildIndex({ batchSize: 16 });
  const failedSecond = context.SemanticRecall.buildIndex({ batchSize: 16 });
  await waitFor(() => typeof rejectFlight === 'function', 'single-flight rejection');
  rejectFlight(new Error('injected shared embedding failure'));
  const failed = await Promise.allSettled([failedFirst, failedSecond]);
  assert(failed.every((entry) => entry.status === 'rejected'), 'all callers observe the shared failure');
  assert.strictEqual(state.index.length, 0);
  assert.strictEqual(Object.keys(state.cursors).length, 0);
  hooks.setEmbedBatch(normalEmbed);
  result = await context.SemanticRecall.buildIndex({ batchSize: 16 });
  assert.strictEqual(result.added, 1, 'a new flight retries all rows after the shared failure');

  assert(diagnostics.some((entry) => entry.label === 'SemanticRecall.loadIndex') === false,
    'expected injected build failures do not masquerade as load failures');
  console.log('smoke-semantic-atomic-world-lease ok');
}()).catch((error) => {
  console.error(error);
  process.exit(1);
});
