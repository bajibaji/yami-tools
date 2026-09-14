# 现状清单 · 面板交互（t2）

> 范围：`ai-agent.js`（2981 行）、`ai-render-core.js`（322 行）、`hud-overlay.js` 中与 AI 面板相关的部分（CSS + 底栏花费 + 子视图调度），以及面板调用的 `probe-core.js` 高亮演出层。
> 规矩：每条断言都指到 文件:行号。指不到的写「未能确证」。只读审计，未改动任何被审计文件。
> 阅读方式：先看 §0 状态机总览，再看你关心的那一节。

---

## 0. 状态机总览（面板侧真源）

面板只有一个全局可变状态对象：

- ai-agent.js:48-66 — state = { token, child, sessionId, busy, pending, deciding, mounted, balance, abort, thinkingView, processFold, busySend, queue, queueSeq }。
  - busy：是否有一轮在跑（setBusy，ai-agent.js:1040-1050）。
  - pending：待确认的审批对象（renderApproval，ai-agent.js:1097；清空点见 §5）。
  - deciding：审批正在提交的防连点闸门，与 busy 刻意分开（注释 ai-agent.js:54、ai-agent.js:2398-2402）。
  - abort：本轮的 AbortController（streamTurn，ai-agent.js:1180）。
  - busySend：繁忙时发送的行为（queue 默认 / interrupt），ai-agent.js:1501-1516。
  - queue：繁忙时打的话排队区（内存数组），ai-agent.js:2020-2025。

三条独立的进入路径，都汇到同一个事件流渲染器 streamTurn：

| 路径 | 入口 | 事件流路由 |
| --- | --- | --- |
| 正常一轮 | sendMessage → runMessage → streamChat（ai-agent.js:2328 / 2356 / 1138） | /chat/stream（ai-agent.js:1152） |
| 批准后续跑 | decide(true)（ai-agent.js:2428） | /approve/stream |
| 拒绝后续跑 | decide(false)（ai-agent.js:2428） | /reject/stream |

回合生命周期：prepareTurn（ai-agent.js:391-398）→ 流式装配 → finishTurn（ai-agent.js:401-408）→ flushQueue（仅在 runMessage 的 finally，ai-agent.js:2389-2394）。

---

## 1. 输入与发送

- 输入框只有 textarea#yami-ai-input（ai-agent.js:2812-2817），自动长高 52–140px（ai-agent.js:2956-2959；CSS hud-overlay.js:4032-4045）。
- 快捷键只有两处：
  - Enter 发送 / Shift+Enter 换行；输入法合成期直接放行（event.isComposing || keyCode === 229，ai-agent.js:2949-2955）。
  - Ctrl/Cmd+Enter = 引导，仅 busy 时生效（ai-agent.js:2953-2954）。
  - Esc 是文档级监听，只在「面板打开 + 停在 AI 页」时接管（ai-agent.js:2925-2947）。
- 一颗按钮兼任发送与停止：setBusy 里切 class stop 与文案「停止/发送」（ai-agent.js:1040-1050），点击分派在 ai-agent.js:2850（state.busy ? stopStream() : sendMessage()）。
- 空文本发送只是把焦点还给输入框（ai-agent.js:2350），不报错。
- 未实现（grep 已核，无对应实现）：草稿持久化 / 重载恢复、历史发送记录（↑↓ 取回）、图片粘贴或拖入、斜杠命令、@ 文件引用、附件。证据：全文件事件绑定只有 ai-agent.js:208-363、1210、2145-2149、2293-2317、2871-2963 这些出处，没有任何 paste / drop / 草稿写入。sessionId 会写 localStorage（ai-agent.js:51、67），输入框内容不会。

---

## 2. 一轮回合的装配（回合分组）

- 一轮 = 一个 .yami-ai-turn 容器（beginTurn，ai-agent.js:368-377），容器下两块：过程区 .yami-ai-process + 正文槽 .yami-ai-turn-body（processArea ai-agent.js:411-450；messageSlot ai-agent.js:478-487）。
- 【顺序不变量】过程区永远插在正文槽之前，即使正文先出现（ai-agent.js:443-447）。
- 过程区头部摘要 = 思考秒数 + 段数 + 步数，口径走渲染核心纯函数 processFoldTitle（ai-agent.js:453-475 ↔ ai-render-core.js:189-200）。
- 工具卡片算过程区一步：pushToolCard 里 area.steps++（ai-agent.js:1872）；引导条也算一步（ai-agent.js:2001）。面板自己的提示行刻意不算步（注释与实现 ai-agent.js:502-521）。
- 轮次结束后的两件事：紧凑模式自动收起过程区（applyTurnFold ai-agent.js:1735-1757，判据在 ai-render-core.js:209-217），以及每轮用量行（renderTurnUsage ai-agent.js:1760-1774）。
- 思考分段：状态机 createThinkingSegments（ai-render-core.js:161-182，面板缺核心时有等价内联兜底 ai-agent.js:108-121）；封段时机 = 工具调用（ai-agent.js:1312）、正文开始（ai-agent.js:1301）、回合结束（ai-agent.js:1704-1706）。
- 关键顺序规则（直接影响「过程在上、答案在下」的观感）：正文已输出后再来思考或工具调用，就把当前回合的过程区/正文槽指针置空，新内容另起一组（思考 ai-agent.js:1276-1284、工具 ai-agent.js:1317-1324）。processArea() 每次都新建、**不**复用旧过程块（只在 currentTurn.process 非空时复用，ai-agent.js:412-413），所以一轮里可以出现多段过程区。
- 轮次导航轨道 .yami-ai-rail：一个回合一个刻度，滚动高亮取「阅读线 = scrollTop + h/3」（buildRail ai-agent.js:2088-2151 ↔ activeTurnIndex ai-render-core.js:293-303）；悬停预览现算，截 50 字（ai-agent.js:2114-2117）；轨道只有 ≥2 轮才显示（ai-agent.js:2125）。历史回放没有 turn 容器时退回按用户消息分轮（ai-agent.js:2099-2103）。

---

## 3. 繁忙时：排队 / 引导 / 打断

判定与分流全在 sendMessage（ai-agent.js:2328-2353）：

1. state.busy 为真：
   - mode === 'steer'（Ctrl+Enter）→ sendSteer（ai-agent.js:2337）；
   - 设置项 busySendMode() === 'interrupt' → interruptThenSend（ai-agent.js:2338）；
   - 否则 enqueueMessage 排队 + toast（ai-agent.js:2339-2340）。
2. state.pending 为真（有未确认的修改）：直接发新消息 = 放弃那项修改，收卡片，把工具卡打成「已取消，工程未改动 · 你直接发了新需求」（ai-agent.js:2345-2349；卡片收尾 resolvePendingCard ai-agent.js:1974-1990）。

三条支路的实现细节：

- 排队 enqueueMessage / renderQueueDock / dropQueued（ai-agent.js:2020-2057）：#yami-ai-queue 插在 .yami-ai-compose 之前（buildComposeExtras ai-agent.js:2070-2082）；每条一行、可单条撤回（ai-agent.js:2053）；头部文案「排队中 N 条（本轮结束后依次发出）」（ai-agent.js:2041）。
- 接力 flushQueue（ai-agent.js:2060-2067）：一轮结束只发**一条**，剩余等下一轮结束；直接 runMessage，刻意不碰用户正在敲的草稿（注释 ai-agent.js:2065）。
  - 调用点只有 runMessage 的 finally（ai-agent.js:2393）。decide() 的 finally（ai-agent.js:2450-2454）不调用，loadSession / startNewSession 也不调用。事实：审批续跑那一轮结束后，排队区不会自动接力，要等下一次 runMessage 结束。这是行为边界、不是崩溃（仅代码路径判读，未在真实运行中复现）。
- 打断再发 interruptThenSend（ai-agent.js:2162-2167）：stopStream() → 最多轮询 50×100ms 等 state.busy 落 → runMessage(text)。等不到（5 秒）也照发。

---

## 4. 引导（steer）的送达与未送达

- 发送：sendSteer（ai-agent.js:2170-2184）POST /steer。
  - 宿主回 busy:true → 画引导条 pushSteerChip（ai-agent.js:1993-2004，文案「引导（将在下一步送到模型）：…」，黄色 wait 态）+ toast「已交给模型，会在下一个步骤边界读到」。
  - 宿主已空闲 → 如实降级进排队区 + toast「这一轮刚好结束了，已放进排队区」（ai-agent.js:2178-2179）。
  - 请求异常 → 同样进排队区，toast 带出异常原文（ai-agent.js:2180-2183）。
- 送达回执：宿主发 {type:'steer', phase:'delivered', text} → markSteerDelivered（ai-agent.js:1350 → 2006-2017），把第一个文本包含该 text 的等待中引导条翻成 ok「引导已送达模型」。
  - 匹配方式是 el.textContent.indexOf(text) !== -1（ai-agent.js:2009），**没有对空 text 设防**：若宿主送的 text 为空串，''.indexOf 恒为 0，第一条等待中的引导条会被误判为已送达。宿主侧是否可能出现空 text 属 t3 范围，本清单只登记面板侧判据。
  - 只翻第一条（return true，ai-agent.js:2013）；两条相同文本的引导条会按顺序各翻一次。
  - 没有任何超时 / 未送达兜底：引导条一旦画成 wait，若宿主既不回执也不结束，它就永久停在「将在下一步送到模型」。面板侧唯一的善后是整轮结果里的 undeliveredSteer（见下一条）。
- 未送达：整轮结束时 finalResult.undeliveredSteer 逐条 enqueueMessage 进排队区 + toast 数量（ai-agent.js:1409-1413）；异常路径同样从 e.payload.undeliveredSteer 捞回来（ai-agent.js:2373-2378）。「绝不假装送达」这条原则在面板侧落实了。
- 引导条样式：.yami-ai-steer 黄边、.ok 绿边（hud-overlay.js:4573-4582；同一份也在 src/style.css:4498、4507）。wait 没有独立样式，仍是默认黄。

---

## 5. 审批卡（确认 / 取消修改）

- 结构在面板模板里：#yami-ai-approval（ai-agent.js:2798-2811），状态是 .show class（CSS hud-overlay.js:4428-4436）。**不是**遮挡式模态：DOM 里位于消息列表与输入区**之间**（ai-agent.js:2795-2812），随 .yami-perf-dock-body（overflow-y:auto，hud-overlay.js:925-934）整体滚动，没有焦点陷阱、没有 aria-modal（CSS 注释自称 “Approval Modal”，hud-overlay.js:4427）。
- 渲染：renderApproval（ai-agent.js:1096-1135）
  - 头部信息 = 目标 + 操作 + message（1106-1108）；diff 逐行着色（renderDiff 1078-1094；diff 区 max-height:34vh; overflow:auto，hud-overlay.js:4461-4469）；diff 统计 “+a / -b（已截断）”（1123-1127）。
  - 高危（risk === 'high'）→ danger 样式 + 按钮文案改「确认删除（会先备份）」，并**禁用**批量授权勾选（1109-1121）；删除类操作不给批量授权（1113）。
  - 删除类还会把 preview.impact 的名称/类型/字节/内容开头追加进详情（1128-1132）。
  - 状态栏切「等待确认」/「等待确认删除」（1134）。
- 决定：decide（ai-agent.js:2397-2454）
  - 闸门只有 state.pending 与 state.deciding，**刻意不看 state.busy**（注释 2398-2401：审批卡弹出时 busy 完全可能是 true，用 busy 挡会变成点了没反应的死按钮）。
  - 用户一做出选择就立刻收起卡片（2422），续跑进度改由事件流实时上屏；若这一轮还要再确认，renderApproval 会重新弹出（2430）。
  - 「本次任务内不再逐条确认」勾选写 localStorage danjuan-ai-grant（2415-2417），并按 grantForSession 随请求带上（2428-2429）。
  - Esc 取消修改在 ai-agent.js:2933-2940，但**要求 !state.busy && !state.deciding**（2936）——审批等待期间 busy 为真（见 §11.1），所以 Esc 常常不生效，只能点按钮。
  - 失败分三类：被打断（2436-2439 标记卡片「已取消，工程未改动 · 已打断」）；编辑器有未失焦输入（2440-2444 **保留**卡片 + toast 让用户先失焦）；其他错误（2445-2448 上屏 error 消息并标记「执行失败」）。
  - deciding 在 finally 复位并还原两颗按钮文案（2450-2454）；stopStream 里也主动复位一次，理由是「审批提交到一半被打断会让下一次点击被静默挡掉」（1067-1073）。
- 卡片与上次操作的对账：resolvePendingCard（ai-agent.js:1974-1990）用 document.querySelector('.yami-ai-tool-dot.wait') 找**第一张**等待中的工具卡，翻成 ok/bad 并补一行结论、强制展开。页面上同时存在多张等待卡时，只有第一张会被收尾。

---

## 6. 停止链路

- 入口：发送按钮在 busy 时变「停止」（ai-agent.js:2850）；Esc（ai-agent.js:2942-2946）无确认弹窗，立即打断。
- stopStream（ai-agent.js:1053-1075）依次做四件事：
  1. state.abort.abort() 断 SSE；
  2. window.__YAMI_PERF_PROBE__.ui.cancel('用户打断') 打断界面高亮演出（1056-1058；演出控制器在 probe-core.js:2595-2600，ringTo 会返回 {ok:false, cancelled:true}，probe-core.js:2585-2588）；
  3. request('/ui-cancel', {reason:'用户打断'}) 让宿主停模型请求与后续工具（1059）；
  4. 状态条「已打断」+ 提示行「已打断，AI 停下来了（已完成的改动都保留着）」（1060-1061）。
- 兜底解开界面：state.pending = null、隐藏审批卡、state.deciding = false、按钮文案还原、setBusy(false)（1065-1074）。注释明确写了「不能只等 runMessage 的 finally —— SSE 已经断掉时它可能永远回不来」（1062-1064）。
- **没有强杀进程的路径**：面板从不 state.child.kill()；state.child 只在 ensureHost spawn 时赋值（ai-agent.js:333-346，全文件仅此一处引用 state.child），stderr 只转发到 console（347）。
- 打断与审批的交叉：decide 的 catch 把 AbortError / 「已打断」映射成「已打断」并把卡片标记为取消（2436-2439）。

---

## 7. 提示与错误的呈现位置

四个不同去处，语义刻意分开：

| 类型 | 函数 / 出处 | 位置 |
| --- | --- | --- |
| 面板提示行（进度 / 授权 / 失败说明） | pushNotice ai-agent.js:508-521 | 成功类进过程区；mode==='bad' 或没有活跃回合时**留在过程区外面**（514），避免紧凑模式一收起把错藏了 |
| 模型回复 / 用户消息 | addMessage ai-agent.js:489-500 | assistant 进当前回合正文槽，其余直接进列表 |
| 轻提示 toast | hudToast ai-agent.js:1787-1799 | 复用或新建 #yami-perf-toast，2.2 秒自动消失 |
| 状态条 | setStatus ai-agent.js:1028-1038 | 顶栏 #yami-ai-status，四档色调 ready/working/waiting/error（CSS hud-overlay.js:3488-3537） |

- 上游错误分流：只有命中配置类关键词（API.?Key|密钥|端点|endpoint|模型不存在|余额）才追加「请到设置里检查后重试。」，其余只上屏原文 + 句号（ai-agent.js:2381-2387）。
- 静默期读数：流事件 5 秒没有新事件才在状态文案后追加「（已等待 N 秒）」，只报等待时长、不猜「卡住了」（ai-agent.js:1199-1208；清理 clearIdleTicker ai-agent.js:382-384）。
- 流断且没有 result → 抛「连接在跑完之前断了（AI 宿主可能已退出），这一步的结果无法确认」（ai-agent.js:1380-1382），宁可报错也不假装跑完。
- 结果状态分派：stuck → bad 提示 + 一键破局按钮（1397-1400；offerStuckBreakerActions 1419-1462，两个动作都直接 runMessage / startNewSession，无二次确认）；compile-failed → bad 提示（1401）；step-limit → wait 提示 + 接续按钮（1402-1405；offerContinuePrompt 1465-1484，点击即 runMessage('继续')）。
- 工具卡片的提示只来自冻结结果：状态点四种 run/ok/bad/wait（CSS hud-overlay.js:4499-4508）；失败详情直接展开（ai-agent.js:1911-1918）；截断另行标注并给「打开落盘目录」（1898-1909 ↔ ai-render-core.js:280-287；卡片小标签只认结构化字段，ai-render-core.js:259-274）。
- 可访问性现状（已核）：role="log" aria-live="polite" 挂在消息列表（ai-agent.js:2795），流式期间一帧一次 DOM 写入（ai-agent.js:1295、1307），屏幕阅读器会被持续打断；role="alert" 挂在审批卡（2798）但没有 aria-modal / aria-labelledby；折叠类控件（思考块 1616-1619、工具卡 1851-1852、过程区 419-420、系统提示词行 1942-1943）都没有 aria-expanded；#yami-ai-send 的 aria-disabled 恒为 'false'（ai-agent.js:1045），忙闲只用文案与 class 表达。

---

## 8. 轮次用量、上下文刻度与花费

- 每轮用量行只在「记账完整」时出现：formatTurnUsage 要求 complete === true && calls > 0 && total > 0，否则整行不画（ai-render-core.js:231-245；面板 renderTurnUsage ai-agent.js:1760-1774）。文案「本轮 N 次调用 · X tokens · 约 Y 元」，title 里给输入 / 缓存命中 / 输出明细。
  - 调用点只有一处：ai-agent.js:1408，且在 finalResult.status !== 'approval' 分支内（1383）——**审批等待中的那些中间轮不画用量行**。
- 上下文刻度：renderContext（ai-agent.js:524-538）把 /status 的 context 压成「97.2k · 10%」这类紧凑串，nearLimit 加 .warn + 后缀「临界」、压缩过加「压缩」；title 里区分「按模型真实用量计」与「按官方换算估算」（535-537）。
  - 刷新时机只有 4 处：进入面板（2848）、普通一轮结束（2370）、审批续跑结束（2434）、切换历史会话（1006）；新会话清空（1022）。**流式期间不刷新**，所以刻度是「每轮一跳」，不是实时水位。
- 花费：底栏 #yami-ai-footer-cost（模板 hud-overlay.js:5571；只在 AI 页显示，由视图调度器切显隐 hud-overlay.js:5655-5659；样式 hud-overlay.js:1006-1035）。
  - 内容 = 余额 X 元 · 本次 Y 元；余额 60 秒缓存（refreshFooterCost ai-agent.js:2515-2553，缓存判据 2523-2531）。
  - 拿不到就清空、title 写「余额与用量暂不可用」（2549-2552），不报错刷屏。
  - 另一条 /pricing 单价行只画在设置面板里的 #yami-ai-money（refreshMoney ai-agent.js:2556-2568）。
  - 单轮花费同时出现在用量行（ai-render-core.js:242-243 的「约 X 元」/「估算花费 X 元」）。
- 花费 / 余额刷新时机：一轮结束（2371）、审批续跑结束（2435）、加载设置（2656）、查余额（2578）。

---

## 9. 历史会话与撤销

历史面板（renderHistory ai-agent.js:856-950；容器 #yami-ai-history 模板 2734）

- 只列「真的聊过」的会话（turns > 0 过滤，864）；空态文案 885-891。
- 每行：标题 / 更新时间 + 轮数 / 删除（892-936）；当前会话加 .current（894）。
- 删除是两段式：第一次点变「确定删除?」并在 3 秒后自动回退，第二次点才真删（911-932）；删的若是当前会话就顺手开新会话（930）。
- 切换会话 loadSession（952-1010）：busy 时直接 toast 拒绝（953-956，**没有排队、也没有「本轮结束再切」**）；加载会清空审批卡、复位 pending、清 dismissedUndoFiles、按核心的 historyWindow 只渲染最近 60 条并提示折叠了多少（967-970）；历史回放的思考块只报字数不编造秒数（972-983 ↔ replayThinkingMeta 1653-1655）；正文里的 <alignment-card> JSON 会被抠出来渲染成卡片、不再当正文摊给用户（987-996；实时路径同规则 1384-1395）。
- 打开历史时若宿主仍记着挂起的审批，会重新弹卡（1002），否则置「就绪」。

撤销面板（renderUndoList ai-agent.js:593-782；容器 #yami-ai-undo 模板 2733）

- 只列本次会话里 AI 改过的文件（599-601），并在列表上方列出「本次任务内免逐条确认」的授权，可单独取消（630-665）。
- 每个文件两种态：已修改 → 「撤销」按钮走 /backup-undo（758-772）；已恢复 → 只读「已在初始版本」+ 可选「重做修改」（701-736）+「移除」记录（738-750）。
- 移除记录是**面板内存里的 Set**（dismissedUndoFiles，ai-agent.js:88），刷新 / 换会话即清空（962、1016）——属「临时忽略」，不是持久设置。
- 子视图互斥由 setSubView 统一调度（ai-agent.js:558-590）：view-undo / view-history / view-settings 三种 class 挂在 #page-ai 上。

---

## 10. 在场感知（scope bar）

- 顶栏一条 #yami-ai-scope（模板 ai-agent.js:2729-2732），文案来自 window.__YAMI_CTX_SUMMARY__()，停留点徽标来自 probe.getPresence()（updateScopeBar ai-agent.js:2186-2208）。
- **1 秒一次轮询刷新**（挂载时 setInterval(updateScopeBar, 1000)，ai-agent.js:2969；理由写在 2968：2 秒会明显滞后于鼠标停过去的动作）；点击条本身也手动刷一次并 toast「环境已刷新」（2963-2966）。
- 徽标文案只有两态：「停留中」/「在场感知」（2207）。
- 发消息时把同一份上下文快照随请求带给宿主：pageContext = { page, summary, scope }（streamChat ai-agent.js:1138-1157）。
- 界面操作演出的打断链同上（§6）：面板在打断时调 ui.cancel，演出层在 probe-core.js:2595-2600；「别演了」按钮在 probe-core.js:2470-2479（skipped 一旦置位，后续 ringTo 直接返回 {ok:true, skipped:true}，probe-core.js:2548-2551）。

---

## 11. 面板侧已确证的缺口 / 可疑点（供差距分析使用）

按「影响面 × 可核实度」排；全部只描述代码事实，不含对宿主行为的推测。

1. **审批等待期间 Esc 取消常常不生效，且无法「发新消息作废审批」**
   - 事实 A：审批卡显示时 state.busy 仍为真（renderApproval 在 runMessage 的 try 内被调用，2368；setBusy(false) 在 finally 的 finishTurn 里，2392-2393），代码注释也如此认定（ai-agent.js:54、2398-2401）。
   - 事实 B：Esc 取消审批要求 !state.busy（2936）。
   - 事实 C：此期间发送 = 排队 / 打断 / 引导三选一（2333-2341），而 pending 分支（2345-2349）在 busy 分支**之后**，审批等待期永远走不到。
2. **队列接力只有一条触发路径**：flushQueue 仅由 runMessage 的 finally 调用（2393），decide 的 finally 没有（2450-2454）。审批续跑结束不会自动发下一条排队消息。
3. **引导条没有超时兜底**：markSteerDelivered 只由宿主回执驱动（1350），无定时器、无兜底文案；空 text 会误判第一条（2009）。
4. **每轮用量行在审批链路里缺失**：renderTurnUsage 在 status !== 'approval' 分支内（1383、1408）。
5. **上下文刻度非实时**：只有 4 个刷新点（1006、2370、2434、2848），流式期间不变。
6. **子视图隐藏选择器含失效 ID**：hud-overlay.js:4174-4175、4179-4180 与 src/style.css:4099-4100、4104-4105 指向 #yami-ai-quick-bar / #yami-ai-composer，而真实 DOM 是 .yami-ai-compose（无 id，ai-agent.js:2812）与 .yami-ai-devbar（2819）。全仓库 grep 只有 CSS 与测试引用过这两个 id（tests/test-subviews-floating.cjs:47-49 只断言选择器字符串存在，不校验它命中元素）。→ 进入历史 / 撤销子视图时输入区**并未**被 CSS 隐藏。
7. **等待中的工具卡只有第一张会被收尾**：resolvePendingCard 用 querySelector('.yami-ai-tool-dot.wait')（1975），多张等待卡时其余永远停在「等待你确认」。
8. **撤销 / 重做点击在 busy 时静默返回**：if (state.busy) return（723、759），按钮不置灰、无提示。
9. **面板不做子进程强杀**：state.child 只被赋值、不被 kill（333-346，全文件唯一引用）；停止靠 abort + /ui-cancel（1055-1059）。
10. **可访问性缺口**：见 §7 最后一条（aria-live 流式刷屏、折叠控件无 aria-expanded、aria-disabled 恒 false、审批卡无 aria-modal / aria-labelledby）。
11. **未确证存在的能力**（grep 已核，可能由宿主侧提供，故写「未确证」而非「确认没有」）：输入草稿持久化、消息编辑 / 重发、消息级复制 / 引用、图片粘贴、@ 文件引用、斜杠命令、历史发送记录。宿主侧是否有等价物属 t3 范围。

---

## 12. 核不到 / 需运行才能定的点（不猜）

- 宿主是否会在某些路径下发送空 text 的 steer delivered（决定 §11.3 是否是真 bug）：需读 ai-host.js 的 steer 投递处，属 t3。
- 审批等待期 busy 是否恒为真：本次只按 ai-agent.js 的控制流判读（setBusy(false) 只出现在 stopStream 与 finishTurn 内）。若宿主在发 result(status=approval) 前另发过改变面板控制流的事件，结论才不同；面板侧无此分支。
- §11.6 的实际视觉后果（输入区在历史视图里是否真的可见）取决于 .yami-ai-page.view-history 之外是否还有别的隐藏规则 —— 本次只核了 AI 相关的全部 grep 命中（hud-overlay.js:4171-4194、src/style.css:4095-4110）。

---

## 13. 本次取证方式（可复核）

- 全量阅读：ai-render-core.js（322 行全读）；ai-agent.js 按段读 1-260 / 355-614 / 614-788 / 778-1078 / 1078-1478 / 1490-1790 / 1787-1976 / 1974-2194 / 2194-2454 / 2459-2649 / 2645-2665 / 2699-2981。
- 定向 grep：hud-overlay.js（yami-ai-* 全部命中、footer-cost、registerPage、__DANJUAN_HUD_API__）、src/style.css（yami-ai-steer、#yami-ai-composer）、probe-core.js（yami-ai-ring）、tests/test-subviews-floating.cjs。
- 未执行任何测试、未启动编辑器、未改动任何被审计文件（只读审计）。
