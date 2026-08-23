// tm-world-era.js — current-world dynasty/era resolution shared by runtime consumers.
(function(root) {
  'use strict';

  var CURRENCY_DYNASTY_ALIASES = [
    ['明清更迭', '明'],
    ['五代十国', '五代'],
    ['南北朝', '南北朝'],
    ['北宋', '宋'],
    ['南宋', '宋'],
    ['南明', '明'],
    ['秦汉', '秦'],
    ['先秦', '先秦'],
    ['西汉', '汉'],
    ['东汉', '汉'],
    ['两汉', '汉'],
    ['漢', '汉'],
    ['曹魏', '魏晋'],
    ['西晋', '魏晋'],
    ['东晋', '魏晋'],
    ['魏晋', '魏晋'],
    ['晉', '魏晋'],
    ['民国', '民国'],
    ['五代', '五代'],
    ['秦', '秦'],
    ['汉', '汉'],
    ['魏', '魏晋'],
    ['晋', '魏晋'],
    ['隋', '隋'],
    ['唐', '唐'],
    ['宋', '宋'],
    ['辽', '辽'],
    ['金', '金'],
    ['元', '元'],
    ['明', '明'],
    ['清', '清']
  ];

  function _capture(error, label) {
    if (root.TM && root.TM.errors && typeof root.TM.errors.capture === 'function') {
      root.TM.errors.capture(error, label);
      return;
    }
    if (root.console && typeof root.console.warn === 'function') {
      root.console.warn('[TMWorldEra] ' + label, error);
    }
  }

  function _text(value) {
    if (value === undefined || value === null) return '';
    var text = String(value).trim();
    return text;
  }

  function currentScenario(G) {
    G = G || root.GM || null;
    if (!G || !_text(G.sid) || typeof root.findScenarioById !== 'function') return null;
    try {
      var scenario = root.findScenarioById(G.sid);
      return scenario && typeof scenario === 'object' ? scenario : null;
    } catch (error) {
      _capture(error, 'resolve-current-scenario');
      return null;
    }
  }

  function resolveDetail(G, player, editorData) {
    G = G || root.GM || null;
    player = player || root.P || null;
    editorData = editorData || root.scriptData || null;
    var scenario = currentScenario(G);
    var candidates = [
      ['scenario.dynasty', scenario && scenario.dynasty],
      ['scenario.era', scenario && scenario.era],
      ['GM.eraState.dynasty', G && G.eraState && G.eraState.dynasty],
      ['GM.eraState.era', G && G.eraState && G.eraState.era],
      ['GM.dynasty', G && G.dynasty],
      ['GM.era', G && G.era],
      ['P.dynasty', player && player.dynasty],
      ['P.era', player && player.era],
      ['scriptData.dynasty', editorData && editorData.dynasty],
      ['scriptData.settings.dynasty', editorData && editorData.settings && editorData.settings.dynasty]
    ];
    for (var i = 0; i < candidates.length; i++) {
      var value = _text(candidates[i][1]);
      if (value) return { value: value, source: candidates[i][0], scenario: scenario };
    }
    return { value: '', source: 'default', scenario: scenario };
  }

  function resolve(G, player, editorData) {
    return resolveDetail(G, player, editorData).value;
  }

  function canonicalCurrencyDynasty(value) {
    var text = _text(value).replace(/\s+/g, '');
    if (!text) return '';
    for (var i = 0; i < CURRENCY_DYNASTY_ALIASES.length; i++) {
      if (text.indexOf(CURRENCY_DYNASTY_ALIASES[i][0]) >= 0) {
        return CURRENCY_DYNASTY_ALIASES[i][1];
      }
    }
    return '';
  }

  root.TMWorldEra = {
    resolve: resolve,
    resolveDetail: resolveDetail,
    currentScenario: currentScenario,
    canonicalCurrencyDynasty: canonicalCurrencyDynasty,
    VERSION: 1
  };
})(typeof window !== 'undefined' ? window : globalThis);
