'use strict'

const assert = require('node:assert/strict')
require('./app.js')

const core = globalThis.LocalizationLabCore

// 1. 分段：无 ref / 有 ref 混排
assert.deepEqual(core.splitRefSegments('治疗药剂'), { hasRef: false, segments: ['治疗药剂'] })
const mixed = core.splitRefSegments('攻击力 <ref:aaaaaaaaaaaaaaaa> +5')
assert.equal(mixed.hasRef, true)
assert.equal(mixed.segments.length, 2) // ref 前后两个非 ref 段
assert.equal(mixed.segments[0], '攻击力 ')
assert.equal(mixed.segments[1], ' +5')
const onlyRef = core.splitRefSegments('<ref:aaaaaaaaaaaaaaaa>')
assert.equal(onlyRef.hasRef, true)
assert.equal(onlyRef.segments[0], '')
assert.equal(onlyRef.segments[1], '')

// 2. 判定：中文 high / 英文 medium / 排除项 null
assert.deepEqual(core.classifyText('治疗药剂'), { confidence: 'high' })
assert.deepEqual(core.classifyText('攻击力 +5'), { confidence: 'high' }) // 中英数字混合 → 中文优先
assert.deepEqual(core.classifyText('HP'), { confidence: 'medium' })
assert.deepEqual(core.classifyText('0bebc5fffdd070ea'), null) // 16hex GUID
assert.deepEqual(core.classifyText('50'), null) // 数字
assert.deepEqual(core.classifyText('<local:quantity>'), null) // 纯变量标签
assert.deepEqual(core.classifyText('Assets/物品/a.item'), null) // 路径
assert.deepEqual(core.classifyText('A'), null) // 单字符
assert.deepEqual(core.classifyText('  \n '), null) // 空白
assert.deepEqual(core.classifyText('attack', 'tag'), null) // 命令 tag 枚举
assert.deepEqual(core.classifyText('open', 'tag'), null)
assert.deepEqual(core.classifyText('全局鼠标'), { confidence: 'high' }) // 中文 tag 保留
assert.deepEqual(core.classifyText('Attack'), { confidence: 'medium' }) // 非 tag 字段的英文单词保留

// 3. 归一化合并
assert.equal(core.normalizeText('恢复<color:00ff00>50</color>HP'), '恢复50HP')
assert.equal(core.normalizeText(' 冷却时间 <local:_cd> 秒 '), '冷却时间 秒')
const merged = core.mergeCandidates([
  { zhCN: '治疗药剂', file: 'a.item', path: 'attributes[0].value', raw: '治疗药剂', segmentIdx: -1, kind: 'full' },
  { zhCN: '治疗药剂', file: 'b.item', path: 'attributes[0].value', raw: '治疗药剂', segmentIdx: -1, kind: 'full' },
  { zhCN: '攻击力 +5', file: 'a.item', path: 'attributes[1].value', raw: '攻击力 +5', segmentIdx: -1, kind: 'full' },
])
assert.equal(merged.length, 2)
assert.equal(merged[0].locations.length, 2)
assert.equal(merged[1].locations.length, 1)

// 4. 文本型属性 ID 集合 + loopList 排除
const attribute = {
  keys: [
    { class: 'folder', id: 'g1', children: [
      { id: 'a1', key: 'name', type: 'string' },
      { id: 'a2', key: 'attack', type: 'number' },
      { id: 'a3', key: 'loopList', type: 'string' },
    ] },
  ],
}
const stringIds = core.buildStringAttributeIds(attribute)
assert.deepEqual([...stringIds], ['a1', 'a3'])
assert.equal(core.loopListAttributeId(attribute), 'a3')
assert.equal(core.loopListAttributeId({ keys: [] }), '4cb407bd71929620') // 兜底 GUID

// 5. 资产扫描：attributes + 命令树 + 孤儿
const file = {
  attributes: [
    { key: 'a1', value: '治疗药剂' },                       // 文本型属性 → 候选
    { key: 'a2', value: '50' },                             // 数值属性 → 跳过
    { key: 'a3', value: '[{"id":"0123456789abcdef"}]' },   // loopList → 跳过
    { key: 'a1', value: '已本地化<ref:8265489f97b59cd2>' }, // ref 先例 → 段处理
  ],
  events: [{ commands: [{ id: 'cmd', params: { content: '冷却时间 <local:_cd> 秒' } }] }],
  title: '编辑器标题',                                      // 排除 key
  script: 'print(1)',                                       // 代码 → 跳过
}
const ids = new Set(['8265489f97b59cd2'])
const result = core.collectCandidates(file, 'items', stringIds, ids, new Set([core.loopListAttributeId(attribute)]))
assert.equal(result.orphans.length, 0)
const texts = result.candidates.map((c) => c.zhCN)
assert.ok(texts.includes('治疗药剂'))
assert.ok(texts.includes('已本地化'))
assert.ok(texts.includes('冷却时间 <local:_cd> 秒'))
assert.equal(result.candidates.filter((c) => c.kind === 'segment').length, 1)
// 孤儿：ref 指向不存在的 ID
const orphanResult = core.collectCandidates({ events: [{ params: { value: 'x<ref:ffffffffffffffff>' } }] }, 'events', new Set(), new Set(), new Set())
assert.equal(orphanResult.orphans.length, 1)
assert.equal(orphanResult.orphans[0].refId, 'ffffffffffffffff')

// 6. 缺翻译
const missing = core.findMissingTranslations({ list: [
  { id: 'a', name: '确定', contents: { 'zh-CN': '确定', en: 'OK', ja: 'OK' } }, // 三种语言齐 → 不缺
  { id: 'b', name: '获得', contents: { 'zh-CN': '获得', en: '' } },           // 缺 en
  { id: 'c', name: '组', children: [{ id: 'd', name: '子项', contents: { 'zh-CN': '子项' } }] }, // 子项缺 en/ja
] }, ['zh-CN', 'en', 'ja'])
assert.equal(missing.length, 2)
assert.ok(missing.find((m) => m.id === 'b').missingLangs.includes('en'))
assert.ok(missing.find((m) => m.id === 'd').missingLangs.includes('en'))

// 7. 路径导航与段替换
const obj = { attributes: [{ value: '攻击<ref:aaaaaaaaaaaaaaaa>+5' }], events: [{ commands: [{ params: { content: 'x' } }] }] }
assert.equal(core.locateValue(obj, 'attributes[0].value'), '攻击<ref:aaaaaaaaaaaaaaaa>+5')
assert.equal(core.locateValue(obj, 'events[0].commands[0].params.content'), 'x')
assert.equal(core.replaceSegment('攻击<ref:aaaaaaaaaaaaaaaa>+5', 0, '<ref:bbbbbbbbbbbbbbbb>'), '<ref:bbbbbbbbbbbbbbbb><ref:aaaaaaaaaaaaaaaa>+5')
// full 替换
const target = cloneFile()
const plan = core.applyAssetReplacement(target, { id: 'cccccccccccccccc', zhCN: '治疗药剂', locations: [{ file: 'f', path: 'attributes[0].value', kind: 'full', segmentIdx: -1 }] })
assert.equal(plan.ok, true)
assert.equal(core.locateValue(target, 'attributes[0].value'), '<ref:cccccccccccccccc>')
// 外部改动 → 中止
const changed = { attributes: [{ value: '改名药剂' }] }
assert.equal(core.applyAssetReplacement(changed, { id: 'cccccccccccccccc', zhCN: '治疗药剂', locations: [{ file: 'f', path: 'attributes[0].value', kind: 'full', segmentIdx: -1 }] }).ok, false)
function cloneFile() { return JSON.parse(JSON.stringify({ attributes: [{ value: '治疗药剂' }] })) }

// 8. localization 写入（新增 + 补译 + 幂等）
const loc = { list: [{ id: 'a', name: '确定', contents: { 'zh-CN': '确定', en: '' } }] }
core.localizationInsertion(loc,
  [{ id: '1111111111111111', zhCN: '治疗药剂', langs: { en: 'Potion' } }],
  [{ id: 'a', langs: { en: 'OK' } }],
  ['zh-CN', 'en'])
assert.equal(loc.list.length, 2) // 快速本地化文件夹
assert.equal(loc.list[0].contents.en, 'OK')
const folder = loc.list[1]
assert.equal(folder.name, '快速本地化')
assert.equal(folder.children[0].id, '1111111111111111')
assert.equal(folder.children[0].contents['zh-CN'], '治疗药剂')
assert.equal(folder.children[0].contents.en, 'Potion')
// 幂等：同 ID 再次插入不重复
core.localizationInsertion(loc, [{ id: '1111111111111111', zhCN: '治疗药剂', langs: {} }], [], ['zh-CN', 'en'])
assert.equal(folder.children.length, 1)

// 9. 导入校验
const existing = new Map([['aaaaaaaaaaaaaaaa', { zhCN: '确定' }]])
const { errors, additions, fills } = core.validateImportRows([
  { sheet: 'add', row: 2, id: 'bbbbbbbbbbbbbbbb', zhCN: '治疗药剂', langs: { en: 'Potion' } },
  { sheet: 'add', row: 3, id: 'aaaaaaaaaaaaaaaa', zhCN: '确定', langs: {} },      // 幂等跳过（同原文）
  { sheet: 'add', row: 4, id: 'aaaaaaaaaaaaaaaa', zhCN: '不同原文', langs: {} },  // 冲突
  { sheet: 'add', row: 5, id: 'nothex', zhCN: 'x', langs: {} },                   // 坏 ID
  { sheet: 'fill', row: 6, id: 'aaaaaaaaaaaaaaaa', langs: { en: 'OK' } },
  { sheet: 'fill', row: 7, id: 'cccccccccccccccc', langs: { en: 'X' } },          // 不存在
], existing, ['zh-CN', 'en'])
assert.equal(errors.length, 3) // 冲突 + 坏 ID + fill 不存在
assert.equal(additions.length, 1)
assert.equal(fills.length, 1)

// 10. 随机 ID 格式
assert.equal(/^[0-9a-f]{16}$/.test(core.randomHex16()), true)

// 11. 序列化仿生：CRLF + 无尾随换行（Yami 原生格式），LF + 尾随换行也保留
assert.equal(core.serializeLike({ a: [1, 2] }, '{\r\n  "a": [\r\n    1,\r\n    2\r\n  ]\r\n}'), '{\r\n  "a": [\r\n    1,\r\n    2\r\n  ]\r\n}')
assert.equal(core.serializeLike({ a: 1 }, '{\n  "a": 1\n}'), '{\n  "a": 1\n}')
assert.equal(core.serializeLike({ a: 1 }, '{\r\n  "a": 1\r\n}\r\n'), '{\r\n  "a": 1\r\n}\r\n')

console.log('localization lab self-check passed')
