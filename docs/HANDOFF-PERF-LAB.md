# Electron 性能分析台 Handoff

> 当前版本：v0.3.0
> 最后整理：2026-08-22

## 产品定位

性能页只分析真实 Electron 游戏在正常游玩中采集的报告。浏览器沙箱、iframe、Service Worker、角色克隆压测和自研运行时探针已全部移除。

采集工具只使用成熟现成方案：

- Electron 自带 Chromium DevTools Performance：CPU、V8 Profile、GC、主线程和帧事件；
- [BabylonJS/Spector.js](https://github.com/BabylonJS/Spector.js)：WebGL capture，MIT 许可证，上游仓库提供完整 Manifest V3 `extensions/` 目录。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 双报告导入、总览/CPU/WebGL 三个分析视图 |
| `app.js` | 文件导入、渲染、基线和分析结果导出 |
| `analyzer-core.js` | 两类 JSON 的纯函数解析核心，浏览器和 Node 共用 |
| `self-check.js` | 最小 trace/capture 回归 |
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

## 已验证

- `node --check`：`app.js`、`analyzer-core.js`、`self-check.js`；
- `node tools/perf-lab/self-check.js`；
- Spector.js 上游真实 fixture：`test/integration/fixtures/captured-frame.json`，成功解析命令、Draw Call、冗余状态、上下文与时序。

## 已知边界

- DevTools trace 格式由 Chromium 版本决定，分析器采用宽松字段识别；
- 只有 Performance Monitor 截图无法导入，必须保存 trace JSON；
- Spector.js 只负责 WebGL，不分析 Node 文件 I/O 或业务事件语义；
- 打包游戏必须允许加载 Spector.js 上游扩展；网页本身不会也不能替游戏安装扩展；
- CPU trace 与 Spector capture 不一定来自同一时间轴，当前只合并摘要，不做跨报告时间对齐。
