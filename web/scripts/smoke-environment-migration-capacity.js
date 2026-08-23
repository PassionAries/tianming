#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function load(context, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}

function makeLeaf(id, mouths) {
  const child = Math.floor(mouths * 0.2);
  return {
    id: id + '-county',
    name: id + '县',
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
  return leaves.reduce((total, leaf) => {
    const detail = leaf.populationDetail;
    total.mouths += detail.mouths;
    total.households += detail.households;
    total.ding += detail.ding;
    Object.keys(detail.byAge).forEach((key) => { total.byAge[key] = (total.byAge[key] || 0) + detail.byAge[key]; });
    Object.keys(detail.byGender).forEach((key) => { total.byGender[key] = (total.byGender[key] || 0) + detail.byGender[key]; });
    return total;
  }, { mouths: 0, households: 0, ding: 0, byAge: {}, byGender: {} });
}

function sameDemographicTotals(a, b) {
  if (a.mouths !== b.mouths || a.households !== b.households || a.ding !== b.ding) return false;
  return ['byAge', 'byGender'].every((field) => {
    const keys = new Set(Object.keys(a[field] || {}).concat(Object.keys(b[field] || {})));
    return Array.from(keys).every((key) => {
      const leftRaw = a[field] && Object.prototype.hasOwnProperty.call(a[field], key) ? a[field][key] : 0;
      const rightRaw = b[field] && Object.prototype.hasOwnProperty.call(b[field], key) ? b[field][key] : 0;
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      assert(Number.isFinite(left), field + '.' + key + ' left bucket must be finite');
      assert(Number.isFinite(right), field + '.' + key + ' right bucket must be finite');
      return left === right;
    });
  });
}

function configureRegionCapacity(region, capacity, mouths) {
  region.arableArea = capacity;
  region.soilFertility = 1;
  region.aquiferLevel = capacity / 1500000;
  region.riverFlow = 1;
  region.forestArea = capacity / 1.5;
  region.coalReserve = 0;
  Object.keys(region.ecoScars).forEach((key) => { region.ecoScars[key] = 0; });
  region.carrying.farmlandSupport = capacity;
  region.carrying.waterSupport = capacity;
  region.carrying.fuelSupport = capacity;
  region.carrying.sanitationSupport = 1000000;
  region.carrying.housingSupport = mouths * 1.1;
  region.carryingMax = Math.min(capacity, mouths * 1.1, 1000000);
  region.currentLoad = mouths / region.carryingMax;
}

function makeWorld(specs, order, options) {
  options = options || {};
  const leaves = {};
  Object.keys(specs).forEach((id) => { leaves[id] = makeLeaf(id, specs[id].mouths); });
  const context = {
    console,
    Math, Date, JSON, RegExp, Error,
    Array, Object, String, Number, Boolean,
    parseInt, parseFloat, isFinite, isNaN,
    setTimeout() { return 1; },
    clearTimeout() {},
    addEB() {},
    toast() {}
  };
  context.window = context;
  context.global = context;
  context.globalThis = context;
  context.TM = { errors: { capture() {}, captureSilent() {} } };
  context.GM = {
    sid: 'migration-capacity',
    turn: 88,
    regions: order.map((id) => ({ id, name: id + '省', unrest: 20 })),
    guoku: { money: 1000000, grain: 500000, cloth: 0 },
    minxin: { trueIndex: 60 },
    adminHierarchy: {
      player: {
        factionId: 'player-faction',
        divisions: order.map((id) => ({ id, name: id + '省', children: [leaves[id]] }))
      }
    },
    population: {
      national: {
        mouths: Object.values(specs).reduce((sum, row) => sum + row.mouths, 0),
        households: Object.values(leaves).reduce((sum, leaf) => sum + leaf.populationDetail.households, 0),
        ding: Object.values(leaves).reduce((sum, leaf) => sum + leaf.populationDetail.ding, 0)
      },
      byRegion: order.reduce((out, id) => {
        out[leaves[id].id] = leaves[id].populationDetail;
        return out;
      }, {}),
      dynamics: { yearlyLog: [] }
    }
  };
  context.P = {
    id: 'migration-capacity',
    name: '汉代迁民容量回归',
    dynasty: '汉',
    conf: {},
    time: { daysPerTurn: 30 },
    playerInfo: { factionName: 'player-faction' },
    environmentConfig: { migrationReliefMaxLoad: options.threshold == null ? 1 : options.threshold }
  };
  context.findScenarioById = () => context.P;
  context.IntegrationBridge = { getTopLevelDivisions(hierarchy) { return hierarchy.player.divisions; } };
  context.FiscalEngine = {
    spendFromGuoku(cost) {
      const deducted = {};
      ['money', 'grain', 'cloth'].forEach((kind) => {
        const rawAmount = cost && Object.prototype.hasOwnProperty.call(cost, kind) ? cost[kind] : 0;
        const amount = Number(rawAmount);
        if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid fiscal test amount for ' + kind);
        context.GM.guoku[kind] -= amount;
        deducted[kind] = { deducted: amount, deficit: 0 };
      });
      return { ok: true, deducted };
    }
  };
  vm.createContext(context);
  load(context, 'tm-economy-engine-currency.js');
  load(context, 'tm-economy-engine.js');
  load(context, 'tm-huji-engine.js');
  context.EnvCapacityEngine.init(context.P);
  Object.keys(specs).forEach((id) => {
    configureRegionCapacity(context.GM.environment.byRegion[id], specs[id].capacity, specs[id].mouths);
  });
  return { context, leaves };
}

function stableOutcome(world) {
  const rows = {};
  Object.keys(world.leaves).sort().forEach((id) => {
    rows[id] = JSON.parse(JSON.stringify(world.leaves[id].populationDetail));
  });
  return rows;
}

function runManyRegions(order) {
  const specs = {};
  for (let i = 0; i < 10; i++) specs['high-' + i] = { mouths: 700000 + i * 1000, capacity: 450000 };
  for (let i = 0; i < 3; i++) specs['receiver-' + i] = { mouths: 150000 + i * 1000, capacity: 800000 };
  const world = makeWorld(specs, order);
  const leaves = Object.values(world.leaves);
  const before = demographicTotal(leaves);
  const preLoads = {};
  Object.keys(specs).forEach((id) => { preLoads[id] = world.context.GM.environment.byRegion[id].currentLoad; });
  const result = world.context.EnvCapacityEngine.enactPolicy('migration_relief', 'all');
  assert(result && result.ok, 'ten-source migration should produce one atomic capacity-aware plan');
  assert(sameDemographicTotals(demographicTotal(leaves), before), 'complete demographic bundle remains conserved');
  const projection = result.immediate.migrationProjection;
  assert(projection && projection.safeLoadThreshold === 1);
  const receivingRows = projection.rows.filter((row) => row.plannedIncoming > 0);
  assert.strictEqual(receivingRows.length, 3, 'projected-load planner distributes into all three safe receivers');
  receivingRows.forEach((row) => {
    assert(row.projectedLoad <= 1 + 1e-9, row.regionId + ' projected load stays within threshold');
    assert(world.context.GM.environment.byRegion[row.regionId].currentLoad <= 1 + 1e-9,
      row.regionId + ' final recomputed load stays within threshold');
    assert.strictEqual(row.plannedOutgoing, 0, 'a receiver never becomes a source in the same policy');
  });
  projection.rows.filter((row) => row.plannedOutgoing > 0).forEach((row) => {
    assert.strictEqual(row.plannedIncoming, 0, 'a source never re-exports newly received population');
  });
  Object.keys(specs).forEach((id) => {
    const finalLoad = world.context.GM.environment.byRegion[id].currentLoad;
    assert(finalLoad <= Math.max(1, preLoads[id]) + 1e-9, id + ' cannot become a newly worse overload');
  });
  return stableOutcome(world);
}

const ids = [];
for (let i = 0; i < 10; i++) ids.push('high-' + i);
for (let i = 0; i < 3; i++) ids.push('receiver-' + i);
const forward = runManyRegions(ids);
const reversed = runManyRegions(ids.slice().reverse());
assert.deepStrictEqual(reversed, forward, 'planning result is independent of environment object key order');

{
  const specs = {
    source: { mouths: 800000, capacity: 450000 },
    nearlyFull: { mouths: 595000, capacity: 600000 },
    spare: { mouths: 200000, capacity: 700000 }
  };
  const world = makeWorld(specs, ['source', 'nearlyFull', 'spare']);
  const result = world.context.EnvCapacityEngine.enactPolicy('migration_relief', 'source');
  assert(result && result.ok);
  assert(world.leaves.nearlyFull.populationDetail.mouths <= 600000,
    'receiver close to carrying limit never accepts population beyond its safe capacity');
  assert(world.context.GM.environment.byRegion.nearlyFull.currentLoad <= 1 + 1e-9);
  assert(world.context.GM.environment.byRegion.spare.currentLoad <= 1 + 1e-9);
}

{
  const specs = {
    highA: { mouths: 800000, capacity: 450000 },
    highB: { mouths: 800000, capacity: 450000 },
    fullReceiver: { mouths: 595000, capacity: 600000 }
  };
  const world = makeWorld(specs, ['highA', 'highB', 'fullReceiver']);
  const before = JSON.stringify({
    guoku: world.context.GM.guoku,
    environment: world.context.GM.environment,
    population: world.context.GM.population,
    hierarchy: world.context.GM.adminHierarchy
  });
  const result = world.context.EnvCapacityEngine.enactPolicy('migration_relief', 'all');
  assert(result && result.ok === false && /接纳容量不足/.test(result.reason),
    'insufficient total receiver capacity fails explicitly');
  assert.strictEqual(JSON.stringify({
    guoku: world.context.GM.guoku,
    environment: world.context.GM.environment,
    population: world.context.GM.population,
    hierarchy: world.context.GM.adminHierarchy
  }), before, 'capacity failure leaves treasury, environment and population completely unchanged');
}

console.log('smoke-environment-migration-capacity ok');
