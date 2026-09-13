# DanJuan妙妙插件 · AI 界面操作交付 验收结论

**验收人**：验收 AI（独立复核，非交付方）
**验收对象**：`docs/AI界面操作-交付与验收报告.md`
**验收基线**：工作区未提交改动（HEAD `cd001ac`，分支 `extension`）
**验收日期**：本轮会话
**对照标准**：`docs/AI界面操作-方案与验收清单.md` 第 6 节 23 项 + `docs/AI界面操作-施工单.md`

---

## 复验结论（返工完成后 · 以此节为准）

首轮验收提出的 **6 处不通过 + 5 处部分成立 + 测试方法论问题**，已全部返工并复验通过。下文 §0 - §9 是**首轮验收时的原始记录**，保留作为问题档案；当前状态以本节为准。

| 首轮问题 | 修法 | 复验凭据 |
| :--- | :--- | :--- |
| P0-B `getEditorContext()` 必抛 ReferenceError | `pageHref` / `isEditorHostPage` 提到模块作用域 | 断言「getEditorContext() 可执行（作用域回归守卫）」+「GET /context 返回 ok」；两条修复前必红 |
| P0-A AI 调不到 `uiSteps` | `server.js` 注册 `ui_steps` 工具 + 系统提示词补 7 条界面演示/对齐规则 | 断言「模型请求体里带上了 ui_steps」——**直接抓模型实际收到的请求体**，不是读源码 |
| P0-C 急停被吞 | 删掉 `ringTo` 入口的 `cancelled = false`，改为整轮开始 `resetCancel()`；`cancel` 进 5967 白名单 | 断言「急停落在 wait 步骤之间仍被尊重」+「cancel 动作在白名单内」 |
| P0-D 对齐卡无触发通道 | 提示词定义 `<alignment-card>` 协议；正文里的机器可读 JSON 自动剥离后再上屏 | 断言「系统提示词里定义了对齐卡协议」；面板侧解析与渲染已有 |
| P1-E 绿档无撤销入口 | 新增 `/ui-undo` 宿主路由 + 界面演示卡片后的「撤销这一步」按钮 | `build.cjs` 新增 `yami-ai-step-undo` 锚点守卫 |
| 验收项 12/13/14 全灭 | 随 P0-B 一并复活；并把 `ui_steps` 一并纳入「未失焦输入」前置拦截 | `hasPendingInput` 三条断言；上下文行数据源恢复可执行 |
| 验收项 9/10 凭据无效 | 夹具解析跨平台化（新增 `tests/resolve-project.cjs`），该套件从「跑不起来」变为 **39/39 全绿** | 见下表 |
| 验收项 22 run-all 不达标 | 同上，取代硬编码的 `/home/deck/yami-fixture` | **29/29 套通过**（首轮 22/29） |
| 测试自带一份实现 | 全量重写为三条真通道：真 5967 请求处理器 + 真令牌 / 真 JSON-RPC / 真宿主截获模型请求体 | **44/44 PASS**，无一条断言绕过产品代码 |

**全量门禁复验**

| 项 | 首轮 | 复验 |
| :--- | :--- | :--- |
| `node build.cjs` | 50 项锚点 | **51 项锚点**全绿（新增撤销入口 / `ui_steps` 接线 / 急停白名单 / 对齐卡协议四道守卫） |
| `node tests/run-all.cjs` | 22/29 | **29/29** |
| `tests/test-ui-operation.cjs` | 24/24，其中 18 条未碰产品代码 | **44/44，全部真通道** |
| 生产镜像 | 一致 | `node build.cjs --deploy` 后 10 个文件 + runtime 递归**逐文件 MD5 一致** |

**仍未验证的（如实声明）**：改属性后真机 Ctrl+Z 的体感、黄档审批在真实面板上的手感、边框收束动画的实际观感 —— 这些需要人坐在编辑器前点，不属于自动化可覆盖范围。

**口径更正**：交付报告 `docs/AI界面操作-交付与验收报告.md` 中的「23 项 100% 履约」「run-all >= 25/28 通过」「test-mcp-approval-diff 全绿」三处当时均不成立，该文档已加更正指引；其余结论（含演出引擎、撤销闭环、试玩视野修复）经复验成立。

---

## 0. 一句话结论（首轮验收时的状态）

**演出引擎本身是真货，我实测跑通了；但这套东西目前 AI 根本调不到，而且它依赖的上下文函数每次调用都抛异常——所以「AI 在界面上一步一步操作」这件事还没成立。**

23 项清单我的判定是：**明确通过 12 项 / 明确不通过 6 项 / 部分成立 5 项**，不是报告里的 23/23。

---

## 1. 我是怎么验的（可复现）

不采信断言文本，只采信**真实执行**。我另起了一套对抗台，直接加载工作区里真实的 `probe-core.js`，用真实的 `http.createServer` 拿到 5967 的**真请求处理器**，先 `GET /token` 取真令牌，再 `POST /action`，全链路无桩：

- 环境：`vm.runInNewContext` + 自建 DOM（可控 `getBoundingClientRect`、真实 `focus/blur/click` 计数）
- 通道：5967 真实 handler + 真实 `x-yami-bridge-token`
- 引擎事实：从 `dist/assets/index.js.map` 的 `sourcesContent` 读引擎原始 TS；从 `dist-electron/main.js` 读主进程
- 回归基线：`git worktree add --detach HEAD` 起一份纯净 `cd001ac`，逐套件对比（验收完已 `git worktree remove` 清理）

---

## 2. 真交付了、且我实测通过的部分

| 能力 | 我的验证方式 | 结果 |
| :--- | :--- | :--- |
| 收束高亮浮层 | 跑真实 `uiSteps`，检查 `#yami-ai-ring` DOM | 真实创建、真实定位 `translate(200px, 100px)`，尺寸 `150x32` 与目标 rect 一致；跑完自动 `display:none` |
| 零重排 | 读 `src/style.css:4425-4502` | 只动 `outline-offset` / `transform` / `opacity`，加 `will-change`；确有 `@keyframes yami-ai-ring-in { from{outline-offset:28px} to{outline-offset:0} }` |
| 穿透不挡手 | 同上 CSS | 容器 `pointer-events:none`，`.`**`-skip` 单独 `pointer-events:auto`** —— 「别演了」按钮是可点的，这点做对了 |
| `uiSteps` 执行器 | 真实三步 focus/set/click | `ok:true`，三步按序真实执行，DOM 真值变更（value=50、click=1） |
| 撤销栈闭环 | 同上，查事件序列 | `focus,input,change,blur` 全出现，`blur` 确实调了 —— 能进 `UndoManager` 的路子是对的 |
| 失败熔断 | 第 2 步给不存在的选择器 | `{ok:false, failedAt:1, done:[第1步]}`，**第 3 步绝对没执行**（监听器未被触发、目标值未变） |
| 批量合并 | 同 `mergeGroup` 三步 vs 不合并三步，**实测耗时** | 合并 **1032ms** / 不合并 **2317ms**，目标 ≤1400ms 达成 |
| 焦点保护 | 用户先在别的框打字并聚焦 | 操作后 `activeElement` 与未提交内容无损 |
| `/whoami` 双实例 | 真实 GET | 返回真实工程根（引擎 `file-system-core.ts:17,39` 确有 `File.root: string`，写法没错） |
| 试玩视野覆盖 | 读主进程 + 读宿主注入顺序 | **这条是真修好了**，见下方 §3.1 |

一句话：**施工单里 P1（演出引擎）这块是真干出来的**，代码质量比我预期的好。

---

## 3. 真修好的那个老毛病

### 3.1 试玩窗口身份错报 —— 确认修复

我上次报的「换了写法仍恒假」，这次是真解决了，证据链完整：

1. 主进程 `dist-electron/main.js` 里试玩窗口走 `s.loadFile(\`\${t}index.html\`)`，`t = File.root` —— 载入的是**用户工程自己的 index.html**，不含 `/resources/app/dist/`；
2. 所以试玩窗口里 `isEditorHostPage` 为假、`ai-agent.js` 的 `isPagePlaytest` 为真；
3. `manifest.json` 是 `<all_urls>` + `all_frames`，`hud-overlay.js` 没有任何宿主页屏蔽逻辑 —— 面板**确实存在于试玩窗口**；
4. 宿主侧 `ai-host.js:1487-1490`：

   ```js
   let envSummary = (events && events.envSummary) || ''
   if (!envSummary) { try { envSummary = await fetchEditorContextSummary() } catch {} }
   ```

   **直发的一手快照优先，5967 只做兜底** —— 顺序是对的，不再被编辑器串味。

决策 #9「谁提问就用谁的视野」这条，交付到位。

---

## 4. 不算交付的部分

### P0-A（致命）AI 根本调不到 `uiSteps`

**这是最要命的一条：演出引擎是一段没人能触发的死代码。**

我把所有可能入口都排除了：

| 排查点 | 事实 |
| :--- | :--- |
| `runtime/yami-mcp/server.js` | 39 条工具注册里**没有任何 uiSteps / ui_steps 工具**（`get_editor_context` 在 889 行，动作类只有 `editor_action`(771) 和 `interact_editor`(781)） |
| `editor_action` 的 schema | `enum: ['save','undo','redo','refresh','playtest']` —— 没有 uiSteps |
| `editor_action` 的实现 | `if (!expressions[args.action]) return { ok:false, error: '不支持的编辑器动作: ...' }` —— 就算硬传也会被拒 |
| 工具从哪来 | `ai-host.js:22` `MCP_PATH = runtime/yami-mcp/server.js`，`spawn` 它；`modelTools()` 原样透传、**不做任何增补或过滤** |
| `editorBridge.uiSteps()` | 新增了方法，但**全仓库零调用点** |
| 系统提示词 | 全仓库 grep `演出|边框|一步一步|演示|界面操作|高亮` 在 `ai-host.js` 里**零匹配** |

结论：模型既没有工具、也没有被告知这件事存在。**「AI 在界面上一步一步操作」目前只能靠人工 curl 带令牌调 `/action` 触发。**

（我没敢直接写「加个工具就行」——注意还有个坑：现有 `action()` 拿 `process.env.YAMI_PROJECT_ROOT` 或第三参做 `whoami` 比对，接工具时必须把当前工程根正确传下去，否则每次调用都会被自己的防串工程逻辑拒掉。）

### P0-B（致命，且是**历史遗留**）`getEditorContext()` 调用即抛异常

```
ReferenceError: isEditorHostPage is not defined
    at getEditorContext (probe-core.js:1957)
```

**根因（作用域）**：`const isEditorHostPage` 声明在 `try { if (typeof require === 'function') { ... } }` 这个块里（现 `probe-core.js:3519`，HEAD 版本 `:3286`），而 `getScope()`(`:1920`) 与 `getEditorContext()`(`:1957`) 在模块作用域引用它 —— 块级 `const` 在词法上就不可见，**跟运行环境无关，必然抛**。

我在纯净 `cd001ac` worktree 上跑了同一个调用：

| 版本 | `getEditorContext()` |
| :--- | :--- |
| 当前工作区 | `ReferenceError: isEditorHostPage is not defined` |
| HEAD `cd001ac`（未改动） | `ReferenceError: isEditorHostPage is not defined` |

**所以这是 V1.5.3「环境感知」自己带进来的老 bug，本次交付没有引入、但也没有发现，反而在它上面盖了三层新功能。** 连锁后果（全部实测/推导成立）：

- 5967 `/context` 处理器里同步抛错 → 请求永远没有响应，客户端超时；
- `ai-host` 的 `fetchEditorContextSummary()` **恒为空**；
- 新增的**写盘前置守卫恒不触发**（`getContext()` 拿不到 `ok`，异常被 `catch {}` 吞掉）→ **验收项 14 是死的**；
- `window.__YAMI_CTX_SUMMARY__()` 抛错 → `updateScopeBar` 进 catch → **常显上下文行永远显示「未检测到活跃场景或工作区」** → **验收项 12、13 是死的**；
- 新增的 `scope` / `page` 字段一并失效。

**最小复现（一行）**：在你们自己的 `tests/test-ui-operation.cjs` 的 `createProbeSandbox` 后面加
`assert.doesNotThrow(() => probe.getEditorContext())` —— 立刻变红。你们现有 4 条「环境感知」断言全是 `assert.ok(/正则/.test(源码))`，函数从来没被执行过，所以一直是绿的。

**修法**：把 `href` 与 `isEditorHostPage` 从那个 `try` 块里提到模块作用域（一行改动），再重跑。

### P0-C 急停会在常见情况下被吞掉

两个独立缺陷叠在一起：

1. **`ringTo()` 入口无条件 `cancelled = false`** —— 刷新了打断标记。于是只有「打断恰好落在 340/420ms 高亮停留期内」才会被发现；落在 `wait` 步骤、或步骤间隙，就被下一次 `ringTo` 清掉，AI 继续干到底。

   我实测两种落点：

   | 打断落点 | 结果 |
   | :--- | :--- |
   | 高亮停留期内 | `{ok:false, error:'打断'}`，后续步骤未执行 —— **通过** |
   | `wait 500ms` 步骤期间 | `{ok:true, steps:3, done:[三步全绿]}`，第 3 步照做（`d3.value === 'C'`）—— **被打断却跑完了** |

2. **`/ui-cancel` 是死路**：`ai-host.js:1880` 转发 `action('cancel')`，但 5967 的白名单里**没有 `cancel`**，实测返回
   `400 {"ok":false,"error":"未知编辑器动作，仅允许 save、undo、redo、refresh、playtest、dumpUi、click、interact、context、uiSteps"}`
   —— 注意它把 `uiSteps` 加进去了，却漏了 `cancel`。面板按 Esc 时之所以还能停，靠的是 `stopStream()` 里直接调同页的 `probe.ui.cancel()`，HTTP 那条路是断的。

这两条合起来：**决策 #6「随时可打断」目前只做到了「运气好时可打断」。**

### P0-D 意图对齐卡永远弹不出来

`renderAlignmentCard` 写得很完整（div role=button、tabindex、选中态、开工按钮），但**没有任何触发通道**：

- SSE `align` 事件：`ai-agent.js:986` 监听它，但 `ai-host.js` 里 grep `align` 只有 2 处 —— 一处是 `messagePairs.alignStartIndex`（消息裁剪，无关），一处是 `pageContext`。**宿主从不发这个事件**；
- `<alignment-card>` 正文标签：`ai-agent.js:1016` 会解析它，但系统提示词里**一个字都没提**，模型不可能凭空吐这个标签。

→ **验收项 19 是死的，决策 #7「开工前对齐卡」未交付。**

### P1-E 绿档「撤销这一步」不存在

全仓库 grep `撤销这一步`，只在我的两份文档里出现，产品代码 **0 处**。现有 `#yami-ai-undo` 面板是**旧的「撤销文件改动」备份面板**（点撤销调 `/backup-undo`，见 `ai-agent.js:522`），跟「刚演的那一步操作，撤销它」不是一回事。→ 决策 #3 的绿档撤销入口未交付。

---

## 5. 测试套件质量问题（本次最该返工的地方）

`tests/test-ui-operation.cjs` 24 条断言里，**18 条根本没碰产品代码**——测试自己把功能实现了一遍，然后断言自己那份实现是对的：

| 断言 | 实情 |
| :--- | :--- |
| 1 | **先把 `probe.ui.ringTo` 覆盖成自己的桩**（`line 218`），再在测试里写一个 for 循环当「执行器」——真正的 `uiSteps` 执行器一次都没被调用 |
| 2 / 3 / 10 | 同样是测试内联的 for 循环和 if 分支 |
| 4 / 5 | 纯算术：`240+340+420 === 1000`、`1240 <= 1400`——断言的是作者刚敲进去的常量等于作者刚敲进去的常量 |
| 7 | 手工拼一个 `systemMessage` 字符串字面量，再断言它 `includes('试玩运行中')`——**恒真**，`ai-host.js` 从未被 require |
| 9 | 在 Mock 元素上自测自建流程 |

真正碰到产品代码的只有断言 6（真调 `probe.hasPendingInput()`）和断言 8（真调 `EditorBridge.action` 签名）。**报告第 3 节 23 项核销表把这些当成「实测凭据」引用，这是站不住的。**

对照我自己的对抗台（同一份源码、走真 HTTP 通道）：我立刻拿到了他们漏掉的东西 —— 急停被吞的复现（`ok:true` 且第 3 步照做）、以及 `ReferenceError`。「测试自带一份实现」这种写法，正是上一轮那 4 条字符串断言踩过的同一个坑。

**建议**：断言 1/2/3/4/5/7/9/10 全部重写为「只调产品入口，不复制逻辑」——走 5967 真实 handler + 真令牌，像验收台那样打 `POST /action`。

---

## 6. 门禁与数字核对

| 报告里的说法 | 我的实测 | 判定 |
| :--- | :--- | :--- |
| `node build.cjs` 50 项核心锚点全绿 | `全部 50 项核心锚点 + 0 Emoji + 术语合规校验全绿` | 属实 |
| `run-all.cjs` >= 25/28 通过 | **22/29 套通过** | **报告不实**（详见下） |
| 生产镜像 10 文件 + 15 runtime 逐文件一致 | 7 个发布文件 **7/7** + runtime **15/15** MD5 全一致 | 属实（数字口径不同，结论一致） |
| 铁律 43 条 / 测试 29 套 / README 同步 | 门禁自检输出与 README 一致 | 属实 |
| 「`test-mcp-approval-diff.cjs`（全绿）」作为验收项 9、10 的凭据 | 该套件在本机 **exit 2 直接中止**：`找不到夹具工程: /home/deck/yami-fixture` | **凭据无效** |
| 「`src/style.css:2624` 声明 pointer-events」 | 2624 行是 `.yami-cheat-btn:hover`；真正的块在 **4425-4502** | 引用行号错误 |

**关于 22/29 是不是回归 —— 不是。** 我用 `git worktree` 起了一份纯净 `cd001ac` 逐套件对比：

| 套件 | 纯净 HEAD | 交付后 |
| :--- | :--- | :--- |
| test-ai-session.cjs | 14 PASS / 15 FAIL | 14 PASS / 15 FAIL（逐字一致） |
| test-thinking-mode.cjs | 同一处 `TypeError ... reading 'thinking'` | 同上 |
| test-mcp-approval-diff / test-parallel-tools / test-acceptance / test-ai-repair / test-mcp-ai-tools | `找不到夹具工程: /home/deck/yami-fixture` exit 2 | 同上 |

7 条全是**既有环境性失败**（缺夹具工程、旧有异常），本次交付**没有引入回归**。但报告把「>= 25/28」写成已通过，且拿一个根本跑不起来的套件当绿灯凭据，这两点必须纠正。

---

## 7. 23 项清单逐条判定

| 编号 | 判定 | 说明 |
| :--- | :--- | :--- |
| 1 边框贴合 ≤1px | 通过 | 实测坐标/尺寸与目标 rect 一致 |
| 2 单动作 ≤1.05s | 通过 | 实测 760ms（340+420）；240ms 收束是 CSS 并发动画，不额外占时 |
| 3 批量 ≤1.4s、落点 ≤5 | 通过 | 实测合并 1032ms |
| 4 浮层穿透 | 通过 | 容器 none + skip 按钮 auto |
| 5 零重排 | 通过 | 只动 outline-offset / transform |
| 6 目标消失如实停下 | 通过 | 实测 failedAt 精确熔断 |
| 7 改属性可撤销 | 通过 | focus→改→change→blur 闭环成立 |
| 8 绿档撤销入口 | **不通过** | 「撤销这一步」不存在 |
| 9 黄档停审批卡 | 部分 | 机制为旧有实现、本次未改；所引套件未运行，无有效凭据 |
| 10 红档打字确认+备份 | 部分 | 同上 |
| 11 `cdp_eval` 默认不可达 | 部分 | 工具仍在标准表里且 `modelTools` 不过滤；实际依赖编辑器是否开 9222 调试端口，本次未改未验 |
| 12 上下文行反映当前页 | **不通过** | ReferenceError，恒显示「未检测到活跃场景或工作区」 |
| 13 检视器名/类型/试玩态真实 | **不通过** | 字段写法已修正，但函数抛错，取不到值 |
| 14 未失焦禁止写盘 | **不通过** | 守卫依赖 /context，异常被吞，永不触发 |
| 15 双实例防串工程 | 通过 | /whoami 返回真实 File.root，比对逻辑成立（依赖 YAMI_PROJECT_ROOT 存在） |
| 16 焦点与输入不丢 | 通过 | 实测无损（会额外补一次原焦点 focus，属预期） |
| 17 急停停在动作之间 | 部分 | 高亮停留期内有效；落在 wait/间隙被吞；/ui-cancel 路由 400 |
| 18 目标找不到熔断 | 通过 | 实测第 3 步未执行 |
| 19 需求模糊出对齐卡 | **不通过** | 无触发通道（宿主不发 align，提示词不提标签） |
| 20 答不出反问 | 部分 | 依赖上下文行，实际恒空，撑不起来 |
| 21 build 全绿 | 通过 | 50 项 |
| 22 run-all >= 25/28 | **不通过** | 实测 22/29（无回归，属既有环境性失败） |
| 23 镜像逐文件一致 | 通过 | 7/7 + 15/15 |

**合计：通过 12 / 不通过 6 / 部分成立 5。**

---

## 8. 建议返工顺序

1. **P0-B 一行修**：`isEditorHostPage` 提到模块作用域；同时给 `test-ui-operation.cjs` 加一条 `assert.doesNotThrow(() => probe.getEditorContext())`，防回归。**这条不修，12/13/14 三项永远是死的。**
2. **P0-A 接通工具**：`server.js` 增 `ui_steps` 工具 → `editorBridge.uiSteps(steps)`（30s 超时已就位）；系统提示词补一段「在界面上演示」的用法与 `uiSteps` 协议；注意把当前工程根正确传给 `action()` 以免被 whoami 自锁。
3. **P0-C 急停**：`ringTo` 里删掉 `cancelled = false`，改成一次运行开始时 `resetCancel()`；把 `cancel` 加进 5967 白名单。
4. **P0-D 对齐卡**：要么宿主发 `align` 事件，要么在提示词里定义 `<alignment-card>` 协议（二选一，别两头都留着当摆设）。
5. **P1-E**：绿档动作完成后在面板给「撤销这一步」，接 `/action undo`。
6. **测试重写**：`test-ui-operation.cjs` 的 8 条自测型断言改为打真实通道。
7. 修完再更新交付报告——**按实测数字写**，跑不起来的套件不要写成绿灯。

---

## 9. 验收工作自身的边界（如实声明）

- 全部结论来自静态阅读 + 沙盒内真实执行 + 引擎源码/主进程源码比对；**未启动 Open Yami**，未做真机点选。
- 因此「改属性后 Ctrl+Z 真能撤回」我是按代码路径判定为通过（focus/change/blur 序列实测成立），**未在真编辑器里按过 Ctrl+Z**；
- 「黄档/红档审批」属旧有机制，本次未独立复验；
- 我创建的文件：本结论文档。仓库代码我一行未改，未做任何 git 提交/推送；验收期间建的 `git worktree` 已 `remove` 清理。
