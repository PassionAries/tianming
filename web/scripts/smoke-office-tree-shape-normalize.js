#!/usr/bin/env node
// smoke-office-tree-shape-normalize.js — 官制树形状归一（children→positions/subs 拍平）+ 民心 pin
// 2026-08 玩家剧本事故：国师/案卷写出的 {name,level,holder,children} 嵌套官制与引擎契约 {positions,subs} 不符
// → 全树 0 职位槽·41 个人物官衔无处入座·全被甩进（编制外）动态部门平铺；
// variables['民心'] 显式设定从不被读（GM.minxin 只由叶子区划 minxinLocal 自底向上聚合）→ 被静默丢弃。
// 覆盖 _offNormalizeTreeShape 5 组形状断言 + _tmStartPinMinxinFromVars 新开局 pin/读档跳过。

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = { console, Date, JSON, Math, GM: { turn: 0 }, P: {} };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
function assert(cond, msg) { if (!cond) throw new Error('[smoke-office-tree-shape-normalize] ' + msg); }

load('tm-office-system.js');
const _norm = ctx._offNormalizeTreeShape;
let assertions = 0;

// ── case 1·children 形状归一+拍平（尚书省 → 领尚书省事 + 吏部[吏部尚书/吏部侍郎（阙）]）──
const out1 = _norm([
  { name: '尚书省', level: '中枢', children: [
    { name: '领尚书省事', level: '从二品', holder: '昭衡' },
    { name: '吏部', children: [
      { name: '吏部尚书', level: '正三品', holder: '郑明远' },
      { name: '吏部侍郎', level: '正四品', holder: '（阙）' }
    ] }
  ] }
]);
assertions += 1; assert(Array.isArray(out1) && out1.length === 2, 'case1 flat 长度应为 2（尚书省+吏部拍平为顶级）');
const ss = out1[0], lb = out1[1];
assertions += 1; assert(ss.name === '尚书省' && ss.positions.length === 1, 'case1 尚书省 positions 长度应为 1');
assertions += 1; assert(ss.positions[0].holder === '昭衡' && ss.positions[0].rank === '从二品', 'case1 领尚书省事 holder=昭衡·level→rank=从二品');
assertions += 1; assert(lb.name === '吏部' && lb.positions.length === 2, 'case1 吏部紧随其后且 positions 长度应为 2');
assertions += 1; assert(lb.positions[0].holder === '郑明远', 'case1 吏部尚书 holder=郑明远');
assertions += 1; assert(lb.positions[1].holder === '' && lb.positions[1].vacancyCount === 1, 'case1 吏部侍郎（阙）→ holder 空 + vacancyCount=1');
assertions += 1; assert(out1.every(function (n) { return Array.isArray(n.subs) && n.subs.length === 0 && !('children' in n); }), 'case1 所有输出节点 subs 均为空数组且无 children 键');

// ── case 2·canonical 透传（官方契约形状零变更）──
const out2 = _norm([{ id: 'x', name: '内阁', positions: [{ name: '首辅', holder: '黄立极' }], subs: [] }]);
assertions += 1; assert(out2.length === 1, 'case2 输出长度应为 1');
assertions += 1; assert(out2[0].positions[0].holder === '黄立极' && out2[0].id === 'x', 'case2 canonical positions/holder 原样保留');

// ── case 3·「（阙·由中书令兼摄）」→ 空缺 ──
const out3 = _norm([{ name: '中书省', children: [{ name: '中书侍郎', level: '正四品', holder: '（阙·由中书令兼摄）' }] }]);
assertions += 1; assert(out3[0].positions[0].holder === '' && out3[0].positions[0].vacancyCount === 1, 'case3 （阙…）开头 → holder 空 + vacancyCount=1');

// ── case 4·id/court/group 保留 ──
const out4 = _norm([{ id: 'd1', name: '户部', court: 'central', group: 'liucao', children: [{ name: '户部尚书', level: '正三品', holder: '王某' }] }]);
assertions += 1; assert(out4[0].id === 'd1' && out4[0].court === 'central' && out4[0].group === 'liucao', 'case4 id/court/group 保留');

// ── case 5·深层拍平顺序：A{children:[a1, B{children:[b1]}]} → [A, B] ──
const out5 = _norm([{ name: 'A', children: [{ name: 'a1', level: '正一品', holder: '甲' }, { name: 'B', children: [{ name: 'b1', level: '正二品', holder: '乙' }] }] }]);
assertions += 1; assert(out5.length === 2 && out5[0].name === 'A' && out5[1].name === 'B', 'case5 flat 顺序应为 [A, B]');
assertions += 1; assert(out5[0].positions[0].name === 'a1' && out5[1].positions[0].name === 'b1', 'case5 A.positions 含 a1·B.positions 含 b1');

// ── case 6·民心 pin（tm-patches-start.js 可 vm 加载：装载期语句仅 startGame 裸赋值·sloppy 下落到 ctx 全局）──
load('tm-patches-start.js');
const _pin = ctx._tmStartPinMinxinFromVars;
assertions += 1; assert(typeof _pin === 'function', 'case6 _tmStartPinMinxinFromVars 应已定义');
ctx.P = { adminHierarchy: { '楚': { divisions: [{ name: 'A' }, { name: 'B', children: [{ name: 'B1' }] }] } } };
ctx.GM = { turn: 1 };
const r1 = _pin({ variables: [{ name: '民心', value: 85 }] });
assertions += 1; assert(r1 === true, 'case6 新开局 pin 应返回 true');
assertions += 1; assert(ctx.P.adminHierarchy['楚'].divisions[0].minxin === 85, 'case6 叶子 A.minxin===85');
assertions += 1; assert(ctx.P.adminHierarchy['楚'].divisions[1].children[0].minxinLocal === 85, 'case6 叶子 B1.minxinLocal===85');
assertions += 1; assert(ctx.P.adminHierarchy['楚'].divisions[1].minxin === undefined, 'case6 非叶 B 不设 minxin');
ctx.GM = { turn: 5 };
const r2 = _pin({ variables: [{ name: '民心', value: 85 }] });
assertions += 1; assert(r2 === false, 'case6 GM.turn>1（读档）应跳过返回 false');

console.log('[smoke-office-tree-shape-normalize] pass assertions=' + assertions);
