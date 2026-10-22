'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { installCompositeWaits } = require('../../scripts/electron/npc-composite-waits.cjs');
const tests = [], test = (name, run) => tests.push({ name, run });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(deadlineAt = 1800000, inspect = false) {
  let now = 0, serial = 0; const timers = new Map(), calls = [], heldRecords = [];
  const clock = { now: () => now, setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const pending = { turn: deferred(), save: deferred(), load: deferred() };
  const root = { GM: { turn: 3, running: true, _campaignId: 'campaign', _timelineId: 'timeline', busy: false, _endTurnBusy: false, _endTurnCommitPending: false }, P: {}, _tmLoadGen: 7 };
  root._endTurnInternal = function() { calls.push({ kind: 'turn', receiver: this, args: [...arguments] }); root.GM.busy = root.GM._endTurnBusy = root.GM._endTurnCommitPending = true; return pending.turn.promise; };
  root.saveToSlot = function() { calls.push({ kind: 'save', receiver: this, args: [...arguments] }); return pending.save.promise; };
  root.SaveManager = { loadFromSlot: function() { calls.push({ kind: 'load', receiver: this, args: [...arguments] }); return pending.load.promise; } };
  root._tmCommitEndTurnTransaction = function(txn) { calls.push({ kind: 'commit', receiver: this, args: [...arguments] }); if (txn.rejectCommit) return false; txn.committed = true; root.GM._endTurnCommitPending = false; return true; };
  let install = installCompositeWaits;
  if (inspect) {
    // The actual serialized helper used by Electron, with a VM-only Map observer.
    // This inspects ownership without adding production/debug exports to the helper.
    class ObservedMap extends Map { set(key, value) { if (typeof key === 'number' && value.kind) heldRecords.push(value); return super.set(key, value); } }
    install = vm.runInNewContext('(' + installCompositeWaits.toString() + ')', { Map: ObservedMap, Promise, Number, String, Array, Error });
  }
  const waits = install(root, deadlineAt, clock);
  function txn(extra = {}) { return Object.assign({ gmRef: root.GM, pRef: root.P, loadGen: root._tmLoadGen, turn: 3, campaignId: 'campaign', timelineId: 'timeline', transactionId: 'turn-commit', committed: false,
    canonicalSaveReceipt: { state: 'committed', transactionId: 'turn-commit', slots: ['autosave', 'slot_0'].map(id => ({ id, campaignId: 'campaign', timelineId: 'timeline' })) } }, extra); }
  function idle() { root.GM.busy = root.GM._endTurnBusy = root.GM._endTurnCommitPending = false; }
  function advance(ms) { now += ms; for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.fn(); } }
  return { root, waits, pending, calls, heldRecords, timers, clock, txn, idle, advance };
}
test('real turn Promise stays pending after turn advancement and commit until final work settles', async () => {
  const f = fixture(), id = f.waits.arm('turn'), options = { postTurnCourt: false }, receiver = { caller: 'UI' };
  const returned = f.root._endTurnInternal.call(receiver, options); assert.equal(returned, f.pending.turn.promise);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].receiver, receiver); assert.equal(f.calls[0].args[0], options);
  let settled = false; f.waits.wait(id).then(() => { settled = true; }); f.root.GM.turn++;
  for (let i = 0; i < 750; i++) { f.advance(100); f.waits.snapshot(); }
  await tick(); assert.equal(settled, false, 'more than the old 500 polls cannot manufacture completion');
  const transaction = f.txn(); assert.equal(f.root._tmCommitEndTurnTransaction(transaction), true); await tick(); assert.equal(settled, false);
  f.idle(); f.pending.turn.resolve(); const result = await f.waits.wait(id);
  assert.equal(result.status, 'completed'); assert.equal(result.invocations, 1); assert.equal(result.before.turn, 3); assert.equal(result.after.turn, 4);
  assert.equal(result.commit.transactionId, transaction.transactionId); assert.deepEqual(result.commit.slots, ['autosave', 'slot_0']);
});
test('global save producer waits through prompt, background jobs and UI refresh and requires true', async () => {
  const f = fixture(), id = f.waits.arm('save', 2), receiver = { ui: true }, extra = { unchanged: true };
  const returned = f.root.saveToSlot.call(receiver, 2, extra); assert.equal(returned, f.pending.save.promise);
  assert.equal(f.calls[0].receiver, receiver); assert.deepEqual(f.calls[0].args, [2, extra]);
  f.advance(120000); await tick(); assert.equal(f.waits.snapshot()[0].status, 'pending');
  f.pending.save.resolve(true); const result = await f.waits.wait(id); assert.equal(result.result, true); assert.equal(result.slot, 2); assert.equal(result.invocations, 1);
});
for (const value of [false, undefined, { ok: true }]) test('fulfilled save without strict true is rejected: ' + String(value), async () => {
  const f = fixture(), id = f.waits.arm('save', 1); f.root.saveToSlot(1); f.pending.save.resolve(value);
  await assert.rejects(f.waits.wait(id), /true commit receipt/);
});
for (const outcome of ['no-commit', 'false-commit', 'rollback', 'unconfirmed']) test('turn fulfillment cannot certify ' + outcome, async () => {
  const f = fixture(), id = f.waits.arm('turn'); f.root._endTurnInternal(); f.root.GM.turn++; f.idle();
  if (outcome === 'false-commit') assert.equal(f.root._tmCommitEndTurnTransaction(f.txn({ rejectCommit: true })), false);
  if (outcome === 'rollback') { f.root.GM.turn--; f.root.GM._lastEndTurnRollback = { turn: f.root.GM.turn }; }
  if (outcome === 'unconfirmed') { f.root.GM.busy = true; f.root.GM._endTurnCommitPending = true; }
  f.pending.turn.resolve(); await assert.rejects(f.waits.wait(id), /no genuine commit|before a confirmed idle commit/);
});
test('a nominal true commit with a foreign canonical receipt still fails', async () => {
  const f = fixture(), id = f.waits.arm('turn'); f.root._endTurnInternal(); f.root.GM.turn++;
  const transaction = f.txn(); transaction.canonicalSaveReceipt.transactionId = 'foreign'; f.root._tmCommitEndTurnTransaction(transaction);
  await assert.rejects(f.waits.wait(id), /invalid or repeated/); f.idle(); f.pending.turn.resolve();
});
test('rejected and synchronously throwing producers preserve failure and original behavior', async () => {
  const f = fixture(), id = f.waits.arm('save', 1), error = Error('actual save failure');
  assert.equal(f.root.saveToSlot(1), f.pending.save.promise); f.pending.save.reject(error); await assert.rejects(f.waits.wait(id), /actual save failure/);
  const g = fixture(), realThrow = Error('actual UI throw'); g.root.saveToSlot = function() { throw realThrow; };
  const waits = installCompositeWaits(g.root, 1800000, g.clock), ticket = waits.arm('save', 1);
  assert.throws(() => g.root.saveToSlot(1), e => e === realThrow); await assert.rejects(waits.wait(ticket), /actual UI throw/);
});
for (const change of ['GM', 'P', 'generation', 'timeline']) test('save completion rejects cross-world mutation: ' + change, async () => {
  const f = fixture(), id = f.waits.arm('save', 1); f.root.saveToSlot(1);
  if (change === 'GM') f.root.GM = { ...f.root.GM }; if (change === 'P') f.root.P = {};
  if (change === 'generation') f.root._tmLoadGen++; if (change === 'timeline') f.root.GM._timelineId = 'other';
  f.pending.save.resolve(true); await assert.rejects(f.waits.wait(id), /crossed its original world/);
});
test('duplicate and wrong-slot calls fail while every original invocation still executes exactly once', async () => {
  const f = fixture(), id = f.waits.arm('save', 1);
  assert.equal(f.root.saveToSlot(1), f.pending.save.promise); assert.equal(f.root.saveToSlot(1), f.pending.save.promise);
  assert.equal(f.calls.length, 2); await assert.rejects(f.waits.wait(id), /duplicate/); f.pending.save.resolve(true);
  const g = fixture(), ticket = g.waits.arm('save', 2); assert.equal(g.root.saveToSlot(1), g.pending.save.promise);
  assert.equal(g.calls.length, 1); await assert.rejects(g.waits.wait(ticket), /wrong slot/); g.pending.save.resolve(true);
});
test('a duplicate call after settlement cannot reuse the previous passing ticket', async () => {
  const f = fixture(), id = f.waits.arm('save', 1); f.root.saveToSlot(1); f.pending.save.resolve(true); await f.waits.wait(id);
  f.root.saveToSlot(1); await assert.rejects(f.waits.wait(id), /duplicate/); assert.throws(() => f.waits.arm('save', 1), /failed/);
});
test('load requires its real true receipt and an idle replacement world with an advancing generation', async () => {
  const f = fixture(), id = f.waits.arm('load', 2); assert.equal(f.root.SaveManager.loadFromSlot(2), f.pending.load.promise);
  assert.equal(f.calls[0].receiver, f.root.SaveManager); f.advance(120000);
  f.root.GM = { ...f.root.GM, _timelineId: 'loaded-fork' }; f.root.P = {}; f.root._tmLoadGen++;
  f.pending.load.resolve(true); const result = await f.waits.wait(id); assert.equal(result.slot, 2); assert.equal(result.result, true); assert(result.after.load > result.before.load);
  for (const bad of [false, true]) { const g = fixture(), ticket = g.waits.arm('load', 1); g.root.SaveManager.loadFromSlot(1); g.pending.load.resolve(bad); await assert.rejects(g.waits.wait(ticket), /expected recovered world/); }
});
test('one suite deadline covers all producers, including unstarted UI calls, and never resets', async () => {
  const f = fixture(1000), first = f.waits.arm('save', 1); f.root.saveToSlot(1); f.advance(600); f.pending.save.resolve(true); await f.waits.wait(first);
  const second = f.waits.arm('load', 1); assert.equal([...f.timers.values()][0].at, 1000);
  f.advance(399); assert.equal(f.waits.snapshot()[1].status, 'armed'); f.advance(1);
  await assert.rejects(f.waits.wait(second), /suite deadline/); await assert.rejects(f.waits.wait(first), /suite deadline/);
  assert.throws(() => f.waits.arm('turn'), /suite deadline/); assert(f.waits.snapshot().every(row => row.deadlineAt === 1000));
});
test('finished, failed and timed-out observers release world references and expose only primitive receipts', async () => {
  for (const outcome of ['saved', 'failed', 'deadline']) {
    const f = fixture(1000, true), id = f.waits.arm('save', 1); f.root.saveToSlot(1); assert.equal(f.heldRecords[0].world.gm, f.root.GM);
    if (outcome === 'deadline') f.advance(1000); else f.pending.save.resolve(outcome === 'saved');
    if (outcome === 'saved') await f.waits.wait(id); else await assert.rejects(f.waits.wait(id));
    assert.equal(f.heldRecords[0].world, null); assert.equal(f.heldRecords[0].resolve, null); assert.equal(f.heldRecords[0].reject, null);
    const json = JSON.stringify(f.waits.snapshot()); assert(!json.includes('gmRef')); assert(!json.includes('canonicalSaveReceipt'));
    if (outcome === 'deadline') f.pending.save.resolve(true);
  }
});
test('the actual Electron suite, outer process and CI limits retain 1800 seconds, 1830 seconds and 45 minutes', () => {
  const root = path.resolve(__dirname, '../..'), bridge = fs.readFileSync(path.join(root, 'scripts/electron/bridge-main.cjs'), 'utf8');
  const expression = bridge.match(/^const bridgeTimeoutMs = (.+);$/m)[1];
  assert.equal(vm.runInNewContext(expression, { mode: 'npc-composite', multiScenarioAuthoring: false, visiblePerformance: false }), 1800000);
  assert(bridge.includes('const bridgeDeadlineAt = Date.now() + bridgeTimeoutMs;'));
  assert(bridge.includes("setTimeout(() => finish(new Error('electron-bridge-timeout')), bridgeTimeoutMs)"));
  assert(bridge.includes('deadlineAt: bridgeDeadlineAt'));
  assert.equal(Number(fs.readFileSync(path.join(root, 'scripts/verify-electron-bridge.js'), 'utf8').match(/timeout: mode === 'npc-composite' \? (\d+)/)[1]), 1830000);
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'), /timeout-minutes: \$\{\{ matrix\.group == 'npc-composite' && 45 \|\| 30 \}\}/);
});
(async () => { let pass = 0, fail = 0; for (const t of tests) { try { await t.run(); pass++; console.log('PASS ' + t.name); } catch (e) { fail++; console.error('FAIL ' + t.name + '\n' + e.stack); } } console.log(JSON.stringify({ pass, fail, total: tests.length })); if (fail) process.exitCode = 1; })();
