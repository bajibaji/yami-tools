#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { spawn } = require('child_process')
const pricing = require('./runtime/yami-mcp/modules/pricing')
const messagePairs = require('./runtime/yami-mcp/modules/message-pairs')
const contextMeter = require('./runtime/yami-mcp/modules/context-meter')

const PORT = Number(process.env.YAMI_AI_PORT || 5968)
const TOKEN = process.env.YAMI_AI_TOKEN || crypto.randomBytes(24).toString('hex')
const PARENT_PID = Number(process.env.YAMI_AI_PARENT_PID || 0)
const CONFIG_DIR = process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite')
const CONFIG_PATH = path.join(CONFIG_DIR, 'ai-config.json')
const MCP_PATH = path.join(__dirname, 'runtime', 'yami-mcp', 'server.js')
const sessions = new Map()
const seen = new Set()   // 已被模型返回并在上下文中回填过的 tool_call id，避免流式重放时重复回填
let projectRoot = process.env.YAMI_PROJECT_ROOT || ''
let mcp = null

const FILE_MUTATIONS = new Set([
  'write_resource', 'create_script', 'write_script', 'edit_script', 'patch_resource',
  'delete_resource', 'append_event_commands', 'upsert_database_item', 'restore_backup'
])
const OTHER_MUTATIONS = new Set(['click_element', 'trigger_playtest', 'editor_action', 'interact_editor', 'send_player_input', 'send_player_pointer', 'playtest_smoke'])
const HIDDEN_TOOLS = new Set(['cdp_eval'])
// 只读工具：可并发执行（模型常在一条消息里同时读好几个文件）。
// 写盘 / 编辑器动作 / 试玩输入一律独占执行并保持顺序；未列出的工具按独占处理（将来新增写工具不会被误并发）。
// 由 MCP 注册表的 readOnlyHint 动态填充（启动时拉取一次），是并发的真源
const declaredReadOnlyTools = new Set()
// 兜底清单：MCP 未声明 readOnlyHint 时的已知只读工具
const READ_ONLY_TOOLS = new Set([
  'list_resources', 'read_resource', 'validate_resource', 'validate_project',
  'list_scripts', 'read_script', 'parse_plugin_meta', 'compile_check', 'generate_guid',
  'list_event_commands', 'get_event_command_examples',
  'search_project', 'diagnose_runtime', 'project_changelog', 'list_backups',
  'todo_write', 'dump_ui_hierarchy', 'get_runtime_state'
])

/* ============================== 会话存储与上下文预算 ============================== */
// 会话落盘目录：关掉窗口、重启编辑器、甚至隔天回来都能接着聊（对标 Claude Code 的会话恢复）
// 可配置项（便于测试与按机器调优）：YAMI_AI_SESSION_DIR / YAMI_AI_CONTEXT_BUDGET / YAMI_AI_CONTEXT_KEEP / YAMI_AI_MAX_STEPS
const SESSION_DIR = process.env.YAMI_AI_SESSION_DIR || path.join(CONFIG_DIR, 'sessions')
const MAX_STEPS = Number(process.env.YAMI_AI_MAX_STEPS || 12)      // 单轮最多连续工具调用步数
const TOOL_RESULT_LIMIT = Number(process.env.YAMI_AI_TOOL_LIMIT || 24000)  // 工具结果进上下文时保留的总字符数（头+尾）
const TOOL_RESULT_TAIL = Number(process.env.YAMI_AI_TOOL_TAIL || 4000)     // 其中留给尾部的字符数（报错原文与结论常在末尾）

/**
 * 上下文治理规格（单一事实源，全部走 context-meter）：
 *   · 窗口 = 官方公布的 1M token（deepseek-flash / v4-pro 同）；
 *   · 占用达到窗口的 80% 就自动压缩（对齐 DSH compaction-basic 的 thresholdRatio）；
 *   · 压缩后原样保留最近 16% 窗口（DSH 的 retainRatio），另加「至少保留 N 条消息」的下限。
 * 可用环境变量覆盖以便测试与按机器调优：YAMI_AI_CONTEXT_WINDOW / YAMI_AI_COMPACT_THRESHOLD
 * / YAMI_AI_COMPACT_RETAIN / YAMI_AI_CONTEXT_KEEP。
 */
function contextSpec() {
  return contextMeter.resolveSpec({
    contextWindow: Number(process.env.YAMI_AI_CONTEXT_WINDOW || contextMeter.DEFAULT_CONTEXT_WINDOW),
    thresholdRatio: Number(process.env.YAMI_AI_COMPACT_THRESHOLD || contextMeter.DEFAULT_THRESHOLD_RATIO),
    retainRatio: Number(process.env.YAMI_AI_COMPACT_RETAIN || contextMeter.DEFAULT_RETAIN_RATIO),
    minKeepMessages: Number(process.env.YAMI_AI_CONTEXT_KEEP || contextMeter.DEFAULT_MIN_KEEP_MESSAGES)
  })
}

/** 模型可见的工具 schema：整轮复用同一个数组实例，估算结果才能命中缓存 */
let toolsForModel = []

function safeSessionId(id) {
  const text = String(id || 'default').trim() || 'default'
  return text.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
}

function sessionPath(id) {
  return path.join(SESSION_DIR, safeSessionId(id) + '.json')
}

/** 精简会话结构用于落盘：丢掉函数引用等不可序列化字段 */
function serializeSession(session) {
  return {
    id: session.id,
    updatedAt: Date.now(),
    summary: session.summary || '',
    usage: session.usage || null,
    grants: session.grants || [],
    // 真实用量锚点一并落盘：重启后刻度仍然贴近真实值，不必重新估一遍
    tokenAnchor: session.tokenAnchor || null,
    messages: session.messages,
    pending: session.pending
      ? {
          call: session.pending.call,
          name: session.pending.name,
          args: session.pending.args,
          preview: session.pending.preview,
          remaining: session.pending.remaining || []
        }
      : null
  }
}

function saveSession(session) {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true })
    const data = serializeSession(session)
    fs.writeFileSync(sessionPath(session.id), JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    process.stderr.write('[danjuan-ai] 会话保存失败: ' + error.message + '\n')
  }
}

function loadSessionFromDisk(id) {
  try {
    const data = JSON.parse(fs.readFileSync(sessionPath(id), 'utf8'))
    if (!data || !Array.isArray(data.messages)) return null
    return {
      id: safeSessionId(id),
      messages: data.messages,
      summary: data.summary || '',
      usage: data.usage || null,
      grants: Array.isArray(data.grants) ? data.grants : [],
      pending: data.pending || null,
      tokenAnchor: data.tokenAnchor || null,
      seen: new Set(),
      busy: false
    }
  } catch {
    return null
  }
}

/** 会话里适合回显给前端的消息（跳过 system 与纯工具结果，长内容截断）
 *  压缩检查点单独处理：剥掉引导语与标签，只把摘要正文当一条助手消息回显，
 *  否则用户会在历史里看到一大段「这是自动生成的检查点…」的机器话。
 *  思考过程（reasoning_content）一并回传：它一直好好地存在会话文件里，只是以前回显时被
 *  丢掉了，于是切回旧会话看起来就像"当时的思考凭空消失"。 */
function visibleMessages(session, limit = 4000) {
  const reasoningLimit = limit * 2   // 思考通常比正文长，给两倍额度
  return session.messages
    .filter(message => message.role === 'user' || (message.role === 'assistant' && message.content))
    .map(message => {
      if (isCheckpoint(message)) {
        const summary = String(message.content)
          .replace(/[\s\S]*?<compacted-summary>\s*/, '')
          .replace(/\s*<\/compacted-summary>[\s\S]*$/, '')
        return { role: 'assistant', content: ('【早前对话已压缩，以下是要点】\n\n' + summary).slice(0, limit), reasoning: '' }
      }
      return {
        role: message.role,
        content: String(message.content || '').slice(0, limit),
        reasoning: message.reasoning_content ? String(message.reasoning_content).slice(0, reasoningLimit) : ''
      }
    })
}

function listSessions() {  try {
    return fs.readdirSync(SESSION_DIR)
      .filter(name => name.endsWith('.json'))
      .map(name => {
        const id = name.replace(/\.json$/, '')
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, name), 'utf8'))
          const firstUser = (data.messages || []).find(message => message.role === 'user')
          return {
            id,
            updatedAt: data.updatedAt || 0,
            title: String(firstUser && firstUser.content || '新对话').replace(/\s+/g, ' ').slice(0, 40),
            messageCount: (data.messages || []).length
          }
        } catch {
          return { id, updatedAt: 0, title: '（无法读取）', messageCount: 0 }
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30)
  } catch {
    return []
  }
}

/**
 * 工具结果裁剪：超长结果保留**开头与结尾**（结尾很重要——报错原文、命令输出结论都在末尾，
 * 只留开头会让模型看不到关键几行，进而反复重读同一个文件），中段给出明确提示而不是静默丢弃。
 */
function clipToolResult(result) {
  let text
  try {
    text = JSON.stringify(result)
  } catch {
    return '{"ok":false,"error":"工具结果无法序列化"}'
  }
  if (!text || text.length <= TOOL_RESULT_LIMIT) return text
  // 尾部预算不能超过总预算的一半，否则小预算下"只有尾巴"反而更长
  const tailBudget = Math.max(0, Math.min(TOOL_RESULT_TAIL, Math.floor(TOOL_RESULT_LIMIT / 2)))
  const headChars = Math.max(0, TOOL_RESULT_LIMIT - tailBudget)
  const head = text.slice(0, headChars)
  const tail = tailBudget > 0 ? text.slice(-tailBudget) : ''
  return JSON.stringify({
    ok: result && result.ok !== false,
    truncated: true,
    originalChars: text.length,
    note: `工具结果过长已裁剪（原 ${text.length} 字符，保留开头与结尾）。需要完整内容请用更精确的参数（如 read_resource 的 key、list_* 的分页）重新获取。`,
    head: tail ? head + '\n...(中段省略)...\n' + tail : head
  })
}

/**
 * 发送前的强制体检：把"带 tool_calls 却没有 tool 应答"的坏序列补齐。
 *
 * 历史事故：空转保护/用户打断等提前退出路径漏了回填，坏序列随会话落盘，之后每次请求都被
 * 上游 400 拒绝（面板只显示一句跟设置无关的报错），整个会话就此报废。坏序列一旦写进历史就
 * 会一直跟着用户，所以修复必须发生在**每次发请求之前**，而不是指望每条退出路径自觉。
 */
function healSessionMessages(session, reason) {
  const result = messagePairs.repairToolPairs(session.messages, { reason })
  if (!result.changed) return false
  session.messages = result.messages
  saveSession(session)
  const { filled, droppedOrphan, droppedDuplicate, droppedEmptyCalls } = result.fixes
  process.stderr.write(`[danjuan-ai] 消息序列已自愈（${reason}）：补 ${filled} 条工具应答，剔除越界 ${droppedOrphan + droppedDuplicate} 条、空调用 ${droppedEmptyCalls} 条\n`)
  return true
}

/** 给"确定不会执行"的工具调用补应答：它们已经进了历史，缺应答就会变成坏序列 */
function appendUnexecutedToolResults(session, calls, reason) {
  const answered = new Set()
  for (const message of session.messages) {
    if (message && message.role === 'tool' && message.tool_call_id) answered.add(message.tool_call_id)
  }
  const placeholder = messagePairs.notExecutedResult(reason)
  let added = 0
  for (const call of calls || []) {
    if (!call || !call.id || answered.has(call.id)) continue
    session.messages.push({ role: 'tool', tool_call_id: call.id, content: placeholder })
    answered.add(call.id)
    added++
  }
  if (added) saveSession(session)
  return added
}

/** 上游对"消息序列不合法"的拒绝（各家措辞不同，这里只认特征最强的几种） */
function isSequenceError(error) {
  const text = String((error && error.message) || '')
  return /tool_call_id|insufficient tool messages|tool_calls?[^。]{0,40}(must|should) be followed|role ['"]?tool['"]?[^。]{0,40}(must|should)/i.test(text)
}

/** 当前上下文的 token 占用：有真实用量锚点时以锚点为准，误差不随对话变长而累积 */
function measureContext(session, tools) {
  return contextMeter.measure(session.messages, { tools: tools || toolsForModel, anchor: session.tokenAnchor })
}

/** 给前端用的上下文刻度：token 计量 + 窗口占比（文案在宿主侧算好，前端只管显示） */
function contextStatus(session) {
  if (!session) return null
  const spec = contextSpec()
  const usage = measureContext(session)
  const percent = Math.max(0, Math.min(999, Math.round(usage.tokens / spec.contextWindow * 100)))
  return {
    tokens: usage.tokens,
    window: spec.contextWindow,
    thresholdTokens: spec.thresholdTokens,
    percent,
    calibrated: usage.calibrated,
    messages: session.messages.length,
    summary: !!session.summary,
    nearLimit: usage.tokens >= spec.thresholdTokens,
    label: contextMeter.formatTokens(usage.tokens) + '/' + contextMeter.formatTokens(spec.contextWindow) + ' · ' + percent + '%'
  }
}

/** 检查点包装：用一段固定引导语让后续模型把摘要当作既定背景，而不是当成新指令 */
const CHECKPOINT_PREAMBLE = '这是自动生成的检查点，浓缩了此前的对话以腾出上下文。把其中内容当作已经确认的背景继续推进，不要复述它，也不要提到这次压缩，直接接着后面的消息做事。'
const CHECKPOINT_OPEN = '<compacted-summary>'
const CHECKPOINT_CLOSE = '</compacted-summary>'

/**
 * 摘要指令：八节固定结构照搬 DeepSeek Harness 的 compaction 提示词。
 * 结构必须完整（空节写「（无）」）—— 能丢的只有细节，不能丢的是「有哪些类别的事实」，
 * 少一节就等于小模型永远想不起来还有这类信息要交代。
 */
const COMPACTION_INSTRUCTION = [
  '你现在是本 AI 开发助手的压缩引擎。把上面的对话浓缩成一份结构化检查点，让另一个模型能在不丢关键信息的前提下接续工作。',
  '',
  '严格按下面的 Markdown 结构输出：每一节都必须保留、顺序不变。用简短的项目符号，不要写成长段文字。某一节为空就写「（无）」，绝不删节。',
  '',
  '## 主要请求与意图',
  '- [用户最初与演变后的目标；措辞重要时按原话引用]',
  '',
  '## 关键技术概念',
  '- [涉及的技术、框架、模式与约定]',
  '',
  '## 文件与代码',
  '- [精确路径：为什么重要、关键改动或代码片段]',
  '',
  '## 错误与修复',
  '- [报错：如何解决的，以及相关的用户反馈]',
  '',
  '## 待办事项',
  '- [用户明确要求但尚未完成的事]',
  '',
  '## 当前工作',
  '- [此刻正在做什么]',
  '',
  '## 下一步',
  '- [紧接着的单一动作，与最近一次请求一致；没有就写「（无）」]',
  '',
  '## 关键上下文',
  '- [决策及其理由、约束、用户偏好、未决问题、继续工作所需的数据]',
  '',
  '规则：',
  '- 用简体中文书写，保留精确的文件路径、命令、报错原文、标识符、数值、函数签名与语法片段。',
  '- 忠实记录用户的反馈与明确指令，尤其是纠正意见。',
  '- 不要提到这次摘要请求，也不要提到上下文被压缩过。',
  '- 只输出检查点文本：不要调用任何工具，也不要执行任何其他动作。',
  `- 如果对话里已经出现 ${CHECKPOINT_OPEN} 块，那是上一次的检查点：不要把旧内容原样抄过来，保留仍然成立的事实、丢掉过期的，把新信息合并进同一份结构。`
].join('\n')

/** 一条消息是不是压缩检查点 */
function isCheckpoint(message) {
  return !!message && typeof message.content === 'string' && message.content.includes(CHECKPOINT_OPEN)
}

/**
 * 上下文治理：两级压缩（对齐 DeepSeek Harness 的 compaction 设计）
 *   第一级 确定性修剪：历史里超长的工具结果换成「头 + 标记 + 尾」，不调模型、零成本、可复现；
 *   第二级 模型摘要：把中段历史折叠成一份结构化检查点，替换成一条消息。
 * 触发条件是「占用达到窗口阈值（默认 1M 的 80%）」，而不是撞满窗口才动手。
 * 布局：system → 检查点(user) → ...最近消息，是合法且省事的对话序列。
 */
async function compressContext(session, config, key, tools) {
  const spec = contextSpec()
  const usage = measureContext(session, tools)
  const fixedOverhead = contextMeter.estimateTools(tools || toolsForModel)
  const decision = contextMeter.shouldCompact({ tokens: usage.tokens, toolsTokens: fixedOverhead, thresholdTokens: spec.thresholdTokens })
  if (!decision.compact) {
    if (decision.reason === 'fixed-overhead') {
      process.stderr.write(`[danjuan-ai] 工具定义本身约占 ${fixedOverhead} token，已达压缩阈值 ${spec.thresholdTokens}，压缩对话没有意义，已跳过\n`)
    }
    return false
  }
  if (session.messages.length <= spec.minKeepMessages + 3) return false

  // ---- 第一级：确定性修剪（多数情况下这一步就够，且不花一分钱 token） ----
  const pruned = contextMeter.pruneToolResults(session.messages)
  if (pruned.pruned.length) {
    session.messages = pruned.messages
    session.tokenAnchor = null   // 消息内容被改写，真实用量锚点随之作废
    saveSession(session)
    process.stderr.write(`[danjuan-ai] 上下文修剪：${pruned.pruned.length} 条超长工具结果改为头尾保留，省下约 ${pruned.savedTokens} token\n`)
  }
  const afterPrune = measureContext(session, tools)
  if (afterPrune.tokens < spec.thresholdTokens) return pruned.pruned.length > 0

  // ---- 第二级：模型摘要 ----
  const before = session.messages
  // 保留范围：先按 token 预算从尾部累积，再对齐到工具调用组边界（切在 tool 消息上会造出坏序列）
  const startIndex = messagePairs.alignStartIndex(before, contextMeter.selectStartIndex(before, spec.retainTokens, spec))
  if (startIndex <= 1) return pruned.pruned.length > 0
  const system = before[0]
  const tail = before.slice(startIndex)
  const folded = before.slice(1, startIndex)

  let summaryText = ''
  if (key) {
    try {
      // 摘要调用重放「system + 待折叠消息」再追加指令：与正常请求共享同一段前缀，
      // 上游的前缀缓存能直接复用；也让摘要看到的是原文，而不是二手的压缩描述。
      // 必须走流式：非流式在整段生成的漫长时间里没有任何数据流动，会撞上 socket 空闲超时
      // （摘要恰好是"超大输入 + 长输出"的最坏场景）。
      const produced = await requestModelStream(config, key, [
        ...before.slice(0, startIndex),
        { role: 'user', content: COMPACTION_INSTRUCTION }
      ], tools || toolsForModel, () => {}, null)
      summaryText = String(produced.content || '').trim()
      if (produced.__usage) session.usage = pricing.addUsage(session.usage, produced.__usage)
      if (!summaryText) process.stderr.write('[danjuan-ai] 摘要调用没有返回文本，改用静态折叠\n')
    } catch (error) {
      process.stderr.write('[danjuan-ai] 上下文摘要失败，改用静态折叠: ' + error.message + '\n')
    }
  }
  if (!summaryText) {
    // 摘要失败也要交出一份结构完整的检查点：骨架 + 逐条要点。
    // 「细节不可用」这种话等于把历史全扔了——要点行至少保住目标、改了哪些文件、报了什么错。
    const digest = folded
      .filter(message => message.role !== 'system')
      .map(message => {
        const role = message.role === 'tool' ? '工具结果' : message.role === 'assistant' ? '助手' : '用户'
        const calls = Array.isArray(message.tool_calls) && message.tool_calls.length
          ? '（调用 ' + message.tool_calls.map(call => call.function && call.function.name).join('、') + '）'
          : ''
        return '- ' + role + calls + '：' + String(message.content || '').replace(/\s+/g, ' ').slice(0, 200)
      })
      .join('\n')
    const previous = session.summary ? session.summary + '\n' : ''
    summaryText = previous + [
      '## 主要请求与意图',
      '- （模型摘要未成功，以下为折叠要点的机械摘录）',
      '',
      '## 关键技术概念',
      '- （无）',
      '',
      '## 文件与代码',
      `- 已折叠 ${folded.length} 条较早的对话与工具结果，逐条要点见「关键上下文」。`,
      '',
      '## 错误与修复',
      '- （无）',
      '',
      '## 待办事项',
      '- （无）',
      '',
      '## 当前工作',
      '- （无）',
      '',
      '## 下一步',
      '- （无）',
      '',
      '## 关键上下文',
      digest || '- （无）',
      '',
      '- 需要早前细节时，请重新读取相关文件，不要凭记忆推断。'
    ].join('\n')
  }
  session.summary = summaryText
  session.messages = [system, {
    role: 'user',
    content: CHECKPOINT_PREAMBLE + '\n\n' + CHECKPOINT_OPEN + '\n' + summaryText + '\n' + CHECKPOINT_CLOSE
  }, ...tail]
  session.tokenAnchor = null
  // 折叠只动"组边界"，但历史里可能本来就残留坏序列（旧版本写下的），顺手体检一次
  healSessionMessages(session, '上下文压缩后体检')
  if (session.seen) session.seen.clear()
  else session.seen = new Set()
  for (const message of session.messages) {
    if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) session.seen.add(call.id)
  }
  const after = measureContext(session, tools)
  process.stderr.write(`[danjuan-ai] 上下文已压缩：折叠 ${folded.length} 条，${before.length} → ${session.messages.length} 条，约 ${contextMeter.formatTokens(usage.tokens)} → ${contextMeter.formatTokens(after.tokens)} token\n`)
  return true
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-yami-agent-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  res.end(JSON.stringify(data))
}

function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => {
      raw += chunk
      if (raw.length > limit) { reject(new Error('请求内容过大')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { reject(new Error('请求 JSON 无法解析')) }
    })
    req.on('error', reject)
  })
}

/** 探测本机 5968 上是否已有可用 AI Host（用于多窗口竞态时的实例复用） */
function probeStatus(callback) {
  let settled = false
  const done = value => { if (!settled) { settled = true; callback(value) } }
  const req = http.request({
    hostname: '127.0.0.1', port: PORT, path: '/status', method: 'GET',
    headers: { 'x-yami-agent-token': TOKEN }, timeout: 1200
  }, res => {
    let raw = ''
    res.on('data', chunk => { raw += chunk })
    res.on('end', () => {
      if (res.statusCode !== 200) return done(null)
      try { done(JSON.parse(raw)) } catch { done(null) }
    })
  })
  req.on('timeout', () => { req.destroy(); done(null) })
  req.on('error', () => done(null))
  req.end()
}

function isProjectRoot(root) {
  try {
    const dir = path.resolve(String(root || ''))
    return fs.existsSync(path.join(dir, 'game.yamirpg')) || (fs.existsSync(path.join(dir, 'Assets')) && fs.existsSync(path.join(dir, 'Data')))
  } catch { return false }
}

function psDpapi(mode, value) {
  if (process.platform !== 'win32') return Promise.resolve(mode === 'protect' ? Buffer.from(value, 'utf8').toString('base64') : Buffer.from(value, 'base64').toString('utf8'))
  const code = mode === 'protect'
    ? "[Reflection.Assembly]::LoadWithPartialName('System.Security')|Out-Null;$v=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))"
    : "[Reflection.Assembly]::LoadWithPartialName('System.Security')|Out-Null;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))"
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || 'Windows 密钥保护失败')))
    child.stdin.end(String(value))
  })
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-flash'

/**
 * 把用户填的地址规整成「Base URL（OpenAI 格式）」。
 * 按官方文档（api-docs.deepseek.com）：BASE URL 就是 https://api.deepseek.com，
 * 对话接口是 base + /chat/completions。为了兼容老配置（有人直接贴了完整地址），
 * 这里统一剥掉 /chat/completions 后缀，避免拼成 .../chat/completions/chat/completions。
 */
function normalizeBaseUrl(value) {
  let text = String(value || '').trim()
  if (!text) return DEFAULT_BASE_URL
  text = text.replace(/\/+$/, '')
  text = text.replace(/\/chat\/completions$/i, '')
  return text || DEFAULT_BASE_URL
}

/** 由 Base URL 推导对话接口地址 */
function chatCompletionsUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl) + '/chat/completions'
}

function readStoredConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return {
      endpoint: normalizeBaseUrl(data.baseUrl || data.endpoint),
      model: data.model || DEFAULT_MODEL,
      thinkingMode: data.thinkingMode === 'disabled' ? 'disabled' : 'enabled',
      thinkingEffort: ['low', 'high', 'max'].includes(data.thinkingEffort) ? data.thinkingEffort : 'high',
      // 思考过程显示方式属于界面偏好，前端 localStorage 之外再存一份到宿主配置，
      // 免得换了窗口/清了站点数据后又"设置没保存"
      thinkingView: ['expand', 'preview', 'collapse'].includes(data.thinkingView) ? data.thinkingView : 'preview',
      encryptedKey: data.encryptedKey || '',
      keyTail: data.keyTail || '',
      keyInvalidReason: data.keyInvalidReason || '',
      approvalMode: data.approvalMode === 'auto' ? 'auto' : 'confirm'
    }
  } catch {
    return { endpoint: DEFAULT_BASE_URL, model: DEFAULT_MODEL, thinkingMode: 'enabled', thinkingEffort: 'high', thinkingView: 'preview', encryptedKey: '', keyTail: '', keyInvalidReason: '', approvalMode: 'confirm' }
  }
}

/**
 * 密钥体检：把「明显填错」当场说清楚，别等 API 回一句 401 让用户猜。
 * 实测踩过：密钥栏里存进来的是 BASE URL（"https://api.deepseek.com/"），
 * 面板还显示"已安全保存"，每次调用都 401 Authentication Fails。
 */
function inspectApiKey(value, endpoint) {
  const text = String(value || '').trim()
  if (!text) return { ok: false, reason: '还没有填写 API Key' }
  // 填成网址是铁错，任何端点都不可能是对的
  if (/^https?:\/\//i.test(text) || text.includes('://')) {
    return { ok: false, reason: 'API Key 那一栏填的是网址（' + text.slice(0, 32) + '）：密钥以 sk- 开头，地址请填在 BASE URL 那一栏' }
  }
  // 官方端点才管形状；本地推理服务（Ollama/LM Studio 等）的密钥本来就是随便填的，不能拦
  const official = /api\.deepseek\.com/i.test(String(endpoint || ''))
  if (official && !/^sk-[A-Za-z0-9_-]{16,}$/.test(text)) {
    return { ok: true, warn: '这串不太像 DeepSeek 官方密钥（官方形如 sk- + 32 位），如果是官方地址请确认没复制错' }
  }
  return { ok: true }
}

/**
 * 启动时体检一次已存的密钥：老配置里可能存着网址之类的垃圾，
 * 留着只会让面板一直显示"已保存"，实际每次调用都 401。发现就该清掉并说明原因。
 */
async function migrateStoredKey() {
  let data
  try { data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) } catch { return }
  if (!data.encryptedKey || data.keyInvalidReason) return
  let key = ''
  try { key = await psDpapi('unprotect', data.encryptedKey) } catch { key = '' }
  const verdict = inspectApiKey(key, data.baseUrl || data.endpoint)
  if (verdict.ok) {
    if (!data.keyTail) data.keyTail = String(key).slice(-4)
    if (verdict.warn) data.keyInvalidReason = ''
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    return
  }
  data.encryptedKey = ''
  data.keyTail = ''
  data.keyInvalidReason = verdict.reason
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  process.stderr.write('[danjuan-ai] 已清除无效密钥：' + verdict.reason + '\n')
}

/**
 * 拉取模型列表（OpenAI 兼容 GET {baseUrl}/models）。
 * 部分本地推理服务不提供该接口，因此失败要如实说明而不是装作拿到了列表。
 */
function fetchModels(config, apiKey) {
  return new Promise((resolve, reject) => {
    let url
    try { url = new URL(normalizeBaseUrl(config.endpoint) + '/models') } catch { return reject(new Error('模型地址无法解析')) }
    const transport = url.protocol === 'http:' ? http : https
    const headers = { Accept: 'application/json' }
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey
    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: 'GET', headers, timeout: 15000 }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk; if (raw.length > 2 * 1024 * 1024) { reject(new Error('模型列表响应过大')); req.destroy() } })
      res.on('end', () => {
        let data
        try { data = JSON.parse(raw) } catch { return reject(new Error('模型列表无法解析（服务可能不提供 /models 接口）')) }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error((data.error && data.error.message) || ('获取模型列表失败：HTTP ' + res.statusCode)))
        }
        const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
        const models = list.map(item => (typeof item === 'string' ? item : item && (item.id || item.name))).filter(Boolean)
        if (!models.length) return reject(new Error('服务返回的模型列表为空'))
        resolve(models.sort())
      })
    })
    req.on('error', error => reject(new Error('获取模型列表失败：' + error.message)))
    req.on('timeout', () => { req.destroy(); reject(new Error('获取模型列表超时')) })
    req.end()
  })
}

/**
 * 查询账户余额。只有 DeepSeek 官方域名提供该接口（GET /user/balance），
 * 其它 OpenAI 兼容端点（本地推理等）一律如实说明不支持，不去瞎试。
 */
function fetchBalance(config, apiKey) {
  return new Promise((resolve, reject) => {
    const base = normalizeBaseUrl(config.endpoint)
    if (!/api\.deepseek\.com/i.test(base)) {
      return reject(new Error('当前地址不是 DeepSeek 官方端点，无法查询余额（本地或第三方端点不提供该接口）'))
    }
    if (!apiKey) return reject(new Error('请先填写 API Key'))
    const url = new URL(base + '/user/balance')
    const req = https.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname, method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + apiKey }, timeout: 15000 }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        let data
        try { data = JSON.parse(raw) } catch { return reject(new Error('余额响应无法解析')) }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error((data.error && data.error.message) || ('查询余额失败：HTTP ' + res.statusCode)))
        }
        const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
        const cny = infos.find(item => item && item.currency === 'CNY') || infos[0] || null
        resolve({
          isAvailable: data.is_available !== false,
          currency: cny ? cny.currency : 'CNY',
          total: cny ? cny.total_balance : null,
          granted: cny ? cny.granted_balance : null,
          toppedUp: cny ? cny.topped_up_balance : null
        })
      })
    })
    req.on('error', error => reject(new Error('查询余额失败：' + error.message)))
    req.on('timeout', () => { req.destroy(); reject(new Error('查询余额超时')) })
    req.end()
  })
}

async function saveConfig(input) {
  const current = readStoredConfig()
  const normalized = normalizeBaseUrl(input.baseUrl || input.endpoint || current.endpoint)
  const next = {
    baseUrl: normalized,
    // 同时写 endpoint：publicConfig 与历史读取路径都以它为口径，少一个就会出现
    // 「保存成功但返回的还是旧地址」这种自相矛盾（实测踩过）
    endpoint: normalized,
    model: String(input.model || current.model).trim() || DEFAULT_MODEL,
    thinkingMode: (input.thinkingMode || current.thinkingMode) === 'disabled' ? 'disabled' : 'enabled',
    thinkingEffort: ['low', 'high', 'max'].includes(input.thinkingEffort) ? input.thinkingEffort : (current.thinkingEffort || 'high'),
    thinkingView: ['expand', 'preview', 'collapse'].includes(input.thinkingView) ? input.thinkingView : (current.thinkingView || 'preview'),
    approvalMode: input.approvalMode === 'auto' ? 'auto' : 'confirm',
    encryptedKey: current.encryptedKey
  }
  if (!/^https?:\/\//i.test(next.baseUrl)) throw new Error('模型地址必须以 http:// 或 https:// 开头')
  next.keyTail = current.keyTail || ''
  next.keyInvalidReason = current.keyInvalidReason || ''
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    const verdict = inspectApiKey(input.apiKey, next.baseUrl)
    if (!verdict.ok) throw new Error('API Key 无效：' + verdict.reason)
    next.encryptedKey = await psDpapi('protect', input.apiKey.trim())
    next.keyTail = input.apiKey.trim().slice(-4)
    next.keyInvalidReason = verdict.warn || ''
  }
  if (input.clearApiKey === true) { next.encryptedKey = ''; next.keyTail = ''; next.keyInvalidReason = '' }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  return publicConfig(next)
}

function publicConfig(config = readStoredConfig()) {
  return {
    endpoint: config.endpoint, baseUrl: config.endpoint, chatUrl: chatCompletionsUrl(config.endpoint),
    model: config.model, thinkingMode: config.thinkingMode, thinkingEffort: config.thinkingEffort,
    thinkingView: config.thinkingView,
    approvalMode: config.approvalMode,
    hasApiKey: !!(config.encryptedKey || process.env.DEEPSEEK_API_KEY),
    keyTail: config.keyTail || '',
    keyInvalidReason: config.keyInvalidReason || ''
  }
}

async function getApiKey(config) {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  return config.encryptedKey ? await psDpapi('unprotect', config.encryptedKey) : ''
}

class McpClient {
  constructor(root) {
    this.root = root
    this.child = null
    this.buffer = ''
    this.id = 1
    this.pending = new Map()
    this.tools = []
  }

  async start() {
    if (!fs.existsSync(MCP_PATH)) throw new Error('插件内置 yami-mcp 缺失，请重新安装或更新插件')
    if (!isProjectRoot(this.root)) throw new Error('当前没有打开有效的 Open Yami 工程')
    this.child = spawn(process.execPath, [MCP_PATH, '--root', this.root], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', YAMI_PROJECT_ROOT: this.root, YAMI_MCP_GUARDED: '1' }
    })
    this.child.stdout.on('data', chunk => this.onData(chunk))
    this.child.stderr.on('data', chunk => process.stderr.write('[embedded-mcp] ' + chunk.toString()))
    this.child.on('exit', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('内置 MCP 进程已退出'))
      this.pending.clear()
      this.child = null
    })
    await this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'danjuan-ai', version: '1.1.0' } })
    const list = await this.rpc('tools/list', {})
    this.tools = (list.tools || []).filter(tool => !HIDDEN_TOOLS.has(tool.name))
    // 用注册表声明刷新只读集合：工具自己说只读的才允许并发
    declaredReadOnlyTools.clear()
    for (const tool of this.tools) if (tool.readOnlyHint === true) declaredReadOnlyTools.add(tool.name)
    return this
  }

  onData(chunk) {
    this.buffer += chunk.toString()
    let index
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const pending = this.pending.get(msg.id)
      if (pending) { this.pending.delete(msg.id); msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result) }
    }
  }

  rpc(method, params) {
    if (!this.child) return Promise.reject(new Error('内置 MCP 未启动'))
    const id = this.id++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 超时')) }, 180000)
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  async call(name, args) {
    const result = await this.rpc('tools/call', { name, arguments: args || {} })
    const text = result.content && result.content[0] && result.content[0].text
    return text ? JSON.parse(text) : { ok: !result.isError }
  }

  close() { if (this.child) this.child.kill() }
}

async function ensureMcp() {
  if (!mcp) mcp = await new McpClient(projectRoot).start()
  return mcp
}

function modelTools(tools) {
  return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema || { type: 'object', properties: {} } } }))
}

/** 把 usage 归一成计费口径（兼容 OpenAI 与 DeepSeek 的字段命名差异） */
function normalizeUsage(model, raw) {
  const usage = raw || {}
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0
  const completionTokens = Number(usage.completion_tokens ?? usage.completionTokens ?? 0) || 0
  const cachedTokens = Number(
    usage.prompt_cache_hit_tokens ?? usage.prompt_cache_hit ?? usage.cached_tokens ?? 0
  ) || 0
  return { model, promptTokens, completionTokens, cachedTokens, at: new Date() }
}

/**
 * 组装模型请求体。
 * 思考模式按官方文档（OpenAI 格式）：
 *   · thinking 开关：{"thinking":{"type":"enabled"|"disabled"}}
 *   · 思考强度：reasoning_effort = low | high | max（默认 high）
 * 注意：思考模式下 temperature 不生效（官方明确），因此开启思考时不再传 temperature。
 */
/**
 * 发给 API 前清洗消息：
 *   · 助手消息保留 reasoning_content —— 带 tools 的请求官方要求完整回传，否则 400；
 *   · 剥掉我们自己的内部字段（__usage 等），避免污染请求体。
 */
function messagesForApi(messages) {
  return messages.map(message => {
    const clean = {}
    for (const [key, value] of Object.entries(message)) {
      if (key.startsWith('__')) continue
      if (value === undefined) continue
      clean[key] = value
    }
    return clean
  })
}

function buildModelBody(config, messages, tools, stream) {
  const thinkingOn = config.thinkingMode !== 'disabled'
  const body = { model: config.model, messages: messagesForApi(messages), stream }
  // 没有工具时不要发 tools / tool_choice：空数组与孤立的 tool_choice 都可能被上游判为非法请求
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools
    // 注意：思考模式下 tool_choice 不支持 required / 指定具体工具（官方会返回 400），这里固定 auto。
    body.tool_choice = 'auto'
  }
  // stream_options 必须与 stream:true 同用（官方：单独用会 400）；带上它流式响应才会在末尾给出 usage，
  // 否则拿不到真实 token 用量、费用估算只能瞎猜。
  if (stream) body.stream_options = { include_usage: true }
  if (thinkingOn) {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = config.thinkingEffort || 'high'
  } else {
    body.thinking = { type: 'disabled' }
    // 非思考模式下 temperature 仍有效
    body.temperature = 0.2
  }
  return body
}

function requestModel(config, apiKey, messages, tools) {
  return new Promise((resolve, reject) => {
    const url = new URL(chatCompletionsUrl(config.endpoint))
    const transport = url.protocol === 'http:' ? http : https
    const body = Buffer.from(JSON.stringify(buildModelBody(config, messages, tools, false)), 'utf8')
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': body.length }
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey
    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: 'POST', headers, timeout: 120000 }, res => {
      let raw = ''
      res.on('data', chunk => {
        raw += chunk
        if (raw.length > 16 * 1024 * 1024) { reject(new Error('模型响应过大')); req.destroy() }
      })
      res.on('end', () => {
        let data
        try { data = JSON.parse(raw) } catch { return reject(new Error('模型响应无法解析')) }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(data.error && data.error.message || `模型请求失败：HTTP ${res.statusCode}`))
        const message = data.choices && data.choices[0] && data.choices[0].message
        if (!message) return reject(new Error('模型没有返回消息'))
        if (data.usage) message.__usage = normalizeUsage(config.model, data.usage)
        resolve(message)
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('模型请求超时，请检查网络或模型地址')) })
    req.end(body)
  })
}

/**
 * 流式调用模型（OpenAI 兼容 SSE）。
 * 逐块回调 onDelta({ content, reasoning })，返回与 requestModel 相同形状的 message（含组装好的 tool_calls）。
 * 服务端不支持流式时自动降级为整段返回（返回降级后的 message，调用方无需分支）。
 */
/**
 * 取消令牌：前端点「停止」（或直接断开 SSE）时，用它把信号一路传到
 * 上游模型请求与工具执行循环，做到真正停下而不是只断开界面。
 */
function createCancelToken() {
  const listeners = []
  const token = {
    cancelled: false,
    reason: '',
    cancel(reason) {
      if (token.cancelled) return
      token.cancelled = true
      token.reason = reason || '用户打断'
      for (const fn of listeners.splice(0)) { try { fn(token.reason) } catch (e) { /* 监听器自己的错不该影响取消 */ } }
    },
    onCancel(fn) {
      if (token.cancelled) { try { fn(token.reason) } catch (e) {} return }
      listeners.push(fn)
    }
  }
  return token
}

function requestModelStream(config, apiKey, messages, tools, onDelta, cancelToken) {
  return new Promise((resolve, reject) => {
    let url
    try { url = new URL(chatCompletionsUrl(config.endpoint)) } catch { return reject(new Error('模型地址无法解析')) }
    const transport = url.protocol === 'http:' ? http : https
    const body = Buffer.from(JSON.stringify(buildModelBody(config, messages, tools, true)), 'utf8')
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Content-Length': body.length }
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey

    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      error ? reject(error) : resolve(value)
    }

    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: 'POST', headers, timeout: 180000 }, res => {
      if (cancelToken) cancelToken.onCancel(() => { try { res.destroy() } catch (e) {} })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          let detail = ''
          try { detail = JSON.parse(raw).error.message } catch { detail = raw.slice(0, 200) }
          finish(new Error(detail || `模型请求失败：HTTP ${res.statusCode}`))
        })
        return
      }
      const contentType = String(res.headers['content-type'] || '')
      // 非 SSE（部分本地推理服务忽略 stream 参数）：整段读取后降级处理
      if (!/text\/event-stream/i.test(contentType)) {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          try {
            const data = JSON.parse(raw)
            const message = data.choices && data.choices[0] && data.choices[0].message
            if (!message) return finish(new Error('模型没有返回消息'))
            if (message.content && onDelta) onDelta({ content: message.content })
            finish(null, message)
          } catch {
            finish(new Error('模型响应无法解析（既不是 SSE 也不是 JSON）'))
          }
        })
        return
      }

      res.setEncoding('utf8')
      let buffer = ''
      let content = ''
      let reasoning = ''
      let streamUsage = null
      const toolCalls = new Map()
      const consume = line => {
        const text = line.trim()
        if (!text.startsWith('data:')) return
        const payload = text.slice(5).trim()
        if (!payload || payload === '[DONE]') return
        let event
        try { event = JSON.parse(payload) } catch { return }
        if (event.usage) streamUsage = event.usage
        const choice = event.choices && event.choices[0]
        const delta = choice && (choice.delta || choice.message)
        if (!delta) return
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content
          if (onDelta) onDelta({ content: delta.content })
        }
        const reasoningDelta = delta.reasoning_content || delta.reasoning
        if (typeof reasoningDelta === 'string' && reasoningDelta) {
          reasoning += reasoningDelta
          if (onDelta) onDelta({ reasoning: reasoningDelta })
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const part of delta.tool_calls) {
            const index = typeof part.index === 'number' ? part.index : toolCalls.size
            const current = toolCalls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } }
            if (part.id) current.id = part.id
            if (part.function) {
              if (part.function.name) current.function.name = part.function.name
              if (part.function.arguments) current.function.arguments += part.function.arguments
            }
            toolCalls.set(index, current)
          }
        }
      }
      res.on('data', chunk => {
        buffer += chunk
        let index
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          consume(line)
        }
      })
      res.on('end', () => {
        if (buffer.trim()) consume(buffer)
        const calls = Array.from(toolCalls.keys()).sort((a, b) => a - b).map(key => toolCalls.get(key))
        for (const call of calls) if (!call.id) call.id = 'call_' + crypto.randomBytes(6).toString('hex')
        const message = { role: 'assistant', content, tool_calls: calls.length ? calls : undefined }
        // 思考模式下必须把 reasoning_content 完整回传（带 tools 时官方要求，否则 400）
        if (reasoning) message.reasoning_content = reasoning
        if (streamUsage) message.__usage = normalizeUsage(config.model, streamUsage)
        finish(null, message)
      })
    })
    if (cancelToken) cancelToken.onCancel(() => { try { req.destroy() } catch (e) {} })
    req.on('error', error => finish(cancelToken && cancelToken.cancelled ? new Error(cancelToken.reason) : error))
    req.on('timeout', () => { req.destroy(); finish(new Error('模型请求超时，请检查网络或模型地址')) })
    req.end(body)
  })
}

const SYSTEM_PROMPT = `你是 Open Yami RPG Editor 内置开发副驾。用简体中文回答，面向不懂代码的用户。
你可以通过工具读取和操作当前工程。遵守以下规则：
1. 修改前先读取目标和相关调用方，优先复用现有脚本、事件和引擎能力。
2. 工程文件写入工具先预览；系统会统一处理确认和正式写入，不要绕过确认。
3. TS 修改后调用 compile_check；资源修改后调用 validate_resource，跨资源改动后调用 validate_project。
4. 不暴露 GUID 等内部细节，除非用户明确询问；结果用白话说明改了什么、验证是否通过。
5. 不承诺没有验证的结果。遇到错误时说明恢复办法。不要请求或输出 API Key。

【工作方式：先搜、再看、再改，省上下文】
6. 找东西先 search_project（内容检索）或 list_scripts / list_resources，不要一上来整份读大文件。
   只有命中之后才 read_script / read_resource 读那一个文件，read_resource 遇到大文件请用 key 参数读子节。
7. 改脚本优先 edit_script 做**片段替换**，而不是 write_script 整份重写：
   oldText 要带足够上下文保证在文件里唯一（不唯一会被拒绝并给出行号）；
   先用 dryRun 预览，确认无误再正式写入。整份重写只在新建或大改结构时使用。

【工程领域常识】
8. 目录约定：脚本与资源在 Assets/ 下（.ts 插件脚本、.event 事件、.scene 场景、.ui 界面、.actor/.skill/.item 等资源），
   Data/ 下是数据表（variables、teams、commands、plugins、attribute、enumeration…），Data/manifest.json 是资源索引（不要手改）。
9. 资源文件名形如 名称.16位十六进制.ext，GUID 由文件名决定；改名/新建请用工具，不要手拼 GUID。
10. 事件编排用 append_event_commands，指令用中文名即可（如 显示文本/弹出选项/等待/设置数值/调用事件）；
    不确定指令有哪些参数时先 list_event_commands 或 get_event_command_examples，不要凭空猜参数名。
11. 脚本写入会跑引擎原生 tsc，编译不过会自动回滚；所以修完脚本务必看 compile_check 的结论再说"改好了"。
12. 用户反馈"游戏里不对/报错/卡住"时：先 diagnose_runtime 读运行时诊断（里面有可疑文件、行号、就地源码、卡住事件与白话归因），
    按给的行号用 search_project + edit_script 定位修改，改完 compile_check，最后用 send_player_input 让试玩复现验证。
13. 多步任务（要改多处、或要"检查并修复"这类复合需求）开工时，先用 todo_write 列一份白话待办清单（3~6 步），
    每完成一步就更新一次状态；用户会在界面上看到进度。任务全部完成后把清单清掉或全部标为完成。
14. 用户问"你刚才改了什么 / 改了哪些文件"时，或一次多文件改动收尾时：用 project_changelog 生成改动小结
    （它按内容哈希对比基线，写了又改回去、写失败回滚的都不会被算成变更；还能带出编译与试玩结论）。
15. 改完脚本或事件、想确认"真的还能玩"时：用 playtest_smoke 跑一遍（可传 "down,down,ok" 这类动作脚本）。
    它会自动对比跑之前/之后的运行时诊断，直接告诉你有没有新报错、有没有事件卡住、性能是否恶化。
    需要先在编辑器里启动试玩；如果没在试玩中，如实告诉用户"请先点试玩"，不要假装跑过。
16. 用户说"改回去 / 撤销 / 恢复原样 / 刚才那个不要了"时：用 list_backups 找到要回退的文件与时间点，
    再用 restore_backup 回退（不传 backup 即回到最早那次，也就是你动手之前）；回退前先 dryRun 让用户看到差异。
    回退本身也会留一份安全备份，所以不必担心"退错了就回不去"。`



function sessionFor(id) {
  const key = safeSessionId(id)
  if (!sessions.has(key)) {
    const restored = loadSessionFromDisk(key)
    sessions.set(key, restored || { id: key, messages: [{ role: 'system', content: SYSTEM_PROMPT }], pending: null, summary: '', grants: [], seen: new Set(), busy: false })
  }
  const session = sessions.get(key)
  if (!session.seen) session.seen = new Set()
  return session
}

function safeArgs(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}) } catch { return {} }
}

function summarizePending(name, args, preview) {
  const target = args.path || args.table || args.action || args.key || ''
  const summary = name === 'write_script' ? `替换完整脚本，共 ${String(args.content || '').length} 个字符`
    : name === 'edit_script' ? `精确修改第 ${preview && preview.line || '?'} 行附近（片段替换）`
      : name === 'patch_resource' ? `修改字段：${Object.keys(args.patch || {}).join('、') || '未提供'}`
        : name === 'append_event_commands' ? `写入 ${Array.isArray(args.commands) ? args.commands.length : 0} 条事件指令`
          : name === 'upsert_database_item' ? `更新 ${args.table || '数据表'} 中的一项`
            : name === 'delete_resource' ? '删除此资源（会先备份，可恢复）'
              : name === 'create_script' ? `新建 ${args.nameZh || args.className || '脚本'}`
                : `执行 ${name}`
  const risk = (preview && preview.risk) || (name === 'delete_resource' ? 'high' : 'medium')
  return {
    tool: name,
    target: String(target),
    summary,
    risk,
    message: preview && (preview.message || preview.error) || `准备执行 ${name}`,
    preview: preview ? {
      dryRun: preview.dryRun === true,
      changedBytes: preview.changedBytes,
      oldSha256: preview.oldSha256,
      newSha256: preview.newSha256,
      line: preview.line,
      diff: preview.diff || '',
      diffStat: preview.diffStat || null,
      impact: preview.impact || null
    } : null
  }
}

/** 编译失败自动修复：把 tsc 的原始报错原样喂回模型，让它自己改到编译通过为止 */
const MAX_REPAIR_ATTEMPTS = Number(process.env.YAMI_AI_REPAIR_LIMIT || 2)

/**
 * 判断这次工具执行是否属于「编译没通过、已自动回滚」。
 * 命中后不能就此收工——要把编译器原话交给模型继续修，这才是本工程最需要的闭环。
 */
function compileFailureOf(name, result) {
  if (!result || result.ok !== false) return null
  const compile = result.compile
  if (!compile || compile.ok === true) return null
  // 「本机没找到 tsc」不等于「代码没通过编译」：当成错误会让模型被反复要求去修一个
  // 根本不存在的语法问题（而且永远修不好）。这种情况只在界面上如实说明"这次没校验"。
  if (compile.unavailable) return null
  const output = String(compile.output || '').trim()
  const firstLine = output.split('\n').map(line => line.trim()).find(line => line.includes('error TS')) || ''
  return {
    tool: name,
    path: String(result.path || ''),
    rolledBack: !!result.rollback && !result.rollback.error,
    errorCount: compile.errorCount || 0,
    firstLine,
    output: output.slice(-2000)
  }
}

/** 构造回喂给模型的修复指令：要求最小改动、别再整份重写 */
function repairMessage(failure) {
  return {
    role: 'user',
    content: [
      `刚才的 ${failure.tool} 写入没有通过引擎的 TypeScript 编译检查${failure.rolledBack ? '，文件已自动回滚到修改前的状态' : ''}，所以工程现在是完好的。`,
      failure.firstLine ? `第一条报错：${failure.firstLine}` : '',
      '',
      '编译器原始输出（请严格按里面的 文件:行号 定位）：',
      '```',
      failure.output || '（编译器没有给出输出）',
      '```',
      '',
      '请这样修：',
      '1. 用 search_project 或 read_script 读取报错行附近（不要整份重读）；',
      '2. 用 edit_script 做**最小片段替换**，只改出错的那几行，不要整份重写；',
      '3. 改完必须再确认编译通过，然后才向我汇报结果。',
      '4. 如果同一个报错你修两次都没过，就停下来把原因和两种可行写法讲清楚，不要继续试。'
    ].filter(Boolean).join('\n')
  }
}

/** 会话里是否出现过写盘动作（有才需要生成变更小结） */
function sessionTouchedFiles(session) {
  for (const message of session.messages) {
    if (!Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      const name = call.function && call.function.name
      if (FILE_MUTATIONS.has(name)) return true
    }
  }
  return false
}

/**
 * 任务收尾：生成「本次改动小结」并挂到返回值上。
 * 小结由 MCP 的 project_changelog 依据内容哈希算出真实变更（写了又改回去、写失败回滚都不计），
 * 再合并编译结论与试玩结论——用户不用自己比对就知道这次动了什么。
 */
async function attachChangelog(session, result) {
  if (!result || !sessionTouchedFiles(session)) return result
  try {
    const client = await ensureMcp()
    const summary = await client.call('project_changelog', {})
    // 还没建立基线（例如面板没打开就发了需求）→ 先补建基线，保证后续小结准确
    if (summary && summary.ok && summary.baseline) {
      result.changedFiles = 0
      if (summary.message) result.changelogNote = summary.message
      return result
    }
    if (summary && summary.ok && summary.summary) {
      result.changedFiles = summary.summary.fileCount
      if (summary.todos && summary.todos.length) {
        result.plan = { items: summary.todos, summary: summary.todoSummary }
      }
      // 只在确有净变更时给用户看小结（写了又改回去 / 写失败回滚都不算）
      if (summary.summary.fileCount > 0) {
        result.changelog = {
          headline: summary.headline,
          summary: summary.summary,
          files: (summary.files || []).slice(0, 30),
          playtest: summary.playtest || null,
          nextSteps: summary.nextSteps || []
        }
      }
    }
  } catch (error) {
    process.stderr.write('[danjuan-ai] 变更小结生成失败: ' + error.message + '\n')
  }
  return result
}

/* ============================== 会话内批量授权 ============================== */
// 动机：一件任务里同一个文件常要连着改好几次，每条都弹审批会把人磨烦；
// 而"逐条确认"一旦变成走过场，反而更危险。做法是让用户**显式**授权：
// 批准某次写盘时勾选"本次任务内该文件不再逐条确认"，之后只有这个文件免打扰。
// 安全前提：写盘仍有备份与差异统计、收尾有改动小结、随时可一键撤销。
const DELETE_TOOLS = new Set(['delete_resource'])

function grantKeyOf(name, args) {
  const rel = String((args && args.path) || '')
  return rel ? `${name}::${rel}` : ''
}

function isGranted(session, name, args) {
  if (!session.grants) return false
  // 删除永远逐条确认：不可轻易撤销的动作不接受批量授权
  if (DELETE_TOOLS.has(name)) return false
  const key = grantKeyOf(name, args)
  return !!key && session.grants.includes(key)
}

function addGrant(session, pending) {
  if (!pending) return null
  if (DELETE_TOOLS.has(pending.name)) return null
  const key = grantKeyOf(pending.name, pending.args)
  if (!key) return null
  if (!Array.isArray(session.grants)) session.grants = []
  if (!session.grants.includes(key)) session.grants.push(key)
  return key
}

async function continueSession(session, config, events = {}) {
  const cancelToken = events.cancelToken || null
  const aborted = () => {
    saveSession(session)
    if (events.onNotice) events.onNotice('已打断')
    return {
      ok: true,
      status: 'aborted',
      interrupted: true,
      message: '已打断。我已经停下来了，已完成的改动都保留着，可以接着说下一步。',
      usage: session.usage || null
    }
  }
  const client = await ensureMcp()
  const key = await getApiKey(config)
  if (!key && /api\.deepseek\.com/i.test(config.endpoint)) throw new Error('请先在设置中填写 DeepSeek API Key')
  // 工具 schema 整轮复用同一个数组实例：既省掉重复序列化，也让计量结果命中缓存
  toolsForModel = modelTools(client.tools)
  // 每次发请求前先体检历史：旧版本可能把坏序列写进过会话（上游会一路 400 到底）
  healSessionMessages(session, '发送前体检')
  await compressContext(session, config, key, toolsForModel)
  // 打转保护：同一批工具调用（同名同参）连续重复时，模型已陷入循环，及时中断而不是撞步数上限
  let lastSignature = ''
  let repeats = 0
  let repairJustInjected = false
  let sequenceRetryUsed = false
  for (let step = 0; step < MAX_STEPS; step++) {
    if (cancelToken && cancelToken.cancelled) return aborted()
    if (events.onStatus) events.onStatus(step === 0 ? '正在思考' : `继续处理（第 ${step + 1} 步）`)
    let assistant
    // 记下这次请求实际发出的消息条数：响应里的 prompt_tokens 就是这批消息（含 system 与工具
    // schema）的真实用量，存成锚点后，面板刻度与压缩判定都不用再靠纯估算
    const sentCount = session.messages.length
    try {
      assistant = await requestModelStream(config, key, session.messages, toolsForModel, delta => {
        if (events.onDelta) events.onDelta(delta)
      }, cancelToken)
    } catch (error) {
      // 打断导致的失败不算错误：把已流出的内容留下，如实收尾
      if (cancelToken && cancelToken.cancelled) {
        if (error.message) session.messages.push({ role: 'assistant', content: error.message })
        return aborted()
      }
      // 上游因消息序列不合法而拒绝（400）：先自愈再重试一次，不占步数。
      // 这是给"将来新增的退出路径又漏了回填"准备的兜底——坏序列不该把整个会话锁死。
      if (!sequenceRetryUsed && isSequenceError(error) && healSessionMessages(session, '上游拒绝消息序列')) {
        sequenceRetryUsed = true
        if (events.onNotice) events.onNotice('历史消息不完整，已自动修复，正在重试')
        step--
        continue
      }
      throw error
    }
    assistant.role = 'assistant'
    if (assistant.__usage) {
      session.usage = pricing.addUsage(session.usage, assistant.__usage)
      // 真实用量锚点：prompt_tokens 覆盖了 system、工具 schema 与刚发出的这批消息，
      // 之后的刻度就是「锚点 + 新增消息的估算」，不必自己实现分词器也不会累积误差
      if (Number.isInteger(assistant.__usage.promptTokens) && assistant.__usage.promptTokens > 0) {
        session.tokenAnchor = { messageCount: sentCount, promptTokens: assistant.__usage.promptTokens, toolsTokens: contextMeter.estimateTools(toolsForModel) }
      }
    }
    session.messages.push(assistant)
    saveSession(session)
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : []
    if (!calls.length) return await attachChangelog(session, { ok: true, status: 'done', message: assistant.content || '任务已完成', usage: session.usage || null, usageText: pricing.describeUsage(session.usage) })
    const signature = calls
      .map(call => (call.function && call.function.name) + '(' + String(call.function && call.function.arguments || '') + ')')
      .join('|')
    // 刚喂过编译器报错时不算打转：模型重试同一处修改是正常行为。
    // 此时该由"修复次数上限"来兜底，而不是被误判成死循环（否则会把正常修复掐断）。
    if (!repairJustInjected) {
      if (signature === lastSignature) {
        repeats++
        // 连续 3 次完全相同的调用才算空转：留一轮余量，避免"参数没描述清楚时"被过早掐断
        if (repeats >= 3) {
          const labels = calls.map(call => toolLabel(call.function && call.function.name)).join('、')
          // 这批调用一次都没执行，但它们已经随 assistant 入了历史：必须补上应答，
          // 否则这条坏序列会跟着会话落盘，之后每次请求都被上游 400 拒绝（会话直接废掉）
          appendUnexecutedToolResults(session, calls, '模型陷入重复调用，本次已停止')
          return await attachChangelog(session, {
            ok: false,
            status: 'stuck',
            message: `模型连续 ${repeats + 1} 次执行同一批操作（${labels}），已停止以免空转。可以换个说法需求、让它换个参数/换个文件再试，或先把已完成的改动确认掉再继续。`
          })
        }
      } else {
        lastSignature = signature
        repeats = 0
      }
    }
    repairJustInjected = false
    if (cancelToken && cancelToken.cancelled) {
      // 模型已给出工具调用但用户按下停止：本轮不再执行，避免"说停还在改文件"。
      // 注意：这条带 tool_calls 的 assistant 上面已经入历史了，这里**不能**再补一条去掉
      // tool_calls 的副本（重复消息），而必须给每个未执行的调用补上应答——否则留下的是
      // "有调用、无应答"的坏序列，用户下次一开口就被上游 400 拒绝。
      appendUnexecutedToolResults(session, calls, '用户打断了这次操作')
      session.messages.push({ role: 'user', content: '（用户打断了这次操作，工具调用未执行）' })
      return aborted()
    }
    const outcome = await processToolCalls(session, calls, config, assistant.content, events, cancelToken)
    if (cancelToken && cancelToken.cancelled) return aborted()
    if (outcome.approval) return outcome.approval

    // 编译没通过 → 把编译器报错喂回去让模型自己修（有限次，避免无限重试）
    const failure = (outcome.results || []).map(entry => compileFailureOf(entry.name, entry.result)).find(Boolean)
    if (failure) {
      if ((session.repairs || 0) >= MAX_REPAIR_ATTEMPTS) {
        return await attachChangelog(session, {
          ok: false,
          status: 'compile-failed',
          message: `脚本没能通过编译检查，已自动回滚、工程保持完好。最后一次报错：\n${failure.firstLine || failure.output.split('\n')[0] || '（无输出）'}\n可以让 AI 换个思路再试，或把这条报错贴给我继续排查。`
        })
      }
      session.repairs = (session.repairs || 0) + 1
      session.messages.push(repairMessage(failure))
      saveSession(session)
      repairJustInjected = true
      lastSignature = ''
      repeats = 0
      if (events.onNotice) events.onNotice(`编译没通过（${failure.errorCount} 处），已回滚并让 AI 自动重修（第 ${session.repairs}/${MAX_REPAIR_ATTEMPTS} 次）`)
      continue
    }
  }
  throw new Error(`本次任务步骤过多（已达 ${MAX_STEPS} 步），已停止。请把需求拆成更小的任务后重试`)
}

/** 给前端看的工具中文名，用于「工具条」实时上屏 */
const TOOL_LABELS = {
  list_resources: '列出资源', read_resource: '读取资源', validate_resource: '校验资源', validate_project: '全工程体检',
  write_resource: '写入资源', patch_resource: '修改资源字段', delete_resource: '删除资源',
  list_scripts: '列出脚本', read_script: '读取脚本', write_script: '写入脚本', create_script: '新建脚本',
  parse_plugin_meta: '解析脚本参数', compile_check: '编译检查', generate_guid: '生成 GUID',
  list_event_commands: '读取指令目录', get_event_command_examples: '取指令样例', append_event_commands: '编排事件',
  upsert_database_item: '更新数据表', editor_action: '编辑器操作', interact_editor: '操作编辑器界面',
  dump_ui_hierarchy: '读取界面结构', click_element: '点击界面元素', trigger_playtest: '启动试玩',
  get_runtime_state: '读取运行状态', playtest_smoke: '试玩冒烟测试', send_player_input: '发送按键', send_player_pointer: '发送鼠标',
  search_project: '工程内检索', edit_script: '精确改脚本', diagnose_runtime: '读取运行诊断',
  project_changelog: '生成改动小结', todo_write: '更新待办清单'
}

function toolLabel(name) {
  return TOOL_LABELS[name] || name
}

/**
 * 读写判定：处理一个工具调用时是否需要"独占"执行。
 * 真源是 MCP 注册表里的 readOnlyHint（工具自己声明是否只读），而不是宿主维护的副本——
 * 副本总会漏掉将来新增的工具，一旦漏了就会把新只读工具当独占，白等时间。
 * 只读工具可以并发（模型经常一次要读好几个文件）；写盘/编辑器动作/试玩输入必须独占且保序。
 * 未声明或未登记的工具一律按独占处理，宁可慢一点也不误并发写操作。
 */
function isExclusiveCall(name) {
  if (FILE_MUTATIONS.has(name)) return true
  if (OTHER_MUTATIONS.has(name)) return true
  if (declaredReadOnlyTools.has(name)) return false
  return !READ_ONLY_TOOLS.has(name)
}

/** 执行一个只读调用（不含审批路径，纯读取） */
async function runReadOnly(client, call, name, args, events) {
  if (events.onTool) events.onTool({ phase: 'start', name, label: toolLabel(name), target: String(args.path || args.table || args.action || args.key || '') })
  try {
    const result = await client.call(name, args)
    if (events.onTool) {
      events.onTool(result && result.ok === false
        ? { phase: 'fail', name, label: toolLabel(name), detail: (result && (result.error || result.message)) || '执行失败' }
        : { phase: 'done', name, label: toolLabel(name) })
    }
    return result
  } catch (error) {
    if (events.onTool) events.onTool({ phase: 'fail', name, label: toolLabel(name), detail: error.message })
    return { ok: false, error: error.message }
  }
}

async function processToolCalls(session, calls, config, assistantContent = '', events = {}, cancelToken = null) {
  const client = await ensureMcp()
  const results = []
  for (let index = 0; index < calls.length; index++) {
    // 用户按了停止：剩下的工具一个都不再执行（已经写过的保留，交给撤销面板处理）
    if (cancelToken && cancelToken.cancelled) break
    const call = calls[index]
    const name = call.function && call.function.name
    const args = safeArgs(call.function && call.function.arguments)

    // 连续的只读调用合并成一批并发执行：模型一次要读好几个文件时，省掉串行等待的时间。
    // 结果仍按模型请求的顺序回填，保证对话消息序列与工具调用一一对应。
    if (!isExclusiveCall(name)) {
      const batch = [{ call, name, args }]
      let cursor = index + 1
      while (cursor < calls.length) {
        const nextName = calls[cursor].function && calls[cursor].function.name
        if (isExclusiveCall(nextName)) break
        batch.push({ call: calls[cursor], name: nextName, args: safeArgs(calls[cursor].function && calls[cursor].function.arguments) })
        cursor++
      }
      index = cursor - 1
      const batchResults = batch.length === 1
        ? [await runReadOnly(client, batch[0].call, batch[0].name, batch[0].args, events)]
        : await Promise.all(batch.map(item => runReadOnly(client, item.call, item.name, item.args, events)))
      for (let position = 0; position < batch.length; position++) {
        const item = batch[position]
        const result = batchResults[position]
        session.messages.push({ role: 'tool', tool_call_id: item.call.id, content: clipToolResult(result) })
        results.push({ name: item.name, result })
        if (item.name === 'todo_write' && result && result.ok !== false && result.summary && result.summary.total) {
          session.todos = result.items
          if (events.onNotice) events.onNotice('计划：' + result.summary.headline)
          if (events.onPlan) events.onPlan(result.items, result.summary)
        }
      }
      saveSession(session)
      continue
    }

    if (events.onTool) events.onTool({ phase: 'start', name, label: toolLabel(name), target: String(args.path || args.table || args.action || args.key || '') })
    const isFileMutation = FILE_MUTATIONS.has(name)
    const granted = isFileMutation && isGranted(session, name, args)
    const needsApproval = !granted && (isFileMutation || (OTHER_MUTATIONS.has(name) && config.approvalMode !== 'auto'))
    if (granted && events.onNotice) {
      events.onNotice(`已授权：${toolLabel(name)} · ${String(args.path || '')}（本次任务内不再逐条确认，随时可撤销）`)
    }
    if (needsApproval) {
      const preview = isFileMutation ? await client.call(name, { ...args, dryRun: true }) : null
      if (preview && preview.ok === false) {
        session.messages.push({ role: 'tool', tool_call_id: call.id, content: clipToolResult(preview) })
        saveSession(session)
        results.push({ name, result: preview })
        if (events.onTool) events.onTool({ phase: 'fail', name, label: toolLabel(name), detail: preview.error || '预览失败' })
        continue
      }
      session.pending = { call, name, args, preview, remaining: calls.slice(index + 1) }
      saveSession(session)
      if (events.onTool) events.onTool({ phase: 'approval', name, label: toolLabel(name) })
      return { approval: { ok: true, status: 'approval', message: assistantContent || '这一步会修改工程或控制编辑器，请确认。', approval: summarizePending(name, args, preview) }, results }
    }
    const result = await client.call(name, args)
    session.messages.push({ role: 'tool', tool_call_id: call.id, content: clipToolResult(result) })
    saveSession(session)
    results.push({ name, result })
    // 待办进度实时上屏：用户不必等收尾才看到做到哪一步
    if (name === 'todo_write' && result && result.ok !== false && result.summary && result.summary.total) {
      session.todos = result.items
      saveSession(session)
      if (events.onNotice) events.onNotice('计划：' + result.summary.headline)
      if (events.onPlan) events.onPlan(result.items, result.summary)
    }
    if (events.onTool) {
      events.onTool(result && result.ok === false
        ? { phase: 'fail', name, label: toolLabel(name), detail: (result && (result.error || result.message)) || '执行失败' }
        : { phase: 'done', name, label: toolLabel(name) })
    }
  }
  // 打断导致中途退出：剩下的调用一个都没执行，但它们已随 assistant 入了历史，必须补应答
  if (cancelToken && cancelToken.cancelled) appendUnexecutedToolResults(session, calls, '用户打断了这次操作')
  return { approval: null, results }
}

async function handle(pathname, body, events = {}) {
  if (pathname === '/config') return await saveConfig(body)
  if (pathname === '/project') {
    if (!isProjectRoot(body.projectRoot)) throw new Error('没有找到有效的 Open Yami 工程目录')
    const next = path.resolve(body.projectRoot)
    if (next !== projectRoot) { if (mcp) mcp.close(); mcp = null; projectRoot = next; sessions.clear() }
    await ensureMcp()
    return { ok: true, projectRoot }
  }
  if (pathname === '/grants') {
    const session = sessionFor(body.sessionId || 'default')
    const list = Array.isArray(session.grants) ? session.grants : []
    if (body.revoke) {
      session.grants = list.filter(key => key !== String(body.revoke))
      saveSession(session)
      return { ok: true, grants: session.grants, message: '已撤销该授权，之后这个文件会重新逐条确认' }
    }
    if (body.clear === true) {
      session.grants = []
      saveSession(session)
      return { ok: true, grants: [], message: '已清空本次任务的全部授权' }
    }
    return {
      ok: true,
      grants: list.map(key => {
        const [tool, path] = key.split('::')
        return { key, tool, toolLabel: toolLabel(tool), path }
      })
    }
  }
  if (pathname === '/quick-config') {
    // 只更新传入的字段（模型 / 思考开关 / 思考强度），其余保持原值。
    // 快捷调节条每次改动都调它，不能用 /config —— 那会把未传字段按默认值覆盖掉。
    const patch = {}
    for (const key of ['model', 'thinkingMode', 'thinkingEffort', 'thinkingView']) {
      if (body[key] !== undefined) patch[key] = body[key]
    }
    const config = await saveConfig(patch)
    return { ok: true, ...config }
  }
  if (pathname === '/balance') {
    const config = readStoredConfig()
    const key = await getApiKey(config)
    try {
      const balance = await fetchBalance(config, key)
      return { ok: true, ...balance }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }
  if (pathname === '/pricing') {
    // 价目与当前时段单价（官方价目表内置在 modules/pricing.js，一处维护）
    const config = readStoredConfig()
    const price = pricing.priceOf(config.model)
    return {
      ok: true,
      model: config.model,
      band: price ? price.band : null,
      price,
      table: pricing.PRICE_TABLE,
      note: '价格来自官方文档（核对日期 2026-09-11）；空闲时段为高峰的一半；高峰=北京时间周一至周五 09:00-12:00 与 14:00-18:00。估算仅供参考，实际以官方账单为准。'
    }
  }
  if (pathname === '/test-connection') {
    // 一键体检：地址通不通、密钥认不认、模型在不在。
    // 只打免费的 GET /models（不产生 token 费用），把官方原话回给用户。
    const config = readStoredConfig()
    const key = await getApiKey(config)
    if (!key) {
      return { ok: false, step: 'key', error: config.keyInvalidReason || '还没有填写 API Key', baseUrl: config.endpoint, model: config.model }
    }
    const verdict = inspectApiKey(key, config.endpoint)
    if (!verdict.ok) return { ok: false, step: 'key', error: verdict.reason, baseUrl: config.endpoint, model: config.model }
    try {
      const models = await fetchModels(config, key)
      const available = models.includes(config.model)
      return {
        ok: true, step: 'done', baseUrl: config.endpoint, model: config.model,
        modelAvailable: available, modelCount: models.length, models: models.slice(0, 12),
        keyWarning: verdict.warn || '',
        message: available
          ? '连接正常：密钥有效，模型 ' + config.model + ' 可用（服务端共 ' + models.length + ' 个模型）'
          : '连接正常，但服务端模型列表里没有 ' + config.model + '，请从列表里挑一个'
      }
    } catch (error) {
      return { ok: false, step: 'models', error: error.message, baseUrl: config.endpoint, model: config.model }
    }
  }
  if (pathname === '/models') {
    const config = readStoredConfig()
    const key = await getApiKey(config)
    try {
      const models = await fetchModels(config, key)
      return { ok: true, baseUrl: config.endpoint, models, current: config.model }
    } catch (error) {
      return { ok: false, baseUrl: config.endpoint, models: [], error: error.message }
    }
  }
  if (pathname === '/changelog-baseline') {
    // 打开面板/开始新任务时把当前工程状态设为基线，之后的变更小结只报增量
    const client = await ensureMcp()
    const result = await client.call('project_changelog', { reset: true })
    return { ok: true, trackedFiles: (result && result.trackedFiles) || 0, message: (result && result.message) || '' }
  }
  if (pathname === '/sessions') return { ok: true, sessions: listSessions() }
  if (pathname === '/backups') {
    // 只列「本次对话里 AI 真正改过的文件」——用户要的是"我刚让它改的东西怎么退回去"，
    // 而不是工程里所有历史备份。
    const session = sessionFor(body.sessionId || 'default')
    const touched = []
    for (const message of session.messages) {
      if (!Array.isArray(message.tool_calls)) continue
      for (const call of message.tool_calls) {
        const name = call.function && call.function.name
        if (!FILE_MUTATIONS.has(name)) continue
        const args = safeArgs(call.function && call.function.arguments)
        if (args.path && !touched.includes(args.path)) touched.push(args.path)
      }
    }
    if (!touched.length) return { ok: true, files: [], hint: '本次对话还没有修改过任何工程文件' }
    const client = await ensureMcp()
    const files = []
    for (const rel of touched) {
      const list = await client.call('list_backups', { path: rel, limit: 20 })
      const backups = (list && list.backups) || []
      if (!backups.length) continue
      files.push({
        path: rel,
        backupCount: backups.length,
        newest: backups[0] && backups[0].savedAt,
        oldest: backups[backups.length - 1] && backups[backups.length - 1].savedAt,
        tools: Array.from(new Set(backups.map(item => item.tool).filter(Boolean)))
      })
    }
    return { ok: true, files, hint: files.length ? '点「撤销」可把该文件退回到 AI 动手之前（回退本身也能再撤回）' : '这些文件没有找到备份' }
  }
  if (pathname === '/backup-undo') {
    const rel = String(body.path || '').trim()
    if (!rel) throw new Error('请指定要回退的文件')
    const client = await ensureMcp()
    const preview = await client.call('restore_backup', { path: rel, dryRun: false })
    if (preview && preview.ok === false) return preview
    return {
      ok: true,
      path: rel,
      savedAt: preview.savedAt,
      diff: preview.diff,
      diffStat: preview.diffStat,
      safetyBackup: preview.safetyBackup,
      message: `已把 ${rel} 退回 ${preview.savedAt} 的版本`
    }
  }
  if (pathname === '/session/load') {
    const id = safeSessionId(body.sessionId)
    const restored = loadSessionFromDisk(id)
    if (!restored) throw new Error('没有找到这个会话')
    // 磁盘上的历史可能是旧版本写下的坏序列：恢复时先体检，别让用户一开口就撞 400
    healSessionMessages(restored, '恢复会话时体检')
    sessions.set(id, restored)
    return {
      ok: true,
      sessionId: id,
      messages: visibleMessages(restored),
      pending: restored.pending ? summarizePending(restored.pending.name, restored.pending.args, restored.pending.preview) : null
    }
  }
  if (pathname === '/session/delete') {
    const id = safeSessionId(body.sessionId)
    sessions.delete(id)
    try { fs.rmSync(sessionPath(id), { force: true }) } catch { /* 忽略删除失败 */ }
    return { ok: true }
  }
  if (pathname === '/chat' || pathname === '/chat/stream') {
    const text = String(body.message || '').trim()
    if (!text) throw new Error('请输入要完成的事情')
    const session = sessionFor(body.sessionId || 'default')
    if (session.busy) throw new Error('上一条需求还在处理中，请稍候')
    if (session.pending) {
      // 用户没理会挂起的那张确认卡，直接说了新需求：视为放弃那项修改。
      // （比硬拦"请先执行或取消"更好——窗口重开时确认卡未必还在，硬拦会把人锁死在原地）
      const abandoned = session.pending
      session.pending = null
      appendUnexecutedToolResults(
        session,
        [abandoned.call].concat(abandoned.remaining || []),
        '用户改说了别的需求，这项操作没有执行'
      )
      if (events.onNotice) events.onNotice(`已放弃未确认的操作：${toolLabel(abandoned.name)} · ${String(abandoned.args && abandoned.args.path || '')}`)
    }
    healSessionMessages(session, '发送前体检')
    session.messages.push({ role: 'user', content: text })
    session.busy = true
    session.repairs = 0   // 每条新需求重新给自动修复预算
    saveSession(session)
    try {
      return await continueSession(session, readStoredConfig(), events)
    } finally {
      session.busy = false
      saveSession(session)
    }
  }
  if (pathname === '/approve' || pathname === '/reject') {
    const session = sessionFor(body.sessionId || 'default')
    if (!session.pending) throw new Error('没有等待确认的操作')
    const pending = session.pending
    session.pending = null
    const rejected = pathname === '/reject'
    let result
    if (rejected) result = { ok: false, rejected: true, message: '用户取消了这项操作' }
    else {
      const args = FILE_MUTATIONS.has(pending.name)
        ? {
            ...pending.args,
            expectedSha256: pending.preview && pending.preview.oldSha256,
            dryRun: false,
            // 高危操作（删除等）必须带上预览时发的一次性确认令牌，只靠 force 不足以执行
            ...(pending.preview && pending.preview.confirmationToken ? { confirmationToken: pending.preview.confirmationToken } : {})
          }
        : pending.args
      if (events.onTool) events.onTool({ phase: 'start', name: pending.name, label: toolLabel(pending.name), target: String(pending.args.path || '') })
      result = await (await ensureMcp()).call(pending.name, args)
      if (events.onTool) {
        events.onTool(result && result.ok === false
          ? { phase: 'fail', name: pending.name, label: toolLabel(pending.name), detail: (result && (result.error || result.message)) || '执行失败' }
          : { phase: 'done', name: pending.name, label: toolLabel(pending.name) })
      }
      // 用户勾选"本次任务内该文件不再逐条确认"时才授予授权（删除类永不授权）
      if (body.grantForSession === true && result && result.ok !== false) {
        const key = addGrant(session, pending)
        if (key && events.onNotice) events.onNotice(`已记住：${toolLabel(pending.name)} · ${pending.args.path || ''} 在本次任务内不再逐条确认（随时可撤销）`)
      }
    }
    session.messages.push({ role: 'tool', tool_call_id: pending.call.id, content: clipToolResult(result) })
    saveSession(session)
    const config = readStoredConfig()

    // 用户确认的写入同样要过编译门禁；失败时把 tsc 报错喂回模型自动重修（与自动执行路径一致）
    const failure = rejected ? null : compileFailureOf(pending.name, result)
    if (rejected) {
      // 用户明确取消：这一步与后面排队的调用都不再执行。剩余调用必须补上"未执行"应答——
      // 否则它们会继续弹确认卡（用户刚说了不要），历史里还会留下没人应答的调用。
      appendUnexecutedToolResults(session, pending.remaining || [], '用户取消了这项操作')
    } else if (failure) {
      if ((session.repairs || 0) >= MAX_REPAIR_ATTEMPTS) {
        // 编译没过且修复预算用尽：本轮中止，队列里剩下的调用一律作废（补应答收尾）
        appendUnexecutedToolResults(session, pending.remaining || [], '前一步编译未通过，本次已停止')
        return await attachChangelog(session, {
          ok: false,
          status: 'compile-failed',
          message: `脚本没能通过编译检查，已自动回滚、工程保持完好。最后一次报错：\n${failure.firstLine || failure.output.split('\n')[0] || '（无输出）'}`
        })
      }
      session.repairs = (session.repairs || 0) + 1
      session.messages.push(repairMessage(failure))
      saveSession(session)
      if (events.onNotice) events.onNotice(`编译没通过（${failure.errorCount} 处），已回滚并让 AI 自动重修（第 ${session.repairs}/${MAX_REPAIR_ATTEMPTS} 次）`)
    } else if (pending.remaining && pending.remaining.length) {
      const outcome = await processToolCalls(session, pending.remaining, config, '', events)
      if (outcome.approval) return outcome.approval
    }
    return await continueSession(session, config, events)
  }
  if (pathname === '/clear') {
    const id = safeSessionId(body.sessionId || 'default')
    sessions.delete(id)
    try { fs.rmSync(sessionPath(id), { force: true }) } catch { /* 忽略删除失败 */ }
    return { ok: true }
  }
  throw new Error('未知请求')
}

/** 建立 SSE 通道并把宿主事件实时推给前端（流式输出 / 工具条 / 审批 / 报错） */
function startStream(res, req, pathname) {
  // 前端点「停止」会直接断开这条 SSE：把它当成取消信号，一路传到模型请求与工具循环。
  // 只断开界面、后台还在烧 token/改文件，是这类助手最不能接受的坏行为。
  const cancelToken = createCancelToken()
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-yami-agent-token'
  })
  if (typeof res.flushHeaders === 'function') res.flushHeaders()
  const send = data => {
    try { res.write('data: ' + JSON.stringify(data) + '\n\n') } catch { /* 连接已断开 */ }
  }
  // 注意只认 res 的 close：Node 里 req 的 close 在请求体读完就会触发，
  // 拿它当断开信号会导致每次对话刚发出就被自己取消（实测踩过）。
  const onAbort = () => {
    if (res.writableEnded) return  // 我们主动收尾的正常结束，不算打断
    cancelToken.cancel('已打断')
  }
  res.on('close', onAbort)

  send({ type: 'start', route: pathname })
  return {
    send,
    cancelToken,
    onStatus: text => send({ type: 'status', text }),
    onDelta: delta => send({ type: 'delta', ...delta }),
    onTool: info => send({ type: 'tool', ...info }),
    onNotice: text => send({ type: 'notice', text }),
    onPlan: (items, summary) => send({ type: 'plan', items, summary })
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {})
  const requestUrl = new URL(req.url, 'http://127.0.0.1')
  const pathname = requestUrl.pathname
  // 令牌可走请求头（普通请求）或查询参数（便于浏览器直接调试 SSE）
  const token = req.headers['x-yami-agent-token'] || requestUrl.searchParams.get('token')
  if (token !== TOKEN) return sendJson(res, 401, { ok: false, error: 'AI 助手令牌无效' })
  try {
    if (req.method === 'GET' && pathname === '/status') {
      // 附带当前会话的上下文占用，供前端显示「上下文 320k/1M · 32%」这类指示
      const sessionId = safeSessionId(requestUrl.searchParams.get('sessionId') || 'default')
      const session = sessions.get(sessionId)
      return sendJson(res, 200, {
        ok: true,
        projectRoot,
        mcpReady: !!mcp,
        config: publicConfig(),
        context: contextStatus(session),
        grants: session && Array.isArray(session.grants) ? session.grants : [],
        usage: session ? (session.usage || null) : null,
        usageText: session ? pricing.describeUsage(session.usage) : '',
        thinking: { mode: publicConfig().thinkingMode, effort: publicConfig().thinkingEffort }
      })
    }
    if (req.method === 'GET' && pathname === '/config') return sendJson(res, 200, { ok: true, ...publicConfig() })
    if (req.method === 'GET' && pathname === '/sessions') return sendJson(res, 200, { ok: true, sessions: listSessions() })
    if (req.method === 'GET' && pathname === '/session/load') {
      const id = safeSessionId(requestUrl.searchParams.get('sessionId'))
      const restored = loadSessionFromDisk(id)
      if (!restored) return sendJson(res, 404, { ok: false, error: '没有找到这个会话' })
      sessions.set(id, restored)
      return sendJson(res, 200, {
        ok: true,
        sessionId: id,
        messages: visibleMessages(restored),
        pending: restored.pending ? summarizePending(restored.pending.name, restored.pending.args, restored.pending.preview) : null
      })
    }
    if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'Not found' })
    const body = await readJson(req)
    if (pathname === '/chat/stream') {
      const events = startStream(res, req, pathname)
      let finished = false
      const close = () => { if (!finished) { finished = true; try { res.end() } catch { /* 已关闭 */ } } }
      try {
        const result = await handle(pathname, body, events)
        events.send({ type: 'result', ...result })
      } catch (error) {
        events.send({ type: 'error', error: error.message })
      }
      return close()
    }
    sendJson(res, 200, { ok: true, ...(await handle(pathname, body)) })
  } catch (error) {
    if (!res.headersSent) sendJson(res, 400, { ok: false, error: error.message })
    else { try { res.end() } catch { /* 已关闭 */ } }
  }
})

server.on('error', error => {
  // 【多实例竞态】编辑器窗口与试玩窗口同时首次唤起时，两边都会各自 spawn 一个 Host。
  // 端口只有一个：后到者不能直接退出（会让先唤起它的那个窗口整轮操作失败），
  // 而应确认端口上是不是"我们的"Host —— 是则本次进程认领失败并让调用方复用已有实例。
  if (error && error.code === 'EADDRINUSE') {
    process.stderr.write(`[danjuan-ai] 端口 ${PORT} 已被本机 AI Host 占用，本次实例不再重复启动\n`)
    let tries = 0
    const probe = setInterval(() => {
      tries++
      probeStatus(status => {
        if (status && status.ok) {
          clearInterval(probe)
          process.stderr.write('[danjuan-ai] 已确认端口上运行的是可用 AI Host，交由前端复用\n')
          process.exit(0)
        }
        // 约 60 秒内没等到可用 Host（可能是别的程序占用该端口）→ 退出，避免变成永久孤儿进程
        if (tries >= 200) { clearInterval(probe); process.exit(1) }
      })
    }, 300)
    return
  }
  process.stderr.write('[danjuan-ai] ' + error.message + '\n')
  process.exit(1)
})
// 启动日志带端口与令牌指纹：出现"面板连不上 / 连到旧实例"这类问题时，
// 一眼能看出当前跑的是哪个实例、令牌是不是面板手里那个（历史上踩过孤儿进程残留的坑）
migrateStoredKey().catch(() => {})

server.listen(PORT, '127.0.0.1', () => {
  const fingerprint = crypto.createHash('sha256').update(String(TOKEN)).digest('hex').slice(0, 8)
  process.stderr.write(`[danjuan-ai] ready http://127.0.0.1:${PORT} (token:${fingerprint} pid:${process.pid})\n`)
})

if (PARENT_PID > 0) {
  setInterval(() => {
    try { process.kill(PARENT_PID, 0) } catch { if (mcp) mcp.close(); process.exit(0) }
  }, 3000).unref()
}

process.on('SIGTERM', () => { if (mcp) mcp.close(); process.exit(0) })
