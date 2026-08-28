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
// 2026-08-13 噪声过滤：颜色 hex / 剥标签 / value 位置引擎枚举
assert.deepEqual(core.classifyText('ff3810ff'), null) // 8hex 颜色码
assert.deepEqual(core.classifyText('ffff80ff'), null)
assert.deepEqual(core.classifyText('#ff3810'), null) // 6hex 颜色码
assert.deepEqual(core.classifyText('<color:14>"'), null) // 剥标签后无文本
assert.deepEqual(core.classifyText('<color:red>攻击</color>'), { confidence: 'high' }) // 标签内中文
assert.deepEqual(core.classifyText(' +<local:num>'), null) // 剥变量标签后只剩符号
assert.deepEqual(core.classifyText('skill', 'value'), null) // value 位置单 token 引擎枚举
assert.deepEqual(core.classifyText('inventory', 'value'), null)
assert.deepEqual(core.classifyText('skill shop', 'value'), { confidence: 'medium' }) // 多词英文保留
assert.deepEqual(core.classifyText('skill', 'attr'), { confidence: 'medium' }) // 属性值不受枚举排除影响
// 2b. v0.2.1 噪声过滤：全部引擎标签剥离 + 无中文残留必须含 ≥2 字母单词（完工工程实测：注释/]x2/X10/裸标签是主要误报源）
assert.deepEqual(core.classifyText('<italic>'), null) // 裸标签残留
assert.deepEqual(core.classifyText('<bold>攻击</bold>'), { confidence: 'high' }) // 标签内中文照常
assert.deepEqual(core.classifyText('</size>'), null)
assert.deepEqual(core.classifyText(']x2'), null) // ref 后缀段（[<ref:ID>]x2 的残留）
assert.deepEqual(core.classifyText('X10'), null) // 单字母+数字占位
assert.deepEqual(core.classifyText('x2'), null)
assert.deepEqual(core.classifyText('5x'), null)
assert.deepEqual(core.classifyText('HP'), { confidence: 'medium' }) // 2 字母单词保留
assert.deepEqual(core.classifyText('Del'), { confidence: 'medium' })
assert.deepEqual(core.classifyText('Attack'), { confidence: 'medium' })

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

// 5. 资产扫描：attributes + 命令树候选（孤儿引用改由 collectOrphanRefs 全树扫描）
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
const attrCands = core.collectAttributeCandidates(file, 'items', stringIds, new Set([core.loopListAttributeId(attribute)]))
const attrTexts = attrCands.map((c) => c.zhCN)
assert.ok(attrTexts.includes('治疗药剂'))
assert.ok(attrTexts.includes('已本地化'))
assert.equal(attrCands.filter((c) => c.kind === 'segment').length, 1)
const cands = core.collectCandidates(file, 'items') // 命令树只走显示路径，属性另走 collectAttributeCandidates
const texts = cands.map((c) => c.zhCN)
assert.ok(texts.includes('冷却时间 <local:_cd> 秒'))
assert.ok(!texts.includes('治疗药剂'))
// 5c. 命令树位置规则（v0.2.1，完工工程 692→285 的噪声来源）：comment 永不扫；conditions 比较跳过；value 只留 operand.value（显示模板）与 properties[n].value（setText 文本）
const cmdFile = {
  events: [{ commands: [
    { id: 'a', params: { content: '显示文本' } },                               // content → 候选
    { id: 'b', params: { comment: '开发者注释' } },                              // comment → 跳过
    { id: 'c', params: { branches: [{ conditions: [{ value: '物资' }] }] } },    // 条件比较 → 跳过
    { id: 'd', params: { value: '树' } },                                        // 普通 params.value → 跳过
    { id: 'e', params: { operand: { value: '物资' } } },                         // operand 短标识 → 跳过
    { id: 'f', params: { operand: { value: '冷却时间 <local:_cd> 秒' } } },      // operand 显示模板 → 候选
    { id: 'g', params: { properties: [{ value: '价格 <local:_p>' }] } },         // properties 文本 → 候选
  ] }],
}
const cmdCands = core.collectCandidates(cmdFile, 'events', new Set(), new Set())
const cmdTexts = cmdCands.map((c) => c.zhCN)
assert.ok(cmdTexts.includes('显示文本'))
assert.ok(cmdTexts.includes('冷却时间 <local:_cd> 秒'))
assert.ok(cmdTexts.includes('价格 <local:_p>'))
assert.ok(!cmdTexts.includes('开发者注释'))
assert.ok(!cmdTexts.includes('物资'))
assert.ok(!cmdTexts.includes('树'))

// 孤儿：全树扫描，白名单外属性也能发现（备注属性不在 stringAttrIds 里）
const occs = core.collectOrphanRefs({ attributes: [{ key: 'a2', value: 'x<ref:ffffffffffffffff>' }] })
assert.equal(occs.length, 1)
assert.equal(occs[0].refId, 'ffffffffffffffff')
assert.equal(occs[0].attrKey, 'a2')

// 5b. 孤儿分组 + 建议文本：名称属性 ← 文件名；多 ref 只推第一个；备注/后缀不推导
const attrNames = { keys: [
  { id: 'da4d32a4f1097059', key: 'name', name: '名称', type: 'string' },
  { id: '2c96add3b90ff60d', key: 'notes', name: '备注', type: 'string' },
] }
const actorLike = {
  attributes: [
    { key: 'da4d32a4f1097059', value: '<ref:aaaaaaaaaaaaaaaa><ref:bbbbbbbbbbbbbbbb>' },
    { key: '2c96add3b90ff60d', value: '<ref:cccccccccccccccc>' },
  ],
}
const scan2 = core.buildScanResult([
  { file: 'Assets/角色/怪物/004.精英哥布林 -远程.bd5b908e27003ba4.actor', type: 'actors', data: actorLike },
], { attributeJson: attrNames, localizationJson: { list: [] }, languages: ['zh-CN', 'en'] })
assert.equal(scan2.orphans.length, 3)
const orphanA = scan2.orphans.find((o) => o.refId === 'aaaaaaaaaaaaaaaa')
assert.equal(orphanA.suggestion, '精英哥布林') // 剥序号 + 多 ref 首段剥「 -远程」后缀
assert.equal(orphanA.uses[0].attrName, '名称')
const orphanB = scan2.orphans.find((o) => o.refId === 'bbbbbbbbbbbbbbbb')
assert.equal(orphanB.suggestion, '') // 后缀 ref 留给人工
const orphanC = scan2.orphans.find((o) => o.refId === 'cccccccccccccccc')
assert.equal(orphanC.suggestion, '') // 备注属性不推导
assert.equal(scan2.candidates.length, 0) // 纯 ref 属性值不产生候选
// .ui 节点编辑器标签作建议
const scan3 = core.buildScanResult([
  { file: 'Assets/UI/设置/设置界面.a.ui', type: 'ui', data: { nodes: [{ name: '左右', content: '<ref:dddddddddddddddd>' }] } },
], { attributeJson: { keys: [] }, localizationJson: { list: [] }, languages: ['zh-CN', 'en'] })
const orphanD = scan3.orphans.find((o) => o.refId === 'dddddddddddddddd')
assert.equal(orphanD.suggestion, '左右')
// 同 ID 多文件：分组 + 最短文件名核心胜出（068.大恶魔 / 069.大恶魔-远程 → 大恶魔）
const scan4 = core.buildScanResult([
  { file: 'Assets/角色/怪物/068.大恶魔.d3c3389a3425636a.actor', type: 'actors', data: { attributes: [{ key: 'da4d32a4f1097059', value: '<ref:eeeeeeeeeeeeeeee>' }] } },
  { file: 'Assets/角色/怪物/069.大恶魔-远程.d5c756a3bc81fced.actor', type: 'actors', data: { attributes: [{ key: 'da4d32a4f1097059', value: '<ref:eeeeeeeeeeeeeeee>' }] } },
], { attributeJson: attrNames, localizationJson: { list: [] }, languages: ['zh-CN', 'en'] })
assert.equal(scan4.orphans.length, 1)
assert.equal(scan4.orphans[0].suggestion, '大恶魔')
assert.equal(scan4.orphans[0].fileCount, 2)
assert.equal(scan4.orphans[0].count, 2)

// 6. 缺翻译
const missing = core.findMissingTranslations({ list: [
  { id: 'a', name: '确定', contents: { 'zh-CN': '确定', en: 'OK', ja: 'OK' } }, // 三种语言齐 → 不缺
  { id: 'b', name: '获得', contents: { 'zh-CN': '获得', en: '' } },           // 缺 en
  { id: 'c', name: '组', children: [{ id: 'd', name: '子项', contents: { 'zh-CN': '子项' } }] }, // 子项缺 en/ja
] }, ['zh-CN', 'en', 'ja'])
assert.equal(missing.length, 2)
assert.ok(missing.find((m) => m.id === 'b').missingLangs.includes('en'))
assert.ok(missing.find((m) => m.id === 'd').missingLangs.includes('en'))

// 6b. 疑似占位符（v0.2.1 用户拍板：只判脏词）——「与原文相同」是开发者有意状态（完工工程 zh-TW/ja 与 zh-CN 相同 200+ 条），不再当占位；空译文归「缺翻译」
const suspicious = core.findSuspiciousTranslations({ list: [
  { id: 's1', name: '村里最好的剑', contents: { 'zh-CN': '村里最好的剑', en: 'shit' } },
  { id: 's2', name: '确认', contents: { 'zh-CN': '确认删除', en: '确认删除' } }, // 与原文相同 → 不判占位
  { id: 's3', name: '版本', contents: { 'zh-CN': 'v1.1.43', en: 'v1.1.43' } },
  { id: 's4', name: 'ok', contents: { 'zh-CN': '确定', en: 'OK' } },
  { id: 's5', name: '未填', contents: { 'zh-CN': '未填', en: '' } },              // 空译文 → 归缺翻译，不判占位
  { id: 's6', name: '待办', contents: { 'zh-CN': '待办', en: '待翻译' } },
] }, ['zh-CN', 'en'])
assert.equal(suspicious.length, 2)
assert.ok(suspicious.find((m) => m.id === 's1').suspicious[0].reason === '占位词')
assert.ok(suspicious.find((m) => m.id === 's6').suspicious[0].reason === '占位词')
// zh-TW 与原文相同不再判定
const suspTW = core.findSuspiciousTranslations({ list: [
  { id: 't1', contents: { 'zh-CN': '游戏设置', 'zh-TW': '游戏设置' } },
  { id: 't2', contents: { 'zh-CN': '梅林', 'zh-TW': '梅林' } },
] }, ['zh-CN', 'zh-TW'])
assert.equal(suspTW.length, 0)

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
// 原文被编辑过：按 originalZhCN（扫描原文）校验替换，条目写编辑后的文本
const editedTarget = cloneFile()
assert.equal(core.applyAssetReplacement(editedTarget, { id: 'dddddddddddddddd', zhCN: '治疗药水', originalZhCN: '治疗药剂', locations: [{ file: 'f', path: 'attributes[0].value', kind: 'full', segmentIdx: -1 }] }).ok, true)
assert.equal(core.locateValue(editedTarget, 'attributes[0].value'), '<ref:dddddddddddddddd>')
function cloneFile() { return JSON.parse(JSON.stringify({ attributes: [{ value: '治疗药剂' }] })) }

// 8. localization 写入：按来源类型分子文件夹（物品/孤儿修复）+ 补译 + 幂等 + 子文件夹复用
const loc = { list: [{ id: 'a', name: '确定', contents: { 'zh-CN': '确定', en: '' } }] }
core.localizationInsertion(loc,
  [{ id: '1111111111111111', zhCN: '治疗药剂', langs: { en: 'Potion' }, folder: '物品' },
   { id: '2222222222222222', zhCN: '兽人', langs: {}, folder: '孤儿修复' }],
  [{ id: 'a', langs: { en: 'OK' } }],
  ['zh-CN', 'en'])
assert.equal(loc.list.length, 2) // 快速本地化文件夹
assert.equal(loc.list[0].contents.en, 'OK')
const folder = loc.list[1]
assert.equal(folder.name, '快速本地化')
assert.equal(folder.children.length, 2) // 物品 + 孤儿修复 两个子文件夹
const itemFolder = folder.children.find((f) => f.name === '物品')
assert.equal(itemFolder.children[0].id, '1111111111111111')
assert.equal(itemFolder.children[0].contents['zh-CN'], '治疗药剂')
assert.equal(itemFolder.children[0].contents.en, 'Potion')
const orphanFolder = folder.children.find((f) => f.name === '孤儿修复')
assert.equal(orphanFolder.children[0].id, '2222222222222222')
// 幂等：同 ID 再次插入不重复
core.localizationInsertion(loc, [{ id: '1111111111111111', zhCN: '治疗药剂', langs: {}, folder: '物品' }], [], ['zh-CN', 'en'])
assert.equal(itemFolder.children.length, 1)
// 同类型子文件夹复用
core.localizationInsertion(loc, [{ id: '3333333333333333', zhCN: '长剑', langs: {}, folder: '物品' }], [], ['zh-CN', 'en'])
assert.equal(itemFolder.children.length, 2)
assert.equal(folder.children.length, 2)

// 9. 导入校验：错误 / 新增 / 补译 / 忽略（处理方式=忽略、孤儿空建议、幂等已存在）
const existing = new Map([['aaaaaaaaaaaaaaaa', { zhCN: '确定' }]])
const validated = core.validateImportRows([
  { sheet: 'add', row: 2, id: 'bbbbbbbbbbbbbbbb', zhCN: '治疗药剂', langs: { en: 'Potion' } },
  { sheet: 'add', row: 3, id: 'aaaaaaaaaaaaaaaa', zhCN: '确定', langs: {} },      // 幂等 → ignored
  { sheet: 'add', row: 4, id: 'aaaaaaaaaaaaaaaa', zhCN: '不同原文', langs: {} },  // 冲突
  { sheet: 'add', row: 5, id: 'nothex', zhCN: 'x', langs: {} },                   // 坏 ID
  { sheet: 'fill', row: 6, id: 'aaaaaaaaaaaaaaaa', langs: { en: 'OK' } },
  { sheet: 'fill', row: 7, id: 'cccccccccccccccc', langs: { en: 'X' } },          // 不存在
  { sheet: 'add', row: 8, id: 'dddddddddddddddd', zhCN: '忽略我', langs: {}, handle: '忽略' }, // 忽略
  { sheet: 'orphan', row: 9, id: 'eeeeeeeeeeeeeeee', zhCN: '兽人', langs: {} },   // 孤儿修复新增
  { sheet: 'orphan', row: 10, id: 'ffffffffffffffff', zhCN: '', langs: {} },      // 空建议 → ignored
  { sheet: 'orphan', row: 11, id: 'aaaaaaaaaaaaaaaa', zhCN: '确定', langs: {} },  // 已存在 → ignored
], existing, ['zh-CN', 'en'])
assert.equal(validated.errors.length, 3) // 冲突 + 坏 ID + fill 不存在
assert.equal(validated.additions.length, 2) // bbbb + eeee
const orphanAdd = validated.additions.find((r) => r.id === 'eeeeeeeeeeeeeeee')
assert.equal(orphanAdd.folder, '孤儿修复')
assert.equal(validated.fills.length, 1)
assert.equal(validated.ignored.length, 4) // 幂等 + 忽略 + 空建议 + 已存在
assert.ok(validated.ignored.some((r) => r.reason.includes('处理方式=忽略')))

// 10. 随机 ID 格式
assert.equal(/^[0-9a-f]{16}$/.test(core.randomHex16()), true)

// 11. 序列化仿生：CRLF + 无尾随换行（Yami 原生格式），LF + 尾随换行也保留
assert.equal(core.serializeLike({ a: [1, 2] }, '{\r\n  "a": [\r\n    1,\r\n    2\r\n  ]\r\n}'), '{\r\n  "a": [\r\n    1,\r\n    2\r\n  ]\r\n}')
assert.equal(core.serializeLike({ a: 1 }, '{\n  "a": 1\n}'), '{\n  "a": 1\n}')
assert.equal(core.serializeLike({ a: 1 }, '{\r\n  "a": 1\r\n}\r\n'), '{\r\n  "a": 1\r\n}\r\n')

// 12. 引用判定（复刻引擎打包算法 createReferencedFileIDMap + 预设元素映射）
assert.equal(core.assetGuid('Assets/角色/怪物/010.兽人.c65e716280b38eef.actor'), 'c65e716280b38eef')
assert.equal(core.assetGuid('plain.txt'), null)
const refs = {
  data: [
    { guid: 'aaaaaaaaaaaaaaaa', type: 'ui', data: { nodes: [{ presetId: 'bbbbbbbbbbbbbbbb', content: 'x', children: [] }] } },
    { guid: 'cccccccccccccccc', type: 'items', data: { attributes: [{ key: 'a', value: '无人引用' }] } },
    { guid: 'eeeeeeeeeeeeeeee', type: 'events', data: { type: 'startup', commands: [{ id: 'createElement', params: { presetId: 'bbbbbbbbbbbbbbbb' } }] } },
    { guid: 'ffffffffffffffff', type: 'events', data: { type: 'common', commands: [] } },
  ],
  scripts: [{ guid: '1111111111111111', code: "UI.load('2222222222222222')" }],
  plugins: {}, commands: {}, config: { x: '3333333333333333' },
}
const usedIds = core.referencedFileIds(refs)
assert.ok(usedIds.has('bbbbbbbbbbbbbbbb')) // 事件引用了预设元素
assert.ok(usedIds.has('aaaaaaaaaaaaaaaa')) // 预设元素反查到所在 ui 文件
assert.ok(usedIds.has('eeeeeeeeeeeeeeee')) // 自动触发事件自身
assert.ok(!usedIds.has('ffffffffffffffff')) // common 事件不自动标记
assert.ok(usedIds.has('1111111111111111')) // 脚本 meta 自标记
assert.ok(usedIds.has('2222222222222222')) // 脚本代码单引号 GUID
assert.ok(usedIds.has('3333333333333333')) // config 里的纯 GUID
assert.ok(!usedIds.has('cccccccccccccccc')) // 无引用的 item 不在集合

// 13. 已引用本地化条目：资产 <ref:> 引用 + 嵌套闭包
const usedRefs = core.referencedLocalizationIds(
  [{ data: { x: '<ref:aaaaaaaaaaaaaaaa>' } }],
  { list: [
    { id: 'aaaaaaaaaaaaaaaa', contents: { 'zh-CN': '外层<ref:bbbbbbbbbbbbbbbb>' } },
    { id: 'bbbbbbbbbbbbbbbb', contents: { 'zh-CN': '内层' } },
    { id: 'cccccccccccccccc', contents: { 'zh-CN': '未引用' } },
  ] },
)
assert.ok(usedRefs.has('aaaaaaaaaaaaaaaa'))
assert.ok(usedRefs.has('bbbbbbbbbbbbbbbb')) // 嵌套引用也算
assert.ok(!usedRefs.has('cccccccccccccccc'))

// 14. buildScanResult 引用过滤：只扫被引用资产；候选=界面显示路径、attributeCandidates=数据属性、缺翻译/疑似占位只留被引用条目
const scanA = core.buildScanResult(
  [
    { file: 'Assets/A.aaaaaaaaaaaaaaaa.item', type: 'items', data: { attributes: [{ key: 'k', value: '治疗药剂' }] } },
    { file: 'Assets/B.bbbbbbbbbbbbbbbb.item', type: 'items', data: { attributes: [{ key: 'k', value: '闲置文本' }] } },
  ],
  { attributeJson: { keys: [{ id: 'k', key: 'name', type: 'string' }] }, localizationJson: { list: [] }, languages: ['zh-CN', 'en'],
    references: { data: [{ guid: 'cccccccccccccccc', type: 'events', data: { type: 'startup', commands: [{ id: 'x', params: { item: 'aaaaaaaaaaaaaaaa' } }] } }], scripts: [], plugins: {}, commands: {}, config: {} } },
)
assert.equal(scanA.referenced, true)
assert.equal(scanA.candidates.length, 0) // 属性文本不进界面候选
assert.equal(scanA.attributeCandidates.length, 1) // 只有被引用的 A 的数据属性
assert.equal(scanA.unreferenced.total, 1)
assert.equal(scanA.unreferenced.byType.items, 1)
const scanB = core.buildScanResult(
  [{ file: 'Assets/A.aaaaaaaaaaaaaaaa.item', type: 'items', data: { attributes: [{ key: 'k', value: '治疗药剂' }] } }, { file: 'Assets/B.bbbbbbbbbbbbbbbb.item', type: 'items', data: { attributes: [{ key: 'k', value: '闲置文本' }] } }],
  { attributeJson: { keys: [{ id: 'k', key: 'name', type: 'string' }] }, localizationJson: { list: [] }, languages: ['zh-CN', 'en'], includeUnreferenced: true,
    references: { data: [{ guid: 'cccccccccccccccc', type: 'events', data: { type: 'startup', commands: [{ id: 'x', params: { item: 'aaaaaaaaaaaaaaaa' } }] } }], scripts: [], plugins: {}, commands: {}, config: {} } },
)
assert.equal(scanB.attributeCandidates.length, 2) // 含未引用 → 全部扫
const scanC = core.buildScanResult(
  [{ file: 'Assets/A.aaaaaaaaaaaaaaaa.item', type: 'items', data: { attributes: [{ key: 'k', value: '<ref:dddddddddddddddd>' }] } }],
  { attributeJson: { keys: [] }, languages: ['zh-CN', 'en'],
    localizationJson: { list: [
      { id: 'dddddddddddddddd', name: 'a', contents: { 'zh-CN': 'a', en: '' } },
      { id: 'eeeeeeeeeeeeeeee', name: 'b', contents: { 'zh-CN': 'b', en: 'shit' } },
    ] },
    references: { data: [{ guid: 'ffffffffffffffff', type: 'events', data: { type: 'startup', commands: [{ id: 'x', params: { item: 'aaaaaaaaaaaaaaaa' } }] } }], scripts: [], plugins: {}, commands: {}, config: {} },
  },
)
assert.equal(scanC.missing.length, 1) // dddd 被引用保留
assert.equal(scanC.suspicious.length, 0) // eeee 未被引用 → 疑似占位被过滤
assert.equal(scanC.unreferencedMissing, 0)
assert.equal(scanC.unreferencedSuspicious, 1)
// 15. 已本地化列表：按引用位置分档——界面显示路径 / 数据属性（数据 tab）
assert.equal(scanC.localized.length, 0) // dddd 只被属性引用 → 不在界面已本地化
assert.equal(scanC.attributeLocalized.length, 1) // dddd 在数据属性 tab
assert.equal(scanC.attributeLocalized[0].zh, 'a')
assert.ok(scanC.attributeLocalized[0].locations.length >= 1)
assert.equal(scanC.attributeLocalized[0].langs.en, '')
// 界面显示路径（.ui 文本节点 content）引用 → 界面已本地化
const scanD = core.buildScanResult(
  [{ file: 'Assets/UI/标题.aaaaaaaaaaaaaaa1.ui', type: 'ui', data: { nodes: [{ class: 'text', presetId: 'abc', content: '<ref:dddddddddddddddd>' }] } }],
  { attributeJson: { keys: [] }, languages: ['zh-CN', 'en'], includeUnreferenced: true,
    localizationJson: { list: [{ id: 'dddddddddddddddd', name: 'a', contents: { 'zh-CN': 'a', en: '' } }] },
    references: { data: [], scripts: [], plugins: {}, commands: {}, config: {} } },
)
assert.equal(scanD.localized.length, 1)
assert.equal(scanD.attributeLocalized.length, 0)
// 15b. setText 覆盖的占位节点：编辑器内容运行时被写入值替换——不进候选，其 ref 也不计入界面已本地化
const scanE = core.buildScanResult(
  [
    { file: 'Assets/UI/界面.bbbbbbbbbbbbbba1.ui', type: 'ui', data: { nodes: [
      { class: 'text', presetId: 'p1', content: '占位模板文本' },
      { class: 'text', presetId: 'p2', content: '真实界面文本' },
    ] } },
    { file: 'Assets/! 事件/事件.ccccccccccccccca1.event', type: 'events', data: { type: 'startup', commands: [
      { id: 'setText', params: { element: { type: 'by-id', presetId: 'p1' }, properties: [{ key: 'content', value: '<local:name>' }] } },
    ] } },
  ],
  { attributeJson: { keys: [] }, languages: ['zh-CN', 'en'], localizationJson: { list: [] }, includeUnreferenced: true,
    references: { data: [], scripts: [], plugins: {}, commands: {}, config: {} } },
)
assert.equal(scanE.candidates.length, 1) // 占位模板文本被排除
assert.equal(scanE.candidates[0].zhCN, '真实界面文本')
assert.equal(core.collectSetTextTargets({ commands: [{ id: 'setText', params: { element: { type: 'by-id', presetId: 'abc' } } }] }).has('abc'), true)

// 16. 引擎格式 Excel（open-yami）：与编辑器 to-excel/from-excel 同算法（main.js:112-254）
const oyTree = { list: [
  { id: 'aaaaaaaaaaaaaaaa', name: '确定', contents: { 'zh-CN': '确定', en: 'OK' } },
  { class: 'folder', name: '技能', expanded: false, children: [
    { id: 'bbbbbbbbbbbbbbbb', name: '', contents: { 'zh-CN': '攻击', en: 'Attack' } },
  ] },
  { class: 'folder', name: 'UI', expanded: false, children: [
    { class: 'folder', name: '主菜单', expanded: false, children: [
      { id: 'cccccccccccccccc', name: '继续', contents: { 'zh-CN': '继续', en: '' } },
    ] },
  ] },
] }
const oyRows = core.openYamiRows(oyTree, ['zh-CN', 'en'])
assert.equal(oyRows.length, 6) // 3 叶子 + 3 文件夹
const oyLeaves = oyRows.filter((r) => !(r.isDir === 1))
const oyDirs = oyRows.filter((r) => r.isDir === 1)
assert.equal(oyLeaves.length, 3)
assert.equal(oyDirs.length, 3)
for (const r of oyDirs) assert.equal(/^[0-9a-f]{16}$/.test(r.id), true) // 文件夹 ID 每次导出重新生成（引擎 generate64bit）
const oyA = oyRows.find((r) => r.id === 'aaaaaaaaaaaaaaaa')
assert.equal(oyA.contents['zh-CN'], '确定')
assert.equal(oyA.contents.en, 'OK')
assert.equal(oyA.parentID, '') // 根叶子无父
const oyB = oyRows.find((r) => r.id === 'bbbbbbbbbbbbbbbb')
assert.equal(oyDirs.find((r) => r.id === oyB.parentID).name, '技能') // 子行 parentID 指向文件夹行
assert.ok(oyRows.indexOf(oyB) < oyRows.findIndex((r) => r.id === oyB.parentID)) // 子行在文件夹行之前（引擎导出顺序）
// 导入还原：叶子 ID/内容保留，文件夹结构/名称保留（文件夹 ID 不持久）
const oyRestored = core.localizationFromOpenYami(oyRows)
const restoredIds = []
;(function walk(items) { for (const item of items) { if (item.children) walk(item.children); else restoredIds.push(item.id) } })(oyRestored)
assert.deepEqual(restoredIds.sort(), ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc'])
const restoredFolders = []
;(function walk(items) { for (const item of items) { if (item.children) { restoredFolders.push(item.name); walk(item.children) } } })(oyRestored)
assert.deepEqual(restoredFolders.sort(), ['UI', '主菜单', '技能']) // 默认按 UTF-16 码点排序
const oyRestoredUI = oyRestored.find((r) => r.children && r.name === 'UI')
const oyRestoredC = oyRestoredUI.children.find((r) => r.children).children[0]
assert.equal(oyRestoredC.contents['zh-CN'], '继续')
assert.equal(oyRestoredC.contents.en, '')
const oyDiff = core.diffLocalizationTrees(oyTree.list, oyRestored)
assert.equal(oyDiff.added.length, 0)
assert.equal(oyDiff.removed.length, 0)
assert.equal(oyDiff.updated.length, 0)
assert.equal(oyDiff.foldersBefore, 3)
assert.equal(oyDiff.foldersAfter, 3)
// 未知 parentID 且文件夹行永不出现 → 引擎同样丢弃（占位仅存 dataMap，不进根节点）
assert.deepEqual(core.localizationFromOpenYami([{ id: 'dddddddddddddddd', name: 'x', parentID: 'eeeeeeeeeeeeeeee', isDir: 0, contents: { 'zh-CN': 'x' } }]), [])
// 文件夹行后到（引擎导出顺序：子行在前）→ 占位并入真实文件夹，结构正确
const lateRows = [
  { id: 'ffffffffffffffff', name: '子', parentID: 'eeeeeeeeeeeeeeee', isDir: 0, contents: { 'zh-CN': '子' } },
  { id: 'eeeeeeeeeeeeeeee', name: '父', parentID: '', isDir: 1 },
]
const lateTree = core.localizationFromOpenYami(lateRows)
assert.equal(lateTree.length, 1)
assert.equal(lateTree[0].name, '父')
assert.equal(lateTree[0].children[0].id, 'ffffffffffffffff')
// 差异统计：内容更新/新增/移除按叶子 ID 判定
const oyDiff2 = core.diffLocalizationTrees(oyTree.list, [
  { id: 'aaaaaaaaaaaaaaaa', name: '确定', contents: { 'zh-CN': '确定', en: 'Okay' } },
  { id: 'ffffffffffffffff', name: '新增', contents: { 'zh-CN': '新增' } },
])
assert.deepEqual(oyDiff2.added, ['ffffffffffffffff'])
assert.deepEqual(oyDiff2.updated, ['aaaaaaaaaaaaaaaa'])
assert.equal(oyDiff2.removed.length, 2)
assert.equal(oyDiff2.foldersAfter, 0)

// 17. 导入候选查找必须覆盖数据属性候选（回归：数据属性 sheet 被误判孤儿 → 资产不替换、条目照建）
//     fixtures: 界面候选在 candidates、数据属性候选在 attributeCandidates，两者共用同一 ID 空间
const fakeScan = {
  candidates: [{ id: '111111111111111a', zhCN: '界面文本', sourceType: 'ui', locations: [{ file: 'A.ui', path: [], kind: 'full' }] }],
  attributeCandidates: [{ id: '222222222222222b', zhCN: '物品名称', sourceType: 'item', locations: [{ file: 'B.item', path: [], kind: 'full' }] }],
}
assert.equal(core.findCandidateById(fakeScan, '111111111111111a').sourceType, 'ui')
assert.equal(core.findCandidateById(fakeScan, '222222222222222b').sourceType, 'item') // 之前只查 candidates 会得到 undefined
assert.equal(core.findCandidateById(fakeScan, '333333333333333c'), undefined)
const fakeAdditions = [
  { id: '111111111111111a', zhCN: '界面文本', handle: '' },
  { id: '222222222222222b', zhCN: '物品名称', handle: '' }, // 数据属性行：必须产生替换分组，而不是孤儿
  { id: '333333333333333c', zhCN: '孤儿建议', handle: '' }, // 孤儿修复行
]
const classified = core.classifyImportAdditions(fakeScan, fakeAdditions)
assert.equal(classified.groups.length, 2)
assert.deepEqual(classified.groups.map((g) => g.file).sort(), ['A.ui', 'B.item'])
assert.equal(classified.orphanAdds.length, 1)
assert.equal(classified.orphanAdds[0].id, '333333333333333c')

// 18. 跨域同 ID：同 normalized 文本同时出现在界面候选与数据属性候选（共用同一 ID）时，
//     两个域的资产文件都必须替换成 <ref:ID>——findCandidatesById 合并两域 locations。
const sharedScan = {
  candidates: [{ id: '111111111111111a', zhCN: '黄金巨人骷髅', sourceType: 'ui', locations: [{ file: 'X.ui', path: [], kind: 'full' }] }],
  attributeCandidates: [{ id: '111111111111111a', zhCN: '黄金巨人骷髅', sourceType: 'actor', locations: [{ file: 'Y.actor', path: [], kind: 'full' }] }],
}
assert.equal(core.findCandidatesById(sharedScan, '111111111111111a').length, 2)
assert.equal(core.findCandidateById(sharedScan, '111111111111111a').sourceType, 'ui')
const sharedClassified = core.classifyImportAdditions(sharedScan, [{ id: '111111111111111a', zhCN: '黄金巨人骷髅', handle: '' }])
assert.deepEqual(sharedClassified.groups.map((g) => g.file).sort(), ['X.ui', 'Y.actor'])
assert.equal(sharedClassified.orphanAdds.length, 0)

console.log('localization lab self-check passed')