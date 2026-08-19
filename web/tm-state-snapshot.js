// @ts-check
// ============================================================
// tm-state-snapshot.js — 按对局隔离的完整回合快照与 timeTravel 回溯
//
// 快照与普通存档复用同一个纯快照构造器，避免“只覆盖一部分 GM，
// 其余字段沿用当前局”的混合世界。所有异步边界都复验对局身份。
// ============================================================

(function(global) {
  'use strict';

  var DB_NAME = 'tianming_snapshots';
  var LEGACY_STORE = 'snapshots';
  var STORE = 'snapshots_v2';
  var DB_VERSION = 3;
  var MAX_SNAPSHOTS = 200;
  var _dbPromise = null;

  function _newCampaignId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return 'tmc_' + global.crypto.randomUUID();
      }
    } catch (_) {}
    return 'tmc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14)
      + '_' + Math.random().toString(36).slice(2, 10);
  }

  function _ensureCampaignId(gm) {
    if (!gm) return '';
    var id = typeof gm._campaignId === 'string' ? gm._campaignId.trim() : '';
    if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) id = _newCampaignId();
    gm._campaignId = id;
    return id;
  }

  function _ensureTimelineId(gm) {
    if (!gm) return '';
    try {
      if (typeof global._tmEnsureTimelineId === 'function') return global._tmEnsureTimelineId(gm);
    } catch (_) {}
    var id = typeof gm._timelineId === 'string' ? gm._timelineId.trim() : '';
    if (!/^tml_[A-Za-z0-9_-]{8,124}$/.test(id)) id = 'tml_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14);
    gm._timelineId = id;
    return id;
  }

  function _strictTurn(turn) {
    var n = typeof turn === 'number' ? turn : Number(String(turn == null ? '' : turn).trim());
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000000) throw new Error('非法回合号: ' + turn);
    return n;
  }

  function _recordId(campaignId, timelineId, turn) {
    return campaignId + ':' + timelineId + ':' + _strictTurn(turn);
  }

  function _deepClone(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    try {
      if (typeof structuredClone === 'function') return structuredClone(obj);
    } catch (_) {}
    return JSON.parse(JSON.stringify(obj));
  }

  function _openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function(resolve, reject) {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB 不可用'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('campaignId', 'campaignId', { unique: false });
          store.createIndex('campaignTimeline', ['campaignId', 'timelineId'], { unique: false });
          store.createIndex('timelineTurn', ['campaignId', 'timelineId', 'turn'], { unique: true });
        } else if (e.oldVersion < 3) {
          var existingStore = e.target.transaction.objectStore(STORE);
          try { existingStore.createIndex('campaignTimeline', ['campaignId', 'timelineId'], { unique: false }); } catch (_) {}
          try { existingStore.createIndex('timelineTurn', ['campaignId', 'timelineId', 'turn'], { unique: true }); } catch (_) {}
        }
        // v1 的 partial GM 快照不能安全升级成完整 {GM,P}，保留旧 store 只读，
        // 但绝不混入 v2 列表或恢复路径。
        if (!db.objectStoreNames.contains(LEGACY_STORE)) {
          db.createObjectStore(LEGACY_STORE, { keyPath: 'turn' });
        }
      };
      req.onsuccess = function(e) {
        var db = e.target.result;
        db.onversionchange = function() { try { db.close(); } catch (_) {} _dbPromise = null; };
        resolve(db);
      };
      req.onerror = function(e) { _dbPromise = null; reject(e.target.error || new Error('快照数据库打开失败')); };
      req.onblocked = function() { _dbPromise = null; reject(new Error('快照数据库升级被其他窗口阻塞')); };
    });
    return _dbPromise;
  }

  function _captureFullState(gm, p) {
    var builder = global._buildSaveState;
    if (typeof builder !== 'function' && typeof _buildSaveState === 'function') builder = _buildSaveState;
    if (typeof builder !== 'function') throw new Error('完整存档快照构造器未就绪');
    var state = builder({ format: 'idb', detach: true, gm: gm, p: p || {} });
    if (!state || !state.GM || !state.P || typeof state.GM !== 'object' || typeof state.P !== 'object') {
      throw new Error('完整存档快照构造失败');
    }
    return state;
  }

  function _putRecord(record) {
    return _openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(record);
          tx.oncomplete = function() { resolve(record); };
          tx.onerror = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照写入失败')); };
          tx.onabort = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照事务已中止')); };
        } catch (e) { reject(e); }
      });
    });
  }

  function _getAllRecords() {
    return _openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE, 'readonly');
          var req = tx.objectStore(STORE).getAll();
          req.onsuccess = function(e) { resolve(e.target.result || []); };
          req.onerror = function(e) { reject(e.target.error || new Error('快照列表读取失败')); };
          tx.onabort = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照读取事务已中止')); };
        } catch (e) { reject(e); }
      });
    });
  }

  function _enforceLRU(campaignId, timelineId, max) {
    return _getAllRecords().then(function(records) {
      var own = records.filter(function(r) { return r && r.campaignId === campaignId && r.timelineId === timelineId; });
      own.sort(function(a, b) { return (a.turn - b.turn) || (a.ts - b.ts); });
      var remove = own.slice(0, Math.max(0, own.length - max));
      if (!remove.length) return;
      return _openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
          var tx;
          try {
            tx = db.transaction(STORE, 'readwrite');
            var store = tx.objectStore(STORE);
            remove.forEach(function(r) { store.delete(r.id); });
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照清理失败')); };
            tx.onabort = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照清理事务已中止')); };
          } catch (e) { reject(e); }
        });
      });
    });
  }

  function _saveSnapshotFrom(gm, p, requestedTurn, requestedCampaignId, requestedTimelineId) {
    try {
      if (!gm) return Promise.resolve({ ok: false, reason: 'no GM' });
      var campaignId = requestedCampaignId || _ensureCampaignId(gm);
      if (campaignId !== _ensureCampaignId(gm)) {
        return Promise.resolve({ ok: false, reason: 'campaign mismatch' });
      }
      var timelineId = requestedTimelineId || _ensureTimelineId(gm);
      if (timelineId !== _ensureTimelineId(gm)) return Promise.resolve({ ok: false, reason: 'timeline mismatch' });
      var turn = _strictTurn(requestedTurn == null ? gm.turn : requestedTurn);
      if (_strictTurn(gm.turn) !== turn) return Promise.resolve({ ok: false, reason: 'turn mismatch' });
      var state = _captureFullState(gm, p);
      var record = {
        id: _recordId(campaignId, timelineId, turn),
        campaignId: campaignId,
        timelineId: timelineId,
        turn: turn,
        ts: Date.now(),
        schema: 2,
        state: state
      };
      return _putRecord(record).then(function() {
        return _enforceLRU(campaignId, timelineId, MAX_SNAPSHOTS).catch(function(e) {
          try { console.warn('[StateSnapshot] LRU 清理失败，快照本身已写入', e); } catch (_) {}
        });
      }).then(function() {
        return { ok: true, turn: turn, campaignId: campaignId, timelineId: timelineId, record: record };
      }).catch(function(e) { return { ok: false, error: e }; });
    } catch (e) {
      return Promise.resolve({ ok: false, error: e });
    }
  }

  function saveSnapshot(turn) {
    var gm = global.GM || (typeof GM !== 'undefined' ? GM : null);
    var p = global.P || (typeof P !== 'undefined' ? P : null);
    return _saveSnapshotFrom(gm, p, turn, gm ? _ensureCampaignId(gm) : '', gm ? _ensureTimelineId(gm) : '');
  }

  function loadSnapshot(turn, campaignId, timelineId) {
    try {
      var gm = global.GM || (typeof GM !== 'undefined' ? GM : null);
      campaignId = campaignId || (gm ? _ensureCampaignId(gm) : '');
      timelineId = timelineId || (gm ? _ensureTimelineId(gm) : '');
      if (!campaignId || !timelineId) return Promise.resolve(null);
      var id = _recordId(campaignId, timelineId, turn);
      return _openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
          var tx;
          try {
            tx = db.transaction(STORE, 'readonly');
            var req = tx.objectStore(STORE).get(id);
            req.onsuccess = function(e) { resolve(e.target.result || null); };
            req.onerror = function(e) { reject(e.target.error || new Error('快照读取失败')); };
            tx.onabort = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照读取事务已中止')); };
          } catch (e) { reject(e); }
        });
      });
    } catch (e) { return Promise.reject(e); }
  }

  function listSnapshots(campaignId, timelineId) {
    var gm = global.GM || (typeof GM !== 'undefined' ? GM : null);
    campaignId = campaignId || (gm ? _ensureCampaignId(gm) : '');
    timelineId = timelineId || (gm ? _ensureTimelineId(gm) : '');
    if (!campaignId || !timelineId) return Promise.resolve([]);
    return _getAllRecords().then(function(records) {
      return records.filter(function(r) { return r && r.campaignId === campaignId && r.timelineId === timelineId; })
        .sort(function(a, b) { return a.turn - b.turn; })
        .map(function(r) { return { turn: r.turn, ts: r.ts, campaignId: r.campaignId, timelineId: r.timelineId }; });
    });
  }

  function deleteSnapshot(turn, campaignId, timelineId) {
    try {
      var gm = global.GM || (typeof GM !== 'undefined' ? GM : null);
      campaignId = campaignId || (gm ? _ensureCampaignId(gm) : '');
      timelineId = timelineId || (gm ? _ensureTimelineId(gm) : '');
      if (!campaignId || !timelineId) return Promise.resolve({ ok: false, reason: 'no world identity' });
      var id = _recordId(campaignId, timelineId, turn);
      return _openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
          var tx;
          try {
            tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = function() { resolve({ ok: true }); };
            tx.onerror = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照删除失败')); };
            tx.onabort = function(e) { reject((e.target && e.target.error) || tx.error || new Error('快照删除事务已中止')); };
          } catch (e) { reject(e); }
        });
      });
    } catch (e) { return Promise.reject(e); }
  }

  function _loadGen() { return Number(global._tmLoadGen || 0); }

  function _stillCurrent(gm, p, loadGen, campaignId, timelineId) {
    return global.GM === gm && global.P === p && _loadGen() === loadGen
      && !!gm && gm._campaignId === campaignId && gm._timelineId === timelineId;
  }

  function _restoreFullState(state, loadOptions) {
    if (!state || !state.GM || !state.P) return Promise.reject(new Error('快照结构不完整'));
    var payload = { gameState: { GM: _deepClone(state.GM), P: _deepClone(state.P) } };
    var loader = global.fullLoadGame;
    if (typeof loader !== 'function' && typeof fullLoadGame === 'function') loader = fullLoadGame;
    if (typeof loader === 'function') {
      try { return Promise.resolve(loader(payload, loadOptions || { source: 'time-travel' })); }
      catch (e) { return Promise.reject(e); }
    }
    // 测试/最小运行环境兜底；正式游戏始终走 fullLoadGame 的默认值、迁移和重建链。
    global.GM = payload.gameState.GM;
    global.P = payload.gameState.P;
    global._tmLoadGen = _loadGen() + 1;
    return Promise.resolve();
  }

  function timeTravel(targetTurn, opts) {
    opts = opts || {};
    var sourceGM = global.GM || (typeof GM !== 'undefined' ? GM : null);
    var sourceP = global.P || (typeof P !== 'undefined' ? P : null);
    if (!sourceGM) return Promise.resolve({ ok: false, reason: 'no GM' });
    var target;
    var currentTurn;
    try {
      target = _strictTurn(targetTurn);
      currentTurn = _strictTurn(sourceGM.turn);
    } catch (e) { return Promise.resolve({ ok: false, error: e }); }
    var campaignId = _ensureCampaignId(sourceGM);
    var timelineId = _ensureTimelineId(sourceGM);
    var sourceLoadGen = _loadGen();
    var keepShiji = opts.keepShijiHistory ? _deepClone(sourceGM.shijiHistory || []) : null;
    var keepEvt = opts.keepEvtLog ? _deepClone(sourceGM.evtLog || []) : null;

    return loadSnapshot(target, campaignId, timelineId).then(function(targetRecord) {
      if (!targetRecord) return { ok: false, reason: 'no snapshot for turn ' + target };
      if (!targetRecord.state || targetRecord.campaignId !== campaignId || targetRecord.timelineId !== timelineId || targetRecord.turn !== target) {
        return { ok: false, reason: 'snapshot identity mismatch' };
      }
      if (!_stillCurrent(sourceGM, sourceP, sourceLoadGen, campaignId, timelineId)) {
        return { ok: false, reason: 'stale game before travel' };
      }
      // 在应用目标局之前同步、完整地保存返航点；失败即不动 live 状态。
      return _saveSnapshotFrom(sourceGM, sourceP, currentTurn, campaignId, timelineId).then(function(saved) {
        if (!saved || saved.ok !== true) return { ok: false, reason: 'failed to save return point', error: saved && saved.error };
        if (!_stillCurrent(sourceGM, sourceP, sourceLoadGen, campaignId, timelineId)) {
          return { ok: false, reason: 'stale game during travel' };
        }
        return _restoreFullState(targetRecord.state, { source: 'time-travel' }).then(function() {
          var restoredGM = global.GM || (typeof GM !== 'undefined' ? GM : null);
          var restoredP = global.P || (typeof P !== 'undefined' ? P : null);
          if (!restoredGM || restoredGM._campaignId !== campaignId || Number(restoredGM.turn) !== target) {
            throw new Error('恢复后的快照身份不匹配');
          }
          if (keepShiji) restoredGM.shijiHistory = keepShiji;
          if (keepEvt) restoredGM.evtLog = keepEvt;
          try { delete restoredGM._turnAiResults; } catch (_) {}
          try { delete restoredGM._postTurnJobs; } catch (_) {}
          if (!Array.isArray(restoredGM._timeTravelHistory)) restoredGM._timeTravelHistory = [];
          restoredGM._timeTravelHistory.push({ from: currentTurn, to: target, ts: Date.now() });
          var restoredTimelineId = _ensureTimelineId(restoredGM);
          // fullLoadGame 会为时间回溯建立子时间线。目标点和刚保存的返航点都必须
          // 继承到子时间线，否则玩家回溯成功后会立刻失去返回原回合的入口。
          var inheritedReturnRecord = null;
          if (currentTurn !== target) {
            inheritedReturnRecord = _deepClone(saved.record);
            inheritedReturnRecord.id = _recordId(campaignId, restoredTimelineId, currentTurn);
            inheritedReturnRecord.timelineId = restoredTimelineId;
            inheritedReturnRecord.ts = Date.now();
            if (inheritedReturnRecord.state && inheritedReturnRecord.state.GM) {
              inheritedReturnRecord.state.GM._timelineId = restoredTimelineId;
              inheritedReturnRecord.state.GM._parentTimelineId = restoredGM._parentTimelineId || timelineId;
              inheritedReturnRecord.state.GM._forkTurn = restoredGM._forkTurn;
              inheritedReturnRecord.state.GM._timelineForkReason = restoredGM._timelineForkReason || 'time-travel';
            }
          }
          return Promise.all([
            _saveSnapshotFrom(restoredGM, restoredP, target, campaignId, restoredTimelineId),
            inheritedReturnRecord ? _putRecord(inheritedReturnRecord) : Promise.resolve(true)
          ]).then(function(branchWrites) {
            if (!(branchWrites[0] && branchWrites[0].ok === true)) throw new Error('子时间线目标快照写入失败');
            return {
              ok: true,
              restoredTurn: target,
              savedFromTurn: currentTurn,
              campaignId: campaignId,
              timelineId: restoredTimelineId
            };
          });
        }).catch(function(restoreError) {
          // 目标恢复异常时尽力回到刚写入的完整返航点。
          return _restoreFullState(saved.record.state, { source: 'time-travel-rollback', preserveTimeline: true }).then(function() {
            return { ok: false, reason: 'restore failed', error: restoreError, rolledBack: true };
          }).catch(function(rollbackError) {
            return { ok: false, reason: 'restore and rollback failed', error: restoreError, rollbackError: rollbackError };
          });
        });
      });
    }).catch(function(e) { return { ok: false, error: e }; });
  }

  function registerAutoSnapshot() {
    if (typeof EndTurnHooks === 'undefined' || !EndTurnHooks || !EndTurnHooks.register) return false;
    EndTurnHooks.register('after', function() {
      var gm = global.GM || (typeof GM !== 'undefined' ? GM : null);
      var t = gm ? Number(gm.turn) : 0;
      if (!Number.isSafeInteger(t) || t <= 0) return Promise.resolve();
      // EndTurnHooks.execute 会 await 返回值；失败抛出并由统一 hook 错误通道记录。
      return saveSnapshot(t).then(function(result) {
        if (!result || result.ok !== true) throw (result && result.error) || new Error('回合快照未落库');
        return result;
      });
    }, 'StateSnapshot.autoSave');
    return true;
  }

  function _tryRegister() {
    if (registerAutoSnapshot()) return;
    if (global && typeof global.addEventListener === 'function') {
      global.addEventListener('DOMContentLoaded', function() { registerAutoSnapshot(); });
    }
  }
  _tryRegister();

  global._tmNewCampaignId = _newCampaignId;
  global.StateSnapshot = {
    save: saveSnapshot,
    load: loadSnapshot,
    list: listSnapshots,
    delete: deleteSnapshot,
    timeTravel: timeTravel,
    newCampaignId: _newCampaignId
  };
  Object.defineProperty(global, '_timeTravel', { value: timeTravel, writable: false, configurable: true });
})(typeof window !== 'undefined' ? window : this);
