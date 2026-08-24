#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');

function makeContext() {
  const endedWars = [];
  const context = {
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    isFinite,
    parseInt,
    parseFloat,
    setTimeout,
    clearTimeout,
    TM: {},
    P: { playerInfo: { factionId: 'player', factionName: '朝廷' } },
    CasusBelliSystem: {
      endWar(id) {
        endedWars.push(id);
        return { success: true };
      }
    }
  };
  context.window = context;
  context.global = context;
  context.globalThis = context;
  context.GM = {
    turn: 8,
    facs: [
      { id: 'fac-a', name: '甲' },
      { id: 'fac-b', name: '乙' },
      { id: 'fac-c', name: '丙' },
      { id: 'fac-same-1', name: '同名' },
      { id: 'fac-same-2', name: '同名' }
    ],
    activeWars: [],
    treaties: []
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(WEB, 'tm-faction-diplomacy.js'), 'utf8'), context, {
    filename: 'tm-faction-diplomacy.js'
  });
  return { context, endedWars };
}

function seedMutual(a, b, third) {
  a.aiStrategy = {
    grudges: [b.name, third.name],
    grudgeIds: [b.id, third.id]
  };
  b.aiStrategy = {
    grudges: [a.name, third.name],
    grudgeIds: [a.id, third.id]
  };
}

function accept(context, from, to, type, turn) {
  const dip = context.TM.FactionDiplomacy;
  const result = dip.recordProposals(from, [{
    toFaction: to.name,
    toFactionId: to.id,
    type,
    terms: type
  }], turn);
  assert.strictEqual(result.recorded, 1);
  const proposal = to._incomingProposals.filter((item) => item.status === 'pending').slice(-1)[0];
  assert(proposal);
  assert.strictEqual(dip.applyResponses(to, [{ proposalId: proposal.id, decision: 'accept' }], turn).resolved, 1);
}

const world = makeContext();
const [a, b, c, same1, same2] = world.context.GM.facs;

// 拒绝会同时形成姓名与稳定 ID 两套兼容记录。
accept(world.context, a, b, 'deal', 8);
world.context.TM.FactionDiplomacy.recordProposals(a, [{
  toFaction: b.name,
  toFactionId: b.id,
  type: 'alliance',
  terms: '先拒后盟'
}], 9);
let pending = b._incomingProposals.filter((item) => item.status === 'pending').slice(-1)[0];
world.context.TM.FactionDiplomacy.applyResponses(b, [{ proposalId: pending.id, decision: 'reject' }], 9);
assert(a.aiStrategy.grudges.includes('乙') && a.aiStrategy.grudgeIds.includes('fac-b'),
  'rejection writes both legacy name and stable-id grudges');

seedMutual(a, b, c);
accept(world.context, a, b, 'alliance', 10);
assert.deepStrictEqual(Array.from(a.aiStrategy.grudges), ['丙']);
assert.deepStrictEqual(Array.from(a.aiStrategy.grudgeIds), ['fac-c']);
assert.deepStrictEqual(Array.from(b.aiStrategy.grudges), ['丙']);
assert.deepStrictEqual(Array.from(b.aiStrategy.grudgeIds), ['fac-c']);

['nonaggression', 'joint_action'].forEach((type, index) => {
  seedMutual(a, b, c);
  accept(world.context, a, b, type, 11 + index);
  assert.deepStrictEqual(Array.from(a.aiStrategy.grudges), ['丙'], type + ' clears only the counterpart name');
  assert.deepStrictEqual(Array.from(a.aiStrategy.grudgeIds), ['fac-c'], type + ' clears only the counterpart id');
});

seedMutual(a, b, c);
world.context.GM.activeWars = [{ id: 'war-ab', attacker: '甲', defender: '乙' }];
accept(world.context, a, b, 'peace', 13);
assert.deepStrictEqual(world.endedWars, ['war-ab'], 'peace still uses the canonical endWar entry point');
assert.deepStrictEqual(Array.from(a.aiStrategy.grudges), ['丙']);
assert.deepStrictEqual(Array.from(a.aiStrategy.grudgeIds), ['fac-c']);

// 旧档只有姓名或只有 ID 时均可清理，重复接受保持幂等。
a.aiStrategy = { grudges: ['乙', '丙'], grudgeIds: [] };
b.aiStrategy = { grudges: [], grudgeIds: ['fac-a', 'fac-c'] };
accept(world.context, a, b, 'alliance', 14);
assert.deepStrictEqual(Array.from(a.aiStrategy.grudges), ['丙']);
assert.deepStrictEqual(Array.from(b.aiStrategy.grudgeIds), ['fac-c']);
accept(world.context, a, b, 'alliance', 15);
assert.deepStrictEqual(Array.from(a.aiStrategy.grudges), ['丙']);
assert.deepStrictEqual(Array.from(b.aiStrategy.grudgeIds), ['fac-c']);

// 同名不同 ID：清除 same1 时，same2 的稳定宿怨及兼容姓名必须保留。
a.aiStrategy = { grudges: ['同名', '丙'], grudgeIds: ['fac-same-1', 'fac-same-2', 'fac-c'] };
same1.aiStrategy = { grudges: ['甲'], grudgeIds: ['fac-a'] };
accept(world.context, a, same1, 'nonaggression', 16);
assert.deepStrictEqual(Array.from(a.aiStrategy.grudgeIds), ['fac-same-2', 'fac-c']);
assert(a.aiStrategy.grudges.includes('同名') && a.aiStrategy.grudges.includes('丙'),
  'same-name compatibility label remains while another same-name stable grudge exists');
assert(!a.aiStrategy.grudgeIds.includes('') && !a.aiStrategy.grudgeIds.includes('undefined')
  && !a.aiStrategy.grudgeIds.includes('null'), 'no invalid identity sentinel is created');

console.log('[smoke-faction-diplomacy-grudge-identities] PASS');
