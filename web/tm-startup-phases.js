// tm-startup-phases.js — observes classic-script startup phases without changing load order.
(function(root) {
  'use strict';

  root.TM = root.TM || {};
  var active = null;
  var completed = [];

  function perf() {
    return root.TM && root.TM.perf;
  }

  function closeActive(metadata) {
    if (!active) return null;
    var provider = perf();
    var result = provider && typeof provider.endSpan === 'function'
      ? provider.endSpan(active.span, metadata || {})
      : null;
    completed.push({ phase: active.phase, result: result });
    active = null;
    return result;
  }

  function transition(phase, metadata) {
    phase = String(phase || '').trim();
    if (!phase) throw new Error('startup phase name is required');
    closeActive({ nextPhase: phase });
    var provider = perf();
    active = {
      phase: phase,
      span: provider && typeof provider.beginSpan === 'function'
        ? provider.beginSpan('startup.phase.' + phase, metadata || {})
        : null
    };
    return active;
  }

  function finish(metadata) {
    return closeActive(metadata || { finished: true });
  }

  root.TMStartupPhases = {
    transition: transition,
    finish: finish,
    report: function() { return completed.slice(); }
  };
  transition('menu', { observer: 'classic-script-order' });
})(typeof window !== 'undefined' ? window : globalThis);
