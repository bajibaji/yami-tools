#!/usr/bin/env node
'use strict'

/**
 * Yami MCP Server — 资源文件读写与校验（规则二：数据文件层）
 *
 * 架构定位（路线 C：纯文件层为主，预留 CDP 扩展）：
 *  - 本 server 直接读写游戏工程的明文 JSON 资源（.event/.scene/.ui/.trigger/.actor/.tile/.anim 等 + Data/*.json），
 *    与编辑器"文件驱动 + 聚焦重扫"机制天然兼容：MCP 写入后，编辑器窗口聚焦即自动刷新（dirchange）。
 *  - 引擎解析规则（GUID 命名、文件 schema、引用完整性）由《Yami引擎编写规则.md》第二部提炼。
 *  - CDP 扩展（路线 B）预留：tools/cdp_eval 骨架 + 环境变量 YAMI_MCP_CDP_PORT，未来可通过
 *    --remote-debugging-port 连接编辑器渲染进程调用其内部 API（Data/File/PluginManager）。
 *
 * 传输：MCP stdio（每行一条 JSON-RPC 2.0 消息，换行分隔）。
 * 项目根解析优先级：--root <path> 参数 > YAMI_PROJECT_ROOT 环境变量 > 当前工作目录探测。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DatabaseManager = require('./modules/db-manager')
const EventBuilder = require('./modules/event-builder')
const CdpClient = require('./modules/cdp-client')
const RuntimeBridge = require('./modules/runtime-bridge')
const EditorBridge = require('./modules/editor-bridge')
const rle = require('./modules/rle')
const { resolveInside, relativePath, sha256, writeAtomic, restoreBackup, listBackups } = require('./modules/file-ops')
const { unifiedDiff } = require('./modules/diff')
const { snapshotProject, diffSnapshot, buildChangelog } = require('./modules/changelog')
const { normalizeTodos, summarizeTodos, validateTransition, renderTodos } = require('./modules/todos')

const VERSION = '0.2.0'
const PROTOCOL_VERSION = '2024-11-05'

/* ============================== 项目根探测 ============================== */

function resolveRoot() {
  const argIdx = process.argv.indexOf('--root')
  if (argIdx !== -1 && process.argv[argIdx + 1]) return path.resolve(process.argv[argIdx + 1])
  if (process.env.YAMI_PROJECT_ROOT) return path.resolve(process.env.YAMI_PROJECT_ROOT)
  // 从 cwd 向上遍历，找 game.yamirpg（或同时存在 Assets+Data 的目录）作为项目根
  let dir = process.cwd()
  for (;;) {
    if (fs.existsSync(path.join(dir, 'game.yamirpg')) || (fs.existsSync(path.join(dir, 'Assets')) && fs.existsSync(path.join(dir, 'Data')))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

const ROOT = resolveRoot()

/**
 * 受限模式：由插件内置 Agent Host（ai-host.js）启动时置 1。
 * 定位是"防呆"而非安全边界——内置大模型不得自行解除上下文保护的旁路开关，
 * read_resource 的 forceFull 只留给外部 MCP 客户端人工使用。
 */
const GUARDED = process.env.YAMI_MCP_GUARDED === '1'

/**
 * 操作风险分级：给审批卡片用。
 *   low     只读或可忽略
 *   medium  写盘（有备份、可回滚）
 *   high    删除、批量替换、落盘发布这类不可轻易撤销的动作 → 需要二次确认令牌
 */
const HIGH_RISK_TOOLS = new Set(['delete_resource'])
const MEDIUM_RISK_TOOLS = new Set([
  'write_resource', 'write_script', 'edit_script', 'create_script',
  'patch_resource', 'append_event_commands', 'upsert_database_item'
])
function riskOf(tool) {
  if (HIGH_RISK_TOOLS.has(tool)) return 'high'
  if (MEDIUM_RISK_TOOLS.has(tool)) return 'medium'
  return 'low'
}

/**
 * 二次确认令牌：高危操作的 dryRun 预览会发一个一次性令牌，
 * 正式执行必须原样带回，避免"预览的内容和用户确认的不是同一份"（也挡住误触/重放）。
 */
const confirmationTokens = new Map()
const CONFIRM_TOKEN_TTL = 5 * 60 * 1000
function issueConfirmationToken(tool, rel, oldSha) {
  const token = crypto.randomBytes(12).toString('hex')
  confirmationTokens.set(token, { tool, path: rel, oldSha, at: Date.now() })
  for (const [key, value] of confirmationTokens) {
    if (Date.now() - value.at > CONFIRM_TOKEN_TTL) confirmationTokens.delete(key)
  }
  return token
}
function takeConfirmationToken(token, tool, rel) {
  const entry = confirmationTokens.get(String(token || ''))
  if (!entry) return { ok: false, error: '确认令牌无效或已过期，请重新预览一次' }
  confirmationTokens.delete(token)
  if (Date.now() - entry.at > CONFIRM_TOKEN_TTL) return { ok: false, error: '确认令牌已过期，请重新预览一次' }
  if (entry.tool !== tool) return { ok: false, error: '确认令牌与当前操作不匹配，请重新预览' }
  if (rel && entry.path !== rel) return { ok: false, error: '确认令牌对应的文件已变化，请重新预览' }
  return { ok: true, entry }
}

/** 组装审批用的差异预览（写盘类工具统一走这里） */
function withDiff(preview, oldText, newText, options = {}) {
  const diff = unifiedDiff(oldText, newText, { label: options.label || '' })
  return {
    ...preview,
    risk: options.risk || 'medium',
    diff: diff.text,
    diffStat: { added: diff.added, removed: diff.removed, truncated: diff.truncated },
    ...(options.impact ? { impact: options.impact } : {})
  }
}

/**
 * 候选 Open Yami 编辑器安装根目录（不写死盘符，跨平台可用）：
 *   1. YAMI_ENGINE_ROOT 环境变量（Agent Host 或外部客户端可显式指定）；
 *   2. 可执行文件同层（编辑器内 ELECTRON_RUN_AS_NODE 启动时，process.execPath 即编辑器本体）；
 *   3. Windows 默认安装位置（保留原有行为，仅作为兜底）；
 *   4. 源码仓库并列目录（开发者在本机跑源码时）。
 */
function candidateEngineRoots() {
  const roots = []
  if (process.env.YAMI_ENGINE_ROOT) roots.push(process.env.YAMI_ENGINE_ROOT)
  if (process.execPath) roots.push(path.dirname(process.execPath))
  // 插件装在 <引擎根>/extension/<插件名>/runtime/yami-mcp 下：往上四级正好是引擎根。
  // 旧实现写成往上三级再拼字符串 '2'，只有目录恰好叫 "2" 时才碰巧成立——Linux 源码版
  // 就是被这行坑掉的：引擎根永远找不到，编译门禁整体失效（详见铁律㊲）。
  roots.push(path.resolve(__dirname, '..', '..', '..', '..'))
  // 打包版可能少一层（<安装目录>/resources/app/extension/...），多给一个候选不亏
  roots.push(path.resolve(__dirname, '..', '..', '..'))
  roots.push('D:\\Program Files\\Open Yami RPG Editor')
  return roots.filter(Boolean)
}

const cdpClient = new CdpClient()
const dbManager = new DatabaseManager(ROOT, () => generateGuid())
const eventBuilder = new EventBuilder(ROOT)
const runtimeBridge = new RuntimeBridge(5966, cdpClient)
const editorBridge = new EditorBridge(5967)

/* ============================== 变更小结的运行时状态 ============================== */
// 基线快照与待办清单：按 sessionId 分桶隔离，避免跨会话污染与相互冲刷（写入历史不分桶：它记的是这个工程最近被谁改过，与对话无关）
const sessionBaselines = new Map()
const sessionTodos = new Map()
// 每个会话"上次报告改动清单"的时间：只报这之后发生的写入，避免同一批文件被反复列出来
const sessionReportedAt = new Map()
// 本轮写入记录（工具名、是否通过编译、是否被回滚），供小结标注"谁改的、编译过没过"
const recentWrites = []
const RECENT_WRITES_MAX = 200
let lastPlaytest = null

function getSessionKey(args) {
  return String((args && args.sessionId) || 'default')
}

/** 从编译器输出里取第一条报错（给变更小结用） */
function firstCompileError(compile) {
  const output = String((compile && compile.output) || '')
  const line = output.split('\n').map(text => text.trim()).find(text => text.includes('error TS')) || ''
  return line.slice(0, 200)
}

function rememberWrite(entry) {
  if (!entry || !entry.path) return
  if (!entry.at) entry.at = Date.now()
  recentWrites.push(entry)
  if (recentWrites.length > RECENT_WRITES_MAX) recentWrites.splice(0, recentWrites.length - RECENT_WRITES_MAX)
}

/* ============================== 类型与规则 ============================== */

/** 扩展名 → 资源类型（编辑器 file/folder-item.js extnameToTypeMap 子集，数据文件层） */
const TYPE_BY_EXT = {
  '.event': 'event', '.scene': 'scene', '.ui': 'ui', '.trigger': 'trigger',
  '.actor': 'actor', '.tile': 'tileset', '.anim': 'animation', '.particle': 'particle',
  '.skill': 'skill', '.item': 'item', '.equip': 'equipment', '.state': 'state',
  '.ts': 'script', '.js': 'script', '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.webp': 'image', '.cur': 'image', '.mp3': 'audio', '.m4a': 'audio', '.ogg': 'audio',
  '.wav': 'audio', '.flac': 'audio', '.mp4': 'video', '.mkv': 'video', '.webm': 'video',
  '.ttf': 'font', '.otf': 'font', '.woff': 'font', '.woff2': 'font'
}

/** 数据文件类型（可读写的 JSON 资源） */
const DATA_TYPES = ['event', 'scene', 'ui', 'trigger', 'actor', 'tileset', 'animation', 'particle', 'skill', 'item', 'equipment', 'state']

/** 文件名内嵌 16 位 hex GUID 正则（同引擎 data-object.js parseGUID） */
const GUID_IN_NAME = /(?<=\.)[0-9a-f]{16}(?=\.\S+$)/

function parseGuidFromName(name) {
  const m = GUID_IN_NAME.exec(name)
  return m ? m[0] : null
}

function isValidGuid(g) {
  return typeof g === 'string' && /^[0-9a-f]{16}$/.test(g) && /[a-f]/.test(g)
}

/**
 * 各数据类型的必需字段（schema 校验用）。
 * 【规则实据】这份表是把工程里**每一种资源的每个实例**都读一遍、取「100% 出现的顶层字段」得到的
 * （实测样本：event 90 / ui 16 / animation 62 / scene 7 / tileset 6 / particle 35 / skill 69 /
 *  trigger 53 / item 20 / state 18 / equipment 54 / actor 63）。
 * 旧表有几处与真实资源不符，会冤枉合法文件：
 *   · skill/item/equipment/state 被要求有 name —— 真实资源**根本没有 name 字段**（名字来自文件名）；
 *   · tileset 被要求有 image —— 6 个真实图集里只有 4 个有 image（新建空图集没有）；
 *   · particle 被要求有 sprites —— 真实粒子只有 layers。
 * 少列比多列安全：这里的定位是「拦下必然装不上的文件」，不是复刻引擎的字段表。
 */
const REQUIRED_FIELDS = {
  event: ['type', 'enabled', 'commands'],
  scene: ['width', 'height', 'tileWidth', 'tileHeight', 'ambient', 'objects'],
  ui: ['width', 'height', 'nodes'],
  trigger: ['shape', 'events'],
  actor: ['sprites', 'attributes'],
  tileset: ['width', 'height', 'tileWidth', 'tileHeight'],
  animation: ['sprites', 'motions'],
  particle: ['layers'],
  skill: ['icon', 'events'],
  item: ['icon', 'events'],
  equipment: ['icon', 'events'],
  state: ['icon', 'events']
}

/* ============================== 规则一：脚本元数据（复刻引擎 plugin.js parseMeta 规则） ============================== */

const META_SELECTOR = /\/\*\s*@plugin\s[\s\S]+?(?=\*\/)/
// 标签只在**行首**出现：` * @number x`（CRLF / LF 都要认）。
// 引擎自己的写法是 (?=\s@|$)，但这在 CRLF 文件上行不通 —— 
// '*' 既不是 @ 也不是 \s，正则在这里匹配失败，于是整个元数据块被当成**一个**匹配，
// 结果只有第一个标签被处理、后面的参数全部不存在（实测：把工程文件存成 LF 就能复现）。
// 只在行首认标签还顺带修掉另一件事：@lang 块里的正文如果提到 @xxx，不再被当成标签。
// 工具侧用的**严格**版：标签只在行首（` * @number x`）才算数。
// 为什么不能用引擎那条正则：它的前瞻是 (?=\s@|$)，而注释续行的 ' * ' 里 '*' 既不是 @ 也不是 \s，
// 于是在 CRLF 文件里前瞻永远不成立 —— 整个元数据块被当成**一个**匹配，
// 结果只有第一个标签被处理、后面全部丢失，连 @version 都会粘进 @plugin 的值里（实测踩过）。
const META_STATEMENT = /@([a-z\-\[\]]+)((?:[ \t]*\r?\n[ \t]*\*)?[\s\S]*?)(?=\r?\n[ \t]*\*[ \t]*@|$)/g
// 引擎同款的**宽松**版（plugin.ts:362 原样），只给体检用：
// 它会把 ' * @clamp 1 10' 这种续行当成新标签，正好是体检要暴露的东西 ——
// 引擎真的会把它算成一个参数（key 就是 '1 10'），所以我们的报错不是误报。
const META_STATEMENT_LOOSE = /@([a-z\-\[\]]+)([\s\S]*?)(?=\s@|$)/g

/** 段内容清洗：去掉注释每行的 ' * ' 前缀，压成一行 */
function metaStatementContent(raw) {
  return String(raw || '')
    .replace(/^[ \t]*[*]/, ' ')
    .split(/\r?\n/)
    .map(line => line.replace(/^[ \t]*[*][ \t]?/, ''))
    .join(' ')
    .trim()
}
const META_OPTION = /^(.+?)\{([\s\S]+?)\}$/
const META_LANG_NAME = /^([a-zA-Z\-]+)(?:\s+extends\s+([a-zA-Z\-]+))?/
const META_LANG_PROP = /(#\S+)\s+([\s\S]+?)(?=\s+#|$)/g

// 元数据**标签**白名单：逐条对照引擎 PluginManager.parseMeta 的 processors 表（plugin.ts:1120-1181）。
// 刻意把两件事分开（旧版混成一个数组，埋了两个坑）：
//   · group / group[] 是标签不是参数类型 —— 引擎把 group[] 收成一个 type='repeatable-group' 的参数；
//   · repeatable-group 才是引擎真正落盘的类型（type-registry.ts 同名注册），旧版没列它，
//     于是带 repeatable-group 的元数据被解析器当未知标签**静默丢掉**。
const COMMA_SEP = /\s*,\s*/
const META_TAGS = ['plugin', 'author', 'link', 'version', 'deprecated', 'require', 'boolean', 'number', 'variable-number', 'string', 'number[]', 'string[]', 'keycode', 'color', 'option', 'easing', 'team', 'variable', 'attribute', 'attribute-key', 'attribute-group', 'enum', 'enum-value', 'enum-group', 'actor', 'region', 'light', 'animation', 'particle', 'parallax', 'tilemap', 'element', 'element-id', 'file', 'variable-getter', 'variable-setter', 'actor-getter', 'skill-getter', 'state-getter', 'equipment-getter', 'item-getter', 'element-getter', 'position-getter', 'clamp', 'decimals', 'placeholder', 'default', 'alias', 'desc', 'suffix', 'prefix', 'readonly', 'hidden', 'validate', 'cond', 'lang', 'group', 'group[]', 'repeatable-group']
// 会产生一个参数值的标签（引擎 processors 里走 setParameter / setNumber / setOption / setAttribute / setEnum / setFile 的那批）
const PARAM_TYPES = ['boolean', 'number', 'variable-number', 'string', 'number[]', 'string[]', 'keycode', 'color', 'option', 'easing', 'team', 'variable', 'attribute', 'attribute-key', 'attribute-group', 'enum', 'enum-value', 'enum-group', 'actor', 'region', 'light', 'animation', 'particle', 'parallax', 'tilemap', 'element', 'element-id', 'file', 'variable-getter', 'variable-setter', 'actor-getter', 'skill-getter', 'state-getter', 'equipment-getter', 'item-getter', 'element-getter', 'position-getter', 'repeatable-group', 'group', 'group[]']
// 只对某些类型生效的修饰标签：对照引擎各 setXxx 里的 switch(parameter.type) 守卫（plugin.ts:638-783）
const MODIFIER_TYPES = {
  clamp: ['number', 'variable-number'],
  decimals: ['number', 'variable-number'],
  placeholder: ['string', 'number', 'variable-number']
}
const PARAM_MODIFIERS = ['alias', 'desc', 'default', 'filter', 'clamp', 'decimals', 'cond', 'placeholder', 'suffix', 'prefix', 'readonly', 'hidden', 'validate']
const OVERVIEW_TAGS = ['plugin', 'version', 'author', 'link', 'desc', 'deprecated', 'require']

/** 解析 .ts 源码中的 /* @plugin *\/ 元数据注释块（规则一 DSL） */
/** 解析 .ts 源码的 /* @plugin *\/ 元数据块（tags 口径逐条对照引擎 plugin.ts:1120-1181 的 processors 表） */
/** 取引号里的字符串：引擎 parseString 的口径（plugin.ts:422-430），不是引号包裹就返回 null */
function unquoteText(value) {
  const text = String(value == null ? '' : value)
  if (text.length < 2) return null
  const head = text[0]
  const foot = text[text.length - 1]
  const quoted = (head === String.fromCharCode(39) && foot === String.fromCharCode(39)) || (head === String.fromCharCode(34) && foot === String.fromCharCode(34))
  return quoted ? text.slice(1, -1) : null
}
function parsePluginMeta(code) {
  const m = META_SELECTOR.exec(code)
  if (!m) return { ok: false, error: '未找到 /* @plugin ... */ 元数据注释块' }
  const out = { ok: true, raw: m[0], overview: {}, parameters: [], langMap: {} }
  let current = null
  META_STATEMENT.lastIndex = 0
  let st
  while ((st = META_STATEMENT.exec(m[0])) !== null) {
    const tag = st[1]
    const content = metaStatementContent(st[2])
    // 概览标签（@plugin/@version/@author/@link/@desc/@deprecated/@require）在引擎里各走各的 setter，
    // 只有走 setParameter/setNumber/setOption/setAttribute/setEnum/setFile 的标签才产生参数（plugin.ts:1127-1154）。
    if (OVERVIEW_TAGS.includes(tag)) {
      if (tag === 'require') (out.overview.requires = out.overview.requires || []).push(content)
      else out.overview[tag] = content
      continue
    }
    if (tag === 'lang') {
      const ln = META_LANG_NAME.exec(content)
      if (ln) {
        const lang = { name: ln[1], extends: ln[2] || null, props: {} }
        META_LANG_PROP.lastIndex = 0
        let lp
        while ((lp = META_LANG_PROP.exec(content)) !== null) lang.props[lp[1]] = lp[2].trim()
        out.langMap[ln[1]] = lang
      }
      continue
    }
    if (PARAM_TYPES.includes(tag)) {
      current = { key: content, type: tag }
      if (tag === 'option') {
        const om = META_OPTION.exec(content)
        if (om) {
          current.key = om[1].trim()
          // 选项值要**去掉引号**：引擎解析 @option 时走 parseString，参数值就是不带引号的 'a'；
          // 留着引号的话，跟 @default 的引号值比较会永远不相等（实测：生成器自己的模板被判成非法）。
          current.options = om[2].split(COMMA_SEP).map(s => { const unquoted = unquoteText(s.trim()); return unquoted === null ? s.trim() : unquoted })
        }
      }
      if (tag === 'group' || tag === 'group[]') current = null
      if (current) out.parameters.push(current)
      continue
    }
    // @alias / @default / @clamp ... 是修饰标签：挂到当前参数上；没有当前参数时按引擎的 setDesc 特例处理
    if (PARAM_MODIFIERS.includes(tag)) {
      if (current) current[tag] = content
      else if (tag === 'desc') out.overview.desc = content
    }
  }
  return out
}

/** 过滤器白名单：逐条抄引擎（fileFilters / attrFilters / enumFilters，plugin.ts:676-722） */
const FILE_FILTERS = ['actor', 'skill', 'trigger', 'item', 'equipment', 'state', 'event', 'scene', 'tileset', 'ui', 'animation', 'particle', 'image', 'audio', 'video', 'script', 'font', 'other']
const ATTR_FILTERS = ['actor', 'skill', 'state', 'item', 'equipment', 'element']
const ENUM_FILTERS = ['shortcut-key', 'cooldown-key', 'equipment-slot', 'global-event', 'scene-event', 'actor-event', 'skill-event', 'state-event', 'equipment-event', 'item-event', 'region-event', 'light-event', 'animation-event', 'particle-event', 'parallax-event', 'tilemap-event', 'element-event']


/**
 * 按引擎的 @default 解析规则把文本还原成值（plugin.ts:496-520）：
 * 解析不出来就是 null —— 引擎认定这个 default 不合法，会退回该类型的初始值。
 */
function parseDefaultByType(type, raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return null
  const num = value => { const n = parseFloat(value); return isNaN(n) ? null : n }
  const bool = value => (value === 'true' ? true : value === 'false' ? false : null)
  switch (type) {
    case 'boolean': return bool(text)
    case 'number':
    case 'variable-number': return num(text)
    case 'string':
    case 'keycode': return unquoteText(text)
    case 'color': return /^[0-9a-f]{8}$/.test(text) ? text : null
    case 'number[]': {
      if (text[0] !== '[' || text[text.length - 1] !== ']') return null
      const list = []
      for (const slice of text.slice(1, -1).split(COMMA_SEP)) { const n = num(slice); if (n !== null) list.push(n) }
      return list
    }
    case 'string[]': {
      if (text[0] !== '[' || text[text.length - 1] !== ']') return null
      const list = []
      const quoted = /(?:[\u0027][^\u0027]*[\u0027]|"[^"]")(?=\s*,?)/g
      let hit
      while ((hit = quoted.exec(text)) !== null) { const v = unquoteText(hit[0]); if (v !== null) list.push(v) }
      return list
    }
    default: {
      const asString = unquoteText(text)
      if (asString !== null) return asString
      const asNumber = num(text)
      if (asNumber !== null) return asNumber
      return bool(text)
    }
  }
}
/**
 * 元数据体检：判定口径全部对着引擎源码（plugin.ts / type-registry.ts），注释里给行号 —— 改规则前先回去看引擎。
 * 严重度：error = 写了等于白写或装配必失败；warn = 引擎容忍但有坑。
 */
function validatePluginMeta(meta, code) {
  const issues = []
  const text = String(code || "")
  const metaBlock = String((meta && meta.raw) || "")
  // ① 块外残留 @标签：引擎只在 /* @plugin ... */ 里找标签（selector.exec(code)，plugin.ts:1200），块外一律不存在
  const outside = text.replace(new RegExp('/[*][\\s\\S]*?[*]/', 'g'), '')
  if (/@[a-z][a-z\-\[\]]*/.test(outside)) {
    issues.push({ severity: 'error', code: 'tags-outside-block', message: '有 @ 标签写在元数据注释块外面：引擎只在块内解析（plugin.ts:1200），块外的一律不存在' })
  }
  // ② 参数 key 不合法：引擎的 key 就是标签后面那段文本，带空格或 # 的 key 在检视器里是垃圾值
  for (const p of meta.parameters || []) {
    if (!/^[A-Za-z_$][\w$]*$/.test(String(p.key || ''))) {
      issues.push({ severity: 'error', code: 'bad-key', target: p.key, message: '参数 key 不合法：「' + p.key + '」—— 引擎把标签后那一段原样当 key（plugin.ts:549），含空格 / # / 中文都会变成检视器里的垃圾键；改成英文标识符' })
    }
  }
  // ③ 参数 key 重复：引擎只保留第一个（plugin.ts:548 if (!paramMap[content])）
  const seen = new Set()
  for (const p of meta.parameters || []) {
    if (seen.has(p.key)) issues.push({ severity: 'warn', code: 'duplicate-key', target: p.key, message: '参数 key 重复：引擎只保留第一个（plugin.ts:548），重复的那个会被丢掉' })
    seen.add(p.key)
    const isGetter = /-getter$/.test(String(p.type))
    if (!isGetter && p.default !== undefined && p.default !== '') {
      const parsed = parseDefaultByType(p.type, p.default)
      if (parsed === null) {
        issues.push({ severity: 'error', code: 'bad-default', target: p.key, message: '@default 与参数类型 ' + p.type + ' 不匹配（引擎 plugin.ts:496-520 解析不出来就退回该类型的初始值）：' + String(p.default).slice(0, 60) })
      } else if (p.type === 'option' && Array.isArray(p.options) && !p.options.includes(parsed)) {
        issues.push({ severity: 'error', code: 'default-not-in-options', target: p.key, message: '@default 不在本参数的 @option 列表里（引擎 plugin.ts:505-508 判为 null 并退回第一个选项）' })
      }
    }
  }
  // ④ 修饰标签的类型守卫：逐条对引擎各 setXxx 里的 switch(parameter.type)（plugin.ts:638-783）
  const guarded = {
    clamp: { types: ['number', 'variable-number'], need: '需要恰好两个数值：@clamp 最小值 最大值' },
    decimals: { types: ['number', 'variable-number'], need: '取一个 0-10 的整数' },
    placeholder: { types: ['string', 'number', 'variable-number'], need: '' }
  }
  let owner = ""
  let st
  META_STATEMENT_LOOSE.lastIndex = 0
  while ((st = META_STATEMENT_LOOSE.exec(metaBlock)) !== null) {
    const tag = st[1]
    const content = metaStatementContent(st[2])
    if (PARAM_TYPES.includes(tag)) { owner = tag; continue }
    const guard = guarded[tag]
    if (!guard) continue
    if (owner && !guard.types.includes(owner)) {
      issues.push({ severity: 'warn', code: 'modifier-scope', target: tag, message: '@' + tag + ' 写在 ' + owner + ' 上：引擎只对 ' + guard.types.join(' / ') + ' 生效（plugin.ts:638-783 的类型守卫），这里是白写。' + guard.need })
      continue
    }
    if (tag === 'clamp' || tag === 'decimals') {
      const parts = content.split(/\s+/)
      const okShape = tag === 'clamp' ? (parts.length === 2 && parts.every(v => !isNaN(parseFloat(v)))) : (parts.length === 1 && /^\d+$/.test(parts[0]) && Number(parts[0]) <= 10)
      if (!okShape) {
        issues.push({ severity: 'warn', code: tag === 'clamp' ? 'bad-clamp' : 'bad-decimals', target: tag, message: '@' + tag + ' 写法不对（' + guard.need + '），当前是「' + content + '」，引擎会整条忽略' })
      }
    }
  }
  return issues
}

/** 四类脚本模板（骨架，参数可注入） */
const SCRIPT_TEMPLATES = {
  plugin: {
    description: '全局插件（Script<Plugin>，类名注册到 PluginManager，类名=对外 API 名）',
    interface: 'Plugin',
    body: 'onStartup(): void {}\n  update(deltaTime: number): void {}\n  onBeforeSave(data: GameSaveData, define: PluginSaveDefine) {}\n  onBeforeLoad(data: GameSaveData) {}'
  },
  command: {
    description: '自定义指令（Script<Command> + call()，以 GUID 注册为事件指令）',
    interface: 'Command',
    body: 'call(): boolean {\n    return true\n  }'
  },
  'scene-object': {
    description: '场景对象脚本（Script<Trigger>/Script<Scene> 等，挂载到场景对象 scripts[]）',
    interface: 'Trigger',
    body: 'onStart(): void {}\n  update(deltaTime: number): void {}\n  onDestroy(): void {}'
  },
  'ui-element': {
    description: '界面元素脚本（Script<ButtonElement> 等，挂载到 UI 节点 scripts[]）',
    interface: 'ButtonElement',
    body: 'onStart(): void {}\n  update(deltaTime: number): void {}'
  }
}

function buildScriptSource(type, className, nameZh, params, extra) {
  const tpl = SCRIPT_TEMPLATES[type]
  const author = String((extra && extra.author) || '').trim()
  const link = String((extra && extra.link) || '').trim()
  // @author / @link 只在有内容时才写：引擎对它们没有非空要求（plugin.ts:524-534 的 setAuthor/setLink
  // 直接存值，@link 还要过 httpLink 正则），空标签只是占位噪音。
  const lines = ['/* @plugin #plugin', ' * @version 1.0']
  if (author) lines.push(' * @author ' + author)
  if (link && /^https?:\/\/.+$/.test(link)) lines.push(' * @link ' + link)
  lines.push(' * @desc #desc')
  for (const p of params || []) {
    if (p.type === 'option') lines.push(` * @option ${p.key} {${(p.options || ['a', 'b']).map(v => `'${v}'`).join(', ')}}`)
    else lines.push(` * @${p.type} ${p.key}`)
    lines.push(` * @alias #${p.key}`)
    if (p.default !== undefined && p.default !== '') {
      // 引号由类型决定，不能由 JS 里传进来的值决定：引擎 parseString 只认引号包裹的字符串，
      // 而 option 的 default 必须是 'a' 这种带引号的形式（plugin.ts:422-430 / 505-508），
      // 写成 @default a 会被判为 null 并退回第一个选项 —— 实测就是这条把生成器自己的模板卡住了。
      const quoted = typeof p.default === 'string'
        ? (p.type === 'number' || p.type === 'variable-number' || p.type === 'boolean' || p.type === 'number[]'
            ? p.default
            : `'${p.default}'`)
        : p.default
      lines.push(` * @default ${quoted}`)
    }
  }
  lines.push(' * @lang zh', ` * #plugin ${nameZh}`, ' * #desc 描述', ...(params || []).map(p => ` * #${p.key} ${p.key}`))
  lines.push(' */', '', `export default class ${className} implements Script<${tpl.interface}> {`)
  for (const p of params || []) lines.push(`  ${p.key}!: ${p.type.startsWith('number') || p.type === 'variable-number' ? 'number' : p.type.startsWith('string') || p.type === 'color' || p.type === 'keycode' || p.type === 'option' ? 'string' : p.type === 'boolean' ? 'boolean' : 'any'}`)
  lines.push('  ' + tpl.body.split('\n').join('\n  '), '}')
  const source = lines.join('\n') + '\n'
  // 生成完立刻自检：模板 + 参数拼出来的元数据同样要过引擎规则那一关 ——
  // 否则 create_script 会造出一个「预览看着没问题、装到编辑器里参数不出现」的脚本。
  const meta = parsePluginMeta(source)
  return { source, metaIssues: meta.ok ? validatePluginMeta(meta, source) : [] }
}

/** 生成 16 位 hex GUID（引擎要求含 a-f） */
function generateGuid() {
  for (let i = 0; i < 32; i++) {
    const g = crypto.randomBytes(8).toString('hex')
    if (/[a-f]/.test(g)) return g
  }
  return crypto.randomBytes(8).toString('hex')
}

/** 当前平台的 tsc 包名与二进制名：引擎自带的是 @typescript/typescript-<平台>-<架构> */
function platformTscNames() {
  const platform = process.platform
  const arch = process.arch
  return {
    pkg: `typescript-${platform}-${arch}`,            // linux-x64 / win32-x64 / darwin-arm64
    binary: platform === 'win32' ? 'tsc.exe' : 'tsc'
  }
}

/**
 * 在某个引擎根下找当前平台自带的 tsc。
 * 旧实现把包名写死成 typescript-win32-x64，于是 Linux / macOS 上永远找不到编译器——
 * 而写盘门禁是「编译不过就回滚」，找不到编译器等于「每次改代码都被回滚」，
 * AI 在非 Windows 平台上完全无法改脚本（铁律㊲）。
 */
function platformCompilerIn(engineRoot) {
  const { pkg, binary } = platformTscNames()
  const candidates = [
    path.join(engineRoot, 'node_modules', '@typescript', pkg, 'lib', binary),
    path.join(engineRoot, 'resources', 'app', 'node_modules', '@typescript', pkg, 'lib', binary),
    path.join(engineRoot, 'resources', 'app.asar.unpacked', 'node_modules', '@typescript', pkg, 'lib', binary)
  ]
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate
  // pnpm：顶层 @typescript/<包> 常常只是 .pnpm 里的硬链接，链接缺失时直接进存储目录找
  const store = path.join(engineRoot, 'node_modules', '.pnpm')
  try {
    const hit = fs.readdirSync(store)
      .filter(name => name.startsWith(`@typescript+${pkg}@`))
      .sort()
      .pop()
    if (hit) {
      const stored = path.join(store, hit, 'node_modules', '@typescript', pkg, 'lib', binary)
      if (fs.existsSync(stored)) return stored
    }
  } catch (e) { /* 没有 .pnpm 目录就继续找别的 */ }
  return ''
}

/** 定位 tsc 编译器：YAMI_TSC_EXE > 引擎自带（按当前平台） > YAMI_TSC_JS > node_modules/typescript */
function findCompiler() {
  if (process.env.YAMI_TSC_EXE && fs.existsSync(process.env.YAMI_TSC_EXE)) {
    return { command: process.env.YAMI_TSC_EXE, args: [] }
  }
  for (const engineRoot of candidateEngineRoots()) {
    const found = platformCompilerIn(engineRoot)
    if (found) return { command: found, args: [] }
  }

  if (process.env.YAMI_TSC_JS && fs.existsSync(process.env.YAMI_TSC_JS)) {
    return { command: process.execPath, args: [process.env.YAMI_TSC_JS] }
  }
  const candidates = [
    path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js'),
    path.join(__dirname, 'node_modules', 'typescript', 'lib', 'tsc.js')
  ]
  for (const c of candidates) if (fs.existsSync(c)) return { command: process.execPath, args: [c] }
  return null
}

function registerCreatedScript(type, guid, tool = 'create_script') {
  const table = type === 'plugin' ? 'plugins' : type === 'command' ? 'commands' : null
  if (!table) return { ok: true, skipped: true }
  const rel = `Data/${table}.json`
  const abs = resolveInside(ROOT, rel)
  let data = []
  if (fs.existsSync(abs)) {
    try { data = JSON.parse(fs.readFileSync(abs, 'utf8')) } catch (e) { return { ok: false, error: `${rel} 解析失败: ${e.message}` } }
  }
  if (!Array.isArray(data)) return { ok: false, error: `${rel} 不是数组结构` }
  if (!data.some(item => item && item.id === guid)) {
    data.push(type === 'plugin'
      ? { id: guid, enabled: true, parameters: {} }
      : { id: guid, enabled: true, alias: '', keywords: '' })
    return { ok: true, ...writeAtomic(ROOT, rel, JSON.stringify(data, null, 2) + '\n', { tool }), registered: true, table }
  }
  return { ok: true, registered: false, table }
}

function findTscJs() {
  const compiler = findCompiler()
  return compiler && compiler.command === process.execPath ? compiler.args[0] : null
}

/* ============================== 文件工具 ============================== */

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** 列出全部资源文件（相对项目根），可选类型过滤 */
function listResourceFiles(type) {
  const all = walk(path.join(ROOT, 'Assets'))
  const files = []
  for (const p of all) {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/')
    if (rel.startsWith('.')) continue
    const t = TYPE_BY_EXT[path.extname(p).toLowerCase()]
    if (!t) continue
    if (type && t !== type) continue
    files.push({ path: rel, type: t, size: fs.statSync(p).size, guid: parseGuidFromName(path.basename(p)) })
  }
  return files
}

function findCommandCatalogPath() {
  const candidates = [process.env.YAMI_COMMANDS_JSON]
  // 编辑器自带目录（Windows 安装版 / 解包产物），路径相对可执行文件推导而非写死盘符
  for (const engineRoot of candidateEngineRoots()) {
    candidates.push(
      path.join(engineRoot, 'resources', 'app', 'dist', 'commands.json'),
      path.join(engineRoot, 'resources', 'app', 'Project', 'commands.json')
    )
  }
  // 源码仓库同层（开发者在本机直接跑源码时的兜底）：同样从插件位置往上推引擎根，
  // 别再拼死目录名——旧写法只在仓库目录恰好叫 "2" 时成立，Linux 源码版上指令目录永远是空的
  candidates.push(
    path.resolve(__dirname, '..', '..', '..', '..', 'Project', 'commands.json'),
    path.join(process.cwd(), 'Project', 'commands.json')
  )
  return candidates.filter(Boolean).find(file => fs.existsSync(file)) || null
}

function flattenCommandCatalog() {
  const file = findCommandCatalogPath()
  if (!file) return []
  let tree
  try { tree = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] }
  const output = []
  const visit = (nodes, category = '') => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== 'object') continue
      if (node.class === 'folder') visit(node.children, node.value || category)
      else if (typeof node.value === 'string') output.push({ id: node.value, category, kind: node.class || '' })
    }
  }
  visit(tree)
  return output
}

function commandExamples(commandId, limit = 5) {
  const examples = []
  const visit = (value, source) => {
    if (examples.length >= limit || !value || typeof value !== 'object') return
    if (!Array.isArray(value) && value.id === commandId && value.params && typeof value.params === 'object') examples.push({ source, params: value.params })
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, source)
  }
  for (const file of listResourceFiles()) {
    if (examples.length >= limit || !DATA_TYPES.includes(file.type)) continue
    try { visit(JSON.parse(fs.readFileSync(resolveInside(ROOT, file.path), 'utf8')), file.path) } catch {}
  }
  return examples
}

/** 读 Data/*.json（不存在返回 null） */
function readDataJson(name) {
  const p = path.join(ROOT, 'Data', name)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return { __parseError: e.message } }
}

/**
 * 把引擎的"文件夹树"数据表摊平（属性表、变量表都是 `{class:'folder', children:[...]}` 这种形状）。
 * 用显式栈，不写自调用。
 */
function collectTreeEntries(root, fields) {
  const out = []
  const stack = [{ node: root, key: '' }]
  while (stack.length) {
    const cur = stack.pop()
    const node = cur.node
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], key: '' }); continue }
    // id 有两种写法：条目自带 id（属性表/变量表），或者**以 GUID 为键**的字典（plugins.json）
    const id = (typeof node.id === 'string' && node.id) ? node.id : (/^[0-9a-f]{16}$/.test(cur.key) ? cur.key : '')
    // 文件夹（class:'folder'）不是条目：本机属性表 266 条里有 18 条是文件夹，
    // 当成属性报给模型，它就敢按文件夹名去写指令。仍然要往下走（条目在 children 里）。
    const isFolder = node.class === 'folder'
    if (id && !isFolder) {
      const entry = { id: id }
      for (const f of fields) entry[f] = node[f]
      out.push(entry)
    }
    // 往下走**所有**对象字段：属性表条目在 keys 里、变量表在 children 里，
    // 只认 children 的话属性表一条都读不出来（第一次就踩了：list_attributes 返回 0 条）
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (value && typeof value === 'object') stack.push({ node: value, key: key })
    }
  }
  return out
}

/**
 * 属性表（Data/attribute.json）。两套键都要如实给出，别只给一套：
 *   · **数据文件**里引用属性用 id：本机实测 a5fd5e9f229abb2d=生命值(key health)、
 *     a8451228fe0c120a=最大生命值，角色文件里就是 {"key":"a5fd5e9f229abb2d","value":700}。
 *   · **运行时** actor.attributes 的键是 **属性名**（引擎 actor.ts:610 调 Attribute.loadEntries，
 *     variable.ts:263/266 写 map[attr.key]，key 为空才回落 id）。
 * 所以每条都同时返回 id 与 key/name，让调用方自己按场合取。
 */
function attributeEntries() {
  const data = readDataJson('attribute.json')
  if (!data || data.__parseError) return []
  return collectTreeEntries(data, ['key', 'name', 'type'])
}

/** 变量表（Data/variables.json）。同样是 id 键：变量引用写的是 id（实测 182 处全按 id） */
function variableEntries() {
  const data = readDataJson('variables.json')
  if (!data || data.__parseError) return []
  return collectTreeEntries(data, ['name', 'value', 'note']).map(entry => ({
    id: entry.id,
    name: entry.name || '',
    note: entry.note || '',
    // 引擎按 typeof 比类型（variable.ts:118），null 的 typeof 是 'object' —— 这里如实照抄
    valueType: entry.value === null ? 'object' : typeof entry.value
  }))
}

/** 写盘后给插件脚本做一次引擎级 lint（tsc 查不出这些，只有引擎运行时才知道） */
function lintPluginScripts(files) {
  const issues = []
  const owners = new Map()
  // 类名只对**全局插件**才是键（event.ts:539-549：以 constructor.name 注册进 PluginManager）；
  // 自定义指令是按 GUID 注册的（Command.scriptMap[guid]），类名重名不影响 ——
  // 第一版没区分，把指令脚本也算进来，真机上报出 6 条冲突，其中一部分是误报。
  const pluginGuids = new Set()
  const plugins = readDataJson('plugins.json')
  if (plugins && !plugins.__parseError) {
    // 只算**已启用**的：enabled:false 的条目在 ScriptManager.create 里就被过滤掉了，根本不会实例化，
    // 它的类名也就不会去覆盖别人（实测：本机两个 DialogueSystem 里那个"远距离距离"就是停用状态 ——
    // 不按 enabled 过滤会报一条"看着吓人、其实没事"的冲突）
    for (const entry of collectTreeEntries(plugins, ['name', 'enabled'])) if (entry.id && entry.enabled !== false) pluginGuids.add(entry.id)
  }
  for (const f of files || []) {
    if (f.type !== 'script' || !/^Assets\/插件\//.test(f.path)) continue
    if (pluginGuids.size && !pluginGuids.has(parseGuidFromName(path.basename(f.path)) || '')) continue
    let code = ''
    try { code = fs.readFileSync(path.join(ROOT, f.path), 'utf8') } catch { continue }
    // ① 全局插件以**类名**为键挂在 PluginManager 上（event.ts:539-549），重名会互相覆盖。
    // 类名有两种写法：export default class X，以及 export default X（X 在本文件里定义）。
    // 本机实测 17 个已注册插件里有 3 个是后者，旧实现完全不计入 → 冲突漏报。
    const classMatch = code.match(/export\s+default\s+class\s+([A-Za-z_$][\w$]*)/)
    let exportedName = classMatch ? classMatch[1] : ''
    if (!exportedName) {
      const aliasMatch = code.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|\r?\n|$)/)
      if (aliasMatch && new RegExp('class\\s+' + aliasMatch[1] + '\\b').test(code)) exportedName = aliasMatch[1]
    }
    if (exportedName) {
      const list = owners.get(exportedName) || []
      list.push(f.path)
      owners.set(exportedName, list)
    }
    // ② onBeforeSave 里直接改 data **是会进存档的**（引擎把同一个对象交给钩子、再原样落盘：
    //    data.ts:734-748 新建 data 对象 → emit('beforesave', {argument: data}) → event.ts:1020-1071 返回该对象
    //    → JSON.stringify 写盘）。旧文案说"不会被保存"是错的。真正的理由只是：绕过 define 会和
    //    引擎字段/其它插件撞名，所以建议用 define(key, value) 放进 data.plugins[插件id] 命名空间。
    const saveBody = extractMethodBody(code, 'onBeforeSave')
    if (saveBody && /\bdata\s*\.\s*[\w$]+\s*=/.test(saveBody)) {
      issues.push({ severity: 'info', code: 'plugin-save-without-define', file: f.path, message: 'onBeforeSave 里直接给 data 赋值会进存档（引擎确实会落盘），但建议改用引擎注入的 define(key, value) 放进 data.plugins[插件id] 命名空间，避免与引擎字段或其它插件撞名（event.ts:1020-1071）' })
    }
    // ③ data.plugins 是只读 Proxy，赋值会直接抛错
    const loadBody = extractMethodBody(code, 'onBeforeLoad')
    if ((loadBody && /data\s*\.\s*plugins\s*\[[^\]]*\]\s*=/.test(loadBody)) || (saveBody && /data\s*\.\s*plugins\s*\[[^\]]*\]\s*=/.test(saveBody))) {
      issues.push({ severity: 'warning', code: 'plugin-plugins-readonly', file: f.path, message: 'data.plugins 是只读 Proxy（event.ts:1135 起）：对它赋值会抛错，请只读取 data.plugins[guid]' })
    }
  }
  for (const [name, list] of owners) {
    if (list.length > 1) {
      issues.push({
        severity: 'error', code: 'plugin-class-conflict', files: list.slice(0, 3),
        message: '全局插件的类名重复：' + name + '（' + list.length + ' 个脚本）—— 引擎以类名为键注册（PluginManager[类名]），后加载的会覆盖前一个，两个插件的功能会互相顶掉'
      })
    }
  }
  return issues
}

/** 抠出某个方法体内的大括号内容（够用即可：插件脚本里的这几个方法都不长） */
function extractMethodBody(code, method) {
  const start = code.indexOf(method)
  if (start < 0) return ''
  const open = code.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return code.slice(open + 1, i)
    }
  }
  return ''
}

/**
 * 全局变量引用体检：两种坏法表现**不一样**，文案别写反（旧文案说"引擎会静默丢弃"，是错的）：
 *   · 类型不符：运行时 switch(typeof value) 里没有匹配分支 → 这次赋值整个不发生（variable.ts:118）。
 *   · 键不存在：switch 里有 case 'undefined' → **当场写进 Variable.map**，只是不在任何群组里，
 *     saveData 不持久化（variable.ts:140-149）→ 表现是"改完当场有效、读档就没了"。
 * 实测本机工程：207 处变量引用按 id 命中，另有 81 处指向不存在的变量。
 */
/**
 * 属性引用体检：引擎按 id 查属性表（Attribute.get → idMap），**查不到就静默 continue**
 * （Templates/arpg-ts-chinese/Script/variable.ts:256-269）。
 * 本机工程实测有 213 处属性 id 已不在属性表里（被删或改过名）——角色文件与事件里的那条属性还在，
 * 但游戏里永远不生效、也不报错。这是密度最高的静默坏点，过去没人查。
 */
function checkAttributeRefs(files) {
  const issues = []
  const entries = attributeEntries()
  if (!entries.length) return issues
  const ids = new Set(entries.map(e => e.id))
  const seen = new Set()
  const isGuid = (v) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)
  const note = (file, where, id) => {
    const dedupe = file + '|' + id
    if (seen.has(dedupe)) return
    seen.add(dedupe)
    issues.push({ severity: 'warning', code: 'unknown-attribute', attribute: id, message: file + ' 的' + where + '引用了属性表里不存在的属性 ' + id + '（引擎加载时静默跳过：这条属性不生效，也不会报错）' })
  }
  for (const f of files || []) {
    if (!DATA_TYPES.includes(f.type)) continue
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(ROOT, f.path), 'utf8')) } catch { continue }
    const stack = [data]
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) { for (const item of node) stack.push(item); continue }
      if (isGuid(node.attributeId) && !ids.has(node.attributeId)) note(f.path, '属性参数', node.attributeId)
      if (Array.isArray(node.attributes)) {
        for (const item of node.attributes) {
          if (item && typeof item === 'object' && isGuid(item.key) && !ids.has(item.key)) note(f.path, '角色属性', item.key)
        }
      }
      for (const k of Object.keys(node)) {
        const v = node[k]
        if (v && typeof v === 'object') stack.push(v)
      }
    }
  }
  return issues
}

function checkVariableRefs(files) {
  const issues = []
  const variables = variableEntries()
  if (!variables.length) return issues
  const byId = new Map(variables.map(v => [v.id, v]))
  const EXPECTED = { setBoolean: 'boolean', setNumber: 'number', setString: 'string', setObject: 'object', setList: 'object' }
  const seen = new Set()
  for (const f of files || []) {
    if (!DATA_TYPES.includes(f.type)) continue
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(ROOT, f.path), 'utf8')) } catch { continue }
    const stack = [data]
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) { for (const item of node) stack.push(item); continue }
      const expected = EXPECTED[node.id]
      const variable = node.params && node.params.variable
      if (expected && variable && typeof variable === 'object' && variable.type === 'global' && typeof variable.key === 'string') {
        const key = variable.key
        const hit = byId.get(key)
        const dedupe = f.path + '|' + node.id + '|' + key
        if (!seen.has(dedupe)) {
          seen.add(dedupe)
          if (!hit) {
            issues.push({ severity: 'warning', code: 'unknown-variable', variable: key, message: f.path + ' 的 ' + node.id + ' 引用不存在的全局变量 ' + key + '（当场能写进内存、但不在变量表里，读档即丢；请先在变量表里建它）' })
          } else if (hit.valueType !== expected) {
            issues.push({ severity: 'warning', code: 'variable-type-mismatch', variable: key, message: f.path + ' 的 ' + node.id + ' 写「' + (hit.name || key) + '」，但它的初始值是 ' + hit.valueType + '（引擎按 typeof 比对，不符就静默丢弃）' })
          }
        }
      }
      for (const k of Object.keys(node)) {
        const value = node[k]
        if (value && typeof value === 'object') stack.push(value)
      }
    }
  }
  return issues
}

/**
 * 收集磁盘上所有 GUID → 来源（跨 Assets 文件 + Data 表）。
 * 除了「文件名里的 GUID」，还必须收**数据表里注册的 id** —— 否则 eventId / easingId 这类引用
 * 会被判成悬空（实测：引擎自带的缓动曲线 id 全在 Data/easings.json 里，不是文件名）。
 */
function collectAllGuids(files) {
  const map = new Map()
  const add = (source, g) => {
    if (!g) return
    if (!map.has(g)) map.set(g, [])
    if (!map.get(g).includes(source)) map.get(g).push(source)
  }
  for (const f of files || listResourceFiles()) add(f.path, parseGuidFromName(path.basename(f.path)))
  for (const f of walk(path.join(ROOT, 'Data'))) add(path.relative(ROOT, f).replace(/\\/g, '/'), parseGuidFromName(path.basename(f)))
  // 数据表里注册的 id（缓动/图集/插件/指令/队伍/变量/枚举/属性…）
  for (const name of ['easings', 'autotiles', 'plugins', 'commands', 'teams', 'variables', 'enumeration', 'attribute']) {
    const data = readDataJson(name + '.json')
    if (!data || data.__parseError) continue
    const rel = 'Data/' + name + '.json'
    const visit = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 8) return
      if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
      if (typeof value.id === 'string' && isValidGuid(value.id)) add(rel, value.id)
      for (const key of ['children', 'list', 'items']) if (value[key]) visit(value[key], depth + 1)
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object' && key !== 'id') visit(child, depth + 1)
      }
    }
    visit(data, 0)
  }
  return map
}

/**
 * 哪些键的值才是「资源 GUID」：只认这两个，其余一律不判。
 *
 * 为什么收得这么紧：variable.key / attributes.key / presetId / sprites.id / motions.id / layers.sprite
 * 这些字段里的 16 位 hex **不是资源引用**（是变量、属性、节点、动作 id）；旧实现按「任何 16 位 hex 都算引用」
 * 全量扫，实测在本机工程上报出 **6093 条悬空引用**，把真问题彻底淹没了。
 * 代价是「别处引用不存在的资源」这类问题查不全 —— 宁可少报，也不拿 6000 条假警报糊住用户。
 */
const REF_KEYS = new Set(['eventId', 'easingId'])

/** 从对象树收集**资源引用**（只认 REF_KEYS 里的键；其余 16 位 hex 是变量/属性/节点 id，不是资源） */
function collectRefs(obj, refs, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return
  seen.add(obj)
  if (Array.isArray(obj)) { for (const v of obj) collectRefs(v, refs, seen); return }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') { if (REF_KEYS.has(k) && isValidGuid(v)) refs.push(v) }
    else if (typeof v === 'object' && v !== null) collectRefs(v, refs, seen)
  }
}

/* ============================== 校验实现 ============================== */

/** 校验单个数据文件（相对项目根路径） */
function validateResourceFile(relPath) {
  const issues = []
  const abs = path.join(ROOT, relPath)
  if (!fs.existsSync(abs)) return { ok: false, issues: [{ severity: 'error', code: 'not-found', message: '文件不存在' }] }
  const base = path.basename(relPath)
  const ext = path.extname(base).toLowerCase()
  const type = TYPE_BY_EXT[ext]

  // 1) GUID 命名
  const guid = parseGuidFromName(base)
  if (!guid) issues.push({ severity: 'error', code: 'missing-guid', message: `文件名缺少 16 位 hex GUID（应为 <名称>.<16hex>${ext}）` })
  else if (!isValidGuid(guid)) issues.push({ severity: 'error', code: 'invalid-guid', message: `GUID 非法（须 16 位 hex 且含 a-f）: ${guid}` })

  // 2) JSON 可解析 + 必需字段
  if (DATA_TYPES.includes(type)) {
    let data
    try {
      data = JSON.parse(fs.readFileSync(abs, 'utf8'))
    } catch (e) {
      return { ok: issues.length === 0, type, guid, issues: [...issues, { severity: 'error', code: 'invalid-json', message: `JSON 解析失败: ${e.message}` }] }
    }
    const required = REQUIRED_FIELDS[type] || []
    for (const f of required) {
      if (!(f in data)) issues.push({ severity: 'error', code: 'missing-field', message: `缺少必需字段: ${f}` })
    }
    // 3) presetId 唯一性（文件内节点树）
    const presetIds = new Map()
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (typeof node.presetId === 'string') {
        if (presetIds.has(node.presetId)) issues.push({ severity: 'error', code: 'duplicate-preset-id', message: `presetId 重复: ${node.presetId}` })
        else presetIds.set(node.presetId, true)
      }
      if (Array.isArray(node.children)) for (const c of node.children) visit(c)
      if (Array.isArray(node.nodes)) for (const c of node.nodes) visit(c)
      if (Array.isArray(node.objects)) for (const c of node.objects) visit(c)
    }
    if (type === 'ui') for (const n of data.nodes || []) visit(n)
    if (type === 'scene') for (const o of data.objects || []) visit(o)
    // 4) presetId 格式：引擎新生成时一律用 GUID.generate64bit()（16 位 hex 且必含 a-f，guid.ts:11-17），
    //    非法格式虽然能被读进来，但一旦节点被复制/重建就会被引擎换掉，引用它的指令会指向旧 id。
    if (type === 'ui' || type === 'scene') {
      const badFormat = []
      const checkFormat = node => {
        if (!node || typeof node !== 'object') return
        if (typeof node.presetId === 'string' && node.presetId !== '' && !isValidGuid(node.presetId)) badFormat.push(node.presetId)
        for (const key of ['children', 'nodes', 'objects']) if (Array.isArray(node[key])) node[key].forEach(checkFormat)
      }
      if (type === 'ui') for (const n of data.nodes || []) checkFormat(n)
      if (type === 'scene') for (const o of data.objects || []) checkFormat(o)
      if (badFormat.length) issues.push({ severity: 'warning', code: 'bad-preset-id', message: `presetId 格式不是 16 位 hex 含 a-f（引擎新生成的都是这个格式）: ${badFormat.slice(0, 3).join('、')}` })
    }
  }
  return { ok: issues.length === 0, type, guid, issues }
}

/** 全工程校验：GUID 唯一性 + 数据文件引用完整性 + manifest 一致性 */
function validateProject() {
  const issues = []
  // 一次性扫描：这段逻辑此前把整棵 Assets 递归 + 逐文件 stat 跑了四遍
  // （collectAllGuids / 引用完整性 / manifest 一致性 / 统计各来一次），工程越大越明显。
  const files = listResourceFiles()
  const guidMap = collectAllGuids(files)
  // 1) GUID 唯一性：只比**文件路径**。
  //    数据表里注册的同名 id（自定义指令的 commands.json 条目 = 脚本文件名里的那个 GUID）不是冲突，
  //    旧实现把两者混在一起比，本机工程直接报出 47 条假冲突。
  for (const [g, sources] of guidMap) {
    //    另外**要把 Data 表本身排除掉**：plugins.json / commands.json 里的条目 id 就等于脚本文件名里的 GUID，
    //    那是「同一个资源的两处登记」，不是两个文件撞 GUID（本机工程实测 47 条全是这种）。
    const filePaths = sources.filter(item => typeof item === 'string' && item.startsWith('Assets/'))
    if (filePaths.length > 1) issues.push({ severity: 'error', code: 'duplicate-guid', guid: g, message: `GUID 重复（${filePaths.length} 个文件）: ${g}`, files: filePaths })
  }
  // 2) 数据文件引用完整性：所有 16hex 引用须能在磁盘找到
  const known = new Set(guidMap.keys())
  for (const f of files) {
    if (!DATA_TYPES.includes(f.type)) continue
    const abs = path.join(ROOT, f.path)
    let data
    try { data = JSON.parse(fs.readFileSync(abs, 'utf8')) } catch { continue }
    const refs = []
    collectRefs(data, refs)
    const seen = new Set()
    for (const r of refs) {
      if (seen.has(r)) continue
      seen.add(r)
      if (!known.has(r)) issues.push({ severity: 'warning', code: 'dangling-ref', message: `${f.path} 引用不存在的资源: ${r}` })
    }
  }
  // 3) presetId 跨文件唯一性：引擎把场景/界面的默认对象注册成**全局**键（scenePresets / uiPresets），
  //    冲突时后注册的会直接覆盖前一个（scene-window.ts:1270-1276 `scenePresets[node.presetId] = {...}`），
  //    于是引用旧 id 的指令会悄悄指到另一个场景的对象上 —— 单文件内查重看不出来，必须跨文件查。
  {
    const owners = new Map()
    const collect = (file, node) => {
      if (!node || typeof node !== 'object') return
      if (typeof node.presetId === 'string' && node.presetId !== '') {
        const list = owners.get(node.presetId) || []
        if (!list.includes(file.path)) list.push(file.path)
        owners.set(node.presetId, list)
      }
      for (const key of ['children', 'nodes', 'objects']) if (Array.isArray(node[key])) node[key].forEach(child => collect(file, child))
    }
    for (const f of files) {
      if (f.type !== 'scene' && f.type !== 'ui') continue
      let data
      try { data = JSON.parse(fs.readFileSync(path.join(ROOT, f.path), 'utf8')) } catch { continue }
      const roots = f.type === 'ui' ? (data.nodes || []) : (data.objects || [])
      if (Array.isArray(roots)) roots.forEach(node => collect(f, node))
    }
    for (const [presetId, ownerFiles] of owners) {
      if (ownerFiles.length > 1) issues.push({ severity: 'error', code: 'duplicate-preset-id', presetId, files: ownerFiles.slice(0, 3), message: `presetId 在多份资源里重复: ${presetId}（${ownerFiles.length} 份）—— 引擎注册时后写的会覆盖前一个，引用它的指令会指错对象` })
    }
    // 3b) 界面里 reference 节点的 prefabId 指向**某个界面节点的 presetId**（不是资源 GUID）。
    //     实据：ui-window.ts:697 `reference.prefabId = prefab.presetId`、reference-element.ts:29 `Data.uiPresets[value]`。
    //     指不到任何 presetId 时引擎**静默**什么都不加载（reference-element.ts:30 `if (preset && ...)`）——
      //     界面上那个位置就是空的，不报错、不提示，属于最难查的一类坏。
    const knownPresets = new Set(owners.keys())
    const collectPrefabs = (file, node) => {
      if (!node || typeof node !== 'object') return
      if (typeof node.prefabId === 'string' && node.prefabId && !knownPresets.has(node.prefabId)) {
        issues.push({ severity: 'warning', code: 'dangling-prefab', message: `${file.path} 的 reference 节点指向的 prefabId 不存在: ${node.prefabId}（引擎会静默不加载，界面上那块是空的）` })
      }
      for (const key of ['children', 'nodes', 'objects']) if (Array.isArray(node[key])) node[key].forEach(child => collectPrefabs(file, child))
    }
    for (const f of files) {
      if (f.type !== 'ui') continue
      let data
      try { data = JSON.parse(fs.readFileSync(path.join(ROOT, f.path), 'utf8')) } catch { continue }
      if (Array.isArray(data.nodes)) data.nodes.forEach(node => collectPrefabs(f, node))
    }
  }
  // 4) manifest 一致性：磁盘文件 vs manifest 条目
  const manifest = readDataJson('manifest.json')
  if (manifest && !manifest.__parseError) {
    const manifestPaths = new Set()
    for (const [k, v] of Object.entries(manifest)) {
      if (!Array.isArray(v)) continue
      for (const item of v) if (item && typeof item.path === 'string') manifestPaths.add(item.path.replace(/\\/g, '/'))
    }
    for (const f of files) {
      if (f.type === 'script' || f.type === 'image' || f.type === 'audio' || f.type === 'video' || f.type === 'font') continue
      if (!manifestPaths.has(f.path)) issues.push({ severity: 'warning', code: 'not-in-manifest', message: `磁盘文件不在 manifest 中（编辑器会重建）: ${f.path}` })
    }
  }
  // 5) 压缩字段（RLE）**真解码**校验：以前只比字符串长度，串本身坏掉是看不出来的
  for (const f of files) {
    if (f.type !== 'scene') continue
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(ROOT, f.path), 'utf8')) } catch { continue }
    const width = Number(data.width) || 0
    const height = Number(data.height) || 0
    if (width && height && typeof data.terrains === 'string' && data.terrains) {
      const got = rle.verifyTerrains(data.terrains, width, height)
      if (!got.ok) issues.push({ severity: 'error', code: 'rle-invalid', file: f.path, message: '场景 terrains 压缩串坏掉了：' + got.error })
    }
    const stack = [data.objects || []]
    while (stack.length) {
      const list = stack.pop()
      for (const node of list || []) {
        if (!node || typeof node !== 'object') continue
        if (Array.isArray(node.children)) stack.push(node.children)
        if (typeof node.code === 'string' && node.code && node.width && node.height) {
          const got = rle.verifyTiles(node.code, node.width, node.height)
          if (!got.ok) issues.push({ severity: 'error', code: 'rle-invalid', file: f.path, message: '瓦片地图「' + (node.name || node.id || '') + '」的 code 坏掉了：' + got.error })
        }
      }
    }
  }
  // 6) 插件脚本 lint（类名冲突 / onBeforeSave 没用 define / 改只读的 data.plugins）
  for (const item of lintPluginScripts(files)) issues.push(item)
  // 7) 全局变量引用体检（不存在的变量：读档即丢；类型不符：这次赋值不发生）
  for (const item of checkVariableRefs(files)) issues.push(item)
  // 8) 属性引用体检（属性 id 不在属性表里 → 引擎静默跳过）
  for (const item of checkAttributeRefs(files)) issues.push(item)
  return { ok: issues.every(i => i.severity !== 'error'), issues, stats: { files: files.length, duplicateGuids: [...guidMap.values()].filter(a => a.length > 1).length } }
}

/* ============================== 工具定义 ============================== */

const tools = [
  {
    name: 'list_resources',
    description: '列出游戏工程的资源文件清单（规则二数据文件层），可按类型过滤；返回相对项目根的路径/类型/大小/GUID',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: DATA_TYPES.concat(['script', 'image', 'audio']), description: '按类型过滤（event/scene/ui/trigger/actor/tileset/animation/particle/skill/item/equipment/state/script/image/audio）' },
        filter: { type: 'string', description: '路径包含过滤（如 "插件/自定义指令"）' },
        offset: { type: 'number', description: '分页起点，默认 0' },
        limit: { type: 'number', description: '返回数量，默认 100，最大 500' }
      }
    }
  },
  {
    name: 'read_resource',
    description: '读取一个资源文件（.event/.scene/.ui/.trigger/.actor/.tile/.anim/.particle/.skill/.item/.equip/.state 或 Data/*.json），返回解析后的 JSON；RLE 字段（terrains/code）原样保留。文件超过 200KB 会自动截断，此时用 key 精读某个顶层字段，或 forceFull 读全文（受保护的会话里 forceFull 不生效）',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根的路径，如 Assets/! 事件/@1 启动游戏事件.xxx.event 或 Data/attribute.json' },
        // key / forceFull 是截断保护给的出路，必须声明给模型，
        // 否则它读不到这两个参数、只会拿同样的 path 反复重读（实测踩过：主菜单.ui 连读三次被判定空转）
        key: { type: 'string', description: '只读该顶层字段（大文件截断后返回 topLevelKeys，从中挑一个，例如 nodes）' },
        forceFull: { type: 'boolean', description: '忽略截断保护读取完整内容；仅在文件确实需要整体查看时使用' }
      },
      required: ['path']
    }
  },
  {
    name: 'validate_resource',
    description: '校验单个资源文件：GUID 命名、JSON 可解析性、必需字段、presetId 唯一性',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根的路径' }
      },
      required: ['path']
    }
  },
  {
    name: 'validate_project',
    description: '全工程校验：GUID 全局唯一性、数据文件引用完整性（悬空引用）、磁盘与 manifest 一致性',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'write_resource',
    description: '写入（新建/覆盖）一个资源文件。内容必须是 JSON 对象；自动校验：文件名 GUID 合法、JSON 可序列化、presetId 文件内唯一。默认 dryRun=true 只预览不落盘；写盘后编辑器聚焦窗口即自动重扫。注意：terrains/code（RLE）字段不要手改',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根的路径，如 Assets/! 事件/新事件.xxxxxxxxxxxxxxxx.event' },
        content: { type: 'object', description: '要写入的 JSON 对象（将 JSON.stringify(obj, null, 2) 落盘）' },
        dryRun: { type: 'boolean', description: 'true=仅校验+预览不写盘（默认）；false=实际写入' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_scripts',
    description: '列出规则一脚本（Assets/插件/**/*.ts），按四类（全局插件/自定义指令/场景对象脚本/界面元素脚本）分组返回',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'parse_plugin_meta',
    description: '解析 .ts 脚本的 /* @plugin */ 元数据注释块（规则一 DSL），返回概述/参数列表（含修饰标签）/语言包；用于学习现有脚本模式或校验自己写的元数据',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对项目根的 .ts 路径，如 Assets/插件/自定义指令/获取角色id.xxx.ts' } },
      required: ['path']
    }
  },
  {
    name: 'create_script',
    description: '按四类模板生成 TS 脚本（全局插件/自定义指令/场景对象脚本/界面元素脚本）：自动生成 @plugin 元数据头 + 类骨架；默认 dryRun 只预览不落盘',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['plugin', 'command', 'scene-object', 'ui-element'], description: '脚本类型' },
        path: { type: 'string', description: '目标相对路径（文件名须含 16 位 hex GUID），如 Assets/插件/自定义指令/新指令.xxxxxxxxxxxxxxxx.ts' },
        className: { type: 'string', description: 'TS 类名（如 MyCommand）' },
        nameZh: { type: 'string', description: '中文名称（@plugin 语言包显示名）' },
        params: { type: 'array', items: { type: 'object' }, description: '可选参数声明 [{key, type: number|string|boolean|option, default, options}]' },
        author: { type: 'string', description: '可选：@author 作者名；不填就不生成这一行（空标签只是占位噪音）' },
        link: { type: 'string', description: '可选：@link 链接，必须是 http(s):// 开头（引擎自己会校验，不合法会被丢弃）' },
        dryRun: { type: 'boolean', description: '默认 true 只预览；false 写入文件' }
      },
      required: ['type', 'path', 'className', 'nameZh']
    }
  },
  {
    name: 'list_event_commands',
    description: '分页列出 Open Yami 内建事件指令目录，可按 ID 或分类关键词过滤；参数结构按需调用 get_event_command_examples',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: '指令 ID 或分类关键词' },
        offset: { type: 'number', description: '分页起点，默认 0' },
        limit: { type: 'number', description: '返回数量，默认 60，最大 200' }
      }
    }
  },
  {
    name: 'get_event_command_examples',
    description: '从当前真实工程中按指令 ID 提取参数样例，避免猜测 params 结构',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '内建或自定义指令 ID' }, limit: { type: 'number', description: '样例数，默认 5，最大 10' } },
      required: ['id']
    }
  },
  {
    name: 'read_script',
    description: '读取一个 TS/JS 脚本的完整源码与 SHA-256，供 AI 在修改前建立准确上下文和并发保护',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '工程内脚本相对路径，如 Assets/插件/全局插件/示例.xxx.ts' } },
      required: ['path']
    }
  },
  {
    name: 'write_script',
    description: '安全写入现有 TS/JS 脚本；默认 dryRun 预览，expectedSha256 防止覆盖用户刚改过的版本，可选编译校验',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工程内脚本相对路径' },
        content: { type: 'string', description: '完整脚本源码' },
        expectedSha256: { type: 'string', description: '修改前源码 SHA-256；省略则不做并发版本保护' },
        dryRun: { type: 'boolean', description: '默认 true，只预览不写盘' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'patch_resource',
    description: '对 Assets 内 JSON 资源做递归局部补丁，保留未修改字段；默认 dryRun，禁止直接改写 manifest 与压缩 RLE 字段',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Assets 内 .event/.scene/.ui/.trigger/.actor/.skill/.item 等资源路径' },
        patch: { type: 'object', description: '要递归合并的字段' },
        expectedSha256: { type: 'string', description: '修改前文件 SHA-256' },
        dryRun: { type: 'boolean', description: '默认 true，只预览不写盘' }
      },
      required: ['path', 'patch']
    }
  },
  {
    name: 'delete_resource',
    description: '删除工程资源；默认 dryRun 预览，正式删除前会自动备份到 .yami-mcp-backups',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工程内资源相对路径' },
        expectedSha256: { type: 'string', description: '预览时返回的原文件 SHA-256，正式删除时用于防止误删新版本' },
        dryRun: { type: 'boolean', description: '默认 true，只预览不删除' }
      },
      required: ['path']
    }
  },
  {
    name: 'editor_action',
    // reload_resource：把磁盘上的改动重读进编辑器内存（引擎 5967 桥的 reload 动作，逐类型重建映射 + 派发 datachange）。
    // 定位要写清：「把磁盘重读进内存」而不是反过来 —— AI 写盘后自动重载走的就是它。
    // 前置条件与失败长相写清楚：官方预编译版没有 window.YamiEngine，这几项一律报 engineUnavailable ——
    // 说明里不写，模型会反复重试同一个动作、甚至向用户承诺「已经保存好了」。
    description: '执行受限的编辑器原生操作：保存、撤销、重做、刷新资源树、启动试玩、把某个资源从磁盘重读进编辑器内存（reload_resource 需给 path）；不接受任意 JS。前提：这些动作都依赖引擎内部接口，编辑器若没暴露（官方预编译版就是这样）会返回 engineUnavailable 并说明原因，此时不要重试、也不要向用户承诺已经保存/已启动试玩',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'undo', 'redo', 'refresh', 'playtest', 'reload_resource'], description: '编辑器动作；reload_resource 需同时给 path' },
        path: { type: 'string', description: 'action=reload_resource 时的资源路径（工程内相对路径）' }
      },
      required: ['action']
    }
  },
  {
    name: 'interact_editor',
    // 与 ui_steps 的分工写清楚：ui_steps 走引擎公开入口（进撤销栈、有高亮演出），是**首选**；
    // interact_editor 是鼠标级模拟（pointerdown/up + click），只在 ui_steps 够不着时用 ——
    // 两段说明原先各自只说自己是「兜底/首选」，模型很容易选错。
    description: '用鼠标级模拟操作编辑器控件（pointerdown/up + click、按坐标拖动、直接写控件值）。只在这些情况下用：ui_steps 够不着的目标（canvas 里的东西、需要真拖拽、没有稳定选择器的控件）；能用 ui_steps 的一律优先 ui_steps（它走引擎公开入口、会进撤销栈、有高亮演出）',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['input', 'select', 'click', 'move', 'down', 'up', 'drag'], description: '交互动作' },
        selector: { type: 'string', description: '目标 CSS 选择器，输入与选项操作必填' },
        value: { description: 'input/select 的值' },
        x: { type: 'number' }, y: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' },
        button: { type: 'number', description: '鼠标键，默认 0' }
      },
      required: ['action']
    }
  },
  {
    name: 'generate_guid',
    description: '生成 16 位 hex GUID（引擎要求含 a-f）；check=true 时在当前工程查重',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: { count: { type: 'number', description: '生成数量，默认 1' }, check: { type: 'boolean', description: '是否查重（默认 true）' } } }
  },
  {
    name: 'compile_check',
    description: '对项目运行 tsc --noEmit 编译检查（返回错误数/警告列表）。需要 tsc.js：YAMI_TSC_JS 环境变量指定，或项目根 node_modules 含 typescript',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cdp_eval',
    description: '通过 Chrome DevTools Protocol 连接编辑器渲染进程执行 JS（需以 --remote-debugging-port=<port> 启动编辑器，默认端口 9222）',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要执行的 JS 表达式' }
      },
      required: ['expression']
    }
  },
  {
    name: 'dump_ui_hierarchy',
    description: '【无视觉定位】扫描当前编辑器可见的交互元素（按钮、导航标签、输入框等），返回 ID、文字、选择器与屏幕像素包围盒 [x,y,w,h]，使 AI 无需截图即可精准定位屏幕上的控件',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'click_element',
    description: '【无视觉点击】点击编辑器界面元素。可传入选择器（如 #title-play）进行语义点击，或传入 x, y 进行屏幕绝对坐标点击',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器（如 #title-play, #nav-project）' },
        x: { type: 'number', description: '屏幕物理 X 像素坐标' },
        y: { type: 'number', description: '屏幕物理 Y 像素坐标' }
      }
    }
  },
  {
    name: 'trigger_playtest',
    description: '快捷触发编辑器启动或重启游戏试玩（相当于点击标题栏 #title-play 或按 F4）',
    readOnlyHint: false,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'append_event_commands',
    description: '【高阶指令装配】向指定 .event 事件文件追加或插入指令（对话、注释、脚本、等待、变量设置、调用事件等）。自动将自定义指令名转换为 16 位 hex GUID，免除手写复杂 JSON 槽位',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '事件文件相对路径（如 Assets/! 事件/测试.event）' },
        commands: { type: 'array', items: { type: 'object' }, description: '指令列表，支持 {type: "comment", text: "..."} 等高阶语法' },
        position: { description: '插入位置："end"（末尾，默认）、"start"（开头）或具体数字下标' },
        dryRun: { type: 'boolean', description: '默认 true 只预览；false 正式写盘' }
      },
      required: ['path', 'commands']
    }
  },
  {
    name: 'upsert_database_item',
    description: '【数据表单项打补丁】对 Data/*.json（plugins, commands, teams, variables, attribute 等）进行单项增删改或局部属性合并；Assets 内角色/技能/物品等请使用 patch_resource',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '数据表名：plugins / commands / teams / variables / attribute / enumeration / easings / autotiles / config / localization' },
        id: { type: 'string', description: '目标条目的 GUID 或变量 ID（若新增且省略，会自动生成合法 16 位 hex GUID）' },
        item: { type: 'object', description: '要合并或新增的数据对象字段' },
        parentId: { type: 'string', description: 'variables 表专用：父文件夹 ID（默认根目录）' },
        dryRun: { type: 'boolean', description: '默认 true 只预览；false 正式写盘' }
      },
      required: ['table', 'item']
    }
  },
  {
    name: 'get_runtime_state',
    description: '获取正在运行的试玩游戏实时状态（帧率、场景角色数量、活动事件、内存占用及最新黑匣子报错日志）',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'diagnose_runtime',
    description: '读取试玩运行时的诊断摘要（AI 专用）：未捕获报错按指纹聚合、每条带「可疑文件名 + 行号 + 就地源码 + 白话归因」，外加卡住/幽灵事件、最耗时更新器与渲染器、内存与资源缓存。先诊断再动手改代码时用这个，不要读整份报告。',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_editor_context',
    description: '获取 Open Yami 编辑器与游戏运行时的实时环境上下文（当前编辑/运行的场景中文名、资源树/文件列表中选中的文件、检视器属性面板打开的对象、试玩状态等）。在回答用户涉及具体场景、当前选中道具/技能/事件时优先调用此工具。',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_attributes',
    description: '列出工程的角色/技能/状态/装备属性表（Data/attribute.json，可带 query 过滤）。**属性的键是这里的 id**（不是 key/name）：实测 a5fd5e9f229abb2d=生命值、a8451228fe0c120a=最大生命值；角色文件里写的就是 {"key":"<属性id>","value":700}。要读写角色属性、写事件指令参数时，先用这个工具把 id 查出来，别猜名字（引擎里没有 actor.hp 这种东西）。',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '可选：按 id / key / 中文名模糊过滤，例如「生命」或「maxHealth」' }
      }
    }
  },
  {
    name: 'read_tilemap',
    description: '把场景的压缩地图解开给人看/给模型改：返回 terrains 与每张瓦片地图的**原始数值数组**（引擎 RLE 解码后的结果，不是压缩串）。要改地图就先用它读出数组、改好，再用 write_resource 写回（写回时会自动做编解码校验）。',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '场景文件路径，例如 Assets/场景/新手村.xxxxxxxxxxxxxxxx.scene' }
      },
      required: ['path']
    }
  },
  {
    name: 'todo_write',
    description: '维护本次任务的待办清单（多步开发任务开工时先列一次，之后每完成一步更新状态）。用户会在界面上看到进度骨架；步骤文案用白话，别写代码术语。状态：pending 待做 / in_progress 进行中 / done 已完成。',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          description: '清单：字符串数组 ["第一步","第二步"]，或对象数组 [{ text:"第一步", status:"done" }]',
          oneOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] }, id: { type: 'string' } } } }
          ]
        },
        clear: { type: 'boolean', description: '清空清单（任务结束后用）' }
      }
    }
  },
  {
    name: 'project_changelog',
    description: '生成「本次改动小结」：把工程当前状态与上一次基线快照对比，列出真正被改/新建/删除的文件（写了又改回去、写失败回滚的都不会被算进来），并合并编译结论与试玩冒烟结论。改完收尾、或用户问"你刚才改了什么"时用它。传 reset:true 可把当前状态设为新基线（一般在新任务开始时调用一次）。',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        reset: { type: 'boolean', description: '把当前工程状态设为新基线并返回（用于开始一件新任务）' },
        limit: { type: 'number', description: '最多列出多少个文件，默认 50' }
      }
    }
  },
  {
    name: 'list_backups',
    description: '列出可回退的历史版本（每次 AI 写盘前都会自动备份）：返回时间、被改文件、由哪个工具改动、体积。用户说「改回去 / 撤销 / 恢复原样」时先用它确认要回到哪一步。',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '可选：只看某个文件的备份（相对路径）' },
        limit: { type: 'number', description: '最多返回多少条，1-200，默认 30' }
      }
    }
  },
  {
    name: 'restore_backup',
    description: '把某个文件回退到指定备份（不传 backup 则回退到该文件最早的一次备份，即 AI 动手之前）。回退前会先把当前内容另存一份，所以回退本身也能再撤回；返回与当前内容的差异。',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要回退的文件（相对路径）' },
        backup: { type: 'string', description: '可选：list_backups 给出的 backup 路径；不传则回退到最早备份' },
        dryRun: { type: 'boolean', description: '默认 true 只预览将发生的差异；false 才真正回退' },
        expectedSha256: { type: 'string', description: '可选：校验当前文件未被他人改动' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_project',
    description: '在工程里做内容检索（类似 grep）：按正则搜索脚本与数据文件，返回命中文件、行号、该行内容与可选上下文行。改代码前先用它定位，避免整份读取大文件。',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的正则或纯文本（如 "movementSpeed"、"掉落物品"、"parseGUID"）' },
        scope: { type: 'string', enum: ['script', 'data', 'event', 'all'], description: '搜索范围：script 只搜 .ts/.js 脚本，data 搜 Data/*.json，event 搜 .event 资源，all 搜全部（默认 script）' },
        contextLines: { type: 'number', description: '每个命中附带的前后上下文行数，0-5，默认 0' },
        maxResults: { type: 'number', description: '最多返回多少条命中，1-200，默认 40' },
        ignoreCase: { type: 'boolean', description: '是否忽略大小写，默认 false' }
      },
      required: ['query']
    }
  },
  {
    name: 'edit_script',
    description: '精确修改脚本片段（不必整文件重写）：把 oldText 替换为 newText；要求 oldText 在文件内唯一匹配，否则报错并提示可用命中位置。支持 dryRun 预览与 expectedSha256 冲突检测，写入后自动用引擎 tsc 编译校验，失败自动回滚。',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '脚本相对路径，如 Assets/插件/全局插件/经验值计算.xxxx.ts' },
        oldText: { type: 'string', description: '要被替换的原文片段（必须与文件内容逐字符一致，且在文件中唯一）' },
        newText: { type: 'string', description: '替换后的新片段；传空字符串表示删除该片段' },
        dryRun: { type: 'boolean', description: '默认 true 只预览差异；false 正式写盘' },
        expectedSha256: { type: 'string', description: '可选；正式写入时校验文件未被他人改动' }
      },
      required: ['path', 'oldText', 'newText']
    }
  },
  {
    name: 'playtest_smoke',
    description: '试玩冒烟测试（本工程特色验证闭环）：按脚本驱动一遍游戏（方向键走位、确认对话等），跑完自动对比运行时诊断，报告「新出现的报错 / 变频繁的报错 / 新卡住的事件 / 性能是否恶化」。改完代码想确认"真的还能玩"时用它。需要先在编辑器里启动试玩。\n'
      // 旧说明写「数字键与 F1~F12 不支持」，但 5966 桥的白名单其实是 ArrowUp/Down/Left/Right|Enter|Escape|Space|Key[A-Z]|Digit[0-9]|F[1-12]；
      // 当时功能键失败是 CDP 兜底路径没给 windowsVirtualKeyCode（已修），说明写错会让模型白白放弃可行的验证方案。
      + '按键白名单：up/down/left/right/ok/cancel/space/字母键/数字键/F1~F12。',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        sequence: {
          description: '动作脚本：可写字符串简写 "down,down,ok"，也可写对象数组 [{ key:"left", action:"press", holdMs:600, waitMs:900 }, { waitMs:500 }]',
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, action: { type: 'string', enum: ['press', 'down', 'up'] }, holdMs: { type: 'number' }, waitMs: { type: 'number' } } } }
          ]
        },
        settleMs: { type: 'number', description: '脚本跑完后再等多久收集数据（毫秒，默认 1200）' }
      },
      required: ['sequence']
    }
  },
  {
    name: 'send_player_input',
    description: '向正在运行的试玩游戏下发虚拟按键操作，用于自动化探索与跑图回归测试。'
      // 【规则实据】5966 桥的按键白名单是 ArrowUp/Down/Left/Right|Enter|Escape|Space|Key[A-Z]|Digit[0-9]|F[1-12]
      // （probe-core.js executeRuntimeAction），也就是**功能键是支持的**；旧说明写「F1~F12 不支持」是
      // 因为 CDP 兜底路径当时没给功能键 windowsVirtualKeyCode（已修）—— 说明写错会让模型白白放弃可行的验证方案。
      + '支持的键：方向键 / Enter(ok) / Escape(cancel) / Space / 字母键 / 数字键 / F1~F12（功能键可用）。',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '按键标识：up / down / left / right / ok / cancel 或具体键名如 "ArrowUp", "Enter"' },
        action: { type: 'string', enum: ['press', 'down', 'up'], description: '动作类型，默认 press' }
      },
      required: ['key']
    }
  },
  {
    name: 'send_player_pointer',
    description: '向试玩游戏发送鼠标移动、按下、弹起或点击，用于界面和地图交互回归。注意：每次都会先派发一次 pointermove（引擎靠它更新指针位置），再执行你要的动作',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['move', 'down', 'up', 'click'], description: '鼠标动作' },
        x: { type: 'number', description: '试玩窗口客户区 X 坐标' },
        y: { type: 'number', description: '试玩窗口客户区 Y 坐标' },
        button: { type: 'number', description: '鼠标键，默认 0' }
      },
      required: ['action', 'x', 'y']
    }
  },
  {
    name: 'finish_stuck_event',
    // 引擎侧 probe 已有 finishEventById（调引擎原生 finish() 拔引用），旧实现只有界面上的「一键结束」按钮，
    // 模型看得见卡住事件却拔不掉。eventId 就用 diagnose_runtime 里卡住事件条目带的 id。
    description: '结束一个卡住的事件（试玩中）：用 diagnose_runtime 报出的卡住事件 id 调用，引擎会调事件原生的 finish() 把它结束掉，并解除它对场景对象的引用。用户说「卡住了/不动了/帮我结束它」时用这个',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: { eventId: { type: 'string', description: '卡住事件的 id（diagnose_runtime 的卡住/幽灵事件列表里有）' } },
      required: ['eventId']
    }
  },
  {
    name: 'suspend_runtime_kind',
    // 引擎侧 probe 的 state.suspend 有 7 个类别开关（actors/animations/emitters/triggers/ui/events/audio），
    // 定位「谁在拖帧/谁在死循环」时按类别二分是最快的办法；旧实现只把它们藏在面板上，模型一条都用不了。
    description: '暂停或恢复试玩里某一类内容的更新，用来二分定位卡顿/死循环的来源。kind：actors 角色更新 / animations 动画 / emitters 粒子发射器 / triggers 触发器 / ui 界面 / events 事件系统 / audio 音频；on=true 暂停、false 恢复。暂停只是让那一类不再更新，不改动任何工程内容',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['actors', 'animations', 'emitters', 'triggers', 'ui', 'events', 'audio'], description: '要暂停/恢复的类别' },
        on: { type: 'boolean', description: 'true 暂停、false 恢复' }
      },
      required: ['kind', 'on']
    }
  },
  {
    name: 'ui_steps',
    description: '在编辑器界面上把操作一步一步"演"给用户看：每步先用收束高亮框圈住目标控件，再执行，最后留痕变绿。目标走引擎公开入口（等价于用户自己点了那里），不是鼠标模拟。任何一步找不到控件就立即熔断、绝不继续往下做，并如实报出是第几步失败的。适合"用户看得见才放心"的属性调整与界面操作。',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: '按顺序执行并演示的步骤列表',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['focus', 'set', 'click', 'goto', 'wait'], description: '这一步做什么：聚焦 / 改值 / 点击 / 切换工作页 / 等待' },
              target: { type: 'string', description: '目标控件的 CSS 选择器，如 #fileItem-attack；goto 与 wait 可不填' },
              value: { description: 'kind=set 时写入的值（字符串或数字）' },
              label: { type: 'string', description: '这一步的白话说明，会显示在高亮框旁边，写给人看别写代码术语' },
              mergeGroup: { type: 'string', description: '同一次需求里关联的步骤填同一个分组名，演出会合并成一轮、不会一顿一顿' },
              page: { type: 'string', description: 'kind=goto 时切换的工作页：home/directory/project/scene/ui/animation/particle' },
              duration: { type: 'number', description: 'kind=wait 时等待的毫秒数' }
            },
            required: ['kind']
          }
        }
      },
      required: ['steps']
    }
  }
]

// 注意：原始 tools/list 保持完整（cdp_eval 也在里面）——它是给外部 MCP 客户端/路线 B 用的。
// "内置模型看不到 cdp_eval" 由宿主侧 ai-host.js 的 HIDDEN_TOOLS 负责过滤，
// 那条边界有 test-ui-operation.cjs 直接抓模型请求体来验，不在这一层做。

/* ============================== 工具执行 ============================== */

function normalizeRelPath(p) {
  return relativePath(ROOT, String(p).replace(/\\/g, '/').replace(/^\.\//, ''))
}

function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object') return target
  const result = Array.isArray(target) ? [...target] : { ...(target || {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = mergePatch(result[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}

function readText(rel) {
  const abs = resolveInside(ROOT, rel)
  if (!fs.existsSync(abs)) return null
  return fs.readFileSync(abs, 'utf8')
}

function hasForbiddenPatchKey(value) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasForbiddenPatchKey)
  return Object.entries(value).some(([key, child]) => key === 'terrains' || key === 'code' || hasForbiddenPatchKey(child))
}

async function ensureEditorWritable(rel) {
  const result = await editorBridge.action('preflight', { path: rel })
  const detail = result && result.data ? result.data : result
  if (detail && detail.dirty) return { ok: false, dirty: true, error: detail.error || `编辑器中「${rel}」有未保存修改，请先保存或取消后重试` }
  // 桥在线但显式拒绝（例如工程不匹配、被占用、或其他错误），坚决拦截
  if (result && result.ok === false && !String(result.error || '').includes('未启动')) {
    return { ok: false, error: result.error || '编辑器预检失败，拒绝写盘以防数据覆盖' }
  }
  // 仅在桥端口未监听（离线/独立 MCP 测试）时降级放行并给出 warning
  if (!result || (result.ok === false && String(result.error || '').includes('未启动'))) {
    return { ok: true, warning: '编辑器桥未运行（离线/测试模式），未执行未保存修改检查' }
  }
  return { ok: true }
}

// 写盘后的编辑器热更新结果（最近一次）。成功要记，失败更要记 —— 以前这里 try/catch 吞掉一切，
// 于是"编辑器内存没刷新成功"谁都看不见，而它恰恰意味着：用户下次在编辑器里保存，会把刚才的改动覆盖掉。
let lastReloadReport = null
async function notifyEditorReload(rel) {
  const report = { rel: rel, ok: true, error: '', at: Date.now() }
  try {
    const res = await editorBridge.action('reload', { path: rel })
    if (res && res.ok === false) {
      report.ok = false
      report.error = res.error || res.message || '编辑器桥拒绝了重载请求'
    }
  } catch (error) {
    report.ok = false
    report.error = error.message
  }
  lastReloadReport = report
  return report
}

async function callTool(name, args) {
  args = args || {}
  switch (name) {
    case 'list_scripts': {
      // 【口径】引擎能不能实例化一个脚本，只看注册表（Data/plugins.json / Data/commands.json，
      // 全局插件还要 enabled !== false；运行时 event.ts:1207-1209）。旧实现按"目录名里有没有
      // 插件/全局插件"分组，于是没注册的（本机实测 2 个）被当成插件、停用的也照列出来。
      const all = listResourceFiles('script')
      const readRegistry = (rel) => {
        const map = new Map()
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
          const items = Array.isArray(raw) ? raw : Object.values(raw || {})
          for (const it of items) if (it && typeof it === 'object' && it.id) map.set(it.id, it.enabled !== false)
        } catch { /* 表不存在/坏了都按"没有注册"处理 */ }
        return map
      }
      const plugins = readRegistry('Data/plugins.json')
      const commands = readRegistry('Data/commands.json')
      const groups = {
        '全局插件（已注册且启用）': [],
        '全局插件（未注册或已停用）': [],
        '自定义指令（已注册且启用）': [],
        '自定义指令（未注册或已停用）': [],
        '场景/界面等其它脚本': []
      }
      for (const f of all) {
        const guid = parseGuidFromName(path.basename(f.path)) || ''
        const isPluginDir = f.path.includes('插件/全局插件')
        const isCommandDir = f.path.includes('插件/自定义指令')
        if (isPluginDir || (!isCommandDir && plugins.has(guid))) groups[plugins.get(guid) ? '全局插件（已注册且启用）' : '全局插件（未注册或已停用）'].push(f)
        else if (isCommandDir || commands.has(guid)) groups[commands.get(guid) ? '自定义指令（已注册且启用）' : '自定义指令（未注册或已停用）'].push(f)
        else groups['场景/界面等其它脚本'].push(f)
      }
      return { ok: true, total: all.length, groups, registry: { plugins: plugins.size, commands: commands.size } }
    }
    case 'parse_plugin_meta': {
      const rel = normalizeRelPath(args.path)
      const abs = path.join(ROOT, rel)
      if (!fs.existsSync(abs)) return { ok: false, error: `文件不存在: ${rel}` }
      const code = fs.readFileSync(abs, 'utf8')
      const meta = parsePluginMeta(code)
      if (!meta.ok) return meta
      const metaIssues = validatePluginMeta(meta, code)
      return {
        ok: true, path: rel, ...meta, metaIssues,
        metaIssuesNote: metaIssues.length
          ? '以上按引擎规则（plugin.ts / type-registry.ts）逐条判过：error = 写了等于白写或装配失败，warn = 引擎容忍但有坑'
          : '元数据符合引擎规则'
      }
    }
    case 'create_script': {
      const rel = normalizeRelPath(args.path)
      // 引擎只扫 Assets 下的脚本（运行时 event.ts:1221-1228 找不到就报 "The script is missing"）。
      // 旧实现不校验路径：干跑时连 Data/xxx.<guid>.ts 都收，还照样写进注册表 → 运行时永远加载不到。
      if (!/^Assets\//.test(rel)) {
        return { ok: false, error: '脚本必须建在 Assets/ 目录下：' + rel + ' 引擎扫不到（运行时会报 The script is missing）' }
      }
      const base = path.basename(rel)
      const guid = parseGuidFromName(base)
      if (!SCRIPT_TEMPLATES[args.type]) return { ok: false, error: `未知类型: ${args.type}（应为 ${Object.keys(SCRIPT_TEMPLATES).join('/')}）` }
      if (!guid || !isValidGuid(guid)) return { ok: false, error: `文件名需含合法 16 位 hex GUID（含 a-f）: ${base}` }
      if (fs.existsSync(resolveInside(ROOT, rel))) return { ok: false, error: `脚本已存在，拒绝覆盖: ${rel}；修改请使用 write_script` }
      const built = buildScriptSource(args.type, args.className, args.nameZh, args.params, { author: args.author, link: args.link })
      const src = built.source
      const diffRes = unifiedDiff('', src, { label: rel })
      const diffStat = { added: diffRes.added, removed: diffRes.removed, truncated: diffRes.truncated }
      const preview = {
        path: rel,
        oldSha256: null,
        newSha256: sha256(src),
        changedBytes: Buffer.byteLength(src),
        diff: diffRes.text,
        diffStat
      }
      const metaIssues = Array.isArray(built.metaIssues) ? built.metaIssues : []
      const metaErrors = metaIssues.filter(item => item.severity === 'error')
      if (metaErrors.length) {
        return { ok: false, dryRun: true, metaIssues, error: '生成的元数据不符合引擎规则（装上去参数不会出现），未写盘：' + metaErrors.map(item => (item.target ? item.target + '：' : '') + item.message).join('；') }
      }
      if (args.dryRun !== false) {
        return {
          ok: true, dryRun: true, message: '模板已生成（未写盘，dryRun）', script: src, ...preview, metaIssues,
          metaCheck: metaIssues.length ? '引擎规则体检有 ' + metaIssues.length + ' 条提醒（见 metaIssues）' : '元数据符合引擎规则'
        }
      }
      try {
        const table = args.type === 'plugin' ? 'plugins' : args.type === 'command' ? 'commands' : null
        if (table) {
          const writable = await ensureEditorWritable(`Data/${table}.json`)
          if (!writable.ok) return writable
        }
        const written = writeAtomic(ROOT, rel, src, { tool: 'create_script' })
        rememberWrite({ path: rel, tool: 'create_script', ok: true })
        const registration = registerCreatedScript(args.type, guid, 'create_script')
        if (!registration.ok) {
          try { fs.unlinkSync(resolveInside(ROOT, rel)) } catch {}
          return { ok: false, registration, error: '脚本注册失败，已撤销脚本文件：' + registration.error }
        }
        const compile = await runCompileCheck()
        if (!compile.ok && !compile.unavailable) {
          try { fs.unlinkSync(resolveInside(ROOT, rel)) } catch {}
          try { if (registration.backup) restoreBackup(ROOT, `Data/${registration.table}.json`, registration.backup) } catch {}
          return { ok: false, compile, error: '新脚本编译未通过，已撤销脚本和注册表' }
        }
        eventBuilder.customCommandMap = null
        await notifyEditorReload(rel)
        if (table) await notifyEditorReload(`Data/${table}.json`)
        return {
          ok: true, dryRun: false, ...written, registration, compile,
          compileSkipped: !!compile.unavailable,
          message: `已写入 ${rel}${compile.unavailable ? '（未能编译校验：本机没找到引擎自带的 tsc）' : '并编译通过'}`
        }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'read_script': {
      const rel = normalizeRelPath(args.path)
      if (!/\.(ts|js)$/i.test(rel) || !rel.startsWith('Assets/')) return { ok: false, error: '只允许读取 Assets 内的 .ts 或 .js 脚本' }
      const text = readText(rel)
      if (text === null) return { ok: false, error: `脚本不存在: ${rel}` }
      const meta = parsePluginMeta(text)
      return { ok: true, path: rel, content: text, sha256: sha256(text), meta, metaIssues: meta.ok ? validatePluginMeta(meta, text) : [] }
    }
    case 'write_script': {
      const rel = normalizeRelPath(args.path)
      if (!/\.(ts|js)$/i.test(rel) || !rel.startsWith('Assets/')) return { ok: false, error: '只允许写入 Assets 内的 .ts 或 .js 脚本' }
      if (typeof args.content !== 'string') return { ok: false, error: 'content 必须是完整脚本字符串' }
      const oldText = readText(rel)
      if (oldText === null) return { ok: false, error: `脚本不存在: ${rel}；新建脚本请使用 create_script` }
      if (args.expectedSha256 && sha256(oldText) !== args.expectedSha256) {
        return { ok: false, conflict: true, error: '脚本已被其他操作修改，expectedSha256 不匹配；请重新读取后再改' }
      }
      const nextMeta = parsePluginMeta(args.content)
      if (!nextMeta.ok) return { ok: false, error: '脚本缺少合法 /* @plugin ... */ 元数据块，未写入' }
      const metaIssues = validatePluginMeta(nextMeta, args.content)
      const metaErrors = metaIssues.filter(item => item.severity === 'error')
      if (metaErrors.length) {
        return { ok: false, metaIssues, error: '元数据不符合引擎规则（引擎会忽略或装不上），未写入：' + metaErrors.map(item => (item.target ? item.target + '：' : '') + item.message).join('；') }
      }
      const preview = { path: rel, oldSha256: sha256(oldText), newSha256: sha256(args.content), changedBytes: Buffer.byteLength(args.content) - Buffer.byteLength(oldText), meta: nextMeta }
      if (args.dryRun !== false) return { ok: true, dryRun: true, ...preview, message: '脚本校验通过，未写盘' }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        const written = writeAtomic(ROOT, rel, args.content, { tool: 'write_script' })
        let compile = null
        compile = await runCompileCheck()
        if (compile && !compile.ok && !compile.unavailable) {
          let rollback = null
          try { if (written.backup) rollback = restoreBackup(ROOT, rel, written.backup) } catch (e) { rollback = { error: e.message } }
          rememberWrite({ path: rel, tool: 'write_script', ok: false, compileOk: false, errorCount: compile.errorCount || 0, firstError: firstCompileError(compile), rolledBack: !!rollback && !rollback.error })
          return { ok: false, ...preview, compile, rollback, error: '编译未通过，已尝试自动恢复修改前脚本' }
        }
        await notifyEditorReload(rel)
        rememberWrite({ path: rel, tool: 'write_script', ok: true, compileOk: compile ? compile.ok : undefined, errorCount: compile ? (compile.errorCount || 0) : 0 })
        return {
          ok: true, dryRun: false, ...preview, ...written, compile,
          compileSkipped: !!(compile && compile.unavailable),
          message: `已写入 ${rel}`
        }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'edit_script': {
      const rel = normalizeRelPath(args.path)
      if (!/\.(ts|js)$/i.test(rel) || !rel.startsWith('Assets/')) return { ok: false, error: '只允许编辑 Assets 内的 .ts 或 .js 脚本' }
      if (typeof args.oldText !== 'string' || !args.oldText.length) return { ok: false, error: 'oldText 必须是非空字符串（要替换的原文片段）' }
      if (typeof args.newText !== 'string') return { ok: false, error: 'newText 必须是字符串；删除片段请传空字符串' }
      const oldText = readText(rel)
      if (oldText === null) return { ok: false, error: `脚本不存在: ${rel}` }
      let target = args.oldText
      let firstHit = oldText.indexOf(target)
      // 兼容 Windows CRLF / Linux LF 换行符差异：若直接找不到，尝试转换换行符匹配
      if (firstHit === -1 && oldText.includes('\r\n') && target.includes('\n') && !target.includes('\r\n')) {
        const crlfTarget = target.replace(/\n/g, '\r\n')
        const crlfHit = oldText.indexOf(crlfTarget)
        if (crlfHit !== -1) {
          target = crlfTarget
          firstHit = crlfHit
        }
      } else if (firstHit === -1 && !oldText.includes('\r\n') && target.includes('\r\n')) {
        const lfTarget = target.replace(/\r\n/g, '\n')
        const lfHit = oldText.indexOf(lfTarget)
        if (lfHit !== -1) {
          target = lfTarget
          firstHit = lfHit
        }
      }
      if (firstHit === -1) {
        return { ok: false, error: '未在脚本中找到 oldText；请用 read_script 或 search_project 取到与文件逐字符一致的片段（注意缩进与换行）' }
      }
      if (oldText.indexOf(target, firstHit + target.length) !== -1) {
        // 多处匹配会改错地方，直接拒绝并给出所有命中行号，让模型缩小片段
        const lineNumbers = []
        let cursor = firstHit
        while (cursor !== -1 && lineNumbers.length < 20) {
          lineNumbers.push(oldText.slice(0, cursor).split('\n').length)
          cursor = oldText.indexOf(target, cursor + target.length)
        }
        return { ok: false, ambiguous: true, lines: lineNumbers, error: `oldText 在脚本中出现多次（行 ${lineNumbers.join('、')}），为保证改对位置请带上更多上下文使其唯一` }
      }
      if (args.expectedSha256 && sha256(oldText) !== args.expectedSha256) {
        return { ok: false, conflict: true, error: '脚本已被其他操作修改，expectedSha256 不匹配；请重新读取后再改' }
      }
      const line = oldText.slice(0, firstHit).split('\n').length
      const nextText = oldText.slice(0, firstHit) + args.newText + oldText.slice(firstHit + target.length)
      const preview = withDiff({
        path: rel,
        line,
        oldSha256: sha256(oldText),
        newSha256: sha256(nextText),
        changedBytes: Buffer.byteLength(nextText) - Buffer.byteLength(oldText),
        removedLines: target.split('\n').length,
        addedLines: args.newText.split('\n').length
      }, oldText, nextText, { label: `精确修改 ${rel}（第 ${line} 行）` })
      // 片段替换不改元数据块，但仍校验一次：避免把 @plugin 块改坏却毫无提示
      const nextMeta = parsePluginMeta(nextText)
      if (!nextMeta.ok) return { ok: false, ...preview, error: '替换后脚本的 /* @plugin ... */ 元数据块不合法，未写入' }
      const metaIssues = validatePluginMeta(nextMeta, nextText)
      const metaErrors = metaIssues.filter(item => item.severity === 'error')
      if (metaErrors.length) {
        return { ok: false, ...preview, metaIssues, error: '替换后元数据不符合引擎规则（引擎会忽略或装不上），未写入：' + metaErrors.map(item => (item.target ? item.target + '：' : '') + item.message).join('；') }
      }
      if (args.dryRun !== false) {
        return {
          ok: true,
          dryRun: true,
          ...preview,
          // 注意：这里不能再写 `diff` 字段——那会覆盖 withDiff 生成的统一差异文本。
          // 片段级前后对照另起字段名，避免与审批卡片的差异预览打架（这个坑实测踩过）。
          fragmentDiff: { before: target.slice(0, 600), after: args.newText.slice(0, 600) },
          message: `片段替换校验通过（第 ${line} 行，-${target.split('\n').length}/+${args.newText.split('\n').length} 行），未写盘`
        }
      }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        const written = writeAtomic(ROOT, rel, nextText, { tool: 'edit_script' })
        const compile = await runCompileCheck()
        if (compile && !compile.ok && !compile.unavailable) {
          let rollback = null
          try { if (written.backup) rollback = restoreBackup(ROOT, rel, written.backup) } catch (e) { rollback = { error: e.message } }
          rememberWrite({ path: rel, tool: 'edit_script', ok: false, compileOk: false, errorCount: compile.errorCount || 0, firstError: firstCompileError(compile), rolledBack: !!rollback && !rollback.error })
          return { ok: false, ...preview, compile, rollback, error: '编译未通过，已尝试自动恢复修改前脚本' }
        }
        await notifyEditorReload(rel)
        rememberWrite({ path: rel, tool: 'edit_script', ok: true, compileOk: compile ? compile.ok : undefined, errorCount: compile ? (compile.errorCount || 0) : 0, firstError: compile && !compile.ok ? firstCompileError(compile) : '' })
        return {
          ok: true, dryRun: false, ...preview, ...written, compile,
          compileSkipped: !!(compile && compile.unavailable),
          message: `已精确修改 ${rel}（第 ${line} 行）`
        }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'search_project': {
      const query = String(args.query || '')
      if (!query) return { ok: false, error: 'query 不能为空' }
      const scope = ['script', 'data', 'event', 'all'].includes(args.scope) ? args.scope : 'script'
      const maxResults = Math.min(Math.max(Number(args.maxResults) || 40, 1), 200)
      const contextLines = Math.min(Math.max(Number(args.contextLines) || 0, 0), 5)
      let pattern
      try {
        pattern = new RegExp(query, args.ignoreCase ? 'gi' : 'g')
      } catch (e) {
        // 非法正则（用户可能直接搜 "a(b" 这类字面量）→ 退化为纯文本搜索
        pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.ignoreCase ? 'gi' : 'g')
      }
      const scopeFilter = {
        script: file => /\.(ts|js)$/i.test(file),
        data: file => /^Data[\\/].+\.json$/i.test(path.relative(ROOT, file)),
        event: file => /\.event$/i.test(file),
        all: () => true
      }[scope]
      const files = walk(ROOT).filter(file => {
        if (!scopeFilter(file)) return false
        if (/[\\/](\.yami-mcp-backups|node_modules|\.git|Dist)[\\/]/.test(file)) return false
        if (file.endsWith('Data/manifest.json')) return false
        try { return fs.statSync(file).size <= 2 * 1024 * 1024 } catch { return false }
      })
      const results = []
      let scanned = 0
      for (const file of files) {
        if (results.length >= maxResults) break
        let text
        try { text = fs.readFileSync(file, 'utf8') } catch { continue }
        scanned++
        if (!pattern.test(text)) { pattern.lastIndex = 0; continue }
        pattern.lastIndex = 0
        const lines = text.split(/\r?\n/)
        for (let index = 0; index < lines.length && results.length < maxResults; index++) {
          const lineText = lines[index]
          pattern.lastIndex = 0
          const matches = []
          let hit
          while ((hit = pattern.exec(lineText)) !== null) {
            matches.push([hit.index, hit.index + hit[0].length])
            if (hit[0].length === 0) pattern.lastIndex++
            if (matches.length >= 8) break
          }
          if (!matches.length) continue
          const entry = {
            path: path.relative(ROOT, file).split(path.sep).join('/'),
            line: index + 1,
            text: lineText.trim().slice(0, 240),
            matches
          }
          if (contextLines > 0) {
            const from = Math.max(0, index - contextLines)
            const to = Math.min(lines.length - 1, index + contextLines)
            entry.context = []
            for (let cursor = from; cursor <= to; cursor++) {
              entry.context.push({ line: cursor + 1, text: lines[cursor].trim().slice(0, 200), current: cursor === index })
            }
          }
          results.push(entry)
        }
      }
      return {
        ok: true,
        query,
        scope,
        scannedFiles: scanned,
        totalMatched: results.length,
        truncated: results.length >= maxResults,
        results,
        hint: results.length
          ? '用 read_script / read_resource 读取命中的文件（或直接用 edit_script 做片段替换）'
          : '没有命中：换个关键词，或先用 list_scripts / list_resources 看有哪些文件'
      }
    }
    case 'patch_resource': {
      const rel = normalizeRelPath(args.path)
      if (!rel.startsWith('Assets/') || !DATA_TYPES.includes(TYPE_BY_EXT[path.extname(rel).toLowerCase()])) return { ok: false, error: '只允许补丁修改 Assets 内的 JSON 资源' }
      if (hasForbiddenPatchKey(args.patch)) return { ok: false, error: '禁止通过局部补丁修改场景压缩字段 terrains/code' }
      const oldText = readText(rel)
      if (oldText === null) return { ok: false, error: `资源不存在: ${rel}` }
      if (args.expectedSha256 && sha256(oldText) !== args.expectedSha256) return { ok: false, conflict: true, error: '资源已被其他操作修改，expectedSha256 不匹配' }
      let current
      try { current = JSON.parse(oldText) } catch (e) { return { ok: false, error: `资源 JSON 解析失败: ${e.message}` } }
      const next = mergePatch(current, args.patch)
      const nextText = JSON.stringify(next, null, 2) + '\n'
      const check = validateResourceFile(rel)
      if (!check.ok) return { ok: false, issues: check.issues, error: '原资源当前校验未通过，先修复原文件再打补丁' }
      const nextIssues = []
      const required = REQUIRED_FIELDS[TYPE_BY_EXT[path.extname(rel).toLowerCase()]] || []
      for (const field of required) if (!(field in next)) nextIssues.push(`缺少必需字段: ${field}`)
      if (nextIssues.length) return { ok: false, error: nextIssues.join('；') }
      const preview = withDiff({ path: rel, oldSha256: sha256(oldText), newSha256: sha256(nextText), changedBytes: Buffer.byteLength(nextText) - Buffer.byteLength(oldText), preview: next }, oldText, nextText, { label: `修改资源 ${rel}` })
      if (args.dryRun !== false) return { ok: true, dryRun: true, ...preview, message: '资源补丁校验通过，未写盘' }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        const written = writeAtomic(ROOT, rel, nextText, { tool: 'patch_resource' })
        rememberWrite({ path: rel, tool: 'patch_resource', ok: true })
        await notifyEditorReload(rel)
        return { ok: true, dryRun: false, ...preview, ...written, message: `已安全更新 ${rel}` }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'delete_resource': {
      const rel = normalizeRelPath(args.path)
      if (rel === 'Data/manifest.json' || rel.startsWith('.yami-mcp-backups/')) return { ok: false, error: '禁止删除工程清单或 MCP 备份目录' }
      const abs = resolveInside(ROOT, rel)
      if (!fs.existsSync(abs)) return { ok: false, error: `文件不存在: ${rel}` }
      const stat = fs.statSync(abs)
      if (!stat.isFile()) return { ok: false, error: '暂不支持删除目录，请使用编辑器文件管理操作' }
      const guid = parseGuidFromName(path.basename(rel))
      let referencingFiles = []
      if (guid) {
        for (const f of listResourceFiles()) {
          if (f.path === rel || !DATA_TYPES.includes(f.type)) continue
          const fAbs = path.join(ROOT, f.path)
          // 精确判定：解析 JSON 后找"值正好等于这个 GUID"的字段。
          // 旧的纯文本 includes 会把注释/脚本/压缩串里偶然出现的 16 位串也算成引用（误报保护），
          // 与 validate_project 里刻意收紧的 REF_KEYS 口径相反。
          let parsed = null
          try { parsed = JSON.parse(fs.readFileSync(fAbs, 'utf8')) } catch { parsed = null }
          if (!parsed) continue
          const stack = [parsed]
          let hit = false
          while (stack.length && !hit) {
            const node = stack.pop()
            if (!node || typeof node !== 'object') continue
            if (Array.isArray(node)) { for (const item of node) stack.push(item); continue }
            for (const k of Object.keys(node)) {
              const v = node[k]
              if (v === guid) { hit = true; break }
              if (v && typeof v === 'object') stack.push(v)
            }
          }
          if (hit) referencingFiles.push(f.path)
          if (referencingFiles.length >= 5) break
        }
        if (referencingFiles.length > 0 && !args.force) {
          return {
            ok: false,
            hasReferences: true,
            referencingFiles,
            error: `该资源正被 ${referencingFiles.length} 个文件引用（如 ${referencingFiles[0]}），为防止工程损坏已被保护；如确认强制删除请传 force: true`
          }
        }
      }
      const backupDir = path.join(ROOT, '.yami-mcp-backups')
      const backup = path.join(backupDir, `${Date.now()}-${path.basename(rel)}.deleted.bak`)
      const currentSha256 = sha256(fs.readFileSync(abs))
      if (args.expectedSha256 && currentSha256 !== args.expectedSha256) return { ok: false, conflict: true, error: '资源已被其他操作修改，拒绝删除' }

      // 删除属于不可轻易撤销的动作：
      //   1) dryRun 预览给出「要删掉什么」的摘要（名称、类型、体积、前几行内容）；
      //   2) 正式执行必须带回预览时发的一次性确认令牌 —— 只传 force 不足以删掉东西。
      const rawText = fs.readFileSync(abs, 'utf8')
      const impact = {
        name: path.basename(rel),
        type: TYPE_BY_EXT[path.extname(rel).toLowerCase()] || 'other',
        bytes: stat.size,
        preview: rawText.split(/\r?\n/).slice(0, 12).join('\n').slice(0, 600),
        backup: '.yami-mcp-backups/' + path.basename(backup),
        referencingFiles: referencingFiles.length > 0 ? referencingFiles : undefined,
        forced: referencingFiles.length > 0 && !!args.force
      }
      const previewMsg = referencingFiles.length > 0
        ? `【高危强删】该资源仍被 ${referencingFiles.length} 个文件引用（如 ${referencingFiles[0]}），删除可能导致工程损坏，请务必谨慎确认。`
        : `将删除 ${path.basename(rel)}（${stat.size} 字节），删除前会自动备份；这是不可轻易撤销的操作，需要你确认。`
      const previewResult = {
        ok: true,
        dryRun: true,
        path: rel,
        risk: 'high',
        bytes: stat.size,
        oldSha256: currentSha256,
        impact,
        message: previewMsg
      }
      if (args.dryRun !== false) {
        return { ...previewResult, confirmationToken: issueConfirmationToken('delete_resource', rel, currentSha256) }
      }
      const tokenCheck = takeConfirmationToken(args.confirmationToken, 'delete_resource', rel)
      if (!tokenCheck.ok) {
        // 语义要准：这次调用**没有执行**，所以 ok:false，别让调用方以为已经进入执行阶段
        return {
          ok: false,
          dryRun: true,
          confirmRequired: true,
          path: rel,
          risk: 'high',
          bytes: stat.size,
          impact,
          confirmationToken: issueConfirmationToken('delete_resource', rel, currentSha256),
          error: tokenCheck.error + '（请把返回的 confirmationToken 原样带上再执行一次）'
        }
      }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        fs.mkdirSync(backupDir, { recursive: true })
        fs.copyFileSync(abs, backup)
        fs.unlinkSync(abs)
        // 备份路径以工程根为基准返回（相对路径，跨平台且便于直接交给 read 工具恢复）
        const backupRel = '.yami-mcp-backups/' + path.basename(backup)
        return { ok: true, dryRun: false, path: rel, risk: 'high', backup: backupRel, impact, message: `已删除 ${rel}，备份为 ${backupRel}（可随时恢复）` }
      } catch (e) { return { ok: false, error: `删除失败: ${e.message}` } }
    }
    case 'generate_guid': {
      const count = Math.max(1, Math.min(50, Number(args.count) || 1))
      const check = args.check !== false
      const known = check ? new Set(collectAllGuids().keys()) : null
      const guids = []
      for (let i = 0; i < count; i++) {
        for (let t = 0; t < 32; t++) {
          const g = generateGuid()
          if (!known || !known.has(g)) { guids.push(g); if (known) known.add(g); break }
        }
      }
      return { ok: true, guids, checked: check }
    }
    case 'compile_check': {
      return runCompileCheck()
    }
    case 'list_resources': {
      const all = listResourceFiles(args.type)
      const filtered = args.filter ? all.filter(f => f.path.includes(args.filter)) : all
      const offset = Math.max(0, Number(args.offset) || 0)
      const limit = Math.max(1, Math.min(500, Number(args.limit) || 100))
      return { ok: true, count: filtered.length, offset, limit, resources: filtered.slice(offset, offset + limit), hasMore: offset + limit < filtered.length }
    }
    case 'list_event_commands': {
      const all = flattenCommandCatalog()
      const keyword = String(args.filter || '').toLowerCase()
      const filtered = keyword ? all.filter(item => (item.id + ' ' + item.category).toLowerCase().includes(keyword)) : all
      const offset = Math.max(0, Number(args.offset) || 0)
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 60))
      return { ok: true, count: filtered.length, offset, limit, commands: filtered.slice(offset, offset + limit), hasMore: offset + limit < filtered.length }
    }
    case 'get_event_command_examples': {
      const id = String(args.id || '').trim()
      if (!id) return { ok: false, error: '缺少指令 ID' }
      const examples = commandExamples(id, Math.max(1, Math.min(10, Number(args.limit) || 5)))
      return { ok: true, id, count: examples.length, examples }
    }
    case 'read_resource': {
      const rel = normalizeRelPath(args.path)
      const abs = resolveInside(ROOT, rel)
      if (!fs.existsSync(abs)) return { ok: false, error: `文件不存在: ${rel}` }
      const ext = path.extname(abs).toLowerCase()
      if (!DATA_TYPES.includes(TYPE_BY_EXT[ext]) && !(rel.startsWith('Data/') && rel.endsWith('.json'))) {
        return { ok: false, error: `不支持的文件类型: ${rel}（仅数据文件层 JSON 资源）` }
      }
      try {
        const raw = fs.readFileSync(abs, 'utf8')
        const fullSha = sha256(raw)
        const parsed = JSON.parse(raw)
        if (args.key !== undefined && args.key !== null && args.key !== '' && parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed)) {
            const idx = Number(args.key)
            if (!Number.isInteger(idx) || idx < 0 || idx >= parsed.length) {
              return { ok: false, error: `数组索引超出范围: ${args.key}（有效范围 0~${parsed.length - 1}）` }
            }
            return { ok: true, path: rel, key: String(idx), content: parsed[idx], sha256: fullSha }
          }
          if (!(args.key in parsed)) return { ok: false, error: `文件中不存在指定的 key: ${args.key}` }
          return { ok: true, path: rel, key: args.key, content: parsed[args.key], sha256: fullSha }
        }
        if (raw.length > 200000 && (GUARDED || !args.forceFull)) {
          const keys = Object.keys(parsed)
          const hint = GUARDED
            ? '请改用 key 参数按顶层字段精确定位子节（可先看 topLevelKeys）。'
            : '可传 key 参数精确定位子节，或传 forceFull=true 读取完整内容。'
          return {
            ok: true,
            path: rel,
            truncated: true,
            sizeBytes: raw.length,
            sha256: fullSha,
            message: `文件体积较大 (${Math.round(raw.length / 1024)} KB)，已开启上下文截断保护。${hint}`,
            topLevelKeys: keys.slice(0, 50)
          }
        }
        return { ok: true, path: rel, content: parsed, sha256: fullSha }
      } catch (e) {
        return { ok: false, error: `JSON 解析失败: ${e.message}` }
      }
    }
    case 'validate_resource': {
      const rel = normalizeRelPath(args.path)
      const r = validateResourceFile(rel)
      return { ok: r.ok, path: rel, ...r }
    }
    case 'validate_project':
      return validateProject()
    case 'write_resource': {
      const rel = normalizeRelPath(args.path)
      if (!args.content || typeof args.content !== 'object' || Array.isArray(args.content)) return { ok: false, error: 'content 必须是 JSON 对象' }
      const base = path.basename(rel)
      const ext = path.extname(base).toLowerCase()
      const type = TYPE_BY_EXT[ext]
      const issues = []
      // 校验：类型支持
      if (!DATA_TYPES.includes(type)) issues.push({ severity: 'error', code: 'unsupported-type', message: `不支持的类型 ${ext}（仅 ${DATA_TYPES.join('/')}）` })
      // 校验：GUID 命名
      const guid = parseGuidFromName(base)
      if (!guid || !isValidGuid(guid)) issues.push({ severity: 'error', code: 'invalid-guid', message: `文件名需含合法 16 位 hex GUID（含 a-f）: ${base}` })
      // 校验：必需字段
      const required = REQUIRED_FIELDS[type] || []
      for (const f of required) {
        if (!(f in args.content)) issues.push({ severity: 'error', code: 'missing-field', message: `缺少必需字段: ${f}` })
      }
      // 校验：压缩字段（RLE）不许被写短。
      // 实据：scene 的 terrains 与 tilemap 的 code 是引擎 Codec 编码出来的 RLE 文本（codec.ts:215-260），
      // 空间地图的 scene 里它占全文 32%（本机实测：27.5k 的 scene 有 17.1k 是 RLE）。
      // 真实故障链：read_resource 对 >200KB 的文件只回字段名清单 → 模型拿到不完整内容却照原样 write_resource
      // → 引擎加载时 decodeTerrains/decodeTiles 直接抛 RangeError（codec.ts:205-211），地图就坏了。
      // 所以这里只拦「写短了」：内容一模一样或更长的压缩串一律放行。
      {
        const oldRaw = readText(rel)
        if (oldRaw) {
          let oldData = null
          try { oldData = JSON.parse(oldRaw) } catch { oldData = null }
          // 【数值数组回写】read_tilemap 把解码后的 tiles/terrains 数组交给模型；模型改完数组直接写回时，
          // code / terrains 两个字符串没变 → 下面 checkRle 的 to === from 会直接放行 → 引擎只认字符串，
          // 地图"报成功但一点没改"，还把数组塞进 .scene。引擎自己就是从数组重算压缩串的
          // （运行时 scene.ts:3675 code: Codec.encodeTiles(this.tiles)；编辑器 codec.ts:97-99 加载时再从 code 反解），
          // 所以这里写盘前先把数组编码成引擎要的串，并把引擎不会落盘的 tiles 字段摘掉。
          if (type === 'scene') {
            const encW = Number(args.content.width) || Number(oldData && oldData.width) || 0
            const encH = Number(args.content.height) || Number(oldData && oldData.height) || 0
            if (Array.isArray(args.content.terrains) && encW && encH) {
              try { args.content.terrains = rle.encodeTerrains(args.content.terrains) } catch (e) {
                issues.push({ severity: 'error', code: 'rle-invalid', message: 'terrains 数值数组编不回去: ' + e.message })
              }
            }
            const reencode = (root) => {
              const stack = Array.isArray(root) ? root.slice() : [root]
              while (stack.length) {
                const node = stack.pop()
                if (!node || typeof node !== 'object') continue
                if (Array.isArray(node.children)) stack.push(...node.children)
                if (!Array.isArray(node.tiles)) continue
                const w = Number(node.width) || 0
                const h = Number(node.height) || 0
                if (!w || !h) continue
                try {
                  node.code = rle.encodeTiles(node.tiles)
                  delete node.tiles
                } catch (e) {
                  issues.push({ severity: 'error', code: 'rle-invalid', message: '瓦片图「' + (node.name || node.id || '') + '」的 tiles 数组编不回去: ' + e.message })
                }
              }
            }
            reencode(args.content.objects || [])
          }
          if (oldData) {
            // 有了真编解码，判据就从「不许写短」升级成「**必须解得开**」：
            //   解得开 → 放行（写短也可能是合法的重新编码：把一片空地压得更紧），并如实报告改了哪些元素；
            //   解不开 → 拦下（引擎加载时会抛 RangeError，地图直接坏掉）。
            const checkRle = (where, from, to, decode, encode) => {
              if (typeof to !== 'string' || !to) {
                if (typeof from === 'string' && from) issues.push({ severity: 'error', code: 'rle-missing', message: `${where}的压缩字段没了：引擎算出来的串必须保留` })
                return
              }
              if (to === from) return
              let oldValues = null
              let newValues = null
              try { newValues = decode(to) } catch (e) {
                issues.push({ severity: 'error', code: 'rle-invalid', message: `${where}的压缩串解不开（引擎加载时会直接抛错）：${e.message}` })
                return
              }
              const again = encode(newValues)
              if (decode(again).length !== newValues.length) {
                issues.push({ severity: 'error', code: 'rle-invalid', message: `${where}的压缩串重编码后对不上，拒绝写入` })
                return
              }
              try { if (typeof from === 'string' && from) oldValues = decode(from) } catch { oldValues = null }
              if (oldValues && oldValues.length === newValues.length) {
                let changed = 0
                for (let i = 0; i < newValues.length; i++) if (oldValues[i] !== newValues[i]) changed++
                if (changed === 0 && to.length < from.length) {
                  issues.push({ severity: 'info', code: 'rle-recompressed', message: `${where}内容没变、压缩串变短了（${from.length} → ${to.length} 字符）—— 已按引擎编解码校验通过，放行` })
                } else if (changed > 0) {
                  issues.push({ severity: 'info', code: 'rle-changed', message: `${where}共改了 ${changed} 个元素（已校验可解码）` })
                }
              }
            }
            const collectRle = (root, map) => {
              const stack = Array.isArray(root) ? root.slice() : [root]
              while (stack.length) {
                const node = stack.pop()
                if (!node || typeof node !== 'object') continue
                if (typeof node.code === 'string' && node.code) map.push(node)
                if (Array.isArray(node.children)) stack.push(...node.children)
              }
            }
            if (type === 'scene') {
              const width = Number(args.content.width) || Number(oldData.width) || 0
              const height = Number(args.content.height) || Number(oldData.height) || 0
              if (width && height) {
                checkRle('场景 terrains', oldData.terrains, args.content.terrains,
                  code => rle.decodeTerrains(code, width, height), values => rle.encodeTerrains(values))
              }
              const oldNodes = [], newNodes = []
              collectRle(oldData.objects || [], oldNodes)
              collectRle(args.content.objects || [], newNodes)
              for (let i = 0; i < Math.min(oldNodes.length, newNodes.length); i++) {
                const nw = Number(newNodes[i].width) || 0
                const nh = Number(newNodes[i].height) || 0
                if (!nw || !nh) {
                  // 尺寸缺失就没法解码校验 → 退回老判据：只拦"写短了"（写短基本就是把内容弄丢了）
                  const from = oldNodes[i].code
                  const to = newNodes[i].code
                  if (typeof from === 'string' && typeof to === 'string' && to.length < from.length) {
                    issues.push({ severity: 'error', code: 'rle-shrunk', message: '瓦片地图的压缩字段被写短了（' + from.length + ' → ' + to.length + ' 字符）：拿不到地图尺寸、无法解码校验，拒绝写入' })
                  }
                  continue
                }
                checkRle('瓦片地图', oldNodes[i].code, newNodes[i].code,
                  code => rle.decodeTiles(code, nw, nh), values => rle.encodeTiles(values))
              }
            }
          }
        }
      }
      // 校验：presetId 文件内唯一
      if (type === 'ui' || type === 'scene') {
        const seen = new Set()
        const visit = (n) => {
          if (!n || typeof n !== 'object') return
          if (typeof n.presetId === 'string') {
            if (seen.has(n.presetId)) issues.push({ severity: 'error', code: 'duplicate-preset-id', message: `presetId 重复: ${n.presetId}` })
            seen.add(n.presetId)
          }
          for (const key of ['children', 'nodes', 'objects']) if (Array.isArray(n[key])) n[key].forEach(visit)
        }
        for (const arr of [args.content.nodes, args.content.objects]) if (Array.isArray(arr)) arr.forEach(visit)
        // 跨文件查重：引擎把场景/界面的默认对象注册成**全局**键（scenePresets / uiPresets），
        // 撞 id 时注册阶段会直接覆盖前一个（scene-window.ts:1270-1276）——
        // 而引擎自己在加载时又会对「已存在的 presetId」重新发号（1270 行的 node.presetId in scenePresets），
        // 于是引用旧 id 的指令会指到另一个场景的对象上。写盘前必须拦。
        const collided = []
        for (const other of listResourceFiles()) {
          if (other.path === rel) continue
          if (other.type !== 'scene' && other.type !== 'ui') continue
          let otherData
          try { otherData = JSON.parse(fs.readFileSync(path.join(ROOT, other.path), 'utf8')) } catch { continue }
          const stack = [...(otherData.objects || []), ...(otherData.nodes || [])]
          while (stack.length) {
            const node = stack.pop()
            if (!node || typeof node !== 'object') continue
            if (typeof node.presetId === 'string' && node.presetId && seen.has(node.presetId)) collided.push({ presetId: node.presetId, file: other.path })
            for (const key of ['children', 'nodes', 'objects']) if (Array.isArray(node[key])) stack.push(...node[key])
          }
        }
        if (collided.length) {
          issues.push({ severity: 'error', code: 'preset-id-conflict', message: `presetId 与其它资源冲突: ${collided.slice(0, 3).map(c => c.presetId + '@' + c.file).join('、')} —— 引擎注册时会覆盖，引用它的指令会指错对象；请换一个 id` })
        }
      }
      const errors = issues.filter(i => i.severity === 'error')
      if (errors.length > 0) return { ok: false, issues: errors, dryRun: true, message: '校验未通过，未写入' }
      const text = JSON.stringify(args.content, null, 2) + '\n'
      const oldText = readText(rel)
      const oldSha256 = oldText === null ? null : sha256(oldText)
      const diffRes = unifiedDiff(oldText || '', text, { label: rel })
      const diffStat = { added: diffRes.added, removed: diffRes.removed, truncated: diffRes.truncated }
      if (args.expectedSha256 && oldSha256 !== args.expectedSha256) return { ok: false, conflict: true, error: '资源已被其他操作修改，拒绝覆盖' }
      if (args.dryRun !== false) return { ok: true, dryRun: true, message: '校验通过（未写盘，dryRun）', preview: text, diff: diffRes.text, diffStat, oldSha256, newSha256: sha256(text) }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        const written = writeAtomic(ROOT, rel, text, { tool: 'write_resource' })
        let memoryStatus = null
        try {
          const reloadRes = await cdpClient.reloadEditorResource(rel, guid)
          if (reloadRes && reloadRes.ok) memoryStatus = '已自动热更新进编辑器内存，阻止反向覆盖'
        } catch (e) {}
        await notifyEditorReload(rel)
        rememberWrite({ path: rel, tool: 'write_resource', ok: true })
        return { ok: true, dryRun: false, path: rel, diff: diffRes.text, diffStat, ...written, memoryStatus, message: `已写入 ${rel}${memoryStatus ? '（' + memoryStatus + '）' : ''}` }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'cdp_eval':
      return await cdpClient.eval(args.expression)
    case 'dump_ui_hierarchy':
      {
        const direct = await editorBridge.dumpUiHierarchy()
        return direct.ok !== false ? direct : await cdpClient.dumpUiHierarchy()
      }
    case 'click_element':
      {
        const direct = await editorBridge.clickElement(args)
        return direct.ok !== false ? direct : await cdpClient.clickElement(args)
      }
    case 'trigger_playtest': {
      // 与 editor_action(playtest) 一致：先走 5967 桥（编辑器进程内直接调引擎），
      // 桥不在才退 CDP。此前这里只走 CDP，等于要求用户必须开 9222 调试端口才能启动试玩。
      const direct = await editorBridge.action('playtest')
      if (direct.ok !== false) return direct
      return await cdpClient.triggerPlaytest()
    }
    case 'editor_action': {
      // 取引擎接口：源码版停在 window.YamiEngine 下，老打包版直接挂全局，两套都认。
      const pick = "const E = (window.YamiEngine || {});"
      const expressions = {
        save: "(() => { " + pick + " const F = E.File; if (!F || !F.save) return {ok:false, error:'File.save 不可用（引擎未暴露 YamiEngine.File）'}; const r = F.save(false); return Promise.resolve(r).then(() => ({ok:true, action:'save'})); })()",
        undo: "(() => { " + pick + " const U = E.UndoManager; if (!U || !U.undo) return {ok:false, error:'UndoManager.undo 不可用（引擎未暴露 YamiEngine.UndoManager）'}; U.undo(); return {ok:true, action:'undo'}; })()",
        redo: "(() => { " + pick + " const U = E.UndoManager; if (!U || !U.redo) return {ok:false, error:'UndoManager.redo 不可用（引擎未暴露 YamiEngine.UndoManager）'}; U.redo(); return {ok:true, action:'redo'}; })()",
        refresh: "(() => { " + pick + " const D = E.Directory; if (!D || !D.update) return {ok:false, error:'Directory.update 不可用（引擎未暴露 YamiEngine.Directory）'}; return Promise.resolve(D.update()).then(() => ({ok:true, action:'refresh'})); })()",
        playtest: "(() => { " + pick + " const T = E.Title; if (!T || !T.playGame) return {ok:false, error:'Title.playGame 不可用（引擎未暴露 YamiEngine.Title）'}; const r = T.playGame(); return Promise.resolve(r).then(() => ({ok:true, action:'playtest'})); })()"
      }
      // 把磁盘重读进编辑器内存：引擎桥自己逐类型重建（Data 表重建映射、资源按扩展名回填 Data.xxx + Directory.update）
      if (args.action === 'reload_resource') {
        const rel = normalizeRelPath(args.path)
        if (!rel) return { ok: false, error: 'reload_resource 需要 path（工程内相对路径）' }
        const res = await editorBridge.action('reload', { path: rel })
        if (res && res.ok === false) return res
        return { ok: true, action: 'reload_resource', path: rel, message: `已把 ${rel} 从磁盘重读进编辑器内存` }
      }
      if (!expressions[args.action]) return { ok: false, error: `不支持的编辑器动作: ${args.action}` }
      const directActions = new Set(['save', 'undo', 'redo', 'refresh', 'playtest'])
      if (directActions.has(args.action)) {
        const direct = await editorBridge.action(args.action)
        if (direct.ok !== false) return direct
      }
      return await cdpClient.eval(expressions[args.action], true, 'editor')
    }
    case 'interact_editor':
      return await editorBridge.action('interact', args)
    case 'append_event_commands': {
      if (args.dryRun === false) {
        const writable = await ensureEditorWritable(normalizeRelPath(args.path))
        if (!writable.ok) return writable
      }
      const appendRes = eventBuilder.appendCommands(args)
      if (appendRes.ok && args.dryRun === false) {
        try {
          const guid = parseGuidFromName(path.basename(args.path))
          await cdpClient.reloadEditorResource(args.path, guid)
        } catch (e) {}
      }
      if (appendRes.ok && args.dryRun === false) await notifyEditorReload(normalizeRelPath(args.path))
      return appendRes
    }
    case 'upsert_database_item': {
      if (args.dryRun === false) {
        const rel = `Data/${String(args.table || '').replace(/\.json$/i, '').toLowerCase()}.json`
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
      }
      const result = dbManager.upsertItem(args)
      if (result.ok && args.dryRun === false) await notifyEditorReload(result.path)
      return result
    }
    case 'get_runtime_state':
      return await runtimeBridge.getLiveState()
    case 'diagnose_runtime':
      return await runtimeBridge.getDiagnosis()
    case 'get_editor_context':
      return await editorBridge.getContext()
    case 'list_attributes': {
      const entries = attributeEntries()
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const matched = query
        ? entries.filter(e => [e.id, e.key, e.name].some(v => String(v || '').toLowerCase().includes(query)))
        : entries
      return {
        ok: true,
        total: entries.length,
        count: matched.length,
        note: '属性键就是 id：事件/脚本里引用属性一律用 id；key/name 只是给人看的说明',
        attributes: matched.slice(0, 300).map(e => ({ id: e.id, key: e.key || '', name: e.name || '', type: e.type || '' }))
      }
    }
    case 'read_tilemap': {
      const rel = normalizeRelPath(args.path)
      const abs = path.join(ROOT, rel)
      if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在: ' + rel }
      let data
      try { data = JSON.parse(fs.readFileSync(abs, 'utf8')) } catch (e) { return { ok: false, error: 'JSON 解析失败: ' + e.message } }
      const width = Number(data.width) || 0
      const height = Number(data.height) || 0
      const out = { ok: true, path: rel, width: width, height: height, terrains: null, tilemaps: [] }
      if (width && height && typeof data.terrains === 'string' && data.terrains) {
        out.terrains = { codeLength: data.terrains.length, values: rle.decodeTerrains(data.terrains, width, height) }
      }
      let index = 0
      const stack = [data.objects || []]
      while (stack.length) {
        const list = stack.pop()
        for (const node of list || []) {
          if (!node || typeof node !== 'object') continue
          if (Array.isArray(node.children)) stack.push(node.children)
          if (typeof node.code === 'string' && node.code && node.width && node.height) {
            out.tilemaps.push({
              index: index,
              id: node.id || '',
              name: node.name || '',
              width: node.width,
              height: node.height,
              tilesetMap: node.tilesetMap || {},
              codeLength: node.code.length,
              tiles: rle.decodeTiles(node.code, node.width, node.height)
            })
            index++
          }
        }
      }
      out.note = 'tiles/terrains 是解码后的数值数组。改完数组后用 write_resource 整体写回：写盘前会把数组重新编码成引擎要的压缩串（引擎只读 code/terrains，不认数组），并校验解得开'
      return out
    }
    case 'ui_steps': {
      const steps = Array.isArray(args.steps) ? args.steps : []
      if (!steps.length) return { ok: false, error: 'steps 不能为空：至少要写一步要在界面上演示的操作' }
      const result = await editorBridge.uiSteps(steps, ROOT)
      // 熔断与打断走的是 HTTP 400，正文里带着 failedAt 和已完成的步骤；
      // 必须原样透给模型，否则它只知道"失败了"，不知道死在第几步、前面做完了哪些。
      if (result && result.ok === false && result.data && typeof result.data.ok === 'boolean') return result.data
      return result
    }
    case 'todo_write': {
      const sKey = getSessionKey(args)
      let currentTodos = sessionTodos.get(sKey) || []
      if (args.clear === true) {
        sessionTodos.set(sKey, [])
        return { ok: true, cleared: true, items: [], summary: summarizeTodos([]) }
      }
      const { items, rejected } = normalizeTodos(args.todos)
      if (!items.length) {
        return { ok: false, rejected, error: '清单为空或格式不对；todos 传字符串数组或 [{text,status}] 数组' }
      }
      // 不允许把"已完成"改回"待做"：进度倒退会让用户误判
      const transition = validateTransition(currentTodos, items)
      if (!transition.ok) {
        return { ok: false, regressed: transition.regressed, error: '不允许把已完成的步骤改回未完成：' + transition.regressed.join('、') }
      }
      sessionTodos.set(sKey, items)
      const summary = summarizeTodos(items)
      return {
        ok: true,
        rejected,
        items,
        summary,
        progress: summary.headline,
        rendered: renderTodos(items),
        hint: summary.done === summary.total ? '全部完成，可以收尾并给用户小结了' : '继续做下一个未完成项，完成一个就回来更新状态'
      }
    }
    case 'project_changelog': {
      const sKey = getSessionKey(args)
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200)
      const current = snapshotProject(ROOT)
      // 只报"上次汇报之后"的写入：同一轮里问好几次时，重复列同一批文件只是噪音
      const since = sessionReportedAt.get(sKey) || 0
      const writes = recentWrites.filter(item => (item.at || 0) > since)
      sessionReportedAt.set(sKey, Date.now())
      let baselineSnapshot = sessionBaselines.get(sKey)
      if (args.reset === true || !baselineSnapshot) {
        const isFirst = !baselineSnapshot
        sessionBaselines.set(sKey, current)
        // 首次调用只回一句"基线已建立"，模型就看不到"我刚才改了什么"（实测踩过：它发现这点后
        // 干脆不报清单，用户最后拿不到"改了哪些文件"）。基线是给**之后**的增量用的，
        // 写入记录是**已经发生**的事实，一并交出去。
        const pending = buildChangelog({ snapshotDiff: { modified: [], created: [], deleted: [] }, writes, includeWriteOnly: true, playtest: lastPlaytest })
        return {
          ok: true,
          baseline: true,
          trackedFiles: current.size,
          writes: writes.map(item => ({ path: item.path, tool: item.tool, ok: item.ok, rolledBack: item.rolledBack === true })),
          summary: pending.summary,
          headline: pending.headline,
          files: pending.files.slice(0, limit),
          message: isFirst
            ? `已把当前状态设为基线（跟踪 ${current.size} 个文本资源），之后再来叫我就只报增量。`
              + (pending.files.length ? `另外：这之前你已经改过 ${pending.files.length} 个文件，清单见 files（收尾时要如实报给用户）。` : '')
            : `已把当前状态重置为新基线（${current.size} 个文本资源）。`
        }
      }
      const diff = diffSnapshot(baselineSnapshot, current)
      const changelog = buildChangelog({ snapshotDiff: diff, writes, playtest: lastPlaytest })
      const currentTodos = sessionTodos.get(sKey) || []
      const todoSummary = summarizeTodos(currentTodos)
      return {
        ok: true,
        trackedFiles: current.size,
        summary: changelog.summary,
        headline: changelog.headline,
        files: changelog.files.slice(0, limit),
        truncated: changelog.files.length > limit,
        playtest: changelog.playtest,
        todos: currentTodos,
        todoSummary,
        nextSteps: changelog.nextSteps
      }
    }
    case 'list_backups': {
      const filterPath = args.path ? normalizeRelPath(args.path) : ''
      const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 200)
      const all = listBackups(ROOT, filterPath)
      const grouped = new Map()
      for (const item of all) grouped.set(item.path, (grouped.get(item.path) || 0) + 1)
      let currentSha = null
      let currentExists = false
      let isRestored = false
      let canRedo = false
      let redoBackup = null
      if (filterPath) {
        const abs = resolveInside(ROOT, filterPath)
        if (fs.existsSync(abs)) {
          currentExists = true
          try {
            currentSha = sha256(fs.readFileSync(abs, 'utf8'))
            const oldest = all[all.length - 1]
            if (oldest && oldest.sha256) {
              isRestored = (currentSha === oldest.sha256)
            }
            if (isRestored && all.length > 1) {
              for (const b of all) {
                if (b.sha256 && b.sha256 !== currentSha) {
                  canRedo = true
                  redoBackup = b.backup
                  break
                }
              }
            }
          } catch (e) {}
        }
      }
      return {
        ok: true,
        count: all.length,
        fileCount: grouped.size,
        currentExists,
        currentSha,
        isRestored,
        canRedo,
        redoBackup,
        backups: all.slice(0, limit).map(item => ({
          backup: item.backup,
          path: item.path,
          savedAt: item.savedAt,
          tool: item.tool,
          bytes: item.bytes,
          sha256: item.sha256,
          olderVersions: grouped.get(item.path) || 1
        })),
        truncated: all.length > limit,
        hint: all.length
          ? '要把某个文件退回 AI 动手之前，调用 restore_backup（不传 backup 即回到最早一次备份）'
          : '还没有任何备份：AI 每次写盘都会自动备份，先去改一次就会出现'
      }
    }
    case 'restore_backup': {
      const rel = normalizeRelPath(args.path)
      if (rel === 'Data/manifest.json') return { ok: false, error: 'Data/manifest.json 是引擎派生的资源索引，禁止回退（重新打开工程会自动重建）' }
      const abs = resolveInside(ROOT, rel)
      if (!fs.existsSync(abs)) return { ok: false, error: `文件不存在: ${rel}` }
      const candidates = listBackups(ROOT, rel)
      if (!candidates.length) return { ok: false, error: `没有找到 ${rel} 的备份，无法回退` }
      // 不指定 backup 时回到**最早**一次（即 AI 动手之前的原始版本）
      const chosen = args.backup
        ? candidates.find(item => item.backup === String(args.backup).replace(/\\/g, '/'))
        : candidates[candidates.length - 1]
      if (!chosen) return { ok: false, error: '指定的备份不存在或不属于这个文件，请先用 list_backups 查看' }

      const currentText = fs.readFileSync(abs, 'utf8')
      const backupAbs = resolveInside(ROOT, chosen.backup)
      const restoreText = fs.readFileSync(backupAbs, 'utf8')
      const currentSha = sha256(currentText)
      const restoreSha = sha256(restoreText)

      if (args.expectedSha256 && currentSha !== args.expectedSha256) {
        return { ok: false, conflict: true, error: '文件已被其他操作修改，expectedSha256 不匹配；请重新确认后再回退' }
      }
      const diff = unifiedDiff(currentText, restoreText, { label: `回退 ${rel} → ${chosen.savedAt}` })
      const preview = {
        path: rel,
        risk: 'medium',
        backup: chosen.backup,
        savedAt: chosen.savedAt,
        tool: chosen.tool,
        oldSha256: currentSha,
        newSha256: restoreSha,
        diff: diff.text,
        diffStat: { added: diff.added, removed: diff.removed, truncated: diff.truncated }
      }

      // 幂等防御：若当前内容与目标备份完全一致，无需重复写盘，不新增冗余备份
      if (currentSha === restoreSha) {
        return {
          ok: true,
          dryRun: false,
          alreadyRestored: true,
          ...preview,
          message: `当前文件已是 ${chosen.savedAt} 的版本（内容一致，无需重复回退）`
        }
      }

      if (args.dryRun !== false) return { ok: true, dryRun: true, ...preview, message: `将把 ${rel} 回退到 ${chosen.savedAt} 的版本，未写盘` }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        // 先给"当前内容"也存一份，保证回退本身可以再撤回（撤销的撤销）
        const safety = writeAtomic(ROOT, rel, restoreText, { tool: 'restore_backup', kind: 'pre-restore' })
        await notifyEditorReload(rel)
        return { ok: true, dryRun: false, ...preview, safetyBackup: safety.backup, message: `已把 ${rel} 回退到 ${chosen.savedAt} 的版本（当前内容也已备份，可再次撤回）` }
      } catch (e) { return { ok: false, error: `回退失败: ${e.message}` } }
    }
    case 'playtest_smoke': {
      const smoke = await runtimeBridge.playtestSmoke(args.sequence, { settleMs: args.settleMs })
      if (smoke && smoke.ok) lastPlaytest = { verdict: smoke.verdict, message: smoke.message, steps: smoke.steps, problems: smoke.problems, at: Date.now() }
      return smoke
    }
    case 'send_player_input':
      return await runtimeBridge.sendInput(args.key, args.action)
    case 'send_player_pointer':
      return await runtimeBridge.sendPointer(args)
    case 'finish_stuck_event':
      return await runtimeBridge.finishEvent(args.eventId || args.id)
    case 'suspend_runtime_kind':
      return await runtimeBridge.suspend(args.kind, args.on)
    default:
      return { ok: false, error: `未知工具: ${name}` }
  }
}

/** 跑一次 tsc，返回原始输出（compile_check 与写入后的编译门禁共用）
 *  注意：覆盖用参数必须放在 -p 之前，放在 -p 之后对读取的项目配置不生效 */
function runCompiler(extraArgs = []) {
  const compiler = findCompiler()
  if (!compiler) return null
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const args = [...compiler.args, '--noEmit', ...extraArgs, '-p', path.join(ROOT, 'tsconfig.json')]
    const child = spawn(compiler.command, args, { cwd: ROOT, windowsHide: true })
    let output = ''
    child.stdout.on('data', d => output += d)
    child.stderr.on('data', d => output += d)
    const timer = setTimeout(() => { child.kill(); resolve({ output, timeout: true, compiler: compiler.command }) }, 120000)
    child.on('error', error => { clearTimeout(timer); resolve({ output: output + '\n' + error.message, spawnError: error.message, compiler: compiler.command }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ output, exitCode: code, compiler: compiler.command }) })
  })
}

/**
 * 编译检查门禁。
 *
 * 关键坑位（实测）：工程 tsconfig.json 若让 tsc 推断不出 rootDir / 或存在其它"配置级"错误
 * （形如 tsconfig.json(58,5): error TS5011 ...），tsc 会**只报配置错误、完全跳过代码检查**——
 * 此时哪怕写入的是语法错误的脚本，输出里也只有那一条配置错误，门禁会误判为通过。
 * 因此这里必须在只看到配置级错误（TS5xxx）时，带上 --rootDir . 重跑一次真正进入代码检查。
 */
async function runCompileCheck() {
  const compiler = findCompiler()
  // 「找不到编译器」和「代码没通过编译」是两件事。前者不该触发回滚——否则在没装对 tsc 的机器上
  // 每次改代码都会被撤销，AI 彻底改不了脚本（Linux 源码版就是这么废掉的，铁律㊲）；
  // 但也绝不能静默放过：结果里标 unavailable，让模型与界面都知道"这一步没校验"。
  if (!compiler) {
    return {
      ok: false,
      unavailable: true,
      error: `未找到 Open Yami 自带的 tsc 编译器（当前平台 ${process.platform}-${process.arch}）。`
        + '可设置 YAMI_TSC_EXE 指向 tsc 可执行文件，或在工程根安装 typescript。'
    }
  }
  const first = await runCompiler()
  if (!first) return { ok: false, unavailable: true, error: '未找到 Open Yami tsc 编译器' }
  if (first.timeout) return { ok: false, error: '编译超时（>120s）', output: first.output.slice(0, 4000) }
  const collect = (output) => {
    const all = output.match(/error TS\d+/g) || []
    const configLevel = output.match(/tsconfig\.json\(\d+,\d+\): error TS5\d+/g) || []
    return { all, configLevel }
  }
  let { all, configLevel } = collect(first.output)

  if (all.length > 0 && all.length === configLevel.length) {
    // 只报了配置级错误 → 代码根本没被检查，补一次 --rootDir . 重跑
    const retry = await runCompiler(['--rootDir', '.'])
    if (retry && !retry.timeout) {
      const second = collect(retry.output)
      if (second.all.length !== second.configLevel.length) {
        return {
          ok: false,
          exitCode: retry.exitCode,
          errorCount: second.all.length - second.configLevel.length,
          compiler: second.all.length ? retry.compiler : compiler.command,
          configIssue: true,
          configError: (first.output.match(/error TS5\d+[^\n]*/g) || [])[0] || '',
          output: retry.output.slice(0, 4000),
          note: '工程 tsconfig 存在配置级错误，已自动带 --rootDir . 重跑以获得真实的代码检查结果'
        }
      }
      // 重跑后依然只有配置错误：说明代码确实没问题，如实说明并附上配置错误
      return {
        ok: true,
        exitCode: 0,
        errorCount: 0,
        compiler: compiler.command,
        configIssue: true,
        configError: (first.output.match(/error TS5\d+[^\n]*/g) || [])[0] || '',
        output: first.output.slice(0, 4000),
        note: '代码检查通过，但工程 tsconfig 存在配置级错误（建议修复）'
      }
    }
  }

  return {
    ok: all.length === 0 && !first.spawnError,
    exitCode: first.exitCode,
    errorCount: all.length,
    compiler: compiler.command,
    output: first.output.slice(0, 4000)
  }
}

/* ============================== MCP stdio 协议 ============================== */

const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function log(...a) { // 日志必须走 stderr，stdout 是协议通道
  process.stderr.write('[yami-mcp] ' + a.map(String).join(' ') + '\n')
}

rl.on('line', (line) => {
  line = line.trim()
  if (!line) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'yami-mcp', version: VERSION }
      }
    })
    log(`connected, root=${ROOT}`)
    return
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') return
  if (msg.method === 'ping') { send({ jsonrpc: '2.0', id: msg.id, result: {} }); return }
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } })
    return
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {}
    const callStartedAt = Date.now()
    Promise.resolve()
      .then(() => callTool(name, args))
      .then((result) => {
        // 这次调用里发生过编辑器热更新、而且是失败的 → 如实告诉模型：
        // 它（和用户）必须知道"编辑器内存还是旧的，保存会覆盖这次改动"，否则就是拿假成功骗人。
        const reload = lastReloadReport
        if (reload && !reload.ok && reload.at >= callStartedAt && result && typeof result === 'object' && result.ok === true) {
          result.editorReload = { ok: false, path: reload.rel, error: reload.error }
          result.message = String(result.message || ('已写入 ' + reload.rel))
            + '。但编辑器内存没有刷新成功（' + reload.error + '）：请提醒用户在编辑器里按【刷新资源树】或重启工程，'
            + '否则他下次保存可能把这次改动覆盖掉。'
        }
        send({
          jsonrpc: '2.0', id: msg.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: !result.ok
          }
        })
      })
      .catch((e) => {
        send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }], isError: true } })
      })
    return
  }
  // 未知方法
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } })
})

process.stderr.write(`[yami-mcp] started v${VERSION}, root=${ROOT}\n`)
