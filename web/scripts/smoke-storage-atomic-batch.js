#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const fullSource = fs.readFileSync(path.join(ROOT, 'tm-storage.js'), 'utf8');
const bootAt = fullSource.lastIndexOf('\nTM_SaveDB.open().then');
const source = bootAt > 0 ? fullSource.slice(0, bootAt) : fullSource;
let assertions = 0;
function check(value, message) {
  if (!value) throw new Error('[smoke-storage-atomic-batch] ' + message);
  assertions++;
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function makeLocalStorage(initial, failKey, failureName) {
  const rows = new Map(Object.entries(initial || {}).map(([k, v]) => [k, String(v)]));
  let failed = false;
  return {
    rows,
    get length() { return rows.size; },
    key(i) { return Array.from(rows.keys())[i] || null; },
    getItem(k) { return rows.has(String(k)) ? rows.get(String(k)) : null; },
    setItem(k, v) {
      if (!failed && failKey && String(k) === failKey) {
        failed = true;
        const error = new Error('injected-local-write-failure');
        error.name = failureName || 'Error';
        throw error;
      }
      rows.set(String(k), String(v));
    },
    removeItem(k) { rows.delete(String(k)); }
  };
}

function makeIndexedDB(initial, failPutAt, failureName) {
  const stores = new Map([
    ['saves', new Map(Object.entries(initial && initial.saves || {}).map(([k, v]) => [k, clone(v)]))],
    ['saveMetadata', new Map(Object.entries(initial && initial.saveMetadata || {}).map(([k, v]) => [k, clone(v)]))],
    ['projects', new Map()]
  ]);
  const stats = { readwriteTransactions: 0, puts: 0 };
  const db = {
    objectStoreNames: { contains(name) { return stores.has(name); } },
    close() {},
    transaction(names, mode) {
      if (mode === 'readwrite') stats.readwriteTransactions++;
      const pending = [];
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = name => ({
        put(value) { stats.puts++; pending.push({ name, value: clone(value), putNo: stats.puts }); },
        delete(id) { pending.push({ name, deleteId: String(id) }); },
        get(id) {
          const req = {};
          setTimeout(() => { req.result = clone(stores.get(name).get(String(id))); if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
          return req;
        },
        getAll() {
          const req = {};
          setTimeout(() => { req.result = Array.from(stores.get(name).values()).map(clone); if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
          return req;
        }
      });
      setTimeout(() => {
        if (failPutAt && pending.some(op => op.putNo === failPutAt)) {
          tx.error = new Error('injected-idb-write-failure');
          tx.error.name = failureName || 'Error';
          if (tx.onabort) tx.onabort({ target: { error: tx.error } });
          return;
        }
        pending.forEach(op => {
          if (op.deleteId != null) stores.get(op.name).delete(op.deleteId);
          else stores.get(op.name).set(String(op.value.id), clone(op.value));
        });
        if (tx.oncomplete) tx.oncomplete({ target: tx });
      }, 0);
      return tx;
    }
  };
  return {
    stores, stats,
    open() { const req = {}; setTimeout(() => req.onsuccess && req.onsuccess({ target: { result: db } }), 0); return req; }
  };
}

function makeContext(indexedDB, localStorage) {
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Promise, Math, Date, JSON, Object, Array, Number, String, Boolean, Error,
    Blob, Response, CompressionStream: undefined, DecompressionStream: undefined, TextDecoder,
    setTimeout, clearTimeout, localStorage, indexedDB,
    navigator: { storage: null }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'tm-storage.js' });
  return context;
}

(async function main() {
  const idb = makeIndexedDB();
  const ctx = makeContext(idb, makeLocalStorage());
  await ctx.TM_SaveDB.open();
  const state = { GM: { turn: 50 }, P: {} };
  const ok = await ctx.TM_SaveDB.saveManyAtomic([
    { id: 'autosave', gameState: state, meta: { type: 'auto', turn: 50 } },
    { id: 'slot_0', gameState: state, meta: { type: 'auto', turn: 50 } }
  ]);
  check(ok === true && idb.stats.readwriteTransactions === 1, 'both canonical slots use one IndexedDB readwrite transaction');
  check(idb.stores.get('saves').size === 2 && idb.stores.get('saveMetadata').size === 2, 'payloads and metadata commit together');
  let duplicateRejected = false;
  try {
    await ctx.TM_SaveDB.saveManyAtomic([
      { id: 'slot_0', gameState: state },
      { id: 'slot_0', gameState: state }
    ]);
  } catch (_) { duplicateRejected = true; }
  check(duplicateRejected, 'duplicate ids are rejected before opening a batch transaction');

  const oldAuto = { id: 'autosave', gameState: 'old-auto' };
  const oldSlot = { id: 'slot_0', gameState: 'old-slot' };
  const failingIdb = makeIndexedDB({ saves: { autosave: oldAuto, slot_0: oldSlot }, saveMetadata: {
    autosave: { id: 'autosave', turn: 49 }, slot_0: { id: 'slot_0', turn: 49 }
  } }, 3);
  const failingCtx = makeContext(failingIdb, makeLocalStorage());
  await failingCtx.TM_SaveDB.open();
  let rejected = false;
  try {
    await failingCtx.TM_SaveDB.saveManyAtomic([
      { id: 'autosave', gameState: state, meta: { turn: 50 } },
      { id: 'slot_0', gameState: state, meta: { turn: 50 } }
    ]);
  } catch (_) { rejected = true; }
  check(rejected && failingIdb.stores.get('saves').get('autosave').gameState === 'old-auto' && failingIdb.stores.get('saves').get('slot_0').gameState === 'old-slot',
    'an injected second-slot failure aborts the complete IndexedDB batch');

  const quotaInitial = {
    saves: {
      autosave: { id: 'autosave', type: 'auto', gameState: 'old-auto' },
      slot_0: { id: 'slot_0', type: 'auto', gameState: 'old-slot' },
      older_auto_1: { id: 'older_auto_1', type: 'auto', gameState: 'disposable' }
    },
    saveMetadata: {
      autosave: { id: 'autosave', type: 'auto', turn: 49, timestamp: 20 },
      slot_0: { id: 'slot_0', type: 'auto', turn: 49, timestamp: 20 },
      older_auto_1: { id: 'older_auto_1', type: 'auto', turn: 12, timestamp: 1 }
    }
  };
  const quotaIdb = makeIndexedDB(quotaInitial, 1, 'QuotaExceededError');
  const quotaCtx = makeContext(quotaIdb, makeLocalStorage());
  await quotaCtx.TM_SaveDB.open();
  const quotaSaved = await quotaCtx.TM_SaveDB.saveManyAtomic([
    { id: 'autosave', gameState: state, meta: { type: 'auto', turn: 50 } },
    { id: 'slot_0', gameState: state, meta: { type: 'auto', turn: 50 } }
  ]);
  check(quotaSaved === true && !quotaIdb.stores.get('saves').has('older_auto_1'),
    'quota failure aborts the batch, deletes one disposable old auto save, then retries once');
  check(JSON.parse(quotaIdb.stores.get('saves').get('autosave').gameState).GM.turn === 50
    && JSON.parse(quotaIdb.stores.get('saves').get('slot_0').gameState).GM.turn === 50,
  'quota recovery still advances both canonical slots together');

  const noDisposableIdb = makeIndexedDB({ saves: { autosave: oldAuto, slot_0: oldSlot }, saveMetadata: {
    autosave: { id: 'autosave', type: 'auto', turn: 49, timestamp: 1 },
    slot_0: { id: 'slot_0', type: 'auto', turn: 49, timestamp: 1 }
  } }, 1, 'QuotaExceededError');
  const noDisposableCtx = makeContext(noDisposableIdb, makeLocalStorage());
  await noDisposableCtx.TM_SaveDB.open();
  const noDisposableSaved = await noDisposableCtx.TM_SaveDB.saveManyAtomic([
    { id: 'autosave', gameState: state, meta: { type: 'auto', turn: 50 } },
    { id: 'slot_0', gameState: state, meta: { type: 'auto', turn: 50 } }
  ]);
  check(noDisposableSaved === false
    && noDisposableIdb.stores.get('saves').get('autosave').gameState === 'old-auto'
    && noDisposableIdb.stores.get('saves').get('slot_0').gameState === 'old-slot',
  'quota recovery never deletes either canonical slot when no disposable auto save exists');

  const marker = { transactionId: 'turn-marker-12345678', campaignId: 'campaign-1', turn: 50 };
  const markerState = { GM: { turn: 51, _pendingTurnDataPublish: marker }, P: {} };
  const markerIdb = makeIndexedDB({ saves: {
    autosave: { id: 'autosave', type: 'auto', turn: 51, gameState: JSON.stringify(markerState), _compressed: false },
    slot_0: { id: 'slot_0', type: 'auto', turn: 51, gameState: JSON.stringify(markerState), _compressed: false }
  }, saveMetadata: {
    autosave: { id: 'autosave', type: 'auto', turn: 51 }, slot_0: { id: 'slot_0', type: 'auto', turn: 51 }
  } });
  const markerCtx = makeContext(markerIdb, makeLocalStorage());
  await markerCtx.TM_SaveDB.open();
  const markerCleared = await markerCtx.TM_SaveDB.clearPendingTurnDataPublishAtomic(['autosave', 'slot_0'], marker.transactionId);
  const clearedAuto = await markerCtx.TM_SaveDB.load('autosave');
  const clearedSlot = await markerCtx.TM_SaveDB.load('slot_0');
  check(markerCleared === true && !clearedAuto.gameState.GM._pendingTurnDataPublish && !clearedSlot.gameState.GM._pendingTurnDataPublish,
    'successful turn-data publish checkpoint clears both canonical markers atomically');

  const keys = {
    auto: 'tm_idb_saves_autosave', autoMeta: 'tm_idb_saveMetadata_autosave',
    slot: 'tm_idb_saves_slot_0', slotMeta: 'tm_idb_saveMetadata_slot_0'
  };
  const initial = { [keys.auto]: 'old-auto', [keys.autoMeta]: 'old-auto-meta', [keys.slot]: 'old-slot', [keys.slotMeta]: 'old-slot-meta' };
  const local = makeLocalStorage(initial, keys.slotMeta);
  const localCtx = makeContext(null, local);
  await localCtx.TM_SaveDB.open();
  rejected = false;
  try {
    await localCtx.TM_SaveDB.saveManyAtomic([
      { id: 'autosave', gameState: state, meta: { turn: 50 } },
      { id: 'slot_0', gameState: state, meta: { turn: 50 } }
    ]);
  } catch (_) { rejected = true; }
  check(rejected && Object.entries(initial).every(([k, v]) => local.getItem(k) === v), 'localStorage failure restores all four prior values');
  check(local.getItem('tm_save_batch_journal_v1') === null, 'successful rollback removes the local batch journal');

  const localQuotaInitial = {
    [keys.auto]: JSON.stringify({ id: 'autosave', type: 'auto', name: 'old auto', timestamp: 20, turn: 49, gameState: JSON.stringify({ GM: { turn: 49 }, P: {} }) }),
    [keys.autoMeta]: JSON.stringify({ id: 'autosave', type: 'auto', name: 'old auto', turn: 49, timestamp: 20 }),
    [keys.slot]: JSON.stringify({ id: 'slot_0', type: 'auto', name: 'old slot', timestamp: 20, turn: 49, gameState: JSON.stringify({ GM: { turn: 49 }, P: {} }) }),
    [keys.slotMeta]: JSON.stringify({ id: 'slot_0', type: 'auto', name: 'old slot', turn: 49, timestamp: 20 }),
    tm_idb_saves_older_auto_1: JSON.stringify({ id: 'older_auto_1', type: 'auto', gameState: '{}' }),
    tm_idb_saveMetadata_older_auto_1: JSON.stringify({ id: 'older_auto_1', type: 'auto', turn: 12, timestamp: 1 })
  };
  const localQuota = makeLocalStorage(localQuotaInitial, keys.slotMeta, 'QuotaExceededError');
  const localQuotaCtx = makeContext(null, localQuota);
  await localQuotaCtx.TM_SaveDB.open();
  const localQuotaSaved = await localQuotaCtx.TM_SaveDB.saveManyAtomic([
    { id: 'autosave', gameState: state, meta: { type: 'auto', turn: 50 } },
    { id: 'slot_0', gameState: state, meta: { type: 'auto', turn: 50 } }
  ]);
  check(localQuotaSaved === true
    && localQuota.getItem('tm_idb_saves_older_auto_1') === null
    && localQuota.getItem('tm_idb_saveMetadata_older_auto_1') === null,
  'localStorage quota recovery restores the batch, removes one disposable auto save, and retries once');
  check(JSON.parse(JSON.parse(localQuota.getItem(keys.auto)).gameState).GM.turn === 50
    && JSON.parse(JSON.parse(localQuota.getItem(keys.slot)).gameState).GM.turn === 50,
  'localStorage quota recovery still advances both canonical slots together');

  const preparedItems = Object.entries(initial).map(([key, previous]) => ({ key, previous }));
  const crashLocal = makeLocalStorage(Object.assign({}, initial, {
    [keys.auto]: 'new-auto',
    tm_save_batch_journal_v1: JSON.stringify({ version: 1, phase: 'prepared', items: preparedItems })
  }));
  const crashCtx = makeContext(null, crashLocal);
  await crashCtx.TM_SaveDB.open();
  check(crashLocal.getItem(keys.auto) === 'old-auto' && crashLocal.getItem('tm_save_batch_journal_v1') === null,
    'open recovers a crash left in prepared phase');

  const committedLocal = makeLocalStorage(Object.assign({}, initial, {
    [keys.auto]: 'new-auto',
    [keys.autoMeta]: 'new-auto-meta',
    [keys.slot]: 'new-slot',
    [keys.slotMeta]: 'new-slot-meta',
    tm_save_batch_journal_v1: JSON.stringify({ version: 1, phase: 'committed', items: preparedItems })
  }));
  const committedCtx = makeContext(null, committedLocal);
  await committedCtx.TM_SaveDB.open();
  check(committedLocal.getItem(keys.auto) === 'new-auto' && committedLocal.getItem(keys.slot) === 'new-slot' &&
    committedLocal.getItem('tm_save_batch_journal_v1') === null,
  'open keeps the new batch when a crash occurs after the committed journal marker');

  const corruptLocal = makeLocalStorage({ tm_save_batch_journal_v1: '{broken-json' });
  const corruptCtx = makeContext(null, corruptLocal);
  await corruptCtx.TM_SaveDB.open();
  check(corruptLocal.getItem('tm_save_batch_journal_v1') === null,
    'a corrupt journal is discarded instead of permanently blocking storage startup');

  console.log('[smoke-storage-atomic-batch] PASS assertions=' + assertions);
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
