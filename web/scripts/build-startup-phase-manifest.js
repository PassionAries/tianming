#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib-arch-guard');

const INDEX = path.join(lib.WEB_ROOT, 'index.html');
const PROVIDERS = path.join(lib.REPORT_DIR, 'global-providers.json');
const OUTPUT = path.join(lib.WEB_ROOT, 'startup-script-phases.json');
const CHECK = process.argv.includes('--check');

if (!fs.existsSync(PROVIDERS)) {
  throw new Error('global provider report missing; run node web/scripts/lint-global-providers.js first');
}

const report = JSON.parse(fs.readFileSync(PROVIDERS, 'utf8'));
const parsed = lib.parseIndexScripts(INDEX)
  .filter((row) => /\.js$/i.test(row.src || ''));
const providedByScript = new Map();
(report.definitions || []).forEach((definition) => {
  (definition.definitions || []).forEach((row) => {
    if (!providedByScript.has(row.src)) providedByScript.set(row.src, new Set());
    providedByScript.get(row.src).add(definition.name);
  });
});
const consumedByScript = new Map();
(report.earlyReads || []).forEach((row) => {
  if (!consumedByScript.has(row.src)) consumedByScript.set(row.src, new Set());
  consumedByScript.get(row.src).add(row.name);
});

const dataModelIndex = parsed.findIndex((row) => row.src === 'tm-data-model.js');
const worldIndex = parsed.findIndex((row) => row.src === 'tm-launch.js');
const optionalIndex = parsed.findIndex((row) => row.src === 'tm-content-manager.js');
if (dataModelIndex < 0 || worldIndex < 0 || optionalIndex < 0) throw new Error('startup phase boundary script missing');

function phaseFor(index) {
  if (index < dataModelIndex) return 'menu';
  if (index < worldIndex) return 'core';
  if (index < optionalIndex) return 'world';
  return 'optional';
}

const scripts = parsed.map((row, index) => ({
  script: row.src,
  order: index,
  phase: phaseFor(index),
  provides: Array.from(providedByScript.get(row.src) || []).sort(),
  consumes: Array.from(consumedByScript.get(row.src) || []).sort(),
  mustLoadBefore: index + 1 < parsed.length ? [parsed[index + 1].src] : [],
  mustLoadAfter: index > 0 ? [parsed[index - 1].src] : [],
  lazySafe: false,
  reason: 'Round 20 dependency audit retained the current classic-script order; no startup side-effect-free lazy boundary was proven for this provider.'
}));

const manifest = {
  version: 1,
  source: 'index.html',
  generatedBy: 'web/scripts/build-startup-phase-manifest.js',
  scriptCount: scripts.length,
  phaseCounts: scripts.reduce((out, row) => {
    out[row.phase] = (out[row.phase] || 0) + 1;
    return out;
  }, {}),
  deferredChangesApproved: 0,
  auditConclusion: 'No classic-script group was deferred in Round 20: 414+ ordered providers, immediate registrations, split-provider adjacency contracts, and two approved early reads make bulk defer unsafe without a dedicated loader migration.',
  scripts
};
const text = JSON.stringify(manifest, null, 2) + '\n';

if (CHECK) {
  const actual = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
  if (actual !== text) {
    console.error('[startup-phase-manifest] stale: ' + lib.rel(OUTPUT));
    process.exit(1);
  }
  console.log('[startup-phase-manifest] PASS scripts=' + scripts.length + ' phases=' + JSON.stringify(manifest.phaseCounts));
} else {
  fs.writeFileSync(OUTPUT, text, 'utf8');
  console.log('[startup-phase-manifest] wrote ' + lib.rel(OUTPUT) + ' scripts=' + scripts.length);
}
