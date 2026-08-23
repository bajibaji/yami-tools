# Electron 性能分析台

本工具只做离线分析。游戏必须在真实 Electron 环境中正常游玩，采集由现成工具 + 可选的真机逐帧探针完成：

| 范围 | 采集工具 | 导入文件 |
| --- | --- | --- |
| CPU、GC、主线程、长帧 | Electron 自带 Chromium DevTools Performance | trace JSON |
| WebGL 命令、Draw Call、纹理/缓冲内存 | [BabylonJS/Spector.js](https://github.com/BabylonJS/Spector.js) 原版扩展 | capture JSON |
| 逐帧计算压力、超预算帧元凶（更新器/渲染器/事件） | 工具页自带的「真机探针」控制台脚本 | 探针 JSON |

浏览器快速回归、Service Worker 虚拟工程和 iframe 运行器已经移除。

## 采集 CPU / GC / 长帧

1. 在 Open Yami 的游戏试玩窗口或打包后的 Electron 游戏中打开 DevTools。
2. 进入 **Performance** 面板，点击录制。
3. 正常游玩并复现卡顿；建议一次录制 15～60 秒，只覆盖一个明确问题。
4. 停止录制，使用 Performance 面板的保存功能导出 trace JSON。
5. 回到性能分析台，将 JSON 拖入“DevTools Performance”。

分析台会读取主线程任务、帧标记、V8 CPU Profile 和 GC 事件。不同 Electron/Chromium 版本的 trace 字段可能略有差异；缺少 CPU Profile 时页面会明确提示。

## 采集 WebGL

Spector.js 是成熟的通用 WebGL 调试扩展，MIT 许可证。本项目直接使用上游扩展，不修改其采集逻辑。

上游安装方式：

1. 获取 [Spector.js 仓库](https://github.com/BabylonJS/Spector.js)。
2. 使用仓库中的 `extensions/` 目录作为未打包扩展。
3. Open Yami 编辑器启动时会从安装目录的 `extension/` 加载扩展；试玩窗口与编辑器共用 Electron session。
4. 打包后的独立 Electron 游戏必须由其主进程调用 `session.defaultSession.loadExtension(<Spector extensions 目录>)`，或使用该游戏已经支持的扩展加载方式。
5. 正常游玩到目标画面，使用 Spector.js 捕获目标帧并保存 capture JSON。
6. 将 JSON 拖入分析台的“Spector.js”区域。

Spector.js 单次捕获最多 10000 条 GL 命令。达到上限时分析台会提示报告可能被截断。

## 真机逐帧探针（推荐：定位“哪段代码把帧顶超 16.7ms”）

这是回答“游玩时哪些地方性能开销过大、帧数到不了 60fps”的核心功能：

1. 在分析台侧栏点「复制探针脚本」；
2. 在 Electron 游戏 DevTools **控制台**粘贴并回车（不修改工程、不写文件）；
3. 正常游玩目标片段（卡顿场景）；
4. 在控制台执行：
   ```js
   window.__YAMI_PERF_PROBE__.copy()
   ```
   （`copy()` 会把 JSON 复制到剪贴板；复制失败时会直接打印 JSON）
5. 把复制的 JSON 保存成 `.json` 文件，拖回分析台的「Yami 真机探针」区域。

探针会记录：

- 每帧计算耗时 = `Game.update()` + `Game.deferredRendering()`；
- 各更新器 / 渲染器 / 事件处理器的耗时（事件显示为「事件类型 :: 事件文件名」）；
- 对**超过 16.7ms 的帧**，记录该帧 Top 5 最耗时更新器/渲染器/事件；
- 分析台「超帧定位」页会汇总：哪个模块/事件**最常导致超帧**、累计多少毫秒，并列出最差帧 Top 60。

## 分析结果

- **总览**：采集时长、帧间隔 P95、最长任务、长任务数量、GC、Draw Call、GL 命令、帧资源内存，以及探针的计算 P95/平均/最大/超预算帧数。
- **CPU 与长帧**：V8 Profile 热点与超过 50ms 的主线程任务。
- **WebGL**：Renderer/Vendor/WebGL 版本、命令次数与捕获耗时。
- **超帧定位**：探针数据下的超帧元凶（更新器/渲染器/事件）与最差帧列表。
- **诊断结论**：帧预算超限、GC 占用、冗余 GL 状态、Draw Call 偏高和捕获截断。
- **基线**：保存在当前浏览器 `localStorage`，只比较摘要指标。

## 验证

```powershell
node --check tools/perf-lab/app.js
node --check tools/perf-lab/analyzer-core.js
node tools/perf-lab/self-check.js
```

`self-check.js` 覆盖 DevTools trace、Spector capture 和 Yami 真机探针三种格式。Spector 解析还使用上游仓库的 `test/integration/fixtures/captured-frame.json` 做过真实格式验证。

## 版本

- v0.4.0（2026-08-22）：新增 Yami 真机逐帧探针与「超帧定位」页。
- v0.3.0（2026-08-22）：移除浏览器快速回归，改为 Electron DevTools + Spector.js 真机报告分析台。
