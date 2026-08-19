#!/usr/bin/env node
// Guards deferred court-close ordering: critical finalization before post-commit UI.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const court = fs.readFileSync(path.join(ROOT, 'tm-court-meter.js'), 'utf8');
const pipeline = fs.readFileSync(path.join(ROOT, 'tm-endturn-pipeline-steps.js'), 'utf8');
let passed = 0;
function assert(cond, label) { if (!cond) throw new Error('[assert] ' + label); passed++; }

const closeStart = court.indexOf('async function _onPostTurnCourtEnd()');
const closeBody = court.slice(closeStart);
assert(closeStart >= 0, 'post-turn court close handler exists');
assert(closeBody.indexOf('_endTurn_render.apply') < 0, 'court handler never renders an uncommitted result');
assert(closeBody.indexOf('await _deferredPhase5();') >= 0, 'court close awaits the shared critical finalizer');
assert(closeBody.indexOf('_finishPostTurnCourtState();') > closeBody.indexOf('await _deferredPhase5();'), 'court state is released only after finalization succeeds');

const deferredStart = pipeline.indexOf('GM._pendingShijiModal.deferredPhase5 = async function()');
const deferredBody = pipeline.slice(deferredStart, deferredStart + 1400);
assert(deferredStart >= 0, 'pipeline registers deferred finalization closure');
assert(deferredBody.indexOf('await _runPostRenderTurnOpeners(ctx)') >= 0, 'deferred state writers finish before commit barrier');
assert(deferredBody.indexOf('ctx.meta.deferEndTurnSave = false') >= 0, 'deferred closure explicitly arms the final save');
assert(deferredBody.indexOf('await _tmFinalizeEndTurnTransaction(ctx, ctx.meta.transaction)') >= 0,
  'deferred closure uses the same record/save/commit/post-commit UI transaction entry');

console.log('[smoke-postturn-court-render-fallback] pass assertions=' + passed);
