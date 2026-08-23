#!/usr/bin/env node
// Dynamic regression: recent-appointment identity contract and explicit vacancy/overstaffing statistics.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let assertions = 0;
const warnings = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  assertions++;
}

function fakeEl() {
  return {
    style: {}, innerHTML: '', textContent: '', value: '',
    appendChild() {}, removeChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

const context = {
  console: {
    log() {}, info() {}, error: console.error.bind(console),
    warn() { warnings.push(Array.from(arguments).join(' ')); }
  },
  Date,
  JSON,
  Math,
  RegExp,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Map,
  Set,
  parseInt,
  parseFloat,
  isFinite,
  isNaN,
  setTimeout() {},
  clearTimeout() {},
  P: { playerInfo: {}, ai: {} },
  GM: {
    turn: 15,
    chars: [
      { id: 'char-a', name: '同名官', alive: true },
      { id: 'char-b', name: '同名官', alive: true },
      { id: 'char-c', name: '异名官', alive: true }
    ],
    officeTree: [],
    corruption: {
      trueIndex: 20,
      perceivedIndex: 20,
      activeCases: [],
      history: { snapshots: [] },
      supervision: { level: 40 },
      subDepts: {
        central: { true: 20 }, provincial: { true: 20 }, military: { true: 20 },
        fiscal: { true: 20 }, judicial: { true: 20 }, imperial: { true: 20 }
      }
    }
  },
  CorruptionEngine: { tick() {} },
  SettlementPipeline: { register() {} },
  document: {
    readyState: 'complete',
    body: fakeEl(), head: fakeEl(),
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return fakeEl(); },
    addEventListener() {}
  },
  escHtml(value) { return String(value == null ? '' : value); },
  findCharByName(name) {
    return context.GM.chars.find(ch => ch && ch.name === name) || null;
  },
  _isSameLocation(a, b) { return a === b; },
  toast() {},
  addEB() {},
  _dbg() {},
  _$() { return null; }
};
context.window = context;
context.globalThis = context;

vm.createContext(context);

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}

load('tm-utils.js');
load('tm-office-system.js');
load('tm-corruption-cases.js');
load('tm-office-panel.js');
load('tm-office-runtime-summary-appoint.js');

const charA = context.GM.chars[0];
const charB = context.GM.chars[1];
const charC = context.GM.chars[2];
let marked = context.CorruptionEngine.markCharAsRecentAppointment(charA);
assert(marked.ok === true && charA.isRecentAppointment === true && charA.appointedTurn === 15, 'current-world character object must be marked');

marked = context.CorruptionEngine.markAsRecentAppointmentById('char-c');
assert(marked.ok === true && charC.isRecentAppointment === true, 'valid stable character ID must be marked');

charA.isRecentAppointment = false;
charB.isRecentAppointment = false;
const missing = context.CorruptionEngine.markAsRecentAppointment('missing-id');
assert(missing.ok === false && missing.reason === 'character-not-found', 'missing stable ID must fail explicitly');
assert(charA.isRecentAppointment === false && charB.isRecentAppointment === false, 'missing stable ID must not mark another character');

const ambiguousName = context.CorruptionEngine.markAsRecentAppointment('同名官');
assert(ambiguousName.ok === false && ambiguousName.reason === 'character-not-found', 'character name must not be accepted as an ID');
assert(charA.isRecentAppointment === false && charB.isRecentAppointment === false, 'same-name characters must not be fuzzily marked');

const detached = context.CorruptionEngine.markCharAsRecentAppointment({ id: 'char-a', name: '同名官' });
assert(detached.ok === false && detached.reason === 'character-not-in-world', 'detached lookalike object must not be accepted');
assert(warnings.length >= 3, 'invalid appointment arguments must produce diagnostic warnings');

const under = context._offPositionStats({
  name: '少员职位', establishedCount: 3, actualHolders: [{ name: '甲', generated: true }]
});
assert(under.headCount === 3 && under.actualCount === 1 && under.vacant === 2 && under.overstaffed === 0, 'understaffing must be reported as positive vacancy');

const exact = context._offPositionStats({
  name: '满员职位', establishedCount: 2,
  actualHolders: [{ name: '甲', generated: true }, { name: '乙', generated: true }]
});
assert(exact.vacant === 0 && exact.overstaffed === 0 && exact.actualCount === 2, 'exact staffing must report neither vacancy nor overstaffing');

const over = context._offPositionStats({
  name: '超编职位', establishedCount: 1,
  actualHolders: [
    { name: '甲', generated: true },
    { name: '乙', generated: true },
    { name: '丙', generated: true }
  ]
});
assert(over.vacant === 0 && over.overstaffed === 2 && over.actualCount === 3, 'overstaffing must be explicit rather than negative vacancy');

const legacyOver = context._offPositionStats({
  name: '旧档计数超编职位', establishedCount: 1, vacancyCount: 0, actualCount: 3
});
assert(legacyOver.vacant === 0 && legacyOver.overstaffed === 2 && legacyOver.actualCount === 3, 'legacy count-only overstaffing must survive migration');

const placeholders = context._offPositionStats({
  name: '未具象职位', establishedCount: 2,
  actualHolders: [{ name: '甲', generated: true }, { name: '', generated: false, placeholderId: 'ph-1' }]
});
assert(placeholders.unmaterialized === 1 && placeholders.unmaterialized >= 0, 'unmaterialized count must be non-negative');

const duplicate = context._offPositionStats({
  name: '重复任命职位', establishedCount: 1,
  actualHolders: [{ name: '甲', generated: true }, { name: '甲', generated: true }]
});
assert(duplicate.actualCount === 1 && duplicate.overstaffed === 0, 'duplicate holder rows must not double-count an appointment');

const html = context.renderOfficeDeptV2({
  name: '测试部',
  positions: [{
    name: '测试官', establishedCount: 1,
    actualHolders: [
      { name: '甲', generated: true },
      { name: '乙', generated: true },
      { name: '丙', generated: true }
    ]
  }],
  subs: []
}, ['root', 0]);
assert(html.includes('超2'), 'office UI must show the explicit overstaffing count');
assert(!/缺-\d+/.test(html), 'office UI must never render a negative vacancy');

context.GM._edictSuggestions = [];
assert(context._offSelectCandidate('异名官', '测试部', '测试官') === true, 'missing legacy age must retain the documented adult fallback');
assert(context.GM._edictSuggestions.length === 1, 'eligible missing-age candidate must create one appointment suggestion');
charC.age = 0;
assert(context._offSelectCandidate('异名官', '测试部', '测试官') === false, 'zero-age character must be rejected by the production appointment entry');
assert(context.GM._edictSuggestions.length === 1, 'rejected zero-age candidate must not create another suggestion');

console.log('smoke-appointment-office-invariants: PASS (' + assertions + ' assertions)');
