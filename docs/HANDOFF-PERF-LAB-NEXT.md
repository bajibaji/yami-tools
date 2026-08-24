# 性能分析台（perf-lab）交接文档

> 交给下一位继续开发/维护的人。
> 仓库：`D:\Documents\GitHub\yami-tools`
> 工具目录：`tools/perf-lab/`（纯静态 Web 工具，无构建、无框架）
> 当前最新提交：`efab04b 册那怎么修不好`
> 交接时工作区还有 **4 个未提交文件**（见 §9，务必先看）。

## 0. 这个工具是干什么的

「性能分析台（Electron 性能分析台）」是 yami-tools 工具合集里的一个纯离线分析工具，**不运行游戏、不读写游戏工程**，只分析真实 Electron 游戏在游玩时采集的离线报告，回答：

- 主线程是不是太忙？（CPU / GC / 长任务）
- WebGL / 渲染有没有瓶颈？（Draw Call / GL 命令 / 纹理内存）
- **游玩时哪些地方把帧顶超 16.7ms、帧数到不了 60fps？**（真机逐帧探针）

采集源有三种：

| 数据 | 采集方式 | 导入格式 |
| --- | --- | --- |
| CPU/GC/长帧 | Electron 内置 Chromium DevTools Performance | trace JSON |
| WebGL | 上游 Spector.js 扩展（MIT） | capture JSON |
| 逐帧计算/超帧元凶 | 工具页生成的「真机探针」控制台脚本 | probe JSON |

历史：v0.1/0.2 曾做过“浏览器沙箱 + Service Worker + iframe 运行游戏 + 角色克隆压测”，后来被用户明确否决，全部删除。现在不要往回做沙箱方案。

## 1. 当前功能

1. 三种报告导入（拖拽或文件选择），自动识别格式；
2. 四个视图：
   - 总览：采集时长、帧间隔 P95、长任务、GC、探针计算 P95/平均/最大/超预算帧、WebGL 指标；
   - CPU 与长帧：V8 Profile 热点、主线程长任务（≥50ms）；
   - WebGL：上下文、命令统计、冗余状态/帧内存；
   - **超帧定位**：探针数据的“采集期间耗时排行”（更新器/渲染器/事件总耗时）+ 超帧元凶 + 最差帧 Top60；
3. 基线：保存当前摘要到 localStorage，后续报告自动显示 Δ（红/绿）；
4. 真机探针：生成可复制的控制台脚本，提供 `check() / copy() / download()`；
5. 使用说明弹窗：顶部「使用说明？」，包含三条采集路线、完整命令、重点加粗等格式化内容；
6. 导出完整分析 JSON。

## 2. 技术架构

纯静态网页，浏览器本地解析，不上传。

```
index.html        UI + 使用说明弹窗 DOM
styles.css        样式（含弹窗、表格、代码块）
analyzer-core.js  纯函数解析：trace / spector / probe 三类 JSON
app.js            导入、渲染、基线、探针脚本模板 PROBE_SCRIPT、弹窗交互
self-check.js     Node 最小回归（可直接 node 运行）
README.md         面向使用者的文档
```

`analyzer-core.js` 是 Node/浏览器共用纯函数（UMD 风格），`self-check.js` 直接 `require('./analyzer-core.js')` 测试。

缓存版本约定：改 `index.html` 里的 `?v=20260822-perf-analysis-N` 必须同步升 N（目前 N=9），否则 GitHub Pages/浏览器会用旧资源。

## 3. 三种数据格式简述

### 3.1 DevTools trace
- 入口：`analyzeTrace(raw)`；支持数组或 `{traceEvents: [...]}`。
- 主线程：优先按 `thread_name` 元数据识别 `CrRendererMain/RendererMain`，否则按 RunTask 耗时选线程。
- 帧间隔：`BeginFrame/DrawFrame/FireAnimationFrame` 时间戳差。
- CPU 热点：合并 `ProfileChunk` 的 `cpuProfile.nodes/samples/timeDeltas`。

### 3.2 Spector.js capture
- 入口：`analyzeSpector(raw)`。
- 命令统计按 `commands[].name/startTime/endTime`；Draw Call 优先 `CommandsSummary.draw`，缺失按 `draw*` 计数。
- 冗余命令递归统计 `redundantCommandIds`；帧内存为 `frameMemory` 求和。

### 3.3 Yami 真机探针 JSON（最重要）
字段大致如下：

```json
{
  "kind": "yami-probe",
  "version": 1,
  "budgetMs": 16.7,
  "startedAt": "2026-08-24T06:21:06.194Z",
  "durationMs": 10.5,
  "samples": 600,
  "compute": { "avg": 8.0, "p95": 15.6, "p99": 20.0, "max": 67.1, "overBudgetCount": 193 },
  "frame": { "avg": 16.7, "p95": 20.0, "max": 30.0 },
  "updaters": [ { "name": "SceneManager", "avg": 5.0, "max": 12.0, "count": 600, "total": 3000.0 } ],
  "renderers": [],
  "events": [ { "name": "common :: 刷怪.event", "avg": 4.0, "max": 15.0, "count": 600, "total": 2400.0 } ],
  "overBudgetFrames": [
    { "frame": 10, "compute": 21.0, "update": 12.0, "render": 9.0,
      "updaters": [{ "name": "SceneManager", "ms": 8.0 }],
      "renderers": [],
      "events": [{ "name": "common :: 刷怪.event", "ms": 6.0 }] }
  ],
  "hooked": { "game": true, "updaters": 11, "renderers": 6, "events": 12 },
  "scene": { "actors": "4/20", "uiElements": 75, "textures": 47 }
}
```

## 4. 真机探针脚本（核心）

`PROBE_SCRIPT` 是一个大字符串，位于 `app.js` 顶部。用户在性能分析台点「复制探针脚本」拿到它，然后粘贴到 **Electron 游戏窗口的 DevTools Console** 运行。

脚本做的事：
- 包装 `Game.update` 和 `Game.deferredRendering()`，得到每帧计算耗时；
- 包装 `Game.updaters` / `Game.renderers` / `EventManager.activeEvents` 里的每个对象，统计总耗时和当前帧耗时；
- 独立 `requestAnimationFrame` 结算每帧；`compute > 16.7` 时记录该帧 Top5 更新器/渲染器/事件；
- 每隔 1 秒 `refresh()` 补包新出现的模块/事件（因为 `Game.updaters` 在异步初始化时会整体重建）；
- API：
  - `window.__YAMI_PERF_PROBE__.check()` → `{ game, updaters, renderers, events, samples }`
  - `window.__YAMI_PERF_PROBE__.copy()` → 停止并复制 JSON 到剪贴板
  - `window.__YAMI_PERF_PROBE__.download()` → 停止并下载 `yami-probe-<timestamp>.json`
- 如果 `hooked.game=false` 或 `samples=0`，`copy/download` 会打 console.warn，不产出有效数据。

### 关键坑（接手必须知道）

1. **Yami 运行时是脚本顶层 `let` 单例，不是 window 属性**：`Game/Data/Time/Scene/UI/GL/EventManager` 都不能用 `window.Game` 访问。探针必须用裸标识符 `typeof Game !== 'undefined'` 判断。父页面（性能分析台）不能直接访问 iframe/游戏窗口里的这些单例。
2. **探针必须在游戏自己的 DevTools Console 跑**，不能在性能分析台页面或浏览器其他页面跑。判断方法：`typeof Game` 应为 `"object"`。
3. **`Game.updaters` 在 Game.initialize 异步过程中会被整体重新赋值**：探针脚本加载时可能只包到空列表，所以有 `setInterval(refresh, 1000)` 补包。
4. **事件名取不到时的回退链**：`event.type || event.initial?.type || 'event'` + `event.path || event.initial?.path`；再不行用 `parent.constructor.name`，最后 `unknown`。如果用户仍看到 `unknown :: unknown`，需要拿真实 EventHandler 实例进一步看 `initial` 结构。
5. **不要再用 `Math.min/max(...大数组)`**：156MB trace 会栈溢出。已全部改成 reduce/循环；后续新增代码不要写 spread 到 Math。
6. **scene 统计必须全程空值保护**：`Scene.actor` 存在但 `Scene.actor.list` 可能未初始化，直接 `.list.length` 会崩。
7. **使用说明弹窗 DOM 必须放在 `<script>` 之前**：`app.js` 初始化时会 `$('help-modal')`，放后面会拿不到。
8. **探针脚本是“文本复制进控制台”的**：改完探针后，用户必须重新点「复制探针脚本」并用新版脚本重新采集，旧的控制台脚本不会自动更新。
9. **缓存版本号**：改 `analyzer-core.js/app.js/styles.css/index.html` 后，`index.html` 里三个 `?v=20260822-perf-analysis-N` 必须升 N。

## 5. 验证方法

```powershell
cd D:\Documents\GitHub\yami-tools

# 语法
node --check tools/perf-lab/app.js
node --check tools/perf-lab/analyzer-core.js
node --check tools/perf-lab/self-check.js

# 解析核心回归
node tools/perf-lab/self-check.js

# 浏览器冒烟（需要 .e2e-tmp 里的 playwright-core；.e2e-tmp 已被 gitignore）
cd .e2e-tmp
node test-perf-analysis.js
node test-probe-script.js
node test-large-trace.js
```

- `test-perf-analysis.js`：导入模拟 trace + Spector + probe，验证四个视图/导出/使用说明弹窗。
- `test-probe-script.js`：把 `PROBE_SCRIPT` 提取到模拟运行环境跑 30 帧，验证 `check/copy/stop` 与 analyzer 联动。
- `test-large-trace.js`：12 万事件大 trace，防止 `Math.min/max` 栈溢出回归。
- 真实游戏工程只读冒烟：用 `D:\new-game`（只读，禁止修改）手工/脚本验证。
- 本地预览：仓库根 `python -m http.server 4173`，打开 `http://127.0.0.1:4173/tools/perf-lab/`。

## 6. 已知未解/用户反馈

- 用户实际导入探针后曾出现：
  - `hooked.game=false`、`samples=0` → 跑错页面/没游玩；
  - `durationMs` 为负数 → 已修复（用 `Date.now()` 差值）；
  - `scene` 统计崩溃 → 已修复（空值保护）；
  - 事件名 `unknown :: unknown`、累计 0ms → 已修事件名回退链 + 3 位小数 + 分析器过滤 `<0.05ms`，**但还没有用户用新版真实采集验证结论是否足够可读**。
- 目前没有真实用户完整探针 JSON 的反馈样本，建议下一步拿到一份实际数据后，再优化「超帧定位」的展示，特别是：
  - 如果超帧里没有任何单点超过预算，说明是多个小模块叠加，需要展示“超帧帧里 Top 组合”或总更新/渲染拆分；
  - 事件名如果仍然 unknown，需要深入 `EventManager.activeEvents` 里的 `initial` 结构。

### 2026-08-24 真实报告复盘

用户提供了桌面真实报告：

- `D:\Desktop\谷歌浏览器性能导出Profile-20260824T141000.json`（156MB）
- `D:\Desktop\yami-probe-1787552546190.json`

发现并修复：

- trace 时长被 `ts=0` 元数据拉成 27 小时；现按 Renderer 主线程有效事件边界计算，实际约 60.9 秒；
- CPU Profile 跨进程按 node id 合并，导致 Renderer 与 Browser profile 串数据；现按 `pid/tid/profileId` 分桶并选择 Renderer profile；
- `FireAnimationFrame` 多 rAF 回调不能直接等同显示帧；探针存在时优先使用探针帧数据；
- DevTools 唯一 63ms 长任务来自 `CpuProfiler::StartProfiling`，现识别为工具开销并排除；
- trace 同时运行旧探针，`tick/hookGame` 污染 CPU Profile 622.8ms；现明确提示两类采集必须分开复现；
- 旧探针模块全叫 anonymous、帧内 Map 闭包失效、update/render 共用包装标记，造成 139.8ms 更新尖峰却无帧内证据；v2 已修；
- 旧报告只能高置信确认：持续更新阶段卡顿（最长连续 315 个超预算样本），渲染和 GC 不是主因；归因覆盖率为 0%，不得点名 `event :: unknown`。

## 7. 建议的下一步

1. 拿到用户真实探针 JSON，核对事件名/模块名是否可读；
2. 增强超帧归因：不仅按单项耗时，还按“某类型在超帧帧里出现频次”排序；如果单项都 <16.7ms，给出“多段小任务叠加”的结论；
3. 增加“逐帧时间线”简单可视化（比如计算耗时曲线 + 超预算标红）——对定位卡顿时刻很有用；
4. 可选：把探针脚本做成游戏侧“可加载插件”由用户决定（现在保持纯控制台脚本，不动工程）；
5. 优化大 trace 导入性能（156MB 目前能解析但偏慢，可考虑 Web Worker 异步解析 + 进度条）；
6. 增加 trace 与探针的时间轴对齐/合并（目前只是摘要合并）。

## 8. 权限与红线

- 不要未经用户同意修改 `D:\new-game`（真实游戏工程）；
- 不要自动提交/推送/部署，用户说“发”才提交；
- 不要恢复被删除的浏览器沙箱/Service Worker/iframe 运行器方案；
- 所有回复中文。

## 9. 当前未提交改动（交接时务必保留/提交）

截至本文档写作时，工作区有 4 个未提交文件：

- `tools/perf-lab/README.md`
- `tools/perf-lab/analyzer-core.js`
- `tools/perf-lab/app.js`
- `tools/perf-lab/index.html`

未提交内容主要是：
- 事件名回退链改进（`event.initial`、parent 回退）；
- 超帧 Top 耗时改 3 位小数（避免 0ms 噪声）；
- analyzer 只显示累计 ≥0.05ms 的元凶；
- 超帧定位页新增「采集期间耗时排行」表；
- README/使用说明同步更新；
- 缓存版本升到 `20260822-perf-analysis-9`。

建议接手后先把这 4 个文件审一遍并提交，再继续下一步。
