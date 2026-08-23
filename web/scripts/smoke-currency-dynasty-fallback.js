#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = [
  'tm-world-era.js',
  'tm-economy-engine-currency.js',
  'tm-fiscal-engine.js'
].map((name) => [name, fs.readFileSync(path.join(ROOT, name), 'utf8')]);

let assertions = 0;
function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-currency-dynasty-fallback] ' + message);
}

const scenarios = Object.create(null);
const context = {
  console,
  Math,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  Promise,
  Set,
  Map,
  TM: { errors: { capture(error) { throw error; } } },
  GM: {},
  P: {},
  scriptData: {},
  findScenarioById(id) { return scenarios[id] || null; }
};
context.window = context;
context.global = context;
context.globalThis = context;
vm.createContext(context);
for (const [name, source] of SOURCES) vm.runInContext(source, context, { filename: name });

function reset({ sid = '', scenario = null, GM = {}, P = {}, scriptData = {} } = {}) {
  for (const key of Object.keys(scenarios)) delete scenarios[key];
  if (sid && scenario) scenarios[sid] = scenario;
  context.GM = Object.assign({ sid, turn: 1 }, GM);
  context.P = P;
  context.scriptData = scriptData;
}

function assertMoney(expected, label) {
  const unit = context.CurrencyUnit.getUnit();
  check(unit.money === expected, label + ' money unit is ' + expected + ', got ' + unit.money);
  check(context.CurrencyUnit.unitOf('money') === expected, label + ' unitOf agrees with getUnit');
  check(context.CurrencyUnit.fmt(12, 'money').endsWith(expected), label + ' UI formatter uses the same unit');
  return unit;
}

reset({ sid: 'official-qin', scenario: { id: 'official-qin', dynasty: '秦' }, GM: { dynasty: '清' } });
check(context.TMWorldEra.resolveDetail().source === 'scenario.dynasty', 'registered scenario has first dynasty priority');
assertMoney('钱', 'registered Qin scenario');

reset({ sid: 'official-song', scenario: { id: 'official-song', era: '南宋' } });
assertMoney('贯', 'registered Southern Song scenario');

reset({ sid: 'custom-missing', GM: { eraState: { dynasty: '大唐' } } });
check(context.TMWorldEra.resolve() === '大唐', 'unregistered custom world resolves GM.eraState dynasty');
assertMoney('贯', 'GM eraState Tang');
context.CurrencyEngine.init(null);
check(context.GM.currency.dynasty === '唐', 'coin engine uses the same canonical Tang dynasty');
check(context.CurrencyEngine.getAIContext().includes('计价单位：贯'), 'AI currency context uses the UI currency unit');
check(context.FiscalEngine.resolveDynasty(context.GM) === '大唐', 'fiscal engine uses the shared current-world resolver');

reset({ GM: { dynasty: '西汉' } });
assertMoney('钱', 'GM dynasty fallback');
reset({ GM: { era: '五代十国' } });
assertMoney('贯', 'GM era fallback');
reset({ P: { dynasty: '北宋' } });
assertMoney('贯', 'P dynasty fallback');
reset({ P: { era: '东汉' } });
assertMoney('钱', 'P era fallback');
reset({ scriptData: { dynasty: '唐' } });
assertMoney('贯', 'editor dynasty fallback');
reset({ scriptData: { settings: { dynasty: '秦' } } });
assertMoney('钱', 'editor settings dynasty fallback');
reset();
assertMoney('两', 'old save without dynasty');
reset({ GM: { dynasty: '星海架空朝' } });
check(context.CurrencyUnit.getUnit().dynastyKey === 'default', 'unknown fictional dynasty stays explicit default');
assertMoney('两', 'unknown fictional dynasty');

const compositeCases = [
  ['南北朝', '钱'],
  ['五代十国', '贯'],
  ['南宋', '贯'],
  ['北宋', '贯'],
  ['南明', '两'],
  ['明清更迭', '两'],
  ['秦汉', '钱']
];
for (const [dynasty, expected] of compositeCases) {
  reset({ GM: { dynasty } });
  assertMoney(expected, 'composite dynasty ' + dynasty);
}

reset({
  sid: 'explicit-scenario',
  scenario: { id: 'explicit-scenario', dynasty: '秦', fiscalConfig: { unit: { money: '贝', grain: '斛' } } },
  GM: { fiscal: { unit: { money: '两', grain: '石', cloth: '匹' } } }
});
let unit = context.CurrencyUnit.getUnit();
check(unit.money === '贝' && unit.grain === '斛', 'scenario fiscalConfig unit overrides GM runtime unit');
check(unit.cloth === '匹', 'missing scenario field falls through to GM explicit field');

reset({
  sid: 'explicit-world',
  scenario: { id: 'explicit-world', dynasty: '清', fiscalConfig: { unit: { money: '两' } } },
  GM: { fiscal: { unit: { money: '锭', silverToCoin: 9 } } },
  P: { fiscalConfig: { unit: { money: '铢', silverToCoin: 0 } } }
});
unit = context.CurrencyUnit.getUnit();
check(unit.money === '铢', 'active-world P fiscalConfig has explicit-unit priority');
check(unit.silverToCoin === 0, 'explicit zero conversion ratio is preserved');

reset({ GM: { dynasty: '唐', fiscal: { unit: { money: '缗' } } } });
assertMoney('缗', 'GM fiscal runtime override');

reset({ GM: { dynasty: '宋' } });
const beforeSave = context.CurrencyUnit.getUnit();
const savedGM = JSON.parse(JSON.stringify(context.GM));
const savedP = JSON.parse(JSON.stringify(context.P));
context.GM = JSON.parse(JSON.stringify(savedGM));
context.P = JSON.parse(JSON.stringify(savedP));
const afterLoad = context.CurrencyUnit.getUnit();
check(JSON.stringify(afterLoad) === JSON.stringify(beforeSave), 'currency resolution remains stable after save/load cloning');

console.log('[smoke-currency-dynasty-fallback] PASS assertions=' + assertions);
