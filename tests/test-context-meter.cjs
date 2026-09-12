/**
 * 上下文计量与自动压缩回归（零依赖）
 *
 * 背景（真实故障）：此前用的是「字符预算 240000」，既不是 token 也不是模型真实窗口——
 * DeepSeek 官方给的上下文是 1M token，按中文 0.6 token/字折算，24 万字符只有 14 万 token，
 * 长期过早压缩；而面板上的「240k/240k」是字符数，用户对不上真实用量。
 * 现在的要求：按 1M token 计量、占用到 80% 自动压缩，压缩算法对齐 DeepSeek Harness
 * （context-meter / compaction-basic / tool-result-pruner）。
 *
 * 覆盖：
 *   ① 单元：官方换算口径、工具 schema 计入、窗口/阈值/保留规格、保留范围选择、工具结果头尾修剪、真实用量锚点
 *   ② 端到端：小窗口下占用到 80% 自动触发压缩，产出结构化检查点，占用显著回落，序列仍然合法
 *   ③ 对照：没到阈值时绝不压缩
 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const meter = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'context-meter'))
const pairs = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'message-pairs'))

const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 18368 + Math.floor(Math.random() * 400)
const MODEL_PORT = AI_PORT + 1000
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-ctx-'))
const SESSION_DIR = path.join(CONFIG_DIR, 'sessions')
// 小窗口便于在测试里触发压缩：阈值 = 3000 × 0.8 = 2400 token，保留 = 3000 × 0.16 = 480 token
const TEST_WINDOW = 3000

let passed = 0
let failed = 0
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')) }
}

/* ------------------------------ 单元 ------------------------------ */

function unitTests() {
  console.log('\n########## 1. 单元：换算口径对齐官方文档 ##########')
  // 官方「Token 用量计算」：1 个中文字符 ≈ 0.6 token，1 个英文字符 ≈ 0.3 token
  check('中文 100 字 ≈ 60 token', meter.estimateText('中'.repeat(100)) === 60, String(meter.estimateText('中'.repeat(100))))
  check('英文 100 字符 ≈ 30 token', meter.estimateText('a'.repeat(100)) === 30, String(meter.estimateText('a'.repeat(100))))
  const mixed = meter.estimateText('中文abc')
  check('中英混排按字分类计费', mixed === Math.ceil(2 * 0.6 + 3 * 0.3), String(mixed))
  check('空文本为 0', meter.estimateText('') === 0 && meter.estimateText(null) === 0)

  console.log('\n########## 2. 单元：工具 schema 与消息开销都要计入 ##########')
  const tools = [{ type: 'function', function: { name: 'list_scripts', description: '列出脚本', parameters: { type: 'object', properties: {} } } }]
  check('工具 schema 有开销', meter.estimateTools(tools) > 0, String(meter.estimateTools(tools)))
  check('空工具列表为 0', meter.estimateTools([]) === 0)
  const message = { role: 'user', content: '中文测试' }
  check('消息含角色框架开销', meter.estimateMessage(message) > meter.estimateText('中文测试'), String(meter.estimateMessage(message)))
  const withoutTools = meter.measure([message], { tools: [] })
  const withTools = meter.measure([message], { tools })
  check('计量把工具 schema 算进总量', withTools.tokens > withoutTools.tokens, `${withoutTools.tokens} → ${withTools.tokens}`)

  console.log('\n########## 3. 单元：窗口与阈值规格 ##########')
  const spec = meter.resolveSpec({})
  check('默认窗口为 1M', spec.contextWindow === 1000000, String(spec.contextWindow))
  check('默认阈值 80% → 800k', spec.thresholdTokens === 800000, String(spec.thresholdTokens))
  check('默认保留 16% → 160k', spec.retainTokens === 160000, String(spec.retainTokens))
  const custom = meter.resolveSpec({ contextWindow: TEST_WINDOW })
  check('窗口可配置且阈值随动', custom.thresholdTokens === 2400 && custom.retainTokens === 480, JSON.stringify({ t: custom.thresholdTokens, r: custom.retainTokens }))
  check('非法占比回落到默认值', meter.resolveSpec({ thresholdRatio: 3 }).thresholdRatio === 0.8)

  console.log('\n########## 4. 单元：保留范围按 token 预算从尾部累积 ##########')
  const long = { role: 'user', content: '填'.repeat(2000) }   // 约 1200 token
  const short = { role: 'user', content: '短' }
  const history = [{ role: 'system', content: 's' }, long, short, long, short]
  const startIndex = meter.selectStartIndex(history, 500, { minKeepMessages: 1 })
  check('按 token 预算切到尾部消息', startIndex >= 3, 'startIndex=' + startIndex)
  const byCount = meter.selectStartIndex(history, 10, { minKeepMessages: 4 })
  check('条数下限更保守时以条数为准', byCount === 1, 'startIndex=' + byCount)
  check('system 永不进入折叠范围', meter.selectStartIndex(history, 1, { minKeepMessages: 1 }) >= 1)
  // 条数下限只是偏好：它让保留部分超过窗口阈值时，这次压缩就等于白做，必须按 token 预算收紧
  const tight = meter.selectStartIndex(history, 100, { minKeepMessages: 3, thresholdTokens: 500 })
  const loose = meter.selectStartIndex(history, 100, { minKeepMessages: 3 })
  check('条数下限会撑破阈值时按 token 收紧', tight > loose, `tight=${tight} loose=${loose}`)

  console.log('\n########## 5. 单元：该不该压缩（固定开销压不掉） ##########')
  check('低于阈值时不压缩', meter.shouldCompact({ tokens: 10, toolsTokens: 5, thresholdTokens: 100 }).compact === false)
  check('超过阈值时压缩', meter.shouldCompact({ tokens: 200, toolsTokens: 5, thresholdTokens: 100 }).compact === true)
  const fixed = meter.shouldCompact({ tokens: 2000, toolsTokens: 500, thresholdTokens: 100 })
  check('工具定义本身超过阈值时明确跳过', fixed.compact === false && fixed.reason === 'fixed-overhead', fixed.reason)

  console.log('\n########## 6. 单元：长工具结果改成头尾保留 ##########')
  const huge = { role: 'tool', tool_call_id: 'c1', content: 'A'.repeat(9000) + 'MIDDLE' + 'Z'.repeat(4000) }
  const toolHistory = [
    { role: 'system', content: 's' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_script', arguments: '{}' } }] },
    huge
  ]
  const prunedResult = meter.pruneToolResults(toolHistory)
  check('超长工具结果被修剪', prunedResult.pruned.length === 1, '修剪 ' + prunedResult.pruned.length + ' 条')
  const prunedText = prunedResult.messages[2].content
  check('保留开头', prunedText.startsWith('A'.repeat(100)))
  check('保留结尾（报错原文常在末尾）', prunedText.endsWith('Z'.repeat(100)))
  check('中段有明确标记', prunedText.includes('中段已裁剪'))
  check('确实省下了 token', prunedResult.savedTokens > 0, '省 ' + prunedResult.savedTokens + ' token')
  const shortResult = meter.pruneToolResults([toolHistory[0], toolHistory[1], { role: 'tool', tool_call_id: 'c1', content: 'short' }])
  check('未超预算的工具结果原样保留', shortResult.pruned.length === 0 && shortResult.messages[2].content === 'short')
  check('修剪不破坏配对关系', pairs.findSequenceProblems(prunedResult.messages).length === 0)

  console.log('\n########## 7. 单元：真实用量锚点优先于估算 ##########')
  const anchored = meter.measure(
    [{ role: 'system', content: 's' }, { role: 'user', content: '你好' }],
    { tools, anchor: { messageCount: 2, promptTokens: 12345 } }
  )
  check('有锚点时用锚点值', anchored.calibrated === true && anchored.tokens >= 12345, JSON.stringify({ tokens: anchored.tokens, calibrated: anchored.calibrated }))
  const stale = meter.measure([{ role: 'system', content: 's' }], { tools, anchor: { messageCount: 9, promptTokens: 1 } })
  check('锚点失效时退回估算', stale.calibrated === false)
  check('格式化可读', meter.formatTokens(1000000) === '1M' && meter.formatTokens(320000) === '320k', meter.formatTokens(320000))
}

/* ------------------------------ 端到端 ------------------------------ */

const summaryMarker = '你现在是本 AI 开发助手的压缩引擎'
let summaryCalls = 0
const seen = []

const FAKE_MCP = `'use strict'
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  let m; try { m = JSON.parse(line) } catch { return }
  const reply = r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\\n')
  if (m.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} })
  if (m.method === 'tools/list') return reply({ tools: [{ name: 'list_scripts', description: '列出脚本', readOnlyHint: true, inputSchema: { type: 'object', properties: {} } }] })
  if (m.method === 'tools/call') return reply({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] })
  reply({})
})
`

const CHECKPOINT_REPLY = [
  '## 主要请求与意图',
  '- 用户在测试上下文压缩。',
  '',
  '## 关键技术概念',
  '- （无）',
  '',
  '## 文件与代码',
  '- （无）',
  '',
  '## 错误与修复',
  '- （无）',
  '',
  '## 待办事项',
  '- （无）',
  '',
  '## 当前工作',
  '- 验证自动压缩。',
  '',
  '## 下一步',
  '- 继续对话。',
  '',
  '## 关键上下文',
  '- 窗口 1M token，80% 触发压缩。'
].join('\n')

const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch (e) { /* 忽略 */ }
    const messages = body.messages || []
    const problems = pairs.findSequenceProblems(messages)
    const last = String((messages[messages.length - 1] || {}).content || '')
    const isSummary = last.includes(summaryMarker)
    if (isSummary) summaryCalls++
    seen.push({ problems, isSummary, count: messages.length })
    if (problems.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'." } }))
    }
    // 真实用量：假模型也照官方口径估一遍，再补一点框架开销，好让宿主的「用量锚点」被真正激活
    const promptTokens = meter.estimateMessages(messages) + 50
    const text = isSummary ? CHECKPOINT_REPLY : '收到。'
    const usage = { prompt_tokens: promptTokens, completion_tokens: 12, total_tokens: promptTokens + 12 }
    // 真上游会按 stream 字段分别返回 SSE 与整体 JSON；假模型也必须这样，
    // 否则非流式调用（例如连接体检）会被静默喂错格式
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage }))
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }) + '\n\n')
    res.write('data: [DONE]\n\n')
    res.end()
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
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-ctx-host-'))
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
    console.log(`\n########## 上下文计量与压缩: ${passed} PASS / ${failed} FAIL ##########`)
    process.exit(failed > 0 ? 1 : 0)
  }

  const host = spawn(process.execPath, [path.join(sandbox, 'ai-host.js')], {
    cwd: sandbox,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: CONFIG_DIR,
      YAMI_PROJECT_ROOT: project,
      YAMI_AI_CONTEXT_WINDOW: String(TEST_WINDOW),
      YAMI_AI_CONTEXT_KEEP: '2'
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
    await request('/config', 'POST', { baseUrl: 'http://127.0.0.1:' + MODEL_PORT, model: 'fake-model', apiKey: 'sk-0123456789abcdefghijklmn', thinkingMode: 'disabled' })

    console.log('\n########## 8. 端到端：没到阈值就不压缩 ##########')
    await request('/chat', 'POST', { sessionId: 'cold-1', message: '你好' })
    const cold = await request('/status?sessionId=cold-1')
    check('短对话不触发压缩', cold.context.summary === false)
    check('刻度按 token 与真实窗口显示', /\/3k · \d+%$/.test(String(cold.context.label)), String(cold.context.label))
    check('刻度用了真实用量锚点', cold.context.calibrated === true)

    console.log('\n########## 9. 端到端：占用到 80% 自动压缩 ##########')
    const filler = '这是一段用来把上下文推到阈值以上的中文填充内容。'.repeat(40)   // 约 1200 token/轮
    let compressed = false
    for (let round = 0; round < 10 && !compressed; round++) {
      await request('/chat', 'POST', { sessionId: 'hot-1', message: `第 ${round} 轮：` + filler })
      const state = await request('/status?sessionId=hot-1')
      compressed = state.context.summary === true
      if (!compressed && state.context.nearLimit) {
        // 已经到阈值却还没压缩，说明这一轮之后必然压缩；再问一次让压缩发生
        await request('/chat', 'POST', { sessionId: 'hot-1', message: '继续' })
        const again = await request('/status?sessionId=hot-1')
        compressed = again.context.summary === true
      }
    }
    check('占用到阈值后自动压缩了', compressed === true)
    check('压缩时调用了摘要（走的是压缩指令）', summaryCalls >= 1, '摘要调用 ' + summaryCalls + ' 次')

    const hotFile = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'hot-1.json'), 'utf8'))
    const checkpoint = hotFile.messages.find(m => typeof m.content === 'string' && m.content.includes('<compacted-summary>'))
    check('历史里写入了一条结构化检查点', !!checkpoint)
    check('检查点是 user 消息且带引导语', !!checkpoint && checkpoint.role === 'user' && checkpoint.content.includes('自动生成的检查点'))
    const sections = ['主要请求与意图', '关键技术概念', '文件与代码', '错误与修复', '待办事项', '当前工作', '下一步', '关键上下文']
    const missing = sections.filter(name => !checkpoint || !checkpoint.content.includes('## ' + name))
    check('检查点八节结构完整', missing.length === 0, missing.length ? missing.join('、') + ' || 实际内容: ' + JSON.stringify(String(checkpoint && checkpoint.content).slice(0, 600)) : '八节齐全')

    const hotState = await request('/status?sessionId=hot-1')
    check('压缩后占用回落到阈值以下', hotState.context.tokens < hotState.context.thresholdTokens,
      `${hotState.context.tokens} < ${hotState.context.thresholdTokens}`)
    check('压缩后历史序列仍然合法', pairs.findSequenceProblems(hotFile.messages).length === 0, pairs.findSequenceProblems(hotFile.messages).join('; ') || '合法')
    check('发给模型的每一次请求都合法', seen.every(item => item.problems.length === 0))
    check('刻度标记为已压缩', hotState.context.summary === true)
    check('刻度文案仍带窗口与占比', /\/3k · \d+%$/.test(String(hotState.context.label)), String(hotState.context.label))

    console.log('\n########## 10. 端到端：压缩后还能继续聊 ##########')
    const after = await request('/chat', 'POST', { sessionId: 'hot-1', message: '压缩之后还在吗' })
    check('压缩后对话仍然正常', after && after.ok === true, String(after && after.status))
    const finalFile = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'hot-1.json'), 'utf8'))
    check('新消息追加在检查点之后', finalFile.messages[finalFile.messages.length - 2].content === '压缩之后还在吗')
  } finally {
    if (process.env.YAMI_DEBUG) console.log('\n[宿主 stderr]\n' + stderr.slice(-2000))
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
  }

  console.log(`\n########## 上下文计量与压缩: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
