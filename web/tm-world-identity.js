// @ts-check
// ============================================================
// tm-world-identity.js — campaign / timeline identity
//
// campaignId identifies one playthrough family. timelineId identifies one
// concrete branch inside that family. Loading a saved snapshot hydrates its
// parent branch first, then forks before gameplay is enabled.
// ============================================================

(function(global) {
  'use strict';

  function _validId(value, prefix) {
    value = typeof value === 'string' ? value.trim() : '';
    return value.length >= prefix.length + 8 && value.length <= 128 && value.indexOf(prefix) === 0
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function _newId(prefix) {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return prefix + global.crypto.randomUUID().replace(/-/g, '_');
      }
    } catch (_) {}
    return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14)
      + '_' + Math.random().toString(36).slice(2, 10);
  }

  function newTimelineId() {
    return _newId('tml_');
  }

  function ensureTimelineId(gm) {
    if (!gm || typeof gm !== 'object') return '';
    var id = gm._timelineId;
    if (!_validId(id, 'tml_')) id = newTimelineId();
    gm._timelineId = id;
    return id;
  }

  function forkTimeline(gm, reason) {
    if (!gm || typeof gm !== 'object') return '';
    var parent = ensureTimelineId(gm);
    var next = newTimelineId();
    gm._parentTimelineId = parent;
    gm._timelineId = next;
    gm._forkTurn = Number.isSafeInteger(Number(gm.turn)) ? Number(gm.turn) : 0;
    gm._timelineForkReason = String(reason || 'load').slice(0, 80);
    return next;
  }

  global.TMWorldIdentity = {
    newTimelineId: newTimelineId,
    ensureTimelineId: ensureTimelineId,
    forkTimeline: forkTimeline,
    isValidTimelineId: function(value) { return _validId(value, 'tml_'); }
  };
  global._tmNewTimelineId = newTimelineId;
  global._tmEnsureTimelineId = ensureTimelineId;
  global._tmForkTimeline = forkTimeline;
})(typeof window !== 'undefined' ? window : this);
