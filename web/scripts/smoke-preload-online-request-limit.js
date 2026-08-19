#!/usr/bin/env node
'use strict';

const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
let exposed = null;
const invokes = [];
let assertions = 0;

function check(value, label) {
  if (!value) throw new Error('[smoke-preload-online-request-limit] ' + label);
  assertions += 1;
}

const electronStub = {
  contextBridge: { exposeInMainWorld(_name, api) { exposed = api; } },
  ipcRenderer: {
    sendSync() { return { success: true, token: 'test-session' }; },
    invoke(channel, payload) { invokes.push({ channel, payload }); return Promise.resolve({ success: true }); },
    on() {}
  }
};

const originalLoad = Module._load;
Module._load = function(request) {
  if (request === 'electron') return electronStub;
  return originalLoad.apply(this, arguments);
};

(async function main() {
  require(path.join(ROOT, 'preload-impl.js'));
  check(exposed && typeof exposed.onlineRequest === 'function', 'preload exposes the bounded online request bridge');

  await exposed.onlineRequest('POST', 'feed/post', { text: 'small' });
  check(invokes.length === 1 && invokes[0].channel === 'online-request', 'small JSON request crosses IPC');

  let rejected = null;
  try { await exposed.onlineRequest('POST', 'feed/post', { text: 'x'.repeat(2 * 1024 * 1024) }); }
  catch (error) { rejected = error; }
  check(rejected && /1MB/.test(rejected.message) && invokes.length === 1, 'ordinary oversized JSON is rejected before ipcRenderer.invoke');

  await exposed.onlineRequest('POST', 'workshop/upload', { text: 'x'.repeat(2 * 1024 * 1024) });
  check(invokes.length === 2, 'explicit large-payload route accepts a request below 4MB');

  rejected = null;
  try { await exposed.onlineRequest('POST', 'workshop/upload', { text: 'x'.repeat(5 * 1024 * 1024) }); }
  catch (error) { rejected = error; }
  check(rejected && /4MB/.test(rejected.message) && invokes.length === 2, '10MB-class payloads cannot cross the preload IPC boundary');

  console.log('[smoke-preload-online-request-limit] PASS assertions=' + assertions);
})().finally(() => {
  Module._load = originalLoad;
}).catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
