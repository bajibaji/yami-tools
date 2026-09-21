'use strict'
/**
 * 事件指令装配的「中文显示名 → GUID」对齐引擎（零依赖）
 *
 * 规则实据：编辑器里那条自定义指令的中文名来自脚本 @lang 段的 #plugin 值
 * （引擎 plugin.ts 的 LanguageMap：overview 用 #plugin、参数用 #key）；
 * Data/commands.json 只有 { id, enabled, alias, keywords }，alias 实测全是空串、没有 name。
 * 所以「按编辑器里看到的名字下指令」必须靠脚本语言包来解析，光看 commands.json 永远解析不出来。
 *
 * 用法: node tests/test-mcp-command-name.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SERVER = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const GUID = 'abcdef1234567890'
const DISPLAY_NAME = '事件广播·单独发送'

let passed = 0
let failed = 0
function check(name, condition, detail) {
  const extra = detail === undefined ? '' : '  [' + detail + ']'
  if (condition) { passed++; console.log('  PASS  ' + name + extra) }
  else { failed++; console.error('  FAIL  ' + name + extra) }
}

const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-cmd-name-'))
fs.mkdirSync(path.join(PROJECT, 'Data'), { recursive: true })
fs.mkdirSync(path.join(PROJECT, 'Assets', '插件', '自定义指令'), { recursive: true })
fs.mkdirSync(path.join(PROJECT, 'Assets', '! 事件'), { recursive: true })
fs.writeFileSync(path.join(PROJECT, 'game.yamirpg'), '{}')
fs.writeFileSync(path.join(PROJECT, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext' } }, null, 2))
// commands.json 按真实工程的形状写：alias 是空串、没有 name —— 这正是旧实现走不通的原因
fs.writeFileSync(path.join(PROJECT, 'Data', 'commands.json'), JSON.stringify([
  { id: GUID, enabled: true, alias: '', keywords: 'broadcastOnce' }
], null, 2))
// 自定义指令脚本：文件名与显示名**故意不一样**，逼解析器去看语言包
fs.writeFileSync(path.join(PROJECT, 'Assets', '插件', '自定义指令', '内部代号.指令.' + GUID + '.ts'), [
  '/* @plugin #plugin',
  ' * @version 1.0',
  ' * @desc #desc',
  ' * @lang zh',
  ' * #plugin ' + DISPLAY_NAME,
  ' * #desc 单独发一条广播事件',
  ' */',
  'export default class BroadcastOnce implements Script<Command> {',
  '  call(): boolean { return true }',
  '}',
  ''
].join('\n'))
const EVENT_REL = 'Assets/! 事件/测试.1111111111111111.event'
fs.writeFileSync(path.join(PROJECT, EVENT_REL), JSON.stringify({ type: 'autorun', enabled: true, priority: false, namespace: false, returnType: 'none', description: '', conditions: [], commands: [] }, null, 2))

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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'command-name-test', version: '1' } })

  console.log('')
  console.log('########## 1. 用编辑器里显示的中文名装指令 ##########')
  const byDisplayName = await call('append_event_commands', {
    path: EVENT_REL,
    commands: [{ type: DISPLAY_NAME }],
    dryRun: true
  })
  check('按语言包里的中文显示名解析成功（而不是只能按文件名）', byDisplayName.ok === true, String(byDisplayName.error || byDisplayName.message || '').slice(0, 90))
  const assembled = JSON.stringify(byDisplayName.previewCommands || [])
  check('装配出来的指令 ID 就是那个脚本的 GUID', assembled.indexOf(GUID) !== -1, assembled.slice(0, 120))

  console.log('')
  console.log('########## 2. 文件名（去掉 .指令 后缀）与完整名照旧可用 ##########')
  const byShortName = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '内部代号' }], dryRun: true })
  check('按「文件名去 .指令 后缀」解析成功', byShortName.ok === true, String(byShortName.error || '').slice(0, 80))
  const byFullName = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '内部代号.指令' }], dryRun: true })
  check('按完整文件名解析成功', byFullName.ok === true, String(byFullName.error || '').slice(0, 80))

  console.log('')
  console.log('########## 3. 说不出来的名字必须如实报错，不许瞎写 ##########')
  const bogus = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '根本不存在的指令' }], dryRun: true })
  check('未知指令被拒绝并说明原因', bogus.ok === false && /未找到自定义指令/.test(String(bogus.error || '')), String(bogus.error || '').slice(0, 80))

  console.log('')
  console.log('########## 4. 禁用前缀与等待时长（引擎 ! 前缀 / wait 毫秒语义） ##########')
  const disabledId = await call('append_event_commands', {
    path: EVENT_REL,
    commands: [{ type: '!setNumber', variable: { type: 'local', key: 'x' }, operation: 'set', operands: [] }],
    dryRun: true
  })
  check('带 ! 前缀的指令 id 能被原样保留（引擎用它表示「这条被禁用」）', disabledId.ok === true && JSON.stringify(disabledId.previewCommands || []).indexOf('!setNumber') !== -1, JSON.stringify(disabledId.previewCommands || []).slice(0, 90))
  const waitTurn = await call('append_event_commands', {
    path: EVENT_REL,
    commands: [{ type: 'wait', duration: 200 }],
    dryRun: true
  })
  check('等待指令按毫秒原样写入', waitTurn.ok === true && JSON.stringify(waitTurn.previewCommands || []).indexOf('200') !== -1, JSON.stringify(waitTurn.previewCommands || []).slice(0, 90))
  const waitObject = await call('append_event_commands', {
    path: EVENT_REL,
    commands: [{ type: 'wait', duration: { type: 'variable', variable: { type: 'local', key: 't' } } }],
    dryRun: true
  })
  check('等待时长是变量对象时不被硬转成数字', waitObject.ok === true && JSON.stringify(waitObject.previewCommands || []).indexOf('"type":"variable"') !== -1, JSON.stringify(waitObject.previewCommands || []).slice(0, 110))
  console.log('')
  console.log('########## 5. 中文名必须落到引擎真名与真形状（撞车名会静默改语义） ##########')
  const asJson = r => JSON.stringify((r && r.previewCommands || [])[0] || {})
  const setNum = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '设置数值', variableId: 'aaaa1111bbbb2222', value: 5 }], dryRun: true })
  check('设置数值：键名是引擎的 operation/operands（旧实现写 operator/operand，编译期直接抛错）',
    setNum.ok === true && asJson(setNum).includes('"operation":"set"') && asJson(setNum).includes('"operands"') && !asJson(setNum).includes('"operator"'), asJson(setNum).slice(0, 130))
  const setStr = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '设置字符串', variableId: 'aaaa1111bbbb2222', value: 'hi' }], dryRun: true })
  check('设置字符串：operation=set + operand（单数）',
    setStr.ok === true && asJson(setStr).includes('"operation":"set"') && asJson(setStr).includes('"operand"') && !asJson(setStr).includes('"operator"'), asJson(setStr).slice(0, 130))
  const branch = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '条件分支', params: { variable: { type: 'global', key: 'v' }, branches: [] } }], dryRun: true })
  check('条件分支 → 引擎的 switch（引擎里 if 叫「如果」；判成 if 会把条件清空变恒真）',
    branch.ok === true && asJson(branch).includes('"id":"switch"'), asJson(branch).slice(0, 90))
  const setText = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '设置文本', params: { element: 'e', property: 'text-content', value: 'x' } }], dryRun: true })
  check('设置文本 → 引擎的 setText（旧实现当 setString，写了个空 key 变量、静默无效）',
    setText.ok === true && asJson(setText).includes('"id":"setText"'), asJson(setText).slice(0, 90))
  const loopTurn = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '遍历', params: { list: { type: 'local', key: 'l' }, commands: [] } }], dryRun: true })
  check('引擎真名「遍历」不再报未找到自定义指令',
    loopTurn.ok === true && asJson(loopTurn).includes('"id":"forEach"'), asJson(loopTurn).slice(0, 90))
  const callEv = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '调用事件', eventId: 'ffffffffffffffff', eventArgs: [{ key: 'p', type: 'number', value: 1 }] }], dryRun: true })
  check('调用事件保留 eventArgs（过去被静默丢掉，带参事件拿到空参）',
    callEv.ok === true && asJson(callEv).includes('"eventArgs"'), asJson(callEv).slice(0, 110))
  const engineShaped = await call('append_event_commands', { path: EVENT_REL, commands: [{ type: '设置数值', variable: { type: 'global', key: 'k' }, operation: 'add', operands: [{ operation: 'add', type: 'constant', value: 7 }] }], dryRun: true })
  check('照 get_event_command_examples 抄来的引擎形状原样透传（不再被 String() 揉成 [object Object]）',
    engineShaped.ok === true && !asJson(engineShaped).includes('[object Object]') && asJson(engineShaped).includes('"operation":"add"'), asJson(engineShaped).slice(0, 130))

  console.log('')
  console.log('########## 指令中文名解析: ' + passed + ' PASS / ' + failed + ' FAIL ##########')
  child.kill()
  process.exit(failed ? 1 : 0)
}

process.on('exit', () => { try { if (child) child.kill() } catch { /* 忽略 */ } })

main().catch(error => {
  console.error(error && error.stack || error)
  if (child) child.kill()
  process.exit(1)
})
