#!/usr/bin/env node
'use strict';

// Runtime settlement must not read mutable targets from P/scenario templates.
// The two legacy feudal steps are production-reachable through SettlementPipeline,
// so any future dependency on P or findScenarioById here is a hard architecture error.

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const violations = [];
const scans = [
  {
    file: 'tm-feudal-warfare.js',
    targets: new Set(['updateMilitary', 'updateMap']),
    writableMapTargets: new Set(['updateMap'])
  },
  {
    file: 'tm-map-system.js',
    targets: new Set([
      'initMapSystem', 'normalizeGameMapRuntime', 'setMapRegionOwner',
      'updateMapRegionFields', 'applyRuntimeAIMapChanges', 'updateMapColors',
      'buildAdjacencyGraph'
    ]),
    writableMapTargets: new Set([
      'initMapSystem', 'normalizeGameMapRuntime', 'setMapRegionOwner',
      'updateMapRegionFields', 'applyRuntimeAIMapChanges', 'updateMapColors',
      'buildAdjacencyGraph'
    ])
  }
];

function visit(node, owner, scan, found, writableCalls) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && scan.targets.has(node.id.name)) {
    found.add(node.id.name);
    owner = node.id.name;
  }
  if (owner && scan.file === 'tm-feudal-warfare.js' && node.type === 'Identifier' && node.name === 'P') {
    violations.push({ file: scan.file, owner, line: node.loc && node.loc.start.line, reason: 'runtime settlement references P template state' });
  }
  if (owner && node.type === 'CallExpression' && node.callee
      && node.callee.type === 'Identifier' && node.callee.name === 'findScenarioById') {
    violations.push({ file: scan.file, owner, line: node.loc && node.loc.start.line, reason: 'runtime step resolves a shared scenario template' });
  }
  if (owner && scan.writableMapTargets.has(owner) && node.type === 'CallExpression' && node.callee
      && node.callee.type === 'Identifier') {
    if (node.callee.name === 'getLiveMapData' || node.callee.name === 'peekMapSource') {
      violations.push({ file: scan.file, owner, line: node.loc && node.loc.start.line, reason: 'map write path calls a read-only map provider' });
    }
    if (node.callee.name === 'ensureWritableRuntimeMap') writableCalls.add(owner);
  }
  Object.keys(node).forEach((key) => {
    if (key === 'loc' || key === 'start' || key === 'end') return;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((item) => visit(item, owner, scan, found, writableCalls));
    else if (child && typeof child === 'object') visit(child, owner, scan, found, writableCalls);
  });
}

for (const scan of scans) {
  const filePath = path.join(__dirname, '..', scan.file);
  const source = fs.readFileSync(filePath, 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  const found = new Set();
  const writableCalls = new Set();
  visit(ast, '', scan, found, writableCalls);
  for (const name of scan.targets) {
    if (!found.has(name)) violations.push({ file: scan.file, owner: name, line: 0, reason: 'required production function missing' });
  }
  for (const name of scan.writableMapTargets) {
    if (!writableCalls.has(name)) violations.push({ file: scan.file, owner: name, line: 0, reason: 'map write path does not acquire GM-owned writable runtime state' });
  }
}

if (violations.length) {
  console.error('[lint-runtime-template-immutability] FAIL');
  violations.forEach((item) => console.error(`  ${item.file}:${item.owner}:${item.line || '?'} ${item.reason}`));
  process.exit(1);
}
console.log('[lint-runtime-template-immutability] PASS — runtime map writers acquire GM-owned state and templates remain read-only');
