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
  roots.push('D:\\Program Files\\Open Yami RPG Editor')
  roots.push(path.resolve(__dirname, '..', '..', '..', '2'))
  return roots.filter(Boolean)
}

const cdpClient = new CdpClient()
const dbManager = new DatabaseManager(ROOT, () => generateGuid())
const eventBuilder = new EventBuilder(ROOT)
const runtimeBridge = new RuntimeBridge(5966, cdpClient)
const editorBridge = new EditorBridge(5967)

/* ============================== 变更小结的运行时状态 ============================== */
// 基线快照：新任务开始时由 project_changelog(reset:true) 建立，之后只报增量
let baselineSnapshot = null
// 本轮写入记录（工具名、是否通过编译、是否被回滚），供小结标注"谁改的、编译过没过"
const recentWrites = []
const RECENT_WRITES_MAX = 200
// 最近一次试玩冒烟结论
let lastPlaytest = null
// 本次任务的待办清单（模型通过 todo_write 维护）
let currentTodos = []

/** 从编译器输出里取第一条报错（给变更小结用） */
function firstCompileError(compile) {
  const output = String((compile && compile.output) || '')
  const line = output.split('\n').map(text => text.trim()).find(text => text.includes('error TS')) || ''
  return line.slice(0, 200)
}

function rememberWrite(entry) {
  if (!entry || !entry.path) return
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

/** 各数据类型的必需字段（schema 校验用，按《Yami引擎编写规则.md》第二部） */
const REQUIRED_FIELDS = {
  event: ['type', 'enabled', 'commands'],
  scene: ['width', 'height', 'tileWidth', 'tileHeight', 'ambient', 'objects'],
  ui: ['width', 'height', 'nodes'],
  trigger: ['shape', 'events'],
  actor: ['sprites', 'attributes'],
  tileset: ['image', 'width', 'height', 'tileWidth', 'tileHeight'],
  animation: ['sprites', 'motions'],
  particle: ['sprites'],
  skill: ['name', 'events'],
  item: ['name', 'events'],
  equipment: ['name', 'events'],
  state: ['name', 'events']
}

/* ============================== 规则一：脚本元数据（复刻引擎 plugin.js parseMeta 规则） ============================== */

const META_SELECTOR = /\/\*\s*@plugin\s[\s\S]+?(?=\*\/)/
const META_STATEMENT = /@([a-z\-\[\]]+)([\s\S]*?)(?=\s@|$)/g
const META_OPTION = /^(.+?)\{([\s\S]+?)\}$/
const META_LANG_NAME = /^([a-zA-Z\-]+)(?:\s+extends\s+([a-zA-Z\-]+))?/
const META_LANG_PROP = /(#\S+)\s+([\s\S]+?)(?=\s+#|$)/g

const PARAM_TYPES = ['boolean', 'number', 'variable-number', 'string', 'number[]', 'string[]', 'keycode', 'color', 'option', 'easing', 'team', 'variable', 'attribute', 'attribute-key', 'attribute-group', 'enum', 'enum-value', 'enum-group', 'actor', 'region', 'light', 'animation', 'particle', 'parallax', 'tilemap', 'element', 'element-id', 'file', 'variable-getter', 'variable-setter', 'actor-getter', 'skill-getter', 'state-getter', 'equipment-getter', 'item-getter', 'element-getter', 'position-getter', 'group', 'group[]']
const PARAM_MODIFIERS = ['alias', 'desc', 'default', 'filter', 'clamp', 'decimals', 'cond', 'placeholder', 'suffix', 'prefix', 'readonly', 'hidden', 'validate']
const OVERVIEW_TAGS = ['plugin', 'version', 'author', 'link', 'desc', 'deprecated', 'require']

/** 解析 .ts 源码中的 /* @plugin *\/ 元数据注释块（规则一 DSL） */
function parsePluginMeta(code) {
  const m = META_SELECTOR.exec(code)
  if (!m) return { ok: false, error: '未找到 /* @plugin ... */ 元数据注释块' }
  const out = { ok: true, raw: m[0], overview: {}, parameters: [], langMap: {} }
  let current = null
  META_STATEMENT.lastIndex = 0
  let st
  while ((st = META_STATEMENT.exec(m[0])) !== null) {
    const tag = st[1]
    const content = (st[2] || '').trim()
    if (PARAM_TYPES.includes(tag)) {
      if (tag === 'group' || tag === 'group[]') { current = null; out.parameters.push({ key: content, type: tag }); continue }
      current = { key: content, type: tag }
      if (tag === 'option') {
        const om = META_OPTION.exec(content)
        if (om) {
          current.key = om[1].trim()
          current.options = om[2].split(/\s*,\s*/).map(s => s.trim())
        }
      }
      out.parameters.push(current)
    } else if (PARAM_MODIFIERS.includes(tag)) {
      if (current) current[tag] = content
      else if (tag === 'desc') out.overview.desc = content
    } else if (OVERVIEW_TAGS.includes(tag)) {
      if (tag === 'require') { (out.overview.requires = out.overview.requires || []).push(content) }
      else out.overview[tag] = content
    } else if (tag === 'lang') {
      const ln = META_LANG_NAME.exec(content)
      if (ln) {
        const lang = { name: ln[1], extends: ln[2] || null, props: {} }
        META_LANG_PROP.lastIndex = 0
        let lp
        while ((lp = META_LANG_PROP.exec(content)) !== null) lang.props[lp[1]] = lp[2].trim()
        out.langMap[ln[1]] = lang
      }
    }
  }
  return out
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

function buildScriptSource(type, className, nameZh, params) {
  const tpl = SCRIPT_TEMPLATES[type]
  const lines = ['/* @plugin #plugin', ' * @version 1.0', ' * @author', ' * @link', ' * @desc #desc']
  for (const p of params || []) {
    if (p.type === 'option') lines.push(` * @option ${p.key} {${(p.options || ['a', 'b']).map(v => `'${v}'`).join(', ')}}`)
    else lines.push(` * @${p.type} ${p.key}`)
    lines.push(` * @alias #${p.key}`)
    if (p.default !== undefined && p.default !== '') lines.push(` * @default ${typeof p.default === 'string' ? `'${p.default}'` : p.default}`)
  }
  lines.push(' * @lang zh', ` * #plugin ${nameZh}`, ' * #desc 描述', ...(params || []).map(p => ` * #${p.key} ${p.key}`))
  lines.push(' */', '', `export default class ${className} implements Script<${tpl.interface}> {`)
  for (const p of params || []) lines.push(`  ${p.key}!: ${p.type.startsWith('number') || p.type === 'variable-number' ? 'number' : p.type.startsWith('string') || p.type === 'color' || p.type === 'keycode' || p.type === 'option' ? 'string' : p.type === 'boolean' ? 'boolean' : 'any'}`)
  lines.push('  ' + tpl.body.split('\n').join('\n  '), '}')
  return lines.join('\n') + '\n'
}

/** 生成 16 位 hex GUID（引擎要求含 a-f） */
function generateGuid() {
  for (let i = 0; i < 32; i++) {
    const g = crypto.randomBytes(8).toString('hex')
    if (/[a-f]/.test(g)) return g
  }
  return crypto.randomBytes(8).toString('hex')
}

/** 定位 tsc.js（编译检查用）：YAMI_TSC_JS 环境变量 > 项目根 node_modules > server 同层 */
function findCompiler() {
  if (process.env.YAMI_TSC_EXE && fs.existsSync(process.env.YAMI_TSC_EXE)) {
    return { command: process.env.YAMI_TSC_EXE, args: [] }
  }
  const exeCandidates = []
  for (const engineRoot of candidateEngineRoots()) {
    exeCandidates.push(
      path.join(engineRoot, 'resources', 'app', 'node_modules', '@typescript', 'typescript-win32-x64', 'lib', 'tsc.exe'),
      path.join(engineRoot, 'resources', 'app', 'node_modules', '@typescript', 'typescript-win32-x64', 'lib', 'tsc')
    )
  }
  for (const c of exeCandidates) if (fs.existsSync(c)) return { command: c, args: [] }

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
  // 源码仓库同层（开发者在本机直接跑源码时的兜底）
  candidates.push(
    path.resolve(__dirname, '..', '..', '..', '2', 'Project', 'commands.json'),
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

/** 收集磁盘上所有 GUID → 文件（跨 Assets + Data） */
function collectAllGuids() {
  const map = new Map()
  const add = (relPath) => {
    const g = parseGuidFromName(path.basename(relPath))
    if (g) {
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(relPath)
    }
  }
  for (const f of listResourceFiles()) add(f.path)
  for (const f of walk(path.join(ROOT, 'Data'))) add(path.relative(ROOT, f).replace(/\\/g, '/'))
  return map
}

/** 从对象树收集所有 GUID 引用（递归，含 tilesetMap/events/scripts/attributes/引用字段） */
function collectRefs(obj, refs, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return
  seen.add(obj)
  if (Array.isArray(obj)) { for (const v of obj) collectRefs(v, refs, seen); return }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && isValidGuid(v)) refs.push(v)
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
  }
  return { ok: issues.length === 0, type, guid, issues }
}

/** 全工程校验：GUID 唯一性 + 数据文件引用完整性 + manifest 一致性 */
function validateProject() {
  const issues = []
  const guidMap = collectAllGuids()
  // 1) GUID 唯一性
  for (const [g, files] of guidMap) {
    if (files.length > 1) issues.push({ severity: 'error', code: 'duplicate-guid', guid: g, message: `GUID 重复（${files.length} 个文件）: ${g}`, files })
  }
  // 2) 数据文件引用完整性：所有 16hex 引用须能在磁盘找到
  const known = new Set(guidMap.keys())
  for (const f of listResourceFiles()) {
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
  // 3) manifest 一致性：磁盘文件 vs manifest 条目
  const manifest = readDataJson('manifest.json')
  if (manifest && !manifest.__parseError) {
    const manifestPaths = new Set()
    for (const [k, v] of Object.entries(manifest)) {
      if (!Array.isArray(v)) continue
      for (const item of v) if (item && typeof item.path === 'string') manifestPaths.add(item.path.replace(/\\/g, '/'))
    }
    for (const f of listResourceFiles()) {
      if (f.type === 'script' || f.type === 'image' || f.type === 'audio' || f.type === 'video' || f.type === 'font') continue
      if (!manifestPaths.has(f.path)) issues.push({ severity: 'warning', code: 'not-in-manifest', message: `磁盘文件不在 manifest 中（编辑器会重建）: ${f.path}` })
    }
  }
  return { ok: issues.every(i => i.severity !== 'error'), issues, stats: { files: listResourceFiles().length, duplicateGuids: [...guidMap.values()].filter(a => a.length > 1).length } }
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
    description: '读取一个资源文件（.event/.scene/.ui/.trigger/.actor/.tile/.anim/.particle/.skill/.item/.equip/.state 或 Data/*.json），返回解析后的 JSON；RLE 字段（terrains/code）原样保留',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根的路径，如 Assets/! 事件/@1 启动游戏事件.xxx.event 或 Data/attribute.json' }
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
        compileAfter: { type: 'boolean', description: '写入后运行 tsc --noEmit，默认 false' },
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
    description: '执行受限的编辑器原生操作：保存、撤销、重做、刷新资源、启动试玩；不接受任意 JS',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['save', 'undo', 'redo', 'refresh', 'playtest'], description: '编辑器动作' } },
      required: ['action']
    }
  },
  {
    name: 'interact_editor',
    description: '在编辑器中操作具体控件：按选择器输入文本、切换选项，或按坐标移动、点击、拖动；只作结构化工具缺失时的兜底',
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
    description: '试玩冒烟测试（本工程特色验证闭环）：按脚本驱动一遍游戏（方向键走位、确认对话等），跑完自动对比运行时诊断，报告「新出现的报错 / 变频繁的报错 / 新卡住的事件 / 性能是否恶化」。改完代码想确认"真的还能玩"时用它。需要先在编辑器里启动试玩。',
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
    description: '向正在运行的试玩游戏下发虚拟按键操作（方向键、确定对话、取消等），用于自动化探索与跑图回归测试',
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
    description: '向试玩游戏发送鼠标移动、按下、弹起或点击，用于界面和地图交互回归',
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
  }
]

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
  if (detail && detail.dirty) return { ok: false, error: detail.error || '编辑器里有未保存修改，请先保存或取消后重试' }
  return { ok: true }
}

async function notifyEditorReload(rel) {
  try { await editorBridge.action('reload', { path: rel }) } catch {}
}

async function callTool(name, args) {
  args = args || {}
  switch (name) {
    case 'list_scripts': {
      const groups = { '全局插件': [], '自定义指令': [], '场景对象脚本': [], '界面元素脚本': [] }
      const all = listResourceFiles('script')
      for (const f of all) {
        const key = Object.keys(groups).find(k => f.path.includes('插件/' + k))
        if (key) groups[key].push(f)
      }
      const total = all.length
      return { ok: true, total, groups }
    }
    case 'parse_plugin_meta': {
      const rel = normalizeRelPath(args.path)
      const abs = path.join(ROOT, rel)
      if (!fs.existsSync(abs)) return { ok: false, error: `文件不存在: ${rel}` }
      const meta = parsePluginMeta(fs.readFileSync(abs, 'utf8'))
      return meta.ok ? { ok: true, path: rel, ...meta } : meta
    }
    case 'create_script': {
      const rel = normalizeRelPath(args.path)
      const base = path.basename(rel)
      const guid = parseGuidFromName(base)
      if (!SCRIPT_TEMPLATES[args.type]) return { ok: false, error: `未知类型: ${args.type}（应为 ${Object.keys(SCRIPT_TEMPLATES).join('/')}）` }
      if (!guid || !isValidGuid(guid)) return { ok: false, error: `文件名需含合法 16 位 hex GUID（含 a-f）: ${base}` }
      if (fs.existsSync(resolveInside(ROOT, rel))) return { ok: false, error: `脚本已存在，拒绝覆盖: ${rel}；修改请使用 write_script` }
      const src = buildScriptSource(args.type, args.className, args.nameZh, args.params)
      if (args.dryRun !== false) return { ok: true, dryRun: true, message: '模板已生成（未写盘，dryRun）', script: src }
      try {
        const table = args.type === 'plugin' ? 'plugins' : args.type === 'command' ? 'commands' : null
        if (table) {
          const writable = await ensureEditorWritable(`Data/${table}.json`)
          if (!writable.ok) return writable
        }
        const written = writeAtomic(ROOT, rel, src, { tool: 'write_resource' })
        rememberWrite({ path: rel, tool: 'write_resource', ok: true })
        const registration = registerCreatedScript(args.type, guid, 'create_script')
        if (!registration.ok) {
          try { fs.unlinkSync(resolveInside(ROOT, rel)) } catch {}
          return { ok: false, registration, error: '脚本注册失败，已撤销脚本文件：' + registration.error }
        }
        const compile = await runCompileCheck()
        if (!compile.ok) {
          try { fs.unlinkSync(resolveInside(ROOT, rel)) } catch {}
          try { if (registration.backup) restoreBackup(ROOT, `Data/${registration.table}.json`, registration.backup) } catch {}
          return { ok: false, compile, error: '新脚本编译未通过，已撤销脚本和注册表' }
        }
        eventBuilder.customCommandMap = null
        await notifyEditorReload(rel)
        if (table) await notifyEditorReload(`Data/${table}.json`)
        return { ok: true, dryRun: false, ...written, registration, compile, message: `已写入并编译 ${rel}` }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'read_script': {
      const rel = normalizeRelPath(args.path)
      if (!/\.(ts|js)$/i.test(rel) || !rel.startsWith('Assets/')) return { ok: false, error: '只允许读取 Assets 内的 .ts 或 .js 脚本' }
      const text = readText(rel)
      if (text === null) return { ok: false, error: `脚本不存在: ${rel}` }
      return { ok: true, path: rel, content: text, sha256: sha256(text), meta: parsePluginMeta(text) }
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
      const preview = { path: rel, oldSha256: sha256(oldText), newSha256: sha256(args.content), changedBytes: Buffer.byteLength(args.content) - Buffer.byteLength(oldText), meta: nextMeta }
      if (args.dryRun !== false) return { ok: true, dryRun: true, ...preview, message: '脚本校验通过，未写盘' }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        const written = writeAtomic(ROOT, rel, args.content, { tool: 'write_script' })
        let compile = null
        compile = await runCompileCheck()
        if (compile && !compile.ok) {
          let rollback = null
          try { if (written.backup) rollback = restoreBackup(ROOT, rel, written.backup) } catch (e) { rollback = { error: e.message } }
          rememberWrite({ path: rel, tool: 'edit_script', ok: false, compileOk: false, errorCount: compile.errorCount || 0, firstError: firstCompileError(compile), rolledBack: !!rollback && !rollback.error })
          return { ok: false, ...preview, compile, rollback, error: '编译未通过，已尝试自动恢复修改前脚本' }
        }
        await notifyEditorReload(rel)
        rememberWrite({ path: rel, tool: 'write_script', ok: true, compileOk: compile ? compile.ok : undefined, errorCount: compile ? (compile.errorCount || 0) : 0 })
        return { ok: true, dryRun: false, ...preview, ...written, compile, message: `已写入 ${rel}` }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'edit_script': {
      const rel = normalizeRelPath(args.path)
      if (!/\.(ts|js)$/i.test(rel) || !rel.startsWith('Assets/')) return { ok: false, error: '只允许编辑 Assets 内的 .ts 或 .js 脚本' }
      if (typeof args.oldText !== 'string' || !args.oldText.length) return { ok: false, error: 'oldText 必须是非空字符串（要替换的原文片段）' }
      if (typeof args.newText !== 'string') return { ok: false, error: 'newText 必须是字符串；删除片段请传空字符串' }
      const oldText = readText(rel)
      if (oldText === null) return { ok: false, error: `脚本不存在: ${rel}` }
      const target = args.oldText
      const firstHit = oldText.indexOf(target)
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
        if (compile && !compile.ok) {
          let rollback = null
          try { if (written.backup) rollback = restoreBackup(ROOT, rel, written.backup) } catch (e) { rollback = { error: e.message } }
          return { ok: false, ...preview, compile, rollback, error: '编译未通过，已尝试自动恢复修改前脚本' }
        }
        await notifyEditorReload(rel)
        rememberWrite({ path: rel, tool: 'edit_script', ok: true, compileOk: compile ? compile.ok : undefined, errorCount: compile ? (compile.errorCount || 0) : 0, firstError: compile && !compile.ok ? firstCompileError(compile) : '' })
        return { ok: true, dryRun: false, ...preview, ...written, compile, message: `已精确修改 ${rel}（第 ${line} 行）` }
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
      if (guid && !args.force) {
        const referencingFiles = []
        for (const f of listResourceFiles()) {
          if (f.path === rel || !DATA_TYPES.includes(f.type)) continue
          const fAbs = path.join(ROOT, f.path)
          try {
            const fContent = fs.readFileSync(fAbs, 'utf8')
            if (fContent.includes(guid)) referencingFiles.push(f.path)
          } catch {}
          if (referencingFiles.length >= 5) break
        }
        if (referencingFiles.length > 0) {
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
        backup: '.yami-mcp-backups/' + path.basename(backup)
      }
      const previewResult = {
        ok: true,
        dryRun: true,
        path: rel,
        risk: 'high',
        bytes: stat.size,
        oldSha256: currentSha256,
        impact,
        message: `将删除 ${path.basename(rel)}（${stat.size} 字节），删除前会自动备份；这是不可轻易撤销的操作，需要你确认。`
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
        if (args.key && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
      }
      const errors = issues.filter(i => i.severity === 'error')
      if (errors.length > 0) return { ok: false, issues: errors, dryRun: true, message: '校验未通过，未写入' }
      const text = JSON.stringify(args.content, null, 2) + '\n'
      const oldText = readText(rel)
      const oldSha256 = oldText === null ? null : sha256(oldText)
      if (args.expectedSha256 && oldSha256 !== args.expectedSha256) return { ok: false, conflict: true, error: '资源已被其他操作修改，拒绝覆盖' }
      if (args.dryRun !== false) return { ok: true, dryRun: true, message: '校验通过（未写盘，dryRun）', preview: text, oldSha256, newSha256: sha256(text) }
      try {
        const writable = await ensureEditorWritable(rel)
        if (!writable.ok) return writable
        const written = writeAtomic(ROOT, rel, text, { tool: 'create_script' })
        let memoryStatus = null
        try {
          const reloadRes = await cdpClient.reloadEditorResource(rel, guid)
          if (reloadRes && reloadRes.ok) memoryStatus = '已自动热更新进编辑器内存，阻止反向覆盖'
        } catch (e) {}
        await notifyEditorReload(rel)
        return { ok: true, dryRun: false, ...written, message: `已写入 ${rel}（${text.length} 字节）${memoryStatus ? ' · ' + memoryStatus : ''}`, memoryReloaded: !!memoryStatus }
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
    case 'trigger_playtest':
      return await cdpClient.triggerPlaytest()
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
    case 'todo_write': {
      if (args.clear === true) {
        currentTodos = []
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
      currentTodos = items
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
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200)
      const current = snapshotProject(ROOT)
      if (args.reset === true || !baselineSnapshot) {
        const isFirst = !baselineSnapshot
        baselineSnapshot = current
        return {
          ok: true,
          baseline: true,
          trackedFiles: current.size,
          message: isFirst
            ? `已把当前状态设为基线（跟踪 ${current.size} 个文本资源），之后再来叫我就只报增量。`
            : `已把当前状态重置为新基线（${current.size} 个文本资源）。`
        }
      }
      const diff = diffSnapshot(baselineSnapshot, current)
      const changelog = buildChangelog({ snapshotDiff: diff, writes: recentWrites, playtest: lastPlaytest })
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
      return {
        ok: true,
        count: all.length,
        fileCount: grouped.size,
        backups: all.slice(0, limit).map(item => ({
          backup: item.backup,
          path: item.path,
          savedAt: item.savedAt,
          tool: item.tool,
          bytes: item.bytes,
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
      if (args.expectedSha256 && sha256(currentText) !== args.expectedSha256) {
        return { ok: false, conflict: true, error: '文件已被其他操作修改，expectedSha256 不匹配；请重新确认后再回退' }
      }
      const diff = unifiedDiff(currentText, restoreText, { label: `回退 ${rel} → ${chosen.savedAt}` })
      const preview = {
        path: rel,
        risk: 'medium',
        backup: chosen.backup,
        savedAt: chosen.savedAt,
        tool: chosen.tool,
        oldSha256: sha256(currentText),
        newSha256: sha256(restoreText),
        diff: diff.text,
        diffStat: { added: diff.added, removed: diff.removed, truncated: diff.truncated }
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
  if (!compiler) return { ok: false, error: '未找到 Open Yami tsc 编译器：请设置 YAMI_TSC_EXE，或确认引擎安装目录存在 @typescript/typescript-win32-x64/lib/tsc.exe' }
  const first = await runCompiler()
  if (!first) return { ok: false, error: '未找到 Open Yami tsc 编译器' }
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
    Promise.resolve()
      .then(() => callTool(name, args))
      .then((result) => {
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
