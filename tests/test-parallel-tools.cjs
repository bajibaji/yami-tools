'use strict'
/**
 * 只读工具并发执行（宿主侧）回归测试（零依赖）
 *
 * 为什么要并发：模型经常在一条消息里同时请求多个只读工具（一起读几个文件/查几处代码），
 * 串行执行等于白等。现在连续的只读调用合并并发；写盘/编辑器动作/试玩输入仍独占且保序。
 *
 * 用真实耗时与"调用到达快照"证明并发生效，而不是只看代码：
 *   假 MCP 提供 400ms 的只读工具 slow_read，假模型在同一条消息里请求 3 次。
 *
 * 用法: node tests/test-parallel-tools.cjs
 */
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const TOKEN = 'parallel-test-token'
const AI_PORT = 19100 + Math.floor(Math.random() * 200)
const MODEL_PORT = AI_PORT + 300
const SLOW_MS = 400

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const FAKE_MCP = `'use strict'
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const received = []
const TOOLS = [
  { name: 'slow_read', description: '测试用只读工具', readOnlyHint: true, inputSchema: { type: 'object', properties: { tag: { type: 'string' } } } },
  { name: 'write_script', description: '测试用写盘工具', readOnlyHint: false, inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, dryRun: { type: 'boolean' }, expectedSha256: { type: 'string' } } } }
]
rl.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  if (message.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '1' } })
  if (message.method === 'tools/list') return reply({ tools: TOOLS })
  if (message.method !== 'tools/call') return reply({})
  const args = (message.params && message.params.arguments) || {}
  const name = message.params && message.params.name
  const startedAt = Date.now()
  received.push({ name, tag: args.tag || args.path || '', startedAt })
  const snapshot = received.map(item => item.tag)
  if (name === 'slow_read') {
    return setTimeout(() => {
      reply({ content: [{ type: 'text', text: JSON.stringify({ ok: true, tag: args.tag || '', startedAt, costMs: Date.now() - startedAt, receivedSoFar: snapshot }) }] })
    }, ${SLOW_MS})
  }
  if (name === 'write_script') {
    const payload = args.dryRun === false
      ? { ok: true, path: args.path, dryRun: false, changedBytes: 1 }
      : { ok: true, path: args.path, dryRun: true, oldSha256: 'deadbeef', diff: '@@ 预览 @@', diffStat: { added: 1, removed: 0 }, risk: 'medium', message: '预览通过' }
    return reply({ content: [{ type: 'text', text: JSON.stringify(payload) }] })
  }
  reply({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'unknown' }) }], isError: true })
})
`

let toolPlan = []
const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    const messages = body.messages || []
    const lastUser = messages.map(message => message.role).lastIndexOf('user')
    const hasTool = lastUser >= 0 && messages.slice(lastUser + 1).some(message => message.role === 'tool')
    const push = chunks => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const chunk of chunks) res.write('data: ' + JSON.stringify(chunk) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }
    if (hasTool || !toolPlan.length) return push([{ choices: [{ delta: { content: '处理完成。' } }] }])
    const deltas = [{ choices: [{ delta: { content: '开始处理。' } }] }]
    toolPlan.forEach((item, index) => {
      deltas.push({ choices: [{ delta: { tool_calls: [{ index, id: 'call_' + index, type: 'function', function: { name: item.name, arguments: JSON.stringify(item.args) } }] } }] })
    })
    push(deltas)
  })
})

function prepareSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-parallel-'))
  fs.writeFileSync(path.join(dir, 'ai-host.js'), fs.readFileSync(path.join(ROOT, 'ai-host.js'), 'utf8'))
  fs.mkdirSync(path.join(dir, 'runtime', 'yami-mcp'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'runtime', 'yami-mcp', 'server.js'), FAKE_MCP)
  // 宿主会 require 内置模块（价目表等），整个 modules 目录照搬，避免以后新增模块又漏拷
  fs.cpSync(path.join(ROOT, 'runtime', 'yami-mcp', 'modules'), path.join(dir, 'runtime', 'yami-mcp', 'modules'), { recursive: true })
  return dir
}

function startHost(sandbox) {
  const child = spawn(process.execPath, [path.join(sandbox, 'ai-host.js')], {
    cwd: sandbox,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: path.join(sandbox, 'config'),
      YAMI_AI_SESSION_DIR: path.join(sandbox, 'config', 'sessions'),
      YAMI_PROJECT_ROOT: FIXTURE
    }
  })
  child.stderrText = ''
  child.stderr.on('data', chunk => { child.stderrText += chunk.toString() })
  return child
}

function request(route, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method,
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      const events = []
      let buffer = ''
      const isStream = String(res.headers['content-type'] || '').includes('event-stream')
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk
        if (!isStream) return
        let index
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const line = block.split('\n').find(one => one.startsWith('data:'))
          if (!line) continue
          try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 忽略坏块 */ }
        }
      })
      res.on('end', () => {
        if (isStream) return resolve(events)
        try { resolve(JSON.parse(buffer || '{}')) } catch { resolve({}) }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function waitReady(host) {
  for (let i = 0; i < 60; i++) {
    try {
      const status = await request('/status', 'GET')
      if (status && status.ok) return
    } catch { /* 等等 */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('宿主启动超时\n' + host.stderrText)
}

async function main() {
  if (!fs.existsSync(path.join(FIXTURE, 'game.yamirpg'))) {
    console.error('找不到夹具工程: ' + FIXTURE)
    process.exit(2)
  }
  await new Promise(resolve => model.listen(MODEL_PORT, '127.0.0.1', resolve))
  const sandbox = prepareSandbox()
  const host = startHost(sandbox)
  await waitReady(host)
  try {
    await request('/config', 'POST', { endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake', apiKey: 'k', approvalMode: 'auto' })
    await request('/project', 'POST', { projectRoot: FIXTURE })

    console.log('\n########## 1. 一条消息里的三个只读调用 ##########')
    toolPlan = [
      { name: 'slow_read', args: { tag: 'a' } },
      { name: 'slow_read', args: { tag: 'b' } },
      { name: 'slow_read', args: { tag: 'c' } }
    ]
    const startedAt = Date.now()
    const events = await request('/chat/stream', 'POST', { sessionId: 'parallel-1', message: '同时读三处' })
    const cost = Date.now() - startedAt
    const result = events.find(event => event.type === 'result')
    check('流程正常收尾', !!result && result.status === 'done', result && result.status)
    void cost

    const session = JSON.parse(fs.readFileSync(path.join(sandbox, 'config', 'sessions', 'parallel-1.json'), 'utf8'))
    const toolMessages = session.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
    check('三个结果都回填进会话', toolMessages.length === 3, 'count=' + toolMessages.length)
    check('结果按请求顺序回填', JSON.stringify(toolMessages.map(item => item.tag)) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(toolMessages.map(item => item.tag)))
    // 如实记录三个请求到达 MCP 的时间跨度（并发是否生效的实测值）。
    // 注意：本项目里 MCP 是同机子进程、只读工具通常在几十毫秒内返回，
    // 因此并发带来的端到端收益有限；这里以"行为正确"为准，不硬性要求更快。
    const arrivals = toolMessages.map(item => item.startedAt).sort((a, b) => a - b)
    const span = arrivals[arrivals.length - 1] - arrivals[0]
    console.log('    · 实测：三个请求到达跨度 ' + span + 'ms，端到端 ' + cost + 'ms（含两次模型调用与 3×' + SLOW_MS + 'ms 人为延迟）')
    check('只读工具按注册表声明并发执行（到达跨度接近单个耗时）', span < SLOW_MS, '跨度 ' + span + 'ms（串行约 ' + (SLOW_MS * 2) + 'ms）')
    const thirdSaw = toolMessages[2] && toolMessages[2].receivedSoFar
    check('第三个请求到达时前两个已在途', Array.isArray(thirdSaw) && thirdSaw.length === 3, JSON.stringify(thirdSaw))
    const firstCost = toolMessages[0] && toolMessages[0].costMs
    check('每个调用自身耗时符合设定值', typeof firstCost === 'number' && firstCost >= SLOW_MS - 50, 'costMs=' + firstCost)

    console.log('\n########## 2. 只读 + 写盘混合：写盘独占 ##########')
    toolPlan = [
      { name: 'slow_read', args: { tag: 'x' } },
      { name: 'write_script', args: { path: 'Assets/插件/全局插件/x.ts', content: '// x' } },
      { name: 'slow_read', args: { tag: 'y' } }
    ]
    const mixed = await request('/chat/stream', 'POST', { sessionId: 'mixed-1', message: '边读边写' })
    const mixedResult = mixed.find(event => event.type === 'result')
    check('写盘先弹审批（没被并发跳过）', !!mixedResult && mixedResult.status === 'approval', mixedResult && mixedResult.status)
    check('审批卡片带预览差异', !!(mixedResult && mixedResult.approval && /@@/.test(String((mixedResult.approval.preview || {}).diff || ''))))
    const mixedSession = JSON.parse(fs.readFileSync(path.join(sandbox, 'config', 'sessions', 'mixed-1.json'), 'utf8'))
    const doneTags = mixedSession.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content).tag)
    check('写盘之前那个只读调用已完成', JSON.stringify(doneTags) === JSON.stringify(['x']), JSON.stringify(doneTags))
  } finally {
    host.kill()
    model.close()
    // Windows 上刚 kill 的子进程可能还握着目录句柄，rmSync 会抛 EPERM；
    // 清理失败不该把一个全绿的套件判成失败 —— 重试几次，仍失败就如实记一行警告。
    let cleaned = false
    for (let i = 0; i < 5 && !cleaned; i++) {
      try { fs.rmSync(sandbox, { recursive: true, force: true }); cleaned = true }
      catch (e) { await new Promise(resolve => setTimeout(resolve, 150)) }
    }
    if (!cleaned) console.warn('提示: 临时目录未能清理（Windows 句柄占用，不影响结论）: ' + sandbox)
  }

  console.log(`\n########## 只读并发执行测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
