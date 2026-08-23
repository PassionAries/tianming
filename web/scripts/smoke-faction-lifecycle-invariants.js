#!/usr/bin/env node
// Dynamic regression: removing a faction must retire all stable-ID references atomically and idempotently.

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

const target = {
  id: 'fac-revolt-a', name: '同名叛军',
  aiStrategy: { grudgeIds: ['fac-player'], grudges: ['本朝'] }
};
const sameNameOther = {
  id: 'fac-revolt-b', name: '同名叛军',
  aiStrategy: { grudgeIds: ['fac-player'], grudges: ['本朝'] }
};
const player = {
  id: 'fac-player', name: '本朝', isPlayer: true,
  liegeId: 'fac-revolt-a',
  vassalIds: ['fac-revolt-a', 'fac-revolt-b'],
  allyIds: ['fac-revolt-a'],
  enemyIds: ['fac-revolt-a', 'fac-revolt-b'],
  aiStrategy: {
    allianceIds: ['fac-revolt-b'],
    grudgeIds: ['fac-revolt-a', 'fac-revolt-b'],
    enemyIds: ['fac-revolt-a'],
    grudges: ['同名叛军', '第三方']
  },
  _incomingProposals: [
    { sourceFactionId: 'fac-revolt-a', type: 'peace' },
    { sourceFactionId: 'fac-revolt-b', type: 'trade' }
  ]
};

const world = {
  turn: 20,
  facs: [player, target, sameNameOther],
  chars: [
    { id: 'leader-a', name: '渠帅甲', faction: '同名叛军', factionId: 'fac-revolt-a' },
    { id: 'leader-b', name: '渠帅乙', faction: '同名叛军', factionId: 'fac-revolt-b' }
  ],
  activeWars: [
    { id: 'war-a', attackerId: 'fac-revolt-a', defenderId: 'fac-player', warScore: 10, warGoal: 'capital' },
    { id: 'war-b', attackerId: 'fac-revolt-b', defenderId: 'fac-player', warScore: 20 }
  ],
  armies: [
    { id: 'army-a', name: '甲军', faction: '同名叛军', factionId: 'fac-revolt-a' },
    { id: 'army-b', name: '乙军', faction: '同名叛军', factionId: 'fac-revolt-b' }
  ],
  activeSieges: [
    { id: 'siege-a', attackerArmy: 'army-a', attackerFactionId: 'fac-revolt-a', targetCity: '京城' },
    { id: 'siege-b', attackerArmy: 'army-b', attackerFactionId: 'fac-revolt-b', targetCity: '陪都' }
  ],
  treaties: [
    { id: 'treaty-a', sourceFactionId: 'fac-revolt-a', targetFactionId: 'fac-player' },
    { id: 'treaty-b', sourceFactionId: 'fac-revolt-b', targetFactionId: 'fac-player' }
  ],
  pendingDiplomaticProposals: [
    { proposerId: 'fac-revolt-a', sourceFactionId: 'fac-revolt-a', targetFactionId: 'fac-player' },
    { proposerId: 'fac-revolt-b', sourceFactionId: 'fac-revolt-b', targetFactionId: 'fac-player' }
  ],
  _pendingDiplomaticProposals: [
    { sourceFactionId: 'fac-revolt-a', targetFactionId: 'fac-player' }
  ],
  _pendingAudiences: [
    { factionId: 'fac-revolt-a', subject: '求和' },
    { factionId: 'fac-revolt-b', subject: '互市' }
  ],
  _negotiations: [
    { sourceFactionId: 'fac-revolt-a', targetFactionId: 'fac-player' },
    { sourceFactionId: 'fac-revolt-b', targetFactionId: 'fac-player' }
  ],
  factionRelations: [
    { fromId: 'fac-revolt-a', toId: 'fac-player', from: '同名叛军', to: '本朝' },
    { fromId: 'fac-revolt-b', toId: 'fac-player', from: '同名叛军', to: '本朝' }
  ],
  factionRelationsMap: {
    'fac-revolt-a': { 'fac-player': { value: -80 } },
    'fac-revolt-b': { 'fac-player': { value: -60 } },
    'fac-player': {
      'fac-revolt-a': { value: -80 },
      'fac-revolt-b': { value: -60 }
    }
  },
  _warTruces: {
    version: 1,
    truces: {
      'fac-player|fac-revolt-a': 30,
      'fac-player|fac-revolt-b': 40
    }
  },
  mapData: {
    regions: [
      { id: 'region-a', ownerFactionId: 'fac-revolt-a', occupiedBy: 'id:fac-revolt-a', _occupiedTurn: 18 },
      { id: 'region-b', ownerFactionId: 'fac-revolt-b', occupiedBy: 'id:fac-revolt-b', _occupiedTurn: 19 }
    ]
  },
  adminHierarchy: {
    a: { id: 'admin-a', factionId: 'fac-revolt-a', divisions: [] },
    b: { id: 'admin-b', factionId: 'fac-revolt-b', divisions: [] }
  },
  _provinceToFaction: { A: 'id:fac-revolt-a', B: 'id:fac-revolt-b' }
};

let removedIndexName = null;
let indexRebuilds = 0;
const capturedErrors = [];
const context = {
  console: { log() {}, info() {}, warn() {}, error: console.error.bind(console) },
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
  deepClone,
  P: { playerInfo: { factionName: '本朝' } },
  GM: world,
  TM: {
    errors: {
      capture(error, label) { capturedErrors.push({ error, label }); },
      captureSilent(error, label) { capturedErrors.push({ error, label }); }
    }
  },
  removeFromIndex(kind, name) { if (kind === 'fac') removedIndexName = name; },
  buildIndices() { indexRebuilds++; },
  invalidateGameIndices() {},
  addEB() {}
};
context.window = context;
context.globalThis = context;
world._facIndex = { 'fac-revolt-a': target, 'fac-revolt-b': sameNameOther };

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tm-relations.js'), 'utf8'), context, { filename: 'tm-relations.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tm-faction-membership.js'), 'utf8'), context, { filename: 'tm-faction-membership.js' });

const sameNameCharProbe = { id: 'char-probe', name: '转籍探针', faction: '同名叛军', factionId: 'fac-revolt-a' };
const sameNameArmyProbe = { id: 'army-probe', name: '转军探针', faction: '同名叛军', factionId: 'fac-revolt-a' };
assert(context.TM.FactionMembership.assignChar(sameNameCharProbe, '同名叛军', { targetFactionId: 'fac-revolt-b', silent: true }) === true, 'stable target ID must disambiguate a same-name character transfer');
assert(sameNameCharProbe.factionId === 'fac-revolt-b', 'character membership API must write the exact requested stable faction ID');
assert(context.TM.FactionMembership.assignArmy(sameNameArmyProbe, '同名叛军', { targetFactionId: 'fac-revolt-b', silent: true }) === true, 'stable target ID must disambiguate a same-name army transfer');
assert(sameNameArmyProbe.factionId === 'fac-revolt-b', 'army membership API must write the exact requested stable faction ID');

const result = context.TM.Factions.removeFaction('fac-revolt-a', { reason: 'revolt-defeated' });
assert(result.ok === true && result.removed === true, 'faction lifecycle entry must remove the requested stable ID');
assert(!world.facs.some(f => f && f.id === 'fac-revolt-a'), 'removed faction must leave the primary faction collection');
assert(world.facs.some(f => f && f.id === 'fac-revolt-b'), 'same-name different-ID faction must remain');
assert(world.activeWars.length === 1 && world.activeWars[0].id === 'war-b', 'wars involving only the removed faction must be terminated');
assert(world.armies.length === 1 && world.armies[0].id === 'army-b', 'armies owned by the removed faction must be retired');
assert(world.activeSieges.length === 1 && world.activeSieges[0].id === 'siege-b', 'sieges owned by the removed faction must be retired');
assert(world.treaties.length === 1 && world.treaties[0].id === 'treaty-b', 'treaties involving the removed faction must be cleared');
assert(world.pendingDiplomaticProposals.length === 1 && world.pendingDiplomaticProposals[0].sourceFactionId === 'fac-revolt-b', 'pending proposals must not retain the removed ID');
assert(world._pendingDiplomaticProposals.length === 0, 'private pending proposals must not retain the removed ID');
assert(world._pendingAudiences.length === 1 && world._pendingAudiences[0].factionId === 'fac-revolt-b', 'pending audiences must not retain the removed ID');
assert(world._negotiations.length === 1 && world._negotiations[0].sourceFactionId === 'fac-revolt-b', 'negotiations must not retain the removed ID');
assert(world.factionRelations.length === 1 && world.factionRelations[0].fromId === 'fac-revolt-b', 'bidirectional relation records must not retain the removed ID');
assert(!world.factionRelationsMap['fac-revolt-a'], 'relation map source key must be cleared');
assert(!world.factionRelationsMap['fac-player']['fac-revolt-a'], 'relation map reverse key must be cleared');
assert(!world._warTruces.truces['fac-player|fac-revolt-a'], 'world-owned truce must be cleared');
assert(world._warTruces.truces['fac-player|fac-revolt-b'] === 40, 'other faction truce must remain');
assert(world.chars[0].factionId === '' && world.chars[0].faction === '', 'stable character faction reference must clear both ID and legacy name without guessing an ambiguous twin');
assert(world.chars[1].factionId === 'fac-revolt-b', 'same-name faction character must remain attached by stable ID');
assert(player.vassalIds.length === 1 && player.vassalIds[0] === 'fac-revolt-b', 'vassal ID references must be cleaned without touching the twin');
assert(player.enemyIds.length === 1 && player.enemyIds[0] === 'fac-revolt-b', 'enemy ID references must be cleaned without touching the twin');
assert(player.aiStrategy.grudgeIds.length === 1 && player.aiStrategy.grudgeIds[0] === 'fac-revolt-b', 'AI stable-ID grudges must clear only the removed faction');
assert(player.aiStrategy.grudges.includes('同名叛军'), 'ambiguous legacy name must not be guessed and accidentally clear the twin');
assert(world.mapData.regions[0].ownerFactionId === undefined && world.mapData.regions[0].occupiedBy === undefined, 'map ownership and occupation refs must clear');
assert(world.mapData.regions[0]._occupiedTurn === undefined, 'occupation metadata must clear with its owner');
assert(world.mapData.regions[1].ownerFactionId === 'fac-revolt-b', 'other map ownership must remain');
assert(world.adminHierarchy.a.factionId === undefined, 'administrative stable faction ref must clear');
assert(world.adminHierarchy.b.factionId === 'fac-revolt-b', 'other administrative faction ref must remain');
assert(!Object.prototype.hasOwnProperty.call(world._provinceToFaction, 'A'), 'province ownership index must clear the removed faction');
assert(world._provinceToFaction.B === 'id:fac-revolt-b', 'province ownership for another faction must remain');
assert(removedIndexName === '同名叛军' && indexRebuilds === 1 && !Object.prototype.hasOwnProperty.call(world, '_facIndex'), 'faction indexes must be invalidated and rebuilt once');
assert(capturedErrors.length === 0, 'successful faction removal must not report lifecycle errors');

const second = context.TM.Factions.removeFaction('fac-revolt-a', { reason: 'repeat' });
assert(second.ok === true && second.alreadyRemoved === true && second.removed === false, 'repeated faction removal must be idempotent');
assert(world.facs.length === 2 && world.activeWars.length === 1 && world.armies.length === 1, 'idempotent repeat must not damage other factions');

const serialized = JSON.stringify(world);
assert(!serialized.includes('"fac-revolt-a"'), 'serialized modern world must contain no dangling removed stable ID');
assert(serialized.includes('"fac-revolt-b"'), 'serialized world must retain the same-name surviving stable ID');

console.log('smoke-faction-lifecycle-invariants: PASS (' + assertions + ' assertions)');
