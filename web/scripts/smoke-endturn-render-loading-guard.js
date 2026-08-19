#!/usr/bin/env node
// Guards the post-commit-only UI render boundary and its loading-overlay fallback.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'tm-endturn-core.js'), 'utf8');
const pipeline = fs.readFileSync(path.join(ROOT, 'tm-endturn-pipeline-steps.js'), 'utf8');
const render = fs.readFileSync(path.join(ROOT, 'tm-endturn-render.js'), 'utf8');
let passed = 0;
function assert(cond, label) { if (!cond) throw new Error('[assert] ' + label); passed++; }

const commitIdx = core.indexOf('if (!_tmCommitEndTurnTransaction(txn))');
const renderIdx = core.indexOf('_endTurn_render(ctx.meta.turnPresentation)', commitIdx);
assert(commitIdx >= 0 && renderIdx > commitIdx, 'pure UI render starts only after the world transaction commits');
const postCommit = core.slice(commitIdx, renderIdx + 900);
assert(postCommit.indexOf('ctx.results.renderError = renderError') >= 0, 'post-commit render failure is retained for diagnostics');
assert(postCommit.indexOf('_endTurn_showRenderFallback(renderError)') >= 0, 'post-commit render failure opens the safe fallback');
assert(pipeline.indexOf('_endTurn_render.apply(null, _renderArgs)') < 0, 'pipeline no longer renders before state finalization and save');
assert(pipeline.indexOf('ctx.meta.turnRenderArgs = _renderArgs') >= 0, 'pipeline stages immutable render inputs for the commit barrier');

const fallbackIdx = render.indexOf('function _endTurn_showRenderFallback(error)');
const fallback = render.slice(fallbackIdx, fallbackIdx + 1300);
assert(fallbackIdx >= 0 && fallback.indexOf("typeof hideLoading === 'function'") >= 0, 'fallback always releases the loading overlay');
assert(fallback.indexOf('showTurnResult(') >= 0 && fallback.indexOf('本回合已安全保存') >= 0, 'fallback accurately reports a committed world');

console.log('[smoke-endturn-render-loading-guard] pass assertions=' + passed);
