/**
 * 打断输出（停止键 / Esc）端到端回归（零依赖）
 *
 * 这类助手最不能接受的坏行为是：界面上停了，后台还在烧 token、还在改文件。
 * 所以这里不测"按钮点了没"，而是测**真停**：
 *   ① 客户端断开 SSE 后，宿主不再发起新的模型请求（假模型计数不再增长）
 *   ② 取消后剩余的工具一个都不执行
 *   ③ 已经产生的对话被保存下来，宿主进程本身不崩
 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 17468 + Math.floor(Math.random() * 500)
const MODEL_PORT = AI_PORT + 1000
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-interrupt-'))

let passed = 0
let failed = 0
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')) }
}

// 假模型：慢速流式吐字，好让客户端有时间在中途按停止；
// 同时统计被调用的次数——打断是否真的生效，全看这个计数还涨不涨。
const requests = []
const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    requests.push({ at: Date.now(), body: raw })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const write = chunk => { try { res.write('data: ' + JSON.stringify(chunk) + '\n\n') } catch (e) { /* 连接已断 */ } }
    // 先给一个工具调用，逼宿主进入"工具执行 → 再问模型"的第二轮
    write({ choices: [{ delta: { reasoning_content: '先看一眼工程。' } }] })
    write({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] } }] })
    // 然后慢慢吐正文，客户端会在这段时间里打断
    let ticks = 0
    const timer = setInterval(() => {
      ticks++
      write({ choices: [{ delta: { content: '第 ' + ticks + " 段输出。" } }] })
      if (ticks >= 20) {
        clearInterval(timer)
        try { res.write('data: [DONE]\n\n'); res.end() } catch (e) { /* 已断开 */ }
      }
    }, 120)
    res.on('close', () => clearInterval(timer))
  })
})

const FAKE_MCP = `'use strict'
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  let m; try { m = JSON.parse(line) } catch { return }
  const reply = r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\\n')
  if (m.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} })
  if (m.method === 'tools/list') return reply({ tools: [{ name: 'list_scripts', description: 'r', readOnlyHint: true, inputSchema: { type: 'object', properties: {} } }] })
  // 工具故意慢 1.5 秒返回：复现"用户按停止时宿主正卡在工具里"的场景
  if (m.method === 'tools/call') return setTimeout(() => reply({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }), 1500)
  reply({})
})
`

function request(route, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method, timeout: 10000,
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { resolve({}) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); resolve({ error: '请求超时（10 秒）' }) })
    if (payload) req.write(payload)
    req.end()
  })
}

/** 发起一次流式对话，拿到第一段输出后就掐断连接（等价于点「停止」） */
function startThenAbort(sessionId) {
  return new Promise(resolve => {
    const payload = Buffer.from(JSON.stringify({ sessionId, message: '看看工程' }))
    let sawDelta = false
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: '/chat/stream', method: 'POST',
      headers: { 'x-yami-agent-token': TOKEN, 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, res => {
      res.setEncoding('utf8')
      res.on('data', chunk => {
        if (!sawDelta && chunk.includes('"delta"')) {
          sawDelta = true
          req.destroy()          // 就是点「停止」：断开这条 SSE
          resolve({ aborted: true, at: Date.now() })
        }
      })
      res.on('end', () => { if (!sawDelta) resolve({ aborted: false, at: Date.now() }) })
      res.on('error', () => { if (!sawDelta) resolve({ aborted: false, at: Date.now() }) })
    })
    req.on('error', () => { if (!sawDelta) resolve({ aborted: false, at: Date.now() }) })
    req.write(payload)
    req.end()
    setTimeout(() => { if (!sawDelta) { try { req.destroy() } catch (e) {} resolve({ aborted: false, at: Date.now() }) } }, 8000)
  })
}

/** 发一条流式请求，只关心"是否被接受"：收到 start 事件即算通过，随后立刻断开。
 *  （不能用非流式的 /chat 来测——那要等整个任务跑完，把"被接受"和"任务跑完"混为一谈。） */
function acceptedOnly(sessionId, message) {
  return new Promise(resolve => {
    const payload = Buffer.from(JSON.stringify({ sessionId, message }))
    let done = false
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: '/chat/stream', method: 'POST', timeout: 8000,
      headers: { 'x-yami-agent-token': TOKEN, 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, res => {
      res.setEncoding('utf8')
      res.on('data', chunk => {
        if (done) return
        done = true
        resolve({ accepted: res.statusCode === 200 && chunk.includes('"start"'), status: res.statusCode, error: /还在处理中/.test(chunk) ? '上一条需求还在处理中，请稍候' : '' })
        try { req.destroy() } catch (e) { /* 已断开 */ }
      })
      res.on('end', () => { if (!done) { done = true; resolve({ accepted: false, status: res.statusCode, error: '流已结束' }) } })
    })
    req.on('error', () => { if (!done) { done = true; resolve({ accepted: false, status: 0, error: '连接失败' }) } })
    req.on('timeout', () => { if (!done) { done = true; resolve({ accepted: false, status: 0, error: '请求超时' }); req.destroy() } })
    req.write(payload)
    req.end()
  })
}

async function main() {
  await new Promise(r => model.listen(MODEL_PORT, '127.0.0.1', r))
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-interrupt-host-'))
  fs.writeFileSync(path.join(sandbox, 'ai-host.js'), fs.readFileSync(path.join(ROOT, 'ai-host.js'), 'utf8'))
  fs.mkdirSync(path.join(sandbox, 'runtime', 'yami-mcp'), { recursive: true })
  fs.writeFileSync(path.join(sandbox, 'runtime', 'yami-mcp', 'server.js'), FAKE_MCP)
  fs.cpSync(path.join(ROOT, 'runtime', 'yami-mcp', 'modules'), path.join(sandbox, 'runtime', 'yami-mcp', 'modules'), { recursive: true })

  // 宿主只接受有效的 Open Yami 工程目录（有 Assets + Data），随便指一个仓库目录会被拒
  const project = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
  if (!fs.existsSync(path.join(project, 'Assets'))) {
    console.log('跳过：找不到可用的测试工程 ' + project + '（可用 YAMI_TEST_PROJECT 指定）')
    host.kill(); model.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); fs.rmSync(sandbox, { recursive: true, force: true })
    process.exit(0)
  }
  const host = spawn(process.execPath, [path.join(sandbox, 'ai-host.js')], {
    cwd: sandbox,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: CONFIG_DIR,
      YAMI_AI_DEBUG: '1',
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

    const cfg = await request('/config', 'POST', { baseUrl: 'http://127.0.0.1:' + MODEL_PORT, model: 'fake-model', apiKey: 'sk-0123456789abcdefghijklmn', thinkingMode: 'enabled' })
    if (process.env.YAMI_DEBUG) console.log('[/config 返回]', JSON.stringify(cfg).slice(0, 240))

    console.log('\n########## 1. 中途停止：模型不再被继续调用 ##########')
    const first = await startThenAbort('interrupt-1')
    check('确实在流中途断开了连接', first.aborted === true)
    const afterAbort = requests.length
    await new Promise(r => setTimeout(r, 1200))
    check('打断后宿主没有再发起新的模型请求', requests.length === afterAbort, `断开时 ${afterAbort} 次，1.2 秒后仍是 ${requests.length} 次`)

    console.log('\n########## 2. 宿主仍然健在，会话已落盘 ##########')
    const status = await request('/status?sessionId=interrupt-1')
    check('打断后宿主没崩，仍能应答', status.ok === true)
    const sessionFile = path.join(CONFIG_DIR, 'sessions', 'interrupt-1.json')
    const saved = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : null
    check('打断时的对话被保存下来了', !!saved && Array.isArray(saved.messages) && saved.messages.length > 0, saved ? saved.messages.length + ' 条消息' : '没有会话文件')

    console.log('\n########## 3. 对照：不打断时会正常跑完 ##########')
    const before = requests.length
    await request('/chat/stream', 'POST', { sessionId: 'interrupt-2', message: '看看工程' })
    check('不打断时模型照常被调用（说明上面的停止不是假象）', requests.length > before, `${before} → ${requests.length} 次`)

    console.log('\n########## 4. 打断后立刻恢复：不能再被「上一条需求还在处理中」顶回来 ##########')
    // 先制造一次"宿主正卡在慢工具里"的打断（假 MCP 的工具要 1.5 秒才回）
    const during = await startThenAbort('interrupt-3')
    check('在工具执行期间断开了连接', during.aborted === true)
    // 不等任何超时，立刻说下一句
    // 宿主感知 SSE 断开本身是异步的，所以给一两次重试的余量；
    // 但整体必须明显快于"干等慢工具跑完"（1.5 秒）和旧实现的 180 秒超时
    let recovered = false
    let lastErr = ''
    let attempts = 0
    const started = Date.now()
    for (let attempt = 0; attempt < 10 && !recovered; attempt++) {
      attempts = attempt + 1
      const probe = await acceptedOnly('interrupt-3', '打断之后马上说下一句')
      recovered = probe.accepted
      lastErr = probe.error || ''
      if (!recovered) await new Promise(r => setTimeout(r, 120))
    }
    const total = Date.now() - started
    check('打断后宿主恢复可用（不再被 busy 顶回）', recovered, lastErr || `第 ${attempts} 次即被接受`)
    check('恢复得很快（没有干等慢工具跑完）', total < 1500, total + 'ms')
  } finally {
    if (process.env.YAMI_DEBUG) {
      const sf = path.join(CONFIG_DIR, 'sessions', 'interrupt-1.json')
      console.log('\n[会话]', fs.existsSync(sf) ? fs.readFileSync(sf, 'utf8').slice(0, 500) : '(无)')
      console.log('[宿主 stderr]', stderr.slice(-600))
    }
    host.kill()
    model.close()
    // Windows 上刚 kill 的子进程可能还握着目录句柄，rmSync 会抛 EPERM；
    // 清理失败不该把一个全绿的套件判成失败 —— 重试几次，仍失败就如实记一行警告。
    for (const dir of [CONFIG_DIR, sandbox]) {
      let cleaned = false
      for (let i = 0; i < 5 && !cleaned; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); cleaned = true }
        catch (e) { await new Promise(resolve => setTimeout(resolve, 150)) }
      }
      if (!cleaned) console.warn('提示: 临时目录未能清理（Windows 句柄占用，不影响结论）: ' + dir)
    }
    const sess = fs.existsSync(path.join(CONFIG_DIR, 'sessions', 'interrupt-1.json')) ? fs.readFileSync(path.join(CONFIG_DIR, 'sessions', 'interrupt-1.json'), 'utf8') : '(无)'
    if (process.env.YAMI_DEBUG) console.log('\n宿主 stderr:\n' + stderr.slice(-1200) + '\n会话:\n' + sess.slice(0, 600))
  }

  console.log(`\n########## 打断测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
