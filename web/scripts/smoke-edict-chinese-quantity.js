#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let assertions = 0;
function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-edict-chinese-quantity] ' + message);
}
function load(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

const transferOrders = [];
const issuedPapers = [];
const corveeCalls = [];
const context = {
  console,
  setTimeout,
  clearTimeout,
  GM: {
    turn: 12,
    population: {
      meta: {},
      national: { mouths: 200000, households: 40000, ding: 65000 },
      hiddenCount: 0,
      fugitives: 30000,
      byCategory: {},
      byLegalStatus: { huangji: { mouths: 0, households: 0, ding: 0 } },
      byRegion: {
        shaanxi: { mouths: 100000, households: 20000, ding: 32000 },
        jingji: { mouths: 100000, households: 20000, ding: 33000 }
      },
      military: { totalPool: 0, types: {} },
      corvee: { events: [] }
    },
    fiscal: { regions: { jiangnan: { name: '江南' } } },
    regions: [{ id: 'jiangnan', name: '江南' }],
    currency: { paper: { issuances: [] } }
  },
  P: {},
  scriptData: {},
  EconomyLinkage: {
    createTransferOrder(spec) {
      transferOrders.push(spec);
      return { ok: true, orderId: 'transfer-1' };
    }
  },
  CurrencyEngine: {
    REFORM_PRESETS: [],
    issuePaper(spec) {
      issuedPapers.push(spec);
      return { ok: true, success: true };
    }
  },
  HujiEngine: {
    LARGE_CORVEE_PRESETS: [{ id: 'river_repair' }],
    startLargeCorvee(id, options) {
      corveeCalls.push({ id, options });
      return { ok: true };
    }
  },
  globalThis: null,
  window: null
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
load(context, 'tm-number-parser.js');
load(context, 'tm-edict-parser.js');

[
  ['五万', 50000],
  ['十万', 100000],
  ['十二万三千', 123000],
  ['一亿零五万', 100050000],
  ['两万', 20000],
  ['3.5万', 35000],
  ['壹拾万', 100000],
  ['三千五百', 3500]
].forEach(([text, expected]) => {
  const parsed = context.TMNumberParser.parseNumber(text);
  check(parsed.ok && parsed.value === expected, text + ' parses to ' + expected);
});

[
  ['征兵五万', 50000],
  ['调银十万两', 100000],
  ['移民两万', 20000],
  ['发徭役三万', 30000],
  ['拨粮十二万石', 120000],
  ['增发钱三百五十万贯', 3500000]
].forEach(([text, expected]) => {
  const parsed = context.TMNumberParser.extractEdictQuantity(text);
  check(parsed.ok && parsed.value === expected, text + ' extracts the intended action quantity');
});

[
  '承和十六年颁诏休养生息',
  '第一道诏命整饬吏治',
  '三成税率暂缓施行',
  '第十二州上奏灾情',
  '命张三负责此案'
].forEach((text) => {
  check(context.TMNumberParser.extractEdictQuantity(text).ok === false, text + ' is not an action quantity');
});

let result = context.EdictParser.tryExecute('征兵五万', {}, { typeOverride: 'military_reform' });
check(result.ok && context.GM.population.military.totalPool === 50000, 'formal conscription route applies 五万 without fallback');

result = context.EdictParser.tryExecute('征兵3.5万', {}, { typeOverride: 'military_reform' });
check(result.ok && context.GM.population.military.totalPool === 85000, 'Arabic decimal 万 behavior remains intact');

result = context.EdictParser.tryExecute('修河发徭役三万', {}, { typeOverride: 'corvee_reform' });
check(result.ok && corveeCalls.length === 1 && corveeCalls[0].options.amount === 30000, 'formal corvee route applies 三万');

result = context.EdictParser.tryExecute('迁民安置流民两万，由陕西迁往京畿', {}, { typeOverride: 'huji_reform' });
check(result.ok && context.GM.population.byRegion.shaanxi.mouths === 80000 && context.GM.population.byRegion.jingji.mouths === 120000,
  'formal migration route transfers 两万');

result = context.EdictParser.tryExecute('下拨江南粮十二万石赈灾', {}, { typeOverride: 'central_local_finance' });
check(result.ok && transferOrders.length === 1 && transferOrders[0].amount === 120000, 'formal transfer route applies 十二万石');

result = context.EdictParser.tryExecute('发行交子三百五十万贯', {}, { typeOverride: 'currency_reform' });
check(result.ok && issuedPapers.length === 1 && issuedPapers[0].originalAmount === 3500000, 'formal paper route applies 三百五十万贯');

const ambiguous = context.EdictParser.tryExecute('下拨江南银十万两，并拨粮十二万石赈灾', {}, { typeOverride: 'central_local_finance' });
check(ambiguous.ok === false && transferOrders.length === 1, 'ambiguous quantities fail without applying a fallback transfer');

const huge = context.EdictParser.tryExecute('征兵九千亿亿人', {}, { typeOverride: 'military_reform' });
check(huge.ok === false && context.GM.population.military.totalPool === 85000, 'malformed or overflowing quantities fail without state writes');

console.log('[smoke-edict-chinese-quantity] PASS assertions=' + assertions);
