'use strict'

/**
 * 上下文计量与压缩规格（对齐 DeepSeek Harness 的 dsh-token-meter / dsh-compaction-basic）
 *
 * 为什么要有这个模块（真实故障）：
 *   之前用的是「字符预算 240000」——既不是 token，也不是模型真实窗口：
 *   · 官方给的上下文长度是 1M token，而我们按 24 万**字符**判断，按中文 0.6 token/字折算
 *     才 14 万 token，只用了窗口的 14%，于是长期过早压缩、白白丢失上下文；
 *   · 面板上显示「240k/240k」是字符数，用户根本对不上真实用量；
 *   · 工具 schema（35 个工具的完整 JSON）从来没算进上下文，实际占用被系统性低估。
 *   所以把「窗口 / 阈值 / 保留 / 估算」集中成这一处事实源，别处不要再自己算。
 *
 * 换算口径来自官方「Token 用量计算」页：1 个中文字符 ≈ 0.6 token，1 个英文字符 ≈ 0.3 token。
 * 每条消息、每个内容块各 +4 的结构开销沿用 DSH token-meter 的固定启发式。
 * 估算终究是估算，所以另外提供「真实用量锚点」：上游返回的 prompt_tokens 是权威值，
 * 用它加增量估算，面板与阈值判定就能贴着真实值走。
 */

/** 官方换算：中文（CJK）字符消耗的 token 数 */
const CJK_TOKENS_PER_CHAR = 0.6
/** 官方换算：其余字符（英文/数字/符号/空白）消耗的 token 数 */
const LATIN_TOKENS_PER_CHAR = 0.3
/** 单个内容块的结构开销（JSON 框架与类型标签） */
const BLOCK_OVERHEAD = 4
/** 单条消息的角色框架开销 */
const MESSAGE_OVERHEAD = 4

/** DeepSeek 官方模型页公布的上下文长度：1M token（deepseek-flash / v4-pro 同） */
const DEFAULT_CONTEXT_WINDOW = 1000000
/** 触发压缩的窗口占比，对齐 DSH compaction-basic 的 DEFAULT_THRESHOLD_RATIO */
const DEFAULT_THRESHOLD_RATIO = 0.8
/** 压缩后原样保留的最近窗口占比，对齐 DSH 的 DEFAULT_RETAIN_RATIO */
const DEFAULT_RETAIN_RATIO = 0.16
/** 无论 token 预算怎么算，至少原样保留这么多条最近消息（原文比摘要可靠） */
const DEFAULT_MIN_KEEP_MESSAGES = 16
/** 长工具结果的头尾保留预算，对齐 DSH tool-result-pruner 的默认值 */
const DEFAULT_PRUNE = { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
/** 中段被裁掉时插入的标记（模型据此知道中间还有内容，需要时可重新取） */
const PRUNE_MARKER = '\n\n[... 工具结果中段已裁剪以节省上下文 ...]\n\n'

/** CJK 与全角标点：汉字、假名、谚文、CJK 扩展、全角符号 */
const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

/**
 * 估算一段文本的 token 数。
 * 文本按代码点遍历（不拆代理对），CJK 与西文分别按官方口径计费。
 */
function estimateText(text) {
  const value = text === undefined || text === null ? '' : String(text)
  if (!value) return 0
  let cjk = 0
  let total = 0
  for (const char of value) {
    total++
    if (CJK_RE.test(char)) cjk++
  }
  const latin = total - cjk
  return Math.ceil(cjk * CJK_TOKENS_PER_CHAR + latin * LATIN_TOKENS_PER_CHAR)
}

// 消息对象一旦入历史就不再修改，用 WeakMap 缓存估算结果：
// 否则每次取上下文刻度都要把几十万字重新扫一遍（面板每秒都在问）。
const cache = new WeakMap()

/** 估算单条消息的 token 数（含角色框架、tool_calls 与思考内容） */
function estimateMessage(message) {
  if (!message || typeof message !== 'object') return 0
  const hit = cache.get(message)
  if (hit !== undefined) return hit
  let tokens = MESSAGE_OVERHEAD + estimateText(message.content)
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    tokens += estimateText(JSON.stringify(message.tool_calls))
  }
  if (message.reasoning_content) tokens += estimateText(message.reasoning_content)
  tokens += BLOCK_OVERHEAD
  cache.set(message, tokens)
  return tokens
}

/** 估算一组消息的 token 数 */
function estimateMessages(messages) {
  let tokens = 0
  for (const message of Array.isArray(messages) ? messages : []) tokens += estimateMessage(message)
  return tokens
}

/**
 * 估算工具 schema 的 token 数。
 * 工具描述是中文、参数名是英文，混排时按文本密度逐字计费才准；
 * tools 数组本身不会变，所以同样缓存（调用方应复用同一个数组实例）。
 */
const toolsCache = new WeakMap()
function estimateTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return 0
  const hit = toolsCache.get(tools)
  if (hit !== undefined) return hit
  let text = ''
  try {
    text = JSON.stringify(tools)
  } catch {
    text = ''
  }
  const tokens = estimateText(text) + BLOCK_OVERHEAD
  toolsCache.set(tools, tokens)
  return tokens
}

/**
 * 当前上下文的 token 占用。
 *
 * anchor 是「真实用量锚点」：{ messageCount, promptTokens }，来自上一次上游返回的
 * prompt_tokens（那是权威计数，含 system、tools 与全部消息）。锚点之后新增的消息用估算补上，
 * 这样既不用自己实现分词器，也不会让估算误差随对话长度累积。
 */
function measure(messages, options) {
  const list = Array.isArray(messages) ? messages : []
  const opts = options || {}
  const anchor = opts.anchor
  if (anchor && Number.isInteger(anchor.messageCount) && Number.isInteger(anchor.promptTokens)
    && anchor.messageCount >= 0 && anchor.messageCount <= list.length && anchor.messageCount >= 1) {
    let tokens = anchor.promptTokens
    for (let index = anchor.messageCount; index < list.length; index++) tokens += estimateMessage(list[index])
    return { tokens, calibrated: true, messagesTokens: tokens, toolsTokens: anchor.toolsTokens || 0 }
  }
  const messagesTokens = estimateMessages(list)
  const toolsTokens = estimateTools(opts.tools)
  return { tokens: messagesTokens + toolsTokens, calibrated: false, messagesTokens, toolsTokens }
}

/** 把窗口占比换算成具体 token 预算（对齐 DSH resolveCompactSpec） */
function resolveSpec(options) {
  const opts = options || {}
  const contextWindow = Number(opts.contextWindow) > 0 ? Math.floor(Number(opts.contextWindow)) : DEFAULT_CONTEXT_WINDOW
  const thresholdRatio = clampRatio(opts.thresholdRatio, DEFAULT_THRESHOLD_RATIO)
  const retainRatio = clampRatio(opts.retainRatio, DEFAULT_RETAIN_RATIO)
  const thresholdTokens = Math.floor(contextWindow * thresholdRatio)
  const retainTokens = Math.floor(contextWindow * Math.min(retainRatio, thresholdRatio))
  const minKeepMessages = Number(opts.minKeepMessages) >= 1 ? Math.floor(Number(opts.minKeepMessages)) : DEFAULT_MIN_KEEP_MESSAGES
  return { contextWindow, thresholdRatio, retainRatio, thresholdTokens, retainTokens, minKeepMessages }
}

function clampRatio(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number > 1) return fallback
  return number
}

/**
 * 选择压缩的保留范围起点：从尾部往前累积 token 直到达到 retainTokens
 * （对齐 DSH selectCompactableRange），再与「至少保留 N 条最近消息」取更保守的一侧。
 * 返回的 index 表示「从这个下标起原样保留」，即 [1, index-1] 是要折叠的部分。
 * system（下标 0）永远不折叠；没有可折叠内容时返回 1。
 */
function selectStartIndex(messages, retainTokens, options) {
  const list = Array.isArray(messages) ? messages : []
  const opts = options || {}
  const minKeep = Number(opts.minKeepMessages) >= 1 ? Math.floor(Number(opts.minKeepMessages)) : DEFAULT_MIN_KEEP_MESSAGES
  if (list.length <= 1) return 1
  let accumulated = 0
  let index = list.length
  for (let cursor = list.length - 1; cursor >= 1; cursor--) {
    accumulated += estimateMessage(list[cursor])
    index = cursor
    if (accumulated >= retainTokens) break
  }
  const byCount = Math.max(1, list.length - minKeep)
  const start = Math.max(1, Math.min(index, byCount))
  // 条数下限只是「尽量多留原文」的偏好。若它让保留部分本身就超过窗口阈值，
  // 这次压缩就白做了（压完还是超）——此时以 token 预算为准，收紧到纯预算切点。
  const thresholdTokens = Number(opts.thresholdTokens) > 0 ? Math.floor(Number(opts.thresholdTokens)) : 0
  if (thresholdTokens > 0 && start < index) {
    let kept = 0
    for (let cursor = start; cursor < list.length; cursor++) kept += estimateMessage(list[cursor])
    if (kept > thresholdTokens) return Math.max(1, index)
  }
  return start
}

/**
 * 第一级压缩：确定性修剪历史里的超长工具结果（不调模型、零成本、结果可复现）。
 * 对齐 DSH 的 tool-result-pruner：保留头部与尾部，中段替换成标记。
 * 尾部很重要——报错原文、命令输出结论往往在末尾，只留头会丢掉最关键的几行。
 * 只动 role==='tool' 的消息，且只动超预算的；返回新的消息数组与节省量。
 */
function pruneToolResults(messages, options) {
  const list = Array.isArray(messages) ? messages : []
  const opts = options || {}
  const thresholdChars = Number(opts.thresholdChars) > 0 ? Math.floor(Number(opts.thresholdChars)) : DEFAULT_PRUNE.thresholdChars
  const headChars = Number(opts.headChars) >= 0 ? Math.floor(Number(opts.headChars)) : DEFAULT_PRUNE.headChars
  const tailChars = Number(opts.tailChars) >= 0 ? Math.floor(Number(opts.tailChars)) : DEFAULT_PRUNE.tailChars
  const out = []
  const pruned = []
  let savedTokens = 0
  for (const message of list) {
    if (!message || message.role !== 'tool' || typeof message.content !== 'string') { out.push(message); continue }
    const points = Array.from(message.content)
    if (points.length <= thresholdChars) { out.push(message); continue }
    const text = points.slice(0, headChars).join('') + PRUNE_MARKER + points.slice(Math.max(headChars, points.length - tailChars)).join('')
    const next = Object.assign({}, message, { content: text })
    out.push(next)
    pruned.push({ toolCallId: message.tool_call_id || '', charsBefore: points.length, charsAfter: text.length })
    savedTokens += estimateMessage(message) - estimateMessage(next)
  }
  return { messages: out, pruned, savedTokens }
}

/**
 * 该不该压缩。工具 schema 是每次请求都必须带的固定开销，压不掉——若它本身就超过阈值
 * （工具很多时会发生），压缩对话只会白跑一趟，此时明确拒绝而不是空转。
 */
function shouldCompact(input) {
  const data = input || {}
  const tokens = Number(data.tokens) || 0
  const toolsTokens = Number(data.toolsTokens) || 0
  const thresholdTokens = Number(data.thresholdTokens) || 0
  if (toolsTokens >= thresholdTokens) return { compact: false, reason: 'fixed-overhead' }
  if (tokens < thresholdTokens) return { compact: false, reason: 'below-threshold' }
  return { compact: true, reason: 'over-threshold' }
}

/** 人类可读的 token 数：1000000 → 1M，320000 → 320k */
function formatTokens(value) {
  const number = Math.max(0, Math.round(Number(value) || 0))
  if (number >= 1000000) return trimZero((number / 1000000).toFixed(number % 1000000 === 0 ? 0 : 1)) + 'M'
  if (number >= 1000) return trimZero((number / 1000).toFixed(number >= 100000 ? 0 : 1)) + 'k'
  return String(number)
}

function trimZero(text) {
  return text.replace(/\.0$/, '')
}

module.exports = {
  CJK_TOKENS_PER_CHAR,
  LATIN_TOKENS_PER_CHAR,
  BLOCK_OVERHEAD,
  MESSAGE_OVERHEAD,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_THRESHOLD_RATIO,
  DEFAULT_RETAIN_RATIO,
  DEFAULT_MIN_KEEP_MESSAGES,
  DEFAULT_PRUNE,
  PRUNE_MARKER,
  estimateText,
  estimateMessage,
  estimateMessages,
  estimateTools,
  measure,
  resolveSpec,
  selectStartIndex,
  shouldCompact,
  pruneToolResults,
  formatTokens
}
