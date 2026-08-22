#!/usr/bin/env node
// smoke-env-policy-complete-chain.js - environment edicts must become live policies.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error('[assert] ' + msg);
}

function load(ctx, rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
}

function makeLeaf(id, name, mouths) {
  const child = Math.round(mouths * 0.2);
  return {
    id,
    name,
    populationDetail: {
      mouths,
      households: Math.round(mouths / 5),
      ding: Math.round(mouths * 0.3),
      byAge: { child, adult: mouths - child },
      byGender: { male: Math.floor(mouths / 2), female: mouths - Math.floor(mouths / 2) }
    }
  };
}

function demographicTotal(leaves) {
  return leaves.reduce((out, leaf) => {
    const detail = leaf.populationDetail;
    out.mouths += detail.mouths;
    out.households += detail.households;
    out.ding += detail.ding;
    Object.keys(detail.byAge || {}).forEach(key => { out.byAge[key] = (out.byAge[key] || 0) + detail.byAge[key]; });
    Object.keys(detail.byGender || {}).forEach(key => { out.byGender[key] = (out.byGender[key] || 0) + detail.byGender[key]; });
    return out;
  }, { mouths: 0, households: 0, ding: 0, byAge: {}, byGender: {} });
}

const mountainLeaves = [
  makeLeaf('mountain-east', '东山县', 600000),
  makeLeaf('mountain-west', '西山县', 300000)
];
const plainLeaves = [makeLeaf('plain-center', '平原县', 300000)];
const allLeaves = mountainLeaves.concat(plainLeaves);
const math = Object.create(Math);
math.random = () => 1;

const ctx = {
  console,
  Math: math, Date, JSON, RegExp, Error,
  Array, Object, String, Number, Boolean,
  parseInt, parseFloat, isFinite, isNaN,
  setTimeout() { return 1; },
  clearTimeout() {},
  addEB() {},
  toast() {}
};
ctx.window = ctx;
ctx.global = ctx;
ctx.globalThis = ctx;
ctx.TM = { errors: { capture() {}, captureSilent() {} } };
ctx.GM = {
  sid: 'env-policy-chain',
  turn: 72,
  regions: [
    { id: 'mountain', name: '山地府', unrest: 30, disasterLevel: 0.4 },
    { id: 'plain', name: '平原府', unrest: 20 }
  ],
  guoku: { money: 1000000, grain: 500000 },
  minxin: { trueIndex: 58 },
  adminHierarchy: {
    player: {
      factionId: 'player-faction',
      divisions: [
        { id: 'mountain', name: '山地府', children: mountainLeaves },
        { id: 'plain', name: '平原府', children: plainLeaves }
      ]
    }
  },
  population: {
    _inited: true,
    national: { households: 240000, mouths: 1200000, ding: 360000 },
    byRegion: {
      'mountain-east': mountainLeaves[0].populationDetail,
      'mountain-west': mountainLeaves[1].populationDetail,
      'plain-center': plainLeaves[0].populationDetail
    },
    dynamics: { yearlyLog: [] }
  }
};
ctx.P = {
  id: 'env-policy-chain',
  name: '明末环境政策烟测',
  dynasty: '明',
  conf: {},
  time: { daysPerTurn: 30 },
  playerInfo: { factionName: 'player-faction' },
  environmentConfig: {
    initialCarrying: {
      byRegion: {
        mountain: { arableArea: 220000, forestArea: 120000, soilFertility: 0.55, techLevel: { agriculture: 1, irrigation: 1 } },
        plain: { arableArea: 900000, forestArea: 650000, soilFertility: 0.88, techLevel: { agriculture: 1, irrigation: 1 } }
      }
    },
    initialScars: {
      byRegion: {
        mountain: { deforestation: 0.62, soilErosion: 0.58, riverSilting: 0.42, soilFertilityLoss: 0.52 },
        plain: { deforestation: 0.12, soilErosion: 0.10, riverSilting: 0.08, soilFertilityLoss: 0.06 }
      }
    }
  }
};
ctx.findScenarioById = () => ctx.P;

vm.createContext(ctx);
load(ctx, 'tm-fiscal-engine.js');   // 国库出入已收口走真账(2026-07-04)·沙箱须与运行时同形态
load(ctx, 'tm-economy-engine-currency.js'); load(ctx, 'tm-economy-engine.js');
load(ctx, 'tm-huji-engine.js');
load(ctx, 'tm-integration-bridge.js');
load(ctx, 'tm-edict-parser.js');

ctx.HujiEngine.init(ctx.P);
ctx.EnvCapacityEngine.init(ctx.P);

const policyIds = ctx.EnvCapacityEngine.ENV_POLICIES.map(p => p.id);
['migration_relief', 'tech_investment', 'disaster_recovery'].forEach(id => {
  assert(policyIds.includes(id), id + ' should be a real ENV_POLICIES entry');
});

const beforeMoney = ctx.GM.guoku.money;
const beforeGrain = ctx.GM.guoku.grain;
const beforeMountain = demographicTotal(mountainLeaves);
const beforePlain = demographicTotal(plainLeaves);
const beforeWorld = demographicTotal(allLeaves);
const beforeTech = ctx.GM.environment.byRegion.mountain.techLevel.irrigation;
const beforeScar = ctx.GM.environment.byRegion.mountain.ecoScars.soilErosion;
const beforeArable = ctx.GM.environment.byRegion.mountain.arableArea;

const affordableGrain = ctx.GM.guoku.grain;
ctx.GM.guoku.grain = 10;
const insufficientSnapshot = JSON.stringify({
  guoku: ctx.GM.guoku,
  environment: ctx.GM.environment,
  population: ctx.GM.population,
  hierarchy: ctx.GM.adminHierarchy
});
const insufficient = ctx.EnvCapacityEngine.enactPolicy('migration_relief', 'mountain');
assert(insufficient && insufficient.ok === false
  && JSON.stringify({
    guoku: ctx.GM.guoku,
    environment: ctx.GM.environment,
    population: ctx.GM.population,
    hierarchy: ctx.GM.adminHierarchy
  }) === insufficientSnapshot,
'grain preflight failure should leave treasury environment population and policies unchanged');
ctx.GM.guoku.grain = affordableGrain;

const edicts = [
  '诏令：山地府迁民出山，移民减压，给粮安置于平原府。',
  '诏令：山地府技术投入，修省水农具与水利技术，以救承载。',
  '诏令：山地府灾后恢复，复耕三年，修水毁田土。'
];
edicts.forEach(text => {
  const result = ctx.EdictParser.tryExecute(text, {}, { source: 'smoke-env-policy-complete-chain' });
  assert(result && result.ok, 'edict should execute directly: ' + text);
});

const active = ctx.GM.environment.activePolicies || [];
['migration_relief', 'tech_investment', 'disaster_recovery'].forEach(id => {
  assert(active.some(p => p.id === id && p.regionId === 'mountain'), id + ' should become an active mountain policy');
});

assert(ctx.GM.guoku.money < beforeMoney, 'environment policies should spend money');
assert(ctx.GM.guoku.grain < beforeGrain, 'migration/recovery should spend grain');
const afterMountain = demographicTotal(mountainLeaves);
const afterPlain = demographicTotal(plainLeaves);
const afterWorld = demographicTotal(allLeaves);
assert(afterMountain.mouths < beforeMountain.mouths, 'migration relief should move people out of overloaded province leaves');
assert(afterPlain.mouths > beforePlain.mouths, 'migration relief should settle people in a receiving province leaf');
assert(JSON.stringify(afterWorld) === JSON.stringify(beforeWorld),
  'migration relief should conserve mouths households ding age and gender across provinces');
assert(ctx.GM.environment.byRegion.mountain.techLevel.irrigation > beforeTech, 'tech investment should raise a real tech level');
assert(ctx.GM.environment.byRegion.mountain.arableArea > beforeArable, 'disaster recovery should restore arable area');

const realSpend = ctx.FiscalEngine.spendFromGuoku;
const partialSnapshot = JSON.stringify({
  guoku: ctx.GM.guoku,
  environment: ctx.GM.environment,
  population: ctx.GM.population,
  hierarchy: ctx.GM.adminHierarchy
});
ctx.FiscalEngine.spendFromGuoku = () => {
  ctx.GM.guoku.money -= 10;
  return { ok: true, deducted: { money: { deducted: 10, deficit: 159990 } } };
};
const partialPayment = ctx.EnvCapacityEngine.enactPolicy('tech_investment', 'mountain');
ctx.FiscalEngine.spendFromGuoku = realSpend;
assert(partialPayment && partialPayment.ok === false
  && JSON.stringify({
    guoku: ctx.GM.guoku,
    environment: ctx.GM.environment,
    population: ctx.GM.population,
    hierarchy: ctx.GM.adminHierarchy
  }) === partialSnapshot,
'partial fiscal payment should roll treasury and all policy effects back atomically');

ctx.EnvCapacityEngine.tick({ turn: 73, monthRatio: 12, _monthRatio: 12, strict: true });
assert(ctx.GM.environment.byRegion.mountain.ecoScars.soilErosion < beforeScar, 'active policies should reduce scars through tick');
assert(ctx.GM._envPolicyActions && ctx.GM._envPolicyActions.length >= 3, 'edict path should audit environment policy actions');
assert(ctx.GM.environment.policyHistory && ctx.GM.environment.policyHistory.length >= 3, 'environment should keep policy history');

console.log('[smoke-env-policy-complete-chain] PASS environment policy complete chain');
