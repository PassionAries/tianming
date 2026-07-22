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
  cm.includes('if (isModPack && isResumePack(mf)) return {'),
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

// ════════════════════════════════════════════════════════════════════════
//  返修·Codex 四条：把上面的「水断言」升级为可执行断言（纯 node·无 DOM）。
//  手法：正则从运行时源码抽出目标纯函数源文，new Function 包一层参数化注入闭包依赖后真跑。
// ════════════════════════════════════════════════════════════════════════

// 花括号平衡不敏感的轻量抽取器：本仓源码风格下顶层函数收尾恒为「\n  }」(2空格花括号独占一行)，
// 且函数体内层收尾缩进更深(≥4空格)——故从函数头首现处切到首个「\n  }」即函数全文。
function extractFn(src, header) {
  var s = src.indexOf(header);
  assert(s >= 0, 'extractFn 找不到函数头: ' + header);
  var rest = src.slice(s);
  var end = rest.indexOf('\n  }');
  assert(end >= 0, 'extractFn 找不到 2 空格收尾花括号: ' + header);
  return rest.slice(0, end + 4); // 含尾部 "\n  }"
}

// ── R4·R1：目录视图态纯 helper 真跑四态判定 ──────────────────────────────
(function testCatalogViewState() {
  var catalogViewState = new Function(extractFn(community, 'function catalogViewState(state)') + '\nreturn catalogViewState;')();
  assert(catalogViewState({ catalog: { packs: [{ id: 'a' }] }, catalogError: 'HTTP 500' }) === 'stale',
    'R4·R1: 出错+有旧数据 → stale（上方 banner·列表照常）');
  assert(catalogViewState({ catalog: null, catalogError: 'HTTP 500' }) === 'error',
    'R4·R1: 出错+无数据 → error（错误卡）');
  assert(catalogViewState({ catalog: { packs: [] }, catalogError: null }) === 'empty',
    'R4·R1: 无错误+无数据 → empty（真空卡）');
  assert(catalogViewState({ catalog: { packs: [{ id: 'a' }] }, catalogError: null }) === 'list',
    'R4·R1: 无错误+有数据 → list');
})();
// 接线校验：browse 与 discover 两页都走 catalogViewState，并有 stale banner 分支（不靠文案串匹配）。
assert((community.match(/catalogViewState\(state\)/g) || []).length >= 3,
  'R4·R1: renderDiscover / renderBrowsePane 两页面须都调用 catalogViewState（+定义处）');
assert(community.includes('catalogStaleBannerHtml(state)') && community.includes('catalogErrorCardHtml(state)'),
  'R4·R1: 两页面须复用共享 stale-banner / error-card helper');

// ── R4·R2：立绘归并顺序纯 helper 真跑（确定可复述·portrait 恒优先 mod·同类型按 order）──
(function testMergeOrder() {
  var waMergePortraitIndex = new Function(extractFn(cm, 'function waMergePortraitIndex(items)') + '\nreturn waMergePortraitIndex;')();
  var portraitItem = { type: 'portrait', order: 1, entries: [{ base: 'zhang', url: 'P::zhang' }] };
  var modItem = { type: 'mod', order: 0, entries: [{ base: 'zhang', url: 'M::zhang' }] };
  assert(waMergePortraitIndex([modItem, portraitItem]).zhang === 'P::zhang',
    'R4·R2: 同名立绘·portrait 包优先于 mod 包（输入序 mod 在前也不改结果）');
  assert(waMergePortraitIndex([portraitItem, modItem]).zhang === 'P::zhang',
    'R4·R2: 同名立绘·portrait 包优先于 mod 包（输入序 portrait 在前）');
  var pA = { type: 'portrait', order: 0, entries: [{ base: 'li', url: 'A::li' }] };
  var pB = { type: 'portrait', order: 1, entries: [{ base: 'li', url: 'B::li' }] };
  assert(waMergePortraitIndex([pB, pA]).li === 'A::li',
    'R4·R2: 同类型按 waListAssetPacks 列表序（order 小者先占坑）');
})();
assert(cm.includes('_waPortraitIdx = waMergePortraitIndex(results);'),
  'R4·R2: waWarmup 须把 Promise.all 结果交纯归并（而非在并发 job 内先到先占坑）');

// ── R4·R3：配额判定纯 helper 真跑（只认真配额错误·不误吞其他错误）──────────
(function testQuota() {
  var isQuotaError = new Function(extractFn(cm, 'function isQuotaError(e)') + '\nreturn isQuotaError;')();
  assert(isQuotaError({ name: 'QuotaExceededError' }) === true, 'R4·R3: QuotaExceededError 名 → true');
  assert(isQuotaError(new Error('quota exceeded')) === true, 'R4·R3: message 含 quota → true');
  assert(isQuotaError(new Error('存储空间不足')) === true, 'R4·R3: 含「存储空间」→ true');
  assert(isQuotaError(new Error('storage is full')) === true, 'R4·R3: storage+full 组合 → true');
  assert(isQuotaError(new Error('Maximum call stack size exceeded')) === false,
    'R4·R3: "call stack size exceeded" 不得误判为配额（裸 exceeded 匹配已删）');
  assert(isQuotaError(new Error('network timeout')) === false, 'R4·R3: 无关错误 → false');
  assert(isQuotaError(null) === false, 'R4·R3: null → false');
})();
assert(cm.includes('var quota = isQuotaError(e);'),
  'R4·R3: 安装 catch 须走 isQuotaError（而非内联裸 exceeded 正则）');

// ── R4·loadWorkshopCatalog 三条生命周期路径真跑（成功清错 / 失败保留 stale / 开跑清错）──
(function testLoadCatalogLifecycle() {
  var makeLWC = new Function(
    'state', 'render', 'desktop', 'document', 'window', 'TM', 'catalogUrlWithParams', 'saveCatalogUrl',
    extractFn(cm, 'async function loadWorkshopCatalog()') + '\nreturn loadWorkshopCatalog;'
  );
  function runLWC(state, catalogFn) {
    var lwc = makeLWC(
      state,
      function render() {},
      function desktop() { return false; },
      { getElementById: function () { return null; } },
      {},
      { OnlineClient: { catalog: catalogFn } },
      function catalogUrlWithParams() { return state.catalogUrl || ''; },
      function saveCatalogUrl() {}
    );
    return lwc();
  }
  return (async function () {
    // ① 成功路径：catalog 返回 {packs:[…]} → catalogError 清空且 packs 落位。
    var s1 = { catalogUrl: 'u', defaultCatalogUrl: 'u', catalog: null, catalogError: null };
    await runLWC(s1, async function () { return { type: 'tianming-workshop-catalog', packs: [{ id: 'a' }, { id: 'b' }] }; });
    assert(s1.catalogError === null, 'R4·LWC①: 成功后 catalogError===null');
    assert(s1.catalog && s1.catalog.packs && s1.catalog.packs.length === 2, 'R4·LWC①: packs 落位');

    // ② 失败路径：抛 HTTP 500 → catalogError 含 'HTTP 500' 且旧 catalog 保持（stale 保留）。
    var s2 = { catalogUrl: 'u', defaultCatalogUrl: 'u', catalog: { type: 't', packs: [{ id: 'old' }] }, catalogError: null };
    await runLWC(s2, async function () { throw new Error('HTTP 500'); });
    assert(/HTTP 500/.test(s2.catalogError || ''), 'R4·LWC②: 失败后 catalogError 含 HTTP 500');
    assert(s2.catalog && s2.catalog.packs && s2.catalog.packs[0] && s2.catalog.packs[0].id === 'old',
      'R4·LWC②: 失败保留旧目录（不清 state.catalog）');

    // ③ 开跑清错：预置旧错误 → 成功后清空（护「state.catalogError = null;」清错行不被摘）。
    var s3 = { catalogUrl: 'u', defaultCatalogUrl: 'u', catalog: null, catalogError: '上一次的旧错误' };
    await runLWC(s3, async function () { return { packs: [{ id: 'z' }] }; });
    assert(s3.catalogError === null, 'R4·LWC③: 开跑清错→成功后 catalogError 为 null');
  })();
})().then(function () {
// 收尾行保持原样(列 0)：全部路径通过后打印 PASS。
console.log('[smoke-workshop-pipeline-a] PASS');
}).catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
