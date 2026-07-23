(function (root) {
  'use strict';

  var STORAGE_KEY = 'tm.homeUI';
  var DEFAULT_THEME = 'desk';
  var LOAD_TIMEOUT_MS = 12000;
  var THEMES = {
    desk: {
      label: '御案待批',
      shortLabel: '书案',
      note: '卷面即菜单，主次最清楚',
      asset: 'assets/ui/home/home-ui-desk-v3-4k.webp',
      thumb: 'assets/ui/home/home-ui-desk-v3-thumb.webp',
      primary: [
        [24.3, 39.1, 24.2, 16.4], [28.4, 56.1, 18.7, 9.4],
        [28.4, 65.4, 18.7, 9.4], [28.4, 74.8, 18.7, 9.4]
      ],
      saves: [
        [58.6, 27.1, 34.0, 9.0], [58.6, 37.7, 34.0, 9.0], [58.6, 48.3, 34.0, 9.0]
      ],
      utilities: [
        [60.2, 62.8, 9.4, 8.8], [70.0, 62.8, 10.1, 8.8], [80.8, 62.8, 9.8, 8.8],
        [60.2, 73.0, 13.8, 7.5], [74.8, 73.0, 15.3, 7.5]
      ]
    },
    map: {
      label: '山河入卷',
      shortLabel: '山河',
      note: '世界即入口，沉浸感最强',
      asset: 'assets/ui/home/home-ui-map-v3-4k.webp',
      thumb: 'assets/ui/home/home-ui-map-v3-thumb.webp',
      primary: [
        [2.6, 29.4, 28.5, 9.7], [2.6, 41.5, 28.5, 8.8],
        [2.6, 52.1, 28.5, 9.4], [2.6, 63.8, 28.5, 9.4]
      ],
      saves: [
        [19.6, 79.8, 19.8, 7.8], [40.2, 79.8, 19.8, 7.8], [60.6, 79.8, 19.8, 7.8]
      ],
      utilities: [
        [92.4, 48.1, 5.7, 8.7], [92.4, 57.0, 5.7, 8.7], [92.4, 65.9, 5.7, 8.7],
        [92.4, 74.8, 5.7, 8.7], [92.4, 83.7, 5.7, 8.7]
      ]
    },
    gate: {
      label: '宫门启阖',
      shortLabel: '宫阙',
      note: '开门即开局，仪式感最强',
      asset: 'assets/ui/home/home-ui-gate-v3-4k.webp',
      thumb: 'assets/ui/home/home-ui-gate-v3-thumb.webp',
      primary: [
        [32.3, 57.2, 8.3, 27.8], [41.7, 59.9, 7.0, 25.0],
        [50.8, 59.9, 7.0, 25.0], [59.7, 57.2, 8.0, 27.8]
      ],
      saves: [
        [3.0, 58.9, 19.3, 7.1], [3.0, 66.8, 19.3, 7.1], [3.0, 74.8, 19.3, 7.1]
      ],
      utilities: [
        [73.0, 81.5, 4.7, 8.7], [77.8, 81.5, 4.7, 8.7], [82.6, 81.5, 4.7, 8.7],
        [87.5, 81.5, 4.7, 8.7], [93.1, 81.5, 4.4, 8.7]
      ]
    }
  };
  var PRIMARY_IDS = ['btn-new-game', 'btn-load-save', 'btn-editor', 'btn-settings'];
  var activeTheme = '';
  var pendingTheme = '';
  var loadSerial = 0;
  var loadWatchdog = 0;

  function validTheme(theme) {
    return Object.prototype.hasOwnProperty.call(THEMES, theme);
  }

  function readPreference() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      return validTheme(saved) ? saved : DEFAULT_THEME;
    } catch (_) {
      return DEFAULT_THEME;
    }
  }

  function writePreference(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
  }

  function setRect(el, rect) {
    if (!el || !rect) return;
    el.style.setProperty('--tm-home-x', rect[0] + '%');
    el.style.setProperty('--tm-home-y', rect[1] + '%');
    el.style.setProperty('--tm-home-w', rect[2] + '%');
    el.style.setProperty('--tm-home-h', rect[3] + '%');
  }

  function recentRecords() {
    try {
      var index = JSON.parse(localStorage.getItem('tm_save_index') || '{}');
      return Object.keys(index).map(function (slot) {
        var record = index[slot];
        return record && typeof record === 'object' ? { slot: slot, record: record } : null;
      }).filter(Boolean).filter(function (item) {
        return !!item.record.timestamp;
      }).sort(function (a, b) {
        return Number(b.record.timestamp || 0) - Number(a.record.timestamp || 0);
      }).slice(0, 3);
    } catch (_) {
      return [];
    }
  }

  function saveLabel(item) {
    var record = item.record || {};
    var base = record.eraName || record.date || record.name || '案卷';
    return base + (record.turn ? ' · 第' + record.turn + '回' : '');
  }

  function saveMeta(item) {
    var record = item.record || {};
    if (record.name) return record.name;
    return item.slot === 'slot_0' ? '自动存档' : '手动存档';
  }

  function appendText(parent, className, text) {
    var el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function refreshRecent(theme) {
    var host = document.getElementById('home-recent');
    var conf = THEMES[theme];
    if (!host || !conf) return;
    var records = recentRecords();
    host.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var item = records[i] || null;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tm-home-save' + (item ? '' : ' is-empty');
      setRect(button, conf.saves[i]);
      if (item) {
        appendText(button, 'tm-home-save-seal', item.slot === 'slot_0' ? '自' : '封');
        var copy = appendText(button, 'tm-home-save-copy', '');
        copy.textContent = '';
        appendText(copy, 'tm-home-save-name', saveLabel(item));
        appendText(copy, 'tm-home-save-meta', saveMeta(item));
        button.setAttribute('aria-label', '读取存档：' + saveLabel(item));
        button.addEventListener('click', function () {
          var loadButton = document.getElementById('btn-load-save');
          if (loadButton) loadButton.click();
        });
      } else {
        appendText(button, 'tm-home-save-seal', '空');
        appendText(button, 'tm-home-save-empty', '此位尚未封卷');
        button.disabled = true;
      }
      host.appendChild(button);
    }
  }

  function ensureVersion() {
    var main = document.querySelector('.home-main');
    if (!main) return;
    var badge = main.querySelector('.tm-home-version');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'tm-home-version';
      badge.setAttribute('aria-label', '当前版本');
      main.appendChild(badge);
    }
    var meta = document.querySelector('meta[name="tm-version"]');
    badge.textContent = '天 命　v ' + (meta ? meta.getAttribute('content') : '');
  }

  function syncSettingsSelection(theme) {
    var buttons = document.querySelectorAll('[data-home-ui-choice]');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-home-ui-choice') === theme;
      buttons[i].classList.toggle('active', on);
      buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
      buttons[i].setAttribute('tabindex', on ? '0' : '-1');
      var state = buttons[i].querySelector('.tm-home-ui-choice-state');
      if (state) state.textContent = on ? '当前使用' : '选用此案';
    }
  }

  function syncSettingsPending(theme) {
    var buttons = document.querySelectorAll('[data-home-ui-choice]');
    for (var i = 0; i < buttons.length; i++) {
      var key = buttons[i].getAttribute('data-home-ui-choice');
      var pending = !!theme && key === theme;
      var selected = key === activeTheme;
      buttons[i].classList.toggle('is-loading', pending);
      buttons[i].setAttribute('aria-busy', pending ? 'true' : 'false');
      var state = buttons[i].querySelector('.tm-home-ui-choice-state');
      if (state) state.textContent = pending ? '正在装裱…' : (selected ? '当前使用' : '选用此案');
    }
  }

  function ensureLoadingStatus() {
    var stage = document.querySelector('.home-stage');
    if (!stage) return null;
    var status = stage.querySelector('.tm-home-loading');
    if (!status) {
      status = document.createElement('div');
      status.className = 'tm-home-loading';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      stage.appendChild(status);
    }
    status.hidden = false;
    var theme = pendingTheme || activeTheme || readPreference();
    status.textContent = '正在展卷 · ' + (THEMES[theme] ? THEMES[theme].label : '天命');
    return status;
  }

  function hideLoadingStatus() {
    var status = document.querySelector('.tm-home-loading');
    if (status) status.hidden = true;
  }

  function cancelPendingTheme() {
    loadSerial++;
    if (loadWatchdog && typeof root.clearTimeout === 'function') root.clearTimeout(loadWatchdog);
    loadWatchdog = 0;
    pendingTheme = '';
    if (!root.document || !document.documentElement) return;
    document.documentElement.removeAttribute('data-tm-home-ui-loading');
    document.documentElement.removeAttribute('data-tm-home-ui-pending');
    syncSettingsPending('');
    hideLoadingStatus();
  }

  function applyLayout(theme) {
    if (!root.document || !document.body || !validTheme(theme)) return;
    var conf = THEMES[theme];
    for (var i = 0; i < PRIMARY_IDS.length; i++) {
      setRect(document.getElementById(PRIMARY_IDS[i]), conf.primary[i]);
    }
    var tools = document.querySelectorAll('.home-tools > button');
    for (var j = 0; j < tools.length && j < conf.utilities.length; j++) setRect(tools[j], conf.utilities[j]);
    refreshRecent(theme);
    ensureVersion();
    syncSettingsSelection(theme);
  }

  function commitTheme(theme, persist, announce, renderLayout) {
    activeTheme = theme;
    pendingTheme = '';
    document.documentElement.setAttribute('data-tm-home-ui', theme);
    document.documentElement.removeAttribute('data-tm-home-ui-error');
    document.documentElement.removeAttribute('data-tm-home-ui-loading');
    document.documentElement.removeAttribute('data-tm-home-ui-pending');
    hideLoadingStatus();
    if (persist) writePreference(theme);
    if (renderLayout !== false) applyLayout(theme);
    syncSettingsPending('');
    if (announce && typeof root.toast === 'function') root.toast('主页 UI 已切换 · ' + THEMES[theme].label);
    try {
      root.dispatchEvent(new CustomEvent('tm:home-ui-change', { detail: { theme: theme } }));
    } catch (_) {}
  }

  function loadTheme(theme, persist, announce) {
    theme = validTheme(theme) ? theme : DEFAULT_THEME;
    if (loadWatchdog && typeof root.clearTimeout === 'function') root.clearTimeout(loadWatchdog);
    loadWatchdog = 0;
    var serial = ++loadSerial;
    pendingTheme = theme;
    if (root.document && document.documentElement) {
      document.documentElement.setAttribute('data-tm-home-ui-pending', theme);
      syncSettingsPending(theme);
      ensureLoadingStatus();
    }
    if (typeof root.Image !== 'function') {
      commitTheme(theme, persist, announce, false);
      return;
    }
    var probe = new root.Image();
    probe.decoding = 'async';
    try { probe.fetchPriority = (!activeTheme || persist) ? 'high' : 'auto'; } catch (_) {}
    var settled = false;
    var decodeStarted = false;
    function clearWatchdog() {
      if (loadWatchdog && typeof root.clearTimeout === 'function') root.clearTimeout(loadWatchdog);
      loadWatchdog = 0;
    }
    function success() {
      if (settled || serial !== loadSerial) return;
      settled = true;
      clearWatchdog();
      commitTheme(theme, persist, announce);
    }
    function failure() {
      if (settled || serial !== loadSerial) return;
      settled = true;
      clearWatchdog();
      pendingTheme = '';
      if (!activeTheme) document.documentElement.removeAttribute('data-tm-home-ui');
      document.documentElement.removeAttribute('data-tm-home-ui-loading');
      document.documentElement.removeAttribute('data-tm-home-ui-pending');
      document.documentElement.setAttribute('data-tm-home-ui-error', theme);
      hideLoadingStatus();
      syncSettingsPending('');
      if (typeof root.toast === 'function') root.toast('主页美术资源未就绪 · 已保留原主页');
    }
    function decodedSuccess() {
      if (decodeStarted || settled || serial !== loadSerial) return;
      decodeStarted = true;
      if (typeof probe.decode !== 'function') { success(); return; }
      try {
        probe.decode().then(success, success);
      } catch (_) { success(); }
    }
    probe.onload = decodedSuccess;
    probe.onerror = failure;
    if (typeof root.setTimeout === 'function') loadWatchdog = root.setTimeout(failure, LOAD_TIMEOUT_MS);
    probe.src = THEMES[theme].asset;
    if (probe.complete && probe.naturalWidth) decodedSuccess();
  }

  function launchIsVisible() {
    var launch = document.getElementById('launch');
    if (!launch || launch.style.display === 'none') return false;
    try { if (root.GM && root.GM.running) return false; } catch (_) {}
    return true;
  }

  function blockingLayerOpen() {
    var settings = document.getElementById('settings-bg');
    if (settings && settings.classList.contains('show')) return true;
    if (document.querySelector('.modal-bg.show,#save-manager-overlay,.pause-bg.show')) return true;
    return false;
  }

  function clickById(id) {
    var button = document.getElementById(id);
    if (button) button.click();
  }

  function bindGlobalShortcuts() {
    if (document.documentElement.getAttribute('data-tm-home-shortcuts') === '1') return;
    document.documentElement.setAttribute('data-tm-home-shortcuts', '1');
    document.addEventListener('keydown', function (event) {
      if (!launchIsVisible() || blockingLayerOpen() || event.defaultPrevented) return;
      var target = event.target;
      var interactive = target && target.closest && target.closest('button,a,input,select,textarea,[contenteditable="true"]');
      if (interactive && event.key === 'Enter') return;
      var ctrl = event.ctrlKey || event.metaKey;
      var handled = true;
      if (!ctrl && event.key === 'Enter') clickById('btn-new-game');
      else if (ctrl && String(event.key).toLowerCase() === 'l') clickById('btn-load-save');
      else if (ctrl && String(event.key).toLowerCase() === 'e') clickById('btn-editor');
      else if (ctrl && event.key === ',') clickById('btn-settings');
      else if (!ctrl && event.key === '?') {
        var help = document.querySelector('.home-tools > button:nth-child(4)');
        if (help) help.click();
      } else if (!ctrl && event.key === 'Escape') {
        var exitButton = document.querySelector('.home-tools > button:nth-child(5)');
        if (exitButton) exitButton.click();
      } else handled = false;
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function bindArrowNavigation() {
    var main = document.querySelector('.home-main');
    if (!main || main.getAttribute('data-tm-home-nav') === '1') return;
    main.setAttribute('data-tm-home-nav', '1');
    main.addEventListener('keydown', function (event) {
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].indexOf(event.key) < 0) return;
      var focusables = Array.prototype.slice.call(main.querySelectorAll('.home-card,.tm-home-save:not(:disabled),.home-tools > button'));
      var current = focusables.indexOf(document.activeElement);
      if (current < 0 || !focusables.length) return;
      var step = (event.key === 'ArrowDown' || event.key === 'ArrowRight') ? 1 : -1;
      event.preventDefault();
      focusables[(current + step + focusables.length) % focusables.length].focus();
    });
  }

  function initDom() {
    if (!root.document || !document.body || typeof root.Image !== 'function') return;
    if (pendingTheme || document.documentElement.getAttribute('data-tm-home-ui-loading') === '1') ensureLoadingStatus();
    else hideLoadingStatus();
    applyLayout(activeTheme || readPreference());
    bindGlobalShortcuts();
    bindArrowNavigation();
  }

  function installRuntimeRefresh() {
    if (root.GameHooks && typeof root.GameHooks.on === 'function') {
      root.GameHooks.on('backToLaunch:after', function () {
        applyLayout(activeTheme || readPreference());
      });
    }
    root.addEventListener('focus', function () {
      if (launchIsVisible()) refreshRecent(activeTheme || readPreference());
    });
    root.addEventListener('storage', function (event) {
      if (event.key === STORAGE_KEY) loadTheme(readPreference(), false, false);
      if (event.key === 'tm_save_index') refreshRecent(activeTheme || readPreference());
    });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function onChoiceKey(event, button) {
    if (!event || !button) return true;
    var keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'];
    if (keys.indexOf(event.key) < 0) return true;
    var choices = Array.prototype.slice.call(document.querySelectorAll('[data-home-ui-choice]'));
    var current = choices.indexOf(button);
    if (current < 0 || !choices.length) return true;
    var nextIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = choices.length - 1;
    else {
      var step = (event.key === 'ArrowRight' || event.key === 'ArrowDown') ? 1 : -1;
      nextIndex = (current + step + choices.length) % choices.length;
    }
    event.preventDefault();
    event.stopPropagation();
    var next = choices[nextIndex];
    next.focus();
    loadTheme(next.getAttribute('data-home-ui-choice'), true, true);
    return false;
  }

  function renderSettingsSection() {
    var selected = activeTheme || readPreference();
    var order = ['desk', 'map', 'gate'];
    var html = '<div class="settings-section tm-home-ui-settings"><h4>主页 UI</h4>' +
      '<div class="tm-home-ui-intro">选择启幕主页的视觉方案。切换立即生效，只保存在本设备；开卷、续卷、剧本工坊与设置仍共用同一套游戏动作。</div>' +
      '<div class="tm-home-ui-grid" role="radiogroup" aria-label="主页 UI 方案" aria-describedby="tm-home-ui-help" aria-busy="' + (pendingTheme ? 'true' : 'false') + '">';
    order.forEach(function (key, index) {
      var theme = THEMES[key];
      var on = selected === key;
      var pending = pendingTheme === key;
      html += '<button type="button" role="radio" class="tm-home-ui-choice' + (on ? ' active' : '') + (pending ? ' is-loading' : '') + '" data-home-ui-choice="' + key + '" aria-checked="' + (on ? 'true' : 'false') + '" aria-busy="' + (pending ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '" onclick="TM.HomeUI.set(\'' + key + '\',this)" onkeydown="return TM.HomeUI.onChoiceKey(event,this)">' +
        '<span class="tm-home-ui-choice-no">案 ' + (index + 1) + '</span>' +
        '<span class="tm-home-ui-choice-check" aria-hidden="true">✓</span>' +
        '<img src="' + esc(theme.thumb || theme.asset) + '" alt="" aria-hidden="true" loading="lazy" decoding="async" draggable="false">' +
        '<span class="tm-home-ui-choice-copy"><b>' + esc(theme.label) + '</b><small>' + esc(theme.shortLabel + ' · ' + theme.note) + '</small></span>' +
        '<span class="tm-home-ui-choice-state">' + (pending ? '正在装裱…' : (on ? '当前使用' : '选用此案')) + '</span></button>';
    });
    return html + '</div><div class="tm-home-ui-hint" id="tm-home-ui-help">切换立即生效，无需另行保存。三案均以透明热区承接真实菜单操作；最近存档与版本号会以实时数据覆写。</div></div>';
  }

  var TM = root.TM = root.TM || {};
  TM.HomeUI = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_THEME: DEFAULT_THEME,
    themes: THEMES,
    current: function () { return activeTheme || readPreference(); },
    pending: function () { return pendingTheme; },
    set: function (theme) {
      theme = validTheme(theme) ? theme : DEFAULT_THEME;
      if (theme === activeTheme) {
        if (pendingTheme) cancelPendingTheme();
        syncSettingsSelection(theme);
        return;
      }
      loadTheme(theme, true, true);
    },
    onChoiceKey: onChoiceKey,
    apply: function () { loadTheme(readPreference(), false, false); },
    refreshRecent: function () { refreshRecent(activeTheme || readPreference()); },
    renderSettingsSection: renderSettingsSection
  };

  var bootstrapTheme = readPreference();
  if (root.document && document.documentElement && document.readyState === 'loading' && !document.body) {
    document.documentElement.setAttribute('data-tm-home-ui', bootstrapTheme);
    document.documentElement.setAttribute('data-tm-home-ui-loading', '1');
  }
  loadTheme(bootstrapTheme, false, false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDom);
  else initDom();
  root.addEventListener('load', installRuntimeRefresh);
})(window);
