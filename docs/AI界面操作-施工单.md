# AI 界面操作 · 施工单（给实现方）

> 配套文档：`docs/AI界面操作-方案与验收清单.md`（需求已定案 + 23 条验收清单）。**本文件是施工说明，那本是验收标准。**
> 需求已经与用户逐条确认定案，**不要再改需求**；有疑问先问，不要自行发挥。

---

## 0. 交付物清单（做完这些才算完）

| 交付物 | 说明 |
| :--- | :--- |
| 代码改动 | `probe-core.js` / `ai-host.js` / `ai-agent.js` / `src/style.css` / `runtime/yami-mcp/*`（按第 5 节分期） |
| 新增测试套件 | `tests/test-ui-operation.cjs`（行为断言，不是字符串存在性断言） |
| 构建锚点 | `build.cjs` 里新增本机制的断言（见 2.3） |
| 文档更新 | `HANDOFF.md` 第三层新增条目；`README.md` 同步计数（见 2.5） |
| 自查输出 | 第 8 节所有命令的真实输出 |

---

## 1. 完成定义（DoD）

1. `node build.cjs --deploy` 全绿，生产镜像 MD5 逐文件一致。
2. `node tests/run-all.cjs` 不低于当前基线 **25/28**（既有失败：`test-changelog` / `test-tool-schema` / `test-compiler-lookup`，属环境所致，不要试图"修"它们）。
3. 新增套件全绿，且**断言的是行为与数值，不是"文件里有没有这个字符串"**。
4. 配套文档第 6 节 23 条验收清单逐条可过。

---

## 2. 工程硬约束（违反任一条 = 交付无效）

### 2.1 版本与构建

- 版本 SSOT 在 `manifest.json`，由 `build.cjs` 级联到 `hud-overlay.js` / `README.md` / `HANDOFF.md`。
- **改完发布文件必须跑 `node build.cjs --deploy`**，只跑门禁不部署 = 生产目录还是旧代码。
- 发布文件：`manifest.json` / `bootstrap.js` / `ai-render-core.js` / `probe-core.js` / `hud-overlay.js` / `ai-agent.js` / `ai-host.js` + `runtime/` 递归。

### 2.2 门禁

`node build.cjs` 必须全绿：**46 项核心锚点 + 10 项整包更新锚点 + 0 Emoji + 术语合规 + CSS 花括号配平 + 滚动条单一事实源 + 文档一致性**。

### 2.3 主动加锚点

本仓库的规矩是：**每上一个机制，就往 `build.cjs` 的断言表里加一条锚点**（现在 46 条）。本次至少要加：

- 演出浮层的类名存在于 CSS；
- `uiSteps` 执行器存在且不吞错；
- `pendingInput`（未提交输入）判据存在；
- 双实例握手端点存在。

### 2.4 测试套件接入方式（会踩坑，写清楚）

`tests/run-all.cjs` 用的是**硬编码数组** `SUITE`（不是自动扫描目录）。新增套件必须：

1. 在 `tests/run-all.cjs` 的 `SUITE` 里加一行 `['test-ui-operation.cjs', '界面操作(收束边框+步骤执行+急停)']`；
2. 同步 `README.md` 里的套件数。
3. 套件风格照抄现有：纯 Node、零依赖、`PASS/FAIL` 输出、末尾打印 `########## xxx: N PASS / M FAIL ##########`、失败退出码非 0。
4. 涉及临时目录清理的，**必须带 Windows `rmSync` EPERM 重试**（五个套件都踩过这个坑）。

### 2.5 文档计数一致性（有门禁，必须同步）

`tests/test-static-health.cjs:409-419` 会校验 README 里两个数字：

- `/(\d+)\s*条血泪避坑档案/` -> 必须等于 `HANDOFF.md` 里 `### ①…` 形式铁律的实际条数（圈码范围要覆盖到 ㊿）；
- `/run-all\.cjs:?\s*(\d+)\s*套/` -> 必须等于实际套件数。

**新增铁律或新增套件时，README 不同步 = 门禁红。**

### 2.6 主世界装载方式（别改错）

- `manifest.json` 的 `content_scripts.js` **只有 `bootstrap.js`**（Electron 20 忽略 `world:"MAIN"`）。
- `bootstrap.js:27` 的 `FILES = ['probe-core.js','ai-render-core.js','hud-overlay.js','ai-agent.js']` 是注入顺序，**probe-core 第一个**。
- 新增脚本必须同时加进 `bootstrap.js` 的 FILES 与 manifest 的 `web_accessible_resources`。

### 2.7 CSS 单一事实源

- 所有样式写在 `src/style.css`，由 `build.cjs` 注入 `hud-overlay.js`（不要直接手改 `hud-overlay.js` 里的样式）。
- **任何 `overflow:auto|scroll` 的容器都要登记进滚动条选择器组**，否则门禁红。
- 禁止规则块嵌套；花括号必须配平。
- 类名一律加 `yami-ai-` / `yami-perf-` 前缀，**keyframes 也必须加前缀**，避免与编辑器样式冲突。

### 2.8 不许做的事

- **不许 `git commit` / `git push`**（用户明确要求，提交时机由用户决定）。
- **不许启动 Open Yami 编辑器做验证，不许截图**（用户明确要求）。
- 不许为了让测试通过而放宽断言。

---

## 3. 可复用资产（先读这些，别重造轮子）

| 能力 | 位置 | 说明 |
| :--- | :--- | :--- |
| 页面内全局钩子 | `probe-core.js:4426` `window.__YAMI_PERF_PROBE__ = {...}` | **已有约定**，HUD/面板已经在读它（`hud-overlay.js:5223` 等 8 处） |
| 编辑器动作桥 | `probe-core.js:3400-3630`，端口 5967 | `/live` `/token` `/context` `/action`，动作白名单，无任意 JS |
| 已有动作 | `probe-core.js:3520-3612` | `save` `refresh` `playtest` `undo` `redo` `dumpUi` `click` `interact` `context` |
| 控件枚举 | `probe-core.js:3542` `dumpUi` | 返回可见控件的 tag/id/text/bounds |
| 性能/诊断桥 | `probe-core.js:3346` 起，端口 5966 | `/live` `/report` `/diagnose` `/stream`（**没有 `/context`**） |
| MCP 编辑器客户端 | `runtime/yami-mcp/modules/editor-bridge.js` | `request(method,route,body,timeout,token)` / `action()` / `getContext()` |
| MCP 工具注册 | `runtime/yami-mcp/server.js:885` 起（现有 36 个） | 加工具要同时加 `tools[]` 条目与 `callTool` 分支 |
| 审批卡 | `ai-host.js:1781` `FILE_MUTATIONS`/`DELETE_TOOLS`/`approvalMode`；面板 `#yami-ai-approval`（`ai-agent.js:773`） | **黄/红档直接复用** |
| 打断 | `ai-agent.js:2248-2257` | 面板开着且正忙时 `Esc` = 停；升级成"停在动作之间" |
| 引导投递 | `ai-host.js` `steerQueues`/`queueSteer`/`drainSteer`/`takeUndeliveredSteer` | 铁律㊷"收下 ≠ 送到" |
| 面板页面注册 | `ai-agent.js:2061` `page.id='page-ai'`；`2171` `api.registerPage('ai', page, {...})` | 常显上下文行加在这里 |
| 会话与事件 | `ai-host.js` `/chat` `/chat/stream` `/approve` `/reject` `/steer` `/config` `/project` `/sessions` `/backups`… | SSE 事件：`start/status/delta/tool/result/error/system/steer/notice` |
| 浮层基建 | `hud-overlay.js`（`#yami-perf-dock`、`.yami-perf-toast`，均 `position: fixed`） | 演出浮层与它同层级体系 |

---

## 4. 接口契约（先定死，不许各写各的）

### 4.1 页面内钩子（解决"谁在提问就用谁的视野"）

在 `window.__YAMI_PERF_PROBE__` 上新增：

```js
getEditorContext(),   // 返回当前这个页面自己的上下文（编辑器页 or 试玩页都能调）
hasPendingInput(),    // 是否有未失焦/未提交的输入（boolean）
ui: { ... }           // 见 4.2
```

`ai-agent.js` 调 `/chat` 时带上：

```js
{
  sessionId, message,
  pageContext: {
    page: 'editor' | 'playtest',    // 由 location.href 判定（复用 probe-core 的 isEditorHostPage 口径）
    summary: '场景「新手村」· 选中「木剑.item」· 检视「木剑」',
    scope: window.__YAMI_PERF_PROBE__.getScope() || null   // 4.1 里 `getScope`：当前页面/窗口种类
  }
}
```

宿主优先用 `pageContext.summary` 注入 system；**拿不到时才回退查 5967**。这样试玩窗口提问时不会被写成"编辑器"。

### 4.2 演出 API（probe-core 负责画和等，面板只负责写白话）

```js
window.__YAMI_PERF_PROBE__.ui = {
  // 把边框从外扩收到目标元素边框上；返回 Promise，留痕结束后 resolve
  // target: { selector } | { page, key } | { rect }
  // opts: { phase: 'preview' | 'applied', label, holdMs, settleMs, batchKey }
  ringTo(target, opts) -> Promise<{ ok, rect?, error? }>,
  cancel(reason),        // 急停：立刻收框，后续步骤不再执行
  isBusy(),
  onUserActivity(cb)     // 用户在打字/点击 -> 执行器让路
}
```

**为什么归 probe-core**：它在页面里、能建 DOM（`probe-core.js:4592` 已有先例）、注入顺序第一个、且要跟"解析目标元素"共用同一份 DOM 知识。

### 4.3 5967 动作协议扩展：`uiSteps`

`POST /action`（需令牌）新增：

```js
{
  action: 'uiSteps',
  steps: [
    { kind: 'focus' | 'set' | 'click' | 'goto' | 'wait',
      target: { selector: '#fileItem-attack' } | { page: 'scene' } | { key: 'attack' },
      value: 25,            // kind=set 时用
      label: '把攻击力从 10 改成 25',
      mergeGroup: 'item-木剑'   // 同组动作合并成一步演出
    }
  ]
}
```

执行器语义（**必须严格照做**）：

1. 逐步执行：解析目标 -> `ringTo(预览)` -> 等 `holdMs` -> 执行 -> `ringTo(已改)`。
2. **任一步失败（目标解析不到 / 执行抛错）立刻停止**，返回
   `{ ok:false, failedAt:index, done:[...已完成步骤], error:'人话原因' }`——**绝不允许继续执行后续步骤**。
3. `cancel()` 在步骤之间生效，正在执行的原子动作不打断。
4. 同一 `mergeGroup` 的步骤合并演出（首框 240+340ms，后续每个 120ms，最后一次留痕）。

### 4.4 面板 <-> 宿主的新增事件

- 宿主 -> 面板：`ui` 事件 `{ step:'begin'|'done'|'failed', index, label, total }`，面板把它写进聊天卡片的白话行。
- 面板 -> 宿主：`/chat` 的 `pageContext`（4.1）。
- 新增 `POST /ui-cancel`：面板「停止」与 `Esc` 调它，宿主转成 5967 的 `ui.cancel()`。

### 4.5 DOM 命名（统一前缀，避免与编辑器冲突）

- 演出浮层：`#yami-ai-ring`，类 `.yami-ai-ring`、`.yami-ai-ring-preview`、`.yami-ai-ring-applied`；
- 常显上下文行：`#yami-ai-scope`；
- 对齐卡：`#yami-ai-align`（样式沿用现有卡片体系）；
- keyframes：`yami-ai-ring-in` 等。

---

## 5. 分期施工

### P0 必修（盲区，可独立交付，先做）

| 编号 | 做什么 | 文件 | 验收 |
| :--- | :--- | :--- | :--- |
| P0-1 | 上下文采集补全：加 `Layout.manager.index`（当前工作页面）、浮动窗口判定、`pendingInput`；`selectedFile` 用 `alias` 而不是带 guid 的 `name` | `probe-core.js` `getEditorContext()` | 配套文档 6.3 第 12/13 条 |
| P0-2 | 试玩窗口视野：实现 4.1 的钩子 + `/chat` 带 `pageContext`；同时让 5966 也暴露 `/context` 作为兜底 | `probe-core.js` / `ai-agent.js` / `ai-host.js` | 在试玩窗口提问时摘要必须写"试玩运行中"，不许写"编辑器" |
| P0-3 | AutoReload 竞态：写盘类工具执行前检查 `hasPendingInput()`，为真则排队等待或明确告知用户 | `ai-host.js` + `probe-core.js` | 用户正在输入未失焦时写盘被拦住 |
| P0-4 | 双实例握手：`GET /whoami` 返回 `{ projectRoot, pageUrl, instanceId }`；`EADDRINUSE` 不再静默，宿主发现工程不匹配必须拒绝操作并如实告知 | `probe-core.js` 3402/3624 / `editor-bridge.js` | 开两个编辑器时不串工程 |
| P0-5 | 焦点保护：改属性补 `focus()->写值->blur()`，动作前后保存/恢复焦点；用户正在输入时排队 | `probe-core.js` 动作执行器 | 改完能 Ctrl+Z 撤回；用户的输入不丢 |

**P0-5 是硬前置**：不补 blur，引擎不写撤销栈（`inspector.ts:340`），绿档"可撤销"就是假的。

### P1 演出引擎

- 建 `#yami-ai-ring` 浮层（`probe-core.js`），样式进 `src/style.css`。
- 实现 `ringTo`：`outline-offset` 从 +28px 动画到 0（**不要动 top/left/width/height**），位置用 `transform: translate()` 跟随 `getBoundingClientRect()`。
- 时间轴：收束 240ms -> 停留 340ms -> 执行 -> 留痕 420ms（单动作 1.0s）。
- 滚动跟随：监听 scroll/resize 重取 rect；目标消失 -> 收框并返回 `{ok:false}`。
- `pointer-events: none`（含命中测试断言）。
- 合并规则与 5 个落点上限。
- **每帧不许触发重排**（本插件就是性能插件，不能自己制造 layout thrash）。

### P2 常显上下文行 + 反问

- `#yami-ai-scope` 挂在 `#page-ai` 内；数据来自 `pageContext`（4.1），切换页面/选中后应及时更新。
- 点它可纠正/清空（写进输入框或重新读取）。
- AI 自身不确定时必须反问，不许硬猜。

### P3 对齐卡

- `#yami-ai-align`：AI 在动手前必须先出这张卡（决策 6）。
- 选项来自 AI 的提问；**只问"答案会改变接下来做法"的问题，不设数量上限**（决策 7）。
- 卡片必须列出"其余按默认"的项，用户可当场否决。
- 用户点「开工」后 AI 回一句开工回执，然后才执行 `uiSteps`。

### P4 危险分级接线

- 绿：直接执行 + 面板给「撤销这一步」（调 `/action undo` 或 `UndoManager`）。
- 黄：走现有审批卡 `#yami-ai-approval`。
- 红：打字确认（复用 `DELETE_TOOLS` 的二次确认路径）。
- `cdp_eval` 默认从工具列表移除，只在设置的"开发者模式"里出现。

### P5 能力范围（乙档）

按配套文档第 3 节的能力表落地：定位/查看、改属性、装配事件指令、建/复制资源、删资源、跑试玩验证、批量改。
**脚本改动保留能力但不进演出**（无界面落点），用卡片交代改了哪个文件。

---

## 6. 引擎事实表（照抄，不要重新试错）

| 事实 | 出处 | 后果 |
| :--- | :--- | :--- |
| 检视器改动**靠 blur 才进撤销栈** | `inspector.ts:340` `Inspector.inputBlur`；各页 `elements.on('blur', ...)`，如 `file-scene-page.ts:56` | 不补 blur，AI 改的值撤不回来 |
| `Inspector.open()` 会主动 `document.activeElement.blur()` | `inspector.ts:202-204` | 会踩掉用户正在输入的内容，并触发 history.save |
| 控件 id 约定是 `<面板>-<字段>` | `inspector.ts:235-243` `Inspector.getKey`；如 `#fileItem-attack` `#fileScene-width` | 属性级高亮可以精确定位 |
| 面板容器是 `#inspector-page-manager > page-frame[value=...]`，**用 CSS 类 `visible` 切换**，子节点**没有 id** | `page-manager.ts:27-55`；`index.html` | 别用 `[style*="display: none"]` 或 `[hidden]` 判激活（会得到死代码）；权威字段是 `Inspector.manager.active` |
| 场景对象的权威类别字段是 `.class` | `scene-target.ts:17` `map[target.class]` | 取值 `actor/region/light/tilemap/animation/particle/parallax` |
| `Scene.setTarget()` 自己会更新列表并打开检视器 | `scene-target.ts:6-23` | 走引擎入口时界面会自己跟着变（这就是"假装点了"能成立的原因） |
| 树列表有 `expandToSelection()` / `scrollToSelection()` | `scene-target.ts:247-248` | 指之前先把目标滚进可视区，别硬滚 |
| 资源树当前选中在 `body.selections`，`activeFile` 只是"按下未松开"的临时态 | `file-body-pane.ts:651-695` | 读选中要读 `selections` |
| `FileItem` 有 `name/alias/basename/extname/path/type`；`FileMeta` **没有** `name/alias` | `file-item.ts:12-50`；`metadata.ts:29-43` | 检视器名要取 `Inspector.meta.file.alias` |
| 编辑器页面判据是 URL 含 `/resources/app/dist/` | `probe-core.js:3286` | 试玩页不匹配，可用来区分两者 |
| AutoReload 只在 `Data.manifest.changes` 不含该 meta 时才重载 | `autoreload.ts:157-165` | 未失焦的输入不在 changes 里 -> 会被冲掉 |
| 事件编辑器选中项可读 | `autoreload.ts:216` `EventEditor.list.selected` | 后续可扩展"停在某条指令上" |
| `file-browser` 有两个实例，第一个是 `#project-browser` | `index.html`；`file-browser.ts:544` | `querySelector('file-browser')` 命中主浏览器，但**建议改用 `#project-browser`** |
| 场景画布对象**没有 DOM 节点**（WebGL 绘制） | 引擎 scene-draw | 第一版不演画布对象 |

---

## 7. 测试要求（`tests/test-ui-operation.cjs`）

**必须是行为断言。** 参考反面教材：现有"环境感知"那 4 条断言只是 `assert.ok(/function getEditorContext\(/.test(src))` 这种字符串存在性检查——它们全绿，但三个字段当时全是死的。

至少断言：

1. `uiSteps` 执行器：正常 3 步 -> 3 次 ring + 3 次执行，顺序正确。
2. 第 2 步目标解析失败 -> `{ok:false, failedAt:1}`，且**第 3 步没有被执行**。
3. `cancel()` 在步骤之间生效：取消后剩余步骤不执行。
4. 合并规则：同 `mergeGroup` 的 3 步合并为一步演出，落点数 3。
5. 时间轴：单动作耗时在 1.0s ±5% 内，批量 3 处 <= 1.4s（用注入的假时钟或放宽到实测区间）。
6. `pendingInput` 为真时，写盘工具被拦（端到端跑一次 ai-host）。
7. `pageContext` 注入：面板在"试玩页"身份下提问，注入的 system 必须写"试玩运行中"。
8. 双实例：模拟 5967 被占用，`whoami` 工程不匹配时宿主拒绝操作并给出人话提示。
9. 焦点保护：动作前后 `document.activeElement` 与未提交输入值不变。
10. 目标消失（把元素从 DOM 摘掉）-> 收框 + 如实失败，不许静默继续。

---

## 8. 交付前自查（必须贴真实输出）

```powershell
node build.cjs                                  # 必须全绿
node build.cjs --deploy                         # 必须 MD5 逐文件一致
$env:YAMI_TEST_PROJECT='D:\new-game'; node tests/run-all.cjs   # 必须 >= 25/28 且新套件全绿
node tests/test-ui-operation.cjs                # 新套件全绿
```

**不要**设置 `YAMI_TSC_JS` 跑全量（会改变 `test-compiler-lookup` 的既有结果）。

---

## 9. 已知陷阱（都踩过）

1. 改完发布文件只跑门禁不跑 `--deploy` -> 生产目录是旧代码，"我改了啊"。
2. 新增套件忘了加进 `run-all.cjs` 的 `SUITE` 数组 -> 套件永远不跑。
3. 新增套件/铁律忘了同步 README 里的数字 -> 文档一致性门禁红。
4. 往编辑器列表行里插 DOM -> 抢走 pointer 事件、还会被列表重建冲掉。浮层必须独立、`pointer-events: none`。
5. 用 `transform: scale` 做收束 -> 边框粗细跟着缩放，很丑；用 `outline-offset`。
6. 用 `top/left/width/height` 做动画 -> 每帧重排，编辑器掉帧（而我们是性能插件）。
7. 直接改 `hud-overlay.js` 里的样式 -> 下次 build 被 `src/style.css` 覆盖。
8. 只写"字符串存在性"断言 -> 全绿但功能是死的。
9. Windows 临时目录 `rmSync` EPERM -> 测试假失败，要带重试。
10. 向模型提示里写绝对路径 -> MCP 只认工程内相对路径，模型读不到（已修，别改回去）。
