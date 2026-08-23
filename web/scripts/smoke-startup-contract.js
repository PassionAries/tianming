#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'tm-startup-contract.js'), 'utf8');
let assertions = 0;

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error('[smoke-startup-contract] ' + message);
}

function criticalWorld() {
  return {
    TM: { platform: {} },
    startGame() {}, enterGame() {}, fullLoadGame() {}, endTurn() {}, renderGameState() {}, callAISmart() {},
    TMNumberParser: { parseNumber() {} },
    TMWorldEra: { resolve() {} },
    TM_SaveDB: {}, HujiEngine: {}, EnvCapacityEngine: {}, TimeUtils: {}
  };
}

function load(world) {
  const appended = [];
  const document = {
    body: { appendChild(node) { appended.push(node); } },
    documentElement: { dataset: {} },
    getElementById() { return null; },
    createElement() {
      return {
        id: '', textContent: '', style: {}, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() {}
      };
    }
  };
  const context = Object.assign(world, {
    document,
    console: { error() {} },
    globalThis: null
  });
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'tm-startup-contract.js' });
  return { context, document, appended };
}

let fixture = load(criticalWorld());
check(fixture.context.__tmStartupContract.ok === true, 'complete runtime satisfies the startup contract');
check(fixture.appended.length === 0, 'complete runtime does not render a failure surface');
check(fixture.context.TMStartupContract.required.includes('endTurn'), 'contract publishes its critical global inventory');

const broken = criticalWorld();
delete broken.endTurn;
delete broken.HujiEngine;
fixture = load(broken);
check(fixture.context.__tmStartupContract.ok === false, 'missing critical providers fail the contract');
check(fixture.context.__tmStartupContract.missing.join(',') === 'endTurn,HujiEngine', 'contract reports exact missing provider names');
check(fixture.appended.length === 1, 'broken runtime renders one explicit full-screen error surface');
check(fixture.appended[0].textContent.includes('endTurn') && fixture.appended[0].textContent.includes('HujiEngine'), 'failure surface identifies missing providers');
check(fixture.document.documentElement.dataset.tmStartupFailed === 'true', 'document exposes a machine-readable startup failure state');

console.log('[smoke-startup-contract] PASS assertions=' + assertions);
