#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');

function makeDocument() {
  const body = {
    children: [],
    appendChild(node) {
      node.parentNode = body;
      body.children.push(node);
      return node;
    }
  };
  const energyBar = { id: '_energyBar', innerHTML: 'energy-before' };
  function createElement(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      innerHTML: '',
      parentNode: null,
      remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) this.parentNode.children.splice(index, 1);
        this.parentNode = null;
      },
      querySelector() { return null; }
    };
  }
  return {
    body,
    energyBar,
    createElement,
    getElementById(id) {
      if (id === '_energyBar') return energyBar;
      return body.children.find((node) => node.id === id) || null;
    }
  };
}

function makeWorld() {
  const errors = [];
  const notices = [];
  const document = makeDocument();
  const context = {
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Promise,
    isFinite,
    parseInt,
    parseFloat,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document,
    confirm() { return true; },
    toast(message) { notices.push(message); },
    escHtml(value) { return String(value); },
    _$: (id) => document.getElementById(id),
    TM: {
      errors: {
        capture(error, label) { errors.push({ error, label }); }
      }
    },
    P: {
      playerInfo: { factionName: '朝廷' },
      keju: {},
      ai: {}
    },
    GM: {
      turn: 20,
      _energy: 100,
      _energyMax: 100,
      guoku: { money: 1000000 },
      activeWars: [],
      keju: { _pendingProposal: { proposalId: 'before', marker: true } },
      chars: [
        { id: 'c1', name: '甲', officialTitle: '礼部尚书', faction: '朝廷', loyalty: 70, intelligence: 80 },
        { id: 'c2', name: '乙', officialTitle: '吏部侍郎', faction: '朝廷', loyalty: 55, intelligence: 65 },
        { id: 'c3', name: '丙', officialTitle: '都察院御史', faction: '朝廷', loyalty: 45, intelligence: 75 }
      ]
    },
    _spendEnergy(cost) {
      if (context.GM._energy < cost) return false;
      context.GM._energy -= cost;
      document.energyBar.innerHTML = 'energy-after-' + context.GM._energy;
      return true;
    },
    _captureEnergySnapshot() {
      return {
        hadEnergy: Object.prototype.hasOwnProperty.call(context.GM, '_energy'),
        energy: context.GM._energy,
        energyBarHtml: document.energyBar.innerHTML
      };
    },
    _restoreEnergySnapshot(snapshot) {
      if (snapshot.hadEnergy) context.GM._energy = snapshot.energy;
      else delete context.GM._energy;
      document.energyBar.innerHTML = snapshot.energyBarHtml;
      return true;
    },
    _kjResolveTopic(type, data) {
      return {
        topicType: type,
        title: '议·测试科议',
        threshold: 0.5,
        callbackName: 'testCallback',
        sliceOwner: 'round19',
        topicData: data
      };
    }
  };
  context.window = context;
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(WEB, 'tm-keju-runtime-keyi.js'), 'utf8'), context, {
    filename: 'tm-keju-runtime-keyi.js'
  });
  return { context, errors, notices, document };
}

function assertRolledBack(world, priorPending) {
  assert.strictEqual(world.context.GM._energy, 100, 'energy is restored exactly');
  assert.strictEqual(world.context.GM.keju._pendingProposal, priorPending, 'pending proposal is restored by identity');
  assert.strictEqual(world.context.KEYI_STATE, null, 'KEYI_STATE is restored');
  assert.strictEqual(world.document.getElementById('keyi-modal'), null, 'no modal remains');
  assert.strictEqual(world.document.energyBar.innerHTML, 'energy-before', 'energy UI is restored');
  assert(world.errors.some((entry) => entry.label === '打开科议失败'), 'failure is captured structurally');
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  {
    const world = makeWorld();
    const prior = world.context.GM.keju._pendingProposal;
    world.context._keyiInferStance = function() { throw new Error('injected stance failure'); };
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal', topicData: { id: 's1' } }), false);
    assertRolledBack(world, prior);
  }

  {
    const world = makeWorld();
    const prior = world.context.GM.keju._pendingProposal;
    world.context._renderKeyiModal = function() {
      const modal = world.document.createElement('div');
      modal.id = 'keyi-modal';
      world.document.body.appendChild(modal);
      throw new Error('injected render failure');
    };
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal' }), false);
    assertRolledBack(world, prior);
  }

  {
    const world = makeWorld();
    const prior = world.context.GM.keju._pendingProposal;
    world.document.body.appendChild = function() { throw new Error('injected append failure'); };
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal' }), false);
    assertRolledBack(world, prior);
  }

  {
    const world = makeWorld();
    world.context._keyiRunBothRounds = function() {
      world.context.KEYI_STATE._busy = true;
      world.context.KEYI_STATE.speeches.push({ _streaming: true });
      return Promise.reject(new Error('injected async round failure'));
    };
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal' }), true);
    await flush();
    assert.strictEqual(world.context.GM._energy, 85, 'an opened session charges energy exactly once');
    assert.strictEqual(world.context.KEYI_STATE._busy, false, 'async rejection clears busy state');
    assert.strictEqual(world.context.KEYI_STATE._runFailed, true, 'async rejection is visible on the current session');
    assert.strictEqual(world.context.KEYI_STATE.speeches.length, 0, 'streaming placeholders are cleaned');
    assert(world.errors.some((entry) => entry.label === '科议异步议论失败'), 'async failure is captured');
  }

  {
    const world = makeWorld();
    let starts = 0;
    world.context._keyiRunBothRounds = function() {
      starts++;
      return new Promise(function() {});
    };
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal' }), true);
    const token = world.context.KEYI_STATE._sessionToken;
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal' }), false,
      'rapid duplicate open is rejected');
    assert.strictEqual(world.context.GM._energy, 85, 'rapid duplicate does not charge again');
    assert.strictEqual(starts, 1, 'rapid duplicate starts only one round runner');
    assert.strictEqual(world.document.body.children.filter((node) => node.id === 'keyi-modal').length, 1,
      'rapid duplicate creates only one modal');
    assert.strictEqual(world.context.KEYI_STATE._sessionToken, token);
  }

  {
    const world = makeWorld();
    let rejectOld;
    world.context._keyiRunBothRounds = function() {
      return new Promise((resolve, reject) => { rejectOld = reject; });
    };
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal' }), true);
    const oldToken = world.context.KEYI_STATE._sessionToken;
    world.context.closeKeyi();
    world.context._keyiRunBothRounds = function() { return Promise.resolve(); };
    assert.strictEqual(world.context.openKeyiSession({ topicType: 'scandal' }), true);
    const newToken = world.context.KEYI_STATE._sessionToken;
    assert.notStrictEqual(newToken, oldToken);
    rejectOld(new Error('late old-session failure'));
    await flush();
    assert.strictEqual(world.context.KEYI_STATE._sessionToken, newToken,
      'late error from an old session cannot close or mutate the new session');
    assert.strictEqual(world.document.body.children.filter((node) => node.id === 'keyi-modal').length, 1);
  }

  console.log('[smoke-keyi-open-atomicity] PASS');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
