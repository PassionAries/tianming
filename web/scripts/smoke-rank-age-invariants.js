#!/usr/bin/env node
// Dynamic regression: rank polarity and zero-age semantics must follow production providers.

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

const quietConsole = {
  log() {},
  info() {},
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

const context = {
  console: quietConsole,
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
  setTimeout() {},
  clearTimeout() {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  P: { engineConstants: {}, playerInfo: {} },
  GM: {
    turn: 8,
    chars: [],
    corruption: { countermeasures: { salaryReform: 0 }, subDepts: {} },
    currency: { market: { landPricePerUnit: 5 } },
    guoku: { money: 100000, grain: 100000, cloth: 10000 },
    facs: [],
    temples: { faithful: 10000 }
  },
  TM: { errors: { capture(error) { throw error; } } },
  SettlementPipeline: { register() {} },
  findCharByName(name) {
    return context.GM.chars.find(ch => ch && ch.name === name) || null;
  },
  triggerCharacterDeath(ch) { ch.dead = true; },
  addEB() {},
  toast() {},
  _dbg() {},
  findNpcOffice() { return null; },
  calculateCandidateWeight() { return { total: 5, breakdown: {}, eraModifier: 1 }; }
};
context.findScenarioById = function() { return {}; };
context.recordChange = function() {};
context._getDaysPerTurn = function() { return 365; };
context.window = context;
context.globalThis = context;

vm.createContext(context);

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}

load('tm-utils.js');
load('tm-office-system.js');
load('tm-char-economy-engine.js');
load('tm-feudal.js');
load('tm-economy.js');
load('tm-influence-groups.js');

const top = { name: '一品官', rankLevel: 1, officialTitle: '正一品大学士', socialClass: 'civilOfficial', influence: 50 };
const bottom = { name: '九品官', rankLevel: 18, officialTitle: '从九品典吏', socialClass: 'civilOfficial', influence: 50 };

assert(context.getRankSalary(top) > context.getRankSalary(bottom), 'first-rank salary must exceed ninth-rank salary');
for (let level = 1; level < 18; level++) {
  assert(
    context.getRankSalary(level) >= context.getRankSalary(level + 1),
    'default salary must be monotonic from high to low rank at level ' + level
  );
}
assert(context.isHighOfficial(top) === true, 'first-rank official must qualify as high official');
assert(context.isHighOfficial(bottom) === false, 'ninth-rank official must not qualify as high official');
assert(context.CharEconEngine.Income.personalTribute(top) > 0, 'high official must receive high-office tribute');
assert(context.CharEconEngine.Income.personalTribute(bottom) === 0, 'low official must not receive high-office tribute');
assert(
  context.CharEconEngine.Expenses.patronage(bottom) > context.CharEconEngine.Expenses.patronage(top),
  'intentional low-rank upward patronage burden must retain its direction'
);

function economicChar(base) {
  return Object.assign({
    age: 40,
    alive: true,
    integrity: 80,
    loyalty: 70,
    health: 80,
    stress: 20,
    intelligence: 60,
    administration: 60,
    military: 50,
    influence: 50,
    resources: {
      privateWealth: { money: 1000, grain: 0, cloth: 0, land: 0, commerce: 0, slaves: 0 },
      publicTreasury: null,
      virtueMerit: 0,
      virtueStage: 1,
      fame: 0,
      hiddenWealth: 0
    }
  }, base);
}

const stressedTop = economicChar(top);
const stressedBottom = economicChar(bottom);
context.CharEconEngine.tickCharacter(stressedTop, 1, {});
context.CharEconEngine.tickCharacter(stressedBottom, 1, {});
assert(stressedTop.stress > stressedBottom.stress, 'high-office stress must apply to top ranks rather than low ranks');

context.GM.rankHierarchy = [
  { id: 'a', label: '上秩', level: 10, salary: 900 },
  { id: 'b', label: '中秩', level: 20, salary: 500 },
  { id: 'c', label: '下秩', level: 30, salary: 100 }
];
assert(context.getRankSalary(10) === 900, 'custom hierarchy salary metadata must be authoritative');
assert(context.getRankSalary(30) === 100, 'custom low-rank salary metadata must be authoritative');
assert(context.getRankSeniorityScore(10) === 3, 'custom hierarchy seniority must not depend on level 18/19');
assert(context.getRankInferiorityScore(30) === 3, 'custom hierarchy inferiority must not depend on level 18/19');
assert(context.isHighOfficial(10) === true && context.isHighOfficial(20) === false, 'custom hierarchy high-office threshold must use table order');
assert(context.getRankSalary(undefined) === 0, 'missing rank must have a finite zero salary');
assert(context.getRankSalary('not-a-rank') === 0, 'invalid rank must have a finite zero salary');
assert(Number.isFinite(context.getRankSalary(NaN)), 'NaN rank must never propagate NaN salary');
delete context.GM.rankHierarchy;

assert(context.getValidAge({ age: 0 }, 30) === 0, 'zero age must remain zero');
assert(context.getValidAge({ age: '0' }, 30) === 0, 'numeric zero string must normalize to zero');
assert(context.getValidAge({ age: NaN }, 30) === 30, 'NaN age must use fallback');
assert(context.getValidAge({ age: 'unknown' }, 30) === 30, 'invalid age text must use fallback');
assert(context.getValidAge({ age: -1 }, 30) === 30, 'negative age must use fallback');
assert(context.getValidAge({}, 30) === 30, 'missing age must use fallback');
assert(context.getValidAge({}, null) === null, 'candidate filters may request an explicit invalid-age sentinel');

const infantRegency = context.InfluenceGroups.buildRegentSignal({
  turn: 1,
  playerInfo: { characterName: '幼主' },
  chars: [{ id: 'infant-ruler', name: '幼主', age: 0, health: 0, isRuler: true }]
});
assert(infantRegency.active === true, 'zero-age ruler must activate the regency signal');
assert(infantRegency.hardCeiling === true, 'zero-age ruler must activate the hard regency ceiling');
assert(infantRegency.rulerAge === 0, 'regency diagnostics must preserve zero age');
assert(infantRegency.rulerHealth === 0, 'regency diagnostics must preserve zero health');

context.P.time = { perTurn: '1y' };
context.GM.turn = 1;
context.GM.sid = 'age-regression';
context.GM.chars = [{ id: 'newborn', name: '新生儿', age: 0, alive: true }];
context.updateCharacters(12);
assert(context.GM.chars[0].age === 1, 'production age increment must advance zero age to one');

context.GM.chars = [
  { id: 'baby', name: '婴儿', age: 0, alive: true, loyalty: 90, intelligence: 90 },
  { id: 'adult', name: '成人', age: 30, alive: true, loyalty: 90, intelligence: 90 },
  { id: 'legacy', name: '旧档缺龄', alive: true, loyalty: 90, intelligence: 90 }
];
const screened = context.quanxuanInitialScreen({ requirements: {} }, {});
assert(!screened.some(item => item.name === '婴儿'), 'zero-age child must not enter adult appointment candidates');
assert(screened.some(item => item.name === '成人'), 'valid adult must remain eligible');
assert(screened.some(item => item.name === '旧档缺龄'), 'missing legacy age must keep the documented adult fallback');

console.log('smoke-rank-age-invariants: PASS (' + assertions + ' assertions)');
