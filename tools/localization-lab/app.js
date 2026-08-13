/* 快速本地化：扫描未本地化文本、缺翻译条目与孤儿引用；导出/导入多语言 Excel。
   顶部为纯函数核心（node 可跑，self-check.js 直接 require），底部为浏览器 DOM 装配。 */
'use strict'

const REF_RE = /<ref:([0-9a-f]{16})>/gi
const COLOR_RE = /<color:[^>]*>|<\/color>/gi
const LOCAL_RE = /<local:[^>]*>/gi
const GLOBAL_RE = /<global:[0-9a-f]{16}>/gi
const CJK_RE = /[一-鿿]/
const GUID_RE = /^[0-9a-f]{16}$/i
const LONG_HEX_RE = /^[0-9a-f]{32}$/i
const NUMERIC_RE = /^[\d\s.,%+\-*/=<>x×（）()]+$/
const EN_TEXT_RE = /^[A-Za-z][A-Za-z\s'\-!?.(),:;%°]*$/
const LOOPLIST_ID = '4cb407bd71929620'
const LOCALIZATION_FOLDER = '快速本地化'

// 命令树文本字段白名单：引擎实测 CJK 与 <ref:> 只出现在这些 key（name 是 .ui 编辑器标签、script 是代码，均排除）
const BASE_TEXT_KEYS = ['value', 'content', 'comment', 'tag', 'operand']
const SKIP_KEYS = new Set(['name', 'script', 'description', 'namespace', 'id', 'key', 'type', 'enum', 'note', 'title'])
// ponytail: 按当前工程命令 tag 噪声起步的排除清单，误报由 Excel 置信度列人工过滤兜底
const COMMAND_TAG_DENYLIST = new Set([
  'actor', 'global', 'inherit', 'constant', 'variable', 'trigger', 'none', 'add', 'sub', 'set', 'clear',
  'penetrate', 'move', 'attack', 'skill', 'random', 'switch', 'state', 'sound', 'close', 'wait', 'branch',
  'loop', 'call', 'event', 'input', 'mouse', 'key', 'scene', 'anim', 'particle', 'active', 'inactive',
  'true', 'false', 'save', 'load', 'menu', 'system', 'local', 'private', 'public', 'static', 'inline',
  'up', 'down', 'left', 'right', 'forward', 'back', 'item', 'equip', 'skillpoint', 'gold', 'exp', 'open', 'quit',
])
const EXT_TYPE = { '.item': 'items', '.equip': 'equipments', '.skill': 'skills', '.state': 'states', '.event': 'events', '.ui': 'ui', '.trigger': 'triggers' }

function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) }

function randomHex16() {
  try {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    let out = ''
    for (let i = 0; i < 16; i++) out += Math.floor(Math.random() * 16).toString(16)
    return out
  }
}

/** 仿生原文件格式序列化：Yami 编辑器用 2 空格缩进 + CRLF + 无尾随换行（实测 000 - 治疗药剂.item）；
   按原文本的换行风格与尾随换行有无还原，避免写回后编辑器大 diff。 */
function serializeLike(data, originalText) {
  const json = JSON.stringify(data, null, 2)
  const crlf = String(originalText || '').includes('\r\n')
  const body = crlf ? json.replace(/\n/g, '\r\n') : json
  if (!String(originalText || '').endsWith('\n')) return body
  return body + (crlf ? '\r\n' : '\n')
}

function normalizeText(text) {
  return String(text).replace(COLOR_RE, '').replace(LOCAL_RE, '').replace(GLOBAL_RE, '').replace(/\s+/g, ' ').trim()
}

/** 按 <ref:ID> 切分字符串，返回非 ref 段数组（含前后文本）；hasRef 指示是否含 ref。 */
function splitRefSegments(value) {
  const parts = String(value).split(/(<ref:[0-9a-f]{16}>)/gi)
  const segments = []
  let hasRef = false
  for (let i = 0; i < parts.length; i += 2) {
    if (i + 1 < parts.length) hasRef = true
    segments.push(parts[i])
  }
  return { hasRef, segments }
}

/** 单段文本判定：返回 {confidence:'high'|'medium'} 或 null（排除 GUID/数字/标签/路径/命令枚举等）。 */
function classifyText(segment, key = '') {
  const text = String(segment ?? '')
  const trimmed = text.trim()
  if (!trimmed) return null
  // 路径判定必须在 CJK 之前（中文路径如「Assets/物品/a.item」不能算文本）
  if (/^(Assets\/|[A-Za-z]:[\\/]|\/)/.test(trimmed)) return null
  if (CJK_RE.test(text)) return { confidence: 'high' }
  if (GUID_RE.test(trimmed) || LONG_HEX_RE.test(trimmed)) return null
  if (NUMERIC_RE.test(trimmed)) return null
  if (/^<[a-z]+:[^>]*>$/i.test(trimmed)) return null
  if (/^[A-Za-z]$/.test(trimmed)) return null
  if ((key === 'tag' || key === 'operand') && COMMAND_TAG_DENYLIST.has(trimmed.toLowerCase())) return null
  if (EN_TEXT_RE.test(trimmed) && trimmed.length >= 2) return { confidence: 'medium' }
  if (/[A-Za-z]/.test(trimmed)) return { confidence: 'medium' }
  return null
}

/** attribute.json：收集 type==='string' 的属性 ID（文本型属性名单）。 */
function buildStringAttributeIds(attributeJson) {
  const ids = new Set()
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node && Array.isArray(node.children)) walk(node.children)
      else if (node && node.type === 'string' && node.id) ids.add(node.id)
    }
  }
  walk(attributeJson && attributeJson.keys)
  return ids
}

/** attribute.json：找语义键为 loopList 的属性 ID（其 value 是掉落数据 JSON，非可见文本）。 */
function loopListAttributeId(attributeJson) {
  let id = LOOPLIST_ID
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node && Array.isArray(node.children)) walk(node.children)
      else if (node && node.key === 'loopList' && node.id) id = node.id
    }
  }
  walk(attributeJson && attributeJson.keys)
  return id
}

/** localization.json：收集全部叶子 ID（孤儿引用判定用）。 */
function localizationIds(localizationJson) {
  const ids = new Set()
  const walk = (items) => {
    for (const item of items || []) {
      if (item && Array.isArray(item.children)) walk(item.children)
      else if (item && item.id) ids.add(item.id)
    }
  }
  walk(localizationJson && localizationJson.list)
  return ids
}

/** 命令树两趟扫描：第一趟收集「出现过 <ref:> 的 key」并入白名单（ref 先例信号）。 */
function collectRefKeys(root) {
  const refKeys = new Set()
  const walk = (node) => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        // 用字面量正则（共享 REF_RE 的 lastIndex 会被 test 推进，污染后续 matchAll）
        if (!SKIP_KEYS.has(key) && /<ref:[0-9a-f]{16}>/i.test(value)) refKeys.add(key)
      } else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(root)
  return refKeys
}

/** 单个资产文件扫描：attributes[].value（文本型属性）+ 命令树白名单 key。 */
function collectCandidates(fileJson, type, stringAttrIds, ids, skipAttrIds) {
  const candidates = []
  const orphans = []
  const note = (candidate) => { candidate.sourceType = type; candidates.push(candidate) }
  const handleValue = (value, path, key) => {
    for (const match of [...String(value).matchAll(/<ref:([0-9a-f]{16})>/gi)]) {
      if (!ids.has(match[1].toLowerCase())) orphans.push({ refId: match[1], path })
    }
    const { hasRef, segments } = splitRefSegments(value)
    if (hasRef) {
      segments.forEach((segment, index) => {
        if (!segment || !segment.trim()) return
        const cls = classifyText(segment, key)
        if (cls) note({ kind: 'segment', segmentIdx: index, zhCN: segment, confidence: cls.confidence, path, raw: value })
      })
    } else {
      const cls = classifyText(value, key)
      if (cls) note({ kind: 'full', segmentIdx: -1, zhCN: value, confidence: cls.confidence, path, raw: value })
    }
  }
  for (let i = 0; i < (fileJson.attributes || []).length; i++) {
    const attr = fileJson.attributes[i]
    if (attr && typeof attr.value === 'string' && stringAttrIds.has(attr.key) && !skipAttrIds.has(attr.key)) {
      handleValue(attr.value, `attributes[${i}].value`, 'value')
    }
  }
  const keys = new Set(BASE_TEXT_KEYS.filter((k) => !SKIP_KEYS.has(k)))
  for (const key of collectRefKeys(fileJson)) keys.add(key)
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`)); return }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'attributes') continue // 属性数组由文本型属性白名单单独处理，不走命令树（防重复）
      if (typeof value === 'string' && keys.has(key)) handleValue(value, path ? `${path}.${key}` : key, key)
      else if (value && typeof value === 'object') walk(value, path ? `${path}.${key}` : key)
    }
  }
  walk(fileJson, '')
  return { candidates, orphans }
}

/** 同文本合并：normalize 相等 → 同一候选，locations 追加。 */
function mergeCandidates(list) {
  const map = new Map()
  for (const candidate of list) {
    const key = normalizeText(candidate.zhCN)
    if (!key) continue
    const existing = map.get(key)
    if (existing) {
      existing.locations.push({ file: candidate.file, path: candidate.path, raw: candidate.raw, segmentIdx: candidate.segmentIdx, kind: candidate.kind })
    } else {
      candidate.normalized = key
      candidate.locations = [{ file: candidate.file, path: candidate.path, raw: candidate.raw, segmentIdx: candidate.segmentIdx, kind: candidate.kind }]
      map.set(key, candidate)
    }
  }
  return [...map.values()]
}

/** 缺翻译条目：config 语言列表中除首个（zh-CN）外任一语言为空即计入。 */
function findMissingTranslations(localizationJson, languages) {
  const missing = []
  const primary = languages[0]
  const walk = (items, folder) => {
    for (const item of items || []) {
      if (item && Array.isArray(item.children)) walk(item.children, item.name || '')
      else if (item && item.id && item.contents) {
        const langs = {}
        for (const lang of languages) langs[lang] = typeof item.contents[lang] === 'string' ? item.contents[lang] : ''
        const missingLangs = languages.filter((lang) => lang !== primary && !(typeof item.contents[lang] === 'string' && item.contents[lang].trim()))
        if (missingLangs.length) missing.push({ id: item.id, name: item.name || '', folder: folder || '', languages: langs, missingLangs })
      }
    }
  }
  walk(localizationJson && localizationJson.list, '')
  return missing
}

function buildScanResult(assets, { attributeJson, localizationJson, languages }) {
  const ids = localizationIds(localizationJson)
  const stringAttrIds = buildStringAttributeIds(attributeJson)
  const skipAttrIds = new Set([loopListAttributeId(attributeJson)])
  const candidates = []
  const orphans = []
  for (const { file, type, data } of assets) {
    const result = collectCandidates(data, type, stringAttrIds, ids, skipAttrIds)
    for (const c of result.candidates) c.file = file
    for (const o of result.orphans) o.file = file
    candidates.push(...result.candidates)
    orphans.push(...result.orphans)
  }
  return { candidates: mergeCandidates(candidates), orphans, missing: findMissingTranslations(localizationJson, languages), languages: [...languages] }
}

/** 按点路径导航（'attributes[3].value' / 'events[0].commands[2].params.content'）；路径不存在返回 undefined（不抛错）。 */
function locateValue(root, path) {
  let node = root
  for (const part of String(path).split('.')) {
    if (!part) continue
    const match = /^(.+?)\[(\d+)\]$/.exec(part)
    node = match ? node?.[match[1]]?.[Number(match[2])] : node?.[part]
    if (node === undefined) return undefined
  }
  return node
}

function setValue(root, path, value) {
  const parts = String(path).split('.').filter(Boolean)
  let node = root
  for (let i = 0; i < parts.length - 1; i++) {
    const match = /^(.+?)\[(\d+)\]$/.exec(parts[i])
    node = match ? node[match[1]][Number(match[2])] : node[parts[i]]
  }
  const last = parts.at(-1)
  const match = /^(.+?)\[(\d+)\]$/.exec(last)
  if (match) node[match[1]][Number(match[2])] = value
  else node[last] = value
}

/** 把候选的某段替换为 <ref:ID>：segmentIndex 是 splitRefSegments 的段号（非 ref 段），整值（full）即替换整个字符串。 */
function replaceSegment(value, segmentIndex, replacement) {
  const parts = String(value).split(/(<ref:[0-9a-f]{16}>)/gi)
  parts[segmentIndex * 2] = replacement
  return parts.join('')
}

/** 把候选写入资产文件数据（file 指定时只处理该文件的 locations）。
   先全部校验（当前值与导出时一致，不一致=外部改动，返回失败），再统一替换——
   同文件多个相同文本位置必须先校验后替换，否则前一个被换成 <ref:ID> 后后一个校验会失败。 */
function applyAssetReplacement(fileJson, candidate, file) {
  const locations = file ? candidate.locations.filter((l) => l.file === file) : candidate.locations
  for (const loc of locations) {
    const current = locateValue(fileJson, loc.path)
    if (typeof current !== 'string' || !current.includes(candidate.zhCN)) {
      return { ok: false, reason: `${loc.file} ${loc.path} 当前值已与导出时不一致（可能被外部修改），导入已中止` }
    }
  }
  for (const loc of locations) {
    const current = locateValue(fileJson, loc.path)
    if (loc.kind === 'full') setValue(fileJson, loc.path, `<ref:${candidate.id}>`)
    else setValue(fileJson, loc.path, replaceSegment(current, loc.segmentIdx, `<ref:${candidate.id}>`))
  }
  return { ok: true }
}

/** 把新增/补译条目写入 localization.json 树（根级「快速本地化」文件夹；不存在则创建）。幂等：ID 已存在则跳过新增。 */
function localizationInsertion(localizationJson, additions, fills, languages) {
  const root = localizationJson.list || (localizationJson.list = [])
  const byId = new Map()
  const collect = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) collect(item.children); else if (item && item.id) byId.set(item.id, item) } }
  collect(root)
  let folder = root.find((item) => item && item.name === LOCALIZATION_FOLDER && Array.isArray(item.children))
  if (!folder) { folder = { class: 'folder', name: LOCALIZATION_FOLDER, expanded: false, children: [] }; root.push(folder) }
  for (const fill of fills) {
    const leaf = byId.get(fill.id)
    if (!leaf) continue
    for (const lang of languages) {
      const value = fill.langs[lang]
      if (typeof value === 'string' && value.trim()) leaf.contents[lang] = value
    }
  }
  for (const add of additions) {
    if (byId.has(add.id)) continue
    const contents = { [languages[0]]: add.zhCN }
    for (const lang of languages) {
      const value = add.langs[lang]
      if (typeof value === 'string' && value.trim()) contents[lang] = value
    }
    folder.children.push({ id: add.id, name: String(add.zhCN).replace(/\s+/g, ' ').trim().slice(0, 20), contents })
    byId.set(add.id, null)
  }
  return localizationJson
}

/** Excel 导入行校验：ID 格式/表内重复/与现有条目冲突/原文空/补译行 ID 必须存在。返回错误与归类行。 */
function validateImportRows(rows, existingById, languages) {
  const errors = []
  const warnings = []
  const seen = { add: new Set(), fill: new Set() } // 表内重复按 sheet 分开（两张表 ID 重叠正常）
  const additions = []
  const fills = []
  for (const row of rows) {
    const id = String(row.id || '').trim()
    if (!/^[0-9a-f]{16}$/i.test(id)) { errors.push(`第 ${row.row} 行：ID「${row.id || '(空)'}」不是 16 位 hex`); continue }
    if (seen[row.sheet].has(id)) { errors.push(`第 ${row.row} 行：ID ${id} 在表中重复`); continue }
    seen[row.sheet].add(id)
    if (row.sheet === 'add') {
      const zhCN = String(row.zhCN || '')
      if (!zhCN.trim()) { errors.push(`第 ${row.row} 行：原文为空`); continue }
      const existing = existingById.get(id)
      if (existing) {
        if (normalizeText(existing.zhCN) === normalizeText(zhCN)) continue // 幂等：已存在且原文一致 → 跳过
        errors.push(`第 ${row.row} 行：ID ${id} 已存在于 localization.json 且原文不同（${existing.zhCN.slice(0, 24)}…），可能是重复导出的旧表，请重新导出`)
        continue
      }
      additions.push(row)
    } else {
      if (!existingById.has(id)) { errors.push(`第 ${row.row} 行：ID ${id} 不存在于 localization.json，无法补译`); continue }
      fills.push(row)
    }
  }
  return { errors, warnings, additions, fills }
}

const core = {
  REF_RE, COLOR_RE, LOCAL_RE, GLOBAL_RE, normalizeText, splitRefSegments, classifyText,
  buildStringAttributeIds, loopListAttributeId, localizationIds, collectRefKeys, collectCandidates,
  mergeCandidates, findMissingTranslations, buildScanResult, locateValue, setValue, replaceSegment,
  applyAssetReplacement, localizationInsertion, validateImportRows, randomHex16, EXT_TYPE,
  LOCALIZATION_FOLDER, serializeLike, clone,
}
globalThis.LocalizationLabCore = core

// [DOM]

// eslint-disable-next-line no-undef
if (typeof document !== 'undefined') initializeLocalizationLab()

// eslint-disable-next-line no-unused-vars
function initializeLocalizationLab() {
  const WATCH_INTERVAL_MS = 5000
  const $ = (selector) => document.querySelector(selector)
  const els = {
    projectState: $('#project-state'), pickProject: $('#pick-project'), restoreProject: $('#restore-project'),
    folderFallback: $('#folder-fallback'), btnExport: $('#btn-export'), btnImport: $('#btn-import'), importXlsx: $('#import-xlsx'),
    btnRescan: $('#btn-rescan'), filterSource: $('#filter-source'), filterConfidence: $('#filter-confidence'), filterQuery: $('#filter-query'),
    metricCandidates: $('#metric-candidates'), metricMissing: $('#metric-missing'), metricMissingLangs: $('#metric-missing-langs'), metricOrphans: $('#metric-orphans'),
    listBody: $('#list-body'), scanStatus: $('#scan-status'),
    importPreview: $('#import-preview'), importPreviewSummary: $('#import-preview-summary'), importPreviewBody: $('#import-preview-body'),
    btnCancelImport: $('#btn-cancel-import'), btnConfirmImport: $('#btn-confirm-import'), toastRegion: $('#toast-region'),
  }
  const state = {
    rootHandle: null, lastRootHandle: null, scan: null, filter: 'candidates', filterSourceValue: 'all', filterConfidenceValue: 'all', filterQueryValue: '',
    importRows: null, importErrors: null, importAdditions: null, importFills: null, selectedIds: new Set(), pendingFiles: [],
    watchPaths: [], watchTimer: null, watchSnapshot: new Map(), watchRunning: false,
  }
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  function toast(message, type = 'info') {
    const element = document.createElement('div')
    element.className = `toast ${type}`
    element.textContent = message
    els.toastRegion.appendChild(element)
    setTimeout(() => element.remove(), 3200)
  }
  function typeLabel(type) {
    return ({ items: '物品', equipments: '装备', skills: '技能', states: '状态', events: '事件', ui: '界面', triggers: '触发器' })[type] || type
  }
  const formatNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  // ---- 工程记忆（indexedDB，与角色编辑器同库同键） ----
  let settingsDatabasePromise = null
  function openSettingsDatabase() {
    if (settingsDatabasePromise) return settingsDatabasePromise
    settingsDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('loot-smith-settings', 1)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings') }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return settingsDatabasePromise
  }
  async function setting(key, value) {
    const database = await openSettingsDatabase()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('settings', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('settings')
      const request = value === undefined ? store.get(key) : store.put(value, key)
      request.onsuccess = () => resolve(value === undefined ? request.result : value)
      request.onerror = () => reject(request.error)
    })
  }

  async function getHandle(root, path) {
    const parts = String(path).split('/').filter(Boolean)
    let directory = root
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
    return directory.getFileHandle(parts.at(-1))
  }
  async function readText(root, path) { return (await (await getHandle(root, path)).getFile()).text() }
  async function readJson(root, path) { return JSON.parse(await readText(root, path)) }

  async function collectAssets(root, manifest) {
    const assets = []
    for (const type of ['items', 'equipments', 'skills', 'states', 'events', 'ui', 'triggers']) {
      for (const entry of manifest[type] || []) {
        try { assets.push({ file: entry.path, type, data: await readJson(root, entry.path) }) } catch (error) { console.warn('跳过无法读取的文件', entry.path, error) }
      }
    }
    return assets
  }
  async function scanProject(root) {
    stopAutoSync()
    els.projectState.textContent = '正在扫描…'
    try {
      const [manifest, attributeJson, localizationJson, configJson] = await Promise.all([
        readJson(root, 'Data/manifest.json'), readJson(root, 'Data/attribute.json'), readJson(root, 'Data/localization.json'),
        readJson(root, 'Data/config.json').catch(() => ({})),
      ])
      const languages = (configJson.localization && configJson.localization.languages && configJson.localization.languages.map((l) => l.name)) || ['zh-CN', 'en']
      const assets = await collectAssets(root, manifest)
      state.scan = buildScanResult(assets, { attributeJson, localizationJson, languages })
      state.scanLocalization = localizationJson
      state.rootHandle = root
      state.lastRootHandle = root
      state.watchPaths = ['Data/manifest.json', 'Data/attribute.json', 'Data/localization.json', 'Data/config.json',
        ...['items', 'equipments', 'skills', 'states', 'events', 'ui', 'triggers'].flatMap((type) => (manifest[type] || []).map((e) => e.path))]
      els.btnExport.disabled = false
      els.btnImport.disabled = !root || state.importRows !== null
      els.projectState.textContent = root.name || '工程已导入'
      els.scanStatus.textContent = `扫描完成 · ${state.scan.candidates.length} 候选 · ${state.scan.missing.length} 缺翻译 · ${state.scan.orphans.length} 孤儿`
      renderScan()
      startAutoSync()
    } catch (error) {
      els.scanStatus.textContent = '扫描失败'
      toast(`扫描失败：${error.message}`, 'error')
      console.error(error)
    }
  }
  async function scanProjectFiles(files) {
    stopAutoSync()
    els.projectState.textContent = '正在扫描…'
    try {
      // webkitRelativePath 首段是所选目录名（如 yami-tools-localize-e2e/Data/manifest.json），去掉后才是工程内相对路径
      const rel = (file) => { const p = file.webkitRelativePath || ''; const i = p.indexOf('/'); return i === -1 ? p : p.slice(i + 1) }
      const byPath = new Map(files.map((file) => [rel(file), file]))
      const readData = async (path) => JSON.parse(await byPath.get(path).text())
      const manifest = byPath.has('Data/manifest.json') ? await readData('Data/manifest.json') : null
      const assets = []
      if (manifest) {
        for (const type of ['items', 'equipments', 'skills', 'states', 'events', 'ui', 'triggers']) {
          for (const entry of manifest[type] || []) {
            const file = byPath.get(entry.path)
            if (!file) continue
            try { assets.push({ file: entry.path, type, data: JSON.parse(await file.text()) }) } catch {}
          }
        }
      } else {
        for (const file of files) {
          const ext = '.' + file.name.split('.').pop().toLowerCase()
          const type = EXT_TYPE[ext]
          if (!type) continue
          try { assets.push({ file: rel(file), type, data: JSON.parse(await file.text()) }) } catch {}
        }
      }
      const attributeJson = byPath.has('Data/attribute.json') ? await readData('Data/attribute.json') : { keys: [] }
      const localizationJson = byPath.has('Data/localization.json') ? await readData('Data/localization.json') : { list: [] }
      let languages = ['zh-CN', 'en']
      if (byPath.has('Data/config.json')) {
        try {
          const config = JSON.parse(await byPath.get('Data/config.json').text())
          if (config.localization && config.localization.languages) languages = config.localization.languages.map((l) => l.name)
        } catch {}
      }
      state.scan = buildScanResult(assets, { attributeJson, localizationJson, languages })
      state.scanLocalization = localizationJson
      state.lastRootHandle = null
      state.watchPaths = []
      els.btnExport.disabled = false
      els.btnImport.disabled = true // fallback 导入模式只读，不写回工程
      els.projectState.textContent = '已导入工程（只读）'
      els.scanStatus.textContent = `扫描完成 · ${state.scan.candidates.length} 候选 · ${state.scan.missing.length} 缺翻译 · ${state.scan.orphans.length} 孤儿`
      renderScan()
    } catch (error) {
      els.scanStatus.textContent = '扫描失败'
      toast(`扫描失败：${error.message}`, 'error')
      console.error(error)
    }
  }

  // ---- 渲染 ----
  function renderScan() {
    const scan = state.scan
    if (!scan) return
    els.metricCandidates.textContent = scan.candidates.length
    els.metricMissing.textContent = scan.missing.length
    els.metricMissingLangs.textContent = `缺：${scan.missing.reduce((n, m) => n + m.missingLangs.length, 0)} 语言 · 共 ${scan.languages.length} 种语言`
    els.metricOrphans.textContent = scan.orphans.length
    state.selectedIds = new Set(scan.candidates.map((c) => c.normalized)) // 默认全选，导出范围由勾选控制
    renderList()
  }
  function renderList() {
    const scan = state.scan
    if (!scan) { els.listBody.innerHTML = ''; return }
    let html = ''
    if (state.filter === 'missing') html = renderMissingRows(scan.missing)
    else if (state.filter === 'orphans') html = renderOrphanRows(scan.orphans)
    else html = renderCandidateRows(scan.candidates)
    els.listBody.innerHTML = html || '<div class="empty-state">没有匹配的条目。</div>'
    els.listBody.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedIds.add(checkbox.dataset.key)
        else state.selectedIds.delete(checkbox.dataset.key)
      })
    })
  }
  function renderCandidateRows(candidates) {
    const scan = state.scan
    const query = state.filterQueryValue
    const rows = candidates.filter((c) => {
      if (state.filterSourceValue !== 'all' && c.sourceType !== state.filterSourceValue) return false
      if (state.filterConfidenceValue !== 'all' && c.confidence !== state.filterConfidenceValue) return false
      if (query && !c.zhCN.toLowerCase().includes(query) && !c.locations.some((l) => l.file.toLowerCase().includes(query))) return false
      return true
    })
    return `<table class="candidate-table"><thead><tr><th class="col-check">勾选</th><th>原文</th><th>语言</th><th>处理</th><th>置信度</th><th>来源</th><th class="col-loc">出现位置</th></tr></thead><tbody>${rows.map((c) => {
      const checked = state.selectedIds.has(c.normalized) ? 'checked' : ''
      const locations = c.locations.slice(0, 4).map((l) => `<span class="loc-file">${escapeHtml(l.file)}</span><span class="loc-path">${escapeHtml(l.path)}</span>`).join('')
      const more = c.locations.length > 4 ? `<span class="loc-path">…共 ${c.locations.length} 处</span>` : ''
      return `<tr${checked ? ' class="selected"' : ''}>
        <td class="col-check"><input type="checkbox" data-key="${escapeHtml(c.normalized)}" ${checked} /></td>
        <td class="col-text"><span class="raw col-zh">${escapeHtml(c.zhCN)}</span></td>
        <td class="col-text"><span class="raw col-en">${scan.languages.length > 1 ? scan.languages.slice(1).map((l) => `${l}：待翻译`).join(' · ') : ''}</span></td>
        <td><select class="handle-select" data-key="${escapeHtml(c.normalized)}"><option selected>替换</option><option>忽略</option></select></td>
        <td><span class="conf-badge ${c.confidence === 'high' ? 'conf-high' : 'conf-medium'}">${c.confidence === 'high' ? '高' : '中'}</span></td>
        <td><span class="type-badge">${typeLabel(c.sourceType)}</span></td>
        <td class="col-loc">${locations}${more}</td></tr>`
    }).join('')}</tbody></table>`
  }
  function renderMissingRows(missing) {
    const scan = state.scan
    const query = state.filterQueryValue
    const rows = missing.filter((m) => !query || m.id.includes(query) || m.name.includes(query) || (m.languages[m.languages[0]] || '').includes(query))
    return `<table class="candidate-table"><thead><tr><th>ID</th><th>名称</th><th>中文</th>${scan.languages.slice(1).map((l) => `<th>${l}</th>`).join('')}<th>缺语言</th></tr></thead><tbody>${rows.map((m) => `<tr>
      <td class="col-muted">${m.id}</td><td>${escapeHtml(m.name)}</td><td class="col-text"><span class="raw col-zh">${escapeHtml(m.languages[scan.languages[0]] || '')}</span></td>
      ${scan.languages.slice(1).map((l) => `<td class="${m.languages[l] ? 'col-muted' : 'col-danger'}">${escapeHtml(m.languages[l] || '(空)')}</td>`).join('')}
      <td class="col-danger">${m.missingLangs.join(', ')}</td></tr>`).join('')}</tbody></table>`
  }
  function renderOrphanRows(orphans) {
    const query = state.filterQueryValue
    const rows = orphans.filter((o) => !query || o.refId.includes(query) || o.file.includes(query))
    return `<table class="candidate-table"><thead><tr><th>引用 ID</th><th>文件</th><th>位置</th></tr></thead><tbody>${rows.map((o) => `<tr>
      <td class="col-danger">${o.refId}</td><td class="col-loc"><span class="loc-file">${escapeHtml(o.file)}</span></td><td class="col-muted">${escapeHtml(o.path)}</td></tr>`).join('')}</tbody></table>`
  }

  // ---- 导出 Excel ----
  async function buildExportWorkbook() {
    const scan = state.scan
    const workbook = new ExcelJS.Workbook()
    const primary = scan.languages[0]
    const other = scan.languages.filter((l) => l !== primary)
    const candidates = scan.candidates.filter((c) => state.selectedIds.has(c.normalized))
    const addSheet = workbook.addWorksheet('待本地化')
    addSheet.columns = ['ID', `原文(${primary})`, ...other, '处理方式', '置信度', '来源', '出现位置'].map((h) => ({ header: h, width: h === '出现位置' ? 46 : 14 }))
    addSheet.getRow(1).font = { bold: true }
    addSheet.views = [{ state: 'frozen', ySplit: 1 }]
    candidates.forEach((c, i) => {
      c.id = c.id || randomHex16()
      const row = addSheet.getRow(i + 2)
      const locations = c.locations.map((l) => `${l.file} :: ${l.path}`).join('\n')
      row.getCell(1).value = c.id
      row.getCell(2).value = c.zhCN
      other.forEach((lang, j) => { row.getCell(3 + j).value = '' })
      row.getCell(3 + other.length).value = '替换'
      row.getCell(4 + other.length).value = c.confidence === 'high' ? '高' : '中'
      row.getCell(5 + other.length).value = typeLabel(c.sourceType)
      row.getCell(6 + other.length).value = locations
      row.getCell(2).alignment = { wrapText: true }
      row.getCell(6 + other.length).alignment = { wrapText: true }
    })
    const fillSheet = workbook.addWorksheet('缺翻译')
    fillSheet.columns = ['ID', '名称', `原文(${primary})`, ...other, '缺语言', '备注'].map((h) => ({ header: h, width: h.includes('原文') || h === '备注' ? 18 : 14 }))
    fillSheet.getRow(1).font = { bold: true }
    fillSheet.views = [{ state: 'frozen', ySplit: 1 }]
    scan.missing.forEach((m, i) => {
      const row = fillSheet.getRow(i + 2)
      row.getCell(1).value = m.id
      row.getCell(2).value = m.name
      row.getCell(3).value = m.languages[primary]
      other.forEach((lang, j) => { row.getCell(4 + j).value = m.languages[lang] })
      row.getCell(4 + other.length).value = m.missingLangs.join(', ')
      row.getCell(5 + other.length).value = m.missingLangs.map((lang) => (m.languages[lang] && m.languages[lang].trim() ? `${lang} 已有值（疑似占位符），请确认` : '')).filter(Boolean).join('；')
    })
    const orphanSheet = workbook.addWorksheet('孤儿引用')
    orphanSheet.columns = [{ header: '引用ID', width: 20 }, { header: '文件', width: 50 }, { header: '位置', width: 30 }]
    orphanSheet.getRow(1).font = { bold: true }
    scan.orphans.forEach((o, i) => { orphanSheet.getRow(i + 2).values = [null, o.refId, o.file, o.path] })
    const guideSheet = workbook.addWorksheet('说明')
    guideSheet.getRow(1).values = [null, '快速本地化 · 填写指引']
    const guide = [
      '1. 「待本地化」表：导出时已预分配 ID（请勿修改），每行是工程中尚未本地化的文本。填好各语言列后，导入时会把原文替换为 <ref:ID> 引用。',
      '2. 「处理方式」列可改为「忽略」：该行导入时跳过，不创建条目也不替换。',
      '3. 「缺翻译」表：已存在的本地化条目，补填缺失语言列即可；导入时写回 localization.json。',
      '4. 删除整行 = 放弃该条（待本地化表中的 ID 不会写入工程）；请勿只删单元格留下空行。',
      '5. 语言列由 Data/config.json 的 localization.languages 决定，未来加语言只需在配置中追加并重新导出。',
      '6. 同一 Excel 重复导入是安全的（已处理过的条目自动跳过）；导入前工具会重新扫描工程，发现文件被外部改动会中止导入。',
    ]
    guide.forEach((line, i) => { guideSheet.getRow(i + 3).values = [null, line] })
    guideSheet.getColumn(2).width = 120
    return workbook
  }
  async function exportExcel() {
    if (!state.scan) return
    try {
      const workbook = await buildExportWorkbook()
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `localization-导出-${formatNow()}.xlsx`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      toast(`已导出 ${state.scan.candidates.length} 候选 / ${state.scan.missing.length} 缺翻译 / ${state.scan.orphans.length} 孤儿`, 'success')
    } catch (error) { toast(`导出失败：${error.message}`, 'error'); console.error(error) }
  }

  // ---- 导入 Excel ----
  function cellText(value) {
    if (value == null) return ''
    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) return value.richText.map((t) => t.text || '').join('')
      if (value.result != null) return String(value.result)
      return String(value)
    }
    return String(value)
  }
  async function readImportWorkbook(buffer) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const rows = []
    for (const sheet of workbook.worksheets) {
      if (!sheet.name.includes('待本地化') && !sheet.name.includes('缺翻译')) continue
      const isAdd = sheet.name.includes('待本地化')
      const header = sheet.getRow(1)
      const cols = {}
      header.eachCell({ includeEmpty: false }, (cell, col) => { cols[cellText(cell.value).trim()] = col })
      if (!cols.ID) throw new Error(`${sheet.name} 缺少 ID 列`)
      const primaryCol = Object.keys(cols).find((name) => name.startsWith('原文'))
      if (!primaryCol) throw new Error(`${sheet.name} 缺少原文列`)
      const langCols = []
      for (const [name, col] of Object.entries(cols)) {
        if (name !== 'ID' && name !== primaryCol && name !== '处理方式' && name !== '置信度' && name !== '来源' && name !== '出现位置' && name !== '名称' && name !== '缺语言' && name !== '备注') langCols.push({ name, col })
      }
      for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r)
        const id = cellText(row.getCell(cols.ID).value)
        if (!id.trim()) continue
        const langs = {}
        for (const { name, col } of langCols) langs[name] = cellText(row.getCell(col).value)
        rows.push({
          sheet: isAdd ? 'add' : 'fill', row: r, id,
          zhCN: cellText(row.getCell(cols[primaryCol]).value),
          langs,
          handle: cols['处理方式'] ? cellText(row.getCell(cols['处理方式']).value) : '替换',
        })
      }
    }
    return rows
  }
  async function handleImportFile(file) {
    if (!state.scan || !state.rootHandle) { toast('只读导入模式无法写回工程，请使用「选择工程」授权后导入', 'error'); return }
    try {
      const rows = await readImportWorkbook(await file.arrayBuffer())
      const existingById = new Map()
      const collect = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) collect(item.children); else if (item && item.id && item.contents) existingById.set(item.id, { zhCN: typeof item.contents[state.scan.languages[0]] === 'string' ? item.contents[state.scan.languages[0]] : '', leaf: item }) } }
      collect(state.scanLocalization)
      const { errors, additions, fills } = core.validateImportRows(rows, existingById, state.scan.languages)
      state.importRows = rows
      state.importErrors = errors
      state.importAdditions = additions
      state.importFills = fills
      renderImportPreview()
    } catch (error) { toast(`导入失败：${error.message}`, 'error'); console.error(error) }
  }
  function renderImportPreview() {
    const { errors, additions, fills } = state
    els.importPreview.classList.remove('hidden')
    const involved = new Set()
    for (const row of additions) {
      const candidate = state.scan.candidates.find((c) => c.id === row.id)
      if (candidate) candidate.locations.forEach((l) => involved.add(l.file))
    }
    els.importPreviewSummary.textContent = `将新增 ${additions.length} 条本地化并替换 ${involved.size} 个文件中的原文 · 补译 ${fills.length} 条 · 错误 ${errors.length} 条`
    els.importPreviewBody.innerHTML = errors.map((e) => `<div class="err">✕ ${escapeHtml(e)}</div>`).join('')
      + (additions.length ? `<div class="ok">＋ ${additions.length} 条新增（含译文：${additions.filter((r) => Object.values(r.langs).some((v) => v && v.trim())).length}）</div>` : '')
      + (fills.length ? `<div class="ok">＋ ${fills.length} 条补译</div>` : '')
      + (additions.length && involved.size ? `<div class="ok">＋ 将写入 ${involved.size} 个资产文件与 localization.json（先备份，失败自动回滚）</div>` : '')
    els.btnConfirmImport.disabled = errors.length > 0 || (additions.length === 0 && fills.length === 0)
  }
  async function confirmImport() {
    const { importRows, importAdditions, importFills, importErrors } = state
    if (importErrors.length) { toast('存在错误行，请修正后重新导入', 'error'); return }
    if (!importAdditions.length && !importFills.length) { toast('没有可导入的内容', 'info'); return }
    els.btnConfirmImport.disabled = true
    try {
      // 1) 重扫工程，确保位置与内容权威
      const [manifest, localizationJson, configJson] = await Promise.all([
        readJson(state.rootHandle, 'Data/manifest.json'), readJson(state.rootHandle, 'Data/localization.json'), readJson(state.rootHandle, 'Data/config.json').catch(() => ({})),
      ])
      // 2) 读取待写资产文件并校验（按 候选×文件 分组：同一候选同一文件的多个位置须一次调用先校验后替换）
      const filesToWrite = new Map()
      const groups = []
      const seenGroups = new Set()
      for (const row of importAdditions) {
        const candidate = state.scan.candidates.find((c) => c.id === row.id)
        if (!candidate) throw new Error(`ID ${row.id} 不在导出范围内`)
        if (row.handle && row.handle.trim() === '忽略') continue
        for (const loc of candidate.locations) {
          const key = `${row.id}::${loc.file}`
          if (!seenGroups.has(key)) { seenGroups.add(key); groups.push({ candidate, file: loc.file }) }
        }
      }
      for (const { candidate, file } of groups) {
        if (!filesToWrite.has(file)) {
          try {
            const original = await readText(state.rootHandle, file)
            filesToWrite.set(file, { data: JSON.parse(original), original })
          } catch (error) { throw new Error(`无法读取 ${file}：${error.message}`) }
        }
        const result = core.applyAssetReplacement(filesToWrite.get(file).data, candidate, file)
        if (!result.ok) throw new Error(result.reason)
      }
      // 3) 备份（Lootsmith Backups/<时间戳>/：localization.json + 全部待写资产文件）
      const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups', { create: true })
      const backupDir = await backupRoot.getDirectoryHandle(formatNow(), { create: true })
      const writeFileTo = async (handle, content) => {
        const file = await handle.createWritable()
        await file.write(content)
        await file.close()
      }
      await writeFileTo(await backupDir.getFileHandle('localization.json', { create: true }), await readText(state.rootHandle, 'Data/localization.json'))
      for (const file of filesToWrite.keys()) {
        await writeFileTo(await backupDir.getFileHandle(file.replace(/\//g, '__'), { create: true }), await readText(state.rootHandle, file))
      }
      // 4) 写入资产文件（仿生原文件换行风格）
      for (const [file, { data, original }] of filesToWrite) {
        await writeFileTo(await getHandle(state.rootHandle, file), core.serializeLike(data, original))
      }
      // 5) 写入 localization.json（补译 + 新增，仿生原文件换行风格）
      const additions = []
      for (const row of importAdditions) {
        if (row.handle && row.handle.trim() === '忽略') continue
        const candidate = state.scan.candidates.find((c) => c.id === row.id)
        additions.push({ id: row.id, zhCN: row.zhCN, langs: row.langs, candidate })
      }
      core.localizationInsertion(localizationJson, additions, importFills, state.scan.languages)
      const originalLocalization = await readText(state.rootHandle, 'Data/localization.json')
      await writeFileTo(await getHandle(state.rootHandle, 'Data/localization.json'), core.serializeLike(localizationJson, originalLocalization))
      // 6) 完成：重置导入状态并重扫
      state.importRows = state.importErrors = state.importAdditions = state.importFills = null
      els.importPreview.classList.add('hidden')
      toast(`导入完成：新增 ${additions.length} 条 · 补译 ${importFills.length} 条 · 备份于 Lootsmith Backups/${backupDir.name}`, 'success')
      await scanProject(state.rootHandle)
    } catch (error) {
      els.btnConfirmImport.disabled = false
      toast(`导入中止：${error.message}`, 'error')
      console.error(error)
    }
  }

  // ---- 自动同步（ponytail: 固定 watchPaths 元数据轮询，5s；不自动重扫覆盖用户操作，只提示） ----
  function fileStamp(value) {
    if (value instanceof File) return `${value.lastModified}:${value.size}`
    return `${value.lastModified || 0}:${value.size || 0}`
  }
  async function captureWatchSnapshot() {
    if (!state.rootHandle) return
    const snapshot = new Map()
    for (const path of state.watchPaths) {
      try {
        const file = await (await getHandle(state.rootHandle, path)).getFile()
        snapshot.set(path, fileStamp(file))
      } catch { snapshot.set(path, 'missing') }
    }
    state.watchSnapshot = snapshot
  }
  async function pollWatchSnapshot() {
    if (!state.rootHandle || !state.watchPaths.length || document.visibilityState !== 'visible') return
    for (const path of state.watchPaths) {
      let current = 'missing'
      try {
        const file = await (await getHandle(state.rootHandle, path)).getFile()
        current = fileStamp(file)
      } catch {}
      if (state.watchSnapshot.get(path) !== current) {
        showSyncNotice()
        await captureWatchSnapshot()
        return
      }
    }
  }
  function showSyncNotice() {
    toast('检测到工程文件变化，请点击「重新扫描」刷新本地化数据', 'info')
    els.btnRescan.classList.add('notice')
    setTimeout(() => els.btnRescan.classList.remove('notice'), 6000)
  }
  function startAutoSync() {
    stopAutoSync()
    if (!state.rootHandle) return
    captureWatchSnapshot()
    state.watchTimer = setInterval(pollWatchSnapshot, WATCH_INTERVAL_MS)
    state.watchRunning = true
  }
  function stopAutoSync() {
    if (state.watchTimer) { clearInterval(state.watchTimer); state.watchTimer = null }
    state.watchRunning = false
  }

  // ---- 工程选择 ----
  async function rememberRootHandle(root) { try { await setting('last-project-handle', root) } catch {} }
  async function loadRememberedProject() {
    let root = null
    try { root = await setting('last-project-handle') } catch {}
    if (!root) return
    let permission = await root.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') permission = await root.requestPermission({ mode: 'readwrite' })
    if (permission === 'granted') {
      els.restoreProject.classList.add('hidden')
      await scanProject(root)
    } else {
      els.restoreProject.classList.remove('hidden')
      els.restoreProject.textContent = `加载上次工程（${root.name}）`
    }
  }
  async function chooseProject() {
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' })
      els.restoreProject.classList.add('hidden')
      await rememberRootHandle(root)
      await scanProject(root)
    } catch (error) {
      if (error && error.name === 'AbortError') return
      toast(`选择工程失败：${error.message}`, 'error')
      console.error(error)
    }
  }

  // ---- 事件绑定 ----
  els.pickProject.addEventListener('click', chooseProject)
  els.restoreProject.addEventListener('click', async () => {
    const root = await setting('last-project-handle')
    if (root) { const permission = await root.requestPermission({ mode: 'readwrite' }); if (permission === 'granted') await scanProject(root) }
  })
  els.folderFallback.addEventListener('change', () => {
    if (els.folderFallback.files.length) { const files = [...els.folderFallback.files]; scanProjectFiles(files) }
  })
  els.btnExport.addEventListener('click', exportExcel)
  els.btnImport.addEventListener('click', () => els.importXlsx.click())
  els.importXlsx.addEventListener('change', () => {
    if (els.importXlsx.files[0]) handleImportFile(els.importXlsx.files[0])
    els.importXlsx.value = ''
  })
  els.btnRescan.addEventListener('click', () => { if (state.rootHandle) scanProject(state.rootHandle) })
  els.btnCancelImport.addEventListener('click', () => {
    state.importRows = state.importErrors = state.importAdditions = state.importFills = null
    els.importPreview.classList.add('hidden')
  })
  els.btnConfirmImport.addEventListener('click', confirmImport)
  els.filterSource.addEventListener('change', () => { state.filterSourceValue = els.filterSource.value; renderList() })
  els.filterConfidence.addEventListener('change', () => { state.filterConfidenceValue = els.filterConfidence.value; renderList() })
  els.filterQuery.addEventListener('input', () => { state.filterQueryValue = els.filterQuery.value.trim().toLowerCase(); renderList() })
  document.querySelectorAll('.metric-card').forEach((card) => card.addEventListener('click', () => {
    document.querySelectorAll('.metric-card').forEach((c) => c.classList.remove('active'))
    card.classList.add('active')
    state.filter = card.dataset.filter
    els.filterSource.value = 'all'
    state.filterSourceValue = 'all'
    renderList()
  }))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.importPreview.classList.add('hidden')
      state.importRows = state.importErrors = state.importAdditions = state.importFills = null
    }
  })

  loadRememberedProject()
}
