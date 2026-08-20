#!/usr/bin/env node
'use strict';

// StateSnapshot v4：旧快照迁移、祖先只读继承、完整状态恢复、异步身份租约与 awaited hook。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'tm-state-snapshot.js'), 'utf8');
let pass = 0;
function ok(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); pass++; console.log('  ok - ' + msg); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

function fakeIndexedDB(options) {
  options = options || {};
  const stores = new Map();
  const deletedIndexes = [];
  if (Array.isArray(options.records)) {
    stores.set('snapshots_v2', {
      keyPath: 'id',
      rows: new Map(options.records.map(record => [String(record.id), clone(record)])),
      indexes: new Set(options.indexes || ['campaignId', 'campaignTurn'])
    });
    stores.set('snapshots', { keyPath: 'turn', rows: new Map(), indexes: new Set() });
  }
  function storeFacade(def) {
    function completeLater(tx) { setTimeout(function() { if (tx && tx.oncomplete) tx.oncomplete(); }, 0); }
    return {
      indexNames: { contains(name) { return def.indexes.has(name); } },
      createIndex(name) { def.indexes.add(name); },
      deleteIndex(name) { def.indexes.delete(name); deletedIndexes.push(name); },
      put(record) { def.rows.set(String(record[def.keyPath]), clone(record)); return {}; },
      get(key) {
        const req = {};
        setTimeout(function() { if (req.onsuccess) req.onsuccess({ target: { result: def.rows.has(String(key)) ? clone(def.rows.get(String(key))) : undefined } }); }, 0);
        return req;
      },
      getAll() {
        const req = {};
        setTimeout(function() { if (req.onsuccess) req.onsuccess({ target: { result: Array.from(def.rows.values()).map(clone) } }); }, 0);
        return req;
      },
      delete(key) { def.rows.delete(String(key)); return {}; },
      openCursor() {
        const req = {};
        const values = Array.from(def.rows.values()).map(clone);
        let cursorIndex = 0;
        function advance() {
          setTimeout(function() {
            req.result = cursorIndex < values.length ? { value: values[cursorIndex++], continue: advance } : null;
            if (req.onsuccess) req.onsuccess({ target: req });
          }, 0);
        }
        advance();
        return req;
      },
      _completeLater: completeLater
    };
  }
  const db = {
    objectStoreNames: { contains(name) { return stores.has(name); } },
    createObjectStore(name, options) {
      if (!stores.has(name)) stores.set(name, { keyPath: options.keyPath, rows: new Map(), indexes: new Set() });
      return storeFacade(stores.get(name));
    },
    close() {},
    transaction(name) {
      if (!stores.has(name)) throw new Error('missing store ' + name);
      const def = stores.get(name);
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
      function completeLater() { setTimeout(function() { if (tx.oncomplete) tx.oncomplete(); }, 0); }
      tx.objectStore = function() {
        const facade = storeFacade(def);
        const put = facade.put;
        const del = facade.delete;
        facade.put = function(record) { const result = put(record); completeLater(); return result; };
        facade.delete = function(key) { const result = del(key); completeLater(); return result; };
        return facade;
      };
      return tx;
    }
  };
  return {
    stores,
    deletedIndexes,
    open(_name, version) {
      const req = {};
      setTimeout(function() {
        const upgradeTx = { objectStore(name) { return storeFacade(stores.get(name)); } };
        if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion: Number(options.oldVersion) || 0, target: { result: db, transaction: upgradeTx } });
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    }
  };
}

(async function() {
  let registeredHook = null;
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, Number,
    setTimeout, clearTimeout, structuredClone,
    crypto: { randomUUID: function() { return 'fixed-id'; } },
    indexedDB: fakeIndexedDB(),
    EndTurnHooks: {
      register(phase, callback, name) {
        if (phase === 'after' && name === 'StateSnapshot.autoSave') registeredHook = callback;
      }
    },
    addEventListener() {}
  };
  ctx.window = ctx;
  ctx._tmLoadGen = 0;
  ctx._buildSaveState = function(options) {
    return { GM: clone(options.gm), P: clone(options.p || {}) };
  };
  let forkSeq = 0;
  ctx.fullLoadGame = function(payload, options) {
    ctx.GM = clone(payload.gameState.GM);
    ctx.P = clone(payload.gameState.P);
    if (!(options && options.preserveTimeline)) {
      const parentTimelineId = ctx.GM._timelineId;
      ctx.GM._parentTimelineId = parentTimelineId;
      ctx.GM._timelineId = 'tml_time_travel_fork_' + (++forkSeq) + '_12345678';
      ctx.GM._forkTurn = ctx.GM.turn;
      ctx.GM._timelineForkReason = options && options.source || 'load';
    }
    ctx._tmLoadGen++;
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  ok(/DB_VERSION = 4/.test(src) && /keyPath: 'id'/.test(src), 'v4 使用 campaign/timeline/turn compound record id');
  ok(/_buildSaveState/.test(src) && /format: 'idb', detach: true/.test(src), '快照复用完整纯存档 builder');
  ok(registeredHook && typeof registeredHook === 'function', 'after hook 已注册');

  function expectedLegacyTimeline(campaignId) {
    let hash = 2166136261;
    for (let i = 0; i < campaignId.length; i++) {
      hash ^= campaignId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return 'tml_legacy_' + (hash >>> 0).toString(16).padStart(8, '0') + '_' + campaignId;
  }
  const legacyCampaign = 'campaignLegacy';
  const legacyTimeline = expectedLegacyTimeline(legacyCampaign);
  const legacyDb = fakeIndexedDB({
    oldVersion: 2,
    records: [{
      id: legacyCampaign + ':4', campaignId: legacyCampaign, turn: 4, ts: 4, schema: 2,
      state: { GM: { _campaignId: legacyCampaign, turn: 4, marker: 'legacy-v2' }, P: { conf: { legacy: true } } }
    }]
  });
  const legacyCtx = {
    console, Promise, Date, Math, JSON, Object, Array, Number,
    setTimeout, clearTimeout, structuredClone,
    indexedDB: legacyDb,
    EndTurnHooks: { register() {} }, addEventListener() {},
    _buildSaveState(options) { return { GM: clone(options.gm), P: clone(options.p || {}) }; }
  };
  legacyCtx.window = legacyCtx;
  vm.createContext(legacyCtx);
  vm.runInContext(src, legacyCtx);
  await legacyCtx.StateSnapshot.list(legacyCampaign, legacyTimeline);
  await new Promise(resolve => setTimeout(resolve, 20));
  const migratedLegacy = await legacyCtx.StateSnapshot.load(4, legacyCampaign, legacyTimeline);
  ok(migratedLegacy && migratedLegacy.state.GM.marker === 'legacy-v2'
    && migratedLegacy.state.GM._timelineId === legacyTimeline
    && migratedLegacy.migrationState === 'legacy-v2',
  'v2 campaign-only snapshot migrates atomically into deterministic legacy timeline');
  ok(legacyDb.deletedIndexes.includes('campaignTurn'), 'v4 upgrade removes obsolete unique campaignTurn index');

  ctx.GM = { _campaignId: 'campA', _timelineId: 'tml_campA_12345678', turn: 1, marker: 'A1', customWorld: { deep: 11 }, shijiHistory: [{ turn: 1, a: 1 }], evtLog: [{ turn: 1 }] };
  ctx.P = { conf: { campaign: 'A' }, mapData: { a: 1 } };
  let r = await ctx.StateSnapshot.save(1);
  ok(r.ok === true, 'campA/T1 完整快照写入');

  ctx.GM.turn = 2; ctx.GM.marker = 'A2'; ctx.GM.customWorld.deep = 22;
  ctx.GM.shijiHistory.push({ turn: 2, a: 2 }); ctx.P.mapData.a = 2;
  r = await ctx.StateSnapshot.save(2);
  ok(r.ok === true && (await ctx.StateSnapshot.list()).length === 2, '同局多回合可列出');

  ctx.GM = {
    _campaignId: 'campA', _timelineId: 'tml_childA_12345678', _parentTimelineId: 'tml_campA_12345678',
    _forkTurn: 2, turn: 2, marker: 'A2-child', customWorld: { deep: 23 }, shijiHistory: [], evtLog: []
  };
  ctx.P = { conf: { campaign: 'A-child' }, mapData: { a: 23 } };
  const inheritedList = await ctx.StateSnapshot.list();
  const inheritedA1 = await ctx.StateSnapshot.load(1);
  ok(inheritedList.map(item => item.turn).join(',') === '1,2'
    && inheritedList.every(item => item.inherited === true)
    && inheritedA1 && inheritedA1.inherited === true && inheritedA1.state.GM.marker === 'A1',
  '子时间线以父链只读继承 forkTurn 以前的完整快照列表');
  r = await ctx.StateSnapshot.save(2);
  const childOverrideList = await ctx.StateSnapshot.list();
  ok(r.ok === true && childOverrideList[0].inherited === true && childOverrideList[1].inherited === false
    && (await ctx.StateSnapshot.load(2)).state.GM.marker === 'A2-child',
  '子时间线同回合快照覆盖父线视图但不复制其他祖先 payload');

  ctx.GM = { _campaignId: 'campB', _timelineId: 'tml_campB_12345678', turn: 1, marker: 'B1', customWorld: { deep: 99 }, shijiHistory: [], evtLog: [] };
  ctx.P = { conf: { campaign: 'B' } };
  r = await ctx.StateSnapshot.save(1);
  const listB = await ctx.StateSnapshot.list();
  const b1 = await ctx.StateSnapshot.load(1);
  const a1 = await ctx.StateSnapshot.load(1, 'campA', 'tml_campA_12345678');
  ok(r.ok === true && listB.length === 1 && b1.state.GM.marker === 'B1', '同回合不同 campaign 不覆盖、默认列表只见当前局');
  ok(a1.state.GM.marker === 'A1' && a1.state.P.conf.campaign === 'A', '显式 campaign 可读回原局快照');

  // 回到 campA/T2，再穿越 T1；未在旧 partial 白名单里的 customWorld/P.mapData 也必须恢复。
  ctx.GM = { _campaignId: 'campA', _timelineId: 'tml_campA_12345678', turn: 2, marker: 'A2-live', customWorld: { deep: 222 }, shijiHistory: [{ turn: 2, current: true }], evtLog: [{ turn: 2 }] };
  ctx.P = { conf: { campaign: 'A-live' }, mapData: { a: 222 } };
  ctx._tmLoadGen++;
  r = await ctx.StateSnapshot.timeTravel(1);
  ok(r.ok === true && ctx.GM.turn === 1 && ctx.GM.marker === 'A1', 'timeTravel 恢复目标回合身份');
  ok(ctx.GM.customWorld.deep === 11 && ctx.P.mapData.a === 1 && ctx.P.conf.campaign === 'A', '完整 GM/P 恢复，不叠加当前局字段');
  ok(ctx.GM.shijiHistory.length === 1 && ctx.GM.shijiHistory[0].turn === 1, '默认使用目标快照历史，不覆盖当前历史');
  ok(!ctx.GM._postTurnJobs && !ctx.GM._turnAiResults, '恢复后清理临时任务');
  const forkedTimeline = ctx.GM._timelineId;
  const forkedSnapshots = await ctx.StateSnapshot.list('campA', forkedTimeline);
  const forkedReturn = await ctx.StateSnapshot.load(2, 'campA', forkedTimeline);
  ok(forkedTimeline !== 'tml_campA_12345678' && ctx.GM._parentTimelineId === 'tml_campA_12345678',
    'timeTravel 恢复目标后建立明确的子时间线');
  ok(forkedSnapshots.map(item => item.turn).join(',') === '1,2'
    && forkedReturn.state.GM._timelineId === forkedTimeline && forkedReturn.state.GM.marker === 'A2-live',
  '子时间线同时继承目标快照和返航点，分支隔离不破坏返回能力');

  // 异步读取期间换局：旧请求必须失效，不能覆盖新局。
  ctx.GM = { _campaignId: 'campA', _timelineId: 'tml_campA_12345678', turn: 2, marker: 'source-before-stale', shijiHistory: [], evtLog: [] };
  ctx.P = { conf: { campaign: 'A' } };
  ctx._tmLoadGen++;
  const pending = ctx.StateSnapshot.timeTravel(1);
  ctx.GM = { _campaignId: 'campB', _timelineId: 'tml_campB_12345678', turn: 1, marker: 'new-live', shijiHistory: [], evtLog: [] };
  ctx.P = { conf: { campaign: 'B' } };
  ctx._tmLoadGen++;
  r = await pending;
  ok(r.ok === false && /stale game/.test(r.reason) && ctx.GM.marker === 'new-live', '跨异步边界换局后拒绝旧 timeTravel');

  // hook 返回真实 Promise；EndTurnHooks.execute 可 await 落库完成。
  ctx.GM = { _campaignId: 'campHook', _timelineId: 'tml_campHook_12345678', turn: 3, marker: 'hook', shijiHistory: [], evtLog: [] };
  ctx.P = { conf: {} };
  const hookResult = registeredHook();
  ok(hookResult && typeof hookResult.then === 'function', '自动快照 hook 返回 Promise');
  r = await hookResult;
  ok(r.ok === true && (await ctx.StateSnapshot.load(3)).state.GM.marker === 'hook', 'await hook 后快照已落库');

  ok(/_stillCurrent\(sourceGM, sourceP, sourceLoadGen, campaignId, timelineId\)/.test(src), 'timeTravel 在异步边界复验 GM/P/loadGen/campaign/timeline');
  ok(/failed to save return point/.test(src) && /time-travel-rollback/.test(src), '返航点失败不恢复，目标恢复失败会回滚');
  ok(/return saveSnapshot\(t\)\.then/.test(src), '自动 hook 显式返回保存链');

  console.log('\n[smoke-state-snapshot-integrity] pass=' + pass);
})().catch(function(e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
