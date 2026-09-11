/**
 * 消息序列自愈（assistant.tool_calls 必须有 tool 应答）回归（零依赖）
 *
 * 真实事故（本次故障的复现）：模型空转被"空转保护"自动停止时，那条带 tool_calls 的
 * assistant 消息没有任何应答就落了盘。此后用户每说一句话都被上游 400 拒绝——
 *   An assistant message with 'tool_calls' must be followed by tool messages ...
 * 面板上只显示一句跟设置毫无关系的报错，用户完全无从下手，整个会话就此报废。
 *
 * 所以这里既测修复函数，也测两条真实路径：
 *   ① 单元：悬挂调用补应答 / 孤儿与重复应答剔除 / 压缩切点不切断配对
 *   ② 端到端：空转保护停止后，落盘的历史仍然合法（坏序列不再产生）
 *   ③ 端到端：磁盘上已有的坏会话（事故现场），在用户开口前被自动治好
 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const pairs = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'message-pairs'))

const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 17968 + Math.floor(Math.random() * 400)
const MODEL_PORT = AI_PORT + 1000
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-pairs-'))
const SESSION_DIR = path.join(CONFIG_DIR, 'sessions')

let passed = 0
let failed = 0
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')) }
}

/* ------------------------------ 单元：修复函数 ------------------------------ */

function call(id, name) {
  return { id, type: 'function', function: { name: name || 'list_scripts', arguments: '{}' } }
}

function unitTests() {
  console.log('\n########## 1. 单元：悬挂调用必须补应答 ##########')
  const dangling = [
    { role: 'system', content: 's' },
    { role: 'user', content: '看看工程' },
    { role: 'assistant', content: '', tool_calls: [call('c1'), call('c2')] },
    { role: 'user', content: '是吗?' }
  ]
  const fixed = pairs.repairToolPairs(dangling, { reason: '测试' })
  check('补上了缺失的应答', fixed.fixes.filled === 2, '补 ' + fixed.fixes.filled + ' 条')
  check('修复后序列合法', pairs.findSequenceProblems(fixed.messages).length === 0, pairs.findSequenceProblems(fixed.messages).join('; '))
  const answerIndex = fixed.messages.findIndex(m => m.role === 'tool')
  check('应答紧跟其 assistant（插在 user 消息之前）', answerIndex === 3, '位置 ' + answerIndex)
  check('入参未被就地修改', dangling.length === 4 && !dangling.some(m => m.role === 'tool'))
  check('占位内容说明了"未执行"', /notExecuted/.test(fixed.messages[3].content))

  console.log('\n########## 2. 单元：孤儿与重复应答要被剔除 ##########')
  const messy = [
    { role: 'system', content: 's' },
    { role: 'tool', tool_call_id: 'ghost', content: '{}' },
    { role: 'assistant', content: '', tool_calls: [call('c1')] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'user', content: '继续' }
  ]
  const cleaned = pairs.repairToolPairs(messy, { reason: '测试' })
  check('孤儿工具消息被剔除', cleaned.fixes.droppedOrphan === 1, '剔除 ' + cleaned.fixes.droppedOrphan + ' 条')
  check('重复应答被剔除', cleaned.fixes.droppedDuplicate === 1, '剔除 ' + cleaned.fixes.droppedDuplicate + ' 条')
  check('空 tool_calls 字段被摘掉', cleaned.fixes.droppedEmptyCalls === 1 && !('tool_calls' in cleaned.messages.find(m => m.role === 'assistant' && !m.tool_calls)))
  check('清理后序列合法', pairs.findSequenceProblems(cleaned.messages).length === 0, pairs.findSequenceProblems(cleaned.messages).join('; '))

  console.log('\n########## 3. 单元：合法序列原样保留 ##########')
  const healthy = [
    { role: 'system', content: 's' },
    { role: 'user', content: '看看工程' },
    { role: 'assistant', content: '', tool_calls: [call('c1')] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    { role: 'assistant', content: '看完了' }
  ]
  const untouched = pairs.repairToolPairs(healthy, { reason: '测试' })
  check('没有误报（changed 为 false）', untouched.changed === false)
  check('消息条数与顺序不变', untouched.messages.length === healthy.length)

  console.log('\n########## 4. 单元：压缩切点不得切断配对 ##########')
  const long = [
    { role: 'system', content: 's' },
    { role: 'user', content: '看看工程' },
    { role: 'assistant', content: '', tool_calls: [call('c1')] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    { role: 'assistant', content: '看完了' }
  ]
  const start = pairs.alignTailStart(long, 2)   // 朴素切点会落在 tool 消息上
  check('切点向前对齐到 assistant', long[start].role === 'assistant', '起点角色 ' + long[start].role)
  check('对齐后尾部序列合法', pairs.findSequenceProblems(long.slice(start)).length === 0)
  check('朴素切点确实会切断配对（对照）', pairs.findSequenceProblems(long.slice(-2)).length > 0)
}

/* ------------------------------ 端到端：真实宿主 ------------------------------ */

let callCount = 0
const seen = []

const FAKE_MCP = `'use strict'
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  let m; try { m = JSON.parse(line) } catch { return }
  const reply = r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\\n')
  if (m.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} })
  if (m.method === 'tools/list') return reply({ tools: [{ name: 'list_scripts', description: 'r', readOnlyHint: true, inputSchema: { type: 'object', properties: {} } }] })
  if (m.method === 'tools/call') return reply({ content: [{ type: 'text', text: JSON.stringify({ ok: true, scripts: [] }) }] })
  reply({})
})
`

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const chunk of chunks) res.write('data: ' + JSON.stringify(chunk) + '\n\n')
  res.write('data: [DONE]\n\n')
  res.end()
}

// 假模型：每次请求都**先校验消息序列**，不合法就照上游原样回 400。
// 这样"宿主有没有把历史修好"不是靠读代码判断，而是由请求本身证明。
const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch (e) { /* 忽略 */ }
    callCount++
    const problems = pairs.findSequenceProblems(body.messages)
    seen.push({ n: callCount, problems, messages: body.messages })
    if (problems.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        error: {
          message: "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)",
          type: 'invalid_request_error'
        }
      }))
    }
    // 前 4 次都回同一批工具调用：逼宿主触发"空转保护"（连续 3 次相同即止）
    if (callCount <= 4) {
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_loop' + callCount, type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
      ])
    }
    sse(res, [
      { choices: [{ delta: { content: '收到，工程没问题。' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
    ])
  })
})

function request(route, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method,
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { resolve({}) } })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function main() {
  unitTests()

  await new Promise(r => model.listen(MODEL_PORT, '127.0.0.1', r))
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-pairs-host-'))
  fs.writeFileSync(path.join(sandbox, 'ai-host.js'), fs.readFileSync(path.join(ROOT, 'ai-host.js'), 'utf8'))
  fs.mkdirSync(path.join(sandbox, 'runtime', 'yami-mcp'), { recursive: true })
  fs.writeFileSync(path.join(sandbox, 'runtime', 'yami-mcp', 'server.js'), FAKE_MCP)
  fs.cpSync(path.join(ROOT, 'runtime', 'yami-mcp', 'modules'), path.join(sandbox, 'runtime', 'yami-mcp', 'modules'), { recursive: true })

  const project = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
  if (!fs.existsSync(path.join(project, 'Assets'))) {
    console.log('\n跳过端到端：找不到可用的测试工程 ' + project + '（可用 YAMI_TEST_PROJECT 指定）')
    model.close()
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true })
    fs.rmSync(sandbox, { recursive: true, force: true })
    console.log(`\n########## 消息序列自愈: ${passed} PASS / ${failed} FAIL ##########`)
    process.exit(failed > 0 ? 1 : 0)
  }

  // 事故现场：磁盘上已经躺着一条"带 tool_calls 却没有应答"的坏会话
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  fs.writeFileSync(path.join(SESSION_DIR, 'broken.json'), JSON.stringify({
    id: 'broken',
    updatedAt: Date.now(),
    messages: [
      { role: 'system', content: '你是 Open Yami 开发副驾。' },
      { role: 'user', content: '看看这个 主菜单 场景' },
      { role: 'assistant', content: '', tool_calls: [call('call_stuck', 'list_scripts')] },
      { role: 'user', content: '是吗?' }
    ]
  }))

  const host = spawn(process.execPath, [path.join(sandbox, 'ai-host.js')], {
    cwd: sandbox,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: CONFIG_DIR,
      YAMI_PROJECT_ROOT: project
    }
  })
  let stderr = ''
  host.stderr.on('data', d => { stderr += d })

  try {
    let ready = false
    for (let i = 0; i < 60; i++) {
      try { const s = await request('/status'); if (s.ok) { ready = true; break } } catch (e) { /* 等 */ }
      await new Promise(r => setTimeout(r, 100))
    }
    if (!ready) throw new Error('宿主未就绪：' + stderr.slice(-400))
    await request('/config', 'POST', { baseUrl: 'http://127.0.0.1:' + MODEL_PORT, model: 'fake-model', apiKey: 'sk-0123456789abcdefghijklmn', thinkingMode: 'enabled' })

    console.log('\n########## 5. 端到端：空转保护停止后不留坏序列 ##########')
    const stuck = await request('/chat', 'POST', { sessionId: 'loop-1', message: '看看工程' })
    check('确实由空转保护终止', stuck && stuck.status === 'stuck', String(stuck && stuck.status))
    const loopFile = path.join(SESSION_DIR, 'loop-1.json')
    const loopSaved = JSON.parse(fs.readFileSync(loopFile, 'utf8'))
    const loopProblems = pairs.findSequenceProblems(loopSaved.messages)
    check('落盘的历史没有坏序列（模型停止时的调用已补应答）', loopProblems.length === 0, loopProblems.join('; ') || '合法')
    check('模型侧收到的每一次请求都合法', seen.every(item => item.problems.length === 0), seen.map(item => item.n + ':' + item.problems.length).join(' '))

    console.log('\n########## 6. 端到端：磁盘上的坏会话被自动治好 ##########')
    const loaded = await request('/session/load', 'POST', { sessionId: 'broken' })
    check('会话恢复成功', loaded && loaded.ok === true)
    const brokenOnDisk = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'broken.json'), 'utf8'))
    check('恢复时就把坏序列治好了（无需用户动手）', pairs.findSequenceProblems(brokenOnDisk.messages).length === 0, pairs.findSequenceProblems(brokenOnDisk.messages).join('; ') || '合法')

    const reply = await request('/chat', 'POST', { sessionId: 'broken', message: '继续吧' })
    check('用户能正常聊下去了（不再撞上游 400）', reply && reply.ok === true && /工程没问题/.test(String(reply.message || '')), String(reply && reply.message || '').slice(0, 40))
    check('自愈后发给模型的请求全部合法', seen.every(item => item.problems.length === 0))
    check('宿主没有为此抛错', !/insufficient tool messages/.test(stderr), stderr.split('\n').filter(l => /自愈/.test(l)).join(' | ').slice(0, 120))
  } finally {
    if (process.env.YAMI_DEBUG) console.log('\n[宿主 stderr]\n' + stderr.slice(-1200))
    host.kill()
    model.close()
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true })
    fs.rmSync(sandbox, { recursive: true, force: true })
  }

  console.log(`\n########## 消息序列自愈: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
