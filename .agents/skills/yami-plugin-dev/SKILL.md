---
name: yami-plugin-dev
description: Open Yami RPG Editor 扩展插件（yami-perf-extension / Yami DevSuite）开发的完整背景知识。当用户要求开发、修改、排障 Yami 编辑器扩展时使用：包含核心工程路径映射、扩展加载与注入机制、输入防穿透金规、引擎真实数据结构、UI 污染防御、热重载流程与工程规范。
---

# Yami 插件开发 Prompt Skill

面向 Open Yami RPG Editor 的扩展插件开发（当前项目：yami-perf-extension，演进目标：Yami DevSuite 复合开发者套件）。开始任何任务前阅读本节。

## 1. 核心工程与源码路径映射

| 路径 | 工程定位 | 核心职责 |
| :--- | :--- | :--- |
| `D:\Program Files\Open Yami RPG Editor\extension\yami-perf-extension\` | **编辑器运行时加载路径** | 引擎启动时挂载的生产扩展目录（真正生效的就是这里） |
| `D:\Documents\GitHub\yami-tools\public\tools\perf-lab\extension\` | **版本受控源码路径** | 源码开发基线（工作区，与生产目录保持文件级同步） |
| `D:\Documents\GitHub\yami-tools\dist\tools\perf-lab\` | **分析台 Web 端** | 性能大盘网页端（DevTools Trace / Spector.js / 5966 SSE 实时波形） |
| `D:\Documents\GitHub\2` | **Open Yami 引擎底层源码** | `main/`=Electron 主进程；`Project/Script/`=编辑器源码；`Project/Templates/arpg-ts-*`=运行时模板与内核（`main.ts`、`webgl.ts`、`stage.ts`、`time.ts` 等） |
| `D:\new-game` | **游戏工程本体** | `Assets/`=事件(.event)/UI(.ui)/插件/素材；`Script/`=运行时 TS 与组件；`Data/`=引擎配置与数据表；`DANJUAN TOOLS/`=项目内定制工具与机制文档 |
| `D:\GAME-20240905` | **历史/参考游戏工程** | 早期游戏版本与参照工程 |

**铁律：`D:\Documents\GitHub\2` 引擎源码仓库只读参考、勿改；`D:\new-game` 改动不提交。**

## 2. 扩展加载与注入机制（必守）

- MV3 manifest，权限 `["<all_urls>"]`，注入 `probe-core.js` → `hud-overlay.js`，时机 `document_start`。
- 加载路径**必须绝对化**：引擎主进程 `readdirSync('./extension')` 返回相对目录名，需 `path.resolve(extensionPath, v)`，否则静默失败。
- 试玩窗口是 `file://` 协议，必须 `session.loadExtension(p, { allowFileAccess: true })`，否则 Content Script 被拦截。
- content_scripts 必须声明 `"world": "MAIN"`，才能与游戏主脚本同 JS 上下文，直接读 `Game`、`Scene`、`EventManager`、`Variable`、`Camera`。

## 3. 输入防穿透（Event Phase Isolation，金规）

- 鼠标进入侧边栏/胶囊：调用 `Scene.preventInput()` 并重置 `Input.buttons = [0,0,0]`；离开时 `Scene.restoreInput()`。原理：引擎内 `if (Scene.preventInputEvents === 0)` 才处理输入，计数>0 时内核自动忽略全部输入——官方零副作用通道。
- DOM 层只允许在 **`mousedown` 阶段**对父容器 `e.stopPropagation()`；**严禁拦截 `click` / `mouseup` 冒泡**（否则浏览器中断调度，插件按钮/Tab 点不动）。
- 结果：按钮/Tab 原生点击反馈正常，游戏不会误走位，不改 Yami 源码。

## 4. 引擎真实数据结构（严禁盲猜字段）

- 角色：`Scene.actor.list`（实体数组）；可见数 `Scene.visibleActors.count`。
- 光源/粒子：`Scene.light.list`、`Scene.emitter.list`；总微粒 `Scene.particleCount`。
- 动画/触发器：`Scene.animation.list`、`Scene.trigger.list`。
- 活跃事件：`EventManager.activeEvents` 元素为 `EventHandler` 实例；当前指令 `ev.index`，总指令 `ev.commands.length`，路径 `ev.path` 或 `ev.initial.path`。

## 5. 常用调试切入点（已验证）

- 游戏变速：`Time.scale = 2.0`（0.2x~5x）。
- 玩家实体：`const player = Scene.actor.list.find(a => a.isPlayer) || Scene.actor.list[0]`。
- 穿墙：`player.collidable = false`（或重写 `player.checkObstacle`）；无敌：`player.attributes.hp = player.attributes.maxHp`。
- 变量：`Variable.set('var_guid', 99999)` / `Variable.get('var_guid')`。
- 碰撞盒可视化：Hook `SceneSpriteRenderer.prototype.render`，遍历 `Scene.actor.list` 画 collider 矩形。

## 6. UI 开发底线（编辑器 CSS 污染防御）

- 编辑器全局 CSS 有 `button { position: absolute; width: 88px; height: 20px; }`（`Project/css/components.css` 第 5 行）——**所有可点击项一律弃用原生 `<button>`，改用 `<div role="button">`**，并显式 `#yami-perf-dock div[role="button"] { position: static !important; }`。
- Tab 幽灵节点：初始化前 `document.getElementById(...).remove()` 扫旧 DOM；非激活面板 `display: none !important`；切换用 `tabContents.forEach(c => c.classList.toggle('active', c.id === ...))` 局部互斥。
- 暗黑设计系统：`#181818` / `#282828` / `#303030`。

## 7. 模块化蓝图（长期演进目标）

```
yami-devsuite/
├── manifest.json
├── core/  bootstrap.js 桥接 bridge.js  ui-shell.js（胶囊+侧栏+Tab路由）
└── modules/
    ├── profiler/   # 性能与渲染分析（已落地）
    ├── console/    # godmode / noclip / speedhack / inventory
    ├── inspector/  # actor-tree / hitbox-debug
    ├── variables/  # watcher / switches
    └── events/     # step-runner 单步执行器
```

## 8. 热重载与工程规范

- 修改生产扩展目录文件后，**试玩窗口按 F5 即生效**，无需重启编辑器；改了 `manifest.json` 需完全关闭编辑器重开。
- 落盘前必须 `node --check` 语法校验通过。
- 当前处于本地深度开发期：**不自动 git commit/push**，等用户明确指示；未完成/需求待定功能在 README 标 beta。
- 游戏工程 `D:\new-game` 的改动不提交；引擎仓库勿动。