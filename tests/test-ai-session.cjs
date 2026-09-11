'use strict'
/**
 * AI 助手「会话历史 / 上下文管理」回归测试（零依赖）
 *
 * 覆盖：
 *   1. 流式协议：/chat/stream 必须实时推送 start / delta / tool / result 事件；
 *   2. 会话落盘：会话写入 sessions 目录，宿主重启后可按 id 恢复完整历史；
 *   3. 会话列表与删除：/sessions、/session/delete；
 *   4. 上下文压缩：超出预算时折叠历史为摘要，并保留最近若干条；
 *   5. 工具结果裁剪：单条超大结果不整份塞进上下文。
 *
 * 用法: node tests/test-ai-session.cjs
 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PROJECT = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 16968 + Math.floor(Math.random() * 500)
const MODEL_PORT = AI_PORT + 500
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'danjuan-session-test-'))
const SESSION_DIR = path.join(CONFIG_DIR, 'sessions')

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ============================== 假模型（支持流式 / 工具调用） ============================== */
let toolCallMode = 'none'      // none | list_scripts | validate_project
let hugeResult = false
let stickyToolCall = false
let modelCallCount = 0

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  for (const chunk of chunks) res.write('data: ' + JSON.stringify(chunk) + '\n\n')
  res.write('data: [DONE]\n\n')
  res.end()
}

const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    modelCallCount++
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch { /* 忽略 */ }
    const messages = body.messages || []
    const lastUserIndex = messages.map(m => m.role).lastIndexOf('user')
    const hasToolResult = lastUserIndex >= 0 && messages.slice(lastUserIndex + 1).some(m => m.role === 'tool')
    // stickyToolCall=true 时无条件重复调用，用于验证宿主的「打转保护」
    if (toolCallMode === 'list_scripts' && !hasToolResult) {
      const message = { role: 'assistant', content: '', tool_calls: [{ id: 'call_' + modelCallCount, type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] }
      if (body.stream) return sse(res, [{ choices: [{ delta: { content: '先看一下脚本。' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + modelCallCount, type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] } }] }])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message }] }))
    }
    if (stickyToolCall) {
      const message = { role: 'assistant', content: '', tool_calls: [{ id: 'sticky_' + modelCallCount, type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message }] }))
    }
    let message
    if (toolCallMode === 'list_scripts') {
      message = { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] }
    } else if (toolCallMode === 'validate_project') {
      message = { role: 'assistant', content: '', tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'validate_project', arguments: '{}' } }] }
    } else {
      const reply = hugeResult ? '压缩验证：' + '长'.repeat(400) : '好的，这是流式回复的第一段。'
      if (body.stream) return sse(res, [
        { choices: [{ delta: { content: '好的，' } }] },
        { choices: [{ delta: { content: '这是流式回复的' } }] },
        { choices: [{ delta: { content: '第一段。' } }] }
      ])
      message = { role: 'assistant', content: reply }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message }] }))
  })
})

/* ============================== 宿主进程管理 ============================== */
let host = null
let hostStderr = ''

function startHost(extraEnv = {}) {
  host = spawn(process.execPath, [path.join(ROOT, 'ai-host.js')], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: CONFIG_DIR,
      YAMI_AI_SESSION_DIR: SESSION_DIR,
      YAMI_PROJECT_ROOT: PROJECT,
      ...extraEnv
    }
  })
  host.stderr.on('data', data => { hostStderr += data.toString() })
  return host
}

function stopHost() {
  return new Promise(resolve => {
    if (!host) return resolve()
    host.once('exit', () => { host = null; resolve() })
    host.kill()
  })
}

function json(route, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method,
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw || '{}') }) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** 消费 SSE：返回收到的事件数组 */
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
          try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 忽略坏块 */ }
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
    try {
      const result = await json('/status')
      if (result.data && result.data.ok) return
    } catch { /* 还没起来 */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('AI host 启动超时\n' + hostStderr)
}

async function main() {
  await new Promise(resolve => model.listen(MODEL_PORT, '127.0.0.1', resolve))
  startHost({
    YAMI_AI_CONTEXT_WINDOW: '12000',
    YAMI_AI_CONTEXT_KEEP: '4',
    YAMI_AI_TOOL_LIMIT: '500'
  })
  await waitReady()

  await json('/config', 'POST', { endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake-model', apiKey: 'test-key', approvalMode: 'confirm' })
  await json('/project', 'POST', { projectRoot: PROJECT })

  console.log('\n########## 1. 流式协议 ##########')
  const events = await stream('/chat/stream', { sessionId: 'stream-1', message: '你好' })
  const types = events.map(event => event.type)
  check('收到 start 事件', types.includes('start'))
  check('收到 delta 事件（模型逐字推送）', types.filter(type => type === 'delta').length >= 3, 'delta=' + types.filter(t => t === 'delta').length)
  const text = events.filter(event => event.type === 'delta' && event.content).map(event => event.content).join('')
  check('delta 内容可拼接成完整回复', text === '好的，这是流式回复的第一段。', JSON.stringify(text))
  const result = events.find(event => event.type === 'result')
  check('收到 result 事件', !!result)
  check('result 状态为 done', result && result.status === 'done', result && result.status)

  console.log('\n########## 2. 会话落盘与列表 ##########')
  const list = await json('/sessions')
  check('/sessions 能列出会话', list.data.sessions.some(item => item.id === 'stream-1'))
  const item = list.data.sessions.find(one => one.id === 'stream-1')
  check('会话标题取自首条用户消息', item && item.title === '你好', item && item.title)
  check('会话文件已写入指定目录', fs.existsSync(path.join(SESSION_DIR, 'stream-1.json')))
  check('会话文件不含明文 API Key', !fs.readFileSync(path.join(SESSION_DIR, 'stream-1.json'), 'utf8').includes('test-key'))

  console.log('\n########## 3. 宿主重启后恢复历史 ##########')
  await stopHost()
  startHost({ YAMI_AI_CONTEXT_WINDOW: '12000', YAMI_AI_CONTEXT_KEEP: '4', YAMI_AI_TOOL_LIMIT: '500' })
  await waitReady()
  const loaded = await json('/session/load', 'POST', { sessionId: 'stream-1' })
  check('/session/load 返回历史消息', loaded.data.ok === true && Array.isArray(loaded.data.messages))
  check('历史包含用户消息', loaded.data.messages.some(message => message.role === 'user' && message.content === '你好'))
  check('历史包含助手回复', loaded.data.messages.some(message => message.role === 'assistant' && /流式回复/.test(message.content || '')))

  console.log('\n########## 4. 上下文压缩 ##########')
  // 造一段很长的历史：连续多轮用户消息，触发预算压缩
  for (let i = 0; i < 12; i++) {
    await json('/chat', 'POST', { sessionId: 'compress-1', message: '第 ' + i + ' 轮：' + '填充内容'.repeat(200) })
  }
  const status = await json('/status?sessionId=compress-1')
  check('压缩后占用回落到阈值以下', status.data.context.tokens < status.data.context.thresholdTokens,
    status.data.context.tokens + ' < ' + status.data.context.thresholdTokens)
  check('压缩后标记了摘要', status.data.context.summary === true)
  check('刻度按 token 与真实窗口显示', /\/12k · \d+%$/.test(String(status.data.context.label)), String(status.data.context.label))
  const compressFile = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'compress-1.json'), 'utf8'))
  check('落盘历史第一条为 system', compressFile.messages[0].role === 'system')
  check('落盘历史包含结构化检查点', /<compacted-summary>/.test(JSON.stringify(compressFile.messages[1])))
  // 本套件的假模型不模拟"压缩指令"（它只会回一句常规答复），所以这里只验检查点的包装与结构骨架；
  // 八节完整性与摘要质量由 test-context-meter.cjs 的端到端负责
  check('检查点带引导语与闭合标签', String(compressFile.messages[1].content || '').includes('自动生成的检查点')
    && String(compressFile.messages[1].content || '').includes('</compacted-summary>'))
  check('最近消息被原样保留', compressFile.messages.some(message => message.role === 'user' && /第 11 轮/.test(message.content || '')))

  console.log('\n########## 5. 工具结果裁剪与工具事件 ##########')
  toolCallMode = 'list_scripts'
  const toolEvents = await stream('/chat/stream', { sessionId: 'tool-1', message: '列出脚本' })
  const toolStart = toolEvents.find(event => event.type === 'tool' && event.phase === 'start')
  const toolDone = toolEvents.find(event => event.type === 'tool' && event.phase === 'done')
  check('推送工具开始事件（带中文名）', !!toolStart && toolStart.label === '列出脚本', toolStart && toolStart.label)
  check('推送工具完成事件', !!toolDone)
  console.error('[诊断] tool-1 事件序列 =', JSON.stringify(toolEvents.map(e => e.type + (e.phase ? ':' + e.phase : ''))))
  check('工具事件在 result 之前', toolEvents.findIndex(event => event.type === 'tool') < toolEvents.findIndex(event => event.type === 'result'))

  toolCallMode = 'none'
  const toolFile = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'tool-1.json'), 'utf8'))
  const toolMessage = toolFile.messages.find(message => message.role === 'tool')
  check('工具结果已写入历史', !!toolMessage)
  check('超大工具结果被裁剪', !!toolMessage && toolMessage.content.length <= 2000, 'len=' + (toolMessage ? toolMessage.content.length : 0))

  console.log('\n########## 6. 打转保护（模型重复同一调用时及时止损） ##########')
  stickyToolCall = true
  modelCallCount = 0
  const stuckEvents = await stream('/chat/stream', { sessionId: 'stuck-1', message: '随便看看' })
  const stuckResult = stuckEvents.find(event => event.type === 'result')
  const stuckError = stuckEvents.find(event => event.type === 'error')
  check('重复调用被止损（未撞满步数上限）', !!stuckResult && stuckResult.status === 'stuck', stuckResult ? stuckResult.status : 'error:' + (stuckError && stuckError.error))
  check('止损时模型调用次数远小于步数上限', modelCallCount <= 6, 'calls=' + modelCallCount)
  stickyToolCall = false

  console.log('\n########## 7. 会话删除 ##########')
  await json('/session/delete', 'POST', { sessionId: 'tool-1' })
  check('删除后文件消失', !fs.existsSync(path.join(SESSION_DIR, 'tool-1.json')))
  const afterDelete = await json('/sessions')
  check('删除后不再出现在列表', !afterDelete.data.sessions.some(one => one.id === 'tool-1'))

  console.log(`\n########## AI 会话/上下文测试: ${passed} PASS / ${failed} FAIL ##########`)
  await stopHost()
  model.close()
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async error => {
  console.error(error.stack || error.message)
  if (hostStderr) console.error('host stderr:\n' + hostStderr)
  await stopHost()
  model.close()
  process.exit(1)
})
