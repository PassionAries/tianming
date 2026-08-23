#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tm-save-lifecycle.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'tm-endturn-core.js'), 'utf8');
const start = source.indexOf('var _autoSaveInFlight=false;');
const end = source.indexOf('if(_tmHasNativeFs()){', start);
if (start < 0 || end <= start) throw new Error('desktop auto-save runtime slice missing');
const coreStart = coreSource.indexOf('function _tmCaptureEndTurnObject(');
const coreEnd = coreSource.indexOf('async function _tmFinalizeEndTurnTransaction(', coreStart);
if (coreStart < 0 || coreEnd <= coreStart) throw new Error('end-turn transaction runtime slice missing');

let pass = 0;
function check(name, condition) {
  if (!condition) throw new Error('[smoke-desktop-autosave-committed-world] ' + name);
  pass += 1;
  console.log('  PASS - ' + name);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function main() {
  const writes = [];
  let sessionToken = 'session-a';
  let delayedWriteResolve = null;
  let delayNextWrite = false;
  const context = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => 'autosave-test-uuid' },
    window: {
      _tmLoadGen: 4,
      tianming: {
        getAutoSaveSessionToken() { return sessionToken; },
        async autoSave(payload) {
          if (delayNextWrite) {
            delayNextWrite = false;
            await new Promise(resolve => { delayedWriteResolve = resolve; });
          }
          writes.push(clone(payload));
          return { success: true };
        }
      }
    },
    deepClone: clone,
    _tmStripAiKeyInPlace(value) { return value; },
    _tmStripAiKeyView(value) { return value; },
    _tmLiteSafeConf(value) { return value; },
    _prepareGMForSave(gm, p) { return { GM: gm, P: p }; },
    _tmHasNativeFs() { return true; },
    findScenarioById() { return { name: '测试剧本' }; },
    localStorage: { removeItem() {}, setItem() {} }
  };
  context.window.window = context.window;
  context.GM = {
    running: true,
    turn: 8,
    sid: 'scenario-a',
    saveName: '案卷甲',
    _campaignId: 'campaign-a',
    _timelineId: 'timeline-a',
    treasury: 100,
    population: { national: { mouths: 1000 } },
    qijuHistory: [{ turn: 7, text: '已提交' }]
  };
  context.P = { conf: { marker: 'before' }, scenarios: [] };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context, { filename: 'tm-save-lifecycle-autosave-slice.js' });
  vm.runInContext(coreSource.slice(coreStart, coreEnd), context, { filename: 'tm-endturn-core-transaction-slice.js' });

  check('统一世界事务判定函数可用', typeof context.isWorldTransactionActive === 'function');
  const cyclicGM = Object.assign({}, context.GM);
  cyclicGM._postTurnJobs = { pending: [{ id: 'critical', gmRef: cyclicGM }] };
  cyclicGM._postTurnDetachedJobs = [{ id: 'optional', gmRef: cyclicGM }];
  const cycleSafeState = context._buildSaveState({
    format: 'idb', detach: true, prepare: false, gm: cyclicGM, p: context.P
  });
  check('已提交快照排除带 gmRef 环的运行时任务队列', !!cycleSafeState
    && !Object.prototype.hasOwnProperty.call(cycleSafeState.GM, '_postTurnJobs')
    && !Object.prototype.hasOwnProperty.call(cycleSafeState.GM, '_postTurnDetachedJobs'));
  const preTurn = context._buildSaveState({
    format: 'idb',
    detach: true,
    prepare: false,
    gm: context.GM,
    p: context.P
  });
  check('安全快照能够提升为已提交基线', context._tmAdoptCommittedWorldSnapshot(preTurn, {
    turn: 8,
    transactionId: 'pre-turn-8'
  }) === true);

  const endTurnTransaction = context._tmCaptureEndTurnTransaction();
  context.GM.busy = true;
  context.GM._endTurnBusy = true;
  context.GM._endTurnCommitPending = true;
  context.GM.treasury = 60;
  context.GM.population.national.mouths = 850;
  context.GM.qijuHistory.push({ turn: 8, text: '半结算' });
  const duringTurn = await context._tmRunDesktopAutoSaveTick({ force: true });
  check('过回合事务中 timer 只 deferred、不写盘', duringTurn.deferred === true && writes.length === 0);

  check('真实回合事务回滚恢复半结算前 GM/P',
    context._tmRollbackEndTurnTransaction(endTurnTransaction, new Error('injected later system failure')) === true
    && context.GM.treasury === 100
    && context.GM.population.national.mouths === 1000
    && context.GM.qijuHistory.length === 1);
  const afterRollback = await context._tmFlushDeferredDesktopAutoSave('rollback', { immediate: true });
  check('回滚后 deferred 自动档写入一次', afterRollback.ok === true && writes.length === 1);
  check('桌面自动档等于过回合前已提交世界', writes[0].gameState.treasury === 100
    && writes[0].gameState.population.national.mouths === 1000
    && writes[0].gameState.qijuHistory.length === 1);

  const committedTurn9 = context._buildSaveState({
    format: 'idb', detach: true, prepare: false,
    gm: Object.assign({}, context.GM, { turn: 9, treasury: 130, qijuHistory: [{ turn: 8, text: '完成' }] }),
    p: Object.assign({}, context.P, { conf: { marker: 'after' } })
  });
  context._tmAdoptCommittedWorldSnapshot(committedTurn9, { turn: 9, transactionId: 'turn-9' });
  committedTurn9.GM.treasury = 1;
  context.GM.turn = 9;
  const postCommit = await context._tmRunDesktopAutoSaveTick({ force: true });
  check('canonical commit 后自动档推进到新回合', postCommit.ok === true && writes[1]._saveMeta.turn === 9);
  check('已提交快照不引用调用方随后修改的对象', writes[1].gameState.treasury === 130);

  const transactionFlags = [
    function loadHydration() { context.window._tmActiveLoadTransaction = { id: 'load' }; context.GM._loadHydrationPending = true; },
    function rollback() { context.window._tmActiveLoadTransaction = null; context.GM._loadHydrationPending = false; context.window._tmWorldRollbackActive = true; },
    function timeTravel() { context.window._tmWorldRollbackActive = false; context.window._tmActiveTimeTravelTransaction = { id: 'travel' }; }
  ];
  for (const setFlag of transactionFlags) {
    setFlag();
    const beforeWrites = writes.length;
    const result = await context._tmRunDesktopAutoSaveTick({ force: true });
    check('hydration/rollback/time-travel 活跃时均不写盘', result.deferred === true && writes.length === beforeWrites);
  }
  context.window._tmActiveTimeTravelTransaction = null;
  context.window._tmWorldRollbackActive = false;
  context.window._tmActiveLoadTransaction = null;
  context.GM._loadHydrationPending = false;
  await context._tmFlushDeferredDesktopAutoSave('transactions-clear', { immediate: true });

  context.GM.busy = true;
  context.GM._endTurnCommitPending = true;
  const beforeBurst = writes.length;
  await Promise.all([
    context._tmRunDesktopAutoSaveTick({ force: true }),
    context._tmRunDesktopAutoSaveTick({ force: true }),
    context._tmRunDesktopAutoSaveTick({ force: true })
  ]);
  check('连续 timer 不会写入三个不同结算阶段', writes.length === beforeBurst);
  context.GM.busy = false;
  context.GM._endTurnCommitPending = false;
  await context._tmFlushDeferredDesktopAutoSave('burst-clear', { immediate: true });
  check('连续 deferred 最终只补写同一已提交快照一次', writes.length === beforeBurst + 1);

  delayNextWrite = true;
  const firstWrite = context._tmRunDesktopAutoSaveTick({ force: true });
  await Promise.resolve();
  const overlapping = await context._tmRunDesktopAutoSaveTick({ force: true });
  check('IPC 在途锁阻止重叠自动档', overlapping.skipped === true && overlapping.reason === 'in-flight');
  delayedWriteResolve();
  await firstWrite;

  sessionToken = 'session-b';
  context.window._tmAutoSaveSessionToken = sessionToken;
  context.GM._campaignId = 'campaign-b';
  context.GM._timelineId = 'timeline-b';
  const crossWorld = await context._tmRunDesktopAutoSaveTick({ force: true });
  check('新会话不会复用旧战役已提交快照', crossWorld.skipped === true
    && crossWorld.reason === 'no-committed-snapshot');
  const newWorldState = context._buildSaveState({
    format: 'idb', detach: true, prepare: false, gm: context.GM, p: context.P
  });
  check('新世界稳定边界能够建立自己的 committed snapshot',
    context._tmAdoptCommittedWorldSnapshot(newWorldState, {
      turn: context.GM.turn,
      transactionId: 'new-world-loaded',
      takeOwnership: true
    }) === true);
  const newWorldWrite = await context._tmRunDesktopAutoSaveTick({ force: true });
  check('新世界只写入本战役已提交快照', newWorldWrite.ok === true
    && writes[writes.length - 1].gameState._campaignId === 'campaign-b');

  console.log('[smoke-desktop-autosave-committed-world] pass=' + pass);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
