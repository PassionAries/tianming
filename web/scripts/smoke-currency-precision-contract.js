#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'tm-economy-engine-currency.js'), 'utf8');
let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error('[smoke-currency-precision-contract] ' + message);
  passed++;
}

const fixedMath = Object.create(Math);
fixedMath.random = () => 0.5;
const capturedErrors = [];
const ctx = {
  console: { log() {}, info() {}, warn() {}, error(...args) { capturedErrors.push(args.map(String).join(' ')); } },
  Math: fixedMath, Date, JSON, Number, String, Object, Array, isFinite, isNaN,
  GM: {
    sid: 'currency-smoke', turn: 1, month: 2, year: 800,
    vars: { pop: 1000000, farmland: 10000000, disasterLevel: 0.1, poverty: 0.2 },
    activeWars: [],
    guoku: { money: 0.125, balance: 0.125, ledgers: { money: { stock: 0.125 } }, sources: {} }
  },
  P: { ai: {}, conf: {} },
  TM: { errors: { capture(error, label) { capturedErrors.push(label + ':' + (error && error.message || error)); } } },
  findScenarioById() { return { dynasty: '唐' }; }
};
ctx.window = ctx;
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(source, ctx, { filename: 'tm-economy-engine-currency.js' });

assert(ctx.CurrencyEngine.PRECISION_CONTRACT.ledgerAllowsFractional === true
  && ctx.CurrencyEngine.PRECISION_CONTRACT.settlementQuantization === 'none', 'runtime precision contract explicitly permits fractional ledger values');
ctx.CurrencyEngine.init({ dynasty: '唐' });
const agency = ctx.GM.currency.mintAgencies[0];
const copper = ctx.GM.currency.coins.copper;
agency.capacity = 123.45;
agency.staffing = 87.5;
agency.costPerUnit = 0.333;
agency.seignioragePerUnit = 0.271;
copper.rawReserve = 1000000.75;
copper.stock = 1000.125;
const initialTreasury = ctx.GM.guoku.ledgers.money.stock;

for (let turn = 1; turn <= 10000; turn++) {
  ctx.GM.turn = turn;
  ctx.CurrencyEngine.tick({ turn, monthRatio: 0.0001 });
}

const money = ctx.GM.guoku.ledgers.money.stock;
assert(capturedErrors.length === 0, '10,000 deterministic settlements complete without hidden subsystem errors: ' + capturedErrors.join(' | '));
assert(Number.isFinite(money) && Number.isFinite(copper.stock) && Number.isFinite(copper.mintQuantity), 'long-run treasury and coin ledgers remain finite');
assert(money === ctx.GM.guoku.money && money === ctx.GM.guoku.balance, 'money ledger and compatibility mirrors stay exactly synchronized');
assert(Math.abs(money - Math.round(money)) > 1e-6, 'legal fractional seigniorage is not rounded away at settlement boundaries');
assert(money > initialTreasury && copper.stock > 1000.125 && copper.mintHistory.length === 40, 'minting accumulates value and retains the bounded history contract');

const serialized = JSON.parse(JSON.stringify(ctx.GM));
assert(serialized.guoku.ledgers.money.stock === money && serialized.currency.coins.copper.stock === copper.stock, 'save serialization preserves fractional ledger values exactly');
assert(/^\d/.test(ctx.CurrencyUnit.fmt(money, 'money')) && ctx.CurrencyUnit.fmt(money, 'money').endsWith('贯'), 'UI formatting applies presentation rounding with the active dynasty unit');
assert(!/stock\s*=\s*Math\.round\s*\(\s*stock\s*\+/.test(source), 'currency engine does not round the entire treasury stock after income');

console.log('[smoke-currency-precision-contract] pass assertions=' + passed + ' finalMoney=' + money);
