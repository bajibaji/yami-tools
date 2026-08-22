# 性能测试台（perf-lab）Handoff

> 最后整理：2026-08-21
> 代码仓库：`D:\Documents\GitHub\yami-tools`
> 游戏工程：`D:\new-game`（只读测试对象，禁止直接修改）
> 本地开发：`http://127.0.0.1:4173/tools/perf-lab/`

## 1. 定位（用户需求原话）

「性能测试工具页，理论上应该根据游戏源代码去做测试……只要计算压力在每一帧 16.7ms 以内就行了。」

结论：不做静态估算，**直接真实运行工程源码**测每帧计算压力；判定主标准为 **P95 ≤ 16.7ms（默认帧预算）**。

## 2. 架构（为什么网页工具能跑真实游戏）

1. 工具页通过 File System Access API 持有工程目录句柄（fallback 模式为内存文件树）；
2. `sw.js`（Service Worker）拦截 `<scope>/run/**` 的 GET 请求 → 翻译为工程内相对路径 → MessageChannel 向工具页按需索要文件（一问一答，30s 超时，Blob 回包）→ 作为 Response 返回；
3. 游戏页 `./run/index.html` 的相对路径（`Dist/Script/*.js`、`Data/*.json`、`Assets/**`）天然落在虚拟目录下，无需改工程任何文件；
4. SW 服务 `index.html` 时注入 `perf-core.js`（`</body>` 前，游戏全部脚本之后执行）；
5. `perf-core.js` 只读包装 `Game.update` / `Game.deferredRendering` / `Game.loop` 与 `Game.updaters`/`Game.renderers` 里的每个模块；独立 rAF 在 Game.loop 之后的同一帧结算上一帧样本；
6. 工具页轮询 `iframe.contentWindow.__YAMI_PERF__.snapshot(budget)` 更新 UI，结束后取全量样本出报告。

关键点：
- 判定口径：`compute = Game.update 耗时 + Game.deferredRendering 耗时`（逻辑 + 渲染），**不要用帧间隔**（帧间隔含垂直同步等待，不等于计算压力）；
- `Game.defer` 是已 resolve 的 Promise，`deferredRendering` 在 Game.loop 回调后的微任务里执行，探针的 rAF 注册晚于 Game.loop，因此同一帧内先跑完渲染微任务、再结算样本——时序成立；
- 探针只读、幂等（`__yamiPerfWrapped__`/`__yamiPerfHooked__` 标记），不改变游戏行为；
- 游戏存档落在工具页同源 IndexedDB，与工程 `Save/` 完全隔离，零写回。

## 3. 核心文件

| 文件 | 职责 |
| --- | --- |
| `tools/perf-lab/index.html` | 工具页结构（设置/实时指标/报告按钮） |
| `tools/perf-lab/app.js` | 工程加载（复用 loot-smith-settings 联动）、扫描场景列表、SW 握手、测试生命周期、判定与导出 |
| `tools/perf-lab/sw.js` | 虚拟文件服务 + 探针注入 |
| `tools/perf-lab/perf-core.js` | 运行时探针 |
| `tools/perf-lab/styles.css` | 深色 UI |
| `tools/perf-lab/README.md` | 用户文档 |

缓存版本：`styles.css?v=20260821-perf-lab-1`、`app.js?v=20260821-perf-lab-1`、SW 注册 `./sw.js?v=20260821-perf-lab-1`（改线上资源必须同步升版本参数，防 GitHub Pages 缓存）。

当前缓存版本已升至 `20260822-perf-lab-8`，应用/探针版本为 v0.2.1。

## 4. 与已有约定的对齐

- 工程记忆：IndexedDB `loot-smith-settings` 的 `last-project-handle`，与其他工具共用；本工具仅请求 `read` 权限，不写文件；
- fallback 导入：`webkitdirectory` 相对路径去首段（`p.indexOf('/')` 规则，与 save-lab/localization-lab 相同）；
- 自动同步：根目录模式 FileSystemObserver → 500ms 防抖重扫；无 FSO 时 5s 轮询 `Data/manifest.json` 的 lastModified+size；测试进行中不打断（提示测试后手动重扫）；导入模式手动重扫；
- 纯只读：无任何写回路径（区别于其他工具，没有「保存」概念）。

## 5. 已做验证

- `node --check` 三个 JS 文件通过；
- `.e2e-tmp/test-perf.js`（自造夹具工程）通过：fallback 导入 → 扫描 → SW 虚拟服务 → iframe 运行 → 探针注入 → 采样 → PASS 判定（夹具每帧约 5ms）→ 模块 Top（FakeUpdater/FakeRenderer）→ JSON 报告下载 → 零 pageerror；
- `.e2e-tmp/verify-real-perf.js` 对真实工程 `D:\new-game` **只读**冒烟通过：
  - 启动流程：PASS，P95 0.2ms（headless 环境 rAF 不锁 60Hz，fps=180，数值不代表真机）；
  - 切场景「世界」：PASS，P95 0.6ms，场景统计 角色 0/4 · UI 75 · 纹理 47，更新器 Top 正确列出 SceneManager/UIManager/SceneCamera 等；
  - 已实测确认的坑见 §7。
- 手工验收清单见 §6。

## 6. 用户手工验收建议（真实工程）

1. 本地起 `python -m http.server 4173`，Chrome 打开工具页，选择 `D:\new-game`；
2. 默认「启动流程」测 30s：应看到 iframe 内游戏正常启动、实时 FPS/耗时刷新、结束出现 PASS/FAIL；
3. 选一个场景（如 世界/城镇100）再测：iframe 应切到该场景；
4. 检查更新器/渲染器 Top 是否与 `D:\new-game\Script\main.ts` 的 updaters/renderers 列表对得上（如 Scene/UI/EventManager）；
5. 导出 JSON/Markdown，确认可下载且内容完整；
6. 测试期间把页签切后台，确认数据明显异常时（节流）不会误判 PASS——这是已知限制，README 已声明。

## 7. 已知边界与下一步候选

- **关键坑 1（顶层 let）**：Yami 运行时 `Data/Game/Time/Scene/UI/GL` 是脚本顶层 `let` 单例，**不是 window 属性**（`window.Game === undefined`，裸标识符才可见）。父页面（工具页）不能直接 `iframe.contentWindow.Game` 访问——所有访问必须由 `perf-core.js`（与游戏同脚本作用域）代查，通过 `__YAMI_PERF__.isReady()/loadScene()/snapshot()` 暴露。探针内部也必须用裸标识符（`typeof Game !== 'undefined'`），不能走 window；
- **关键坑 2（updaters 重建）**：`Game.updaters/renderers` 在异步 `Game.initialize()` 里被整体重新赋值，探针在脚本加载时包到的是空列表——`tick()` 每 60 帧 + `start()` 时 `refreshWraps()` 幂等补包（`__yamiPerfWrapped__` 标记），勿删除；
- **工程自身浏览器兼容性噪声**：`D:\new-game` 的 Excel操作 系列插件脚本编译产物含 `require("fs")`，在纯浏览器沙箱会报 `ReferenceError: require is not defined`（Electron 里才有 require），这是工程插件脚本与网页版不兼容，不是工具错误；不阻断测量（实测 PASS 正常）。若用户介意，可建议其插件加运行环境守卫；工具不做静默；
- 「每一帧 ≤16.7ms」严格执行会有加载/GC 尖峰误报，故主标准 P95 + 超预算帧数复核；若用户要求更严可加「max ≤ 预算 × 1.5」副标准；
- 无法自动点击 iframe 内的游戏按钮（跨 iframe 同源可以直接 `contentWindow` 调 API，后续可加「调用 Title/事件」的脚本场景）；
- 无头浏览器/隐藏 iframe 会被节流，自动化 E2E 只验链路与判定逻辑，不做真实性能数值断言；
- SW 更新后旧版本残留：注册 URL 带 `?v=` 已处理；若用户切换分支或清缓存后异常，先 DevTools → Application → Service Workers → Unregister；
- 后续候选：真机模式（游戏内基准插件）、批量场景间不重载的快速模式、把判定标准做成可保存预设。


## 8. v0.2.0 升级记录（2026-08-21，用户要求 A/B/C 全做）

- **A 批量场景 + 压测**：场景选择改为多选 checkbox（含启动流程，全选/清空）；`startRun` 逐场景循环，每场景重载 iframe（干净状态）→ `isSceneReady()` 等待 → `loadScene(guid)` → 可选压测 → 采样 → 产出 `batchResults` 表格（场景/压测/帧数/FPS/P95/ΔP95/超预算/判定/主要瓶颈）。压测实现：`perf-core.pressure(level)` 用 `Scene.binding.createActor(node)` 克隆当前场景本地角色（x2/x5/x10，上限 200，节点模板来自 `Scene.actor.list` 实例的 `data/name/presetId/teamId/x/y`）——**关键坑：`createActor` 在 SceneContext（`Scene.binding`）上，不在 SceneManager（`Scene.createActor` 是 undefined）**；`Scene.load` 前必须等 `isSceneReady()`（`Scene.actor && Scene.entity`），否则首场景竞态报 `setObjectLists`。
- **B 基线 + diff**：localStorage `perf-lab-baseline`（按工程名 + 场景 key）；`保存为基线/清除基线`；每次运行 `diffFor(report)` 算 ΔP95/Δavg，退化判定 `dp95 > max(0.5, base.p95*0.15)`，并 diff updaters/renderers/events 的 avg 找出 Top5 退化项；表格与 Markdown 报告带 Δ 列与退化清单。
- **C 事件级定位**：`wrapEventHandlers()` 包装 `EventManager.activeEvents` 里每个 handler 的 `update`，名称 `type :: 文件名`（`event.path` 取 basename）；`eventStats` 进 snapshot/报告/侧栏事件 Top。事件会动态增减，靠每 60 帧 `refreshWraps()` 补包。
- 探针新增 API：`isSceneReady()/pressure(level)/diag()`；缓存版本全部升 `?v=20260821-perf-lab-2`（SW 注册、styles、app、探针注入均带版本）。
- 验证：夹具 E2E 通过（含事件 Top 断言、基线保存、二次运行 ΔP95 对比）；真实工程只读冒烟——单场景 PASS、**7 场景批量 7/7 成功**（世界/地下城/城镇100-102/森林道路/沙漠道路）、压测 x2 实测克隆 8 角色成功。

## 9. v0.2.1 兼容修复（2026-08-22）

- 工程扫描不再硬编码要求 `Dist/Script/main.js`，以工程自己的 `index.html` 为脚本清单，兼容 `D:\new-game` 的 `Dist/Script/` 和 `D:\GAME-20240905` 的旧版 `Script/` 布局；
- `Game.update/deferredRendering/loop` 包装保留全部参数，避免旧版 `Game.update(timestamp)` 丢失时间戳；
- 更新器与渲染器改为按方法分别标记，同一模块同时具有 `update/render` 时两边都能统计；
- 场景角色兼容 `Scene.actor.list`（新版）与 `Scene.actors`（旧版）；压测 `xN` 改为最终总角色数为 N 倍，上限 200；
- 主判定严格保持 `P95 <= 帧预算`，并要求至少采到 1 帧，避免空样本误判 PASS；
- 运行时就绪不再只看旧引擎很早就赋值的 `Data.manifest`，还要求更新器与渲染器已经安装，避免对尚未初始化完成的空壳采样并误报 PASS；
- 文件服务优先把目录句柄或 fallback `File` 表一次性交给 Service Worker 直接读取，避免大工程每个资源都经工具页 MessageChannel 往返；不支持句柄克隆时自动保留旧转发路径；
- Service Worker 重启后会从共用的 `loot-smith-settings/last-project-handle` 恢复目录句柄，防止长测试中途丢失直读通道；
- 旧工程若在浏览器启动分支直接调用 `require('fs'/'path'/'os')`，入口会注入严格只读垫片：读取失败后由引擎走默认数据，写操作拒绝；报告 `compatibility` 明示该模式。上限是桌面文件 I/O 不参与测量，后续若要测这部分需做 Electron 原生 runner；
- 最小回归：`node tools/perf-lab/self-check.js`。
