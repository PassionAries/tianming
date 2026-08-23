#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(WEB, 'tm-endturn-core.js'), 'utf8');
const systemsSource = fs.readFileSync(path.join(WEB, 'tm-endturn-systems.js'), 'utf8');
const pipelineStepsSource = fs.readFileSync(path.join(WEB, 'tm-endturn-pipeline-steps.js'), 'utf8');
const hujiSource = fs.readFileSync(path.join(WEB, 'tm-huji-engine.js'), 'utf8');
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
vm.runInContext(sourceBetween(coreSource, 'function _tmCaptureEndTurnObject', "if (typeof window !== 'undefined') {\n  window._tmMaybeStageTurnResult"), ctx);
vm.runInContext(systemsSource, ctx);
vm.runInContext(pipelineStepsSource, ctx);

function resetWorld(extra) {
  ctx.GM = Object.assign({ turn: 4, sid: 's1', _campaignId: 'c1', busy: false, marker: 10, armies: [{ soldiers: 100 }], treasury: 50 }, extra || {});
  ctx.P = { marker: 'template', conf: {}, ai: {}, battleConfig: {}, time: { daysPerTurn: 30 }, keju: {} };
  const endturn = ctx.TM && ctx.TM.Endturn;
  ctx.TM = { errors: { capture() {} }, Endturn: endturn };
  ctx._tmLoadGen = 0;
  delete ctx.BattleEngine;
  delete ctx.GuokuEngine;
  delete ctx.CorruptionEngine;
  delete ctx.HujiEngine;
  delete ctx.HujiDeepFill;
  delete ctx.EnvCapacityEngine;
  delete ctx.updateProvinceEconomy;
  delete ctx.IntegrationBridge;
  delete ctx.TMArmory;
  delete ctx._endTurn_render;
  delete ctx._endTurn_finalizeRecords;
  delete ctx._endTurn_publishStagedTurnData;
  delete ctx._endTurn_clearCommittedInputs;
  delete ctx._endTurn_showRenderFallback;
  delete ctx._settleCourtMeter;
  delete ctx.advanceCharTravelByDays;
  delete ctx.advanceKejuByDays;
  delete ctx.checkKejuTrigger;
  delete ctx.EndTurnHooks;
  delete ctx._endTurn_saveSnapshot;
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

function stepByName(name) {
  return ctx.TM.Endturn.PipelineSteps.list.find(step => step && step.name === name);
}

function buildStepCtx(input) {
  return {
    input: Object.assign({}, input || {}),
    results: { aiResult: {} },
    deferredSteps: [],
    meta: {}
  };
}

async function expectStepFailureRollback(step, setup, message, label, input) {
  resetWorld();
  const beforeGM = comparableWorld(ctx.GM);
  const beforeP = comparableWorld(ctx.P);
  const txn = ctx._tmCaptureEndTurnTransaction();
  setup();
  const stepCtx = buildStepCtx(input);
  ok(await expectFailure(step.fn(stepCtx), message), label + ' failure propagates out of the pipeline step');
  ctx._tmRollbackEndTurnTransaction(txn, new Error(message));
  ok(comparableWorld(ctx.GM) === beforeGM && comparableWorld(ctx.P) === beforeP,
    label + ' partial state writes roll back atomically');
}

async function main() {
  const snapshotIndex = coreSource.indexOf('_turnTxn = _tmCaptureEndTurnTransaction();');
  const prepareIndex = coreSource.indexOf('await _tmPrepareEndTurnBoundary(_turnTxn, _preCommittedState);', snapshotIndex);
  const commitIndex = coreSource.indexOf('await _tmCommitPreEndTurnRecoveryPoint(txn, clickState);');
  const calibrationIndex = coreSource.indexOf('await _runPreSubmitPartyClassCalibration();', commitIndex);
  ok(snapshotIndex >= 0 && prepareIndex > snapshotIndex && commitIndex >= 0 && calibrationIndex > commitIndex,
    'click-time recovery point commits before pre-submit calibration inside the transaction boundary');

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

  resetWorld({ environment: { byRegion: { first: { scar: 0 } }, crisisHistory: [] } });
  txn = ctx._tmCaptureEndTurnTransaction();
  let environmentStrict = false;
  ctx.EnvCapacityEngine = {
    tick(options) {
      environmentStrict = options && options.strict === true;
      ctx.GM.environment.byRegion.first.scar = 0.75;
      ctx.GM.environment.crisisHistory.push({ id: 'partial-environment-crisis' });
      throw new Error('environment-ledger-failure');
    }
  };
  ok(await expectFailure(ctx._endTurn_updateSystems(1, ''), 'environment-ledger-failure') && environmentStrict,
    'strict environment failure propagates out of systems after partial state writes');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('environment-ledger-failure'));
  ok(ctx.GM.environment.byRegion.first.scar === 0 && ctx.GM.environment.crisisHistory.length === 0,
    'partial environment and crisis history writes roll back atomically');

  resetWorld({
    environment: { nationalLoad: 0.5 }, vars: { disasterLevel: 0 }, activeWars: [],
    population: {
      national: { mouths: 1000000, households: 200000, ding: 300000 },
      byRegion: {},
      dynamics: { birthRateBase: 0.03, deathRateBase: 0.022, yearlyLog: [] }
    }
  });
  const firstLeaf = { id: 'first', populationDetail: { mouths: 600000, households: 120000, ding: 180000 } };
  const secondDetail = { households: 80000, ding: 120000 };
  Object.defineProperty(secondDetail, 'mouths', {
    configurable: true,
    enumerable: true,
    get() {
      if (firstLeaf.populationDetail.mouths !== 600000) throw new Error('huji-second-region-failure');
      return 400000;
    }
  });
  const secondLeaf = { id: 'second', populationDetail: secondDetail };
  ctx.GM.adminHierarchy = { player: { divisions: [firstLeaf, secondLeaf] } };
  ctx.P.conf.populationBottomUpEnabled = false;
  ctx.IntegrationBridge = { getLeafDivisions() { return [firstLeaf, secondLeaf]; } };
  vm.runInContext(hujiSource, ctx);
  const hujiBeforeGM = comparableWorld(ctx.GM);
  const hujiBeforeP = comparableWorld(ctx.P);
  txn = ctx._tmCaptureEndTurnTransaction();
  ok(await expectFailure(ctx._endTurn_updateSystems(1, ''), 'huji-second-region-failure'),
    'real Huji partial-region failure reaches the outer turn transaction');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('huji-second-region-failure'));
  ok(comparableWorld(ctx.GM) === hujiBeforeGM && comparableWorld(ctx.P) === hujiBeforeP,
    'real Huji partial population writes and turn increment roll back atomically');

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

  const systemsStep = stepByName('systems');
  const finalizeStep = stepByName('render-and-finalize');
  ok(systemsStep && systemsStep.onError === 'abort', 'systems keeps an abort policy for resource-ledger failures');
  ok(finalizeStep && finalizeStep.onError === 'abort', 'state finalization aborts instead of committing a partial world');

  await expectStepFailureRollback(systemsStep, () => {
    ctx.TMArmory = {
      async runTurn() {
        ctx.GM.armoryMaterials = 1;
        throw new Error('armory-partial-failure');
      }
    };
  }, 'armory-partial-failure', 'armory production', { _systemsRan: true });

  await expectStepFailureRollback(finalizeStep, () => {
    ctx.advanceCharTravelByDays = async function() {
      ctx.GM.travelDays = 29;
      throw new Error('travel-partial-failure');
    };
  }, 'travel-partial-failure', 'character travel');

  await expectStepFailureRollback(finalizeStep, () => {
    ctx.TM.FactionNpcOffice = {
      async generate() {
        ctx.GM.npcOffice = 'partial-appointment';
        throw new Error('npc-office-partial-failure');
      }
    };
  }, 'npc-office-partial-failure', 'NPC office finalization');

  await expectStepFailureRollback(finalizeStep, () => {
    ctx.TM.FactionNpcGuoku = {
      async generate() {
        ctx.GM.npcTreasury = -999;
        throw new Error('npc-guoku-partial-failure');
      }
    };
  }, 'npc-guoku-partial-failure', 'NPC treasury finalization');

  resetWorld({ shijiHistory: [], qijuHistory: [] });
  let recordBefore = comparableWorld(ctx.GM);
  txn = ctx._tmCaptureEndTurnTransaction();
  ctx._endTurn_finalizeRecords = function() {
    ctx.GM.shijiHistory.push({ turn: 4 });
    throw new Error('chronicle-after-shiji');
  };
  let recordCtx = buildStepCtx();
  recordCtx.meta.turnRenderArgs = [];
  ok(await expectFailure(ctx._tmFinalizeEndTurnTransaction(recordCtx, txn), 'chronicle-after-shiji'),
    'record finalization failure propagates before save/commit');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('chronicle-after-shiji'));
  ok(comparableWorld(ctx.GM) === recordBefore, 'partial Shiji record is rolled back');

  resetWorld({ shijiHistory: [], qijuHistory: [] });
  txn = ctx._tmCaptureEndTurnTransaction();
  ctx._endTurn_finalizeRecords = function() {
    ctx.GM.qijuHistory.push({ turn: 4 });
    throw new Error('memorial-after-qiju');
  };
  recordCtx = buildStepCtx();
  recordCtx.meta.turnRenderArgs = [];
  ok(await expectFailure(ctx._tmFinalizeEndTurnTransaction(recordCtx, txn), 'memorial-after-qiju'),
    'Qiju/memorial record failure propagates before save/commit');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('memorial-after-qiju'));
  ok(ctx.GM.qijuHistory.length === 0, 'partial Qiju record is rolled back');

  resetWorld({ shijiHistory: [] });
  txn = ctx._tmCaptureEndTurnTransaction();
  ctx._endTurn_finalizeRecords = function() { ctx.GM.marker = 20; return { shijiHtml: 'ok' }; };
  ctx._endTurn_saveSnapshot = async function() { return true; };
  ctx._endTurn_render = function() { throw new Error('ui-render-only-failure'); };
  const uiCtx = buildStepCtx();
  uiCtx.meta.turnRenderArgs = [];
  ok(await ctx._tmFinalizeEndTurnTransaction(uiCtx, txn) === true && txn.committed === true,
    'pure UI failure after commit cannot roll the world back');
  ok(uiCtx.results.renderError && uiCtx.results.renderError.message === 'ui-render-only-failure' && ctx.GM.marker === 20,
    'post-commit UI failure remains explicitly degradable and diagnostic');

  resetWorld();
  txn = ctx._tmCaptureEndTurnTransaction();
  let clearDraftCalls = 0;
  ctx._endTurn_finalizeRecords = function() { return { shijiHtml: 'pending' }; };
  ctx._endTurn_saveSnapshot = async function() { return false; };
  ctx._endTurn_clearCommittedInputs = function() { clearDraftCalls++; };
  const failedSaveCtx = buildStepCtx();
  failedSaveCtx.meta.turnRenderArgs = [];
  ok(await expectFailure(ctx._tmFinalizeEndTurnTransaction(failedSaveCtx, txn), '回合最终存档失败'),
    'canonical save failure aborts before commit');
  ok(clearDraftCalls === 0 && txn.committed === false, 'player input drafts remain untouched when final save fails');

  resetWorld();
  txn = ctx._tmCaptureEndTurnTransaction();
  clearDraftCalls = 0;
  ctx._endTurn_finalizeRecords = function() { return { shijiHtml: 'committed' }; };
  ctx._endTurn_saveSnapshot = async function() { return true; };
  ctx._endTurn_publishStagedTurnData = async function() { throw new Error('publish-after-commit'); };
  ctx._endTurn_clearCommittedInputs = function() { clearDraftCalls++; };
  ctx._endTurn_render = function() {};
  const publishCtx = buildStepCtx();
  publishCtx.meta.turnRenderArgs = [];
  publishCtx.meta.stagedTurnData = { transactionId: 'turn-publish-retry' };
  ok(await ctx._tmFinalizeEndTurnTransaction(publishCtx, txn) === true && txn.committed === true,
    'turn-data publish failure cannot roll back an already committed world');
  ok(clearDraftCalls === 1 && publishCtx.meta.stagedTurnData.transactionId === 'turn-publish-retry'
    && !ctx.GM._pendingTurnDataPublish && publishCtx.results.turnDataPublishError,
    'publish failure leaves the independent recovery receipt intact while post-commit input cleanup proceeds');

  resetWorld({ _pendingShijiModal: { courtDone: false, aiReady: false, payload: null } });
  ctx.P.keju = { currentExam: true };
  const deferredBeforeGM = comparableWorld(ctx.GM);
  const deferredBeforeP = comparableWorld(ctx.P);
  txn = ctx._tmCaptureEndTurnTransaction();
  let deferredSaveCalls = 0;
  ctx._endTurn_saveSnapshot = async function() { deferredSaveCalls++; return true; };
  ctx.advanceKejuByDays = async function() {
    ctx.GM.kejuProgress = 99;
    throw new Error('deferred-keju-partial-failure');
  };
  const deferredCtx = buildStepCtx();
  deferredCtx.meta.transaction = txn;
  await finalizeStep.fn(deferredCtx);
  const deferredFinalize = ctx.GM._pendingShijiModal && ctx.GM._pendingShijiModal.deferredPhase5;
  ok(typeof deferredFinalize === 'function', 'deferred court close registers its critical finalizer');
  ok(await expectFailure(deferredFinalize(), 'deferred-keju-partial-failure'),
    'deferred Keju failure reaches the court-close transaction boundary');
  ok(deferredSaveCalls === 0, 'deferred final save is not attempted after a state finalizer fails');
  ok(comparableWorld(ctx.GM) === deferredBeforeGM && comparableWorld(ctx.P) === deferredBeforeP,
    'deferred finalization restores GM/P to the pre-turn snapshot');

  console.log('[smoke-endturn-transaction-failures] PASS assertions=' + assertions);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
