const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, Date, Math, JSON, WeakMap, Promise, setTimeout, clearTimeout, window: {} };
sandbox.window.window = sandbox.window;
sandbox.window.globalThis = sandbox.window;

function load(name) {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), sandbox.window, { filename: name });
}

load('tm-perf.js');
load('tm-memory-retrieval.js');
load('tm-context-zones.js');
load('tm-memory-context-compiler.js');

const TM = sandbox.window.TM;
const MR = TM.MemoryRetrieval;
const MC = TM.MemoryContextCompiler;
const perf = TM.perf;
assert(MR && MC && perf, 'memory providers and perf provider should load');

function makeHits(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `memory-${i}`,
      source: i % 4 === 0 ? 'imperialEdict' : 'shiji',
      text: `第${i}条长期记忆`,
      turn: i + 1,
      importance: (i % 10) + 1,
      relevance: 0.7,
      status: 'active',
    });
  }
  return rows;
}

const GM = {
  _campaignId: 'campaign-memory-index',
  _timelineId: 'timeline-memory-index',
  turn: 10001,
  _memoryRevision: 1,
  _memoryEdgeRevision: 1,
  _memEdges: [
    { type: 'supersedes', src: 'memory-1', dst: 'memory-2', reason: 'new replaces old' },
    { type: 'contradicts', src: 'memory-4', dst: 'memory-5', reason: 'hard fact contradicts history' },
  ],
  _edictRelations: [],
};

const small = makeHits(500);
perf.reset();
const first = MR.rankHitsDetailed(small, { GM, turn: GM.turn });
assert(!first.ranked.some((hit) => hit.id === 'memory-2'), 'superseded hit should remain suppressed');
assert(!first.ranked.some((hit) => hit.id === 'memory-5'), 'lower-authority contradicted hit should remain suppressed');
assert.strictEqual(first.compilationIndex.hitsById['memory-1'], small[1], 'compilation index keeps stable hit lookup');
assert(first.compilationIndex.hitsByNode['memory-1'].includes(small[1]), 'compilation index keeps reverse node lookup');
let report = perf.workReport();
assert.strictEqual(report.counters['memory.edgeTableBuilds'], 1, 'relation edge table should build once for the revision');
assert.strictEqual(report.counters['memory.hitNodeBuilds'], 500, 'each hit should normalize its relation nodes once');

MR.rankHitsDetailed(small, { GM, turn: GM.turn });
report = perf.workReport();
assert.strictEqual(report.counters['memory.edgeTableBuilds'], 1, 'second compilation in the same revision should reuse the edge table');
assert.strictEqual(report.counters['memory.hitNodeBuilds'], 500, 'second compilation should reuse normalized hit nodes');

GM._memEdges.push({ type: 'supersedes', src: 'memory-6', dst: 'memory-7' });
MR.bumpRevision(GM, 'edges');
MR.rankHitsDetailed(small, { GM, turn: GM.turn });
report = perf.workReport();
assert.strictEqual(report.counters['memory.edgeTableBuilds'], 2, 'edge revision change should rebuild the relation table exactly once');

const scaleMetrics = [];
[2000, 10000].forEach((size) => {
  const hits = makeHits(size);
  perf.reset();
  MR.invalidateCompilationIndex(GM);
  MR.rankHitsDetailed(hits, { GM, turn: GM.turn });
  const work = perf.workReport().counters;
  assert.strictEqual(work['memory.edgeTableBuilds'], 1, `${size} hits should still build one edge table`);
  assert.strictEqual(work['memory.hitNodeBuilds'], size, `${size} hits should build one normalized node row each`);
  assert(work['memory.edgeCandidateChecks'] < size * 20, `${size} hit relation checks should remain linear in hits for fixed edges`);
  scaleMetrics.push({
    hits: size,
    edgeTableBuilds: work['memory.edgeTableBuilds'],
    hitNodeBuilds: work['memory.hitNodeBuilds'],
    edgeCandidateChecks: work['memory.edgeCandidateChecks']
  });
});

perf.reset();
const compiled = MC.compileHits(makeHits(500), { maxTokens: 320 });
report = perf.workReport();
assert.strictEqual(report.counters['memory.renderedFragments'], 500, 'each renderable memory fragment should render once per compilation');
assert.strictEqual(compiled.compilationIndex.renderedFragments.chronology.length, 375, 'rendered fragments are retained by section');
assert.strictEqual(compiled.compilationIndex.fragmentTokenCosts.chronology.length, 375, 'fragment token costs are retained once');
assert(compiled.tokenEstimate <= 320, 'pre-rendered fragment compression should preserve the hard token budget');
assert(compiled.text.startsWith('<memory-context'), 'compiled context should preserve the production schema');

console.log('smoke-memory-relation-index ok ' + JSON.stringify(scaleMetrics));
