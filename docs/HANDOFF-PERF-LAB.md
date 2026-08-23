# Electron 性能分析台 Handoff

> 当前版本：v0.4.0
> 最后整理：2026-08-22

## 产品定位

性能页只分析真实 Electron 游戏在正常游玩中采集的报告。浏览器沙箱、iframe、Service Worker、角色克隆压测和自研沙箱运行时探针已全部移除。

采集工具：

- Electron 自带 Chromium DevTools Performance：CPU、V8 Profile、GC、主线程和帧事件；
- [BabylonJS/Spector.js](https://github.com/BabylonJS/Spector.js)：WebGL capture，MIT 许可证，上游仓库提供完整 Manifest V3 `extensions/` 目录；
- **Yami 真机逐帧探针**：工具页生成一段控制台脚本，不改工程、不写文件，记录每帧计算耗时和超帧元凶。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | trace/Spector/探针 三种报告导入、总览/CPU/WebGL/超帧定位四个视图 |
| `app.js` | 文件导入、渲染、基线、探针脚本生成/复制、分析结果导出 |
| `analyzer-core.js` | trace/Spector/探针 三类 JSON 的纯函数解析核心，浏览器和 Node 共用 |
| `self-check.js` | 三类格式最小回归 |
| `styles.css` | 工作台布局 |

已删除：`perf-core.js`、`sw.js`。

## DevTools Trace 口径

- 主线程：优先识别 `CrRendererMain`/`RendererMain` 元数据；否则按 `RunTask` 等事件总耗时选线程；
- 长任务：主线程 `RunTask`/`ThreadControllerImpl::RunTask`/`Program`，持续时间 `>=50ms`；
- 帧间隔：`BeginFrame`、`DrawFrame`、`FireAnimationFrame` 时间戳差；
- GC：名称匹配 MajorGC/MinorGC/GC/GarbageCollect 的完整事件；
- CPU 热点：合并 `ProfileChunk` 的 nodes、samples 和 timeDeltas；
- 帧预算诊断：帧间隔 P95 `>16.7ms`。

## Spector Capture 口径

- 命令次数和捕获耗时按 `commands[].name/startTime/endTime` 汇总；
- Draw Call 优先使用 `CommandsSummary.draw`，缺失时按 `draw*` 命令统计；
- 帧资源内存为 `frameMemory` 数值求和；
- 冗余命令递归统计各状态对象的 `redundantCommandIds`；
- WebGL 上下文读取 `context.capabilities` 与 `canvas`；
- 命令数达到 10000 时提示 Spector 捕获可能被截断。

## Yami 真机探针口径（v0.4.0）

- 探针脚本由 `app.js` 的 `PROBE_SCRIPT` 模板生成，用户复制到 Electron DevTools 控制台运行；
- 包装 `Game.update` / `Game.deferredRendering`，计算耗时 = update + render；
- 包装 `Game.updaters` / `Game.renderers` / `EventManager.activeEvents` 每个处理器，分别累计总耗时与当前帧耗时；
- 独立 rAF 结算帧样本；`compute > 16.7ms` 时记录该帧 Top 5 更新器/渲染器/事件；
- `window.__YAMI_PERF_PROBE__.copy()` 停止并 `copy(JSON)`，失败时 `console.log`；
- 探针 JSON 由 `analyzer-core.analyzeProbe()` 解析：
  - `metrics`：计算 P95/平均/最大、帧间隔 P95、超预算帧数；
  - `causes`：按“出现在超帧帧中的次数/累计 ms”聚合更新器/渲染器/事件；
  - `worstFrames`：超帧按 compute 降序 Top 60；
- 分析台「超帧定位」页展示元凶与最差帧表。

## 已验证

- `node --check`：`app.js`、`analyzer-core.js`、`self-check.js`；
- `node tools/perf-lab/self-check.js`；
- `.e2e-tmp/test-perf-analysis.js` 浏览器冒烟：trace + Spector + 探针三种导入、总览/CPU/WebGL/超帧定位渲染、导出，零 pageerror；
- `.e2e-tmp/test-probe-script.js`：把 `PROBE_SCRIPT` 放入模拟运行环境（假 Game/EventManager/rAF）跑 30 帧，`copy()` 产出 JSON，再由 analyzer 解析成功。

## 已知边界

- DevTools trace 格式由 Chromium 版本决定，分析器采用宽松字段识别；
- 只有 Performance Monitor 截图无法导入，必须保存 trace JSON；
- Spector.js 只负责 WebGL，不分析 Node 文件 I/O 或业务事件语义；
- 打包游戏必须允许加载 Spector.js 上游扩展；网页本身不会也不能替游戏安装扩展；
- CPU trace 与 Spector capture 不一定来自同一时间轴，当前只合并摘要，不做跨报告时间对齐；
- 探针只统计主线程 JS 计算（update+render），不包含 GPU 真实耗时；WebGL 侧仍需 Spector 数据补全；
- 探针脚本依赖游戏运行时顶层 `let` 单例（Game/EventManager/Scene 等），只能在同页面全局作用域运行，不能从扩展/其他页面注入。
