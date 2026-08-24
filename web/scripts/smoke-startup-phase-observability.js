#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'build-startup-phase-manifest.js'), '--check'], {
  cwd: path.resolve(ROOT, '..'),
  stdio: 'pipe'
});
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'startup-script-phases.json'), 'utf8'));
const scriptNames = Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)(?:[?#][^"']*)?["'][^>]*>/gi))
  .map((match) => match[1].replace(/^\.\//, ''));

assert.strictEqual(manifest.scriptCount, scriptNames.length, 'startup manifest should cover every external JavaScript loaded by index.html');
assert.deepStrictEqual(manifest.scripts.map((row) => row.script), scriptNames, 'startup manifest order should match index.html exactly');
assert.strictEqual(manifest.deferredChangesApproved, 0, 'Round 20 should not pretend an unproven classic-script group is lazy safe');
assert(manifest.scripts.every((row) => row.lazySafe === false), 'every retained script should record the conservative dependency-audit result');
assert(manifest.scripts.every((row) => Array.isArray(row.provides) && Array.isArray(row.consumes)), 'manifest should expose machine-readable provider and immediate-consumer inventories');

const sandbox = { console, Date, Math, JSON, performance, Promise, window: {} };
sandbox.window.window = sandbox.window;
sandbox.window.globalThis = sandbox.window;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'tm-perf.js'), 'utf8'), sandbox.window, { filename: 'tm-perf.js' });
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'tm-startup-phases.js'), 'utf8'), sandbox.window, { filename: 'tm-startup-phases.js' });
['core', 'world', 'optional'].forEach((phase) => sandbox.window.TMStartupPhases.transition(phase));
sandbox.window.TMStartupPhases.finish();
['menu', 'core', 'world', 'optional'].forEach((phase) => {
  assert(sandbox.window.TM.perf.reportByName(`startup.phase.${phase}`).count === 1, `startup ${phase} phase should close one measured span`);
});

console.log('smoke-startup-phase-observability ok scripts=' + manifest.scriptCount);
