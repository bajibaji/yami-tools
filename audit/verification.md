# 独立核验报告 · `audit/REPORT.md`（任务 t5）

> 核验者：verifier（独立于 t4 作者）· 只读核验 · 未改动任何插件源码、未执行任何 git 写操作（证据见 §7）
> 核验对象：`audit/REPORT.md`，**SHA256 `3E6E71A665347D69B69552C52DAF64AF97E5AF7E2383AFC6E5E4A1F82E2B968E`（352 行）**
> 为每一条判定附加的都是**我自己读到的源码原文**；报告的结论不作为证据使用。

---

## 0. 版本固定（重要，t6 必读）

| 项 | 值 |
|---|---|
| 核验期间 `audit/REPORT.md` 是否被改写 | **是**。我第一次读取时为 **350 行**；随后（核验进行中）作者追加了第 69 行「引用约定」，其后所有行号 **+1**，`G-10(d)` 一条被重写扩充（补上「5 个 id 选择器」与「测试假绿」），总行数变为 **352 行** |
| 本文件判定所针对的版本 | `3E6E71A6…`（352 行）。文中所有「报告 §X / G-X」均指该版本 |
| 若 REPORT.md 再次变更 | 本核验结论**不可直接沿用**，尤其是行号与 G-10(d) 那一条 |

---

## 1. 方法与工具

- `read`：逐行读源码原文（不使用报告的行号去"认领"结论）。
- `grep`：对报告声称「我们没有 X」的条目做**反向全量搜索**（§3）。
- `pwsh` + `git`：版本水位、工作区状态（§7）。
- `web_fetch`：对标出处直连抓取（§6）。
- 判定口径：**报告写了行号 → 我必须在该行读到能支撑该断言的内容**；读不到、或读到相反内容，即 `failed`。

---

## 2. 本地证据锚点抽查（逐条读原文）

### 2.1 面板（`ai-agent.js` / `hud-overlay.js` / `src/style.css` / `tests/`）

| # | 报告断言（锚点） | 我读到的原文（节选，含行号） | 判定 |
|---|---|---|---|
| A1 | 插件版本号 `1.7.2`（`probe-core.js:5`） | `5| const PROBE_VERSION = '1.7.2';` | passed |
| A2 | 状态机含 busy/pending/queue/busySend/deciding（`ai-agent.js:54-64`） | `54| deciding: false, // …与 busy 分开：审批时 busy 完全可能是 true`；`61| busySend: null`；`62| queue: []`；`63| queueSeq: 0` | passed（五字段齐全）⚠️ 54 行注释与报告 §1.4 相反，见 U4 |
| A3 | `finishTurn` = 收尾 + `setBusy(false)`（`401-408`） | `401| function finishTurn() {` … `403| setBusy(false);` | passed |
| A4 | 顺序不变量注释（`443-445`） | `443| // 【顺序不变量】过程区**永远**排在正文槽之前。` | passed |
| A5 | 用户消息渲染 `addMessage` 无操作按钮（`489`） | `489| function addMessage(kind, text) {`（该函数内无按钮生成） | passed |
| A6 | 失败类留在过程组外（`506`） | `506| *  2) 失败类（bad）留在过程组**外面** …就等于把错藏了。` | passed |
| A7 | 上下文刻度与 80% 文案（`523-536`） | `530| const compactSuffix = context.summary ? ' · 压缩' : …`；`536| …（1M token 窗口，占用达到 80% 自动压缩：先精简长工具结果，再折叠成结构化检查点）` | passed |
| A8 | `refreshContext()` **全文件只有 4 个调用点**（1006/2370/2434/2848） | grep 全量：`540: async function refreshContext()`（定义）+ `1006/2370/2434/2848` 四处调用，**无第 5 处** | passed |
| A9 | 停止链路：发送键变「停止」+ 断 SSE + `/ui-cancel`（`1046-1061`） | `1046| send.textContent = state.busy ? '停止' : '发送';`；`1047| …（也可以按 Esc）`；`1053| function stopStream()`；`1059| request('/ui-cancel', …)` | passed |
| A10 | 审批卡渲染 + 危险态禁用授权勾选（`1096`/`1073-1135`/`1117-1119`） | `1096| function renderApproval(data) {`；`1110| const dangerous = a.risk === 'high';`；`1117| const allowGrant = !dangerous;`；`1118| grantBox.disabled = !allowGrant;` | passed |
| A11 | 等待卡只收尾**第一张**（`1975`） | `1975| const dot = document.querySelector('.yami-ai-tool-dot.wait');`；`1976| if (!dot) return false;`；`resolvePendingCard` 定义仅 1 处、调用点 2348/2432/2439/2447 | passed（G-10(b) 成立） |
| A12 | 撤销/重做繁忙静默返回（`723`/`759`） | `723| if (state.busy) return;`（重做）；`759| if (state.busy) return;`（撤销） | passed |
| A13 | `flushQueue()` 只在 `2393` 被调用（G-10(a)） | grep 全量：`2060: function flushQueue() {`（定义）+ `2393: flushQueue();`（**唯一调用点**，在 `runMessage` 的 finally 内） | passed |
| A14 | `decide` 的 finally 只有 `finishTurn()`（`2450-2454`） | `2450| } finally {` → `2451| state.deciding = false;` → `2454| finishTurn();`（无 flushQueue） | passed |
| A15 | 真实输入区 DOM（`2812`/`2819`） | `2812| '<div class="yami-ai-compose">' +`；`2819| '<div class="yami-ai-devbar">' +` | passed |
| A16 | 5 个 id 选择器中 3 个真实存在（`ai-agent.js:2729/2795/2798`） | `2729| …class="yami-ai-scope" id="yami-ai-scope"…`；`2795| …id="yami-ai-messages" role="log" aria-live="polite"`；`2798| …id="yami-ai-approval" role="alert"` | passed |
| A17 | `#yami-ai-quick-bar`/`#yami-ai-composer` **不匹配任何元素** | 全仓库 grep 这两个 id：仅出现在 `hud-overlay.js:4174/4175/4179/4180`、`src/style.css:4099/4100/4104/4105`（CSS 选择器本身）与 `tests/test-subviews-floating.cjs:47/49`、`HANDOFF.md:1225`；**无任何元素声明这两个 id** | passed（G-10(d) 成立） |
| A18 | 隐藏规则是一组 5 个 id 选择器（`hud-overlay.js:4172-4181`、`src/style.css:4097-4106`） | hud-overlay `4172-4181`：view-undo/view-history × #yami-ai-scope/#yami-ai-messages/#yami-ai-quick-bar/#yami-ai-composer/#yami-ai-approval → `4182| display: none !important;`；style.css `4097-4106` 同构 | passed |
| A19 | 测试假绿：只断言 CSS 文本包含选择器（`tests/test-subviews-floating.cjs:47/49`） | `47| assert.ok(cssContent.includes('.yami-ai-page.view-undo #yami-ai-composer'), 'src/style.css 在 view-undo 下必须隐藏输入区');`；`49| …view-history #yami-ai-composer…`（无元素匹配校验） | passed |
| A20 | 引导条文案（G-2 前提①） | `1999| el.textContent = '引导（将在下一步送到模型）：' + text;`；`2012| el.textContent = '引导已送达模型：' + text;` | **failed（见 F3）** |
| A21 | 「重发」仅 `ai-agent.js:296` 一句命中（G-1） | `296| throw new Error('AI 宿主没有响应（多半已经退出）。点「停止」可以先把界面解开，然后重发一次需求…')` **另有** `13/14/20` 三处「重新生成」命中 | **failed（见 F1）** |
| A22 | 在场感知 1 秒刷新（`2197-2207`/`2968`） | `2207| if (badge) badge.textContent = at && at.label ? '停留中' : '在场感知';`；`2968| // 1 秒一次：…`；`2969| setInterval(updateScopeBar, 1000);` | passed |
| A23 | 审批等待期 `busy === false`（§1.4 对 t2 §11.1 的反证） | `setBusy(` 全量调用点只有 `403(false,finishTurn)`/`1074(false)`/`2360(true,runMessage 开始)`/`2410(true,decide 开始)`；`2367| const result = await streamChat(text);` → `2368| if (result && result.status === 'approval') renderApproval(result);` → `2389-2393| finally { finishTurn(); flushQueue(); }`；宿主 `2408| const result = await handle(...)` → `2409| events.send({type:'result',...})` → `2413| return close()`（`2406| const close = () => { …res.end() }`）→ SSE 必然结束 | passed（**反证成立**：卡片弹出到用户点按钮之间没有任何 `setBusy(true)`，故 `state.busy=false`） |

### 2.2 宿主与 MCP（`ai-host.js` / `runtime/yami-mcp/*`）

| # | 报告断言（锚点） | 我读到的原文（节选，含行号） | 判定 |
|---|---|---|---|
| B1 | 写盘/其他变更集合（`39-43`），`ui_steps` 不在其中（G-11） | `39| const FILE_MUTATIONS = new Set(['write_resource','create_script','write_script','edit_script','patch_resource','delete_resource','append_event_commands','upsert_database_item','restore_backup'])`；`43| const OTHER_MUTATIONS = new Set(['click_element','trigger_playtest','editor_action','interact_editor','send_player_input','send_player_pointer','playtest_smoke'])` — **两处均无 `ui_steps`** | passed |
| B2 | `needsApproval`：工程文件写盘任何模式都要确认（`1895`） | `1895| const needsApproval = !granted && ((isFileMutation && !isPreviewOnly) \|\| (OTHER_MUTATIONS.has(name) && config.approvalMode !== 'auto'))` | passed |
| B3 | 授权键 `工具::路径`，无 path 工具拿不到授权（`1381-1384`/`1387-1391`） | `1381| function grantKeyOf(name, args) {`；`1382| const rel = String((args && args.path) \|\| '')`；`1383| return rel ? \`${name}::${rel}\` : ''`；`1389| if (DELETE_TOOLS.has(name)) return false` | passed |
| B4 | 授权文案「本次任务内」（`1897`/`2262`） | `1897| events.onNotice(\`已授权：… （本次任务内不再逐条确认，随时可撤销）\`)`；`2262| …\`已记住：… 在本次任务内不再逐条确认（随时可撤销）\` | passed |
| B5 | `/clear` 清 grants（`2313`） | `2302| if (pathname === '/clear') {` … `2313| session.grants = []` | passed ⚠️ 但「只有 /clear 会清」不精确，见 F4 |
| B6 | `grantKeyOf` 拆解展示（`1963`） | `1962| grants: list.map(key => {`；`1963| const [tool, path] = key.split('::')` | passed |
| B7 | `processToolCalls` 第 6 形参是 cancelToken（`1819`/`1824`/`1934`） | `1819| async function processToolCalls(session, calls, config, assistantContent = '', events = {}, cancelToken = null) {`；`1824| if (cancelToken && cancelToken.cancelled) break`；`1934| …appendUnexecutedToolResults(session, calls, '用户打断了这次操作')` | passed |
| B8 | 审批续跑**没传** cancelToken（`2289-2291`） | `2289| } else if (pending.remaining && pending.remaining.length) {`；`2290| const outcome = await processToolCalls(session, pending.remaining, config, '', events)`（**第 6 参数缺失**） | passed |
| B9 | 被批准的那次写盘走**裸调用**（`2251`），自动路径用 `callToolWithCancel`（`1900`/`1913`） | `2251| result = await (await ensureMcp()).call(pending.name, args)`；`1900| …await callToolWithCancel(client, name, { ...args, dryRun: true }, cancelToken)`；`1913| const result = await callToolWithCancel(client, name, args, cancelToken)` | passed |
| B10 | `processToolCalls` **不读** `events.cancelToken` | 全量 grep `events.cancelToken`：仅 `1525| const cancelToken = events.cancelToken \|\| null` 与 `2205| session.activeCancel = events.cancelToken \|\| null`，**函数体内无一处** | passed |
| B11 | 取消回执原文（`1737-1741`） | `1737| cancelToken.onCancel(() => finish({` … `1740| message: '用户打断了这次操作：这个工具的结果不再等待（已发出的请求会在后台跑完并被丢弃）'` | passed |
| B12 | 占位应答「未执行」+ 已应答者跳过（`294-306`/`302`） | `294| function appendUnexecutedToolResults(session, calls, reason) {`；`302| if (!call \|\| !call.id \|\| answered.has(call.id)) continue`；`303| session.messages.push({ role:'tool', tool_call_id: call.id, content: placeholder })`；占位文案见 `message-pairs.js:20-28`（`notExecuted: true`、'该工具调用没有执行（…）'） | passed |
| B13 | 压缩摘要调用无令牌（`443-446`） | `443| const produced = await requestModelStream(config, key, [` … `446| ], tools \|\| toolsForModel, () => {}, null)` — 末位实参 `null` | passed |
| B14 | 工具结果上限 24000 字符（`63-64`） | `63| const TOOL_RESULT_LIMIT = Number(process.env.YAMI_AI_TOOL_LIMIT \|\| 24000)`；`64| const TOOL_RESULT_TAIL = … 4000` | passed |
| B15 | 上下文治理四数字（`context-meter.js:30-38`） | `30| const DEFAULT_CONTEXT_WINDOW = 1000000`；`32| …THRESHOLD_RATIO = 0.8`；`34| …RETAIN_RATIO = 0.16`；`36| …MIN_KEEP_MESSAGES = 16`；`38| …{ thresholdChars: 8192, headChars: 4096, tailChars: 1024 }` | passed |
| B16 | 两级压缩实现（`394-510`），常态修剪 `403-410` | `394| * 上下文治理：两级压缩（对齐 DeepSeek Harness 的 compaction 设计）`；`400| async function compressContext(session, config, key, tools) {`；`404| const pruned = contextMeter.pruneToolResults(session.messages)`；`425| // ---- 第二级：模型摘要 ----`；全量 grep `compressContext` 仅 `1544| await compressContext(...)` 一处调用（自动触发，无手工入口） | passed |
| B17 | 事件面 `2345-2355` + `result/error` `2409/2411`（S-6） | `2345| send({ type:'start', route: pathname })`；`2349-2355| onStatus/onDelta/onTool/onNotice/onPlan/onSteer/onSystem`；`2409| events.send({ type:'result', ...result })`；`2411| events.send({ type:'error', error: error.message })` | passed |
| B18 | `STREAM_ROUTES` + 发完 result 即 `res.end()`（`2402`/`2406-2413`） | `2402| const STREAM_ROUTES = { '/chat/stream':'/chat', '/approve/stream':'/approve', '/reject/stream':'/reject' }`；`2406| const close = () => { if (!finished) { finished = true; try { res.end() } … `；`2413| return close()` | passed |
| B19 | SSE 断开 = 取消信号（`2321-2343`，含被引用的注释原文） | `2322-2323| // 前端点「停止」会直接断开这条 SSE：把它当成取消信号…只断开界面、后台还在烧 token/改文件，是这类助手最不能接受的坏行为。`；`2338| const onAbort = () => {`；`2341| cancelToken.cancel('已打断')`；`2343| res.on('close', onAbort)` | passed |
| B20 | 收尾文案（`1526-1535`） | `1526| const aborted = () => {`；`1533| message: '已打断。我已经停下来了，已完成的改动都保留着，可以接着说下一步。'` | passed |
| B21 | `/ui-cancel` 走编辑器桥（`1977-1983`） | `1977| if (pathname === '/ui-cancel') {`；`1979| const stopped = await editorBridge.action('cancel', …)` | passed |
| B22 | 崩溃兜底：写 host-crash.log **且不让进程退出**（`2474-2482`） | `2474-2475| // ① 落盘到 <配置目录>/host-crash.log…② **不让进程退出**…`；`2480| fs.appendFileSync(path.join(CONFIG_DIR,'host-crash.log'), …)`；`2484| process.on('uncaughtException', error => logHostCrash(…))` | passed |
| B23 | 单进程 HTTP 端口 5968（§2.2「形态」） | `17| const PORT = Number(process.env.YAMI_AI_PORT \|\| 5968)`；`2456| server.listen(PORT, '127.0.0.1', …)` | passed |
| B24 | 系统提示词写死常量（`1154`） | `1154| const SYSTEM_PROMPT = \`你是 Open Yami RPG Editor 内置开发副驾…` | passed |
| B25 | `/session/load` 只把 pending 当摘要返回（`2139`/`2394`） | `2139| pending: restored.pending ? summarizePending(restored.pending.name, restored.pending.args, restored.pending.preview) : null`；`2394` 同；`1246| function summarizePending(name, args, preview) {` | passed |
| B26 | 「未失焦输入」硬拦截（`1880-1893` 含 `ui_steps`；`2225-2234` 审批路径） | `1880| if ((isFileMutation && !isPreviewOnly) \|\| name === 'ui_steps') {`；`1884| const rejectMsg = '检测到编辑器中有未失焦的输入正在进行，…'`；`2228-2229| …hasPendingInput === true) throw new Error('检测到编辑器中有未失焦的输入…')` | passed |
| B27 | 打转保护（`1545-1548`/`1618-1631`/`1648-1656`/`1751`） | `1547| let repeats = 0`；`1618| if (repeats >= 3) {`；`1649| if (repeats > 0) {`；`1653| content: \`【系统干预指引】…严禁再次重复调用相同检索！`；`1751| function repeatHint(session, name) {` | passed |
| B28 | 编译门禁/自动重修（`1658-1683`、审批路径 `2270-2288`） | `1658| // 编译没通过 → 把编译器报错喂回去让模型自己修（有限次…）`；`1664| status: 'compile-failed',`；`2270| const failure = rejected ? null : compileFailureOf(pending.name, result)`；`2285| session.repairs = (session.repairs \|\| 0) + 1` | passed |
| B29 | `todo_write` → 宿主 `onPlan`（`1920-1924`）+ 工具注册（`server.js:897-900`） | `1920| if (name === 'todo_write' && result && result.ok !== false && result.summary && result.summary.total) {`；`1924| if (events.onPlan) events.onPlan(result.items, result.summary)`；server `897| name: 'todo_write',`、`899| readOnlyHint: true,` | passed |
| B30 | `search_project` / `playtest_smoke` 注册（`server.js:954-957` / `986-989`） | `954| name: 'search_project',`、`955| description: '在工程里做内容检索（类似 grep）…'`、`956| readOnlyHint: true,`；`986| name: 'playtest_smoke',`、`988| readOnlyHint: false,` | passed |
| B31 | MCP 忽略 `notifications/cancelled`（`server.js:2032`） | `2032| if (msg.method === 'notifications/initialized' \|\| msg.method === 'notifications/cancelled') return` | passed |
| B32 | 权限档次：只有 high/medium，无 low（`server.js:1469/1486/1501/1868`、`ai-host.js:1256`） | grep `risk: ?'(high\|medium\|low)'`：`1469: risk: 'high',`、`1486: risk: 'high',`、`1501| return { … risk: 'high', … }`、`1868: risk: 'medium',` — **无 `risk: 'low'`**；`ai-host.js:1256| const risk = (preview && preview.risk) \|\| (name === 'delete_resource' ? 'high' : 'medium')` | passed |
| B33 | 面板口径文案（`ai-agent.js:2748`） | `2748| '<span>编辑器操作自动执行，工程文件仍需确认</span>' +` | passed |
| B34 | MCP「没有取消语义、迟到响应被 onData 丢弃」（`1719-1727`） | `1722-1726| // MCP 是 stdio 的请求-响应协议，没有取消语义：请求已经发出，子进程会继续跑完。但我们不该继续干等…迟到的响应由 onData 丢弃（pending 表里已经没有它…）` | passed |

### 2.3 SSOT 与版本水位

| # | 报告断言（锚点） | 我读到的原文（节选） | 判定 |
|---|---|---|---|
| C1 | SSOT 第 4 行自述唯一基准 | `4| > 本文件是唯一对照基准（SSOT），每轮迭代更新「现状 / 差距 / 下一步」三栏。` | passed |
| C2 | `S-1` 第 5 行写「2026-09-11（第 1 轮）」而正文已到第 11 轮 | `5| > 更新时间：2026-09-11（第 1 轮）` vs `188| ## 十二、第 11 轮（已完成，可验证）：只读工具并发 + 一个隐藏缺陷`、`205| ## 十三、后续轮次候选（按价值排序）` | passed |
| C3 | `S-2` 该组关键词在 SSOT 全文 **0 命中** | grep `1\.7\|悬浮\|在场\|停留\|host-crash\|崩溃\|超时\|看门狗\|approve/stream\|/steer\|引导` 于 SSOT → **0 hit** | passed |
| C4 | `S-3` 第 35 行的 32k/240k/最近 16 条 | `35| …单条工具结果超 32k 字符自动裁剪；整段上下文超 240k 字符触发压缩…保留 system + 摘要 + 最近 16 条…` | passed（与 B14/B15 对照，确为过期数字） |
| C5 | `S-6` 第 32 行事件名清点 | `32| | 1 | 流式输出 | …实时推送 \`start/status/delta/tool/result/error\`…`（与 B17 对照，确漏 notice/plan/steer/system） | passed |
| C6 | `S-5` 第 205-208 行候选 | `205| ## 十三、后续轮次候选（按价值排序）`；`207| - P2 子代理委派（并行搜索/审计）`；`208| - 真机 GUI 走查（…）` | passed |
| C7 | `S-4`/§2.3 #10 引「第 41 行」的「可切『全自动』」 | 第 41 行**只有**「三档风险分级（low / medium / high）」；**「可切『全自动』」在 SSOT 第 22 行**（`22| | 10 | **权限分级** | 只读自动、写入确认、危险操作强确认，可切「全自动」 |`） | **failed（见 F2）** |
| C8 | HEAD=`761cd9c`、PROBE_VERSION=`1.7.2`、SSOT 末次提交 `99976f2` | `git rev-parse --short HEAD` → `761cd9c`；`git log -1` → `761cd9c 2026-09-14 11:35:05 +0800 bug fixed round 2`；`git log -1 -- docs/AI助手-…md` → `99976f2 2026-09-11 22:55:24 +0800 V1.1.0`；见 A1 | passed |
| C9 | 简报的「刚发布 v1.6.11」已过时，其后另有 5 个提交 | `git log --oneline -8`：`761cd9c → f2942c3(v1.7.2) → 599bf5d → 24c6eed(v1.7.1) → a7eedd5(v1.7.0) → 0424b9a(V1.6.11) → 4e5fa62(V1.6.8)` | passed |

---

## 3. 反向抽查：报告声称「我们没有 X」的条目（8 条，全部重跑 grep）

| # | 报告断言 | 我执行的搜索 | 命中 | 判定 |
|---|---|---|---|---|
| R1 | G-1 对话时间轴/重来：**0 实现**（`ai-agent.js`+`ai-host.js`） | `grep "重新生成\|重发\|编辑消息\|改写\|fork\|regenerate\|resend\|rewind\|checkpoint\|恢复到这一步"` | ai-agent.js **4 处**（13/14/20/296）、ai-host.js **1 处**（407） | 结论成立（无实现），但**命中数写错**，见 F1 |
| R2 | G-3 `@` 引用文件：未实现 | `grep "@\|提及\|引用\|attach\|附件\|图片\|粘贴\|paste\|clipboard\|拖拽\|drop"` in ai-agent.js | 4 处：`1089`(diff `@@`)、`1826`(clipboard)、`2027`/`2053`(dropQueued) | passed（与报告所列完全一致） |
| R3 | G-9 hooks / 斜杠命令：0 命中 | `grep "hook\|Hook\|斜杠\|slash\|/help\|命令面板"` in ai-agent.js | **0** | passed |
| R4 | G-4 图片/附件通道：无 | `grep "image\|图片\|多模态\|base64"` in ai-host.js | 1 处：`566`（Windows 命令行 base64 编码，无关） | passed |
| R5 | 子代理委派：无 | `grep "subagent\|子代理\|sub_agent"` in ai-host.js | **0** | passed |
| R6 | 计划模式：无独立入口 | `grep "计划模式\|plan_mode\|PlanMode\|ExitPlanMode"` in ai-host.js | **0**（`plan` 事件 = 待办卡，见 B29） | passed |
| R7 | G-8 无手工压缩入口 | `grep "手动压缩\|立即压缩\|/compact\|compactNow"` in ai-agent.js | **0**；且 `compressContext` 全宿主只有 1 处调用（`ai-host.js:1544`，自动） | passed |
| R8 | S-2 SSOT「版本水位」0 命中 | 见 C3 | **0** | passed |

> 8 条反向抽查中，**7 条完全成立**；R1 的**结论**成立、但报告给出的「命中集合」不完整（F1）。

---

## 4. 被证伪 / 需修正的条目（每条附正确现状）

### F1 · G-1「只有 `ai-agent.js:296` 一句命中」——命中集合写错（**需修正**）
- 报告原文（G-1 本地锚点）：「对 `ai-agent.js`、`ai-host.js` 全量 grep …→ 只有 `ai-agent.js:296` 一句错误提示文案…命中了「重发」，**无任何实现**」。
- 事实（我重跑同一条正则）：`ai-agent.js` **4 处**、`ai-host.js` **1 处**：
  - `ai-agent.js:13` `// 只读一次：读不到就往下走（重新生成一个）…`
  - `ai-agent.js:14` `// …真正的兜底是下面的重新生成。`
  - `ai-agent.js:20` `} catch (e) { /* 读不到就当没有，交给下面重新生成 */ }`
  - `ai-agent.js:296`（报告引用的那一句，确为唯一与「重发」相关的文案）
  - `ai-host.js:407` `session.tokenAnchor = null   // 消息内容被改写，真实用量锚点随之作废`
- **正确现状**：无任何「编辑/重发/从某轮重来」实现（结论不变）；但「命中仅 1 处」不成立——实际 5 处，其中 `ai-agent.js:13/14/20` 与 `ai-host.js:407` 是无关注释（临时文件「重新生成」、压缩改写上下文）。

### F2 · `S-4`/§2.3 #10 把「可切『全自动』」挂在 SSOT 第 41 行（**行号错误**）
- 报告原文：`SSOT 第 41 行「三档风险分级（low / medium / high）」「可切『全自动』」`。
- 事实：第 41 行只有「①三档风险分级（low / medium / high）…」（其余为令牌与批量授权描述）；**「可切「全自动」」出现在 SSOT 第 22 行**（表格行 `| 10 | **权限分级** | 只读自动、写入确认、危险操作强确认，可切「全自动」 |`）。
- **正确现状**：SSOT 关于权限的两处表述都在 `#10 权限分级` 名下但分属 22 行（宣称可切全自动）与 41 行（宣称三档分级）。结论（代码里只有 high/medium、且工程文件写盘任何模式都要确认，见 B2/B32）**不受影响**；需把引用拆成「第 22 行 + 第 41 行」。

### F3 · G-2 前提①与最小修法①——**已由现有实现满足**（本条实质失效）
- 报告原文：「用户看到**「引导（等待投递）」**时不知道在等什么（其实是在等当前这步工具跑完）」，最小修法①「引导条文案补一句『将在当前这一步结束后投递』（纯文案，状态机已存在）」。
- 事实：面板里等待态引导条的真实文案是 `ai-agent.js:1999| el.textContent = '引导（将在下一步送到模型）：' + text;`，送达后为 `2012| '引导已送达模型：' + text`；全文件 grep「等待投递」**0 命中**。
- **正确现状**：引导条**已经**把「将在下一步送到模型」写在用户眼前，报告引用的旧文案不存在，拟补的那句话与现有文案同义 → G-2 的「① 文案」应从差距里去掉（**②没有撤回** 仍成立：全文件无撤回排队/引导的入口，只有删除排队项 `dropQueued` `2027`）。

### F4 · G-6 缺口 4「`2313` 只有 `/clear` 会清 `grants`」——表述不精确（**需修正**）
- 事实：`session.grants` 被清空的位置有 `1956| session.grants = []`（`/grants` 的 `clear:true` 分支）与 `2313`（`/clear`）；此外 `1951` 支持单键撤销，`1235` 在**恢复会话**时用磁盘数据（`138| grants: Array.isArray(data.grants) ? data.grants : []`）——即授权**跨宿主重启仍然存活**。
- **正确现状**：授权活到「`/clear`、用户显式清空/撤销，或会话文件被删」；比报告写的「只有 /clear」更宽，反而**加强**了「文案说『本次任务内』与实际作用域不符」这一结论。

---

## 5. 无法判定 / 证据不足（不得当作已确证）

| # | 项 | 为什么无法判定 |
|---|---|---|
| U1 | G-10(d) 的实际**视觉终局**（进历史/撤销子视图后输入区到底看不看得见） | 静态只能证明「那 2 条 CSS 声明不匹配任何元素」（A17/A18/A19 已确证）；是否另有规则/内联样式兜底，需真机走查。报告自身已把主张收敛为「这两条声明不生效 + 测试假绿」，**边界写法正确** |
| U2 | `search_project` 内部细节（范围过滤/非法正则退化/截断提示） | 未读实现体；报告 §5.1 已如实标注「未复验」，处理正确 |
| U3 | 报告自身在核验期间被改写 | 我读到的是 350 行版，判定基于 352 行版（`3E6E71A6…`）。**若该文件再次变更，本核验不可沿用** |
| U4 | 源码注释与 §1.4 的矛盾 | 已成为**已确证的文档级发现**，见 **§10.2（含 git 取证）**：`ai-agent.js:54` 与 `2398-2400` 两处注释与当前控制流相反，属过期注释（会误导维护者）。**行为**以报告 §1.4 为准（A23/§9.2 已复核） |
| U5 | t2 §11.3（`markSteerDelivered` 空 text 误判第一条） | **本行已被推翻重写，见 §9.5**：代码形状确实存在（`2009` 的 `indexOf('')===0`），但报告 §5.7 的「当前不可达」结论经我逐锚点复核**成立**（空串进不了队列）。我首轮只按代码形状判「成立」，属**证据不足**的判定，已更正 |

---

## 6. 对标出处抽查（外部 URL 实测，2026-09-14）

| 报告代号 | URL | 我在抓取正文里命中的原文关键词 | 判定 |
|---|---|---|---|
| [CP] | `https://code.claude.com/docs/en/checkpointing.md` | `each prompt`、`/rewind`、`Restore code`、`Restore conversation`、`Summarize from here`、`keeps file snapshots for the 100 most recent checkpoints in a session` | passed（含「100 个检查点」这一条） |
| [IM] | `https://code.claude.com/docs/en/interactive-mode.md` | `keeps the work done so far`、`Queue messages`、`Ctrl+O`、`Ctrl+V`、`[Image #N]`、`take back what you queued` | passed |
| [PM] | `https://code.claude.com/docs/en/permission-modes.md` | `Available modes`、`acceptEdits`、`dontAsk`、`bypassPermissions`、`switch`、`any time` | passed |
| [PR] | `https://code.claude.com/docs/en/prompt-library.md` | `reference a file`、`@meeting-notes.md`、`@reports/q1-signups.csv` | passed |
| [CW] | `https://code.claude.com/docs/en/context-window.md` | `/compact focus`、`/context`、`Summarize from here` | passed |

> 5/5 抽查通过；报告 §1.2 的出处均为官方文档，未发现引用第三方来源。

---

## 7. 只读约束核验（命令与输出）

```
PS> git status --short
?? .agent-teams/
?? audit/

PS> git diff HEAD --stat -- docs/
（无输出）

PS> git rev-parse --short HEAD
761cd9c

PS> git log -1 --format='%h %ad %s' --date=iso
761cd9c 2026-09-14 11:35:05 +0800 bug fixed round 2

PS> git log -1 --format='%h %ad %s' --date=iso -- docs/AI助手-对标ClaudeCode-差距与路线图.md
99976f2 2026-09-11 22:55:24 +0800 V1.1.0

PS> Get-FileHash audit/REPORT.md -Algorithm SHA256
3E6E71A665347D69B69552C52DAF64AF97E5AF7E2383AFC6E5E4A1F82E2B968E
```

- `git status --short` 只有两个未跟踪目录（`.agent-teams/`、`audit/`）→ ai-agent.js / ai-host.js / probe-core.js / hud-overlay.js / runtime/** / tests/** **零改动**；本次核验只新增本文件，未触碰任何插件源码，未执行 `git add/commit/checkout/push`。
- `git diff HEAD -- docs/` 为空 → 报告 §1.1「SSOT 与 HEAD 无差异」成立（C8）。

---

## 8. 核验结论

| 判定 | 数量 | 说明 |
|---|---|---|
| `passed`（锚点可复现、原文支持断言） | **63 条**（§2.1 21/23 + §2.2 34/34 + §2.3 8/9） | 含全部 P0 与 G-10(a)(b)(d)、G-11、S-1/S-2/S-3/S-5/S-6；逐条原文见 §2 |
| `failed`（需修正） | **4 条**（表中 3 条：A20/G-2 文案、A21/G-1 命中集合、C7/SSOT 行号；表外 1 条：F4 授权清除口径） | 4 条**均不改变报告的 P0/P1 结论与优先级**：F1/F2 是引用精度，F3 使 G-2 的一条子项失效（其「没有撤回」仍在），F4 反而加强 G-6 |
| 无法判定 / 需真机 | **5 条**（§5） | 其中 U3（报告被改写）影响 t6 的可复现性；U5 已在 §9.5 更正 |
| **追加核验（§9，captain 指令后）新增 1 条证伪** | **F5** | G-5 缺口 2（P0 第 2 项）的机理被证伪：在飞的那一条记的是「不再等待」回执、不是「未执行」，且「未执行」占位根本不进界面 → 措辞与账目**不矛盾**，其最小修法已于 `ai-host.js:1916` 实现。G-5 只剩缺口 1 |

**一句话**：报告的核心事实链（无对话时间轴、中断收尾两处漏点、审批缺中间档、SSOT 过期、`ui_steps` 不进门控、子视图选择器失效+测试假绿）**逐条经我独立读码复现，成立**；t2 §11.1 的反证也成立。需修正的 4 条中，**F3 是唯一会改变报告正文措辞的实质问题**（G-2 的文案建议已被现有实现满足），建议 gap-analyst 定向改这 4 处，其余无需重写。

---

## 9. 追加核验（captain 指令后 · 针对修订版与三条 P0 重点）

### 9.1 版本再确认

- 重新取哈希：`audit/REPORT.md` = **`3E6E71A6…`（58940 字节）**，与 §0 固定的值**一致** → captain 说的「350 → 352 修订」正是我已核验的这一版，未再变动。
- 行数口径差异说明：read 工具报 `totalLines=352`；PowerShell `Get-Content | Measure-Object -Line` 报 268（它不数空行）——**不是版本差异**，勿据此怀疑改版。
- 我首轮 §5 的引用取自修订前的 350 行版；**本次已重读 §4/§5（318-352 行）**，确认现行 §5 共 9 条、第 7 条即 t2 §11.3 的降级条目（见 §9.5）。

### 9.2 §1.4 反证链：逐环亲读（**成立，含两条可达性结论**）

| 环节 | 我读到的原文 |
|---|---|
| 审批卡确实显形 | `ai-agent.js:1097| state.pending = data.approval;`；`1133| box.classList.add('show');` |
| 流在拿到 approval 后结束 | `ai-agent.js:2367| const result = await streamChat(text);`；`2368| if (result && result.status === 'approval') renderApproval(result);`；宿主 `ai-host.js:2408| const result = await handle(...)` → `2409| events.send({ type:'result', ...result })` → `2413| return close()`（`2406| const close = () => { … res.end() }`） |
| busy 在 finally 归零 | `ai-agent.js:2389-2393| } finally { finishTurn(); flushQueue(); }` → `403| setBusy(false);` |
| 没有第二条置 true 的路径 | 全文件 `setBusy(` 只有 `403(false)` / `1074(false)` / `2360(true, runMessage 开始)` / `2410(true, decide 开始)` |

- **Esc 能不能取消审批 → 能**：`2936| if ((isApprovalVisible || state.pending) && !state.busy && !state.deciding) {` → `2938| decide(false);`。卡片带 `show`（1133）且 `state.pending` 已置（1097），等待期 `busy=false`、`deciding=false` → 分支可达。
- **发新消息能不能作废审批 → 能**：`2333| if (state.busy) {`（busy=false 时不进入）→ `2345| if (state.pending) {` → `2346| state.pending = null;` → `2347` 收起卡片 → `2348| resolvePendingCard(false, '你直接发了新需求');` → 继续走 `2352| await runMessage(text);`。
- **结论**：**§1.4 成立**，t2 §11.1 事实 A（Esc 不生效 / 新消息分支不可达）**被证伪**。
- ⚠️ 附带（仍见 §5 U4）：源码注释 `ai-agent.js:54` 与 `2398-2400` 仍写着「审批时 busy 完全可能是 true（SSE 还开着）」，与行为相反——那是 v1.6.11 改走 `/approve/stream` 之后的过期注释，建议随文档项一并修（**不影响** §1.4 结论）。

### 9.3 G-5 缺口 1 的因果链（**成立**）

- 审批续跑**确实拿到了活令牌**：`ai-host.js:2324| const cancelToken = createCancelToken()`；`2338| const onAbort = () => {` → `2341| cancelToken.cancel('已打断')`；`2343| res.on('close', onAbort)`；且 `/approve/stream` 走同一条 SSE（`2402-2404`）。
- 但 `2290| const outcome = await processToolCalls(session, pending.remaining, config, '', events)` **少传第 6 参** → 形参 `cancelToken = null`（`1819`）→ `1824| if (cancelToken && cancelToken.cancelled) break` **永不触发**；`1900`/`1913` 也把 `null` 传下去 → `1731| if (!cancelToken) return pending`（裸等）→ **剩余调用全部照跑**。
- 本轮自己的 token 只在**下一个步骤边界**才被看见：`2293| const running = runTurn(session, config, events)` → `1505| const result = await continueSession(session, config, events)` → `1525| const cancelToken = events.cancelToken || null` → `1559| if (cancelToken && cancelToken.cancelled) return aborted()`。即「停止」要等这批剩余调用跑完才生效。
- `2251| result = await (await ensureMcp()).call(pending.name, args)` 是**裸调用**（对照 `1900`/`1913` 的 `callToolWithCancel`）→ 连「不再干等」的取消回执都没有。
- **因果结论**：报告「续跑里的剩余工具调用与那一次写盘仍在跑」**成立**。**边界**（我加的精化）：那一次写盘在协议层本来就不可取消（`1722| // MCP 是 stdio 的请求-响应协议，没有取消语义：请求已经发出，子进程会继续跑完`），所以 `2251` 与 `1913` 的实际差别是**宿主继续干等（缺取消回执）**，不是「多执行了一次工具」。

### 9.4 【新证伪 F5】G-5 缺口 2（P0 第 2 项）的机理不成立

- 报告原文（现行版）：§3.2 行 218「**缺口 2：取消后记「未执行」，但被取消的那次调用可能已在后台生效（真缺陷，记账语义）**」；行 220「…问题是**正在进行中被取消的那一条**，副作用可能已落地，却被记为「未执行」」；行 221「用户看到「未执行」以为工程没动…」；§3.1 行 146 同义；§0 行 11、§3.3 行 309 复述。
- 我逐行读 `ai-host.js:1832-1935` + `294-306` + `runtime/yami-mcp/modules/message-pairs.js` + `visibleMessages`，事实如下：
  1. **在飞的那一条不会被记成「未执行」**：它走 `1913| const result = await callToolWithCancel(client, name, args, cancelToken)`，取消时 `1737-1741` 返回 `{ ok:false, cancelled:true, message:'用户打断了这次操作：这个工具的结果不再等待（已发出的请求会在后台跑完并被丢弃）' }`；紧接着 `1915-1916| const packedResult = withHint(result, hint); session.messages.push({ role:'tool', tool_call_id: call.id, content: clipToolResult(packedResult, name) })` **就把这张诚实回执记了账**。只读并发批路径同理（`1845-1846` → `1852` 逐条 push）。
  2. **「未执行」只发给从未开始的调用**：下一轮 `1824` break 后，`1934| if (cancelToken && cancelToken.cancelled) appendUnexecutedToolResults(session, calls, '用户打断了这次操作')`；其 `302| if (!call || !call.id || answered.has(call.id)) continue` 会跳过在飞那条（已有应答）→ 只有**还没轮到执行**的调用得到占位，对它们而言「未执行」**准确**。
  3. **「未执行」不进界面**：`appendUnexecutedToolResults(session, calls, reason)`（`294`）只 `session.messages.push`，**不发 `onTool`**（对照 `1928-1930` 会推 fail）；`/session/load` 回放的 `visibleMessages`（`155-161`）只放行 `role === 'user'` 与 `role === 'assistant'`，`role:'tool'` 一律丢弃；面板侧全文 grep「未执行」仅 `ai-agent.js:2343` 一句**注释**。在飞那条的取消文案反而是**用户可见**的（`1928-1930` 的 fail detail 就是该 message）。
- **正确现状**：**措辞与账目不矛盾**——在飞的调用记「不再等待（可能已在后台跑完）」（与 `1737-1741` 对外措辞一致）、未开始的调用记「未执行」（准确），两套记录互不重叠（正是 `302` 去重的作用，**不是 bug**），且都不构成用户可见的错误陈述。
- **影响与建议**：该项是 P0「G-5」的第 2 半，**机理不成立**。建议 gap-analyst 二选一：(a) 删去「记账不实」这半，把 G-5 收敛为「停不干净」（缺口 1，§9.3 成立）；(b) 改写为「已核对无缺陷」。另：行 222 提出的最小修法（「先为 `result.cancelled === true` 的调用记账」）**已由 `1916` 实现**，无需改代码。
- **保留**：G-5 缺口 1 与 `443-446`（压缩摘要无令牌）仍成立，故 G-5 仍可列为 P0，但只剩「停不干净」这一半；capitan 关心的「去重逻辑」我已单独判定：`302` 是按 `tool_call_id` 保证不重复记账的**正确**实现。

### 9.5 报告 §5.7（t2 §11.3「空 text 误判」降级为潜伏隐患）—— 复核**成立**

| 报告给的锚点 | 我读到的原文 | 判定 |
|---|---|---|
| `ai-host.js:1972-1973`（trim + 显式拒绝空串） | `1972| const text = String(body.message \|\| '').trim()`；`1973| if (!text) throw new Error('引导内容不能为空')` | passed |
| `queueSteer` 唯一调用点 `1975` | grep 全量：定义 `1459`，调用仅 `1975| return { ok:true, busy:true, queued: queueSteer(session, text) }` | passed |
| 投递事件 `1567` 必带非空 text | `1567| if (events.onSteer) for (const item of steers) events.onSteer({ phase:'delivered', text: item.text })`（`item.text` 来自上述队列）；`onSteer` 唯一生产者即此处 | passed |
| 面板 `markSteerDelivered` 唯一调用点 `ai-agent.js:1350` | `1350| if (event.type === 'steer') { if (event.phase === 'delivered') markSteerDelivered(String(event.text \|\| '')); return; }`（定义 `2006`） | passed |

→ 因空串进不了队列，`2009| if (el.textContent.indexOf(text) !== -1)`（`text===''` 时恒 0）**当前不可达**；报告按「潜伏隐患、不计 P0/P1」记**正确**，我首轮的 U5 判定已按此更正。

### 9.6 仍保持挂账（我未下结论，按 captain 要求）

- t2 §11.4（审批链路缺每轮用量行）、§11.9（面板不 kill 子进程）、§11.10（可访问性）、§11.3 的「引导条无超时兜底」半条；t2 §12 的两条边界（审批期 busy 是否恒真——已由 §1.4/§9.2 反证；§11.6 真机视觉后果）。
- 报告 §5 其余条目（`search_project` 内部细节、计划模式排他性、`/status` 兜底、真机行为）保持原状，未替其下结论。

### 9.7 本轮只读复核

```
PS> git status --short
?? .agent-teams/
?? audit/

PS> Get-FileHash audit/REPORT.md -Algorithm SHA256
3E6E71A665347D69B69552C52DAF64AF97E5AF7E2383AFC6E5E4A1F82E2B968E
```

仍为零源码改动；本轮新增判定：**§1.4 成立**、**G-5 缺口 1 成立（含边界精化）**、**G-5 缺口 2 证伪（F5）**、**§5.7 成立**。

**修后一句话**：报告的核心事实链依然成立；但 P0 清单里 G-5 的「记账不实」一半站不住（F5），加上此前的 F1/F2/F3/F4，**建议 gap-analyst 定向改 5 处**（F1 命中集合、F2 SSOT 行号、F3 G-2 文案、F4 授权清除口径、F5 G-5 缺口 2），其中 **F3 与 F5 会改变报告正文的实质主张**，其余为引用精度。

---

## 10. 终局确认（captain 裁定后 · §1.4 与过期注释）

### 10.1 §1.4 的最后一块拼图：`renderApproval` 与 `setBusy(false)` 之间**没有 await**

captain 给的微任务论证，我逐行复核**成立**：

| 位置 | 我读到的原文 | 说明 |
|---|---|---|
| `ai-agent.js:2367-2371` | `2367| const result = await streamChat(text);` / `2368| if (result && result.status === 'approval') renderApproval(result);` / `2369`（else 分支）/ `2370| refreshContext();` / `2371| refreshFooterCost();` | 2369-2371 **全是同步语句**：`refreshContext()` / `refreshFooterCost()` 都以 `();` 结尾、**没有 await**（返回的 Promise 不被等待） |
| `ai-agent.js:2389-2393` | `2389| } finally {` … `2392| finishTurn();` / `2393| flushQueue();` | finally 紧随 try 体，**中间没有 await** |
| `ai-agent.js:401-403` | `401| function finishTurn() {` / `403| setBusy(false);` | busy 归零 |
| `decide()` 同一模式 | `2430| if (result && result.status === 'approval') renderApproval(result);` → `2434| refreshContext();` / `2435| refreshFooterCost();` → `2450| } finally {` → `2454| finishTurn();` | 同样无 await 间隔 |

→ 从卡片被加上 `show`（`1133`）到 `setBusy(false)`（`403`）都在**同一个微任务**里跑完，浏览器**不可能**在这个窗口里派发点击或按键。因此「用户能操作审批卡」的那一刻 `busy` 必定已是 `false`：
- Esc 闸门放行：`2936| if ((isApprovalVisible || state.pending) && !state.busy && !state.deciding)` → `2938| decide(false);`
- 新消息作废审批可达：`2333| if (state.busy)` 不进入 → `2345-2348`

**§1.4 结论确认无误；t2 §11.1 事实 A 应改判**（与 captain 裁定一致）。

### 10.2 【文档级发现 F6】两处「审批时 busy 可能是 true」注释已过期，会误导维护者

- 位置与原文（我读到的）：
  - `ai-agent.js:54| deciding: false,   // 审批卡正在提交（防连点），与 busy 分开：审批时 busy 完全可能是 true`
  - `ai-agent.js:2398-2401| // 这里**不能**拿 state.busy 当闸门：审批卡弹出来的时候，本轮正处在"暂停等人"的状态，` / `// busy 完全可能是 true（SSE 还开着）。用 busy 一挡，「执行修改」就变成一个点了毫无反应的` / `// 死按钮 —— 用户报的"点击执行修改没有反应"正是这么来的。`
- git 取证（全部只读命令，输出原样抄录）：

```
PS> git log --oneline -S '死按钮' -- ai-agent.js
4e5fa62 V1.6.8: …（修「执行修改」点了没反应的死按钮…）

PS> git log --oneline -S '完全可能是 true' -- ai-agent.js
4e5fa62 V1.6.8: （同上，同一提交）

PS> git log --oneline -S '/approve/stream' -- ai-host.js
0424b9a V1.6.11: 审批续跑回到同一条事件流（续跑此前走普通 POST…）

PS> git log --oneline 4e5fa62..0424b9a
0424b9a （仅此一条：V1.6.8 与 V1.6.11 之间没有其它提交）

PS> git log --all -i --grep='v1.6.9' --grep='v1.6.10' --grep='1.6.10'
（空）

PS> git show 4e5fa62:ai-host.js | Select-String 'STREAM_ROUTES|approve/stream'
（空 → V1.6.8 尚无 SSE 续跑路由）
```

- **我的判断**：这两处注释**确实是过期注释，会误导维护者**——照注释理解会以为必须保留 `busy` 闸门，而在当前控制流下用 busy 挡 `decide()` 恰好会**重新制造** V1.6.8 修掉的那个「执行修改点了没反应」死按钮。建议单列一条文档项随报告一并修（可与 S-1~S-6 同批）。
- **版本号更正（供记录，不影响任何结论）**：captain 说该注释是「v1.6.10 时代」写的；按上列取证，它引入于 **4e5fa62（V1.6.8）**，而 SSE 续跑（`/approve/stream`）引入于 **0424b9a（V1.6.11）**，仓库里**不存在** v1.6.9 / v1.6.10 提交。实质不变：注释早于「续跑走 SSE」的改动，故已过期。
- **边界（不夸大）**：该注释在 V1.6.8 当时是否就已与控制流不符，我**未定论**——同一提交里 `runMessage` 已是 `1938| if (result && result.status === 'approval') renderApproval(result);` → `1960| setBusy(false);` 的结构，但另有非流式回退路径 `handleResult`（`git show 4e5fa62:ai-agent.js` 第 826-832 行）我未逐行追完。
- **不影响报告**：报告从未引用这两处注释，其 §1.4 结论与代码行为一致 → 这是**仓库的文档缺陷**，不是报告的事实性错误（不计入 F1-F5）。

### 10.3 本轮只读复核

```
PS> git status --short
?? .agent-teams/
?? audit/

PS> (Get-FileHash audit/REPORT.md -Algorithm SHA256).Hash
3E6E71A665347D69B69552C52DAF64AF97E5AF7E2383AFC6E5E4A1F82E2B968E
```

零源码改动；`audit/REPORT.md` 哈希未变（同 §9.1）。本轮新增：**§1.4 终局确认（含微任务论证复核）** 与 **F6 过期注释（附 git 取证）**。

---

## 11. 对「修订后版本」的再核验（REPORT.md 在本次会话内被连续修订）

### 11.1 版本时间线（**结论一律以哈希为准**）

| 修订 | SHA256 | 总行数 | 我对它的核验范围 |
|---|---|---|---|
| **A** | `3E6E71A665347D69B69552C52DAF64AF97E5AF7E2383AFC6E5E4A1F82E2B968E` | 352 | §2 全部 66 条锚点 + §3/§5/§6/§7（本文件主体） |
| **B** | `384F5A4DD0AB545BC2E913531A5F5CE4CDFB115A707026EC09AAE078F69B942C` | 369 | 仅结构勘察（发现 F2/F3/F4 已修、F1/F5 未修） |
| **C（当前）** | `EA096221F049118756A960945E182B48D77273B0C151E3D6EE6F3AB715FF54CD` | 369 | §11.2-§11.3 的差分复核 |

⚠️ **修正 §10.3 的一句话**：我在写 §10 时写的「`audit/REPORT.md` 哈希未变」**已作废**——修订 B 恰好落盘在我取哈希与写入之间。§10.3 该句以本节为准。

### 11.2 已修项（我逐条复核 = passed）

| 我的编号 | 修订 C 的现状（我读到的行） | 判定 |
|---|---|---|
| **F2（SSOT 行号）** | 行 109「（SSOT **第 22 行** + **第 41 行**）」；行 131「SSOT **第 22 行**（要素表：「可切『全自动』」）+ **第 41 行**（现状对照：「三档风险分级…」）」；行 329（§3.4 表）同 | **已修正** ✓ 与 SSOT 实测一致（22 行=可切全自动、41 行=三档分级） |
| **F3（G-2 文案）** | 行 178「**剩下的差距只有「撤回」**：投递之后的引导收不回…」（已删掉「不知道在等什么」前提）；行 179「撤回并入 G-1 的能力…排队项的单条删除已有实现（`ai-agent.js:2027` `dropQueued`），不需要新做」 | **已修正** ✓ `2027`/`2053` 的 `dropQueued` 我已在 §2.1/R2 读到原文 |
| **F4（授权作用域口径）** | 行 239「授权**跨重启存活**，只能靠 `/clear`（`ai-host.js:2313` 清空全部）或 `/grants`（`1947-1966` 单个撤销）**显式清掉**」 | **已修正** ✓ 与我 §4 F4 给的现状一致（grants 随会话落盘：`138`/`1235`） |
| 新增 §3.4「文档项（S-1~S-6，单列、不占 P0 名额）」（行 320-331） | 其 6 条引用的锚点（SSOT 第 5/188/205 行、`probe-core.js:5`、`ai-host.js:63-64`、`context-meter.js:30-38`、SSOT 第 22+41 行、`server.js:1469/1486/1501/1868`、`ai-host.js:1895`、SSOT 第 205-208 行、`ai-host.js:2345-2355`/`2409`/`2411`）**全部是我在 §2.3 已逐条读过原文的同一批锚点** | passed（无新增未核锚点）；「不计入 P0 名额」属计数口径声明，不是事实断言 |

### 11.3 仍未修（以我取哈希时的修订 C 为准）

- **F1 未修**：行 168 原文照旧——「→ 只有 `ai-agent.js:296` 一句错误提示文案…命中了「重发」，**无任何实现**」。正确现状见 **§4 F1**（同一条正则实际命中 5 处：`ai-agent.js:13/14/20/296`、`ai-host.js:407`；结论「无实现」仍成立）。
- **F5 未修**：行 11（§0 第 2 条）、行 148（§3.1 G-5 行）、行 221（缺口 2 正文）、行 300（§3.3.1）、行 311（§3.3.2 第 2 项）均仍主张「被取消的调用被记成『未执行』」。正确现状见 **§9.4**：在飞的那条记的是 `1737-1741` 的诚实回执（`1915-1916` 即入账）；「未执行」只发给从未开始的调用，且**不进界面**（`appendUnexecutedToolResults` 不发 `onTool`；`visibleMessages` 丢弃 role 为 tool 的消息）→ **措辞与账目不矛盾**；行 223 的最小修法已由 `1916` 实现。**这是 P0 第 2 项的机理，建议优先处理。**

### 11.4 使用须知与边界

- 本轮只读复核：`git status --short` 仍只有 `?? .agent-teams/`、`?? audit/`；只改本文件（`audit/verification.md`）。
- **REPORT.md 是活文件**：本会话内已观察到 A→B→C 三次内容。`audit/REPORT.md` 未被 git 跟踪，故**无法**用 diff 复核「除我抽查的段外是否还有别的改动」——我只按**行号抽查**了 §0、§2.3 #10、§2.4 S-4、§3.1、§3.3.2、§3.4、G-2、G-6 等处，「§2 其余未动」**不是**我的确证结论。
- 因此：§2 的 66 条锚点核验**对应修订 A**（A→C 的改动未触及被审计的源码文件本身，故源码锚点结论不受影响）；§11.2/§11.3 的判定**对应修订 C**。若 t6 评审时哈希再变，只需重核 F1 与 F5 两处（其余为已修正项）。

---

## 12. 定点重核（t9）：修订版 F1-F5 与 P0 口径

### 12.1 新基线（后续任何改写的比对锚点）

| 项 | 值 |
|---|---|
| `audit/REPORT.md` SHA256 | `A0FFE89555B343EDCE2F7A7D328BE2C1536BCE040FD7ACD7350BC639044E1F6C` |
| 行数 / 字节 | **369 行** / 61597 字节 |
| 快照稳定性 | 取哈希 → 逐条核验 → 再取哈希，两端一致（核验期间文件未变） |
| 上一基线（§11 的修订 C） | `EA096221F049118756A960945E182B48D77273B0C151E3D6EE6F3AB715FF54CD`（369 行） |

⚠️ **§11 中被本次修订取代的判定**：§11 记「F5 未修」——在本次快照（A0FFE895）里 **F5 已关闭**（见 12.2）。另注意修订仍在进行：我在同一次核验中先后读到 §3.3.1 的「两个漏点」（旧）与「一个漏点」（新），说明两次落盘之间有编辑发生；下文一律以 A0FFE895 为准。

### 12.2 F1-F5 逐条判定（判定依据 = 我实读到的当前行 + 我复跑的 grep，不采信作者转述）

| 编号 | 判定 | 我实读到的改动行 | 独立复核 |
|---|---|---|---|
| **F1**（G-1 命中集合） | **not closed** | 行 169：「…全量 grep `重新生成\|重发\|…` → **只有 `ai-agent.js:296` 一句**错误提示文案（「点『停止』…然后重发一次需求」）命中了「重发」，**无任何实现**」 | 我复跑同一正则：`ai-agent.js` **4 处**（13/14/20/296）+ `ai-host.js` **1 处**（407）= **5 处** → 「只有一句」仍不成立（「0 实现」的结论不受影响） |
| **F2**（SSOT 行号） | **closed** | 行 110（§2.3 第 10 行）：「（SSOT **第 22 行** + **第 41 行**）…」；行 132（S-4）：「SSOT **第 22 行**（要素表：「可切『全自动』」）+ **第 41 行**（现状对照：「三档风险分级…」）」；行 329（§3.4 的 S-4 行）：「SSOT 第 22 行 + 第 41 行」 | 与 SSOT 实测一致（22 行=可切全自动、41 行=三档分级），见 §4 F2 |
| **F3**（G-2 文案） | **closed** | 行 179：「**剩下的差距只有「撤回」**：投递之后的引导收不回，也不能把排队里的一条改掉重发」；行 180：「撤回并入 G-1 的能力…排队项的单条删除已有实现（`ai-agent.js:2027` `dropQueued`），不需要新做」 | 旧前提整段 0 命中（grep `等待投递` / `将在当前这一步结束后投递`）；`dropQueued` 在 2027/2053 我已读原文 |
| **F4**（G-6 缺口 4 口径） | **closed** | 行 239：「…而授权**跨重启存活**，只能靠 `/clear`（`ai-host.js:2313` 清空全部）或 `/grants`（`1947-1966` 单个撤销）**显式清掉**…」 | 与我 §4 F4 给出的正确现状一致（grants 随会话落盘：138/1235） |
| **F5**（G-5 缺口 2） | **closed** | 四处旧引用**全部 0 命中**：§0（grep「被取消的调用被记成「未执行」」）、§3.1 G-5 行（grep「记成「未执行」」）、§3.3.1（grep「取消后记账不实」）、§3.3.2 第 2 项（grep「报成「未执行」」）；改由 §3.2 行 221 起「**已排除（t5 F5 证伪 + 本人复核）**」段落承接 | 该段引用的 8 个锚点（1913 / 1915-1916 / 1934 / 302 / 294 / 155-178 / 160-161 / 1928-1930）**都是我 §9.4 已核过的同一批**，无新增未核锚点；另：G-5 标题（行 199）已改为「发现 1 个真缺陷（缺口 1）」，§3.1 G-5 行（149）改为「缺取消回执、宿主继续干等到写盘返回」（采用我 §9.3 的边界精化） |

> 任务书里的「行 11/146/309」是修订 A 的行号；我一律按**内容**定位，四处（§0 / §3.1 G-5 行 / §3.3.1 / §3.3.2）在当前版均已清除。

### 12.3 【新发现 N1】G-3 的命中口径被改错（夹带了一条不成立的断言）

- 当前行 185 原文：「对 `ai-agent.js` grep `@\|提及\|引用\|attach\|附件\|图片\|粘贴\|paste\|clipboard\|拖拽\|drop` → **5 处命中，其中 4 处为无关注释**（t5 复现口径）；本人按同组关键词复跑得同样这批无关命中（`1089` diff 的 `@@`、`1826` 剪贴板复制、`2027`/`2053` 的 `dropQueued`），单搜 `@` 也只有 `1089` 一处。」
- 我复跑该正则（同一文件、同一引擎）：**4 处** —— `1089`（diff 的 `@@`）、`1826`（clipboard）、`2027`、`2053`（dropQueued）。→ **(a)「5 处命中」不成立**；**(b) 该句自己只列出 4 个行号，自相矛盾**。
- **(c)「（t5 复现口径）」是误挂**：我给出的「5 处」是 **G-1 那条正则**的结果（`ai-agent.js` 13/14/20/296 + `ai-host.js:407`），不是 G-3 这条正则的结果。
- **(d) 这是回归**：修订前 G-3 原文是「命中仅 **4 处**且全部无关」——我在 §3（R2）判定它**正确**；本次改动把一处正确的表述改错了，而它想修的那处（G-1 行 169）原样未动。
- 「单搜 `@` 也只有 `1089` 一处」→ 我复跑 = **1 处**，✓ 正确。结论句「没有 @ 引用实现 / 0 实现不变」✓ 不受影响。
- **建议**：G-3 恢复为「4 处命中、全部无关」；把「5 处（其中 4 处无关）」这句挪到它真正该在的位置——**G-1 行 169**（那才是 F1）。

### 12.4 未夹带新断言：被改句子逐句溯源

| 被改/新增的句子 | 依据来源 | 判定 |
|---|---|---|
| G-2 行 178-180（差距只剩「撤回」；`dropQueued` 已有） | t5 F3 + 我 §2.1 对 2027/2053 的实读 | 有据 ✓ |
| G-5 行 215-216（不取消 / 干等 / 缺回执；「不是多执行了一次工具」） | t5 §9.3 的边界精化（我的判词） | 有据 ✓ |
| G-5 行 219（P0：两行参数 + 一处调用点改写，不新增机制） | t5 F5 / §9.3-§9.4 | 有据 ✓ |
| G-5 行 221-225「已排除」段（含 8 个锚点） | t5 §9.4（同一批锚点，无新增） | 有据 ✓ |
| §3.1 行 141-142（P0 定义与计数口径） | 口径声明（计数约定，非事实断言） | 有据 ✓ |
| §3.4 行 320-331（S-1~S-6 小表） | 我 §2.3/§2.4 已核过的同一批锚点 | 有据 ✓（无新锚点） |
| G-6 行 239（跨重启存活、2313、1947-1966） | t5 F4 | 有据 ✓ |
| §2.3 #10 行 110 / S-4 行 132（SSOT 22+41） | t5 F2 | 有据 ✓ |
| **G-3 行 185 的「5 处命中…（t5 复现口径）」** | **无**（不属于 t5 F1-F5、也不属于 t6 R1-R8 的任何一条） | **夹带 ✗（即 N1）** |

→ 除 N1 外，未发现其他夹带；其余改动均可逐句回到 t5 findings。

### 12.5 P0 口径实测（§0 / §3.1 / §3.2 / §3.3 四处）

- **§3.1 口径声明**（行 141-142）：「P0 = 用户可直接感知 + 改动成本最小…按**条目**计数…上限 5 条，**只统计交互项**」；「**本版 P0 = 3 条交互项**：G-1、G-5、G-10(a)(b)」；「文档项 S-1~S-6 单列在 §3.4，**不计入 P0 名额**」。
- **§3.1 表**：`G-1`（行 148）、`G-5`（149）、`G-10(a)(b)`（150）三行标 **P0**；其余为 P1/P2/取舍。
- **§3.2**：G-1 行 173 **P0**；G-5 行 219 **P0（第 2 项）**；G-10 行 280 **P0（第 3 项）**；G-11、G-10(d) 为 **P1**、G-2 为 **P2**（未越级）。
- **§3.3.1** 行 299：「中断链路**有一个漏点**（审批续跑不吃取消）」✓ 与「G-5 只剩缺口 1」一致，不再出现「记账不实」。
- **§3.3.2**（行 306-317）：1 G-1 / 2 G-5 / 3 G-10(a)(b) / 4 G-6 / 5 G-8 / 6 G-10(d) / 7 G-11 / 8 G-7 / 「—」S-1~S-6（注明不占名额）。
- **计数**：P0 = **3 条 ≤ 5** ✓；P0 **成员**在 §3.1 表、§3.2、§3.3.2 三处完全一致 ✓。
- **一处措辞提醒（不是事实错误，供 t8 判断）**：§0 的标题是「最该补的 **3 件事**」，其 3 条**不等于** 3 条 P0——第 2 条同时含 G-5 与 G-10(a)(b)（两条 P0），第 3 条是 G-6（**P1**）+ S-1~S-6（文档项，不计 P0）。因此 §3.3.2 头部「1~3 项与 §0 的三件事同序」按**字面逐条**对不上（§3.3.2 的 #3 = G-10(a)(b)，对应的是 §0 的**第 2 条**；§0 第 3 条对应 §3.3.2 的 #4 与表末「—」行）。建议改为「前 3 项即 §3.1 的 3 条 P0」（一句话级）。

### 12.6 本轮只读复核

```
PS> git status --short
?? .agent-teams/
?? audit/

PS> (Get-FileHash audit/REPORT.md -Algorithm SHA256).Hash
A0FFE89555B343EDCE2F7A7D328BE2C1536BCE040FD7ACD7350BC639044E1F6C
```

- 只改本文件（`audit/verification.md`）；未触碰 `audit/REPORT.md`；未改任何插件源码；未执行任何 git 写操作。
- 复跑证据（供审计）：`只有 ai-agent.js:296 一句` → 1 命中（行 169，F1 未闭）；`5 处命中，其中 4 处为无关注释` → 1 命中（行 185，N1）；F5 四条标记（`被取消的调用被记成「未执行」` / `记成「未执行」` / `取消后记账不实` / `报成「未执行」`）→ 各 0 命中。

**t9 结论**：**F2/F3/F4/F5 已 closed**（改动行逐条复核、无新增未核锚点）；**F1 not closed**（行 169 原样），且本次改动**新引入 N1**（G-3 行 185 的「5 处命中」不成立且误挂 t5 口径）→ 修复方向：G-3 恢复「4 处、全部无关」，把 5 处结论写进 G-1。P0 计数与成员一致（3 条 ≤ 5），仅 §3.3.2 头部的「同序」措辞需微调。

---

## 13. 基线更正后的补充判定（t9 续 · captain 指令：两处待判）

### 13.1 基线确认（我独立取哈希，与 captain 一致）

| 项 | 值 |
|---|---|
| SHA256 | `A0FFE89555B343EDCE2F7A7D328BE2C1536BCE040FD7ACD7350BC639044E1F6C` |
| 行数 / 字节 / 写入时间 | **369 行** / 61597 字节 / **2026-09-14 11:57:09** |
| 与 §12.1 的关系 | 与 §12 记录的基线**同一个哈希**（未再变动），本节判定全部以此版为准 |

**行号校正（给后续编辑者，避免按错行去改）**：§0 的 F5 复述在 **行 11** ✓；§3.1 汇总表的 **G-5 行在 149**（不是 148——148 是 G-1 行）；§3.3.1 的判定行在 **300** ✓；§3.3.2 第 2 项在 **311** ✓。（captain 消息里的「行 148」应为 149，其余一致。）

### 13.2 待判 1 · F1 —— **not closed**

- **我实读到的行 169 原文**：「对 `ai-agent.js`、`ai-host.js` 全量 grep `重新生成|重发|编辑消息|改写|fork|regenerate|resend|rewind|checkpoint|恢复到这一步` → **只有 `ai-agent.js:296` 一句**错误提示文案（「点『停止』…然后重发一次需求」）命中了「重发」，**无任何实现**。」
- **我复跑同一正则**：`ai-agent.js` **4 处**（13/14/20/296）+ `ai-host.js` **1 处**（407）= **5 处**。
- ⇒ 「**只有一句命中**」仍错 → **F1 = not closed**（结论「0 实现 / 无任何实现」不受影响，无需改动）。
- **附（与 §12.3 的 N1 联动）**：本次修订把 F1 的口径写到了别处——**G-3 行 185**「5 处命中，其中 4 处为无关注释」，而该正则实际只有 **4 处**（1089/1826/2027/2053）⇒ G-1 漏改 + G-3 改错（回归），两处应互换。

### 13.3 待判 2 · 行 5 的「修订记录」——**对自身 provenance 的陈述不实，not closed**

- **我实读到的行 5 原文（逐字）**：「> 修订记录：本版已吸收 verifier 的定点发现 **F1–F5**（落点：§3.1 汇总表、§3.2 的 G-2 / G-3 / G-5、§3.3.2、§3.4 文档项、§5 不确定项）——其中 **F5 证伪了早前 G-5「缺口 2」**，已改写为 §3.2 的「已排除」说明，P0 只保留「审批续跑不吃取消」这一条。本版行数与 SHA256 见交付说明。」
- **逐项核对（全部用我自己的实读/复跑，不采信该句自述）**：

| 该句声称 | 我核到的实况（本版 A0FFE895） | 判定 |
|---|---|---|
| F2 已吸收 | 行 110 / 132 / 329 = 「SSOT **第 22 行** + **第 41 行**」 | ✓ 属实 |
| F3 已吸收 | 行 179「剩下的差距只有「撤回」」+ 行 180「`ai-agent.js:2027` `dropQueued`」；旧前提 0 命中 | ✓ 属实 |
| F4 已吸收 | 行 239「授权**跨重启存活**，只能靠 `/clear`（`2313`）或 `/grants`（`1947-1966`）显式清掉」 | ✓ 属实 |
| F5 已吸收 | §0 / §3.1 G-5 行 / §3.3.1 / §3.3.2 四处复述 grep **各 0 命中**；§3.2 行 221 起为「已排除（t5 F5 证伪 + 本人复核）」 | ✓ 属实 |
| **F1 已吸收** | 行 169 **原样未改**（仍是「只有…一句」）；F1 的口径反而落到 G-3（行 185，即 N1） | **✗ 不成立** |
| 落点含「§5 不确定项」 | §5 里与之相关的是**第 10 条（行 365）两处过期注释**，它源自我的 **F6**（见 §10.2），**不属于 F1–F5** | 归属不准（把 F6 并入 F1–F5 的落点清单） |

- ⇒ **行 5 = not closed（不实陈述）**：该文件声称自己吸收了 F1–F5，而 F1 恰恰没有吸收，且报告正文（行 169）与该声明直接冲突。
- **正确的写法**：本版吸收 **F2–F5**（并另吸收 **F6** → §5 第 10 条）；**F1 未吸收**（G-1 行 169 待改）；G-3 行 185 的「5 处命中」是误落，应改回「4 处、全部无关」。
- **为什么要修**：这是**文件对自身来源的陈述**——t8 评审与后续任何读者（含接手维护的模型）会据此认定 F1 已处理，从而永久漏掉它；比一条措辞错误危害更大。
- **一处附带措辞风险（不是事实错误）**：行 5 末「P0 只保留「审批续跑不吃取消」这一条」若脱离上下文，可能被读成「全报告只剩 1 条 P0」。结合 §3.1 行 141-142（本版 P0 = 3 条交互项：G-1、G-5、G-10(a)(b)）并不矛盾，但建议写成「**G-5 的 P0 只保留缺口 1**」以免歧义。

### 13.4 本轮只读复核

```
PS> git status --short
?? .agent-teams/
?? audit/

PS> (Get-FileHash audit/REPORT.md -Algorithm SHA256).Hash   # 369 行 / 61597 字节 / 2026-09-14 11:57:09
A0FFE89555B343EDCE2F7A7D328BE2C1536BCE040FD7ACD7350BC639044E1F6C
```

- 只改本文件（`audit/verification.md`）；未触碰 `audit/REPORT.md`；未改任何插件源码；未执行 git 写操作。

**13 节结论**：两处待判**均为 not closed** ——（1）**F1**：行 169 未改，口径被误落到 G-3 行 185（N1）；（2）**行 5 的修订记录**：自称吸收 F1–F5，与实际不符（F2–F5 属实、F1 未吸收、§5 落点实属 F6）。其余验收项（P0 四处口径一致、计数 3 ≤ 5、未夹带其他新断言、新基线哈希）见 §12。

---

## 14. 终局定点复核（t12）：t10 的 6 处修复

### 14.1 终局基线（后续任何改写的比对锚点）

| 项 | 值 |
|---|---|
| SHA256 | `76E2AD4DF8DA60832B505EE5CE8FA878A9C2106F90FC274CE243DDBBB9A70DAC` |
| 行数 / 字节 / 写入时间 | **371 行** / 61687 字节 / 2026-09-14 12:00:07 |
| 与 t10 自述是否一致 | ✓ 一致（t10 报 371 行 / 76E2AD4D…），我独立取哈希核对 |
| 更早基线 | v2 = `A0FFE895…`（369 行 / 61597 字节，见 §12.1、§13.1） |

### 14.2 两条正则：我自己复跑（本轮重点，防「改错地方」回归）

```
PS> # G-1 组正则（报告行 169 声称 5 处）
grep -n "重新生成|重发|编辑消息|改写|fork|regenerate|resend|rewind|checkpoint|恢复到这一步" ai-agent.js
  13, 14, 20, 296   -> 4 处
grep -n "<同一条正则>" ai-host.js
  407               -> 1 处
G-1 合计 = 5 处   ✓ 与行 169 的「5 处命中（ai-agent.js:13/14/20/296 + ai-host.js:407）」逐一对上

PS> # G-3 组正则（报告行 185 声称 4 处）
grep -n "@|提及|引用|attach|附件|图片|粘贴|paste|clipboard|拖拽|drop" ai-agent.js
  1089, 1826, 2027, 2053  -> 4 处   ✓ 与行 185 的「4 处命中，全部无关（1089 / 1826 / 2027 / 2053）」逐一对上
grep -n "@" ai-agent.js
  1089               -> 1 处   ✓ 与「单搜 @ 也只有 1089 一处」对上
```

- 两条正则的**命中数**与**命中行号**都与正文逐一吻合；上一轮那类「改错地方」的回归**未再出现**（另见 14.4 残留扫描）。

### 14.3 六处逐条判定（判定依据 = 我实读到的行 + 我复跑的正则）

| # | 处 | 判定 | 我实读到的行 / 复核 |
|---|---|---|---|
| ① | **行 169（F1）** | **closed** | 「…→ **5 处命中**（`ai-agent.js:13/14/20/296` + `ai-host.js:407`），其中 4 处为无关注释，仅 `296` 是提示文案；**无任何实现**。」| 我复跑 = 5 处且行号完全一致（14.2）；结论「0 实现」保留 |
| ② | **行 185（N1 回退）** | **closed** | 「…→ **4 处命中，全部无关**（`1089` diff 的 `@@`、`1826` 剪贴板复制、`2027`/`2053` 的 `dropQueued`），单搜 `@` 也只有 `1089` 一处。**没有任何 @ 引用/文件提及实现 —— 结论「0 实现」不变。**」| 我复跑 = 4 处（1089/1826/2027/2053）+ 单搜 @ = 1 处；「t5 复现口径」残留 grep = **0**；「5 处命中，其中 4 处」残留 grep = **0** |
| ③ | **行 151（§3.1 G-6 行，N3）** | **not closed（验收口径未满足）** | 现状：「…授权**跨重启存活**，只能靠 `/clear` 或 `/grants` 显式清掉（`1897` 文案却说「本次任务内」）」——**只有 `/grants` 这个词，没有 `1947-1966` 行号锚点**（`/clear` 的 `2313` 同样缺） | 验收明确要求「行 151 补上 /grants 1947-1966」→ 未满足。**正确现状**：事实陈述**正确**（与 §3.2 G-6 缺口 4 的「`/clear`（`ai-host.js:2313` 清空全部）或 `/grants`（`1947-1966` 单个撤销）」一致，我已核过 2313/1947-1966），缺的只是汇总表行里的锚点；建议补成「/clear（`ai-host.js:2313`）或 /grants（`1947-1966`）」 |
| ④ | **行 5（provenance）** | **closed（主句属实）**，附 2 处精度问题 | 原文未变：「本版已吸收 verifier 的定点发现 **F1–F5**（落点：§3.1 汇总表、§3.2 的 G-2 / G-3 / G-5、§3.3.2、§3.4 文档项、§5 不确定项）…」| **主句现在为真**：F1 已在行 169 收口（①），F2–F5 早前已闭（§12.2）→ 我 §13.3 判的「不实陈述」**因 F1 修好而自动消解**。**残留精度问题**：(a) 落点清单**漏列 §3.2 的 G-1**（F1 的实际落点）；(b) 「§5 不确定项」那处是 **F6**（两处过期注释，§5 第 10 条/行 365），不属于 F1–F5 |
| ⑤ | **版本行（行 371）** | **not closed（未含本版数字、易混）** | 现行原文：「*修订记录：v3 · 369 行 · SHA256 `A0FFE895…` · 2026-09-14（上一版 v2 冻结基线；本版 v3 的最终行数与哈希见交付说明，本行每次修订覆盖）*」| 它给出的 369/A0FFE895 **确为上一版 v2 的真实数字**（我 §12.1/§13.1 记过）✓；但它把 **v3** 与 **v2 的数字**并排写（"v3 · 369 行 · A0FFE895"），本版真实值 **371 行 / `76E2AD4D…`** 反而只存在于外部「交付说明」里——正是 t10 想避免的那种混淆仍在。**正确现状**：建议改为「v3 · **371 行** · SHA256 `76E2AD4DF8DA60832B505EE5CE8FA878A9C2106F90FC274CE243DDBBB9A70DAC`（上一版 v2：369 行 / `A0FFE895…`）」 |
| ⑥ | **§3.3.2 头部（行 306）** | **not closed（t10 自述未改）** | 现行原文未变：「#### 3.3.2 建议顺序（含判据归属；P0 见 §3.1 定义，**1~3 项与 §0 的三件事同序**）」| 残留 grep「与 §0 的三件事同序」= **1 命中（行 306）**。**正确现状**：§0 的 3 条 ≠ 3 条 P0（§0 第 2 条含 G-5 与 G-10(a)(b) **两条** P0；第 3 条是 G-6（**P1**）+ S-1~S-6 文档项），故按字面逐条对不上；建议改为「**前 3 项即 §3.1 的 3 条 P0**」 |

**小计**：**closed 3 处**（① 行 169、② 行 185、④ 行 5 主句）；**not closed 3 处**（③ 行 151 缺锚点、⑤ 版本行未含本版数字、⑥ §3.3.2 头部措辞未改）。其中 ③④⑤ 均**不是事实错误**（事实都对），全部是「锚点/数字/措辞」级别的补全。

### 14.4 未夹带新断言：本轮被改句子逐句溯源

| 被改句子 | 依据来源 | 判定 |
|---|---|---|
| 行 169「5 处命中（`ai-agent.js:13/14/20/296` + `ai-host.js:407`），其中 4 处为无关注释，仅 `296` 是提示文案」 | t5 F1（§4 F1）+ 我本轮复跑（14.2） | 有据 ✓（数字与行号均实测一致） |
| 行 185「4 处命中，全部无关（1089 / 1826 / 2027 / 2053）；单搜 @ 只有 1089」 | t5 §3 R2 + t5 §12.3（N1）+ 我本轮复跑 | 有据 ✓（实测一致） |
| 行 151「授权跨重启存活，只能靠 /clear 或 /grants 显式清掉（1897 文案却说「本次任务内」）」 | t5 F4（§4 F4）+ §13.1 | 有据 ✓（仅缺锚点，非新断言） |
| 行 371 版本行「v3 · 369 行 · A0FFE895（上一版 v2 冻结基线）」 | 我 §12.1 / §13.1 的基线记录（369/A0FFE895 确为上一版） | 数字属实 ✓，但未给本版数字（不完整，见 14.3 ⑤） |
| 行 5（未改） | — | 本轮无改动；其主句因 ① 而变真（14.3 ④） |

→ **本轮未发现新断言**：所有改动句都能回到 t5 的 F1/F4 与 t5 §12.3(N1) 的实测量；未出现 t5/t8 findings 之外的新事实主张。

### 14.5 只读复核

```
PS> git status --short
?? .agent-teams/
?? audit/

PS> (Get-FileHash audit/REPORT.md -Algorithm SHA256).Hash   # 371 行 / 61687 字节 / 2026-09-14 12:00:07
76E2AD4DF8DA60832B505EE5CE8FA878A9C2106F90FC274CE243DDBBB9A70DAC
```

- 只改本文件（`audit/verification.md`）；未触碰 `audit/REPORT.md`；未改任何插件源码；未执行 git 写操作。

**t12 结论**：t10 最关键的两处（**F1 行 169 / N1 行 185**）**改对了地方、数字也对**——我复跑的两条正则（G-1=5 处、G-3=4 处）与正文逐一吻合，**上一轮的「改错地方」回归未再出现**。剩余 3 处 not closed 均为补全类：行 151 缺 `/grants 1947-1966` 锚点、行 371 版本行未含本版（371 / `76E2AD4D…`）、行 306 的「1~3 项与 §0 三件事同序」措辞。终局基线：**371 行 · SHA256 `76E2AD4DF8DA60832B505EE5CE8FA878A9C2106F90FC274CE243DDBBB9A70DAC`**。

---

### 14.6 修订漂移与再判定（**必读：报告在我核验期间又变了一次**）

我在 §14.3 做出判定后、写完本节前，`audit/REPORT.md` 又被写了一次：

| 时点 | SHA256 | 行数 / 字节 / 写入时间 |
|---|---|---|
| t10 交付版（我 §14.1-14.5 针对的版本） | `76E2AD4DF8DA60832B505EE5CE8FA878A9C2106F90FC274CE243DDBBB9A70DAC` | 371 行 / 61687 字节 / 12:00:07 |
| **当前版（本节判定依据）** | **`CBFEA37839DF80E693AE784E1BF85C3F6EF2DCCE26CDF018829515A461A07099`** | **371 行 / 61840 字节 / 12:00:53** |

**§14.3 中 3 处 not closed 的当前状态（以 CBFEA378 为准）**：

| # | 处 | §14.3 判定（针对 76E2AD4D） | 当前判定（CBFEA378） | 我实读到的当前行 |
|---|---|---|---|---|
| ③ | 行 151（§3.1 G-6 行） | not closed（缺锚点） | **closed** ✓ | 「…授权**跨重启存活**，只能靠 `/clear`（`ai-host.js:2313`）或 `/grants`（`1947-1966`）显式清掉（`1897` 文案却说「本次任务内」）」——两个锚点都已补上，且与我实测（2313 清 grants、1947-1966 `/grants` 单键撤销）一致 |
| ⑥ | 行 306（§3.3.2 头部） | not closed（措辞未改） | **closed** ✓ | 「#### 3.3.2 建议顺序（含判据归属；P0 见 §3.1 定义，**前 3 项即 §3.1 的 3 条 P0**）」——残留 grep「与 §0 的三件事同序」= **0 命中**；采用的正是我 §12.5 的建议措辞 |
| ⑤ | 行 371（版本行） | not closed（未含本版数字） | **仍未 closed** | 原文未变：「*修订记录：v3 · 369 行 · SHA256 `A0FFE895…`（上一版 v2 冻结基线；本版 v3 的最终行数与哈希见交付说明…）*」——**仍把 v3 与 v2 的数字（369 / A0FFE895）并排写**，本版真实值（**371 行 / `CBFEA378…`**）在文件内仍查不到 |

**同时，行 5 已被改写**（我 §14.3 ④ 的精度意见部分被采纳）：

- 当前行 5 原文：「> 版本 **v3** · 2026-09-14 · 本版吸收 verifier 定点发现 **F1–F5**（F1 于 v3 收口；落点：§3.1 汇总表、§3.2 的 G-2 / G-3 / G-5、§3.3.2、§3.4 文档项、§5 不确定项）＋ 第 2 轮评审发现 **N1–N4**；**核验基线哈希见交付说明**（上一版 v2 = 369 行 / SHA256 `A0FFE895…`）。其中 **F5 证伪了早前 G-5「缺口 2」**…」
- 判定：**主句属实** ✓（F1–F5 确已吸收：「F1 于 v3 收口」与行 169 一致；v2 = 369 行 / `A0FFE895…` 也与我 §12.1/§13.1 的记录一致）。
- **两处仍需注意（不是事实错误，是可核验性）**：
  1. 落点清单**仍漏 §3.2 的 G-1**（F1 的实际落点就是行 169 的 G-1），且仍含「§5 不确定项」——那一处是 **F6**（§5 第 10 条 / 行 365），不属于 F1–F5；
  2. 新增的「＋ 第 2 轮评审发现 **N1–N4**」是**评审方编号**：我只认领 **N1 = G-3 口径（本轮已回退 ✓）**，N2–N4 的内容与落点由 t8/t11 定义，**文件里既没列内容也没列落点，我无法核验**——属「声称已吸收但不可核」的笼统声明，建议补一句落点（或在交付说明里给出映射）。

**再判后的汇总（当前版 CBFEA378）**：**closed 4 处**（① 行 169、② 行 185、③ 行 151、⑥ 行 306）＋ **closed（主句）但附可核验性注记 1 处**（④ 行 5）＋ **not closed 1 处**（⑤ 行 371 版本行）。

**终局基线（我最后一次取哈希）**：**371 行 · SHA256 `CBFEA37839DF80E693AE784E1BF85C3F6EF2DCCE26CDF018829515A461A07099` · 61840 字节 · 2026-09-14 12:00:53**。⚠️ 本会话内该文件已被写入 5 次以上（`3E6E71A6` → `384F5A4D` → `EA096221` → `A0FFE895` → `76E2AD4D` → `CBFEA378`）；**任何结论、行号与数字都必须带哈希使用**，哈希不符时本节判定（尤其 line:行号）不可直接沿用。

**唯一未关闭项的正确现状（⑤）**：文件末行应写成本版自身的数字，例如「修订记录：v3 · **371 行** · SHA256 `CBFEA37839DF80E693AE784E1BF85C3F6EF2DCCE26CDF018829515A461A07099`（上一版 v2：369 行 / `A0FFE895…`）」；当前写法把 v3 与 369/`A0FFE895` 并排，读者无法从文件内部确认本版身份。

---

### 14.7 最后一次漂移（12:01:32）与**当前版**的最终判定

报告在我写 §14.6 期间又写了一次，故 §14.6 的行号与基线同样已被取代：

| 时点 | SHA256 | 行数 / 字节 / 写入 |
|---|---|---|
| t10 交付版（§14.1-14.5） | `76E2AD4D…` | 371 / 61687 / 12:00:07 |
| §14.6 依据版 | `CBFEA378…` | 371 / 61840 / 12:00:53 |
| **当前版（本节依据）** | **`B9CB68FBF46C53BAC130F15A8718014B9984A13FEFC7E9F4ED032524F1988CF1`** | **372 / 62047 / 12:01:32** |

**本次改动**：把原来的单行「修订记录」拆成**行 5 + 行 6**（并重写内容）⇒ 行 6 之后的**所有行号 +1**。因此前两节的 169/185/151/306/371 在本版依次为 **170 / 186 / 152 / 307 / 372**（我逐一 grep 复核过）。

**当前版六处判定（终）**：

| # | 处（本版行号） | 判定 | 我实读到的当前行 / 复核 |
|---|---|---|---|
| ① | **行 170**（F1） | **closed** ✓ | 「→ **5 处命中**（`ai-agent.js:13/14/20/296` + `ai-host.js:407`），其中 4 处为无关注释，仅 `296` 是提示文案；**无任何实现**」——我复跑正则 = 5 处、行号一致 |
| ② | **行 186**（N1 回退） | **closed** ✓ | 「→ **4 处命中，全部无关**（`1089`、`1826`、`2027`/`2053`），单搜 `@` 也只有 `1089` 一处」——我复跑 = 4 处 + 1 处；「t5 复现口径」「5 处命中，其中 4 处」残留均 0 |
| ③ | **行 152**（§3.1 G-6 行，N3） | **closed** ✓ | 「…授权**跨重启存活**，只能靠 `/clear`（`ai-host.js:2313`）或 `/grants`（`1947-1966`）显式清掉…」——两个锚点已补，grep `1947-1966` = [111][152][240] |
| ④ | **行 5 + 行 6**（provenance） | **closed（实质）**，附 2 处**新引入**的行号偏移 | 行 5 已重写：把 **F6 单列**（→ §5 第 10 条）✓、给了 **N1–N4 的落点** ✓、把「P0 只保留缺口 1」明确为「**G-5 的** P0」✓ —— 我 §13.3/§14.6 的三条意见均被采纳。**但**：行 5 里「N1–N4 … 见 … **§3.1 行 151**」应为 **152**；「全报告 P0 仍是 **§3.1 行 141-142**」应为 **142-143**（现 142 = P0 定义、143 = 本版 P0 三 条）。→ 行号各差 1，正是这次「拆行 +1」造成的自不一致 |
| ⑤ | **行 372**（旧版本行） | **not closed** ✗ | 原文未变：「*修订记录：v3 · 369 行 · SHA256 `A0FFE895…`（上一版 v2 冻结基线…）*」——**与新行 6 冲突**：行 6 已正确地写「版本 **v3** · 2026-09-14 · 核验基线哈希见交付说明（上一版 **v2** = 369 行 / `A0FFE895…`）」，而 372 仍把 v3 与 v2 的数字并排。**建议：直接删掉行 372**（行 6 已承担该职能），或将其数字换成 v2 的并去掉 v3 前缀 |
| ⑥ | **行 307**（§3.3.2 头部） | **closed** ✓ | 「…P0 见 §3.1 定义，**前 3 项即 §3.1 的 3 条 P0**）」——残留 grep「与 §0 的三件事同序」= 0 |

**关于「哈希见交付说明」的一点技术说明（给作者）**：文件**不可能**在正文里写出自己的最终 SHA256（写入哈希会改变内容 ⇒ 自指悖论）。所以「核验基线哈希见交付说明」是**正确做法**；版本行只需写「上一版哈希 + 本版行数」。行 6 已这么做 ✓，问题只在行 372 与它重复且措辞冲突。

**未夹带新断言（本版复核）**：本版只改了行 5/6 的叙述与既有条目；其内容我逐句对照过——F1 收口、F5 已排除、F6 → §5 第 10 条、N1–N4 落点、P0 口径，全部能回到 t5 findings（§4 F1/F4/F5、§12.3 N1、§10.2 F6）或 t8 评审编号；**未出现新的事实主张**（唯一缺陷是行 5 的两处行号偏移与行 372 的冗余冲突）。

**终局基线（t12 最后一次取哈希）**：**372 行 · SHA256 `B9CB68FBF46C53BAC130F15A8718014B9984A13FEFC7E9F4ED032524F1988CF1` · 62047 字节 · 2026-09-14 12:01:32**。

⚠️ **本会话内该文件已被写入 6 次**（`3E6E71A6` → `384F5A4D` → `EA096221` → `A0FFE895` → `76E2AD4D` → `CBFEA378` → `B9CB68FB`）。**冻结前请以哈希锁定**：任何行号/数字结论（含本节）在不匹配 `B9CB68FB…` 时都不可直接沿用。

**t12 最终判定汇总（当前版 B9CB68FB）**：**closed 5 处**（① 行 170、② 行 186、③ 行 152、④ 行 5/6 实质、⑥ 行 307）＋ **not closed 1 处**（⑤ 行 372，建议删除）。其中 ④ 附带 2 处行号偏移（151→152、141-142→142-143）属**自指行号**错，非事实主张错误。

---

### 14.9 基线更正指令的核对（captain 第三次：称磁盘 = CBFEA378 / 371 行）

**指令与磁盘实况不符。** 我按指令重新实测（只读）：

```
PS> (Get-FileHash audit/REPORT.md -Algorithm SHA256).Hash
B9CB68FBF46C53BAC130F15A8718014B9984A13FEFC7E9F4ED032524F1988CF1
PS> (Get-Content audit/REPORT.md).Count              -> 372
PS> (Get-Item audit/REPORT.md).Length                -> 62047
PS> (Get-Item audit/REPORT.md).LastWriteTime         -> 2026-09-14 12:01:32 (+0800)  = 04:01:32.2058Z
```

- 我记录的时间线：`76E2AD4D` **12:00:07**（371 行）→ `CBFEA378` **12:00:53**（371 行）→ **`B9CB68FB` 12:01:32（372 行）**。即 **CBFEA378 在 39 秒后就被覆盖**，**它不是当前磁盘版本**；captain 的基线判断落后一次写入。
- **若以 CBFEA378 冻结，冻结的是一个已被覆盖的版本**。我按只读约束**不会**去改/恢复 `REPORT.md`；要真正冻结 CBFEA378，需要作者把它恢复回去（t11 评审也应以实际哈希为准）。
- 「行 5 的修订记录与文末版本行**合并**」这一描述同样与磁盘不符：`B9CB68FB` 里行 5 被**拆成行 5 + 行 6**（修订记录正文 + 版本行），而**文末行 372 仍然存在**且内容冲突（仍写「v3 · 369 行 · `A0FFE895…`」）→ 实为**并存/重复**而非合并；这正是 §14.7 ⑤ 的未关闭项。

**两版的行号映射与判定（判定依据均为我实读 "CBFEA378" 或 "B9CB68FB"）：**

| # | 处 | CBFEA378（371 行，历史） | **B9CB68FB（372 行，磁盘当前）** | 磁盘当前版判定 |
|---|---|---|---|---|
| ① | F1（5 处命中） | 行 169 **closed** | **行 170** | **closed** ✓（我复跑 = 5 处：`ai-agent.js:13/14/20/296` + `ai-host.js:407`） |
| ② | N1 回退（4 处命中、无 t5 口径） | 行 185 **closed** | **行 186** | **closed** ✓（我复跑 = 4 处：1089/1826/2027/2053；单搜 @ = 1089） |
| ③ | §3.1 G-6 补 `/clear`+`/grants` 锚点 | 行 151 **closed** | **行 152** | **closed** ✓（`1947-1966` 命中 [111][152][240]） |
| ④ | 行 5（+版本说明）provenance | 行 5 **closed 实质** | **行 5 + 行 6** | **closed 实质** ⚠️ 含 2 处**自指行号偏移**：「§3.1 行 151」应为 **152**、「§3.1 行 141-142」应为 **142-143** |
| ⑤ | 文末版本行 | 行 371 **not closed** | **行 372** | **not closed** ✗（仍把「v3」与 v2 的数字 369/`A0FFE895` 并排，与行 6 冲突 → 建议**删除行 372**） |
| ⑥ | §3.3.2 头部措辞 | 行 306 **closed** | **行 307** | **closed** ✓（「前 3 项即 §3.1 的 3 条 P0」，残留 grep = 0） |

**正则复跑（本轮第三次执行，与报告版本无关，数字稳定）**：G-1 组 = **5 处**（`ai-agent.js` 13/14/20/296 + `ai-host.js` 407）；G-3 组 = **4 处**（`ai-agent.js` 1089/1826/2027/2053）；正文数字与**位置**（行号）均对得上 ✓。

**终局基线（以磁盘实测为准）**：**372 行 · SHA256 `B9CB68FBF46C53BAC130F15A8718014B9984A13FEFC7E9F4ED032524F1988CF1` · 62047 字节 · 2026-09-14 12:01:32**。
**历史版本**（仅作追溯，不得当作冻结基线）：`A0FFE895…`(369/11:57:09) → `76E2AD4D…`(371/12:00:07) → `CBFEA378…`(371/12:00:53)。

**磁盘当前版判定汇总**：**closed 5 处**（① 行 170、② 行 186、③ 行 152、④ 行 5/6 实质、⑥ 行 307）＋ **not closed 1 处**（⑤ 行 372）；另有 ④ 的 2 处自指行号偏移（151→152、141-142→142-143）需一并修。

---

### 14.10 第三次基线更正 + **冻结确认失败**：磁盘实际是 `4276EEF7`（371 行），不是 captain 宣布冻结的 `B9CB68FB`

captain 下达「B9CB68FB（372 行）为终局版本、文件已冻结」后，我按惯例先做冻结核验（只读），**结果磁盘已在 12:03:10 被再写一次**：

```
PS> (Get-FileHash audit/REPORT.md -Algorithm SHA256).Hash
4276EEF7947D43907F5E540B6465EC55582AE6AF2B5AAB05C4C9FA501BD4BB95
PS> (Get-Content audit/REPORT.md).Count   -> 371
PS> (Get-Item audit/REPORT.md).Length     -> 61893
PS> (Get-Item audit/REPORT.md).LastWriteTime -> 2026-09-14 12:03:10 (+0800)
```

**即：冻结令针对的 `B9CB68FB` 已不在磁盘上。** 本会话观察到的内容序列（8 个）：`3E6E71A6` → `384F5A4D` → `EA096221` → `A0FFE895` → `76E2AD4D` → `CBFEA378` → `B9CB68FB` → **`4276EEF7`（当前）**。

**这一版恰好把我 ⑤ 与 ④ 的余项都修掉了**（所以它比冻结令指定的版本更好，但仍必须重新宣布基线）：

| 我此前的未闭合项 | B9CB68FB 现状 | **4276EEF7 现状（磁盘）** |
|---|---|---|
| ④ 行 5 的 2 处自指行号偏移 | 「§3.1 行 151」「§3.1 行 141-142」 | **已改为段落式引用**（「§3.1 汇总表的 G-6 行」「§3.1 开头的 P0 定义段」）→ grep `行 151` = **0**、`行 141-142` = **0** ✓ |
| ⑤ 文末重复的版本行 | 行 372 仍在（与行 6 冲突） | **已删除** → grep `修订记录` 只剩 **[5]**；文件末为行 370「报告完」+ 空行 371 ✓ |

**六处终判（全部以 4276EEF7 实读为准）= 全部 closed：**

| # | 处（本版行号） | 判定 | 我实读到的当前行 / 复跑 |
|---|---|---|---|
| ① | 行 170（F1 5 处命中） | **closed** ✓ | 「→ **5 处命中**（`ai-agent.js:13/14/20/296` + `ai-host.js:407`），其中 4 处为无关注释，仅 `296` 是提示文案；**无任何实现**」——我复跑 = 5 处、行号逐一吻合 |
| ② | 行 186（G-3 4 处、无 t5 口径） | **closed** ✓ | 「→ **4 处命中，全部无关**（`1089`、`1826`、`2027`/`2053`），单搜 `@` 也只有 `1089` 一处」——我复跑 = 4 处；单搜 @ = 1 处（1089） |
| ③ | 行 152（§3.1 G-6 锚点） | **closed** ✓ | 「…只能靠 `/clear`（`ai-host.js:2313`）或 `/grants`（`1947-1966`）显式清掉…」 |
| ④ | 行 5 + 行 6（provenance） | **closed** ✓ | 行 5 段落式引用（无脆弱行号）、F6 单列、「**G-5 的** P0 只保留缺口 1（全报告 P0 仍是 §3.1 开头的 P0 定义段里的 3 条交互项）」；行 6「版本 **v3** · 2026-09-14 · 核验基线哈希见交付说明（上一版 v2 = 369 行 / `A0FFE895…`）」——与 §3.1 行 142-143 的「3 条交互项」一致 |
| ⑤ | 原文末版本行 | **closed** ✓ | 已删除（见上表）→ 与行 6 的冲突消失 |
| ⑥ | 行 307（§3.3.2 头部） | **closed** ✓ | 「…P0 见 §3.1 定义，**前 3 项即 §3.1 的 3 条 P0**）」 |

**F5 已排除块**仍在（grep 命中 [222]）；两条正则本轮**第四次**复跑结果不变：G-1 = 5、G-3 = 4。

**终局基线（以磁盘实测为准，建议据此重新宣布冻结）**：**371 行 · SHA256 `4276EEF7947D43907F5E540B6465EC55582AE6AF2B5AAB05C4C9FA501BD4BB95` · 61893 字节 · 2026-09-14 12:03:10**。

**流程建议（这次审计的教训）**：「冻结」必须在交付那一刻用哈希核验，而不是宣布；本会话 8 个内容中有 3 次（CBFEA378、B9CB68FB、4276EEF7）都发生在某次「已定稿」之后。若团队要的冻结件确实是 `B9CB68FB`，需要作者把它恢复回去（我按只读约束不会改该文件）；若接受当前内容，请把冻结令改挂到 `4276EEF7` 并复核一次哈希。

**t12 最终结论（4276EEF7）**：**6 处全部 closed，无遗留未闭合项**（§14.3/§14.6/§14.7/§14.9 中针对旧版本的 not-closed 判定均已被后续版本修掉）。

---

### 14.11 第九次写入（12:03:45）与「实质稳定」结论

§14.10 记完 `4276EEF7` 后，报告又在 **12:03:45** 被写一次：**`747C651EB4749AADABE9CCE583A274AD850FBF41F5A8964FCE844D8D981C157B` · 371 行 · 62105 字节**（比上一版 +212 字节，行数不变）。

**六处修复在这一版仍然全部成立**（逐条 grep + 实读，行号与文字均未变）：

| # | 处 | 复核实况 |
|---|---|---|
| ① | 行 170（F1） | 「**5 处命中**（`ai-agent.js:13/14/20/296` + `ai-host.js:407`）…仅 `296` 是提示文案；**无任何实现**」✓（正则复跑第五次仍 = 5 处） |
| ② | 行 186（G-3） | 「**4 处命中，全部无关**（`1089`、`1826`、`2027`/`2053`），单搜 `@` 也只有 `1089` 一处」✓（正则 = 4 处、单搜 @ = 1 处） |
| ③ | 行 152（§3.1 G-6） | 含「`/clear`（`ai-host.js:2313`）或 `/grants`（`1947-1966`）」✓ |
| ④ | 行 5 + 行 6 | 行 5 为段落式引用（无脆弱行号）、F6 单列、「**G-5 的** P0 只保留缺口 1（全报告 P0 仍是 §3.1 开头的 P0 定义段里的 3 条交互项）」；行 6「版本 **v3** · 核验基线哈希见交付说明（上一版 v2 = 369 行 / `A0FFE895…`）」✓ |
| ⑤ | 文末重复版本行 | **仍然不存在**（grep `修订记录` 只剩 [5]；末段为行 370「报告完」+ 行 371 空行）✓ |
| ⑥ | 行 307（§3.3.2 头部） | 「前 3 项即 §3.1 的 3 条 P0」✓ |

另：F5 的「已排除」块仍在 [222]。

**坦白的边界**：该文件未被 git 跟踪，我**无法做逐字节 diff**，所以「+212 字节改了哪里」我无法确证；我复核的是**六处修复 + 上述锚点行 + 关键短语**（均实读/复跑），**不是全文每一句**。

**结论（不改判，改为「跨版本稳定」表述）**：自 `B9CB68FB` 起的每一版（含当前 `747C651E`），**t12 的 6 处修复全部 closed**；漂移只发生在「版本记账两行 + 若干措辞」这类**非事实性**内容上。因此：
- **判定本身**不依赖具体哈希（六处均成立）；
- **行号与哈希**必须随版本走 —— 本文件 §14.3/§14.6/§14.7/§14.9/§14.10 里针对旧版的行号**仅供追溯**。

**最新实测基线**：**371 行 · SHA256 `747C651EB4749AADABE9CCE583A274AD850FBF41F5A8964FCE844D8D981C157B` · 62105 字节 · 2026-09-14 12:03:45**（§14.10 的 `4276EEF7` 已被它取代）。

**流程建议（重申，且已被验证两次）**：「冻结」请以**交付那一刻的哈希核验**为准；本会话该文件已被写入 **9 次**，其中至少 3 次发生在某次「已定稿/已冻结」之后。我按只读约束不介入其内容；如需再核，请给我目标哈希，我按点复核。

---

### 14.12 第十次写入（12:04:12）—— 停止逐版追哈希，改以「跨版本不变量」交付

**第十个内容**：`17DFD99E2BA053B38373A638CB5AFE4CA4913886C01A40C19FE61A0D226D0651` · 371 行 · 62049 字节 · 2026-09-14 12:04:12。

**六处修复在这一版仍然全部成立**（同一组 grep，行号全未变）：`5 处命中` → [5][170]；`4 处命中，全部无关` → [186]；`1947-1966` → [111][152][240]；`前 3 项即 §3.1 的 3 条 P0` → [307]；F5「已排除」块 → [222]；`修订记录` 仅 [5]（无重复版本行）。

**跨版本不变量（本文件的可交付结论）**：自 `B9CB68FB` 起，共 4 个内容（`B9CB68FB` → `4276EEF7` → `747C651E` → `17DFD99E`）**t12 的 6 处修复均为 closed**：

| # | 不变量（与哈希无关） | 复核方式 |
|---|---|---|
| ① | G-1 证据句写 **5 处命中**且列出 `ai-agent.js:13/14/20/296` + `ai-host.js:407` | 我复跑正则 5 次，结果恒为 5 处、行号一致 |
| ② | G-3 证据句写 **4 处命中、全部无关**（1089/1826/2027/2053），单搜 `@` 只有 1089 | 我复跑正则 5 次，结果恒为 4 处 + 1 处 |
| ③ | §3.1 的 G-6 行含 `/clear`（2313）与 `/grants`（1947-1966）锚点 | 直接实读 |
| ④ | 行 5 provenance 为**段落式引用**（无脆弱行号）、F6 单列、「G-5 的 P0 只保留缺口 1」 | 直接实读 + grep「行 151」/「行 141-142」= 0 |
| ⑤ | 文末**不再有**重复的旧版本行（`修订记录` 只出现在行 5） | grep |
| ⑥ | §3.3.2 头部为「前 3 项即 §3.1 的 3 条 P0」 | 直接实读 |

**我到此停止逐版追哈希**：该文件在本会话内已被写入 **10 次**，且**至少 4 次发生在「已定稿/已冻结」宣布之后**（`CBFEA378`、`B9CB68FB`、`4276EEF7`、`747C651E`、`17DFD99E`）。继续为每一版重记哈希对本审计没有边际价值 —— 因为**六处的判定不随版本变化**（上表），变化的只是**版本记账两行与若干措辞**（字节数 61893 / 62049 / 62105 之间抖动，行数 371）。

**交付口径（建议）**：
1. 交付时以**那一刻**的 `Get-FileHash` 作为基线哈希写进交付说明（本文件无法自含自身最终哈希，属自指悖论）；
2. 上表的**六条不变量**才是 t12 的可交付结论，行号请以交付版的实读为准；
3. 如需我复核某个具体哈希，请给出该哈希，我按点复核（不再对整个文件的每次写入重跑）。

**最新实测（仅供锚定，不作承诺）**：371 行 · `17DFD99E2BA053B38373A638CB5AFE4CA4913886C01A40C19FE61A0D226D0651` · 62049 字节 · 12:04:12。

---

## 15. t14 定点确认（captain 5 点清单 + 行 157 授权改格的时点注记）

### 15.1 取哈希时点（先给结论：**行 157 的改格已包含在本次版本内**）

- 我在本次复核**开始与结束各取一次哈希，两端一致**：`17DFD99E2BA053B38373A638CB5AFE4CA4913886C01A40C19FE61A0D226D0651` · **371 行** · 62049 字节 · **2026-09-14 12:04:12** → 复核窗口内文件未变。
- captain 授权的「§3.1 汇总表 G-3 行（行 157）就地改格」**已经落在这一版里**：我实读行 157 已是**新口径**——「…命中 **4 处、全部无关**（`1089`/`1826`/`2027`/`2053`）；单搜 `@` 只有 `1089` 一处 —— **0 实现**」。因此**本次复核 = 行 157 改写之后**（不是改写前）。
- 我把该格的新数字**当场复核**了一遍（正则第 6 次复跑）：G-3 组 = **4 处**（`ai-agent.js` 1089/1826/2027/2053）、单搜 `@` = **1 处**（1089）→ **新格内容与源码实测一致** ✓；且它与 §3.2 行 186 的详述（同为「4 处、全部无关」）**口径统一**，顺带消掉了此前「汇总格混口径 / 详述格精确口径」的不一致。

### 15.2 五点清单逐条确认

| # | 检查项 | 结果 | 我的证据（实读/实跑） |
|---|---|---|---|
| 1 | **行 5 无行号引用** | **passed** ✓ | 全文 grep `行 [0-9]+` 仅 **1 处**，且**不在行 5**（在行 63，属另一节，见 15.3）；行 5 现为段落式引用（「§3.1 汇总表的 G-6 行」「§3.1 开头的 P0 定义段」） |
| 2 | **文末冗余行已删** | **passed** ✓ | grep `修订记录` → **仅 [5]**；文末为行 370「报告完…」+ 行 371 空行，**无重复版本行** |
| 3 | **总行数 371** | **passed** ✓ | `(Get-Content audit/REPORT.md).Count` = **371**（复核前后各一次，均 371） |
| 4 | **行 6 / 152 / 170 / 186 / 307 一致** | **passed** ✓ | 逐行实读：**行 6**「版本 **v3** · 2026-09-14 · 核验基线哈希见交付说明（上一版 v2 = 369 行 / `A0FFE895…`）」；**行 152**「…`/clear`（`ai-host.js:2313`）或 `/grants`（`1947-1966`）显式清掉…」；**行 170**「**5 处命中**（`ai-agent.js:13/14/20/296` + `ai-host.js:407`）…**无任何实现**」；**行 186**「**4 处命中，全部无关**（1089/1826/2027/2053），单搜 `@` 也只有 `1089` 一处」；**行 307**「…**前 3 项即 §3.1 的 3 条 P0**）」 |
| 5 | **不重跑全量 / 不改行号结论** | **passed** ✓ | 只做定点复核；两条正则再跑一次（G-1 = **5 处**：`ai-agent.js` 13/14/20/296 + `ai-host.js` 407；G-3 = **4 处**）——与行 170 / 186 / 157 的数字**全部一致**，既有行号结论未受影响 |

### 15.3 一条**范围外**观察（不影响 t14 判定，供 captain/作者决定）

- 全文唯一残留的「行 N」式引用在**行 63**（§1.4 交叉一致清单）：「t3 §14.2（`auto` 模式语义偏窄）对应本报告 **§1 行 10**」。
- 问题：本版 **§1 从第 16 行起**，其内部并无「第 10 行」的对应内容；与 `auto` 模式语义相关的条目实际在 **§2.3 的第 10 行（权限分级），即行 110**（我早前 grep `第 22 行` = [110] 可佐证该行位置）。
- 建议：改为结构引用（如「§2.3 表第 10 行（权限分级）」），与本轮已修的其它脆弱引用同一处理方式。**它不在 t14 的 5 点清单内**，故不影响本次判定，仅记录。

### 15.4 只读复核

```
PS> git status --short
?? .agent-teams/
?? audit/

PS> (Get-FileHash audit/REPORT.md -Algorithm SHA256).Hash   # 371 行 / 62049 字节 / 12:04:12
17DFD99E2BA053B38373A638CB5AFE4CA4913886C01A40C19FE61A0D226D0651
```

- 本次只改本文件（`audit/verification.md`）；未触碰 `audit/REPORT.md`；未改任何插件源码；未执行 git 写操作。

**t14 结论**：**5 点清单全部 passed**；行 157 的授权改格**已包含**在本次取哈希的版本内（我实读为新口径，并用正则当场核对为「4 处 / 单搜 @ 1 处」，与 §3.2 行 186 口径统一）。**本次记录哈希 = 行 157 改写后**：`17DFD99E2BA053B38373A638CB5AFE4CA4913886C01A40C19FE61A0D226D0651`（371 行 / 62049 字节 / 12:04:12）。
