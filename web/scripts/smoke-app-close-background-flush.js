#!/usr/bin/env node
'use strict';

const EventEmitter = require('events');
const Module = require('module');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const eventHandlers = new Map();
let assertions = 0;

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-app-close-background-flush] ' + message);
}

process.env.TIANMING_TEST_EXPORTS = '1';
const electronStub = {
  app: {
    getPath: () => path.join(os.tmpdir(), 'tm-close-flush-user-data'),
    getVersion: () => '1.3.4.11',
    getAppPath: () => ROOT,
    isPackaged: false,
    whenReady: () => new Promise(() => {}),
    on() {},
    once() {},
    quit() {},
    relaunch() {},
    exit() {}
  },
  BrowserWindow: function BrowserWindow() {},
  ipcMain: {
    handle() {},
    on(channel, listener) { eventHandlers.set(channel, listener); }
  },
  dialog: {},
  shell: {},
  Menu: {},
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  net: { fetch: (url, init) => fetch(url, init) },
  session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }
};
electronStub.BrowserWindow.getAllWindows = () => [];

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  if (request === 'electron-updater') {
    return { autoUpdater: { on() {}, setFeedURL() {}, checkForUpdates: async () => null, downloadUpdate: async () => [], quitAndInstall() {} } };
  }
  return originalLoad.apply(this, arguments);
};

function makeWindow() {
  const webContents = new EventEmitter();
  const sent = [];
  const frame = {
    url: pathToFileURL(path.join(ROOT, 'web', 'index.html')).href,
    parent: null
  };
  webContents.mainFrame = frame;
  webContents.isDestroyed = () => false;
  webContents.send = (channel, payload) => sent.push({ channel, payload });
  return {
    sent,
    frame,
    webContents,
    win: { isDestroyed: () => false, webContents }
  };
}

async function main() {
  const T = require(path.join(ROOT, 'main-impl.js')).__test;
  check(T && typeof T.requestRendererCloseFlush === 'function', 'main exports the production close-flush request helper in test mode');
  check(eventHandlers.has('app-close-flush-complete'), 'main registers one trusted close-flush acknowledgement channel');
  const acknowledge = eventHandlers.get('app-close-flush-complete');

  const success = makeWindow();
  const successPromise = T.requestRendererCloseFlush(success.win, 'renderer-test', 1000);
  check(success.sent.length === 1 && success.sent[0].channel === 'app-close-flush-request', 'main sends one close-flush request');
  const successId = success.sent[0].payload.requestId;
  acknowledge({ sender: success.webContents, senderFrame: success.frame }, {
    requestId: successId,
    ok: true,
    reason: 'queue-drained'
  });
  const successResult = await successPromise;
  check(successResult.ok === true && successResult.reason === 'queue-drained', 'matching renderer acknowledgement permits close');
  check(success.webContents.listenerCount('destroyed') === 0, 'success acknowledgement removes the renderer lifecycle listener');

  const failure = makeWindow();
  const failurePromise = T.requestRendererCloseFlush(failure.win, 'renderer-test', 1000);
  acknowledge({ sender: failure.webContents, senderFrame: failure.frame }, {
    requestId: failure.sent[0].payload.requestId,
    ok: false,
    code: 'background-save-flush-failed',
    reason: 'injected write failure'
  });
  const failureResult = await failurePromise;
  check(failureResult.ok === false && failureResult.code === 'background-save-flush-failed', 'renderer save failure cancels close with a structured code');

  const destroyed = makeWindow();
  const destroyedPromise = T.requestRendererCloseFlush(destroyed.win, 'window-close', 1000);
  destroyed.webContents.emit('destroyed');
  const destroyedResult = await destroyedPromise;
  check(destroyedResult.ok === false && destroyedResult.code === 'renderer-destroyed-before-flush', 'renderer destruction cannot be mistaken for a successful flush');

  const timeout = makeWindow();
  const timeoutResult = await T.requestRendererCloseFlush(timeout.win, 'window-close', 10);
  check(timeoutResult.ok === false && timeoutResult.code === 'background-save-flush-timeout', 'missing acknowledgement fails closed after the bounded timeout');
  check(timeout.webContents.listenerCount('destroyed') === 0, 'timeout also removes the renderer lifecycle listener');

  const unavailable = await T.requestRendererCloseFlush(null, 'window-close', 10);
  check(unavailable.ok === true && unavailable.skipped === true, 'already unavailable renderer has no pending queue to flush');

  console.log('[smoke-app-close-background-flush] PASS assertions=' + assertions);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});
