#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const timeSource = fs.readFileSync(path.join(WEB, 'tm-time-utils.js'), 'utf8');
const chronicleSource = fs.readFileSync(path.join(WEB, 'tm-chronicle-system.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(WEB, 'tm-endturn-core.js'), 'utf8');
let assertions = 0;
function check(value, message) {
  if (!value) throw new Error('[smoke-chronicle-world-lease] ' + message);
  assertions++;
}
function sourceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  if (start < 0 || end <= start) throw new Error('source slice missing: ' + startText);
  return source.slice(start, end);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

let daysPerTurn = 30;
let aiCalls = 0;
let aiQueue = [];
let aiPrompts = [];
const durableChronicles = new Map();
const ctx = {
  console,
  Date,
  Promise,
  Object,
  Array,
  Number,
  String,
  Boolean,
  JSON,
  Math,
  Error,
  setTimeout,
  clearTimeout,
  deepClone: clone,
  _getDaysPerTurn: () => daysPerTurn,
  findScenarioById: () => ({ dynasty: '测试朝', emperor: '测试帝' }),
  _getCharRange: () => [100, 200],
  _charRangeText: () => '100-200字',
  _charRangeScaled: () => '50-100字',
  _buildTemporalConstraint: () => '',
  extractJSON: value => typeof value === 'string' ? JSON.parse(value) : value,
  callAI(prompt) {
    aiCalls++;
    aiPrompts.push(String(prompt || ''));
    const task = deferred();
    aiQueue.push(task);
    return task.promise;
  },
  TM_SaveDB: {
    async saveChronicleRecord(record, options) {
      if (options && typeof options.writeGuard === 'function' && options.writeGuard() !== true) return false;
      durableChronicles.set(record.campaignId + ':' + record.year, clone(record));
      return true;
    },
    async listChronicleRecords(campaignId) {
      return Array.from(durableChronicles.values()).filter(record => record.campaignId === campaignId).map(clone);
    }
  },
  _dbg() {},
  addEB() {},
  buildIndices() {},
  renderGameState() {},
  _tmLoadGen: 0,
  TM: { errors: { capture() {} } }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(timeSource, ctx, { filename: 'tm-time-utils.js' });
vm.runInContext(chronicleSource, ctx, { filename: 'tm-chronicle-system.js' });
vm.runInContext(sourceBetween(coreSource, 'function _tmCaptureEndTurnObject', 'async function _tmFinalizeEndTurnTransaction'), ctx, { filename: 'tm-endturn-core-transaction.js' });

function setWorld(id, time) {
  ctx.GM = { turn: 1, sid: 'scenario-1', _campaignId: id, busy: false };
  ctx.P = {
    ai: { key: 'test-key' }, conf: { chronicleKeep: 10 }, chronicleConfig: {},
    time: Object.assign({ year: 2026, startYear: 2026, startMonth: 1, startDay: 1 }, time || {})
  };
  ctx.ChronicleSystem.reset(ctx.GM);
}

(async function main() {
  setWorld('calendar-start', { year: 2026, startYear: 2026, startMonth: 9, startDay: 1 });
  daysPerTurn = 30;
  ctx.ChronicleSystem.addMonthDraft(1, '九月首稿', '一');
  ctx.ChronicleSystem.addMonthDraft(2, '十月次稿', '二');
  ctx.ChronicleSystem.addMonthDraft(3, '十月末稿', '三');
  const drafts = ctx.ChronicleSystem.serialize().monthDrafts;
  check(Object.keys(drafts).join(',') === '1,2,3', 'same-quarter turns are retained under append-only turn keys');
  check(drafts['1'].year === 2026 && drafts['1'].month === 9 && drafts['1'].day === 1, 'September scenario start uses canonical start month/day');
  check(drafts['2'].month === 10 && drafts['2'].day === 1 && drafts['3'].month === 10 && drafts['3'].day === 31,
    'turn dates follow TimeUtils instead of fixed quarter arithmetic');

  const beforeRollback = ctx.ChronicleSystem.serialize();
  const txn = ctx._tmCaptureEndTurnTransaction();
  ctx.ChronicleSystem.addMonthDraft(4, '事务内月稿', '应回滚');
  check(Object.keys(ctx.ChronicleSystem.monthDrafts).length === 4, 'chronicle mutation lands inside GM campaign state');
  ctx._tmRollbackEndTurnTransaction(txn, new Error('forced later finalization failure'));
  check(JSON.stringify(ctx.ChronicleSystem.serialize()) === JSON.stringify(beforeRollback), 'GM/P rollback also restores ChronicleSystem state');

  setWorld('leap-calendar', { year: 2024, startYear: 2024, startMonth: 2, startDay: 28 });
  daysPerTurn = 1;
  ctx.ChronicleSystem.addMonthDraft(1, '二月廿八', '');
  ctx.ChronicleSystem.addMonthDraft(2, '闰日', '');
  ctx.ChronicleSystem.addMonthDraft(3, '三月初一', '');
  const leapDrafts = ctx.ChronicleSystem.serialize().monthDrafts;
  check(leapDrafts['2'].year === 2024 && leapDrafts['2'].month === 2 && leapDrafts['2'].day === 29,
    'leap-year February matches canonical calendar');
  check(leapDrafts['3'].month === 3 && leapDrafts['3'].day === 1, 'day after leap day advances to March 1');

  setWorld('annual-filter', { year: 2024, startYear: 2024, startMonth: 1, startDay: 1 });
  daysPerTurn = 30;
  let first2025Turn = 1;
  while (ctx.TimeUtils.turnToDate(first2025Turn).year < 2025) first2025Turn++;
  ctx.ChronicleSystem.addMonthDraft(first2025Turn, '二年正史素材', '');
  ctx.GM._yearlyDigest = [
    { turn: 1, year: 2024, summary: '上一年摘要不得出现' },
    { turn: first2025Turn, year: 2025, summary: '本年显式摘要' },
    { turn: first2025Turn + 1, summary: '本年旧格式摘要' }
  ];
  ctx.GM._foreshadowings = [{ resolved: true, plantTurn: 1, resolveTurn: first2025Turn, content: '伏笔', resolveContent: '回收' }];
  ctx.GM._edictTracker = [{ turn: first2025Turn, category: '诏令', content: '本年诏令', status: 'done' }];
  ctx.GM._endTurnCommitPending = true;
  aiQueue = [];
  aiPrompts = [];
  const filteredRequest = ctx.ChronicleSystem._tryGenerateYearChronicle(2025);
  check(aiPrompts.length === 1 && !aiPrompts[0].includes('上一年摘要不得出现')
    && aiPrompts[0].includes('本年显式摘要') && aiPrompts[0].includes('本年旧格式摘要'),
  'annual prompt includes only digests belonging to the canonical target year');
  check(aiPrompts[0].includes('本年诏令') && aiPrompts[0].includes('伏笔'),
    'edict and foreshadowing year filters share the canonical calendar');
  aiQueue.shift().resolve(JSON.stringify({ chronicle: '二年正史', afterword: '二年史评' }));
  await new Promise(resolve => setTimeout(resolve, 5));
  check(!durableChronicles.has('annual-filter:2025') && !ctx.ChronicleSystem.yearChronicles[2025],
    'annual result waits for the world commit barrier before becoming durable');
  ctx.GM._endTurnCommitPending = false;
  const filteredGenerated = await filteredRequest;
  check(filteredGenerated && filteredGenerated.ok === true && filteredGenerated.durable === true
    && durableChronicles.has('annual-filter:2025'),
  'annual result checkpoints durably before it is exposed in campaign memory');

  ctx._tmLoadGen++;
  setWorld('annual-filter', { year: 2024, startYear: 2024, startMonth: 1, startDay: 1 });
  check(!ctx.ChronicleSystem.yearChronicles[2025], 'canonical world snapshot may predate the completed background chronicle');
  const hydrated = await ctx.ChronicleSystem.hydrateDurableRecords(ctx.GM, ctx.P);
  check(hydrated && hydrated.ok === true && hydrated.merged === 1
    && ctx.ChronicleSystem.yearChronicles[2025].content === '二年正史',
  'immediate reload restores a background chronicle from the lightweight checkpoint');

  ctx.ChronicleSystem.yearChronicles = { 100: { content: '百年' }, 9: { content: '九年' }, 10: { content: '十年' } };
  check(ctx.ChronicleSystem.getAvailableYears().join(',') === '9,10,100', 'chronicle years sort numerically');

  setWorld('campaign-A', { year: 2024, startYear: 2024 });
  daysPerTurn = 30;
  ctx.ChronicleSystem.addMonthDraft(1, 'A局年度素材', '');
  aiCalls = 0;
  aiQueue = [];
  const requestA = ctx.ChronicleSystem._tryGenerateYearChronicle(2024);
  check(aiCalls === 1 && aiQueue.length === 1, 'annual generation starts one background request');
  const taskA = aiQueue.shift();
  ctx._tmLoadGen++;
  setWorld('campaign-B', { year: 2030, startYear: 2030 });
  taskA.resolve(JSON.stringify({ chronicle: 'A局正史', afterword: 'A局史评' }));
  const staleA = await requestA;
  check(staleA && staleA.stale === true && Object.keys(ctx.ChronicleSystem.yearChronicles).length === 0,
    'late result from campaign A cannot write into loaded campaign B');

  setWorld('campaign-rollback', { year: 2024, startYear: 2024 });
  ctx.ChronicleSystem.addMonthDraft(1, '待回滚年度素材', '');
  const beforeAsyncRollback = ctx.ChronicleSystem.serialize();
  const asyncTxn = ctx._tmCaptureEndTurnTransaction();
  aiQueue = [];
  const rolledBackRequest = ctx.ChronicleSystem._tryGenerateYearChronicle(2024);
  const rollbackTask = aiQueue.shift();
  ctx._tmRollbackEndTurnTransaction(asyncTxn, new Error('save failed'));
  rollbackTask.resolve(JSON.stringify({ chronicle: '不应落地', afterword: '' }));
  const staleRollback = await rolledBackRequest;
  check(staleRollback && staleRollback.stale === true && JSON.stringify(ctx.ChronicleSystem.serialize()) === JSON.stringify(beforeAsyncRollback),
    'annual result returning after transaction rollback is discarded');

  setWorld('campaign-dedup', { year: 2024, startYear: 2024 });
  ctx.ChronicleSystem.addMonthDraft(1, '去重年度素材', '');
  aiCalls = 0;
  aiQueue = [];
  const first = ctx.ChronicleSystem._tryGenerateYearChronicle(2024);
  const second = ctx.ChronicleSystem._tryGenerateYearChronicle(2024);
  check(first === second && aiCalls === 1, 'same campaign/year reuses one in-flight request');
  aiQueue.shift().resolve(JSON.stringify({ chronicle: '唯一年度正史', afterword: '唯一史评' }));
  const generated = await first;
  check(generated && generated.ok === true && ctx.ChronicleSystem.yearChronicles[2024].content === '唯一年度正史',
    'current leased annual result commits exactly once');

  const detached = { _chronicleSysState: { monthDrafts: { 9: { turn: 9, year: 1999 } }, yearChronicles: {} } };
  check(ctx.ChronicleSystem.serialize(detached).monthDrafts['9'].year === 1999,
    'save preparation can serialize its detached GM snapshot without reading the live world');

  console.log('[smoke-chronicle-world-lease] PASS assertions=' + assertions);
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
