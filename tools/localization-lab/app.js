/* 快速本地化：扫描未本地化文本、缺翻译条目与孤儿引用；导出/导入多语言 Excel。
   顶部为纯函数核心（node 可跑，self-check.js 直接 require），底部为浏览器 DOM 装配。 */
'use strict'

const REF_RE = /<ref:([0-9a-f]{16})>/gi
// 引擎运行时全部文本标签（printer.js regexps + local.js）：color/italic/bold/size/image/local/global/ref
// 统一剥离：<tag>、</tag>、<tag:参数>——纯标签残留不算文本，标签内文字照常判定
const MARKUP_STRIP_RE = /<\/?[a-z][a-z0-9-]*(?::[^>]*)?>/gi
const MARKUP_TAG_RE = /<\/?[a-z][a-z0-9-]*(?::[^>]*)?>/i
const CJK_RE = /[一-鿿]/
const GUID_RE = /^[0-9a-f]{16}$/i
const LONG_HEX_RE = /^[0-9a-f]{32}$/i
const HEX8_RE = /^[0-9a-f]{8}$/i
const COLOR_HEX_RE = /^#?[0-9a-f]{6}$/i
const NUMERIC_RE = /^[\d\s.,%+\-*/=<>x×（）()]+$/
const EN_TEXT_RE = /^[A-Za-z][A-Za-z\s'\-!?.(),:;%°]*$/
const LOOPLIST_ID = '4cb407bd71929620'
const LOCALIZATION_FOLDER = '快速本地化'
const ORPHAN_FOLDER = '孤儿修复'
// 占位符脏词（整值匹配）：翻译列里出现这些值基本可以断定没真正翻译
const PLACEHOLDER_WORD_RE = /^(shit|fuck|xxx+|test|todo|tbd|fixme|tmp|placeholder|待翻译|未翻译|占位|暂缺|暂不翻译|待定|占位符|暂无)$/i
// 简体独有字（繁体写法不同的常用字）：zh-TW 与 zh-CN 相同且含其中一字 → 大概率没转繁
const SIMPLIFIED_ONLY_RE = /[国语文这们个说见话关开长东车门问无时来会风龙电马鸟鱼觉让军兴样经结层还进书办对产发里离实学写处号业队极间几线验联尔场块买卖头听谁课岁义亿与云专丰为乐习乡亏亲从仑仓仪价众传伤伦伪体余佣侠侣侦侧侨归忆忧怀状犹独猎猫环现玛疗疯盘监着础确礼积称稳穷窃竞笔签简类粮紧约级纪纳纷纸纹纺纽练组细织终绍经绑绕绘给络绝绞统继绩维综绿绵缆编缘缩缴罚罢罗聪肃肤胁胜脑肿胶脸腾胆腻舆举舰舱艺节苍苏劳荣药获营萨蓝虑虫虽虾蚀蚁蚕蛮观规览计订认议记讲设访证评识诉诊词译试诗诚话询该详语误说请诸读课谁调谈谊谋谢谣谨谱谷贝负贡财责货质贩贪购贮贯贱贴贵贸费贺资贾贿赁赐赔赏赚赛赠赞赢赵赶趋践踪跃转轮软轻载辅辈辉辐输辖辙边达过迈迁运还这进远违连迟选适递逻遗辽邮邻郑钟铁铅铜银铸铺链锁锋锐错锡锤锦键锯锻镇镜镐长门闲间闷闹闻阅队阶阳阴阵际陆陈险难随隐虽电雾静页顶项顺须顾顿顽颁领颈频颗题额颠颤风飘飞饭饮饰饱饲饶饺饼饿馆马驱驳驴驶驾骄骆验骑骗骤发鱼鲜鲁鸦鸭鸽鹅鹊鹤鹏鹰麦黄齐龄龙龟亚严两丽举击势动劲历压厌员吴启吨园围图圣坚堕备复声壳奖夺奋妇妆妈婴孙学宁宝审宽宾导寻将尘届屿岭峡岛岗币师带帮干庆应庙库废张强归当录彻忆态恒恶恼惨惩惯懒战戏护报担据挥损换摆摇摄数断敌斗旧旷显晓晒晕术杀杂权条杨枪柜栏标树桥检欢欧汉汤沟没泪泽洁洒浇测济浏浑浓涂润涨渐渔渗湾湿满滥滨滤灵灿炉点炼烧烫热爱爷墙]/

// 命令树文本字段白名单：引擎运行时只有「最终进入 UI.Text.content 的字符串」才会走 Local.replace——
// comment 是开发者注释永不显示（完工工程实测 677 处全是注释噪声）；value 只保留 operand.value 与 properties[n].value
const BASE_TEXT_KEYS = ['value', 'content', 'tag', 'operand']
const SKIP_KEYS = new Set(['name', 'script', 'description', 'namespace', 'id', 'key', 'type', 'enum', 'note', 'title', 'comment'])
// ponytail: 按当前工程命令 tag 噪声起步的排除清单，误报由 Excel 置信度列人工过滤兜底；
// tag/operand 位置整值排除；value 位置仅排除单 token（多词英文保留），防误杀真实文本
const COMMAND_TAG_DENYLIST = new Set([
  'actor', 'global', 'inherit', 'constant', 'variable', 'trigger', 'none', 'add', 'sub', 'set', 'clear',
  'penetrate', 'move', 'attack', 'skill', 'random', 'switch', 'state', 'sound', 'close', 'wait', 'branch',
  'loop', 'call', 'event', 'input', 'mouse', 'key', 'scene', 'anim', 'particle', 'active', 'inactive',
  'true', 'false', 'save', 'load', 'menu', 'system', 'local', 'private', 'public', 'static', 'inline',
  'up', 'down', 'left', 'right', 'forward', 'back', 'item', 'equip', 'skillpoint', 'gold', 'exp', 'open', 'quit',
  'inventory', 'smithy', 'equipment', 'sell', 'buy', 'ranged', 'melee',
])
const EXT_TYPE = { '.item': 'items', '.equip': 'equipments', '.skill': 'skills', '.state': 'states', '.event': 'events', '.ui': 'ui', '.trigger': 'triggers', '.actor': 'actors' }

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
  return String(text).replace(MARKUP_STRIP_RE, '').replace(/\s+/g, ' ').trim()
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

/** 单段文本判定：返回 {confidence:'high'|'medium'} 或 null（排除 GUID/数字/颜色/路径/命令枚举等）。
    判定前先剥全部引擎文本标签（color/italic/bold/size/image/local/global…）——纯标签残留不算文本；
    无 CJK 的残留必须含 ≥2 字母的英文单词才算候选（「]x2」「X10」「<italic>」这类 ref 后缀/占位/裸标签是噪声）。 */
function classifyText(segment, key = '') {
  const raw = String(segment ?? '')
  const text = raw.replace(MARKUP_STRIP_RE, '')
  const trimmed = text.trim()
  if (!trimmed) return null
  // 路径判定必须在 CJK 之前（中文路径如「Assets/物品/a.item」不能算文本）
  if (/^(Assets\/|[A-Za-z]:[\\/]|\/)/.test(trimmed)) return null
  if (CJK_RE.test(text)) return { confidence: 'high' }
  if (GUID_RE.test(trimmed) || LONG_HEX_RE.test(trimmed) || HEX8_RE.test(trimmed) || COLOR_HEX_RE.test(trimmed)) return null
  if (NUMERIC_RE.test(trimmed)) return null
  if (key === 'tag' || key === 'operand') {
    if (COMMAND_TAG_DENYLIST.has(trimmed.toLowerCase())) return null
  } else if (key === 'value' && !/\s/.test(trimmed) && COMMAND_TAG_DENYLIST.has(trimmed.toLowerCase())) {
    return null // value 位置单 token 引擎枚举（菜单页签/方向/商店等），多词文本保留
  }
  if (!/[A-Za-z]{2,}/.test(trimmed)) return null // 无中文残留必须含 ≥2 字母单词（HP/OK/Del/Attack 保留；x2/X10/]x2/单字母/纯符号丢弃）
  return { confidence: 'medium' }
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

/** localization.json：收集全部叶子 ID（小写归一，孤儿引用判定用）。 */
function localizationIds(localizationJson) {
  const ids = new Set()
  const walk = (items) => {
    for (const item of items || []) {
      if (item && Array.isArray(item.children)) walk(item.children)
      else if (item && item.id) ids.add(String(item.id).toLowerCase())
    }
  }
  walk(localizationJson && localizationJson.list)
  return ids
}

/** attribute.json：属性 ID → 语义名（名称/备注/描述…），孤儿引用的上下文提示用。 */
function buildAttributeNames(attributeJson) {
  const names = new Map()
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node && Array.isArray(node.children)) walk(node.children)
      else if (node && node.id) names.set(String(node.id).toLowerCase(), node.name || '')
    }
  }
  walk(attributeJson && attributeJson.keys)
  return names
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

/** 单段值判定并记录候选（共用的 handleValue：ref 分段 / 整值判定）。 */
function scanValueCandidates(value, path, key, type, out) {
  const { hasRef, segments } = splitRefSegments(value)
  if (hasRef) {
    segments.forEach((segment, index) => {
      if (!segment || !segment.trim()) return
      const cls = classifyText(segment, key)
      if (cls) out.push({ kind: 'segment', segmentIdx: index, zhCN: segment, confidence: cls.confidence, path, raw: value, sourceType: type })
    })
  } else {
    const cls = classifyText(value, key)
    if (cls) out.push({ kind: 'full', segmentIdx: -1, zhCN: value, confidence: cls.confidence, path, raw: value, sourceType: type })
  }
}

/** 单个资产文件命令树扫描：界面显示路径的未本地化候选（数据属性另走 collectAttributeCandidates）。
    placeholderPresetIds = 被事件 setText 覆盖的界面节点——其编辑器内容是占位模板，运行时显示的是写入值（已单独扫描）。 */
function collectCandidates(fileJson, type, placeholderPresetIds = null) {
  const candidates = []
  const keys = new Set(BASE_TEXT_KEYS.filter((k) => !SKIP_KEYS.has(k)))
  for (const key of collectRefKeys(fileJson)) keys.add(key)
  // value 位置规则：引擎里 value 只在两类路径是「显示文本」——operand.value（setValue 字符串常量）
  // 与 properties[n].value（setText 文本属性）；其余 params.value/条件 value 是数据标识（树/矿/物资…）
  const valuePathIsText = (p) => {
    const m = /^(.*)\.([^.]+)$/.exec(p)
    if (!m) return false
    return /(?:^|\.)operand$/.test(m[1]) || /properties\[\d+\]$/.test(m[1])
  }
  // operand.value 字符串常量：含标签/空格/≥5 字 → 显示模板；短单 token 纯字词 → 标识符（物资/按下…）
  const operandValueLooksDisplay = (v) => {
    const s = String(v)
    if (MARKUP_TAG_RE.test(s) || /\s/.test(s)) return true
    return s.replace(MARKUP_STRIP_RE, '').trim().length >= 5
  }
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, path + '[' + i + ']')); return }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'attributes') continue // 属性数组由 collectAttributeCandidates 单独处理，不走命令树（防重复）
      const childPath = path ? path + '.' + key : key
      if (key === 'conditions' && Array.isArray(value)) continue // 条件比较：标识符比较，永不显示
      if (typeof value === 'string' && keys.has(key)) {
        // .ui 文本节点 content 且 presetId 被 setText 覆盖 → 占位模板，运行时被写入值替换
        if (key === 'content' && placeholderPresetIds && typeof node.presetId === 'string' && placeholderPresetIds.has(node.presetId.toLowerCase())) continue
        if (key === 'value' && !valuePathIsText(childPath)) continue
        if (key === 'value' && childPath.endsWith('.operand.value') && !operandValueLooksDisplay(value)) continue
        scanValueCandidates(value, childPath, key, type, candidates)
      } else if (value && typeof value === 'object') walk(value, childPath)
    }
  }
  walk(fileJson, '')
  return candidates
}

/** 数据属性扫描：attributes[].value（attribute.json 里 type==='string' 的属性：名称/描述）→ 数据属性 tab 的候选。
    本地化 = 界面显示内容（用户拍板），数据属性是内部数据，单独立 tab 不混进界面候选。 */
function collectAttributeCandidates(fileJson, type, stringAttrIds, skipAttrIds) {
  const candidates = []
  for (let i = 0; i < (fileJson.attributes || []).length; i++) {
    const attr = fileJson.attributes[i]
    if (attr && typeof attr.value === 'string' && stringAttrIds.has(attr.key) && !skipAttrIds.has(attr.key)) {
      scanValueCandidates(attr.value, 'attributes[' + i + '].value', 'attr', type, candidates) // 'attr' 不参与命令 tag 排除（属性文本不是命令枚举）
    }
  }
  return candidates
}


/** 孤儿引用全树扫描：不依赖文本字段白名单——任何含 <ref:ID> 的字符串值都检查目标 ID 是否存在。
    记录上下文：attrKey（属性 ID）、nodeName（.ui 节点编辑器标签）、presetId（所在节点，占位模板判定用）、refIndex/refCount。 */
function collectOrphanRefs(fileJson) {
  const occurrences = []
  const collect = (value, path, attrKey, nodeName, presetId) => {
    const matches = [...String(value).matchAll(/<ref:([0-9a-f]{16})>/gi)]
    for (let i = 0; i < matches.length; i++) {
      occurrences.push({ refId: matches[i][1].toLowerCase(), path, attrKey: attrKey || null, nodeName: nodeName || null, presetId: presetId || null, refIndex: i, refCount: matches.length })
    }
  }
  for (let i = 0; i < (fileJson.attributes || []).length; i++) {
    const attr = fileJson.attributes[i]
    if (attr && typeof attr.value === 'string') collect(attr.value, 'attributes[' + i + '].value', attr.key || null, null, null)
  }
  const walk = (node, path, nodeName, presetId) => {
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, path + '[' + i + ']', nodeName, presetId)); return }
    if (!node || typeof node !== 'object') return
    const name = typeof node.name === 'string' && node.name.trim() ? node.name : nodeName
    const pid = typeof node.presetId === 'string' && node.presetId ? node.presetId.toLowerCase() : presetId
    for (const [key, value] of Object.entries(node)) {
      if (key === 'attributes' || key === 'name') continue
      if (typeof value === 'string') collect(value, path ? path + '.' + key : key, null, name, pid)
      else if (value && typeof value === 'object') walk(value, path ? path + '.' + key : key, name, pid)
    }
  }
  walk(fileJson, '', null, null)
  return occurrences
}

/** setText 目标节点集合：被事件 setText 写入的界面节点 presetId——其 .ui 编辑器内容是占位模板，运行时显示的是写入值。 */
function collectSetTextTargets(data) {
  const set = new Set()
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    if (node.id === 'setText' && node.params && node.params.element && typeof node.params.element === 'object' && typeof node.params.element.presetId === 'string' && node.params.element.presetId) {
      set.add(node.params.element.presetId.toLowerCase())
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value)
  }
  walk(data)
  return set
}

/** 引用出现位置分类：attribute=数据属性（数据 tab）；display=界面显示路径；other=不显示（注释/条件/标签等）。 */
function refPathKind(path) {
  if (/^attributes\[\d+\]\.value$/.test(path)) return 'attribute'
  if (/\.content$/.test(path)) return 'display'
  if (/properties\[\d+\]\.value$/.test(path)) return 'display'
  if (/\.operand\.value$/.test(path)) return 'display'
  return 'other'
}

/** 文件名核心：去路径、去扩展名、去尾部 16hex GUID（「010.兽人.c65e716280b38eef.actor」→「010.兽人」）。 */
function filenameCore(file) {
  const base = String(file).split('/').pop()
  return base
    .replace(/\.(?:item|equip|skill|state|event|ui|trigger|actor|anim|particle)$/i, '')
    .replace(/\.(?:[0-9a-f]{16})$/i, '')
}

/** 最高频项；并列取最短（「大恶魔」胜过「大恶魔-远程」）。 */
function mostFrequent(items) {
  const count = new Map()
  for (const item of items) count.set(item, (count.get(item) || 0) + 1)
  let best = null
  let bestCount = 0
  for (const [item, n] of count) {
    if (n > bestCount || (n === bestCount && best !== null && item.length < best.length)) { best = item; bestCount = n }
  }
  return best
}

/** 孤儿建议文本：① 名称属性的 ref → 文件名推导（剥序号；同值多 ref 只推第一个，后缀 ref 留给人工）；② .ui 节点编辑器标签。 */
function orphanSuggestion(group) {
  const NAME_ATTRS = ['名称', '名字', 'name']
  const nameUses = group.uses.filter((u) => NAME_ATTRS.includes(u.attrName))
  if (nameUses.length) {
    const firstOnly = nameUses.filter((u) => u.refIndex === 0)
    if (firstOnly.length) {
      const core = mostFrequent(firstOnly.map((u) => filenameCore(u.file)))
      if (core) {
        let s = core.replace(/^\d+\s*[.．、]\s*/, '')
        if (firstOnly.some((u) => u.refCount > 1)) s = s.replace(/\s*[-－—]\s*[^-－—]+$/, '')
        return s.trim()
      }
    }
    return ''
  }
  const nodeNames = group.uses.map((u) => u.nodeName).filter((n) => n && CJK_RE.test(n))
  return nodeNames.length ? mostFrequent(nodeNames) : ''
}

/** 孤儿按 refId 分组（同 ID 多处引用合并成一条，创建一次处处生效）；有建议文本的排前面。 */
function groupOrphans(occurrences) {
  const map = new Map()
  for (const o of occurrences) {
    const group = map.get(o.refId) || { refId: o.refId, uses: [], count: 0, files: new Set() }
    group.uses.push({ file: o.file, path: o.path, attrKey: o.attrKey, attrName: o.attrName, nodeName: o.nodeName, refIndex: o.refIndex, refCount: o.refCount })
    group.count += 1
    group.files.add(o.file)
    map.set(o.refId, group)
  }
  const orphans = []
  for (const group of map.values()) {
    orphans.push({ refId: group.refId, uses: group.uses, count: group.count, fileCount: group.files.size, suggestion: orphanSuggestion(group) })
  }
  orphans.sort((a, b) => (b.suggestion ? 1 : 0) - (a.suggestion ? 1 : 0) || a.refId.localeCompare(b.refId))
  return orphans
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

/** 疑似占位翻译：译文是明显占位脏词（shit/xxx/test/待翻译…）。
    「与原文相同」不再判定——完工工程实测 188 条 zh-TW + 40 条 ja 与 zh-CN 相同是开发者有意状态（未翻译该语言），不是占位符；空译文由「缺翻译」视图负责。 */
function findSuspiciousTranslations(localizationJson, languages) {
  const suspicious = []
  const walk = (items, folder) => {
    for (const item of items || []) {
      if (item && Array.isArray(item.children)) walk(item.children, item.name || '')
      else if (item && item.id && item.contents) {
        const langs = {}
        for (const lang of languages) langs[lang] = typeof item.contents[lang] === 'string' ? item.contents[lang] : ''
        const flagged = []
        for (const lang of languages.slice(1)) {
          const value = langs[lang].trim()
          if (value && PLACEHOLDER_WORD_RE.test(value)) flagged.push({ lang, value, reason: '占位词' })
        }
        if (flagged.length) suspicious.push({ id: item.id, name: item.name || '', folder: folder || '', languages: langs, suspicious: flagged })
      }
    }
  }
  walk(localizationJson && localizationJson.list, '')
  return suspicious
}

/** 文件名里提取资产 GUID（「010.兽人.c65e716280b38eef.actor」→ c65e716280b38eef）。 */
function assetGuid(file) {
  const match = /\.([0-9a-f]{16})\.\S+$/.exec(String(file))
  return match ? match[1].toLowerCase() : null
}

/** 复刻引擎打包算法的「已引用文件」判定（编辑器 data-object.js createReferencedFileIDMap:334-387）：
    ① 全部资产文件内容 + plugins/commands/config 里出现的「纯 16hex GUID 字符串值」；
    ② UI/场景节点的 presetId（事件按预设元素引用 → 经 uiPresets/scenePresets 反查所在文件）；
    ③ 自动触发事件（type ≠ 'common'）自身；④ 脚本 meta（guid+code）自标记 + 脚本代码内的引号 GUID。
    打包只打已引用文件——未出现在该集合里的资产游戏里用不到，不需要本地化。 */
function referencedFileIds(references) {
  const uiPresets = {}
  const scenePresets = {}
  const walkNodes = (nodes, setter) => {
    for (const node of nodes || []) {
      if (!node || typeof node !== 'object') continue
      setter(node)
      if (Array.isArray(node.children) && node.children.length) walkNodes(node.children, setter)
    }
  }
  for (const item of references.data || []) {
    if (!item.guid) continue
    if (item.type === 'ui' && item.data) walkNodes(item.data.nodes, (n) => { if (n.presetId) uiPresets[n.presetId] = item.guid })
    else if (item.type === 'scenes' && item.data) walkNodes(item.data.objects, (n) => { if (n.presetId) scenePresets[n.presetId] = item.guid })
  }
  const used = new Set()
  const mark = (guid) => {
    const g = String(guid).toLowerCase()
    if (!/^[0-9a-f]{16}$/.test(g)) return
    used.add(g)
    if (uiPresets[g]) used.add(uiPresets[g])
    if (scenePresets[g]) used.add(scenePresets[g])
  }
  const jsonRe = /"([0-9a-f]{16})/g
  const scanJson = (obj) => { jsonRe.lastIndex = 0; let m; const text = JSON.stringify(obj); while ((m = jsonRe.exec(text))) mark(m[1]) }
  for (const item of references.data || []) scanJson(item.data)
  if (references.plugins !== undefined) scanJson(references.plugins)
  if (references.commands !== undefined) scanJson(references.commands)
  if (references.config !== undefined) scanJson(references.config)
  for (const script of references.scripts || []) {
    if (script.guid) mark(script.guid)
    scanJson({ guid: script.guid, code: script.code })
  }
  const scriptRe = /"[0-9a-f]{16}"|'[0-9a-f]{16}'/g
  for (const script of references.scripts || []) {
    scriptRe.lastIndex = 0
    let m
    while ((m = scriptRe.exec(script.code || ''))) mark(m[0].slice(1, -1))
  }
  for (const item of references.data || []) {
    const data = item.data
    if (data && data.type !== undefined && data.type !== 'common' && item.guid) mark(item.guid)
  }
  return used
}

/** 已引用本地化条目：被扫描资产 <ref:ID> 引用的条目 + 被引用条目内容里嵌套引用的条目（闭包）。
    引擎打包时 localization.json 整包携带，这里按「游戏里真的会显示」过滤缺翻译/疑似占位视图。 */
function referencedLocalizationIds(assets, localizationJson) {
  const refs = new Set()
  for (const { data } of assets) {
    for (const m of [...JSON.stringify(data).matchAll(/<ref:([0-9a-f]{16})>/gi)]) refs.add(m[1].toLowerCase())
  }
  const byId = new Map()
  const walk = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) walk(item.children); else if (item && item.id) byId.set(String(item.id).toLowerCase(), item) } }
  walk(localizationJson && localizationJson.list)
  const out = new Set()
  const queue = [...refs]
  while (queue.length) {
    const id = queue.shift()
    if (out.has(id)) continue
    out.add(id)
    const leaf = byId.get(id)
    if (leaf && leaf.contents) {
      for (const value of Object.values(leaf.contents)) {
        for (const m of [...String(value).matchAll(/<ref:([0-9a-f]{16})>/gi)]) {
          const nested = m[1].toLowerCase()
          if (!out.has(nested)) queue.push(nested)
        }
      }
    }
  }
  return out
}

/** 引擎本地化 Excel（open-yami 表）行生成：与编辑器 to-excel（main.js:112-158）同算法——
    整棵树导出：文件夹每次导出重新生成 16hex ID（子行在前、文件夹行在后），parentID 表达层级，
    叶子保留真实 ID 与全部语言 contents。列序：ID | Name | 语言… | parentID | isDir。 */
function openYamiRows(localizationJson, languages) {
  const rows = []
  const walk = (items, parentID) => {
    for (const item of items || []) {
      if (item && Array.isArray(item.children)) {
        const id = randomHex16()
        walk(item.children, id)
        rows.push({ id, name: item.name || '', parentID, isDir: 1 })
      } else if (item && item.id) {
        const contents = {}
        for (const lang of languages) contents[lang] = item.contents && typeof item.contents[lang] === 'string' ? item.contents[lang] : ''
        rows.push({ id: item.id, name: item.name || '', parentID, isDir: 0, contents })
      }
    }
  }
  walk(localizationJson && localizationJson.list, '')
  return rows
}

/** 解析引擎格式行：与编辑器 from-excel（main.js:162-254）同算法——isDir===1 建文件夹（expanded:false），
    其余建条目（contents = 非系统列的全部语言）；dataMap 按 id 建节点，parentID 挂载；
    未知 parentID 建空名文件夹占位，文件夹行后到时合并子级；整体替换 localization.list（文件夹 ID 不持久，叶子 ID 保留）。 */
function localizationFromOpenYami(rows) {
  const dataMap = new Map()
  const rootNodes = []
  for (const row of rows || []) {
    const isDir = row.isDir === 1 || row.isDir === '1'
    const rowData = isDir
      ? { class: 'folder', id: String(row.id || ''), name: String(row.name || ''), parentID: String(row.parentID || ''), expanded: false, children: [] }
      : { id: String(row.id || ''), name: String(row.name || ''), parentID: String(row.parentID || ''), contents: { ...(row.contents || {}) } }
    const existing = dataMap.get(rowData.id)
    if (existing && existing.class === 'folder') {
      rowData.children = existing.children
      dataMap.delete(rowData.id)
    }
    dataMap.set(rowData.id, rowData)
    if (rowData.parentID) {
      const parent = dataMap.get(rowData.parentID)
      if (parent) {
        parent.children = parent.children || []
        parent.children.push(rowData)
      } else {
        dataMap.set(rowData.parentID, { class: 'folder', id: rowData.parentID, name: '', expanded: false, children: [rowData] })
      }
    } else {
      rootNodes.push(rowData)
    }
  }
  return rootNodes
}

/** 引擎格式导入差异：按叶子 ID 统计 新增/更新/移除 与文件夹数变化（预览用）。 */
function diffLocalizationTrees(currentList, nextList) {
  const flat = (items) => {
    const map = new Map()
    const walk = (nodes) => { for (const item of nodes || []) { if (item && Array.isArray(item.children)) walk(item.children); else if (item && item.id) map.set(item.id, item) } }
    walk(items)
    return map
  }
  const oldMap = flat(currentList)
  const newMap = flat(nextList)
  const added = []
  const updated = []
  const removed = []
  for (const [id, item] of newMap) {
    if (!oldMap.has(id)) added.push(id)
    else if (JSON.stringify(item.contents) !== JSON.stringify(oldMap.get(id).contents)) updated.push(id)
  }
  for (const [id] of oldMap) if (!newMap.has(id)) removed.push(id)
  const countFolders = (items) => { let n = 0; const walk = (nodes) => { for (const item of nodes || []) { if (item && Array.isArray(item.children)) { n += 1; walk(item.children) } } }; walk(items); return n }
  return { added, updated, removed, foldersBefore: countFolders(currentList), foldersAfter: countFolders(nextList) }
}

function buildScanResult(assets, { attributeJson, localizationJson, languages, references, includeUnreferenced }) {
  const used = references ? referencedFileIds(references) : null
  let scanAssets = assets
  const unreferenced = { total: 0, byType: {} }
  if (used && !includeUnreferenced) {
    const kept = []
    for (const asset of assets) {
      if (used.has(assetGuid(asset.file))) kept.push(asset)
      else {
        unreferenced.total += 1
        unreferenced.byType[asset.type] = (unreferenced.byType[asset.type] || 0) + 1
      }
    }
    scanAssets = kept
  }
  const ids = localizationIds(localizationJson)
  const stringAttrIds = buildStringAttributeIds(attributeJson)
  const skipAttrIds = new Set([loopListAttributeId(attributeJson)])
  const attrNames = buildAttributeNames(attributeJson)
  // setText 覆盖的界面节点（占位模板）：目标来自任何被引用资产，过滤前全量收集
  const placeholders = new Set()
  for (const { data } of assets) for (const p of collectSetTextTargets(data)) placeholders.add(p)
  const candidates = []
  const attributeCandidates = []
  const orphanOccurrences = []
  const displayLocations = new Map()
  const attributeLocations = new Map()
  for (const { file, type, data } of scanAssets) {
    for (const c of collectCandidates(data, type, placeholders)) { c.file = file; candidates.push(c) }
    for (const c of collectAttributeCandidates(data, type, stringAttrIds, skipAttrIds)) { c.file = file; attributeCandidates.push(c) }
    for (const o of collectOrphanRefs(data)) {
      if (!ids.has(o.refId)) {
        o.file = file
        o.attrName = o.attrKey ? (attrNames.get(String(o.attrKey).toLowerCase()) || '') : ''
        orphanOccurrences.push(o)
        continue
      }
      let kind = refPathKind(o.path)
      if (kind === 'display' && o.presetId && placeholders.has(o.presetId)) kind = 'other' // 占位模板里的 ref 运行时被 setText 覆盖，不显示
      const map = kind === 'attribute' ? attributeLocations : kind === 'display' ? displayLocations : null
      if (map) {
        if (!map.has(o.refId)) map.set(o.refId, [])
        if (map.get(o.refId).length < 40) map.get(o.refId).push({ file, path: o.path })
      }
    }
  }
  // 已本地化：被引用且条目存在——按引用位置分两档：界面显示路径 / 数据属性
  const buildLocalized = (locations) => {
    const leaves = new Map()
    const leafWalk = (items, folder) => {
      for (const item of items || []) {
        if (item && Array.isArray(item.children)) leafWalk(item.children, item.name || '')
        else if (item && item.id && locations.has(String(item.id).toLowerCase())) leaves.set(String(item.id).toLowerCase(), { leaf: item, folder: folder || '' })
      }
    }
    leafWalk(localizationJson && localizationJson.list, '')
    const out = []
    for (const [id, { leaf, folder }] of leaves) {
      const langs = {}
      for (const lang of languages) langs[lang] = typeof leaf.contents[lang] === 'string' ? leaf.contents[lang] : ''
      out.push({ id, name: leaf.name || '', folder, zh: langs[languages[0]] || '', langs, locations: locations.get(id) || [] })
    }
    out.sort((a, b) => (a.name || a.zh).localeCompare(b.name || b.zh, 'zh-CN'))
    return out
  }
  const localized = buildLocalized(displayLocations) // 界面显示路径里的已本地化条目（编辑原文/译文）
  const attributeLocalized = buildLocalized(attributeLocations) // 数据属性里的已本地化条目（数据 tab）
  let missing = findMissingTranslations(localizationJson, languages)
  let suspicious = findSuspiciousTranslations(localizationJson, languages)
  let unreferencedMissing = 0
  let unreferencedSuspicious = 0
  if (used && !includeUnreferenced) {
    const usedRefs = referencedLocalizationIds(scanAssets, localizationJson)
    const keepMissing = missing.filter((m) => usedRefs.has(m.id.toLowerCase()))
    const keepSuspicious = suspicious.filter((m) => usedRefs.has(m.id.toLowerCase()))
    unreferencedMissing = missing.length - keepMissing.length
    unreferencedSuspicious = suspicious.length - keepSuspicious.length
    missing = keepMissing
    suspicious = keepSuspicious
  }
  return {
    candidates: mergeCandidates(candidates), attributeCandidates: mergeCandidates(attributeCandidates),
    orphans: groupOrphans(orphanOccurrences), missing, suspicious, localized, attributeLocalized, languages: [...languages],
    referenced: !!used, unreferenced, unreferencedMissing, unreferencedSuspicious,
  }
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
   先全部校验（当前值与扫描时一致，不一致=外部改动，返回失败），再统一替换——
   同文件多个相同文本位置必须先校验后替换，否则前一个被换成 <ref:ID> 后后一个校验会失败。
   原文在界面里被编辑过时（candidate.originalZhCN 存在），按原始文本校验（文件里还是原文本），写进条目的是编辑后的文本。 */
function applyAssetReplacement(fileJson, candidate, file) {
  const locations = file ? candidate.locations.filter((l) => l.file === file) : candidate.locations
  const expect = candidate.originalZhCN || candidate.zhCN
  for (const loc of locations) {
    const current = locateValue(fileJson, loc.path)
    if (typeof current !== 'string' || !current.includes(expect)) {
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

/** 把新增/补译条目写入 localization.json 树。
    新增按 add.folder 分入根级「快速本地化」文件夹下的类型子文件夹（物品/装备/技能/…/孤儿修复；不存在则创建）。
    幂等：ID 已存在则跳过新增；已有条目（补译）按 ID 覆盖非空语言列。 */
function localizationInsertion(localizationJson, additions, fills, languages) {
  const root = localizationJson.list || (localizationJson.list = [])
  const byId = new Map()
  const collect = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) collect(item.children); else if (item && item.id) byId.set(item.id, item) } }
  collect(root)
  let folder = root.find((item) => item && item.name === LOCALIZATION_FOLDER && Array.isArray(item.children))
  if (!folder) { folder = { class: 'folder', name: LOCALIZATION_FOLDER, expanded: false, children: [] }; root.push(folder) }
  const subFolders = new Map()
  const subFolder = (name) => {
    const key = name || '其他'
    if (!subFolders.has(key)) {
      let sub = folder.children.find((item) => item && item.name === key && Array.isArray(item.children))
      if (!sub) { sub = { class: 'folder', name: key, expanded: false, children: [] }; folder.children.push(sub) }
      subFolders.set(key, sub)
    }
    return subFolders.get(key)
  }
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
    subFolder(add.folder).children.push({ id: add.id, name: String(add.zhCN).replace(/\s+/g, ' ').trim().slice(0, 20), contents })
    byId.set(add.id, null)
  }
  return localizationJson
}

/** Excel 导入行校验：ID 格式/表内重复/与现有条目冲突/原文空/补译行 ID 必须存在。
    忽略行（处理方式=忽略、建议文本为空、幂等已存在）单独进 ignored 列表，供预览明示。 */
function validateImportRows(rows, existingById, languages) {
  const errors = []
  const warnings = []
  const seen = { add: new Set(), fill: new Set(), orphan: new Set() } // 表内重复按 sheet 分开（多张表 ID 重叠正常）
  const additions = []
  const fills = []
  const ignored = []
  for (const row of rows) {
    if (row.sheet === 'add' && row.handle && String(row.handle).trim() === '忽略') {
      ignored.push({ ...row, reason: '处理方式=忽略，不创建也不替换' })
      continue
    }
    if (row.sheet === 'orphan') {
      const id = String(row.id || '').trim()
      if (!/^[0-9a-f]{16}$/i.test(id)) { errors.push(`第 ${row.row} 行：引用ID「${row.id || '(空)'}」不是 16 位 hex`); continue }
      if (seen.orphan.has(id)) { errors.push(`第 ${row.row} 行：引用ID ${id} 在表中重复`); continue }
      seen.orphan.add(id)
      const zhCN = String(row.zhCN || '').trim()
      if (!zhCN) { ignored.push({ ...row, reason: '建议文本为空，跳过（可在界面或 Excel 里补填）' }); continue }
      if (existingById.has(id)) { ignored.push({ ...row, reason: '条目已存在（此前已修复），幂等跳过' }); continue }
      additions.push({ ...row, folder: ORPHAN_FOLDER, zhCN })
      continue
    }
    const id = String(row.id || '').trim()
    if (!/^[0-9a-f]{16}$/i.test(id)) { errors.push(`第 ${row.row} 行：ID「${row.id || '(空)'}」不是 16 位 hex`); continue }
    if (seen[row.sheet].has(id)) { errors.push(`第 ${row.row} 行：ID ${id} 在表中重复`); continue }
    seen[row.sheet].add(id)
    if (row.sheet === 'add') {
      const zhCN = String(row.zhCN || '')
      if (!zhCN.trim()) { errors.push(`第 ${row.row} 行：原文为空`); continue }
      const existing = existingById.get(id)
      if (existing) {
        if (normalizeText(existing.zhCN) === normalizeText(zhCN)) { ignored.push({ ...row, reason: '条目已存在且原文一致，幂等跳过' }); continue }
        errors.push(`第 ${row.row} 行：ID ${id} 已存在于 localization.json 且原文不同（${existing.zhCN.slice(0, 24)}…），可能是重复导出的旧表，请重新导出`)
        continue
      }
      additions.push(row)
    } else {
      if (!existingById.has(id)) { errors.push(`第 ${row.row} 行：ID ${id} 不存在于 localization.json，无法补译`); continue }
      fills.push(row)
    }
  }
  return { errors, warnings, additions, fills, ignored }
}

/** 按候选 ID 查找候选：先查界面候选，再查数据属性候选。
    两者共用同一 ID 空间（candidateIdMap 按 normalized 分配），只查 candidates 会把数据属性 sheet 整张漏掉。 */
function findCandidateById(scan, id) {
  return scan.candidates.find((c) => c.id === id) || scan.attributeCandidates.find((c) => c.id === id)
}

/** 把导入新增行分类为「需替换资产文件的候选×文件分组」与「孤儿修复行（找不到候选，资产文件已引用该 ID，无需替换）」。
    数据属性候选（attributeCandidates）必须参与查找——只查 candidates 会把数据属性 sheet 的每行都误判成孤儿：
    资产文件不被替换成 <ref:ID>，而 localization 条目照常创建，用户看到「新增 N 条」但游戏里仍是硬编码中文（静默失败）。 */
function classifyImportAdditions(scan, additions) {
  const groups = []
  const seenGroups = new Set()
  const orphanAdds = []
  for (const row of additions) {
    const candidate = findCandidateById(scan, row.id)
    if (!candidate) { orphanAdds.push(row); continue }
    for (const loc of candidate.locations) {
      const key = `${row.id}::${loc.file}`
      if (!seenGroups.has(key)) { seenGroups.add(key); groups.push({ candidate, file: loc.file }) }
    }
  }
  return { groups, orphanAdds }
}

const core = {
  REF_RE, MARKUP_STRIP_RE, MARKUP_TAG_RE, normalizeText, splitRefSegments, classifyText,
  buildStringAttributeIds, loopListAttributeId, localizationIds, buildAttributeNames, collectRefKeys, collectCandidates, collectAttributeCandidates, collectSetTextTargets, refPathKind,
  collectOrphanRefs, orphanSuggestion, groupOrphans, mergeCandidates, findMissingTranslations, findSuspiciousTranslations,
  buildScanResult, assetGuid, referencedFileIds, referencedLocalizationIds, openYamiRows, localizationFromOpenYami, diffLocalizationTrees,
  locateValue, setValue, replaceSegment, applyAssetReplacement, localizationInsertion, validateImportRows, findCandidateById, classifyImportAdditions,
  randomHex16, EXT_TYPE, LOCALIZATION_FOLDER, ORPHAN_FOLDER, serializeLike, clone,
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
    metricCandidates: $('#metric-candidates'), metricMissing: $('#metric-missing'), metricMissingLangs: $('#metric-missing-langs'), metricOrphans: $('#metric-orphans'), metricSuspicious: $('#metric-suspicious'), metricLocalized: $('#metric-localized'), metricAttributes: $('#metric-attributes'),
    listBody: $('#list-body'), scanStatus: $('#scan-status'), btnFixOrphans: $('#btn-fix-orphans'), btnSaveFills: $('#btn-save-fills'), chkUnreferenced: $('#chk-unreferenced'), langSelect: $('#lang-select'),
    importPreview: $('#import-preview'), importPreviewSummary: $('#import-preview-summary'), importPreviewBody: $('#import-preview-body'),
    btnCancelImport: $('#btn-cancel-import'), btnConfirmImport: $('#btn-confirm-import'), toastRegion: $('#toast-region'),
    scanProgress: $('#scan-progress'), scanProgressFill: $('#scan-progress-fill'),
    btnBackups: $('#btn-backups'), backupPanel: $('#backup-panel'), backupPanelSummary: $('#backup-panel-summary'), backupPanelBody: $('#backup-panel-body'),
    btnBackupNow: $('#btn-backup-now'), btnCloseBackup: $('#btn-close-backup'),
  }
  const state = {
    rootHandle: null, lastRootHandle: null, scan: null, filter: 'candidates', filterSourceValue: 'all', filterConfidenceValue: 'all', filterQueryValue: '',
    importRows: null, importErrors: null, importAdditions: null, importFills: null, importIgnored: [], importTree: null, selectedIds: new Set(), pendingFiles: [],
    orphanTexts: new Map(), fillDrafts: new Map(), candidateLangs: new Map(), langValue: '', candidateIdMap: new Map(), watchPaths: [], watchTimer: null, watchSnapshot: new Map(), watchRunning: false,
    scanAssets: null, scanAttribute: null, references: null, filterReferenced: true, // 引用过滤：默认只扫被引擎打包算法判定的已引用资产
    // 数据属性（名称/描述）单独成 tab（attributeCandidates/attributeLocalized），不混进界面候选
    // 富文本显示解析：颜色索引调色板（config.indexedColors）/ 全局变量名（variables.json）/ 图片文件（manifest.images）/ 嵌套 ref 文本
    indexedColors: null, variableNames: new Map(), imageFiles: new Map(), fallbackFiles: null, imageCache: new Map(), localizationTextMap: null, editCells: new Set(), // 条目视图里正在编辑的单元格（默认显示富文本，点 ✎ 切到源代码输入框）
  }
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  /** 原文富文本渲染 v2（2026-08-14 用户要求）：展示时把标签解析成实际内容，编辑框仍显示源代码——
      <color:RRGGBB[AA]> → 彩色；<color:N> → config.indexedColors[N] 调色板色；<italic>/<bold> → 斜体/粗体；
      <global:ID>/<global::ID> → 全局变量名（:: 带 @）；<ref:ID> → 引用条目的中文原文；
      <image:guid[,...]> → 图片（渲染后由 hydrateImages 异步填图）；<local:xxx> → 局部变量名徽标（运行时值未知）。 */
  function renderRichText(text) {
    const s = String(text)
    let html = ''
    let open = null
    const openColor = (hex) => { if (open) html += '</span>'; open = hex; html += '<span style="color:#' + hex + '">' }
    const closeColor = () => { if (open) { html += '</span>'; open = null } }
    const TAG_RE = /(<color:(?:[0-9a-f]{6}(?:[0-9a-f]{2})?|\d{1,2})>|<\/color>|<italic>|<\/italic>|<bold>|<\/bold>|<size:[^>]*>|<\/size>|<image:[0-9a-f]{16}(?:,[^>]*)?>|<global::?[0-9a-f]{16}>|<ref:[0-9a-f]{16}>|<local:[^>]*>)/gi
    let last = 0
    let m
    while ((m = TAG_RE.exec(s))) {
      if (m.index > last) html += escapeHtml(s.slice(last, m.index))
      const tag = m[0]
      if (tag === '</color>') closeColor()
      else if ((m = /^<color:([0-9a-f]{6})(?:[0-9a-f]{2})?>$/i.exec(tag))) openColor(m[1])
      else if ((m = /^<color:(\d{1,2})>$/.exec(tag))) {
        const entry = state.indexedColors && state.indexedColors[parseInt(m[1], 10)]
        openColor(entry && typeof entry.code === 'string' && /^[0-9a-f]{6}/i.test(entry.code) ? entry.code.slice(0, 6) : 'ffffff')
      }
      else if (tag === '<italic>') html += '<i>'
      else if (tag === '</italic>') html += '</i>'
      else if (tag === '<bold>') html += '<b>'
      else if (tag === '</bold>') html += '</b>'
      else if (/^<\/?size:[^>]*>$/.test(tag)) { /* 字号标签：纯展示忽略 */ }
      else if ((m = /^<global::?([0-9a-f]{16})>$/.exec(tag))) {
        const id = m[1].toLowerCase()
        const dynamic = tag.startsWith('<global::')
        const name = state.variableNames.get(id) || ''
        html += '<span class="tag-global" title="全局变量 ' + escapeHtml(id) + '">' + escapeHtml((dynamic ? '@' : '') + (name || id)) + '</span>'
      }
      else if ((m = /^<ref:([0-9a-f]{16})>$/.exec(tag))) {
        const id = m[1].toLowerCase()
        const zh = getLocalizationText(id)
        html += zh !== undefined
          ? '<span class="tag-ref" title="本地化条目 ' + escapeHtml(id) + '">' + renderRichText(zh) + '</span>'
          : '<span class="tag-ref tag-ref-missing" title="本地化条目不存在：' + escapeHtml(id) + '">' + escapeHtml(id) + '</span>'
      }
      else if ((m = /^<image:([0-9a-f]{16})(?:,([^>]*))?>$/.exec(tag))) {
        const id = m[1].toLowerCase()
        const info = state.imageFiles.get(id)
        const name = info ? info.name : id
        html += '<span class="tag-image" data-guid="' + escapeHtml(id) + '" data-params="' + escapeHtml(m[2] || '') + '" data-path="' + escapeHtml(info ? info.path : '') + '" title="图片 ' + escapeHtml(name) + '">🖼 ' + escapeHtml(name) + '</span>'
      }
      else if ((m = /^<local:([^>]*)>$/.exec(tag))) {
        html += '<span class="tag-local" title="局部变量（运行时值）">' + escapeHtml(m[1]) + '</span>'
      }
      last = TAG_RE.lastIndex
    }
    if (last < s.length) html += escapeHtml(s.slice(last))
    closeColor()
    return html
  }
  /** 嵌套 <ref:ID> 的显示文本：localization 叶子 id → zh-CN（缓存按 scanLocalization 对象身份失效）。 */
  function getLocalizationText(id) {
    const primary = state.scan && state.scan.languages[0]
    if (state.localizationTextMap && state.localizationTextMap.source === state.scanLocalization) return state.localizationTextMap.map.get(id)
    const map = new Map()
    const walk = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) walk(item.children); else if (item && item.id && item.contents) map.set(String(item.id).toLowerCase(), typeof item.contents[primary] === 'string' ? item.contents[primary] : '') } }
    walk(state.scanLocalization && state.scanLocalization.list)
    state.localizationTextMap = { source: state.scanLocalization, map }
    return map.get(id)
  }
/** 富文本显示元数据：颜色索引调色板（config.indexedColors）/ 全局变量名（variables.json 树）/ 图片文件（manifest.images guid → 路径名）。 */
function loadDisplayMetadata(manifest, configJson, variablesJson) {
  state.indexedColors = configJson && Array.isArray(configJson.indexedColors) ? configJson.indexedColors : null
  state.variableNames = new Map()
  const walkVars = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) walkVars(item.children); else if (item && item.id && typeof item.name === 'string') state.variableNames.set(String(item.id).toLowerCase(), item.name) } }
  walkVars(variablesJson)
  state.imageFiles = new Map()
  for (const entry of (manifest && manifest.images) || []) {
    const guid = core.assetGuid(entry.path)
    if (guid) state.imageFiles.set(guid.toLowerCase(), { path: entry.path, name: String(entry.path).split('/').pop() || entry.path })
  }
}
  /** 异步把 .tag-image 占位换成实际图片（剪裁参数 guid,cx,cy,cw,ch[,w,h]；缓存 dataURL）。 */
  async function hydrateImages(container) {
    const chips = [...container.querySelectorAll('.tag-image[data-path]')]
    for (const chip of chips) {
      const cacheKey = chip.dataset.guid + ':' + (chip.dataset.params || '')
      try {
        if (!state.imageCache.has(cacheKey)) {
          let file = null
          if (state.rootHandle) file = await (await getHandle(state.rootHandle, chip.dataset.path)).getFile()
          else if (state.fallbackFiles) file = state.fallbackFiles.get(chip.dataset.path) || null
          if (!file) continue
          const nums = (chip.dataset.params || '').split(',').map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n))
          const bitmap = nums.length >= 4 ? await createImageBitmap(file, nums[0], nums[1], nums[2], nums[3]) : await createImageBitmap(file)
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          canvas.getContext('2d').drawImage(bitmap, 0, 0)
          state.imageCache.set(cacheKey, canvas.toDataURL('image/png'))
        }
        chip.innerHTML = '<img class="tag-image-img" src="' + state.imageCache.get(cacheKey) + '" alt="" style="height:1.2em;vertical-align:middle" />'
      } catch { /* 读不到就保留文件名文本 */ }
    }
  }
  function setScanProgress(done, total, indeterminate) {
    if (indeterminate) {
      els.scanProgress.classList.remove('hidden')
      els.scanProgress.classList.add('indeterminate')
      return
    }
    els.scanProgress.classList.remove('indeterminate')
    if (!total) { els.scanProgress.classList.add('hidden'); return }
    els.scanProgress.classList.remove('hidden')
    els.scanProgressFill.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`
  }
  function toast(message, type = 'info') {
    const element = document.createElement('div')
    element.className = `toast ${type}`
    element.textContent = message
    els.toastRegion.appendChild(element)
    setTimeout(() => element.remove(), 3200)
  }
  function typeLabel(type) {
    return ({ items: '物品', equipments: '装备', skills: '技能', states: '状态', events: '事件', ui: '界面', triggers: '触发器', actors: '角色' })[type] || type
  }
  /** 扫描完成状态行（含未引用资产跳过说明）。 */
  function scanStatusText() {
    const scan = state.scan
    if (!scan) return '等待扫描'
    let extra = ''
    if (scan.referenced) {
      const skipped = []
      if (scan.unreferenced.total) skipped.push(`未引用资产 ${scan.unreferenced.total} 个已跳过`)
      if (scan.unreferencedMissing) skipped.push(`未引用缺翻译 ${scan.unreferencedMissing} 条已跳过`)
      if (scan.unreferencedSuspicious) skipped.push(`未引用疑似占位 ${scan.unreferencedSuspicious} 条已跳过`)
      if (skipped.length) extra = ` · ${skipped.join(' · ')}（可勾选「含未引用资产」查看）`
    }
    return `扫描完成 · ${scan.candidates.length} 候选（界面） · ${scan.attributeCandidates.length} 数据属性 · ${scan.missing.length} 缺翻译 · ${scan.orphans.length} 孤儿 · ${scan.suspicious.length} 疑似占位${extra}`
  }
  /** 从缓存资产重算扫描结果（切换「含未引用资产」时用，不重读文件）。 */
  function rescanFromCache() {
    if (!state.scanAssets) return
    state.scan = buildScanResult(state.scanAssets, {
      attributeJson: state.scanAttribute, localizationJson: state.scanLocalization, languages: state.scan.languages,
      references: state.references, includeUnreferenced: !state.filterReferenced,
    })
    els.scanStatus.textContent = scanStatusText()
    renderScan()
  }
  /** 写回后增量更新：把内存里已写回的文件内容同步进缓存（资产 + 引用源 + localization），无需重读磁盘。 */
  function applyInMemoryWrites(filesToWrite, localizationJson) {
    const byFile = new Map(filesToWrite)
    for (const asset of state.scanAssets || []) {
      const written = byFile.get(asset.file)
      if (written) asset.data = written.data
    }
    for (const item of state.references && state.references.data || []) {
      const written = byFile.get(item.file)
      if (written) item.data = written.data
    }
    if (localizationJson) state.scanLocalization = localizationJson
  }
  /** 刷新被写文件的监控戳（避免自动同步把自己刚写入的文件误判为外部变化）。 */
  async function refreshWatchStamps(paths) {
    if (!state.rootHandle || !state.watchPaths.length) return
    for (const path of paths) {
      try {
        const file = await (await getHandle(state.rootHandle, path)).getFile()
        state.watchSnapshot.set(path, fileStamp(file))
      } catch { state.watchSnapshot.set(path, 'missing') }
    }
  }
  /** 写回后的统一收尾：增量更新 → 刷新监控戳 → 重算渲染（不重扫工程）。 */
  async function finishAfterWrite(filesToWrite, localizationJson) {
    applyInMemoryWrites(filesToWrite, localizationJson)
    await refreshWatchStamps([...filesToWrite.keys(), 'Data/localization.json'])
    setScanProgress(0, 0)
    rescanFromCache()
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

  // 扫描类型：参与候选/孤儿判定；引用类型：只参与「已引用文件」判定（复刻引擎打包算法）
  const SCAN_TYPES = ['items', 'equipments', 'skills', 'states', 'events', 'ui', 'triggers', 'actors']
  const REF_ONLY_TYPES = ['scenes', 'animations', 'particles', 'tilesets']
  async function collectAssets(root, manifest, onProgress) {
    const assets = []
    const references = { data: [], scripts: [] }
    let done = 0
    const tick = () => { done += 1; if (onProgress) onProgress(done) }
    for (const type of SCAN_TYPES) {
      for (const entry of manifest[type] || []) {
        try {
          const data = await readJson(root, entry.path)
          assets.push({ file: entry.path, type, data })
          references.data.push({ guid: core.assetGuid(entry.path), type, file: entry.path, data })
        } catch (error) { console.warn('跳过无法读取的文件', entry.path, error) }
        tick()
      }
    }
    for (const type of REF_ONLY_TYPES) {
      for (const entry of manifest[type] || []) {
        try { references.data.push({ guid: core.assetGuid(entry.path), type, file: entry.path, data: await readJson(root, entry.path) }) } catch (error) { console.warn('跳过无法读取的文件', entry.path, error) }
        tick()
      }
    }
    for (const entry of manifest.script || []) {
      try { references.scripts.push({ guid: core.assetGuid(entry.path), code: await readText(root, entry.path) }) } catch (error) { console.warn('跳过无法读取的脚本', entry.path, error) }
      tick()
    }
    return { assets, references }
  }
  async function scanProject(root) {
    stopAutoSync()
    els.projectState.textContent = '正在扫描…'
    try {
      const [manifest, attributeJson, localizationJson, configJson, pluginsJson, commandsJson] = await Promise.all([
        readJson(root, 'Data/manifest.json'), readJson(root, 'Data/attribute.json'), readJson(root, 'Data/localization.json'),
        readJson(root, 'Data/config.json').catch(() => ({})),
        readJson(root, 'Data/plugins.json').catch(() => undefined),
        readJson(root, 'Data/commands.json').catch(() => undefined),
      ])
      const variablesJson = await readJson(root, 'Data/variables.json').catch(() => undefined)
      loadDisplayMetadata(manifest, configJson, variablesJson)
      const languages = (configJson.localization && configJson.localization.languages && configJson.localization.languages.map((l) => l.name)) || ['zh-CN', 'en']
      const total = [...SCAN_TYPES, ...REF_ONLY_TYPES, 'script'].reduce((n, type) => n + (manifest[type] || []).length, 0)
      setScanProgress(0, total)
      els.projectState.textContent = `正在扫描… 0/${total}`
      const { assets, references } = await collectAssets(root, manifest, (done) => { setScanProgress(done, total); els.projectState.textContent = `正在扫描… ${done}/${total}` })
      references.plugins = pluginsJson
      references.commands = commandsJson
      references.config = configJson
      state.scanAssets = assets
      state.scanAttribute = attributeJson
      state.references = references
      state.scan = buildScanResult(assets, { attributeJson, localizationJson, languages, references, includeUnreferenced: !state.filterReferenced })
      state.scanLocalization = localizationJson
      state.rootHandle = root
      state.lastRootHandle = root
      state.watchPaths = ['Data/manifest.json', 'Data/attribute.json', 'Data/localization.json', 'Data/config.json', 'Data/plugins.json', 'Data/commands.json',
        ...[...SCAN_TYPES, ...REF_ONLY_TYPES, 'script'].flatMap((type) => (manifest[type] || []).map((e) => e.path))]
      setScanProgress(0, 0)
      els.btnExport.disabled = false
      els.btnImport.disabled = !root || state.importRows !== null
      els.btnBackups.disabled = !root
      els.projectState.textContent = root.name || '工程已导入'
      els.scanStatus.textContent = scanStatusText()
      renderScan()
      startAutoSync()
    } catch (error) {
      setScanProgress(0, 0)
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
      const references = { data: [], scripts: [] }
      const ALL_TYPES = [...SCAN_TYPES, ...REF_ONLY_TYPES, 'script']
      const total = manifest ? ALL_TYPES.reduce((n, type) => n + (manifest[type] || []).length, 0) : files.filter((file) => EXT_TYPE['.' + file.name.split('.').pop().toLowerCase()] || file.name.toLowerCase().endsWith('.ts')).length
      let done = 0
      setScanProgress(0, total)
      els.projectState.textContent = `正在扫描… 0/${total}`
      const tick = () => { done += 1; setScanProgress(done, total); els.projectState.textContent = `正在扫描… ${done}/${total}` }
      if (manifest) {
        for (const type of ALL_TYPES) {
          for (const entry of manifest[type] || []) {
            const file = byPath.get(entry.path)
            if (!file) continue
            if (type === 'script') {
              references.scripts.push({ guid: core.assetGuid(entry.path), code: await file.text() })
            } else {
              try {
                const data = JSON.parse(await file.text())
                references.data.push({ guid: core.assetGuid(entry.path), type, file: entry.path, data })
                if (SCAN_TYPES.includes(type)) assets.push({ file: entry.path, type, data })
              } catch {}
            }
            tick()
          }
        }
      } else {
        for (const file of files) {
          const ext = '.' + file.name.split('.').pop().toLowerCase()
          const type = EXT_TYPE[ext]
          if (!type && !file.name.toLowerCase().endsWith('.ts')) continue
          try {
            if (type === 'scripts' || (type === undefined && file.name.toLowerCase().endsWith('.ts'))) {
              references.scripts.push({ guid: core.assetGuid(rel(file)), code: await file.text() })
            } else {
              const data = JSON.parse(await file.text())
              references.data.push({ guid: core.assetGuid(rel(file)), type, file: rel(file), data })
              if (SCAN_TYPES.includes(type)) assets.push({ file: rel(file), type, data })
            }
          } catch {}
          tick()
        }
      }
      const attributeJson = byPath.has('Data/attribute.json') ? await readData('Data/attribute.json') : { keys: [] }
      const localizationJson = byPath.has('Data/localization.json') ? await readData('Data/localization.json') : { list: [] }
      let languages = ['zh-CN', 'en']
      let configJson = {}
      if (byPath.has('Data/config.json')) {
        try {
          configJson = JSON.parse(await byPath.get('Data/config.json').text())
          if (configJson.localization && configJson.localization.languages) languages = configJson.localization.languages.map((l) => l.name)
        } catch {}
      }
      references.plugins = byPath.has('Data/plugins.json') ? await readData('Data/plugins.json').catch(() => undefined) : undefined
      references.commands = byPath.has('Data/commands.json') ? await readData('Data/commands.json').catch(() => undefined) : undefined
      references.config = configJson
      state.fallbackFiles = byPath
      const variablesJson = byPath.has('Data/variables.json') ? await readData('Data/variables.json').catch(() => undefined) : undefined
      loadDisplayMetadata(manifest, configJson, variablesJson)
      state.scanAssets = assets
      state.scanAttribute = attributeJson
      state.references = references
      state.scan = buildScanResult(assets, { attributeJson, localizationJson, languages, references, includeUnreferenced: !state.filterReferenced })
      state.scanLocalization = localizationJson
      state.lastRootHandle = null
      state.watchPaths = []
      setScanProgress(0, 0)
      els.btnExport.disabled = false
      els.btnImport.disabled = true // fallback 导入模式只读，不写回工程
      els.btnBackups.disabled = true
      els.projectState.textContent = '已导入工程（只读）'
      els.scanStatus.textContent = scanStatusText()
      renderScan()
    } catch (error) {
      setScanProgress(0, 0)
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
    els.metricSuspicious.textContent = scan.suspicious.length
    els.metricLocalized.textContent = scan.localized.length
    els.metricAttributes.textContent = scan.attributeCandidates.length
    els.chkUnreferenced.checked = !state.filterReferenced
    // 语言切换下拉：单语言模式（译文列只显示当前语言）；默认第一个非原文语言
    els.langSelect.innerHTML = scan.languages.map((lang) => `<option value="${escapeHtml(lang)}">${escapeHtml(lang)}${lang === scan.languages[0] ? '（原文）' : ''}</option>`).join('')
    if (!scan.languages.includes(state.langValue)) state.langValue = scan.languages[1] || scan.languages[0]
    els.langSelect.value = state.langValue
    // 会话内稳定的候选 ID（与引擎同格式 16hex）：重扫/切换过滤不换 ID，Excel 导出与「本地化」按钮共用
    for (const c of [...scan.candidates, ...scan.attributeCandidates]) {
      let id = state.candidateIdMap.get(c.normalized)
      if (!id) { id = core.randomHex16(); state.candidateIdMap.set(c.normalized, id) }
      c.id = id
    }
    state.selectedIds = new Set([...scan.candidates, ...scan.attributeCandidates].map((c) => c.normalized)) // 默认全选，导出范围由勾选控制
    state.editCells.clear()
    for (const o of scan.orphans) {
      if (o.suggestion && !state.orphanTexts.has(o.refId)) state.orphanTexts.set(o.refId, o.suggestion) // 保留用户已填的文本
    }
    renderList()
  }
  function renderList() {
    const scan = state.scan
    if (!scan) { els.listBody.innerHTML = ''; return }
    let html = ''
    if (state.filter === 'missing') html = renderMissingRows(scan.missing)
    else if (state.filter === 'orphans') html = renderOrphanRows(scan.orphans)
    else if (state.filter === 'suspicious') html = renderSuspiciousRows(scan.suspicious)
    else if (state.filter === 'localized') html = renderLocalizedRows(scan.localized)
    else if (state.filter === 'attributes') html = renderAttributeRows(scan)
    else html = renderCandidateRows(scan.candidates)
    els.listBody.innerHTML = html || '<div class="empty-state">没有匹配的条目。</div>'
    hydrateImages(els.listBody) // 异步把 <image:...> 标签换成实际图片（失败保留文件名）
    els.listBody.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedIds.add(checkbox.dataset.key)
        else state.selectedIds.delete(checkbox.dataset.key)
      })
    })
    els.listBody.querySelectorAll('.orphan-text').forEach((input) => {
      input.addEventListener('input', () => {
        state.orphanTexts.set(input.dataset.refId, input.value)
        const button = input.closest('tr')?.querySelector('.btn-fix-orphan')
        if (button) button.disabled = !input.value.trim()
      })
    })
    els.listBody.querySelectorAll('.btn-fix-orphan').forEach((button) => {
      button.addEventListener('click', () => createOrphanEntries([{ refId: button.dataset.refId }]))
    })
    els.listBody.querySelectorAll('.btn-edit-text').forEach((button) => {
      button.addEventListener('click', () => startTextEdit(button))
    })
    els.listBody.querySelectorAll('.btn-edit-cell').forEach((button) => {
      button.addEventListener('click', () => { state.editCells.add(button.dataset.cell); renderList() })
    })
    els.listBody.querySelectorAll('.btn-cell-done').forEach((button) => {
      button.addEventListener('click', () => { state.editCells.delete(button.dataset.cell); renderList() })
    })
    const firstEdit = els.listBody.querySelector('.fill-input')
    if (firstEdit) firstEdit.focus()
    els.listBody.querySelectorAll('.btn-localize-now').forEach((button) => {
      button.addEventListener('click', () => {
        const scan = state.scan
        const candidate = scan && (scan.candidates.find((c) => c.normalized === button.dataset.key) || scan.attributeCandidates.find((c) => c.normalized === button.dataset.key))
        if (candidate) localizeCandidateNow(candidate)
      })
    })
    els.listBody.querySelectorAll('.fill-input').forEach((input) => {
      const autosize = () => { if (input.tagName === 'TEXTAREA') { input.style.height = 'auto'; input.style.height = (input.scrollHeight + 2) + 'px' } }
      autosize()
      input.addEventListener('input', () => {
        state.fillDrafts.set(`${input.dataset.id}::${input.dataset.lang}`, input.value)
        input.classList.toggle('dirty', !!input.value.trim())
        autosize()
      })
    })
    els.listBody.querySelectorAll('.candidate-lang-input').forEach((input) => {
      input.addEventListener('input', () => {
        state.candidateLangs.set(`${input.dataset.key}::${state.langValue}`, input.value)
        input.classList.toggle('dirty', !!input.value.trim())
      })
    })
    els.btnFixOrphans.classList.toggle('hidden', state.filter !== 'orphans' || !state.rootHandle)
    els.btnSaveFills.classList.toggle('hidden', !['missing', 'suspicious', 'localized', 'attributes'].includes(state.filter) || !state.rootHandle)
  }
  // 单语言模式：译文列只显示语言下拉选中的语言（可切换）；原文(zh-CN)列固定
  function langCellValue(languages, id) {
    const key = `${id}::${state.langValue}`
    const draft = state.fillDrafts.get(key)
    return { key, draft, value: draft !== undefined ? draft : (languages[state.langValue] || '') }
  }
/** 条目视图的可编辑富文本单元格：默认渲染富文本（正常显示），点 ✎ 切到输入框（显示源代码）；输入值进 fillDrafts，「保存修改」写回 localization.json。 */
function richCell(opts) {
  const cellKey = opts.id + '::' + opts.lang
  const editing = state.editCells.has(cellKey)
  const td = opts.tdClass ? '<td class="' + opts.tdClass + '">' : '<td>'
  if (editing) {
    return td + '<div class="cell-edit-row"><textarea class="fill-input fill-textarea' + (opts.wide ? ' fill-wide' : '') + (opts.dirty ? ' dirty' : '') + (opts.extraClass ? ' ' + opts.extraClass : '') + '" data-id="' + escapeHtml(opts.id) + '" data-lang="' + escapeHtml(opts.lang) + '" placeholder="待翻译" rows="2">' + escapeHtml(opts.input) + '</textarea><button class="btn-cell-done" type="button" data-cell="' + escapeHtml(cellKey) + '" title="完成编辑">✓</button></div>' + (opts.suffix || '') + '</td>'
  }
  return td + '<span class="raw col-zh rich-text">' + renderRichText(opts.display) + '</span><button class="btn-edit-cell" type="button" data-cell="' + escapeHtml(cellKey) + '" title="编辑（显示源代码）">✎</button>' + (opts.suffix || '') + '</td>'
}
  function renderCandidateRows(candidates) {
    const scan = state.scan
    const query = state.filterQueryValue
    const langEditable = state.langValue && state.langValue !== scan.languages[0]
    const rows = candidates.filter((c) => {
      if (state.filterSourceValue !== 'all' && c.sourceType !== state.filterSourceValue) return false
      if (state.filterConfidenceValue !== 'all' && c.confidence !== state.filterConfidenceValue) return false
      if (query && !c.zhCN.toLowerCase().includes(query) && !c.locations.some((l) => l.file.toLowerCase().includes(query))) return false
      return true
    })
    return `<table class="candidate-table"><thead><tr><th class="col-check">勾选</th><th>原文</th><th>译文(${escapeHtml(state.langValue)})</th><th>处理</th><th>置信度</th><th>来源</th><th class="col-loc">出现位置</th></tr></thead><tbody>${rows.map((c) => {
      const checked = state.selectedIds.has(c.normalized) ? 'checked' : ''
      const locations = c.locations.slice(0, 4).map((l) => `<span class="loc-file">${escapeHtml(l.file)}</span><span class="loc-path">${escapeHtml(l.path)}</span>`).join('')
      const more = c.locations.length > 4 ? `<span class="loc-path">…共 ${c.locations.length} 处</span>` : ''
      const langDraft = state.candidateLangs.get(`${c.normalized}::${state.langValue}`)
      const langCell = langEditable
        ? `<td><input class="fill-input candidate-lang-input${langDraft !== undefined ? ' dirty' : ''}" type="text" data-key="${escapeHtml(c.normalized)}" value="${escapeHtml(langDraft !== undefined ? langDraft : '')}" placeholder="待翻译（随 Excel 导出）" /></td>`
        : `<td class="col-muted">—</td>`
      return `<tr${checked ? ' class="selected"' : ''}>
        <td class="col-check"><input type="checkbox" data-key="${escapeHtml(c.normalized)}" ${checked} /></td>
        <td class="col-text"><span class="raw col-zh rich-text">${renderRichText(c.zhCN)}</span><button class="btn-edit-text" type="button" data-key="${escapeHtml(c.normalized)}" title="编辑原文：条目 zh-CN 与 Excel 导出用编辑后的文本，导入时仍按扫描原文校验">✎</button>${state.rootHandle ? `<button class="btn-localize-now" type="button" data-key="${escapeHtml(c.normalized)}" title="立即创建条目（下方唯一 ID）并把文件里的原文替换为 <ref:ID>（先备份）">本地化</button>` : ''}<div class="text-id" title="唯一 ID（与引擎同格式 16hex），写入 localization.json 条目">${escapeHtml(c.id)}</div></td>
        ${langCell}
        <td><select class="handle-select" data-key="${escapeHtml(c.normalized)}"><option selected>替换</option><option>忽略</option></select></td>
        <td><span class="conf-badge ${c.confidence === 'high' ? 'conf-high' : 'conf-medium'}">${c.confidence === 'high' ? '高' : '中'}</span></td>
        <td><span class="type-badge">${typeLabel(c.sourceType)}</span></td>
        <td class="col-loc">${locations}${more}</td></tr>`
    }).join('')}</tbody></table>`
  }
  function renderMissingRows(missing) {
    const scan = state.scan
    const query = state.filterQueryValue
    const langEditable = state.langValue && state.langValue !== scan.languages[0]
    const rows = missing.filter((m) => !query || m.id.includes(query) || m.name.includes(query) || (m.languages[m.languages[0]] || '').includes(query))
    const editable = !!state.rootHandle
    return `<table class="candidate-table"><thead><tr><th>名称</th><th>中文（下方为条目 ID）</th><th>译文(${escapeHtml(state.langValue)})</th><th>缺语言</th></tr></thead><tbody>${rows.map((m) => {
      const { key, draft, value } = langCellValue(m.languages, m.id)
      const dirty = draft !== undefined && draft !== (m.languages[state.langValue] || '')
      const langCell = !langEditable
        ? `<td class="col-muted">—</td>`
        : editable
          ? richCell({ id: m.id, lang: state.langValue, display: m.languages[state.langValue] || '', input: value, dirty })
          : `<td class="${m.languages[state.langValue] ? 'col-muted' : 'col-danger'}">${m.languages[state.langValue] ? renderRichText(m.languages[state.langValue]) : '(空)'}</td>`
      const primary = scan.languages[0]
      const zhKey = `${m.id}::${primary}`
      const zhDraft = state.fillDrafts.get(zhKey)
      const zhValue = zhDraft !== undefined ? zhDraft : (m.languages[primary] || '')
      const zhDirty = zhDraft !== undefined && zhDraft !== (m.languages[primary] || '')
      const zhCell = editable
        ? richCell({ id: m.id, lang: primary, display: zhValue, input: zhValue, dirty: zhDirty, wide: true, tdClass: 'col-text', suffix: `<div class="text-id">${escapeHtml(m.id)}</div>` })
        : `<td class="col-text"><span class="raw col-zh rich-text">${renderRichText(m.languages[primary] || '')}</span><div class="text-id">${escapeHtml(m.id)}</div></td>`
      return `<tr>
        <td>${escapeHtml(m.name)}</td>${zhCell}
        ${langCell}
        <td class="col-danger">${m.missingLangs.join(', ')}</td></tr>`
    }).join('')}</tbody></table>`
  }
  function renderOrphanRows(orphans) {
    const query = state.filterQueryValue
    const rows = orphans.filter((o) => !query
      || o.refId.includes(query)
      || o.suggestion.toLowerCase().includes(query)
      || o.uses.some((u) => u.file.toLowerCase().includes(query) || (u.attrName || '').includes(query)))
    const contextOf = (o) => [...new Set(o.uses.map((u) => u.attrName || u.nodeName || '').filter(Boolean))].join(' / ')
    return `<table class="candidate-table"><thead><tr><th>引用 ID</th><th>上下文</th><th class="col-orphan-text">中文文本（创建缺失条目）</th><th class="col-loc">引用位置</th><th></th></tr></thead><tbody>${rows.map((o) => {
      const value = state.orphanTexts.get(o.refId) || o.suggestion || ''
      const context = contextOf(o)
      const uses = o.uses.slice(0, 4).map((u) => `<span class="loc-file">${escapeHtml(u.file)}</span><span class="loc-path">${escapeHtml(u.path)}</span>`).join('')
      const more = o.uses.length > 4 ? `<span class="loc-path">…共 ${o.uses.length} 处（${o.fileCount} 个文件）</span>` : ''
      return `<tr>
        <td class="col-danger col-mono">${o.refId}</td>
        <td class="col-muted">${escapeHtml(context) || '—'}</td>
        <td class="col-orphan-text"><input class="orphan-text" type="text" data-ref-id="${escapeHtml(o.refId)}" value="${escapeHtml(value)}" placeholder="输入该条目的中文原文" /></td>
        <td class="col-loc">${uses}${more}</td>
        <td><button class="btn-fix-orphan button" type="button" data-ref-id="${escapeHtml(o.refId)}" ${value.trim() ? '' : 'disabled'} title="用该引用 ID 在 localization.json 创建条目（资产文件无需改动）">创建条目</button></td></tr>`
    }).join('')}</tbody></table>`
  }
  function renderSuspiciousRows(suspicious) {
    const scan = state.scan
    const query = state.filterQueryValue
    const langEditable = state.langValue && state.langValue !== scan.languages[0]
    const rows = suspicious.filter((m) => !query || m.id.includes(query) || m.name.includes(query) || (m.languages[scan.languages[0]] || '').includes(query))
    const editable = !!state.rootHandle
    return `<table class="candidate-table"><thead><tr><th>名称</th><th>中文（下方为条目 ID）</th><th>译文(${escapeHtml(state.langValue)})</th><th>疑似说明</th></tr></thead><tbody>${rows.map((m) => {
      const suspect = m.suspicious.filter((s) => s.lang === state.langValue)
      const { key, draft, value } = langCellValue(m.languages, m.id)
      const dirty = draft !== undefined && draft !== (m.languages[state.langValue] || '')
      const langCell = !langEditable
        ? `<td class="col-muted">—</td>`
        : editable
          ? richCell({ id: m.id, lang: state.langValue, display: m.languages[state.langValue] || '', input: value, dirty, extraClass: suspect.length ? 'fill-suspect' : '' })
          : `<td class="${suspect.length ? 'col-danger' : 'col-muted'}">${m.languages[state.langValue] ? renderRichText(m.languages[state.langValue]) : '(空)'}</td>`
      const primary = scan.languages[0]
      const zhKey = `${m.id}::${primary}`
      const zhDraft = state.fillDrafts.get(zhKey)
      const zhValue = zhDraft !== undefined ? zhDraft : (m.languages[primary] || '')
      const zhDirty = zhDraft !== undefined && zhDraft !== (m.languages[primary] || '')
      const zhCell = editable
        ? richCell({ id: m.id, lang: primary, display: zhValue, input: zhValue, dirty: zhDirty, wide: true, tdClass: 'col-text', suffix: `<div class="text-id">${escapeHtml(m.id)}</div>` })
        : `<td class="col-text"><span class="raw col-zh rich-text">${renderRichText(m.languages[primary] || '')}</span><div class="text-id">${escapeHtml(m.id)}</div></td>`
      return `<tr>
        <td>${escapeHtml(m.name)}</td>${zhCell}
        ${langCell}
        <td class="col-muted">${escapeHtml(m.suspicious.map((s) => `${s.lang}：${s.reason}（「${s.value}」）`).join('；'))}</td></tr>`
    }).join('')}</tbody></table>`
  }
  /** 已本地化视图：被引用且条目存在的文本——中文与译文都可直接编辑，「保存修改」备份后写回 localization.json。 */
  function renderLocalizedRows(localized) {
    const scan = state.scan
    const query = state.filterQueryValue
    const langEditable = state.langValue && state.langValue !== scan.languages[0]
    const editable = !!state.rootHandle
    const primary = scan.languages[0]
    const rows = localized.filter((m) => !query || m.id.includes(query) || m.name.includes(query) || m.zh.includes(query) || m.locations.some((l) => l.file.toLowerCase().includes(query)))
    return `<table class="candidate-table"><thead><tr><th>名称</th><th>中文原文（可编辑，下方为条目 ID）</th><th>译文(${escapeHtml(state.langValue)})</th><th>缺语言</th><th class="col-loc">引用位置</th></tr></thead><tbody>${rows.map((m) => {
      const missingLangs = scan.languages.slice(1).filter((lang) => !(m.langs[lang] && m.langs[lang].trim()))
      const zhKey = `${m.id}::${primary}`
      const zhDraft = state.fillDrafts.get(zhKey)
      const zhValue = zhDraft !== undefined ? zhDraft : m.zh
      const { key, draft, value } = langCellValue(m.langs, m.id)
      const dirty = draft !== undefined && draft !== (m.langs[state.langValue] || '')
      const zhDirty = zhDraft !== undefined && zhDraft !== m.zh
      const zhCell = editable
        ? richCell({ id: m.id, lang: primary, display: zhValue, input: zhValue, dirty: zhDirty, wide: true, tdClass: 'col-text', suffix: `<div class="text-id">${escapeHtml(m.id)}</div>` })
        : `<td class="col-text"><span class="raw col-zh rich-text">${renderRichText(m.zh)}</span><div class="text-id">${escapeHtml(m.id)}</div></td>`
      const langCell = !langEditable
        ? `<td class="col-muted">—</td>`
        : editable
          ? richCell({ id: m.id, lang: state.langValue, display: m.langs[state.langValue] || '', input: value, dirty })
          : `<td class="${m.langs[state.langValue] ? 'col-muted' : 'col-danger'}">${m.langs[state.langValue] ? renderRichText(m.langs[state.langValue]) : '(空)'}</td>`
      const locations = m.locations.slice(0, 3).map((l) => `<span class="loc-file">${escapeHtml(l.file)}</span><span class="loc-path">${escapeHtml(l.path)}</span>`).join('')
      const more = m.locations.length > 3 ? `<span class="loc-path">…共 ${m.locations.length} 处</span>` : ''
      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        ${zhCell}
        ${langCell}
        <td class="${missingLangs.length ? 'col-danger' : 'col-muted'}">${missingLangs.length ? missingLangs.join(', ') : '完整'}</td>
        <td class="col-loc">${locations}${more}</td></tr>`
    }).join('')}</tbody></table>`
  }
  /** 数据属性 tab：数据文件的属性文本（名称/描述）——上半部分未本地化候选（可勾选/本地化），下半部分已本地化条目（可编辑原文/译文）。 */
  function renderAttributeRows(scan) {
    if (!scan.attributeCandidates.length && !scan.attributeLocalized.length) return '<div class="empty-state">没有数据属性条目。</div>'
    const candBlock = scan.attributeCandidates.length ? `<h3 class="list-section">未本地化的数据属性（名称/描述）</h3>` + renderCandidateRows(scan.attributeCandidates) : ''
    const locBlock = scan.attributeLocalized.length ? `<h3 class="list-section">已本地化的数据属性条目（编辑原文/译文）</h3>` + renderLocalizedRows(scan.attributeLocalized) : ''
    return candBlock + locBlock
  }

  // ---- 导出 Excel ----
  async function buildExportWorkbook() {
    const scan = state.scan
    const workbook = new ExcelJS.Workbook()
    const primary = scan.languages[0]
    const other = scan.languages.filter((l) => l !== primary)
    // 引擎兼容表 open-yami：与 Yami 编辑器本地化界面导出算法一致（main.js to-excel）——
    // 整棵树：文件夹每次导出重新生成 16hex ID，parentID 表达层级，叶子保留真实 ID 与全部语言列
    const yamiSheet = workbook.addWorksheet('open-yami')
    yamiSheet.columns = [{ header: 'ID', key: 'id', width: 20 }, { header: 'Name', key: 'name', width: 10 }, ...scan.languages.map((v) => ({ header: v, key: v, width: 10 })), { header: 'parentID', key: 'parentID', width: 20 }, { header: 'isDir', key: 'isDir', width: 10 }]
    yamiSheet.getRow(1).font = { bold: true }
    yamiSheet.views = [{ state: 'frozen', ySplit: 1 }]
    core.openYamiRows(state.scanLocalization, scan.languages).forEach((row) => {
      const values = { id: row.id, name: row.name, parentID: row.parentID, isDir: row.isDir }
      for (const lang of scan.languages) values[lang] = row.contents[lang]
      yamiSheet.addRow(values)
    })
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
      other.forEach((lang, j) => { row.getCell(3 + j).value = state.candidateLangs.get(`${c.normalized}::${lang}`) || '' })
      row.getCell(3 + other.length).value = '替换'
      row.getCell(4 + other.length).value = c.confidence === 'high' ? '高' : '中'
      row.getCell(5 + other.length).value = typeLabel(c.sourceType)
      row.getCell(6 + other.length).value = locations
      row.getCell(2).alignment = { wrapText: true }
      row.getCell(6 + other.length).alignment = { wrapText: true }
    })
    // 数据属性表：数据文件属性文本（名称/描述）的未本地化候选，列结构同待本地化
    const attributeCandidates = scan.attributeCandidates.filter((c) => state.selectedIds.has(c.normalized))
    const attrSheet = workbook.addWorksheet('数据属性')
    attrSheet.columns = ['ID', `原文(${primary})`, ...other, '处理方式', '置信度', '来源', '出现位置'].map((h) => ({ header: h, width: h === '出现位置' ? 46 : 14 }))
    attrSheet.getRow(1).font = { bold: true }
    attrSheet.views = [{ state: 'frozen', ySplit: 1 }]
    attributeCandidates.forEach((c, i) => {
      c.id = c.id || randomHex16()
      const row = attrSheet.getRow(i + 2)
      const locations = c.locations.map((l) => `${l.file} :: ${l.path}`).join('\n')
      row.getCell(1).value = c.id
      row.getCell(2).value = c.zhCN
      other.forEach((lang, j) => { row.getCell(3 + j).value = state.candidateLangs.get(`${c.normalized}::${lang}`) || '' })
      row.getCell(3 + other.length).value = '替换'
      row.getCell(4 + other.length).value = c.confidence === 'high' ? '高' : '中'
      row.getCell(5 + other.length).value = typeLabel(c.sourceType)
      row.getCell(6 + other.length).value = locations
      row.getCell(2).alignment = { wrapText: true }
      row.getCell(6 + other.length).alignment = { wrapText: true }
    })
    const fillSheet = workbook.addWorksheet('缺翻译')
    fillSheet.columns = ['ID', '名称', `原文(${primary})`, ...other, '缺语言'].map((h) => ({ header: h, width: h.includes('原文') ? 18 : 14 }))
    fillSheet.getRow(1).font = { bold: true }
    fillSheet.views = [{ state: 'frozen', ySplit: 1 }]
    scan.missing.forEach((m, i) => {
      const row = fillSheet.getRow(i + 2)
      row.getCell(1).value = m.id
      row.getCell(2).value = m.name
      row.getCell(3).value = m.languages[primary]
      other.forEach((lang, j) => { row.getCell(4 + j).value = m.languages[lang] })
      row.getCell(4 + other.length).value = m.missingLangs.join(', ')
    })
    const suspiciousSheet = workbook.addWorksheet('疑似占位')
    suspiciousSheet.columns = ['ID', '名称', `原文(${primary})`, ...other, '疑似说明'].map((h) => ({ header: h, width: h.includes('原文') || h === '疑似说明' ? 20 : 14 }))
    suspiciousSheet.getRow(1).font = { bold: true }
    suspiciousSheet.views = [{ state: 'frozen', ySplit: 1 }]
    scan.suspicious.forEach((m, i) => {
      const row = suspiciousSheet.getRow(i + 2)
      row.getCell(1).value = m.id
      row.getCell(2).value = m.name
      row.getCell(3).value = m.languages[primary]
      other.forEach((lang, j) => { row.getCell(4 + j).value = m.languages[lang] })
      row.getCell(4 + other.length).value = m.suspicious.map((s) => `${s.lang}：${s.reason}（现值「${s.value}」）`).join('；')
    })
    const orphanSheet = workbook.addWorksheet('孤儿引用')
    orphanSheet.columns = [{ header: '引用ID', width: 20 }, { header: '出现文件', width: 60 }, { header: '上下文', width: 16 }, { header: '建议文本', width: 24 }]
    orphanSheet.getRow(1).font = { bold: true }
    orphanSheet.views = [{ state: 'frozen', ySplit: 1 }]
    scan.orphans.forEach((o, i) => {
      const row = orphanSheet.getRow(i + 2)
      row.getCell(1).value = o.refId
      row.getCell(2).value = o.uses.map((u) => u.file).join('\n')
      row.getCell(3).value = [...new Set(o.uses.map((u) => u.attrName || u.nodeName || '').filter(Boolean))].join(' / ')
      row.getCell(4).value = o.suggestion
      row.getCell(2).alignment = { wrapText: true }
      row.getCell(4).alignment = { wrapText: true }
    })
    const guideSheet = workbook.addWorksheet('说明')
    guideSheet.getRow(1).values = [null, '快速本地化 · 填写指引']
    const guide = [
      '1. 「待本地化」表：界面显示路径上尚未本地化的文本；「数据属性」表：数据文件的属性文本（名称/描述）。导出时已预分配 ID（请勿修改），填好各语言列后，导入时会把原文替换为 <ref:ID> 引用。',
      '2. 「处理方式」列可改为「忽略」：该行导入时跳过，不创建条目也不替换。',
      '3. 「缺翻译」表：已存在的本地化条目，补填缺失语言列即可；导入时写回 localization.json。',
      '4. 删除整行 = 放弃该条（待本地化表中的 ID 不会写入工程）；请勿只删单元格留下空行。',
      '5. 语言列由 Data/config.json 的 localization.languages 决定，未来加语言只需在配置中追加并重新导出。',
      '6. 同一 Excel 重复导入是安全的（已处理过的条目自动跳过）；导入前工具会重新扫描工程，发现文件被外部改动会中止导入。',
      '7. 「孤儿引用」表：引用的条目不存在于 localization.json。在「建议文本」列填中文原文，导入时按引用 ID 创建条目（资产文件无需改动）；留空则跳过该行。',
      '8. 「疑似占位」表：译文是占位脏词（shit/test/待翻译…）。直接在语言列填入正确译文，导入时按 ID 写回。',
      '9. 新增条目会按来源类型分组写入 localization.json 的「快速本地化」文件夹（物品/装备/技能/状态/事件/界面/触发器/角色/孤儿修复）。',
      '10. 「open-yami」表（第一张）：与 Yami 编辑器本地化界面导出/导入算法一致——整棵条目树，文件夹行 isDir=1、叶子保留真实 ID，parentID 表达层级。该表可直接在编辑器「从Excel导入」使用；本工具导入含该表的文件时按整树替换（叶子 ID 保留、引用不失效），可与其他工作表共存但以本表为准。',
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
    // 引擎兼容格式：存在 open-yami 表 → 整体树导入（与编辑器 from-excel 同算法）
    const treeSheet = workbook.getWorksheet('open-yami')
    if (treeSheet) {
      const treeHeader = treeSheet.getRow(1)
      const treeCols = {}
      treeHeader.eachCell({ includeEmpty: false }, (cell, col) => { const value = cellText(cell.value).trim(); if (value) treeCols[value] = col })
      if (!treeCols.ID || !treeCols.isDir) throw new Error('open-yami 表缺少 ID/isDir 列')
      const treeRows = []
      for (let r = 2; r <= treeSheet.rowCount; r++) {
        const row = treeSheet.getRow(r)
        const id = cellText(row.getCell(treeCols.ID).value)
        if (!id.trim()) continue
        const contents = {}
        for (const [key, col] of Object.entries(treeCols)) {
          if (!['ID', 'Name', 'parentID', 'isDir'].includes(key)) contents[key] = cellText(row.getCell(col).value)
        }
        treeRows.push({
          id, name: cellText(row.getCell(treeCols.Name).value),
          parentID: cellText(row.getCell(treeCols.parentID).value),
          isDir: cellText(row.getCell(treeCols.isDir).value),
          contents,
        })
      }
      if (!treeRows.length) throw new Error('open-yami 表没有数据行')
      return { treeRows }
    }
    const rows = []
    for (const sheet of workbook.worksheets) {
      const name = sheet.name
      const isAdd = name.includes('待本地化') || name.includes('数据属性')
      const isOrphan = name.includes('孤儿引用')
      const isFill = name.includes('缺翻译') || name.includes('疑似占位')
      if (!isAdd && !isFill && !isOrphan) continue
      const header = sheet.getRow(1)
      const cols = {}
      header.eachCell({ includeEmpty: false }, (cell, col) => { cols[cellText(cell.value).trim()] = col })
      let primaryCol = null
      if (isOrphan) {
        if (!cols['引用ID']) throw new Error(`${name} 缺少「引用ID」列`)
        if (!cols['建议文本']) throw new Error(`${name} 缺少「建议文本」列`)
        primaryCol = '建议文本'
      } else {
        if (!cols.ID) throw new Error(`${name} 缺少 ID 列`)
        primaryCol = Object.keys(cols).find((key) => key.startsWith('原文'))
        if (!primaryCol) throw new Error(`${name} 缺少原文列`)
      }
      const META_COLS = new Set(['ID', '引用ID', '处理方式', '置信度', '来源', '出现位置', '名称', '缺语言', '备注', '疑似说明', '建议文本', '出现文件', '上下文', primaryCol])
      const langCols = []
      for (const [key, col] of Object.entries(cols)) {
        if (!META_COLS.has(key)) langCols.push({ name: key, col })
      }
      for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r)
        const idCell = isOrphan ? cols['引用ID'] : cols.ID
        const id = cellText(row.getCell(idCell).value)
        if (!id.trim()) continue
        const langs = {}
        for (const { name: langName, col } of langCols) langs[langName] = cellText(row.getCell(col).value)
        rows.push({
          sheet: isOrphan ? 'orphan' : isAdd ? 'add' : 'fill', row: r, id,
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
      const loaded = await readImportWorkbook(await file.arrayBuffer())
      if (loaded.treeRows) {
        // 引擎格式：整树替换，统计差异供预览
        const newList = core.localizationFromOpenYami(loaded.treeRows)
        const diff = core.diffLocalizationTrees(state.scanLocalization.list, newList)
        state.importTree = { newList, diff }
        state.importRows = state.importErrors = state.importAdditions = state.importFills = state.importIgnored = null
        renderImportPreview()
        return
      }
      const rows = loaded
      const existingById = new Map()
      const collect = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) collect(item.children); else if (item && item.id && item.contents) existingById.set(item.id, { zhCN: typeof item.contents[state.scan.languages[0]] === 'string' ? item.contents[state.scan.languages[0]] : '', leaf: item }) } }
      collect(state.scanLocalization && state.scanLocalization.list)
      const { errors, additions, fills, ignored } = core.validateImportRows(rows, existingById, state.scan.languages)
      state.importRows = rows
      state.importErrors = errors
      state.importAdditions = additions
      state.importFills = fills
      state.importIgnored = ignored
      renderImportPreview()
    } catch (error) { toast(`导入失败：${error.message}`, 'error'); console.error(error) }
  }
  function renderImportPreview() {
    if (state.importTree) {
      const { diff } = state.importTree
      const changed = diff.added.length + diff.updated.length + diff.removed.length
      els.importPreview.classList.remove('hidden')
      els.importPreviewSummary.textContent = `open-yami 表（引擎格式）整树导入：新增 ${diff.added.length} 条 · 更新 ${diff.updated.length} 条 · 移除 ${diff.removed.length} 条 · 文件夹 ${diff.foldersBefore} → ${diff.foldersAfter} 个`
      els.importPreviewBody.innerHTML = `<div class="ok">＋ 将整体替换 localization.json 条目树（叶子 ID 保留，引用不失效；文件夹 ID 每次导出重新生成）</div>`
        + (diff.added.length ? `<div class="ok">＋ 新增 ${diff.added.length} 条：${escapeHtml(diff.added.slice(0, 6).join(' '))}${diff.added.length > 6 ? ' …' : ''}</div>` : '')
        + (diff.updated.length ? `<div class="warn">⊙ 更新 ${diff.updated.length} 条（译文/内容有变化的条目）</div>` : '')
        + (diff.removed.length ? `<div class="err">✕ 移除 ${diff.removed.length} 条（表格里不存在的条目会被删除）</div>` : '')
        + `<div class="ok">＋ 先备份 localization.json，写回格式仿生；不影响资产文件</div>`
      els.btnConfirmImport.disabled = changed === 0
      return
    }
    const { errors, additions, fills, importIgnored } = state
    els.importPreview.classList.remove('hidden')
    const { groups: importGroups, orphanAdds } = core.classifyImportAdditions(state.scan, additions)
    const involved = new Set(importGroups.map((g) => g.file))
    const replacementFiles = involved.size ? `，替换 ${involved.size} 个资产文件中的原文` : ''
    const orphanNote = orphanAdds.length ? `（其中孤儿修复 ${orphanAdds.length} 条，仅写 localization.json，资产文件无需改动）` : ''
    els.importPreviewSummary.textContent = `将新增 ${additions.length} 条本地化${replacementFiles} · 补译 ${fills.length} 条 · 忽略 ${importIgnored.length} 条 · 错误 ${errors.length} 条`
    const ignoredLines = importIgnored.slice(0, 12).map((row) => `<div class="skip">－ 第 ${row.row} 行（${row.sheet === 'orphan' ? '孤儿引用' : row.sheet === 'add' ? '待本地化' : '缺翻译/疑似占位'}）「${escapeHtml(String(row.zhCN || row.id).slice(0, 24))}」：${escapeHtml(row.reason)}</div>`).join('')
    const ignoredMore = importIgnored.length > 12 ? `<div class="skip">…还有 ${importIgnored.length - 12} 条忽略</div>` : ''
    els.importPreviewBody.innerHTML = errors.map((e) => `<div class="err">✕ ${escapeHtml(e)}</div>`).join('')
      + (additions.length ? `<div class="ok">＋ ${additions.length} 条新增（含译文：${additions.filter((r) => Object.values(r.langs).some((v) => v && v.trim())).length}）${orphanNote}</div>` : '')
      + (fills.length ? `<div class="ok">＋ ${fills.length} 条补译</div>` : '')
      + (additions.length && involved.size ? `<div class="ok">＋ 将写入 ${involved.size} 个资产文件与 localization.json（先备份，失败自动回滚）</div>` : '')
      + (importIgnored.length ? `<div class="warn">⊙ ${importIgnored.length} 条忽略（不创建、不替换、不写入）</div>${ignoredLines}${ignoredMore}` : '')
    els.btnConfirmImport.disabled = errors.length > 0 || (additions.length === 0 && fills.length === 0)
  }
  async function confirmImport() {
    if (state.importTree) {
      const { newList, diff } = state.importTree
      els.btnConfirmImport.disabled = true
      try {
        setScanProgress(0, 0, true)
        const localizationJson = await readJson(state.rootHandle, 'Data/localization.json')
        localizationJson.list = newList
        const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups', { create: true })
        const backupDir = await backupRoot.getDirectoryHandle(formatNow(), { create: true })
        const writeFileTo = async (handle, content) => {
          const file = await handle.createWritable()
          await file.write(content)
          await file.close()
        }
        await writeFileTo(await backupDir.getFileHandle('localization.json', { create: true }), await readText(state.rootHandle, 'Data/localization.json'))
        const original = await readText(state.rootHandle, 'Data/localization.json')
        await writeFileTo(await getHandle(state.rootHandle, 'Data/localization.json'), core.serializeLike(localizationJson, original))
        state.importTree = null
        els.importPreview.classList.add('hidden')
        toast(`open-yami 导入完成：新增 ${diff.added.length} · 更新 ${diff.updated.length} · 移除 ${diff.removed.length}（备份于 Lootsmith Backups/${backupDir.name}）`, 'success')
        await finishAfterWrite(new Map(), localizationJson)
      } catch (error) {
        els.btnConfirmImport.disabled = false
        toast(`导入中止：${error.message}`, 'error')
        console.error(error)
      }
      return
    }
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
      const { groups } = core.classifyImportAdditions(state.scan, importAdditions.filter((row) => !(row.handle && row.handle.trim() === '忽略')))
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
        const candidate = core.findCandidateById(state.scan, row.id)
        additions.push({ id: row.id, zhCN: row.zhCN, langs: row.langs, folder: row.folder || (candidate ? typeLabel(candidate.sourceType) : '其他') })
      }
      core.localizationInsertion(localizationJson, additions, importFills, state.scan.languages)
      const originalLocalization = await readText(state.rootHandle, 'Data/localization.json')
      await writeFileTo(await getHandle(state.rootHandle, 'Data/localization.json'), core.serializeLike(localizationJson, originalLocalization))
      // 6) 完成：重置导入状态并重扫
      state.importRows = state.importErrors = state.importAdditions = state.importFills = null
      state.importIgnored = []
      state.importTree = null
      els.importPreview.classList.add('hidden')
      toast(`导入完成：新增 ${additions.length} 条 · 补译 ${importFills.length} 条 · 备份于 Lootsmith Backups/${backupDir.name}`, 'success')
      await finishAfterWrite(filesToWrite, localizationJson)
    } catch (error) {
      els.btnConfirmImport.disabled = false
      toast(`导入中止：${error.message}`, 'error')
      console.error(error)
    }
  }

  // ---- 孤儿引用修复：按引用 ID 创建缺失条目（只写 localization.json，资产文件已引用该 ID 无需改动） ----
  async function createOrphanEntries(rows) {
    if (!state.scan || !state.rootHandle) { toast('只读导入模式无法写回工程，请使用「选择工程」授权后修复', 'error'); return }
    const entries = rows
      .map((r) => ({ refId: r.refId, zhCN: (state.orphanTexts.get(r.refId) || '').trim() }))
      .filter((e) => e.zhCN)
    if (!entries.length) { toast('没有可创建的条目（先在表格中填写中文文本）', 'info'); return }
    try {
      const localizationJson = await readJson(state.rootHandle, 'Data/localization.json')
      const existingIds = core.localizationIds(localizationJson)
      const pending = entries.filter((e) => !existingIds.has(e.refId.toLowerCase()))
      if (!pending.length) { toast('这些条目已存在（无需修复）', 'info'); return }
      const additions = pending.map((e) => ({ id: e.refId, zhCN: e.zhCN, langs: {}, folder: ORPHAN_FOLDER }))
      core.localizationInsertion(localizationJson, additions, [], state.scan.languages)
      const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups', { create: true })
      const backupDir = await backupRoot.getDirectoryHandle(formatNow(), { create: true })
      const writeFileTo = async (handle, content) => {
        const file = await handle.createWritable()
        await file.write(content)
        await file.close()
      }
      await writeFileTo(await backupDir.getFileHandle('localization.json', { create: true }), await readText(state.rootHandle, 'Data/localization.json'))
      const original = await readText(state.rootHandle, 'Data/localization.json')
      await writeFileTo(await getHandle(state.rootHandle, 'Data/localization.json'), core.serializeLike(localizationJson, original))
      toast(`已创建 ${additions.length} 条缺失条目（备份于 Lootsmith Backups/${backupDir.name}）`, 'success')
      await finishAfterWrite(new Map(), localizationJson)
    } catch (error) {
      toast(`创建失败：${error.message}`, 'error')
      console.error(error)
    }
  }

  // ---- 原文编辑：候选行的 ✎ 按钮 → 单元格内联编辑（保存后条目 zh-CN/导出用新文本，导入校验仍按扫描原文） ----
  function startTextEdit(button) {
    const candidate = state.scan && (state.scan.candidates.find((c) => c.normalized === button.dataset.key) || state.scan.attributeCandidates.find((c) => c.normalized === button.dataset.key))
    if (!candidate) return
    const cell = button.closest('td')
    const old = candidate.zhCN
    cell.innerHTML = `<div class="edit-cell">
      <textarea class="edit-text">${escapeHtml(old)}</textarea>
      <div class="text-id">${escapeHtml(candidate.id || '')}</div>
      <div class="edit-actions">
        <button class="button btn-save-edit" type="button">保存</button>
        <button class="button btn-cancel-edit" type="button">取消</button>
      </div></div>`
    const textarea = cell.querySelector('.edit-text')
    textarea.focus()
    const finish = (save) => {
      if (save) {
        const value = textarea.value
        if (value !== old) {
          if (!candidate.originalZhCN) candidate.originalZhCN = old // 首次编辑锁定扫描原文，导入校验用
          candidate.zhCN = value
          toast('原文已修改：导出与条目 zh-CN 用新文本，导入替换校验仍按扫描原文', 'success')
        }
      }
      renderList()
    }
    cell.querySelector('.btn-save-edit').addEventListener('click', () => finish(true))
    cell.querySelector('.btn-cancel-edit').addEventListener('click', () => finish(false))
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) finish(true)
      if (event.key === 'Escape') finish(false)
    })
  }

  // ---- 单条立即本地化：用候选的唯一 ID 创建条目（zh-CN=当前原文，含界面里填的译文），
  //      并把所有出现位置的原文替换为 <ref:ID>（先校验后替换 → 备份 → 仿生写回 → 重扫） ----
  async function localizeCandidateNow(candidate) {
    if (!state.scan || !state.rootHandle) { toast('只读导入模式无法写回工程，请使用「选择工程」授权', 'error'); return }
    try {
      setScanProgress(0, 0, true)
      const filesToWrite = new Map()
      for (const loc of candidate.locations) {
        if (filesToWrite.has(loc.file)) continue
        const original = await readText(state.rootHandle, loc.file)
        filesToWrite.set(loc.file, { data: JSON.parse(original), original })
      }
      for (const file of filesToWrite.keys()) {
        const result = core.applyAssetReplacement(filesToWrite.get(file).data, candidate, file)
        if (!result.ok) throw new Error(result.reason)
      }
      const localizationJson = await readJson(state.rootHandle, 'Data/localization.json')
      const langs = {}
      for (const lang of state.scan.languages.slice(1)) {
        const value = state.candidateLangs.get(`${candidate.normalized}::${lang}`)
        if (value && value.trim()) langs[lang] = value
      }
      core.localizationInsertion(localizationJson, [{ id: candidate.id, zhCN: candidate.zhCN, langs, folder: typeLabel(candidate.sourceType) }], [], state.scan.languages)
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
      for (const [file, { data, original }] of filesToWrite) {
        await writeFileTo(await getHandle(state.rootHandle, file), core.serializeLike(data, original))
      }
      const originalLocalization = await readText(state.rootHandle, 'Data/localization.json')
      await writeFileTo(await getHandle(state.rootHandle, 'Data/localization.json'), core.serializeLike(localizationJson, originalLocalization))
      toast(`已本地化「${candidate.zhCN.slice(0, 24)}」→ 条目 ${candidate.id}（备份于 Lootsmith Backups/${backupDir.name}）`, 'success')
      await finishAfterWrite(filesToWrite, localizationJson)
    } catch (error) {
      setScanProgress(0, 0)
      toast(`本地化失败：${error.message}`, 'error')
      console.error(error)
    }
  }

  // ---- 补译保存：缺翻译/疑似占位视图的语言输入 → 备份 → 写回 localization.json ----
  function localizationLeaf(id) {
    let found = null
    const walk = (items) => { for (const item of items || []) { if (item && Array.isArray(item.children)) walk(item.children); else if (item && item.id === id) found = item } }
    walk(state.scanLocalization && state.scanLocalization.list)
    return found
  }
  async function writeLocalizationFills() {
    if (!state.scan || !state.rootHandle) { toast('只读导入模式无法写回工程，请使用「选择工程」授权', 'error'); return }
    const fills = []
    for (const [key, value] of state.fillDrafts) {
      const separator = key.indexOf('::')
      const id = key.slice(0, separator)
      const lang = key.slice(separator + 2)
      if (!value || !value.trim()) continue
      const leaf = localizationLeaf(id)
      if (leaf && String(leaf.contents[lang] || '') === value) continue // 与现值相同 → 跳过
      fills.push({ id, langs: { [lang]: value } })
    }
    if (!fills.length) { toast('没有需要保存的修改（先在上方表格里填写）', 'info'); return }
    try {
      setScanProgress(0, 0, true)
      const localizationJson = await readJson(state.rootHandle, 'Data/localization.json')
      core.localizationInsertion(localizationJson, [], fills, state.scan.languages)
      const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups', { create: true })
      const backupDir = await backupRoot.getDirectoryHandle(formatNow(), { create: true })
      const writeFileTo = async (handle, content) => {
        const file = await handle.createWritable()
        await file.write(content)
        await file.close()
      }
      await writeFileTo(await backupDir.getFileHandle('localization.json', { create: true }), await readText(state.rootHandle, 'Data/localization.json'))
      const original = await readText(state.rootHandle, 'Data/localization.json')
      await writeFileTo(await getHandle(state.rootHandle, 'Data/localization.json'), core.serializeLike(localizationJson, original))
      toast(`已保存 ${fills.length} 处修改（原文/译文写回 localization.json，备份于 Lootsmith Backups/${backupDir.name}）`, 'success')
      await finishAfterWrite(new Map(), localizationJson)
    } catch (error) {
      setScanProgress(0, 0)
      toast(`保存失败：${error.message}`, 'error')
      console.error(error)
    }
  }

  // ---- 备份与还原面板：列出 Lootsmith Backups 目录，支持立即备份 / 还原 / 删除 ----
  async function listBackupEntries() {
    try {
      const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups')
      const entries = []
      for await (const [name, handle] of backupRoot.entries()) {
        if (handle.kind !== 'directory') continue
        let fileCount = 0
        for await (const [innerName, inner] of handle.entries()) { if (inner.kind === 'file') fileCount += 1 }
        entries.push({ name, fileCount })
      }
      entries.sort((a, b) => b.name.localeCompare(a.name))
      return { backupRoot, entries }
    } catch { return { backupRoot: null, entries: [] } }
  }
  async function renderBackupPanel() {
    els.backupPanelBody.innerHTML = '<div class="empty-state">读取备份列表…</div>'
    const { entries } = await listBackupEntries()
    els.backupPanelSummary.textContent = entries.length ? `共 ${entries.length} 个备份（新在上）` : 'Lootsmith Backups 目录下的历史备份'
    if (!entries.length) {
      els.backupPanelBody.innerHTML = '<div class="empty-state">还没有备份。导入 Excel、孤儿修复、保存补译和「立即备份」都会在 Lootsmith Backups 下创建带时间戳的备份目录。</div>'
      return
    }
    els.backupPanelBody.innerHTML = entries.map((entry) => `<div class="backup-row">
      <span class="backup-name">${escapeHtml(entry.name)}</span>
      <span class="backup-meta">${entry.fileCount} 个文件</span>
      <span class="spacer"></span>
      <button class="button btn-restore" type="button" data-backup="${escapeHtml(entry.name)}">还原</button>
      <button class="button btn-delete" type="button" data-backup="${escapeHtml(entry.name)}">删除</button>
    </div>`).join('')
    els.backupPanelBody.querySelectorAll('.btn-restore').forEach((button) => button.addEventListener('click', () => restoreBackup(button.dataset.backup)))
    els.backupPanelBody.querySelectorAll('.btn-delete').forEach((button) => button.addEventListener('click', () => deleteBackup(button.dataset.backup)))
  }
  async function openBackupPanel() {
    if (!state.rootHandle) { toast('请先选择工程', 'error'); return }
    els.backupPanel.classList.remove('hidden')
    await renderBackupPanel()
  }
  async function backupNow() {
    if (!state.rootHandle || !state.scan) return
    try {
      setScanProgress(0, 0, true)
      const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups', { create: true })
      const backupDir = await backupRoot.getDirectoryHandle(formatNow(), { create: true })
      const writeFileTo = async (handle, content) => {
        const file = await handle.createWritable()
        await file.write(content)
        await file.close()
      }
      const files = [...new Set(state.watchPaths)] // localization/配置 4 件套 + 全部已扫描资产文件
      let count = 0
      for (const path of files) {
        try { await writeFileTo(await backupDir.getFileHandle(path.replace(/\//g, '__'), { create: true }), await readText(state.rootHandle, path)); count += 1 } catch (error) { console.warn('备份跳过', path, error) }
      }
      setScanProgress(0, 0)
      toast(`已备份 ${count} 个文件到 Lootsmith Backups/${backupDir.name}`, 'success')
      await renderBackupPanel()
    } catch (error) { setScanProgress(0, 0); toast(`备份失败：${error.message}`, 'error'); console.error(error) }
  }
  async function restoreBackup(name) {
    if (!state.rootHandle) return
    try {
      const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups')
      const backupDir = await backupRoot.getDirectoryHandle(name)
      const entries = []
      for await (const [innerName, handle] of backupDir.entries()) {
        if (handle.kind !== 'file') continue
        const file = await handle.getFile()
        entries.push({ name: innerName, text: await file.text() })
      }
      if (!entries.length) { toast('该备份是空目录', 'info'); return }
      // 还原前先快照当前文件（可反悔）
      const preDir = await backupRoot.getDirectoryHandle(`还原前-${formatNow()}`, { create: true })
      const writeFileTo = async (handle, content) => {
        const file = await handle.createWritable()
        await file.write(content)
        await file.close()
      }
      for (const entry of entries) {
        const targetPath = entry.name.replace(/__/g, '/')
        try { await writeFileTo(await preDir.getFileHandle(entry.name, { create: true }), await readText(state.rootHandle, targetPath)) } catch {}
      }
      for (const entry of entries) {
        const targetPath = entry.name.replace(/__/g, '/')
        await writeFileTo(await getHandle(state.rootHandle, targetPath), entry.text)
      }
      toast(`已从 ${name} 还原 ${entries.length} 个文件（还原前状态存于 ${preDir.name}）`, 'success')
      await scanProject(state.rootHandle)
    } catch (error) { toast(`还原失败：${error.message}`, 'error'); console.error(error) }
  }
  async function deleteBackup(name) {
    try {
      const backupRoot = await state.rootHandle.getDirectoryHandle('Lootsmith Backups')
      await backupRoot.removeEntry(name, { recursive: true })
      toast(`已删除备份 ${name}`, 'success')
      await renderBackupPanel()
    } catch (error) { toast(`删除失败：${error.message}`, 'error') }
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
  els.btnBackups.addEventListener('click', openBackupPanel)
  els.btnCloseBackup.addEventListener('click', () => els.backupPanel.classList.add('hidden'))
  els.btnBackupNow.addEventListener('click', backupNow)
  els.btnSaveFills.addEventListener('click', writeLocalizationFills)
  els.chkUnreferenced.addEventListener('change', () => { state.filterReferenced = !els.chkUnreferenced.checked; rescanFromCache() })
  els.langSelect.addEventListener('change', () => { state.langValue = els.langSelect.value; renderList() })
  els.btnFixOrphans.addEventListener('click', () => {
    if (!state.scan) return
    createOrphanEntries(state.scan.orphans.filter((o) => (state.orphanTexts.get(o.refId) || '').trim()).map((o) => ({ refId: o.refId })))
  })
  els.btnCancelImport.addEventListener('click', () => {
    state.importRows = state.importErrors = state.importAdditions = state.importFills = null
    state.importIgnored = []
    state.importTree = null
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
      els.backupPanel.classList.add('hidden')
      state.importRows = state.importErrors = state.importAdditions = state.importFills = null
      state.importIgnored = []
      state.importTree = null
    }
  })

  loadRememberedProject()
}
