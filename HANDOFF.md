# DanJuan妙妙插件 (DanJuan DevSuite / Extension)
## 项目交接、系统架构与核心经验演进全档案 (HANDOFF & ARCHITECTURE)

> **文档定位**：记录本套件的**系统架构剖析、底层工作原理、时间线演进历史、高价值核心经验与防踩坑档案**，作为跨开发者与 AI 协同的唯一技术基线与记忆中枢（SSOT）。当前版本：`v0.2.0`。

---

## 🏛️ 1. 项目愿景与整体系统架构 (System Architecture)

### 1.1 架构定位与愿景
从单一的性能分析扩展，演进为 **Open Yami 原生复合型在场开发者全能套件（DanJuan妙妙插件 / In-Game DevSuite）**：
- **零修改游戏工程源码**：以 Open Yami RPG Editor 编辑器原生扩展（Chrome MV3 Extension）形式加载，试玩任何工程自动生效，不侵入、不污染游戏项目文件；
- **完全非阻塞与游戏自由交互**：沉浸式停靠、自由拖拽、支持双重物理级鼠标穿透，游戏不暂停、操作不拦截；
- **100% 对齐 Yami 原生暗黑设计系统**：硬朗暗黑调色板（`#181818` / `#242424` / `#303030`），绝对零 Emoji，纯正原生编辑器质感与官方开源 Remix Icon 矢量 Path 内联呈现；
- **多维能力复合体演进蓝图**：
  1. `[已落地]` **性能与卡顿分析（Profiler）**：普通体检/专业调试双模、精确到具体文件的真凶归因、内核级快速排查、5966 推流；
  2. `[已落地]` **控制台报错黑匣子（Error Debugger）**：全局拦截 `window.onerror` 与 `console.error`，内建智能白话归因分析库与调用栈复制；
  3. `[已落地]` **微内核页面契约架构（Microkernel Views Registry）**：标准生命周期契约（`mount / refresh / destroy`），跨模块依赖显式上下文 `ctx` 注入，彻底消除闭包耦合；
  4. `[已落地]` **零依赖原生自检与部署（build.cjs）**：纯 Node.js 实现样式自动注入、17 项关键 DOM 与锚点自检、`--deploy` 单向安全同步与 MD5 对齐报告；
  5. `[规划中]` **场景实体与触发器（Scene Inspector）**：同屏实体树形层级、碰撞与触发器检视；
  6. `[规划中]` **全局变量与开关调试（Variable & Switch Watcher）**：实时过滤监视游戏内开关与变量，支持动态改值；
  7. `[规划中]` **作弊与调试控制台（Cheats & Debug Console）**：穿墙、锁血、移速倍率、无敌、秒杀。

### 1.2 全局数据流向与模块分工拓扑图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Open Yami RPG Editor (Electron Host)                     │
│  main.ts -> session.loadExtension(..., { allowFileAccess: true })          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                         Chrome MV3 Extension 机制注入
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  游戏运行时主线程上下文 (world: "MAIN")                        │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    probe-core.js (探针与微服务内核)                    │  │
│  │  - WebGL 状态机拦截: drawElements / drawArrays / bindTexture / Shader  │  │
│  │  - 帧循环与对象级耗时计算: Hook Game.updaters / Game.renderers        │  │
│  │  - 原型链级嫌疑拦截器: Actor / Emitter / Event / Audio / UI (放行主角) │  │
│  │  - 100分制健康度与真凶定位引擎: 精确到 .event 步数 与 .actor 实例耗时 │  │
│  │  - 0 成本热更新器: jsDelivr 全球加速比对 + Node 原生本地物理路径覆盖  │  │
│  │  - 本地 5966 端口微服务: 原生 HTTP/SSE 服务 (跨域打通 /live 与 /stream)│  │
│  └──────────────────┬─────────────────────────────────┬──────────────────┘  │
│                     │ 内存直读 / CustomEvent 事件总线 │ 本地 HTTP / SSE 推流 │
│                     ▼                                 ▼                     │
│  ┌──────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │    hud-overlay.js (原生暗黑大盘)     │  │   yami-tools/perf-lab (Web) │  │
│  │  - 迷你胶囊 HUD (FPS / ms / DC)      │  │  - 离线性能大盘网页端        │  │
│  │  - 普通模式 (体检打分/真凶定位/排查) │  │  - 5966 实时波形图与分析     │  │
│  │  - 专业模式 (4大Tab微秒级分析)       │  │  - 历史基线性能比对          │  │
│  │  - 官方 Scene.preventInput 输入隔离  │  │                             │  │
│  └──────────────────────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 2. 核心子系统架构深度剖析 (Core Subsystems)

### 2.1 探针与诊断内核 (`probe-core.js`)
1. **WebGL 底层绘制流水线拦截**：
   - 挂载在 `WebGLRenderingContext` 与 `WebGL2RenderingContext` 原型链上；
   - 拦截 `drawElements` 与 `drawArrays`：精确记录每帧真实 DrawCall 提交次数与几何多边形面数（Triangles）；
   - 拦截 `useProgram` 与 `bindTexture`：追踪每帧着色器切换次数与纹理绑定切换开销。
2. **零侵入帧耗时与对象级开销分析**：
   - 智能包裹 `Game.updaters` 与 `Game.renderers`，按微秒记录耗时，并将连续超预算帧（>16.7ms）捕获至快照环形缓冲区；
   - 隔帧采样（每 3 帧一次）提取场景内实体耗时排行榜与活跃事件列表，确保探针自身对游戏主线程几乎**零额外开销**。
3. **内核级 A/B 嫌疑快速排查拦截器（原型链级强力阻断）**：
   - **角色逻辑**：Hook `Actor.prototype.update`。通过 `Party.player` 及 `Party.members` 精准放行玩家主角，全图所有存量与动态新生成的怪物/NPC 瞬间绝对定格，主角仍可完全自如走位与放技能测试；
   - **微粒系统**：Hook `SceneParticleEmitterManager.prototype.update`，全场景粒子发射与步进瞬间静止；
   - **事件系统**：Hook `EventHandler.prototype.update`，全引擎所有后台公共事件、自动执行与并行事件指令瞬间挂起；
   - **音效系统**：Hook `AudioManager.se.play` 与 `playWithDistance`，激活时调用 `se.stop()` 并清零 `gainNode`，实现 100% 绝对静音；
   - **界面系统**：Hook `UI.render`（跳过 `UI.root.draw()`）与 `UI.update`，画面上的血条、飘字、UI 元素彻底在视觉上消失并不提交显卡，真实消除绘制与更新开销。
4. **卡顿真凶归因引擎（精准到工程文件）**：
   - **事件死循环定位**：直指 `Assets/Event/xxx.event`，标明当前执行的指令索引行号（第 N 步）与高频循环原因，附带一键复制文件路径；
   - **角色过载定位**：直指 `Assets/Actor/xxx.actor`，标明单怪耗时与角色实例名；
   - **DrawCall 满帧自适应**：智能评估 `fps >= 55 && avgCompute < 14`，流畅满帧时不误报“严重卡顿”，降级为温和的低配优化建议；
   - **粒子与界面泄漏定位**：实时监控粒子数量与 `UI.manager.list.length` 元素驻留数。
5. **本地 5966 端口微服务**：
   - 探针内部通过 Node.js 原生 `http` 模块创建无依赖微服务器，监听 `127.0.0.1:5966`；
   - 暴露 `/live`（最新性能快照 JSON）与 `/stream`（SSE 实时数据流），配合 `Access-Control-Allow-Origin: *` 实现与外部 Web 工具台无缝跨域推流。

### 2.2 原生暗黑 UI 大盘 (`hud-overlay.js`)
1. **双模切换架构 (Dual-Mode System)**：
   - 顶栏配置 `[ 普通模式 | 专业模式 ]` 切换开关，本地持久化 `localStorage`，默认启动进入【普通模式】；
   - **普通模式（小白/策划/快速体检）**：
     - **100 分制健康度评分环**（根据帧率、计算耗时、DrawCall、微粒、实体综合加权，附带健康交通灯评价）；
     - **卡顿真凶定位卡片**（红标严重/橙标警告，展示具体文件、位置、诊断原因、白话建议与复制按钮）；
     - **A/B 快速排查箱**（5 个一键切换开关：冻结怪物、关闭粒子、暂停事件、静音音效、隐藏UI）；
   - **专业模式（极客/主程微秒级分析）**：
     - 无缝保留 4 大硬核视图：`性能总览`（模块耗时排行榜/内存）、`渲染DrawCall`（批次与Shader）、`场景实体`（F10对齐实体总数）、`活跃事件`（活跃事件历史流水与当前执行步数）。
2. **悬浮交互与官方输入隔离通道**：
   - **迷你胶囊 HUD**：实时显示 FPS、耗时与 DC，双模自适应展示，全屏任意拖拽并记忆坐标；
   - **官方原生防走位**：鼠标移入侧边栏时调用 `Scene.preventInput()` 并置零 `Input.buttons`，离开时调用 `Scene.restoreInput()`。DOM 仅在 `mousedown` 拦截冒泡，`click` 与 `mouseup` 完全放行，杜绝点击死锁。

### 2.3 自动化版本管理与 0 成本热更新架构
1. **0 服务器成本架构**：
   - 依托 GitHub 仓库（`bajibaji/yami-tools@extension`）为唯一真实源码源；
   - 依托 jsDelivr 全球免费开源 CDN（`cdn.jsdelivr.net/gh/bajibaji/yami-tools@extension/`）加速分发，免翻墙、免服务器、免流量费；
2. **前端纯类驱动显隐机制**：
   - 采用纯 `.show` 类驱动横幅，默认 `display: none !important;`，只有在检测到远端版本更高时才激活展示，并监听 `yami-perf-update-none` 消除误报；
3. **Node.js 原生一键原子覆盖**：
   - 探测本地插件物理路径（`D:/Program Files/Open Yami RPG Editor/extension/yami-perf-extension`），直接下载更新文件原子覆盖本地，提示用户“重启工程即可生效”。

---

## 📅 3. 时间线演进历史 (Timeline & Changelog)

只记录关键技术节点与核心架构突破，按演进时间升序排列：

- **2026-09-01 · 架构奠基 (v0.0.1)**
  - 攻克 Electron MV3 扩展机制，在主进程通过 `session.loadExtension(..., { allowFileAccess: true })` 与 `world: "MAIN"` 实现游戏主线程零侵入注入；
  - 拦截 WebGL 底层 `drawElements` / `drawArrays` / `useProgram` / `bindTexture`，首创帧级 DrawCall 与三角面数微秒级捕获；
  - 内置 Node.js 原生 5966 端口 HTTP/SSE 微服务，打通游戏内实时数据向 Web 分析台长连接推流。

- **2026-09-02 · 原生体验与暗黑质感重构 (v0.0.5)**
  - 发现并采用 Yami 官方原生 `Scene.preventInput()` / `Scene.restoreInput()`，彻底解决悬浮大盘点击导致游戏主角误走位的难题，且实现 DOM 零死锁；
  - 推出“完全非阻塞停靠侧栏”，支持 `Home` 键全局唤起/收起与自由拖拽胶囊；
  - 建立“严禁彩色系统 Emoji 政策”，引入 Yami 官方暗黑遮罩 PNG 图标库，配合 CSS 滤镜实现极具沉浸感的银白原生编辑器质感。

- **2026-09-03 上午 · 双模诊断体系与原型级排查落地 (v0.1.0)**
  - **普通小白模式与专业深度模式解耦**：普通模式输出 100 分制健康圆环与精确到具体 `.event` / `.actor` 文件的卡顿真凶卡片；
  - **A/B 快速排查内核化**：抛弃实例轮询，改用 `Actor.prototype.update`、`UI.render`、`EventHandler.prototype.update` 等原型链拦截，支持主角 `Party.player` 豁免保护与全局音效 SE 彻底静音；
  - **DrawCall 智能自适应**：满帧（>= 55 FPS）顺畅时不机械恐吓报“严重卡顿”，降级为温和的低配建议；
  - **0 成本自动化热更新引擎**：确立 GitHub (`extension` 分支) + jsDelivr 全球免翻墙 CDN 架构，Node.js 原生一键原子覆盖本地插件目录。

- **2026-09-03 10:30 · 稳定性与体验终极加固 (v0.1.1)**
  - **根除幽灵弹窗 Bug**：修复 CSS `!important` 穿透覆盖内联样式导致“未改版本却总是提示发现新版”的致命缺陷；
  - **修复更新按钮布局错位**：锁定 `min-width`、单行弹性居中与紧凑文案，消除了更新中的折行抖动；
  - **明确 Yami 刷新机制**：Toast 文案修正为“重启工程即可生效”（Yami 编辑器无浏览器式强制刷新）；
  - **确立口令驱动 Git 规范**：严禁私自 Git 操作，由用户明确下达“Git 上去”口令触发，自动根据改动量自增 SemVer 版本号。

- **2026-09-03 13:30 · 品牌确立与全能套件大厅化 (DanJuan妙妙插件)**
  - **正式确立品牌**：由 Yami 开发者套件统一更名为 **DanJuan妙妙插件**；
  - **模块化套件大厅**：主页精简 4 大模块卡片（性能分析、控制台报错、场景实体、变量与开关），文案极度精炼去啰嗦化；
  - **控制台报错黑匣子**：全量拦截 `window.onerror` 与 `console.error`，内建白话原因诊断与一键复制调用栈；
  - **双重硬核物理穿透**：破除 CSS 后声明 `!important` 级联覆盖陷阱，结合行内最强特异性控制与顶栏免穿透保护；
  - **正统 Remix Icon 离线免联网标准**：全量内联开源矢量 Path，0 网络请求秒开；
  - **瑕疵彻底清零**：展开大盘联动隐藏右上角迷你胶囊（避免半透明穿帮），拔除孤立未闭合标签（彻底铲除红色大通栏）。

- **2026-09-03 14:10 · 契约化解耦与零依赖构建自检体系落地 (v0.2.0 当前版本)**
  - **单文件内契约化抽象**：抽离 `Views` 页面注册表与 `ctx` 显式注入上下文，三大页面（`home`、`errors`、`profiler`）对齐 `mount / refresh / destroy` 页面契约，消灭闭包硬耦合与主循环面条式 `if-else`；
  - **CSS 纯净独立抽离**：抽取 `src/style.css`，彻底解决 850 行长字符串无 IDE 语法高亮与 Emmet 补全的痛点；
  - **极速零依赖构建器 `build.cjs`**：原生 Node.js 实现样式注入、语法自检、17 项关键 DOM 与锚点严苛自检，以及 `--deploy` 模式单向同步与 MD5 自动校验对比；
  - **严格零行为与零 UI 变化**：所有类名、ID、文案、事件完全 1:1 保真对齐，实机体验毫厘不爽。

---

## ⚠️ 4. 核心经验与致命踩坑防踩档案 (Critical Gotchas)

后续接手开发任何新模块时，**必须严格遵守以下血泪经验**：

### ① CSS `!important` 穿透内联样式导致“幽灵弹窗”
- **现象**：明明版本没变，一启动试玩却总是弹出写死的“发现新版本 v0.2.0”升级条，更新后下次启动依然在。
- **根因**：CSS 规则里写了 `.yami-update-banner { display: flex !important; }`，它强行穿透并覆盖了 HTML 骨架上的行内样式 `style="display: none;"`。
- **铁律**：所有弹窗、提示条、横幅等动态显隐组件，**CSS 默认规则必须锁死为 `display: none !important;`**；只有在 JS 明确判定需展示时，才赋予 `.show` 类（`.yami-update-banner.show { display: flex !important; }`）。

### ② 编辑器全局 `components.css` 的 `button` 粗暴绝对定位
- **现象**：在游戏内测试正常，但在 Open Yami 编辑器窗口加载时，按钮严重变形、错位、层叠堆积在左上角。
- **根因**：Yami 编辑器源码 `Project/css/components.css` 声明了全局规则：
  `button { position: absolute; width: 88px; height: 20px; }`。
- **铁律**：插件内部**严禁使用任何原生 `<button>` 标签**！全部使用 `<div role="button">`，并在 CSS 中显式声明 `position: static !important; user-select: none !important; box-sizing: border-box !important;`。

### ③ 动态文本膨胀导致的 Flex 按钮折行与错位
- **现象**：点击“一键热更新”后，按钮文字变成“⏳ 更新中 (1/5)...”，按钮突然折行、上下伸缩，导致大盘整体抖动。
- **根因**：Flex 容器未声明 `gap`，子按钮未声明 `flex-shrink: 0` 和 `min-width`，且行高未锁死。
- **铁律**：状态切换按钮必须锁死 `min-width: 86px; height: 26px; line-height: 26px; white-space: nowrap !important; flex-shrink: 0 !important; display: inline-flex; align-items: center; justify-content: center;`，文案保持精炼（如 `⏳ 更新 1/5`）。

### ④ 刷新机制差异：Yami 编辑器无浏览器强制刷新
- **现象**：提示用户“按 Ctrl + F5 刷新生效”，用户按了毫无反应。
- **根因**：Yami 的游戏试玩窗口是由 Electron 定制的主窗口，禁用了 Chromium 的默认开发者快捷键与强制刷新。
- **铁律**：涉及文件覆盖或插件更新后，**统一指引文案为“重启工程即可生效”**。

### ⑤ 快速排查“实例轮询打补丁”的弱效与主角误冻结
- **现象**：点击冻结怪物时，动态新生成的怪物依旧在跑，主角也被冻住无法走位；隐藏 UI 后画面上血条依然在渲染。
- **根因**：通过定时器轮询实例打 patch 容易漏掉新对象，且暂停逻辑未阻断 `UI.render`（`UI.root.draw()`）；怪物判定未剔除主角。
- **铁律**：排查拦截必须直接上升到**原型链与管理器入口**（`Actor.prototype.update`、`UI.render`、`SceneParticleEmitterManager.prototype.update`、`EventHandler.prototype.update`、`AudioManager.se.play`）。同时必须通过 `Party.player` 及 `Party.members` 给予玩家主角最高优先级豁免放行。

### ⑥ DrawCall 满帧时的机械化恐吓规避
- **现象**：在独立显卡 PC 上满帧 60 FPS 极度流畅，插件却因 DrawCall 达 150 次强行判定为“严重卡顿”，健康分暴扣至 40 分，用户感到恐慌。
- **根因**：现代独立显卡合批提交能力强，高 DrawCall 在当前配置并未构成实际卡顿瓶颈。
- **铁律**：诊断算法必须具备“帧率自适应能力”——先判定 `isSmoothGame = (fps >= 55 && avgCompute < 14)`。若游戏满帧顺畅，高 DrawCall 仅作为“💡 低配优化建议”温和呈现，健康分维持 90+ 绿标，严禁机械恐吓！

### ⑦ 黑色单色遮罩 PNG 在暗黑背景上的“黑吃黑”
- **现象**：引入 Yami 原生图标 PNG 后，在深灰/黑色大盘背景上几乎完全隐形看不见。
- **根因**：Yami 原生素材均为黑色纯色 Alpha 遮罩图。
- **铁律**：统一注入 CSS 滤镜：`filter: brightness(0) invert(0.85) !important;` 将黑色转化为质感银白（`#d8d8d8`），并在 hover/active 时切换为 `invert(1)` 高亮纯白。

### ⑧ 输入事件防穿透：DOM 冒泡阻断导致点击死锁
- **现象**：为了防止点击大盘导致游戏角色移动，在父容器捕获阶段拦截事件，导致侧栏内所有 Tab 和按钮彻底“点不动”。
- **根因**：捕获阶段中断导致浏览器无法将 `click` 派发给具体的 DOM 子元素。
- **铁律**：采用**官方原生输入隔离通道**：鼠标进入插件调用 `Scene.preventInput()` 并置零 `Input.buttons`，离开时调用 `Scene.restoreInput()`。DOM 层仅在 `mousedown` 拦截冒泡，完全放行 `click` 和 `mouseup`。

### ⑨ CSS 规则声明顺序与 `!important` 级联覆盖（物理穿透失效）
- **现象**：点击“穿透”按钮后，侧栏样式类添加了 `.through`，但鼠标依然无法点击底下的游戏画面。
- **根因**：`.yami-perf-dock.show` 规则写在 `.through` 之后，且两边都带有 `!important`。CSS 规范中同权重且带 `!important` 时，后声明的规则强行覆盖先声明的规则，导致 `pointer-events: auto !important` 击穿了 `pointer-events: none`。
- **铁律**：穿透规则必须升级为高特异性复合选择器：`.yami-perf-dock.show.through` 与 `* { pointer-events: none !important; }`，同时在 JS 交互中注入行内 `dock.style.setProperty('pointer-events', 'none', 'important')`（行内 + important 处于 CSS 层叠树最高层），顶栏单独放行 `pointer-events: auto !important`。

### ⑩ 多层 UI 联动隐身机制（半透明背景下浮窗穿帮）
- **现象**：开启穿透后侧边栏半透明至 75%，但背后赫然显现出右上角常驻的迷你帧数胶囊，两个帧数叠在一起造成穿帮。
- **根因**：大盘展开时未对宿主原有常驻胶囊施加隐匿控制。
- **铁律**：大盘展开时立即触发 `hud.style.setProperty('display', 'none', 'important')` 彻底隐藏右上角胶囊；大盘关闭收起时才恢复显示，保证半透明穿透时背景绝对纯净。

### ⑪ 孤立标签与重复按钮导致红色大通栏
- **现象**：顶栏下方出现一条刺眼的通栏大红条，左侧带有白叉 `×`。
- **根因**：模板字符串切片替换时遗留了孤立的重复 `<div id="btn-dock-close">×</div>`，脱离 Header 容器后被 Electron 宿主全局警示规则施加了红色通栏高亮。
- **铁律**：页面模板替换必须确保标签严格配对，全局 `btn-dock-close` 严格唯一，杜绝游离孤立元素。

### ⑫ 正统 Remix Icon 离线免联网内联标准与绝对零 Emoji 准则
- **现象**：手绘简单 SVG 显得粗糙不专业，引入 Emoji 会破坏游戏原生暗黑工业感。
- **根因**：外部 CDN / .woff2 字体在单机断网环境下会白框失效，Emoji 跨操作系统渲染不一致。
- **铁律**：100% 采用正统开源 Remix Icon（Line 风格）官方矢量几何 Path（`<path d="..." fill="currentColor">`）内嵌在代码中，0 个网络请求，保证单机断网 100% 渲染且支持 hover 升亮；全局绝对严禁任何 Emoji！

### ⑬ 页面契约化初始路由调用时序陷阱（TDZ 暂时性死区）
- **现象**：刚启动试玩控制台即弹出 `Error at switchView ... at initHUD`。
- **根因**：`switchView(currentView)` 初次调度写在了中段（第 1558 行），若用户 localStorage 缓存的上次页面是 `profiler`，它会立即触发 `profiler.refresh()` 访问后半段才声明的 `const` DOM 变量，撞上 ES6 暂时性死区（TDZ）；且大盘未展开时空刷 DOM 无意义。
- **铁律**：初始路由调度 `switchView(currentView)` 必须放置在脚本底部（所有 DOM 与页面函数声明完毕后）；同时 `profiler.refresh` 必须自带 `if (!isDockOpen) return;` 阻断保护。

---

## 🛠️ 5. Git 提交与智能版本自增规范 (Strict Git & Smart SemVer Policy)

1. **绝对禁止主动 Git (No Autonomous Git)**：
   - 平时日常开发、Bug 修复、样式调优过程中，**严禁擅自执行任何 `git commit` 或 `git push`**！
   - 所有改动在本地仓库（`extension` 分支）完成后，直接单向覆盖拷贝到 `D:\Program Files\Open Yami RPG Editor\extension\yami-perf-extension` 进行实机联调。
2. **唯一口令驱动触发 (User Command-Driven)**：
   - **只有当用户明确在对话中发出“git上去”、“提交代码”、“发布版本”等口令时，方可触发 Git 流程**！
3. **改动幅度智能决定版本号大小 (Smart SemVer Auto-Bump)**：
   - **Patch (`x.y.Z + 1`)**：中小型 Bug 修复、文案优化、CSS 样式微调（小改动）；
   - **Minor (`x.Y + 1.0`)**：新增功能模块（如新增排查项、新增诊断算法、开发作弊器/变量监视器等新功能）；
   - **Major (`X + 1.0.0`)**：跨模块核心架构重构、不兼容底层变更，或正式发布 1.0 里程碑；
4. **自动化闭环**：
   - 自动自增 `manifest.json` 与 `probe-core.js` 版本；
   - 生成规范 Commit 说明并推送至 `origin/extension`；
   - 最终单向覆盖镜像至编辑器扩展目录。

---

## 📁 6. 核心源码路径映射与运行目录对照表

| 路径 | 角色定位 | 维护准则 |
| :--- | :--- | :--- |
| `d:\Documents\GitHub\yami-tools\` (branch: `extension`) | **唯一真实源码源 (Single Source of Truth)** | 插件的母仓库，所有代码编写、版本管理和 Git 提交必须在此进行。 |
| `D:\Program Files\Open Yami RPG Editor\extension\yami-perf-extension\` | **编辑器运行时加载路径** | 仅作为本地联调和生产加载目标，由母仓库单向覆盖镜像生成，严禁在此建立独立分支。 |
| `https://github.com/bajibaji/yami-tools/tree/extension` | **远端分发与热更新源** | 用户一键热更新拉取代码的公共镜像源。 |
| `D:\Documents\GitHub\2\` | **Open Yami 引擎底层源码参考** | Electron 主进程 `main/main.ts` 与游戏内核模板 `Project/Templates/`。 |