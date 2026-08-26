#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ ' + message);
  }
}

function FakeElement(tagName) {
  this.tagName = String(tagName || 'div').toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.style = {};
  this.listeners = Object.create(null);
  this.innerHTML = '';
  this.id = '';
  this.title = '';
}
FakeElement.prototype.appendChild = function appendChild(child) {
  child.parentNode = this;
  this.children.push(child);
  return child;
};
FakeElement.prototype.removeChild = function removeChild(child) {
  const index = this.children.indexOf(child);
  if (index >= 0) this.children.splice(index, 1);
  child.parentNode = null;
  return child;
};
FakeElement.prototype.addEventListener = function addEventListener(type, handler) {
  if (!this.listeners[type]) this.listeners[type] = [];
  this.listeners[type].push(handler);
};
FakeElement.prototype.removeEventListener = function removeEventListener(type, handler) {
  const list = this.listeners[type] || [];
  const index = list.indexOf(handler);
  if (index >= 0) list.splice(index, 1);
};

const body = new FakeElement('body');
const stage = new FakeElement('div');
const documentListeners = Object.create(null);
const intervals = new Map();
let intervalSequence = 0;
const storage = Object.create(null);
const context = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  Number,
  String,
  Error,
  TypeError,
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {},
  setInterval(handler, delay) {
    const id = ++intervalSequence;
    intervals.set(id, { handler, delay });
    return id;
  },
  clearInterval(id) { intervals.delete(id); },
  localStorage: {
    getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem(key, value) { storage[key] = String(value); }
  },
  document: {
    body,
    createElement(tag) { return new FakeElement(tag); },
    querySelector(selector) { return selector === '.me-stage' ? stage : null; },
    getElementById() { return null; },
    addEventListener(type, handler) {
      if (!documentListeners[type]) documentListeners[type] = [];
      documentListeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      const list = documentListeners[type] || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    }
  },
  TM: {}
};
context.window = context;
vm.createContext(context);

function load(file) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

console.log('smoke-map-editor-bookmarks-lifecycle');
load('map-editor-dynasty.js');
load('map-editor-undo.js');
load('map-editor-core.js');
const ME = context.TM.MapEditor;
ME.EDITOR.camera = { x: 0, y: 0, zoom: 1 };
ME.EDITOR.map = { dynasty: 'smoke', divisions: [] };
ME.EDITOR.canvas = null;

let probeCalls = 0;
const offProbe = ME.on('probe', function () { probeCalls++; });
ME.fire('probe');
const firstOff = offProbe();
const secondOff = offProbe();
ME.fire('probe');
ok(probeCalls === 1 && firstOff === true && secondOff === false, 'event hub returns an idempotent disposer');

const originalOn = ME.on;
let mapLoadedSubscriptions = 0;
let mapLoadedUnsubscriptions = 0;
ME.on = function trackedOn(eventName, handler) {
  const disposer = originalOn(eventName, handler);
  if (eventName === 'map-loaded') mapLoadedSubscriptions++;
  let active = true;
  return function trackedDisposer() {
    const result = disposer();
    if (active && result && eventName === 'map-loaded') mapLoadedUnsubscriptions++;
    active = false;
    return result;
  };
};

load('map-editor-bookmarks.js');
const bookmarks = ME.bookmarks;
ok(bookmarks.init() === true && bookmarks.isInitialized(), 'first init installs the bookmark feature');
ok(intervals.size === 1 && (documentListeners.keydown || []).length === 1 && mapLoadedSubscriptions === 1, 'init installs exactly one timer, key listener, and map subscription');
ok(bookmarks.init() === false && intervals.size === 1 && (documentListeners.keydown || []).length === 1 && mapLoadedSubscriptions === 1, 'repeated init is idempotent');
ok(stage.children.length === 1 && stage.children[0].id === 'me-bookmarks', 'bookmark column is installed once');

ME.fire('map-loaded');
ok(bookmarks.dispose() === true && !bookmarks.isInitialized(), 'dispose releases an initialized feature');
ok(intervals.size === 0 && (documentListeners.keydown || []).length === 0 && mapLoadedUnsubscriptions === 1, 'dispose clears timer, key listener, and map subscription');
ok(stage.children.length === 0, 'dispose removes the bookmark column');
ok(bookmarks.dispose() === false && mapLoadedUnsubscriptions === 1, 'repeated dispose is idempotent');

ok(bookmarks.init() === true && intervals.size === 1 && (documentListeners.keydown || []).length === 1, 'feature can be initialized again after disposal');
ok(bookmarks.dispose() === true && intervals.size === 0 && mapLoadedSubscriptions === 2 && mapLoadedUnsubscriptions === 2, 'second lifecycle leaves no accumulated resources');

console.log('\nsmoke-map-editor-bookmarks-lifecycle ' + (failed ? 'FAIL' : 'PASS') + ' ' + passed + '/' + (passed + failed));
process.exit(failed ? 1 : 0);
