# 屎山清理·第一轮（2026-10-14）

同志令：「看看天命的史山代码情况，清理、优化一下」。本轮先摸底，再只动「能被门禁和 smoke 验证」的两刀；
其余列成账，等拍板。工作区 `E:/tianming-shishan-20261014`，分支 `claude/shishan-cleanup-20261014`，基于 origin/main `bddd3c51`；10-14 夜变基到主干最新 `d41e534a`（提交号以变基后为准）。

## 一、摸底（bddd3c51）

| 项 | 数字 | 说明 |
| --- | --- | --- |
| web/ 顶层 JS | 606 个 · 41.5 万行 | 5 座超 3000 行（endturn-apply 5081 / endturn-ai 5025 / editor-authoring-agent 4508 / endturn-prompt 4214 / endturn-followup 3620），已在 file-size 棘轮里 |
| index.html 同步挂载 | 479 个 `<script>` · 20.3MB · 470 个无 defer | 启动分期清单 startup-script-phases.json 只把 9 个标为 deferred |
| styles.css | 649KB · 5176 条规则 | 按「类名/ID 在运行时文本零出现」估 240 条死规则（27.7KB，4%）；其中 `.ote-rank-N`、`.severity-N`、`.dir-out`、`.z-sup` 一类多半是动态拼类名，**不能机械删** |
| 函数级死码 | 1.58 万个声明里零引用 45 个 | 其中 14 个被 smoke/工具按名抽取（见下），真死 31 个 |
| 文件级孤儿 | 0 | tm-editor-fit.js / tm-workbench-*.js / tm-start-preparation-runtime.js 看似孤儿，实由 preview 页或原生开局清单挂载 |
| 全局同名覆盖 | 89 条在 `intentional-global-overrides.json` 白名单 | 多数是拆分家族的别名链；真重复的工具函数只有 `_getDaysPerTurn`（tm-utils→tm-edict-lifecycle）、`escHtml`（tm-utils→tm-chaoyi-changchao）、`robustParseJSON`（tm-utils→tm-ai-infra-json） |
| 根目录 docs/ | 140 个目录 · 164MB | 全是 Codex 任务证据；最大 `late-tang-person-20260917/` 65MB（一个 62.8MB 的 JSON 快照） |
| web/preview/ | 98 件 | 活的：剧本工坊重置预览一套 + 92MB `official-scenarios-bundle.js`；死的：45 件备份副本/坏编码副本/codemod |
| 88MB 双胞胎 | `web/tm-official-scenario-bundle.js` 与 `web/preview/official-scenarios-bundle.js` | 都由 sync-official-scenarios.js 派生、内容只差壳，两份都进仓 |
| release-hot/ | 79 件 1.2.x～1.3.4 推送脚本 | heal.py 7.6MB、graphql.json 3.1MB；OTA 已停用 |
| web/source-manifest.json | 2026-06-04 生成 · 974 条 | 剧本工坊 AI 代理 `listSource` 的源文件索引，四个月没更新 |
| console.log | web/*.js 里 311 处 | 未动 |

## 二、本轮做了什么

### 第一刀 `dd63e1b5`（变基前 68c6ed22）：删 31 个零引用函数（445 行，15 个文件）
口径：任意缩进的 `function` 声明与函数表达式赋值，标识符在全部运行时文本 + web/scripts + scripts 里整词只出现一次。
按原始字节切行删除，混排的 CRLF/LF 不动。清单在提交信息里。

**保留的 14 个「测试钉住的死码」**（生产零调用，但 smoke 用 `functionSource()` 按名抽取后单测）：
`_buildSc{1d,15,15n,16,17,18,2,25,25c,27,28}JsonSchema`（tm-endturn-ai.js，被 smoke-final-completion.js 与工具 derive-sc-schema-from-prompt.js 用）、
`_seedRecordFromP1ForApplyFailure`（lib-player-error-regression.js）、`_fireCommitCanon`（smoke-sc1q-sc19-upgrade.js）、`rightIssueRows`（smoke-right-panel-lag-guards.js）。
要删它们得先改这些 smoke 的契约，属于另一刀。

### 第二刀 `cf1d38a4`（变基前 b93b69ac）：删 127 个一次性垃圾文件（19.9MB）
- web/ 根 4 件废 JSON/脚本/报告；web/preview/ 45 件备份与 codemod；release-hot/ 78 件旧推送脚本（只留 `.env.local.example`）。
- 随动：package.json / release-excludes.json / verify-release-contract.js 去掉已无对象的排除项；PROJECT-STRUCTURE.md 改 release-hot 口径；
  `.hot-update-manifest.json` 删 16 条条目并对齐哈希；`source-manifest.json` 删 37 条已删路径。

### 第三刀 `0cb4fd94`：本目录两份记录
README 与 final-smokes.txt。

### 第四刀：变基后补齐派生清单
主干 26ec4c81～d41e534a 那几笔改了 13 个文件的字节却没重生成派生清单，`sync-hot-baseline --check` 报 13 项 stale、
`build-startup-phase-manifest --check` 也 stale，GitHub guards 工作流的「Cross-release contract」在 d41e534a 上因此红。
这一刀按脚本顺序重生成：lint-global-providers 报告 → startup-script-phases.json → tm-start-runtime-manifest.json → 重打 .hot-update-manifest.json。
（顺序错了会像我第一次那样：用旧的 providers 报告生成分期清单，少 5 个新函数，smoke-startup-phase-observability 立刻抓出来。）

### 门禁
lint-arch-all 15/15 绿；verify-release-contract 176 项绿；sync-hot-baseline --check 绿；verify-hot-builder-gates 27 项绿；
build-native-preparation-manifest --check 绿；定向 smoke 177 + 13 + 41 全过；全量 ci-smokes 结果见本目录 `final-smokes.txt`。
变基到 d41e534a 后：lint-arch-all 15/15、hot-builder-gates 27、四项 --check、release contract 176 再次全绿；定向 smoke 190/190（含主干新加的税诏/过回合用例）。
Electron 七组未在本机跑（改动不含界面）。

## 三、没动的，和为什么

1. **`_getDaysPerTurn` 双定义**：tm-edict-lifecycle.js 那份带 `TM_RETENTION_GUARD: edict-days-per-turn-compatible-redefinition`，
   smoke-non-dead-retention-guards.js 钉着「两份都在」；另有 3 个 smoke 单独装载 tm-edict-lifecycle.js 不带 tm-utils。
   要集中化：tm-utils 版改成 Number() 口径的超集 → 删 edict 版 → 改 4 个 smoke → 白名单减一条。
2. **`escHtml` 双定义**：tm-chaoyi-changchao.js 的一行版在 index.html 里后装，**覆盖**了 tm-utils 版（差别：`escHtml(0)` 前者返回 ''，后者 '0'）。
   但 preview/changchao-preview.html 等两页只装 changchao 不装 utils，12 个 smoke 也单独装它，删了会炸。先让这些页/测试装 tm-utils，再删。
3. **`robustParseJSON` 双定义**：tm-ai-infra-json 版（带 OOM 护栏，#40 审计加的）在 index.html 覆盖 tm-utils 版；editor.html 只有 tm-utils 版。两边语义不同，要合并得先定哪份是正典。
4. **240 条死 CSS**：动态拼类名的误报率不低，要人工逐条看；收益只有 27KB。
5. **docs/ 164MB**：是 Codex 的证据目录，删不删是同志定；建议把 10MB 以上的快照 JSON 挪出仓（git 历史里有）。
6. **24 个 preview-*.html 设计稿**：发版已按 `previewMockup` 排除，不进包；前端重做期间留着当参考。
7. **88MB 双胞胎剧本包**：要省得改 sync-official-scenarios.js 和两处 parity 守卫，让 preview 复用主包。
8. **index.html 479 个同步脚本**：真正的启动优化点（分期懒加载 / 合包），但要配 startup-script-phases 审计与 Electron 七组，另开专项。

## 四、教训
- 扫描死码时，去注释的正则遇到字符串里的 `image/*` 会把半个文件吞掉，产出 70 个假死函数——**最终以「全文整词计数 ≤1」为准，不去注释**。
- 「被 smoke 引用」要用 `grep -rlw` 全目录核，别信自己脚本里的一次性判断（第一次漏了 14 个，smoke 抓回来 1 个）。
- `E:/tianming-main-port-20261014` 同时有别的会话在改，开工前 `git status` 干净不代表开工后还干净——动刀一律另开工作区。
