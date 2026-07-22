// smoke-party-inference.js — 党派/阶层演绎层（批乙·2026-07-22·AI 主导·宪法闸落账）
//
// owner 宪法落地：党派身份与行为交 AI(forgeIdentity 立身份 + tickInference 逐回合行动)·引擎只验不产。
// 本 smoke 不经真 AI(除 forge/tick 整合用 canned callAI)：直接灌 canned 决策进 _applyActions·
// 验全部宪法闸——身份锻造兜底两轨/七动作各≥1例(含闸拒:死者cosigner拒/超夹被钳/未注册跳/
// standing直设拒/党魁变更拒/煽动不经bridge拒)/幂等回合戳/单党≤2全局≤10封顶/flag OFF零行为/
// 党魁记忆落账/阶层 creed 进 actor 文案。
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var failures = [];
function assert(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); }
  else { failures.push(msg); console.log('  FAIL ' + msg); }
}

var sandbox = { console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp, Error: Error };
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
sandbox._ebs = [];
sandbox.addEB = function (cat, msg) { sandbox._ebs.push(cat + '·' + msg); };
sandbox._mems = [];
sandbox.NpcMemorySystem = { remember: function (name, event, emo, imp) { sandbox._mems.push({ name: name, event: event, emo: emo, imp: imp }); } };
sandbox._bridgeCalls = [];
sandbox.TM = { ClassMinxinBridge: { applyClassPressure: function (root, payload) { sandbox._bridgeCalls.push(payload); return { ok: true }; } } };
sandbox.uid = (function () { var n = 0; return function () { return 'uid-' + (++n); }; })();

function freshGM() {
  return {
    turn: 10,
    eraName: '朋党倾轧',
    huangwei: { index: 55 }, huangquan: { index: 60 },
    parties: [
      { name: '东林', leader: '顾宪成', head: '顾宪成', influence: 60, cohesion: 65, status: 'active', ideology: '清流', socialBase: ['士绅'], currentAgenda: '澄清吏治' },
      { name: '齐党', leader: '亓诗教', head: '亓诗教', influence: 45, cohesion: 50, status: 'active', ideology: '乡党', socialBase: ['官僚'], currentAgenda: '固党势' },
      { name: '浙党', leader: '沈一贯', head: '沈一贯', influence: 40, cohesion: 55, status: 'active', ideology: '', currentAgenda: '' },
      { name: '楚党', leader: '官应震', influence: 35, cohesion: 50, status: 'active' },
      { name: '宣党', leader: '汤宾尹', influence: 30, cohesion: 50, status: 'active' },
      { name: '昆党', leader: '顾天峻', influence: 30, cohesion: 50, status: 'active' },
      { name: '亡党', leader: '', influence: 2, cohesion: 5, status: '湮灭' }
    ],
    partyState: {
      '东林': { influence: 60, cohesion: 65, officeCount: 5, standing: 'governing', alliedWith: [], conflictWith: [], historyLog: [] },
      '齐党': { influence: 45, cohesion: 50, officeCount: 2, standing: 'opposition', alliedWith: [], conflictWith: [], historyLog: [] }
    },
    classes: [
      { name: '士绅', satisfaction: 55, influence: 60, demands: '减赋' },
      { name: '佃农', satisfaction: 40, influence: 30, demands: '均田' }
    ],
    chars: [
      { name: '顾宪成', alive: true, party: '东林' },
      { name: '高攀龙', alive: true, party: '东林' },
      { name: '亓诗教', alive: true, party: '齐党' },
      { name: '沈一贯', alive: true, party: '浙党' },
      { name: '死谏官', alive: false }
    ],
    _partyDynamics: [{ party: '东林', type: 'ideological_split', desc: '东林内部路线分歧：清流派3人 vs 稳健派2人' }],
    _edictTracker: [{ turn: 10, category: '政事', content: '着都察院核吏治' }],
    memorials: []
  };
}

vm.createContext(sandbox);
sandbox.GM = freshGM();
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tm-party-inference.js'), 'utf8'), sandbox, { filename: 'tm-party-inference.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tm-party-class-actors.js'), 'utf8'), sandbox, { filename: 'tm-party-class-actors.js' });

var PI = sandbox.TM.PartyInference;
var GM = sandbox.GM;

function party(n) { return GM.parties.find(function (p) { return p.name === n; }); }
function cls(n) { return GM.classes.find(function (c) { return c.name === n; }); }

async function main() {
  assert(PI && typeof PI._applyActions === 'function', '模块加载·暴露 _applyActions');
  assert(typeof PI.forgeIdentity === 'function' && typeof PI.schedule === 'function', '暴露 forgeIdentity/schedule');

  console.log('① 身份锻造·确定性兜底轨（AI 缺席→模板·标 _identityFallback）');
  var ft = PI._forgeTemplates(GM);
  assert(ft && ft.parties >= 6 && ft.classes >= 2, '_forgeTemplates 覆盖全部活跃党/阶层');
  assert(party('东林')._identity && party('东林')._identity._identityFallback === true, '东林得模板身份·标兜底');
  assert(/清流/.test(party('东林')._identity.creed), '党纲领由 ideology 拼(清流)');
  assert(party('浙党')._identity && party('浙党')._identity.creed === '匡扶社稷·各安其分', '无 ideology 党→保守模板纲领');
  assert(cls('士绅')._identity && cls('士绅')._identity.voice && cls('士绅')._identity._identityFallback === true, '阶层得轻装模板身份(creed+voice)');
  assert(!party('亡党')._identity, '湮灭党不在活跃集·不锻身份');

  console.log('② 身份锻造·AI 轨（AI 覆盖者取真身份·未覆盖者模板兜底·同批双轨）');
  GM.parties.forEach(function (p) { delete p._identity; });
  GM.classes.forEach(function (c) { delete c._identity; });
  sandbox.callAI = async function (prompt, max, _n, tier, opts) {
    if (opts && opts.id === 'party-identity') {
      return JSON.stringify({
        parties: [{ name: '东林', creed: '风声雨声读书声', stance: '刚直敢言', agenda: '去邪党', redlines: '不党附阉竖' }],
        classes: [{ name: '士绅', creed: '薄赋轻徭', voice: '温良陈请' }]
      });
    }
    if (opts && opts.id === 'party-inference') {
      sandbox._lastTickPrompt = prompt;
      return JSON.stringify({ parties: [{ name: '东林', narrative: '东林发难', actions: [{ type: 'propaganda', influenceDelta: 2 }] }] });
    }
    return '{}';
  };
  var forgeRes = await PI.forgeIdentity(GM);
  assert(forgeRes && forgeRes.parties >= 1, 'forgeIdentity·AI 轨返回锻造计数');
  assert(party('东林')._identity.creed === '风声雨声读书声' && !party('东林')._identity._identityFallback, '东林取 AI 真纲领(非兜底)');
  assert(cls('士绅')._identity.creed === '薄赋轻徭', '士绅取 AI 真诉求口号');
  assert(party('齐党')._identity && party('齐党')._identity._identityFallback === true, 'AI 未覆盖的齐党→同批模板兜底(双轨)');

  console.log('③ joint_memorial·宪法闸(cosigners 全在世在册)');
  var r3 = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'joint_memorial', cosigners: ['顾宪成', '高攀龙'], title: '劾齐党疏', content: '党同伐异·乞正朝纲' }] }] });
  assert(r3.applied === 1 && GM.memorials.length === 1, '合规联名→落 memorials');
  assert(GM.memorials[0].from === '顾宪成' && GM.memorials[0].status === 'pending', 'memorial from=党魁·status=pending');
  assert(JSON.stringify(GM.memorials[0].cosigners) === JSON.stringify(['顾宪成', '高攀龙']), 'cosigners 落账');
  assert(sandbox._mems.some(function (m) { return m.name === '顾宪成' && m.imp >= 5; }), '重大动作给党魁写记忆(imp≥5)');
  var r3b = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'joint_memorial', cosigners: ['顾宪成', '死谏官'] }] }] });
  assert(r3b.blocked === 1 && GM.memorials.length === 1, '死者 cosigner→整条拒·memorials 不增');
  // 修3①·奏疏总闸：pending≥12→党派联名让位常规奏疏(转 blocked)
  var savedMems = GM.memorials.slice();
  GM.memorials = [];
  for (var _mi = 0; _mi < 12; _mi++) GM.memorials.push({ id: 'pm' + _mi, from: '某臣', status: 'pending', turn: GM.turn });
  var r3c = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'joint_memorial', cosigners: ['顾宪成', '高攀龙'], title: '又一联名' }] }] });
  assert(r3c.blocked === 1 && GM.memorials.length === 12, 'pending 奏疏=12(≥闸)→联名转 blocked·不落疏');
  GM.memorials = savedMems;

  console.log('④ propaganda·超夹 delta 被钳(±6)');
  var infB = party('东林').influence;
  var r4 = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'propaganda', influenceDelta: 999 }] }] });
  assert(r4.applied === 1 && party('东林').influence === Math.min(100, infB + 6), 'influenceDelta 999→钳至 +6');
  assert(GM.partyState['东林'].historyLog.some(function (h) { return h.type === 'propaganda'; }), '清议造势落 historyLog');

  console.log('⑤ obstruct·双方 conflictWith 互记·不直设 standing');
  var standB = GM.partyState['东林'].standing;
  var qiInfB = party('齐党').influence;
  var r5 = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'obstruct', target: '齐党' }] }] });
  assert(r5.applied === 1, 'obstruct 合规→applied');
  assert(GM.partyState['东林'].conflictWith.indexOf('齐党') >= 0 && GM.partyState['齐党'].conflictWith.indexOf('东林') >= 0, 'conflictWith 对称互记');
  assert(GM.partyState['东林'].standing === standB, 'obstruct 不改 standing(只从 officeCount 派生)');
  assert(party('齐党').influence < qiInfB, '目标党 influence 小幅受损');

  console.log('⑥ 未注册动作(set_standing/set_leader)·standing 直设拒·党魁变更拒');
  var r6 = PI._applyActions(GM, { parties: [{ name: '浙党', actions: [{ type: 'set_standing', standing: 'governing' }, { type: 'set_leader', leaderName: '篡位者' }] }] });
  assert(r6.blocked === 2 && r6.applied === 0, 'set_standing/set_leader 皆未注册→静默拒+计数');
  assert(party('浙党').leader === '沈一贯', '党魁变更被拒·leader 不动');
  assert(!(GM.partyState['浙党'] && GM.partyState['浙党'].standing === 'governing'), 'standing 直设被拒');

  console.log('⑦ ally/rupture·对称维护(alliedWith/conflictWith)');
  var r7 = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'ally', target: '浙党' }] }] });
  assert(r7.applied === 1 && GM.partyState['东林'].alliedWith.indexOf('浙党') >= 0 && GM.partyState['浙党'].alliedWith.indexOf('东林') >= 0, '结盟→alliedWith 对称');
  var r7b = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'rupture', target: '浙党' }] }] });
  assert(r7b.applied === 1 && GM.partyState['东林'].alliedWith.indexOf('浙党') < 0, '交恶→移除旧盟');
  assert(GM.partyState['东林'].conflictWith.indexOf('浙党') >= 0 && GM.partyState['浙党'].conflictWith.indexOf('东林') >= 0, '交恶→conflictWith 对称');

  console.log('⑧ agenda_shift·currentAgenda+agenda_history(镜像 apply 语义)');
  var r8 = PI._applyActions(GM, { parties: [{ name: '齐党', actions: [{ type: 'agenda_shift', newAgenda: '联浙抗东林', reason: '势孤' }] }] });
  assert(r8.applied === 1 && party('齐党').currentAgenda === '联浙抗东林', '议程转向落 currentAgenda');
  var ah = party('齐党').agenda_history;
  assert(Array.isArray(ah) && ah[ah.length - 1].agenda === '联浙抗东林' && ah[ah.length - 1].prev === '固党势', 'agenda_history 记新旧');

  console.log('⑨ press·倒阁施压·只落账不改官职');
  var ocB = GM.partyState['齐党'].officeCount;
  var r9 = PI._applyActions(GM, { parties: [{ name: '齐党', actions: [{ type: 'press', target: '东林', outcome: 'lose' }] }] });
  assert(r9.applied === 1 && GM.partyState['齐党'].recentPolicyLose >= 1, 'press→recentPolicyLose 账');
  assert(GM.partyState['齐党'].officeCount === ocB, 'press 不改 officeCount(倒阁实效由既有齿轮自然发生)');
  assert(GM.partyState['齐党'].historyLog.some(function (h) { return h.type === 'press'; }), 'press 落 historyLog');
  assert(sandbox._mems.some(function (m) { return m.name === '亓诗教'; }), 'press 给党魁写记忆');

  console.log('⑩ incite·必经 ClassMinxinBridge·satDelta 钳至 ±4·绝不直写满意度');
  var satB = cls('佃农').satisfaction;
  var bridgeN = sandbox._bridgeCalls.length;
  var r10 = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'incite', target: '佃农', satisfactionDelta: 99 }] }] });
  assert(r10.applied === 1 && sandbox._bridgeCalls.length === bridgeN + 1, 'incite→调用 applyClassPressure');
  var pay = sandbox._bridgeCalls[sandbox._bridgeCalls.length - 1];
  assert(pay.className === '佃农' && pay.satisfactionDelta === 4, 'satisfactionDelta 99→钳至 4');
  assert(cls('佃农').satisfaction === satB, '演绎层绝不直写 cls.satisfaction(经桥)');
  var savedBridge = sandbox.TM.ClassMinxinBridge;
  sandbox.TM.ClassMinxinBridge = undefined;
  var r10b = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'incite', target: '佃农', satisfactionDelta: 3 }] }] });
  assert(r10b.blocked === 1, '桥缺席→煽动拒(不经 bridge 不落地)');
  sandbox.TM.ClassMinxinBridge = savedBridge;

  console.log('⑪ 单党单回合动作≤2 封顶');
  var r11 = PI._applyActions(GM, { parties: [{ name: '东林', actions: [{ type: 'propaganda', influenceDelta: 1 }, { type: 'propaganda', influenceDelta: 1 }, { type: 'propaganda', influenceDelta: 1 }] }] });
  assert(r11.applied === 2, '第3动作被 slice(0,2) 丢弃·单党封顶2');

  console.log('⑫ 全局单回合动作≤10 封顶');
  var bigParties = PI.activeParties(GM).map(function (p) {
    return { name: p.name, actions: [{ type: 'propaganda', influenceDelta: 1 }, { type: 'propaganda', influenceDelta: 1 }] };
  });
  var r12 = PI._applyActions(GM, { parties: bigParties });
  assert(r12.applied === 10 && r12.blocked >= 2, '6党×2=12→applied 封顶10·余 blocked');

  console.log('⑬ 幂等回合戳下沉·tickInference 权威闸(先查后置·所有入口共用)');
  GM.turn = 15; delete GM._partyInferTurn;
  var tk1 = await PI.tickInference(GM);
  assert(tk1 && GM._partyInferTurn === 15, '首调 tickInference→行动并打戳(先查后置)');
  var tk2 = await PI.tickInference(GM);
  assert(tk2 === null, '同回合直调第二次→no-op(共用同一闸·外部直调亦幂等)');
  console.log('⑬b schedule·外层省调用优化(戳已置则不重复入队)');
  var jobs = [];
  sandbox._enqueuePostTurnJob = function (id, fn) { jobs.push(id); return Promise.resolve(); };
  GM.turn = 18; delete GM._partyInferTurn;
  PI.schedule(GM);
  assert(jobs.indexOf('partyInference') >= 0, 'schedule→入队 partyInference(戳由 tickInference 置)');
  var n1 = jobs.length;
  GM._partyInferTurn = 18;  // 模拟 tick 已跑置戳
  PI.schedule(GM);
  assert(jobs.length === n1, '戳已置→schedule 省调用·不重复入队');

  console.log('⑭ flag OFF→零行为(双轨兜底)');
  sandbox.P = { conf: { partyInferenceEnabled: false } };
  jobs.length = 0;
  GM.turn = 17; delete GM._partyInferTurn;
  PI.schedule(GM);
  assert(jobs.length === 0 && PI.enabled() === false, 'flag OFF→schedule 零入队');
  var tOff = await PI.tickInference(GM);
  assert(tOff === null, 'flag OFF→tickInference 零行为');
  // 修2①·forgeIdentity 公开口 OFF 全截：返 null·不锻不写 _identity
  var freshP = { name: '临时党', leader: '', influence: 20, cohesion: 50, status: 'active' };
  GM.parties.push(freshP);
  var fOff = await PI.forgeIdentity(GM);
  assert(fOff === null && !freshP._identity, 'flag OFF→forgeIdentity 返 null·不写 _identity');
  GM.parties = GM.parties.filter(function (p) { return p !== freshP; });
  sandbox.P = { conf: { partyInferenceEnabled: true } };

  console.log('⑮ 阶层 creed 进 class actor 文案(有 _identity→有立场口吻·无→零回归)');
  var Actors = sandbox.TM.PartyClassActors;
  assert(Actors && typeof Actors._planClassActions === 'function', 'PartyClassActors 加载');
  GM.class_actions = []; GM.party_actions = [];
  var tian = cls('佃农');
  tian._identity = { creed: '均田免赋', voice: '泣血陈情' };
  tian.satisfaction = 40; tian.demands = '均田';
  Actors._planClassActions(GM, tian, { turn: GM.turn });
  var petition = (GM.class_actions || []).find(function (a) { return a.actorId === '佃农' && a.actionType === 'petition'; });
  assert(petition && /均田免赋/.test(petition.belief), '有 _identity.creed→creed 拼进 petition 文案(有立场口吻)');
  var shen = cls('士绅');
  delete shen._identity;
  shen.satisfaction = 40; shen.demands = '减赋';
  Actors._planClassActions(GM, shen, { turn: GM.turn });
  var p2 = (GM.class_actions || []).find(function (a) { return a.actorId === '士绅' && a.actionType === 'petition'; });
  assert(p2 && !/本位诉求/.test(p2.belief), '无 _identity→belief 不加 creed 前缀(零回归)');
  // 修2②·flag OFF→即便存档已有 cls._identity.creed 也不拼(玩家关演绎=全关)
  sandbox.P = { conf: { partyInferenceEnabled: false } };
  GM.class_actions = []; GM.party_actions = [];
  tian._identity = { creed: '均田免赋', voice: '泣血陈情' };
  tian.satisfaction = 40; tian.demands = '均田';
  Actors._planClassActions(GM, tian, { turn: GM.turn });
  var p3 = (GM.class_actions || []).find(function (a) { return a.actorId === '佃农' && a.actionType === 'petition'; });
  assert(p3 && !/均田免赋/.test(p3.belief), 'flag OFF→即便有 _identity.creed 也不拼进文案');
  sandbox.P = { conf: { partyInferenceEnabled: true } };

  console.log('⑯ tickInference 整合(forge+tick+apply·canned AI)');
  GM.parties.forEach(function (p) { delete p._identity; });
  GM.classes.forEach(function (c) { delete c._identity; });
  var infB16 = party('东林').influence;
  GM.turn = 20; delete GM._partyInferTurn;
  var res16 = await PI.tickInference(GM);
  assert(res16 && res16.applied >= 1, 'tickInference 整合→应用 AI 决策');
  assert(party('东林')._identity && party('东林').influence >= infB16, '整合内先锻身份再行动(influence 因 propaganda 抬升)');

  console.log('⑰ 党数封顶·top8(9 党场景 forge/tick 只取 influence top8·余党轮动)');
  var names9 = ['甲党', '乙党', '丙党', '丁党', '戊党', '己党', '庚党', '辛党', '壬党'];
  var nineGM = freshGM();
  nineGM.parties = names9.map(function (nm, i) { return { name: nm, leader: nm + '魁', influence: 90 - i * 10, cohesion: 50, status: 'active' }; });
  nineGM.partyState = {};
  nineGM.classes = [];
  nineGM.chars = names9.map(function (nm) { return { name: nm + '魁', alive: true }; });
  nineGM.memorials = [];
  nineGM._partyDynamics = [];
  nineGM._edictTracker = [];
  nineGM.turn = 30; delete nineGM._partyInferTurn;
  assert(PI.activePartiesCapped(nineGM).length === 8, 'activePartiesCapped→9 党取 top8');
  assert(PI.activePartiesCapped(nineGM).every(function (p) { return p.name !== '壬党'; }), '最低 influence 党(壬党)不在 top8');
  sandbox._lastTickPrompt = '';
  await PI.tickInference(nineGM);
  var pr = sandbox._lastTickPrompt;
  assert(names9.slice(0, 8).every(function (n) { return pr.indexOf(n) >= 0; }), 'top8 党名全入 tick prompt');
  assert(pr.indexOf('壬党') < 0, '第9党(壬党)本回合截断出局·不入 prompt(下回合轮动)');
  assert(!nineGM.parties[8]._identity, '未入选党不锻身份(forge 随党数封顶)');

  console.log('');
  if (failures.length) {
    console.log('FAIL smoke-party-inference: ' + failures.length + ' 处失败');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
  console.log('PASS smoke-party-inference (身份双轨/七动作宪法闸/死者cosigner拒/pending≥12让位/超夹钳/未注册拒/standing拒/煽动经桥/单党≤2全局≤10/幂等下沉tick权威闸/schedule省调用/flagOFF全截(schedule+tick+forge+creed)/党魁记忆/阶层creed进文案/tick整合/党数封顶top8)');
}

main().catch(function (e) { console.log('FAIL smoke-party-inference: 异常 ' + (e && e.stack || e)); process.exit(1); });
