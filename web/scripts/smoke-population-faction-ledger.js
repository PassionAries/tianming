#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const hujiSource = fs.readFileSync(path.join(ROOT, 'tm-huji-engine.js'), 'utf8');
const deepSource = fs.readFileSync(path.join(ROOT, 'tm-huji-deep-fill.js'), 'utf8');
const runtimeBridgeSource = fs.readFileSync(path.join(ROOT, 'tm-huji-runtime-bridge.js'), 'utf8');
const economySource = fs.readFileSync(path.join(ROOT, 'tm-economy-engine.js'), 'utf8');
const historicalSource = fs.readFileSync(path.join(ROOT, 'tm-historical-presets.js'), 'utf8');
const regionEnrichSource = fs.readFileSync(path.join(ROOT, 'tm-region-enrich.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(condition, message) {
  if (condition) { pass++; console.log('  PASS - ' + message); }
  else { fail++; console.error('  FAIL - ' + message); }
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function makeLeaf(id, name, mouths, capital) {
  return {
    id, name, regionType: capital ? 'capital' : 'prefecture', minxin: 50, prosperity: 50,
    population: { mouths, households: Math.round(mouths / 5), ding: Math.round(mouths * 0.3) },
    populationDetail: { mouths, households: Math.round(mouths / 5), ding: Math.round(mouths * 0.3) },
    environment: { carrying: mouths * 2, currentLoad: 0.5 }
  };
}
function totals(leaves) {
  return leaves.reduce((out, leaf) => {
    out.mouths += leaf.populationDetail.mouths;
    out.households += leaf.populationDetail.households;
    out.ding += leaf.populationDetail.ding;
    return out;
  }, { mouths: 0, households: 0, ding: 0 });
}

function makeRuntime(options = {}) {
  const math = Object.create(Math);
  math.random = options.random || (() => 0.9);
  const playerLeaves = [makeLeaf('player-capital', '京城', 600000, true), makeLeaf('player-south', '江南', 400000, false)];
  const npcLeaves = [makeLeaf('npc-capital', '沈阳', 3000000, true), makeLeaf('npc-north', '辽北', 2000000, false)];
  const context = {
    console, Math: math, Date, JSON, RegExp, Error,
    Array, Object, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite,
    setTimeout() { return 1; }, clearTimeout() {}, addEB() {}, toast() {},
    P: {
      id: 'faction-ledger', dynasty: '明', time: { year: options.year || 1627 },
      conf: { populationBottomUpEnabled: false },
      populationConfig: {
        initial: { nationalHouseholds: 200000, nationalMouths: 1000000, nationalDing: 300000 },
        corveeRules: { annualCorveeDays: 30 }
      },
      playerInfo: { factionName: '玩家朝廷', capital: '京城' }
    },
    GM: {
      sid: 'faction-ledger', turn: options.turn || 1, year: options.year || 1627,
      _campaignId: options.campaignId || 'campaign-a', _capital: '京城',
      vars: { disasterLevel: 0 }, activeWars: [], chars: [],
      guoku: { money: 100000000, grain: 100000000 },
      minxin: { trueIndex: 50 }, huangquan: { index: 50 }, corruption: { trueIndex: 20 },
      environment: { nationalLoad: 0.5, byRegion: {}, climatePhase: options.climate || 'normal' },
      facs: [
        { id: 'fac-player', name: '玩家朝廷', isPlayer: true, capital: '京城' },
        { id: 'fac-npc', name: '后金', capital: '沈阳' }
      ],
      adminHierarchy: {
        player: { factionId: 'fac-player', factionName: '玩家朝廷', divisions: playerLeaves },
        npc: { factionId: 'fac-npc', factionName: '后金', divisions: npcLeaves }
      }
    },
    turnsForMonths(months) {
      const days = options.daysPerTurn || 30;
      return Math.ceil(months * 30 / days);
    },
    _getDaysPerTurn() { return options.daysPerTurn || 30; },
    calcDateFromTurn(turn) {
      if (typeof options.dateForTurn === 'function') return options.dateForTurn(turn);
      return { adYear: context.GM.year, year: context.GM.year };
    },
    FiscalEngine: { spendFromGuoku() { return true; }, addToGuoku() { return true; } },
    TM: { errors: { capture() {}, captureSilent() {} } }
  };
  context.window = context;
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(hujiSource, context, { filename: 'tm-huji-engine.js' });
  vm.runInContext(deepSource, context, { filename: 'tm-huji-deep-fill.js' });
  vm.runInContext(runtimeBridgeSource, context, { filename: 'tm-huji-runtime-bridge.js' });
  context.HujiEngine.init(context.P);
  context.GM.population.corvee.enabled = false;
  context.GM.population.military.enabled = false;
  context.GM.population.meta.registrationCycle = 1000;
  context.HujiDeepFill.init();
  return { context, playerLeaves, npcLeaves };
}

console.log('[smoke-population-faction-ledger]');

{
  const { context, playerLeaves, npcLeaves } = makeRuntime();
  const playerBefore = totals(playerLeaves).mouths;
  const npcBefore = totals(npcLeaves).mouths;
  const expectedPlayerBirths = playerLeaves.reduce((sum, leaf) => sum + Math.round(leaf.populationDetail.mouths * 0.035 / 12), 0);
  const expectedNpcBirths = npcLeaves.reduce((sum, leaf) => sum + Math.round(leaf.populationDetail.mouths * 0.035 / 12), 0);
  const npcSourceBefore = npcLeaves[1].populationDetail.mouths;
  const npcCapitalBefore = npcLeaves[0].populationDetail.mouths;
  const npcSourceWithoutMigration = npcSourceBefore
    + Math.round(npcSourceBefore * 0.035 / 12)
    - Math.round(npcSourceBefore * 0.025 / 12);
  const npcCapitalWithoutMigration = npcCapitalBefore
    + Math.round(npcCapitalBefore * 0.035 / 12)
    - Math.round(npcCapitalBefore * 0.025 / 12);
  context.HujiEngine.tick({ turn: 1, monthRatio: 1, strict: true });
  const playerAfter = totals(playerLeaves).mouths;
  const npcAfter = totals(npcLeaves).mouths;
  ok(context.GM.population.national.mouths === playerAfter, 'player national contains only player faction leaves');
  ok(context.GM.population.dynamics._yearlyAccumBirths === expectedPlayerBirths,
    'player birth ledger excludes NPC births');
  ok(context.GM.worldPopulationSummary.byFaction.npc.dynamics._yearlyAccumBirths === expectedNpcBirths,
    'NPC births are retained in a separate faction ledger');
  ok(context.GM.worldPopulationSummary.byFaction.npc.national.mouths === npcAfter
    && context.GM.worldPopulationSummary.national.mouths === playerAfter + npcAfter,
    'world summary is separate from player national while preserving every faction');
  ok(npcLeaves[1].populationDetail.mouths < npcSourceWithoutMigration
    && npcLeaves[0].populationDetail.mouths > npcCapitalWithoutMigration,
    'NPC capital pull stays inside the NPC faction');
  ok(playerAfter - playerBefore < npcAfter - npcBefore,
    'larger NPC population growth does not leak into the player national total');
}

{
  const { context, playerLeaves, npcLeaves } = makeRuntime();
  const npcBefore = totals(npcLeaves).mouths;
  const playerBefore = totals(playerLeaves).mouths;
  const result = context.HujiEngine.applyPopulationLoss({ cause: 'smoke-corvee', mouths: 8000, ding: 8000 });
  context.TM.HujiRuntimeBridge.maintain(context.GM, { scenario: context.P, turn: 1 });
  ok(result.ok && result.mouths === 8000, 'mortality ledger applies the requested player loss');
  ok(totals(playerLeaves).mouths === playerBefore - 8000
    && context.GM.population.national.mouths === playerBefore - 8000,
    'leaf mortality survives RuntimeBridge national aggregation');
  ok(totals(npcLeaves).mouths === npcBefore, 'player mortality never changes NPC leaves');
}

{
  const { context, playerLeaves, npcLeaves } = makeRuntime();
  const playerBefore = totals(playerLeaves).mouths;
  const npcCapitalBefore = npcLeaves[0].populationDetail.mouths;
  const npcRegionBefore = npcLeaves[1].populationDetail.mouths;
  const playerDeathBefore = context.GM.population.dynamics._yearlyAccumDeaths || 0;
  const result = context.HujiEngine.applyPopulationLoss({ cause:'smoke-npc-region', regionId:'npc-north', mouths:7000 });
  ok(result.ok && result.factionId === 'fac-npc'
    && npcLeaves[1].populationDetail.mouths === npcRegionBefore - 7000
    && npcLeaves[0].populationDetail.mouths === npcCapitalBefore,
  'region-targeted mortality changes only the matching faction leaf');
  ok(totals(playerLeaves).mouths === playerBefore
    && (context.GM.population.dynamics._yearlyAccumDeaths || 0) === playerDeathBefore,
  'NPC mortality never enters the player national or death accumulator');
  ok(context.GM.worldPopulationSummary.byFaction.npc.mortalityLedger.some(row => row.cause === 'smoke-npc-region'),
    'NPC mortality is retained in the NPC faction ledger');
}

{
  const { context, playerLeaves } = makeRuntime({ climate: 'little_ice_age' });
  const before = totals(playerLeaves).mouths;
  context.HujiDeepFill.tick({ turn: 2, monthRatio: 1, strict: true });
  const afterDeep = totals(playerLeaves).mouths;
  context.TM.HujiRuntimeBridge.maintain(context.GM, { scenario: context.P, turn: 2 });
  ok(afterDeep < before && context.GM.population.national.mouths === afterDeep,
    'little-ice-age mortality is written to leaves and survives aggregation');
  const originalLoss = context.HujiEngine.applyPopulationLoss;
  context.HujiEngine.applyPopulationLoss = () => { throw new Error('injected mortality-ledger failure'); };
  let strictFailure = null;
  try { context.HujiDeepFill.tick({ turn: 3, monthRatio: 1, strict: true }); }
  catch (error) { strictFailure = error; }
  context.HujiEngine.applyPopulationLoss = originalLoss;
  ok(strictFailure && /mortality-ledger failure/.test(strictFailure.message),
    'strict HujiDeepFill propagates mortality failures to the turn transaction');
}

{
  const { context, playerLeaves } = makeRuntime({
    year: 1200,
    random: () => 0,
    dateForTurn(turn) { return { adYear: turn >= 2 ? 1200 : 1199 }; }
  });
  const before = totals(playerLeaves).mouths;
  context.HujiDeepFill.tick({ turn: 2, monthRatio: 1, strict: true });
  const after = totals(playerLeaves).mouths;
  context.TM.HujiRuntimeBridge.maintain(context.GM, { scenario: context.P, turn: 2 });
  const plagueLoss = context.GM.population.mortalityLedger
    .filter(row => row.cause === 'plague')
    .reduce((sum, row) => sum + row.mouths, 0);
  ok(plagueLoss > 0 && after === before - plagueLoss
    && context.GM.population.national.mouths === after,
  'plague deaths use the leaf ledger and cannot be erased by national aggregation');
}

{
  const runtime = makeRuntime({ year: 1101, campaignId: 'campaign-a' });
  const { context, playerLeaves } = runtime;
  playerLeaves[0].name = '中原京城';
  playerLeaves[1].name = '江南路';
  context.GM._capital = '中原京城';
  context.GM.facs[0].capital = '中原京城';
  context.HujiEngine.tick({ turn: 1, monthRatio: 1, strict: true });
  const countAfterFirst = context.GM.population.migrationEvents.filter(row => row.id === 'jingkang_nandu').length;
  const saved = clone(context.GM);
  context.GM = saved;
  context.HujiEngine.tick({ turn: 2, monthRatio: 1, strict: true });
  const countAfterReload = context.GM.population.migrationEvents.filter(row => row.id === 'jingkang_nandu').length;
  const other = makeRuntime({ year: 1101, campaignId: 'campaign-b' });
  other.playerLeaves[0].name = '中原京城';
  other.playerLeaves[1].name = '江南路';
  other.context.GM._capital = '中原京城';
  other.context.GM.facs[0].capital = '中原京城';
  other.context.HujiEngine.tick({ turn: 1, monthRatio: 1, strict: true });
  const otherCount = other.context.GM.population.migrationEvents.filter(row => row.id === 'jingkang_nandu').length;
  ok(countAfterFirst === 1 && countAfterReload === 1, 'persisted migration event state prevents restart duplication');
  ok(otherCount === 1, 'a different campaign can independently trigger the same historical migration');
  ok(!Object.prototype.hasOwnProperty.call(context.HujiEngine.MIGRATION_EVENTS[0], '_triggered'),
    'immutable migration presets never carry campaign trigger state');
}

{
  const { context } = makeRuntime();
  context.GM.adminHierarchy = {};
  context.GM.population.national = { mouths: 20000, households: 4000, ding: 6000 };
  context.GM.population.dynamics.birthRateBase = 0;
  context.GM.population.dynamics.deathRateBase = 0.12;
  context.HujiEngine.tick({ turn: 1, monthRatio: 1, strict: true });
  ok(context.GM.population.national.mouths > 0 && context.GM.population.national.mouths < 100000,
    'a legitimate 20,000-person polity is never raised to a hard-coded 100,000 floor');
}

{
  const daysPerTurnCases = [1, 10, 30, 90];
  const triggerResults = daysPerTurnCases.map(daysPerTurn => {
    const { context } = makeRuntime({ daysPerTurn });
    const cycleTurns = context.turnsForMonths(12);
    context.GM.population.meta.registrationCycle = 1;
    context.GM.population.meta.lastRegistrationTurn = 0;
    context.HujiEngine.tick({ turn: cycleTurns - 1, monthRatio: daysPerTurn / 30, strict: true });
    const premature = context.GM.population.meta.lastRegistrationTurn;
    context.HujiEngine.tick({ turn: cycleTurns, monthRatio: daysPerTurn / 30, strict: true });
    return { cycleTurns, premature, triggered: context.GM.population.meta.lastRegistrationTurn };
  });
  ok(triggerResults.every(result => result.premature === 0 && result.triggered === result.cycleTurns),
    'registration cycles use canonical elapsed months for every daysPerTurn scale');
}

{
  const { context, playerLeaves } = makeRuntime({
    dateForTurn(turn) { return { adYear: turn >= 13 ? 2 : 1 }; }
  });
  const corvee = context.GM.population.corvee;
  corvee.enabled = true;
  corvee.currentYear = 1;
  Object.keys(corvee.byType).forEach(key => {
    corvee.byType[key].totalDays = 100000000;
    corvee.byType[key].currentYearDays = 100000000;
  });
  const before = totals(playerLeaves).mouths;
  context.HujiEngine.tick({ turn: 13, monthRatio: 1, strict: true });
  const junyi = corvee.byType.junyi;
  const after = totals(playerLeaves).mouths;
  ok(corvee.currentYear === 2 && junyi.currentYearDays > 0
    && junyi.currentYearDays < junyi.totalDays / 10,
  'new calendar year resets corvee pressure while preserving lifetime statistics');
  ok(corvee.currentYearBurden < 0.1,
    'fugitive pressure is derived from the current-year window, not lifetime service days');
  ok(after < before
    && context.GM.population.mortalityLedger.some(row => /^corvee:/.test(row.cause)),
  'ordinary corvee mortality reaches the leaf population ledger');
}

{
  const { context, playerLeaves } = makeRuntime();
  const before = totals(playerLeaves).mouths;
  const expectedWithoutMortality = before + playerLeaves.reduce((sum, leaf) => {
    const mouths = leaf.populationDetail.mouths;
    return sum + Math.round(mouths * 0.035 / 12) - Math.round(mouths * 0.025 / 12);
  }, 0);
  const started = context.HujiEngine.startLargeCorvee('ming_zijincheng');
  context.HujiEngine.tick({ turn: 2, monthRatio: 1, strict: true });
  context.TM.HujiRuntimeBridge.maintain(context.GM, { scenario: context.P, turn: 2 });
  const after = totals(playerLeaves).mouths;
  ok(started.ok && after < expectedWithoutMortality
    && context.GM.population.mortalityLedger.some(row => row.cause === 'large-corvee:ming_zijincheng')
    && context.GM.population.national.mouths === after,
  'large-corvee mortality survives the complete leaf-to-national bridge');
}

ok(/HujiEngine\.applyPopulationLoss\(\{ cause:'environment-crisis:/.test(economySource)
  && !/target\.mouths\s*=\s*Math\.max\(10000/.test(economySource),
  'environment crisis mortality is routed through the leaf ledger');
ok(/HujiEngine\.applyPopulationLoss\(\{ cause:'historical-plague:/.test(historicalSource)
  && /HujiEngine\.applyPopulationLoss\(\{ cause:'war-casualty:/.test(historicalSource)
  && !/population\.national\.mouths\s*=\s*Math\.max\(100000/.test(historicalSource),
  'historical plague and war casualties are routed through the leaf ledger');
ok(/HujiEngine\.applyPopulationLoss\(\{ cause:'disease-cycle:/.test(regionEnrichSource)
  && !/population\.national\.mouths\s*=\s*Math\.max\(0/.test(regionEnrichSource),
  'regional disease mortality is routed through the leaf ledger');

console.log('\n[smoke-population-faction-ledger] ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
