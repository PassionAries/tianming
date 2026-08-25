#!/usr/bin/env node
'use strict';

const EventEmitter = require('events');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const emitter = new EventEmitter();
let exposed = null;
let assertions = 0;
const sent = [];

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-preload-ipc-disposers] ' + message);
}

const ipcRenderer = {
  sendSync() { return { success: true, token: 'ipc-disposer-test' }; },
  send(channel, payload) { sent.push({ channel, payload }); },
  invoke() { return Promise.resolve({ success: true }); },
  on(channel, listener) { emitter.on(channel, listener); return ipcRenderer; },
  removeListener(channel, listener) { emitter.removeListener(channel, listener); return ipcRenderer; }
};
const electronStub = {
  contextBridge: { exposeInMainWorld(_name, api) { exposed = api; } },
  ipcRenderer
};
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return originalLoad.apply(this, arguments);
};

function exercise(apiName, channel) {
  let callsA = 0;
  let callsB = 0;
  let lastPayload = null;
  const disposeA = exposed[apiName](function (payload) {
    callsA += 1;
    lastPayload = payload;
  });
  check(typeof disposeA === 'function', apiName + ' returns a disposer');
  emitter.emit(channel, { sender: 'main' }, { step: 'A' });
  check(callsA === 1 && lastPayload.step === 'A', apiName + ' forwards payload once');
  check(disposeA() === true && disposeA() === false, apiName + ' disposer is idempotent');

  const disposeB = exposed[apiName](function (payload) {
    callsB += 1;
    lastPayload = payload;
  });
  emitter.emit(channel, { sender: 'main' }, { step: 'B' });
  check(callsA === 1, apiName + ' never invokes disposed callback again');
  check(callsB === 1 && lastPayload.step === 'B', apiName + ' invokes replacement callback exactly once');
  disposeB();
  check(emitter.listenerCount(channel) === 0, apiName + ' removes its exact listener');
}

async function exerciseCloseFlush() {
  let calls = 0;
  const dispose = exposed.onAppCloseFlushRequest(async function (payload) {
    calls += 1;
    check(payload.reason === 'renderer-test', 'close flush bridge exposes only the close reason');
    return { ok: true, reason: 'queue-drained' };
  });
  emitter.emit('app-close-flush-request', { sender: 'main' }, { requestId: 'close-1', reason: 'renderer-test' });
  await new Promise(resolve => setImmediate(resolve));
  check(calls === 1, 'close flush callback runs once');
  check(sent.length === 1 && sent[0].channel === 'app-close-flush-complete'
    && sent[0].payload.requestId === 'close-1' && sent[0].payload.ok === true,
  'close flush success is acknowledged with the same request id');
  check(dispose() === true && dispose() === false, 'close flush disposer is idempotent');
  check(emitter.listenerCount('app-close-flush-request') === 0, 'close flush listener is removed exactly');

  const disposeFailure = exposed.onAppCloseFlushRequest(function () {
    throw new Error('injected close flush failure');
  });
  emitter.emit('app-close-flush-request', { sender: 'main' }, { requestId: 'close-2', reason: 'renderer-test' });
  await new Promise(resolve => setImmediate(resolve));
  check(sent.length === 2 && sent[1].payload.ok === false
    && sent[1].payload.code === 'background-save-flush-exception',
  'close flush exceptions return a structured failure acknowledgement');
  disposeFailure();
}

async function main() {
  require(path.join(ROOT, 'preload-impl.js'));
  check(exposed && exposed.isDesktop === true, 'preload bridge is exposed through the real implementation');
  exercise('onUpdateStatus', 'update-status');
  exercise('onHotUpdateStatus', 'hot-update-status');
  exercise('onMenuAction', 'menu-action');
  exercise('onImportData', 'import-project-data');
  await exerciseCloseFlush();
  console.log('[smoke-preload-ipc-disposers] PASS assertions=' + assertions);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});
