# DanJuan妙妙插件 (DanJuan DevSuite / Extension)
## 交接文档 · 三层结构 (HANDOFF)

> **文档定位**：跨开发者与 AI 协同的唯一技术基线（SSOT）。文档分三层，读法如下：
>
> - **第一层 · 客观事实**：项目是什么、装在哪、怎么跑起来——只写客观存在的东西，不含判断。
> - **第二层 · 记忆与经验**：项目经历了什么、踩过哪些坑、为什么这样设计——读它能少走弯路。
> - **第三层 · 当前进度**：推进到哪里了、什么已完成、什么没做完、下一步做什么。
>
> **当前版本**：`v1.3.1`　**最近更新**：2026-09-12 上午

---

# 第一层 · 客观事实（What It Is）

## 1.1 项目属性

| 项 | 值 |
| :--- | :--- |
| 名称 | DanJuan妙妙插件（DanJuan DevSuite） |
| 形态 | Open Yami RPG Editor 的 Chrome MV3 扩展（非侵入式，不改游戏逻辑） |
| 当前版本 | `v1.2.0`（单一事实源：`manifest.json` 的 `version`） |
| 母仓库 | `yami-tools`，分支 `extension` |
| 许可与分发 | 母仓库 + GitHub 远端（热更新源），插件目录单向镜像 |
| 支持平台 | Windows（打包版引擎）与 Linux（源码构建版，本机为 Steam Deck / X11） |

## 1.2 路径映射与运行环境

| 路径 | 角色定位 | 维护准则 |
| :--- | :--- | :--- |
| `d:\Documents\GitHub\yami-tools\` (branch: `extension`) | **唯一真实源码源 (Single Source of Truth)** | 插件的母仓库，所有代码编写、版本管理和 Git 提交必须在此进行。 |
| `D:\Program Files\Open Yami RPG Editor\extension\yami-perf-extension\` | **编辑器运行时加载路径** | 仅作为本地联调和生产加载目标，由母仓库单向覆盖镜像生成，严禁在此建立独立分支。 |
| 加载机制（引擎侧事实） | `main.ts:330-341` | 引擎启动时遍历 `<编辑器>/extension/` 下**每个子目录**并 `loadExtension(dir, { allowFileAccess: true })`；故目录名可任意、多插件可共存，且**改完必须重启工程**（Electron 无 Ctrl+F5，见铁律④）。日常开发推荐 `node build.cjs --watch`：保存源文件即自动重建+镜像，免手动敲 `--deploy`。 |
| `https://github.com/bajibaji/yami-tools/tree/extension` | **远端分发与热更新源** | 用户一键热更新拉取代码的公共镜像源。 |
| `D:\Documents\GitHub\2\` | **Open Yami 引擎底层源码参考** | Electron 主进程 `main/main.ts` 与游戏内核模板 `Project/Templates/`。 |

## 1.3 系统架构与全局数据流

### 1.3.1 架构定位与愿景
从单一的性能分析扩展，演进为 **Open Yami 原生复合型在场开发者全能套件（DanJuan妙妙插件 / In-Game DevSuite）**：
- **零修改游戏工程源码**：以 Open Yami RPG Editor 编辑器原生扩展（Chrome MV3 Extension）形式加载，试玩任何工程自动生效，不侵入、不污染游戏项目文件；
- **完全非阻塞与游戏自由交互**：沉浸式停靠、自由拖拽、支持双重物理级鼠标穿透，游戏不暂停、操作不拦截；
- **100% 对齐 Yami 原生暗黑设计系统**：硬朗暗黑调色板（`#181818` / `#242424` / `#303030`），绝对零 Emoji，纯正原生编辑器质感与官方开源 Remix Icon 矢量 Path 内联呈现；
- **多维能力复合体演进蓝图**：
  1. `[已落地]` **性能分析大盘（Profiler）**：普通体检/专业调试双模、精确到具体文件指令的真凶归因、内核级快速排查（A/B实验）、5966 实时推流；
  2. `[已落地]` **控制台报错工作台（Error Debugger Workbench）**：全局拦截未捕获异常，11 种专属引擎白话诊断库，同源错误指纹聚合（`[xN次]` 杜绝刷屏），源码就地展开高亮与一键资源管理器定位，分类过滤与实时搜索，一键导出 Markdown 诊断报告；
  3. `[已落地]` **存档管理台（Save Lab）**：双环境（独立试玩窗口/编辑器宿主）智能感知，全量游戏变量中文字典与文件夹分类解密，布尔型工业级 Toggle 绑定，常用速改与 JSON 树形图编辑，三大子面板纵向满高自适应贯通；
  4. `[已落地]` **微内核页面契约架构（Microkernel Views Registry）**：标准生命周期契约（`mount / refresh / destroy`），跨模块依赖显式上下文 `ctx` 注入，彻底消除闭包耦合；
  5. `[已落地]` **零依赖原生自检与单一事实源门禁（build.cjs）**：纯 Node.js 实现样式自动注入、**45 项关键 DOM 锚点 + 原生 `<button>` 负向断言**与 0 Emoji 自检、SSOT 版本一致性强断言锁、`--deploy` 单向安全同步与 MD5 报告；
  6. `[已落地]` **场景实体检查台（Scene Inspector）**：同屏实体分组检视（场景放置/全局角色/触发区域）、碰撞体积/导航器/动画状态展开详情与关键字搜索过滤；全中文白话文案，**主页第 4 卡为唯一入口**（专业模式 tab 不再重复暴露）；
  7. `[已落地]` **作弊与调试控制台（Cheats）**：变速 0.5x~10x（高倍速=设 `Time.deltaTime=16.6` 后循环 `Game.update()` 跳过渲染；注意 `Game.update` 无参、time.ts:64 maxDeltaTime=35 陷阱）、穿墙（`passage=-1`，actor.ts:1646 实锤）、移速加成、锁血/秒杀（**血量=Attribute 属性系统非 hp 字段**）、**一键全部还原**（`resetAllCheats()`：关闭全部作弊开关并复原主角原本 `passage`/`movementSpeed` 与 `Time.timeScale`，立即执行不等下一帧，防试玩状态残留污染正式包）；附"后台时间漂移提示"（挂机失步盲点最小闭环，只检测不补算）；主角瞬移经用户裁决**不做**（见第 13 条）；
  8. `[已落地]` **变量监视挂件（Pin）**：胶囊旁钉 3~5 个常用变量/开关实时刷新（存档台每变量加【固定】按钮）；hook `Variable.set` 拦截类型静默丢弃 + NaN 检测，便签红字 `[类型异常]` 提醒；
  9. `[已落地 v0.9.0]` **事件黑匣子（事件指令级时间线 + 幽灵事件侦探）**：最近 20 步事件流水（开始/进行中/等待中/已暂停/停住了/结束了，经**编译期**建立的「原始指令 ↔ 编译槽位」映射把运行下标翻译成白话指令，如「第 5 步 · 等待 500 毫秒」）+ 幽灵侦探（已停住时长、所属对象已被删除红标、一键 `finish()` 终止）；**重要修正**：引擎初始化读完数据即 `delete Data.events`（`event.ts:88`），蓝图原定「运行时经 `Data.events[id].commands[index]` 反查」不可行，已改为编译期追踪（详见第 4 节铁律⑳）；
  10. `[已落地 v1.0.0]` **AI 全能副驾（AI Agent & MCP Hub）**：内置 `ai-agent.js` 与 `ai-host.js`，深度无缝桥接内置 `runtime/yami-mcp`（35 类工具）。白话驱动 Open Yami 引擎与工程全流程控制，包含写代码/编译、事件/数据表读写、5967 编辑器动作桥、5966 试玩交互桥、5968 本地代理桥、DPAPI 凭证加密存储、大文件截断与删除引用保护、三步确认审批与原子安全回滚；
  11. `[降级保留]` 性能基线快照对比：底层数据接口保留，UI 不主推（小白理解成本高）；
  12. `[不做]` 输入宏录制回放（随机数致回放失效、成本极高）、**主角瞬移「点哪里飞哪里」**（2026-09-09 用户裁决，勿再提议）、调试绘制层（Debug Draw）、UI 检视器、画面射线拾取器线框（2026-09 用户裁决，勿再提议）。

### 1.3.2 全局数据流向与模块分工拓扑图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Open Yami RPG Editor (Electron Host)                     │
│  main.ts -> session.loadExtension(..., { allowFileAccess: true })          │
│  窗口上下文: 5967 本地动作桥 (File.save, Directory.update, Playtest)         │
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
│  │  - 0 成本整包快照更新: tar.gz 直连 + 校验 + 原子落盘                    │  │
│  │  - 本地 5966 端口微服务: 原生 HTTP/SSE 服务 (跨域 /live, /stream, 输入) │  │
│  └──────────────────┬───────────────────┬────────────────────────────────┘  │
│                     │                   │ 5966 推流 / 试玩控制              │
│                     ▼                   ▼                                   │
│  ┌──────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │    hud-overlay.js (原生暗黑大盘)     │  │   yami-tools/perf-lab (Web) │  │
│  │  - 迷你胶囊 HUD (FPS / ms / DC)      │  │  - 离线性能大盘网页端        │  │
│  │  - 普通模式 (体检打分/真凶定位/排查) │  │  - 5966 实时波形图与分析     │  │
│  │  - 专业模式 (3大Tab微秒级分析)       │  │                             │  │
│  │  - AI 全能副驾视图 (#page-ai-agent)  │  │                             │  │
│  └──────────────────┬───────────────────┘  └─────────────────────────────┘  │
│                     │ UI 交互 / 聊天调度                                    │
│                     ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │   ai-agent.js + ai-host.js (AI 全能副驾宿主，端口 5968)                │  │
│  │  - 本地 DPAPI 加密凭证安全存储 (Windows Crypt32 原生防护)              │  │
│  │  - OpenAI / DeepSeek / 本地 Ollama 兼容协议驱动                        │  │
│  │  - 安全改动卡片审批 (Diff 预览 / 确认执行 / 一键回滚)                   │  │
│  └──────────────────┬────────────────────────────────────────────────────┘  │
│                     │ JSON-RPC / 本地进程管道                               │
│                     ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │   runtime/yami-mcp/server.js (内置 Yami MCP 工具服务器，35 类工具)     │  │
│  │  - 文件与资源原子操作 (带 SHA-256 冲突检验与 .yami-mcp-backups 备份)   │  │
│  │  - 原生 tsc.exe 编译排查 (ok=true / errorCount=0)                      │  │
│  │  - 5967 HTTP 桥驱动编辑器保存与重扫，5966 HTTP 桥驱动试玩按键模拟     │  │
│  │  - 200KB 上下文截断保护 + 资产删除全局引用反查拦截保护                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---


## 1.4 核心子系统剖析

### 1.4.1 探针与诊断内核 (`probe-core.js`)
1. **WebGL 底层绘制流水线拦截**：
   - 挂载在 `WebGLRenderingContext` 与 `WebGL2RenderingContext` 原型链上；
   - 拦截 `drawElements` 与 `drawArrays`：精确记录每帧真实 DrawCall 提交次数与几何多边形面数（Triangles）；
   - 拦截 `useProgram` 与 `bindTexture`：追踪每帧着色器切换次数与纹理绑定切换开销。
2. **零侵入帧耗时与对象级开销分析**：
   - 智能包裹 `Game.updaters` 与 `Game.renderers`，按微秒记录耗时，并将连续超预算帧（>16.7ms）捕获至快照环形缓冲区；
   - 隔帧采样（每 3 帧一次）提取场景内实体耗时排行榜与活跃事件列表，确保探针自身对游戏主线程几乎**零额外开销**。
3. **内核级 A/B 嫌疑快速排查拦截器（原型链级强力阻断）**：
   - **角色逻辑**：Hook `Actor.prototype.update`。通过 `Party.player` 及 `Party.members` 精准放行玩家主角，全图所有存量与动态新生成的怪物/NPC 瞬间绝对定格，主角仍可完全自如走位与放技能测试；
   - **粒子系统**：Hook `SceneParticleEmitterManager.prototype.update`，全场景粒子发射与步进瞬间静止；
   - **事件系统**：Hook `EventHandler.prototype.update`，全引擎所有后台公共事件、自动执行与并行事件指令瞬间挂起；
   - **音效系统**：Hook `AudioManager.se.play` 与 `playWithDistance`，激活时调用 `se.stop()` 并清零 `gainNode`，实现 100% 绝对静音；
   - **界面系统**：Hook `UI.render`（跳过 `UI.root.draw()`）与 `UI.update`，画面上的血条、飘字、界面元素彻底在视觉上消失并不提交显卡，真实消除绘制与更新开销。
4. **卡顿真凶归因引擎（精准到工程文件）**：
   - **事件死循环定位**：直指 `Assets/Event/xxx.event`，标明当前执行的指令索引行号（第 N 步）与高频循环原因，附带一键复制文件路径；
   - **角色过载定位**：直指 `Assets/Actor/xxx.actor`，标明单怪耗时与角色实例名；
   - **DrawCall 满帧自适应**：智能评估 `fps >= 55 && avgCompute < 14`，流畅满帧时不误报“严重卡顿”，降级为温和的低配优化建议；
   - **粒子与界面泄漏定位**：实时监控粒子数量与 `UI.manager.list.length` 元素驻留数。
5. **本地 5966 端口微服务**：
   - 探针内部通过 Node.js 原生 `http` 模块创建无依赖微服务器，监听 `127.0.0.1:5966`；
   - 暴露 `/live`（最新性能快照 JSON）与 `/stream`（SSE 实时数据流），配合 `Access-Control-Allow-Origin: *` 实现与外部 Web 工具台无缝跨域推流。
6. **事件黑匣子内核（v0.9.0 新增）**：
   - **编译期指令映射 `installEventTrace()`**：包裹 `Command.compile` 与逐条指令编译器，建立「原始指令下标 ↔ 编译槽位」映射表（`WeakMap`），使运行期 `event.index` 可被精确翻译回原始指令；
   - **事件启动钩子 `installEventCallHook()`**：包裹 `EventHandler.call` 登记所有在跑事件，配合 `wrapEventInstance` 记录「指令索引推进时间戳」，据此判定 执行/等待/暂停/挂起 四态；
   - **对外的 `getEventBlackbox()` / `finishEvent(id)`**：前者返回最近 20 步流水 + 在册事件快照（含挂起时长、宿主是否已销毁、是否仍在被驱动），后者调引擎原生 `finish()` 拔除滞留引用。

### 1.4.2 原生暗黑 UI 大盘 (`hud-overlay.js`)
1. **双模切换架构 (Dual-Mode System)**：
   - 顶栏配置 `[ 普通模式 | 专业模式 ]` 切换开关，本地持久化 `localStorage`，默认启动进入【普通模式】；
   - **普通模式（小白/策划/快速体检）**：
     - **100 分制健康度评分环**（根据帧率、计算耗时、DrawCall、粒子、实体综合加权，附带健康交通灯评价）；
     - **卡顿真凶定位卡片**（红标严重/橙标警告，展示具体文件、位置、诊断原因、白话建议与复制按钮）；
     - **A/B 快速排查箱**（5 个一键切换开关：冻结怪物、关闭粒子、暂停事件、静音音效、隐藏UI）；
   - **专业模式（极客/主程微秒级分析）**：
     - 保留 3 大硬核视图：`性能总览`（模块耗时排行榜/内存）、`渲染DrawCall`（批次与Shader）、`活跃事件`（活跃事件历史流水与当前执行步数）；原「场景实体」tab 入口已移除（数据块代码保留备用），场景实体统一走主页第 4 卡白话检视页。
2. **悬浮交互与官方输入隔离通道**：
   - **迷你胶囊 HUD**：实时显示 FPS、耗时与 DC，双模自适应展示，全屏任意拖拽并记忆坐标；
   - **官方原生防走位**：鼠标移入侧边栏时调用 `Scene.preventInput()` 并置零 `Input.buttons`，离开时调用 `Scene.restoreInput()`。DOM 仅在 `mousedown` 拦截冒泡，`click` 与 `mouseup` 完全放行，杜绝点击死锁。

### 1.4.3 自动化版本管理与整包快照更新架构
1. **0 服务器成本架构**：
   - 依托 GitHub 仓库（`bajibaji/yami-tools@extension`）为唯一真实源码源；
   - 更新载荷 = **分支整包快照**（`github.com/bajibaji/yami-tools/archive/refs/heads/extension.tar.gz`，2026-09 实测大陆直连 588 KB / 2.2 秒），第三方反代前缀（`gh-proxy.com` / `ghproxy.net`）只做兜底，免服务器、免流量费；
   - 版本探测（只取 691 字节的 `manifest.json`）四通道自动降级：反代取 raw → `api.github.com` 内容接口（0.33 秒，有匿名限流）→ raw 直连（开了系统代理时可用）→ jsDelivr（分支引用带 CDN 缓存、可能短暂滞后，故排最后）；
   - **首字节预算 8 秒 / 整包预算 30 秒**：实测直连通道会偶发"连得上但半天不回"（同一分钟内三次里两次 6 秒超时），两段预算分开才能在通道抽风时及时落到反代，而不是让用户干等半分钟；
2. **前端纯类驱动显隐机制**：
   - 采用纯 `.show` 类驱动横幅，默认 `display: none !important;`，在「发现远端版本更高」或「更新失败 / 通道全部不可达」时激活展示，并监听 `yami-perf-update-none` 消除误报；
3. **整包安装流水线**（`probe-core.js`）：下载 tar.gz → `zlib.gunzipSync` + 自写 tar 解析（零依赖，兼容 GNU 长名与 pax 扩展头）→ **校验**（manifest 声明的每一个文件必须在包里、每个 `.js` 必须过一遍 `vm.Script` 语法解析）→ 备份旧版本到 `_backup/previous/` → 先写 `.tmp` 再 `rename` 原子替换，`manifest.json` 最后落盘（版本门闩）。任何一项校验不过就**原地不动**（如实报"未改动任何文件"）；写盘中途失败自动回滚。
4. **装机范围 = 整包内容 − 开发目录黑名单**（`src/ tests/ tools/ docs/ build.cjs bump.cmd` 等「绝不可能是运行时依赖」的物料）：不在黑名单里的新增文件（例如新加的 `runtime/yami-mcp/modules/*.js`）自动进包——这就是"新增模块不需要人工登记"的机制来源，历史事故见铁律㊵。
5. **离线兜底通道**：面板常驻「本地安装」（横幅按钮 + 页脚链接，两条入口同一处理），选择手动下载并解压好的整包文件夹即可升级或重装同版本，全程不依赖任何外网。

### 1.4.4 AI 全能副驾内核与 yami-mcp 工具枢纽 (`ai-agent.js` / `ai-host.js` / `runtime/yami-mcp`)
1. **无 9222 端口依赖的本地双桥架构（Dual-Bridge Architecture）**：
   - **磁盘层与元数据**：由内置 `runtime/yami-mcp/server.js`（27 类 MCP 规范工具）以独立子进程管道运行，直读直写工程文件，自动计算 SHA-256 冲突校验并在写入前自动备份至 `.yami-mcp-backups`；
   - **编辑器动作桥 (端口 5967)**：由 `probe-core.js` 在编辑器宿主上下文中监听 `127.0.0.1:5967`，支持 Token 握手鉴权。暴露 `save`（调原生 `File.save`）、`refresh`（调 `Directory.update` 通知资产树即时重扫）、`playtest`（调起测试窗口）与 `undo`/`redo`，彻底摆脱 Electron 远程调试端口假象；
   - **试玩交互桥 (端口 5966)**：复用探针的原生 5966 微服务通道，暴露 `input` 与 `simulateKey`，驱动主角走位与指令测试；
   - **AI Agent 本地服务 (端口 5968)**：`ai-host.js` 启动轻量代理服务，处理与 OpenAI / DeepSeek / 本地 Ollama 接口的 SSE 流式交互，并在工具调用时协调 MCP 与宿主双桥。
2. **DPAPI 原生物理级凭证加密**：
   - 用户填入的 API 密钥绝不落明文到 `localStorage` 或明文 JSON；
   - 调用 Windows 原生 `CryptProtectData`（经由 powershell / node 绑定）实施机器与当前用户绑定的 DPAPI 加密，密文存储于本地数据目录；运行时内存解密即用即销。
3. **安全审批与回滚闭环（Approval & Rollback Safety Net）**：
   - **只读操作自执行**：读取资源、检索代码、查询变量等安全操作由 Agent 静默执行；
   - **破坏性写入三步确认**：任何涉及代码改写、事件替换、数据表更新、文件删除的操作，强制生成**白话改动说明卡片**与**代码 Diff 预览**，等待用户在插件界面显式点击【确认执行】；
   - **一键原子回滚**：备份记录随卡片持久化，用户点击【取消/回滚】即可立即恢复原文件。
4. **三大安全保护门禁**：
   - **200KB 上下文截断保护**：`read_resource` 支持指定 `args.key` 读取子节；对超过 200KB 的大文件默认实施安全截断与结构摘要，避免挤爆大模型提示词；
   - **资产删除全局引用反查强保护**：`delete_resource` 自动扫描工程内所有 `.event`、`.actor`、`.ui` 与 `Data/*.json`，若目标 GUID 仍存在入边引用则坚决拦截并输出引用位置，仅在 `force: true` 时放行；
   - **IIFE 单次调用防重放**：编辑器 CDP 模拟动作统一封装为自执行单次调用，根治双击或多次触发的隐患。
5. **上下文计量与自动压缩（对齐 DeepSeek Harness 的 token-meter / compaction-basic / tool-result-pruner）**：
   - **窗口与阈值**：窗口取官方公布的 **1M token**（`deepseek-flash` / `deepseek-v4-pro` 同），占用达 **80%** 触发压缩，压缩后原样保留最近 **16%** 窗口的原文（外加「至少保留 N 条消息」的下限）；规格集中在 `runtime/yami-mcp/modules/context-meter.js`；
   - **计量口径**：按官方「Token 用量计算」换算——中文 0.6 token/字、英文 0.3 token/字符，每条消息与每个内容块各 +4 结构开销；**工具 schema（35 个工具约 4.4k token）也计入**；
   - **真实用量锚点**：上游返回的 `prompt_tokens` 是权威计数，存成 `session.tokenAnchor = { messageCount, promptTokens }` 后，刻度 = 锚点 + 增量估算，误差不随对话变长而累积；面板显示形如 `上下文 320k/1M · 32%`；
   - **两级压缩**：第一级确定性修剪（超长工具结果换成「头 + 标记 + 尾」，默认 8192/4096/1024，不调模型、零成本）；第二级模型摘要（重放「system + 待折叠消息」+ 追加压缩指令，复用上游前缀缓存），产出**八节固定结构**的检查点包在 `<compacted-summary>` 里，替换成一条带引导语的 user 消息；
   - **不可压的固定开销**：工具 schema 本身超过阈值时明确跳过压缩并说明原因，不做「压了还是超」的空转。

---


## 1.5 端口、协议与令牌

| 端口 | 归属 | 作用 | 说明 |
| :--- | :--- | :--- | :--- |
| `5968` | `ai-host.js` | AI 助手本地宿主（HTTP + SSE） | 唯一对外入口；每轮对话、会话读写、余额与价目、连接体检都走这里 |
| `5967` | `probe-core.js`（编辑器页） | 编辑器动作桥：保存 / 撤销 / 重做 / 刷新资源树 / 启动试玩 | 需要引擎把内部接口挂到 `window.YamiEngine`（见 1.8） |
| `5966` | `probe-core.js`（试玩页） | 试玩实时推流（SSE）与按键/鼠标注入 | 只在试玩窗口的页面里监听 |
| `9222` | Electron 调试端口 | CDP（可选，用于界面审查与无视觉点击兜底） | 由桌面快捷方式带上，不是运行必需 |

- 鉴权：`ai-host` 与两座桥都要求令牌，请求头 `x-yami-agent-token`（SSE 亦可走 `?token=`）；令牌文件在 `<配置目录>/agent-token`（Linux 为 `~/DanJuanDevSuite/`）。
- AI 宿主 SSE 事件类型：`start` / `status` / `delta`（分 `content` 与 `reasoning` 两路）/ `tool` / `notice` / `plan` / `result` / `error`。
- MCP 侧：`ai-host` 以 stdio 拉起 `runtime/yami-mcp/server.js`（JSON-RPC 2.0），工具数以 `tools/list` 为准（当前 35 项）。

## 1.6 发布文件清单与职责

| 文件 | 职责 | 备注 |
| :--- | :--- | :--- |
| `manifest.json` | MV3 扩展清单 | **只挂 `bootstrap.js`**；三个主脚本走 `web_accessible_resources` 放行 |
| `bootstrap.js` | 主世界装载器（内容脚本） | 把主脚本按序注入页面主世界；首文件为探针，单个失败会指名告警 |
| `probe-core.js` | 探针内核 + 5966/5967 双桥 + 热更新 | 数据源与动作执行端 |
| `hud-overlay.js` | 暗黑大盘 UI（含全部样式 SSOT） | 样式由 `src/style.css` 在构建时注入 |
| `ai-agent.js` | AI 助手面板（对话 UI、审批、撤销、计划、成本显示） | 依赖 `ai-render-core.js`，缺它会降级直写并告警 |
| `ai-render-core.js` | 流式渲染纯逻辑（帧合并调度 / 增量文本缓冲 / 滚动判定 / 历史窗口） | UMD 双挂：浏览器全局与 Node `require` 同时可用 |
| `ai-host.js` | AI 宿主：模型调用、工具编排、审批、会话、计费、连接体检 | 127.0.0.1:5968 |
| `runtime/yami-mcp/server.js` | 内置 MCP 服务（35 个工具） | 由宿主以 stdio 拉起 |
| `runtime/yami-mcp/modules/*` | 工具实现与共享模块（diff / changelog / playtest / todos / pricing / message-pairs / file-ops / 双桥 / cdp / db / event-builder） | 每个模块都必须登记进热更新清单（`tests/test-static-health.cjs` 会扫目录核对，漏登记会让老用户热更新后宿主起不来） |
| `runtime/yami-mcp/modules/message-pairs.js` | 消息序列自愈：`assistant.tool_calls` 与 `tool` 应答配对（补占位 / 剔除越界 / 压缩切点对齐 / 合法性校验） | 宿主每次发请求前调用；依赖它的 `require`，删文件等于 AI 助手全废 |
| `runtime/yami-mcp/modules/context-meter.js` | 上下文计量与压缩规格（token 估算 / 1M 窗口与 80% 阈值 / 保留范围选择 / 长工具结果头尾修剪 / 真实用量锚点） | 计量口径与阈值参数的单一事实源，别处不要再自己算上下文大小 |
| `src/style.css` | 样式单一事实源 | 构建时注入 `hud-overlay.js` |
| `build.cjs` | 构建门禁 + 镜像部署 | 断言、SSOT 级联、`--deploy` / `--watch` / `--bump` |
| `tests/*` | 零依赖测试套件 | 由 `tests/run-all.cjs` 汇总 |

## 1.7 构建、测试与部署

```bash
. ~/.nvm/nvm.sh                                   # 先加载 nvm（本机 node 走 nvm）
node build.cjs                                    # 门禁自检（锚点 / 零 Emoji / 术语 / CSS 结构 / 滚动条 SSOT / 插件装配）
node build.cjs --bump minor                       # 单一事实源自增版本并级联
YAMI_DEPLOY_DIR="<引擎仓库>/extension/yami-perf-extension" node build.cjs --deploy
node tests/run-all.cjs                            # 全量套件（单个套件建议 timeout ≤60，整套会超过命令行时限）
```

- 门禁覆盖：46 项核心锚点 + 10 项整包更新锚点、零彩色 Emoji、术语合规、`src/style.css` 花括号与嵌套结构、滚动容器必须有滚动条样式、插件装配（manifest↔bootstrap↔整包快照更新↔部署清单四处咬合）。
- 测试套件（节选）：AI Agent E2E、AI 会话与上下文、上下文计量与自动压缩、消息序列自愈、编译器查找与降级语义、MCP 特色工具、编译自动修复、审批差异、试玩冒烟、变更小结、待办、价目、思考模式、只读并发、打断输出、渲染性能、工具提示一致性、静态健康、整体验收、热更新。
- 「静态健康」套件额外承担三类守卫断言：隐式全局 / CSS 结构 / 插件装配（含整包更新锚点与开发目录黑名单，且 `updateFiles` 一旦复活即判失败）；**心跳开销**（HUD 自重入、专业页与普通模式双指纹、存档台时间闸+目录指纹、抽样分位数、单次扫描）；**文档一致性**（README 声明的铁律条数与测试套件数必须与 HANDOFF / run-all.cjs 一致——这两个数字历史上漂移过多次）。
- 常用环境变量：`YAMI_TEST_PROJECT`、`YAMI_AI_PORT` / `YAMI_AI_TOKEN` / `YAMI_AI_CONFIG_DIR` / `YAMI_AI_SESSION_DIR` / `YAMI_AI_MAX_STEPS`、`YAMI_AI_CONTEXT_WINDOW`（默认 1000000，即 1M token）/ `YAMI_AI_COMPACT_THRESHOLD`（默认 0.8）/ `YAMI_AI_COMPACT_RETAIN`（默认 0.16）/ `YAMI_AI_CONTEXT_KEEP`（最少保留消息条数，默认 16）/ `YAMI_AI_TOOL_LIMIT`（工具结果入上下文的字符上限，默认 24000）/ `YAMI_AI_TOOL_TAIL`（其中尾部预留，默认 4000）/ `YAMI_AI_REPAIR_LIMIT`、`YAMI_AI_DEBUG`（=1 时打开宿主的取消链路追踪，默认关）、`YAMI_RUNTIME_BRIDGE_PORT`、`YAMI_MCP_GUARDED`。

## 1.8 引擎接口暴露契约（`window.YamiEngine`）

- 位置：引擎仓库 `Project/Script/main/main.ts` —— 顶部 import 内部对象后挂 `(window as any).YamiEngine = { File, Directory, Title, UndoManager, Data }`。
- **刻意不挂 `window.File`**：浏览器原生 `File` 构造函数占用该名，覆盖会波及上传 / Blob 等原生能力。
- 重建：`pnpm run build:vite`（只重建渲染层 dist，约 5 秒）；编辑器按 `dist/index.html` + `dist/assets/index.js` 运行。
- 插件侧统一取值：`window.YamiEngine?.X ?? window.X`（兼容老打包版裸全局）。三处取值点：`probe-core.js` 的 `engineApi()`、`runtime/yami-mcp/server.js` 的 `editor_action` 表达式、`ai-agent.js` 的工程根探测；`tests/test-static-health.cjs` 有断言守着，禁止改回裸全局。
- 已核对可用的引擎方法：`File.save(hint)`、`Directory.update()`、`Title.playGame()`、`UndoManager.undo()/redo()`、`Data` 系列。

---

## 1.9 版本与 Git 规范

### 1.9.1 Git 提交与智能版本自增规范

1. **绝对禁止主动 Git (No Autonomous Git)**：
   - 平时日常开发、Bug 修复、样式调优过程中，**严禁擅自执行任何 `git commit` 或 `git push`**！
   - 所有改动在本地仓库（`extension` 分支）完成后，直接单向覆盖拷贝到 `D:\Program Files\Open Yami RPG Editor\extension\yami-perf-extension` 进行实机联调。
2. **唯一口令驱动触发 (User Command-Driven)**：
   - **只有当用户明确在对话中发出“git上去”、“提交代码”、“发布版本”等口令时，方可触发 Git 流程**！
3. **改动幅度智能决定版本号大小 (Smart SemVer Auto-Bump)**：
   - **Patch (`x.y.Z + 1`)**：中小型 Bug 修复、文案优化、CSS 样式微调（小改动）；
   - **Minor (`x.Y + 1.0`)**：新增功能模块（如新增排查项、新增诊断算法、开发作弊器/变量监视器等新功能）；
   - **Major (`X + 1.0.0`)**：跨模块核心架构重构、不兼容底层变更，或正式发布 1.0 里程碑；
4. **全自动 SSOT 级联版本同步 (One-Source Cascade Sync)**：
   - 彻底废除多文件手工查找替换的低效模式！以 `manifest.json` 为**唯一绝对权威输入源**；
   - 支持 `node build.cjs --bump [patch|minor|major|<ver>]` 命令行秒级自增；
   - `build.cjs` 自动将权威版本单向级联注入 `probe-core.js`、`hud-overlay.js`、`README.md` 与 `HANDOFF.md`，实现改一处、秒级全量自动对齐并完成生产镜像部署。

---

---

# 第二层 · 记忆与经验（What Happened & Why）

## 2.1 演进时间线

### 2.1.1 里程碑概览

只记录关键技术节点与核心架构突破，按演进时间升序排列：

- **2026-09-01 · 架构奠基 (v0.4.1)**
  - 攻克 Electron MV3 扩展机制，在主进程通过 `session.loadExtension(..., { allowFileAccess: true })` 与 `world: "MAIN"` 实现游戏主线程零侵入注入；
  - 拦截 WebGL 底层 `drawElements` / `drawArrays` / `useProgram` / `bindTexture`，首创帧级 DrawCall 与三角面数微秒级捕获；
  - 内置 Node.js 原生 5966 端口 HTTP/SSE 微服务，打通游戏内实时数据向 Web 分析台长连接推流。

- **2026-09-02 · 原生体验与暗黑质感重构 (v0.4.1)**
  - 发现并采用 Yami 官方原生 `Scene.preventInput()` / `Scene.restoreInput()`，彻底解决悬浮大盘点击导致游戏主角误走位的难题，且实现 DOM 零死锁；
  - 推出“完全非阻塞停靠侧栏”，支持 `Home` 键全局唤起/收起与自由拖拽胶囊；
  - 建立“严禁彩色系统 Emoji 政策”，引入 Yami 官方暗黑遮罩 PNG 图标库，配合 CSS 滤镜实现极具沉浸感的银白原生编辑器质感。

- **2026-09-03 上午 · 双模诊断体系与原型级排查落地 (v0.4.1)**
  - **普通小白模式与专业深度模式解耦**：普通模式输出 100 分制健康圆环与精确到具体 `.event` / `.actor` 文件的卡顿真凶卡片；
  - **A/B 快速排查内核化**：抛弃实例轮询，改用 `Actor.prototype.update`、`UI.render`、`EventHandler.prototype.update` 等原型链拦截，支持主角 `Party.player` 豁免保护与全局音效 SE 彻底静音；
  - **DrawCall 智能自适应**：满帧（>= 55 FPS）顺畅时不机械恐吓报“严重卡顿”，降级为温和的低配建议；
  - **0 成本自动化热更新引擎**：确立 GitHub (`extension` 分支) + jsDelivr 全球免翻墙 CDN 架构，Node.js 原生一键原子覆盖本地插件目录。

- **2026-09-03 10:30 · 稳定性与体验终极加固 (v0.4.1)**
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

- **2026-09-03 14:10 · 契约化解耦与零依赖构建自检体系落地 (v0.4.1 当前版本)**
  - **单文件内契约化抽象**：抽离 `Views` 页面注册表与 `ctx` 显式注入上下文，三大页面（`home`、`errors`、`profiler`）对齐 `mount / refresh / destroy` 页面契约，消灭闭包硬耦合与主循环面条式 `if-else`；
  - **CSS 纯净独立抽离**：抽取 `src/style.css`，彻底解决 850 行长字符串无 IDE 语法高亮与 Emmet 补全的痛点；
  - **极速零依赖构建器 `build.cjs`**：原生 Node.js 实现样式注入、语法自检、17 项关键 DOM 与锚点严苛自检，以及 `--deploy` 模式单向同步与 MD5 自动校验对比；
  - **严格零行为与零 UI 变化**：所有类名、ID、文案、事件完全 1:1 保真对齐，实机体验毫厘不爽。

- **2026-09-03 16:20 · 存档台 (Save Lab) 模块原生化移植与工业级 UI/UX 落地**
  - **降维原生直达**：告别 Web 端繁琐的选择目录与沙盒弹窗，依托 Electron 运行环境毫秒级直达当前游戏 `Save/` 目录与 `Data/` 数据字典；
  - **GUID 智能中文字典解密**：自动扫描 `manifest.json`、`variables.json`、`attribute.json`，把原本冰冷晦涩的 GUID 翻译为真实游戏名称（如新手村、最大生命值）；
  - **依据 ui-ux-pro-max 规范排版**：设计槽位分段滚动条（Slot Bar）、2x2 概览便当盒（Bento Grid）、三模切换器（【常用速改】、【变量与开关】、【JSON 树形】）；
  - **物理级双重安全屏障**：每次保存修改前，Node.js 自动生成带有毫秒级时间戳的 `.bak` 备份文件于 `Save/Backups/` 目录，杜绝任何坏档风险。

- **2026-09-03 16:40 · 全自动活动工程跟随与变量深度解密完善**
  - **全自动工程追踪**：彻底剔除硬编码路径 fallback，打通 Open Yami 编辑器全局配置（`~/.openyami/config.json` 中的 `project` 字段）与 `window.File.root`，配合 `#home` 欢迎页感知，实现“用户打开什么工程就自动显示什么工程的存档”，未打开工程时友好提示；
  - **变量全量解密**：适配 Yami 引擎原生 `Data/variables.json` 顶层直接为 `Array` 树形结构（非 `.list`），成功解密游戏中全部变量（如 `赶路进度`、`当前地下城名字` 等）；
  - **槽位全屏平铺展开**：废除硬编码的矮框高度截断（`max-height: 120px`），根据实际存档卡片数量纵向自适应展开，彻底消除多余滚动条；
  - **导出按钮路由收敛**：全局底部【复制 JSON】与【保存报告】仅在【性能分析】页面展示，主页与存档页全面隐身；
  - **色彩层级互换**：卡片与按钮全面采用用户高度认可的工业深灰规范（`#303030` 底色 + `#3d3d3d` 细边框），大盘托底 `#202020`。

---


### 2.1.2 逐日详档

#### 2026-09-03 [里程碑] 变量与开关全量元信息解密与深度 E2E 验证
- **问题根因**：原先变量字典仅存储名称字符串，且布尔开关由于 Yami 引擎未改动前未写入 save.variables，导致所有布尔变量被误判为 [VAR] 并渲染为输入框；同时若初始化时字典有任何时序延迟，变量名会退化为 GUID。
- **全量升级**：
  1. loadDictionaries 升级为加载完整元信息对象：包含中文名称、真实类型（boolean / number / string）、所属文件夹分类（如常用变量、系统变量、地下城、世界地图、用户界面）与备注说明；
  2. render 与 renderVarsPanel 注入字典零状态自愈逻辑：只要检测到字典为空自动重新装载，杜绝 GUID 形式的变量名展示；
  3. 变量与开关列表精准呈现工业级分类标签与类型徽章（[开关] 绿色、[数值] 黄色、[文本] 蓝色），布尔型 100% 渲染为 Toggle 开关；
  4. 编写并全绿通过 17 项深度 E2E 仿真测试与 25 项全流程端到端自动化测试。

#### 2026-09-03 [优化] 存档管理三大子面板最大弹窗高度自适应贯通
- **痛点解决**：此前常用速改、变量与开关、JSON 树形图被死固定的 max-height (如 320px/480px) 截断，且缺少 flex: 1 贯通链路，导致大屏弹窗下高度仅展示一小截，内部双滚动条局促体验糟糕。
- **方案落地**：
  1. 宿主弹性链路全面贯通：#page-save 与 .yami-save-container、.yami-save-panel 设置 flex: 1 1 0; min-height: 0; height: 100%; overflow: hidden;
  2. 变量与开关：移除行内 max-height: 480px 限制，.yami-save-var-list 设置 flex: 1; max-height: none; overflow-y: auto; 垂直吃满全部剩余高度，一屏沉浸式检视；
  3. JSON 树形图：移除 320px 死限制，.yami-save-tree-box 设置 flex: 1; max-height: none; 满屏展开；
  4. 常用速改：引入 .yami-save-quick-scroll 弹性容器，垂直自由流动，滚动体验流畅平滑。
- **测试验证**：编写并通过 14 项三大子面板满高自适应 E2E 自动化测试。

#### 2026-09-04 · 控制台报错工作台全维度落地 (v0.4.0)
- **引擎专属白话诊断库扩充**：新增空指针目标属性解引用、公共事件死锁/爆栈、场景地形与 Autotile 加载越界、插件自定义指令参数异常、WebGL 图形管线、音频解码播放受阻、NaN 无效计算等 11 类典型异常；
- **同类高频错误指纹聚合**：引入 fingerprint 错误指纹算法，同源异常自动聚合并累计频次（`[xN次]` 徽章），标注首末发生时间戳，杜绝异常列表被无谓刷屏；
- **源码就地展开与定位直达**：就地展开报错行上下 7 行源码片段，高亮标记出错行；提供【定位文件】按钮，一键调起操作系统资源管理器定位文件；
- **多维分类过滤与搜索**：顶部提供 `全部`、`高频`、`空指针`、`方法丢失`、`插件指令`、`场景地形`、`资源404`、`控制台` 标签式弹性换行过滤器，支持关键字实时检索；
- **一键导出 Markdown 报告**：生成包含硬件环境、游戏状态、场景、FPS/DrawCall 以及全部异常详细调用栈与源码片段的专业报告，自动复制并落盘；
- **全量测试凭证**：编写并通过 24 项全维度自动化测试（`e2e-error-debugger-test.cjs` 100% 全绿通过）。

#### 2026-09-04 · 架构深度打磨与顶级作用域提升 (v0.4.1)
- **未读计数有界收敛**：`errorUnreadCount` 严格收敛至 `state.errorHistory.length` 语义上限（上限 100），彻底消除死循环长时挂机爆大数隐患；
- **转义函数单一事实源提升**：将 `esc` 与 `escapeHtml` 提升至 IIFE 最顶层模块作用域，消除闭包耦合与依赖函数提升可能带来的断链风险；
- **死变量彻底清理**：移除重构遗留的 `errorsCountLabelEl` 死变量；
- **回归测试资产跟进**：`errflow` 测试套件更新对齐 v0.4.0+ 指纹聚合模型（3 连发同源 = 1 条 count=3），构建自检 18 项核心锚点全绿。

#### 2026-09-04 · 场景实体检查台 (Scene Inspector) 全维度落地 (v0.5.0)
- **探针同屏实体快照 `getSceneEntities`**：一次 O(n) 只读遍历产出角色实例（场景放置 local / 全局角色 global 精确分组，`instanceof GlobalActor` 判别 + `data.type` 跨 realm 兜底）与触发区域（矩形范围、区内角色名单、绑定状态）；每实体携带坐标/朝向/渲染优先级、碰撞体（形状/直径/immovable/本帧位移）、导航器（mode/速度/寻路态）、动画播放器（motion/暂停/播完）与玩家主角高亮；`binding null`（未开地图）与无 Scene 双空态全防御，不处理双场景槽（bind 已指向当前场景）；
- **SceneLab 分组检视台**：`#page-scene` 独立第 5 页；顶部场景信息卡（地图名/路径/尺寸 + 角色/区域/动画/粒子/触发器/光源计数 + 镜头）、搜索框、全部/角色/区域过滤与"仅可见"开关；角色按「场景放置/全局角色」分组，触发区域独立组；展开行就地检视坐标、碰撞体、导航、动画、区内角色详情；**500ms 心跳节流 + 快照 JSON 相等跳过重建 + 单组展示上限 200** 三重护栏杜绝高频 DOM 抖动；
- **主页第 4 卡收编**：将遗留"变量与开关（规划中）"占位卡替换为「场景实体」入口（该能力早已并入存档管理台【变量与开关】子面板），主页 4 大模块卡片全部转正落地；
- **mount 无调用点陷阱规避**：SceneLab 的挂载与事件绑定转入 `refresh` 惰性自愈（`_ensureRoot` 一次性守卫），对齐 SaveLab 的实际入口模式；
- **版本与门禁**：SSOT 三源提升至 v0.5.0；build.cjs 锚点扩至 20 项（新增 register('scene')/scene 骨架/主页四模块顺序正则收尾）；
- **测试凭证**：新增 `.e2e-tmp/test-scene-lab.mjs` 25 断言全绿（空态/binding null/schema 分组/字段/数据变化一致性/hud 接线静态契约/Proxy-DOM 集成渲染冒烟），`errflow` 13

#### 2026-09-04 · 小白友好文案整改与目标用户画像确立 (v0.5.1)
- **目标用户画像确立**：插件受众 = 会用 Open Yami 编辑器做游戏、但计算机理论知识薄弱的制作者（非程序员）；所有界面文案必须中文白话直白、零黑话，专业术语仅在专业模式保留；
- **错误卡片分类名中文化**：卡片头部 `[异常] NullPointer` 等英文分类统一改走共享中文映射 `CAT_LABEL`（空指针/方法丢失/插件指令/场景地形/资源404/控制台），过滤器按钮与卡片共用同一映射源，杜绝双份文案漂移；
- **场景实体详情去代码残留**：详情字段 `隐藏 (visible=false)` 黑话改为 `已隐藏`；计数 chip「弹道」术语修正为「触发器」（trigger=触发器铁律）；
- 版本三源（manifest / PROBE_VERSION / hud 兜底）同步 v0.5.1；回归全绿（verify 30 / autoupdate 24 / errflow 13 / scene-lab 25）。

#### 2026-09-04 · 场景实体入口统一（工作区改动，随下一版发布）
- **移除专业模式 tab 栏「场景实体」重复入口**：场景实体唯一入口 = 主页第 4 卡白话检视页（SceneLab），普通人不会再撞见英文数据卡版本；`ptab-scene` 数据块代码完整保留备用，恢复只需加回一行 tab 按钮；
- 专业模式视图由 4 减为 3（性能总览 / 渲染DrawCall / 活跃事件），其余模块不受影响；对应更新 1.2 拓扑图与 2.2 双模架构描述。

#### 2026-09-07 · 调试控制台与变量监视器小窗落地 (v0.6.0)
- **调试控制台 (CheatsLab) 全维度上线**：
  1. 游戏变速：支持 0.5x, 1x, 2x, 5x, 10x 档位；通过单帧高频循环驱动 `Game.update()` 彻底绕过 `time.ts:64` 的 `maxDeltaTime=35` 节流瓶颈，同时跳过冗余 GPU 渲染；
  2. 穿墙模式 (NoClip)：设置 `Party.player.passage = -1`，关闭时自动恢复角色原本通行能力；
  3. 加速奔跑 (SpeedBoost)：设置 `Party.player.navigator.movementSpeed = 12`，关闭时无缝复原原本移速；
  4. 无限生命 (GodMode)：每帧主动向主角生命属性注入满血（自适应 `health`、`hp`、`生命值` 与对应上限），杜绝测试中暴毙打断流程；
  5. 秒杀全图怪 (KillAllMonsters)：一键遍历当前场景实体列表，对非队伍玩家怪物的生命值归零并触发消亡；
  6. ~~坐标瞬移 (点哪里飞哪里)~~：**本条为误记，从未落地**——v0.7.0 复核时全库无 `teleport`/`Input.mouse` 任何实现，且场景实体页亦无屏幕坐标→世界坐标换算可复用；经用户 2026-09-09 裁决**不做**（见 §1.1 第 13 条），勿再按本条提议实现；
  7. 后台时间漂移监测 (Background Drift)：监听 `visibilitychange`，切出后台时精准记录真实与逻辑落差并给出白话提示。
- **变量监视器小窗 (PinnedWidget) 落地**：
  1. 迷你胶囊下方常驻可扩展监视浮窗，最多固定 5 个核心变量；
  2. 支持在【存档管理】的变量与开关面板中通过 `[盯]` / `[已盯]` 按钮自由固定或取消固定；
  3. 挂接 `Variable.set` 拦截器与探针预警：捕获类型不匹配被引擎静默吞噬（`variable.ts:118`）及 `NaN` 异常计算，实时展示醒目 `[异常]` 工业角标；
  4. 遵从多层 UI 联动隐身机制：大盘展开时联动随胶囊隐身，收起时自动唤醒。
- **主页 5 大功能入口布局**：主页扩展为 5 大模块网格（性能分析、控制台报错、存档管理、场景实体、调试控制台）。
- **门禁校验与 SSOT 一致性**：manifest.json、probe-core.js、hud-overlay.js 全线对齐 v0.6.0，build.cjs 24 项核心锚点断言 + 0 Emoji + 中文术语自检全绿。

#### 2026-09-09 · 作弊台安全闭环、铁律② 门禁化与回归资产入库 (v0.7.0)
- **作弊台「一键全部还原」落地**：
  1. `probe.resetAllCheats()` 新增——关闭 `speedMultiplier`/`noClip`/`speedBoost`/`godMode` 全部开关，复原主角原本 `passage` 与 `navigator.movementSpeed`、`Time.timeScale=1`，并**立即执行一次 `applyCheatsPerFrame()`**（不等下一帧，且原值还原后自动清空 `orig*` 缓存）；
  2. 作弊页新增第 4 卡「全部还原」，带状态指示器：`状态干净`（绿）/ `有作弊开启`（黄），`refresh` 时按四项开关任一开启实时切换；
  3. **解决真实事故源**：此前开了穿墙/锁血/加速忘记关，试玩状态残留会被误判为游戏 bug，甚至污染正式包。
- **铁律② 门禁化（全库唯一原生 `<button>` 违规清零）**：
  1. `hud-overlay.js` 存档台变量面板 `[盯]` 按钮由 `<button>` 改为 `<div role="button">`（此前是**全库唯一**一处原生 button）；
  2. `src/style.css` 的 `.btn-pin-var` 补齐防护：`position: static` / `box-sizing: border-box` / `display: inline-flex` / `min-width: 46px` / `flex-shrink: 0`，抵御编辑器全局 `button{position:absolute;width:88px;height:20px}`；
  3. **build.cjs 新增原生 `<button>` 负向断言**——此后任何一处 `<button>` 都会让构建直接失败，铁律从文档约定升级为机器门禁。
- **回归资产入库（防测试网丢失）**：
  1. `verify-perf-probe.mjs` / `test-errflow.mjs` / `test-scene-lab.mjs` / `test-autoupdate.mjs` 由被 gitignore 的 `.e2e-tmp/` 迁入 `tests/`（相对路径 `../` 不变，断言内容一字未改）；
  2. 新增 `tests/test-cheats-reset.mjs`（19 断言）：覆盖开关归零、原本属性复原、`timeScale` 复位、还原后不再干预游戏数值、hud 接线契约与零原生 button；
  3. 新增 `tests/run-all.cjs` 零依赖总入口，发布前跑 `node build.cjs && node tests/run-all.cjs`。
- **修复测试自身缺陷（非产品回归）**：`test-autoupdate.mjs` 的「远端版本」预言机原为裸 `fetch` 单通道，网络抖动时退化成 `'0.0.0'` 导致 5 条断言对着未知值误报失败；改为 raw + jsDelivr 双通道兜底，两条均不可达时显式 `SKIP` 并打日志（**预言机可用时断言一条不减**）。
- **门禁与凭证**：SSOT 三源同步 v0.7.0；build.cjs 锚点扩至 **26 项** + 原生 button 负向断言 + 0 Emoji + 术语自检全绿；回归 **verify 30 / errflow 13 / scene-lab 25 / cheats-reset 19** 全绿（autoupdate 依赖公网，节点受限时第 4 节按环境跳过）。

#### 2026-09-09 · 全量缺陷排查与修复 (v0.7.1)
- **排查方法**：5 路并行静态审计（`probe-core` / `hud-overlay` 三段 / 样式构建文档）+ **引擎源码交叉核验**（`D:\Documents\GitHub\2\Project\Templates\arpg-ts-chinese`）+ **真机 E2E**（Playwright 驱动真实 Chrome，把仓库源码以 `world:MAIN` 等价方式注入真实游戏工程并逐页走查）。
- **P0 功能失效修复**：
  1. **存档台编辑被 150ms 心跳冲掉**（`SaveLab.refresh` 无守卫 → 每 150ms 重读磁盘并整体重建 DOM）：新增 `dirty` 脏标记 + 焦点守卫，速改/变量/开关输入即置脏，写盘与切槽位后清除；**真机实测：输入 `999999` → 500ms 后仍为 `999999`，失焦 600ms 后仍未被回读覆盖**（修复前为 `999999 → 100` 且失焦）。
  2. **变量监视小窗恒显示 `-`**：取数源由 `Variable.groups[0]`（引擎实为 `[[],[],[]]` 数组）改为 `Variable.map`（`variable.ts:58/98`）。
  3. **报错页每 150ms 整体重建**（展开的源码 150ms 内自动收起、滚动回顶）：`renderErrorsList` 增加重建签名比对，无变化即跳过；**实测 DOM 变更 8 次/1.2s → 0 次**。
  4. **场景实体台二次进入后行展开失效**：`destroy()` 未解绑常驻容器上的监听 → 重入叠加，同一次点击被多个 handler 抵消；改为保存绑定引用并在 `destroy` 中 `removeEventListener`。
  5. **场景实体台搜索框每敲一个字就失焦**：重建后回填焦点与光标，且用户聚焦搜索框时跳过重建。
- **引擎 API 错配修复**（均以引擎源码为准）：
  1. `killAllMonsters` 原用 `emit('destroy')`（只派发事件、不移除实例）→ 改为 `actor.destroy()`（`GlobalEntityManager.remove` + `parent.remove`）；
  2. 「全局注册事件总数」恒为 0：引擎初始化后 `delete Data.events` → 改取 `EventManager.guidMap`（`event.ts:45/88`）；
  3. 事件耗时包装器被引擎「等待/暂停/继续」整体替换 `update` 后永久失效 → 记录包装器引用，被顶掉即重新包装；
  4. `Variable.set` 告警漏报「键不存在」（引擎静默丢弃）→ 补判并给出中文原因；
  5. `Local.textMap[].contents[lang]` 为闭包函数时本地化反查失败 → 调用取值，避免界面露 GUID。
- **数据与健壮性修复**：
  1. 空输入框 `Number('') === 0` 会把金币/等级/HP/MP 写成 0 → 统一按「未填写」跳过；
  2. 文本变量被强制转数值（引擎按类型丢弃）→ 仅原值为数值时才转换；
  3. 自造顶层 `switches` 字段（引擎完全不读，属存档污染）移除，键不在存档时改为明确提示；
  4. `console.error` 代理遇循环引用对象会 `JSON.stringify` 抛错并反噬游戏 → 代理体整体 try/catch + 安全降级；
  5. 错误源码上下文在指纹去重前无条件同步读盘（死循环报错每秒 60 次 I/O）→ 移到去重判定之后 + 加缓存 + 行号越界返回 null；
  6. 自身日志前缀 `[Yami Perf]` 大小写不匹配，导致插件自身异常被当成游戏错误计入黑匣子 → 改为大小写不敏感匹配；
  7. 对象级真凶快照 2/3 帧为空导致卡片 4Hz 闪烁 → 保留上一份非空快照；
  8. 首帧 interval（注入 → 游戏启动的空闲期）污染报告 `frame.max` → 首帧超过 500ms 直接丢弃；
  9. 静音还原硬写 `gain=1` → 记录并还原玩家原有音量；「全部还原」硬写 `Time.timeScale=1` → 记录并还原游戏原有 timeScale（子弹时间等不再被永久覆盖）；
  10. 卡顿次数被 `slice(-6)` 截断 → 列表仍取最近 6 条，计数改用真实总数。
- **文案与门禁**：
  1. `CAT_LABEL` 提升至 IIFE 顶层并补齐 7 个缺失分类（`UndefinedVariable`/`StackOverflow`/`RenderError`/`JSONParseError`/`AudioError`/`NumericError`/`RuntimeError`），导出报告复用同一映射（铁律⑱）——真机实测卡片头部已由 `[RuntimeError]` 变为 `[异常] 未知异常`；
  2. `src/style.css`：`.yami-error-count-badge` 引用的不存在动画 `pulseCount` → 复用既有 `yami-pulse`；`#page-cheats` 与 `.yami-nav-back-btn` 默认隐藏补 `!important`（铁律⑭）；
  3. `build.cjs`：样式注入标记缺失/源文件缺失由静默跳过改为 `exit 1`；版本 SSOT 的 hud 侧校验由条件式改为「兜底版本字面量必须存在且全部等于 manifest 版本」；
  4. `README.md` 事实对齐：版本 `v0.5.1`→`v0.7.0`、断言 `20`→`26`、铁律 `17`→`19`、补 `tests/` 目录与作弊台/变量监视模块说明。
- **回归资产**：新增 `tests/test-fix-regressions.mjs`（20 断言：timeScale 还原、`destroy()` 真移除、`guidMap` 计数、缺失键告警、循环引用代理不抛错、分类标签全覆盖 + 4 项接线契约）；`tests/run-all.cjs` 扩为 **6 套**。
- **验证凭证**：`node build.cjs` 26 项全绿；`node tests/run-all.cjs` **6/6 套通过**（verify 30 / errflow 13 / scene-lab 25 / cheats-reset 19 / fix-regressions 20 / autoupdate 25）；真机 E2E 五页全渲染、无插件侧新增异常。

#### 2026-09-09 · 工程体检（断链+死事件）与报错事件级定位全链路落地 (v0.8.0)
- **工程体检内核 `projectAudit` (`probe-core.js`)**：
  1. 纯静态只读扫描 `Data/*.json` 与 `Assets/` 资产目录，建立全局名称与 GUID 字典表（文件名直接解析 + manifest 权威映射 + variables/attribute/teams/easings/autotiles/enumeration 通用树形提取）；
  2. 结合节点自注册 ID 集合（`presetId`、`prefabId`、`sprites[].id`）与全局字典双表判别，递归排查非法断链引用；
  3. **死事件白名单实锤**：严格对齐 `event.ts:49-76` 22 类引擎系统保留事件白名单（startup/autorun/loadscene/touch/mouse/gamepad 等）永不判死；仅将无任何 `callEvent` 入边的公共事件判为死事件；
  4. **真实工程验证凭据**：在 `d:\new-game` 仅 1.5 秒扫完数十万字符资产，实锤揪出 21 种怪物与强化事件中残留的已删除属性 GUID `0def781ddbf542fc`！
- **控制台报错页 (运行日志) 整合体检面板 (`hud-overlay.js` + `src/style.css`)**：
  1. `#page-errors` 顶部工具栏下方集成「工程体检」独立卡片（带官方 Remix Icon 矢量路径、状态徽标与【一键体检】按钮）；
  2. 扫描过程展示 `[扫描中...]` 状态，完成后展示健康度评价与文件/引用统计概览；
  3. 异常清单展开检视：断链卡片（红标）标注文件、第几步指令、丢失 GUID 与字段；死事件卡片（橙标）标注事件名与类型；支持【复制信息】与【定位文件】（调起系统资源管理器）；
  4. 遵从铁律⑲：体检纯由用户点击触发，绝不进入 150ms 心跳轮询，零运行时性能负担。
- **报错定位事件级升级**：
  1. `probe-core.js` 原型链拦截 `EventHandler.prototype.update` 维护事件执行栈 `eventExecStack`；
  2. 捕获未处理异常时调用 `currentEventContext()` 获取顶层事件名、执行步数（`ev.index + 1` 步）以及当前场景名（从 `Scene.binding` / `Data.scenes` 反查中文名称）；
  3. 报错卡片醒目呈现 `[事件定位] 发生在【某事件】第 N 步 · 【场景名】` 工业徽标，且 Markdown 结构化报告同步输出。
- **门禁与自动化回归**：
  1. `build.cjs` 锚点扩充至 **30 项**，0 Emoji 与 0 原生 `<button>` 铁律机器检查全绿；
  2. 新增 `tests/test-project-audit.mjs`（21 项全绿断言：字典构建、断链精确捕获、死事件白名单豁免、事件执行定位捕获、DOM 接线静态契约与零原生 button）；
  3. `tests/run-all.cjs` 测试套件扩至 **7 套**。

#### 2026-09-09 · SSOT 智能级联版本管理与一键驱动落地 (v0.8.1)
- **痛点彻底根除**：此前版本号散落在 `manifest.json`、`probe-core.js`、`hud-overlay.js` 多处字面量、`README.md` 与 `HANDOFF.md`，每次升级需人工逐文件核对修改，效率低下且容易被门禁拦截；
- **全自动 SSOT 级联同步架构**：
  1. 确立 `manifest.json` 为**唯一绝对权威输入源**；
  2. 升级 `build.cjs` 支持 `--bump [patch|minor|major|<ver>]` 参数（默认 `patch`）；
  3. 构建时自动比对基线版本，将权威版本号秒级单向级联注入 `probe-core.js`、`hud-overlay.js`、`README.md` 与 `HANDOFF.md`；
  4. 新增根目录极简原生批处理脚本 `bump.cmd`（封装 `node build.cjs --bump %* --deploy`），支持终端一行命令 `.\bump` 或 `.\bump minor` 瞬间完成「版本自增 + 级联对齐 + 30 项门禁自检 + 生产目录镜像部署」。

#### 2026-09-10 · 事件黑匣子：指令级时间线 + 幽灵事件侦探 (v0.9.0)
- **需求来源**：蓝图 v0.8.0 详案顺延落地（v0.8.0 被「工程体检 + 报错事件级定位」占用）。目标场景：**"角色不动了、剧情不继续了，控制台却没有任何报错"** —— 打开运行日志即可看到「最后停在哪一步、在等什么」。
- **蓝图技术路线被真机源码否决（关键修正）**：原方案「hook `EventHandler.prototype.update` 读 `this.index`，再经 `Data.events[id].commands[index]` 反查指令」**不可行**——
  1. `event.ts:88` 引擎初始化读完数据即 `delete Data.events`，运行时该结构已不存在；
  2. `command.ts:120` 的编译会跳过禁用指令（`!` 前缀）、跳过 null 结果、把 `showChoices`/`block` 这类一条指令展开成多个槽位，**`event.index` 是编译后槽位下标，与原始指令下标并不相等**（真机实测：8 条原始指令编译出 9 个槽位）。
- **落地架构（编译期映射 + 运行期翻译，零磁盘 I/O、零引擎改动）**：
  1. **编译期追踪 `installEventTrace()`**：包裹 `Command.compile` 与**每一条指令编译器**（原型方法 + `setNumber`/`setString`/`setBoolean` 这类类字段自有属性 + `compileScript` 自定义指令通道），按引擎同款推槽规则还原「原始指令下标 ↔ 编译槽位区间」映射表，并存入 `WeakMap<编译结果, 映射表>`；嵌套分支子列表由递归编译各自登记，天然支持 `event.commands` 切换到分支列表后的独立翻译。计账只在「待编译原始指令的 id 恰好等于本次调用」时发生，故 `compileActor`/`compileNumber`/`compileJumps` 等内部辅助调用完全不干扰映射；
  2. **事件启动钩子 `installEventCallHook()`**：包裹 `EventHandler.call`（`event.ts:766` 是全局/角色/界面/触发器事件的**唯一启动入口**），逐条登记在册，并复用 `wrapEventInstance` 给每个事件装上「索引推进时间戳」探针；
  3. **状态机 `eventStateOf()`**：完成 / 暂停（`update === EventHandler.wait`）/ 等待计时（`timer.duration > 0`，回传剩余毫秒）/ 挂起（**索引超过 1 秒没推进**）/ 执行中；`finish()` 后由引擎回调自动出册，长时挂机不积压引用（上限 200 条护栏）；
  4. **幽灵判定 `eventGhostInfo()`**：宿主 `.destroyed === true` → 红标【所属对象已被删除】；挂起 ≥ 60 秒 → 【卡住超过 1 分钟】；连每帧驱动都断了 → 【已经不再运行】；
  5. **一键结束 `finishEvent(id)`**：调引擎原生 `event.finish()` 触发结束回调与引用摘除（对应引擎盲点：普通挂起事件零监控，仅 `Stats.debug` 下查 independent 1 分钟）；
  6. **白话指令表 `COMMAND_PLAIN`**：覆盖 100+ 条引擎指令的中文名（设置数值/弹出选项/施放技能/加载场景…），并对 `wait`（"等待 500 毫秒"）、`showText`（文本摘要）、`showChoices`（项数）、变量类指令（GUID 单独回传、由界面经存档台字典解密为中文变量名）做参数级白话；变量名取不到时自动退化，**界面绝不裸露 GUID 与英文枚举**（铁律⑱）。
- **UI 落地（控制台报错页 → 运行日志页）**：
  1. 主页第 2 卡与页面标题统一更名 **「运行日志」**（文案：报错、事件流水与卡住排查），页面内新增「事件流水」与「幽灵事件侦探」两张卡片，原报错黑匣子与工程体检卡片保持原样；
  2. 流水行 = 时间 + 动作徽标（开始/进行中/等待中/已暂停/停住了/结束了，各自配色）+ 事件名 + 「第 N / M 步」+ 白话指令描述，同名同动作条目 600ms 内自动合并计数 `[xN]`（**防高频事件刷屏**），环形缓冲严格 20 条；
  3. 幽灵卡片 = 事件名 + 红/橙标签 + 中文归属描述（`instanceof` 判别后映射为「角色「勇者」」，压缩构建改名也不受影响）+ 已停住时长 + 停在第几步在做什么 + 【结束事件】按钮；
  4. **铁律⑲ 合规**：`renderEventBlackbox()` 走快照签名守卫，内容未变时绝不重建 DOM；一键结束后的反馈文案走 4 秒「短时提示位」，不会被下一帧常规文案立刻覆盖。
- **门禁与回归凭证**：
  1. `build.cjs` 锚点由 30 项扩至 **35 项**（事件流水面板骨架 / 幽灵侦探面板骨架 / 渲染函数 / `probe.getEventBlackbox()` 接线 / `probe.finishEvent(` 接线）；
  2. 新增 `tests/test-event-blackbox.mjs`（**54 项断言全绿**）：以「高保真伪引擎」逐条复刻 `command.ts:120` 的推槽语义（禁用指令 / null 结果 / `showChoices` 双槽 / `block` 三槽 / 分支子列表递归 / 已编译函数占槽），实测「跳过禁用与 null 后仍精确翻译回第 5 步」；另覆盖多槽槽位翻译、嵌套分支独立翻译、四态状态机、宿主已销毁红标、一键结束、流水 20 条上限与合并计数、以及 **Proxy-DOM 端到端冒烟**（真跑 `hud-overlay.js` 并点击【结束事件】按钮，断言事件真的被 `finish()` 摘除、反馈文案真的回填）；
  3. `tests/run-all.cjs` 扩至 **8 套**，全量回归 **207 项断言 8/8 套通过**；
  4. **回归预言机硬化（非产品回归）**：`test-autoupdate.mjs` 第 2 节的「本地已最新」原先直接拿工作区真实版本号去比远端，**只要本地领先远端（改了版本但还没 git push）就必然误报**；改为「把沙箱内本地版本就地替换为远端真实版本」再断言 `hasUpdate === false` —— 语义一字未改（本地 == 远端 → 不提示更新），但不再与「仓库推到哪一版」耦合；
  5. **真机 E2E 凭证（真实 Yami 引擎运行时，非沙箱模拟）**：复用 `.e2e-tmp/ext-smoke.cjs` 的 `world:MAIN + document_start` 注入方式，在无头 Chrome 里加载真实工程 `D:/GAME-20240905` 并逐条断言 ——
     - `Command` / `EventHandler` / `EventManager` 在 MAIN world **确实可达**（编译期追踪与启动钩子的前提成立；注意它们是**全局词法绑定**，`window.Command === undefined`，必须用裸标识符访问）；
     - `getEventBlackbox().trace === true` 且 `callHooked === true`；
     - 取**工程真实 `.event` 指令数据**（真实 `setString` + 其禁用副本 + 数值 `wait` + 真实 `if` 分支）跑**真实 `Command.compile`**，实测映射表：`槽1 → 第 1 步 设置文本`、`槽2 → 第 3 步 等待 1 毫秒`（禁用的那条被精确跳过）、`槽3 → 第 4 步 条件判断`，`total = 4` 与原始指令条数一致；等待态识别（真实 `timer.duration`）与 `EventHandler.finish()` 均生效；
     - 真实 HUD 的「运行日志」页渲染出事件流水面板，徽标显示 `[记录中 4 条]`；
     - 结果 **19 项断言全绿**（脚本 `.e2e-tmp/_blackbox-real.cjs`，`guidMap` 为空的环境限制项显式 SKIP）。
- **文档对齐**：修正蓝图里程碑表（v0.8.0 实际内容、v0.9.0 事件黑匣子、存档安全体验顺延 v0.10.0）、HANDOFF §1.1 第 9/10/11 条状态与版本号，清除第 353 行游离残文，新增铁律⑳「引擎返回值与数据生命周期双重误读」。

#### 2026-09-10 · 事件黑匣子面板「小白口径」文案整改 (v0.9.1)
- **触发原因**：用户重申目标用户画像 —— **会用引擎做游戏、但不懂代码、计算机原理也很差**。回头按这把尺子审自己刚交付的 v0.9.0 面板，发现**我自己违反了铁律⑱**：面板里写满了「宿主已销毁」「长时间无进展」「已停止更新」「挂起」「滞留」「指令名识别未就绪」「结束回调/引用摘除」这类黑话。**功能是对的，话没说到用户心里**。
- **整改原则**：面板内每一句可见文字都改写成「他会怎么描述这件事」，而不是「引擎里这叫什么」。范围**严格限定在本次新增的事件黑匣子面板**（其余模块文案一字未动，旧的「探针未就绪」等残留按用户裁决暂不处理）。
- **对照表（改前 → 改后）**：
  | 位置 | 改前 | 改后 |
  |---|---|---|
  | 幽灵标签 | 宿主已销毁 | **所属对象已被删除** |
  | 幽灵标签 | 长时间无进展 | **卡住超过 1 分钟** |
  | 幽灵标签 | 已停止更新 | **已经不再运行** |
  | 幽灵元信息 | 宿主：角色「勇者」· 已挂起 2 分 13 秒 | **属于：角色「勇者」· 已停住 2 分 13 秒** |
  | 幽灵徽标 | [N 个滞留] / [无滞留] | **[N 个卡住] / [一切正常]** |
  | 幽灵空态 | 没有发现滞留事件。 | **没有卡住的事件，剧情都还走得动。** |
  | 结束反馈 | 已结束该滞留事件，引用已摘除。 | **已结束这个卡住的事件。** |
  | 按钮悬浮提示 | 调用引擎原生结束回调，拔除滞留引用 | **结束这个卡住的事件，让它彻底停下来** |
  | 流水动作徽标 | 启动/执行/等待/暂停/挂起/结束 | **开始/进行中/等待中/已暂停/停住了/结束了** |
  | 流水状态词 | 执行中 / 无进展 | **进行中 / 卡住了** |
  | 流水徽标 | [静默] / [仅步骤] / [记录中 N 条] | **[暂无记录] / [仅显示步数] / [已记录 N 条]** |
  | 降级提示 | 指令名识别未就绪，重启工程后重新试玩即可 | **暂时只能看到第几步；重启工程再试玩一次，就能看到它具体在做什么。** |
  | 流水空态 | 暂无事件执行记录。游戏内触发事件或对话后即可看到流水。 | **暂无记录。游戏里触发一次事件或对话，这里就会显示它每一步在做什么。** |
  | 主页第 2 卡副标题 | 报错、事件流水与滞留侦探 | **报错、事件流水与卡住排查** |
- **同步范围**：面板内 3 处**代码注释**（含会进入 DOM 的 HTML 注释）一并改成同一口径；`tests/test-event-blackbox.mjs` 的文案断言同步跟随（**断言即文案回归**）；README 与蓝图中被引用的界面标签（【宿主已销毁】等）一并校正，避免文档描述一个不存在的界面。
- **验证凭证**：`node build.cjs` 35 锚点全绿；`node tests/run-all.cjs` **8/8 套、207 断言**全绿（含改后文案断言）；真机 E2E **19 项断言全绿**，真实页面徽标实测已由 `[记录中 4 条]` 变为 **`[已记录 4 条]`**；`--deploy` 镜像 6 文件 MD5 全一致。
- **结论/教训**：**功能正确 ≠ 文案合格**。这个用户不会去理解「宿主」「销毁」「挂起」，他只会说「角色没了」「剧情卡住了」。与引擎有关的一切内部词汇（宿主/引用/回调/未就绪/静态扫描…）都属于铁律⑱的打击范围，**交付前必须用用户的嘴再过一遍界面文字**。

#### 2026-09-10 · 诊断断点补齐：变量告警定位 + 内存与缓存 (v0.10.0)
- **需求来源**：用户追问「这个插件解决了引擎的缺陷吗？能让小白用得舒服、快速解决问题吗」。复盘时**先按「会不会让目标用户卡住」重排了引擎缺陷**（不是按工程刺眼程度）：
  | 引擎缺陷 | 对用户的实际伤害 | 当时覆盖度 |
  |---|---|---|
  | `variable.ts:117-133` 类型不匹配**静默丢弃** | 他用「设置变量」写文本进数值变量 → 游戏毫无反应、零提示 → 只会以为"引擎坏了" | **半覆盖**：看得见症状，**不知道是谁写的** |
  | `event.ts:457-477` 事件层零监控 | "剧情不走但没报错" | 已由 v0.9.0 事件黑匣子补上 |
  | `loader.ts:19-23` 资源缓存只增不减 | "玩久了越来越卡、最后闪退" → 他归因成"电脑不行" | **未覆盖** |
  | 数据销毁 / 39 个全局单例 / 插件无契约 | 对他不可见（是我们的成本） | 不需要解决 |
  结论：**插件并不"解决"引擎缺陷，它补的是「引擎不说话」这件事**；而"看见症状"到"知道去哪改"之间还剩两个断点。用户裁决：**两个都做**。
- **① 变量写入被丢弃 → 定位到「哪条事件第几步·什么指令」**：
  1. 新增 `currentEventLocation()`（probe-core）：复用**事件执行栈 `eventExecStack`** + 引擎的**模块级执行游标 `CommandList` / `CommandIndex`** + **编译期指令映射表**，把"谁在写"翻译成「事件《新手村剧情》· 第 2 / 3 步 · 设置文本 · 场景：新手村」。引擎的 `while (CommandList[CommandIndex++]?.())` 会把游标推过当前指令，故当前指令槽 = `CommandIndex - 1`（这条语义坑已写进注释，接手者别再踩）；取不到引擎游标时回退到事件实例上的 `index`；
  2. 告警记录新增 `eventName / sceneName / step / total / cmdDesc / located / count`（10 秒内同因重复丢弃累计 `count`）；
  3. UI 落到两处：**存档台【变量与开关】每一个变量行下方**（`[写入被丢弃] 类型冲突丢弃 · 事件《…》· 第 2 / 3 步 · 设置文本`，全量变量都能看到，不限已固定项）与 **Pin 监视小窗**（`[异常]` 悬浮提示补全定位，并新增一行可见定位文字）；
  4. 白话格式由 hud 侧 `varWarningLocation()` 统一生成（单点，避免两处文案漂移）。
- **② 内存与缓存：一键清理 + 白话统计（安全优先）**：
  1. **先读引擎定安全边界**（`loader.ts`）：`cachedImages[key]` 既可能是**加载中的 Promise** 也可能是已加载 `<img>`；`cachedUrls[path]` 是 objectURL，且**引擎在图片 onload 时若 `save=false` 就会 revoke 掉它**（loader.ts:254-256）→ 所以「清图片」必须**同步清掉 `cachedUrls`**，否则下次重新加载会拿到失效 URL 导致图片裂开；`cachedBlobs[url]` 才是真正的二进制内存；
  2. `getCacheInfo()`：分开统计 已加载图片 / 加载中 / objectURL / Blob 数量与体积 / JS 堆内存 / 是否正在加载；
  3. `clearAssetCache()`：**安全闸门** —— `Loader.complete === false`（有正在进行的加载）时**直接拒绝**并回传 `reason: 'loading'`；清理时**跳过 Promise 条目**、释放图片与对应 objectURL、顺手回收孤儿 Blob；回传 before/after 供界面展示"清了什么"；
  4. **真机暴露的构建差异（重要，别踩）**：`D:/GAME-20240905` 的真实运行时里 **`Loader` 取不到**（`eval('Loader')` 直接 ReferenceError），而同一页面上 `Data` / `Command` / `EventHandler` / `Scene` / `Callback` 全部可达 —— 即**不同引擎构建暴露的全局词法绑定面并不一致，任何新功能都不能硬依赖某个全局名字**。故新增 `findAssetLoader()`：先按候选名（`Loader`/`FileLoader`/`ResourceLoader`/`AssetLoader`）取，再在可达引擎对象上找「身上挂着 `cachedImages` 的那个 loader」；
  5. **能力不可用就如实降级，不假装可用**：取不到加载器时 `getCacheInfo()` 回传 `available: false`（内存信息照常给），hud 卡片变成「[仅内存] + 已用内存 N MB（当前引擎版本读不到图片缓存）」并**隐藏清理按钮**、改提示「变卡时先重启工程试玩一次」。真机 E2E 专门断言了这条降级路径（`available=false` 且 `clearAssetCache` 返回 `no-loader` 而非抛错）；
  6. UI：性能分析·普通模式新增「内存与缓存」卡片（状态徽标 正常/加载中/偏多/仅内存 + 白话统计 + 【清理缓存】按钮 + 点击结果反馈）；**清理只由点击触发，绝不进心跳**（铁律⑲），渲染走快照签名。
- **验证凭证**：
  1. `build.cjs` 锚点 35 → **40 项**（新增 内存与缓存卡片骨架 / 一键清理按钮 / `probe.getCacheInfo()` / `probe.clearAssetCache()` / `varWarningLocation` 五条）；
  2. 新增 `tests/test-diagnosis-gaps.mjs`（**35 项断言全绿**）：用「伪引擎」复刻引擎的 `while (CommandList[CommandIndex++]?.())` 游标语义与 `variable.ts` 静默丢弃语义，实测告警能落到「禁用指令被跳过 → 第 2 步 · 设置文本」并累计次数；缓存部分逐条验证**安全闸门**（加载中拒绝且一个字节没动、加载中的 Promise 条目被完整保留、objectURL 同步清除并 revoke、孤儿 Blob 回收、清理后统计归零、**取不到加载器时如实降级**）；
  3. `tests/run-all.cjs` 扩至 **9 套**，全量 **241 断言 9/9 全绿**；
  4. 真机 E2E **23 断言全绿 / 0 失败**（2 项环境 SKIP：静态服务下全局事件未注册、该引擎构建未暴露资源加载器），其中缓存清理在真机按降级路径验证通过（不抛错、如实标注）。
- **顺手修掉的测试脆弱点（非产品回归）**：`test-autoupdate.mjs` 第 4 节原先拿「raw 通道读到的远端版本」去比对「jsDelivr 通道下载下来的文件内容」——两个通道在 CDN 追赶期必然不一致（本次就撞上：raw 已 0.9.1 而 jsDelivr 仍 0.8.1）→ 改为断言**载荷自洽**（内存版本 == 实际下载到的 manifest 版本；下载的 `probe-core.js` 里的 `PROBE_VERSION` == 下载到的 manifest 版本），并把「拿远端版本做等值断言」的地方改为**断言前现读一次**。
- **顺带发现（本轮未处理，留给用户裁决）**：
  1. **0-Emoji 门禁有盲区**：`build.cjs` 的正则覆盖 `1F300-1F9FF / 2600-26FF / 2700-27BF / 1F1E0-1F1FF`；性能页快速排查按钮里的 `⏸`（U+23F8）**不在范围内**（实际 5 处却能过门禁）；而本次我在 probe 注释里写的一个警告三角符号（U+26A0，落在 2600-26FF 区间）**被门禁正确拦下** —— 同一套规则一漏一拦，证明盲区真实存在；
  2. **存档台变量面板裸露 GUID**：变量行渲染 `ID: <16位GUID>`（`renderVarsPanel`），与铁律⑱「界面绝不裸露 GUID」冲突——属历史遗留，本次未动。

#### 2026-09-10 · 工程体检输出改造：折叠 + 分级 + 白话影响 + 入边补全 (v0.11.0)
- **触发**：用户问「运行日志里的工程体检，为什么能发现 203 个异常？」。实测拆解 `D:/new-game`：**203 = 200 断链 + 3 死事件**，而 200 条断链其实只有 **55 个不同的 ID**（同一个 ID 最多被引用 12 次）→ 数量在表达上被放大；继续排查又发现**字典缺口导致的误报**与**同一档红字混报三种性质**的产品问题。
- **逐条核实的引擎事实（本轮新增到技术底牌）**：
  1. **未知属性 = 静默丢弃两条路**：载入侧 `variable.ts:256 Attribute.loadEntries` 是 `if (attr !== undefined)` 才写入；运行侧 `command.ts:478` 更直接 —— `const attrKey = Attribute.get(key)?.key; if (!attrKey) return Function.empty`，即**给已删属性赋值的指令会被编译成一个什么都不做的空函数，既不报错也不生效**。所以"可能失效"不是猜测，是源码实锤；
  2. **界面的事件绑定是内联指令**：`.ui` 里形如 `"events":[{"type":"create","enabled":true,"commands":[...]}]`，**不引用独立 `.event` 文件** → 界面绑定不会给独立事件文件产生 GUID 入边；
  3. `callEvent` / `setEvent` / `stopEvent` 用 `params.eventId`；`registerEvent` 是**内联 commands**（压根没有事件 GUID 入边）；
  4. **资产清单是目录不是引用**：`Data/manifest.json` 列出全部资产 GUID，若计入"引用"会让死事件判定整体失效 → 必须整份跳过。
- **落地改造（probe 侧）**：
  1. **单趟扫描**同时收集「定义」与「引用」（旧版先单独跑一趟 `collectPresets`，白解析一遍全部资产）；合法目标改为**三源判定**：`names`（文件名 + `Data/*.json` 字典）∪ **`definedIds`（资产文件内部以 `"id"` 定义的 GUID —— 界面元素属性键、场景节点、动画帧等）** ∪ `nodePresets`。**这是误报的主因**：旧字典只覆盖文件名与 Data，跨文件引用界面元素属性键时必然全被误报；
  2. **按 GUID 折叠**：同一 ID 只出一条，带 `count`（引用处数）、`fileCount` 与 `files`（涉及文件，最多记 10 个）、`samples`（最多 8 个上下文）；
  3. **按影响分级 + 白话影响说明**：`resource`（立绘/图片/素材丢失）→ **high「会影响运行」**；`property` 且出现在指令里 → **mid「可能失效」**（写明会被编译成空函数）；`property` 只出现在资产初始值里 → **low「历史遗留，不影响运行」**（写明载入时被默默忽略）；其它按是否在指令里落 mid/low；
  4. **死事件入边补全**：`eventId` 参数 ∪「全工程任何位置出现过该 GUID」∪ `definedIds` ∪ 脚本 `EventManager.call/emit/get('<guid>')` ∪ **脚本里出现事件名**（保守兜底）；
  5. `stats` 新增 `missingIds`（折叠后类别数）/ `missingRefs`（引用处数）/ `levels`（高/中/低计数）。
- **落地改造（hud 侧）**：体检卡片改为「**折叠卡 + `xN` 徽标 + 涉及文件（前 3 个 + 等 N 个）+ 分级徽标 + 一句白话影响**」；状态徽标在有关键项时显示 `[N 处会影响运行]`，否则 `[N 项待清理]`；**卡片正文不再裸露 GUID**（GUID 挪到悬浮提示与「复制信息」里给开发用），换成语义描述 + 涉及文件，更利于小白定位。
- **真机对照证据（同一个探针、同一台机器）**：
  | 工程 | 改版前 | 改版后 |
  |---|---|---|
  | `D:/new-game` | 203 张无差别红卡 | **102 张**：引用丢失 **99 类 / 545 处**（会影响运行 11 · 可能失效 73 · 历史遗留 15）+ 死事件 3 |
  | 模板工程 `arpg-ts-chinese`（干净工程） | — | **0 张**（证明误报基本清零） |
- **那 3 个死事件的定性（用户会问，所以写死在这里）**：`主菜单_多属性复合整数属性_更新` / `最大生命值_更新` / `最大魔法值_更新` 均为 `type: "common"`、**带真实指令**（8 条 / 2 条），全工程只在 `Data/manifest.json` 出现过 → 是**真·遗留孤儿事件**（多半是主菜单改成内联绑定后剩下的），不是误报，可放心删。
- **对用户工程的结论（可直接照做）**：`new-game` 那 545 处绝大多数是**属性表被重建/删改后，怪物模板与「敌人怪物强化」事件还留着旧属性键**；其中**最值得修的是 `Assets/角色/怪物/敌人怪物强化.event`** —— 它给已不存在的属性做 `mul`，按 `command.ts:478` 这段是**空转**，等于整个强化事件没生效。
- **验证凭证**：`build.cjs` 锚点 40 → **43 项**；`tests/test-project-audit.mjs` 由 21 扩至 **32 断言全绿**（新增折叠字段、分级与白话影响、字典三源、界面绑定/脚本入边不被误判死事件）；`tests/run-all.cjs` **9 套 252 断言全绿**；`--deploy` 镜像 6 文件 MD5 一致。
- **顺手修掉的测试自身缺陷**：`test-fix-regressions.mjs` 的「analyzeError 分类都有中文标签」原先**全库通扫** `category:`，把工程体检的另一套分类域也当成报错分类 → 改为只扫 `analyzeError` 函数体。
- **门禁再抓两次（记录在案，证明门禁有效）**：① 我在 probe 注释里用了那个被禁用的界面用词，被**中文术语自检**拦下（应为「界面元素」）；② 因一次被中止的构建已先执行过 `--bump`，版本被多推到 v0.12.0，已用 `--bump 0.11.0` 显式回退并让文档对齐。


#### 2026-09-10 · UI 打磨：过渡属性收敛 + 按压触感 + 图标体系统一（工作区改动，随下一版发布）
- **排查方式**：`src/style.css` 静态扫描 + **真机计算样式实测**（`getComputedStyle` / `document.getAnimations()` / 真实 `mouse.down()` 分段测量），覆盖 163 个元素与 5 个页面截图。
- **过渡属性收敛**：`transition: all` 由 **21 处归零**，逐条改为按各自 `:hover/.active` 变体推导出的精确属性（如 `.yami-quick-btn → color, background-color, border-color, scale`）；简写归一（`background→background-color`、`border→border-color`），剔除 `cursor`/`pointer-events`（本不可动效）与 `font-weight`（会引发文字重排）。
- **按压触感**：全表原 **0 条 `:active`**，新增 17 个控件的 `:active { scale: 0.96 }`（better-ui 规定值）。真机实测按下态由 `scale:none` 变为 `scale:0.96`，与悬停态可区分。**坑位记录：`scale` 是独立 CSS 属性，不体现在 `transform` 里，量按压反馈必须单独读 `getComputedStyle(el).scale`，否则会误判「无反馈」。**
- **图标体系统一**：废弃 `⏸/▶/▸/▾/⤴` 共 13 处文本字形，全部换成**官方 Remix Icon v4 矢量 path**（新增 IIFE 顶层 `ICON_PATH` + `ico(name)`，遵循铁律⑯）；路径数据取自 Remix-Design/RemixIcon 官方仓库，未做改动；刷新率排查按钮的状态文案同步由 `textContent` 改为 `innerHTML` 组装，颜色随 `.active` 的 `currentColor` 走。
- **出场动效**：大盘进场时序移至 `.yami-perf-dock.show`（0.2s），基础规则承载更短的出场（0.16s + 更柔曲线 `cubic-bezier(0.2, 0, 0, 1)`），实测两态 transition 已分离。
- **验证凭证**：`build.cjs` **44 项锚点** + 0 Emoji + 术语自检全绿；回归 **9/9 套通过**；真机复测「带时长的 `transition: all`」归零、`:active` 生效、同心圆角仍无违例、常驻动画 0 条。
- **未验证（如实记录）**：场景台行箭头与卡顿列表上传标记的**视觉**确认未做——真机夹具中游戏未启动，场景行无数据可渲染；二者与已验证的暂停图标同走 `ico()` 机制与同一官方图标源。

#### 2026-09-10 · 布局加固：分组间距 / 窄宽溢出 / 逻辑属性（工作区改动，随下一版发布）
- **实测方式**：真机 **7 档宽度（1440→500px）× 5 页面**扫描横向压榨（`scrollWidth > clientWidth` 且非可滚容器）与纵向裁剪（`overflow:hidden` 且内容超出），并实测组内/组间间距像素值。
- **组间间距（改的第一处没生效，靠实测才发现）**：`.yami-suite-page { gap }` 被各页面容器自己的 `!important` 压回 8–10px（`.yami-errors-container` / `.yami-scene-container` / `.yami-save-container`）——真机先照出 `[组内 gap] .yami-suite-page=8px` 与理论值不符。三个容器统一改 `16px` 后实测：**组间 `16/24/16/16/16px`，组内 6–8px，比值 2–2.7 倍**（better-layout 要求组间 ≥ 组内 2×）。
- **窄宽溢出（≤500px 视口）**：
  1. 报错页长 URL 是**不可断行 token**，撑破卡片（`.yami-error-source 198>190`）→ 加 `overflow-wrap: anywhere`（`.yami-error-msg` 同）；
  2. 作弊页变速按钮行不换行（`.yami-cheat-grid 208>198`）→ `.yami-speed-btns` 补 `flex-wrap: wrap`，`.yami-speed-btn` 由 `flex: 1` 改 `flex: 1 1 auto` + `min-width: 44px`。**坑位记录：没有 `min-width` 时，`flex-basis: 0` 的 flex 项永远不会触发换行，只会撑破父级**；
  3. 三处内联 flex 行（`.yami-cheat-btn` 所在）补 `flex-wrap: wrap`。
- **呼吸感**：`.yami-quick-toggles` 6→8px、`.yami-error-filter-bar` `4px 5px`→`6px 8px`、`.yami-speed-btns` 6→8px（实测相邻控件间隙由 5–6px 提升到 8px）。
- **逻辑属性**：物理方向属性**全表清零**——CSS 25 处 + JS 内联 5 处，`margin/padding-left|right` → `*-inline-start|end`、`text-align: right` → `end`；真机物理定位（如大盘 `right: 8px`）保持不动。
- **注记（非代码回归）**：全量跑时 `test-autoupdate.mjs` 曾 5 项 FAIL，单独复跑 24 PASS/0 FAIL —— 输出显示 `通道 {"raw":"0.0.0","jsdelivr":"0.8.1"}`，raw 通道抖动 + jsDelivr 缓存旧版所致（与 v0.7.1 记录同类网络问题）。

#### 2026-09-11 · AI 全能副驾与 yami-mcp 全流程集成 (v1.0.0 正式里程碑)
- **业务诉求与目标画像**：
  在无需 9222 远程调试端口的前提下，打通「DanJuan 妙妙插件 + yami-mcp + 本地 DeepSeek / OpenAI 兼容大模型」，让小白和独立开发者能在游戏与编辑器内通过全白话控制 Open Yami 的所有操作（包括编写/编译 TypeScript 脚本、编写/调试/修复事件、读写全量数据表、触发试玩与自动化测试、回滚修改）。
- **架构落地与模块交付**：
  1. **AI 视图与宿主服务 (`ai-agent.js` / `ai-host.js`)**：
     - 大盘第 6 主视图 `#page-ai-agent` 落地，对齐 0 Emoji、暗黑调色板与工业文字标签；
     - 5968 本地代理服务，支持流式 SSE 交互；
     - DPAPI（Windows CryptProtectData）本地物理加密密钥保护，杜绝明文凭证泄漏；
     - 危险写操作生成白话卡片 + Diff 高亮预览 + 显式【确认执行】与【一键回滚】机制。
  2. **内置 MCP 工具服务器 (`runtime/yami-mcp/`)**：
     - 单一真实源落盘并在构建/热更新时同步级联（`server.js`、`db-manager.js`、`event-builder.js`、`file-ops.js` 等 8 个核心模块，哈希 100% 匹配）；
     - 工具集扩展至完整的 27 类：工程元数据、资源读写与编译校验、事件解析与语法树构建、数据表与变量管理、编辑器与试玩控制；
     - 原生 TS 编译器集成：通过定位引擎自带的 `@typescript/typescript-win32-x64/lib/tsc.exe` 实现 0.3 秒无损快速类型排查（`ok=true, errorCount=0`）。
  3. **三大高危漏洞加固与安全门禁闭环**：
     - **大文件上下文防挤爆门禁**：`read_resource` 支持 `args.key` 分节读取，超 200KB 文件默认安全截断并输出结构导航；
     - **资产删除全局引用反查拦截**：`delete_resource` 物理删除前递归全工程排查 GUID 入边引用，有引用时强制拦截（需 `force: true`）；
     - **IIFE 表达式单次调用保护**：编辑器 CDP 动作表达式（`File.save` / `playtest`）自闭包封装，根除连发重复调用隐患。
  4. **热更新端到端闭环加固**：
     - `UPDATE_CONFIG.updateFiles` 扩至 15 个关键文件，全面覆盖 `runtime/yami-mcp/` 子目录及 AI 模块；
     - 严格遵守 `probe-core.js` 首位写盘、`manifest.json` 末位版本门闩写盘次序；
     - `test-autoupdate.mjs` 端到端回归测试 100% 通过。
- **全量验证凭证**：
  1. `node build.cjs`：**45 项核心锚点 + 原生 button 负向断言 + 0 Emoji + 术语合规 100% 全绿**；
  2. `node tests/run-all.cjs`：**10/10 套自动化回归测试（280+ 项断言）全部 PASS**；
  3. `yami-mcp/test.js`：**22/22 项工具链单测全绿**；
  4. `test-compile.js`：真实工程 TypeScript 原生编译 **ok=true errorCount=0**；
  5. 镜像部署验证：`--deploy` 生成生产镜像，MD5 与单一真实源 100% 完全一致。


## 2.2 致命踩坑与铁律档案

后续接手开发任何新模块时，**必须严格遵守以下血泪经验**：

### ① CSS `!important` 穿透内联样式导致“幽灵弹窗”
- **现象**：明明版本没变，一启动试玩却总是弹出写死的“发现新版本 v0.4.1”升级条，更新后下次启动依然在。
- **根因**：CSS 规则里写了 `.yami-update-banner { display: flex !important; }`，它强行穿透并覆盖了 HTML 骨架上的行内样式 `style="display: none;"`。
- **铁律**：所有弹窗、提示条、横幅等动态显隐组件，**CSS 默认规则必须锁死为 `display: none !important;`**；只有在 JS 明确判定需展示时，才赋予 `.show` 类（`.yami-update-banner.show { display: flex !important; }`）。

### ② 编辑器全局 `components.css` 的 `button` 粗暴绝对定位
- **现象**：在游戏内测试正常，但在 Open Yami 编辑器窗口加载时，按钮严重变形、错位、层叠堆积在左上角。
- **根因**：Yami 编辑器源码 `Project/css/components.css` 声明了全局规则：
  `button { position: absolute; width: 88px; height: 20px; }`。
- **铁律**：插件内部**严禁使用任何原生 `<button>` 标签**！全部使用 `<div role="button">`，并在 CSS 中显式声明 `position: static !important; user-select: none !important; box-sizing: border-box !important;`。

### ③ 动态文本膨胀导致的 Flex 按钮折行与错位
- **现象**：点击“一键热更新”后，按钮文字变成“[更新中] 更新中 (1/5)...”，按钮突然折行、上下伸缩，导致大盘整体抖动。
- **根因**：Flex 容器未声明 `gap`，子按钮未声明 `flex-shrink: 0` 和 `min-width`，且行高未锁死。
- **铁律**：状态切换按钮必须锁死 `min-width: 86px; height: 26px; line-height: 26px; white-space: nowrap !important; flex-shrink: 0 !important; display: inline-flex; align-items: center; justify-content: center;`，文案保持精炼（如 `[更新中] 更新 1/5`）。

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
- **铁律**：诊断算法必须具备“帧率自适应能力”——先判定 `isSmoothGame = (fps >= 55 && avgCompute < 14)`。若游戏满帧顺畅，高 DrawCall 仅作为“[建议] 低配优化建议”温和呈现，健康分维持 90+ 绿标，严禁机械恐吓！

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

### ⑭ 子页面专属组件（如专业模式 Tab 条）在首页幽灵现形陷阱
- **现象**：首次进入插件大厅且当前处于专业模式时，首页大厅正上方会突兀露出原本属于性能分析专用的 4 个 Tab（刷新或跳出回来才消失）。
- **根因**：双模控制器 `updateModeUI()` 内部只粗暴判断了 `currentMode === 'pro'` 就将 `tabsBar` 设置为 `display: flex !important;`，完全忽视了此时当前页面是不是 `profiler`；且 HTML 骨架与 CSS 规则中未对该组件施加默认隐藏。
- **铁律**：任何属于特定子页面的专属 UI 组件，其显隐控制必须严格附带当前页面守卫（如 `(currentView === 'profiler' && isPro) ? 'flex' : 'none'`）；且默认 CSS 状态必须锁死为 `display: none !important;`。

---


### ⑮ 同类高频错误帧循环刷屏与指纹聚合（Fingerprint Grouping）
- **现象**：在 `Game.loop` 渲染或逻辑更新循环中一旦发生异常，每秒高频抛错 60 次，黑匣子瞬间堆满 100 条重复卡片把其他有用错误冲垮，同时造成频繁的 DOM 重绘与严重卡顿。
- **根因**：缺少错误特征指纹抽象，无脑将每次事件作为独立记录入队。
- **铁律**：计算同源唯一指纹 `fingerprint = (type || 'error') + '::' + message.slice(0, 100) + '::' + source + '::' + lineno`。命中已有指纹时仅执行 `count++`、刷新最新发生时戳并将记录升至队首；黑匣子列表仅保留不同指纹的独立项，界面醒目呈现 `[xN次]` 徽章，根除死循环刷屏。

### ⑯ IIFE 模块顶层工具提升与防断链实践（Top-Level Scope Hoisting）
- **现象**：转义函数 `const escapeHtml = esc;` 依赖 `function esc` 的函数声明提升才能工作，且散落定义在内部业务函数（如 `initHUD`）中；一旦后续重构拆分业务代码，外部别名立刻遭遇 `ReferenceError` 断链。
- **根因**：基础纯函数工具未提升至模块最外层顶级作用域，与具体 UI 初始化逻辑混杂。
- **铁律**：所有与 DOM/生命周期无关的无状态基础纯函数（如 `esc` / `escapeHtml`、数值格式化等），**必须统一声明在 IIFE 最顶层的公共工具区**，彻底消除闭包依赖与格式污染，为未来架构拆分筑牢安全防线。

### ⑰ 未读计数无界增长防范与有效条数语义收敛（Bounded Counter）
- **现象**：长时挂机试玩若遇到死循环报错，后台未读计数器 `unreadCount` 每次无脑 `++`，数值膨胀至数十万的大数，未来若渲染到界面标签或红点徽章会造成严重的排版溢出与视觉车祸。
- **根因**：计数器未与黑匣子有效实体建立边界约束。
- **铁律**：未读计数严格收敛至黑匣子有效条数语义：`state.errorUnreadCount = Math.min(state.errorHistory.length, (state.errorUnreadCount || 0) + 1);`。同指纹

### ⑱ 小白友好文案铁律（Plain-Language Copy Mandate）
- **现象**：目标用户「会用 Yami 但计算机理论薄弱」；界面若直接透出 `NullPointer`、`visible=false`、`Actors/Anims/Triggers` 等英文枚举名或代码残留，普通人完全看不懂、不知道怎么用，功能形同虚设。
- **根因**：开发者习惯把内部枚举名/字段名直接当 UI 文案使用。
- **铁律**：
  1. 所有用户可见文案必须中文白话直白（空指针 / 已隐藏 / 角色 / 触发器 / 粒子…），内部英文枚举必须经统一中文映射（如 `CAT_LABEL`）后再进 UI；
  2. 同一功能的重复入口收敛为一条小白路径（如场景实体只保留主页白话检视页，专业模式 tab 不重复暴露）；
  3. 专业术语默认藏在专业模式，普通模式禁止出现英文键名与代码残留。高频重复错误不虚增未读数，彻底杜绝计数器无界溢出。

### ⑲ 全局心跳/轮询刷新必须带守卫（Heartbeat Guard）
- **现象**：存档台手动输入数值 150ms 后被磁盘旧值覆盖、输入框失焦；报错页展开的源码自动收起、滚动位置反复回顶；场景实体台二次进入后行展开失效、搜索框每敲一个字就失焦。
- **根因**：`setInterval(..., 150)` 统一心跳对当前激活页面无条件调用 `refresh(ctx)`，而 `SaveLab.refresh` 每次都「重读磁盘 + 整体重建 `innerHTML`」、`renderErrorsList` 每次都重建列表——输入元素被销毁即失焦，未提交的编辑被覆盖，DOM 态（展开/滚动）被重置；`SceneLab.destroy` 又只清引用不解绑监听。
- **铁律**：
  1. 任何被心跳/轮询反复调用的 `refresh` 必须自带守卫，三选一或组合：**焦点守卫**（面板内输入元素持有焦点时跳过）、**脏标记**（有未保存改动时跳过，提交后清除）、**快照签名**（数据未变时跳过重建）；
  2. 常驻容器（如 `#yami-scene-root`）上的事件监听，`destroy()` 必须用保存的引用 `removeEventListener`，禁止 `bind()` 后就地丢弃引用；
  3. 需要重建包含输入框的 DOM 时，重建后必须回填焦点与光标位置。

### ⑳ 引擎返回值与数据生命周期的双重误读（Event Black Box 血泪）
- **现象**：事件黑匣子第一版把「事件被指令拦住」当作挂起依据，结果**每个正在正常运行的事件都被判成挂起**；而蓝图原定的「运行时经 `Data.events[id].commands[index]` 反查指令名」在真机里**永远取不到值**。
- **根因（两条引擎事实，均已逐行核对源码）**：
  1. `event.ts:654` 的 `EventHandler.prototype.update()` 返回的是 **`this.complete`**，即事件没跑完时**每帧都返回 `false`** —— 「返回 false」根本不能代表卡住；真正的挂起信号是**「指令索引多久没有推进」**（`event.index` 长时间不变）。同时 `event.ts:690/703` 会把 `update` 整体替换成 `EventHandler.wait` / `EventHandler.complete`，`event.ts:681` 换成计时器 `tick`，因此**只有比对 `event.constructor.wait/complete` 与 `timer.duration` 才能区分 暂停/计时等待/正常执行**（探针包装 update 时必须存下 `implRef` 才能比对）。
  2. `event.ts:88` 引擎初始化读完数据即 **`delete Data.events`**；且 `command.ts:120` 的编译会**跳过禁用指令（`!` 前缀）、跳过 null 结果、把 `showChoices`/`block` 一条指令展开成多个槽位**，所以 `event.index` 是**编译后槽位下标，与原始指令下标并不相等**。
- **铁律**：
  1. 判定引擎状态**禁止只看布尔返回值**，必须结合索引推进时间戳、`timer.duration` 与 `update` 的实现体身份；
  2. 任何依赖引擎运行时数据结构（`Data.*`）的反查方案，动手前必须确认该结构**在运行时是否仍然存在**（Yami 大量 `delete Data.xxx`）；
  3. 需要「运行下标 → 原始指令」时，唯一可靠做法是**在编译期埋点建立映射**：包裹 `Command.compile` 与逐条指令编译器（`Command[id]` / `compileScript`），按引擎同款推槽规则（函数占 1 槽、禁用/null 不占槽、数组按长度占槽）还原映射表，并允许嵌套分支各自登记各自的表。

### ㉑ 滚动条样式必须走「单一事实源」选择器组（Scrollbar Single Source）
- **现象**：运行日志页的「事件流水」「幽灵事件侦探」两个列表露出**系统默认亮色滚动条**，在暗黑大盘里异常扎眼；用户反馈「已经提过很多次了」。
- **根因**：滚动条样式此前一直是**「谁新加滚动容器谁自己补一条」**——`style.css` 里为此散落了 10 处各写各的 `::-webkit-scrollbar` 规则（宽度还分成 3/4/5/6px 四档），于是**每加一个模块就漏一个**，本次新增的两个列表就漏了。
- **铁律**：
  1. 滚动条**颜色只在 `src/style.css` 末尾的「滚动条单一事实源」选择器组里定义**（track `#181818` / thumb `#383838` / hover `#4a4a4a` / corner `#181818`），宽度按设计分档留在各容器自己身上；
  2. **任何声明了 `overflow: auto|scroll` 的容器都必须出现在该选择器组里**，新容器还要自带 `::-webkit-scrollbar { width/height }`；
  3. 该要求已**机器门禁化**（`build.cjs`「铁律㉑」段）：构建时解析 `style.css`，凡声明滚动却没有 `::-webkit-scrollbar` 覆盖的容器**直接构建失败并打印修法** —— 已用反向实验验证（删掉新容器的滚动条规则后门禁确实报出 `.yami-eventflow-list` 未覆盖）。

### ㉒ 9222 远程调试假象与本地双桥真理（No-9222 Dual-Bridge Paradigm）
- **现象**：试图通过 Chrome DevTools Protocol (CDP) 端口 9222 连接 Open Yami 主编辑器控制 UI 或执行代码，发生连接拒绝（ECONNREFUSED）。
- **根因**：Open Yami 源码（`D:\Documents\GitHub\2`）中 `main.ts` 与 `Project/Script` 没有任何 `--remote-debugging-port=9222` 启动参数或监听端口，仅在 `main.ts:891` 有一个晚于 `app.whenReady()` 的 IPC switch 接口，无法开启远程调试端口。
- **铁律**：
  1. 放弃 9222 远程控制幻想；
  2. 编辑器控制走 `probe-core.js` 注入编辑器宿主上下文的 5967 本地 HTTP 动作桥（带 Token 鉴权），直接操作 `File.save`、`UndoManager`、`Directory.update` 与原生菜单；
  3. 试玩控制走探针的 5966 HTTP 桥，直接执行 `Input.simulateKey` 与键盘/鼠标物理派发；
  4. 文件与元数据读写走独立 MCP 服务（直接操作磁盘，带哈希校验与自动备份）。

### ㉓ 大型工程文件上下文防挤爆门禁（Large-File Context Truncation）
- **现象**：当大模型读取大型 `.event`（数千行指令）、`.ui` 或 `Data/manifest.json` 时，单次读取吐出数十万字符，瞬间挤爆大模型上下文窗口（Context Window），导致后续规划胡言乱语或直接抛出超出 Token 限制异常。
- **根因**：工具层无脑 `fs.readFileSync(path, 'utf8')` 全量输出，未考虑 LLM 上下文经济性与承载上限。
- **铁律**：
  1. `read_resource` 支持传入 `args.key` 读取指定子节点（如仅读特定事件步或特定配置项）；
  2. 对超过 200KB 的文件默认实施保护性截断（取前 200KB），并在结尾附带清晰白话提示与结构摘要，提示模型如何按子节精确定位读取；
  3. 仅当模型显式指定 `full: true` 时才输出全量大文件。

### ㉔ 资产删除全局引用反查拦截保护（Cascade Reference Check On Delete）
- **现象**：AI 副驾在执行清理或重构任务时，删除了一个“看似孤立”的动画或素材 GUID，导致游戏在特定隐藏剧情触发时抛出 `Resource404` 崩溃退档。
- **根因**：Yami 引擎的 GUID 引用链错综复杂，资产可能被 `.event` 指令、`.ui` 内联事件、`.actor` 模板或脚本代码通过字符串形式引用。
- **铁律**：
  1. `delete_resource` 执行物理删除前，必须递归逆向扫描整个工程的 `Assets/` 与 `Data/` 目录；
  2. 若该 GUID 在任何文件中有入边引用，立即中止删除并输出高危拦截报告，列出所有引用该资源的文件与上下文；
  3. 严禁静默删除；仅在用户显式确认并附带 `force: true` 时才允许强制删除。

### ㉕ TypeScript 编译器选型与原生二进制定位陷阱（Bundled Lib vs Native tsc.exe）
- **现象**：在 MCP 或本地脚本中调用编辑器安装包自带的 `typescript/lib/tsc.js` 进行编译校验时，频繁抛错崩溃：`Cannot find type definition file for 'lib.es5.d.ts'`。
- **根因**：安装包目录下的 `tsc.js` 缺少捆绑的内置基础库文件（`lib.*.d.ts`）；而 Open Yami 引擎平台内真实调用的是预编译的原生可执行二进制。
- **铁律**：
  1. 绝不调用裸 `tsc.js`；
  2. 优先探测并执行引擎内置的原生二进制：`Open Yami RPG Editor/resources/app.asar.unpacked/node_modules/@typescript/typescript-win32-x64/lib/tsc.exe`；
  3. 无法探测时回退至系统全局环境变量中的 `tsc`；
  4. 配合工程的 `tsconfig.json` 执行，做到 0.3 秒极速只读类型检查与错误收集。

### ㉖ 热更新更新清单文件数与目录递归依赖（Update Manifest Cascade Integrity）
- **现象**：通过热更新下载新版插件后，控制台报错找不到 `ai-agent.js` 或 `runtime/yami-mcp/server.js`，导致 AI 助手无法启动。
- **根因**：热更新配置 `UPDATE_CONFIG.updateFiles` 写死为早期的 5 个文件，未将新增的子目录与多模块文件纳入清单；且早期写盘逻辑未实现跨平台递归创建父级目录（`mkdirSync(path.dirname(...), { recursive: true })`）。
- **铁律**：
  1. `UPDATE_CONFIG.updateFiles` 必须与仓库源码结构完整同步（当前 15 个关键文件，包括 `runtime/yami-mcp/` 下的 MCP 工具链）；
  2. 写盘必须强制递归创建目录，并坚守“`probe-core.js` 首位写盘、`manifest.json` 末位写盘（版本门闩锁）”安全顺序；
  3. `test-autoupdate.mjs` 必须常态化断言清单文件总数与子目录递归创建能力。
- **注（2026-09-12 起由铁律㊵取代）**：`updateFiles` 逐文件清单这套机制**已整体删除**——它每加一个文件就得人工登记一次，最终在 v1.0.0 → v1.2.0 跨版本更新时把用户插件更没了（见㊵）。现在装机范围由「整包快照 − 开发目录黑名单」决定，本条的第 1 条不再适用；第 2 条的**写盘顺序（manifest.json 最后）与递归建目录**仍然有效。

---


### ㉗ 扩展内容脚本跑在隔离世界，Node 能力必须靠主世界装载器

- **现象**：面板每个按钮都报 `require is not defined`，AI 宿主永远起不来，5966/5967 双桥从不监听。
- **根因**：Electron 20 的扩展内容脚本运行在隔离世界（无 `require`/`process`），而 `content_scripts.world = "MAIN"` 是 Chrome 111+ 字段，Electron 20 直接忽略。引擎两个窗口都是 `nodeIntegration: true`，**只有主世界有 Node**。
- **铁律**：manifest 的 `content_scripts` 只挂 `bootstrap.js`，由它把主脚本注入主世界；改 manifest 必须重启编辑器才生效。

### ㉘ UMD 在 Electron 渲染进程里必须双挂（module 与 window 并存）

- **现象**：对话里 AI 回复一个字都看不到。
- **根因**：`ai-render-core.js` 的 UMD 写成"有 `module` 就只走 CommonJS"，而渲染进程里 `module` 与 `window` 同时存在 → `window.YamiAiRenderCore` 永远 undefined；前端又硬依赖它 → 正文永不写进 DOM。
- **铁律**：先 `const api = factory()`，再 `module.exports = api` **并且** `root.X = api`；同时前端对新增依赖必须留降级分支并告警，绝不静默空白。

### ㉙ 逐 token 渲染必须按帧合并 + 增量追加

- **现象**：上下文一长界面就卡死。
- **根因**：每个片段都 `textContent = 全文`（O(n) 拷贝 × n 段 = O(n²)）并同步拉滚动条（强制重排）。
- **铁律**：帧合并（一帧只写一次 DOM）、增量追加（`createTextBuffer` + `TextNode.appendData`）、滚动跟随先判断用户是否在底部、长会话只渲染最近 60 条。回归在 `tests/test-render-perf.cjs`。

### ㉚ 机械批量替换必须逐处复核（自调用事故）

- **现象**：聊天一发消息就 `RangeError: Maximum call stack size exceeded`。
- **根因**：把 `list.scrollTop = list.scrollHeight;` 全量替换成 `autoScroll();` 时，把 `autoScroll` **函数体内**那一行也换了 → 自己调自己、无终止条件。
- **铁律**：批量替换后逐处复核；`tests/test-static-health.cjs` 现已内置自调用检测（默认危险，只有找到"这是回调"的证据才放过；真递归需注明「允许递归」）。

### ㉛ 工具提示里点名的参数必须在 schema 里声明

- **现象**：模型"连续多次执行同一批操作（读取资源）"被判定空转后掐断。
- **根因**：`read_resource` 实现支持 `key`/`forceFull`（大文件截断后的唯一出路），注册给模型的 `inputSchema` 只声明了 `path`；工具返回又让模型"改用 key 参数"，模型看不到该参数，只能拿同样的 path 反复重读。
- **铁律**：工具描述、返回提示、实现三者必须一致；`tests/test-tool-schema.cjs` 会核对"提示点名的参数是否已声明"。大文件（>200KB）走 `key` 精读，别整体读全文。

### ㉜ 设置项要三级落值，绑定要用事件委托

- **现象**：界面设置改了保存不住。
- **根因**：只写 `localStorage` 一处，且事件直接绑在节点上，面板重建即失效。
- **铁律**：内存状态 → `localStorage`（写完回读校验）→ 宿主配置（`/quick-config`）三处都写；切换后必须给出可见回执；事件用委托绑在容器上。

### ㉝ 密钥体检：官方端点管形状，本地端点不拦

- **现象**：面板显示"已安全保存"，实际每次调用 401。
- **根因**：配置里存的"密钥"其实是 BASE URL（历史误填），而 `hasApiKey` 只看字段非空。
- **铁律**：填成网址一律拒收并说明；只有官方 `api.deepseek.com` 才要求 `sk-` 形状（本地 Ollama/LM Studio 端点的密钥随意）；启动时体检一次历史密钥，发现无效就清掉并说明原因；面板提供「测试连接」（打免费 `/models`）。

### ㉞ 带 tool_calls 的历史必须有应答，否则整个会话被永久锁死

- **现象**：聊天突然只回一句上游原文 `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)`，之后**每一句**都报同一个错，界面还补一句"请检查设置后重试"——而设置毫无问题，用户完全无从下手。
- **根因**：模型空转被自动停止（或用户按停止、工具批处理中途取消）时，那条带 `tool_calls` 的 assistant 消息**已经入了历史**，但对应应答没回填。坏序列随会话落盘，此后每次请求都被上游 400 拒绝，这个会话就废了（本次事故现场：`session-mtx31obt` 第 17 条消息）。
- **铁律**：
  1. 每条提前退出路径都要给"不会执行"的调用补应答（`message-pairs.js` 的 `notExecutedResult`），打断时**不要**再补一条去掉 tool_calls 的 assistant 副本（那会变成重复消息）；
  2. 压缩历史的切点必须对齐"消息组"边界（`alignTailStart`），绝不能切断 assistant 与它的工具应答；
  3. **发送前统一体检**（`repairToolPairs`）：缺应答补占位、越界与重复的剔除、空 `tool_calls` 摘掉——不能指望每条退出路径都自觉回填；
  4. 上游因序列拒绝时，自动自愈并重试一次，别让坏历史把会话锁死；
  5. 报错话术不要一律接"请检查设置"：像这种序列错误跟设置无关，只在确实是配置类问题时才这么提示。
- **事故复现**：拒绝发生时，用户的每一条新消息都被写进历史却得不到回答，会话里会堆积多句同样的问话。

### ㉟ 上下文窗口按官方 token 计，触发按窗口占比，别用字符数拍脑袋

- **现象**：才聊十几轮就不断「压缩上下文」，历史被反复折叠；面板上的「上下文 240k/240k」用户看不懂，也说不清离上限还有多远。
- **根因**：预算写的是「240000 **字符**」，而官方公布的上下文是 **1M token**。按中文 0.6 token/字折算，24 万字符只有 14 万 token——只用了窗口的 14%，长期过早压缩、白白丢上下文；工具 schema（35 个工具约 4.4k token）更是从来没算进占用，量出来的数既不是 token 也不是真实占用。
- **铁律**：
  1. 窗口用官方数字（1M token），触发用**窗口占比**（0.8），保留用占比（0.16）——都放在 `context-meter.js`，别处不许再自己算；
  2. 换算按官方「Token 用量计算」页：中文 0.6 token/字、英文 0.3 token/字符，中英混排必须逐字分类（一律套英文密度 4 字符/token 会把中文低估三倍）；
  3. **工具 schema 必须计入**：它每次请求都要带；若它本身超过阈值，压缩对话毫无意义，要明确跳过而不是空转；
  4. 估算之上要有**真实用量锚点**：上游返回的 `prompt_tokens` 是权威值，用它加增量估算，误差才不会随对话变长累积；
  5. 压缩分两级：先做**不花钱的确定性修剪**（长工具结果留头尾），不够再花 token 让模型摘要；
  6. 摘要调用必须走**流式**：非流式在漫长的生成期间没有任何数据流动，会撞上 socket 空闲超时（摘要恰好是「超大输入 + 长输出」的最坏场景）；
  7. 摘要用固定结构（八节，空节写「（无）」）并包进 `<compacted-summary>` 检查点；摘要失败时用「骨架 + 逐条要点」兜底，绝不写一句「细节不可用」就把历史扔掉。

### ㊱ 滚动跟随的判据要来自「用户意图」，不能事后算距离

- **现象**：AI 边生成边刷屏时，用户往上翻看历史，每来一段新内容就被拽回底部；刚往上滚一点点也会被拽回去，历史根本看不成。
- **根因**：跟随判据用的是「当前离底部多远」。内容一追加 `scrollHeight` 就变大，追加之后再去算距离——老老实实待在底部的用户也会被判成"翻上去看历史了"，跟随于是时断时续；阈值给大了（旧值 80px）更糟：用户刚上滚一点仍算在底部，于是被反复拽回。
- **铁律**：
  1. 跟随状态只由**滚动事件**维护（scroll / wheel / touchmove / 翻页键），追加内容后只问状态、不再算距离；
  2. `wheel` 上滚是"人要看历史"的最早信号，不等滚出阈值就先松开跟随；
  3. 距底阈值收紧到一行左右（24px）——"贴着底"才算贴底；
  4. 暂停跟随时**一个字都不许动用户的视口**，并在底部给一个「↓ 有新内容 / 回到最新」入口；
  5. 只有用户自己的动作（发消息、切会话、清空）才强制回到底部；
  6. 状态机放 `ai-render-core.js`（纯逻辑、可单测），前端只做接线与降级兜底。

### ㊲ 跨平台路径不许写死平台名与目录名（记住：测试可能正拿环境变量掩盖它）

- **现象**：Linux 上 AI 一句「帮我改下这个脚本」都做不到——每次写入都被自动回滚，理由是"编译未通过"；而实际上工程本身编译零错误。
- **根因**：`findCompiler` 把包名写死成 `@typescript/typescript-win32-x64`，引擎根又是按「往上三级再拼字符串 `'2'`」推断的（只在仓库目录恰好叫 `2` 时成立）。于是非 Windows / 非该目录名的机器上**永远找不到 tsc**；而写脚本的路径是「编译不过就回滚」，找不到编译器等于**把每一次改代码都撤销掉**。同一处硬编码还让 `list_event_commands` 的指令目录恒为空。
- **为什么长期没被发现**：所有涉及编译的测试都显式设了 `YAMI_TSC_JS` 指向引擎的 tsc —— 测试绕过查找逻辑，生产环境没有这个变量，于是**测试全绿、功能全废**。
- **铁律**：
  1. 平台相关的包名/二进制名一律按 `process.platform` / `process.arch` 拼（`typescript-<平台>-<架构>`，Windows 才带 `.exe`），并兼顾 pnpm 的 `.pnpm` 存储布局；
  2. 定位引擎根从**插件自身位置**往上推（插件在 `<引擎根>/extension/<插件名>/runtime/yami-mcp`，往上四级就是引擎根），不许拼死目录名；
  3. **「找不到工具」不等于「校验不通过」**：前者放行但如实标注"这次没校验"，后者才回滚。把两者混为一谈，会让环境问题伪装成代码问题；
  4. 凡是被环境变量「喂」出来的依赖，测试里至少留一条**不喂**的用例，否则等于没测。

### ㊳ 150ms 心跳上不许挂重活（性能大盘最容易变成卡顿源）

- **现象**：开着性能面板玩游戏，面板自己制造卡顿；存档页打开不动也持续发热。
- **根因**：一条 150ms 的统一心跳（6.7 次/秒）串起了三件重活——① `getReport()` 每次对 12000 个样本做 3 趟全量排序（其中 `frame.p95` 根本没人用）；② `refreshDockData()` 无指纹守卫，每次重建 6 处列表 `innerHTML`；③ 存档台每次同步 `readdir` + 逐文件 `stat` + 读**整个存档 JSON**（含 base64 截图）+ 整页 `innerHTML` 重建。三件都跑在渲染进程主线程（也就是游戏自己的线程）上。
- **铁律**：
  1. 挂上心跳前先问「这个东西一秒内真的会变几次」；统计量（分位数）按抽样算，样本超过千级就别全量排序；
  2. 列表类刷新一律先比**快照指纹**（且指纹要在取贵数据**之前**算），没变就整块跳过；
  3. 涉及磁盘 I/O 的刷新必须有时间闸（≥2 秒）+ 目录指纹；
  4. 每个被注入的脚本都要有自重入守卫（HUD 曾是四个里唯一没有的，而它的心跳连 id 都没留存）；
  5. 测试套件只覆盖纯逻辑，**"心跳频率 × 真实数据规模"必须靠人审**——全绿不代表不卡。

### ㊴ 「停止」停不下来：主动 destroy 不会兑现 Promise

- **现象**：点了停止、界面也显示「已打断」，但之后每句话都被「上一条需求还在处理中，请稍候」顶回来，只能重启编辑器；同时模型会陷入反复检索（工具条上「执行：工程内检索」刷屏）。
- **根因**（两条叠加）：① 取消时对上游请求调了 `req.destroy()`，而那个 Promise 只在 `req.on('error')` / `res.on('end')` 上兑现——Node 里**主动 destroy 只触发 close、不触发 error**，于是 Promise 永远悬着，`continueSession` 卡死在 await 上，`finally` 不执行，`session.busy` 永远为 true；② 工具执行是裸 `await client.call(...)`，取消令牌只在工具**之间**检查，而 MCP 是 stdio 请求-响应、没有取消语义，按了停止还要等工具跑完（最坏 180 秒）。
- **铁律**：
  1. 任何"可取消"的异步操作，取消路径必须**自己兑现 Promise**（`finish(new Error(原因))`），不能指望 destroy 会触发 error；
  2. 长耗时的下游调用（MCP 工具）包一层"取消即放行"：不再等结果，迟到的响应由 pending 表丢弃；
  3. `busy` 这类互斥标志要配一个**可等待句柄**（`activeRun` + `activeCancel`）：下一条请求发现"已取消但还在收尾"时先等它（带 1 秒硬超时），而不是直接把用户顶回去；
  4. 同一工具在一轮里反复调用要给模型一句提示（`__hint`），帮它自己收敛——模型看不到调用次数，用户却看得见刷屏。
- **验证**：`test-interrupt.cjs` 新增「打断后立刻恢复」场景（假 MCP 故意慢 1.5 秒）：打断后**第 1 次请求即被接受，耗时 4ms**（旧行为是永久卡住）。

### ㊵ 更新器不许把写盘清单烧死在客户端里（老用户永远拉不到新版新增的文件）

- **现象**：用户在 Open Yami 里点「一键热更新」，界面如实提示成功（15/15 个文件）；当时面板照常能用，**重启编辑器后插件彻底消失**——面板、HUD、AI 副驾全没了，控制台里连一条插件报错都没有。
- **根因**（三件事叠在一起）：
  1. 老客户端（v1.0.0）的 `UPDATE_CONFIG.updateFiles` 是**烧死在它自己代码里**的 15 文件清单，而远端 v1.2.0 把入口从「内容脚本直挂三个脚本」改成了主世界装载器 `bootstrap.js`；新增的 `bootstrap.js` / `ai-render-core.js` 不在老清单里，**永远不会被下载**；
  2. 清单里 `manifest.json` 排在最后（本意是版本门闩），于是那次更新把**新版 manifest.json 落了盘**，而它声明的入口文件根本不在盘上——「新门牌 + 没有门」，Electron 加载扩展时找不到内容脚本，插件等于不存在；
  3. 没有任何落地校验，也没有自愈路径：manifest 版本号已等于远端最新，再点检查更新只会回「已是最新」；插件不加载 → `probe-core.js` 不跑 → 连更新按钮本身都不存在（鸡生蛋）。
- **铁律**：
  1. **更新载荷必须自洽**：一次只下一份**整包快照**（`archive/refs/heads/extension.tar.gz`），装机范围 = 整包内容 − 开发目录黑名单，黑名单只放「绝不可能是运行时依赖」的物料。**漏一个开发目录只是多放几个不参与加载的文件，漏一个白名单条目就是把插件更没**——代价不对称，所以只能是黑名单。
  2. **校验先于写盘**：解包后先断言 manifest 声明的每个文件都在包里、每个 `.js` 都能过 `vm.Script`；任何一条不过就**原地不动**，绝不允许半更新落地。
  3. `manifest.json` 仍最后落盘（版本门闩），但写入前必须先备份旧版本到 `_backup/previous/`，写盘失败要能自动回滚。
  4. **通道按实测选，不按名气选**：`raw.githubusercontent.com` 在大陆直连被墙（4 秒超时）却曾是首选通道，而 `codeload` 整包、`api.github.com`、`gh-proxy.com` 都是直连可用的；改通道顺序前先跑一遍实测（含"关了代理"这一态）。
  5. 网络可以被墙，但**用户必须永远有一条活路**：面板常驻「本地安装」（选一个手动下载并解压好的整包目录），它不依赖任何外网。
- **验证**：`tests/test-autoupdate.mjs` 重写为整包口径（52 项）：含"新增模块自动纳入"、"缺文件 / 语法坏 / 降级一律零改动"、"写盘失败自动回滚"、"主通道被墙自动降级"、"真实网络整包安装到临时目录后 runtime 模块一个不少"；`build.cjs` 增 10 项整包更新锚点，`updateFiles` 一旦复活直接构建失败。

## 2.3 关键设计决策与取舍

| 决策 | 理由 | 代价 / 备注 |
| :--- | :--- | :--- |
| 插件零外部依赖（Node 原生 http / readline / spawn） | 免安装、离线可用、避免依赖漂移 | 需要自己实现 diff、SSE、WebSocket（用 Node 24 原生）等 |
| 扩展只做装载器，主脚本注入主世界 | 只有主世界有 Node，双桥与宿主才可能工作 | 改 manifest 必须重启编辑器 |
| AI 宿主独立进程（5968），不塞进渲染进程 | 模型请求、工具编排、文件写入不该阻塞界面；崩了也不拖垮编辑器 | 需要令牌与父进程看门狗（父死子退） |
| 写盘一律「先预览 → 用户确认 → 原子写 + 备份」 | 面向不懂代码的用户，改坏要能一键回退 | 多一次交互；删除类额外要一次性确认令牌 |
| 打断要真停（销毁上游请求 + 停止剩余工具） | 只断界面不停后台 = 继续烧 token、继续改文件 | 需要取消令牌贯穿模型与工具循环 |
| 思考过程默认「单行预览」 | 大段推理横在对话中间不符合阅读习惯 | 想看全文点开，或在设置里切「展开」 |
| 工具/文案全部用中文口语，不暴露 GUID | 目标用户是不懂代码的开发者 | 需要维护中文工具名映射 |
| 版本以 `manifest.json` 为唯一事实源并级联 | 手工多处改必然漂移 | 依赖 `build.cjs` 门禁；未提交前不得发版 |

## 2.4 协作约定（与人类协作者）

1. **不要擅自 Git**：只有用户明确说"提交 / 发布版本"才允许 commit / push。
2. **不要为了看界面而启动用户的编辑器，也不要用截图当验证依据**：GUI 效果交给用户自己看；助手只做命令行验证、测试套件、构建门禁与静态检查，并把需要用户确认的点讲清楚。
3. **不要自作主张**：涉及口径、价格、模型参数、外部接口数据这类事实，必须查官方文档或向用户确认，不猜。
4. **沟通与注释用中文**，代码注释写"为什么这么做"（历史教训），不写"做了什么"。
5. **改完必须过门禁**：`node build.cjs` + 相关测试套件；影响发布文件时 `--deploy`。

---

# 第三层 · 当前进度（Where We Are）

> 更新日期：2026-09-12 晚 · 当前版本：`v1.3.1`

## 3.1 能力清单与完成度

| 能力 | 状态 | 位置 / 说明 |
| :--- | :--- | :--- |
| 性能大盘（帧率 / DrawCall / 真凶归因 / A-B 排查） | 已落地 | `probe-core.js` + `hud-overlay.js` |
| 运行日志与错误黑匣子（指纹聚合 / 指令级时间线 / 幽灵事件） | 已落地 | 同上 |
| 存档管理（速改 / 变量开关 / JSON 树 / 一键还原） | 已落地 | 同上 |
| 场景实体检查台 / 作弊台 / 工程体检 / 诊断断点 | 已落地 | 同上 |
| AI 助手面板（流式对话 / 思考过程 / 审批差异 / 撤销 / 计划 / 变更小结） | 已落地 | `ai-agent.js` |
| AI 宿主（模型调用 / 工具编排 / 会话持久化 / 上下文计量与两级压缩 / 计费 / 连接体检 / 打断） | 已落地 | `ai-host.js` + `context-meter.js` |
| 内置 MCP 工具集（35 项：读 / 写 / 搜 / 编译 / 事件编排 / 数据表 / 备份 / 试玩冒烟…） | 已落地 | `runtime/yami-mcp/` |
| 代理能力（子任务委派给子代理） | 未做（P2） | 见 3.3 |
| 计划模式（Plan Mode） | 明确不做 | 用户拍板不需要 |

## 3.2 最近一轮完成（2026-09-11 → 09-12）

1. **引擎接口暴露**：`window.YamiEngine = { File, Directory, Title, UndoManager, Data }`，插件三处取值点改经它，`editor_action` / `interact_editor` 具备可用的前提。
2. **插件装载架构改造**：新增主世界装载器 `bootstrap.js`，解决隔离世界无 Node 的致命问题；补 `web_accessible_resources` 与单文件失败告警。
3. **对话界面补基础能力**：真打断（停止键 / Esc，宿主侧取消令牌贯穿模型与工具）、执行过程集中显示（思考+工具收进「执行过程」，正文干净）、思考默认单行预览、余额与本次花费移到版本号那一行（仅 AI 助手页显示）。
4. **流式渲染性能治理**：新增 `ai-render-core.js`（帧合并 / 增量缓冲 / 智能滚动 / 历史窗口），修掉 O(n²) 卡死。
5. **DeepSeek 接入打通**：对照官方文档核验请求形状（模型名 / thinking / reasoning_effort / reasoning_content 回传 / tool_choice / 价目与高峰时段），新增密钥体检、启动清理无效密钥、`POST /test-connection` 一键体检；面板实测报「连接正常：密钥有效，模型 deepseek-flash 可用」。
6. **模型空转修复**：补齐 `read_resource` 的 `key` / `forceFull` 声明，打转阈值放宽到连续 3 次。
7. **版本升到 `v1.1.0`**：SSOT 级联对齐 probe-core / hud-overlay / README / HANDOFF，并同步 MCP 客户端版本字段。
8. **测试体系加固**：新增「静态健康」（隐式全局 / CSS 结构 / 插件装配 / 自调用检测）、「渲染性能」、「工具提示一致性」、「打断输出」四套件；构建门禁 46 项锚点。
9. **会话锁死事故修复（用户报「没法聊天啊」）**：模型空转被自动停止时，带 `tool_calls` 的 assistant 已入历史却没有工具应答，坏序列随会话落盘，此后每次请求都被上游 400 拒绝（`session-mtx31obt` 第 17 条为事故现场）。修法：① 新增共享模块 `runtime/yami-mcp/modules/message-pairs.js`（补占位 / 剔除越界与重复 / 压缩切点对齐 / 合法性校验）；② 空转保护、用户打断、工具批处理取消、审批拒绝等所有提前退出路径一律补「未执行」应答；③ **每次发请求前统一体检**（`healSessionMessages`），旧会话自动治好、无需用户删会话；④ 上游因序列拒绝时自愈并重试一次；⑤ 报错话术不再一律接"请检查设置"；⑥ 前端有未确认卡片时直接发新消息 = 放弃该项修改（不再静默卡住）。新增 `tests/test-message-pairs.cjs`（22 项）与热更新清单扫目录断言。

10. **上下文计量与自动压缩改造（用户要求：窗口 1M、占用 80% 自动压缩、算法参考 DeepSeek Harness）**：① 新增共享模块 `runtime/yami-mcp/modules/context-meter.js`——官方 token 换算（中文 0.6 字/英文 0.3 字符）、1M 窗口、80% 阈值、16% 保留、保留范围选择、长工具结果头尾修剪、真实用量锚点、固定开销压不动时明确跳过；② 旧的「240k 字符预算」作废（那只是窗口的 14%，导致长期过早压缩），`YAMI_AI_CONTEXT_BUDGET` 退役；③ 两级压缩：第一级确定性修剪（不调模型、零成本）→ 第二级模型摘要（重放 system + 待折叠消息 + 压缩指令，**流式**调用以复用前缀缓存并避免空闲超时）；④ 摘要产出八节固定结构的 `<compacted-summary>` 检查点（对齐 DSH compaction-basic 提示词），失败时降级为「骨架 + 逐条要点」；⑤ 工具 schema（约 4.4k token）计入占用；⑥ 面板刻度改为 `上下文 320k/1M · 32%` 并显示校准来源，触及阈值时高亮；⑦ 新增 `tests/test-context-meter.cjs`（45 项），`test-ai-session.cjs` 的压缩断言改到 token 口径。

11. **历史对话回放思考过程（用户问「为什么历史对话里不保留思考过程」）**：思考内容（`reasoning_content`）其实一直随会话落盘，丢失发生在**回显**环节——`visibleMessages()` 只回传了 `content`，前端 `loadSession()` 也只渲染正文。修法：① 宿主回显带上 `reasoning`（额度为正文的两倍）；② 前端抽出 `appendThinkingBlock(text, metaText)`，让历史回放与流式共用同一套思考块结构、折叠交互与三档显示；③ 历史块只报字数不编造耗时。新增断言：宿主回显字段、前端回放接线（`test-ai-agent.cjs`）与端到端回放（`test-ai-session.cjs`）。

12. **视图跟随与思考预览改造（用户要求：默认显示最下方最新内容，但不能打扰上滚看历史）**：① 跟随状态机 `createFollowState(threshold)` 放进 `ai-render-core.js`（可单测）：判据只来自滚动事件，追加内容后不再算距离；② `wheel` 上滚即刻松开跟随，距底阈值由 80px 收紧到 24px；③ 暂停期间视口一字不动，底部出现「↓ 有新内容 / 回到最新」提示（`order:9999` + `sticky` 常驻消息末尾，样式 `.yami-ai-jump`）；④ 思考单行预览改为显示**最后一行**（`previewLine`：末行太短往前并一行、过长保留最新那段）；⑤ 发消息 / 切会话 / 清空强制回到底部。`test-render-perf.cjs` 扩到 43 项（含状态机的 9 项与预览 5 项），`test-ai-agent.cjs` 增接线断言。

13. **编译器查找跨平台修复 + 性能 HIGH 治理（2026-09-12 实测发现）**：① 实测暴露 P0——`findCompiler` 写死 `typescript-win32-x64`、引擎根硬编码 `'2'`，导致 Linux 上编译门禁整体失效，而写脚本是「编译不过就回滚」，等于 AI 改代码 100% 被撤销（测试用 `YAMI_TSC_JS` 掩盖了这一点）；已改为按 `process.platform`/`process.arch` 找引擎自带 tsc（含 pnpm `.pnpm` 布局）、引擎根从插件位置往上四级推断，并把「找不到编译器」与「编译不通过」分开（前者放行 + 如实标注 `compileSkipped`，后者才回滚）；同一处硬编码还让 `list_event_commands` 恒空，一并修好。从部署镜像实测：不给任何环境变量，自动找到 `typescript-linux-x64/lib/tsc`，0.6 秒编译通过，指令目录读到 153 条。② 性能体检发现 150ms 心跳上挂着三件重活：`getReport()` 3 趟 12000 元素全排序（抽样化并删掉无人使用的 `frame.p95`）、`refreshDockData()` 无指纹重建 6 处列表（加 800ms 时间闸 + 数据指纹）、存档台每 150ms 同步读盘并解析整个存档（加 2 秒时间闸 + 目录指纹）；另修普通模式真凶卡指纹、HUD 自重入守卫、变量挂件降频、`validate_project` 单次扫描。新增 `tests/test-compiler-lookup.cjs`（17 项）与静态健康里的「心跳开销守卫」断言。

14. **对话体验修复（2026-09-12）**：① **历史对话回放思考过程**——思考一直在会话文件里，丢在回显环节（`visibleMessages` 只回传正文、前端也只画正文），现已连带思考块一起回放（与流式共用同一套结构、折叠交互与三档显示）；② **视图跟随改造**——跟随判据改由滚动事件驱动（不再事后算距离），`wheel` 上滚即刻松开、距底阈值 80px→24px、暂停期间视口一字不动并在底部给「↓ 有新内容 / 回到最新」入口，状态机放进 `ai-render-core.js` 可单测；③ **修「思考过程不滚动到最新一行」**——展开模式下思考块自带 `max-height:30vh` 滚动区却从没人设过 `scrollTop`，单行预览又被 `text-overflow: ellipsis` 从**右侧**裁掉了最新那段（改为右对齐 + 左侧裁切 + span 承载）；④ 思考收尾/切换档位时内容未变不再重写整段，保住用户手动滚动的位置。

15. **「无限思考 / 停不下来」修复（2026-09-12 用户实测反馈）**：用户报告 AI 反复执行「工程内检索」且打断后无法继续对话（「上一条需求还在处理中」）。追踪日志定位到真凶：取消时 `req.destroy()` 不触发 error，模型请求的 Promise 永不兑现 → 任务悬在 await → `busy` 永不释放；同时工具执行阶段是裸 await、取消令牌只在工具之间检查。修复：① 两处取消点改为 destroy 后**显式 finish**；② 新增 `callToolWithCancel`（取消即放行，覆盖只读批处理/独占执行/审批预览）；③ `/chat` 遇到"已取消但还在收尾"时先等 `activeRun`（1 秒硬超时）再放行；④ 新增 `repeatHint`／`__hint`：同一工具一轮内调用 ≥5 次时给模型一句收敛提示；⑤ 新增 `YAMI_AI_DEBUG=1` 的取消链路追踪开关。回归：`test-interrupt.cjs` 扩到 8 项（含"打断后第 1 次请求即被接受"）。

16. **整包快照更新改造（v1.3.0，用户报「插件在 Open Yami 里打不开」的事故修复 + 通道国产化）**：① 定位到事故真因——用户机器上装的是 v1.0.0，点一键热更新后老客户端按**自己烧死的 15 文件清单**下载，却把远端 v1.2.0 的 manifest.json 落盘，而新入口 `bootstrap.js` 不在老清单里，重启编辑器后插件凭空消失（详见铁律㊵）；已用 `node build.cjs --deploy` 从母仓库单向镜像补齐 `bootstrap.js` / `ai-render-core.js` 与 7 个缺失的 runtime 模块。② 更新器整体换成**整包快照**：主通道 `archive/refs/heads/extension.tar.gz`、反代前缀兜底，下载 → `zlib.gunzipSync` + 自写 tar 解析 → 完整性校验（manifest 声明文件齐全 + 每个 JS 过 `vm.Script`）→ 备份 `_backup/previous/` → `.tmp` + `rename` 原子替换、manifest 最后落盘，失败即零改动并可自动回滚。③ 版本探测改四通道降级（**不再把被墙的 raw 直连放在首位**），面板横幅显示当前探测通道，失败时不再静默。④ 新增「本地安装」离线兜底（横幅按钮 + 页脚链接），可整包重装同版本用于修复。⑤ 实测：主通道 588 KB / 2.2 秒直连可用；`tests/test-autoupdate.mjs` 重写为 52 项（含真实网络整包安装到临时目录），`build.cjs` 增 10 项整包更新锚点，静态健康增"黑名单/锚点/清单不许复活"断言，并修掉一条对 CRLF 敏感的旧断言（HEAD 上本就在 Windows 误报）。

## 3.3 未完成 / 未验证 / 已知限制

| 项目 | 状态 | 说明 |
| :--- | :--- | :--- |
| 编辑器动作桥（5967）在源码构建版的实际可用性 | **已实测可用（2026-09-12）** | 需要重启编辑器后看控制台是否出现 `[Yami Perf Bridge] 编辑器动作服务已就绪: http://127.0.0.1:5967`；本机引擎源码构建此前不暴露引擎全局，已通过 `YamiEngine` 补上 |
| `playtest_smoke` 真实试玩链路 | 待真机验证 | 需要编辑器 + 启动试玩窗口（自动化只能覆盖桩） |
| 界面细节验收（思考块 / 过程区 / 成本行 / 打断手感） | 待用户确认 | 助手不启动编辑器、不截图，一律由用户看 |
| 子代理委派（把子任务派给独立 agent） | 未做（P2） | 现有「任务计划」已能显示步骤；委派本身收益待评估 |
| 热更新通道 | 已改为整包快照 + 本地安装兜底 | 主通道 `codeload` 直连实测 2.2 秒；发布只需 push `extension` 分支（不必另发 Release）；面板「本地安装」为断网兜底 |
| 整包更新的真机试用 | 待用户确认 | 需要用户在 Open Yami 里点一次「一键热更新」（或「本地安装」）并重启工程验收；助手不启动编辑器 |
| 引擎仓库的本地补丁 | 未提交 | Linux 移植补丁 + `YamiEngine` 暴露，均为本地改动，是否上游由用户决定 |

## 3.4 下一步建议

1. 重启编辑器，确认 5967 桥就绪日志出现，让 AI 跑一次「保存工程 / 刷新资源树 / 启动试玩」，把 `editor_action` 从"具备前提"变成"实测可用"。
2. 用一个真实需求（例如改主菜单某处 UI）走完整链路：搜索 → 精读（`key`）→ 预览 → 确认 → 编译 → 变更小结 → 撤销，检验端到端手感。
3. 视使用情况决定是否补 3.3 中的 P2 项（子代理委派）与其余界面基础功能（重新生成 / 复制回答 / 编辑重发 / @ 引用文件）。

## 3.5 回滚与应急

- 插件母仓库任一文件被改坏：`git diff` 查看未提交改动，必要时 `git checkout -- <file>`（母仓库有完整提交历史）。
- **插件生产目录被更新坏**：更新器在写盘前会把旧版本整份备份到 `<插件目录>/_backup/previous/`，把里面内容覆盖回插件目录即可；也可以直接 `node build.cjs --deploy` 用母仓库重新单向镜像（母仓库永远是唯一真实源）。
- 引擎侧改动（Linux 移植补丁 + `YamiEngine`）全部未提交：`dist` 整份备份在 `/tmp/yami-dist-backup-*`，`Project/index.html` 另有备份；引擎重建走 `pnpm run build:vite`。
- 插件运行镜像出问题：重新执行 `node build.cjs --deploy` 用母仓库覆盖即可（镜像永远是母仓库的单向拷贝）。
- AI 会话记录：`~/DanJuanDevSuite/sessions/*.json`，删除某段对话用面板「历史」里的删除按钮，或直接删文件。
