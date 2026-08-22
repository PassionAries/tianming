#!/usr/bin/env node
/* eslint-env node */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = (fs.readFileSync(path.join(ROOT, 'tm-economy-engine-currency.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'tm-economy-engine.js'), 'utf8'));
const hujiSource = fs.readFileSync(path.join(ROOT, 'tm-huji-engine.js'), 'utf8');

let assertions = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('[smoke-economy-env-huangquan] ' + msg);
  assertions += 1;
}

const math = Object.create(Math);
math.random = () => 1;

function makeLeaf(id, name, mouths) {
  return {
    id,
    name,
    populationDetail: {
      mouths,
      households: Math.round(mouths / 5),
      ding: Math.round(mouths * 0.3),
      byAge: { child: Math.round(mouths * 0.2), adult: mouths - Math.round(mouths * 0.2) },
      byGender: { male: Math.floor(mouths / 2), female: mouths - Math.floor(mouths / 2) }
    }
  };
}

const countyA = makeLeaf('capital-east', '京东县', 600000);
const countyB = makeLeaf('capital-west', '京西县', 500000);

const authorityCalls = [];
const ctx = {
  console,
  Date,
  JSON,
  Math: math,
  Object,
  Array,
  Number,
  String,
  Boolean,
  parseInt,
  parseFloat,
  isFinite,
  TM: { errors: { capture() {}, captureSilent() {} } },
  GM: {
    sid: 'smoke',
    turn: 12,
    regions: [{ id: 'capital', unrest: 30, disasterLevel: 0 }],
    adminHierarchy: {
      player: {
        factionId: 'player-faction',
        divisions: [{ id: 'capital', name: '京畿省', children: [countyA, countyB] }]
      }
    },
    population: {
      byRegion: {
        'capital-east': countyA.populationDetail,
        'capital-west': countyB.populationDetail
      },
      national: { mouths: 1100000, households: 220000, ding: 330000 },
      dynamics: { yearlyLog: [] }
    },
    minxin: { trueIndex: 60 },
    huangquan: { index: 55 },
    environment: {
      _inited: true,
      techEra: 'ming',
      nationalLoad: 2.0,
      nationalCarrying: {},
      activePolicies: [],
      crisisHistory: [],
      byRegion: {
        capital: {
          carrying: {
            farmlandSupport: 425000,
            waterSupport: 1500000,
            fuelSupport: 750000,
            housingSupport: 1200000,
            sanitationSupport: 1000000
          },
          carryingMax: 425000,
          ecoScars: {
            deforestation: 0,
            soilErosion: 0,
            waterTableDrop: 0,
            riverSilting: 0,
            soilFertilityLoss: 0,
            salinization: 0,
            desertification: 0,
            biodiversityLoss: 0,
            urbanSewageOverload: 0
          },
          currentLoad: 2.0,
          overloadYears: 0,
          forestArea: 500000,
          coalReserve: 0,
          aquiferLevel: 1.0,
          riverFlow: 1.0,
          arableArea: 500000,
          soilFertility: 0.85,
          techLevel: {}
        }
      }
    }
  },
  P: { id: 'smoke', conf: {}, time: { daysPerTurn: 30 }, playerInfo: { factionName: 'player-faction' } },
  IntegrationBridge: {
    getTopLevelDivisions(hierarchy) { return hierarchy.player.divisions; }
  },
  _adjAuthority(key, delta, reason, meta) {
    authorityCalls.push({ key, delta, reason, meta });
    if (key === 'minxin') ctx.GM.minxin.trueIndex += delta;
    if (key === 'huangquan') ctx.GM.huangquan.index += delta;
    return { ok: true };
  },
  addEB() {},
  turnsForMonths(months) { return months; },
  findScenarioById() { return null; }
};
ctx.window = ctx;
ctx.global = ctx;
ctx.globalThis = ctx;

function runOverloadTierCase(load) {
  const mouths = Math.round(load * 100000);
  const leaf = makeLeaf('tier-county', '分级县', mouths);
  const calls = [];
  const tierMath = Object.create(Math);
  tierMath.random = () => 1;
  const tierCtx = {
    console,
    Date,
    JSON,
    Math: tierMath,
    Object,
    Array,
    Number,
    String,
    Boolean,
    parseInt,
    parseFloat,
    isFinite,
    TM: { errors: { capture() {}, captureSilent() {} } },
    GM: {
      sid: 'overload-tier-' + String(load),
      turn: 12,
      regions: [{ id: 'tier-province', unrest: 30, disasterLevel: 0 }],
      adminHierarchy: {
        player: {
          factionId: 'player-faction',
          divisions: [{ id: 'tier-province', name: '分级省', children: [leaf] }]
        }
      },
      population: {
        byRegion: { 'tier-county': leaf.populationDetail },
        national: {
          mouths,
          households: leaf.populationDetail.households,
          ding: leaf.populationDetail.ding
        },
        dynamics: { yearlyLog: [] }
      },
      minxin: { trueIndex: 60 },
      environment: {
        _inited: true,
        techEra: '汉',
        nationalLoad: load,
        nationalCarrying: {},
        activePolicies: [],
        crisisHistory: [],
        byRegion: {
          'tier-province': {
            carrying: {},
            carryingMax: 100000,
            ecoScars: {
              deforestation: 0,
              soilErosion: 0,
              waterTableDrop: 0,
              riverSilting: 0,
              soilFertilityLoss: 0,
              salinization: 0,
              desertification: 0,
              biodiversityLoss: 0,
              urbanSewageOverload: 0
            },
            currentLoad: load,
            forestArea: 100000,
            coalReserve: 0,
            aquiferLevel: 1,
            riverFlow: 1,
            arableArea: 100000,
            soilFertility: 1,
            techLevel: {}
          }
        }
      }
    },
    P: {
      id: 'overload-tier-' + String(load),
      conf: {},
      time: { daysPerTurn: 30 },
      playerInfo: { factionName: 'player-faction' }
    },
    IntegrationBridge: {
      getTopLevelDivisions(hierarchy) { return hierarchy.player.divisions; }
    },
    _adjAuthority(key, delta) {
      calls.push({ key, delta });
      return { ok: true };
    },
    addEB() {},
    turnsForMonths(months) { return months; },
    findScenarioById() { return null; }
  };
  tierCtx.window = tierCtx;
  tierCtx.global = tierCtx;
  tierCtx.globalThis = tierCtx;
  vm.createContext(tierCtx);
  vm.runInContext(src, tierCtx, { filename: 'tm-economy-engine.js' });
  vm.runInContext(hujiSource, tierCtx, { filename: 'tm-huji-engine.js' });
  tierCtx.EnvCapacityEngine.tick({ monthRatio: 1, turn: tierCtx.GM.turn, strict: true });
  const region = tierCtx.GM.regions[0];
  return {
    unrest: region.unrest - 30,
    disaster: region.disasterLevel,
    minxin: calls.filter(call => call.key === 'minxin' && call.delta < 0)
      .reduce((sum, call) => sum + call.delta, 0)
  };
}

function runZeroResourceCase() {
  const leaf = makeLeaf('barren-county', '荒县', 10000);
  const zeroMath = Object.create(Math);
  zeroMath.random = () => 1;
  const zeroCtx = {
    console,
    Date,
    JSON,
    Math: zeroMath,
    Object,
    Array,
    Number,
    String,
    Boolean,
    parseInt,
    parseFloat,
    isFinite,
    TM: { errors: { capture() {}, captureSilent() {} } },
    GM: {
      sid: 'zero-environment-resources',
      turn: 12,
      regions: [{ id: 'barren', unrest: 0, disasterLevel: 0 }],
      guoku: { money: 1000000, grain: 500000, cloth: 0 },
      adminHierarchy: {
        player: {
          factionId: 'player-faction',
          divisions: [{ id: 'barren', name: '荒芜省', children: [leaf] }]
        }
      },
      population: {
        byRegion: { 'barren-county': leaf.populationDetail },
        national: { mouths: 10000, households: 2000, ding: 3000 },
        dynamics: { yearlyLog: [] }
      },
      minxin: { trueIndex: 60 }
    },
    P: {
      id: 'zero-environment-resources',
      dynasty: '汉',
      conf: {},
      time: { daysPerTurn: 30 },
      playerInfo: { factionName: 'player-faction' },
      environmentConfig: {
        initialCarrying: {
          byRegion: {
            barren: {
              farmlandSupport: 0,
              waterSupport: 0,
              fuelSupport: 0,
              housingSupport: 0,
              sanitationSupport: 0,
              forestArea: 0,
              coalReserve: 0,
              aquiferLevel: 0,
              riverFlow: 0,
              arableArea: 0,
              soilFertility: 0
            }
          }
        }
      }
    },
    IntegrationBridge: {
      getTopLevelDivisions(hierarchy) { return hierarchy.player.divisions; }
    },
    FiscalEngine: {
      spendFromGuoku(cost) {
        const deducted = {};
        ['money', 'grain', 'cloth'].forEach(kind => {
          const amount = Number(cost[kind]) || 0;
          zeroCtx.GM.guoku[kind] -= amount;
          deducted[kind] = { deducted: amount, deficit: 0 };
        });
        return { ok: true, deducted };
      }
    },
    _adjAuthority() { return { ok: true }; },
    addEB() {},
    turnsForMonths(months) { return months; },
    findScenarioById() { return zeroCtx.P; }
  };
  zeroCtx.window = zeroCtx;
  zeroCtx.global = zeroCtx;
  zeroCtx.globalThis = zeroCtx;
  vm.createContext(zeroCtx);
  vm.runInContext(src, zeroCtx, { filename: 'tm-economy-engine.js' });
  zeroCtx.EnvCapacityEngine.init(zeroCtx.P);
  const row = zeroCtx.GM.environment.byRegion.barren;
  ['forestArea', 'coalReserve', 'aquiferLevel', 'riverFlow', 'arableArea', 'soilFertility'].forEach(field => {
    assert(row[field] === 0, 'explicit zero ' + field + ' should survive environment initialization');
  });
  zeroCtx.EnvCapacityEngine.tick({ monthRatio: 1, turn: zeroCtx.GM.turn, strict: true });
  assert(row.forestArea === 0 && row.aquiferLevel === 0 && row.riverFlow === 0
    && row.arableArea === 0 && row.soilFertility === 0,
  'environment recomputation and passive decay must not revive zero natural resources');
  const technology = zeroCtx.EnvCapacityEngine.enactPolicy('tech_investment', 'barren');
  assert(technology && technology.ok && row.arableArea === 0 && row.forestArea === 0,
    'percentage technology boosts must not conjure arable land or forest from zero');
  const recovery = zeroCtx.EnvCapacityEngine.enactPolicy('disaster_recovery', 'barren');
  assert(recovery && recovery.ok && row.arableArea === 0 && Math.abs(row.soilFertility - 0.05) < 1e-12,
    'disaster recovery should add only its explicit fertility boost to a zero-resource region');
}

vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'tm-economy-engine.js' });
vm.runInContext(hujiSource, ctx, { filename: 'tm-huji-engine.js' });

const lightOverload = runOverloadTierCase(1.10);
const mediumOverload = runOverloadTierCase(1.30);
const severeOverload = runOverloadTierCase(1.60);
assert(lightOverload.unrest === 0 && lightOverload.disaster === 0 && lightOverload.minxin === 0,
  'level-one overload should not fall through to level-three collapse effects');
assert(mediumOverload.unrest === 3 && mediumOverload.disaster === 0 && mediumOverload.minxin === -0.2,
  'level-two overload should apply only the famine-tier social effects');
assert(severeOverload.unrest === 8 && severeOverload.disaster === 0.05 && severeOverload.minxin === -0.5,
  'level-three overload should apply the strongest collapse effects');
assert(lightOverload.unrest < mediumOverload.unrest && mediumOverload.unrest < severeOverload.unrest,
  'overload social penalties should increase monotonically across all three tiers');
runZeroResourceCase();

const beforeHuangquan = ctx.GM.huangquan.index;
const beforePopulation = countyA.populationDetail.mouths + countyB.populationDetail.mouths;
ctx.EnvCapacityEngine.tick({ monthRatio: 1, turn: ctx.GM.turn, strict: true });
const afterPopulation = countyA.populationDetail.mouths + countyB.populationDetail.mouths;

assert(ctx.GM.environment.nationalLoad > 1.2, 'fixture should remain overloaded after recompute');
assert(Math.abs(ctx.GM.environment.byRegion.capital.currentLoad
  - beforePopulation / ctx.GM.environment.byRegion.capital.carryingMax) < 1e-9,
'province carrying load should use the real sum of child-leaf population');
assert(ctx.GM.environment.byRegion.capital.carrying.housingSupport === beforePopulation * 1.1,
  'province housing support should never fall back to a fictitious fixed population');
assert(afterPopulation < beforePopulation, 'province overload should debit authoritative child leaves');
assert(ctx.GM.population.mortalityLedger.some(row => /^environment-overload:/.test(row.cause)),
'environment overload should be recorded by the Huji mortality ledger');
[countyA, countyB].forEach(leaf => {
  const detail = leaf.populationDetail;
  const ageTotal = Object.values(detail.byAge || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const genderTotal = Object.values(detail.byGender || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  assert(ageTotal === detail.mouths && genderTotal === detail.mouths,
    'overload mortality should keep each leaf demographic bundle exact');
});
assert(authorityCalls.some(call => call.key === 'minxin'), 'overload should still affect minxin');
assert(!authorityCalls.some(call => call.key === 'huangquan'), 'environment capacity must not adjust huangquan');
assert(ctx.GM.huangquan.index === beforeHuangquan, 'huangquan index should remain unchanged by environment capacity');

const realLoss = ctx.HujiEngine.applyPopulationLoss;
let injectedCalls = 0;
ctx.HujiEngine.applyPopulationLoss = options => {
  injectedCalls += 1;
  if (injectedCalls === 2) throw new Error('environment-second-leaf-failure');
  return { ok: true, mouths: options.mouths };
};
let strictFailure = null;
try {
  ctx.EnvCapacityEngine.tick({ monthRatio: 1, turn: ctx.GM.turn, strict: true });
} catch (error) {
  strictFailure = error;
}
ctx.HujiEngine.applyPopulationLoss = realLoss;
assert(strictFailure && /environment-second-leaf-failure/.test(strictFailure.message) && injectedCalls === 2,
  'strict environment tick should propagate an internal partial-leaf failure');

function resetLeafPopulation(leaf, mouths) {
  const detail = leaf.populationDetail;
  detail.mouths = mouths;
  detail.households = Math.round(mouths / 5);
  detail.ding = Math.round(mouths * 0.3);
  detail.byAge = { child: Math.round(mouths * 0.2), adult: mouths - Math.round(mouths * 0.2) };
  detail.byGender = { male: Math.floor(mouths / 2), female: mouths - Math.floor(mouths / 2) };
}
resetLeafPopulation(countyA, 50000);
resetLeafPopulation(countyB, 50000);
ctx.GM.population.national = { mouths: 100000, households: 20000, ding: 30000 };
ctx.GM.environment.byRegion.capital.ecoScars.riverSilting = 0.6;
ctx.GM.environment.byRegion.capital._crisis_huaihe_flood = 0;
let crisisRolls = 0;
math.random = () => crisisRolls++ === 0 ? 0 : 1;
const crisisPopulationBefore = countyA.populationDetail.mouths + countyB.populationDetail.mouths;
const successfulHistoryBefore = ctx.GM.environment.crisisHistory.length;
ctx.EnvCapacityEngine.tick({ monthRatio: 1, turn: ctx.GM.turn, strict: true });
assert(countyA.populationDetail.mouths + countyB.populationDetail.mouths === crisisPopulationBefore - 8000
  && ctx.GM.environment.crisisHistory.length === successfulHistoryBefore + 1
  && ctx.GM.environment.crisisHistory[ctx.GM.environment.crisisHistory.length - 1].id === 'huaihe_flood',
'province crisis should debit child leaves before committing one matching history record');

countyA.populationDetail.mouths = 500;
countyB.populationDetail.mouths = 500;
ctx.GM.environment.byRegion.capital.ecoScars.riverSilting = 0.6;
ctx.GM.environment.byRegion.capital._crisis_huaihe_flood = 0;
const crisisHistoryBefore = ctx.GM.environment.crisisHistory.length;
crisisRolls = 0;
math.random = () => crisisRolls++ === 0 ? 0 : 1;
ctx.HujiEngine.applyPopulationLoss = () => ({ ok: false, reason: 'injected-crisis-ledger-failure', mouths: 0 });
let crisisFailure = null;
try {
  ctx.EnvCapacityEngine.tick({ monthRatio: 1, turn: ctx.GM.turn, strict: true });
} catch (error) {
  crisisFailure = error;
}
ctx.HujiEngine.applyPopulationLoss = realLoss;
assert(crisisFailure && /injected-crisis-ledger-failure/.test(crisisFailure.message)
  && ctx.GM.environment.crisisHistory.length === crisisHistoryBefore
  && !ctx.GM.environment.byRegion.capital._crisis_huaihe_flood,
'failed crisis mortality should propagate before crisis history or cooldown markers are committed');

const hierarchy = ctx.GM.adminHierarchy;
delete ctx.GM.adminHierarchy;
const scarBeforeUnresolvedMapping = ctx.GM.environment.byRegion.capital.ecoScars.deforestation;
let mappingFailure = null;
try {
  ctx.EnvCapacityEngine.tick({ monthRatio: 1, turn: ctx.GM.turn, strict: true });
} catch (error) {
  mappingFailure = error;
}
ctx.GM.adminHierarchy = hierarchy;
assert(mappingFailure && /无法解析人口层级/.test(mappingFailure.message)
  && ctx.GM.environment.byRegion.capital.ecoScars.deforestation === scarBeforeUnresolvedMapping,
'strict environment tick should fail before mutation when a province cannot resolve authoritative leaves');

console.log('[smoke-economy-env-huangquan] pass assertions=' + assertions);
