#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const warfareSource = fs.readFileSync(path.join(WEB, 'tm-feudal-warfare.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(WEB, 'tm-endturn-core.js'), 'utf8');

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error('missing source slice: ' + startMarker);
  return source.slice(start, end);
}

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing function: ' + marker);
  let pos = source.indexOf('{', start);
  let depth = 0;
  for (; pos < source.length; pos += 1) {
    if (source[pos] === '{') depth += 1;
    else if (source[pos] === '}' && --depth === 0) return source.slice(start, pos + 1);
  }
  throw new Error('unterminated function: ' + marker);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error('[smoke-war-truce-world-isolation] ' + label);
  passed += 1;
  console.log('  PASS - ' + label);
}

const context = {
  console,
  Math,
  Number,
  String,
  Object,
  Array,
  Date,
  Error,
  JSON,
  deepClone: clone,
  clamp(value, min, max) { return Math.max(min, Math.min(max, value)); },
  _dbg() {},
  addEB() {},
  turnsForMonths(value) { return Number(value); },
  window: {
    _tmLoadGen: 1,
    crypto: { randomUUID() { return 'round19-war-txn'; } }
  },
  crypto: { randomUUID() { return 'round19-war-txn'; } },
  P: { marker: 'world-a' },
  GM: null
};
context.window.window = context.window;
vm.createContext(context);

const warWeightSlice = extractBetween(
  warfareSource,
  'var WarWeightSystem = {',
  '// D1. 宣战理由'
);
const endWarSlice = extractFunction(warfareSource, 'function endWar(warId)');
const transactionSlice = extractBetween(
  coreSource,
  'function _tmCaptureEndTurnObject(',
  'async function _tmFinalizeEndTurnTransaction('
);
vm.runInContext(warWeightSlice + '\n' + endWarSlice + '\n' + transactionSlice, context, {
  filename: 'round19-war-runtime.js'
});

function makeWorld(id) {
  return {
    sid: id,
    turn: 10,
    _campaignId: 'campaign-' + id,
    _timelineId: 'timeline-' + id,
    activeWars: [{ id: 'war-' + id, attacker: '甲', defender: '乙', truceMonths: 12 }]
  };
}

const gameA = makeWorld('a');
context.GM = gameA;
context.WarWeightSystem.addTruce('甲', '乙', 8);
check(context.WarWeightSystem.hasTruce('甲', '乙') === true, 'Game A stores its own truce');

const gameB = makeWorld('b');
context.GM = gameB;
context.WarWeightSystem.reset(gameB);
check(context.WarWeightSystem.hasTruce('甲', '乙') === false, 'new Game B does not inherit Game A truce');
check(context.WarWeightSystem.hasTruce('甲', '乙', gameA) === true, 'switching worlds does not erase Game A state');

context.WarWeightSystem.deserialize(null, gameB);
check(Object.keys(gameB._warTruces.truces).length === 0, 'legacy save without _warTruces clears world state');
context.WarWeightSystem.deserialize({ truces: { '丙|丁': 42 } }, gameB);
check(gameB._warTruces.truces['丙|丁'] === 42, 'versioned legacy truce payload migrates');
context.WarWeightSystem.deserialize({ '戊|己': 51 }, gameB);
check(gameB._warTruces.truces['戊|己'] === 51, 'bare legacy truce dictionary migrates');
context.WarWeightSystem.deserialize({ truces: {
  '甲|乙': Number.NaN,
  '丙|丁': Number.POSITIVE_INFINITY,
  '戊|己': -1,
  '__proto__|敌': 20,
  '安全甲|安全乙': 60
} }, gameB);
check(Object.keys(gameB._warTruces.truces).length === 1
  && gameB._warTruces.truces['安全甲|安全乙'] === 60,
  'malformed expiry and prototype-pollution keys are discarded');

const beforeLoadA = context.WarWeightSystem.serialize(gameA);
context.GM = gameB;
context.WarWeightSystem.deserialize({ truces: { '新甲|新乙': 99 } }, gameB);
context.GM = gameA;
context.WarWeightSystem.deserialize(beforeLoadA, gameA);
check(context.WarWeightSystem.hasTruce('甲', '乙', gameA) === true
  && context.WarWeightSystem.hasTruce('新甲', '新乙', gameA) === false,
  'failed-load rollback restores the original world truce state');

context.GM = makeWorld('txn');
context.P = { marker: 'txn-before' };
context.lastCommittedSnapshot = null;
context.desktopAutoSave = null;
context._buildSaveState = function(options) {
  const gm = clone(options.gm);
  gm._warTruces = context.WarWeightSystem.serialize(gm);
  return { GM: gm, P: clone(options.p) };
};
context._tmAdoptCommittedWorldSnapshot = function(state) {
  context.lastCommittedSnapshot = clone(state);
  return true;
};
context._tmRequestDeferredDesktopAutoSaveFlush = function() {
  context.desktopAutoSave = context._buildSaveState({ gm: context.GM, p: context.P });
  return Promise.resolve({ ok: true });
};
const transaction = context._tmCaptureEndTurnTransaction();
context.endWar('war-txn');
check(context.GM.activeWars.length === 0
  && context.WarWeightSystem.hasTruce('甲', '乙') === true,
  'real endWar removes the war and records a world-owned truce');
check(context._tmRollbackEndTurnTransaction(transaction, new Error('injected later failure')) === true,
  'turn transaction rollback completes');
check(context.GM.activeWars.length === 1
  && context.WarWeightSystem.hasTruce('甲', '乙') === false,
  'turn rollback restores activeWars and the pre-turn truce state together');
check(context.desktopAutoSave
  && Object.keys(context.desktopAutoSave.GM._warTruces.truces).length === 0,
  'deferred desktop autosave after rollback excludes the rolled-back truce');

context.WarWeightSystem.addTruce('甲', '乙', 9, context.GM);
const detached = context.WarWeightSystem.serialize(context.GM);
context.GM._warTruces.truces['甲|乙'] = 999;
check(detached.truces['甲|乙'] !== 999, 'serialize returns a detached snapshot without aliases');

const sameNamesA = makeWorld('same-a');
const sameNamesB = makeWorld('same-b');
context.WarWeightSystem.addTruce('同名甲', '同名乙', 5, sameNamesA);
check(context.WarWeightSystem.hasTruce('同名甲', '同名乙', sameNamesA) === true
  && context.WarWeightSystem.hasTruce('同名甲', '同名乙', sameNamesB) === false,
  'identical faction names in different campaigns do not leak truces');

console.log('[smoke-war-truce-world-isolation] pass=' + passed);
