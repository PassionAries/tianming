#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'tm-map-system.js'), 'utf8');
let assertions = 0;

function check(value, label) {
  if (!value) throw new Error('[smoke-legacy-city-info-security] ' + label);
  assertions += 1;
}

class FakeNode {
  constructor(tagName, text) {
    this.tagName = tagName || '';
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.textContent = text || '';
    this.id = '';
    this.className = '';
    this.listeners = {};
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append() {
    Array.prototype.slice.call(arguments).forEach((child) => this.appendChild(child));
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
  }
  set innerHTML(_) { throw new Error('legacy city detail must not assign innerHTML'); }
}

const body = new FakeNode('BODY');
function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}
function allText(node) {
  return String(node.textContent || '') + node.children.map(allText).join('');
}
function allTags(node) {
  return [node.tagName].concat(node.children.flatMap(allTags));
}

const attack = '<img src=x onerror="document.documentElement.dataset.tmCityXss=\'triggered\'">';
const context = {
  console,
  Math, Date, JSON, Object, Array, Number, String, Boolean,
  parseInt, parseFloat, isFinite,
  GM: {
    mapData: {
      state: { scale: 1, offsetX: 0, offsetY: 0, hoveredCityId: null, selectedCityId: null },
      cities: {
        'city-uuid': { id: 'city-uuid', name: attack, owner: attack, population: 0, income: 0, neighbors: ['near-uuid'] },
        'near-uuid': { id: 'near-uuid', name: attack, owner: attack }
      },
      polygons: {}
    }
  },
  P: {},
  findFacByName() { return null; },
  document: {
    documentElement: { dataset: {} },
    body,
    createElement(tag) { return new FakeNode(String(tag).toUpperCase()); },
    createTextNode(text) { return new FakeNode('#text', String(text)); },
    getElementById(id) { return findById(body, id); }
  }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'tm-map-system.js' });

context.showCityInfo('city-uuid');
const overlay = context.document.getElementById('city-info-overlay');
check(overlay && allText(overlay).includes(attack), 'malicious city and neighbour fields are rendered as literal text');
check(!context.document.documentElement.dataset.tmCityXss, 'legacy city detail does not execute inline event payloads');
check(!allTags(overlay).includes('IMG'), 'attacker text never creates an IMG element');
check(allText(overlay).includes('人口：0') && allText(overlay).includes('收入：0 金/月'), 'legal zero population and income remain visible');

context.GM.mapData.polygons = {
  0: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }
};
check(context.getCityAtPosition(1, 1) === '0', 'city id 0 remains selectable as its original key');
context.GM.mapData.polygons = {
  '550e8400-e29b-41d4-a716-446655440000': { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }
};
check(context.getCityAtPosition(1, 1) === '550e8400-e29b-41d4-a716-446655440000', 'UUID city ids are not coerced to NaN');

console.log('[smoke-legacy-city-info-security] PASS assertions=' + assertions);
