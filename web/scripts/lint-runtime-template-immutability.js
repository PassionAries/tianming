#!/usr/bin/env node
'use strict';

// Runtime settlement must not read mutable targets from P/scenario templates.
// The two legacy feudal steps are production-reachable through SettlementPipeline,
// so any future dependency on P or findScenarioById here is a hard architecture error.

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const FILE = path.join(__dirname, '..', 'tm-feudal-warfare.js');
const source = fs.readFileSync(FILE, 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
const targets = new Set(['updateMilitary', 'updateMap']);
const violations = [];
const found = new Set();

function visit(node, owner) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && targets.has(node.id.name)) {
    found.add(node.id.name);
    owner = node.id.name;
  }
  if (owner && node.type === 'Identifier' && node.name === 'P') {
    violations.push({ owner, line: node.loc && node.loc.start.line, reason: 'runtime step references P template state' });
  }
  if (owner && node.type === 'CallExpression' && node.callee
      && node.callee.type === 'Identifier' && node.callee.name === 'findScenarioById') {
    violations.push({ owner, line: node.loc && node.loc.start.line, reason: 'runtime step resolves a shared scenario template' });
  }
  Object.keys(node).forEach((key) => {
    if (key === 'loc' || key === 'start' || key === 'end') return;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((item) => visit(item, owner));
    else if (child && typeof child === 'object') visit(child, owner);
  });
}

visit(ast, '');
for (const name of targets) {
  if (!found.has(name)) violations.push({ owner: name, line: 0, reason: 'required production settlement function missing' });
}

if (violations.length) {
  console.error('[lint-runtime-template-immutability] FAIL');
  violations.forEach((item) => console.error(`  ${item.owner}:${item.line || '?'} ${item.reason}`));
  process.exit(1);
}
console.log('[lint-runtime-template-immutability] PASS — feudal settlement reads GM-owned runtime state only');
