# 对标基线：agent 级工具的「交互机制」清单（t1）

> 产出人：bar-researcher（t1）。只读审计产物，未改动任何插件源码。
> 基线对象：**Claude Code 官方文档**（主）、**Reasonix 官网文档**（DeepSeek 原生的同类工具）、**本机 DSH（DeepSeek Harness）中文设计文档**（第三方实现交叉印证）。
> 取证方式：全部经 `web_fetch` 拉取官方文档的 markdown 源（`https://code.claude.com/docs/en/<page>.md`），原文于 **2026-09-14** 当日可访问；本机文档为绝对路径直读。每条断言都带「出处」；取不到的写「未能确证」。
> ⚠️ 本文只描述**对标对象有什么**，不含对 DanJuan 妙妙插件的任何判断（那是 t4 的活）。

## 阅读方式

- 每条机制写成三段：**回路**（谁把什么交给谁、什么时候、对方的反馈是什么）、**出处**（可点开的 URL / 本机路径:行号）、**为什么算门槛**（这条机制解决的是哪类交互失败）。
- 末尾 §14 给了「本仓库现状清单章节 ↔ 本基线章节」的映射表，t4 直接按表逐项判差。
- 引用格式：`docs/en/<page>.md §<小节>` 对应 `https://code.claude.com/docs/en/<page>`（Mintlify 站点的 `.md` 源与渲染页内容一致，锚点即小节标题）。
- **凡写成「行 N」的地方，指的都是该 URL 的 `.md` 源文件的行号**（本文件作者正是直接抓取这些 `.md` 源并逐行读取的），因此 t5 可以「抓同一个 URL → 按行号核对」；小节标题引用则直接用站点锚点。

---

## 0. 先定判据：什么叫「agent 级」的交互

不是功能罗列。会跑工具循环的聊天框与 agent 级工具的分界线，是**回路是否闭合**，具体三条：

1. **中途可干预**：人能在 agent 正在跑的时候施加影响（打断、插话、改权限、改计划），且中断本身不会丢弃已完成的工作。
   - 出处：`interactive-mode.md §General controls`——`Esc`：「Stop the current response or tool call mid-turn so you can redirect. Claude keeps the work done so far.」；`§Queue messages while Claude works`。
2. **越界前可裁决**：agent 的每一次有副作用的动作，都能在**动作发生前**被人看到并裁决；裁决可以被记住（本会话/永久），也可以被撤销；哪些动作**无论什么模式都必须问**要写清楚。
   - 出处：`permission-modes.md §Available modes`、`§Actions no mode auto-approves`。
3. **事后可定位可撤销**：任意一轮的效果能定位、能回看、能撤销，且**撤销的边界**（撤销不了什么）被明确写出。
   - 出处：`checkpointing.md §How checkpoints work`、`§Limitations`。

以下 10 组机制按这三条判据展开。**G 组以前的机制都在服务「回路闭合」，G 组以后（外部注入/记忆/扩展面/审计）在服务「回路不中断、可移交」。**

---

## A. 人类 → agent 的输入回路

### A1. 自由文本 + 多行输入
- **回路**：人在输入框打字 → Enter 提交成为一轮。多行有 4 种入口（`\`+Enter / Option+Enter / Shift+Enter / Ctrl+J），粘贴大段代码直接可用。
- **出处**：`interactive-mode.md §Multiline input`。
- **门槛**：单行输入框会把「贴一段日志再提问」变成不可能，逼迫人改写问题。

### A2. `/` 斜杠命令与技能菜单
- **回路**：输入 `/` 弹出候选（内置命令 + 技能 + 插件/MCP 贡献的命令）→ 过滤 → Tab/Enter 选定 → 命令执行或展开为提示词。
  - 菜单里同时列出内置命令、捆绑技能、用户技能、插件命令、MCP prompt（`§Commands`；MCP prompts 也变成命令：`mcp.md`）。
  - **中途补全**：`run the tests, then /com` 也能补全；`/tmp/notes.md` 这种路径不会持续打开列表；只有命令**位于消息开头**时才会被执行（`§Complete a command mid-prompt`）。
  - 插件技能按裸名匹配（`/deploy` 找到 `myplugin:deploy-app`），插入时写成全名。
- **出处**：`interactive-mode.md §Commands`、`§Complete a command mid-prompt`；命令全表见 `commands.md`。
- **门槛**：命令是「**不可能被误当成提示词**」的那条通路——命令必须执行，不能被静默降级成自然语言。DSH 把这条当契约写死（见 §11.A）。

### A3. `@` 文件/目录/会话引用
- **回路**：输入 `@` → 模糊匹配下拉 → 选中 → 插入一个**原子引用 token**；文件内容是 agent 自己去读，引用本身不夹带内容。
  - 尾部加 `/` 表示目录（`@src/components/`）。
  - 有跨会话消息时，`@` 后面打一个字母也会提示**本机其他活着的会话**，用来让当前会话给别的会话发消息（`interactive-mode.md §Quick commands` 行 95）。
- **出处**：`vs-code.md §Reference files and folders`；`interactive-mode.md §Quick commands`。
- **门槛**：把人指文件的方式从「复制路径到提示词」变成「结构化 mention」，**同时不给模型偷塞内容**——DSH 把这条写成了显式契约（见 §11.A）。

### A4. `!` shell 直通
- **回路**：`! npm test` → 命令直接跑（**不经模型审批**）→ 命令与输出进入会话上下文 → **Claude 自动回应该输出**，不需要第二条提示词。
  - 支持与后台化相同的 `Ctrl+B`；支持基于历史的 Tab 补全、实时路径补全；空输入时 Esc/Backspace/Ctrl+U 退出该模式；粘贴以 `!` 开头的文本会自动进入该模式。
- **出处**：`interactive-mode.md §Shell mode with `!` prefix`。
- **门槛**：这是「人比 agent 更清楚要跑什么」时的逃生舱，且**输出自动变成对话上下文**，闭合了「跑完还要解释一遍」的回路。

### A5. 记忆的查看与编辑入口
- **回路**：`/memory` 打开记忆文件的查看/编辑入口；CLAUDE.md 在会话启动时加载，自动记忆由 Claude 自行累积、可审计可编辑。
- **出处**：`memory.md §View and edit with /memory`、`§Auto memory`、`§Audit and edit your memory`。
- **门槛**：把「agent 记住了什么」变成可被人类检查的实体，而不是黑箱。
- **未确证**：`#` 前缀快速追加记忆的快捷键在现行 `memory.md` 中**未出现**（grep 无命中），故本基线不引用它。

### A6. 图片与附件粘贴
- **回路**：Ctrl+V / Cmd+V / Alt+V 粘贴剪贴板图片 → 光标处插入 `[Image #N]` 芯片 → 提示词里可按位置引用；VS Code 里也可拖文件成附件，附件旁的 X 可移除。
- **出处**：`interactive-mode.md §General controls`（`Ctrl+V or Cmd+V (iTerm2) or Alt+V (Windows and WSL)`）；`vs-code.md §Reference files and folders`。
- **门槛**：视觉类问题（UI 截图、报错截图）无法用文字替代。

### A7. 排队 vs 打断（人 → 运行中的 agent）
- **回路**：agent 在跑时按 Enter 提交的消息**排队**而非打断；队列显示在输入框上方；到点才送给模型：
  - 排队期间**工具调用结束**时立刻送达（同一轮内）；
  - 轮次结束时若还有排队项，**只发最旧的一条**作为下一轮，其余继续排队；
  - 命令与 shell 命令**押到轮次结束后**逐条执行；
  - `Up` 可从首行把排队内容**收回**输入框再编辑；
  - 想立刻打断就按 `Esc`，排队内容**立刻补发**。
- **出处**：`interactive-mode.md §Queue messages while Claude works`、`§When Claude Code sends what you queued`、`§Take back what you queued`。
- **门槛**：把「等 agent 说完再补一句」（浪费轮次）与「打断重来」（丢工作）之间补上第三条路。

### A8. 长提示词交给外部编辑器
- **回路**：`Ctrl+G`/`Ctrl+X Ctrl+E` 把当前提示词（可选把上一条回复作为 `#` 注释前置）拿到默认编辑器里改，保存回填，注释块被剥掉。
- **出处**：`interactive-mode.md §General controls`。
- **门槛**：长提示词/大段重写在单行输入框里编辑不现实。

### A9. 提示词建议（下一句该说什么）
- **回路**：回合结束后，Claude Code 用一次复用缓存的背景请求生成候选下一句 → 灰字显示在输入框 → Tab/→ 采纳、打字即消失。
  - 明确列出跳过条件（缓存冷、上一条报错、计划模式中、接近额度、agent team 的 teammate 默认不生成……）。
- **出处**：`interactive-mode.md §Prompt suggestions`、`§When Claude Code skips suggestions`。
- **门槛**：降低「不知道下一步能问什么」的启动摩擦；同时把**成本条件**写出来（缓存冷就不生成）。

### A10. 选择即上下文（IDE 面板特有）
- **回路**：在编辑器里选中代码 → 提示词栏显示选中行数 → `Option/Alt+K` 插入带行号的 mention（`@app.ts#5-10`）→ 点 X 可移除；切换文件后指示器回来。
- **出处**：`vs-code.md §Reference files and folders`。
- **门槛**：面板型工具的核心优势就是「人正在看的东西自动进上下文」，否则等于退回终端复制粘贴。

---

## B. 运行中的可见性（agent → 人）

### B1. 流式输出与工具调用行
- **回路**：模型输出与工具调用实时上行；工具调用默认可能被折叠成一行摘要（例如 MCP 调用折叠为 `Called slack 3 times`）。
- **出处**：`interactive-mode.md §General controls`（`Ctrl+O` 的说明）。
- **门槛**：没有实时过程，人无法判断「它卡住了」还是「它在想」。

### B2. 转录查看器（`Ctrl+O`）
- **回路**：展开详细工具用量与执行、每条助手消息的时间戳与所用模型、默认折叠的行；进入后有独立快捷键（上一/下一个用户提示词 `{`/`}`、把整段对话写进终端 scrollback 以便原生搜索 `[`、写入临时文件用 `$EDITOR` 打开 `v`、`?` 快捷键面板）。
- **出处**：`interactive-mode.md §Transcript viewer`。
- **门槛**：把「我只要结论」和「我要查它到底干了什么」拆成两个视图层级，而不是二选一。

### B3. 待办清单（`Ctrl+T`）
- **回路**：Claude 自建 todo → `Ctrl+T` 显示/隐藏，一次最多显示 5 条，按 pending/in_progress/complete 标注 → 展开状态会跨 `--resume` 恢复 → **todo 跨上下文压缩保留** → 想看全部/清空直接对 Claude 说。
- **出处**：`interactive-mode.md §Task list`。
- **门槛**：长任务里「它现在在第几步」是人的第一疑问。

### B4. 状态行（人自建的可观测面）
- **回路**：状态行是一个接收 JSON 的脚本，可显示上下文占用百分比、花费、时长、代码增删行数、git 状态等；输入字段包括 `context_window.used_percentage`、`cost.total_cost_usd`、`cost.total_duration_ms`、`cost.total_lines_added/removed` 等。**子代理也有独立状态行**。
- **出处**：`statusline.md §Available data`、`§Context window fields`、`§Subagent status lines`。
- **门槛**：把「还能跑多久、花了多少钱」从事后账单变成实时仪表。

### B5. 上下文占用指示与自动压缩
- **回路**：提示词框显示上下文占用；需要时 Claude 自动压缩，人也可手动 `/compact`。
- **出处**：`vs-code.md §Use the prompt box`（Context indicator）；`context-window.md`。
- **门槛**：上下文溢出是 agent 最典型的静默失败，必须可见。

### B6. 会话回顾（recap）
- **回路**：人离开终端再回来时，给一行「发生了什么」的回顾；至少 3 分钟后且终端失焦时后台生成，至少 3 轮才出现，不连续出现两次；`/recap` 可随时要，自动与手动都限 400 字符，可在 `/config` 关掉。
- **出处**：`interactive-mode.md §Session recap`。
- **门槛**：中断后回来重新建立上下文是高成本动作。

### B7. 后台任务视图
- **回路**：Bash 命令可后台化（提示 Claude 或按 `Ctrl+B`），返回后台任务 ID，输出写入文件供 Claude 用 Read 取回；自动清理、5GB 终止、内存压力回收（会话空闲 ≥30 分钟且无轮次/子代理在跑）等边界都写明；`/tasks` 查看运行中的 shell 与子代理。
- **出处**：`interactive-mode.md §Background Bash commands`、`§How backgrounding works`。
- **门槛**：长构建/长测试期间人还能继续用会话。

### B8. 子代理面板与 agent map
- **回路**：提示词框底部显示子代理数量与其状态点（工作中 / 等权限）；点开是树形图，每个子代理有状态、耗时、token 数；点子代理可看它的提示词、工具调用、只读转录，运行中可停止。
  - 后台子代理行在成功时立刻移除并在页脚提示 30 秒 `/tasks to see subagents`；失败/停止时保留 30 秒。
- **出处**：`vs-code.md §Use the prompt box`（Agent map）；`sub-agents.md §Run subagents in foreground or background`。
- **门槛**：并行度上去了，「谁在跑、谁卡住、谁等我」必须一眼可见（与 §F 呼应）。

### B9. 侧提问 `/btw`（不污染历史）
- **回路**：`/btw <问题>` → 从**已有上下文**作答（无工具访问）、不进对话历史、在浮层里显示 → `c` 复制原文 markdown、`f` 把该问答 fork 成有完整工具权限的后台子代理、`Up/Down` 翻历史、`x` 清空 − 侧提问在 **Claude 正在跑的时候也能用**，不影响主轮。VS Code 里它开成面板，线程跨窗口重载存活。
- **出处**：`interactive-mode.md §Side questions with /btw`；`vs-code.md §Use the prompt box`。
- **门槛**：这是「不打断主任务又立刻解答」的机制；`f` 键还给出了「侧问题其实是个新任务」的升级路径。

### B10. 差异面板 `/diff`
- **回路**：`/diff` 打开差异面板（与对话并排、持续刷新），列出改动文件与增删行数：
  - **鼠标选中某些行** → 选中内容挂到下一条提示词上（输入框旁显示行数）；
  - `Ctrl+X B` 循环切换比较基准（本会话改动 → 未提交改动 → 自分支点以来全部），按工程记忆；
  - 列表跳过测试文件与生成文件（可点开计数展开）；Claude 一开始改文件时可自动打开（终端 ≥144 列），关掉后保持关闭。
- **出处**：`interactive-mode.md §Review changes with /diff`、`§Diff panel`、`§Diff viewer`。
- **门槛**：**「指着 diff 的一行问」是人机回路里最短的一条路径**，比复制代码到提示词短得多。

---

## C. 门控与批准（agent → 人 → agent）

### C1. 权限模式（一个键循环切换）
- **回路**：`Shift+Tab` 循环 `default(Manual)` → `acceptEdits` → `plan` →（可选）`bypassPermissions`/`auto`；状态栏显示当前模式（`⏸ plan mode on` 等）。各界面有自己的入口与默认值解析顺序。
- **模式语义**（每种模式「不用问就能做什么」）：
  - `default`：只读；
  - `acceptEdits`：读 + 文件编辑 + 常见文件系统命令（`mkdir`/`touch`/`mv`/`cp`/`rm`/`sed`，工作目录或 `additionalDirectories` 内）；
  - `plan`：读 +（可用 auto 时）分类器放行的命令；
  - `auto`：全部，但有独立分类器在动作前复核；
  - `dontAsk`：只读 + 预批准工具，其余一律**拒绝**（不提问）；
  - `bypassPermissions`：全部。
- **出处**：`permission-modes.md §Available modes`、`§Switch permission modes`、`§Which mode a session starts in`、`§Auto-approve file edits with acceptEdits mode`。
- **门槛**：把「逐条问」与「全放开」之间的中间挡位显式化；且**模式可在一轮中途切换**。

### C2. 无论什么模式都必须问的动作
- **回路**：标准明确列出「任何模式都不自动批准」的清单：显式 ask 规则匹配的工具、组织设为 ask 的连接器工具、**需要用户交互的工具**（内置 `AskUserQuestion` 与标记 `requiresUserInteraction` 的 MCP 工具）、指向关键路径的 `rm`/`rmdir`、跨会话消息保护、工作目录外的读取（开相关设置时）。
- **出处**：`permission-modes.md §Actions no mode auto-approves`。
- **门槛**：这是安全边界必须**可枚举**、不能靠「我们记得」的例子。

### C3. 权限提示的交互细节
- **回路**：提示里 `Tab` 打开**评论字段**（可以「不行，但改成这样」），`Esc` 等于不带评论的「No」；`Left/Right` 在提示的选项卡间切换；`Shift+Tab` 在某类提示上可直接选「本会话都允许」。
  - 后台子代理的权限提示**回落到主会话**，提示里写明哪个子代理在问；`Esc` 只拒绝**那一次调用**，不停掉子代理。
  - 会话级授权（如「本会话允许」）会同时作用于主对话与子代理。
- **出处**：`interactive-mode.md §General controls`；`sub-agents.md §Run subagents in foreground or background`；`tools-reference.md §Agent tool behavior` 行 119–121。
- **门槛**：审批不是二元开关——「拒绝并给替代方案」才是常见需求；并行场景下审批必须能归属到发起者。

### C4. 计划模式（先计划、后批准、批准即换挡）
- **回路**：进 plan 模式（`Shift+Tab` 或单条提示词加 `/plan`）后 Claude 只探索、写计划、不改源码 → 计划写完弹出选择：
  - **Yes, and use auto mode** / **Yes, manually approve edits** / **No, keep planning**；
  - 批准**同时切换权限模式**；`Ctrl+G` 可在批准前把计划拿到外部编辑器直接改；
  - 接受计划还会给会话生成标题（若尚未命名）。
- **出处**：`permission-modes.md §Analyze before you edit with plan mode`、`§Review and approve a plan`。
- **门槛**：把「探索—改动」两个阶段分开，让大改动有一次低成本否决点；批准动作本身携带了「接下来怎么跑」的策略。

### C5. `AskUserQuestion`（结构化提问，而非自由文本）
- **回路**：Claude 需要决策/澄清时用多选提问 → 人选一项、或走 `Other` 行/备注字段自填；自填时机器用中性措辞转达，Claude 会照人写的做（包括「先等等/先解释」）。
  - **超时自动继续**（可选 `60s/5m/10m`）：超时后提交已选项并告知 Claude「人可能不在键盘前」，由 Claude 自行判断、之后可再问；最后 20 秒显示倒计时，任意按键重启计时。
  - **超时只适用于多选题**：权限提示（含计划批准）**永远不会因空闲自动解决**。
- **出处**：`tools-reference.md §AskUserQuestion tool behavior`、`§Question auto-continue timeout`。
- **门槛**：给出「提问也有 SLA」的设计——否则一个无人值守的会话会永久卡死；同时明确权限类的审批**不允许**被超时绕过。

### C6. MCP 工具的「每次都问」
- **回路**：MCP server 在 `tools/list` 里给工具打 `_meta["anthropic/requiresUserInteraction"]=true` → 该工具**每次调用**都出权限提示，在 `acceptEdits`/`auto`/`bypassPermissions` 下也一样，且**不提供「不再询问」**，匹配它的 allow 规则也不生效；`dontAsk` 下直接拒绝。
  - 明确要求「提示必须到达一个人」：非交互模式的 `--permission-prompt-tool` 返回 allow 会被转成 deny；SDK 的 `canUseTool` 会收到这类调用（因为 SDK 应用被认为会展示给人）。
- **出处**：`mcp.md §Require approval for a specific tool`。
- **门槛**：把「同意本身即是功能」的工具（如 consent/发布类）纳入协议，而不是靠工具描述劝模型自觉。

### C7. hooks 的事前拦截（可以「不让动作发生」）
- **回路**：`PreToolUse` 在工具执行前触发，可以阻塞；**退出码 2 = 阻塞**，且**连 JSON 里的 `permissionDecision:"allow"` 也覆盖不了它**；退出码 0 + JSON 可以给出 allow/deny/ask 决策；`UserPromptSubmit` 可以拒绝一条提示词（阻塞原因会给人看）。
  - 另有一整套生命周期事件（见 §G1），包括 `PermissionRequest`/`PermissionDenied`、`PostToolUseFailure`、`TaskCreated`/`TaskCompleted`、`TeammateIdle` 等。
- **出处**：`hooks.md §Exit code output`、`§Exit code 2`、`§Hook lifecycle`；`agent-teams.md §Enforce quality gates with hooks`。
- **门槛**：策略有时不属于模型也不属于 UI，而属于宿主/组织；且**「退出码 2 的阻塞不可被 JSON 覆盖」**是防绕过的关键约定。

### C8. 批准也可以被程序消费（SDK 面）
- **回路**：Agent SDK 里传 `canUseTool` 回调：任何**没有被更早的规则/模式放行**的工具调用会回调进来（工具名 + 入参 + `suggestions`（建议的 PermissionUpdate）+ 取消信号），宿主自行决定 allow/deny。
  - 明确警告：**已自动批准的工具不会触发回调**；要对每个调用都生效应用 `PreToolUse` hook。
  - 同一个回调也承载 `AskUserQuestion`（`toolName == "AskUserQuestion"`），宿主负责把它渲染成人能回答的界面。
  - 也可用 `PermissionRequest` hook 在等待批准时发外部通知（Slack/邮件/推送）。
- **出处**：`agent-sdk/user-input.md §Detect when Claude needs input`、`§Handle tool approval requests`、`§Handle clarifying questions`。
- **门槛**：面向「宿主是编辑器插件」的实现者——审批/提问的**接入点**必须是协议级的，不是靠 UI 猜。

---

## D. 中断与纠正（人 → 运行中的 agent）

### D1. `Esc` 打断当前响应或工具调用，保留已完成工作
- **回路**：`Esc` 中途停止响应/工具调用以便改方向；「Claude keeps the work done so far」；若有排队消息，接着立刻发送；对话框打开时 `Esc` = 关对话框；权限提示上 `Esc` = 不同意。
- **出处**：`interactive-mode.md §General controls`。
- **门槛**：中断的语义必须写明「保不保留已完成的工作」——这是最容易做错、也最伤人的一处。

### D2. `Ctrl+C` 的两段式语义
- **回路**：有操作在跑时中断；没有时第一次清空输入、第二次才退出。
- **出处**：`interactive-mode.md §General controls`。
- **门槛**：防止误杀会话。

### D3. 一键停止全部后台子代理
- **回路**：`Ctrl+X Ctrl+K` 停止本会话所有后台子代理，并在本会话余下时间关掉 artifact 自动回复；**3 秒内按两次确认**。
- **出处**：`interactive-mode.md §General controls`。
- **门槛**：并行度上来后，「全部刹车」必须是一级动作。

### D4. 打断后的归属：中途消息不产生检查点
- **回路**：在工具调用间隙插进当前轮的消息**属于该轮**，不进 rewind 列表；要撤销它带来的改动，只能回到**开启该轮的那条提示词**（会连带撤销这轮更早的工作）。
- **出处**：`checkpointing.md §Messages sent mid-turn not checkpointed`。
- **门槛**：steering 的能力边界必须写出来，否则人会以为可以精确回滚「我刚插那句话之后的部分」。

### D5. 队列内容可收回
- **出处**：`interactive-mode.md §Take back what you queued`。
- **门槛**：排队不等于发出——收得回来才敢用。

---

## E. 回滚与恢复（人 → 历史）

### E1. 检查点自动建立
- **回路**：**每一条开启轮次的提示词**自动创建一个检查点，最多保留 100 个快照；随对话一起保存（resume 后仍可 `/rewind`）；约 30 天后随保留策略清理；VS Code 用「每个文件的第一份快照」作为会话 diff 的基线。
- **出处**：`checkpointing.md §Automatic tracking`。
- **门槛**：不需要人先记得保存。

### E2. `/rewind` 或 `Esc Esc` → 一个动作菜单
- **回路**：列出本会话每条提示词 → 选一点 → 六个动作：**Restore code and conversation** / **Restore conversation** / **Restore code** / **Summarize from here** / **Summarize up to here** / Never mind；只有该检查点之后确有文件改动时才出现「恢复代码」两项；恢复对话后**原提示词会回到输入框**可改再发；总结可额外填「聚焦什么」的说明。
- **出处**：`checkpointing.md §Rewind and summarize`、`§Guide a summary`。
- **门槛**：把「撤销」拆成「代码回滚 / 对话回滚 / 上下文压缩」三个独立动词——现实需求是混合的。

### E3. 撤销的**边界**被逐条写明
- **回路**：文档明确列出撤销不到的东西：bash 命令改的文件、后台子代理的编辑（前台 fork 技能除外）、会话外的改动、符号链接/硬链接路径（会提示 `Restored the code, but skipped N files`）、中途消息。
- **出处**：`checkpointing.md §Limitations`。
- **门槛**：**这一节是本基线里最有复用价值的部分**——回滚功能的可信度等于它承认的边界。

### E4. `/clear` 之后还能回到清空前的会话
- **回路**：`/clear` 后 `/rewind` 菜单顶部多一项 `/resume <session-id> (previous session)`。
- **出处**：`checkpointing.md §Rewind past a cleared conversation`。
- **门槛**：清空上下文是最常见的危险操作，需要留一扇门。

### E5. 会话恢复（`--continue` / `--resume` / 命名 / 按 PR）
- **回路**：多种入口：最近一条、选择器、按名字、按转录文件路径、按 PR 过滤、会话内 `/resume` 切换到别的会话。
  - **恢复什么**：完整对话（含工具调用与结果）、模型、agent 及其工具限制、权限模式（视恢复路径而定，表格逐行给出）、仍活跃的 goal、未过期的计划任务；**不恢复**：后台 Bash/monitor、部分启动参数（`--mcp-config`/`--settings`/`--plugin-dir`/`--add-dir` 要重传）。
  - 会话按工程目录存储；跨工程按 session id 查找（仅当唯一匹配）。
- **出处**：`sessions.md §Resume a session`、`§What a resumed session restores`、`§Permission mode on resume`、`§Where the session picker looks`。
- **门槛**：恢复的**清单**必须明确（多数实现只恢复消息，丢掉模式与权限，导致恢复后行为突变）。

### E6. 长会话恢复时的三选一
- **回路**：Pro/Max 下恢复「超过约 1 小时不活跃且 >100k token」的会话时先弹对话框：**Resume from summary**（立即压缩，代价是丢细节）/ **Resume full session as-is**（贵但全）/ **Don't ask me again**；说明里点明无论选哪个，下一次请求都要整段重算（缓存已过期）。
- **出处**：`sessions.md §Resume from a summary`。
- **门槛**：把「贵 vs 全」的取舍交给人，而不是替人决定。

### E7. 会话分支（fork）而不是覆盖
- **回路**：`/branch` / `claude --continue --fork-session` 从某点分叉出新会话，保留原会话完整。
- **出处**：`checkpointing.md §Guide a summary`（Note）、`sessions.md §Branch a session`。
- **门槛**：「换条路试试」不应以毁掉原路为代价。

### E8. 手动压缩 `/compact`
- **出处**：`vs-code.md §Use the prompt box`（Context indicator）、`context-window.md §What survives compaction`。
- **门槛**：自动压缩触发前给人一次手动整理的机会；压缩后「什么幸存」要可查。

---

## F. 会话与并行（多任务）

### F1. 会话命名与自动标题
- **回路**：新会话按首条消息生成 AI 标题；可重命名、归档；接受计划也会生成标题（除非已命名）。
- **出处**：`sessions.md §Name your sessions`；`vs-code.md §Resume past conversations`；`permission-modes.md §Review and approve a plan`。
- **门槛**：会话一多，「哪个是哪个」是第一个失效点。

### F2. 后台会话（关终端仍在跑）
- **回路**：会话可移交后台，由独立 supervisor 进程托管，关闭 agent view/终端后继续跑；状态落盘、跨自动更新与 supervisor 重启存活、机器休眠后进程恢复；被中断的响应会从断点续写。
- **出处**：`agent-view.md §Read session state`（行 134–138）、`§How background sessions are hosted`。
- **门槛**：长任务不能绑在人的窗口上。

### F3. agent view（多会话的一屏管理）
- **回路**：
  - **状态图标**：Working / Needs input（黄，含权限决策、沙箱提示、MCP elicitation）/ Idle / Completed / Failed / Stopped；图标**形状**另表进程是否还活着（`∙` = 进程已退出，回复时从原处重启）。
  - **行摘要**：由 Haiku 类模型生成一句话说明它在做什么/要什么；回合结束时重写，长回合中每隔几分钟重写，工作期间最多每 15 秒用自身输出更新且不发请求。
  - **Peek & reply**：`Space` 打开窥视面板 → 等待中的会话显示**它正在问的那个问题** + 已等待时长；预定义选项显示为编号列表可按数字选；权限提示只能文字回复或 attach；`Tab` 填入建议回复可编辑后再发；回复以 `!` 前缀则发送 Bash 命令；**发送失败的回复会被保存，待会话进程重启后作为下一条提示词送达**。
  - 终端标签标题显示待输入计数（`2 awaiting input · claude agents`）；需要输入的会话会发系统通知（走 `Notification` hook，类型 `agent_needs_input`/`agent_completed`）。
- **出处**：`agent-view.md §Read session state`、`§Row summaries`、`§Peek and reply`、`§Attach to a session`。
- **门槛**：并行度 >1 之后，「哪些在等我」是唯一重要的聚合视图。**行摘要 + 行内回复**是面板型工具最值得抄的一组机制。

### F4. worktree 隔离（并行改动不打架）
- **出处**：`worktrees.md`（llms.txt 索引）；`agent-view.md §How file edits are isolated`。
- **门槛**：并行 agent 改同一仓库必然冲突，隔离要在工具层解决。

### F5. agent teams（多 agent 协作的交互契约）
- **回路**：
  - 每个 teammate 是**完整独立会话**；人可直接给任意 teammate 发消息（in-process 模式在 agent 面板上下选人、Enter 进入、`x` 停止、`Ctrl+T` 切任务列表；split-pane 模式点进窗格）。
  - **共享任务清单**：pending / in progress / completed，支持依赖（依赖未完成不能被领取）；lead 可显式分配，teammate 也可自领；**领取用文件锁防并发**。
  - **通信**：消息自动投递（lead 不用轮询）；teammate 结束会带最终答复通知 lead；按名字一对一发消息；想通知所有人就逐人发。
  - **优雅关闭**：lead 发关闭请求，teammate 可同意（优雅退出）或**带理由拒绝**。
  - **质量闸门用 hooks**：`TeammateIdle` 退出码 2 可把 teammate 留在工作态并给反馈；`TaskCreated`/`TaskCompleted` 退出码 2 可阻止创建/完成。
  - 明确写出「in-process teammate 里普通文本与技能发给该 teammate，但**内置命令仍在 lead 会话执行**」，以及 `/model`/`/fast` 只改 lead。
- **出处**：`agent-teams.md §Talk to teammates directly`、`§Assign and claim tasks`、`§Shut down teammates`、`§Enforce quality gates with hooks`、`§Context and communication`。
- **门槛**：多 agent 的难点不是派发而是**认领、依赖、归属、关闭同意**。

### F6. 子代理的前后台与可寻址
- **回路**：子代理默认后台跑；后台子代理的权限提示回落主会话（见 C3）；可用 `name` 命名从而可被 `SendMessage`/`resume` 按名字寻址；`maxTurns` 到顶返回**部分结果**并可 resume 继续；子代理的最终报告在进入主对话前会被扫描（防止被读到的内容里夹带指令）。
- **出处**：`tools-reference.md §Agent tool behavior`；`sub-agents.md §Run subagents in foreground or background`、`§Subagent names`、`§Resume subagents`、`§Subagent output scanning`。
- **门槛**：子代理不是「一次函数调用」，而是可命名的长生命周期对象。

### F7. 动态 workflow（脚本编排，先批准再跑）
- **回路**：Claude 写一个可重复运行的编排脚本 → **批准计划后才执行** → 运行可暂停后续跑；有规模指引与关闭开关。
- **出处**：`workflows.md §Have Claude write a workflow`、`§Approve the plan before it runs`、`§Resume after a pause`。
- **门槛**：批量任务需要「一次批准、多次执行」的层级，而不是逐条确认。

---

## G. 外部事件注入（世界 → agent）

### G1. hooks 的完整生命周期
- **回路**：三种节奏——每会话（`SessionStart`/`SessionEnd`）、每轮（`UserPromptSubmit`/`Stop`/`StopFailure`）、每次工具调用（`PreToolUse`/`PostToolUse`）；另有 `PermissionRequest`/`PermissionDenied`、`Notification`、`SubagentStart/Stop`、`TaskCreated/Completed`、`TeammateIdle`、`InstructionsLoaded`、`ConfigChange`、`CwdChanged`、`FileChanged`、`WorktreeCreate/Remove`、`PreCompact/PostCompact`、`PreModelSwitch/PostModelSwitch`、`Elicitation/ElicitationResult`、`MessageDisplay` 等。
  - 钩子可阻塞（退出码 2）、可加上下文（`UserPromptSubmit`/`SessionStart` 等的纯文本 stdout 会进上下文）、可强制模型再跑一轮。
- **出处**：`hooks.md §Hook lifecycle`、`§Exit code output`；`hooks-guide.md`。
- **门槛**：宿主要能参与 agent 的决策点，而不只是包一层 UI。

### G2. channels（把外部事件推进正在跑的会话）
- **回路**：channel 是一个**推送**事件的 MCP server（标准 MCP 是「Claude 主动去查」）：CI 结果、聊天消息、监控告警可推进会话；**可双向**——Claude 读事件并通过同一 channel 回帖（聊天桥）；事件只在会话打开时到达；每个获批 channel 维护**发送者白名单**，不在名单上的静默丢弃；仅装在 `.mcp.json` 里不够，还必须在 `--channels` 里具名。
- **出处**：`channels.md`（行 13、25、280、293、358）；`channels-reference.md`（llms.txt 索引）。
- **门槛**：单向查询 vs 双向推送是两种集成范式，后者才支持「人不在也能反应」。

### G3. 定时与循环任务
- **回路**：`/loop` 与 cron 工具让提示词按计划重复执行、轮询状态或做一次性提醒；恢复会话时未过期的任务会被恢复（见 E5）。
- **出处**：`scheduled-tasks.md`（llms.txt 索引）。
- **门槛**：agent 需要能自己醒来。

### G4. 深链接与 CI 触发
- **回路**：`claude-cli://` 链接可在正确仓库、带正确提示词打开终端会话（用于 runbook/告警/面板）；GitHub Actions 里 `@claude` 提及可触发任务并产出 PR。
- **出处**：`deep-links.md`、`github-actions.md`（llms.txt 索引）。
- **门槛**：agent 的**入口**不能只有人的键盘。

---

## H. 跨轮的上下文与记忆

### H1. 指令文件的层级加载
- **回路**：CLAUDE.md 分企业/用户/项目/子目录层级加载，支持 `@` 导入其他文件；`.claude/rules/*.md` 组织规则；有独立的指令加载钩子 `InstructionsLoaded`（会话开始与**会话中懒加载**时都触发）。
- **出处**：`memory.md §CLAUDE.md files`、`§Import additional files`、`§Organize rules with .claude/rules/`；`hooks.md §Hook lifecycle`。
- **门槛**：项目知识不能靠人每次重述。

### H2. 自动记忆
- **回路**：Claude 跨会话累积学习（auto memory），可开关、有存储位置、可审计与编辑；`/memory` 查看编辑。
- **出处**：`memory.md §Auto memory`、`§Enable or disable auto memory`、`§Audit and edit your memory`。
- **门槛**：记忆必须是**可审计的实体**，否则无法信任。

### H3. 技能按需加载
- **回路**：SKILL.md 的 `description` 决定 Claude 何时自动加载；正文只在用时进上下文（长期参考材料平时几乎不花 token）；支持 `!` 动态上下文注入（把命令输出在 Claude 看到之前内联进技能正文）。
- **出处**：`skills.md §Create your first skill`（其中的 `!` 动态上下文注入示例）与 `skills.md#inject-dynamic-context`；`interactive-mode.md §Commands`。
- **门槛**：这是「长期知识 vs 上下文预算」的标准解法。

### H4. 技能的调用权归谁
- **回路**：`disable-model-invocation: true` = 只有人能 `/name` 调；`user-invocable: false` = 只有 Claude 能调、从 `/` 菜单隐藏；`allowed-tools` = 本次技能轮内免问的工具（**下一条消息即失效**）；`disallowed-tools` = 该技能激活期间从工具池移除（例如后台循环里禁用 `AskUserQuestion`）。
- **出处**：`skills.md §Control who invokes a skill`（表格行 337–340）。
- **门槛**：**「谁能触发这个动作」必须显式可配**——这是把安全责任从提示词挪到配置的关键一步。

### H5. 压缩与幸存内容
- **出处**：`context-window.md §What survives compaction`；`checkpointing.md §Rewind and summarize`（两种 summarize）。
- **门槛**：同上（E8/B5）。

---

## I. 宿主嵌入与扩展面

### I1. MCP 的完整交互面
- **回路**：远程 HTTP/SSE/WebSocket 与本地 stdio 四种传输；安装范围（local/project/user）与优先级；**MCP prompts 变成斜杠命令**（`interactive-mode.md §Commands` 指向 `mcp.md#use-mcp-prompts-as-commands`）；**elicitation**（server 在工具调用中向人请求输入，对话框开着时该调用不会被自动后台化）；动态工具更新、自动重连、长工具调用自动后台化、每个工具的输出上限覆盖、无效 schema 的处理、`requiresUserInteraction`（见 C6）。
- **出处**：`mcp.md`（llms.txt 索引 + 上述小节标题）、`§Require approval for a specific tool`（行 1283–1291）、`§Automatic backgrounding of long tool calls`。
- **门槛**：MCP 不只是「工具清单」，还包括**提示词、资源、向人提问、工具集热更新**。

### I2. 插件与分发
- **回路**：插件把 skills/agents/hooks/MCP server/命令打包，通过 marketplace 分发；插件也能带可执行文件进 PATH；IDE 里可生成安装链接。
- **出处**：`plugins.md`、`plugins-reference.md`、`discover-plugins.md`、`vs-code.md §Manage plugins`。
- **门槛**：扩展的发现与安装本身是交互（谁来装、装到哪里、怎么分享）。

### I3. SDK 的两种输入模式
- **回路**：single mode（一次给提示词）vs **streaming input**（长期打开的流式多轮），后者是交互式宿主的基础；配 `canUseTool`（C8）与 hooks 组成完整回路。
- **出处**：`agent-sdk/streaming-vs-single-mode.md`；`agent-sdk/user-input.md`。
- **门槛**：宿主需要能在一轮跑的过程中继续喂东西（对应 A7/D1）。

### I4. 状态行 / 通知通道 / 通知钩子
- **出处**：`statusline.md`；`agent-view.md §Read session state`（`preferredNotifChannel`、`Notification` hook 的 `agent_needs_input`/`agent_completed`）。
- **门槛**：人在别处时，要有「这里需要你」的出口。

---

## J. 事后可审计性

### J1. 转录文件与脚本访问
- **回路**：会话持续写入本地转录文件；可导出、可被脚本访问；会话数据可删除；有保留策略时长设置。
- **出处**：`sessions.md §Export and locate session data`、`§Where transcripts are stored`、`§Delete session data`。
- **门槛**：出了事要能复盘到「哪一步、哪个工具、什么参数」。

### J2. 用量归因
- **回路**：`/usage` 显示账户、计划、限额条与重置时间，并**按 skill / subagent / plugin / MCP server 拆分用量**，标出占比 ≥10% 的行为（缓存未命中、长上下文、子代理密集/高并行）并给降耗建议。
- **出处**：`vs-code.md §Check account and usage`。
- **门槛**：把成本与「具体哪个扩展在烧钱」联系起来。

### J3. 调试入口
- **回路**：`/doctor`、`/context`、`/hooks`、`/mcp` 用来确认「什么真的加载了」；调试日志（`~/.claude/debug/<session-id>.txt`）记录钩子 stdout/stderr 与被跳过的路径。
- **出处**：`debug-your-config.md`（llms.txt 索引）；`checkpointing.md §Symlinked and hard-linked paths not restored`。
- **门槛**：「配置没生效」是最难自证的一类问题，必须有内省命令。

---

## 11. 二次基线：本机 DSH 的中文设计文档（可直接引用）

路径前缀（下称 `<DSH>`）= `C:/Users/dange/AppData/Roaming/io.github.hairyf.deepseek-harness-desktop/dependencies/dsh/node_modules/@deepseek-ai/`。
这些是**同一台机器上另一个 agent 级 harness 的设计文档**，不是论文，可作为「同类实现把回路做成什么样」的交叉印证。

### 11.A 输入通道
- **`/` 与 `@` 触发流水线**（`<DSH>dsh-client-ui-input-trigger/README.zh.md:12,32`）：光标处触发、分组候选、键盘与指针、`aria-activedescendant` 承载高亮、候选可下钻（`drill`）、面包屑回退、Tab 作用于高亮补全项、没有高亮项时 Tab 原样放行（不劫持原生焦点遍历）。
- **命令绝不会被静默降级**：`<DSH>dsh-client-ui-commands/README.zh.md:12`——「命令行绝不会被静默降级为普通提示词」；空格与回车对照会话目录解析；`popupSelect`/`action`/`leadingInput` 三类分派。
- **`@` 引用不夹带内容**：`<DSH>dsh-file-reference/README.zh.md:12`——「选中候选绝不读取或附带文件内容；模型必须调用文件系统工具才能查看文件」；文件与会话两组候选互不阻塞（`dsh-client-ui-reference/README.zh.md:12`）。

### 11.B 繁忙时的三条通路（本基线最核心的对照点）
- **收件箱三动词**（`<DSH>dsh-agent/README.zh.md:47`）：
  - `followup()` = 排一条**下一轮**提示词并唤醒驱动器；
  - `steer()` = 提交**下一步**输入并唤醒；
  - `inject()` = 只加模型可见上下文、**不唤醒**；
  - `cancel(cause)` = 中止当前活动，未设 `keepInbox` 时**清空待处理工作**；`cancel(cause,{keepInbox:true})` 只中止轮次、保留待处理项；`whenIdle()` 等完全停稳。
  - 已知限制（`dsh-agent/README.zh.md:175`）：「不存在让轮次继续运行、只中止步骤的操作」。
- **人类输入的宿主证明**（`<DSH>dsh-tool-goal/README.zh.md:72`）：`followup()`/`steer()` 在调用方省略 source 时**分配 `{kind:'user'}`**，因此插件、调度器与其他非人类生产方**必须传自己的 source，不能继承人类权限**。——这是「谁说的话」被建模进协议的例子。
- **composer 的 Queue / Steer**（`<DSH>dsh-client-ui-conversation/README.zh.md:49,51,53`）：繁忙态 Enter 在「普通会话与可继续 child」上选择 **Queue 或 Steer** 投递；排队提交有本地回显（「发送中…」+ 禁用编辑/删除/插话）、Host 队列行到达后替换回显；`sendSession` 用投递模式注册提交回显，Session 按模式与运行状态推导位置（空闲 → 直接进 transcript，繁忙 → 排队）；同一位置的按钮在「可提交草稿」时是 Send、否则是 Stop。

### 11.C 门控与批准
- **一次性审批**（`<DSH>dsh-user-approval/README.zh.md:12`）：`ask` 策略把每个请求发给人类或机器应答者；`never` 直接拒绝；**应答者缺失/失败返回 `unavailable`，操作以拒绝方式关闭**；每项批准只适用于对应请求；请求与结果都进会话审计日志；**模型只看到最终工具结果与当前策略，看不到人类权限 UI 或审计事件**。
- **权限预设**（`<DSH>dsh-permission-presets/README.zh.md:12`）：一个选择器同时应用**沙箱模式 + 审批策略**；改默认值不影响已有会话；当前组合不匹配任何预设时显示推导出的 `custom`，但**用户不能选也不能持久化它**；`/permission` 报告或更改当前预设。
- **UI 侧**（`<DSH>dsh-client-ui-approval/README.zh.md:11-12`）：插件发布每个待处理请求、**接管 Conversation composer**、按需渲染关联 Tool 详情、把决定返回给等待中的 Host 请求。
- **计划模式**（`<DSH>dsh-plan-mode/README.zh.md:12,28,32,53,55,61,63,81`）：`/plan` 进入（可带消息与附件）、`/plan off` 离开；agent 调 `exit_plan_mode` 交计划 → 人评审（Approve / Keep planning（可附自由文本）/ 关闭评审改为发言）；**计划模式不限制任何工具**（「每个工具仍然可用，因此请用沙箱模式与审批提示施加强制限制」）；激活状态跨 resume 与 fork 保留；状态是「单一仅记日志、整值替换的事件」，靠折叠日志复原。UI 上是一个 warn 色的「Plan ×」徽章（`dsh-client-ui-plan/README.zh.md:12`），评审卡片有 `Chat about it`/`Refuse`/`Approve` 三个动作（`dsh-client-ui-user-questions/README.zh.md:36`）。

### 11.D 提问
- **`ask_user_question`**（`<DSH>dsh-tool-ask-user/README.zh.md:12`）：让模型暂停并要确认/选择/缺失信息，接受一个或多个问题，**调用会等待回答被接受或当前轮次被取消**；没有回答处理器接受请求时模型收到错误；**归属于运行时其他 agent 的子级不能调用此工具**，必须在最终结果里报告未解决的问题；本包不渲染界面。
- **UI 侧**（`<DSH>dsh-client-ui-user-questions/README.zh.md:12`）：提问时**接管聊天编辑器**；可在问题间导航、单选/多选、自填、跳过、批量提交结构化答案；单选后立即前进；草稿跨 Session 导航保留；支持 plan-review 专用卡片。

### 11.E 可见性与审计
- **轨迹视图**（`<DSH>dsh-client-ui-trajectory/README.zh.md:12`）：按轮次组织的事件记录表 + 交互式时间概览；对用户/助手/工具/嵌套子工具/压缩记录分组；标明轮次与步骤边界；选中记录显示 token 用量、耗时、输入输出、计时、图片与附件摘要；长历史打开时定位到尾部、按需加载更早页面、只渲染可见行；**流式期间跟随尾部直到人向上滚**；进行中的记录只显示开始标记，**不会虚构耗时**。
- **后台任务**（`<DSH>dsh-client-ui-jobs/README.zh.md:12`）：会话头部动作 → 弹层列出本会话可见任务；**触发器只在会话至少有一个任务时出现**；角标计运行中+停止中；终态行保留并弱化直到注册表丢弃；「本包是给人类看的只读投影」。已知限制（`:76`）：「任务流式输出与人类发起的中断是各自独立的阶段」。
- **花费用量呈现**：见 t2 现状清单 §8 的对应项（本包未展开）。

### 11.F 会话、回滚、持久化
- **检查点策略**（`<DSH>dsh-session-checkpoint-policy/README.zh.md:12`）：在**模型请求之前、顶层工具可能产生外部副作用之前、下一 agent 步骤开始之前**持久记录；每个检查点之后的崩溃都能从已存请求/工具调用/响应/结果恢复；**检查点失败按失败即阻止处理**（持久写入成功前，模型适配器或顶层工具正文不会运行）；未完成的 assistant stream 保持瞬态；**中断的工具调用以「未知结果」恢复，不会自动重试**。
- **目标（goal）**（`<DSH>dsh-goal/README.zh.md:12`）：长期目标跨多轮、resume、fork 与进程重启存活；用户与 agent 都能 create/edit/pause/resume/complete/block/clear；比较并设置的更新会拒绝陈旧视图；可配置 Round 上限（默认 256）；**本包存储 goal 状态但不调度工作**；续行权限是进程本地而非持久状态。
- **会话编排**（`<DSH>dsh-agent-loop/README.zh.md:12,67,175,200`）：创建/恢复 agent 并驱动每轮；`maxParallelToolCalls` 限制并行安全调用、独占调用保序；**取消会保留已经流式交付给用户的文本**；`agent/pre-step` 可拒绝拟进入的步骤或替换消息、`agent/request-error` 可重试、`agent/turn-stopping` 可通过 steer 让本可结束的轮次保持打开；明确写「没有内置轮次预算」。
- **提醒**（`<DSH>dsh-schedule/README.zh.md:12,121,123`）：延时/绝对/固定间隔一次性与重复提醒；重启后仍存在，但**交付需要 live 根 agent**；**交付绝不使用邮件/短信/推送/浏览器通知**；送达走 `followup()`，会认领 agent 的 idle maintenance phase。

### 11.G 扩展与兼容
- **MCP 客户端**（`<DSH>dsh-mcp-client/README.zh.md:12`）：外部 server 的工具以 `mcp__<server>__<tool>` 稳定命名出现；默认不启用任何 server；**只桥接工具，MCP resources 与 prompts 不受支持**。
- **复用 Claude Code 钩子**（`<DSH>dsh-hooks-claude-code/README.zh.md:12,87`）：直接执行既有 `hooks.json`/settings 里的 command 钩子；可**带模型可见原因阻塞提示词或工具调用**、添加上下文、强制再跑一轮；每个事件映射到 harness 扩展点（`SessionStart`→`agent/session-start`，`UserPromptSubmit`/`PreToolUse`→可拒绝的 waterfall `agent/pre-step`/`tools/pre-execute`，等）。
- **超大输出**（`<DSH>dsh-spill/README.zh.md:12`）：把超大文本存到 `ctx.spillStore`，拿不透明定位、精确字节数与取回指引，让工具结果变成有界预览。
- **读前必须读**（`<DSH>dsh-fs-observation-policy/README.zh.md:12`）：**先读文件才允许覆盖或编辑**；文件在读取后变化则拒绝变更并要求重读后重试；读缺失路径授权带防护的创建；**观察记录不持久化，恢复的会话必须重新读取**。
- **重复调用提醒**（`<DSH>dsh-repeat-tool-reminder/README.zh.md:12`）：同一工具同参重复到阈值时提醒模型检查上次结果、换方法或结束；**提醒只是建议，绝不阻止或延迟合理的重复调用**；每个 agent 分别计数，新用户消息清零；base 组合默认在重复 3、5、8 次时提醒。
- **交付物**（`<DSH>dsh-client-ui-deliverables`，见 t1 检索命中 `present` 行）：「present 工具行显示正在交付/已交付/失败/中断状态；展开已结束调用可看记录的结果」。

### 11.H 值得单独记下的一条
- **`dsh-hooks-claude-code` 与 `dsh-hooks-codex` 的存在本身**说明：Claude Code 的钩子事件模型已成为事实标准，另一个 harness 选择**兼容而不是另起一套**。

---

## 12. 第三基线：Reasonix（DeepSeek 原生的同类工具）

先答「reasonix 是什么」：**开源（MIT）的编码 agent**，官网自述「a coding agent you can leave running... One local engine, four ways in — terminal, desktop app, browser, or your editor over ACP」；DeepSeek 官方 API 文档有专门的接入页。

- **出处**：`https://reasonix.io/`（首页，2026-09-14 取证）；`https://reasonix.io/docs`（文档页）；`https://api-docs.deepseek.com/quick_start/agent_integrations/reasonix/`（DeepSeek 官方接入页）。

其交互机制（逐条有出处，均为官网自述）：
1. **逐次工具调用受控**：`https://reasonix.io/` §features/01——「Every tool call is gated... Reads, writes, and shell commands each ask separately, and the workspace sandbox bounds what a command can touch even after you say yes.」
2. **审批只有三种且无永久授权**：`https://reasonix.io/docs#permissions`——「Approvals are limited to Allow once, Allow for this session, and Deny; permanent grants are not offered.」；强制边界无法启动时**失败关闭**（fail closed）。
3. **三个权限预设（跨所有入口一致）**：同节——Read only / Workspace write（默认）/ Full access；受限模式在 macOS 用 Seatbelt、Linux 用 bubblewrap、Windows 用受限令牌+ACL+Job Objects。
4. **逐轮检查点在 git 之外**：`https://reasonix.io/` §features/02——「Each turn writes a checkpoint outside git, so a six-hour run rewinds to any point without touching your commit history.」
5. **计划模式硬挡写入**：`https://reasonix.io/` §features/03——「`/plan` holds every write until you've read the plan and approved it.」
6. **回合内引导（steering）走 ACP 厂商扩展**：`https://reasonix.io/docs` §Editor integration (ACP)——通过 `agentCapabilities._meta` 声明 `_reasonix.io/session/steer`，「A host may call it while `session/prompt` is active to **queue user guidance for the next safe model boundary without cancelling the turn**」；客户端必须先发现该方法，并把 `InvalidRequest` 视为「未入队」。并明确它不是 ACP 核心的 `session/steer`，也不是未发布的 v2 `session/inject`。
7. **ACP 会话能力**：同节——每个会话独立持有工作区、历史、模型、推理强度、协作模式、审批策略与 host 提供的 MCP server；客户端声明能力后，文件操作走**编辑器未保存的 buffer**、前台命令在**客户端持有的 terminal** 里跑。
8. **MCP prompts 变斜杠命令、resources 用 `@` 引用**：`https://reasonix.io/docs` §Plugins (MCP)——「MCP prompts also become slash commands such as `/mcp__server__prompt`, and MCP resources can be referenced with `@server:uri`.」；并声明「**安装 MCP server 本身就是授权决定**」，装后工具直接可用，只有身份变化才重新确认。
9. **记忆与回退**：同文档 §Memory & rewind——项目记忆在 `REASONIX.md`/`AGENTS.md`，批准的 auto-memory fact 存在 home；**`remember`/`forget` 由模型发起但仍需用户明确决定**；`/memory` 看活动与归档 fact，`/forget` 是归档而非永久抹除。
10. **桌面端/浏览器端的可视化回路**：桌面端可「Approve tools, review checkpoints, and rewind code or conversation without leaving the app」；浏览器端可用「chat, tool approvals, session history, rewind, fork, summarize, model switching, and reasoning-effort controls」，并由 `todo_write` 工具驱动**实时 Todo 面板**。
11. **自动压缩阈值可配**：文档 §Prefix cache——默认在上下文 80% 触发，可在 30–85% 调整，并写明**阈值越低可能降低前缀缓存复用率**。
12. **一次任务从开始到结束的样子**（首页图示文本）：`plan 3 steps · 2 files · 1 test run` → `allow edit ... yes` → 两次 edit 带 `+24 −3`/`+41 −0` → `run go test ./internal/net/ ok (0.21s)` → `checkpoint #14 — revert this turn anytime`。

> **口径不一致（必须如实标注）**：Reasonix 首页称自己是「Open source · MIT · a single Go binary / 一个文件，零运行时」，仓库有 `main-v2` 分支与 Go SDK；而 DeepSeek 官方接入页仍写「Install Node.js 20.10+... `npx reasonix code` / `npm i -g reasonix`」，第三方博客也把它描述为 TypeScript/Node 项目。**两处口径矛盾，本报告只引用其交互机制自述，不对其实现语言/运行形态下结论。**

---

## 13. 未能确证 / 明确不做的对标

| 对象 | 状态 | 原因 |
| --- | --- | --- |
| **OpenAI Codex CLI 的交互机制**（审批档位、打断/排队、`/fork` 等） | **未能确证，不做对标** | `developers.openai.com/codex/*` 返回 **403 Forbidden**；`raw.githubusercontent.com/openai/codex/main/docs/config.md` 抓取失败；GitHub README 只讲了安装与入口。搜索到的均为社区/博客二手来源，**不作为对标依据**。 |
| Claude Code 的 `#` 快速追加记忆快捷键 | **未能确证** | 现行 `memory.md` 中无该快捷键记载（grep 无命中），只确证了 `/memory`。 |
| Claude Code 的 `Ctrl+R` 跨工程历史搜索等细粒度差异 | 已确证存在（`interactive-mode.md §Command history`、`whats-new/2026-w19`），但**不影响交互机制分档**，未展开。 |
| Reasonix 的实现语言/运行形态 | **未能确证**（官方口径互相矛盾，见 §12 脚注） | 只引用其机制自述。 |

---

## 14. 给下游（t4 差距分析 / t5 核验 / t6 评审）的映射表

t4 建议按「现状章节 → 基线章节」逐行判差，**差 = 基线有的回路 vs 现状确证的缺口**，不要按功能名对称比较。

| 现状锚点 | 本基线对应 | 判差时要问的问题 |
| --- | --- | --- |
| t2 §1 输入与发送；t3 §9 工具 schema 呈现 | §A1–A10、§B10 | 有没有 `/`、`@`、`!` 三类「不可能被误当提示词」的通路？选中内容能否直接进提示词（A10/B10）？ |
| t2 §2 一轮回合的装配 | §B1–B3、§B9 | 过程/结论分层是否可切换？有没有「指着某一行问」的短路径？ |
| t2 §3 繁忙时排队/引导/打断；t2 §4 引导送达；t3 §4 取消令牌 | §A7、§D1–D5、§11.B | 打断的语义是否写明「保留已完成工作」？排队能否收回？有没有「不打断但立刻解答」的第三条路（`/btw` 等价物）？ |
| t2 §5 审批卡；t3 §2 审批模式与授权；t3 §3 免确认清单 | §C1–C8、§11.C | 权限是否有**模式挡位**（而非一个布尔）？「无论什么模式都必须问」的清单是否可枚举？拒绝时能否带替代方案？授权的作用域与撤销入口是否显式？ |
| t2 §6 停止链路 | §D1–D3 | 停止是「停一个工具调用」「停一轮」「停所有并行任务」中的哪几档？ |
| t2 §7 提示与错误的呈现位置 | §B4、§C5、§G2 | 需要人输入时，通知是否可达（人在别处）？ |
| t2 §8 轮次用量、上下文刻度与花费 | §B4、§B5、§J2、§12.11 | 上下文占用与花费是否实时可见？压缩阈值是否可配、是否写出副作用？ |
| **t2 §9 历史会话与撤销；t3 §5 会话持久化与 resume** | §E1–E8、§11.F | 检查点何时建立？撤销有几种粒度？**撤销的边界是否写出来**？resume 恢复哪些状态（模型/模式/权限/目标）？ |
| t2 §10 在场感知 | §F2–F3 | 「哪些会话在等我」是否有聚合视图与行内回复？ |
| **t3 §10 子代理委派：无** | §F3–F7、§11.E–11.F | 弱化的最小修法可从「可命名 + 可看到状态 + 可停止 + 权限提示归属发起者」四项里选（§F6）。 |
| **t3 §11 计划模式：无（只有待办清单）** | §C4、§11.C | 最小修法在 DSH 已给样例：`/plan` + 退出工具 + 评审卡片三动作（Approve / Keep planning / 关闭改发言），且**计划本身不限制工具**，限制交给沙箱与审批。 |
| **t3 §12 hooks：无** | §C7、§G1、§11.G | 最小修法优先级最高的两个事件是 `PreToolUse`（可阻塞）与 `UserPromptSubmit`（可拒绝/加上下文）；若要兼容既有生态，可直接读 Claude Code 的 `hooks.json`（DSH 已示范）。 |
| t3 §6 上下文计量与两级压缩 | §B5、§E8、§H5、§12.11 | 压缩触发点与阈值是否可配？压缩后「什么幸存」是否可查？ |
| t3 §7 记账；§8 崩溃兜底；§13 双窗口隔离 | §B4、§E1、§E3、§11.F(checkpoint policy) | 「检查点失败即阻止」这类 fail-closed 约定是否成立？中断的工具调用是否被当成「未知结果」而不是「失败/成功」？ |
| t3 §14 事实性缝隙候选 | §0 三条判据 | 每条缝隙请归到「中途可干预 / 越界前可裁决 / 事后可定位可撤销」中的一格，避免报告变成功能清单。 |

**t5 核验提示**：本文件所有 URL 均为官方文档的 `.md` 源，可原样重新 `web_fetch` 复核；引用的 Claude Code 小节标题即为该页锚点。本机 DSH 文档路径含绝对路径与行号，可直接 `read` 复核。**若某条在原文中找不到，请按「编造」处理并退回。**

---

## 15. 本次取证方式（可复核）

- 官方文档统一取 Mintlify 的 markdown 源：`https://code.claude.com/docs/en/<page>.md`（渲染页等价）；文档索引取自 `https://code.claude.com/docs/llms.txt`。
- 本机 DSH 文档：直接读取 `node_modules/@deepseek-ai/*/README.zh.md`（绝对路径见 §11 前缀）。
- Reasonix：`https://reasonix.io/`、`https://reasonix.io/docs`（经 Firecrawl 渲染抓取，页面为 JS 渲染）、以及 DeepSeek 官方接入页。
- 未使用任何二手博客/社区帖作为对标依据。
