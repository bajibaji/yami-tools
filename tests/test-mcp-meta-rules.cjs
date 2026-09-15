'use strict'
/**
 * MCP 元数据规则对齐引擎（零依赖）
 *
 * 判定口径全部来自 Open Yami 引擎源码（只读参考）：
 *   Project/Script/plugin/plugin.ts                     —— parseMeta 的 processors 表与各 setter 的类型守卫
 *   Project/Script/components/type-registry.ts          —— 参数类型的权威注册表（38 项，含 repeatable-group）
 *   Project/Script/file/file-system-core.ts             —— GUID 命名规则与 File.parseGUID
 *   Project/Script/file/guid.ts                         —— 生成 GUID 必须含字母 a-f
 *
 * 用法: node tests/test-mcp-meta-rules.cjs
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SERVER = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')

let passed = 0
let failed = 0
function check(name, condition, detail) {
  const extra = detail === undefined ? '' : '  [' + detail + ']'
  if (condition) { passed++; console.log('  PASS  ' + name + extra) }
  else { failed++; console.error('  FAIL  ' + name + extra) }
}

const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-meta-rules-'))
const SCRIPT_DIR = path.join(PROJECT, 'Assets', '插件', '自定义指令')
fs.mkdirSync(SCRIPT_DIR, { recursive: true })
fs.mkdirSync(path.join(PROJECT, 'Data'), { recursive: true })
fs.writeFileSync(path.join(PROJECT, 'game.yamirpg'), '{}')
fs.writeFileSync(path.join(PROJECT, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext' } }, null, 2))

function writeFixture(name, lines) {
  const file = path.join(SCRIPT_DIR, name)
  fs.writeFileSync(file, lines.join('\n'))
  return 'Assets/插件/自定义指令/' + name
}

/* 用 CRLF 写：Windows 上的工程文件就是这个换行，解析器必须在 CRLF 下也认全部标签 */
function writeFixtureCrlf(name, lines) {
  const file = path.join(SCRIPT_DIR, name)
  fs.writeFileSync(file, lines.join('\r\n'))
  return 'Assets/插件/自定义指令/' + name
}

const GOOD = writeFixtureCrlf('正常.a111111111111111.ts', [
  '/* @plugin #plugin',
  ' * @version 1.0',
  ' * @desc #desc',
  ' * @number amount',
  ' * @alias #amount',
  ' * @default 5',
  ' * @option mode {\'a\', \'b\'}',
  ' * @default \'b\'',
  ' */',
  'export default class Good implements Script<Command> { amount!: number; mode!: string; call(): boolean { return true } }',
  ''
])

const LF = writeFixture('LF换行.b111111111111111.ts', [
  '/* @plugin #plugin',
  ' * @version 1.0',
  ' * @number amount',
  ' * @alias #amount',
  ' * @default 7',
  ' */',
  'export default class Lf implements Script<Command> { amount!: number; call(): boolean { return true } }',
  ''
])

const BAD_DEFAULT = writeFixture('坏默认值.c111111111111111.ts', [
  '/* @plugin #plugin',
  ' * @number amount',
  ' * @default abc',
  ' */',
  'export default class BadDefault implements Script<Command> { amount!: number; call(): boolean { return true } }',
  ''
])

const BAD_OPTION = writeFixture('坏选项默认值.d111111111111111.ts', [
  '/* @plugin #plugin',
  ' * @option mode {\'a\', \'b\'}',
  ' * @default \'z\'',
  ' */',
  'export default class BadOption implements Script<Command> { mode!: string; call(): boolean { return true } }',
  ''
])

const CLAMP_ON_STRING = writeFixture('clamp用错类型.e111111111111111.ts', [
  '/* @plugin #plugin',
  ' * @string label',
  ' * @clamp 1 10',
  ' */',
  'export default class ClampWrong implements Script<Command> { label!: string; call(): boolean { return true } }',
  ''
])

const TAGS_OUTSIDE = writeFixture('标签写在外面.f111111111111111.ts', [
  '/* @plugin #plugin',
  ' * @number amount',
  ' */',
  '// @default 5   ← 写在注释块外面，引擎根本不看',
  'export default class Outside implements Script<Command> { amount!: number; call(): boolean { return true } }',
  ''
])

let child = null
let buffer = ''
let nextId = 1
const pending = new Map()

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' 超时')) }, 60000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

async function call(name, args) {
  const res = await rpc('tools/call', { name, arguments: args || {} })
  const text = res.result && res.result.content && res.result.content[0] && res.result.content[0].text
  try { return JSON.parse(text) } catch { return { raw: String(text).slice(0, 300) } }
}

function codes(result) {
  return (result.metaIssues || []).map(item => item.code)
}

async function main() {
  if (!fs.existsSync(SERVER)) { console.error('找不到 MCP 服务端: ' + SERVER); process.exit(2) }
  child = spawn(process.execPath, [SERVER, '--root', PROJECT], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, YAMI_MCP_GUARDED: '1' } })
  child.stdout.on('data', chunk => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const slot = pending.get(msg.id)
      if (!slot) continue
      pending.delete(msg.id)
      clearTimeout(slot.timer)
      msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg)
    }
  })
  child.stderr.on('data', () => {})
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'meta-rules-test', version: '1' } })

  console.log('')
  console.log('########## 1. CRLF 文件必须解析出全部标签（引擎正则在这里会漏） ##########')
  const good = await call('parse_plugin_meta', { path: GOOD })
  check('CRLF 脚本能解析出 2 个参数', (good.parameters || []).length === 2, JSON.stringify((good.parameters || []).map(p => p.type + ':' + p.key)))
  check('@number 的参数名没有被 @alias 粘住', (good.parameters || [])[0] && good.parameters[0].key === 'amount', (good.parameters || [])[0] && good.parameters[0].key)
  check('@default 的值没有被下一行粘住', (good.parameters || [])[0] && good.parameters[0].default === '5', (good.parameters || [])[0] && good.parameters[0].default)
  check('@option 的值去掉引号（与引擎 parseString 一致）', (good.parameters || [])[1] && JSON.stringify(good.parameters[1].options) === JSON.stringify(['a', 'b']), JSON.stringify((good.parameters || [])[1] && good.parameters[1].options))
  check('概览标签（@version）进 overview 而不是参数表', good.overview && good.overview.version === '1.0', JSON.stringify(good.overview))
  check('规范脚本零问题', codes(good).length === 0, JSON.stringify(codes(good)))

  console.log('')
  console.log('########## 2. LF 文件同样要解析正确 ##########')
  const lf = await call('parse_plugin_meta', { path: LF })
  check('LF 脚本解析出 1 个参数且默认值干净', (lf.parameters || []).length === 1 && lf.parameters[0].default === '7', JSON.stringify(lf.parameters))
  check('LF 脚本零问题', codes(lf).length === 0, JSON.stringify(codes(lf)))

  console.log('')
  console.log('########## 3. 按引擎规则抓错（每条都对应 plugin.ts 的一处判据） ##########')
  const badDefault = await call('parse_plugin_meta', { path: BAD_DEFAULT })
  check('@default 与类型不符被标为 error', codes(badDefault).includes('bad-default'), JSON.stringify(codes(badDefault)))
  const badOption = await call('parse_plugin_meta', { path: BAD_OPTION })
  check('@default 不在 @option 列表里被标为 error', codes(badOption).includes('default-not-in-options'), JSON.stringify(codes(badOption)))
  const clampWrong = await call('parse_plugin_meta', { path: CLAMP_ON_STRING })
  check('@clamp 写在 string 上被提醒（引擎只对数值生效）', codes(clampWrong).includes('modifier-scope'), JSON.stringify(codes(clampWrong)))
  const outside = await call('parse_plugin_meta', { path: TAGS_OUTSIDE })
  check('注释块外的 @标签被标为 error', codes(outside).includes('tags-outside-block'), JSON.stringify(codes(outside)))

  console.log('')
  console.log('########## 4. 写盘门禁：error 拦、warn 放行 ##########')
  const blocked = await call('write_script', { path: BAD_DEFAULT, content: fs.readFileSync(path.join(PROJECT, BAD_DEFAULT), 'utf8'), dryRun: true })
  check('error 级元数据直接拒绝写盘', blocked.ok === false && /元数据不符合引擎规则/.test(String(blocked.error)), String(blocked.error || '').slice(0, 60))
  const warnOnly = await call('write_script', { path: CLAMP_ON_STRING, content: fs.readFileSync(path.join(PROJECT, CLAMP_ON_STRING), 'utf8'), dryRun: true })
  check('warn 级元数据不拦（只是提醒）', warnOnly.ok !== false, String(warnOnly.error || warnOnly.message || '').slice(0, 60))

  console.log('')
  console.log('########## 5. 生成脚本：默认值引号由类型决定，生成的元数据必须自检通过 ##########')
  const made = await call('create_script', {
    type: 'command',
    path: 'Assets/插件/自定义指令/生成自检.abcdef1234567890.ts',
    className: 'GeneratedProbe',
    nameZh: '生成自检',
    params: [
      { key: 'amount', type: 'number', default: 5 },
      { key: 'mode', type: 'option', options: ['a', 'b'], default: 'b' },
      { key: 'label', type: 'string', default: 'x' }
    ]
  })
  check('生成的模板自身通过引擎规则自检', made.ok === true && codes(made).length === 0, String(made.error || JSON.stringify(codes(made))).slice(0, 120))
  const scriptText = String(made.script || '')
  check('option 的默认值带引号（引擎 parseString 要求）', /@default 'b'/.test(scriptText), (scriptText.match(/@default[^\n]*/g) || []).join(' / '))
  check('number 的默认值不带引号', /@default 5/.test(scriptText))
  check('string 的默认值带引号', /@default 'x'/.test(scriptText))
  const authored = await call('create_script', {
    type: 'command',
    path: 'Assets/插件/自定义指令/作者.abcdef1234567891.ts',
    className: 'AuthorProbe',
    nameZh: '作者探针',
    author: 'DanJuan',
    link: 'https://example.com/x'
  })
  check('填了 author/link 时生成 @author 与 @link', authored.ok === true && /@author DanJuan/.test(String(authored.script || '')) && /@link https:\/\/example\.com\/x/.test(String(authored.script || '')), String(authored.error || '').slice(0, 80))
  check('不填时不生成空的 @author / @link 占位', !/@author\s*\n/.test(scriptText) && !/@link\s*\n/.test(scriptText), (scriptText.match(/@(author|link)[^\n]*/g) || ['（没有）']).join(' / '))


  console.log('')
  console.log('########## 6. 资源必需字段与真实资源一致（引擎侧字段形状） ##########')
// 每一种类型的「最小合法文件」必须过，且缺关键字段时必须被拦
  // （旧表的三处误报：skill/item/equip/state 被要求有 name、tileset 被要求有 image、particle 被要求有 sprites）
  const RESOURCE_DIR = path.join(PROJECT, 'Assets', '资源')
  fs.mkdirSync(RESOURCE_DIR, { recursive: true })
  const minimal = {
    '最小.a111111111111111.skill': { icon: '', clip: [0, 0, 16, 16], inherit: '', attributes: [], events: [], scripts: [] },
    '最小.a222222222222222.item': { icon: '', clip: [0, 0, 16, 16], inherit: '', attributes: [], events: [], scripts: [] },
    '最小.a333333333333333.equip': { icon: '', clip: [0, 0, 16, 16], inherit: '', attributes: [], events: [], scripts: [] },
    '最小.a444444444444444.state': { icon: '', clip: [0, 0, 16, 16], inherit: '', attributes: [], events: [], scripts: [] },
    '最小.a555555555555555.particle': { layers: [] },
    '最小.a666666666666666.tile': { type: 'auto', width: 0, height: 0, tileWidth: 32, tileHeight: 32 }
  }
  for (const [name, data] of Object.entries(minimal)) {
    const abs = path.join(RESOURCE_DIR, name)
    fs.writeFileSync(abs, JSON.stringify(data, null, 2) + '\n')
    const rel = 'Assets/资源/' + name
    const res = await call('validate_resource', { path: rel })
    check(name.split('.').pop() + ' 的最小合法文件通过校验（不再被要求不存在的字段）', res.ok === true, JSON.stringify((res.issues || []).map(i => i.code + ':' + i.message)))
  }
  // 反向：真的缺关键字段时必须拦下来
  const missingEvents = path.join(RESOURCE_DIR, '缺字段.a777777777777777.skill')
  fs.writeFileSync(missingEvents, JSON.stringify({ icon: '', clip: [0, 0, 16, 16] }, null, 2) + '\n')
  const bad = await call('validate_resource', { path: 'Assets/资源/缺字段.a777777777777777.skill' })
  check('缺 events 的技能资源被拦下', bad.ok === false && JSON.stringify(bad.issues || []).includes('missing-field'), JSON.stringify((bad.issues || []).map(i => i.code)))
  console.log('')
  console.log('########## 7. 数据表：容器键不许当条目写 + config 平铺补丁 ##########')
  fs.writeFileSync(path.join(PROJECT, 'Data', 'attribute.json'), JSON.stringify({ settings: { base: 1 }, keys: { a: { name: '力量' } } }, null, 2))
  fs.writeFileSync(path.join(PROJECT, 'Data', 'config.json'), JSON.stringify({ gameId: 'probe', deadzone: 0.1, resolution: '1280x720' }, null, 2))
  fs.writeFileSync(path.join(PROJECT, 'Data', 'teams.json'), JSON.stringify({ list: [{ id: 'aaaaaaaaaaaaaaaa', name: 'A队' }], relations: {}, collisions: {} }, null, 2))
  const containerWrite = await call('upsert_database_item', { table: 'attribute', id: 'settings', item: { hack: 1 }, dryRun: true })
  check('把 attribute 的结构键 settings 当条目写会被拒', containerWrite.ok === false && /引擎结构键/.test(String(containerWrite.error || '')), String(containerWrite.error || '').slice(0, 70))
  const entryWrite = await call('upsert_database_item', { table: 'attribute', id: 'strength', item: { name: '力量' }, dryRun: true })
  check('字典型表指定真实条目键照旧可写', entryWrite.ok === true, String(entryWrite.error || entryWrite.message || '').slice(0, 60))
  const configPatch = await call('upsert_database_item', { table: 'config', item: { deadzone: 0.3 }, dryRun: true })
  check('config 不传 id 时按字段补丁（平铺配置没有条目概念）', configPatch.ok === true && /补丁 config/.test(String(configPatch.message || '')), String(configPatch.error || configPatch.message || '').slice(0, 70))
  const listEntry = await call('upsert_database_item', { table: 'teams', item: { name: '新队' }, dryRun: true })
  check('带 list 的表新增条目仍自动生成 id', listEntry.ok === true && !!listEntry.id, String(listEntry.error || listEntry.id || '').slice(0, 60))
  console.log('')
  console.log('########## 8. 全工程校验：引用判定要收窄 + presetId 跨文件唯一 ##########')
  // 造两份场景，故意用同一个 presetId（引擎注册时后写的会覆盖前一个）
  const SCENE_DIR = path.join(PROJECT, 'Assets', '场景')
  fs.mkdirSync(SCENE_DIR, { recursive: true })
  const sceneBody = pid => ({ width: 20, height: 20, tileWidth: 32, tileHeight: 32, ambient: {}, objects: [{ presetId: pid, class: 'actor', name: '物体' }] })
  fs.writeFileSync(path.join(SCENE_DIR, '甲.a111111111111111.scene'), JSON.stringify(sceneBody('deadbeefdeadbeef'), null, 2))
  fs.writeFileSync(path.join(SCENE_DIR, '乙.b222222222222222.scene'), JSON.stringify(sceneBody('deadbeefdeadbeef'), null, 2))
  const goodPreset = await call('validate_resource', { path: 'Assets/场景/甲.a111111111111111.scene' })
  check('合法 presetId（16 位 hex 含 a-f）不报格式问题', (goodPreset.issues || []).some(i => i.code === 'bad-preset-id') === false, JSON.stringify((goodPreset.issues || []).map(i => i.code)))
  fs.writeFileSync(path.join(SCENE_DIR, '丙.d444444444444444.scene'), JSON.stringify(sceneBody('手写的预设ID'), null, 2))
  const badPreset = await call('validate_resource', { path: 'Assets/场景/丙.d444444444444444.scene' })
  check('presetId 不是 16 位 hex 时给出提醒', (badPreset.issues || []).some(i => i.code === 'bad-preset-id') === true, JSON.stringify((badPreset.issues || []).map(i => i.code + ':' + String(i.message).slice(0, 40))))
  const project = await call('validate_project', {})
  const dupPreset = (project.issues || []).filter(i => i.code === 'duplicate-preset-id')
  check('跨文件的 presetId 冲突被抓出来', dupPreset.length >= 1, JSON.stringify(dupPreset.slice(0, 1).map(i => i.message)).slice(0, 120))
  // 引用判定收窄：变量 key 这类 16 位 hex 不该被当成资源引用
  const varKey = 'cafebabecafebabe'
  fs.writeFileSync(path.join(SCENE_DIR, '丙.c333333333333333.scene'), JSON.stringify({ width: 20, height: 20, tileWidth: 32, tileHeight: 32, ambient: {}, objects: [{ presetId: 'aabbccddaabbccdd', variable: { type: 'global', key: varKey } }] }, null, 2))
  const project2 = await call('validate_project', {})
  const dangling = (project2.issues || []).filter(i => i.code === 'dangling-ref' && String(i.message).includes(varKey))
  check('变量 key 不会被误报成悬空资源引用', dangling.length === 0, JSON.stringify(dangling.slice(0, 1).map(i => i.message)).slice(0, 110))
  console.log('')
  console.log('########## 9. 写盘门禁：跨文件 presetId 冲突必须拒绝 ##########')
  const conflictingScene = { width: 20, height: 20, tileWidth: 32, tileHeight: 32, ambient: {}, objects: [{ presetId: 'deadbeefdeadbeef', class: 'actor', name: '撞 id 的对象' }] }
  const blockedWrite = await call('write_resource', { path: 'Assets/场景/丁.e555555555555555.scene', content: conflictingScene, dryRun: true })
  check('写一份与原文件撞 presetId 的场景被拒绝', blockedWrite.ok === false && JSON.stringify(blockedWrite.issues || []).includes('preset-id-conflict'), JSON.stringify((blockedWrite.issues || []).map(i => i.code)))
  const fineWrite = await call('write_resource', { path: 'Assets/场景/丁.e555555555555555.scene', content: Object.assign({}, conflictingScene, { objects: [{ presetId: 'feedfacefeedface', class: 'actor', name: '新 id' }] }), dryRun: true })
  check('换成不冲突的 presetId 就能通过', fineWrite.ok === true, JSON.stringify((fineWrite.issues || []).map(i => i.code)))
  console.log('')
  console.log('########## 10. 界面 reference 节点指不到 prefab 要被报出来 ##########')
  const UI_DIR = path.join(PROJECT, 'Assets', '界面')
  fs.mkdirSync(UI_DIR, { recursive: true })
  const uiBody = prefabId => ({ width: 320, height: 180, nodes: [{ class: 'reference', name: '引用块', presetId: 'aaaabbbbccccdddd', prefabId: prefabId, synchronous: false }] })
  fs.writeFileSync(path.join(UI_DIR, '借用.a999999999999999.ui'), JSON.stringify(uiBody('0123456789abcdef'), null, 2))
  const project3 = await call('validate_project', {})
  const danglingPrefab = (project3.issues || []).filter(i => i.code === 'dangling-prefab')
  check('reference 指向不存在的 prefabId 被报出来', danglingPrefab.length >= 1, JSON.stringify(danglingPrefab.slice(0, 1).map(i => i.message)).slice(0, 130))
  // 指到本工程真实存在的 presetId 时不该报
  fs.writeFileSync(path.join(UI_DIR, '被借.a888888888888888.ui'), JSON.stringify({ width: 320, height: 180, nodes: [{ class: 'image', name: '原件', presetId: 'deadbeefdeadbeef' }] }, null, 2))
  fs.writeFileSync(path.join(UI_DIR, '借用2.b999999999999999.ui'), JSON.stringify(uiBody('deadbeefdeadbeef'), null, 2))
  const project4 = await call('validate_project', {})
  const stillDangling = (project4.issues || []).filter(i => i.code === 'dangling-prefab' && String(i.message).includes('deadbeefdeadbeef'))
  check('指向真实存在的 presetId 时不报', stillDangling.length === 0, JSON.stringify(stillDangling.slice(0, 1).map(i => i.message)).slice(0, 110))
  console.log('')
  console.log('########## 11. 压缩字段（RLE）不许被写短 ##########')
  // 真实故障链：read_resource 对超大文件只回字段名清单，模型却照原样 write_resource → 引擎 decode 直接抛 RangeError
  const sceneRel = 'Assets/场景/地图.a123123123123123.scene'
  const sceneWithRle = { width: 20, height: 20, tileWidth: 32, tileHeight: 32, ambient: {}, terrains: 'AAAA', objects: [{ class: 'tilemap', name: '图层', presetId: 'abababababababab', code: 'RLE-RLE-RLE-RLE-RLE-RLE-RLE-RLE', tilesetMap: {} }] }
  fs.writeFileSync(path.join(SCENE_DIR, '地图.a123123123123123.scene'), JSON.stringify(sceneWithRle, null, 2))
  const keepRle = await call('write_resource', { path: sceneRel, content: sceneWithRle, dryRun: true })
  check('压缩字段原样写回放行', keepRle.ok === true, JSON.stringify((keepRle.issues || []).map(i => i.code)))
  const cutRle = JSON.parse(JSON.stringify(sceneWithRle))
  cutRle.objects[0].code = 'RLE'
  const blockedRle = await call('write_resource', { path: sceneRel, content: cutRle, dryRun: true })
  check('瓦片地图的 code 被写短时拒绝写盘', blockedRle.ok === false && JSON.stringify(blockedRle.issues || []).includes('rle-shrunk'), JSON.stringify((blockedRle.issues || []).map(i => i.code)))
  const cutTerrain = JSON.parse(JSON.stringify(sceneWithRle))
  cutTerrain.terrains = 'A'
  const blockedTerrain = await call('write_resource', { path: sceneRel, content: cutTerrain, dryRun: true })
  check('场景 terrains 被写短时同样拒绝', blockedTerrain.ok === false && JSON.stringify(blockedTerrain.issues || []).includes('rle-shrunk'), JSON.stringify((blockedTerrain.issues || []).map(i => i.code)))
  console.log('')
  console.log('########## 元数据规则对齐: ' + passed + ' PASS / ' + failed + ' FAIL ##########')
  child.kill()
  process.exit(failed ? 1 : 0)
}

process.on('exit', () => { try { if (child) child.kill() } catch { /* 忽略 */ } })

main().catch(error => {
  console.error(error && error.stack || error)
  if (child) child.kill()
  process.exit(1)
})
