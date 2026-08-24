#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'phase8-formal-modules.js'), 'utf8');
let assertions = 0;

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-phase8-listener-lifecycle] ' + message);
}

let currentOverlay = null;
const overlays = [];
function createOverlay() {
  const listeners = Object.create(null);
  const overlay = {
    id: '', className: '', innerHTML: '', listeners, removed: false,
    addEventListener(type, listener) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    querySelector() { return null; },
    remove() {
      this.removed = true;
      if (currentOverlay === this) currentOverlay = null;
    }
  };
  overlays.push(overlay);
  return overlay;
}

const document = {
  body: {
    appendChild(node) { currentOverlay = node; }
  },
  createElement(tag) { return tag === 'div' ? createOverlay() : createOverlay(); },
  getElementById(id) { return id === 'tmf-module-overlay' ? currentOverlay : null; }
};

const issues = [{
  id: 'issue-1', title: '河工裁断', category: '财政', severity: 3, proposer: '户部',
  text: '议河工岁修。', linkedChars: [], linkedFactions: []
}];
const state = { activeModule: null, shizhengIssue: '' };
let actionHandlerCalls = 0;
let aiCalls = 0;
let stateWrites = 0;

function esc(value) { return String(value == null ? '' : value); }
const bridge = {
  _state: state,
  _esc: esc,
  _attr: esc,
  _asset: esc,
  _fmtNum: esc,
  _miniRows() { return ''; },
  _actionButton() { return ''; },
  _dossierRows() { return ''; },
  _ownerKey() { return ''; },
  _ownerName() { return ''; },
  _findFaction() { return null; },
  _findPerson() { return null; },
  _personKey(person) { return person && person.id || ''; },
  _personNameKey(person) { return person && person.name || ''; },
  _getPeople() { return []; },
  _getMapData() { return {}; },
  _getParties() { return []; },
  _getClasses() { return []; },
  _collectRecentEvents() { return []; },
  _getTurnText() { return '第一回'; },
  _firstArray() { return []; },
  _compactText(value) { return esc(value).slice(0, 120); },
  _getMemorials() { return []; },
  _getIssues() { return issues; },
  _getLetters() { return []; },
  _getActiveScenario() { return {}; },
  _getArmies() { return []; },
  _issueIsResolved() { return false; },
  _toast() {},
  _renderEventFeed() {},
  _isPinned() { return false; },
  _issueRank() { return 3; },
  _renderIssueCard(issue) { return '<button data-module-action="select-issue" data-id="' + issue.id + '">' + issue.title + '</button>'; },
  _renderIssueDetail(issue) { return '<button data-module-action="shizheng-choice" data-id="' + issue.id + '" data-choice="0">准</button>'; },
  _clearOfficeStandaloneMode() {},
  openPanel() {},
  openGuoku() {}
};

const context = {
  console: { log() {}, warn() {}, error() {} },
  document,
  TMPhase8FormalBridge: bridge,
  TM_PHASE8_FORMAL: state,
  GM: { verdicts: [] },
  P: { conf: {} },
  TM: {
    PlayerActionSignals: {
      record() { actionHandlerCalls += 1; }
    }
  },
  callAISmart() {
    aiCalls += 1;
    return Promise.resolve('裁断完成');
  },
  _chooseIssueOption(id, choice) {
    context.callAISmart('裁断 ' + id + ':' + choice);
    stateWrites += 1;
    context.GM.verdicts.push({ id, choice });
  },
  setTimeout(fn) { fn(); return 1; },
  clearTimeout() {}
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(SOURCE, context, { filename: 'phase8-formal-modules.js' });

check(bridge.modules && typeof bridge.modules.openModule === 'function', 'real Phase 8 module API loads');
for (let i = 0; i < 100; i += 1) {
  bridge.modules.openModule('shizheng');
  bridge.modules.rerenderModule();
  bridge.modules.closeModule();
}
check(currentOverlay === null, '100 open/redraw/close cycles leave no overlay behind');
check(overlays.length === 200 && overlays.every((overlay) => overlay.removed), 'every replaced overlay is removed');

bridge.modules.openModule('shizheng');
check(currentOverlay.listeners.click.length === 1, 'fresh overlay owns exactly one delegated click listener');
const button = {
  dataset: { moduleAction: 'shizheng-choice', id: 'issue-1', choice: '0' },
  textContent: '准',
  closest(selector) { return selector === '[data-module-action]' ? this : null; },
  getAttribute() { return ''; }
};
currentOverlay.listeners.click[0]({ target: button });

check(actionHandlerCalls === 1, 'one click reaches the action signal/handler exactly once');
check(aiCalls === 1, 'one click starts exactly one AI request');
check(stateWrites === 1 && context.GM.verdicts.length === 1, 'one click performs exactly one adjudication state write');

console.log('[smoke-phase8-listener-lifecycle] PASS assertions=' + assertions);
