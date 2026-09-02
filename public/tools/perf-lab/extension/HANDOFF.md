# Open Yami 开发者全能套件 (Yami DevSuite / Extension)
## 项目交接与复合插件架构蓝图 (HANDOFF & ROADMAP)

> **文档定位**：记录当前扩展的底层注入机制、已实现的性能分析体系，以及未来升级为**「Open Yami 复合开发者套件（游戏内置全能调试台 / 作弊器 / 场景检视器 / 变量监视器）」**的模块化架构蓝图与交接指南。

---

## 1. 项目愿景与架构定位

从单一的「性能分析插件」演进为 **Open Yami 原生复合型在场开发者套件（In-Game DevSuite）**：
- **零修改游戏工程**：以 Open Yami RPG Editor 编辑器扩展（MV3 Extension）形式加载，试玩任何工程自动生效，不污染游戏工程源码。
- **完全非阻塞与游戏无缝交互**：沉浸式停靠、可自由拖拽、支持鼠标穿透，游戏不暂停、操作不拦截。
- **100% 对齐 Yami 原生设计系统**：硬朗暗黑调色板（`#181818` / `#282828` / `#303030`），纯正编辑器质感。
- **多维能力复合体**：
  1. **性能与卡顿分析（Profiler）** [已落地]
  2. **作弊与调试控制台（Cheats & Debug Console）** [规划中]
  3. **场景实体与碰撞盒层级检视（Scene Inspector & Hitbox）** [规划中]
  4. **全局变量与开关动态监视/修改（Variable & Switch Watcher）** [规划中]
  5. **事件单步调试与指令断点（Event Debugger）** [规划中]

---

## 2. 核心源码路径与映射关系

| 目录 / 文件 | 角色定位 | 核心职责 |
| :--- | :--- | :--- |
| `D:\Program Files\Open Yami RPG Editor\extension\yami-perf-extension\` | **编辑器运行时加载路径** | 引擎启动时直接挂载的生产扩展目录。 |
| `d:\Documents\GitHub\yami-tools\public\tools\perf-lab\extension\` | **版本受控源码路径** | 源码开发基线，包含完整的构建与打包产物源文件。 |
| `d:\Documents\GitHub\yami-tools\dist\tools\perf-lab\` | **分析台 Web 端** | 性能大盘网页端，提供深度可视化、历史基线比对与 5966 SSE 实时波形。 |
| `D:\Documents\GitHub\2\main\main.ts` | **引擎底层主进程** | Electron 扩展加载核心逻辑（已修复绝对路径与 `allowFileAccess: true`）。 |
| `D:\Documents\GitHub\2\Project\Templates\arpg-ts-chinese\Script\` | **游戏内核核心源码** | `scene.ts`, `event.ts`, `input.ts`, `camera.ts`, `webgl.ts` 等底层实现参考。 |

---

## 3. 关键底层机制与踩坑防踩档案 (Critical Gotchas)

后续接手开发任何新模块时，**必须严格遵守以下底层规律**：

### ① 扩展加载与本地文件协议权限
- **路径必须绝对化**：引擎主进程 `readdirSync('./extension')` 返回相对目录名，必须使用 `path.resolve(extensionPath, v)`，否则报错静默失败。
- **必须开启 `allowFileAccess: true`**：试玩窗口为 `file://` 协议，Chromium 默认拦截对 `file://` 的 Content Script 注入，必须在 `session.loadExtension(p, { allowFileAccess: true })` 中显式声明。

### ② 脚本注入环境 (`world: "MAIN"`)
- `manifest.json` 中 `content_scripts` 必须声明 `"world": "MAIN"`。这样注入的代码才与游戏主脚本运行在同一个 JS 上下文中，能直接读取全局变量 `Game`, `Scene`, `EventManager`, `Variable`, `Camera`。

### ③ 鼠标与指针事件穿透防御与内部点击保活 (Event Phase Isolation)
- **现象**：点击悬浮窗会导致游戏角色误移动；但若在父容器或 window 的捕获阶段调用 `stopPropagation()` 或 `stopImmediatePropagation()`，会导致浏览器立刻中断后续调度，事件根本无法向下分发到具体的按钮和 Tab，导致插件彻底点不动！
- **根因**：Yami 引擎的 `MouseManager` 监听的是冒泡阶段的 `window.on('mousedown')`，且角色移动逻辑在 `Scene` 帧循环中轮询鼠标状态。
- **最佳标准实践（引擎原生防穿透 API + DOM 零死锁解耦）**：
  1. **采用 Yami 官方原生机制**：鼠标进入侧边栏/胶囊时调用 `Scene.preventInput()` 并重置 `Input.buttons = [0,0,0]`，离开时调用 `Scene.restoreInput()`。
     - 原理：Yami 引擎内部所有点击寻路、NPC 触发均硬性依赖 `if (Scene.preventInputEvents === 0)`，只要该计数大于 0，引擎从内核层面 100% 自动忽略所有输入事件！这是最纯正、零副作用的官方输入隔离通道！
  2. **DOM 层零死锁解耦**：只在 `mousedown` 阶段对父容器进行 `e.stopPropagation()` 阻断，**严禁对 click 和 mouseup 进行冒泡拦截**，让浏览器的点击事件自然分发至每一个具体的 Tab 和关闭按钮；
  3. **结果**：插件内所有按钮和 Tab 拥有 100% 原生点击反馈与灵敏切换，游戏底层绝对不会触发走位，且不改动 Yami 源码一行代码！

### ④ 引擎内部真实数据结构映射 (严禁盲猜字段)
- **角色列表**：不是 `Scene.actors`，而是 `Scene.actor.list`（实体数组）；可见实体为 `Scene.visibleActors.count`。
- **光源与粒子**：不是 `Scene.lights`，而是 `Scene.light.list` 与 `Scene.emitter.list`；总微粒数为 `Scene.particleCount`。
- **动画与触发器**：`Scene.animation.list` 与 `Scene.trigger.list`。
- **活跃事件**：`EventManager.activeEvents` 中的对象为 `EventHandler` 实例，当前指令行为 `ev.index`，总指令为 `ev.commands.length`，路径为 `ev.path` 或 `ev.initial.path`。

### ⑤ Tab 强隔离与防幽灵 DOM 重叠 (Ghost DOM Prevention)
- **现象**：Tab 内容重叠混在一块，或者热重载后存在多个面板实例。
- **解决标准**：
  1. 必须在初始化前显式 `document.getElementById(...).remove()` 扫除旧节点；
  2. 面板切换样式必须使用 `.yami-perf-tab-content { display: none !important; }`，非激活态强制隐藏，绝不依赖特异性弱的通用规则；
  3. 切换逻辑使用 `tabContents.forEach(c => c.classList.toggle('active', c.id === ...))` 在局部容器内实现 100% 互斥。

### ⑥ 编辑器主界面全局 CSS 致命污染规避 (Editor Global CSS Immunity)
- **现象**：在游戏 Demo 窗口中 Tab 正常，但在 Open Yami 编辑器主界面中 Tab 严重叠在一起或变形。
- **根因**：Open Yami 编辑器源码 `Project/css/components.css` 第 5 行直接声明了：
  ```css
  button { position: absolute; width: 88px; height: 20px; }
  ```
  编辑器对全局通用的 `button` 标签粗暴施加了绝对定位，导致所有插件内的原生 `<button>` 全部被强行定位在同一个绝对坐标上严重堆叠！
- **防御规范**：
  1. 插件内部所有可点击项一律弃用原生 `<button>` 标签，全部改用 `<div role="button">`；
  2. 显式声明 `#yami-perf-dock div[role="button"] { position: static !important; }`，彻底免疫编辑器的全局污染！

---

## 4. 当前已交付模块现状 (As-Is)

### 1. `manifest.json` (MV3 清单)
- 权限范围：`["<all_urls>"]`
- 注入文件：`probe-core.js` -> `hud-overlay.js`
- 注入时机：`document_start`

### 2. `probe-core.js` (探针与微服务核心)
- **更新器与渲染器耗时包裹**：零开销 Hook `Game.updaters` 和 `Game.renderers`，按微秒级记录耗时。
- **WebGL DrawCall 拦截器**：Hook `drawElements`, `drawArrays`, `useProgram`, `bindTexture`，统计每帧 DrawCall、三角面数、Shader 切换。
- **内存监控**：安全读取 `performance.memory` 堆内存（Used / Total MB）。
- **场景与事件追踪**：对接 `SceneManager` 实体统计，并在 `wrapEventHandlers` 中捕获事件执行流水历史。
- **本地 5966 端口微服务**：内置 Node.js 原生 HTTP/SSE 服务，打通跨域限制，对外提供 `/stream`（SSE 长连接）与 `/live`（JSON 快照）。

### 3. `hud-overlay.js` (原生暗黑悬浮大盘)
- **迷你胶囊 HUD**：实时显示 FPS、耗时（ms）与 DrawCall（DC）；支持全屏幕自由拖拽，松手自动持久化记忆坐标；避开 Windows 右上角窗口按钮。
- **非阻塞停靠侧栏（宽 440px）**：按 `Home` 键平滑滑出/收起；带 `[📌 穿透]` 模式（半透明，鼠标完全穿透游戏操作）；捕获阶段阻断指针冒泡。
- **4 大 Tab 视图**：
  1. `⚡ 瓶颈与总览`：FPS/耗时/超帧/内存/模块排行榜/严重掉帧快照
  2. `🎨 渲染与 WebGL`：DrawCall/Triangles/Shaders/Textures
  3. `🎬 场景与对象`：角色/光源/发射器/粒子/动画/触发器/摄像机坐标与视口
  4. `📜 活跃事件`：当前运行事件/全局注册事件/最近事件流水轨迹

---

## 5. 复合插件未来模块化蓝图 (To-Be Architecture)

为了避免单文件过大，未来演进为**微内核模块化架构**：

```
yami-devsuite/
├── manifest.json
├── core/
│   ├── bootstrap.js         # 扩展启动器、环境嗅探与微内核生命周期
│   ├── bridge.js            # 5966 本地微服务与广播通信
│   └── ui-shell.js          # Yami 原生暗黑外壳（胶囊、侧边栏容器、Tab路由系统）
├── modules/
│   ├── profiler/            # 模块1：性能与渲染分析 (当前核心功能)
│   │   ├── probe-gl.js      # DrawCall / WebGL 监控
│   │   └── probe-cpu.js     # CPU / Updaters / 卡顿分析
│   ├── console/             # 模块2：作弊与调试控制台 (Cheats & Console)
│   │   ├── godmode.js       # 玩家无敌 / 锁定血量 / 锁定魔力
│   │   ├── noclip.js        # 穿墙模式 (修改 Actor 碰撞标志)
│   │   ├── speedhack.js     # 游戏加速/减速 (修改 Time.scale)
│   │   └── inventory.js     # 金币修改 / 物品自由注入 / 装备解锁
│   ├── inspector/           # 模块3：场景对象与碰撞盒检视 (Scene Inspector)
│   │   ├── actor-tree.js    # 场景 Actor 树状列表，实时查看状态、坐标、自变量
│   │   └── hitbox-debug.js  # 画面叠加碰撞体线框 (Hurtbox/Hitbox 可视化)
│   ├── variables/           # 模块4：全局变量与开关监控 (Variables & Switches)
│   │   ├── watcher.js       # 变量实时监听表，支持在场双击改值
│   │   └── switches.js      # 独立开关/全局开关实时切换
│   └── events/              # 模块5：事件单步执行器 (Event Debugger)
│       └── step-runner.js   # 暂停事件、单步执行、指令行追踪
```

---

## 6. 后续功能特性实现技术指引 (Implementation Recipes)

接手开发新功能时，可直接参考以下已验证的引擎内部核心切入点：

### 1. 游戏速度调节（变速齿轮 / Time Scale）
```javascript
// 修改游戏整体运行速率 (0.2x 慢动作 ~ 5x 极速跳过剧情)
Time.scale = 2.0;
```

### 2. 角色穿墙（Noclip）与无敌（GodMode）
```javascript
// 获取玩家主控角色
const player = Scene.actor ? Scene.actor.list.find(a => a.isPlayer) || Scene.actor.list[0] : null;
if (player) {
  // 穿墙：修改碰撞与移动阻挡
  player.collidable = false; // 或重写 player.checkObstacle
  // 无敌：锁死最大生命值
  if (player.attributes) {
    player.attributes.hp = player.attributes.maxHp;
  }
}
```

### 3. 全局金钱与变量实时查看/修改
```javascript
// Yami 全局变量管理器存放在 Variable
// 读取与修改开关/变量
Variable.set('var_guid', 99999);
const value = Variable.get('var_guid');
```

### 4. 碰撞盒（Hitbox / Hurtbox）可视化调试渲染
```javascript
// Hook SceneSpriteRenderer.prototype.render
// 利用 Canvas 或 WebGL 绘制 Scene.actor.list 中每个角色的 collider 矩形框
```

---

## 7. 日常开发与热重载指南

1. **修改代码后生效方式**：
   - 生产插件位于：`D:\Program Files\Open Yami RPG Editor\extension\yami-perf-extension\`；
   - 每次修改完该目录文件后，**在试玩窗口内按 `F5`（刷新页面）即可立即生效**，无需重启整个 Open Yami 编辑器；
   - 若修改了 `manifest.json`，则需完全关闭编辑器后重新打开。
2. **规范约束**：
   - 当前进入本地深度功能开发期，**不触发无意义的 git commit/push**；
   - 严格保证 `node --check` 语法校验通过后落盘。
