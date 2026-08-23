#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
function load(context, file) {
  vm.runInContext(fs.readFileSync(path.join(WEB, file), 'utf8'), context, { filename: file });
}

function leaf(id, mouths) {
  return {
    id: id + '-county',
    name: id + '县',
    populationDetail: {
      mouths,
      households: Math.round(mouths / 5),
      ding: Math.round(mouths * 0.3),
      byAge: { child: Math.round(mouths * 0.2), adult: mouths - Math.round(mouths * 0.2) },
      byGender: { male: Math.floor(mouths / 2), female: mouths - Math.floor(mouths / 2) }
    }
  };
}

function makeWorld(turn, regionId) {
  const mouths = 1250000;
  const county = leaf(regionId, mouths);
  const randomPolicyCounts = [];
  const math = Object.create(Math);
  const context = {
    console,
    Date,
    JSON,
    RegExp,
    Error,
    Math: math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    setTimeout() { return 1; },
    clearTimeout() {},
    addEB() {},
    toast() {}
  };
  context.window = context;
  context.global = context;
  context.globalThis = context;
  context.TM = { errors: { capture(error) { throw error; }, captureSilent() {} } };
  context.GM = {
    sid: 'policy-expiry',
    turn,
    regions: [{ id: regionId, name: regionId + '省', unrest: 30, disasterLevel: 0 }],
    minxin: { trueIndex: 60 },
    adminHierarchy: {
      player: {
        factionId: 'player',
        divisions: [{ id: regionId, name: regionId + '省', children: [county] }]
      }
    },
    population: {
      national: {
        mouths,
        households: county.populationDetail.households,
        ding: county.populationDetail.ding
      },
      byRegion: { [county.id]: county.populationDetail },
      dynamics: { yearlyLog: [] }
    }
  };
  context.P = {
    id: 'policy-expiry',
    dynasty: '汉',
    time: { daysPerTurn: 30 },
    playerInfo: { factionName: 'player' },
    conf: {}
  };
  context.findScenarioById = () => context.P;
  context.IntegrationBridge = { getTopLevelDivisions(hierarchy) { return hierarchy.player.divisions; } };
  context._adjAuthority = function(key, delta) {
    if (key === 'minxin') context.GM.minxin.trueIndex += delta;
    return { ok: true };
  };
  math.random = function() {
    randomPolicyCounts.push(context.GM.environment.activePolicies.length);
    return 1;
  };
  vm.createContext(context);
  load(context, 'tm-economy-engine-currency.js');
  load(context, 'tm-economy-engine.js');
  load(context, 'tm-huji-engine.js');
  context.EnvCapacityEngine.init(context.P);
  const reg = context.GM.environment.byRegion[regionId];
  reg.arableArea = 1000000;
  reg.soilFertility = 1;
  reg.aquiferLevel = 2 / 3;
  reg.riverFlow = 1;
  reg.forestArea = 1000000;
  reg.coalReserve = 0;
  reg.ecoScars.deforestation = 0.5;
  reg.ecoScars.soilErosion = 0;
  reg.ecoScars.waterTableDrop = 0;
  reg.ecoScars.riverSilting = 0;
  reg.ecoScars.soilFertilityLoss = 0;
  reg.ecoScars.salinization = 0;
  reg.ecoScars.desertification = 0;
  reg.ecoScars.biodiversityLoss = 0;
  reg.ecoScars.urbanSewageOverload = 0;
  reg.carryingMax = 1000000;
  reg.physicalLoad = 1.25;
  reg.effectiveLoadRelief = 0.1;
  reg.currentLoad = 1.15;
  context.GM.environment.activePolicies = [{
    id: 'migration_relief',
    regionId,
    startTurn: 10,
    duration: 3
  }];
  return { context, reg, county, randomPolicyCounts };
}

function run(turn, regionId) {
  const world = makeWorld(turn, regionId);
  world.context.EnvCapacityEngine.tick({ turn, monthRatio: 1, strict: true });
  return world;
}

const stillActive = run(12, 'active');
assert.strictEqual(stillActive.context.GM.environment.activePolicies.length, 1,
  'turn 12 remains inside [10, 13)');
assert.strictEqual(stillActive.reg.effectiveLoadRelief, 0.1);
assert(Math.abs(stillActive.reg.currentLoad
  - Math.max(0, stillActive.reg.physicalLoad - 0.1)) < 1e-9,
  'active currentLoad is the recomputed physical load minus policy relief');
assert(stillActive.reg.ecoScars.deforestation < 0.5,
  'active policy still applies scar reduction on its final valid turn');
assert.strictEqual(stillActive.context.GM.regions[0].unrest, 30,
  'active relief keeps this case in tier 1 rather than tier 2');

const expired = run(13, 'expired');
assert.strictEqual(expired.context.GM.environment.activePolicies.length, 0,
  'turn 13 expires [10, 13) policy before environment calculations');
assert.strictEqual(expired.reg.effectiveLoadRelief, 0,
  'expired load relief is absent from recomputation');
assert(Math.abs(expired.reg.currentLoad - expired.reg.physicalLoad) < 1e-9,
  'currentLoad immediately returns to the unrelieved physical load');
assert(expired.reg.currentLoad > stillActive.reg.currentLoad + 0.09,
  'expiry removes the policy relief after both worlds recompute physical carrying');
assert(Math.abs(expired.context.GM.environment.nationalLoad - expired.reg.currentLoad) < 1e-9,
  'nationalLoad is recomputed from the expired-policy result');
assert(expired.reg.ecoScars.deforestation > 0.5,
  'expired policy no longer reduces scars on the expiry turn');
assert.strictEqual(expired.context.GM.regions[0].unrest, 33,
  'overload tier uses the post-expiry load');
assert(expired.randomPolicyCounts.length > 0
  && expired.randomPolicyCounts.every((count) => count === 0),
  'crisis probability observes the already-cleaned active policy set');

const savedWorld = makeWorld(13, 'saved');
const serialized = JSON.stringify(savedWorld.context.GM);
const reloadedWorld = makeWorld(13, 'saved');
reloadedWorld.context.GM = JSON.parse(serialized);
reloadedWorld.context.window.GM = reloadedWorld.context.GM;
reloadedWorld.context.EnvCapacityEngine.tick({ turn: 13, monthRatio: 1, strict: true });
assert.strictEqual(reloadedWorld.context.GM.environment.activePolicies.length, 0,
  'save/load round trip preserves the half-open expiry boundary');

const globalPolicy = makeWorld(13, 'global');
globalPolicy.context.GM.environment.activePolicies[0].regionId = 'all';
globalPolicy.context.EnvCapacityEngine.tick({ turn: 13, monthRatio: 1, strict: true });
assert.strictEqual(globalPolicy.context.GM.environment.activePolicies.length, 0
  && globalPolicy.reg.effectiveLoadRelief === 0,
  'global policies use the same expiry boundary as regional policies');

console.log('[smoke-environment-policy-expiry] PASS');
