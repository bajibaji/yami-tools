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
const { resolveInside, relativePath, sha256, writeAtomic, restoreBackup } = require('./modules/file-ops')

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

const cdpClient = new CdpClient()
const dbManager = new DatabaseManager(ROOT, () => generateGuid())
const eventBuilder = new EventBuilder(ROOT)
const runtimeBridge = new RuntimeBridge(5966, cdpClient)
const editorBridge = new EditorBridge(5967)

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
  const engineRoot = process.env.YAMI_ENGINE_ROOT || 'D:\\Program Files\\Open Yami RPG Editor'
  const exeCandidates = [
    path.join(engineRoot, 'resources', 'app', 'node_modules', '@typescript', 'typescript-win32-x64', 'lib', 'tsc.exe'),
    path.join(engineRoot, 'resources', 'app', 'node_modules', '@typescript', 'typescript-win32-x64', 'lib', 'tsc')
  ]
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

function registerCreatedScript(type, guid) {
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
    return { ok: true, ...writeAtomic(ROOT, rel, JSON.stringify(data, null, 2) + '\n'), registered: true, table }
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
        filter: { type: 'string', description: '路径包含过滤（如 "插件/自定义指令"）' }
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
      properties: { path: { type: 'string', description: '工程内资源相对路径' }, dryRun: { type: 'boolean', description: '默认 true，只预览不删除' } },
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
        const written = writeAtomic(ROOT, rel, src)
        const registration = registerCreatedScript(args.type, guid)
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
        const written = writeAtomic(ROOT, rel, args.content)
        let compile = null
        compile = await runCompileCheck()
        if (compile && !compile.ok) {
          let rollback = null
          try { if (written.backup) rollback = restoreBackup(ROOT, rel, written.backup) } catch (e) { rollback = { error: e.message } }
          return { ok: false, ...preview, compile, rollback, error: '编译未通过，已尝试自动恢复修改前脚本' }
        }
        return { ok: true, dryRun: false, ...preview, ...written, compile, message: `已写入 ${rel}` }
      } catch (e) { return { ok: false, error: `写入失败: ${e.message}` } }
    }
    case 'patch_resource': {
      const rel = normalizeRelPath(args.path)
      if (!rel.startsWith('Assets/') || !DATA_TYPES.includes(TYPE_BY_EXT[path.extname(rel).toLowerCase()])) return { ok: false, error: '只允许补丁修改 Assets 内的 JSON 资源' }
      if (/(^|\/)(manifest\.json)$|(^|\/)(terrains|code)(?:$|\/)/i.test(JSON.stringify(args.patch))) return { ok: false, error: '禁止通过局部补丁修改 manifest 或场景压缩字段 terrains/code' }
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
      const preview = { path: rel, oldSha256: sha256(oldText), newSha256: sha256(nextText), changedBytes: Buffer.byteLength(nextText) - Buffer.byteLength(oldText), preview: next }
      if (args.dryRun !== false) return { ok: true, dryRun: true, ...preview, message: '资源补丁校验通过，未写盘' }
      try {
        const written = writeAtomic(ROOT, rel, nextText)
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
      const backupDir = path.join(ROOT, '.yami-mcp-backups')
      const backup = path.join(backupDir, `${Date.now()}-${path.basename(rel)}.deleted.bak`)
      if (args.dryRun !== false) return { ok: true, dryRun: true, path: rel, bytes: stat.size, message: `将删除 ${rel}，并备份到 .yami-mcp-backups` }
      try {
        fs.mkdirSync(backupDir, { recursive: true })
        fs.copyFileSync(abs, backup)
        fs.unlinkSync(abs)
        return { ok: true, dryRun: false, path: rel, backup, message: `已删除 ${rel}，备份仍保留` }
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
      return { ok: true, count: filtered.length, resources: filtered }
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
        return { ok: true, path: rel, content: JSON.parse(fs.readFileSync(abs, 'utf8')), sha256: sha256(fs.readFileSync(abs, 'utf8')) }
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
      if (args.dryRun !== false) return { ok: true, dryRun: true, message: '校验通过（未写盘，dryRun）', preview: text, sha256: sha256(text) }
      try {
        const written = writeAtomic(ROOT, rel, text)
        let memoryStatus = null
        try {
          const reloadRes = await cdpClient.reloadEditorResource(rel, guid)
          if (reloadRes && reloadRes.ok) memoryStatus = '已自动热更新进编辑器内存，阻止反向覆盖'
        } catch (e) {}
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
      const expressions = {
        save: "typeof File !== 'undefined' && File.save ? File.save(false).then ? File.save(false).then(() => ({ok:true, action:'save'})) : ({ok:true, action:'save'}) : ({ok:false, error:'File.save 不可用'})",
        undo: "typeof UndoManager !== 'undefined' && UndoManager.undo ? (UndoManager.undo(), {ok:true, action:'undo'}) : ({ok:false, error:'UndoManager.undo 不可用'})",
        redo: "typeof UndoManager !== 'undefined' && UndoManager.redo ? (UndoManager.redo(), {ok:true, action:'redo'}) : ({ok:false, error:'UndoManager.redo 不可用'})",
        refresh: "typeof Directory !== 'undefined' && Directory.update ? Directory.update().then(() => ({ok:true, action:'refresh'})) : ({ok:false, error:'Directory.update 不可用'})",
        playtest: "typeof Title !== 'undefined' && Title.playGame ? Title.playGame().then ? Title.playGame().then(() => ({ok:true, action:'playtest'})) : ({ok:true, action:'playtest'}) : ({ok:false, error:'Title.playGame 不可用'})"
      }
      if (!expressions[args.action]) return { ok: false, error: `不支持的编辑器动作: ${args.action}` }
      const directActions = new Set(['save', 'undo', 'redo', 'refresh', 'playtest'])
      if (directActions.has(args.action)) {
        const direct = await editorBridge.action(args.action)
        if (direct.ok !== false) return direct
      }
      return await cdpClient.eval(expressions[args.action], true, 'editor')
    }
    case 'append_event_commands': {
      const appendRes = eventBuilder.appendCommands(args)
      if (appendRes.ok && args.dryRun === false) {
        try {
          const guid = parseGuidFromName(path.basename(args.path))
          await cdpClient.reloadEditorResource(args.path, guid)
        } catch (e) {}
      }
      return appendRes
    }
    case 'upsert_database_item':
      return dbManager.upsertItem(args)
    case 'get_runtime_state':
      return await runtimeBridge.getLiveState()
    case 'send_player_input':
      return await runtimeBridge.sendInput(args.key, args.action)
    default:
      return { ok: false, error: `未知工具: ${name}` }
  }
}

async function runCompileCheck() {
  const compiler = findCompiler()
  if (!compiler) return { ok: false, error: '未找到 Open Yami tsc 编译器：请设置 YAMI_TSC_EXE，或确认引擎安装目录存在 @typescript/typescript-win32-x64/lib/tsc.exe' }
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const child = spawn(compiler.command, [...compiler.args, '--noEmit', '-p', path.join(ROOT, 'tsconfig.json')], { cwd: ROOT, windowsHide: true })
    let output = ''
    child.stdout.on('data', d => output += d)
    child.stderr.on('data', d => output += d)
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: '编译超时（>120s）', output: output.slice(0, 4000) }) }, 120000)
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: `启动编译器失败: ${error.message}`, output: output.slice(0, 4000) }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const errors = (output.match(/error TS\d+/g) || []).length
      resolve({ ok: code === 0, exitCode: code, errorCount: errors, compiler: compiler.command, output: output.slice(0, 4000) })
    })
  })
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
