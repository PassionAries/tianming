#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WEB = path.resolve(__dirname, '..');
let assertions = 0;

function assert(value, message) {
  assertions += 1;
  if (!value) throw new Error('[assert] ' + message);
}

function load(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(WEB, file), 'utf8'), ctx, { filename: file });
}

function createContext() {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    GM: { turn: 1, chars: [], facs: [], armies: [], regions: [], officeTree: {}, vars: {}, guoku: {}, neitang: {} },
    P: {},
    structuredClone(value) { return JSON.parse(JSON.stringify(value)); }
  };
  context.window = context;
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  return context;
}

function loadPrerequisites(context) {
  load(context, 'tm-ai-change-pathutils.js');
  load(context, 'tm-ai-change-army.js');
  load(context, 'tm-ai-change-narrative.js');
}

const ctx = createContext();
loadPrerequisites(ctx);
load(ctx, 'generated/tm-ai-change-applier.bundle.js');

assert(ctx.AIChangeApplier && ctx.AIChangeApplier.VERSION === 1, 'legacy facade should install');
assert(typeof ctx.AIChangeApplier.applyAITurnChanges === 'function', 'apply API should remain available');
assert(typeof ctx.AIChangeApplier.preflightAIWriteBack === 'function', 'preflight API should remain available');
assert(!Object.prototype.hasOwnProperty.call(ctx.TM, '__acaParts'), 'global ACA bucket must not exist');
assert(ctx.TM.AIChange.ApplierModule && ctx.TM.AIChange.ApplierModule.initialized === true, 'module state should be explicit');

const first = ctx.AIChangeApplier;
load(ctx, 'generated/tm-ai-change-applier.bundle.js');
assert(ctx.AIChangeApplier === first, 'repeated initialization should be idempotent');

assert(fs.existsSync(path.join(WEB, 'modules/ai-change-applier/index.js')), 'module entry source should exist');
[
  'tm-ai-change-applier.js',
  'tm-ai-change-applier-validators.js',
  'tm-ai-change-applier-reconcile.js'
].forEach(function (legacyFile) {
  assert(!fs.existsSync(path.join(WEB, legacyFile)), legacyFile + ' must be removed after bundle migration');
});

const missingDeps = {
  console: { log() {}, warn() {}, error() {} },
  GM: { chars: [], facs: [] },
  P: {}
};
missingDeps.window = missingDeps;
missingDeps.global = missingDeps;
missingDeps.globalThis = missingDeps;
vm.createContext(missingDeps);
let dependencyError = null;
try {
  load(missingDeps, 'generated/tm-ai-change-applier.bundle.js');
} catch (error) {
  dependencyError = error;
}
assert(dependencyError && dependencyError.code === 'ai-change-applier-dependencies-missing', 'missing dependencies must fail explicitly');
assert(!missingDeps.AIChangeApplier, 'failed initialization must not install the legacy facade');

const atomicCtx = createContext();
loadPrerequisites(atomicCtx);
const priorShortcut = function priorShortcut() {};
atomicCtx.applyAITurnChanges = priorShortcut;
const injectedSetter = function injectedSetter() { throw new Error('injected publish failure'); };
Object.defineProperty(atomicCtx, 'normalizeAIWriteBackDeaths', {
  configurable: true,
  enumerable: true,
  get() { return undefined; },
  set: injectedSetter
});
let publishError = null;
try {
  load(atomicCtx, 'generated/tm-ai-change-applier.bundle.js');
} catch (error) {
  publishError = error;
}
assert(publishError && publishError.code === 'ai-change-applier-publish-failed', 'late publish failure must be structured');
assert(atomicCtx.applyAITurnChanges === priorShortcut, 'failed publish must restore an overwritten shortcut descriptor');
[
  'AIChangeApplier', 'applyAllegianceChange', '_syncFiscalScalars', '_arriveCharNow',
  '_hasInstantArrivalRule', 'applyAIArmyChange', 'onAppointment', 'onDismissal',
  '_tmReasonIsImprison', '_TM_IMPRISON_RE', '_resolveBinding', 'renderTurnReport',
  'buildFullAIContext', 'advanceCharTravelByDays', 'applyNormalizedAIWriteBackDeaths',
  '_reconcilePlayerMovements', '_reconcilePlayerFiscalReforms', '_applyOfficeDutyTick',
  '_applyTaxAuthorityGate', '_applyDirectiveCompliance', '_applyRegentDecisions',
  'preflightAIWriteBack', 'validateAIWriteBackBatch', '_applyBattleResult',
  '_applyFiscalDeficitPenalties', '_resetDeficitStreakIfHealthy'
].forEach(function (key) {
  assert(!Object.prototype.hasOwnProperty.call(atomicCtx, key), 'failed publish must not leak ' + key);
});
const restoredBlocker = Object.getOwnPropertyDescriptor(atomicCtx, 'normalizeAIWriteBackDeaths');
assert(restoredBlocker && restoredBlocker.set === injectedSetter, 'failed publish must restore the injected property descriptor');
assert(!Object.prototype.hasOwnProperty.call(atomicCtx.TM.AIChange, 'WriteGuards'), 'failed publish must roll back WriteGuards');
assert(!Object.prototype.hasOwnProperty.call(atomicCtx.TM.AIChange, 'ApplierModule'), 'failed publish must not expose initialized module state');
assert(!publishError.rollbackFailures || publishError.rollbackFailures.length === 0, 'atomic rollback should restore every descriptor');

delete atomicCtx.normalizeAIWriteBackDeaths;
load(atomicCtx, 'generated/tm-ai-change-applier.bundle.js');
assert(atomicCtx.AIChangeApplier && atomicCtx.TM.AIChange.ApplierModule.initialized === true, 'retry after rollback should initialize successfully');
const recoveredFacade = atomicCtx.AIChangeApplier;
load(atomicCtx, 'generated/tm-ai-change-applier.bundle.js');
assert(atomicCtx.AIChangeApplier === recoveredFacade, 'successful retry should remain idempotent');

console.log('smoke-ai-change-applier-module-island PASS assertions=' + assertions);
