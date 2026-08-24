// tm-startup-contract.js — explicit boot failure instead of a silent blank renderer.
(function (root) {
  'use strict';

  var REQUIRED = [
    ['TM', function (world) { return !!world.TM; }],
    ['TM.platform', function (world) { return !!(world.TM && world.TM.platform); }],
    ['startGame', function (world) { return typeof world.startGame === 'function'; }],
    ['enterGame', function (world) { return typeof world.enterGame === 'function'; }],
    ['fullLoadGame', function (world) { return typeof world.fullLoadGame === 'function'; }],
    ['endTurn', function (world) { return typeof world.endTurn === 'function'; }],
    ['renderGameState', function (world) { return typeof world.renderGameState === 'function'; }],
    ['callAISmart', function (world) { return typeof world.callAISmart === 'function'; }],
    ['TMNumberParser', function (world) { return !!(world.TMNumberParser && typeof world.TMNumberParser.parseNumber === 'function'); }],
    ['TMWorldEra', function (world) { return !!(world.TMWorldEra && typeof world.TMWorldEra.resolve === 'function'); }],
    ['TM_SaveDB', function (world) { return !!world.TM_SaveDB; }],
    ['HujiEngine', function (world) { return !!world.HujiEngine; }],
    ['EnvCapacityEngine', function (world) { return !!world.EnvCapacityEngine; }],
    ['TimeUtils', function (world) { return !!world.TimeUtils; }]
  ];

  function validate(world) {
    world = world || root;
    var missing = REQUIRED.filter(function (entry) {
      try { return !entry[1](world); }
      catch (error) { return true; }
    }).map(function (entry) { return entry[0]; });
    return { ok: missing.length === 0, missing: missing };
  }

  function renderFailure(result, doc) {
    doc = doc || (root && root.document);
    if (!doc || !doc.body || typeof doc.createElement !== 'function') return false;
    var old = typeof doc.getElementById === 'function' ? doc.getElementById('tm-startup-contract-error') : null;
    if (old) old.remove();
    var panel = doc.createElement('section');
    panel.id = 'tm-startup-contract-error';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:28px;background:#120d0a;color:#f0dfb0;font-family:serif;white-space:pre-wrap;text-align:center;';
    panel.textContent = '天命启动失败\n\n关键脚本未完整加载：' + result.missing.join('、')
      + '\n\n请重启应用；若仍出现此提示，请重新安装完整版本。';
    doc.body.appendChild(panel);
    if (doc.documentElement && doc.documentElement.dataset) doc.documentElement.dataset.tmStartupFailed = 'true';
    return true;
  }

  var api = { validate: validate, renderFailure: renderFailure, required: REQUIRED.map(function (entry) { return entry[0]; }) };
  root.TMStartupContract = api;
  var result = validate(root);
  root.__tmStartupContract = result;
  if (!result.ok) {
    if (root.console && typeof root.console.error === 'function') {
      root.console.error('[tm-startup-contract] missing critical globals:', result.missing.join(', '));
    }
    renderFailure(result);
  }
})(typeof window !== 'undefined' ? window : globalThis);
