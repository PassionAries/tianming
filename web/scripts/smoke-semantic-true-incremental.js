#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let source = fs.readFileSync(path.resolve(__dirname, '..', 'tm-semantic-recall.js'), 'utf8');
source = source.replace('  // ────── Worker RPC（perf round5）', '  global.__semanticState = STATE;\n\n  // ────── Worker RPC（perf round5）');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function fakeIndexedDB() {
  const rows = new Map();
  let hasStore = false;
  let clearCalls = 0;
  let putCalls = 0;

  function request(result) {
    const req = {};
    setTimeout(() => {
      req.result = clone(result);
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
  function storeApi(pending) {
    return {
      indexNames: { contains(name) { return name === 'worldModel'; } },
      createIndex() {},
      put(value) { putCalls += 1; pending.push(() => rows.set(String(value.id), clone(value))); },
      clear() { clearCalls += 1; pending.push(() => rows.clear()); },
      getAll() { return request(Array.from(rows.values())); },
      index(name) {
        if (name !== 'worldModel') throw new Error('unknown index');
        return {
          getAll(key) {
            return request(Array.from(rows.values()).filter((row) => row
              && row.campaignId === key[0] && row.timelineId === key[1] && row.modelVersion === key[2]));
          }
        };
      }
    };
  }
  const db = {
    objectStoreNames: { contains(name) { return hasStore && name === 'idx'; } },
    createObjectStore() { hasStore = true; return storeApi([]); },
    transaction() {
      const pending = [];
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = () => storeApi(pending);
      setTimeout(() => {
        pending.forEach((fn) => fn());
        if (tx.oncomplete) tx.oncomplete({ target: tx });
      }, 0);
      return tx;
    }
  };
  return {
    open(_name, _version) {
      const req = {};
      setTimeout(() => {
        if (!hasStore && req.onupgradeneeded) {
          const upgradeTx = { objectStore() { return storeApi([]); } };
          req.onupgradeneeded({ target: { result: db, transaction: upgradeTx }, oldVersion: 0 });
        }
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    },
    stats() { return { clearCalls, putCalls, size: rows.size }; }
  };
}

const counters = Object.create(null);
const idb = fakeIndexedDB();
const context = {
  window: null,
  globalThis: null,
  console: { log() {}, warn: console.warn, error: console.error },
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
  Error,
  JSON,
  encodeURIComponent,
  TM: { perf: {
    count(name, delta = 1) { counters[name] = (counters[name] || 0) + Number(delta); },
    withSpan(_name, fn) { return fn(); }
  } },
  GM: null,
  P: { conf: {} }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'tm-semantic-recall.js' });

function embedding(text) {
  text = String(text || '');
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum = (sum + text.charCodeAt(i)) % 997;
  return [text.length / 100, sum / 997];
}
context.__semanticState.enabled = true;
context.__semanticState.modelReady = true;
context.__semanticState.pipeline = async (input) => {
  const texts = Array.isArray(input) ? input : [input];
  return { data: Float32Array.from(texts.flatMap(embedding)) };
};

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error('[smoke-semantic-true-incremental] ' + label);
  passed += 1;
  console.log('  PASS - ' + label);
}
function delta(name, before) { return (counters[name] || 0) - (before[name] || 0); }
function snapshotCounters() { return Object.assign({}, counters); }

(async function main() {
  context.GM = {
    running: true,
    turn: 10,
    _campaignId: 'camp-semantic-A',
    _timelineId: 'tml_semantic_A_12345678',
    shijiHistory: Array.from({ length: 1000 }, (_, i) => ({ id: 'sj-' + i, turn: Math.floor(i / 100), shilu: '第' + i + '条足够长的固定历史记录文本内容。' })),
    _foreshadows: [],
    _chronicleTracks: [],
    _memTables: { eventHistory: { rows: [] } }
  };
  let before = snapshotCounters();
  let result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  check(result.added === 1000 && delta('semantic.sourceRowsVisited', before) === 1000,
    'first build visits and indexes all 1000 source rows');
  check(delta('semantic.embedTextCount', before) === 1000
    && delta('semantic.embedRpcCount', before) === Math.ceil(1000 / 32),
  'first build embeds fixed batches rather than one RPC per row');
  check(idb.stats().clearCalls === 0 && delta('semantic.idbPutCount', before) === 1001,
    'first v2 persistence appends vectors plus one cursor metadata row without clear');

  context.GM.shijiHistory.push({ id: 'sj-late-same-turn', turn: 10, shilu: '同回合晚追加且足够长的历史记录文本内容。' });
  before = snapshotCounters();
  result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  check(result.added === 1 && delta('semantic.sourceRowsVisited', before) === 1
    && delta('semantic.embedTextCount', before) === 1,
  'same-turn append advances the source offset and processes exactly one new row');
  check(delta('semantic.idbPutCount', before) === 2 && idb.stats().clearCalls === 0,
    'one new vector writes only that vector plus cursor metadata');

  before = snapshotCounters();
  result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  check(result.added === 0 && delta('semantic.sourceRowsVisited', before) === 0
    && delta('semantic.embedTextCount', before) === 0
    && delta('semantic.existingIdVisits', before) === 0
    && delta('semantic.idbPutCount', before) === 0,
  'rebuilding without appends performs zero source, existing-id, embedding or IDB write work');

  const query = '固定历史记录文本内容';
  const queryVec = embedding(query);
  const oracle = context.__semanticState.index.map((item, order) => ({
    id: item.sourceId,
    sim: item.vec[0] * queryVec[0] + item.vec[1] * queryVec[1],
    order
  })).filter((row) => row.sim >= -1)
    .sort((a, b) => (b.sim - a.sim) || (a.order - b.order)).slice(0, 7).map((row) => row.id);
  const hits = await context.SemanticRecall.search(query, { topK: 7, threshold: -1 });
  check(JSON.stringify(hits.map((hit) => hit.id)) === JSON.stringify(oracle),
    'fixed-size top-K heap returns the same stable order as the full-sort oracle');

  const oldIndexSize = context.__semanticState.index.length;
  context.GM = {
    running: true,
    turn: 1,
    _campaignId: 'camp-semantic-A',
    _timelineId: 'tml_semantic_B_12345678',
    shijiHistory: [{ id: 'world-b-only', turn: 1, shilu: '世界乙唯一且足够长的历史记录文本内容。' }],
    _foreshadows: [], _chronicleTracks: [], _memTables: { eventHistory: { rows: [] } }
  };
  result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  check(result.added === 1 && context.__semanticState.index.length === 1 && oldIndexSize > 1,
    'timeline switch invalidates in-memory cursor/index and never reuses world A vectors');

  context.GM = {
    running: true,
    turn: 200,
    _campaignId: 'camp-semantic-sliding',
    _timelineId: 'tml_semantic_sliding_12345678',
    shijiHistory: Array.from({ length: 200 }, (_, i) => ({
      id: 'sliding-' + i,
      turn: i + 1,
      shilu: '滑窗史记第' + i + '条足够长的固定历史记录文本内容。'
    })),
    _foreshadows: [], _chronicleTracks: [], _memTables: { eventHistory: { rows: [] } }
  };
  result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  check(result.added === 200, 'sliding-window fixture indexes the initial 200 records');
  let slidingAdded = 0;
  let slidingVisited = 0;
  for (let step = 200; step < 300; step += 1) {
    context.GM.turn = step + 1;
    context.GM.shijiHistory.push({
      id: 'sliding-' + step,
      turn: step + 1,
      shilu: '滑窗史记第' + step + '条足够长的固定历史记录文本内容。'
    });
    context.GM.shijiHistory.splice(0, context.GM.shijiHistory.length - 200);
    result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
    slidingAdded += result.added;
    slidingVisited += result.visited;
  }
  check(slidingAdded === 100 && slidingVisited === 100 && context.__semanticState.index.length === 300,
    '200-row production sliding window indexes each of 100 later records exactly once');

  context.GM = {
    running: true,
    turn: 200,
    _campaignId: 'camp-semantic-fingerprint',
    _timelineId: 'tml_semantic_fingerprint_12345678',
    shijiHistory: Array.from({ length: 200 }, (_, i) => ({
      turn: i + 1,
      shilu: '无显式编号史记第' + i + '条足够长的固定历史记录文本内容。'
    })),
    _foreshadows: [], _chronicleTracks: [], _memTables: { eventHistory: { rows: [] } }
  };
  result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  context.GM.shijiHistory.push({ turn: 201, shilu: '无显式编号史记新增一条足够长的固定历史记录文本内容。' });
  context.GM.shijiHistory.splice(0, 1);
  result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  check(result.added === 1 && result.visited === 1,
    'content fingerprint keeps no-id sliding rows stable without offset-derived identities');

  context.GM = {
    running: true,
    turn: 1000,
    _campaignId: 'camp-semantic-scale',
    _timelineId: 'tml_semantic_scale_12345678',
    shijiHistory: Array.from({ length: 10000 }, (_, i) => ({
      id: 'scale-' + i,
      turn: Math.floor(i / 10),
      shilu: '规模基准第' + i + '条足够长且确定的历史记录文本内容。'
    })),
    _foreshadows: [], _chronicleTracks: [], _memTables: { eventHistory: { rows: [] } }
  };
  before = snapshotCounters();
  result = await context.SemanticRecall.buildIndex({ batchSize: 32 });
  check(result.added === 10000 && delta('semantic.sourceRowsVisited', before) === 10000
    && delta('semantic.embedTextCount', before) === 10000
    && delta('semantic.embedRpcCount', before) === Math.ceil(10000 / 32)
    && idb.stats().clearCalls === 0,
  '10000-row long-run fixture remains batched, append-only and exactly linear in new rows');

  console.log('[smoke-semantic-true-incremental] pass=' + passed);
}()).catch((error) => {
  console.error(error);
  process.exit(1);
});
