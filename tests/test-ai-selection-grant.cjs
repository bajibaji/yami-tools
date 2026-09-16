'use strict'
/**
 * AI 助手「选中文件默认放行」回归测试（零依赖）
 *
 * 规则（用户明确要求）：用户在编辑器里打开着的那个文件 = 我要改它 —— 直接改，不再逐条确认；
 * 打开之外的文件仍然要先弹确认卡。
 *
 * 本测试用真宿主 + 假模型 + 假编辑器桥（5967 同款 /context 路由）跑整条链路：
 *   1. 同一个回合里模型先改「选中的文件」，再改「另一个文件」；
 *   2. 断言：选中的那个当场落盘、没有弹确认卡；另一个必须停在审批、点之前一个字节都不许动；
 *   3. 断言：面板上能看到一句「这是你打开着的文件，直接改」的如实说明。
 *
 * 用法: node tests/test-ai-selection-grant.cjs
 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE = require('./resolve-project.cjs').resolveProject()
const SELECTED_REL = process.env.YAMI_TEST_ACTOR_A || 'Assets/角色/怪物001 - Lv1.de69aa9ed4309642.actor'
const OTHER_REL = process.env.YAMI_TEST_ACTOR_B || 'Assets/角色/怪物002 - Lv2.c173925069666080.actor'

const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 18468 + Math.floor(Math.random() * 200)
const MODEL_PORT = AI_PORT + 300
const EDITOR_PORT = AI_PORT + 600
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'danjuan-selection-'))

let passed = 0
let failed = 0
function check(name, condition, detail) {
  const extra = detail === undefined ? '' : '  [' + detail + ']'
  if (condition) { passed++; console.log('  PASS  ' + name + extra) }
  else { failed++; console.error('  FAIL  ' + name + extra) }
}

// 工程夹具统一走 tests/_fixture.cjs：大素材（音频/视频）不拷、退出时自动删 ——
// 以前这里整份拷贝且从不清理，单次 440MB × 49 个残留 = 21GB（把用户 C 盘塞爆那次）
function copyFixture() {
  return require('./_fixture.cjs').copyProject('yami-selection-', ['Assets', 'Data', 'Script'], ['tsconfig.json', 'game.yamirpg'])
}

/* ============================== 假编辑器桥（5967 同款最小实现） ============================== */
function startFakeEditor(selectedPath) {
  const bridgeToken = 'test-bridge-token'
  const server = http.createServer((req, res) => {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.method === 'GET' && req.url === '/token') return send(200, { ok: true, bridgeToken })
    if (req.method === 'GET' && req.url === '/whoami') return send(200, { ok: true, projectRoot: PROJECT, engineAvailable: true })
    if (req.method === 'GET' && req.url === '/context') {
      return send(200, { ok: true, context: { environment: 'editor', selectedFile: { name: path.basename(selectedPath), path: selectedPath, type: 'actor' }, hasPendingInput: false }, summary: '选中「' + path.basename(selectedPath) + '」 → ' + selectedPath })
    }
    if (req.method === 'POST' && req.url === '/action') {
      if (req.headers['x-yami-bridge-token'] !== bridgeToken) return send(401, { ok: false, error: '令牌无效' })
      let raw = ''
      req.on('data', chunk => { raw += chunk })
      req.on('end', () => {
        let action = {}
        try { action = JSON.parse(raw || '{}') } catch { /* 忽略 */ }
        actionLog.push(action.action)
        if (action.action === 'preflight') return send(200, { ok: true, dirty: false, path: action.path })
        send(200, { ok: true, action: action.action })
      })
      return
    }
    send(404, { ok: false, error: 'not found' })
  })
  return new Promise(resolve => server.listen(EDITOR_PORT, '127.0.0.1', () => resolve(server)))
}
const actionLog = []

/* ============================== 假模型：一个回合里连改两个文件 ============================== */
const modelRequests = []
let asked = false
function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  for (const chunk of chunks) res.write('data: ' + JSON.stringify(chunk) + '\n\n')
  res.write('data: [DONE]\n\n')
  res.end()
}
function toolCall(index, id, name, args) {
  return { index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}
const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch { /* 忽略 */ }
    const messages = body.messages || []
    modelRequests.push(messages)
    const sawToolResult = messages.some(message => message.role === 'tool')
    if (asked || sawToolResult) {
      return sse(res, [{ choices: [{ delta: { content: '两处都改好了。' } }] }])
    }
    asked = true
    sse(res, [
      { choices: [{ delta: { content: '先改选中的那个，再改另一个。' } }] },
      { choices: [{ delta: { tool_calls: [
        toolCall(0, 'call_selected', 'patch_resource', { path: SELECTED_REL, patch: { __selection_grant_probe: 1 }, dryRun: false }),
        toolCall(1, 'call_other', 'patch_resource', { path: OTHER_REL, patch: { __selection_grant_probe: 2 }, dryRun: false })
      ] } }] }
    ])
  })
})

/* ============================== 宿主 ============================== */
function startHost() {
  return spawn(process.execPath, [path.join(ROOT, 'ai-host.js')], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: CONFIG_DIR,
      YAMI_AI_SESSION_DIR: path.join(CONFIG_DIR, 'sessions'),
      YAMI_PROJECT_ROOT: PROJECT,
      YAMI_EDITOR_BRIDGE_PORT: String(EDITOR_PORT),
      ...(process.env.YAMI_TEST_TRACE === '1' ? { YAMI_AI_DEBUG: '1' } : {})
    }
  })
}

let host = null
let hostStderr = ''
let PROJECT = ''

function json(route, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body === null || body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method,
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function stream(route, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method: 'POST',
      headers: { 'x-yami-agent-token': TOKEN, 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, res => {
      const events = []
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk
        let index
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const line = block.split('\n').find(one => one.startsWith('data:'))
          if (!line) continue
          try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 忽略 */ }
        }
      })
      res.on('end', () => resolve(events))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await json('/status', 'GET'); if (r.ok) return } catch { /* 等等 */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('AI host 启动超时\n' + hostStderr)
}

async function main() {
  if (!FIXTURE) { console.error('找不到夹具工程（设 YAMI_TEST_PROJECT 或准备 D:\\new-game）'); process.exit(2) }
  PROJECT = copyFixture()
  const selectedAbs = path.join(PROJECT, SELECTED_REL)
  const otherAbs = path.join(PROJECT, OTHER_REL)
  const selectedBefore = fs.readFileSync(selectedAbs, 'utf8')
  const otherBefore = fs.readFileSync(otherAbs, 'utf8')

  for (const rel of [SELECTED_REL, OTHER_REL]) {
    if (!fs.existsSync(path.join(PROJECT, rel))) { console.error('夹具工程里没有这个资源: ' + rel + '（可用 YAMI_TEST_ACTOR_A/B 指定两个 .actor）'); process.exit(2) }
  }

  const editor = await startFakeEditor(SELECTED_REL)
  await new Promise(resolve => model.listen(MODEL_PORT, '127.0.0.1', resolve))
  host = startHost()
  host.stderr.on('data', data => { hostStderr += data.toString() })
  await waitReady()

  // 用「确认模式」跑：只有选中文件该被放行，别的文件必须停下来问
  await json('/config', 'POST', { endpoint: 'http://127.0.0.1:' + MODEL_PORT + '/chat/completions', model: 'fake', apiKey: 'k', approvalMode: 'confirm' })
  await json('/project', 'POST', { projectRoot: PROJECT })

  console.log('')
  console.log('########## 1. 修选中的文件：不弹确认卡，直接落盘 ##########')
  const events = await stream('/chat/stream', { sessionId: 'grant-1', message: '把这两个角色都改一下' })
  const result = events.find(event => event.type === 'result')
  if (process.env.YAMI_TEST_DEBUG === '1') {
    const types = events.map(event => event.type + (event.phase ? ':' + event.phase : ''))
    console.log('  [debug] 事件序列: ' + types.join(' | '))
    for (const event of events) if (event.type === 'tool') console.log('  [debug] ' + JSON.stringify({ phase: event.phase, key: event.key, name: event.name, target: event.target }).slice(0, 200))
    console.log('  [debug] result: ' + JSON.stringify(result).slice(0, 400))
    console.log('  [debug] 模型请求轮数: ' + modelRequests.length)
    console.log('  [debug] stderr: ' + hostStderr.split('\n').filter(line => line.trim()).slice(-8).join(' | '))
  }
  const selectedAfter = fs.readFileSync(selectedAbs, 'utf8')
  check('选中的文件当场就被改了（不需要点确认）', selectedAfter !== selectedBefore, '长度 ' + selectedBefore.length + ' → ' + selectedAfter.length)
  check('选中的文件确实带上了这次改动', /__selection_grant_probe/.test(selectedAfter))
  const selectedToolEvents = events.filter(event => event.type === 'tool' && event.key === 'call_selected')
  check('选中文件的工具卡片是 done（不是等待确认）', selectedToolEvents.some(event => event.phase === 'done') && !selectedToolEvents.some(event => event.phase === 'approval'),
    selectedToolEvents.map(event => event.phase).join(','))
  check('面板如实说明「这是你打开着的文件，直接改」', events.some(event => event.type === 'notice' && /打开着的文件/.test(String(event.text || ''))))

  console.log('')
  console.log('########## 2. 改别的文件：必须停下来等确认 ##########')
  check('另一个文件在审批之前一个字节都没动', fs.readFileSync(otherAbs, 'utf8') === otherBefore)
  const otherApproval = events.find(event => event.type === 'tool' && event.phase === 'approval' && event.key === 'call_other')
  check('另一个文件弹出了确认卡', !!otherApproval, otherApproval ? otherApproval.name : '没有 approval 事件')
  check('整轮停在审批状态', !!(result && result.status === 'approval'), result && result.status)
  const approvalTarget = result && result.approval && result.approval.target
  check('审批卡指向的是那个没打开的文件', String(approvalTarget || '').indexOf('怪物002') !== -1, String(approvalTarget || ''))

  console.log('')
  console.log('########## 3. 点「执行修改」之后才真正写盘 ##########')
  const approved = await json('/approve', 'POST', { sessionId: 'grant-1' })
  check('批准后写盘成功', approved && approved.ok === true, approved && approved.status)
  check('另一个文件这时才被改动', fs.readFileSync(otherAbs, 'utf8') !== otherBefore)
  check('审批与预检确实走了真桥（不是静默跳过）', actionLog.filter(name => name === 'preflight').length >= 2, actionLog.join(','))

  console.log('')
  console.log('########## 选中文件放行：' + passed + ' PASS / ' + failed + ' FAIL ##########')
  host.kill()
  model.close()
  editor.close()
  process.exit(failed ? 1 : 0)
}

process.on('exit', () => { try { if (host) host.kill() } catch { /* 忽略 */ } })

main().catch(error => { console.error(error && error.stack || error); if (host) host.kill(); process.exit(1) })
