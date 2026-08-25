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

function createStorage() {
  const data = Object.create(null);
  let failWrites = false;
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) {
      if (failWrites) throw new Error('injected-storage-write-failure');
      data[key] = String(value);
    },
    removeItem(key) {
      if (failWrites) throw new Error('injected-storage-write-failure');
      delete data[key];
    },
    setFailWrites(value) { failWrites = !!value; }
  };
}

console.log('smoke-authoring-user-write-failures');

const storage = createStorage();
global.window = global;
global.localStorage = storage;
delete global.TM;
require('../editor-authoring-agent.js');
const AA = global.TM.AuthoringAgent;

ok(AA.memories.save({ name: '持久记忆', type: 'user', description: '测试', body: '不得在失败时消失' }).ok, 'seed memory');
ok(AA.skills.save({ name: '持久技能', body: '不得在失败时消失' }).ok, 'seed skill');
ok(AA.packs.importJSON({ name: '持久能力包', version: '1.0', skills: [{ name: '包内技能', body: '测试' }] }).ok, 'seed user pack');

storage.setFailWrites(true);
const memoryDelete = AA.memories.remove('持久记忆');
ok(memoryDelete.ok === false && AA.memories.list().some((entry) => entry.name === '持久记忆'), 'memory deletion reports persistence failure and preserves stored row');
const skillDelete = AA.skills.remove('持久技能');
ok(skillDelete.ok === false && AA.skills.list().some((entry) => entry.name === '持久技能'), 'skill deletion reports persistence failure and preserves stored row');
const packToggle = AA.packs.setEnabled('立绘工坊', false);
ok(packToggle.ok === false && AA.packs.list().find((pack) => pack.name === '立绘工坊').enabled === true, 'pack toggle reports persistence failure without changing effective state');
const packImport = AA.packs.importJSON({ name: '失败导入包', skills: [{ name: '不会落盘', body: '测试' }] });
ok(packImport.ok === false && !AA.packs.list().some((pack) => pack.name === '失败导入包'), 'pack import never reports success when storage rejects it');
const packRemove = AA.packs.remove('持久能力包');
ok(packRemove.ok === false && AA.packs.list().some((pack) => pack.name === '持久能力包'), 'pack removal reports persistence failure and preserves stored pack');

const captured = [];
const documentListeners = Object.create(null);
const uiContext = {
  console,
  Promise,
  Date,
  Error,
  JSON,
  Math,
  setTimeout,
  clearTimeout,
  localStorage: createStorage(),
  document: {
    readyState: 'loading',
    currentScript: null,
    addEventListener(type, handler) { documentListeners[type] = handler; }
  },
  TM: {
    AuthoringAgent: {},
    errors: {
      capture(error, context, metadata) { captured.push({ error, context, metadata }); }
    }
  }
};
uiContext.window = uiContext;
vm.createContext(uiContext);
const uiSource = fs.readFileSync(path.resolve(__dirname, '..', 'editor-authoring-agent-ui.js'), 'utf8');
vm.runInContext(uiSource, uiContext, { filename: 'editor-authoring-agent-ui.js' });
const UI = uiContext.TM_AuthoringAgentUI;
UI._ui.els = { status: { textContent: '' } };

let successMutations = 0;
const rejected = UI._commitUserWrite({
  operation: 'test.rejected',
  target: '写目标',
  failureLabel: '测试写入',
  run() { return { ok: false, error: '底层拒绝' }; },
  onSuccess() { successMutations++; },
  successMessage: '不应显示'
});
ok(rejected === false && successMutations === 0, 'structured write failure stops success-side UI mutation');
ok(/测试写入失败：底层拒绝/.test(UI._ui.els.status.textContent), 'structured write failure is visible to the user');

const thrown = UI._commitUserWrite({
  operation: 'test.throw',
  target: '抛错目标',
  failureLabel: '抛错写入',
  run() { throw new Error('注入异常'); },
  onSuccess() { successMutations++; }
});
ok(thrown === false && successMutations === 0, 'thrown write failure also stops success-side UI mutation');
ok(captured.length === 2 && captured.every((entry) => entry.context === 'authoring-agent.user-write'), 'write failures enter the structured diagnostic channel');

const committed = UI._commitUserWrite({
  operation: 'test.success',
  target: '成功目标',
  run() { return { ok: true }; },
  onSuccess() { successMutations++; },
  successMessage: '写入成功'
});
ok(committed === true && successMutations === 1 && UI._ui.els.status.textContent === '写入成功', 'success UI updates only after a confirmed commit');

console.log('\nsmoke-authoring-user-write-failures ' + (failed ? 'FAIL' : 'PASS') + ' ' + passed + '/' + (passed + failed));
process.exit(failed ? 1 : 0);
