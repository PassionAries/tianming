#!/usr/bin/env node
// smoke-workshop-asset-effect.js — 工坊四类·批Ⅱ余刀+批Ⅴ防腐线（2026-07-22）：
// ①TMZipStore.parseZip：store zip 真解（实弹往返·中文名·CRC·压缩包明说拒收）；
// ②网页/安卓装资产包：installCatalogPackWeb zip 分支（PK 嗅探·sha256 校验·manifest 硬要求·
//   kind='asset' 入 IDB·帽 64MB/500 件）；
// ③TM.WorkshopAssets 桥：桌面 tm-content:// 与网页 IDB 统一取件·音乐/立绘/图幅三链共用；
// ④立绘生效：tm-renwu-tuzhi/tm-renwu-ui 同名兜底（角色自带立绘优先）；
// ⑤图幅生效：openMapPackInEditor→IDB 交接件(__me_import)→map-editor-io 就绪自取自删。

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let A = 0, F = 0;
function assert(cond, msg) {
  if (cond) { A++; console.log('  PASS ' + msg); }
  else { F++; console.log('  FAIL ' + msg); }
}

console.log('smoke-workshop-asset-effect');

// ── ① parseZip 实弹 ──
const Z = require(path.join(ROOT, 'tm-zip-store.js'));
assert(typeof Z.parseZip === 'function', 'parseZip 已导出');
{
  const enc = new TextEncoder();
  const entries = [
    { name: 'manifest.json', data: enc.encode('{"id":"t","type":"music"}') },
    { name: '战鼓琵琶.mp3', data: new Uint8Array([1, 2, 3, 4, 5, 6, 7]) },
  ];
  const back = Z.parseZip(Z.buildZip(entries));
  assert(back.length === 2 && back[1].name === '战鼓琵琶.mp3', '往返解包·中文文件名无恙');
  assert(JSON.stringify([...back[1].data]) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]), '字节逐位相等（CRC 校验在）');
  const bad = Z.buildZip([{ name: 'a.bin', data: new Uint8Array([1]) }]);
  let eocd = -1;
  for (let i = bad.length - 22; i >= 0; i--) if (bad[i] === 0x50 && bad[i + 1] === 0x4b && bad[i + 2] === 0x05 && bad[i + 3] === 0x06) { eocd = i; break; }
  const cd = bad[eocd + 16] | (bad[eocd + 17] << 8) | (bad[eocd + 18] << 16) | (bad[eocd + 19] << 24);
  bad[cd + 10] = 8;
  let rejected = false;
  try { Z.parseZip(bad); } catch (e) { rejected = /仅支持 store/.test(e.message); }
  assert(rejected, '压缩(deflate) zip 明说拒收（引导走桌面版）');
  let traversal = false;
  try { Z.parseZip(Z.buildZip([{ name: '../evil.js', data: new Uint8Array([1]) }])); } catch (e) { traversal = /越界/.test(e.message); }
  assert(traversal, '越界路径(..)拒收');
}

// ── ② 网页装资产包（tm-content-manager.js 源契约）──
const cm = fs.readFileSync(path.join(ROOT, 'tm-content-manager.js'), 'utf8');
assert(/rawBuf\[0\] === 0x50 && rawBuf\[1\] === 0x4b && rawBuf\[2\] === 0x03 && rawBuf\[3\] === 0x04/.test(cm),
  'PK 魔数嗅探分流（zip=资产包·其余走剧本 JSON 老路）');
assert(/crypto\.subtle\.digest\('SHA-256', rawBuf\)/.test(cm), 'sha256 网页侧校验（对齐桌面纪律）');
assert(/缺少 manifest\.json/.test(cm), 'manifest 硬要求（与桌面 validateWorkshopPack 同约）');
assert(/kind: 'asset'/.test(cm) && /files: zEntries\.filter/.test(cm), 'IDB 资产记录（kind=asset·文件字节入库）');
assert(/64 \* 1024 \* 1024/.test(cm) && /zEntries\.length > 500/.test(cm), '64MB/500 件双帽');
assert(/TM\.WorkshopAssets\.warmup\(\)/.test(cm.slice(cm.indexOf('installCatalogPackWeb'), cm.indexOf('installCatalogPackWeb') + 4000)) || /WorkshopAssets && TM\.WorkshopAssets\.warmup/.test(cm),
  '装完即暖机（立绘索引/音乐轮播立即生效）');

// ── ③ 桥 ──
assert(/TM\.WorkshopAssets = \{ listAssetPacks: waListAssetPacks, getManifest: waGetManifest, fileUrl: waFileUrl, hydrate: waHydrate, portraitFor: waPortraitFor, warmup: waWarmup \}/.test(cm),
  'TM.WorkshopAssets 六口齐（桌面/网页统一取件）');
assert(/source: 'desktop'/.test(cm) && /source: 'idb'/.test(cm), '双源归一（tm-content:// 与 objectURL）');
assert(/URL\.createObjectURL\(new Blob\(\[f\.data\]\)\)/.test(cm), '网页水化=IDB 字节→objectURL（audio/img 直用）');
assert(/kind !== 'handoff'/.test(cm), '交接暂存件不进已装列表');

// ── ④ 立绘生效 ──
const tz = fs.readFileSync(path.join(ROOT, 'tm-renwu-tuzhi.js'), 'utf8');
const ru = fs.readFileSync(path.join(ROOT, 'tm-renwu-ui.js'), 'utf8');
assert(/p\.portrait\|\|\(window\.TM&&TM\.WorkshopAssets\?TM\.WorkshopAssets\.portraitFor\(p\.name\):''\)/.test(tz),
  '图志 faceHtml 同名兜底（自带立绘优先）');
assert(/_ch\.portrait \|\| \(window\.TM && TM\.WorkshopAssets \? TM\.WorkshopAssets\.portraitFor\(c\.name\) : ''\)/.test(ru),
  '人物卡立绘同名兜底');

// ── ⑤ 图幅生效 ──
assert(/openMapPackInEditor: openMapPackInEditor/.test(cm), 'openMapPackInEditor 已挂公共 API');
assert(/packId: '__me_import', kind: 'handoff'/.test(cm), '交接件写入（IDB·跨页同源共享）');
assert(/ptype === 'map' \? '<button/.test(cm), '图幅包详情有「在地图编辑器中打开」钮');
const io = fs.readFileSync(path.join(ROOT, 'map-editor-io.js'), 'utf8');
assert(/function importParsedObject\(obj, fname\)/.test(io) && /importParsedObject: importParsedObject/.test(io),
  '三格式归一装载已抽出并导出（picker 与交接件共用）');
assert(/st\.get\('__me_import'\)/.test(io) && /st\.delete\('__me_import'\)/.test(io), '交接件自取自删（一次性）');
assert(/if \(!retry\) setTimeout\(function\(\)\{ _checkWorkshopHandoff\(true\); \}, 2500\)/.test(io),
  'ME 未就绪重试一次（不死等不打扰）');

// ── ⑥ 音乐链走桥 ──
const au = fs.readFileSync(path.join(ROOT, 'tm-audio-theme.js'), 'utf8');
assert(/var WA = window\.TM && TM\.WorkshopAssets;/.test(au), 'BGM 工坊轨改走统一桥');
assert(!/window\.tianming\.listWorkshopPacks\(\)\.then/.test(au), 'audio 不再直连 IPC（桥内收口）');
assert(/WA\.fileUrl\(p, String\(f\)\)/.test(au) && /if \(!src\) return;/.test(au), '无 URL 曲目跳过（网页未水化不塞坏轨）');

// ── ⑦ 已装列表类型签 ──
const cc = fs.readFileSync(path.join(ROOT, 'tm-content-manager-community.js'), 'utf8');
assert(/rec\.kind === 'asset'/.test(cc) && /立绘包/.test(cc), '已装列表资产记录带类型签（同卸载同更新）');

console.log('smoke-workshop-asset-effect ' + (F === 0 ? 'PASS' : 'FAIL') + ' ' + A + '/' + (A + F));
process.exit(F === 0 ? 0 : 1);
