#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(WEB, 'tm-feudal-warfare.js'), 'utf8');

function extractFunction(marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing function: ' + marker);
  let pos = source.indexOf('{', start);
  let depth = 0;
  for (; pos < source.length; pos += 1) {
    if (source[pos] === '{') depth += 1;
    else if (source[pos] === '}' && --depth === 0) return source.slice(start, pos + 1);
  }
  throw new Error('unterminated function: ' + marker);
}

function registration(id) {
  const marker = "SettlementPipeline.register('" + id + "'";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing settlement registration: ' + id);
  const end = source.indexOf('\n', start);
  return source.slice(start, end > start ? end : source.length);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return value;
}

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error('[smoke-feudal-template-immutability] ' + label);
  passed += 1;
  console.log('  PASS - ' + label);
}

const scenario = deepFreeze({
  id: 'scenario-template',
  military: {
    initialTroops: [{ id: 'army-a', name: '禁军', soldiers: 10000, morale: 50, training: 40, loyalty: 60 }]
  },
  map: {
    regions: [{ id: 'region-a', name: '京畿', owner: '本朝', development: 50, troops: 1000 }]
  }
});
const templateBefore = JSON.stringify(scenario);
const P = deepFreeze({
  military: clone(scenario.military),
  map: clone(scenario.map)
});
const pBefore = JSON.stringify(P);
const callbacks = Object.create(null);
const changes = [];
let scenarioLookups = 0;
let randomValues = [];
const context = {
  console,
  Math,
  Number,
  Array,
  Error,
  P,
  GM: {
    sid: scenario.id,
    armies: clone(scenario.military.initialTroops),
    mapData: clone(scenario.map)
  },
  findScenarioById() { scenarioLookups += 1; return scenario; },
  getLiveMapData() { return context.GM.mapData; },
  random() { return randomValues.length ? randomValues.shift() : 0; },
  recordChange(kind, name, field, before, after, reason) {
    changes.push({ kind, name, field, before, after, reason });
  },
  SettlementPipeline: {
    register(id, label, callback) { callbacks[id] = callback; }
  }
};
vm.createContext(context);
vm.runInContext(
  "'use strict';\n" + extractFunction('function updateMilitary(timeRatio)') + '\n'
    + extractFunction('function updateMap(timeRatio)') + '\n'
    + registration('military') + '\n' + registration('map'),
  context,
  { filename: 'feudal-production-settlement.js' }
);

check(typeof callbacks.military === 'function' && typeof callbacks.map === 'function',
  'real SettlementPipeline production entries are registered');

randomValues = [1, 0.99, 1];
callbacks.military({ timeRatio: 1 });
randomValues = [0, 1, 0];
callbacks.map({ timeRatio: 1 });

check(context.GM.armies[0].morale === 53
  && context.GM.armies[0].training === 42
  && context.GM.armies[0].loyalty === 62,
  'military settlement updates GM.armies runtime state');
check(context.GM.mapData.regions[0].development === 53
  && context.GM.mapData.regions[0].troops === 990,
  'map settlement updates GM.mapData runtime state');
check(scenarioLookups === 0, 'production settlement never resolves a shared scenario template');
check(JSON.stringify(scenario) === templateBefore && JSON.stringify(P) === pBefore,
  'deep-frozen scenario registry and P templates remain byte-equivalent');
check(changes.length >= 5 && changes.every((entry) => entry.before !== entry.after),
  'recordChange receives genuine before/after values only');

const gameAState = clone(context.GM);
const gameB = {
  sid: scenario.id,
  armies: clone(scenario.military.initialTroops),
  mapData: clone(scenario.map)
};
check(gameAState.armies[0].morale !== gameB.armies[0].morale
  && gameAState.mapData.regions[0].development !== gameB.mapData.regions[0].development,
  'a new Game B starts from immutable templates rather than Game A runtime changes');

let rejected = false;
try { callbacks.military({ timeRatio: Number.NaN }); } catch (error) { rejected = /timeRatio/.test(error.message); }
check(rejected, 'invalid settlement ratios fail explicitly instead of silently coercing ledger input');

console.log('[smoke-feudal-template-immutability] pass=' + passed);
