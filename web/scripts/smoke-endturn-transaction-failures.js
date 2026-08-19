#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(WEB, 'tm-endturn-core.js'), 'utf8');
const systemsSource = fs.readFileSync(path.join(WEB, 'tm-endturn-systems.js'), 'utf8');
let assertions = 0;
function ok(value, label) {
  if (!value) throw new Error('[smoke-endturn-transaction-failures] ' + label);
  assertions++;
}

function sourceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  if (start < 0 || end <= start) throw new Error('source slice missing: ' + startText);
  return source.slice(start, end);
}

const ctx = {
  console,
  Date,
  Promise,
  Object,
  JSON,
  Math,
  Error,
  setTimeout,
  clearTimeout,
  deepClone: value => JSON.parse(JSON.stringify(value)),
  buildIndices() {},
  renderGameState() {},
  showLoading() {},
  processBiannian() {},
  _dbg() {},
  TM: { errors: { capture() {} } }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(sourceBetween(coreSource, 'async function _tmRunCriticalEndTurnSystem', 'async function _runPreSubmitPartyClassCalibration'), ctx);
vm.runInContext(sourceBetween(coreSource, 'async function _runPreSubmitPartyClassCalibration()', 'async function _endTurnInternal'), ctx);
vm.runInContext(sourceBetween(coreSource, 'function _tmCaptureEndTurnObject', 'async function _tmFinalizeEndTurnTransaction'), ctx);
vm.runInContext(systemsSource, ctx);

function resetWorld(extra) {
  ctx.GM = Object.assign({ turn: 4, sid: 's1', _campaignId: 'c1', busy: false, marker: 10, armies: [{ soldiers: 100 }], treasury: 50 }, extra || {});
  ctx.P = { marker: 'template', conf: {}, ai: {}, battleConfig: {} };
  ctx.TM = { errors: { capture() {} } };
  ctx._tmLoadGen = 0;
  delete ctx.BattleEngine;
  delete ctx.GuokuEngine;
  delete ctx.CorruptionEngine;
  delete ctx.HujiEngine;
  delete ctx.HujiDeepFill;
  delete ctx.updateProvinceEconomy;
  delete ctx.IntegrationBridge;
  ctx.SubTickRunner = { run() {} };
}

async function expectFailure(promise, text) {
  try { await promise; }
  catch (error) { return !text || String(error && error.message || error).includes(text); }
  return false;
}

function comparableWorld(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy._lastEndTurnRollback;
  delete copy._endTurnBusy;
  return JSON.stringify(copy);
}

async function main() {
  const snapshotIndex = coreSource.indexOf('_turnTxn = _tmCaptureEndTurnTransaction();');
  const calibrationIndex = coreSource.indexOf('await _runPreSubmitPartyClassCalibration();');
  ok(snapshotIndex >= 0 && calibrationIndex > snapshotIndex, 'pre-submit calibration is inside the transaction boundary');

  resetWorld();
  ctx.TM.PartyClassActionScheduler = {
    scheduleBeforeSubmit(GM) { GM.marker = 20; GM.calibrationWrite = true; }
  };
  let txn = ctx._tmCaptureEndTurnTransaction();
  await ctx._runPreSubmitPartyClassCalibration();
  ok(ctx.GM.marker === 20, 'calibration probe mutates the live world');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('forced pre-save failure'));
  ok(ctx.GM.marker === 10 && !ctx.GM.calibrationWrite && ctx.P.marker === 'template', 'pre-save failure rolls calibration changes back to click-time state');
  delete ctx.TM.PartyClassActionScheduler;

  resetWorld();
  txn = ctx._tmCaptureEndTurnTransaction();
  ctx.BattleEngine = {
    _getConfig: () => ({ enabled: true }),
    resolveAllBattles() { ctx.GM.armies[0].soldiers = 25; throw new Error('battle-ledger-failure'); }
  };
  ok(await expectFailure(ctx._endTurn_updateSystems(1, ''), 'battle-ledger-failure'), 'battle failure propagates out of systems step');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('battle-ledger-failure'));
  ok(ctx.GM.armies[0].soldiers === 100 && ctx.GM.turn === 4, 'partial battle mutation and turn state roll back atomically');

  resetWorld();
  txn = ctx._tmCaptureEndTurnTransaction();
  ctx.GuokuEngine = {
    tick() { ctx.GM.treasury = -999; throw new Error('guoku-ledger-failure'); }
  };
  ok(await expectFailure(ctx._endTurn_updateSystems(1, ''), 'guoku-ledger-failure'), 'treasury failure propagates after an intermediate turn increment');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('guoku-ledger-failure'));
  ok(ctx.GM.treasury === 50 && ctx.GM.turn === 4, 'partial treasury mutation and turn increment roll back atomically');

  resetWorld({ turn: 8 });
  let releaseSubticks;
  ctx.SubTickRunner = { run: () => new Promise(resolve => { releaseSubticks = resolve; }) };
  const pending = ctx._endTurn_updateSystems(1, '');
  await Promise.resolve();
  await Promise.resolve();
  ok(ctx.GM.turn === 8, 'turn does not advance while asynchronous subticks are pending');
  releaseSubticks();
  await expectFailure(pending);
  ok(ctx.GM.turn === 9, 'systems continue only after asynchronous subticks resolve');

  const tailCallIndex = coreSource.indexOf('await _tmRunEndTurnDeterministicTail();');
  const tailFinalizeIndex = coreSource.indexOf('await _tmFinalizeEndTurnTransaction(_obsCtx, _turnTxn);', tailCallIndex);
  ok(tailCallIndex >= 0 && tailFinalizeIndex > tailCallIndex, 'deterministic state tail is awaited before transaction commit');

  const tailFailures = [
    ['BuildingWorks', () => { ctx.TM.BuildingWorks = { tick() { ctx.GM.marker = 21; throw new Error('tail-building'); } }; }],
    ['TalentCohorts', () => { ctx.TM.TalentCohorts = { enabled() { return true; }, tick() { ctx.GM.marker = 22; throw new Error('tail-talent'); } }; }],
    ['RegionStatus', () => { ctx.TM.RegionStatus = { tick() { ctx.GM.marker = 23; throw new Error('tail-region'); } }; }],
    ['FieldPipes', () => { ctx.TM.FieldPipes = { tick() { ctx.GM.marker = 24; throw new Error('tail-fields'); } }; }],
    ['SocialFoundation', () => { ctx.TM.SocialFoundation = { tick() { ctx.GM.marker = 25; throw new Error('tail-social'); } }; }],
    ['Renli', () => { ctx.TM.Renli = { endturnTick() { ctx.GM.marker = 26; throw new Error('tail-renli'); } }; }],
    ['OfficeFallback', () => { ctx.TM.OfficeFallback = { tick() { ctx.P.marker = 'partial-office'; throw new Error('tail-office'); } }; }],
    ['IntegrationBridge', () => { ctx.IntegrationBridge = { aggregateRegionsToVariables() { ctx.GM.marker = 28; throw new Error('tail-aggregate'); } }; }],
    ['ArmyReconcile', () => { ctx.TM.AIChange = { Army: { reconcileArmyCommanders() { ctx.GM.armies[0].soldiers = 1; throw new Error('tail-army'); } } }; }]
  ];
  for (const entry of tailFailures) {
    resetWorld();
    const beforeGM = comparableWorld(ctx.GM);
    const beforeP = comparableWorld(ctx.P);
    txn = ctx._tmCaptureEndTurnTransaction();
    entry[1]();
    ok(await expectFailure(ctx._tmRunEndTurnDeterministicTail(), 'tail-'), entry[0] + ' failure reaches the transaction boundary');
    ctx._tmRollbackEndTurnTransaction(txn, new Error('forced ' + entry[0] + ' failure'));
    ok(comparableWorld(ctx.GM) === beforeGM && comparableWorld(ctx.P) === beforeP,
      entry[0] + ' partial GM/P writes roll back to the pre-turn snapshot');
  }

  console.log('[smoke-endturn-transaction-failures] PASS assertions=' + assertions);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
