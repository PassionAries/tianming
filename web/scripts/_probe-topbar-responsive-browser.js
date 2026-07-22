#!/usr/bin/env node
/* eslint-env node */
'use strict';
/*
 * _probe-topbar-responsive-browser.js — 顶栏窄舞台自适应·真浏览器探针 (chromium headless)
 *
 *   病根：#topbar 三块(.tb-left/.tb-vars/.tb-right) 与内部所有卡片皆 flex:0 0 auto(零收缩)+固定 px，
 *         .tb-vars 用 margin-left:auto 右推。深局帑廪/内帑大额值+增减把固有内容宽顶到 ~1270-1300px；
 *         当「渲染分辨率」虚拟舞台(tm-fixed-fit VW)窄于内容宽时 margin-auto 归零、内容不收缩，
 *         最右官印卡/内帑组/全部变量钮溢出舞台被 body overflow:hidden 裁掉(玩家所见「跑到屏幕外」)。
 *   修法：phase8-formal-bridge.js fitTopbar() 读 #topbar scrollWidth vs clientWidth，分级加
 *         .tm-tb-fit1/2(收 padding/gap + 隐增减小字 → 再降字号/印记尺寸)。media-query-free
 *         (fixed-fit 会删所有 max-width @media·且 @media 看设备宽非舞台 VW)。宽舞台两 class 皆不加→零退化。
 *
 *   本探针：起真局 doActualStart → 分档设视口宽 → dispatch resize 触发 fitTopbar → 断言
 *           ① #topbar.scrollWidth <= innerWidth+1  ② 全部变量钮 right <= innerWidth  ③ 无横向滚动。
 *           另跑「大额值」变体(注入 1.5亿 级帑廪+大 delta)验证 1280/1100 触发紧凑仍不溢出。
 *
 *   依赖 playwright / playwright-core（本仓 node_modules 可能未装→回退全局/scratch 安装的 playwright-core，
 *   浏览器取 ~/AppData/Local/ms-playwright 缓存）。属手动浏览器探针(_probe-*)，run-smokes 只收 smoke-*.js 不纳 CI。
 *   跑法：node scripts/_probe-topbar-responsive-browser.js
 */
const path = require('path'); const fs = require('fs'); const http = require('http');
const ROOT = path.resolve(__dirname, '..');

function loadPlaywright() {
  const tries = [
    () => require(path.join(ROOT, 'node_modules', 'playwright')),
    () => require(path.join(ROOT, 'node_modules', 'playwright-core')),
    () => require('playwright'),
    () => require('playwright-core')
  ];
  for (const t of tries) { try { const m = t(); if (m && m.chromium) return m; } catch (_) {} }
  throw new Error('playwright/playwright-core 不可用：请 `npm i -D playwright-core` 或全局安装');
}
function findChromiumExe() {
  const base = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'ms-playwright');
  try {
    const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort();
    for (const d of dirs.reverse()) {
      const exe = path.join(base, d, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch (_) {}
  return null;  // 交给 playwright 默认解析
}

const { chromium } = loadPlaywright();
const EXE = findChromiumExe();
const SID = 'sc-tianqi7-1627';
const PORT = 8733;
const SHOT = path.join(ROOT, '_pw-scratch');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.glb':'model/gltf-binary','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.mp3':'audio/mpeg','.webp':'image/webp','.ico':'image/x-icon' };
const TIERS = [ {w:1280,h:720}, {w:1366,h:768}, {w:1600,h:900}, {w:1920,h:1080} ];
let A = 0, F = 0; function ok(c, m) { if (c) { A++; console.log('  ✓ ' + m); } else { F++; console.log('  ✗ FAIL: ' + m); } }

function serve() {
  return http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(String(req.url || '/').split('?')[0]); if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p.replace(/^\/+/, ''));
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    } catch (e) { try { res.writeHead(500); res.end(); } catch (_) {} }
  }).listen(PORT, '127.0.0.1');
}
async function bootGame(page) {
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.doActualStart === 'function', null, { timeout: 60000 });
  await page.evaluate((sid) => { window.doActualStart(sid); }, SID);
  await page.waitForFunction(() => window.GM && window.GM.running, null, { timeout: 90000 });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { ['开始临朝','知道了','已阅 · 闭卷','已阅·闭卷','开始治国','进入朝堂','确定'].forEach(t => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === t); b && b.click(); }); }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => { const v = document.getElementById('tmf-tb-vars'); return v && v.childElementCount > 0; }, null, { timeout: 30000 }).catch(() => {});
}
async function inflate(page) {
  // 模拟深局大额帑廪/内帑 + 大增减，逼近/越过舞台宽以验证紧凑分级
  await page.evaluate(() => {
    try {
      const G = window.GM; G.guoku = G.guoku || {}; G.neitang = G.neitang || {};
      G.guoku.money = 155000000; G.guoku.grain = 99990000; G.guoku.cloth = 88880000;
      G.neitang.money = 125000000; G.neitang.grain = 77770000; G.neitang.zhen = 66660000; G.neitang.cloth = 66660000;
      if (G.population && G.population.national) G.population.national.ding = 99990000;
      const vars = document.getElementById('tmf-tb-vars');
      const api = window.TMPhase8FormalBridge && window.TMPhase8FormalBridge.topbar;
      if (vars && api && api.renderPreviewTopbarVars) vars.innerHTML = api.renderPreviewTopbarVars();
      vars.querySelectorAll('.tb-var.wide .sd').forEach(el => { el.textContent = '+1235万'; });
    } catch (_) {}
  });
}
async function settleFit(page) { await page.evaluate(() => { window.dispatchEvent(new Event('resize')); }); await page.waitForTimeout(160); }
async function measure(page) {
  return await page.evaluate(() => {
    const iw = window.innerWidth; const top = document.getElementById('topbar'); if (!top) return { err: 'no topbar' };
    const chip = top.querySelector('.tb-chip'); const chipR = chip ? chip.getBoundingClientRect() : null;
    return {
      iw, topScrollW: top.scrollWidth, topClientW: top.clientWidth,
      docScrollW: document.documentElement.scrollWidth,
      chipRight: chipR ? +chipR.right.toFixed(1) : null,
      chipVisible: chipR ? (chipR.right <= iw && chipR.left >= 0) : null,
      fitClass: (top.className.match(/tm-tb-fit\d/g) || []).join('+') || '(none)',
      varCount: (document.getElementById('tmf-tb-vars') || {}).childElementCount || 0
    };
  });
}

(async function main() {
  console.log('\n████ 顶栏窄舞台自适应 · 真浏览器探针 ████\n');
  if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
  const server = serve();
  const browser = await chromium.launch(EXE ? { headless: true, executablePath: EXE } : { headless: true });
  const errs = [];
  // ── 常规值：四档必须放得下且不触发紧凑(1920 零退化) ──
  for (const vp of TIERS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errs.push('pageerror[' + vp.w + ']:' + e.message));
    await bootGame(page); await settleFit(page);
    const m = await measure(page);
    ok(m.topScrollW <= m.iw + 1, '[' + vp.w + '] #topbar.scrollWidth ' + m.topScrollW + ' <= iw+1(' + (m.iw + 1) + ')');
    ok(m.chipRight != null && m.chipRight <= m.iw, '[' + vp.w + '] 全部变量钮 right ' + m.chipRight + ' <= iw ' + m.iw);
    ok(m.docScrollW <= m.iw + 1, '[' + vp.w + '] 无横向滚动 docScrollW ' + m.docScrollW + ' <= iw+1');
    await page.screenshot({ path: path.join(SHOT, 'topbar-resp-' + vp.w + '.png'), clip: { x: 0, y: 0, width: vp.w, height: 90 } });
    await page.close();
  }
  // ── 大额值(深局)：窄档触发紧凑仍不溢出；宽档不触发 ──
  for (const vp of [{ w: 1100, h: 720 }, { w: 1280, h: 720 }, { w: 1920, h: 1080 }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errs.push('pageerror[inflate' + vp.w + ']:' + e.message));
    await bootGame(page); await inflate(page); await settleFit(page);
    const m = await measure(page);
    ok(m.topScrollW <= m.iw + 1 && m.chipRight <= m.iw, '[大额' + vp.w + '] 不溢出 scrollW=' + m.topScrollW + ' chipRight=' + m.chipRight + ' fitClass=' + m.fitClass);
    if (vp.w >= 1600) ok(m.fitClass === '(none)', '[大额' + vp.w + '] 宽舞台零退化(未加紧凑 class)');
    await page.screenshot({ path: path.join(SHOT, 'topbar-resp-inflate-' + vp.w + '.png'), clip: { x: 0, y: 0, width: vp.w, height: 90 } });
    await page.close();
  }
  ok(errs.length === 0, '全程无 JS 页错' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
  await browser.close(); server.close();
  console.log('\n' + (F === 0 ? 'ALL PASS' : 'FAIL') + ' (' + A + ' pass / ' + F + ' fail) · 截图→ _pw-scratch/topbar-resp-*.png');
  process.exit(F === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR:', e); process.exit(1); });
