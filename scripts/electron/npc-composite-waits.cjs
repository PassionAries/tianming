'use strict';
// Injected only by the formal Electron test. Original UI producers still own all
// execution and return their original Promises; this observes their completion.
function installCompositeWaits(root, deadlineAt, clock) {
  if (!Number.isFinite(deadlineAt)) throw Error('composite suite deadline missing');
  clock = clock || { now: () => Date.now(), setTimeout: (fn, ms) => root.setTimeout(fn, ms), clearTimeout: id => root.clearTimeout(id) };
  const records = new Map(), active = new Map(); let sequence = 0;
  function state() {
    const g = root.GM || {};
    return { turn: Number(g.turn), load: Number(root._tmLoadGen || 0), campaignId: String(g._campaignId || ''),
      timelineId: String(g._timelineId || ''), busy: !!(g.busy || g._endTurnBusy), pending: !!g._endTurnCommitPending, running: g.running === true };
  }
  function summary(r) {
    return { id: r.id, kind: r.kind, slot: r.slot, invocations: r.invocations, status: r.status,
      before: r.before, after: r.after || null, commit: r.commit || null, result: r.result === true,
      error: r.error || null, deadlineAt, startedAt: r.startedAt || null, finishedAt: r.finishedAt || null };
  }
  function finish(r, error, result) {
    if (r.finished) return;
    if (clock.now() >= deadlineAt) error = Error('composite suite deadline exceeded');
    r.finished = true; r.finishedAt = clock.now(); r.status = error ? 'failed' : 'completed';
    r.error = error ? String(error.message || error) : null; r.result = result === true;
    r.world = null; // Never retain a completed operation's GM/P through test history.
    clock.clearTimeout(r.timer); r.timer = null;
    if (error) r.reject(Error(r.kind + ': ' + r.error)); else r.resolve(summary(r));
    r.resolve = r.reject = null;
  }
  function sameWorld(r) {
    const s = state();
    return r.world && root.GM === r.world.gm && root.P === r.world.p && s.load === r.before.load
      && s.campaignId === r.before.campaignId && s.timelineId === r.before.timelineId;
  }
  function settled(r, value) {
    if (r.finished) return;
    try {
      r.after = state();
      if (r.kind === 'load') {
        if (value !== true || root.GM === r.world.gm || r.after.load <= r.before.load || !r.after.running
            || r.after.campaignId !== r.before.campaignId || r.after.turn !== r.before.turn || r.after.busy || r.after.pending) {
          throw Error('load producer did not confirm the expected recovered world');
        }
      } else {
        if (!sameWorld(r)) throw Error('producer crossed its original world');
        if (r.after.busy || r.after.pending) throw Error('producer settled before a confirmed idle commit');
        if (r.kind === 'turn' && (!r.commit || r.after.turn <= r.before.turn)) throw Error('turn producer has no genuine commit');
        if (r.kind === 'save' && (value !== true || r.after.turn !== r.before.turn)) throw Error('save producer did not return a true commit receipt');
      }
      finish(r, null, r.kind === 'turn' ? true : value);
    } catch (error) { finish(r, error); }
  }
  function observe(owner, key, kind) {
    const original = owner && owner[key];
    if (typeof original !== 'function') throw Error('composite producer missing: ' + key);
    owner[key] = function() {
      const r = active.get(kind);
      if (r) {
        r.invocations++;
        if (r.invocations !== 1) {
          if (r.finished) { r.status = 'failed'; r.error = 'duplicate UI producer invocation'; }
          else finish(r, Error('duplicate UI producer invocation'));
        }
        else if (!sameWorld(r)) finish(r, Error('UI producer started in another world'));
        else if (kind !== 'turn' && arguments[0] !== r.slot) finish(r, Error('UI producer used the wrong slot'));
        else { r.status = 'pending'; r.startedAt = clock.now(); }
      }
      let promise;
      try { promise = original.apply(this, arguments); }
      catch (error) { if (r && !r.finished) finish(r, error); throw error; }
      if (r && !r.finished) {
        if (!promise || typeof promise.then !== 'function') finish(r, Error('UI producer did not return its Promise'));
        else promise.then(value => settled(r, value), error => finish(r, error));
      }
      return promise;
    };
  }
  observe(root, '_endTurnInternal', 'turn');
  observe(root, 'saveToSlot', 'save');
  observe(root.SaveManager, 'loadFromSlot', 'load');
  const originalCommit = root._tmCommitEndTurnTransaction;
  if (typeof originalCommit !== 'function') throw Error('composite commit producer missing');
  root._tmCommitEndTurnTransaction = function(txn) {
    const result = originalCommit.apply(this, arguments), r = active.get('turn');
    if (r && !r.finished && r.invocations === 1 && result === true) {
      const receipt = txn && txn.canonicalSaveReceipt;
      const valid = sameWorld(r) && txn.committed === true && !txn.rolledBack && !txn.saveWriteUnconfirmed
        && txn.gmRef === root.GM && txn.pRef === root.P && txn.loadGen === r.before.load
        && Number(txn.turn) === r.before.turn && txn.campaignId === r.before.campaignId && txn.timelineId === r.before.timelineId
        && receipt && receipt.state === 'committed' && receipt.transactionId === txn.transactionId
        && Array.isArray(receipt.slots) && receipt.slots.length === 2
        && ['autosave', 'slot_0'].every(id => receipt.slots.some(slot => slot.id === id
          && slot.campaignId === r.before.campaignId && slot.timelineId === r.before.timelineId));
      if (!valid || r.commit) finish(r, Error('invalid or repeated canonical turn commit'));
      else r.commit = { transactionId: String(txn.transactionId), turn: state().turn, load: state().load, campaignId: r.before.campaignId,
        timelineId: r.before.timelineId, slots: ['autosave', 'slot_0'] };
    }
    return result;
  };
  return {
    arm(kind, slot) {
      if (!['turn', 'save', 'load'].includes(kind)) throw Error('unknown composite producer');
      if (clock.now() >= deadlineAt) throw Error('composite suite deadline exceeded');
      const previous = active.get(kind);
      if (previous && !previous.finished) throw Error('previous composite producer is still pending');
      if (Array.from(records.values()).some(r => r.status === 'failed')) throw Error('an observed composite producer failed');
      const r = { id: ++sequence, kind, slot: kind === 'turn' ? null : slot, before: state(),
        world: { gm: root.GM, p: root.P }, invocations: 0, status: 'armed', finished: false };
      r.done = new Promise((resolve, reject) => { r.resolve = resolve; r.reject = reject; });
      r.done.catch(() => {}); // UI confirmation may still be open when the shared deadline expires.
      r.timer = clock.setTimeout(() => finish(r, Error('composite suite deadline exceeded')), deadlineAt - clock.now());
      records.set(r.id, r); active.set(kind, r); return r.id;
    },
    wait(id) {
      const r = records.get(id); if (!r) return Promise.reject(Error('unknown composite producer ticket'));
      if (clock.now() >= deadlineAt) { if (!r.finished) finish(r, Error('composite suite deadline exceeded')); return Promise.reject(Error('composite suite deadline exceeded')); }
      if (r.status === 'failed') return Promise.reject(Error(r.kind + ': ' + r.error));
      return r.done;
    },
    snapshot() { return Array.from(records.values(), summary); }
  };
}
module.exports = { installCompositeWaits };
