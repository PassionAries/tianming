#!/usr/bin/env node
// Dynamic regression: roster IDs, harem births and player succession share one atomic runtime authority.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let assertions = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  assertions++;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const deterministicMath = Object.create(Math);
deterministicMath.random = () => 0.1;
const capturedErrors = [];
const fakeHead = { appendChild() {} };
const fakeBody = { appendChild() {}, removeChild() {} };

const context = {
  console: { log() {}, info() {}, warn() {}, error: console.error.bind(console) },
  Date,
  JSON,
  Math: deterministicMath,
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
  deepClone,
  P: {
    playerInfo: { characterName: '旧君', characterTitle: '皇帝', marker: 'scenario-template' },
    scenarios: [],
    engineConstants: {},
    buildings: [],
    armyTemplates: [],
    parties: [],
    classes: [],
    factions: [],
    unitSystem: { enabled: false }
  },
  GM: {
    sid: 'succession-smoke',
    _campaignId: 'campaign-succession',
    turn: 12,
    chars: [],
    facs: [],
    armies: [],
    parties: [],
    classes: [],
    officeTree: [],
    playerInfo: { characterId: 'ruler-old', characterName: '旧君', characterTitle: '皇帝' },
    harem: { consorts: [], heirs: [], crownPrince: '', crownPrinceId: '' },
    evtLog: [],
    uiSettings: {}
  },
  TM: {
    errors: {
      capture(error, label) { capturedErrors.push({ error, label }); },
      captureSilent(error, label) { capturedErrors.push({ error, label }); }
    },
    FactionIndex: { rebuild() {} }
  },
  document: {
    readyState: 'loading',
    head: fakeHead,
    body: fakeBody,
    addEventListener() {},
    createElement() { return { style: {}, appendChild() {}, remove() {}, querySelector() { return null; } }; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  SettlementPipeline: { register() {} },
  initDataListeners() {},
  toast() {},
  addEB() {},
  _dbg() {},
  _launchPostTurnJobs() {},
  _enqueuePostTurnJob() {},
  confirm() { return true; }
};
context.window = context;
context.globalThis = context;

vm.createContext(context);

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}

load('tm-utils.js');
load('tm-indices.js');
load('tm-office-system.js');

// Avoid exercising unrelated global index families inside a succession transaction;
// roster ID/name indexes below remain the real production Maps created by TM.Roster.
context.buildIndices = function() {};

const sameA = context.TM.Roster.createChar({ name: '同名者', age: 20, gender: 'male' });
const sameB = context.TM.Roster.createChar({ name: '同名者', age: 21, gender: 'male' });
assert(sameA.id && sameB.id && sameA.id !== sameB.id, 'same-name runtime characters must receive distinct stable IDs');
assert(context.findCharById(sameA.id) === sameA, 'new character must be immediately available from the ID index');
assert(context.findCharById(sameB.id) === sameB, 'second same-name character must be immediately available from the ID index');
assert(context.GM._indices.charByName.get('同名者') === sameB, 'name index must be synchronized after creation');

const countBeforeFailure = context.GM.chars.length;
const counterBeforeFailure = context.GM._entityIdCounters.char;
const originalIdSet = context.GM._indices.charById.set;
context.GM._indices.charById.set = function() { throw new Error('injected-index-failure'); };
let creationFailed = false;
try {
  context.TM.Roster.createChar({ name: '半注册角色', age: 30 });
} catch (error) {
  creationFailed = /injected-index-failure/.test(error.message);
}
context.GM._indices.charById.set = originalIdSet;
assert(creationFailed, 'injected index failure must escape character creation');
assert(context.GM.chars.length === countBeforeFailure, 'failed character creation must not leave an array entry');
assert(context.GM._entityIdCounters.char === counterBeforeFailure, 'failed character creation must restore the world ID counter');
assert(!context.GM.chars.some(ch => ch && ch.name === '半注册角色'), 'failed character creation must leave no partial character');

const oldRuler = context.TM.Roster.createChar({
  id: 'ruler-old', name: '旧君', age: 60, gender: 'male', alive: true,
  isPlayer: true, role: '皇帝', title: '皇帝', officialTitle: '皇帝', faction: '本朝', factionId: 'fac-player'
});
const heir = context.TM.Roster.createChar({
  id: 'ruler-heir', name: '储君', age: 30, gender: 'male', alive: true,
  role: '太子', title: '太子', officialTitle: '吏部尚书', position: '吏部尚书',
  isCrownPrince: true, isDesignatedHeir: true, faction: '本朝', factionId: 'fac-player'
}, { father: oldRuler });
oldRuler.designatedHeirId = heir.id;
context.GM.facs = [{ id: 'fac-player', name: '本朝', isPlayer: true, leaderId: oldRuler.id, leader: oldRuler.name }];
context.GM.harem = {
  consorts: [],
  heirs: [{ id: heir.id, characterId: heir.id, name: heir.name, isCrownPrince: true }],
  crownPrince: heir.name,
  crownPrinceId: heir.id
};
context.GM.officeTree = [{
  name: '吏部',
  positions: [{
    name: '尚书', headCount: 1, establishedCount: 1, actualCount: 1, vacancyCount: 0,
    holder: heir.name, actualHolders: [{ name: heir.name, generated: true }]
  }],
  subs: []
}];

const templateBefore = JSON.stringify(context.P.playerInfo);
const transfer = context.TM.Succession.transferPlayerControl({ from: oldRuler, to: heir, reason: 'abdication' });
assert(transfer.ok === true, 'valid abdication must commit');
assert(JSON.stringify(context.P.playerInfo) === templateBefore, 'abdication must never modify P.playerInfo');
assert(context.GM.playerInfo.characterId === heir.id, 'runtime player authority must move to the heir ID');
assert(context.TM.Player.getCharacter(context.GM) === heir, 'all player lookup must return the new ruler');
assert(context.GM.chars.filter(ch => ch && ch.isPlayer).length === 1, 'only one runtime character may retain isPlayer');
assert(oldRuler.isPlayer === false && oldRuler.title === '太上皇', 'old ruler must leave player control and receive the retired title');
assert(heir.isPlayer === true && heir.title === '皇帝' && heir.role === '皇帝', 'heir must become the emperor');
assert(!heir.isCrownPrince && !heir.isDesignatedHeir, 'new ruler must not remain crown prince/designated heir');
assert(context.GM.harem.crownPrince === '' && context.GM.harem.crownPrinceId === '', 'harem crown-prince mirrors must be cleared');
const office = context.GM.officeTree[0].positions[0];
assert(office.holder === '' && office.actualCount === 0 && office.vacancyCount === 1, 'new ruler must vacate the former office and create a real vacancy');
assert(context.GM.facs[0].leaderId === heir.id && context.GM.facs[0].leader === heir.name, 'player faction leadership must follow succession');

const persisted = deepClone(context.GM);
context.GM = deepClone(persisted);
context.window.GM = context.GM;
context.globalThis.GM = context.GM;
context.buildIndices = function() {};
assert(context.TM.Player.getCharacter(context.GM).id === heir.id, 'saved and reloaded runtime player ID must remain authoritative');

const rollbackWorld = context.GM;
const currentRuler = context.TM.Player.getCharacter(rollbackWorld);
const failedHeir = context.TM.Roster.createChar({
  id: 'failed-heir', name: '失败储君', age: 25, alive: true, role: '太子',
  officialTitle: '兵部尚书', title: '太子', isCrownPrince: true, faction: '本朝', factionId: 'fac-player'
}, { father: currentRuler });
rollbackWorld.officeTree[0].positions[0] = {
  name: '兵部尚书', headCount: 1, establishedCount: 1, actualCount: 1, vacancyCount: 0,
  holder: failedHeir.name, actualHolders: [{ name: failedHeir.name, generated: true }]
};
const authoritativeBeforeFailure = JSON.stringify({
  playerInfo: rollbackWorld.playerInfo,
  chars: rollbackWorld.chars,
  officeTree: rollbackWorld.officeTree,
  harem: rollbackWorld.harem,
  facs: rollbackWorld.facs
});
context.TM.FactionIndex.rebuild = function() { throw new Error('injected-succession-failure'); };
const failedTransfer = context.TM.Succession.transferPlayerControl({ from: currentRuler, to: failedHeir, reason: 'abdication' });
context.TM.FactionIndex.rebuild = function() {};
assert(failedTransfer.ok === false && failedTransfer.reason === 'transaction-failed', 'succession failure must report an explicit transaction failure');
assert(JSON.stringify({
  playerInfo: rollbackWorld.playerInfo,
  chars: rollbackWorld.chars,
  officeTree: rollbackWorld.officeTree,
  harem: rollbackWorld.harem,
  facs: rollbackWorld.facs
}) === authoritativeBeforeFailure, 'failed succession must restore every authoritative participant');
assert(capturedErrors.some(row => row.label === 'succession-transfer'), 'failed succession must be recorded diagnostically');

// A later inheritance uses the same transfer transaction and must still leave one player.
failedHeir.isCrownPrince = true;
const inheritance = context.TM.Succession.transferPlayerControl({ from: currentRuler, to: failedHeir, reason: 'inheritance' });
assert(inheritance.ok === true, 'inheritance must reuse the same control-transfer transaction');
assert(rollbackWorld.chars.filter(ch => ch && ch.isPlayer).length === 1, 'abdication followed by inheritance must not create two players');
assert(context.TM.Player.getCharacter(rollbackWorld) === failedHeir, 'player resolver must follow the inherited ruler');

// Harem birth must go through the same deterministic roster provider and preserve age zero.
rollbackWorld.turn = 12;
rollbackWorld.harem = {
  consorts: [{
    name: '皇后甲', rank: '皇后', status: '安宁', age: 0, favor: 80,
    pregnant: true, pregnantSince: 3, children: [], childrenIds: [], childCount: 0
  }],
  heirs: [], crownPrince: '', crownPrinceId: ''
};
load('tm-houguong.js');
context.TM.hougong.processTurn();
const consort = rollbackWorld.harem.consorts[0];
const baby = rollbackWorld.chars.find(ch => ch && ch._origin === 'harem-child');
assert(consort.age === 1, 'zero-age value must increment to one rather than a fallback age');
assert(baby && baby.id, 'newborn heir must immediately have a stable ID');
assert(baby.age === 0, 'newborn heir must remain age zero');
assert(context.findCharById(baby.id) === baby, 'newborn heir must be immediately available by stable ID');
assert(baby.fatherId === failedHeir.id, 'newborn father reference must use the ruler stable ID');
assert(consort.childrenIds.length === 1 && consort.childrenIds[0] === baby.id, 'consort childrenIds must contain true character IDs');

console.log('smoke-succession-roster-invariants: PASS (' + assertions + ' assertions)');
