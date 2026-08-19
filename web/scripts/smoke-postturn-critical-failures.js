#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tm-post-turn-jobs.js'), 'utf8');
const start = source.indexOf('var _POST_TURN_NEXT_REQUIRED_IDS');
const end = source.indexOf('function _compressOldArchives', start);
if (start < 0 || end <= start) throw new Error('post-turn queue source slice missing');

let assertions = 0;
function ok(value, label) {
  if (!value) throw new Error('[smoke-postturn-critical-failures] ' + label);
  assertions++;
}

const ctx = { console, Promise, Date, Object, JSON, Error, _dbg() {}, TM: {}, recordMemoryDiagnostic() {} };
ctx.window = ctx;
ctx._tmLoadGen = 0;
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);

function resetWorld() {
  ctx.GM = { turn: 6, sid: 's1', _campaignId: 'c1', _turnAiResults: { sourcePayload: { keep: true } } };
  ctx.P = { marker: 'p1' };
  ctx._tmLoadGen = 0;
}

async function rejects(fn) {
  try { await fn(); return null; }
  catch (error) { return error; }
}

async function main() {
  resetWorld();
  ctx._enqueuePostTurnJob('sc25c', async function() { throw new Error('sc25c forced failure'); });
  const failedQueue = ctx.GM._postTurnJobs;
  const error = await rejects(() => ctx._awaitPostTurnJobs());
  ok(error && /sc25c/.test(error.message), 'critical sc25c rejection blocks next-turn freshness');
  ok(ctx.GM._postTurnJobs === failedQueue && ctx.GM._postTurnJobs.pending.length === 1, 'failed critical queue remains available for retry and diagnosis');
  ok(ctx.GM._turnAiResults.sourcePayload.keep === true, 'failed critical job preserves source AI data');
  const saveError = await rejects(() => ctx._awaitPostTurnJobsForSave());
  ok(saveError && /sc25c/.test(saveError.message), 'failed critical job blocks save commit');

  let childRan = false;
  ctx._enqueuePostTurnJob('dependent-probe', async function() { childRan = true; }, { dependsOn: ['sc25c'] });
  const child = ctx.GM._postTurnJobs.pending.find(job => job.id === 'dependent-probe');
  const childResult = await child.promise;
  ok(childResult && childResult.ok === false && childRan === false, 'dependency failure prevents child task execution');

  resetWorld();
  let attempts = 0;
  ctx._enqueuePostTurnJob('sc25c', async function() {
    attempts++;
    if (attempts === 1) throw new Error('temporary sc25c failure');
    return { recovered: true };
  });
  const firstFailure = await rejects(() => ctx._awaitPostTurnJobs());
  ok(firstFailure && attempts === 1 && ctx.GM._postTurnJobs.pending[0].status === 'retryable',
    'first critical failure remains visible and records a retryable task instead of a dead Promise');
  await ctx._awaitPostTurnJobs();
  ok(attempts === 2 && ctx.GM._postTurnJobs === null && !Object.prototype.hasOwnProperty.call(ctx.GM, '_turnAiResults'),
    'next save/turn wait rebuilds the task Promise and clears source data only after success');

  resetWorld();
  ctx._enqueuePostTurnJob('sc25c', async function() { return { tactical: true, strategic: true }; });
  await ctx._awaitPostTurnJobs();
  ok(ctx.GM._postTurnJobs === null && !Object.prototype.hasOwnProperty.call(ctx.GM, '_turnAiResults'), 'successful critical jobs clear queue and source data');

  console.log('[smoke-postturn-critical-failures] PASS assertions=' + assertions);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
