#!/usr/bin/env node
'use strict'
/**
 * MCP 数据规则测试：RLE 真编解码 / 属性查询 / 插件 lint / 变量引用体检
 * 用法: node tests/test-mcp-data-rules.cjs
 *
 * 为什么单独一套：这四项都是"引擎静默失效"类问题的看门人 ——
 * RLE 写坏 = 地图直接读不出来；属性键猜错 = 赋值被静默丢弃；
 * 插件类名重复 = 后加载的覆盖前一个；变量类型不符 = 静默丢弃。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const rle = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'rle.js'))

let passed = 0
let failed = 0
function check(name, cond, detail) {
  const extra = detail === undefined ? '' : '  [' + detail + ']'
  if (cond) { passed++; console.log('  PASS  ' + name + extra) }
  else { failed++; console.error('  FAIL  ' + name + extra) }
}

function startMcp(projectDir) {
  const child = spawn(process.execPath, [MCP, '--root', projectDir], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  let nextId = 1
  const pending = new Map()
  child.stdout.on('data', chunk => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      const entry = pending.get(message.id)
      if (entry) { pending.delete(message.id); entry(message) }
    }
  })
  const call = (name, args) => new Promise(resolve => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n')
  const tool = async (name, args) => {
    const raw = await call(name, args || {})
    const content = raw && raw.result && raw.result.content
    if (!content || !content[0]) return { ok: false, error: '工具没有返回内容' }
    try { return JSON.parse(content[0].text) } catch (e) { return { ok: false, error: '返回无法解析' } }
  }
  return { tool, stop: () => child.kill() }
}

async function main() {
  console.log('\n########## 1. RLE 编解码：与引擎同口径（长空白/长重复/截断） ##########')
  const tiles = new Array(64).fill(0)
  tiles[20] = 12345
  for (let i = 21; i < 41; i++) tiles[i] = 12345          // 长重复（>10）
  for (let i = 41; i < 60; i++) tiles[i] = 0              // 长空白（>16）
  const tilesCode = rle.encodeTiles(tiles)
  check('瓦片：编解码往返一致', JSON.stringify(rle.decodeTiles(tilesCode, 8, 8)) === JSON.stringify(tiles), tilesCode.length + ' 字符')
  check('瓦片：解码结果长度 = width*height', rle.decodeTiles(tilesCode, 8, 8).length === 64)
  check('瓦片：verifyTiles 通过', rle.verifyTiles(tilesCode, 8, 8).ok === true)

  const terrains = new Array(100).fill(0)
  for (let i = 10; i < 15; i++) terrains[i] = 3           // 3 连以上才走重复段
  for (let i = 15; i < 70; i++) terrains[i] = 0           // 长空白（>49，走两字节形式）
  const terrainCode = rle.encodeTerrains(terrains)
  check('地形：编解码往返一致（含两字节空白段）', JSON.stringify(rle.decodeTerrains(terrainCode, 10, 10)) === JSON.stringify(terrains), terrainCode.length + ' 字符')
  check('地形：verifyTerrains 通过', rle.verifyTerrains(terrainCode, 10, 10).ok === true)

  let threw = false
  try { rle.decodeTiles(tilesCode.slice(0, 3), 8, 8) } catch (e) { threw = true }
  check('截断的压缩串必须抛错（引擎加载时就是这么炸的）', threw === true)

  // verify* 是 validate_project 直接 return 的东西，抛异常会让整份体检只剩一句错误
  const badVerify = rle.verifyTiles('\x23\x23', 8, 8)
  check('verifyTiles 对坏串返回 {ok:false} 而不是抛出去', badVerify && badVerify.ok === false && !!badVerify.error, String(badVerify && badVerify.error).slice(0, 50))
  const badVerifyTerrain = rle.verifyTerrains('\x23\x23', 10, 10)
  check('verifyTerrains 同样返回 {ok:false}', badVerifyTerrain && badVerifyTerrain.ok === false && !!badVerifyTerrain.error, String(badVerifyTerrain && badVerifyTerrain.error).slice(0, 50))

  console.log('\n########## 2. 属性表 / 变量 / 插件 lint（合成工程真跑 MCP） ##########')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-data-rules-'))
  try {
    fs.mkdirSync(path.join(dir, 'Data'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'Assets', '插件', '全局插件'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'game.yamirpg'), '{}')
    fs.writeFileSync(path.join(dir, 'Data', 'attribute.json'), JSON.stringify({
      keys: { 0: { class: 'folder', id: 'grp1', name: '角色属性', children: [
        { id: 'a5fd5e9f229abb2d', key: 'health', name: '生命值', type: 'number' },
        { id: 'a8451228fe0c120a', key: 'maxHealth', name: '最大生命值', type: 'number' }
      ] } }
    }))
    fs.writeFileSync(path.join(dir, 'Data', 'variables.json'), JSON.stringify([
      { class: 'folder', name: '常用变量', children: [{ id: '9b88cf064bea5488', name: '临时布尔值', value: false }, { id: '4beccf626076a6a5', name: '临时数值', value: 0 }] }
    ]))
    // 两个同名类的全局插件 + 一份 plugins.json 登记（类名冲突只在"全局插件"口径下才算冲突）
    const pluginA = 'P.1111111111111111.ts'
    const pluginB = 'P.2222222222222222.ts'
    fs.writeFileSync(path.join(dir, 'Assets', '插件', '全局插件', pluginA), 'export default class DamagePopup {\n  onBeforeSave(data, define) { data.score = 1 }\n}')
    fs.writeFileSync(path.join(dir, 'Assets', '插件', '全局插件', pluginB), 'export default class DamagePopup {\n  onBeforeLoad(data) { data.plugins["x"] = 1 }\n}')
    fs.writeFileSync(path.join(dir, 'Data', 'plugins.json'), JSON.stringify({
      '1111111111111111': { name: 'A', enabled: true }, '2222222222222222': { name: 'B', enabled: true }
    }))
    // 一个事件：引用不存在的全局变量 + 类型不符（数值变量写成 setBoolean）
    fs.writeFileSync(path.join(dir, 'Assets', '测试.3333333333333333.event'), JSON.stringify({
      commands: [
        { id: 'setNumber', params: { variable: { type: 'global', key: 'ffffffffffffffff' }, operation: 'set', operand: { type: 'constant', value: 1 } } },
        { id: 'setBoolean', params: { variable: { type: 'global', key: '4beccf626076a6a5' }, operation: 'set', operand: { type: 'constant', value: true } } }
      ]
    }))

    const mcp = startMcp(dir)
    try {
      const attrs = await mcp.tool('list_attributes', { query: '生命' })
      check('list_attributes 能查到属性（含 id/key/name）',
        attrs.count === 2 && attrs.attributes[0].id === 'a5fd5e9f229abb2d' && attrs.attributes[0].name === '生命值',
        JSON.stringify(attrs.attributes && attrs.attributes[0]))
      const byId = await mcp.tool('list_attributes', { query: 'a8451228fe0c120a' })
      check('list_attributes 支持按 id 反查', byId.count === 1 && byId.attributes[0].key === 'maxHealth')

      const audit = await mcp.tool('validate_project', {})
      const codes = (audit.issues || []).map(i => i.code)
      check('插件类名冲突被抓（全局插件口径）', codes.includes('plugin-class-conflict'), JSON.stringify(codes))
      check('onBeforeSave 直接改 data 被提醒', codes.includes('plugin-save-without-define'))
      check('对只读 data.plugins 赋值被提醒', codes.includes('plugin-plugins-readonly'))
      check('引用不存在的全局变量被抓', codes.includes('unknown-variable'))
      check('变量类型不符被抓（数值变量被 setBoolean 写）', codes.includes('variable-type-mismatch'))
      check('体检结论为不通过（有 error）', audit.ok === false)
    } finally { mcp.stop() }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }

  console.log('\n########## MCP 数据规则: ' + passed + ' PASS / ' + failed + ' FAIL ##########')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error('测试自身崩了: ' + (err && err.stack || err)); process.exit(1) })
