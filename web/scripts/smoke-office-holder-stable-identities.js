#!/usr/bin/env node
// Dynamic regression: office holders use stable character IDs and legacy names migrate only when unique.

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
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const context = {
  console: { log() {}, info() {}, warn() {}, error: console.error.bind(console) },
  Date, JSON, Math, RegExp, Array, Object, String, Number, Boolean, Map, Set,
  parseInt, parseFloat, isFinite, isNaN,
  deepClone: clone,
  P: { playerInfo: { characterName: '旧君', marker: 'template' }, engineConstants: {} },
  GM: {
    sid: 'office-holder-id-smoke',
    _campaignId: 'campaign-office-holder-id',
    turn: 9,
    chars: [], facs: [], officeTree: [],
    playerInfo: { characterId: 'ruler-old', characterName: '旧君' },
    harem: { heirs: [], crownPrince: '', crownPrinceId: '' }
  },
  TM: { errors: { capture() {} }, FactionIndex: { rebuild() {} } },
  SettlementPipeline: { register() {} },
  document: { readyState: 'loading', addEventListener() {} },
  toast() {}, addEB() {}
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
context.buildIndices = function() {};

const oldRuler = context.TM.Roster.createChar({
  id: 'ruler-old', name: '旧君', alive: true, isPlayer: true,
  role: '皇帝', officialTitle: '皇帝', faction: '本朝', factionId: 'fac-player'
});
const heir = context.TM.Roster.createChar({
  id: 'char-zhang-a', name: '张衡', alive: true,
  role: '太子', officialTitle: '吏部尚书', title: '太子', faction: '本朝', factionId: 'fac-player'
});
const peer = context.TM.Roster.createChar({
  id: 'char-zhang-b', name: '张衡', alive: true,
  officialTitle: '兵部尚书', title: '兵部尚书', faction: '本朝', factionId: 'fac-player'
});
const unique = context.TM.Roster.createChar({
  id: 'char-unique', name: '唯一官', alive: true,
  officialTitle: '礼部尚书', faction: '本朝', factionId: 'fac-player'
});
context.GM.facs = [{ id: 'fac-player', name: '本朝', isPlayer: true, leaderId: oldRuler.id, leader: oldRuler.name }];

const heirSeat = { name: '尚书', establishedCount: 1, actualCount: 1, vacancyCount: 0,
  actualHolders: [{ characterId: heir.id, name: heir.name, generated: true }] };
const peerSeat = { name: '尚书', establishedCount: 1, actualCount: 1, vacancyCount: 0,
  actualHolders: [{ characterId: peer.id, name: peer.name, generated: true }] };
const ambiguousLegacy = { name: '旧档同名官', establishedCount: 1, actualCount: 1,
  actualHolders: [{ name: '张衡', generated: true }] };
const uniqueLegacy = { name: '旧档唯一官', establishedCount: 1, actualCount: 1,
  actualHolders: [{ name: '唯一官', generated: true }] };
const mirroredLegacy = {
  name: '已有稳定镜像官', establishedCount: 1, actualCount: 1,
  holder: '张衡', holderId: peer.id, additionalHolders: [], additionalHolderIds: []
};
context.GM.officeTree = [
  { name: '吏部', positions: [heirSeat], subs: [] },
  { name: '兵部', positions: [peerSeat], subs: [] },
  { name: '礼部', positions: [uniqueLegacy], subs: [] },
  { name: '旧档', positions: [ambiguousLegacy, mirroredLegacy], subs: [] }
];

context._offMigratePosition(uniqueLegacy);
assert(uniqueLegacy.actualHolders[0].characterId === unique.id,
  'a unique legacy holder name must migrate to its stable character ID');
context._offMigratePosition(ambiguousLegacy);
assert(!ambiguousLegacy.actualHolders[0].characterId
  && ambiguousLegacy.actualHolders[0].identityStatus === 'ambiguous-character-name',
  'an ambiguous legacy holder name must remain unresolved instead of choosing a character');
context._offMigratePosition(mirroredLegacy);
assert(mirroredLegacy.actualHolders[0].characterId === peer.id,
  'an existing holderId mirror must survive migration even when the display name is ambiguous');

const rejectedAppointment = context._offAppointPerson({
  name: '歧义任命', establishedCount: 1, actualHolders: [{ name: '', generated: false }]
}, '张衡');
assert(rejectedAppointment.ok === false && rejectedAppointment.reason === 'ambiguous-character-name',
  'name-only appointment must fail closed when two characters share the name');
const rejectedVacate = context._offVacateByCharName('张衡', 'test');
assert(rejectedVacate.ok === false && rejectedVacate.reason === 'ambiguous-character-name',
  'name-only global vacate must fail closed when the character name is ambiguous');
assert(heirSeat.actualHolders[0].characterId === heir.id && peerSeat.actualHolders[0].characterId === peer.id,
  'failed ambiguous operations must not modify either same-name holder');

const templateBefore = JSON.stringify(context.P.playerInfo);
const transfer = context.TM.Succession.transferPlayerControl({ from: oldRuler, to: heir, reason: 'abdication' });
assert(transfer.ok === true, 'same-name heir succession must commit through stable ID office cleanup');
assert(heirSeat.actualHolders.length === 0 && heirSeat.holder === '' && heirSeat.vacancyCount === 1,
  'succession must vacate only the heir stable ID');
assert(peerSeat.actualHolders.length === 1 && peerSeat.actualHolders[0].characterId === peer.id,
  'succession must preserve another office held by a different same-name character');
assert(peer.officialTitle === '兵部尚书', 'same-name peer character title must remain unchanged');
assert(JSON.stringify(context.P.playerInfo) === templateBefore, 'stable-ID succession must not modify the scenario player template');

// The authoritative character-derived rebuild must retain both same-name IDs and write them back to holders.
heir.role = ''; heir.officialTitle = '吏部尚书'; heir.title = '吏部尚书';
context.GM.officeTree = [
  { name: '吏部', positions: [{ name: '尚书', establishedCount: 1, actualHolders: [{ characterId: heir.id, name: heir.name, generated: true }] }], subs: [] },
  { name: '兵部', positions: [{ name: '尚书', establishedCount: 1, actualHolders: [{ characterId: peer.id, name: peer.name, generated: true }] }], subs: [] }
];
const rosterLength = context.GM.chars.length;
const synced = context._offSyncHoldersFromChars({ force: true, dedupChars: true });
assert(synced.ok === true && context.GM.chars.length === rosterLength,
  'office synchronization must not deduplicate distinct same-name character IDs');
const holderIds = [];
context.GM.officeTree.forEach(dept => dept.positions.forEach(pos => {
  (pos.actualHolders || []).forEach(holder => { if (holder && holder.characterId) holderIds.push(holder.characterId); });
}));
assert(holderIds.includes(heir.id) && holderIds.includes(peer.id),
  'character-derived office holders must preserve both same-name stable IDs');

console.log('smoke-office-holder-stable-identities: PASS (' + assertions + ' assertions)');
