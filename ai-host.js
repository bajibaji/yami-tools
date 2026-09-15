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
const EditorBridge = require('./runtime/yami-mcp/modules/editor-bridge')
const editorBridge = new EditorBridge()

const PORT = Number(process.env.YAMI_AI_PORT || 5968)
const CONFIG_DIR = process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite')
function resolveHostToken() {
  if (process.env.YAMI_AI_TOKEN) return process.env.YAMI_AI_TOKEN
  try {
    const tokenFile = path.join(CONFIG_DIR, 'agent-token')
    if (fs.existsSync(tokenFile)) {
      const saved = fs.readFileSync(tokenFile, 'utf8').trim()
      if (saved) return saved
    }
  } catch {}
  return crypto.randomBytes(24).toString('hex')
}
const TOKEN = resolveHostToken()
const PARENT_PID = Number(process.env.YAMI_AI_PARENT_PID || 0)
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
// ui_steps（AI 在编辑器界面上逐步演示/操作）也是**有副作用**的动作：它会改属性、切页、点按钮。
// 以前它不在任何审批集合里 → confirm 模式下也能不问就动界面（越界前不可裁决），
// 只有事后「撤销这一步」；现在并入 OTHER_MUTATIONS：confirm 模式先问、auto 模式照旧自动。
// 新增两个试玩侧动作同样要进来：结束卡住事件会真的结束用户正在跑的事件、suspend 会真的改
// 引擎状态，confirm 模式下都必须先问（auto 模式照旧自动）。
const OTHER_MUTATIONS = new Set(['click_element', 'trigger_playtest', 'editor_action', 'interact_editor', 'send_player_input', 'send_player_pointer', 'playtest_smoke', 'ui_steps', 'finish_stuck_event', 'suspend_runtime_kind'])
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
const SESSION_DIR = process.env.YAMI_AI_SESSION_DIR || path.join(CONFIG_DIR, 'sessions')
const DEFAULT_MAX_STEPS = Number(process.env.YAMI_AI_MAX_STEPS || 0)      // 单轮最多连续工具调用步数（默认 0：无限制，仅防死循环打转）
// 单轮工具调用预算：模型陷入"换个关键词接着查"时，per-name 的软提示拦不住（实测连提示 6 次照旧往下查），
// 所以再上一道硬闸 —— 单个工具刷到 N 次、或本轮累计到 M 次，就如实停下把方向盘交回用户，而不是继续空转。
const TOOL_REPEAT_LIMIT = Number(process.env.YAMI_AI_TOOL_REPEAT_LIMIT || 8)
const TURN_CALL_BUDGET = Number(process.env.YAMI_AI_TURN_CALL_BUDGET || 30)
const MAX_STEPS = DEFAULT_MAX_STEPS
// 对话导出稿**不落进用户工程**：工程是他的 git 仓库，扔个 md 进去就是脏文件；统一放插件自己的数据目录。
const EXPORT_DIR = process.env.YAMI_AI_EXPORT_DIR || path.join(CONFIG_DIR, 'exports')
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

/**
 * 工程自带的「AI 阅读入口」文档（本工程是 `DANJUAN TOOLS/00-文档总索引（AI 阅读入口）.md` 这一套）：
 * 里面写着这个工程的目录约定、引擎机制与既有做法，是最权威的上下文。存在就把路径交给模型，
 * 不存在就一个字都不提（别的工程没这套文档，凭空提只会让它去找不存在的文件）。
 * 按 projectRoot 缓存 —— 切换工程要重算，所以比的是 root 而不是"算过没有"。
 */
const PROJECT_DOC_CANDIDATES = [
  path.join('DANJUAN TOOLS', '00-文档总索引（AI 阅读入口）.md'),
  path.join('DANJUAN TOOLS', '00-文档总索引.md')
]
let docHintCache = { root: '', text: '' }
function projectDocHint() {
  if (!projectRoot) return ''
  if (docHintCache.root === projectRoot) return docHintCache.text
  let rel = ''
  try {
    rel = PROJECT_DOC_CANDIDATES.find(item => fs.existsSync(path.join(projectRoot, item))) || ''
    if (!rel) {
      // 兜底：工程根下任何叫「AI 阅读入口」的 md 都算（目录结构可能不叫 DANJUAN TOOLS）
      const hit = fs.readdirSync(projectRoot, { withFileTypes: true })
        .find(entry => entry.isDirectory() && /工具|TOOLS/i.test(entry.name))
      if (hit) {
        const inside = fs.readdirSync(path.join(projectRoot, hit.name))
          .find(name => /AI ?阅读入口/.test(name) && name.endsWith('.md'))
        if (inside) rel = path.join(hit.name, inside)
      }
    }
  } catch { rel = '' }
  const text = rel
    ? '【工程文档入口】这个工程自带 AI 阅读入口：' + rel.replace(/\\/g, '/') + '。'
      + '开工前先读它（read_resource 能直接读 md），按它的速查表只挑与本次需求相关的一两份文档；'
      + '里面写着目录约定与引擎机制，读完再动手比你自己搜十次都准。索引之外不要通读（合计十几万字）。'
    : ''
  docHintCache = { root: projectRoot, text }
  return text
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
    toolTally: session.toolTally || {},
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
      toolTally: data.toolTally || {},
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
  // 用户消息的**绝对轮次号**（压缩检查点不算）：面板的历史窗口只显示后 60 条时，
  // 气泡上的「重发 / 编辑」仍要能指到宿主眼里的同一条消息（G-1 的 /session/rewind 按这个号截断）。
  let userTurn = -1
  return session.messages
    // 纯工具轮（有思考、没正文）也要回放：实时看到的是「思考① → 执行 → 思考② → …」，
    // 只回放带正文的那一条，用户切回旧会话就会以为"当时的思考和步骤都丢了"。
    .filter(message => message.role === 'user'
      || (message.role === 'assistant' && (message.content || message.reasoning_content || (Array.isArray(message.tool_calls) && message.tool_calls.length))))
    .map(message => {
      if (isCheckpoint(message)) {
        const summary = String(message.content)
          .replace(/[\s\S]*?<compacted-summary>\s*/, '')
          .replace(/\s*<\/compacted-summary>[\s\S]*$/, '')
        return { role: 'assistant', content: ('【早前对话已压缩，以下是要点】\n\n' + summary).slice(0, limit), reasoning: '' }
      }
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      const isUser = message.role === 'user'
      if (isUser) userTurn += 1
      return {
        role: message.role,
        content: String(message.content || '').slice(0, limit),
        reasoning: message.reasoning_content ? String(message.reasoning_content).slice(0, reasoningLimit) : '',
        // 工具步骤一并回放（中文名与实时工具条用同一张表），前端照着还原「执行：xxx」行
        steps: calls.map(call => toolLabel(call.function && call.function.name)).filter(Boolean),
        ...(isUser ? { turnIndex: userTurn } : {})
      }
    })
}

/** 会话标题：第一条"用户真说过的话"的前 40 字。历史列表与导出文件名共用同一口径 */
function sessionTitleOf(list) {
  const firstUser = (list || []).find(message => message && message.role === 'user' && !isCheckpoint(message))
  const text = String((firstUser && firstUser.content) || '新对话')
  return text.replace(/（请检查上一轮的实际进展[\s\S]*$/, '').replace(/\s+/g, ' ').slice(0, 40)
}

function listSessions() {  try {
    return fs.readdirSync(SESSION_DIR)
      .filter(name => name.endsWith('.json'))
      .map(name => {
        const id = name.replace(/\.json$/, '')
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, name), 'utf8'))
          const list = data.messages || []
          const titleText = sessionTitleOf(list)
          return {
            id,
            updatedAt: data.updatedAt || 0,
            title: titleText || '新对话',
            // 上屏给人看的"几轮"= 用户自己说了几句。messageCount 是内部消息条数，
            // 里面混着 system 和每条工具结果 —— 拿它上屏就会出现"问一句显示 2 条、
            // 调几次工具变几十条"这种对不上的数字。
            turns: list.filter(message => message.role === 'user').length,
            messageCount: list.length
          }
        } catch {
          return { id, updatedAt: 0, title: '（无法读取）', turns: 0, messageCount: 0 }
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30)
  } catch {
    return []
  }
}

/* ============================== 对话导出 ============================== */
/**
 * 把一段会话排成人能读的 Markdown。**只读**：不改会话状态、不碰落盘文件，导出失败也不该影响正在进行的对话。
 * 三处刻意的取舍，都是为了"导出的就是真实发生过的那段对话"：
 *   · system 提示词不进稿子（那是给模型看的几百行脚手架，会把人话淹掉），只在头部记条数；
 *   · 工具结果不进正文（一条常几万字），只在步骤行交代"执行了什么"；
 *   · 思考过程用 <details> 折叠 —— 与性能大盘导出诊断报告同一套写法。
 */
/**
 * 会话里 role='user' 的消息并不全是用户打的字：打转干预、写入失败后的修复指令、
 * 打断记录、工作期间补充说明都是宿主替模型追加的（它们要进上下文，但不该被读稿的人当成用户发言）。
 * 导出稿据此换标题；模型看到的原文一个字不改。
 */
const HOST_NOTE_PATTERNS = [
  /^【系统干预指引】/,
  /^（用户在你工作期间补充：/,
  /^（用户打断了这次操作/,
  /^刚才的 \S+ 写入没有通过引擎的 TypeScript 编译检查/
]

function isHostNote(text) {
  const head = String(text || '').trim()
  return HOST_NOTE_PATTERNS.some(pattern => pattern.test(head))
}

function exportArgsHint(raw) {
  // 只挑"指得出对象"的标量字段：write_script / edit_script 的 content 是整篇脚本，
  // 原样 JSON.stringify 会把导出稿撑成一坨代码。
  const args = safeArgs(raw)
  const target = args.path || args.nameZh || args.className || args.table || args.query || args.key || args.action || ''
  return String(target).replace(/\s+/g, ' ').slice(0, 80)
}

function sessionToMarkdown(session) {
  const list = Array.isArray(session.messages) ? session.messages : []
  const turns = list.filter(message => message.role === 'user' && !isCheckpoint(message)).length
  const toolResults = list.filter(message => message.role === 'tool').length
  const systems = list.filter(message => message.role === 'system').length
  const out = []
  out.push('# ' + sessionTitleOf(list))
  out.push('')
  out.push('- **导出时间**: ' + new Date().toLocaleString('zh-CN', { hour12: false }))
  out.push('- **会话 ID**: `' + session.id + '`')
  out.push('- **规模**: ' + turns + ' 轮对话 · ' + list.length + ' 条消息'
    + (toolResults ? '（另有 ' + toolResults + ' 条工具结果未收进正文）' : '')
    + (systems ? '；' + systems + ' 条系统提示词按惯例不导出' : ''))
  for (const message of list) {
    if (!message || message.role === 'system' || message.role === 'tool') continue
    if (isCheckpoint(message)) {
      const summary = String(message.content || '')
        .replace(/[\s\S]*?<compacted-summary>\s*/, '')
        .replace(/\s*<\/compacted-summary>[\s\S]*$/, '')
        .trim()
      out.push('')
      out.push('---')
      out.push('')
      // 整段用同一个引用块：中间空一行会被 Markdown 拆成两个 blockquote，读起来像两段无关的话
      out.push('> **【早前对话已压缩，以下是要点】**')
      for (const line of summary.split('\n')) out.push('> ' + line)
      continue
    }
    const content = String(message.content || '').trim()
    const reasoning = String(message.reasoning_content || '').trim()
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (message.role === 'user') {
      out.push('')
      out.push('---')
      out.push('')
      out.push(isHostNote(content) ? '### 系统提示（宿主自动追加，非用户发言）' : '### 你')
      out.push('')
      out.push(content)
      continue
    }
    if (message.role !== 'assistant') continue
    if (!content && !reasoning && !calls.length) continue
    out.push('')
    out.push('---')
    out.push('')
    out.push('### AI 助手')
    if (reasoning) {
      out.push('')
      out.push('<details><summary>思考过程</summary>')
      out.push('')
      out.push(reasoning)
      out.push('')
      out.push('</details>')
    }
    if (content) {
      out.push('')
      out.push(content)
    }
    for (const call of calls) {
      const fn = call.function || {}
      const hint = exportArgsHint(fn.arguments)
      out.push('')
      out.push('- 执行：' + toolLabel(fn.name) + (hint ? '（`' + hint + '`）' : ''))
    }
  }
  return out.join('\n').trim() + '\n'
}

/**
 * 导出稿落盘：写进插件自己的数据目录（EXPORT_DIR），**绝不落进用户工程** ——
 * 工程是他的 git 仓库，扔个 md 进去就是一条脏文件。写不进去就把正文交回面板走剪贴板，
 * 并如实说明为什么没落盘（不假装成功）。
 */
function writeExport(filename, markdown, sessionCount) {
  const bytes = Buffer.byteLength(markdown, 'utf8')
  try {
    fs.mkdirSync(EXPORT_DIR, { recursive: true })
    const full = path.join(EXPORT_DIR, filename)
    fs.writeFileSync(full, markdown, { encoding: 'utf8', mode: 0o600 })
    return { ok: true, filename, path: full, bytes, sessions: sessionCount }
  } catch (error) {
    return {
      ok: true,
      filename,
      path: '',
      bytes,
      sessions: sessionCount,
      markdown,
      warning: '导出目录写不进去（' + error.message + '），内容已交回面板复制到剪贴板'
    }
  }
}

/** 导出文件名：Windows 文件名里不能出现的字符一律去掉，别让标题把落盘搞失败 */
function exportFileName(title, suffix) {
  const safe = String(title || 'AI对话').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
  return (safe || 'AI对话') + suffix
}

/**
 * 工具结果裁剪：超长结果保留**开头与结尾**（结尾很重要——报错原文、命令输出结论都在末尾，
 * 只留开头会让模型看不到关键几行，进而反复重读同一个文件），中段给出明确提示而不是静默丢弃。
 */
/**
 * 超长工具输出落盘（对齐 DSH 的 spill 语义）：裁剪掉的东西不能就这么没了——
 * 完整原文写到一个可读文件里，交给模型的是路径，交给用户的是"确实被截断了"这句实话。
 */
function spillFullOutput(text, tag) {
  try {
    const dir = path.join(CONFIG_DIR, 'spills')
    fs.mkdirSync(dir, { recursive: true })
    const safe = String(tag || 'tool').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'tool'
    const file = path.join(dir, Date.now().toString(36) + '-' + safe + '.txt')
    fs.writeFileSync(file, text, 'utf8')
    // 只留最近 40 份：这是"被裁掉那部分的证据"，不是归档系统，不能无限长
    try {
      const kept = fs.readdirSync(dir)
        .map(name => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
      for (const old of kept.slice(40)) fs.rmSync(path.join(dir, old.name), { force: true })
    } catch { /* 清理失败不影响本次落盘 */ }
    return file
  } catch {
    return ''
  }
}

function clipToolResult(result, tag) {
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
  const spillPath = spillFullOutput(text, tag)
  // 在**原对象**上盖个章：事件里的结构化摘要才知道这次被裁剪了、完整原文落在哪
  try {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      result.__clip = { originalChars: text.length, spillPath: spillPath || '' }
    }
  } catch { /* 冻结对象之类的就算了，卡片会少一个"已截断"标记，不影响主流程 */ }
  return JSON.stringify({
    ok: result && result.ok !== false,
    truncated: true,
    originalChars: text.length,
    spill: spillPath ? { path: spillPath, chars: text.length } : null,
    // 注意：这里**不能**让模型去读那个落盘路径 —— file-ops 只接受工程根目录内的相对路径，
    // 绝对路径会被直接拒绝（"文件路径必须是工程根目录内的相对路径"）。落盘是留给**人**看的证据；
    // 模型要细节只能换更精确的参数重新取。以前那句"请按这个路径读取"是句假话。
    note: spillPath
      ? `工具结果过长已裁剪（原 ${text.length} 字符，保留开头与结尾）。完整原文已由编辑器侧落盘留档（用户可在界面上点开），` +
        '你**读不到那个路径**（工具只允许访问工程内的相对路径）；需要更多细节请换更精确的参数重新获取（如 read_resource 的 key、list_* 的分页、search_project 缩小范围）。'
      : `工具结果过长已裁剪（原 ${text.length} 字符，保留开头与结尾）。需要完整内容请用更精确的参数（如 read_resource 的 key、list_* 的分页）重新获取。`,
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
    // 刻度点开时用：折叠规模 + 摘要正文（截断，避免把整份摘要塞进一次 /status）
    summaryMeta: session.summaryMeta || null,
    summaryText: session.summary ? String(session.summary).slice(0, 4000) : '',
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
async function compressContext(session, config, key, tools, force = false) {
  const spec = contextSpec()

  // ---- 第一级：确定性修剪无门槛常态化执行（纯本地零 token 成本，防超大输出撑爆上下文） ----
  const pruned = contextMeter.pruneToolResults(session.messages)
  if (pruned.pruned.length) {
    session.messages = pruned.messages
    session.tokenAnchor = null   // 消息内容被改写，真实用量锚点随之作废
    saveSession(session)
    process.stderr.write(`[danjuan-ai] 上下文常态修剪：${pruned.pruned.length} 条超长工具结果改为头尾保留，省下约 ${pruned.savedTokens} token\n`)
  }

  const usage = measureContext(session, tools)
  const fixedOverhead = contextMeter.estimateTools(tools || toolsForModel)
  // 现实中上下文超过 64k tokens 轻量模型注意力即严重衰减，收敛摘要触发上限
  const effectiveThreshold = Number(process.env.YAMI_AI_COMPACT_MAX_TOKENS || 0) || Math.min(spec.thresholdTokens, 64000)
  const decision = contextMeter.shouldCompact({ tokens: usage.tokens, toolsTokens: fixedOverhead, thresholdTokens: effectiveThreshold })
  // force：用户在面板上点「立即压缩」时不等阈值。唯一例外仍是"工具 schema 本身就超阈值"——
  // 那种情况下压缩对话没有意义，手动也跳过，免得白烧一次摘要调用。
  const forced = force && decision.reason !== 'fixed-overhead'
  if (!decision.compact && !forced) {
    if (decision.reason === 'fixed-overhead') {
      process.stderr.write(`[danjuan-ai] 工具定义本身约占 ${fixedOverhead} token，已达压缩阈值 ${effectiveThreshold}，压缩对话没有意义，已跳过\n`)
    }
    return pruned.pruned.length > 0
  }
  if (session.messages.length <= spec.minKeepMessages + 3) return pruned.pruned.length > 0

  // ---- 第二级：模型摘要 ----
  const before = session.messages
  // 关键修复：保留预算必须与有效压缩阈值严格成比例（保留量永远不得大于触发门槛，保证压缩后腾出至少 75% 窗口）
  const ratio = (spec.retainRatio && spec.thresholdRatio) ? (spec.retainRatio / spec.thresholdRatio) : 0.2
  const effectiveRetain = Math.min(spec.retainTokens, Math.floor(effectiveThreshold * ratio))
  const startIndex = messagePairs.alignStartIndex(before, contextMeter.selectStartIndex(before, effectiveRetain, spec))
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
  // 面板「上下文」刻度可点开看折叠了什么：把这次折叠的规模与时间记下来（不进提示词，只回传给界面）
  session.summaryMeta = { folded: folded.length, before: before.length, after: session.messages.length, at: new Date().toISOString(), manual: !!force }
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
      // 轮次结束后过程行要不要自动收起（紧凑）/ 始终可见（标准），默认紧凑
      processFold: data.processFold === 'standard' ? 'standard' : 'compact',
      // 繁忙时按发送：queue 排队 / interrupt 打断当前轮再发这条（默认排队）
      busySend: data.busySend === 'interrupt' ? 'interrupt' : 'queue',
      maxSteps: data.maxSteps !== undefined ? Math.max(0, Math.min(9999, Number(data.maxSteps))) : Number(process.env.YAMI_AI_MAX_STEPS || DEFAULT_MAX_STEPS),
      encryptedKey: data.encryptedKey || '',
      keyTail: data.keyTail || '',
      keyInvalidReason: data.keyInvalidReason || '',
      approvalMode: data.approvalMode === 'auto' ? 'auto' : 'confirm'
    }
  } catch {
    return { endpoint: DEFAULT_BASE_URL, model: DEFAULT_MODEL, thinkingMode: 'enabled', thinkingEffort: 'high', thinkingView: 'preview', processFold: 'compact', busySend: 'queue', maxSteps: DEFAULT_MAX_STEPS, encryptedKey: '', keyTail: '', keyInvalidReason: '', approvalMode: 'confirm' }
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
    processFold: ['compact', 'standard'].includes(input.processFold) ? input.processFold : (current.processFold || 'compact'),
    busySend: ['queue', 'interrupt'].includes(input.busySend) ? input.busySend : (current.busySend || 'queue'),
    maxSteps: input.maxSteps !== undefined ? Math.max(0, Math.min(9999, Number(input.maxSteps))) : (current.maxSteps !== undefined ? current.maxSteps : DEFAULT_MAX_STEPS),
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
    processFold: config.processFold === 'standard' ? 'standard' : 'compact',
    busySend: config.busySend === 'interrupt' ? 'interrupt' : 'queue',
    maxSteps: config.maxSteps !== undefined ? config.maxSteps : DEFAULT_MAX_STEPS,
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
 * 从 5967 编辑器桥轻量获取当前环境摘要（场景、选中项、检视器状态）
 * 设定 350ms 超时，未启动或异常时静默回退为空，0 阻塞 0 报错。
 */
function fetchEditorContextSummary() {
  return new Promise(resolve => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5967,
      path: '/context',
      method: 'GET',
      timeout: 350,
      headers: { Accept: 'application/json' }
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(raw || '{}')
          resolve((data && data.summary) || '')
        } catch { resolve('') }
      })
    })
    req.on('error', () => resolve(''))
    req.on('timeout', () => { req.destroy(); resolve('') })
    req.end()
  })
}

/**
 * 发给 API 前清洗消息：
 *   · 助手消息保留 reasoning_content —— 带 tools 的请求官方要求完整回传，否则 400；
 *   · 剥掉我们自己的内部字段（__usage 等），避免污染请求体；
 *   · 第一条 system 消息动态追加最新编辑器环境摘要，不污染会话持久化存储。
 */
function messagesForApi(messages, envSummary = '') {
  return messages.map((message, idx) => {
    const clean = {}
    for (const [key, value] of Object.entries(message)) {
      if (key.startsWith('__')) continue
      if (value === undefined) continue
      clean[key] = value
    }
    if (idx === 0 && clean.role === 'system' && envSummary) {
      clean.content = clean.content + '\n\n' + envSummary
    }
    return clean
  })
}

function buildModelBody(config, messages, tools, stream, envSummary = '') {
  const thinkingOn = config.thinkingMode !== 'disabled'
  const body = { model: config.model, messages: messagesForApi(messages, envSummary), stream }
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
/** 取消/收尾链路的追踪开关（默认关；YAMI_AI_DEBUG=1 时打到 stderr，用于定位"停不下来"这类问题） */
const DEBUG_TRACE = process.env.YAMI_AI_DEBUG === '1'
function trace(...args) { if (DEBUG_TRACE) process.stderr.write('[trace] ' + args.join(' ') + '\n') }

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

function requestModelStream(config, apiKey, messages, tools, onDelta, cancelToken, envSummary = '') {
  return new Promise((resolve, reject) => {
    let url
    try { url = new URL(chatCompletionsUrl(config.endpoint)) } catch { return reject(new Error('模型地址无法解析')) }
    const transport = url.protocol === 'http:' ? http : https
    const body = Buffer.from(JSON.stringify(buildModelBody(config, messages, tools, true, envSummary)), 'utf8')
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Content-Length': body.length }
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey

    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      error ? reject(error) : resolve(value)
    }

    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: 'POST', headers, timeout: 180000 }, res => {
      // 取消时必须**手工兑现这个 Promise**：Node 里主动 destroy 只会触发 close，
      // 不一定触发 error，光靠 req.on('error') 收尾会让任务永远悬在 await 上——
      // 表现就是"按了停止，界面还说上一条需求还在处理中"（实测抓到的根因）。
      if (cancelToken) cancelToken.onCancel(() => {
        try { res.destroy() } catch (e) {}
        finish(new Error(cancelToken.reason || '已打断'))
      })
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
            // 忽略 stream 参数的本地推理服务：整段 JSON 里同样有 usage 与思考，别当没有
            // （漏读 usage 会让"本轮用量行"永远显示不出来；漏读思考则会让思考块一片空白）
            if (data.usage) message.__usage = normalizeUsage(config.model, data.usage)
            if (message.content && onDelta) onDelta({ content: message.content })
            const wholeReasoning = message.reasoning_content || message.reasoning
            if (wholeReasoning && onDelta) onDelta({ reasoning: String(wholeReasoning) })
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
    // 同上：destroy 之后必须自己 finish，否则 continueSession 会一直 await 下去，
    // busy 永远不清，用户按了停止反而再也不能说话。
    if (cancelToken) cancelToken.onCancel(() => {
      try { req.destroy() } catch (e) {}
      finish(new Error(cancelToken.reason || '已打断'))
    })
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
    回退本身也会留一份安全备份，所以不必担心"退错了就回不去"。

【界面演示：能在界面上做的，就让用户看着你做】
17. 当用户要调的某个东西在编辑器界面上有对应控件（属性面板里的一格、某个按钮、某个工作页）时，
    优先用 ui_steps 在界面上**演出来**，而不是闷头改文件：用户能看着你一步一步点，心里才有底。
    steps 里每一步写清 kind（focus/set/click/goto/wait）、target（CSS 选择器，如 #fileItem-attack）、
    不确定控件选择器时先用 dump_ui_hierarchy 拿到界面上真实存在的 id 与选择器，不要凭空猜（猜错会当场熔断）；
    label（一句白话，会显示在高亮框旁边，别写代码术语）；
    同一次需求里相关的几步填同一个 mergeGroup，演出会合并成一轮，不会一顿一顿。
18. ui_steps 走的是引擎公开入口，等价于"用户自己点了那里"，不是鼠标模拟；
    用户随时可以按停，所以每一步都要能独立看懂，做完了用一句白话交代刚才动了哪几步、结果如何。
19. 不是所有活儿都能演：canvas 里的对象、脚本内容这类没有界面控件可圈的，就不要硬凑，
    如实说一句"这个我只能在后台改"，然后照常走文件工具。
20. ui_steps 是**唯一**会动用户界面的工具；不要用 interact_editor 去模拟鼠标点属性面板，那是兜底手段。
21. 界面操作失败时（某一步找不到控件、或用户按了停）不要假装成功、也不要立刻重试同一批步骤：
    如实说清是第几步卡住的、前面哪几步已经生效，再问用户要不要换个做法。

【开工前先对齐：需求有影响做法的歧义就问，没有就别凑数】
22. 如果用户的需求里存在**会改变你下一步怎么做**的关键歧义（比如"这个技能强一点"到底改哪一项、改成多少），
    不要自己拍板开工，先在回复里给出一张对齐卡。对齐卡必须独占一段、前后不要夹别的内容，格式：
    <alignment-card>{"summary":"我理解你要把木剑改强","questions":[{"title":"攻击力改成多少？","options":["25","40"]}],"defaults":["其余属性不动"]}</alignment-card>
    面板会把它渲染成可点的选项卡，用户点「开工」之后你才会收到确认，那之前不要动手。
23. 只问"答案会改变你下一步做法"的问题，数量不设上限但也不要凑数；需求已经明确时直接开工，不要为了显得严谨硬发一张卡。
    给出 questions 时每个选项都要是具体可执行的取值，不要写"你决定"这种空转选项。

【写盘节奏：预览随便看，落盘只确认一次】
24. 写盘类工具（write_script / edit_script / append_event_commands / patch_resource / upsert_database_item /
    delete_resource / restore_backup / write_resource / create_script）先用 dryRun:true 看一眼差异 ——
    **dryRun:true 不会弹确认卡，直接就能拿到结果**；确认无误再传 dryRun:false 正式写入，那一步才会请用户点「执行修改」。
25. 所以一次需求里能合并的改动就合并成一次正式写入，别一处一确认 ——
    让用户点十次确认，他最后只会闭着眼睛点。预览可以看很多次，落盘只打扰他一次。

【引擎接口不可用时如实说】
26. 如果环境提示里出现「引擎接口未暴露」，说明这台编辑器的引擎没有打 window.YamiEngine 补丁（官方预编译版就是这样）：
    界面演示、高亮、点击、读界面结构、改检视器属性 全都照常可用；
    但 保存、撤销、重做、刷新资源树、启动试玩、文件预检 这几项用不了。
    这种时候不要反复重试同一个动作，也不要承诺"我帮你保存好了 / 已启动试玩"，
    如实说明这一项在当前引擎上用不了、需要引擎侧补丁，然后把能做的部分做完。

27. 环境提示的「停在「攻击力」=25」= 用户此刻正停在那个控件上：他话说得含糊就按它理解，别反问"你指哪个"；
    停在"场景视图"这类区域级说明信息不足，该问就问；他明确说了别处，以他说的为准。

28. 环境提示里「选中「xxx」→ Assets/....」箭头后面那个路径 = **用户此刻在编辑器里打开着的那个工程文件**：
    他说的"这个/它/我选中的那个"指的就是它，它也是你这次要改的**首要目标** —— 直接对这个路径动手，
    不要按名字去工程里另找一个同名文件（同名资源很常见，找错就写到别处去了）。
    为了把这件事做完而必须连带改别的文件时，先用一句白话说明"另外还要改 X"，再动它 —— 不要闷头写。

29. 场景里选中的对象（环境提示「选中actor:「主角」 → Assets/角色/....actor」）箭头后面是它的**源文件**
    （角色/动画/粒子/视差图的定义文件：属性、事件、图片都在那里）。要改的是它在**当前这一份场景里**的东西
    （位置/缩放/朝向/图层）时，改的是环境提示里的场景文件（sceneFile 那个路径）—— 两层分不清就先问一句，
    别默认挑一层动手。

30. 环境提示写着「选中「A」等 3 个」= 他选了不止一个：别默认只改 A，用 get_editor_context 的 selectedFiles
    看全部，先说清你打算改哪一个（他要全改时也要逐个说明改了什么）。

31. 环境提示里「选中「背景」·文件「X.ui」 → Assets/…」这种形状，两个词分工不同：
    「选中」后面 = 他刚在编辑器里点选的那个东西（界面树的节点、列表里的项、场景对象…）；
    「文件」后面 = 编辑器里打开着的那个工程文件（只是"打开着"，不一定是他指的东西）。
    他说"这个/它"时优先指**他点选的那个东西**；要改它，先在它所在的那个文件里按名字 / presetId 找到它，
    别拿"打开着的文件"顶替他指的东西。`



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
    const summary = await client.call('project_changelog', { sessionId: session.id })
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

/**
 * 授权键：`工具::文件` 表示"这一个文件"，`工具::*` 表示"这类工具的所有文件"。
 * 旧版对没有 path 参数的写盘工具（如 upsert_database_item）返回空串 → 永远拿不到授权、
 * 只能一个事务一个事务地勾；而且用户想要的中间档（"这轮里这类写盘别问了"）压根不存在。
 */
function grantKeyOf(name, args, scope) {
  const rel = String((args && args.path) || '')
  if (scope === 'tool' || !rel) return `${name}::*`
  return `${name}::${rel}`
}

function isGranted(session, name, args) {
  if (!session.grants) return false
  // 删除永远逐条确认：不可轻易撤销的动作不接受批量授权
  if (DELETE_TOOLS.has(name)) return false
  return session.grants.includes(grantKeyOf(name, args)) || session.grants.includes(`${name}::*`)
}

function addGrant(session, pending, scope) {
  if (!pending) return null
  if (DELETE_TOOLS.has(pending.name)) return null
  const key = grantKeyOf(pending.name, pending.args, scope)
  if (!key) return null
  if (!Array.isArray(session.grants)) session.grants = []
  if (!session.grants.includes(key)) session.grants.push(key)
  return key
}

/**
 * 这次写盘动的是哪个工程文件：写盘类工具的 path，或 upsert_database_item 的 Data/<表>.json。
 * 同一条口径也用在 /backups 上（那儿原先自己拼了一遍），这里收成一处，免得两处对不上。
 */
function fileTargetOf(name, args) {
  if (!FILE_MUTATIONS.has(name)) return ''
  const rel = String((args && args.path) || '').replace(/\\/g, '/')
  if (rel) return rel
  if (name === 'upsert_database_item' && args && args.table) {
    return 'Data/' + String(args.table).replace(/\.json$/i, '').toLowerCase() + '.json'
  }
  return ''
}

/** 编辑器里"当前打开着的那个文件"：只能问 5967 桥，拿不到就当没有 */
async function selectedEditorFile() {
  try {
    const res = await editorBridge.getContext()
    const selected = res && res.ok && res.context && res.context.selectedFile
    return (selected && selected.path) ? String(selected.path).replace(/\\/g, '/') : ''
  } catch (e) { return '' }
}

/**
 * 用户此刻在编辑器里打开着的那个文件（这一轮认定一次，之后不再重复问桥）。
 * 它代表"我要改这个"的意图：这一轮动它不再逐条确认，动别的文件照旧要先问。
 */
async function noteEditorSelection(session) {
  const selected = await selectedEditorFile()
  session.editorSelection = selected || ''
  return session.editorSelection
}

/** 写盘正好落在选中文件上时，把"这一个文件"加进授权表（每个工具一份键，删除类永远不加） */
function grantSelectionHit(session, name, args, events) {
  const selected = session && session.editorSelection
  if (!selected) return false
  if (fileTargetOf(name, args) !== selected) return false
  if (isGranted(session, name, args)) return false
  if (!addGrant(session, { name: name, args: args }, 'file')) return false
  saveSession(session)
  if (events && events.onNotice) {
    events.onNotice(`「${selected}」是你此刻在编辑器里打开着的文件，这一步直接改它、不再逐条确认；打开之外的文件仍然会先问你。`)
  }
  return true
}

// ============================================================
// 每轮用量记账（对齐 DSH 的轮次用量行语义：记账不全就整行不显示，
// 不拿"部分总量"冒充完整结果）。探针挂在 session 之外的 Map 上：
// 会话 JSON 是用户数据，不该混进运行时计数器。
// ============================================================
const turnProbes = new Map()

function snapshotUsage(usage) {
  return {
    promptTokens: Number((usage && usage.promptTokens) || 0),
    completionTokens: Number((usage && usage.completionTokens) || 0),
    cachedTokens: Number((usage && usage.cachedTokens) || 0),
    cost: Number((usage && usage.cost) || 0),
    calls: Number((usage && usage.calls) || 0)
  }
}

function beginTurnProbe(session) {
  turnProbes.set(session.id, { before: snapshotUsage(session.usage), attempts: 0, reported: 0 })
}

/** 记一次模型调用：reported 只在这次调用真的带回了 usage 时 +1 */
function noteModelAttempt(session, hasUsage) {
  const probe = session && turnProbes.get(session.id)
  if (!probe) return
  probe.attempts += 1
  if (hasUsage) probe.reported += 1
}

function turnUsageOf(session) {
  const probe = turnProbes.get(session.id)
  if (!probe) return { complete: false }
  const after = snapshotUsage(session.usage)
  const delta = {
    calls: after.calls - probe.before.calls,
    promptTokens: after.promptTokens - probe.before.promptTokens,
    completionTokens: after.completionTokens - probe.before.completionTokens,
    cachedTokens: after.cachedTokens - probe.before.cachedTokens,
    cost: Number((after.cost - probe.before.cost).toFixed(6))
  }
  // 「完整」= 本轮每一次 Agent 循环的模型调用都报告了 usage。
  // 允许 delta.calls 大于 attempts：上下文压缩等旁路模型调用也是这一轮的真实花费，
  // 算进去才对得起"本轮花了多少"这个问题；但只要有一次调用没报 usage，整行就不显示。
  delta.complete = probe.attempts > 0 && probe.reported === probe.attempts && delta.calls > 0
  return delta
}

// ============================================================
// 引导（steering）：用户在这一轮还在跑的时候补充的话，既不该被丢掉，也不该硬塞进
// 正在流式的那个请求里 —— 存进队列，在**下一个步骤边界**投递给模型（对齐 DSH 的
// steering 语义：繁忙时走 pending-steering，空闲时才进 transcript）。
// 队列放 Map 而不是 session 上：它是运行时输入，不该跟着会话 JSON 落盘。
// ============================================================
const steerQueues = new Map()

function queueSteer(session, text) {
  const queue = steerQueues.get(session.id) || []
  queue.push({ text: String(text), at: Date.now() })
  steerQueues.set(session.id, queue)
  return queue.length
}

/** 取出全部待投递的补充（取出即清空） */
function drainSteer(session) {
  const queue = steerQueues.get(session.id) || []
  steerQueues.delete(session.id)
  return queue
}

/** 一轮收工时还留在队列里的：模型已经收工、没机会投递 → 如实交回前端，由它当普通消息发出去 */
function takeUndeliveredSteer(session) {
  return drainSteer(session).map(item => item.text)
}

// 系统提示词行的去重：同一份 system 文本只上屏一次；会话重新载入后允许再来一次
// （对齐 DSH：「即使系统文本未变，resume 也会重复该行」）
const systemHashes = new Map()

function systemTextOf(messages) {
  return (messages || []).filter(m => m && m.role === 'system').map(m => String(m.content || '')).join('\n\n')
}

function systemHashOf(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 12)
}

/** 把"模型这一轮实际看到的 system 文本"如实上屏（文本变了才再上一行） */
function noteSystemSurface(session, messages, events) {
  if (!events || !events.onSystem) return
  const text = systemTextOf(messages)
  if (!text) return
  const hash = systemHashOf(text)
  if (systemHashes.get(session.id) === hash) return
  systemHashes.set(session.id, hash)
  events.onSystem({ text: text, hash: hash })
}

/** 包住一轮：结束后把本轮用量与"没送出去的补充"挂到结果上交回前端 */
async function runTurn(session, config, events) {
  beginTurnProbe(session)
  try {
    const result = await continueSession(session, config, events)
    if (result && typeof result === 'object') {
      result.turnUsage = turnUsageOf(session)
      const left = takeUndeliveredSteer(session)
      if (left.length) result.undeliveredSteer = left
    }
    return result
  } catch (error) {
    // 出错也要把没送出去的补充交回去：静默丢掉就等于骗用户"已经引导过了"（铁律㊷）。
    // 之前这里只在成功路径取，抛错时会被下面的 finally 直接清空。
    const left = takeUndeliveredSteer(session)
    if (left.length && error && typeof error === 'object') error.undeliveredSteer = left
    throw error
  } finally {
    turnProbes.delete(session.id)
    steerQueues.delete(session.id)
  }
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
  // 获取当前环境快照（优先采用当前窗口直发的一手快照，防止试玩被误报为编辑器；拿不到回退 5967 桥）
  let envSummary = (events && events.envSummary) || ''
  if (!envSummary) {
    try { envSummary = await fetchEditorContextSummary() } catch {}
  }
  // 工程文档入口跟着环境快照走同一条注入通道（它每轮都该在，但不参与顶栏那一行显示）
  const docHint = projectDocHint()
  if (docHint) envSummary = envSummary ? envSummary + '\n' + docHint : docHint

  const rawMaxSteps = (config && config.maxSteps !== undefined) ? Number(config.maxSteps) : Number(process.env.YAMI_AI_MAX_STEPS || DEFAULT_MAX_STEPS)
  const maxSteps = rawMaxSteps > 0 ? rawMaxSteps : Infinity
  for (let step = 0; step < maxSteps; step++) {
    if (cancelToken && cancelToken.cancelled) return aborted()
    // 步骤边界：把用户在这期间补充的话投递给模型（投递了才告知前端，没投递的一律不算数）
    const steers = drainSteer(session)
    if (steers.length) {
      for (const item of steers) {
        session.messages.push({ role: 'user', content: '（用户在你工作期间补充：' + item.text + '）' })
      }
      saveSession(session)
      if (events.onSteer) for (const item of steers) events.onSteer({ phase: 'delivered', text: item.text })
    }
    noteSystemSurface(session, session.messages, events)
    if (events.onStatus) events.onStatus(step === 0 ? '正在思考' : `继续处理（第 ${step + 1} 步）`)
    let assistant
    // 记下这次请求实际发出的消息条数：响应里的 prompt_tokens 就是这批消息（含 system 与工具
    // schema）的真实用量，存成锚点后，面板刻度与压缩判定都不用再靠纯估算
    const sentCount = session.messages.length
    try {
      assistant = await requestModelStream(config, key, session.messages, toolsForModel, delta => {
        if (events.onDelta) events.onDelta(delta)
      }, cancelToken, envSummary)
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
    noteModelAttempt(session, !!(assistant && assistant.__usage))
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
    // 硬闸：单工具刷屏 / 单轮总预算用尽。toolTally 记的是本轮**已执行**的调用次数（每轮清零），
    // 直接拿来当预算计数器，不引入第二份状态。
    {
      const tally = session.toolTally || {}
      const hotName = calls
        .map(call => call.function && call.function.name)
        .filter(Boolean)
        .find(name => (tally[name] || 0) >= TOOL_REPEAT_LIMIT)
      const usedTotal = Object.values(tally).reduce((sum, value) => sum + (Number(value) || 0), 0)
      if (hotName || usedTotal >= TURN_CALL_BUDGET) {
        const detail = Object.entries(tally)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name, times]) => toolLabel(name) + ' ' + times + ' 次')
          .join('、')
        appendUnexecutedToolResults(session, calls, '本轮工具调用预算用尽，本次未执行')
        return await attachChangelog(session, {
          ok: false,
          status: 'stuck',
          message: (hotName
            ? `「${toolLabel(hotName)}」已经连续调用了 ${tally[hotName]} 次还没有收尾`
            : `本轮工具调用已达上限 ${TURN_CALL_BUDGET} 次`)
            + `，我先停下来，免得继续空转。本轮调用分布：${detail || '（无）'}。`
            + '你可以直接告诉我下一步该看哪个文件、改哪里，或者说一句「继续」让我再跑一轮。'
        })
      }
    }
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

    // 早期打转干预：模型开始重复调用时，在上下文末尾直接追加强干预提示，主动把模型拽出死循环
    if (repeats > 0) {
      const labels = calls.map(call => toolLabel(call.function && call.function.name)).join('、')
      session.messages.push({
        role: 'user',
        content: `【系统干预指引】你刚刚连续第 ${repeats + 1} 次发起了与上一轮完全相同的「${labels}」调用。相同的检索结果前文已完整给出，严禁再次重复调用相同检索！请立即阅读前文已有结果，调用具体的读取/编辑工具（如 read_script、edit_script、append_event_commands）执行下一步，或直接向用户说明结论。`
      })
      saveSession(session)
    }

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
  if (events.onNotice) events.onNotice(`已完成单轮上限（${maxSteps} 步），所有改动已安全保留。回复“继续”即可接续执行。`)
  return await attachChangelog(session, {
    ok: true,
    status: 'step-limit',
    message: `本次任务已执行满单轮步数上限（共 ${maxSteps} 步）。已完成的修改均已安全保留；如需继续推进剩余任务，回复“继续”即可接续执行。`
  })
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
  finish_stuck_event: '结束卡住的事件', suspend_runtime_kind: '暂停/恢复某类更新',
  search_project: '工程内检索', edit_script: '精确改脚本', diagnose_runtime: '读取运行诊断',
  project_changelog: '生成改动小结', todo_write: '更新待办清单',
  ui_steps: '在界面上演示操作'
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
/**
 * ui_steps 的动作分两类：focus / goto / wait 只是"看"（高亮、翻页、停一下），set / click 才是真改东西。
 * 上一轮把整个 ui_steps 并进 OTHER_MUTATIONS（防界面被悄悄改），副作用是连"演示给你看"也要弹确认卡，
 * 于是模型干脆不演示了 —— 用户要的"边做边演示"就这么没了。这里按步骤类型细分：只有真改的才拦。
 */
function uiStepsMutating(args) {
  const steps = Array.isArray(args && args.steps) ? args.steps : []
  return steps.some(step => step && ['set', 'click'].includes(String(step.kind || '')))
}

function isExclusiveCall(name) {
  if (FILE_MUTATIONS.has(name)) return true
  if (OTHER_MUTATIONS.has(name)) return true
  if (declaredReadOnlyTools.has(name)) return false
  return !READ_ONLY_TOOLS.has(name)
}

/**
 * 等一个工具返回，但用户按停止时**立刻**放行。
 *
 * MCP 是 stdio 的请求-响应协议，没有取消语义：请求已经发出，子进程会继续跑完。
 * 但我们不该继续干等——旧实现是裸 await，用户按了停止界面还得等工具跑完（最坏 180 秒，
 * 而模型陷入重复检索时每一步都在等），这期间会话一直是 busy，下一句话直接被
 * 「上一条需求还在处理中」顶回去。现在改成取消即收尾；迟到的响应由 onData 丢弃
 * （pending 表里已经没有它，不会串到别的请求上）。
 */
function callToolWithCancel(client, name, args, cancelToken) {
  trace('工具开始 ' + name)
  const pending = client.call(name, args)
  if (!cancelToken) return pending
  return new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (!settled) { settled = true; trace('工具结束 ' + name + (value && value.cancelled ? '（被取消，不再等待）' : '')); resolve(value) }
    }
    cancelToken.onCancel(() => finish({
      ok: false,
      cancelled: true,
      message: '用户打断了这次操作：这个工具的结果不再等待（已发出的请求会在后台跑完并被丢弃）'
    }))
    pending.then(finish, error => finish({ ok: false, error: error.message }))
  })
}

/**
 * 同一工具在一轮任务里被反复调用时，往结果里塞一句提示，让模型自己收敛。
 * 这不是硬止损（换关键词检索是合理行为），而是把"你已经查了很多遍了"这个事实告诉它——
 * 模型看不到调用次数，而工具条上刷屏的「执行：工程内检索」用户是看得见的。
 */
function repeatHint(session, name) {
  if (!session.toolTally) session.toolTally = {}
  session.toolTally[name] = (session.toolTally[name] || 0) + 1
  const count = session.toolTally[name]
  if (count < 3) return null
  return `这是本次任务里第 ${count} 次调用「${toolLabel(name)}」（同一工具上限 ${TOOL_REPEAT_LIMIT} 次，到点我会停下来把进度交回用户）。`
    + '如果前面几次的结果没能推进任务，请立刻换策略：不要再继续检索！直接读取具体文件（read_script / read_resource），'
    + '或用 edit_script / append_event_commands 执行修改，或把已确认的结论先告诉用户。'
}

/**
 * 工具卡片要用的结构化摘要：只放**确定性事实**（差异行数、字节、命中数、是否落盘、退出码），
 * 让前端不必从中文描述里猜。字段缺失就不放，卡片也不会凭空编一个数字出来。
 */
function toolInfoOf(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const info = {}
  if (result.diffStat && typeof result.diffStat === 'object') {
    info.diffStat = { added: Number(result.diffStat.added) || 0, removed: Number(result.diffStat.removed) || 0 }
  }
  if (Number.isFinite(result.bytes)) info.bytes = result.bytes
  if (Number.isFinite(result.chars)) info.chars = result.chars
  if (Number.isFinite(result.lines)) info.lines = result.lines
  if (Array.isArray(result.matches)) info.matches = result.matches.length
  if (Array.isArray(result.files)) info.files = result.files.length
  if (Array.isArray(result.items)) info.items = result.items.length
  if (Number.isFinite(result.total)) info.total = result.total
  if (result.exitCode !== undefined && result.exitCode !== null) info.exitCode = result.exitCode
  if (result.truncated) info.truncated = true
  if (result.spill && result.spill.path) info.spill = { path: String(result.spill.path), chars: Number(result.spill.chars) || 0 }
  // 裁剪发生在这个结果被序列化的时候（见 clipToolResult 盖的章）：截断了就必须如实说，
  // 否则卡片会显示"完整"，而模型实际只拿到头尾 —— 那正是"拿部分冒充完整"。
  if (result.__clip) {
    info.truncated = true
    if (Number.isFinite(result.__clip.originalChars)) info.originalChars = result.__clip.originalChars
    if (result.__clip.spillPath) {
      info.spill = { path: String(result.__clip.spillPath), chars: Number(result.__clip.originalChars) || 0 }
    }
  }
  // 界面演示：把"演了几步"带给卡片，面板据此给「撤销这一步」入口（不给具体步骤，省上下文）
  if (result.action === 'uiSteps' || result.action === 'ui_steps') {
    info.uiSteps = true
    info.done = Array.isArray(result.done) ? result.done.length : 0
  }
  delete info.__clip
  return Object.keys(info).length ? info : null
}

/** 把提示并进工具结果（将警告置于对象最顶部，确保大模型第一眼即能关注到，打破盲目重复） */
function withHint(result, hint) {
  if (!hint || !result || typeof result !== 'object' || Array.isArray(result)) return result
  return Object.assign({ _SYSTEM_WARNING_: hint }, result, { __hint: hint })
}

/**
 * 执行一个只读调用（不含审批路径，纯读取）。
 * 终态事件（done/fail）由调用方在**打包之后**发：只有那时才知道这次结果有没有被裁剪、
 * 完整原文落在哪 —— 卡片上的事实必须来自最终形态，不能来自打包之前。
 */
async function runReadOnly(client, call, name, args, events, cancelToken) {
  // key 用调用 id：只读批次是并发跑的，没有 key 的话前端会把 A 的结果写到 B 的卡片上
  if (events.onTool) events.onTool({ phase: 'start', key: String(call && call.id || name), name, label: toolLabel(name), target: String(args.path || args.table || args.action || args.key || '') })
  try {
    return await callToolWithCancel(client, name, args, cancelToken)
  } catch (error) {
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
    if ((name === 'todo_write' || name === 'project_changelog') && !args.sessionId) {
      args.sessionId = session.id
    }

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
        ? [await runReadOnly(client, batch[0].call, batch[0].name, batch[0].args, events, cancelToken)]
        : await Promise.all(batch.map(item => runReadOnly(client, item.call, item.name, item.args, events, cancelToken)))
      for (let position = 0; position < batch.length; position++) {
        const item = batch[position]
        const result = batchResults[position]
        const hint = repeatHint(session, item.name)
        const packed = withHint(result, hint)
        session.messages.push({ role: 'tool', tool_call_id: item.call.id, content: clipToolResult(packed, item.name) })
        if (events.onTool) {
          const key = String(item.call && item.call.id || item.name)
          events.onTool(packed && packed.ok === false
            ? { phase: 'fail', key, name: item.name, label: toolLabel(item.name), detail: (packed && (packed.error || packed.message)) || '执行失败', info: toolInfoOf(packed) }
            : { phase: 'done', key, name: item.name, label: toolLabel(item.name), info: toolInfoOf(packed) })
        }
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

    if (events.onTool) events.onTool({ phase: 'start', key: String(call && call.id || name), name, label: toolLabel(name), target: String(args.path || args.table || args.action || args.key || '') })
    const isFileMutation = FILE_MUTATIONS.has(name)
    // dryRun 预览不落盘，本来就不该要用户确认：
    //   · "先看一眼差异"是我们要鼓励的动作，每看一眼都弹一次确认，只会把用户训练成闭眼点确认；
    //   · 真正写盘那一步（dryRun:false）照旧拦确认，安全性一点没少。
    // 只认**显式** dryRun:true：模型不传这个参数时，我们无法保证这个工具一定不写。
    const isPreviewOnly = !!(args && args.dryRun === true)
    // P0-3: 写盘与界面改属性前，检查是否有未失焦/未提交的输入 (AutoReload 竞态防踩)。
    // ui_steps 也是一次"改属性"，用户打了一半的字同样会被 AutoReload 冲掉，所以一并拦。
    // 纯预览既不写盘也不碰控件，不拦。
    // 纯演示（只有高亮/翻页/等待）不写任何东西，也不该被"未失焦输入"拦住
    const uiDemoOnly = name === 'ui_steps' && !uiStepsMutating(args)
    if ((isFileMutation && !isPreviewOnly) || (name === 'ui_steps' && !uiDemoOnly)) {
      try {
        const ctxRes = await editorBridge.getContext()
        if (ctxRes && ctxRes.ok && ctxRes.context && ctxRes.context.hasPendingInput === true) {
          const rejectMsg = '检测到编辑器中有未失焦的输入正在进行，为防修改被冲掉，请先敲击回车或点击空白处失焦后再试'
          const errRes = { ok: false, hasPendingInput: true, error: rejectMsg }
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: clipToolResult(errRes, name) })
          saveSession(session)
          results.push({ name, result: errRes })
          if (events.onTool) events.onTool({ phase: 'fail', key: String(call && call.id || name), name, label: toolLabel(name), detail: rejectMsg, info: toolInfoOf(errRes) })
          continue
        }
      } catch (e) {}
    }
    // 选中文件是用户"我要改这个"的意图：先按它放行，再照常判要不要确认
    const grantedBySelection = isFileMutation && !isPreviewOnly && grantSelectionHit(session, name, args, events)
    const granted = isFileMutation && isGranted(session, name, args)
    const needsApproval = !granted && ((isFileMutation && !isPreviewOnly) || (OTHER_MUTATIONS.has(name) && !uiDemoOnly && config.approvalMode !== 'auto'))
    // 选中放的行走上面那条（说的是"因为你在编辑器里开着它"）；这句只在勾选授权那条路上说
    if (granted && !grantedBySelection && events.onNotice) {
      events.onNotice(`已授权：${toolLabel(name)} · ${String(args.path || '') || '全部分支'}（本对话内不再逐条确认，跨重启仍有效；可用 /clear 或【撤销】面板清除）`)
    }
    if (needsApproval) {
      const preview = isFileMutation ? await callToolWithCancel(client, name, { ...args, dryRun: true }, cancelToken) : null
      if (preview && preview.ok === false) {
        session.messages.push({ role: 'tool', tool_call_id: call.id, content: clipToolResult(preview, name) })
        saveSession(session)
        results.push({ name, result: preview })
        if (events.onTool) events.onTool({ phase: 'fail', key: String(call && call.id || name), name, label: toolLabel(name), detail: preview.error || '预览失败', info: toolInfoOf(preview) })
        continue
      }
      session.pending = { call, name, args, preview, remaining: calls.slice(index + 1) }
      saveSession(session)
      if (events.onTool) events.onTool({ phase: 'approval', key: String(call && call.id || name), name, label: toolLabel(name) })
      return { approval: { ok: true, status: 'approval', message: assistantContent || '这一步会修改工程或控制编辑器，请确认。', approval: summarizePending(name, args, preview) }, results }
    }
    const result = await callToolWithCancel(client, name, args, cancelToken)
    const hint = repeatHint(session, name)
    const packedResult = withHint(result, hint)
    session.messages.push({ role: 'tool', tool_call_id: call.id, content: clipToolResult(packedResult, name) })
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
      const key = String(call && call.id || name)
      events.onTool(packedResult && packedResult.ok === false
        ? { phase: 'fail', key, name, label: toolLabel(name), detail: (packedResult && (packedResult.error || packedResult.message)) || '执行失败', info: toolInfoOf(packedResult) }
        : { phase: 'done', key, name, label: toolLabel(name), info: toolInfoOf(packedResult) })
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
      return { ok: true, grants: session.grants, message: '已撤销该授权，之后会重新逐条确认' }
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
        // 工具::* = 这类工具的所有文件（G-6 的中间档）；path 置空 + allFiles 让面板显示「全部文件」
        const allFiles = path === '*'
        return { key, tool, toolLabel: toolLabel(tool), path: allFiles ? '' : path, allFiles }
      })
    }
  }
  if (pathname === '/steer') {
    // 繁忙时的"引导"：把补充内容排进队列，由 Agent 循环在下一个步骤边界投递给模型。
    // 空闲时没有可插入的边界，如实告诉前端"直接发就行"，而不是假装收下了。
    const session = sessionFor(body.sessionId || 'default')
    const text = String(body.message || '').trim()
    if (!text) throw new Error('引导内容不能为空')
    if (!session.busy) return { ok: true, busy: false, queued: 0, note: '当前没有正在跑的任务，直接发送即可' }
    return { ok: true, busy: true, queued: queueSteer(session, text) }
  }
  if (pathname === '/ui-cancel') {
    try {
      const stopped = await editorBridge.action('cancel', { reason: body && body.reason ? body.reason : '用户停止' })
      if (stopped && stopped.ok === false && stopped.error) return { ok: false, error: stopped.error }
    } catch (e) {}
    return { ok: true, cancelled: true }
  }
  // 绿档动作的「撤销这一步」：界面上刚演完的那一步，一键退回（走引擎 UndoManager）
  if (pathname === '/ui-undo') {
    try {
      const undone = await editorBridge.action('undo')
      if (undone && undone.ok === false) return { ok: false, error: undone.error || '编辑器没有可撤销的记录' }
      return { ok: true, undone: true }
    } catch (e) {
      return { ok: false, error: '撤销失败：' + e.message }
    }
  }
  if (pathname === '/quick-config') {
    // 只更新传入的字段（模型 / 思考开关 / 思考强度），其余保持原值。
    // 快捷调节条每次改动都调它，不能用 /config —— 那会把未传字段按默认值覆盖掉。
    const patch = {}
    for (const key of ['model', 'thinkingMode', 'thinkingEffort', 'thinkingView', 'processFold', 'busySend', 'maxSteps']) {
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
    // 开始新任务时把当前工程状态设为该会话的独立基线，之后的变更小结只报增量
    const client = await ensureMcp()
    const result = await client.call('project_changelog', { reset: true, sessionId: body.sessionId || 'default' })
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
        const filePath = fileTargetOf(name, safeArgs(call.function && call.function.arguments))
        if (filePath && !touched.includes(filePath)) touched.push(filePath)
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
        isRestored: !!(list && list.isRestored),
        canRedo: !!(list && list.canRedo),
        redoBackup: (list && list.redoBackup) || null,
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
    const callArgs = { path: rel, dryRun: false }
    if (body.backup) callArgs.backup = body.backup
    const preview = await client.call('restore_backup', callArgs)
    if (preview && preview.ok === false) return preview
    return {
      ok: true,
      path: rel,
      alreadyRestored: !!preview.alreadyRestored,
      savedAt: preview.savedAt,
      diff: preview.diff,
      diffStat: preview.diffStat,
      safetyBackup: preview.safetyBackup,
      message: preview.message || `已把 ${rel} 退回 ${preview.savedAt} 的版本`
    }
  }
  if (pathname === '/session/load') {
    const id = safeSessionId(body.sessionId)
    const restored = loadSessionFromDisk(id)
    if (!restored) throw new Error('没有找到这个会话')
    // 磁盘上的历史可能是旧版本写下的坏序列：恢复时先体检，别让用户一开口就撞 400
    healSessionMessages(restored, '恢复会话时体检')
    sessions.set(id, restored)
    // resume 后允许「系统提示词」行再上一次（对齐 DSH：即使文本没变也会重复该行）
    systemHashes.delete(id)
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

  // 【导出对话】把一段会话（all=true 时是全部历史）铺成 Markdown 落盘，再把落点交回面板定位。
  // 只读会话：不写会话文件、不动内存里的会话；渲染时也不去碰模型，所以忙碌中也能导出。
  if (pathname === '/session/export') {
    const stamp = new Date().toISOString().slice(0, 10)
    if (body.all === true) {
      const items = []
      for (const name of fs.readdirSync(SESSION_DIR).filter(item => item.endsWith('.json'))) {
        const restored = loadSessionFromDisk(name.replace(/\.json$/, ''))
        if (!restored) continue
        const turns = (restored.messages || []).filter(message => message.role === 'user' && !isCheckpoint(message)).length
        if (!turns) continue   // 一句话没说的空会话不进导出稿
        items.push({ id: restored.id, title: sessionTitleOf(restored.messages), updatedAt: restored.updatedAt || 0, markdown: sessionToMarkdown(restored) })
      }
      if (!items.length) throw new Error('还没有可以导出的对话')
      items.sort((a, b) => b.updatedAt - a.updatedAt)
      const parts = [
        '# 妙妙插件 AI 对话全量导出',
        '',
        '- **导出时间**: ' + new Date().toLocaleString('zh-CN', { hour12: false }),
        '- **会话数**: ' + items.length + ' 段对话',
        '',
        '## 目录',
        ''
      ]
      items.forEach((item, index) => parts.push((index + 1) + '. ' + item.title + '（`' + item.id + '`）'))
      for (const item of items) parts.push('', '---', '', item.markdown.trim())
      return writeExport(exportFileName('AI对话-全部', '-' + stamp + '.md'), parts.join('\n') + '\n', items.length)
    }
    const id = safeSessionId(body.sessionId)
    const session = sessions.get(id) || loadSessionFromDisk(id)
    if (!session) throw new Error('没有找到这个会话')
    const turns = (session.messages || []).filter(message => message.role === 'user' && !isCheckpoint(message)).length
    if (!turns) throw new Error('这段对话还没有内容')
    const markdown = sessionToMarkdown(session)
    return writeExport(exportFileName(sessionTitleOf(session.messages), '-' + stamp + '.md'), markdown, 1)
  }

  // 【G-1】重来：把对话时间轴截断到"某一条用户消息之前"，并把那条原文回填给面板改写重发。
  // 只动对话、不动文件 —— 盘上的改动仍在，要回退请用【撤销】面板（restore_backup）。
  // messageIndex 口径：**非压缩检查点**的用户消息序号（0 基），与面板上的用户气泡一一对应。
  if (pathname === '/session/rewind') {
    const id = safeSessionId(body.sessionId)
    const session = sessions.get(id) || loadSessionFromDisk(id)
    if (!session) throw new Error('没有找到这个会话')
    if (session.busy) throw new Error('这一轮还在处理中：先按「停止」再重来')
    if (session.pending) throw new Error('还有一项操作在等你确认：先执行或取消它，再重来')
    const wanted = Number(body.messageIndex)
    if (!Number.isInteger(wanted) || wanted < 0) throw new Error('要重来的那一轮编号不对')
    let seen = -1
    let cut = -1
    for (let i = 0; i < session.messages.length; i++) {
      const message = session.messages[i]
      // 压缩检查点也是 role='user'，但它不是"用户说过的话"，不许占序号
      if (message.role !== 'user' || isCheckpoint(message)) continue
      seen++
      if (seen === wanted) { cut = i; break }
    }
    if (cut < 0) throw new Error('这一轮已经不在会话里了（可能已被上下文压缩折叠）')
    const text = String(session.messages[cut].content || '')
    const removed = session.messages.length - cut
    session.messages = session.messages.slice(0, cut)
    session.pending = null
    // 历史被截断：之前那批工具调用已不在上下文里，打转计数与修复预算跟着清零
    session.repairs = 0
    if (session.seen) session.seen.clear()
    saveSession(session)
    return { ok: true, message: text, removed, messages: visibleMessages(session) }
  }

  // 【G-8】手动压缩：复用已有的两级压缩路径（force 跳过阈值），让用户能在 80% 之前主动收一次，
  // 而不是只能等它自动发生。压缩会改写历史（折叠成检查点），所以忙碌时直接拒绝。
  if (pathname === '/compact') {
    const session = sessionFor(body.sessionId || 'default')
    if (session.busy) throw new Error('这一轮还在处理中：等它跑完或按停止后再压缩')
    const config = readStoredConfig()
    const key = await getApiKey(config)
    const before = session.messages.length
    const client = await ensureMcp()
    toolsForModel = modelTools(client.tools)
    const changed = await compressContext(session, config, key, toolsForModel, true)
    saveSession(session)
    return { ok: true, changed: !!changed, before, after: session.messages.length, context: contextStatus(session) }
  }
  if (pathname === '/chat' || pathname === '/chat/stream') {
    const text = String(body.message || '').trim()
    if (!text) throw new Error('请输入要完成的事情')
    const session = sessionFor(body.sessionId || 'default')
    if (session.busy) {
      // 上一次任务已经按过停止、只是还没收完尾（取消令牌已触发，但工具调用的收尾需要一个事件循环）：
      // 等它一下再放行。不这样做，用户按了停止、任务其实已经停了，却还要对着
      // 「上一条需求还在处理中」干瞪眼——这正是"停了却发不出下一句"的来源。
      if (session.activeCancel && session.activeCancel.cancelled && session.activeRun) {
        // 硬超时兜底：等收尾最多 1 秒。收尾通常几十毫秒就完成，但万一它卡在某个
        // 不可取消的收尾步骤上，也绝不能把新需求一起拖死（宁可放行并发，也不能让界面失去响应）。
        try {
          await Promise.race([
            Promise.resolve(session.activeRun).catch(() => {}),
            new Promise(resolve => setTimeout(resolve, 1000))
          ])
        } catch (e) { /* 收尾出错不该拖住新任务 */ }
      }
    }
    if (session.busy) throw new Error('上一条需求还在处理中，请稍候')
    if (session.pending) {
      // 用户没理会挂起的那张确认卡，直接说了新需求：视为放弃那项修改。
      // （比硬拦"请先执行或取消"更好——窗口重开时确认卡未必还在，硬拦会把人锁死在原地）
      const abandoned = session.pending
      session.pending = null
      appendUnexecutedToolResults(
        session,
        [abandoned.call].concat(abandoned.remaining || []),
        '用户改说了别的需求，这项操作没有执行。如果这一步仍然是新需求的前置，请主动问用户要不要重做。'
      )
      if (events.onNotice) {
        events.onNotice(`上一步「${toolLabel(abandoned.name)}」还等着你在卡片上点「执行修改」，你先说了新需求，我把它作废了（${String(abandoned.args && abandoned.args.path || '')}）。需要的话说一句"接着刚才那步做"，我重新来。`)
      }
    }
    healSessionMessages(session, '发送前体检')
    let userText = String(text || '').trim()
    const CONTINUATION_RE = /^(继续|继续吧|接着做|接着来|接着干|下一步|继续做|继续执行|接着执行|go\s*on|continue|next)$/i
    if (CONTINUATION_RE.test(userText)) {
      userText = `${userText}（请检查上一轮的实际进展与已有搜索结果，直接执行下一步具体动作，如读取文件、编辑代码或写入事件指令，不要重复调用已经产生过结果的同类检索工具）`
    }
    session.messages.push({ role: 'user', content: userText })
    session.busy = true
    session.repairs = 0     // 每条新需求重新给自动修复预算
    session.toolTally = {}  // 以及重新开始统计工具调用次数（重复提示按轮计）
    saveSession(session)
    if (body.pageContext) {
      const pc = body.pageContext
      if (pc.page === 'playtest') {
        events.envSummary = `【当前环境】当前处于试玩运行中：${pc.summary || '游戏正在运行'}`
      } else if (pc.summary) {
        events.envSummary = pc.summary.startsWith('【当前环境】') ? pc.summary : `【当前环境】${pc.summary}`
      }
    } else if (body.envSummary && !events.envSummary) {
      events.envSummary = String(body.envSummary).trim()
    }
    // 这一轮认定一次"用户在编辑器里打开着哪个文件"（选中即意图），动别的文件照旧要先问
    await noteEditorSelection(session)
    const running = runTurn(session, readStoredConfig(), events)
    session.activeRun = running
    session.activeCancel = events.cancelToken || null
    trace('任务启动 session=' + session.id)
    try {
      return await running
    } finally {
      trace('任务收尾 session=' + session.id)
      session.busy = false
      session.activeRun = null
      session.activeCancel = null
      saveSession(session)
    }
  }
  if (pathname === '/approve' || pathname === '/reject') {
    const session = sessionFor(body.sessionId || 'default')
    if (session.busy) throw new Error('当前会话已有任务正在运行中，请稍候')
    if (!session.pending) throw new Error('没有等待确认的操作')
    session.busy = true
    try {
      const pending = session.pending
      const rejected = pathname === '/reject'
      if (!rejected && FILE_MUTATIONS.has(pending.name)) {
        try {
          const ctxRes = await editorBridge.getContext()
          if (ctxRes && ctxRes.ok && ctxRes.context && ctxRes.context.hasPendingInput === true) {
            throw new Error('检测到编辑器中有未失焦的输入正在进行，为防修改被冲掉，请先敲击回车或点击空白处失焦后再确认执行')
          }
        } catch (e) {
          if (e.message && e.message.includes('未失焦的输入')) throw e
        }
      }
      session.pending = null
      let result
      // 打包（裁剪 + 落盘）只做一次：事件里的"已截断/落在哪"与入历史的正文必须来自同一次打包
      let packedApproved = ''
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
        if (events.onTool) events.onTool({ phase: 'start', key: String(pending.call && pending.call.id || pending.name), name: pending.name, label: toolLabel(pending.name), target: String(pending.args.path || '') })
        // 与自动执行路径同源：等结果也要能被"停止"立刻放行，否则用户点了停止，
        // 界面显示已打断、宿主却还在这里干等到写盘返回（事件流也拿不到取消回执）。
        result = await callToolWithCancel(await ensureMcp(), pending.name, args, events.cancelToken)
        packedApproved = clipToolResult(result, pending.name)   // 顺带在原对象上盖"是否被裁剪"的章
        if (events.onTool) {
          const key = String(pending.call && pending.call.id || pending.name)
          events.onTool(result && result.ok === false
            ? { phase: 'fail', key, name: pending.name, label: toolLabel(pending.name), detail: (result && (result.error || result.message)) || '执行失败', info: toolInfoOf(result) }
            : { phase: 'done', key, name: pending.name, label: toolLabel(pending.name), info: toolInfoOf(result) })
        }
        // 用户勾选「不再逐条确认」时才授予授权（删除类永不授权）。两档粒度（G-6）：
        //   grantForSession = 只放行**这一个文件**（原有行为）；
        //   grantForTool    = 放行**这类工具的所有文件**（跨 5 个文件的活不用停 5 次）。
        if ((body.grantForSession === true || body.grantForTool === true) && result && result.ok !== false) {
          const scope = body.grantForTool === true ? 'tool' : 'file'
          const key = addGrant(session, pending, scope)
          if (key && events.onNotice) {
            const what = scope === 'tool'
              ? toolLabel(pending.name) + ' 这类工具'
              : toolLabel(pending.name) + ' · ' + String(pending.args.path || '')
            events.onNotice(`已记住：${what} 在本对话内不再逐条确认（跨重启仍有效；可用 /clear 或【撤销】面板清除）`)
          }
        }
      }
      session.messages.push({ role: 'tool', tool_call_id: pending.call.id, content: packedApproved || clipToolResult(result, pending.name) })
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
        // 第 6 个参数（cancelToken）以前漏传：processToolCalls 只认自己的形参、不读 events.cancelToken，
        // 于是审批续跑期间"停止"要等这批工具全跑完才生效。
        const outcome = await processToolCalls(session, pending.remaining, config, '', events, events.cancelToken || null)
        if (outcome.approval) return outcome.approval
      }
      const running = runTurn(session, config, events)
      session.activeRun = running
      return await running
    } finally {
      session.busy = false
      session.activeRun = null
      saveSession(session)
    }
  }
  if (pathname === '/clear') {
    // 只清空**这段对话的内容**，绝不删历史文件。
    // 这里以前是 sessions.delete + rmSync：于是面板上那个写着「新对话」的按钮，
    // 每点一次就把上一段对话从磁盘上抹掉 —— 用户看到的"历史对话数量不对/新对话之后
    // 老对话不见了"就是这个。要删某段历史请走 /session/delete（历史面板里的「删除」）。
    const id = safeSessionId(body.sessionId || 'default')
    const session = sessionFor(id)
    session.messages = [{ role: 'system', content: SYSTEM_PROMPT }]
    session.summary = ''
    session.pending = null
    session.toolTally = {}
    session.grants = []
    saveSession(session)
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
    trace('SSE close，writableEnded=' + res.writableEnded)
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
    onPlan: (items, summary) => send({ type: 'plan', items, summary }),
    onSteer: info => send({ type: 'steer', ...info }),
    onSystem: info => send({ type: 'system', ...info })
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
    // 哪些路由跑 SSE：前端界面只认一条事件流 —— 审批之后的续跑跟正常一轮必须是同一条通道，
    // 否则确认之后那一段（工具卡片、思考、提示、正文）在界面上根本没有来源，只能靠一个最终结果
    // 一次性落下来：用户看到的就是"点了确认之后顺序乱了/中间没了"。
    const STREAM_ROUTES = { '/chat/stream': '/chat', '/approve/stream': '/approve', '/reject/stream': '/reject' }
    if (STREAM_ROUTES[pathname]) {
      const events = startStream(res, req, pathname)
      let finished = false
      const close = () => { if (!finished) { finished = true; try { res.end() } catch { /* 已关闭 */ } } }
      try {
        const result = await handle(STREAM_ROUTES[pathname], body, events)
        events.send({ type: 'result', ...result })
      } catch (error) {
        events.send({ type: 'error', error: error.message })
      }
      return close()
    }
    sendJson(res, 200, { ok: true, ...(await handle(pathname, body)) })
  } catch (error) {
    if (!res.headersSent) {
      // 出错时也要把"没赶上的引导"交回前端（铁律㊷：收下 ≠ 送到，拿不到回执就得如实退回）
      const extra = error && Array.isArray(error.undeliveredSteer) && error.undeliveredSteer.length
        ? { undeliveredSteer: error.undeliveredSteer }
        : {}
      sendJson(res, 400, { ok: false, error: error.message, ...extra })
    }
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

/**
 * 宿主**静默死亡**是这个插件最难查的一类故障：面板那边只表现为"请求永远不回"，
 * 而进程已经没了、控制台又不会说为什么。用户实测踩到过：确认 click_element 之后
 * 宿主把活干完（会话文件都落盘了）就消失了，于是 /approve 的响应永远发不出去，
 * 卡片不消失、聊天也不继续。
 * 所以这两类错误一律：① 落盘到 <配置目录>/host-crash.log，事后能查；② **不让进程退出** ——
 * 一个请求出问题不该把整个宿主带走，否则用户只能重启编辑器。
 */
function logHostCrash(kind, error) {
  const detail = (error && (error.stack || error.message)) || String(error)
  try {
    fs.appendFileSync(path.join(CONFIG_DIR, 'host-crash.log'), '[' + new Date().toISOString() + '] ' + kind + ': ' + detail + '\n', 'utf8')
  } catch (e) { /* 记不下来也不能因此再炸一次 */ }
  process.stderr.write('[danjuan-ai] ' + kind + '（已记入 host-crash.log，进程继续）: ' + ((error && error.message) || error) + '\n')
}
process.on('uncaughtException', error => logHostCrash('未捕获异常', error))
process.on('unhandledRejection', reason => logHostCrash('未处理的 Promise 拒绝', reason))
