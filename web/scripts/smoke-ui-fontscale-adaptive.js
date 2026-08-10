#!/usr/bin/env node
'use strict';
/* smoke-ui-fontscale-adaptive — 界面字号自适应（2026-08-10）防腐线。
 * A1 屏幕宽定档（≥3400→1.6·≥2400→1.35·其余→1.2）两处一字不差（index.html early-apply ↔ tm-patches.js _tmUiFontScaleDefault）
 * A2 固定舞台整体放大时字号默认折算防双重放大（stg>1 才折算·APK 舞台缩小不折算）
 * A3 只生效不落盘（tm.uiFontScale 只有 _tmSetUiFontScale 一处写）
 * A4 运行中重适配（resize 去抖重算·显式选档不参与）
 * A5 四档 pills 与「屏幕宽优先于窗口宽」取值不变 */
var fs = require('fs');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var P = 0, F = 0;
function ok(c, m) { if (c) { P++; console.log('  ✓ ' + m); } else { F++; console.log('  ✗ FAIL: ' + m); } }
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function has(s, sub) { return s.indexOf(sub) >= 0; }
console.log('smoke-ui-fontscale-adaptive');

var idx = read('index.html');
var pat = read('tm-patches.js');

var TIER = '(w >= 3400) ? 1.6 : (w >= 2400) ? 1.35 : 1.2';
var FITRE = "/^(\\d{3,4})x(\\d{3,4})$/";
var SCALE = 'if (stg > 1) s = Math.round(Math.min(1.6, Math.max(0.9, s / stg)) * 100) / 100;';
var SCREENW = '(window.screen && window.screen.availWidth) || window.innerWidth';

console.log('— A1 · 屏幕宽定档·两处一字不差 —');
ok(has(idx, TIER), 'index.html early-apply 含定档三元（≥3400→1.6·≥2400→1.35·其余→1.2）');
ok(has(pat, TIER), 'tm-patches.js _tmUiFontScaleDefault 含同一定档三元（一字不差）');
ok(has(pat, 'function _tmUiFontScaleDefault(){'), '出厂档函数在');

console.log('— A2 · 防双重放大 —');
ok(has(idx, FITRE) && has(pat, FITRE), '两处同读 tm.fitResolution（同一正则）');
ok(has(idx, SCALE), 'index.html 含舞台放大折算式（stg>1·夹 0.9~1.6·两位小数）');
ok(has(pat, SCALE), 'tm-patches.js 含同一折算式（一字不差）');

console.log('— A3 · 只生效不落盘 —');
ok(!has(idx, "setItem('tm.uiFontScale'"), 'index.html early-apply 不写 tm.uiFontScale');
ok((pat.split("setItem('tm.uiFontScale'").length - 1) === 1, 'tm-patches.js 全文件仅 _tmSetUiFontScale 一处写该键');

console.log('— A4 · 运行中重适配 —');
ok(has(pat, "window.addEventListener('resize'") && has(pat, '_tmFsAdaptT'), 'resize 去抖重算监听器在');
ok(has(pat, "if (localStorage.getItem('tm.uiFontScale')) return;"), '显式选过档（有存值）完全不参与重适配');
ok(has(pat, 'document.documentElement.style.fontSize = (s === 1 ?'), '重适配即时应用根字号');

console.log('— A5 · 存量契约不动 —');
ok(has(pat, "pill(0.9,'小') + pill(1,'标准') + pill(1.2,'大') + pill(1.35,'特大')"), '四档 pills 原样');
ok(has(idx, SCREENW) && has(pat, SCREENW), '两处均屏幕宽优先、窗口宽兜底');
ok(has(pat, "localStorage.setItem('tm.uiFontScale', String(v)); localStorage.removeItem('tianming_font_size')"), '_tmSetUiFontScale 写入+清旧键行为不动');

console.log('\nsmoke-ui-fontscale-adaptive ' + (F === 0 ? 'PASS' : 'FAIL') + ' ' + P + '/' + (P + F));
process.exit(F === 0 ? 0 : 1);
