#!/usr/bin/env node
'use strict';

// smoke-workshop-pipeline-a.js — 工坊全链修缮·批A（止血四刀）静态断言
//   A1 目录加载出错态与真空态分离 · A2 封面键位双键兼容 ·
//   A3 mod=混合资产组合包（接三条生效链）· A4 网页/安卓配额专门提示
// 风格沿袭 smoke-workshop-admin-review-ui.js：读运行时源码，正则/子串断言不回归。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const onlineClient = read('tm-online-client.js');
const cm = read('tm-content-manager.js');
const community = read('tm-content-manager-community.js');
const audio = read('tm-audio-theme.js');
const admin = read('workshop-admin.html');

// 语法自检（除 admin 内联脚本外，其余三个 JS 运行时源用 --check 由 run-smokes 侧跑；
// 这里对 admin 内联脚本 new Function 一遍，防审核台缩略图改动引入语法错）。
const adminScript = admin.match(/<script>([\s\S]*?)<\/script>/);
assert(adminScript, 'workshop-admin.html should include an inline script');
new Function(adminScript[1]);

// ── ① A1：catalog 直连分支存在 resp.ok 检查，且错误卡/空卡两态分离 ──
assert(
  /\.then\(function \(resp\) \{ if \(!resp\.ok\) throw new Error\('HTTP '/.test(onlineClient),
  'A1: catalog() 直连分支必须在 resp.text() 前检查 resp.ok（非 2xx 抛 HTTP 码）'
);
assert(
  cm.includes('state.catalogError = null;'),
  'A1: loadWorkshopCatalog 开跑须清 state.catalogError'
);
assert(
  cm.includes("state.catalogError = (e && e.message) || '未知错误';"),
  'A1: loadWorkshopCatalog 的 catch 须落明确错误标记（带 HTTP 码来自 e.message）'
);
// community 侧错误卡（含「重试」）与真空卡两态分离，且靠 catalogError 标记而非文案串匹配
assert(
  community.includes('state.catalogError') && community.includes('class="empty err"'),
  'A1: renderBrowsePane 须有独立错误卡（class="empty err"·靠 state.catalogError 分支）'
);
assert(
  community.includes('loadWorkshopCatalog()">重试'),
  'A1: 错误卡须含「重试」按钮，重新触发 loadWorkshopCatalog'
);
assert(
  community.includes('尚未载入在线目录'),
  'A1: 真空卡文案须与错误卡分开保留'
);

// ── ② A2：封面键位双键兼容（coverImage + 扁平 coverUrl）──
assert(
  community.includes("if (p && typeof p.coverUrl === 'string' && p.coverUrl) return p.coverUrl;"),
  'A2: community packCoverUrl 须在 coverImage 之后回退扁平 coverUrl'
);
assert(
  admin.includes("if (p && typeof p.coverUrl === 'string' && p.coverUrl) return p.coverUrl;"),
  'A2: 审核台 coverUrl 须双键兼容（coverImage + 扁平 coverUrl）'
);

// ── ③ A3：waWarmup 含 mod 包扫描，且排除残局包 / 封面基名 ──
assert(
  cm.includes("var isModPack = pk.type === 'mod';"),
  'A3: waWarmup 须让 mod 包参与立绘索引'
);
assert(
  cm.includes('if (isModPack && isResumePack(mf)) return;'),
  'A3: waWarmup 须把残局壳（isResumePack）排除在资产扫描外'
);
assert(
  cm.includes('/^(cover|shot|preview|screenshot)/i'),
  'A3: waWarmup 须排除 cover*/shot*/preview* 封面截图基名，勿把封面误当立绘'
);
assert(
  cm.includes('portraits?') && cm.includes('a.type || a.kind'),
  'A3: waWarmup mod 立绘识别须「优先 manifest 类型化声明·兜底 portraits/ 子目录约定」'
);
// mod 详情与安装文案的组合包语义
assert(
  cm.includes('混合资产组合包'),
  'A3: renderDetailTypeBody 的 mod 分支须写清组合包语义'
);
assert(
  cm.includes('组合包已装载：包内立绘 / 音乐将自动生效'),
  'A3: mod 安装成功文案须给真后缀'
);

// ── ④ A3 音乐链：mod 包内音频也入 BGM 轮播（且排除残局壳）──
assert(
  audio.includes("p.type === 'music' || p.type === 'mod'"),
  'A3: loadWorkshopTracks 曲库须纳入 mod 组合包'
);
assert(
  /p\.type === 'mod' && mf && \(\(Array\.isArray\(mf\.tags\)[\s\S]{0,80}残局[\s\S]{0,80}packageKind === 'resume'/.test(audio),
  'A3: 音乐链须把残局壳（tags 含「残局」/packageKind=resume）排除在曲库外'
);

// ── ⑤ A4：网页/安卓配额耗尽给专门文案 ──
assert(
  cm.includes("e.name === 'QuotaExceededError'"),
  'A4: installCatalogPackWeb catch 须识别 QuotaExceededError'
);
assert(
  cm.includes('设备存储空间不足：请清理空间或卸载不用的工坊包后重试。'),
  'A4: 配额耗尽须给专门文案'
);
assert(
  cm.includes("'网页安装失败：'"),
  'A4: 非配额错误须保持现「网页安装失败」文案'
);

console.log('[smoke-workshop-pipeline-a] PASS');
