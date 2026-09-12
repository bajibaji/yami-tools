'use strict'
/**
 * 思考模式（开关 + 强度）与 reasoning_content 回传回归测试（零依赖）
 *
 * 依据官方文档（api-docs.deepseek.com/zh-cn/guides/thinking_mode）：
 *   · 开关：{"thinking":{"type":"enabled"|"disabled"}}
 *   · 强度：reasoning_effort = low | high | max（默认 high）
 *   · **带 tools 的请求，后续每一轮必须完整回传历史 reasoning_content，否则 API 返回 400**
 *
 * 用法: node tests/test-thinking-mode.cjs
 */
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const TOKEN = 'thinking-test-token'
const AI_PORT = 19300 + Math.floor(Math.random() * 100)
const MODEL_PORT = 19800 + Math.floor(Math.random() * 100)   // 与宿主端口分离，避免撞号

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

// 假模型：第一轮强制工具调用（制造多轮），并把每次收到的请求体落盘
const FAKE_MCP = `'use strict'
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  let m; try { m = JSON.parse(line) } catch { return }
  const reply = r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\\n')
  if (m.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} })
  if (m.method === 'tools/list') return reply({ tools: [{ name: 'slow_read', description: 'r', readOnlyHint: true, inputSchema: { type: 'object', properties: {} } }] })
  if (m.method === 'tools/call') return reply({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] })
  reply({})
})
`

let turn = 0
const seen = []
const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    turn++
    seen.push({
      turn,
      thinking: body.thinking || null,
      effort: body.reasoning_effort || null,
      temperature: body.temperature === undefined ? null : body.temperature,
      assistantReasoning: (body.messages || []).filter(x => x.role === 'assistant').map(x => x.reasoning_content || null),
      toolMessages: (body.messages || []).filter(x => x.role === 'tool').length,
      streamOptions: body.stream_options || null,
      toolChoice: body.tool_choice || null
    })
    const push = chunks => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }
    if (turn === 1) {
      return push([
        { choices: [{ delta: { reasoning_content: '先调用工具。' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'slow_read', arguments: '{}' } }] } }] }
      ])
    }
    push([
      { choices: [{ delta: { reasoning_content: '看到结果了。' } }] },
      { choices: [{ delta: { content: '完成了。' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 2000, completion_tokens: 400, prompt_cache_hit_tokens: 1500 } }
    ])
  })
})

function startHost(sandbox) {
  const child = spawn(process.execPath, [path.join(sandbox, 'ai-host.js')], {
    cwd: sandbox,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: path.join(sandbox, 'cfg'),
      YAMI_PROJECT_ROOT: FIXTURE
    }
  })
  child.stderrText = ''
  child.stderr.on('data', c => { child.stderrText += c.toString() })
  return child
}

function request(route, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method,
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      let buffer = ''
      const events = []
      const isStream = String(res.headers['content-type'] || '').includes('event-stream')
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk
        if (!isStream) return
        let i
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, i); buffer = buffer.slice(i + 2)
          const line = block.split('\n').find(x => x.startsWith('data:'))
          if (line) { try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 忽略 */ } }
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

async function main() {
  await new Promise(r => model.listen(MODEL_PORT, '127.0.0.1', r))
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-thinking-'))
  fs.writeFileSync(path.join(sandbox, 'ai-host.js'), fs.readFileSync(path.join(ROOT, 'ai-host.js'), 'utf8'))
  fs.mkdirSync(path.join(sandbox, 'runtime', 'yami-mcp', 'modules'), { recursive: true })
  fs.writeFileSync(path.join(sandbox, 'runtime', 'yami-mcp', 'server.js'), FAKE_MCP)
  // 整个 modules 目录都要拷：宿主还 require 了 message-pairs 等共享模块，
  // 只挑单个文件复制的话，将来每加一个模块都会让这个套件在沙箱里 MODULE_NOT_FOUND
  fs.cpSync(path.join(ROOT, 'runtime', 'yami-mcp', 'modules'), path.join(sandbox, 'runtime', 'yami-mcp', 'modules'), { recursive: true })
  const host = startHost(sandbox)
  let ready = false
  for (let i = 0; i < 60; i++) {
    try { const s = await request('/status', 'GET'); if (s && s.ok) { ready = true; break } } catch { /* 等等 */ }
    await new Promise(r => setTimeout(r, 100))
  }
  if (!ready) throw new Error('宿主未就绪；stderr：' + host.stderrText.slice(-500))
  try {
    console.log('\n########## 1. 思考模式开启 + 强度 ##########')
    const saved = await request('/config', 'POST', { baseUrl: `http://127.0.0.1:${MODEL_PORT}`, model: 'deepseek-flash', apiKey: 'k', thinkingMode: 'enabled', thinkingEffort: 'max' })
    check('配置保存思考开关与强度', saved.thinkingMode === 'enabled' && saved.thinkingEffort === 'max', JSON.stringify({ mode: saved.thinkingMode, effort: saved.thinkingEffort }))

    await request('/chat/stream', 'POST', { sessionId: 'think-1', message: '列出脚本' })
    check('请求体带 thinking.enabled', seen[0].thinking && seen[0].thinking.type === 'enabled', JSON.stringify(seen[0].thinking))
    check('请求体带 reasoning_effort=max', seen[0].effort === 'max', String(seen[0].effort))
    check('思考模式下不传 temperature（官方明确不生效）', seen[0].temperature === null, String(seen[0].temperature))
    check('流式请求带 stream_options.include_usage（否则拿不到用量）', !!(seen[0].streamOptions && seen[0].streamOptions.include_usage === true), JSON.stringify(seen[0].streamOptions))
    check('tool_choice 固定 auto（思考模式不支持 required/指定工具）', seen[0].toolChoice === 'auto', String(seen[0].toolChoice))

    console.log('\n########## 2. reasoning_content 多轮回传（带 tools 时官方硬要求）##########')
    check('发生了第二轮请求（工具调用后继续）', seen.length >= 2, '轮数=' + seen.length)
    check('第二轮带回了上一轮的 reasoning_content', seen[1].assistantReasoning.includes('先调用工具。'), JSON.stringify(seen[1].assistantReasoning))
    check('第二轮同样保持思考模式', seen[1].thinking && seen[1].thinking.type === 'enabled' && seen[1].effort === 'max')
    check('工具结果仍在上下文里', seen[1].toolMessages >= 1, 'tool 消息数=' + seen[1].toolMessages)

    console.log('\n########## 3. 关闭思考模式 ##########')
    await request('/config', 'POST', { thinkingMode: 'disabled', thinkingEffort: 'high' })
    await request('/chat/stream', 'POST', { sessionId: 'think-2', message: '再来一次' })
    const off = seen[seen.length - 1]
    check('关闭后 thinking.type=disabled', off.thinking && off.thinking.type === 'disabled', JSON.stringify(off.thinking))
    check('关闭后不传 reasoning_effort', off.effort === null, String(off.effort))
    check('关闭后恢复 temperature', off.temperature !== null, String(off.temperature))

    console.log('\n########## 4. 用量与费用估算 ##########')
    const status = await request('/status?sessionId=think-2', 'GET')
    check('/status 报出用量话术', typeof status.usageText === 'string' && /tokens/.test(status.usageText), String(status.usageText).slice(0, 60))
    const pricingResult = await request('/pricing', 'POST', {})
    check('/pricing 给出当前时段单价', pricingResult.ok === true && !!pricingResult.price, JSON.stringify(pricingResult.price || {}).slice(0, 80))
    check('/pricing 附带官方价目表', !!pricingResult.table && !!pricingResult.table['deepseek-flash'])

    console.log('\n########## 5. 流式事件契约（前端靠它渲染思考过程）##########')
    await request('/config', 'POST', { thinkingMode: 'enabled', thinkingEffort: 'high' })
    const streamEvents = await request('/chat/stream', 'POST', { sessionId: 'think-3', message: '列出脚本' })
    const reasoningDeltas = streamEvents.filter(e => e.type === 'delta' && e.reasoning)
    const contentDeltas = streamEvents.filter(e => e.type === 'delta' && e.content)
    check('流里带 reasoning 片段', reasoningDeltas.length >= 1, '片段数=' + reasoningDeltas.length)
    check('reasoning 片段是原文（前端逐段累积即得完整思考）', ['先调用工具。', '看到结果了。'].includes(reasoningDeltas.map(e => e.reasoning).join('')), JSON.stringify(reasoningDeltas.map(e => e.reasoning)))
    check('reasoning 与 content 分开推送（前端才能分块显示）', contentDeltas.every(e => !e.reasoning), 'content 片段数=' + contentDeltas.length)
    check('正文片段照常推送', contentDeltas.length >= 1, '正文片段数=' + contentDeltas.length)
    check('结束仍有 result 事件（收尾思考块的时长/字数）', streamEvents.some(e => e.type === 'result'), streamEvents.map(e => e.type).join(','))
  } finally {
    host.kill()
    model.close()
    // Windows 上刚 kill 的子进程还可能握着沙箱目录里的句柄，rmSync 会抛 EPERM；
    // 清理失败不该把一个全绿的套件判成失败 —— 重试几次，仍失败就如实记一行警告。
    let cleaned = false
    for (let i = 0; i < 5 && !cleaned; i++) {
      try { fs.rmSync(sandbox, { recursive: true, force: true }); cleaned = true }
      catch (e) { await new Promise(resolve => setTimeout(resolve, 150)) }
    }
    if (!cleaned) console.warn('提示: 测试沙箱目录未能清理（Windows 句柄占用，不影响结论）: ' + sandbox)
  }

  console.log(`\n########## 思考模式测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
