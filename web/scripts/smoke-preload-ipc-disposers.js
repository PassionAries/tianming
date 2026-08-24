#!/usr/bin/env node
'use strict';

const EventEmitter = require('events');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const emitter = new EventEmitter();
let exposed = null;
let assertions = 0;

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-preload-ipc-disposers] ' + message);
}

const ipcRenderer = {
  sendSync() { return { success: true, token: 'ipc-disposer-test' }; },
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

try {
  require(path.join(ROOT, 'preload-impl.js'));
  check(exposed && exposed.isDesktop === true, 'preload bridge is exposed through the real implementation');
  exercise('onUpdateStatus', 'update-status');
  exercise('onHotUpdateStatus', 'hot-update-status');
  exercise('onMenuAction', 'menu-action');
  exercise('onImportData', 'import-project-data');
  console.log('[smoke-preload-ipc-disposers] PASS assertions=' + assertions);
} catch (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
} finally {
  Module._load = originalLoad;
}
