#!/usr/bin/env node
// smoke-j4-scandal.js · 科举 Phase J·Slice J4 · 生产考试状态与稳定被告身份
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const scandal = require(path.join(ROOT, 'tm-keju-scandal.js'));
const topicRouter = require(path.join(ROOT, 'tm-keju-topic-router.js'));

let pass = 0;
let fail = 0;
function check(name, condition) {
  if (condition) {
    pass += 1;
    console.log('  PASS - ' + name);
  } else {
    fail += 1;
    console.error('  FAIL - ' + name);
  }
}

function makeCharacter(id, name) {
  return {
    id,
    name,
    alive: true,
    officialTitle: '礼部侍郎',
    careerHistory: [],
    party: '清流',
    ambition: 80,
    loyalty: 80,
    integrity: 60,
    wuchang: { li: 60 }
  };
}

function resetWorld(options) {
  const opts = options || {};
  const examinerA = makeCharacter('char-examiner-a', '主考甲');
  const examinerB = makeCharacter('char-examiner-b', '主考乙');
  const exam = {
    id: 'exam-1600-zhengke',
    stage: Object.prototype.hasOwnProperty.call(opts, 'stage') ? opts.stage : 'huishi',
    chiefExaminerId: opts.omitExaminerId ? undefined : examinerA.id,
    chiefExaminer: examinerA.name,
    examinerView: { factionBias: Object.prototype.hasOwnProperty.call(opts, 'bias') ? opts.bias : 0.8 }
  };
  global.P = {
    conf: { useNewKejuScandal: opts.flag !== false },
    keju: { currentExam: exam }
  };
  global.GM = {
    year: 1600,
    turn: 5,
    corruption: Object.prototype.hasOwnProperty.call(opts, 'corruption') ? opts.corruption : 70,
    minxin: 50,
    _chronicle: [],
    _factionTension: { 清流: Object.prototype.hasOwnProperty.call(opts, 'tension') ? opts.tension : 20 },
    keju: {},
    chars: [examinerA, examinerB]
  };
  global._kjCalcTotalPartyTension = function() {
    return Object.keys(GM._factionTension).reduce(function(sum, key) {
      return sum + GM._factionTension[key];
    }, 0);
  };
  global._kejuExaminerView = function(character) {
    return { factionBias: character && character.id === examinerA.id ? 0.8 : 0.1 };
  };
  return { examinerA, examinerB, exam };
}

function spawnOne() {
  check('正式 P.keju.currentExam 形状能够自然触发弊案', scandal._kjCheckScandalTriggers() === 1);
  const entries = scandal._kjConsumeScandalForAgenda();
  check('触发后生成一条待议弊案', entries.length === 1);
  return entries[0] || {
    examinerId: '',
    examinerName: '',
    examId: '',
    spawnedTurn: null,
    spawnedYear: null,
    severityTier: 'mid'
  };
}

function runSelectExaminerProductionSmoke() {
  const runtimeSource = fs.readFileSync(path.join(ROOT, 'tm-keju-runtime.js'), 'utf8');
  const examiner = makeCharacter('char-runtime-examiner', '运行主考');
  const nodes = {
    'examiner-info': { style: {}, innerHTML: '' },
    'btn-proceed-huishi': { style: {} }
  };
  const context = {
    console,
    window: null,
    P: { keju: { currentExam: { id: 'exam-runtime', stage: 'examiner_select' } } },
    GM: { turn: 7, chars: [examiner] },
    document: { getElementById(id) { return nodes[id] || null; } },
    findCharByName(name) { return name === examiner.name ? examiner : null; },
    _kejuIsEligibleChiefExaminer() { return true; },
    _kejuExaminerView() { return { factionBias: 0.75, strictness: 60 }; },
    escHtml(value) { return String(value); },
    toast() {},
    addEB() {},
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    setTimeout,
    clearTimeout
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(runtimeSource, context, { filename: 'tm-keju-runtime.js' });
  const legacyExam = {
    id: 'exam-legacy',
    stage: 'huishi',
    startTurn: 1,
    chiefExaminer: examiner.name
  };
  context._kejuUpgradeExamSchema(legacyExam);
  context.selectExaminer(examiner.name);
  return { exam: context.P.keju.currentExam, examiner, legacyExam };
}

console.log('[smoke-j4-scandal] production exam state and stable defendant identity');

resetWorld({ flag: false });
check('flag 关闭时不触发', scandal._kjCheckScandalTriggers() === 0);

resetWorld({ stage: 'idle' });
check('正式考试 stage=idle 时不触发', scandal._kjCheckScandalTriggers() === 0);

resetWorld({ stage: 'finished' });
check('正式考试 stage=finished 时不触发', scandal._kjCheckScandalTriggers() === 0);

resetWorld();
scandal._kjInitScandalState();
const initialState = GM.keju._scandal;
scandal._kjInitScandalState();
check('弊案状态初始化幂等', GM.keju._scandal === initialState
  && Array.isArray(initialState.spawned) && Array.isArray(initialState.history));

let world = resetWorld({ bias: 0.8, tension: 0, corruption: 70 });
check('人物没有 factionBias 直写字段', !Object.prototype.hasOwnProperty.call(world.examinerA, 'factionBias'));
const assessedFromView = scandal._scAssess();
check('examinerView.factionBias 足够高时仍参与触发评估', !!(assessedFromView && assessedFromView.bias === 0.8));

world = resetWorld({ tension: 0 });
delete P.keju.currentExam.examinerView;
GM.keju.tension = 99;
const assessedFromDerivedView = scandal._scAssess();
check('缺少持久 examinerView 时调用正式派生器', !!(assessedFromDerivedView && assessedFromDerivedView.bias === 0.8));
check('党争张力优先采用真实 _factionTension 而非旧 GM.keju.tension', assessedFromDerivedView.tension === 0);

world = resetWorld();
const spawned = spawnOne();
check('弊案保存稳定 examinerId', spawned.examinerId === world.examinerA.id);
check('弊案保存兼容 examinerName', spawned.examinerName === world.examinerA.name);
check('弊案保存 examId、spawnedTurn、spawnedYear', spawned.examId === world.exam.id && spawned.spawnedTurn === 5 && spawned.spawnedYear === 1600);

P.keju.currentExam = {
  id: 'exam-next', stage: 'huishi',
  chiefExaminerId: world.examinerB.id,
  chiefExaminer: world.examinerB.name,
  examinerView: { factionBias: 0.1 }
};
let result = scandal._kjScandalKeyiCallback('investigate', { passed: true, topicData: spawned });
check('换科后处置旧案返回明确成功', result && result.ok === true);
check('换科后只处罚条目保存的主考甲',
  (world.examinerA._exiled === true || world.examinerA._dismissed === true || world.examinerA._demerit > 0)
  && !world.examinerB._exiled && !world.examinerB._dismissed && !world.examinerB._demerit);
check('生成后的 cooldown 阻止同年重复弊案', scandal._kjCheckScandalTriggers() === 0);

world = resetWorld();
check('队列耐久性 fixture 生成一条待议弊案', scandal._kjCheckScandalTriggers() === 1);
const queuedScandal = GM.keju._scandal.spawned[0];
let capturedOpenError = null;
global.TM = { errors: { capture(error) { capturedOpenError = error; } } };
global.openKeyiSession = function() { throw new Error('injected agenda open failure'); };
check('议政界面抛错时弊案仍原样留队且返回失败', scandal._kjMaybeRaiseScandalKeyi() === false
  && GM.keju._scandal.spawned.length === 1
  && GM.keju._scandal.spawned[0] === queuedScandal
  && capturedOpenError && capturedOpenError.message === 'injected agenda open failure');
global.openKeyiSession = function() { return false; };
check('议政界面明确取消时不消费弊案', scandal._kjMaybeRaiseScandalKeyi() === false
  && GM.keju._scandal.spawned.length === 1);
let openedTopic = null;
global.openKeyiSession = function(options) { openedTopic = options; return true; };
check('首次失败后第二次成功只消费原案一次', scandal._kjMaybeRaiseScandalKeyi() === true
  && openedTopic && openedTopic.topicData === queuedScandal
  && GM.keju._scandal.spawned.length === 0
  && scandal._kjMaybeRaiseScandalKeyi() === false);
delete global.openKeyiSession;
delete global.TM;

world = resetWorld();
const postExamEntry = spawnOne();
P.keju.currentExam.stage = 'finished';
P.keju.currentExam.chiefExaminerId = '';
P.keju.currentExam.chiefExaminer = '';
result = scandal._kjScandalKeyiCallback('dismiss', { passed: true, topicData: postExamEntry });
check('科举结束后仍按保存 ID 找到原主考', result && result.ok === true && world.examinerA._dismissed === true);

world = resetWorld();
const missingEntry = spawnOne();
GM.chars = [world.examinerB];
P.keju.currentExam.chiefExaminerId = world.examinerB.id;
P.keju.currentExam.chiefExaminer = world.examinerB.name;
const historyBeforeMissing = GM.keju._scandal.history.length;
const chronicleBeforeMissing = GM._chronicle.length;
result = scandal._kjScandalKeyiCallback('investigate', { passed: true, topicData: missingEntry });
check('原被告已删除时明确失败', result && result.ok === false && result.reason === 'examiner-not-found');
check('原被告缺失时不处罚当前主考、不写虚假历史', !world.examinerB._exiled && !world.examinerB._dismissed
  && GM.keju._scandal.history.length === historyBeforeMissing && GM._chronicle.length === chronicleBeforeMissing);

world = resetWorld();
world.examinerA.alive = false;
result = scandal._kjScandalKeyiCallback('dismiss', {
  passed: true,
  topicData: { examinerId: world.examinerA.id, examinerName: world.examinerA.name, severityTier: 'mid' }
});
check('原被告已死亡时明确失败且不处罚其他人', result && result.ok === false
  && result.reason === 'examiner-unavailable' && !world.examinerB._dismissed);

world = resetWorld();
P.keju.currentExam.chiefExaminerId = world.examinerB.id;
P.keju.currentExam.chiefExaminer = world.examinerB.name;
const legacyTopic = { examinerName: world.examinerA.name, severityTier: 'mid', type: 'favoritism' };
result = scandal._kjScandalKeyiCallback('dismiss', { passed: true, topicData: legacyTopic });
check('旧记录只含 examinerName 时兼容解析原人物', result && result.ok === true && world.examinerA._dismissed === true && !world.examinerB._dismissed);
check('旧记录解析后回填稳定 examinerId', legacyTopic.examinerId === world.examinerA.id);

world = resetWorld();
result = scandal._kjScandalKeyiCallback('protect', {
  passed: true,
  topicData: { examinerId: world.examinerA.id, examinerName: world.examinerA.name, severityTier: 'high', type: 'leak' }
});
check('庇护路径保留被告并记录稳定身份', result && result.ok === true
  && !world.examinerA._dismissed && !world.examinerA._exiled
  && GM.keju._scandal.coveredUp[0].examinerId === world.examinerA.id);

world = resetWorld();
result = scandal._kjScandalKeyiCallback('investigate', {
  passed: false,
  topicData: { examinerId: world.examinerA.id, examinerName: world.examinerA.name, severityTier: 'high' }
});
check('议政未通过路径不处罚但记录 unresolved', result && result.ok === true
  && !world.examinerA._dismissed && !world.examinerA._exiled
  && GM.keju._scandal.history.some(function(item) { return item.resolution === 'unresolved'; }));

world = resetWorld();
check('_scPunish 拒绝字符串人物', scandal._scPunish('主考甲', 'dismiss', '测试').reason === 'invalid-examiner-object');
check('_scPunish 拒绝伪造但同 ID 的对象', scandal._scPunish({ id: world.examinerA.id, name: world.examinerA.name }, 'dismiss', '测试').reason === 'examiner-not-in-current-world');
check('_scPunish 接受当前 GM.chars 中稳定人物', scandal._scPunish(world.examinerA, 'demote', '测试').ok === true);

const newTitle = topicRouter._kjResolveTopic('scandal', { examinerName: '张三' }).title;
const oldTitle = topicRouter._kjResolveTopic('scandal', { accused: '李四' }).title;
check('新 TopicData examinerName 显示完整标题', newTitle === '议·主考弊案·张三');
check('旧 TopicData accused 仍兼容显示', oldTitle === '议·主考弊案·李四');

const runtimeSelection = runSelectExaminerProductionSmoke();
check('真实 selectExaminer 同时保存 chiefExaminerId 和显示姓名', runtimeSelection.exam.chiefExaminerId === runtimeSelection.examiner.id
  && runtimeSelection.exam.chiefExaminer === runtimeSelection.examiner.name);
check('旧考试只含主考姓名时迁移稳定 ID', runtimeSelection.legacyExam.chiefExaminerId === runtimeSelection.examiner.id);

check('弊案类型保持跨朝代通用', !/东厂|司礼监|锦衣卫|内阁|票拟|八股|军机处/.test(JSON.stringify(scandal.SCANDAL_TYPES)));

console.log('[smoke-j4-scandal] pass=' + pass + ' fail=' + fail);
if (fail > 0) process.exit(1);
