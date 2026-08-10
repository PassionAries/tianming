#!/usr/bin/env node
'use strict';
/* smoke-guoshi-source-ipc — 国师源码工具桌面 IPC 通道（2026-08-10）防腐线。
 * 病灶：编辑器在桌面端跑在 file:// origin，Chromium fetch 不支持 file: scheme，
 *   genReference/listSource/grepSource/readSource 四工具清一色 Failed to fetch。
 * 刀法：main-impl 注册 read-web-file（路径净化+扩展名白名单+8MB 上限+isInsideDir 复核）·
 *   preload-impl 暴露 readWebFile·四工具经 _srcFetchLike 伪 Response 双通道·fetch 全相对路径。 */
var fs = require('fs');
var path = require('path');
var WEB = path.resolve(__dirname, '..');
var REPO = path.resolve(WEB, '..');
var P = 0, F = 0;
function ok(c, m) { if (c) { P++; console.log('  ✓ ' + m); } else { F++; console.log('  ✗ FAIL: ' + m); } }
function readWeb(p) { return fs.readFileSync(path.join(WEB, p), 'utf8'); }
function readRoot(p) { return fs.readFileSync(path.join(REPO, p), 'utf8'); }
console.log('smoke-guoshi-source-ipc');

console.log('— main-impl · read-web-file handler —');
var main = readRoot('main-impl.js');
var hi = main.indexOf("ipcMain.handle('read-web-file'");
ok(hi >= 0, "注册 ipcMain.handle('read-web-file')");
var handler = hi >= 0 ? main.slice(hi, hi + 2600) : '';
ok(handler.indexOf(".replace(/\\\\/g, '/')") >= 0 && handler.indexOf("'..'") >= 0, '路径净化（反斜杠归一 + 剥 .. 段·防穿越）');
ok(main.indexOf("['.js', '.json', '.html', '.css', '.md', '.txt']") >= 0 && handler.indexOf('READ_WEB_FILE_EXTS') >= 0, '扩展名白名单 .js/.json/.html/.css/.md/.txt');
ok(main.indexOf('READ_WEB_FILE_MAX_BYTES = 8 * 1024 * 1024') >= 0 && handler.indexOf('READ_WEB_FILE_MAX_BYTES') >= 0, '8MB 大小上限');
ok(handler.indexOf('getActiveWebRoot()') >= 0, '以热更感知的 getActiveWebRoot() 为根');
ok(handler.indexOf('isInsideDir(') >= 0, 'isInsideDir 越界复核');
ok(handler.indexOf('success: false, error:') >= 0, '失败返回 { success:false, error } 结果对象（对齐仓里 handler 习惯）');

console.log('— preload-impl · readWebFile —');
var pre = readRoot('preload-impl.js');
ok(/readWebFile:\s*\(relPath\)\s*=>/.test(pre), 'window.tianming 暴露 readWebFile(relPath)');
ok(pre.indexOf("ipcRenderer.invoke('read-web-file', relPath)") >= 0, "走 invoke('read-web-file')");

console.log('— 四工具 · readWebFile 双通道 —');
var agent = readWeb('editor-authoring-agent.js');
ok(agent.indexOf("window.tianming && typeof window.tianming.readWebFile === 'function'") >= 0, '桌面 IPC 桥判定（readWebFile 存在性检查）在');
ok(agent.indexOf('function _srcFetchLike(') >= 0, '_srcFetchLike 伪 Response 双通道派发器在');
['_readSourceTool', '_listSourceTool', '_grepSourceTool', '_genReferenceTool'].forEach(function (fn) {
  var i = agent.indexOf('function ' + fn + '(');
  ok(i >= 0, fn + ' 在');
  var body = i >= 0 ? agent.slice(i, i + 4200) : '';
  ok(body.indexOf('_srcFetchLike(') >= 0, fn + ' 走 _srcFetchLike 双通道（桌面 IPC / 浏览器 fetch 自动择优）');
});

console.log('— fetch 路径全部相对化 —');
ok(agent.indexOf("fetch('/source-manifest.json')") < 0 && agent.indexOf('fetch("/source-manifest.json")') < 0, "不再剩 fetch('/source-manifest.json')");
ok(agent.indexOf("fetch('/editor-fullgen.js')") < 0 && agent.indexOf('fetch("/editor-fullgen.js")') < 0, "不再剩 fetch('/editor-fullgen.js')");
ok(agent.indexOf("fetch('/' +") < 0 && agent.indexOf("fetch('/'+") < 0 && agent.indexOf('fetch("/" +') < 0, "不再剩 fetch('/' + …) 根绝对拼接");
ok(agent.indexOf("_srcFetchLike('source-manifest.json')") >= 0 && agent.indexOf("_srcFetchLike('editor-fullgen.js')") >= 0, '清单与生成范式均改走相对路径');

console.log('\nsmoke-guoshi-source-ipc ' + (F === 0 ? 'PASS' : 'FAIL') + ' ' + P + '/' + (P + F));
process.exit(F === 0 ? 0 : 1);
