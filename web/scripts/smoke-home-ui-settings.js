#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.resolve(__dirname, '..');
var pass = 0;
var fail = 0;

function read(name) { return fs.readFileSync(path.join(ROOT, name), 'utf8'); }
function ok(condition, message) {
  if (condition) { pass++; console.log('  ✓ ' + message); }
  else { fail++; console.error('  ✗ FAIL: ' + message); }
}

console.log('smoke-home-ui-settings');
var source = read('tm-home-ui.js');
var css = read('tm-home-ui.css');
var index = read('index.html');
var patches = read('tm-patches.js');

console.log('— S1 · 正式加载与设置入口 —');
ok(/tm-home-ui\.css\?v=[^"'<\s]+/.test(index), 'index 加载主页 UI 样式并带 cache-bust');
ok(/tm-home-ui\.js\?v=[^"'<\s]+/.test(index), 'index 加载主页 UI 控制器并带 cache-bust');
ok(index.indexOf('tm-home-ui.js') < index.indexOf('tm-patches.js'), '主页控制器先于设置渲染器装载');
ok(/TM\.HomeUI\.renderSettingsSection\(\)/.test(patches), '设置页挂载主页 UI 分区');
ok(/name:\s*'常用'[\s\S]{0,80}\/主页\|界面显示/.test(patches), '主页 UI 页签归入常用分组');

console.log('— S2 · 三案与统一动作契约 —');
['desk', 'map', 'gate'].forEach(function (theme) {
  ok(new RegExp(theme + ':\\s*\\{').test(source), theme + ' 方案配置存在');
  ok(new RegExp('home-ui-' + theme + '-v3-4k\\.webp').test(source), theme + ' 4K 正式资源路径存在');
  ok(new RegExp('home-ui-' + theme + '-v3-thumb\\.webp').test(source), theme + ' 设置页轻量缩略图路径存在');
  ok(new RegExp('data-home-ui-choice=\\"' + theme + '\\"').test(source) || /data-home-ui-choice=/.test(source), theme + ' 设置选择器由共享渲染器生成');
});
['btn-new-game', 'btn-load-save', 'btn-editor', 'btn-settings'].forEach(function (id) {
  ok(source.indexOf("'" + id + "'") >= 0 && index.indexOf('id="' + id + '"') >= 0, id + ' 沿用正式动作锚点');
});
ok(/\.home-tools > button/.test(source) && /\.home-tools > button/.test(css), '邸报/工坊/载图/帮助/退出沿用正式工具按钮');
ok(/localStorage\.getItem\('tm_save_index'\)/.test(source), '最近三卷读取真实存档索引');
ok(/meta\[name=\"tm-version\"\]/.test(source), '主页版本号读取正式版本 meta');
ok(/typeof root\.Image !== 'function'[\s\S]{0,120}commitTheme/.test(source), '非浏览器 smoke 环境不因缺少 Image 中断启动');
ok(/data-tm-home-ui-loading/.test(source) && /data-tm-home-ui-loading/.test(css), '冷启动先建立主题启动态再淡入正式母图');
ok(/probe\.decode\(\)\.then\(success, success\)/.test(source), '正式母图完成解码后才提交主题，避免切换闪屏');
ok(/正在装裱/.test(source) && /aria-busy/.test(source) && /tm-home-ui-choice\.is-loading/.test(css), '设置页切换提供可感知的加载反馈');
ok(/LOAD_TIMEOUT_MS\s*=\s*12000/.test(source) && /root\.setTimeout\(failure, LOAD_TIMEOUT_MS\)/.test(source), '主页资源加载具备 12 秒看门狗，避免设置永久卡在装裱态');
ok(/status\.hidden = false/.test(source)
  && /function hideLoadingStatus[\s\S]{0,160}status\.hidden = true/.test(source)
  && /if \(pendingTheme \|\|[\s\S]{0,150}ensureLoadingStatus\(\);[\s\S]{0,80}else hideLoadingStatus\(\)/.test(source)
  && /\.tm-home-loading\[hidden\]\s*\{\s*display:\s*none/.test(css), '母图就绪或失败后同步收起读屏加载状态');

console.log('— S3 · 偏好持久化与运行时切换 —');
var attrs = {};
var store = {};
var listeners = {};
var failImage = false;
var hangImage = false;
function FakeImage() { this.complete = false; this.naturalWidth = 0; }
Object.defineProperty(FakeImage.prototype, 'src', {
  set: function (value) {
    this._src = value;
    if (hangImage) return;
    if (failImage) { if (this.onerror) this.onerror(); return; }
    this.complete = true;
    this.naturalWidth = 3840;
    if (this.onload) this.onload();
  },
  get: function () { return this._src; }
});
var documentStub = {
  body: null,
  readyState: 'loading',
  documentElement: {
    setAttribute: function (key, value) { attrs[key] = String(value); },
    removeAttribute: function (key) { delete attrs[key]; },
    getAttribute: function (key) { return attrs[key] || null; }
  },
  addEventListener: function (name, fn) { listeners['document:' + name] = fn; },
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () { return {}; }
};
var sandbox = {
  document: documentStub,
  localStorage: {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem: function (key, value) { store[key] = String(value); }
  },
  Image: FakeImage,
  CustomEvent: function (name, init) { this.type = name; this.detail = init && init.detail; },
  addEventListener: function (name, fn) { listeners['window:' + name] = fn; },
  dispatchEvent: function () {},
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'tm-home-ui.js' });
ok(sandbox.TM && sandbox.TM.HomeUI, '控制器导出 TM.HomeUI');
ok(sandbox.TM.HomeUI.current() === 'desk', '未设置时默认御案待批');
ok(attrs['data-tm-home-ui'] === 'desk', '默认方案通过真实资源探测后应用');
sandbox.TM.HomeUI.set('map');
ok(store['tm.homeUI'] === 'map', '切换方案写入设备本地偏好 tm.homeUI');
ok(attrs['data-tm-home-ui'] === 'map', '切换方案即时更新根主题');
var settingsHtml = sandbox.TM.HomeUI.renderSettingsSection();
ok((settingsHtml.match(/data-home-ui-choice=/g) || []).length === 3, '设置分区恰有三种方案');
ok(/<h4>主页 UI<\/h4>/.test(settingsHtml) && /当前使用/.test(settingsHtml), '设置分区标题与当前态明确');
ok(/role="radiogroup"/.test(settingsHtml) && (settingsHtml.match(/role="radio"/g) || []).length === 3, '三案使用互斥单选组语义');
ok(/onChoiceKey\(event,this\)/.test(settingsHtml) && /loading="lazy" decoding="async"/.test(settingsHtml), '设置卡支持方向键切换与缩略图懒解码');
ok(/tm-home-ui-choice-check" aria-hidden="true"/.test(settingsHtml), '选中勾为纯装饰且不被读屏重复朗读');

var focusedChoice = '';
var radioButtons = ['desk', 'map', 'gate'].map(function (theme) {
  return {
    classList: { toggle: function () {} },
    getAttribute: function (name) { return name === 'data-home-ui-choice' ? theme : null; },
    setAttribute: function () {},
    querySelector: function () { return null; },
    focus: function () { focusedChoice = theme; }
  };
});
documentStub.querySelectorAll = function (selector) { return selector === '[data-home-ui-choice]' ? radioButtons : []; };
var prevented = false;
sandbox.TM.HomeUI.onChoiceKey({
  key: 'ArrowRight',
  preventDefault: function () { prevented = true; },
  stopPropagation: function () {}
}, radioButtons[1]);
ok(prevented && focusedChoice === 'gate' && store['tm.homeUI'] === 'gate' && attrs['data-tm-home-ui'] === 'gate', '方向键切换聚焦并持久化相邻方案');
failImage = true;
sandbox.TM.HomeUI.set('desk');
ok(store['tm.homeUI'] === 'gate' && attrs['data-tm-home-ui'] === 'gate' && attrs['data-tm-home-ui-error'] === 'desk', '方案资源失败时保留上一可用主页与偏好');
failImage = false;
hangImage = true;
sandbox.TM.HomeUI.set('desk');
ok(sandbox.TM.HomeUI.pending() === 'desk' && attrs['data-tm-home-ui-pending'] === 'desk', '未完成的资源切换明确暴露 pending 状态');
sandbox.TM.HomeUI.set('gate');
ok(sandbox.TM.HomeUI.pending() === '' && !attrs['data-tm-home-ui-pending'] && attrs['data-tm-home-ui'] === 'gate', '点回当前方案可立即撤销挂起切换');
hangImage = false;

console.log('— S4 · 比例、热区与美术资源 —');
ok(/1\.777778/.test(css) && /min\(100vw, calc\(var\(--tm-home-view-h\)/.test(css) && /100dvh/.test(css), '所有视口以动态高度保持 16:9 4K 画幅完整');
ok(!/min-aspect-ratio:\s*4\s*\/\s*3/.test(css) && /home-stage::after[\s\S]{0,500}var\(--tm-home-art\)[\s\S]{0,120}cover/.test(css), '非 16:9 视口使用同图氛围补景，不再拉伸或留白');
ok(/\.home-stage::after[\s\S]{0,500}mix-blend-mode:\s*normal/.test(css), '氛围边景显式解除旧主页 multiply 混合，避免宽屏两侧压黑');
ok(/--tm-home-x/.test(css) && /--tm-home-y/.test(css) && /focus-visible/.test(css), '比例热区与键盘焦点反馈存在');
ok(/prefers-reduced-motion/.test(css), '支持减少动态效果偏好');

function readVp8Size(asset) {
  var data = fs.readFileSync(asset);
  var isWebP = data.length > 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  var isVp8 = isWebP && data.toString('ascii', 12, 16) === 'VP8 ' && data.toString('hex', 23, 26) === '9d012a';
  return {
    valid: isVp8,
    width: isVp8 ? data.readUInt16LE(26) & 0x3fff : 0,
    height: isVp8 ? data.readUInt16LE(28) & 0x3fff : 0
  };
}

['desk', 'map', 'gate'].forEach(function (theme) {
  var asset = path.join(ROOT, 'assets', 'ui', 'home', 'home-ui-' + theme + '-v3-4k.webp');
  if (!fs.existsSync(asset)) {
    console.log('  · SKIP: fresh checkout 未携带大媒体 ' + path.basename(asset));
    return;
  }
  var size = readVp8Size(asset);
  ok(size.valid && size.width === 3840 && size.height === 2160, theme + ' 正式母图为真正 3840×2160 WebP');
  var thumb = path.join(ROOT, 'assets', 'ui', 'home', 'home-ui-' + theme + '-v3-thumb.webp');
  var thumbSize = readVp8Size(thumb);
  ok(thumbSize.valid && thumbSize.width === 960 && thumbSize.height === 540, theme + ' 设置缩略图严格收敛为 960×540 WebP');
});

console.log('— S5 · 三案预览页移动端与失败降级 —');
var previewRoot = path.join(ROOT, 'preview', 'home-ui-concepts');
if (!fs.existsSync(previewRoot)) {
  console.log('  - SKIP: preview/home-ui-concepts absent (fresh checkout or release tree); S5 preview checks skipped');
} else {
var previewSource = fs.readFileSync(path.join(previewRoot, 'src', 'App.jsx'), 'utf8');
var previewCss = fs.readFileSync(path.join(previewRoot, 'src', 'styles.css'), 'utf8');
var previewIndex = fs.readFileSync(path.join(previewRoot, 'index.html'), 'utf8');
ok(/event\.key === 'Escape'[\s\S]{0,120}event\.stopPropagation\(\)/.test(previewSource), '弹窗 Escape 阻断同次按键穿透，不会误退回总览');
ok(/imageState === 'error'[\s\S]{0,500}重新展卷/.test(previewSource), '4K 母图加载失败时提供可感知重试入口');
ok(/fetchPriority="high"/.test(previewSource)
  && /loading=\{index === 0 \? 'eager' : 'lazy'\}/.test(previewSource)
  && /fetchPriority=\{index === 0 \? 'high' : 'auto'\}/.test(previewSource), '单案优先解码 4K，三案总览按需懒解码缩略图');
ok(/\.gallery-visual\s*\{[\s\S]{0,160}aspect-ratio:\s*16\s*\/\s*9/.test(previewCss)
  && /\.gallery-card img\s*\{[\s\S]{0,160}height:\s*100%/.test(previewCss), '移动端总览图片槽严格保持 16:9，不继承 HTML 固定高度');
ok(/\.gallery-return\s*\{[\s\S]{0,700}min-height:\s*44px/.test(previewCss)
  && /opacity:\s*0\.72/.test(previewCss), '返回总览入口常态可见且达到 44px 触控高度');
ok(/viewport-fit=cover/.test(previewIndex) && /href="\/favicon\.svg"/.test(previewIndex), '预览页适配安卓安全区且具备本地矢量站点图标');
['desk', 'map', 'gate'].forEach(function (theme) {
  var previewThumb = path.join(previewRoot, 'public', 'references', theme + '-reference-v3-thumb.webp');
  var previewThumbSize = readVp8Size(previewThumb);
  ok(previewThumbSize.valid && previewThumbSize.width === 960 && previewThumbSize.height === 540, theme + ' 预览总览缩略图为 960×540 WebP');
});
}

console.log('\nsmoke-home-ui-settings ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
