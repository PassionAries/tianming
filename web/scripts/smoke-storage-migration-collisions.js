#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'tm-storage.js'), 'utf8');
const bootAt = source.lastIndexOf('\nTM_SaveDB.open().then');
let assertions = 0;

function check(condition, message) {
  if (!condition) throw new Error('[smoke-storage-migration-collisions] ' + message);
  assertions += 1;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeLocalStorage() {
  const rows = new Map();
  return {
    get length() { return rows.size; },
    key(index) { return Array.from(rows.keys())[index] || null; },
    getItem(key) { return rows.has(String(key)) ? rows.get(String(key)) : null; },
    setItem(key, value) { rows.set(String(key), String(value)); },
    removeItem(key) { rows.delete(String(key)); }
  };
}

function makeFakeIndexedDB(oldRecords) {
  const state = {
    currentVersion: 0,
    currentStores: new Map(),
    oldStores: new Map([['saves', new Map((oldRecords || []).map(record => [String(record.id), clone(record)]))]]),
    currentConnections: [],
    oldDeleted: false,
    openOrder: []
  };

  function makeConnection(kind) {
    const stores = kind === 'current' ? state.currentStores : state.oldStores;
    const connection = {
      kind,
      closed: false,
      onversionchange: null,
      objectStoreNames: { contains(name) { return stores.has(name); } },
      close() { connection.closed = true; },
      createObjectStore(name) {
        stores.set(name, new Map());
        return objectStore(name);
      },
      transaction() {
        const tx = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete({ target: tx }); }, 0);
        return tx;
      }
    };

    function objectStore(name) {
      if (!stores.has(name)) throw new Error(kind + ' missing store ' + name);
      const rows = stores.get(name);
      return {
        createIndex() {},
        put(value) { rows.set(String(value.id), clone(value)); },
        delete(id) { rows.delete(String(id)); },
        get(id) {
          const request = {};
          setTimeout(() => {
            request.result = clone(rows.get(String(id)));
            if (request.onsuccess) request.onsuccess({ target: request });
          }, 0);
          return request;
        },
        getAll() {
          const request = {};
          setTimeout(() => {
            request.result = Array.from(rows.values()).map(clone);
            if (request.onsuccess) request.onsuccess({ target: request });
          }, 0);
          return request;
        },
        openCursor() {
          const request = {};
          const values = Array.from(rows.values()).map(clone);
          let index = 0;
          function next() {
            setTimeout(() => {
              request.result = index < values.length
                ? { value: values[index++], continue: next }
                : null;
              if (request.onsuccess) request.onsuccess({ target: request });
            }, 0);
          }
          next();
          return request;
        }
      };
    }

    return connection;
  }

  return {
    state,
    open(name, version) {
      const request = {};
      state.openOrder.push(name);
      setTimeout(() => {
        if (name === 'tianming_saves') {
          const oldConnection = makeConnection('old');
          request.result = oldConnection;
          if (request.onsuccess) request.onsuccess({ target: request });
          return;
        }
        const currentConnection = makeConnection('current');
        state.currentConnections.push(currentConnection);
        const requestedVersion = Number(version) || state.currentVersion || 1;
        if (requestedVersion > state.currentVersion && request.onupgradeneeded) {
          const upgradeTx = currentConnection.transaction([], 'versionchange');
          request.onupgradeneeded({
            oldVersion: state.currentVersion,
            target: { result: currentConnection, transaction: upgradeTx }
          });
          state.currentVersion = requestedVersion;
        }
        request.result = currentConnection;
        setTimeout(() => { if (request.onsuccess) request.onsuccess({ target: request }); }, 0);
      }, 0);
      return request;
    },
    deleteDatabase(name) {
      const request = {};
      setTimeout(() => {
        if (name === 'tianming_saves') {
          state.oldDeleted = true;
          state.oldStores.clear();
        }
        if (request.onsuccess) request.onsuccess({ target: request });
      }, 0);
      return request;
    }
  };
}

(async function main() {
  const localStorage = makeLocalStorage();
  localStorage.setItem('tm_save_0', JSON.stringify({
    name: '旧 localStorage 档',
    timestamp: 100,
    gameState: { GM: { turn: 1, source: 'local-storage' }, P: { scenario: 'local' } }
  }));
  localStorage.setItem('tm_save_1', JSON.stringify({
    name: '决战前备份',
    timestamp: 300,
    gameState: { GM: { turn: 3, source: 'same-world' }, P: { scenario: 'same' } }
  }));
  const indexedDB = makeFakeIndexedDB([{
    id: 'slot_0',
    name: '旧 IndexedDB 档',
    type: 'manual',
    timestamp: 200,
    turn: 2,
    gameState: JSON.stringify({ GM: { turn: 2, source: 'old-db' }, P: { scenario: 'old-db' } }),
    _compressed: false
  }, {
    id: 'slot_1',
    name: '自动迁移备份',
    type: 'manual',
    timestamp: 301,
    turn: 3,
    gameState: JSON.stringify({ GM: { turn: 3, source: 'same-world' }, P: { scenario: 'same' } }),
    _compressed: false
  }]);
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Promise, Math, Date, JSON, Object, Array, Number, String, Boolean, Error,
    Blob, Response, CompressionStream, DecompressionStream, TextDecoder,
    setTimeout, clearTimeout, localStorage, indexedDB,
    navigator: { storage: null }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bootAt > 0 ? source.slice(0, bootAt) : source, context, { filename: 'tm-storage.js' });

  await context.TM_SaveDB.open();
  const migrations = await Promise.all([
    context.TM_SaveDB.migrateFromLocalStorage(),
    context.TM_SaveDB.migrateFromOldDB()
  ]);
  check(migrations[0] === 2 && migrations[1] === 2, 'both legacy sources report every handled save');

  const listed = await context.TM_SaveDB.list();
  const ids = listed.map(record => record.id).sort();
  check(ids.length === 4 && ids.indexOf('slot_0') >= 0 && ids.indexOf('slot_0-migrated-old-db') >= 0 &&
    ids.indexOf('slot_1') >= 0 && ids.indexOf('slot_1-migrated-old-db') >= 0,
    'same-id legacy saves receive deterministic distinct target ids');

  const localSave = await context.TM_SaveDB.load('slot_0');
  const oldDbSave = await context.TM_SaveDB.load('slot_0-migrated-old-db');
  check(localSave && localSave.gameState.GM.source === 'local-storage' && localSave.gameState.GM.turn === 1,
    'localStorage source survives migration without being overwritten');
  check(oldDbSave && oldDbSave.gameState.GM.source === 'old-db' && oldDbSave.gameState.GM.turn === 2,
    'old IndexedDB source survives the id collision under its renamed id');
  const distinctMetadataCopy = await context.TM_SaveDB.load('slot_1-migrated-old-db');
  check(distinctMetadataCopy && distinctMetadataCopy.name === '自动迁移备份',
    'same world payload with different user-visible metadata is preserved as a separate save');
  check(localStorage.getItem('tm_save_0') === null && localStorage.getItem('tm_save_1') === null && indexedDB.state.oldDeleted === true,
    'legacy sources are removed only after target writes and read-back verification succeed');
  check(indexedDB.state.openOrder.join('>') === 'tianming_db>tianming_saves',
    'concurrent public migration calls serialize localStorage before the old database');

  console.log('[smoke-storage-migration-collisions] PASS assertions=' + assertions);
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
