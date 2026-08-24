#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'tm-benji.js'), 'utf8');
let assertions = 0;

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-benji-storage-failures] ' + message);
}

function makeBenjiWorld() {
  return {
    sid: 'storage-fixture',
    turn: 12,
    _benji: {
      composedTurn: 12,
      sections: [{ fromTurn: 1, toTurn: 12, text: '本纪正文', isLast: true }]
    }
  };
}

function load(storage, extras) {
  const context = Object.assign({
    console: { log() {}, warn() {}, error() {} },
    Math, JSON, String, Number, Array, Object, Promise, Date,
    localStorage: storage,
    getTSText(turn) { return '第' + turn + '回合'; }
  }, extras || {});
  context.window = context;
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'tm-benji.js' });
  return context;
}

function baseStorage(raw) {
  const values = Object.create(null);
  if (raw !== undefined) values.tm_playHistory = raw;
  return {
    values,
    getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem(key, value) { values[key] = String(value); }
  };
}

async function main() {
  let storage = baseStorage(JSON.stringify([{ sid: 'storage-fixture', turns: 12 }]));
  let context = load(storage);
  let result = context.TM.Benji.attachToPlayHistory(makeBenjiWorld());
  check(result.ok === true, 'normal play-history attachment succeeds');
  check(JSON.parse(storage.values.tm_playHistory)[0].benji.includes('本纪正文'), 'normal attachment writes the composed benji');

  context = load({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('unreachable'); }
  });
  result = context.TM.Benji.attachToPlayHistory(makeBenjiWorld());
  check(result.ok === false && result.reason === 'storage-unavailable', 'getItem failure is reported explicitly');

  storage = baseStorage('{bad-json');
  context = load(storage);
  result = context.TM.Benji.attachToPlayHistory(makeBenjiWorld());
  check(result.ok === false && result.reason === 'history-json-corrupt', 'invalid JSON is reported without claiming success');
  check(storage.values.tm_playHistory === '{bad-json', 'invalid original history is not overwritten');
  check(result.quarantineKey && storage.values[result.quarantineKey] === '{bad-json', 'invalid history is backed up under a quarantine key');

  storage = baseStorage(JSON.stringify({ sid: 'storage-fixture', turns: 12 }));
  context = load(storage);
  result = context.TM.Benji.attachToPlayHistory(makeBenjiWorld());
  check(result.ok === false && result.reason === 'history-not-array', 'non-array history is rejected');
  check(JSON.parse(storage.values.tm_playHistory).sid === 'storage-fixture', 'non-array original history remains untouched');

  storage = baseStorage(JSON.stringify([{ sid: 'storage-fixture', turns: 12 }]));
  storage.setItem = function () {
    const error = new Error('quota');
    error.name = 'QuotaExceededError';
    throw error;
  };
  context = load(storage);
  const quotaWorld = makeBenjiWorld();
  result = context.TM.Benji.attachToPlayHistory(quotaWorld);
  check(result.ok === false && result.reason === 'quota-exceeded', 'quota failure has a distinct result');
  check(quotaWorld._benji.sections.length === 1, 'storage failure never deletes the GM benji');

  storage = baseStorage(JSON.stringify([{ sid: 'storage-fixture', turns: 12 }]));
  storage.setItem = function () { throw new Error('disk bridge failed'); };
  context = load(storage);
  result = context.TM.Benji.attachToPlayHistory(makeBenjiWorld());
  check(result.ok === false && result.reason === 'write-failed', 'non-quota write failure is distinct');

  const status = { textContent: '' };
  const body = { innerHTML: '' };
  const host = { appendChild() {} };
  const document = {
    querySelector(selector) { return selector === '#_endgame > div' ? host : null; },
    createElement() { return { id: '', innerHTML: '' }; },
    getElementById(id) { return id === '_benji_status' ? status : (id === '_benji_body' ? body : null); }
  };
  storage = baseStorage(JSON.stringify([{ sid: 'storage-fixture', turns: 1 }]));
  storage.setItem = function () {
    const error = new Error('quota');
    error.name = 'QuotaExceededError';
    throw error;
  };
  context = load(storage, {
    document,
    P: { conf: { benjiEnabled: true }, ai: { key: 'fixture-key' }, playerInfo: { characterName: '测试帝' } },
    callAISmart() { return Promise.resolve('终局本纪'); },
    escHtml(value) { return String(value == null ? '' : value); }
  });
  const gm = { sid: 'storage-fixture', turn: 1, qijuHistory: [], shijiHistory: [], biannianItems: [] };
  result = await context.TM.Benji.composeForEndgame(gm, {});
  check(result.ok === true && result.playHistory.reason === 'quota-exceeded', 'composition succeeds independently from history-side storage');
  check(gm._benji && gm._benji.sections.length === 1, 'composed benji remains in GM after history-side failure');
  check(status.textContent.includes('本纪修讫') && status.textContent.includes('保存失败'), 'endgame UI truthfully distinguishes composed from persisted');
  check(!status.textContent.includes('已存入历代亲历'), 'endgame UI never claims persistence after failure');

  console.log('[smoke-benji-storage-failures] PASS assertions=' + assertions);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
