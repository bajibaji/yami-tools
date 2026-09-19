# DanJuan妙妙插件 (DanJuan DevSuite / Extension)
## 交接文档 · 三层结构 (HANDOFF)

> **文档定位**：跨开发者与 AI 协同的唯一技术基线（SSOT）。文档分三层，读法如下：
>
> - **第一层 · 客观事实**：项目是什么、装在哪、怎么跑起来——只写客观存在的东西，不含判断。
> - **第二层 · 记忆与经验**：项目经历了什么、踩过哪些坑、为什么这样设计——读它能少走弯路。
> - **第三层 · 当前进度**：推进到哪里了、什么已完成、什么没做完、下一步做什么。
>
> **当前版本**：`v1.10.8`　**最近更新**：2026-09-13

---

# 第一层 · 客观事实（What It Is）

## 1.1 项目属性

| 项 | 值 |
| :--- | :--- |
| 名称 | DanJuan妙妙插件（DanJuan DevSuite） |
| 形态 | Open Yami RPG Editor 的 Chrome MV3 扩展（非侵入式，不改游戏逻辑） |
| 当前版本 | `v1.5.3`（单一事实源：`manifest.json` 的 `version`） |
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
   - **一键原子回滚**：备份记录随卡片持久化，用户点击【取消/回滚】即可立即恢复原文件；
   - **确认之后的续跑回到同一条事件流**：用户在卡片上做出选择后，前端走 `/approve/stream`（或 `/reject/stream`）继续消费 SSE，与正常一轮共用同一段渲染代码（`streamTurn`）—— 确认之后的每一步工具、每段思考、每段正文都实时上屏并归进当前回合（铁律【52】）。
4. **三大安全保护门禁**：
   - **200KB 上下文截断保护**：`read_resource` 支持指定 `args.key` 读取子节；对超过 200KB 的大文件默认实施安全截断与结构摘要，避免挤爆大模型提示词；
   - **资产删除全局引用反查强保护**：`delete_resource` 自动扫描工程内所有 `.event`、`.actor`、`.ui` 与 `Data/*.json`，若目标 GUID 仍存在入边引用则坚决拦截并输出引用位置，仅在 `force: true` 时放行；
   - **IIFE 单次调用防重放**：编辑器 CDP 模拟动作统一封装为自执行单次调用，根治双击或多次触发的隐患。
5. **上下文计量与自动压缩（对齐 DeepSeek Harness 的 token-meter / compaction-basic / tool-result-pruner）**：
   - **窗口与阈值**：窗口取官方公布的 **1M token**（`deepseek-flash` / `deepseek-v4-pro` 同），占用达 **80%** 触发压缩，压缩后原样保留最近 **16%** 窗口的原文（外加「至少保留 N 条消息」的下限）；规格集中在 `runtime/yami-mcp/modules/context-meter.js`；
   - **计量口径**：按官方「Token 用量计算」换算——中文 0.6 token/字、英文 0.3 token/字符，每条消息与每个内容块各 +4 结构开销；**工具 schema（36 个工具约 4.5k token）也计入**；
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
- MCP 侧：`ai-host` 以 stdio 拉起 `runtime/yami-mcp/server.js`（JSON-RPC 2.0），工具数以 `tools/list` 为准（原始表 37 项；内置模型可见 36 项——`cdp_eval` 由宿主侧 `HIDDEN_TOOLS` 过滤，只留给外部 MCP 客户端与路线 B）。

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
| `runtime/yami-mcp/server.js` | 内置 MCP 服务（注册 37 个工具，模型可见 36 个） | 由宿主以 stdio 拉起 |
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
  4. **对用户本人汇报时同样适用**（2026-09-14 用户明确反馈"我有点看不懂你发的文字"，并要求"以后就说这种语言"）：
     聊天里的汇报只说三件事 —— **做了什么 / 你要做什么 / 会看到什么**；提交号、文件哈希、门禁、台账、
     测试套数这类词是写给维护者的，只进文档，不进给用户的回复。用户说"看不懂"就是这条铁律被违反了。

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

### ㊶ 流式渲染的状态要挂在「它所属的那一块」上，不能挂在回合级闭包变量上

- **现象**：思考过程按模型轮次分块后，**第二块及以后的"思考窗口"正文永远是空的**——段头在正常跳（已思考 X 秒 · Y 字），窗口里一个字都没有，上一块却在不停变长。切到默认的「单行预览」档更明显：刚冒出来的思考窗口整段空白，直到这一段结束才突然出现一行字。
- **根因**（两个叠在一起）：
  1. 写文字用的那个文本节点存在 `streamChat` 的**回合级闭包变量**里（`thinkingTextNode`），开新段时没有换。旧节点仍 `isConnected`，于是"要不要新建节点"的判断永远走 false 分支，`appendData` 把**新段的字全追加进了上一块的节点**，新块 body 一直是空的。（这个 bug 只在"一段一块"之后才会出现：以前一回合只有一块，闭包变量恰好等价于"当前块"。）
  2. 「单行预览」档的刷新只写在 `if (thinkingView() === 'expand')` 里面——预览那一行**只在段末**被 `applyThinkingMode` 刷一次，流式过程中根本不更新，于是"新出现的窗口"在整个思考期间没有文字。
- **铁律**：
  1. 分块/分段渲染时，**每个可变状态都必须能从当前元素本身重新取得**（`body.firstChild`、`dataset.text`）；凡是"当前块"的隐式假设一律视为 bug —— 闭包变量的生命周期是回合，不是块。
  2. 显示档位是**视图**，不是**数据通路**：无论展开 / 单行预览 / 折叠，流式增量都必须让该档位看到的内容**实时**更新（预览档只更新那一行即可，取值走缓冲的 `lastLine`，绝不每帧 `split` 全文）。
  3. 这类"只在某个档位下才写 DOM"的分支，加档位时必须配一条钉住根因的断言——光测"新代码存在"没用。
- **验证**：`tests/test-render-perf.cjs` 增 6 条 `lastLine` 语义断言（75 项全绿）；`tests/test-ai-agent.cjs` 增 4 条断言，明令 `thinkingTextNode` 不许复活、文本节点必须从当前块取、预览行必须实时就地更新；真机验收：展开与单行预览两档下，多轮任务里新出现的思考窗口都逐字上屏。

### ㊷ 「收下了」和「送到了」是两件事：异步投递必须有回执，拿不到回执就得如实退回

- **现象**：给 AI 助手加「繁忙时补充一句」（引导）时，最容易写出一种"看起来能用"的实现——前端把话 POST 出去、后端回 `{ok:true}`，界面就显示"已引导"。可实际上模型那一轮可能已经收工了，这句话**从来没进过任何一次请求**；用户以为它在下一步生效，于是坐在那里等一个永远不会来的反应。
- **根因**：投递点是"下一个步骤边界"，而这个边界**有可能永远不来**（模型这一步就是最后一步，或被用户打断）。把"收下"当成"送到"，等于把不确定性藏进了 UI。
- **铁律**：
  1. 所有"稍后生效"的投递（引导、排队、定时器、重试队列）都要区分**收下 / 送到**两个状态，且**只有真送到才改口**；送达回执必须由真正投递的那一方发出（这里是 Agent 循环在步骤边界发 `steer.delivered`）；
  2. 一轮收工时队列里还剩的东西，必须**原样退回**给调用方（`undeliveredSteer`），由它决定下一步（我们放进排队区当普通消息发），绝不允许静默丢弃；
  3. 空闲时没有可插入的边界，就如实回"直接发就行"，不要假装收下（`busy:false` + note）；
  4. 排队与引导是两种语义：排队 = 本轮结束后依次发出（进对话记录），引导 = 下一步骤边界插进上下文（不当普通气泡）。UI 上必须能一眼分清，键盘也要能分开（Enter / Ctrl+Enter）。
- **验证**：`tests/test-ai-agent.cjs` 的 E2E 用"慢两轮 + 中途 POST /steer"跑真实链路：断言 `/steer` 回报 `busy:true`、会话文件里**真的**多了一条用户消息（进了模型可见历史）、`undeliveredSteer` 不出现；空闲调 `/steer` 必须回 `busy:false`。

### ㊸ 检视器属性改动靠 blur 进撤销栈与未失焦输入防踩（Inspector Blur & Pending Input Protection）

- **现象**：AI 助手帮用户改属性（如攻击力、缩放）时，如果只是 `input.value = 50` 并派发 `input`/`change`，界面显示确实改了，但用户按下 Ctrl+Z 无法撤销；更严重的是，若用户此时正在另一个输入框打字未失焦，AI 的写盘或操作会触发引擎 `AutoReload`，直接把用户还没敲回车的内容冲掉。
- **根因**：
  1. Open Yami 引擎的检视器架构依赖 `Inspector.inputBlur`（`inspector.ts:340`）与 `elements.on('blur')`（如 `file-scene-page.ts:56`）在失焦时将改动快照推入 `UndoManager`。无失焦则无撤销记录；
  2. 引擎的 AutoReload 机制只在 `Data.manifest.changes` 不含该 meta 时才重载，未失焦的内容不在 changes 中，文件刷新瞬间会被旧值覆写。
- **铁律**：
  1. AI 修改属性时必须严格遵循 `focus() -> 改值 -> 派发事件 -> blur()` 规范闭环，确保引擎真正生成撤销条目；
  2. 在操作目标控件前必须主动保存当前焦点的元素引用与输入态，修改完成后无损还原原有焦点（Focus Preservation）；
  3. 执行写盘与属性修改前，必须主动通过 `probe.hasPendingInput()` 探测未失焦状态，若为真则前置拦截并友好提示用户敲回车失焦，严禁冲刷未提交输入。
- **验证**：`tests/test-ui-operation.cjs` 包含焦点保护断言（原有焦点与输入内容零损耗）与 `pendingInput` 拦截断言；`build.cjs` 增设 `hasPendingInput` 关键锚点守卫。

### ㊹ 模块作用域与块级作用域的错配：函数引用块内 const 必抛（Block-Scoped Declaration Reachability）

- **现象**：V1.5.3 的「环境感知」整条链路（`/context` 路由、面板顶栏常显上下文行、写盘前的未失焦守卫、`scope` 字段）**全部静默失效**：`/context` 请求永远拿不到响应，上下文行恒定显示「未检测到活跃场景或工作区」，却没有任何报错冒到用户面前；连带的三个验收项在纸面上还是全绿。
- **根因**：`const isEditorHostPage` 声明在 `try { if (typeof require === 'function') { ... } }` 这个**块**里，而 `getScope()` / `getEditorContext()` 在**模块作用域**引用它 —— 块级 `const` 在词法上根本不可达，函数一被调用就抛 `ReferenceError: isEditorHostPage is not defined`。这跟运行环境无关，**任何机器上都必然抛**；又因为所有调用方都包了 try/catch 静默兜底，错误被完整吞掉，只剩"功能不好使"这一层表象。
- **铁律**：
  1. 会被多处函数引用的判定量（页面身份、路径、能力探测）**必须声明在模块最外层**，不许图省事塞进 `try` / `if` 块里；
  2. 新增"静默兜底"的 try/catch 时，必须在同一次改动里给这条链路补一条**本来会红的**断言 —— 否则错误只是换个地方继续隐身。
- **验证**：`tests/test-ui-operation.cjs` 的「`probe.getEditorContext()` 可执行（作用域回归守卫）」与「`GET /context` 返回 ok」两条；修复前必红。

### ㊺ 打断标记必须粘到整轮结束，不能被每次高亮重置（Sticky Cancel Flag）

- **现象**：用户按了停止，AI 却把整批界面操作做完；只有恰好按在 340/420ms 高亮停留期内的那一次能停住。
- **根因**：`ringTo()` 入口有一行 `cancelled = false`，每次画高亮都把打断标记清掉 —— 落在 `wait` 步骤或步骤间隙的打断，被紧随其后的那次 `ringTo` 悄悄吞掉；`/ui-cancel` 这条路又因为 `cancel` 不在 5967 的动作白名单里返回 400 被忽略。两条路一起断，用户看到的就是"停不下来"。
- **铁律**：
  1. 打断是**整轮有效**的状态，只能在一轮开始时清零（`resetCancel()`），任何中间步骤都不许重置；
  2. 做"能被用户打断"的长流程时，前端、宿主、动作桥三段的动作名必须对得上 —— 白名单里少一个词，前端那个停止按钮就只是个装饰。
- **验证**：`tests/test-ui-operation.cjs` 的「急停落在 wait 步骤之间仍被尊重（回归守卫）」与「cancel 动作在 5967 白名单内」。

### ㊻ 依赖外部补丁的能力：要么降级、要么显式报错，绝不静默整体失效（Graceful Capability Degradation）

- **现象**：用户在官方预编译版编辑器上反馈"AI 什么都不会做"。查下来：5967 编辑器动作桥**从来没启动过** —— 它启动时要求页面上能取到引擎接口（`window.YamiEngine`），而那是引擎仓库的**本地补丁**，只存在于作者的 Linux 源码构建上，官方预编译版根本没有这个全局。于是整座桥被放弃，连**根本不依赖引擎**的纯 DOM 能力（界面演示 / 高亮 / 点击 / 界面结构读取 / 环境快照里的"有没有未失焦输入"）一起失效。整个过程只有一行 `console.warn`，用户侧毫无提示。
- **根因**：两个错误叠在一起 ——
  1. 把「服务能不能起来」和「可选依赖在不在」绑死在启动期一次判空上，依赖缺失就 `return`，于是**能力粒度**的降级根本无从谈起；
  2. `engineApi()` 把浏览器**原生** `window.File` 当成引擎 `File` 返回（老代码注释里甚至写着"别拿来当引擎用"），判空只剩 Directory/Data 两项，排查时这半个真值极具误导性。
- **铁律**：
  1. 服务的启动**不要**和可选依赖绑死：依赖缺失时服务照起，把「不可用」降到**单个动作**的粒度去报错；
  2. 可选依赖必须在返回值里**可探测**（`engineAvailable` / `engineMissing`），别只写 `console` —— 用户看不到控制台，模型也看不到；
  3. 判「接口在不在」要看**能力**（`typeof F.save === 'function'`），不要只看对象真值：`window.File` 这类同名原生对象会把判空变成假阳性。
- **验证**：`tests/test-ui-operation.cjs` 的 A2 段 —— 在"引擎接口一个都取不到"的沙盒里，桥仍须启动、`uiSteps` 照常生效、`save`/`undo` 给出带 `engineUnavailable` 的可读原因。

### ㊼ 预览不该要确认，落盘才确认（Preview Is Free, Commit Asks Once）

- **现象**：用户让 AI 往技能事件里加一条指令，AI 先做 `dryRun:true` 预览（**这一步根本不落盘**），却被要求点「执行修改」；用户没点、转口说了新需求，宿主按"新消息作废旧确认"的规则把这次操作作废，用户看到「已放弃未确认的操作」并问"为啥不给我编辑"。准备半天的成果连同 AI 的调研上下文一起白费。
- **根因**：审批判定 `FILE_MUTATIONS.has(name) && !granted` **只看工具名、不看参数**，于是 `dryRun:true` 的纯预览和 `dryRun:false` 的正式写盘走同一条确认路径。而宿主在真要确认时内部还会再跑一次 `dryRun` 取差异 —— 等于同一个预览算两遍、用户还被问一遍。
- **铁律**：
  1. 审批粒度按**会不会真的写盘**来定：显式 `dryRun:true` 免确认（只认显式 —— 模型不传这个参数时，无法保证工具一定不写），`dryRun:false` 照旧拦；
  2. 一次需求里能合并的落盘就合并成一次确认 —— 让用户点十次，他最后只会闭着眼点，安全性反而更低；
  3. 作废挂起操作时，提示必须**说清怎么补救**（"想要的话说一句『接着刚才那步做』"），并给模型补一条"要不要重做"的应答，别让两边都以为对方会处理。
- **验证**：`tests/test-ui-operation.cjs` 的 C5/C6 —— 真宿主 + 假模型发同一条工具调用，`dryRun:true` 断言确认卡数为 0 且预览真的成功，`dryRun:false` 断言确认卡恰好 1 张且本轮以 `approval` 收尾。

### ㊽ 「新建」类操作永远不许顺手删数据；界面上的数字要按用户视角单独算（Non-Destructive Intent）

- **现象**：面板上那个写着**「新对话」**的按钮，每点一次就把**上一段对话从磁盘上删掉** —— 用户的原话是"历史对话有问题啊，怎么显示的数量不对啊，我新建对话之后出现的 bug"。同时历史列表上屏的是**内部消息条数**（含 system、含每条工具结果），问一句「你好」显示"3 条消息"，调几次工具就变成几十条。
- **根因**：两件事凑在一起 ——
  1. 按钮的处理里顺手打了一次 `/clear`，而 `/clear` 的实现是 `sessions.delete + fs.rmSync(会话文件)`。**UI 语义（开一段新对话）与后端副作用（不可逆删文件）根本不一致**，按钮替用户做了一件他没要求、也撤不回来的事；
  2. 列表把内部 `messages.length` 直接当"消息数"上屏。内部结构里混着 system 提示与每条工具结果 —— 这些用户根本看不见，数字自然对不上。
- **铁律**：
  1. 破坏性操作只能由**语义明确**的入口触发：`/clear` 只清内容、`/session/delete` 才删文件；"新建 / 切换 / 打开"这类操作**永远不许顺手删数据**；
  2. 界面上给用户看的数字必须**按用户视角单独算一遍**（"你说了几轮"），不许把内部数组长度直接端上去；
  3. 涉及数据丢失的路径，断言要落在**"操作完文件还在不在"**上，不能只测界面反应。
- **验证**：`tests/test-ai-session.cjs` 第 8 节 —— `/clear` 后文件仍在、内容只剩 system、`turns` 与 `messageCount` 确实是两回事、只有显式删除才真的移除文件。

### ㊾ 点了没反应就是 bug：闸门别用错变量，长任务要有反馈，界面永远留出路（Never A Dead Button）

- **现象**：确认卡上点「执行修改」**毫无反应**，再点还是没反应 —— 用户只能重启编辑器。三层原因叠在一起：
  1. `decide()` 第一行是 `if (state.busy || !state.pending) return`。而审批卡弹出来时，本轮正处在"暂停等人"的状态，`state.busy` **本来就可能为 true**（SSE 还开着）→ 直接被挡掉，且是**静默** return，一点反馈都没有；
  2. `/approve` 当时是普通 POST、**不是 SSE**：确认之后整轮在后台跑完（可能还有好几轮模型调用 + 工具）才一次性返回，期间界面上一个字都不会动 —— 用户看到的就是"卡住了"（**已在 v1.6.11 改成 `/approve/stream` 事件流，见【52】**）；
  3. `stopStream()` 只 abort 了 SSE，**不负责解开 busy**。流一旦已经死掉，`runMessage` 的 finally 永远回不来，busy 就永久挂着，发送/执行全变死按钮，只能重启。
- **铁律**：
  1. 任何"点了没反应"的分支都是 bug：要么给反馈、要么给理由并说明怎么办，**禁止静默 return**；
  2. 交互闸门要用**语义相符**的变量：防连点就用 `deciding`，别拿"本轮是否在跑"的 `busy` 去挡一个"暂停等人"的动作；
  3. 长耗时又**没有流式输出**的操作，必须显式告诉用户"它在干活"+ 计时，并且保证随时能停；更彻底的做法是别让它"没有流式输出"——把这类动作接进同一条事件流（见【52】）；
  4. 打断路径必须**自己负责**把界面状态解开，不许赌"那个异步早晚会回来"。
- **验证**：`ai-agent.js` 的 `decide()`（`!state.pending` 才拦，`state.deciding` 防连点，续跑走 SSE 实时上屏）与 `stopStream()`（兜底清 busy、解开 `deciding`、还原按钮文案与挂起卡）。

### ㊿ 在场感知（用户停在哪个控件上）与「引擎行为一律读源码定论」

- **需求**：插件要能感知"用户此刻停在编辑器界面的哪个控件上"（某个参数文本框、某个选项、右键选中的东西），把这条信息传给模型；同时顶栏文案要短，只显示停留重点。
- **怎么定论的（本机有引擎源码，一律去那里读，不拿现象猜）**：引擎源码在 `D:\Documents\GitHub\2\Project\Script`。
  - **右键高亮的真身**：`components/common-list.ts:230` 的 `pointerdown` 里 `case 0` 与 `case 2` 走同一支 → `this.select(element)`；`select()` 给目标 `addClass('selected')`（`components/element-methods.ts:33`，是真 class），index CSS 里有 78 条规则在给 `.selected` 上色 —— 所以**右键就是"选中"**，权威信号是 `.selected`，不是焦点环（我一开始猜成焦点环，错了）。
  - **控件名字有三种写法，都要认**（拿引擎真实标记做过覆盖率审计，1533 个控件实例）：
    ① `name` 属性（107 个）；
    ② **标签在控件前面**：`<text>Icon</text><custom-box id="fileSkill-icon">`（1073 个）；
    ③ **标签在控件内部**：`<number-box id="animation-speed" …><text class="label">speed:</text></number-box>`（85 个）——
    这一种一开始漏了，是"用真实标记跑覆盖率审计"才发现的，光靠自己手写两个样本永远发现不了。
  - **覆盖率是实测出来的，不是估的**：把 `tests/` 之外的临时审计台（迷你 HTML 解析器 + 真探针）跑在引擎真实 `index.html` 上——6011 个元素节点、**1529 个真控件实例**，结果：**能精确说出控件名 1441 个（94.2%）**、退到区域级 86 个（5.6%）、什么都给不出 **2 个（0.13%，都是瞬时建议弹窗）** —— 合计 99.87% 都能报出"用户停在哪"。
  - 区域级那 86 个的名字**照样取自引擎真实标记里的文字**，不是拿 id 充数：先是已知区域 id；再是**所在窗口的名字**（`<window-frame id="showText"><title-bar>Show Text<close></close></title-bar>`→「Show Text」）；再是**所在分组的 `<legend>`**（`<field-set id="event-commands-fieldset"><legend>Content</legend>`）。补这两条之前，什么都给不出的是 39 个（2.6%）——直接把覆盖率从 96.8% 拉到 99.87%。
  - 剩下 2 个（`node-list#command-suggestions` / `#text-suggestions`）的祖先连一个 id 都没有，无处可锚 —— 它们是输入建议弹窗，可接受。
  - **两个只有真实标记才能发现的坑**：① 标签写在控件**内部**的写法（`<number-box …><text class="label">speed:</text></number-box>`，85 个）——手写样本永远发现不了；② 曾经拿"前一个兄弟文字很短"当标签判据，结果前一个兄弟是别的控件时，会把它的值当成本控件的名字（hover 在 canvas 上却报"停在 speed:1.0"）。**判据必须是标签元素本身（`text`/`label`/`legend`），不能是"文字短"。**
  - **值**：`custom-box` / `number-box` 没有 value 属性，值写在控件自己的 textContent 里；若标签也在内部，要把标签部分剥掉只留值。
  - **引擎自带的人话说明**：元素上的 `.tip`（`element-methods.ts:120` 的 setTooltip），**可能是字符串也可能是 getter 函数**，两种都要认；只取第一行并剥掉 `<b>` 之类标记。
- **实现**：`probe-core.js` 的 `getPresence()` 把信号分成**两组，顺序有意义**：
  1. **"他现在在哪儿"**（指针停留 ≥600ms / 焦点 / 右键）—— 组内按最近优先，**每个候选先精确描述、认不出就退到它所在的"区域"级**（`REGION_NAMES` 只认引擎静态标记里真实存在的容器 id：`scene-screen`/`ui-screen`/`inspector`/`command-list`/`project-browser`…）。场景里的对象是 WebGL 画的、没有 DOM 节点，所以 canvas 上只能报到"停在场景视图"这一级 —— 但总比什么都不说强。
  2. **"他选了什么"**（`.selected`）—— `.selected` 是**持续状态**，不是"此刻在哪"，所以只在①什么都问不出来时兜底。
  - 两个踩过的坑：**(a)** 别把选中态和悬停放一起比时间戳，否则"鼠标已经挪到 canvas 上了"仍报上一次选中的列表项；**(b)** 组内不能"先把所有候选的精确描述都试一遍再退区域"，否则上一次右键的那个控件会盖掉"刚停在 canvas 上"这件更新的事实。
  - 鼠标移到自己面板（`#yami-perf-dock`）上**不清空**上一个停留点 —— "从编辑器挪到面板来打字"恰恰是最该报的时刻。
- **摘要口径**：`formatEditorContextSummary` 改成**在场优先、只说这一件事**（页面/场景用户自己看得见，不占顶栏那一行）；只有"区域级"停留点才补一条背景（比如选中的场景对象）。顶栏与系统提示词共用这一条，实测从 ~90 字降到 13~24 字。
- **铁律**：判断引擎行为**一律读源码定论**，不要从现象反推。现象给灵感，源码给定论。
- **验证**：`tests/test-ui-operation.cjs` 的 A3 段（四个来源 + 区域兜底 + 摘要长度 + tip getter + 面板例外，共 17 条）。
- **圈码用尽**：本条是 ①-㊿ 的最后一条。再加铁律需要换编号形式，并同步改 `tests/test-static-health.cjs` 里的正则 `^### [①-⑳㉑-㉟㊱-㊿]`。

### 【51】宿主不许静默死亡，前端请求不许没有超时（No Silent Death, No Endless Wait）

- **现象**：用户点了确认卡上的「执行修改」之后，卡片一直显示「执行中…」不消失，**聊天也再也不继续**，只能重启编辑器。
- **根因**（两件事叠在一起）：
  1. **AI 宿主进程静默死亡**：它其实把活干完了（会话文件、spill 文件都落了盘），之后进程消失 —— `/approve` 的 HTTP 响应永远发不出去。Node 对 `uncaughtException` 的默认行为就是**直接退出**，而宿主没有任何进程级兜底，控制台也不会留下原因。事后查到的现场：5968 端口无人监听、进程列表里没有它、最后一次写盘就在那一轮。
  2. **前端 `fetch` 没有超时**：宿主没了，`request()` 就永远挂着；面板既收不到结果、也不知道对方已经不在了 ——「执行中…」于是成了永久状态。
- **铁律**：
  1. 长驻子进程必须接住 `uncaughtException` / `unhandledRejection`：**落盘留证（`host-crash.log`）+ 不退出** —— 一个请求出问题不该把整个服务带走；
  2. 任何跨进程请求都要有超时，而且"对方已经没了"要能**确定性地**发现：走 SSE 的请求，**流断了却没拿到 `result` 事件**就是宿主没了，直接如实报错。
     原先那条"并行 ping `/status`、连续两次失败就掐断请求"的看门狗已删除：宿主是单进程，编译（tsc）这类活儿一忙就会让 `/status` 连着超时，把"正在编译"误判成"宿主已退出"——猜出来的死，比不上连接断掉这种确定性信号（见【52】）；
  3. 打断/停止路径必须把**所有**中间状态一起解开 —— 这一版差点又漏掉 `deciding`，那会让下一次「执行修改」被防连点闸门静默挡掉，又是一个死按钮。
- **验证**：`tests/` 全量（约 10 个套件会拉起宿主，宿主不能变哑巴）；"流断了没结果"由 `tests/test-ai-repair.cjs` 的 `/approve/stream` 段间接钉住（续跑必须给出 `result`），前端报错分支属浏览器代码，靠真机确认。
- **圈码用尽**：从本条起改用 `### 【N】` 形式；`tests/test-static-health.cjs` 的文档一致性正则已同步。

### 【52】一个回合只从一条事件流渲染：审批续跑与正常一轮必须走同一段代码（One Feed, One Transcript）

- **现象**：勾选授权、点了「执行修改」之后，"聊天的显示顺序就不太对了" —— 确认之后那一段过程要么整段不见，要么以散行形式堆在对话末尾，跟前面那一轮接不上；那张工具卡片还会永远停在「运行中」。
- **根因**（两处，本质都是"渲染出来的顺序 ≠ 实际发生的顺序"）：
  1. **审批续跑不在事件流上**：`/approve` 当时是普通 POST，宿主跑续跑时 `events = {}`，中途的工具调用、思考、提示**一个事件都发不出来**；前端只能等最终结果回来，用 `handleResult()` 把最后那段正文一次性落下。而这时 `runMessage` 的 `finally` 早就调过 `endTurn()` 把回合组关了 —— 续跑的所有行都落在回合**外面**，顺序全凭到达时刻。这与 DSH 的做法正相反：DSH 的 transcript 只从一条事件流装配（`data-chat-anchor-key="call:<id>"`，按 key 就地更新）。
  2. **过程区可能被追加到正文下面**：`processArea()` 只会 `appendChild`。模型"先说一句、再调工具"是很常见的一轮开头（尤其不流式输出推理的模型），正文槽这时已经建好，过程区于是被挂到正文**下面** —— 读起来就是"答案在前、过程在后"。
- **铁律**：
  1. **一个回合的对话只从一条事件流装配**：`/chat/stream` 与 `/approve/stream`（含 `/reject/stream`）必须跑**同一段渲染代码**（`streamTurn`）；续跑要有自己的回合组（`prepareTurn()`），否则它的卡片与提示没有归属。两条渲染路径 = 两套顺序 = 迟早对不上。
  2. 过程区与正文槽的前后关系是**不变量**：过程永远在正文之前（`insertBefore`），不许依赖"谁先创建谁在前"。
  3. 提示行**不计入步数**（否则"执行了 3 步"是假的）；失败类提示留在过程组**外面** —— 塞进可折叠的过程区，紧凑模式一收起来就等于把错藏了。
  4. 流断了却没有 `result` 事件 = 宿主没了，要如实报错，不许悄悄回到「就绪」；安静时只报"已等待 N 秒"，不猜"卡住了"。
- **验证**：`tests/test-ai-repair.cjs` 第 6b 段（真宿主 + 假模型跑 `/approve/stream`：有 `start`、有工具 `start`/`done` 收尾、有逐字正文、有最终结果；`/reject/stream` 同）；`tests/test-ai-agent.cjs` 把上述接线逐条钉住（含"审批路径不许再有旁路渲染函数 `handleResult`"）；`build.cjs` 三项锚点（续跑事件流 / 宿主 SSE 路由 / 过程区在前）。

### 【53】测试断言要断行为，不要断文本（Assert Behavior, Not Source Text）

- **现象**：v1.7.0 发布的「历史 / 撤销纯净子视图」里，「进子视图隐藏输入区」这条规则**从上线起就没生效过**，而测试一直是全绿的。
- **根因**：那条 CSS 写的是一组 id 选择器，其中 `#yami-ai-quick-bar`、`#yami-ai-composer` **在整个插件里都不存在**（真实类名是 `.yami-ai-compose` / `.yami-ai-devbar`），写了等于没写；而测试断言是 `cssContent.includes('.yami-ai-page.view-undo #yami-ai-composer')` —— **只检查"这段文本在不在文件里"**，指错的选择器照样通过。审计 `audit/REPORT.md` G-10(d) 把它连同"测试假绿"一起揪出来。
- **铁律**：
  1. 凡"某规则必须命中某元素"的断言，要断**存在性或行为**：本轮把测试改成解析该 CSS 规则、逐个核对每个 id/类都能在面板标记里找到 —— 改后的断言会把旧选择器直接判为"指向不存在的元素"（实测会失败）；
  2. 同理，别拿 `源码.includes('某函数调用')` 当"这段逻辑真的会跑"的证明；静态断言保不了什么，要在注释里写明边界；
  3. 审计里"功能没生效"这一类缺陷，**先问"为什么测试没抓到"，把测试一起修**，否则下次照漏。
- **验证**：`tests/test-subviews-floating.cjs`（21/21；其中 3 条断言是"选择器必须指向真实存在的元素"）。

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

> 更新日期：2026-09-13 · 当前版本：`v1.10.8`

## 3.1 能力清单与完成度

| 能力 | 状态 | 位置 / 说明 |
| :--- | :--- | :--- |
| 性能大盘（帧率 / DrawCall / 真凶归因 / A-B 排查） | 已落地 | `probe-core.js` + `hud-overlay.js` |
| 运行日志与错误黑匣子（指纹聚合 / 指令级时间线 / 幽灵事件） | 已落地 | 同上 |
| 存档管理（速改 / 变量开关 / JSON 树 / 一键还原） | 已落地 | 同上 |
| 场景实体检查台 / 作弊台 / 工程体检 / 诊断断点 | 已落地 | 同上 |
| AI 助手面板（流式对话 / 思考过程 / 审批差异 / 撤销 / 计划 / 变更小结） | 已落地 | `ai-agent.js` |
| AI 宿主（模型调用 / 工具编排 / 会话持久化 / 上下文计量与两级压缩 / 计费 / 连接体检 / 打断） | 已落地 | `ai-host.js` + `context-meter.js` |
| 内置 MCP 工具集（36 项：读 / 写 / 搜 / 编译 / 事件编排 / 数据表 / 备份 / 试玩冒烟 / 编辑器上下文…） | 已落地 | `runtime/yami-mcp/` |
| 代理能力（子任务委派给子代理） | 未做（P2） | 见 3.3 |
| 计划模式（Plan Mode） | 明确不做 | 用户拍板不需要 |

## 3.2 最近一轮完成（2026-09-11 → 09-13）

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

17. **AI 助手聊天体验对齐 DSH（v1.4.0）**：参考 DSH 源码与它的包级中文设计文档（`dsh-client-ui-chat` / `dsh-client-ui-tool` / `dsh-client-ui-conversation`）逐条移植聊天侧机制。① **思考按模型轮次分块**：工具调用或正文一到就封段、下一轮思考另起一块（段头 `第 N 段 · 已思考 X 秒 · Y 字`），分段状态机 `createThinkingSegments` 放进渲染核心（纯逻辑可单测）；每段独立文本缓冲，否则第二段会把第一段吞进去。② **历史回放与实时同构**：宿主 `visibleMessages` 不再丢掉"只有思考没正文"的工具轮，工具步骤也回放成「执行：xxx」行（与实时工具条共用同一张中文名映射），空正文不再产生空气泡。③ **A1 轮次过程智能收起**（对齐 DSH `turn-process-folding`）：紧凑/标准两档（默认紧凑，localStorage + 宿主配置双写），轮末在「有最终正文 + 焦点不在过程里」时才收起成一行 `思考 X 秒 · N 段 · M 步`；没有最终正文的轮次保留全部过程证据。④ **A2 每轮用量行**（对齐 DSH `turn-token-usage`）：宿主新增每轮记账（`runTurn` / `turnUsageOf`），结果带**本轮增量**，**记账不全就整行不显示**；顺带修好非 SSE 降级路径漏读 `usage` 与思考（本地推理服务忽略 `stream` 参数时，用量行与思考块本来永远是空的）。⑤ 修「再次出现的思考窗口没有文字」（铁律㊶）。⑥ 顺手修掉 5 套测试在 Windows 上的假红（断言全过、收尾 `rmSync` 抛 EPERM 被判失败）。

18. **对齐 DSH 的第二批聊天机制（v1.5.0）**：① **工具卡片**（对齐 `dsh-client-ui-tool`）——工具调用不再是「一行过程条」，而是一张卡片：状态点（运行中/成功/失败/待确认）+ 中文工具名 + 目标路径（可点，一键在文件夹中定位）+ 右侧事实标签（`+12 / -3 行`、`命中 7 处`、`共 67 条`、`退出码 0`…），点开展开细节与错误原文。事实标签全部来自宿主新加的结构化摘要 `toolInfoOf()`，前端不许从中文描述里猜数字。② **超长输出落盘**（对齐 DSH 的 spill）——工具结果被裁剪时，完整原文写进 `<配置目录>/spills/`，事件里带 `truncated + spill.path`，卡片如实标注「已截断 · 打开落盘目录」，给模型的提示也写明路径；**绝不拿部分总量冒充完整**。③ **系统提示词行**（对齐 DSH 的 system-prompt-row）——把模型这一轮实际看到的 system 原文做成一行可折叠项，宿主按文本指纹去重（没变不重复刷，resume 后允许再来一次）。④ **排队与引导**（对齐 DSH 的 queue / steering）——繁忙时按发送不再把用户打的字吞掉。**输入区只保留一个发送按钮**（用户 2026-09-13 裁决：不要让用户每次在按钮之间选），行为改由【设置 → 繁忙时发送】两档决定：**排队**（默认，进排队区、本轮结束后依次发出、可单条撤回）或**打断**（先真停当前轮、等它收尾再发这条）；另有 Ctrl/Cmd+Enter 保留为"引导"快捷键（`POST /steer`），由 Agent 循环在**下一个步骤边界**投进上下文，送达后才改口「已送达模型」；没赶上的由宿主如实退回排队区（`undeliveredSteer`）。⑤ **轮次导航轨道**（对齐 DSH 的 turn rail）——聊天区右侧每一轮一个刻度，按"阅读线"高亮当前轮（判据 `activeTurnIndex` 在渲染核心），点刻度跳过去，悬停现算一句预览。⑥ 渲染核心新增 4 组纯逻辑并配单测（`toolCardChips` / `truncationText` / `activeTurnIndex` / `shortAmount`），渲染性能套件 89 项；E2E 新增四项真机断言（系统行去重、工具事实、落盘文件真的在、引导真的进了历史）。

19. **AI 助手界面视觉与交互重构（2026-09-13 UI 现代化升级）**：
    - **工业暗黑美学质感**：重写 `src/style.css` 核心样式，背景与面板对齐工业极客暗黑风（`#18191e` / `#15161b` / `#0f1013`），多层级阴影与 1px 细微光边框，彻底消除粗糙生硬感；
    - **极客工具栏（Geek Toolbar）**：顶栏仪表盘集成发光呼吸状态指示灯（`.yami-ai-status-pulse` + 动画 `yami-ai-glow`），区分就绪（翡翠绿）、忙碌（科技蓝）、待命（琥珀黄）、异常（珊瑚红）四态光晕；右侧动作按钮组胶囊化，Hover 微上浮与 Active 微下沉交互；
    - **正统 Remix Icon 官方矢量化**：在 `ai-agent.js` 中内嵌 `AI_ICONS` 官方 Line 风格 SVG Path 常量（撤销、历史、清空、设置、关闭、刷新、CPU、Brain、发送、停止等），0 外链 0 依赖，彻底取代旧版生硬字符；
    - **一体化输入工作舱（Input Island Workstation）**：重构输入区结构，将自适应文本框与底部快捷操作栏（模型胶囊、刷新按钮、Thinking 强度胶囊、发送/停止键）封装为独立岛屿卡片，支持 `:focus-within` 科技蓝呼吸外发光；
    - **抽屉面板卡片化与细节打磨**：设置面板、撤销面板与历史记录面板统一采用带微光浮层卡片设计，设置面板补齐关闭入口；用户消息气泡改用微蓝渐变（`#1e3a5f` -> `#152744`），思考卡片采用左侧蓝紫（`#6366f1`）科技条；
    - **严格守卫工程门禁**：滚动条单一事实源选择器组严格无损保持，0 任何原生 `<button>`，0 任何系统 Emoji，`build.cjs --deploy` 46 项锚点全绿并 100% 镜像同步至生产目录。

20. **顶栏单行布局收敛与纯文字发送按钮优化（2026-09-13）**：
    - **发送/停止键纯文字化**：彻底移除按钮内的 SVG 图标，采用纯文字「发送」与「停止」；样式调整为自适应输入框高度垂直居中展示，字号 13px / 600 字重 / 1px 字距，杜绝图文纵向挤压变形；
    - **顶栏单行防折行治理**：
      1. 精简上下文刻度文案：由冗长的「上下文 97.2k/1M · 10%」缩减为极简纯数字比例「97.2k · 10%」（临界/压缩标也做紧凑化），完整说明与 1M 窗口压缩算法保留在 hover 浮层 title 中；
      2. 统一动作按钮容器类名（`.yami-ai-toolbar-actions`），加固 `.yami-ai-toolbar` 强制 `flex-wrap: nowrap`；
      3. `.yami-ai-status` 与 `.yami-ai-context` 固定 `flex: 0 0 auto` 与 `white-space: nowrap`，工具按钮精致化（高 24px、内边距 6px），确保在 380px 停靠侧栏下绝对单行展示，不再折行截字；
    - **构建与门禁核验**：`build.cjs --deploy` 46 项核心锚点全绿，生产镜像 100% MD5 对齐，测试套件 `test-ai-agent.cjs` 零报错通过。

21. **思考过程时间戳秒数暴走 Bug 修复（2026-09-13）**：
    - **现象与根因**：用户反馈在查看对话时思考过程窗口显示「已思考 1789262202 秒」。经排查定位：在一轮思考结束（正文到达或工具调用）时，`sealThinking()` 正常定格了真实耗时并置 `thinkingStartedAt = 0`；但紧接着流式循环退出收尾（`streamChat` 退出循环后的兜底刷新）或异步排队的 `flushThinking()` 再次被触发。旧代码在 `flushThinking` 与 `renderThinking` 中未判断 `thinkingStartedAt` 是否有效，直接无脑执行 `Math.round((Date.now() - thinkingStartedAt) / 1000)`，在 `thinkingStartedAt === 0` 时直接计算了 `Date.now() - 0`，硬生生把当前毫秒时间戳换算成 17.8 亿秒覆写到了 DOM 上；
    - **修复措施**：
      1. `flushThinking` 与 `renderThinking` 严格添加 `if (thinkingStartedAt > 0)` 门禁，已定格封口（`thinkingStartedAt === 0`）时严禁更新耗时；
      2. `thinkingMetaText` 注入上限防御（`0 < seconds < 86400`），彻底阻断任何异常暴走秒数泄露到段头界面；
      3. `loadSession` 历史加载入口显式置空 `currentThinkingEl` 与 `thinkingStartedAt`，保证干净回放；
    - **验证凭据**：`build.cjs --deploy` 46 项断言全绿，镜像 MD5 对齐，`test-ai-agent.cjs`、`test-render-perf.cjs`（89 PASS）全部通过。

22. **交互细节与边界盲区加固（v1.5.2，2026-09-13）**：
    - **中文输入法（IME）防误发送**：在输入框回车监听中增加 `event.isComposing || event.keyCode === 229` 判定，彻底解决拼音打字回车选字或上屏时直接被当作需求误发送的痛点；
    - **模型刷新按钮样式与加载动效复活**：将 HTML 中失联的 `.yami-ai-fetch-btn` 与 CSS `.yami-ai-capsule-btn` 类名双向对齐，原地复活拉取模型列表时的旋转加载动画（`yami-spin`）与胶囊内微光 Hover 交互；
    - **超长模型名排版防撑爆**：为 `.yami-ai-capsule select` 声明 `max-width: 140px !important; text-overflow: ellipsis !important;`，彻底避免第三方或本地复杂超长模型名撑爆侧栏横向布局；
    - **思考开关与强度下拉状态联动**：关闭思考复选框时联动将 Low/High/Max 强度下拉框禁用置灰（`disabled` + `opacity: 0.4`），开启时即刻恢复，消除配置逻辑矛盾；
    - **繁忙态操作友好 Toast 反馈**：当模型正在输出时，点击清空新对话或切换历史会话，由过去的无声静默忽略改为明确弹出轻量 Toast 提示（`AI 正在处理中，请先停止或等待本轮结束`），杜绝造成界面卡死假象；
    - **输入框自适应撑高与单一事实源滚动条美化**：监听 input 事件按内容行数在 52px~140px 间平滑自适应拉伸（发送键等高联动拉伸，清空时自愈复位），并将 `#yami-ai-input` 完整纳入 WebKit 统一滚动条选择器组，消灭 Windows 原生粗糙泛白大滚动条。

23. **核心后端与宿主工具流安全盲区加固（v1.5.2，2026-09-13）**：
    - **引导（Steer）错误丢失治理（铁律㊷收下≠送到）**：修复 `runTurn` 捕获异常时 `finally` 直接清空队列导致引导丢失的问题；在 `catch` 路径安全取回 `takeUndeliveredSteer` 并挂载至错误响应返回前端，前端自动原样退回排队区，杜绝欺骗用户；
    - **整包快照解包路径穿越防御**：本地安装或解包存在潜在穿越漏洞，在更新器解包时新增 `isUnsafeSnapshotPath` 检查，严格阻断绝对路径与 `../` 越出插件目录的恶意或坏条目，实现解包与落盘双重门闩防护；
    - **超长输出落盘文件容量收敛**：工具超长输出落盘目录（`spills`）新增保留策略，自动按修改时间排序仅保留最近 40 份，消除无界磁盘占用风险；
    - **MCP 工具路径真实指引（纠正假提示）**：模型工具 `file-ops` 严格只认工程根目录内的相对路径。修正向模型输出的裁剪提示，明确告知“你读不到落盘绝对路径”，引导其使用更精确的参数（如 `read_resource` key、`list_*` 分页）重新获取，消除模型工具报错死循环；
    - **审批卡片状态完整闭环**：`decide()` 补全卡片生命周期闭环，在批准、取消或用户发起新需求时统一调用 `resolvePendingCard()`，解决审批卡片永远停滞在“等待你确认”黄点状态的问题。

24. **编辑器与场景实时环境感知机制（方案 A 落地与对抗加固，v1.5.3，2026-09-13）**：
    - **痛点与突破**：此前 AI 无法感知用户当前在编辑哪个场景、打开了什么或选中了哪个道具/技能，用户提问必须人工反复复述上下文；
    - **真实字段与对抗性加固**：
      1. 修复检视对象名称恒空：查明 `Inspector.meta` 为 `FileMeta`，真实文件别名取自 `Inspector.meta.file.alias`（如 `木剑.item`），杜绝无效的 `meta.name`；
      2. 修复场景对象类别恒为 object：查明权威类别字段为 `Scene.target.class`（`actor/region/light/tilemap...`），解决被误判为通用 object 的缺陷；
      3. 资源树选中文件名优先读取 `FileItem.alias`，彻底消除 16 位哈希 GUID（`木剑.a1b2c3d4e5f6a7b8.item`）对提示词的噪音干扰；
      4. 试玩窗口与编辑器窗口环境隔离（双通道）：`probe-core.js` 在页面内暴露 `window.__YAMI_CTX_SUMMARY__`，`ai-agent.js` 在当前窗口直发一手环境快照，宿主优先采信前端直发快照（防止试玩窗口被 5967 误报为“编辑器”），无则平滑回退 5967 桥；
      5. 环境摘要增加 180 字符防御上限截断；
    - **MCP 工具与系统提示词动态注入闭环**：
      1. `runtime/yami-mcp/server.js` 新增只读工具 `get_editor_context`（工具总数扩充至 36 项），供模型主动查询；
      2. `ai-host.js` 将单行极简摘要（如 `【当前环境】编辑器 · 场景「新手村」 · 选中「item/木剑.item」 · 检视「木剑.item」`）动态追加在首条 system 提示词末尾，落盘 session 保持纯净不受污染；
    - **测试守护**：`tests/test-ai-agent.cjs` 扩充真实的字段提取与动态 VM 执行断言，全绿通过。

25. **对话顺序与会话健壮性修复（v1.6.9 → v1.6.11 三轮补丁一次发布，2026-09-13 用户实测反馈）**：
    - **「给了权限之后，聊天的显示顺序就不太对了」**（铁律【52】，本轮主因）：审批续跑原本走普通 POST，宿主跑续跑时 `events = {}`，中途的工具调用/思考/提示**一个事件都发不出来**；前端只能等最终结果，用 `handleResult()` 把最后那段正文一次性落下，而那时 `runMessage` 的 `finally` 早已 `endTurn()` 关掉回合组 —— 续跑的行全落在回合**外面**，顺序全凭到达时刻，那张工具卡片还会永远停在「运行中」。修法：宿主新增 `/approve/stream` / `/reject/stream`（复用同一套 SSE 管道），前端把 `streamChat` 抽成通用 `streamTurn(route, body)`，**正常一轮与续跑跑同一段渲染代码**，续跑以自己的回合组承接（`prepareTurn()` / `finishTurn()`），旁路函数 `handleResult()` 整条删除。参考依据是 DSH 的做法（transcript 只从一条事件流装配、按 key 就地更新，见 `dsh-client-ui-chat` 的中文设计文档）；
    - **过程区会被追加到正文下面**：`processArea()` 只做 `appendChild`，而"模型先说一句、再调工具"会让正文槽先建好 → 过程区挂到了正文下面（读起来"答案在前、过程在后"）。改为 `insertBefore`，把"过程永远在正文之前"变成不变量；
    - **提示行的两条规矩**：提示不计入步数（否则"执行了 3 步"是假的）；失败类提示留在过程组**外面**（塞进可折叠的过程区，紧凑模式一收起来就等于把错藏了）；
    - **宿主静默死亡**（铁律【51】）：宿主补 `uncaughtException` / `unhandledRejection` 兜底（落盘 `<配置目录>/host-crash.log` + 进程不退出）；前端 `request()` 补超时（默认 10 分钟兜底）；判断"宿主没了"改用确定性信号 —— **SSE 断了却没拿到 `result` 事件**就如实报错；原先"ping `/status` 连续两次失败就掐断请求"的看门狗**已删除**（宿主是单进程，编译 tsc 时 `/status` 会连着超时，把"正在编译"误判成"宿主已退出"）；事件流安静时只显示"已等待 N 秒"，不猜"卡住了"；
    - **顺带**：确认卡做出选择后**立即收起**（不再等 `/approve` 返回）；`stopStream()` 兜底解开 `deciding` 并还原按钮文案（少这一步，「执行修改」会变成点了没反应的死按钮）；打断现在真的能停住续跑（续跑有了自己的 `AbortController`，取消令牌一路传到模型与工具循环）；
    - **验证凭证**：`node tests/run-all.cjs` **29/29 套通过**；`tests/test-ai-repair.cjs` 新增 §6b 段（真宿主 + 假模型跑 `/approve/stream`：断言有 `start`、工具 `start`/`done` 收尾、逐字正文、最终结果；`/reject/stream` 同）→ 该套 36 → **44 断言**；`tests/test-ai-agent.cjs` 把上述接线逐条钉死（含"审批路径不许再有旁路渲染函数"）；`node build.cjs` 51 项核心锚点 + 3 项新增 AI 锚点全绿；`--deploy` 镜像 MD5 与母仓库逐一相同。

26. **历史与撤销全屏子视图 + 自由悬浮窗模式（UI/UX 规范级落地，2026-09-13）**：
    - **历史与撤销按钮高亮与互斥**：打开选中后，顶栏按钮颜色实时高亮（增加 `.yami-ai-tool-btn.active` 类，鲜明科技蓝背景 `#1d4ed8` 与阴影微光），再次点击自动恢复默认并切回主对话视图；
    - **全屏纯净子视图展示（不留多余内容）**：打开历史（`#yami-ai-history`）或撤销（`#yami-ai-undo`）时，通过集中视图调度器 `setSubView` 激活 `#page-ai.view-undo` / `#page-ai.view-history`，物理级隐藏底层聊天记录（`#yami-ai-messages`）、输入框与工具快捷条（`#yami-ai-composer` / `#yami-ai-quick-bar`）、常显环境感知条（`#yami-ai-scope`）、审批确认卡（`#yami-ai-approval`），让历史与撤销面板 100% 独占剩余视区；头部展示 `.yami-ai-subpage-header`（带模块标题、功能白话说明与「返回对话」及「新对话」操作按钮），点击即刻还原对话工作区；
    - **自由悬浮窗模式与窗口尺寸调节**：在顶栏穿透按钮（`#btn-dock-pin`）左侧内嵌正统 Remix Icon 矢量悬浮窗图标（`#btn-dock-float`，`ri-picture-in-picture-2-line`，0 外部依赖 0 系统 Emoji）；支持点击在右侧停靠大盘与自由悬浮窗（`.yami-perf-dock.floating`）之间平滑切换；悬浮窗支持顶部拖拽随意定位（自动附带屏幕安全边界吸附保护）、右下角手柄（`#yami-dock-resizer`）拖拽调节宽高（带 380×400 最小尺寸保护），并通过 `localStorage`（`yami-perf-dock-floating`、`yami-perf-dock-pos`、`yami-perf-dock-size`）实现多开、刷新与重启后全自动记忆复原；
    - **构建与测试守护**：
      1. `node build.cjs --deploy`：51 项核心锚点全绿，无任何原生 `<button>`，无系统 Emoji，生产镜像逐文件 MD5 100% 一致；
      2. `node tests/test-static-health.cjs`：全通过（隐式全局 0 泄漏，CSS 结构配平，文档与套件数量 30 套 100% 一致）；
      3. `node tests/test-subviews-floating.cjs`：15/15 项断言全绿；
      4. `node tests/test-ui-operation.cjs`：78/78 项断言全绿。

27. **聊天工具流式呈现时序纠正与单轮步数上限治理（2026-09-13 用户实测反馈）**：
    - **工具条目时空倒流根因与修复**：
      - **根因**：原先模型先输出阶段性正文（如计划/前言）后再调工具时，由于 `currentTurn.process` 全局单例且 `processArea()` 强制 `insertBefore(box, currentTurn.body)`，导致新调用的工具被强行塞回顶部的旧过程框中，而下方正文纹丝不动，造成视觉上“历史倒流”；
      - **修复**：在 `streamTurn` 中引入**阶段状态切断**机制。当检测到 `bubble` 已有正文输出且后续收到 `tool (start)` 或 `delta (reasoning)` 时，立即封口当前正文（`flushContent()`）并重置 `bubble`、`bubbleTextNode`、`text$`、`currentTurn.process`、`currentTurn.body`。后续调用的工具卡片将通过 `processArea()` 以 `appendChild` 追加到消息流的最底部，与最新正文形成“思考/工具 -> 正文 -> 新工具 -> 新正文”的自然从上到下时间线；
    - **单轮步数硬编码 12 步暴力掐死治理**：
      - **根因**：原代码拍脑袋硬编码了 12 步极低阈值，满额后直接 `throw new Error('本次任务步骤过多（已达 12 步），已停止...')` 粗暴终止，无配置入口且抛异常中断体验极差；
      - **修复与彻底放飞**：
        1. `ai-host.js` 默认单轮步数阈值 `DEFAULT_MAX_STEPS` 调整为 `0`（**无限制**，彻底放飞，仅由 `repeats >= 3` 重复死循环打转检测熔断）；循环计算采用 `rawMaxSteps > 0 ? rawMaxSteps : Infinity`，步数上限不再人为设卡；
        2. 设置面板中「单轮步数上限」下拉默认选为「无限制（彻底放飞，仅防打转）」，同时保留 35 / 50 / 80 步阶段检查点选项，用户可随心切换；
        3. 满额处理彻底移除 `throw new Error` 抛异常逻辑，改为优雅收尾：输出温馨 notice 并返回 `status: 'step-limit'`，已完成的改动 100% 安全保留；
        4. 前端渲染联动：在收到 `step-limit` 时自动呈现「单轮已满额：点击接续执行下一步（自动发送“继续”）」一键接续按钮，用户无需手动敲字即可无缝接力执行后续任务；
    - **测试与隔离守护**：
      - 单测套件（`test-ai-agent.cjs`、`test-ai-repair.cjs`、`test-ui-operation.cjs`）增加 `YAMI_EDITOR_BRIDGE_PORT: '0'` 环境变量隔离，彻底杜绝本地前台运行的编辑器焦点输入状态干扰自动化回归测试；
      - `node build.cjs --deploy` 51 项核心锚点全绿，生产目录逐文件 MD5 100% 一致；`test-ui-operation.cjs` 78/78 全绿，`test-ai-repair.cjs` 44/44 全绿，`test-ai-agent.cjs` 全绿，`test-ai-session.cjs` 35/35 全绿。

28. **Home 快捷键捕获阶段事件监听与全键盘码适配（2026-09-13 用户实测反馈）**：
    - **呼出菜单失效根因与剖析**：
      - 原先 `hud-overlay.js` 中的 `window.addEventListener('keydown', ...)` 采用默认冒泡阶段监听（`capture: false`）；
      - Open Yami 编辑器内部存在大量具备焦点管理的子组件（如 `command-list.ts`、`select-list.ts`、`tree-list.ts`、`animation-window.ts` 等），在组件获得焦点时自带针对 `Home` / `End` 键的监听并执行 `event.preventDefault()` 或截断事件传播；同时游戏运行时的 `input.ts` 更是以 `{ capture: true }` 优先捕获；
      - 导致一旦用户在编辑器列表、树控件或试玩区域点击后，按键事件在冒泡到达 `window` 前即被截断，`toggleDock` 根本无法被调用；此外原判定仅限 `e.key === 'Home' || e.code === 'Home'`，小键盘（NumPad 7）与部分笔记本 Fn 组合键存在漏判盲区；
    - **全链路重构与加固**：
      1. **捕获阶段监听（`capture: true`）**：将按键监听升级为 `window.addEventListener('keydown', onGlobalKeyDown, true)` 与 `document.addEventListener('keydown', onGlobalKeyDown, true)` 双重捕获，在事件分发的第一阶段最优先拦截，彻底免疫引擎内部任何控件的冒泡截断；通过 `e.__yami_home_handled` 杜绝重复响应；
      2. **全平台/全键位兼容性覆盖**：判定条件升级为 `e.key === 'Home' || e.code === 'Home' || e.code === 'NumpadHome' || e.keyCode === 36 || e.which === 36`，完美兼容标准全键盘、小键盘（NumLock 开关态）、笔记本 Fn 组合键以及各系统平台键码差异；
      3. **可编辑文本框原生输入保护**：精准识别当前焦点元素是否为 `<input>`、`<textarea>` 或带有 `contenteditable` 的编辑区；若正在文本框打字且未按 Ctrl/Alt/Meta 修饰键，放行给输入框原生处理光标移至行首；按下 Ctrl+Home 或在其他任何区域按 Home 时 100% 触发呼出/收起；
      4. **自由悬浮窗视口边界自愈保护**：在 `toggleDock` 展开时，如果处于自由悬浮窗模式，自动检测当前坐标是否因分辨率变化或意外拖拽掉出屏幕可视范围（`minVisible = 60`），若是则自动重置回安全可视区（右上方偏内），彻底杜绝“大盘已展开但因坐标越界而看不见”的假象；
      5. **全局句柄与调试暴露**：将 `toggleDock` 挂载至 `window.__YAMI_PERF_TOGGLE_DOCK__` 与 `window.__DANJUAN_HUD_API__.toggleDock`，便于控制台调试与各模块一键调度。
    - **构建与测试守护**：
      - `node build.cjs --deploy` 51 项核心锚点全绿，生产目录逐文件 MD5 100% 一致；
      - `test-subviews-floating.cjs` 补充 6 项 Home 快捷键捕获监听与视口自愈断言，21/21 项断言全绿；
      - `node tests/test-static-health.cjs` 静态检查全绿；
      - 全套 30 套测试 100% 全绿。

29. **长历史对话空转打转根治与“继续”极简指令智能意图强化（2026-09-13 用户实测反馈）**：
    - **长历史空转三大痛点根因**：
      1. **免费确定性修剪被错误阻断**：原代码将第一级零成本的超长工具输出修剪（`pruneToolResults`）挡在 `decision.compact`（800,000 tokens）之后，导致对话在 6.8 万 tokens / 160 条消息时从来没有修剪过一次，上下文充斥废弃检索结果，轻量模型（deepseek-flash）长程注意力严重衰减；
      2. **“继续”极简指令缺乏方向引导**：用户单发“继续”缺乏动作指导，模型在超长历史压力下产生概率塌缩，陷入确定性重复检索；
      3. **重复调用缺乏早期强预警**：连续 2~3 次相同调用时系统毫无声息，等到第 4 次才直接掐断；前端在 `stuck` 状态下仅展示红字，缺乏一键破局入口。
    - **全链路彻底根治四步落地**：
      1. **确定性工具修剪常态化解绑**：在 `compressContext` 中无门槛常态化执行 `pruneToolResults`，把历史中冗余超长工具结果裁剪为紧凑头尾，零 token 成本随时瘦身；同时将动态摘要阈值收敛至 64k tokens，阻断历史失控滚雪球；
      2. **“继续”极简指令意图自动强化**：在接收到极简继续词（“继续”、“接着干”、“下一步”、“continue” 等）时，后台自动追加明确动作指令（“请检查上一轮进展与已有搜索结果，直接执行下一步具体动作，不要重复调用同类检索工具”），强力聚焦模型注意力；
      3. **重复调用早期强指令阻断（Loop Breaker）**：降低 `repeatHint` 阈值（5次 -> 3次），并在 `withHint` 中将系统警告置于 JSON 顶层键（`_SYSTEM_WARNING_`）；当模型发起与上一轮完全相同的调用（`repeats > 0`）时，在执行后直接在上下文追加强指令阻断，在第 2 次即把模型拉出死胡同，避免恶化至熔断；
      4. **前端 stuck 状态贴心破局卡片**：在模型被熔断时，卡片下方自动提供【一键破局：跳过检索，直接基于已搜结果操作】与【开启新对话（保留当前历史，清爽接续）】快捷操作，彻底消除干瞪眼。
    - **构建与测试守护**：
      - `node build.cjs --deploy` 51 项核心锚点全绿，生产镜像 MD5 100% 对齐；
      - `test-ai-session.cjs` 35/35 项断言全绿；
      - `test-subviews-floating.cjs` 21/21 项全绿；
      - `test-static-health.cjs` 静态检查全绿。

  - **【57】2026-09-14 · AI 助手顶栏工具栏极简工业图标化改造与设置按钮防截断加固**：
    - **背景与痛点**：
      1. **动作区溢出截断（看不见设置按钮）**：侧边栏停靠默认宽度 440px（内部可用视区约 410px），原工具栏同时平铺 7 个全尺寸图文块（状态指示、上下文用量、撤销、历史、导出、新对话、设置），动作区自身即占用 292px，叠加后总宽达 480px，导致末尾的【设置】按钮被 `overflow: hidden` 截断切除，用户无法直接点击配置；
      2. **视觉认知噪点密集（按钮过多）**：一排平铺 5 个带中文长标签的小方框，视觉层级扁平，给用户带来严重的繁琐杂乱感。
    - **极简工业化重构落地**：
      1. **辅助功能纯图标化（撤销/历史/导出/设置）**：收敛为 24px×24px 紧凑工业纯图标按钮，隐藏冗余汉字，继承官方 Remix Icon 矢量路径与完备的中文 `title` 悬浮说明（如“设置：模型、API Key 与高级参数设置”）；
      2. **主操作高亮分流（+ 新对话）**：唯独保留核心主按钮【+ 新对话】文字并附带微蓝高亮，形成一目了然的操作主次阶梯；
      3. **宽度硬核瘦身与防截断兜底**：动作区总宽从 292px 骤降至 180px（净节约 112px），即使侧栏收窄至 340px，最右端的设置齿轮按钮仍保有充裕边距，绝无被挤出或截断可能；
      4. **动态文本防挤压防护**：对状态文本与上下文刻度添加 `max-width` 截断与省略号保护，彻底杜绝内容动态膨胀挤垮工具栏；
    - **测试与镜像部署守护**：
      - 全量 30/30 套回归自动化测试 100% 满贯通过；
      - `node build.cjs --deploy` 镜像部署至生产环境，全部文件 MD5 100% 对齐。

  - **【56】2026-09-14 · AI 助手核心安全与稳定性系统级加固（6 大致命问题与次要隐患彻底根治）**：
    - **背景与根因定位**：
      1. **未保存修改安全网失效（丢数据隐患）**：`server.js` 中 `ensureEditorWritable` 原逻辑在 `r.dirty === false` 以外将所有异常/不支持降级为 `ok: true`，导致真机上即便编辑器正在编辑未保存文件，AI 也能直接写盘造成数据被覆盖冲毁；
      2. **自动压缩动手阈值与保留比例倒挂**：当动态缩减阈值至 64k tokens 时，保留量仍固定为 160k tokens，保留量反比门槛大 2.5 倍，导致压缩后仍超标陷入死锁空转；
      3. **新建脚本/新建事件确认卡无 diff 差异预览**：`create_script`、`appendCommands`（`event-builder.js`）及 `write_resource` 原先在 dryRun 时仅返回文本或模板，未生成并返回 `diff`，用户在审批卡上看不到代码对比；
      4. **审批续跑未加会话锁致数据并发污染**：`/approve` 与 `/reject` 异步调用未置位 `session.busy`，双窗口或同一窗口快速发消息可直接打穿正在续跑的模型上下文；
      5. **双窗口令牌读取失败导致永久断连**：`ai-agent.js` 读取 token 文件遇并发争用报错时未重试，且 401 报错时未指明鉴权失败并静默卡死；
      6. **任务计划与小结全局单例共享 + 切 Tab 覆盖基线**：`server.js` 的 `baselineSnapshot` 与 `currentTodos` 全局单一变量，多个会话互相冲刷；前端每次点击任务计划 Tab 还重复重设基线。
    - **全链路加固与根治落地**：
      1. **编辑器桥防冲刷与防丢数据物理级硬校验**：
         - `probe-core.js` 动作桥增强：检查 `document.activeElement` 输入状态以及当前正激活/打开的目标文件，若有未保存修改或正在编辑强制报告 `dirty: true`；
         - `server.js` 铁律级拦截：动作桥在线时，只要返回 `dirty` 或报错，100% 拦截并返回清晰白话引导（“请先在编辑器按 Ctrl+S 保存”），彻底杜绝数据覆盖；
      2. **动态等比例保留与压缩窗口释放**：
         - `ai-host.js` `compressContext` 动态按比例计算 `effectiveRetain = effectiveThreshold * (spec.retainRatio / spec.thresholdRatio)`，在 64k 门槛下保留约 12.8k tokens，压缩后稳定腾出 75%~80% 窗口，根除超标死锁；
      3. **全写工具 diff 闭环与差异预览**：
         - `create_script`、`write_resource` 与 `event-builder.js` 全面接入 `unifiedDiff` 与 `diffStat`，新建与追加操作在确认卡上均能提供标准绿增红减 diff；
      4. **审批流程全局会话排他锁**：
         - `/approve` 与 `/reject` 全流程严格置位 `session.busy = true`，绑定 `activeRun` 并由 `try ... finally` 保障释放，杜绝审批续跑阶段被并发写穿；
      5. **令牌争用自旋重试与 401 自愈**：
         - `ai-agent.js` 引入 3 次重试自旋（50ms 递增退避）；遇到 401 自动重读最新令牌并重试一次，失败时报出可读的“401 令牌不匹配”而非通用网络错误；
      6. **会话级完全隔离存储**：
         - `server.js` 全面支持按 `sessionId` 分桶隔离存储基线、代办与近期写入（`sessionBaselines`, `sessionTodos`, `sessionWrites`）；移除 Tab 切换重置基线逻辑，改为会话新建时独立初始化；
      7. **次要隐患清零**：
         - 修正 `write_resource` 与 `create_script` 工具名拼写与 dryRun 状态；
         - `edit_script` 编译失败自动回滚时补齐 `rememberWrite` 记账；
         - `delete_resource` 强删存在引用的资产时在告警中列出具体受影响文件。
    - **构建与测试全量守护**：
      - `test-ai-repair.cjs`（47/47 断言 PASS）与 `test-ai-agent.cjs` 全通；
      - 30/30 套测试 100% 满贯通过；
      - `node build.cjs --deploy` 镜像部署至生产目录，全量核心文件 MD5 100% 一致。

  - **【55】2026-09-13 · 撤销功能交互缺陷与幂等性彻底根治（消除“为什么还在，还可以一直撤销”盲区）**：
    - **背景与深层根因**：
      1. **为什么还可以一直撤销（版本越点越多）**：原 `restore_backup` 缺少内容一致性幂等拦截。当用户点击撤销将文件还原后，当前内容与初始备份已 100% 相同；但此时再次点击撤销，后端依然执行 `writeAtomic` 盲目写盘并生成新的 `.bak`，导致备份版本从 2 个被狂点到 6 个，产生无限撤销假象；
      2. **为什么还在（状态不可感知）**：后端 `/backups` 仅统计工具修改记录，未对比当前磁盘真实文件 sha256 与基准备份 sha256；撤销成功后，前端重新渲染时依然显示未撤销时的绿色【撤销】按钮，用户无法得知是否生效；且缺少移出列表的交互出口。
    - **全链路彻底根治落地**：
      1. **服务端幂等防御**：在 `restore_backup` 中比较 `currentSha === restoreSha`，若已处于目标版本直接返回 `alreadyRestored: true`，绝不重复写盘，不增加垃圾备份；
      2. **精准状态识别透传**：`list_backups` 与 `/backups` 对比当前文件与 oldest 备份 sha256，精准识别并透传 `isRestored`、`canRedo` 与 `redoBackup`；
      3. **前端状态闭环与重做/移除交互**：
         - 状态标签分流：未恢复显示 `[已改动]`，已恢复显示 `[已恢复初始版本]`；
         - 杜绝重复点击：已恢复项右侧显示只读 `[已在初始版本]`（带 check 图标，点击 Toast 说明已处于初始状态，绝不写盘）；
         - 反悔重做支持：对已恢复项提供 `[重做修改]`，可一键恢复 AI 刚才的改动；
         - 列表移除支持：提供 `[移除]` 按钮，点击即可从本次撤销列表中隐去该项；
      4. **测试与部署守护**：`test-ai-repair.cjs` 追加 3 项针对 `isRestored` 与 `alreadyRestored` 幂等防重复备份的严苛断言；全量 30/30 套测试 100% 通过；`build.cjs --deploy` 镜像同步至生产目录 MD5 100% 对齐。

  - **【54】2026-09-13 · 自由悬浮窗模式切换与展开收起丝滑淡入淡出动效落地**：
    - **背景与痛点**：
      1. 原 `.yami-perf-dock.floating` 使用 `display: none !important;` 阻断了浏览器所有 CSS 过渡（transition），导致在悬浮窗模式下呼出（Home 键、点击迷你胶囊）与关闭（Esc、关闭按钮）时窗口生硬闪现/骤停；
      2. 点击顶栏【切换自由悬浮窗 / 停靠面板】按钮时，几何坐标（`left/top/width/height`）与浮动状态为瞬时切换，窗口在屏幕中产生突兀跳闪；
    - **极简工业级方案落地**：
      1. **悬浮窗状态常驻 `display: flex !important;`**：收起时采用 `opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; transform: scale(0.96) translateY(8px) !important;` 组合，配合出场 `transition: opacity 0.14s, transform 0.16s, visibility 0.16s`。展开时 `visibility: visible` 立即就位，配合进场 `transition: opacity 0.18s, transform 0.2s` 实现优雅弹升与微缩淡出；
      2. **模式切换平滑交叉淡入淡出（Crossfade & Re-layout）**：在 `applyFloatingState` 中引入 `isSwitchingMode` 动画锁与 `.switching-mode` 过渡类。展开状态下点击切换按钮时，先 120ms 原地极速淡出微缩，随后在微不可查的重绘间隙切换几何属性并借由双重 `requestAnimationFrame` 移除 `.switching-mode`，触发新形态的顺滑淡入，彻底杜绝坐标跳变与视觉撕裂；初始化与面板隐藏时直接就位，0 额外开销；
      3. **鼠标拖拽与缩放 1:1 跟手零迟滞保证**：`left/top/width/height` 严格不设任何 CSS transition，平移与右下角缩放保持 60fps/120fps 原生手感；
      4. **测试与部署守护**：`test-subviews-floating.cjs` 补全动画与模式切换断言，全套 30 套测试全绿（30/30 PASS），`build.cjs --deploy` 镜像部署 MD5 100% 一致。

30. **审计发现的交互逻辑缺陷修复（v1.8.0，2026-09-14）**：
    - **来源**：同日独立审计 `audit/REPORT.md`（六人团队：对标基线 556 行 / 面板与宿主现状清单各一份 / 66 个锚点逐条取证 / 三轮评审，累计 19 条 findings 全关）。
    - **P0 三条**：① **消息编辑 / 重发 / 从某一轮重来** —— 宿主新增 `POST /session/rewind`（截断 `session.messages` 到该条用户消息之前并落盘、原文回填），面板用户气泡加「重发 / 编辑」两颗按钮；`rewind` **只回退对话、不回退文件**（文件回退仍走【撤销】/`restore_backup`），这条口径已写进 SSOT 第十四节；② **审批续跑不吃停止** —— `processToolCalls` 第 6 参 `cancelToken` 漏传 + 被批准的写盘走裸 `client.call`，两处都改走取消感知路径；③ **面板控制流** —— `decide` 的 finally 补 `flushQueue()`、等待确认的卡片一次收尾全部（以前只收第一张，其余永远停在黄点）。
    - **P1 四条**：授权新增 `工具::*` 档（无 `path` 的写盘工具不再永远拿不到授权，跨文件任务不用停 5 次）；上下文档位可点开看「折叠了多少条 + 摘要正文」并支持**手动压缩**（`/compact`，复用同一条压缩路径、`force` 跳过 80% 阈值）；`ui_steps` 并入 `OTHER_MUTATIONS`（confirm 模式下 AI 改编辑器界面前必须先确认）；v1.7.0 子视图隐藏规则的选择器指向两个**不存在**的 id（真实是 `.yami-ai-compose` / `.yami-ai-devbar`）—— 改选择器，并把测试从「断言 CSS 文本含选择器」改成「断言选择器指向的元素真的存在」（铁律【53】）。
    - **P2 与少量**：过程区摘要附上本轮工具名（收起后也能回答"跑过哪些工具"）；撤销/重做繁忙时给提示而不是静默返回；折叠控件补 `aria-expanded`、审批卡补 `aria-modal`；两处**过期注释**（写着"审批时 busy 可能为 true"，实际 `busy === false`）已更正。
    - **文档项 S-1~S-6**：那份自称「唯一对照基准」的 SSOT 有 6 处过期（版本水位停在 09-11 第 11 轮、事件清单漏 4 个事件名、上下文数字全过期、权限档位与代码不符、路线图只剩两条、更新时间自相矛盾）—— 已逐条更正，并补了第十四节记录本轮。**未做**：G-3（@ 引用工程文件，P2 易用性）、G-4（附件/图片，属新能力）、G-9（hooks，与"计划模式不做"同构），三条都写进 SSOT 第十三节。
    - **验证**：`tests/run-all.cjs` **30/30 套通过**（新增 `test-ai-session.cjs` §9 的真链路 `/session/rewind` E2E：轮次号 / 原文回填 / 截断落盘 / 截断后仍可继续 / 越界如实报错；`test-ai-agent.cjs` 新增 17 条修复契约断言；`test-subviews-floating.cjs` 21/21 且断言已换成真检查）；`build.cjs --deploy` 51 锚点 + 0 Emoji + 术语自检全绿，镜像 MD5 与母仓库一致。

31. **对话导出：把会话变成人能读的 Markdown（v1.9.0，2026-09-14）**：
    - **来源**：用户直接提的需求 —— "能不能导出对话？包括历史对话"。此前会话只以内部 JSON 落在 `~/DanJuanDevSuite/sessions/*.json`，人读不了、也拿不出去。
    - **宿主排版（`ai-host.js`）**：新增 `POST /session/export`（`sessionId` 单段 / `all: true` 全量，全量带一份目录再逐段合并），`sessionToMarkdown()` 负责排版。三处刻意取舍写进注释：**system 提示词不进正文**（那是几百行给模型看的脚手架，只记条数）、**工具结果不进正文**（一条常几万字，只在步骤行交代"执行了什么 + 目标路径"）、**思考过程用 `<details>` 折叠**（与性能大盘导出诊断报告同一套写法）。
    - **只读保证**：导出不写会话文件、不动内存会话、渲染时也不碰模型 —— 所以正在跑的对话也能导出；失败只回一句错，绝不影响会话本身。
    - **一个必须分开的东西**：会话里 `role='user'` 的消息并不全是用户打的字（打转干预、写入失败后的修复指令、打断记录、工作期间补充说明都是宿主替模型追加的）。导出稿按 `HOST_NOTE_PATTERNS` 把它们标成「系统提示（宿主自动追加，非用户发言）」，**模型看到的原文一个字不改** —— 否则读稿子的人会以为那句是用户自己打的。
    - **面板落盘（`ai-agent.js`）**：工具条加【导出】（当前会话）、历史子页加【导出全部】、历史每条加【导出】；落盘沿用性能大盘那套做法（写进工程目录 + 在资源管理器里定位），工程目录不可写就退化成**复制到剪贴板**并如实说明 —— 绝不假装导出成功。文件名 `<首条用户消息前 30 字>-<日期>.md`，Windows 非法字符一律去掉。
    - **验证**：`tests/test-ai-session.cjs` §10 真链路 12 条（含用户原话与助手回话 / 步骤行 / system 与工具结果不进正文 / 干预说明不冒充用户发言 / 单段 + 全量两次导出后**会话文件逐字节未变** / 不存在的会话如实报错）；`test-ai-agent.cjs` 追加 12 条接线断言；全量 `tests/run-all.cjs` **30/30 套通过**；`build.cjs --bump minor --deploy` 门禁全绿、镜像 MD5 一致。

32. **实测反馈修复：从一份真实会话记录里挖出的 8 个坑（v1.9.1，2026-09-14）**：
    - **来源**：用户拿一段真实会话（"写个施放技能的事件测试"，2 轮 / 65 条消息 / 37 次工具调用）来问"这个 AI 助手不好用，MCP 好像也没介入，写入的位置也是错的"。逐条查证后确认：**MCP 全程真的在工作**（37 次调用 34 次成功，3 次失败全是它自己选了 F5 而按键通道不认功能键），问题出在下面 8 处。
    - **F1 工程自带的"AI 阅读入口"文档从来没进过模型上下文**：工程根下有 `DANJUAN TOOLS/00-文档总索引（AI 阅读入口）.md`（十几万字的工程与引擎知识库，专为 AI 准备的），系统提示词里一个字都没提 —— 于是模型只能盲搜：5 次 `search_project`、6 次 `read_resource`、反复"不确定 castSkill 的 mode/key 语义"。现在宿主动态探测该文档（`projectDocHint()`，按 projectRoot 缓存、不存在就一个字不提）并跟环境快照走同一条注入通道。
    - **F2 打转没有硬止损**：宿主连提示 6 次「你已经查了很多遍」，模型照旧往下查（它每次换关键词，不是完全相同的调用，旧的打转保护认不出来）。现在加一道预算硬闸：**单工具 8 次 / 单轮 30 次**（`YAMI_AI_TOOL_REPEAT_LIMIT` / `YAMI_AI_TURN_CALL_BUDGET` 可覆盖），到点用 `status: 'stuck'` 如实停下并报出本轮调用分布，把方向盘交回用户。
    - **F3 写盘后的编辑器热更新失败被静默吞掉**：`notifyEditorReload()` 以前 `try/catch {}` 吞掉一切，而它失败的后果很重 —— 编辑器内存还是旧的，**用户下次保存就会把刚才的改动覆盖掉**。现在热更新结果留痕，失败时挂到工具结果上（`editorReload.ok === false` + 一句"请提醒用户按【刷新资源树】"）。
    - **F4 按键白名单没写进工具说明**：它设计了 F5 触发的事件，到最后才发现 `send_player_input` / `playtest_smoke` 不认功能键，只能请用户手动按 —— 等于测试没跑。现在两个工具的说明里都写明（up/down/left/right/ok/cancel/space/z/x/c；F1~F12 不支持）。
    - **F5 `ui_steps` 一刀切要确认，把"演示"也拦了**：上一轮 G-11 把整个 `ui_steps` 并进 `OTHER_MUTATIONS`（防界面被悄悄改），副作用是连高亮演示都要弹确认卡 —— 而这轮 37 次调用里 `ui_steps` **一次都没用**，用户要的"边做边演示"彻底落空。现在按步骤类型细分：只有 `set`/`click` 才算改动（要确认），`focus`/`goto`/`wait` 直接放行。
    - **F6 导出稿落进了用户工程**（上一轮 1.9.0 的功能缺陷）：导出 md 写到工程根目录 —— 那是用户的 git 仓库，未跟踪文件直接变成脏文件。现在统一落在插件数据目录 `%APPDATA%/DanJuanDevSuite/exports/`，宿主负责排版与落盘、面板只负责报落点并定位；目录写不进去才退化成复制正文。
    - **F7 收尾"改了哪些文件"反而报不出来**：`project_changelog` 首次调用只建基线、不报内容（模型自己发现这点后干脆不报清单，用户最后拿不到改动清单）。现在首次调用也把"上次汇报之后的写入记录"交出去，文件清单也把写入记录并进来（标 `fromWrite`，与基线比对区分）。
    - **F8 环境摘要漏掉"用户选中的资源"**：有停留点（"停在「攻击力」=25"）时就只报停留点，用户鼠标在资源树里选中的技能根本不进提示词 —— 他明明选了技能，模型还是反问"先测哪个"。现在停留点之外**永远带上"选中「xxx」"**（场景对象优先，其次资源树选中项），仍两句封顶、120 字上限。
    - **验证**：`tests/test-ai-session.cjs` 增至 **59 PASS**（新增 §11 演示审批粒度：focus 不弹确认卡 / set 照旧要确认；§12 工具预算：单工具刷到 8 次如实停下并说清刷了多少次；§10 改为断言"落在宿主数据目录、绝不落进用户工程"且逐字节校验只读；§1 追加"工程文档入口真的进了系统提示词"的行为断言）；`test-ai-agent.cjs` 追加 F1~F8 接线断言，并把环境摘要契约更新为"停留点 + 选中的资源"；全量 `tests/run-all.cjs` 30/30 套通过。

33. **"刚进去的对话为什么会有上一次的记忆" —— 屏上与上下文说的不是同一件事（v1.9.2，2026-09-14）**：
    - **现象**：用户重新进入 AI 助手页，屏上只有那句静态欢迎语，他发了一句"写个施放技能的事件测试"，模型却在思考里说"用户重复了同样的请求…上一轮已完成：F5 施展冲撞"，并主动把上一轮的教训（F5 触发、会改角色数据）写进了对齐卡。
    - **根因（会话文件实锤）**：屏上那句欢迎语是挂载时的静态 DOM，而 `state.sessionId` 来自 localStorage —— 面板**缺"进页面就回放上次对话"这一步**，于是它继续拿着上次那个 sessionId 说话。证据：新消息落进了**老会话文件** `session-mu0moxka.json`（从 2 条用户消息涨到 4 条，前两条正是上一轮的），模型当然看得到全部历史。**屏上说"新对话"，上下文里是旧对话。**
    - **修法**：新增 `restoreLastSession()` + `messagesPristine()`：进入 AI 助手页时，若消息区还是"只有欢迎语"的状态，就把上次那段对话原样回放（复用 `loadSession` 的回放路径，实时与回放长得一样），并如实补一句"这是上次那段对话，接着聊即可；想从头开始点【新对话】"。空会话或读不到就保持欢迎语，一个字都不多说；只回放一次（反复进出页面不反复重建时间轴）。
    - **口径**：**屏上和上下文必须说同一件事** —— 要么把历史和盘托出，要么真的换一个新会话（`新对话` 那条路一直是真换 id，没变过）。
    - **验证**：`test-ai-agent.cjs` 追加 2 条接线断言；全量 `tests/run-all.cjs` 30/30 套通过；`build.cjs --bump patch --deploy` 门禁全绿、镜像 MD5 一致。真机观感（进页面是否看到上次那段对话）由用户确认。

34. **任务计划收成一行 + 进页面开新会话（v1.9.3，2026-09-14）**：
    - **任务计划折叠（用户提）**：这张卡以前**一个 CSS 都没有**（`yami-ai-plan` / `-head` / `-item` 在整个 `src/style.css` 里查不到任何规则），是排在下方的裸 div，一次铺五六行。现在默认折叠成一行：`任务计划 1/4 · 当前：<进行中那一步>`（没有进行中就是「下一步：…」，全做完是「全部完成」），点一下展开完整清单；展开状态记在元素上，原地刷新不来回弹。
    - **进页面 = 开新会话（口径由用户拍板，取代第 33 项的回放方案）**：进 AI 助手页时若消息区已经聊过，就 `startNewSession()` 换一个新 sessionId —— 旧对话都在【历史】里（`turns > 0` 的会话照常列出）。例外：**正在跑的一轮不换会话**（换了就把它晾在后台），那种情况反过来，把上次那段回放到屏上，让用户看见它在做什么。理由还是第 33 项那句话：屏上和上下文必须说同一件事。
    - **验证**：`test-ai-agent.cjs` 更新 G-12 契约（进页面开新会话 / 忙时回放）+ 计划卡折叠与样式断言（`planCurrent` / `setPlanExpanded` / 四个类必须有 CSS）；全量 `tests/run-all.cjs` 30/30 套通过；`build.cjs --bump patch --deploy` 门禁全绿、镜像 MD5 一致。

35. **「我说的明明是选中的那个，它写到别的地方去了」—— 选中项带上路径 + 打开着的文件默认放行（2026-09-14，用户提）**：
    - **现象与实锤**：用户拿真实会话问「我提的需求它写到别处去了」。查 `session-mu0moxka.json`：`get_editor_context` 的返回里**有完整路径**（`Assets/技能/012-元素使技能/329.落雷.627cc278af411ab0.skill`），但拼给模型的那行环境摘要（`formatEditorContextSummary`）只取了 `name` —— 模型看到的是「选中「329.落雷」」，**路径得自己猜**。它于是自己决定「放出来要改角色技能栏和事件」，在用户眼里就成了写到别的地方。
    - **修法一（让模型知道该改哪个文件）**：摘要里选中项后面补 `→ <工程路径>`（`probe-core.js` 的 `selectedFileSuffix`，路径超 72 字退化成文件名，仍在 120 字上限内）；系统提示词加第 28 条：箭头后面那个路径就是他此刻在编辑器里打开着的文件、**是首要目标，不要按名字另找同名文件**；为了把事做完必须连带改别的文件时，先用一句白话说明「另外还要改 X」。
    - **修法二（选中即授权，别的文件照旧问 —— 口径由用户拍板）**：宿主每轮开工前问一次 5967 桥「用户打开着哪个文件」（`noteEditorSelection`），写盘正好落在它头上时**直接执行、不弹确认卡**（`grantSelectionHit` 复用既有「工具::文件」授权表，删除类永不在此列），并在过程里如实说一句「这是你打开着的文件，这一步直接改它」；**打开之外的文件仍然逐条确认**。
    - **验证**：新增 `tests/test-ai-selection-grant.cjs`（真宿主 + 假模型 + 假 5967 桥，11 PASS）：同一回合先改选中文件、再改另一个 —— 断言选中的当场落盘且没有 approval 事件、另一个在审批前一个字节没动、点「执行修改」后才写盘、preflight 真走了桥；`test-ai-agent.cjs` 新增「摘要必须带工程路径且不超 120 字」行为断言；全量 `tests/run-all.cjs` **31/31 套通过**。

36. **MCP 元数据规则对照引擎源码：修掉「CRLF 工程里元数据只认第一个标签」（2026-09-14，用户定方向）**：
    - **口径**（用户拍板）：审核标准不是「面板上还有什么功能没接进来」，而是**「这套 MCP 有没有把 Open Yami 的规则摸准」** —— 对照引擎源码，一条条核；核到不对就改，改到没有错为止。引擎源码只读参考 `D:\Documents\GitHub\2`。
    - **查到的真错（最重的一条）**：MCP 的元数据标签正则抄的是引擎 `plugin.ts:362` 的 `(?=\s@|$)`，但注释续行是 ` * @alias`，**`*` 既不是 `@` 也不是 `\s`**，前瞻永远不成立 —— 于是整个 `/* @plugin ... */` 块被当成**一个**匹配，只有第一个标签被处理，后面全部丢失（连 `@version` 都会粘进 `@plugin` 的值里）。工程文件是 CRLF 时必然发生，把同一份文件存成 LF 就好了 —— 这种「换行符决定能不能解析」正是最该被消灭的规则偏差。
    - **改法**：工具侧改用**行首严格版**正则（只在 ` * @tag` 处切标签），并逐行剥掉注释的 ` * ` 前缀（否则 `@version` 会变成 `"1.0\n *"`、`@default` 变成 `"5\n *"`）。
    - **同时按引擎规则补的校验**（每条都在代码注释里写了引擎行号）：`@default` 按引擎 `parseDefault` 口径解析，解析不出来就是 error（引擎会退回类型初始值）；`@default` 不在 `@option` 列表里是 error（`plugin.ts:505-508`）；`@clamp`/`@decimals`/`@placeholder` 写在引擎不认的类型上是 warn（`plugin.ts:638-783` 的类型守卫）；注释块外的 `@标签` 是 error（引擎只在块内解析）。error 拦写盘，warn 只提醒。
    - **顺带修的三处**：`@option` 的值去掉引号（引擎走 `parseString`，参数值本身不带引号；留着引号会让「默认值在不在选项里」永远判不相等）；生成器按**类型**决定 `@default` 要不要加引号（option/string 加，number/boolean 不加 —— 以前 option 的默认值不带引号，生成的模板自己都过不了自检）；`repeatable-group` 补进类型表（引擎 `type-registry.ts` 真正落盘的 38 个类型之一，旧表把它漏了）。
    - **验证**：新增 `tests/test-mcp-meta-rules.cjs`（18 PASS：CRLF/LF 双换行解析、四类引擎规则抓错、写盘门禁 error 拦 warn 放行、生成器默认值引号）；真实工程 **66 个脚本**逐个 `parse_plugin_meta`：**0 条误报**（新校验不冤枉任何现有脚本）。
    - **已核对无偏差**：GUID 规则 —— 引擎 `file-system-core.ts:333` 的 `/ (?<=\.)[0-9a-f]{16}(?=\.\S+$)/` 与 MCP 的 `parseGuidFromName` 逐字符一致；`guid.ts:3` 要求「GUID 必须含字母 a-f」，`generate_guid` 已照做。
    - **还没核的**（下一轮继续）：事件指令装配与 `Data/commands.json` 的对应关系、`Data` 各表的真实结构、编辑器/试玩动作的前置条件。

37. **MCP 指令中文名对照引擎：修掉「照着编辑器里的名字下指令会失败」（2026-09-14，第 36 项的续）**：
    - **真错**：事件装配要把「编辑器里显示的中文名」翻成指令 GUID，而 `loadCustomCommands` 只读 `Data/commands.json` 的 `alias` / `name`。实测本机这份 `commands.json`：**30 条记录，`alias` 全是空串、根本没有 `name` 字段**（真实字段是 `id / enabled / alias / keywords`）—— 这条读取路径等于永远走不到，模型只能靠文件名猜。
    - **引擎规则**：编辑器里那条指令的名字来自脚本 `@lang` 段的 `#plugin`（引擎 `plugin.ts` 的 `LanguageMap`：overview 用 `#plugin`、参数用 `#key`）。所以正确来源是**脚本的语言包**，不是 commands.json。
    - **改法**：扫 `Assets/插件/自定义指令/*.ts` 时顺手解析语言包，把 `#plugin` 的中文名也登记进名称→GUID 表（文件名去 `.指令` 与完整文件名两条老路径照旧保留）。为此在 event-builder 里放了一个**只取语言包**的轻量解析器，刻意不引 server.js 的解析器，避免模块依赖成环。
    - **验证**：新增 `tests/test-mcp-command-name.cjs`（5 PASS）：夹具里文件名与显示名**故意不同**（`内部代号.指令.<guid>.ts` ↔ 显示名「事件广播·单独发送」），断言按显示名能装配出正确 GUID、按文件名两条老路径照旧可用、未知名字如实报错；真实工程上另外实测三个真实指令名（事件广播·单独发送 / Steamworks API / Excel操作）全部解析成功。

38. **MCP 数据表规则对照真实形状：修掉 5 处误报 + 1 处能覆盖引擎结构的危险写入（2026-09-14，第 36/37 项的续）**：
    - **误报（会冤枉合法文件）**：`REQUIRED_FIELDS` 有三处与真实资源不符 —— `skill/item/equip/state` 被要求有 `name`（真实资源**根本没有这个字段**，名字来自文件名）；`tileset` 被要求有 `image`（实测 6 个图集里只有 4 个有）；`particle` 被要求有 `sprites`（真实粒子只有 `layers`）。把工程里**每种资源的每个实例**都读一遍取「100% 出现的顶层字段」后重写：现状 12 种资源各抽一个真实文件校验，**12/12 通过**（改前 5 种报错）。
    - **危险写入**：`upsert_database_item` 的字典型分支会把 `rawData[id]` 整个换掉，而 `attribute.json` 的顶层 `settings`/`keys`、`enumeration.json` 的 `settings`/`strings` 是**引擎结构**不是条目 —— 传 `id: settings` 在 dryRun 阶段就被放行（实测），一旦确认就会把整块结构覆盖成传入的对象。现在按表登记「容器键」，命中即拒并说明这是引擎结构。
    - **够不着的一格**：`config.json` 是平铺配置、没有条目概念，旧实现却要求「必须指定 id 键名」，于是 AI 换不了任何一项配置；而 `patch_resource` 又只收 `Assets/` 内的资源，Data 表走不通。现在 `upsert_database_item` 支持 `table: config` 不传 id 时按字段补丁到根对象。
    - **验证**：`tests/test-mcp-meta-rules.cjs` 增至 **29 PASS**（新增 §6 六种资源的最小合法文件必须过 + 缺字段必须拦、§7 容器键拒写 / 字典型条目可写 / config 补丁 / list 表自动生成 id）；真实工程 10 张表逐个 dryRun：`plugins/commands/teams/variables/easings/autotiles/localization` 可写、`attribute/enumeration` 按要求给条目键后可写、`config` 走补丁路径可写。

39. **MCP 事件指令对照引擎：`!` 禁用前缀 + wait 时长语义（2026-09-14，第 36-38 项的续）**：
    - **`!` 前缀是引擎原生的「这条指令被禁用」**：解析显示时剥掉（`schema.ts:324`）、执行时直接跳过（`command-parse.ts:54`）、列表里启用/禁用就是加/去这个前缀（`command-list.ts:1100-1114`）。真实工程里 **14 种指令、上百条**都带这个前缀（`!setNumber` 26 条、`!loop` 17 条……），而旧实现把它当未知指令直接抛错 —— 既读不了既有事件，也没法让 AI 把某条指令停掉。现在前缀原样保留、裸名照旧解析。
    - **wait 的时长单位是毫秒**：引擎 `getTimer().set(duration)`（工程文档《Yami引擎机制》第 271 行与引擎源码口径一致），真实事件里是 `{duration:200}` 这种写法；`duration` **还可能是对象**（变量取值），旧实现 `Number(...)` 会把它拍成 NaN。现在对象原样透传。
    - **验证**：`tests/test-mcp-command-name.cjs` 增至 **8 PASS**（新增 §4：`!` 前缀原样保留、wait 按毫秒写入、变量对象不被硬转）；另外把真实工程 90 个事件里的指令 id 与参数形状全量扫了一遍（92 种指令、`setNumber` 390 条 / `if` 249 条 / `wait` 29 条…）作为规则依据存进注释。

40. **MCP 试玩输入对照引擎：功能键其实一直可用 + 指针动作的真实语义（2026-09-14，第 39 项的续）**：
    - **查证结论：功能键本来就是支持的**。5966 桥的按键白名单（`probe-core.js` executeRuntimeAction）是 `ArrowUp/Down/Left/Right | Enter | Escape | Space | Key[A-Z] | Digit[0-9] | F[1-12]`，`playtest.js` 的 `ALLOWED_KEY` 同样认 F1~F12。但工具说明里写着「数字键与 F1~F12 不支持，别拿功能键做验证方案」—— 模型照着说明走，就白白放弃了唯一能验证「按 F5 触发技能」这类需求的方案（真实会话里正是这么卡住的）。
    - **真正的原因查到了**：CDP 兜底路径的 `windowsVirtualKeyCode` 映射表只有方向键/Enter/Esc/Space/Z/X/C（12 个），**功能键与数字键全都不在表里** → Chromium 生成的按键事件 vk 是 undefined → 引擎按键表查不到这个键。5966 桥直连时走引擎自己的 `Input.simulateKey` 所以没事，一旦走兜底就失灵。现在把字母键、数字键、F1~F12、Tab/Home/End/方向键等补全（F1=112 … F12=123）。
    - **说明改对**：`send_player_input` / `playtest_smoke` 的说明改成「方向键 / ok / cancel / space / 字母键 / 数字键 / F1~F12」；另外写明 `send_player_pointer` **每次都会先派发一次 pointermove**（引擎靠它更新指针位置）—— 这条语义以前没写，模型不知道点击前指针位置已经被更新过。
    - **验证**：改完后全量 `tests/run-all.cjs` 33 套通过；`test-playtest-smoke.cjs` 的按键白名单断言（本来就把 F1~F12 当合法键）与 `test-tool-schema.cjs` 均未受影响。

41. **MCP 全工程校验对照引擎：把 6000 条假警报收成 105 条真问题（2026-09-14，第 40 项的续）**：
    - **发现**：`validate_project` 在本机工程上报出 **6093 条「悬空引用」+ 47 条「GUID 重复」**，`ok=false` —— 也就是 AI 每次做全工程体检都会拿到一屏假问题，真问题彻底被淹没。
    - **假在哪（逐条查证）**：① 引用收集把**任何 16 位 hex 字符串**都当资源引用，而 `variable.key` / `attributes.key` / `presetId` / `sprites.id` / `motions.id` / `layers.sprite` 这些字段里装的是**变量、属性、节点、动作 id**，不是资源；② 收 ID 时只认文件名，漏了**数据表里注册的 id**（引擎自带 9 条缓动曲线的 id 全在 `Data/easings.json` 里，不是文件名）；③ `plugins.json` / `commands.json` 的条目 id 就等于脚本文件名里的 GUID，是「同一资源的两处登记」，被当成两个文件撞 GUID。
    - **改法**：引用只认 `REF_KEYS = { eventId, easingId }` 两个键（收窄是刻意的：宁可少报，也不拿几千条假警报糊住用户，注释里写明了这个取舍）；`collectAllGuids` 补收 `easings/autotiles/plugins/commands/teams/variables/enumeration/attribute` 八张表里注册的 id；GUID 冲突只比 `Assets/` 内的文件路径。
    - **结果**：同一工程 **6093 → 105 条**、重复 GUID **47 → 0 条**，剩下的 105 条是真引用（例如 8 个动画引用了不存在的缓动曲线 `a42fe5b0bf716fb2` —— 它只出现在 anim 里，`easings.json` 里确实没有）。
    - **顺带补的规则**：`presetId` **跨文件**唯一（引擎把场景/界面的默认对象注册成全局键 `scenePresets/uiPresets`，冲突时后注册的直接覆盖前一个，`scene-window.ts:1270-1276` —— 单文件内查重看不出来）；以及 `presetId` 格式提醒（引擎新生成的一律是 `GUID.generate64bit()`：16 位 hex 且必含 a-f）。
    - **验证**：`tests/test-mcp-meta-rules.cjs` 增至 **33 PASS**（新增 §8：合法 presetId 不报、手写 presetId 报提醒、跨文件冲突被抓、变量 key 不被误报成悬空引用）；真实工程 `validate_project` 耗时约 400ms。

42. **MCP 编辑器动作补齐一格：把资源从磁盘重读进内存（2026-09-14，第 41 项的收尾）**：
    - **缺口**：5967 桥本身有 `reload` 动作（逐类型重建映射、资源按扩展名回填 `Data.xxx` + `Directory.update`），AI 写盘后自动重载走的也是它，但 `editor_action` 只暴露了 save/undo/redo/refresh/playtest 五个 —— 用户在编辑器里改完、或外部工具改了文件之后，AI 没有任何手段让编辑器重读那一个资源。
    - **改法**：`editor_action` 增加 `reload_resource`（需同时给 `path`），说明里点明方向是「把磁盘重读进内存」（不是反过来），避免模型把它当保存用。
    - **验证**：`test-tool-schema.cjs`（工具提示与 schema 一致性）通过；全量 `tests/run-all.cjs` **33/33 套通过**；真实工程 `validate_project` 现在 `ok=true`、耗时约 437ms。

43. **MCP 试玩能力对齐面板：AI 现在能拔掉卡住的事件、也能按类别二分卡顿（2026-09-14，第 42 项的续）**：
    - **缺口**：引擎侧 probe 早就实现了 `finishEventById`（调事件原生 `finish()` 拔引用）与 `state.suspend` 的 7 个类别开关（actors/animations/emitters/triggers/ui/events/audio），但**只有面板按钮能用**，MCP 一个都没暴露 —— AI 在诊断里看得见「卡住/幽灵事件」，却拔不掉；定位卡顿也只能靠猜。
    - **改法**：runtime-bridge 抽出共用管道 `sendAction()`（取令牌 + POST /action + 超时），新增 `finishEvent()` 与 `suspend()`；MCP 注册 `finish_stuck_event`（eventId）与 `suspend_runtime_kind`（kind + on）两个工具；宿主侧同时登记进 `OTHER_MUTATIONS` 与中文名表（confirm 模式先问、auto 模式自动），说明里写清「暂停只是让那一类不再更新，不改工程内容」。
    - **参数校验前置**：桥没起来时，参数写错也会被报成「游戏没在试玩」，把模型引到错方向 —— 现在 `eventId` 必须是 16 位 hex、`kind` 必须在 7 类之内，都在本地先校验掉（实测：非法 kind 直接回「不支持的类别: nonsense（只能是 actors / …）」）。
    - **验证**：工具注册后共 **39 项**（模型可见 38，`cdp_eval` 仍隐藏）；无试玩时两个工具都如实回「试玩运行时桥未启动（游戏没在试玩）」而不是假成功；全量 `tests/run-all.cjs` 33 套通过。

44. **测试断言的脆性修掉一处：G-11 钉「数组最后一项是谁」改成钉工具名（2026-09-14）**：
    - **现象**：新增 `finish_stuck_event` / `suspend_runtime_kind` 之后 `test-ai-agent.cjs` 报「ui_steps 必须进 OTHER_MUTATIONS」，但 ui_steps 明明还在集合里。
    - **根因**：那条断言写的是 `/'playtest_smoke', 'ui_steps'\]\)/` —— 它钉的是「OTHER_MUTATIONS 的结尾正好是这两个」，集合一加东西就误报。
    - **改法**：改成先把集合内容抽出来，再逐个工具名断言（ui_steps / playtest_smoke / finish_stuck_event / suspend_runtime_kind），新增工具不会再撞这条。

45. **MCP 结构规则对照引擎：界面 reference 节点指不到 prefab 时是「静默空白」（2026-09-14，第 44 项的续）**：
    - **规则实据**：界面里的 `reference` 节点，`prefabId` 指的是**某个界面节点的 presetId**（不是资源 GUID）：`ui-window.ts:697 reference.prefabId = prefab.presetId`、`reference-element.ts:29 Data.uiPresets[value]`；指不到任何 presetId 时引擎**静默什么都不加载**（`reference-element.ts:30 if (preset && ...)`）—— 界面上那块就是空的，不报错、不提示。
    - **查证结果**：本机工程 16 份界面共 **624 个 presetId**，9 个 `prefabId` **全部能对上**（我一开始按「只在本文件里找」误判成 0/9，展开查证后确认是跨界面引用，规则本身没问题）。
    - **补的体检**：`validate_project` 增加 `dangling-prefab` 提醒（reference 节点指向不存在的 presetId）—— 以前这种坏法完全查不出来，而它恰好是「界面上莫名其妙少一块」的典型原因。
    - **确认无需改的**：节点嵌套**只用 `children`**（实测 592 处嵌套全是它；`nodes`/`objects` 是顶层容器键），校验与写盘门禁的递归已经覆盖；`terrains` / `code` 这类引擎算出来的 RLE 字段继续禁止手改（`hasForbiddenPatchKey`）。
    - **验证**：全量 `tests/run-all.cjs` 33 套通过；真实工程 `validate_project` 现在 `ok=true`、耗时约 477ms、无假警报。

46. **MCP 工具说明的最后一轮对齐：分工写清 + 前置条件写明（2026-09-14，第 45 项的收尾）**：
    - **interact_editor 与 ui_steps 的分工**：ui_steps 走引擎公开入口（`el.input()` + `change` 事件 + `blur`，所以改动会进撤销栈；`kind:'goto'` 走 `Layout.manager.switch`），是**首选**；interact_editor 是鼠标级模拟（pointerdown/up + `.click()`、坐标拖拽、直接写控件值），只在 ui_steps 够不着时用（canvas 里的东西、真拖拽、没有稳定选择器）。原先两段说明各自只说自己是「兜底/首选」，模型容易选错，现在两边都写明了判据。
    - **editor_action 的前置条件**：save/undo/redo/refresh/playtest/reload_resource 全都依赖引擎内部接口（`window.YamiEngine` 那套），官方预编译版没有 → 一律返回 `engineUnavailable`。说明里写清这一点，模型才不会反复重试、更不会向用户承诺「已经保存好了」。
    - **验证**：`test-tool-schema.cjs`（39 个工具、52 个参数名的一致性检查）通过；全量 `tests/run-all.cjs` 33 套通过。

47. **MCP 写盘安全网：压缩字段（RLE）被写短直接拦下（2026-09-14，第七轮）**：
    - **规则实据**：scene 的 `terrains` 与 tilemap 的 `code` 是引擎 `Codec` 编码出来的 RLE 文本（`codec.ts:215-260`），加载时 `decodeTerrains/decodeTiles` 解码，长度对不上会直接抛 `RangeError`（`codec.ts:205-211`）。空间地图里它占 scene 全文 **32%**（实测：27.5k 的 scene 有 17.1k 是 RLE；单个 tilemap `code` 12933 字符）。
    - **真实故障链**：`read_resource` 对 >200KB 的文件只回字段名清单，模型却可能照原样 `write_resource` —— 那样写下去地图直接读不出来。
    - **改法**：`write_resource` 增加一道只拦「写短了」的校验（内容一样或更长一律放行）：场景 `terrains` 与瓦片地图 `code` 被写短时拒绝，并提示改用 `patch_resource` 只改别的字段。删除节点导致 `code` 数量变少仍放行（只比同位置的长度）。
    - **验证**：实测把真实场景的 `code` 从 12933 砍到 20 → 拒绝并给出「瓦片地图的压缩字段被写短了（12933 → 20 字符）…」；原样写回 → 放行。`tests/test-mcp-meta-rules.cjs` 增至 **42 PASS**（新增 §11 三条断言）。

48. **自动更新「更新完插件消失」的根因排查与自愈兜底（2026-09-14，用户报）**：
    - **用户报的现象**：点一键热更新，提示成功；重启编辑器后插件整个消失（面板/HUD/AI 副驾全没）。
    - **查证（把更新器整段抽出来在 Node 里真跑）**：① 本地整包安装装 48 个文件、入口文件一个不少、`manifest` 声明的文件全部落盘、`runtime/yami-mcp` 递归带上、开发物料没进包；② **安装器从不删除目标目录里的任何文件**（`installSnapshot` 只写不删，`removeFileQuietly` 只用于 `.tmp` 与回滚），所以「新版多出来的文件被清掉」这条不成立；③ 现状不再复现：远端 `extension` 分支与本地 HEAD 同一个提交（8a188b1 / v1.9.3），安装目录 7 个入口文件 MD5 与仓库逐一对齐，`_backup` 干净、无嵌套 `manifest.json`。
    - **历史上真因（HANDOFF 铁律第 929 行那次事故）**：老客户端按**自己烧死的 15 文件清单**下载，却把远端新版内容写进那 15 个名字里 —— 新版多出来的文件一个都没装，重启后主世界装载器找不到依赖，插件静默消失、控制台连一条报错都没有。那次已用「整包快照」改造修掉（本机安装目录里的 probe-core 已经是快照版，可确认）。
    - **这次补的兜底（针对「写盘中途崩 / 编辑器被杀」这条仅剩的路）**：更新器在**开始写盘时**落一个 `.yami-update-in-progress.json` 标记，全部写完才删；`bootstrap.js` 在注入界面**之前**先看这个标记 —— 标记还在就说明上一次更新没走完，于是把 `_backup/previous/` 里的旧版本拷回来、删掉标记、并在屏幕上给一句白话提示。**这是「更新完插件消失」那条路上唯一的出路：新版本装载失败时，旧版本自己回来。** 备份不齐时不回退、保留标记留给下次（不报假成功）。
    - **顺带修掉两个真 bug**（都在新写的恢复路径里，被测试抓出来）：① 反推插件目录时用 `slice(0,18)` 去认 `chrome-extension:/`（少一个斜杠），源码布局下会把 `file:///D:/…` 的前 18 个字符当成协议切掉，推出来的目录是垃圾 —— 结果「恢复功能等于不存在」；② Windows 上 `file:///D:/x` 剥协议后多一个前导斜杠，`path.join('/D:/x', 'manifest.json')` 会被当成 UNC 路径而查不到文件。现在统一交给 `new URL(base).pathname` 解析。
    - **验证**：新增 `tests/test-update-recovery.cjs`（7 PASS：检测到未完成更新 → 五个入口文件全部回退 → 删标记不重复回退 → 备份不齐时不报假成功且留标记）；更新器本体用「真实仓库当本地整包」跑了 10 项断言全过；全量 `tests/run-all.cjs` 通过（`test-autoupdate.mjs` 56 → **59 PASS**：新增「先落进行中标记 / 紧接着落 bootstrap.js / 全部写完后删掉标记」三条断言）。
49. **在场感知口径修正：鼠标划过"说不清是什么"的地方，不再顶掉用户高亮选中的东西（2026-09-14，用户报）**：
    - **用户报的现象**：环境摘要会跟着鼠标跑 —— 他明明在界面上高亮选中了一个技能，只是把鼠标划过去停在别处，摘要就变成"停在「检视器」"，他反问"为什么是我鼠标划过的界面元素被停留了？我已经在界面上有高亮选中的啊"。
    - **实据从真机日志里捞的（不是猜的）**：插件每次环境快照都写进会话文件（`%APPDATA%/DanJuanDevSuite/sessions/*.json`），两个会话各抓到一次同样形状的记录：`{"label":"检视器","kind":"region","vague":true,"via":"hover","restingMs":7028}`、`{…,"restingMs":9155}`，摘要都是「停在「检视器」·选中「329.落雷.skill」」。也就是说：鼠标停在检视器的**空白背景**上（说不出是什么控件，只能退到"区域级"），却把用户真正高亮选中的技能挤掉了。
    - **规矩定成什么**：区域级的鼠标停留是**弱信号**（只能说清"大概在哪一块"）—— 它只在用户什么都没选中时才报；能叫出名字的控件照样最优先，"点进去 / 右键指过"哪怕只是区域级也照样优先。落到 `getPresence()` 上就是一条让位规则（`pointer.vague && pointer.via === 'hover'` 时先问选中态），其余排序一律不动。
    - **顺带**：`formatEditorContextSummary` 去掉"停在「X」·选中「X」"重复两遍；顶栏徽标在停留点来自选中态时显示「选中中」而不是「停留中」（别让用户以为 AI 在盯着他的鼠标）。
    - **验证**：`tests/test-ui-operation.cjs` A3 段 **81 PASS** —— 改写/新增三条：划过 canvas、停在引擎真实标记的 `<page-frame id="inspector-page-manager">` 空白处，都报"选中「火球术」"（用户踩到的那一下按真实标记复现）；什么都没选中时区域级照旧报"停在「场景视图」"（换干净沙盒验，兜底没被削掉）；`test-ai-agent.cjs` 的 F8 契约断言同步改成"停留点就是选中项时不重复"。全量 `tests/run-all.cjs` **34/34 套通过**。

50. **模糊指代补完：场景对象给得出源文件、多选不再当成"只选了一个"，并修掉场景名一直是空的（2026-09-14，用户问"现在能识别模糊意图了吗"）**：
    - **补的第一格（用户点名的那个洞）**：场景里选中的对象原本只报名字（`选中actor:「主角」`），模型只能按名字去工程里搜同名文件 —— 现在带上**它的源文件**，口径取自引擎自己：`Scene.getObjectFile`（`scene-utility.ts:6`：actor/animation 看 `data.guid`、particle 看 `emitter.data.guid`、parallax 看 `image`，一律查 `Data.manifest.guidMap[id].file`）—— 右键菜单「在工程中定位」用的就是它。**同时补上当前场景文件**（`Scene.meta`，`scene-window.ts:779`）：对象在"这一份场景里"的实例数据（位置/缩放/朝向/图层）写在场景文件里，定义（属性/事件/图片）写在源文件里 —— 两层都给，模型才有得判；分不清就按提示词问一句。
    - **补的第二格**：资源树**多选**以前只报第一个（引擎 `file-body-pane.ts:29 selections: any[]`），现在多选会带 `selectedFiles`（最多 8 个）与个数，摘要写「选中「落雷.skill」等 3 个 → Assets/…」，不再让模型以为"他就选了这一个"。
    - **顺带查出来的真 bug**：`currentSceneName()` 读的是 `Scene.binding`，而**本机引擎源码里根本没有这个字段**（整个 `scene/` 目录 grep `binding` 0 命中；`Scene.meta` 才是真源）—— 编辑器里的场景名从来没报出来过（会话日志里 `"scene":""` 与此相符，那条分支只对更老的运行时管用）。现在加了 `Scene.meta` 回退（`FileItem.alias` 就是标签页上那个名字），沙盒实测能报出「新手村」。
    - **提示词**：新增第 29 条（场景对象给的是源文件；改的是场景里的那一份就改场景文件；两层分不清先问）与第 30 条（写着「等 3 个」时别默认只改一个，用 `get_editor_context` 的 `selectedFiles` 看全部）。
    - **验证**：`tests/test-ui-operation.cjs` A3b 新增 7 条（源文件路径 / 场景文件 / 场景名来自 meta / 多选列表 / 摘要带源文件路径 / 多选标个数）+ C3b 新增 2 条提示词契约 → **93 PASS**；`test-ai-agent.cjs` 增加多选摘要断言（沙盒要一起抽取 `selectedCountSuffix`，否则 vm 里会 ReferenceError）；全量 `tests/run-all.cjs` **34/34 套通过**。

51. **树节点的名字与"选中/停在"口径修正（2026-09-14，用户报"我选中这个，他说我停留在…"）**：
    - **用户报的现象**：他在界面树里点选「背景」，顶栏却写「停在「背景E⣿⣿」·选中「003 - 法师技能」」—— 名字是乱码，说的是"停在"，而底下那个"选中"还是个不相干的技能文件。
    - **乱码从哪来（读引擎源码定论）**：界面树/资源树的节点是 `<node-item>`（`components/tree-list.ts:241`），引擎把**纯名字**写在 `element.textNode`（`:283`/`:365`，`parseName` 就是 `item.name`），角标是**后加的元素**：E = 有事件角标、锁 / 可见性图标是私有区码点字形 —— 按 `textContent` 读必然把「背景」+「E」+两个图标字形一起捞进来。现在先按 `textNode` 读纯名字（读不到退 `item.name`），兜底的 textContent 也统一剥掉私有区 / emoji 字形；树节点**没有"值"**（不然摘要会冒出 `=E⣿⣿`）。
    - **"停在"从哪来**：他点完节点，鼠标本来就压在那个节点上 → `pointerover` 成了最新信号 → 报"停在"。现在加一条：鼠标停着的正是他刚点选的那个（含它内部）→ 那是**选中**，不是划过；摘要措辞也跟着区分（选中来自引擎选中态，停在来自鼠标）。
    - **两个"选中"打架**：资源树里那个"打开着的文件"以前一律叫"选中"，于是变成「选中「背景」·选中「003 - 法师技能」」。现在他刚点选的东西占"选中"，打开着的文件改叫**文件「…」**，提示词第 31 条写清这层分工（"这个/它"优先指他点选的那个）。
    - **验证**：`tests/test-ui-operation.cjs` A3c 新增 6 条（纯名字 / 算选中不算划过 / 摘要用"选中" / 文件不冒充选中 / 树节点无值 / 没点选时照旧）+ C3b 提示词契约 → **99 PASS**；全量 `tests/run-all.cjs` 34/34 套通过。

52. **"我点了这个，它说我停在别处"：三个缺陷叠在一条摘要里（2026-09-14，用户第二张截图）**：
    - **用户报的现象**：他在界面树里点选「删除存档数据」，顶栏却是「停在「界面元素列表」·选中「粒子」」—— 三处全错：说他"停在"而不是"选中"、对象是个含糊区域、底下那个"选中"还是他根本没选过的**文件夹**。
    - **三个缺陷（逐个查证）**：
      ① **焦点把精确候选盖掉了**：点树节点时那个列表同时拿到焦点（`activeElement` = 列表），它只能描述到区域级「界面元素列表」，而它更新 → 组内"谁新谁赢"就把它排在他真正点的节点前面。改法：`resolveGroup` **分两轮问** —— 先把能叫出名字的问完，都问不出来才退区域级。顺带修正 ㊿ 的 (b) 老口径："上一次右键的精确控件"对"刚停在 canvas 上的区域级"，现在**精确的赢**（用户两次反馈都是这个方向：明确指过的东西不许被含糊地方顶掉）。
      ② **文件夹被当成文件**：引擎的 `FolderItem` 连 `type` 字段都没有（`file/folder-item.ts:7-14`），而资源树里亮着的是「粒子」这个**目录** → 旧代码把它写成 `selectedFile`，模型会去改一个目录。改法：三条路径（`activeFile` / `selections` 兜底 / 多选列表）统一按 `type` 判是不是文件。
      ③ **"正在编辑的文件"没进上下文**：他点的是界面元素，要改的是它所在的 `.ui`，而资源树里亮着的可能只是个目录。新增 `editingFile`：界面页取 `UI.meta`、场景页取 `Scene.meta`（引擎真实字段：`ui-window.ts:534` / `scene-window.ts:779` 都存当前文件的 FileMeta；`metadata.ts:30` 有 path）。摘要里分工写清：`选中「删除存档数据」·文件「大地图.ui」 → Assets/UI/大地图.….ui`。
    - **验证**：`tests/test-ui-operation.cjs` 新增 A3d **整条链复现用户那一下**（界面树节点 + 列表焦点 + 资源树亮着文件夹 + `UI.meta`）四条断言，摘要实测 `【当前环境】选中「删除存档数据」·文件「大地图.ui」 → Assets/UI/大地图.aabbccdd11223344.ui`；另加"含糊区域级不许盖精确候选"与干净沙盒里的弱信号对照 → **104 PASS**；`test-ai-agent.cjs` 的 F8 契约与新增"点选树节点"摘要断言同步；全量 `tests/run-all.cjs` 34/34 套通过。

53. **测试夹具把用户 C 盘塞爆了 21GB：拷贝真工程 + 从不清理（2026-09-15，用户报"C 盘拉屎"）**：
    - **用户报的现象**：`C:\Users\dange\AppData\Local\Temp` 里堆了 20 多 GB 的 yami 东西。
    - **实测**：`yami-selection-*` **49 个、21.08 GB**（单个 440.6MB），另有 `yami-compiler-*` 等；全目录 TEMP 23.18GB。单个夹具里 433MB 是 `Assets/音频/音乐` 的 wav/ogg。
    - **根因**：`test-ai-selection-grant.cjs` 与 `test-compiler-lookup.cjs` 的 `copyFixture()` 把**真工程整份** `cpSync` 进 `%TEMP%`，而且**从不删**（没有 `process.on('exit')` 清理）。每跑一次总入口就多一个 440MB。
    - **改法**：新增 `tests/_fixture.cjs`（唯一入口）：按**扩展名**跳过音频/图片/视频/字体/压缩包（440.6MB → **18.0MB**，4919 → 692 个文件），并在 `process.on('exit')` 里删掉自己建的目录；`tests/run-all.cjs` 起跑前扫一遍 `%TEMP%`，把**2 小时前**的 `yami-*`/`danjuan-*` 残留删掉并如实打印回收了多少（正在跑的这套不动）。
    - **踩到的坑（差点冤枉产品代码）**：第一版按"体积 > 1MB 就跳过"过滤，结果把 `Script/electron/electron.d.ts`（1.01MB）与 `Data/manifest.json`（2.85MB）也跳过了 —— tsc 少一个类型声明直接报 1 个错，测试于是"证明"编译门禁有问题。**判据必须是"是不是媒体素材"，不能是"文件大不大"**。
    - **顺带查出的两个测试基础设施 bug**：① `test-compiler-lookup.cjs` 里引擎根硬编码 `/home/deck/Desktop/ SHIT/GITHUB/2`（Windows 上等于没有引擎）—— 现在统一走 `resolve-project.cjs` 新增的 `resolveEngineRoot()`（按"存在 `Project/Script`"挑候选）；② 该套件以前**在 Windows 上永远静默跳过**（夹具路径写死 Linux），"看着是绿的，其实一次都没跑过" —— 现在真的跑起来了：**14 PASS / 0 FAIL**（含"平台原生 tsc 存在 / 自动找到并编译通过 errorCount=0 / 语法错误被拦下并回滚"）。
    - **剩下的一条如实标 SKIP**：`找不到编译器时的降级路径` 需要"本机所有 tsc 候选都不存在"才构造得出来，而本机装了 Open Yami 编辑器（那是产品正常候选之一，`server.js:133`）→ 打印 `SKIP …不是通过，是没跑`，不算通过。
    - **验证**：全套 `tests/run-all.cjs` **34/34 套通过**；跑完 `%TEMP%` 里 yami/danjuan 残余 **10 个 / 0.04MB**（改前：单个 440MB、只增不减）；本次清理共回收 **22.79 GB**（C 盘可用 106.74 → 129.81 GB）。

54. **测试套件在 Windows 上有一半在"优雅跳过"：4 条端到端 + 1 个只读段从没跑过（2026-09-15，第 53 项的续）**：
    - **怎么发现的**：用户问"还有什么 bug"，于是把套件里所有 `/home/deck/...` 硬编码路径扫了一遍 —— 它们全都落在 `process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'` 这种默认值上，在 Windows 上等于"夹具不存在 → 静默跳过"，**绿色的 34/34 里有一部分是没跑的**。
    - **改法（统一走 `tests/resolve-project.cjs`，不再有写死路径）**：
      ① `test-interrupt` / `test-context-meter` / `test-message-pairs` 的端到端：只需要"宿主认的工程目录"，改用新增的 `_fixture.minimalProject()`（几十字节、退出即删），不再依赖 Linux 夹具；
      ② `test-acceptance` 的只读段：真实工程改用 `resolveProject()`（= 本机 D:\new-game），引擎 tsc 交给产品自己找（env 留空即"不指定"）；
      ③ `test-todos` / `test-playtest-smoke` 的夹具默认值同样是 Linux 路径 → 改用 `resolveProject()`（这两套以前整片没跑）。
    - **顺手拆掉同一颗雷**：另外 **6 个**套件（`test-changelog` / `test-todos` / `test-playtest-smoke` / `test-mcp-ai-tools` / `test-ai-repair` / `test-mcp-approval-diff`）各自有一份 `copyFixture()` 整份拷贝真工程 —— 只要夹具解析一修好，它们就会跟第 53 项那两颗一样每个 440MB。全部改成 `_fixture.copyProject()`（跳过媒体 + 退出即删）。
    - **跑起来之后真抓到一条假警报**：`test-context-meter` 的"压缩后占用回落到阈值以下"报 `2963 < 2400`。查过产品侧（`ai-host.js:624`"保留量永远不得大于触发门槛，保证压缩后腾出至少 75% 窗口"）后确认：**是测试的窗口选得太小** —— 3000 token 的窗口里，系统提示词 + 38 个工具 schema 本身就近 2000，摘要 + 保留尾巴再加进去，物理上不可能落到 2400 以下。端到端改用 12000 的窗口（阈值 9600，保留 1920）并把轮数从 10 提到 25（10 轮只到 68%，触发不了），承诺这才检查得动；刻度文案断言也跟着由窗口推导，不再写死 `/3k`。
    - **验证**：`node tests/run-all.cjs` **34/34 套通过**；套件里现在只剩 **1 处 SKIP**（就是第 53 项那条"本机另有 tsc、构造不出没编译器的局面"），其余全部真跑；跑完 `%TEMP%` 残留 22 个 / **0.08MB**。

55. **「秒杀全图怪」漏几个的根因：一边遍历一边摘列表 + 按属性名找生命值（2026-09-15，用户报）**：
    - **用户报的现象**：试玩里点「秒杀全图怪」能清掉大部分，但总漏几个；而且顶栏只报一个数字，看不出为什么漏。（同一轮里用户也确认了试玩窗口的「场景实体」面板数据齐全 —— 第 50 项那条"运行时可能没有 `Scene.binding`"的疑虑就此排除，运行时是好的。）
    - **根因一：活列表边遍历边删**。`killAllMonsters` 用的是 `for (let i = 0; i < list.length; i++)`，而 `actor.destroy()` 会真的把角色从 `Scene.actor.list` 里摘掉（引擎 `destroy()` → `parent.remove`）—— 摘一个，后面那个就往前挪一格，循环再 `i++`，**正好跳过它**。改法：遍历前先把名单**快照**出来（`targets` 数组）。
    - **根因二：按"属性名"判断是不是敌人**。老实现只认键名里有 `health` / `hp` / `生命值` 的角色，找不到就 `continue`（跳过）。而**本机工程的角色属性键是 GUID**（`Data/attribute.json` 的 `keys` 里没有这些字面量；角色文件里是 `{"key":"a5fd5e9f229abb2d","value":700}` 这种形状）—— 于是"名字对不上"的角色被静默跳过，用户只看到一个偏小的数字。改法：**"全图怪"就是"清掉所有非我方角色"**（有生命值属性就顺手归零，让界面上看得见血空了；没有这个属性不再是跳过的理由），并把没有生命值属性的那几个**按名字如实报出来**。
    - **改法落地**：`killAllMonsters()` 仍是返回数字（老调用方与测试不受影响），新增 `getLastKillReport()` 返回 `{ killed, skipped: [{name, keys}] }`；HUD 的 toast 在有跳过项时说清「已清掉 N 个角色；其中 M 个没有生命值属性（名字…）」。
    - **验证**：`tests/test-fix-regressions.mjs` §2b 新增 4 条 —— 构造 `destroy()` 真会 `splice` 的列表，断言 **3 个怪物一个不漏**（老实现只会清掉一半）、列表里只剩主角、GUID 属性键的角色照样被清且报告里留着名字、主角不在名单里 → **24 PASS / 0 FAIL**；全量 `tests/run-all.cjs` **34/34 套通过**。

56. **对照《02-Yami引擎机制》审计 AI 助手：揪出「无限生命」同款静默失效 + 5 条机制没进提示词（2026-09-16，用户让读文档查漏）**：
    - **用户给的材料**：`D:\new-game\DANJUAN TOOLS\02-Yami引擎机制.md`（511 行，2026-09-16 更新；含运行时启动链、GUID 契约、属性机制、富文本四层插值、RLE 编解码、存档原子写、源码行号对照表）。
    - **揪出的功能 bug（和上次「秒杀漏人」同一个病根）**：文档 §8.3 明写"原生 Actor 没有 `actor.hp`，战斗属性全靠 `actor.attributes[key]`"，而属性键在这个工程里是 **GUID** —— 实测 `Data/attribute.json`：`a5fd5e9f229abb2d`=生命值（key `health`）、`a8451228fe0c120a`=最大生命值。**「无限生命」的锁血逻辑也是按"键名叫 health/hp/生命值"去找**，于是它在这个工程里**一次都没生效过**（静默、无报错，和「秒杀」一模一样的坑）。
    - **改法**：新增属性表解析（优先运行时的 `Data.attribute`，取不到再读工程里的 `Data/attribute.json`），按表里的 id 找生命值/最大生命值；表里没有就退回按名字找（老工程照旧）。上限取"最大生命值属性"，没有则取"见过的最大的当前值"（升级/换装抬血上限照旧生效），`resetAllCheats` 里清掉基准。为了过静态健康检查（它拦"函数直接调自己"），树遍历改成显式栈循环，不写递归。
    - **没进提示词的 5 条机制**（文档里全是"AI 高危陷阱"级别，而 `ai-host.js` 与 MCP 里 **0 命中**）→ 新增提示词第 32-36 条：① 起始场景不在 `config.startPosition`（那只是启动事件里 `loadScene` 指令的默认取值，只改 config 不生效）；② 属性键是 GUID、原生 Actor 没有 `hp`；③ 注入参数（`@actor`/`@variable-getter`）**注入前已求值**，脚本里拿到的是对象不是函数，禁止 `this.myActor()`；④ 文本插值三档：指令文本 `<local:名>`/`<global:GUID>`、UI TextElement 要**双冒号** `<global::GUID>` 才会自动重绘、本地化用 `<ref:GUID>`；⑤ `Dist/` 是 tsc 编译产物，永远改源文件。
    - **顺带修的测试口径**：提示词变长后 `test-ai-session` 的"压缩后占用回落到阈值以下"（11434 < 11200）差 234 掉下来 —— 和上次 `test-context-meter` 同一类（窗口装不下固定开销），把窗口 14000→20000、轮数 12→20（12 轮只推到 ~11.5k，推不过新阈值就不会触发）；`test-cheats-reset` 的"锁血刷满 100"被我第一版改法打断（老工程用字面量 `maxHealth`）→ 补回按名字找上限的回退。
    - **验证**：`tests/test-fix-regressions.mjs` §1b 新增（GUID 键的生命值被抬回上限 / 关掉后不再干预）→ 26 PASS；`test-ui-operation.cjs` C3c 新增 5 条提示词契约 → 109 PASS；全量 `tests/run-all.cjs` **34/34 套通过**；已部署 1.10.6。

## 3.3 未完成 / 未验证 / 已知限制

| 项目 | 状态 | 说明 |
| :--- | :--- | :--- |
| 编辑器动作桥（5967）在源码构建版的实际可用性 | **已实测可用（2026-09-12）** | 需要重启编辑器后看控制台是否出现 `[Yami Perf Bridge] 编辑器动作服务已就绪: http://127.0.0.1:5967`；本机引擎源码构建此前不暴露引擎全局，已通过 `YamiEngine` 补上 |
| `playtest_smoke` 真实试玩链路 | 待真机验证 | 需要编辑器 + 启动试玩窗口（自动化只能覆盖桩） |
| 界面细节验收（思考块 / 过程区 / 成本行 / 打断手感） | 待用户确认 | 助手不启动编辑器、不截图，一律由用户看 |
| 选中文件默认放行的真机表现（第 35 项） | 待用户确认 | 宿主侧已由 `test-ai-selection-grant.cjs` 真链路验收（选中文件不弹卡直接改 / 另一个文件先确认）；真机请确认两件事：顶栏摘要里出现「选中「xxx」→ Assets/…路径」，以及在编辑器里打开着某个文件时让 AI 改它不再弹确认卡 |
| 对话导出的界面手感（工具条【导出】/ 历史【导出】【导出全部】） | 待用户确认 | 落盘 = 插件数据目录 `%APPDATA%/DanJuanDevSuite/exports/<首条用户消息前 30 字>-<日期>.md`（v1.9.1 起不再落进工程）；导出接口与排版由 `test-ai-session.cjs` §10 真链路验收，面板 DOM 仍只做静态契约断言 |
| 进面板是否回放上次那段对话（G-12） | 待用户确认 | 面板侧行为，静态契约已钉（`restoreLastSession` / `messagesPristine`）；真机由用户进页面看：屏上应当出现上次那段对话 + 一句"这是上次那段对话" |
| 编辑器热更新失败时的真机表现（F3） | 待用户确认 | 失败会挂到工具结果上让模型转告用户；"编辑器内存是否真的刷新了"只能由用户看（引擎未暴露 YamiEngine 时热更新本就不可用） |
| 子代理委派（把子任务派给独立 agent） | 未做（P2） | 现有「任务计划」已能显示步骤；委派本身收益待评估 |
| 热更新通道 | 已改为整包快照 + 本地安装兜底 | 主通道 `codeload` 直连实测 2.2 秒；发布只需 push `extension` 分支（不必另发 Release）；面板「本地安装」为断网兜底 |
| 整包更新的真机试用 | 待用户确认 | 需要用户在 Open Yami 里点一次「一键热更新」（或「本地安装」）并重启工程验收；助手不启动编辑器 |
| 引擎仓库的本地补丁 | **已提交到 fork** | `lildanger/2` · `main` · `f233f54a`（`YamiEngine` 与常用全局暴露）；上游 `bajibaji` 未动，是否上游由用户决定 |
| 试玩窗口的 `Scene.binding`（第 50 项顺带发现） | **已排除（2026-09-15 用户实测）** | 试玩里「场景实体」面板数据齐全（场景名/路径/12x100 紧凑/角色 28…）→ 运行时确实有 `Scene.binding`，这条不用改；编辑器侧仍然走 `Scene.meta`（那条才是对的） |
| 秒钟全图怪的实际手感（第 55 项） | 待用户确认 | 再点一次：应清掉所有非我方角色；如果 toast 里报出"没有生命值属性"的名字里**有你不想清的场景事件角色**（比如「地图终点」这种），告诉我，我按名字/阵营加排除 |
| 测试偶发（2026-09-15） | 待定位 | 全量跑过 6 次里有 1 次 `test-mcp-ai-tools` / `test-playtest-smoke` / `test-acceptance` 退出码非 0（单独跑、以及紧接着的重跑都全绿，实际 0 FAIL）—— 属负载/时序敏感，尚未抓到具体那条断言；下次遇到先留日志再定位 |
| 试玩窗口的 `Scene.binding`（原始记录） | 待查证 | 编辑器侧已确认引擎没有 `Scene.binding`（改用 `Scene.meta`）；但试玩窗口是另一份运行时，`getSceneDetails`（`probe-core.js` 约 1253 行）与「秒杀全图怪」（约 5385 行）仍按 `Scene.binding` 取场景 —— 本机没有那份运行时代码可读，真机试玩时看一眼面板里「场景实体」有没有数据即可判定 |
| 场景对象/多选的真机表现（第 50 项） | 待用户确认 | ① 在场景里点选一个角色，顶栏应显示「选中actor:「主角」 → Assets/角色/…actor」；② 资源树里 Ctrl 多选几个文件，顶栏应显示「选中「A」等 N 个」 |
| 在场感知新口径的真机表现（第 49 项） | 待用户确认 | 请确认两件事：① 高亮选中某个技能后，把鼠标停在检视器空白处或画布上，顶栏应当仍然说"选中「xxx」"（不再变成"停在「检视器」"）；② 鼠标停在一个**有名字的具体控件**上（例如参数框「攻击力」）时，仍然应当说"停在「攻击力」" |
| 审批续跑的顺序修复（【52】） | 待用户确认 | 宿主侧已由 `test-ai-repair.cjs` §6b 真链路验收（事件流上有 start / 工具 start+done / 逐字正文 / 最终结果）；面板 DOM 渲染属浏览器代码，本项目一贯只做静态契约断言，需用户重启编辑器后按「停在确认 → 勾授权 → 执行修改」实测 |

## 3.4 下一步建议

1. 重启编辑器，确认 5967 桥就绪日志出现，让 AI 跑一次「保存工程 / 刷新资源树 / 启动试玩」，把 `editor_action` 从"具备前提"变成"实测可用"。
2. 用一个真实需求（例如改主菜单某处 UI）走完整链路：搜索 → 精读（`key`）→ 预览 → 确认 → 编译 → 变更小结 → 撤销，检验端到端手感。
3. 视使用情况决定是否补 3.3 中的 P2 项（子代理委派）与其余界面基础功能（重新生成 / 复制回答 / @ 引用文件）；「编辑重发」已在第 12 轮、「对话导出」已在第 13 轮落地。

## 3.5 回滚与应急

- 插件母仓库任一文件被改坏：`git diff` 查看未提交改动，必要时 `git checkout -- <file>`（母仓库有完整提交历史）。
- **插件生产目录被更新坏**：更新器在写盘前会把旧版本整份备份到 `<插件目录>/_backup/previous/`，把里面内容覆盖回插件目录即可；也可以直接 `node build.cjs --deploy` 用母仓库重新单向镜像（母仓库永远是唯一真实源）。
- 引擎侧改动（Linux 移植补丁 + `YamiEngine`）已提交到引擎 fork 分支（`lildanger/2` · `main` · `f233f54a`），上游 `bajibaji` 未动；`dist` 整份备份在 `/tmp/yami-dist-backup-*`，`Project/index.html` 另有备份；引擎重建走 `pnpm run build:vite`。
- 插件运行镜像出问题：重新执行 `node build.cjs --deploy` 用母仓库覆盖即可（镜像永远是母仓库的单向拷贝）。
- AI 会话记录：`~/DanJuanDevSuite/sessions/*.json`，删除某段对话用面板「历史」里的删除按钮，或直接删文件。
