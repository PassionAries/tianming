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

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  GM: { turn: 1, chars: [], facs: [], armies: [], regions: [], officeTree: {}, vars: {}, guoku: {}, neitang: {} },
  P: {},
  structuredClone(value) { return JSON.parse(JSON.stringify(value)); }
};
ctx.window = ctx;
ctx.global = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

load(ctx, 'tm-ai-change-pathutils.js');
load(ctx, 'tm-ai-change-army.js');
load(ctx, 'tm-ai-change-narrative.js');
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

console.log('smoke-ai-change-applier-module-island PASS assertions=' + assertions);
