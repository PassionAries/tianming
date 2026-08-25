#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error('[smoke-changequeue-apply-safety] ' + message);
  passed++;
}

function makeWorld() {
  return {
    turn: 7,
    vars: { stability: { value: 50, min: 0, max: 100 } },
    chars: [{ id: 'char-a', name: '同名', loyalty: 50 }, { id: 'char-b', name: '同名', loyalty: 70 }],
    facs: [{ id: 'fac-a', name: '甲', power: 10 }],
    mapData: { regions: [{ id: 'region-a', name: '京畿', prosperity: 30 }] }
  };
}

async function main() {
  const ctx = {
    console,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    Promise,
    Set,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    GM: makeWorld(),
    P: {},
    _dbg() {},
    deepClone(value) { return JSON.parse(JSON.stringify(value)); },
    ensureWritableRuntimeMap() { return ctx.GM.mapData; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tm-change-queue.js'), 'utf8'), ctx, { filename: 'tm-change-queue.js' });

  assert(ctx.ChangeQueue && typeof ctx.ChangeQueue.applyAll === 'function', 'actual ChangeQueue provider loads');

  ctx.ChangeQueue.enqueue({ id: 'valid-a', type: 'character', target: 'char-a', field: 'loyalty', delta: 5, source: 'smoke' });
  let result = ctx.ChangeQueue.applyAll();
  assert(result.ok && result.appliedCount === 1 && ctx.GM.chars[0].loyalty === 55, 'valid change applies exactly once');
  ctx.ChangeQueue.clear();

  ctx.ChangeQueue.enqueue({ id: 'ambiguous', type: 'character', target: '同名', field: 'loyalty', delta: 5, source: 'smoke' });
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.appliedCount === 0 && result.failures[0].code === 'character-name-ambiguous', 'same-name target fails explicitly');
  assert(ctx.GM.chars[0].loyalty === 55 && ctx.GM.chars[1].loyalty === 70, 'ambiguous target changes no character');
  assert(ctx.ChangeQueue.getDeadLetters().some((row) => row.reason === 'character-name-ambiguous'), 'permanent target failure enters dead-letter');

  ctx.ChangeQueue.enqueue({ id: 'batch-valid', type: 'nation', field: 'legitimacy', newValue: 80, source: 'smoke' });
  ctx.ChangeQueue.enqueue({ id: 'batch-invalid', type: 'faction', target: 'missing', field: 'power', delta: 1, source: 'smoke' });
  ctx.GM.legitimacy = 30;
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.rolledBack && ctx.GM.legitimacy === 30, 'one failure rolls back all earlier mutations in the batch');
  assert(result.appliedCount === 0 && ctx.ChangeQueue.length() === 1, 'failed batch never reports partial success and retains only retryable sibling');
  ctx.ChangeQueue.clear();

  ctx.ChangeQueue.enqueue({ id: 'nan', type: 'faction', target: 'fac-a', field: 'power', delta: 'not-a-number', source: 'smoke' });
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.failures[0].code === 'invalid-numeric-value' && ctx.GM.facs[0].power === 10, 'invalid numeric input is rejected before mutation');

  ctx.GM.vars = null;
  ctx.ChangeQueue.enqueue({ id: 'transient', type: 'variable', target: 'stability', delta: 1, source: 'smoke' });
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.failures[0].retryable && ctx.ChangeQueue.length() === 1, 'temporary collection failure remains queued');
  result = ctx.ChangeQueue.applyAll();
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.failures[0].attempts === 3 && ctx.ChangeQueue.length() === 0, 'temporary failure stops retrying after the configured maximum');
  assert(ctx.ChangeQueue.getDeadLetters().some((row) => row.change.id === 'transient' && row.attempts === 3), 'retry exhaustion is retained as a diagnostic dead-letter');

  let thrownReads = 0;
  const explosiveVariable = { min: 0, max: 100 };
  Object.defineProperty(explosiveVariable, 'value', {
    configurable: true,
    get() {
      thrownReads++;
      throw new Error('injected handler exception');
    }
  });
  ctx.GM.vars = { explosive: explosiveVariable };
  ctx.ChangeQueue.enqueue({ id: 'exception-retry', type: 'variable', target: 'explosive', delta: 1, source: 'smoke' });
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.failures[0].code === 'apply-exception' && result.failures[0].attempts === 1 && ctx.ChangeQueue.length() === 1, 'thrown handler exception consumes the first bounded retry');
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.failures[0].attempts === 2 && ctx.ChangeQueue.length() === 1, 'thrown handler exception consumes the second bounded retry');
  result = ctx.ChangeQueue.applyAll();
  assert(!result.ok && result.failures[0].attempts === 3 && ctx.ChangeQueue.length() === 0, 'thrown handler exception reaches the retry ceiling');
  assert(ctx.ChangeQueue.getDeadLetters().some((row) => row.change.id === 'exception-retry' && row.reason === 'apply-exception' && row.attempts === 3), 'thrown handler exception is retained in dead-letter diagnostics');
  result = ctx.ChangeQueue.applyAll();
  assert(result.ok && thrownReads === 3, 'dead-lettered exception is not executed again');

  ctx.GM.vars = { stability: { value: 50, min: 0, max: 100 } };
  const first = ctx.ChangeQueue.enqueue({ id: 'duplicate-id', type: 'nation', field: 'authority', delta: 1, source: 'smoke' });
  const duplicate = ctx.ChangeQueue.enqueue({ id: 'duplicate-id', type: 'nation', field: 'authority', delta: 99, source: 'smoke' });
  assert(first.ok && duplicate.duplicate && ctx.ChangeQueue.length() === 1, 'duplicate change IDs are idempotent');
  ctx.ChangeQueue.clear();

  let capacityFailure = null;
  for (let i = 0; i < 1025; i++) {
    const queued = ctx.ChangeQueue.enqueue({ id: 'capacity-' + i, type: 'nation', field: 'field' + i, delta: 1, source: 'capacity' });
    if (!queued.ok) capacityFailure = queued;
  }
  assert(ctx.ChangeQueue.length() === 1024 && capacityFailure && capacityFailure.code === 'queue-capacity-exceeded', 'hard capacity rejects excess work predictably');
  ctx.ChangeQueue.clear();

  let successfulListenerCalls = 0;
  let observed = null;
  ctx.registerListener('character', 'loyalty', () => { throw new Error('listener injected failure'); }, 1);
  ctx.registerListener('character', 'loyalty', (entity, field, oldValue, newValue) => {
    successfulListenerCalls++;
    observed = { entity, field, oldValue, newValue };
  }, 2);
  const entity = ctx.GM.chars[0];
  ctx.triggerPropertyChange('character', entity, 'loyalty', 55, 56);
  ctx.triggerPropertyChange('character', entity, 'loyalty', 56, 60);
  assert(ctx.GM._changeQueue.length === 1, 'reactive property events coalesce within one microtask');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(ctx.GM._changeQueue.length === 0 && successfulListenerCalls === 1, 'reactive property queue is independently scheduled and consumed once');
  assert(observed.oldValue === 55 && observed.newValue === 60, 'coalescing preserves the earliest old and final new values');
  assert(ctx.ChangeQueue.length() === 0, 'reactive property processing never consumes or populates internal ChangeQueue work');

  const systemsSrc = fs.readFileSync(path.join(ROOT, 'tm-endturn-systems.js'), 'utf8');
  const applyPos = systemsSrc.indexOf('ChangeQueue.applyAll()');
  const guardPos = systemsSrc.indexOf('queueResult.ok');
  const clearPos = systemsSrc.indexOf('ChangeQueue.clear()');
  assert(applyPos >= 0 && guardPos > applyPos && clearPos > guardPos, 'end-turn clears internal queue only after an explicit successful result');

  console.log('[smoke-changequeue-apply-safety] pass assertions=' + passed);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
