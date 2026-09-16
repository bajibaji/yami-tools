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
const PROJECT = require('./resolve-project.cjs').resolveProject()
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
// 预算用例专用计数：modelCallCount 是全流程累计的，用它当上限会被前面几节推过头（第一次跑就踩了）
let budgetLoopCalls = 0
// 最近一次请求里模型实际看到的 system 正文：用来验证"工程文档入口"这类注入真的到了模型手里
let lastSystemPrompt = ''

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
    const systemMessage = messages.find(message => message.role === 'system')
    if (systemMessage) lastSystemPrompt = String(systemMessage.content || '')
    const lastUserIndex = messages.map(m => m.role).lastIndexOf('user')
    const hasToolResult = lastUserIndex >= 0 && messages.slice(lastUserIndex + 1).some(m => m.role === 'tool')
    // 界面演示（ui_steps）：focus 只有高亮、set 真改控件 —— 审批粒度必须不一样，用两种模式分别跑
    if ((toolCallMode === 'ui_focus' || toolCallMode === 'ui_set') && !hasToolResult) {
      const steps = toolCallMode === 'ui_focus'
        ? [{ kind: 'focus', target: '#fileItem-demo', label: '看这里（演示高亮）' }]
        : [{ kind: 'set', target: '#fileSkill-name', value: '演示值', label: '改一个属性' }]
      const args = JSON.stringify({ steps })
      const message = { role: 'assistant', content: '', tool_calls: [{ id: 'ui_' + modelCallCount, type: 'function', function: { name: 'ui_steps', arguments: args } }] }
      if (body.stream) return sse(res, [{ choices: [{ delta: { content: '我在界面上演一下。' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'ui_' + modelCallCount, type: 'function', function: { name: 'ui_steps', arguments: args } }] } }] }])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message }] }))
    }
    // 预算止损：每次换一组参数接着查同一个工具（不是"完全相同的调用"，打转保护认不出来）
    if (toolCallMode === 'budget_loop' && ++budgetLoopCalls <= 15) {
      const message = { role: 'assistant', content: '', tool_calls: [{ id: 'bud_' + budgetLoopCalls, type: 'function', function: { name: 'list_resources', arguments: JSON.stringify({ type: 'skill', offset: budgetLoopCalls }) } }] }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message }] }))
    }
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
        { choices: [{ delta: { reasoning_content: '先看看工程结构，再决定读哪个文件。' } }] },
        { choices: [{ delta: { reasoning_content: '先看 Assets 下的脚本目录。' } }] },
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
    // 窗口是**夹具**不是断言：它只要大到"固定开销（系统提示 + 模型可见工具 schema）+ 可压缩的历史"
    // 里后者占多数即可。工具集每次长一点，这份固定开销就跟着长 —— 12k 时余量已不到 100 token，
    // 工具说明加两行就翻过阈值（实测 9683 > 9600）。断言本身一个字没改，仍然要求压到阈值以下。
    YAMI_AI_CONTEXT_WINDOW: '20000',
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
  // F1：工程自带"AI 阅读入口"文档时，它必须出现在模型看到的系统提示词里（否则模型只会盲搜几十次）
  if (fs.existsSync(path.join(PROJECT, 'DANJUAN TOOLS'))) {
    check('工程文档入口被注入系统提示词', /【工程文档入口】/.test(lastSystemPrompt) && /AI 阅读入口/.test(lastSystemPrompt),
      lastSystemPrompt.split('\n').filter(line => /工程文档入口/.test(line)).join('').slice(0, 80))
  } else {
    console.log('  SKIP  这个测试工程没有 DANJUAN TOOLS 文档入口，跳过该断言（行为由静态契约兜底）')
  }

  console.log('\n########## 2. 会话落盘与列表 ##########')
  const list = await json('/sessions')
  check('/sessions 能列出会话', list.data.sessions.some(item => item.id === 'stream-1'))
  const item = list.data.sessions.find(one => one.id === 'stream-1')
  check('会话标题取自首条用户消息', item && item.title === '你好', item && item.title)
  check('会话文件已写入指定目录', fs.existsSync(path.join(SESSION_DIR, 'stream-1.json')))
  check('会话文件不含明文 API Key', !fs.readFileSync(path.join(SESSION_DIR, 'stream-1.json'), 'utf8').includes('test-key'))

  console.log('\n########## 3. 宿主重启后恢复历史 ##########')
  await stopHost()
  startHost({ YAMI_AI_CONTEXT_WINDOW: '20000', YAMI_AI_CONTEXT_KEEP: '4', YAMI_AI_TOOL_LIMIT: '500' })
  await waitReady()
  const loaded = await json('/session/load', 'POST', { sessionId: 'stream-1' })
  check('/session/load 返回历史消息', loaded.data.ok === true && Array.isArray(loaded.data.messages))
  check('历史包含用户消息', loaded.data.messages.some(message => message.role === 'user' && message.content === '你好'))
  check('历史包含助手回复', loaded.data.messages.some(message => message.role === 'assistant' && /流式回复/.test(message.content || '')))
  check('历史回放带上当时的思考过程', loaded.data.messages.some(message => /先看看工程结构/.test(String(message.reasoning || ''))),
    loaded.data.messages.filter(m => m.reasoning).length + ' 条带思考')

  console.log('\n########## 4. 上下文压缩 ##########')
  // 造一段很长的历史：连续多轮用户消息，触发预算压缩
  // 轮数跟着窗口走：20k 窗口的阈值是 16000，12 轮只推到 ~11.5k（实测），推不过去就不会触发压缩
  for (let i = 0; i < 20; i++) {
    await json('/chat', 'POST', { sessionId: 'compress-1', message: '第 ' + i + ' 轮：' + '填充内容'.repeat(200) })
  }
  const status = await json('/status?sessionId=compress-1')
  check('压缩后占用回落到阈值以下', status.data.context.tokens < status.data.context.thresholdTokens,
    status.data.context.tokens + ' < ' + status.data.context.thresholdTokens)
  check('压缩后标记了摘要', status.data.context.summary === true)
  // 断的是"刻度格式"这件事（占用/真实窗口 · 百分比），窗口数字跟着夹具走，不写死成某个常量
  check('刻度按 token 与真实窗口显示', /^[\d.]+k\/20k · \d+%$/.test(String(status.data.context.label)), String(status.data.context.label))
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

  console.log('\n########## 8. 历史列表口径与「新对话」的非破坏性 ##########')
  // 面板上那个写着「新对话」的按钮，以前的顺序是：先 POST /clear（当年 = 删文件）再换会话 id，
  // 于是每开一段新对话就把上一段对话从磁盘上抹掉。这一节把两条语义钉死：
  //   · /clear 只清空内容，绝不删文件；
  //   · 上屏的"几轮"只数用户消息，不是内部消息条数。
  const histList = await json('/sessions')
  const row = histList.data.sessions.find(one => one.id === 'stream-1')
  check('列表带 turns（用户自己说了几轮）', !!row && row.turns === 1, row && ('turns=' + row.turns))
  check('turns 与 messageCount 确实是两回事（后者含 system 与工具结果）',
    !!row && row.messageCount > row.turns, row && ('turns=' + row.turns + ' / messageCount=' + row.messageCount))

  await json('/clear', 'POST', { sessionId: 'stream-1' })
  check('/clear 之后会话文件仍在磁盘上（不再删历史）', fs.existsSync(path.join(SESSION_DIR, 'stream-1.json')))
  const cleared = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'stream-1.json'), 'utf8'))
  check('/clear 只清空内容（只剩 system 一条）',
    cleared.messages.length === 1 && cleared.messages[0].role === 'system', '剩 ' + cleared.messages.length + ' 条')
  const afterClear = (await json('/sessions')).data.sessions.find(one => one.id === 'stream-1')
  check('清空后 turns 归零（面板据此不再列出这段空会话）', !!afterClear && afterClear.turns === 0)

  // 只有显式的 /session/delete 才真的把文件拿掉
  await json('/session/delete', 'POST', { sessionId: 'stream-1' })
  check('只有显式删除才真的移除文件', !fs.existsSync(path.join(SESSION_DIR, 'stream-1.json')))

  console.log('\n########## 9. 从某一轮重来（/session/rewind） ##########')
  // G-1：对话时间轴可截断到某条用户消息之前，并把那条原文交回面板改写重发。
  await stream('/chat/stream', { sessionId: 'rewind-1', message: '第一句' })
  await stream('/chat/stream', { sessionId: 'rewind-1', message: '第二句' })
  const beforeRewind = (await json('/session/load', 'POST', { sessionId: 'rewind-1' })).data
  const beforeTurns = (beforeRewind.messages || []).filter(m => m.role === 'user')
  check('回放里用户消息带绝对轮次号（历史窗口截断也不影响对齐）',
    beforeTurns.length === 2 && beforeTurns[1].turnIndex === 1, JSON.stringify(beforeTurns.map(m => m.turnIndex)))
  const rewound = (await json('/session/rewind', 'POST', { sessionId: 'rewind-1', messageIndex: 1 })).data
  check('重来返回被截断的那条原文', rewound.ok === true && rewound.message === '第二句', JSON.stringify(rewound.message))
  const afterRewind = (await json('/session/load', 'POST', { sessionId: 'rewind-1' })).data
  const afterTurns = (afterRewind.messages || []).filter(m => m.role === 'user')
  check('时间轴已截断到这一轮之前（且落盘）', afterTurns.length === 1 && afterTurns[0].content === '第一句',
    JSON.stringify(afterTurns.map(m => m.content)))
  const continued = await stream('/chat/stream', { sessionId: 'rewind-1', message: '改写后的第二句' })
  check('重来之后能正常继续对话', !!continued.find(e => e.type === 'result' && e.status === 'done'))
  const badIndex = (await json('/session/rewind', 'POST', { sessionId: 'rewind-1', messageIndex: 99 })).data
  check('越界的轮次号如实报错（不静默成功）', badIndex.ok === false && /不在会话里|编号不对/.test(String(badIndex.error)), String(badIndex.error))

  console.log('\n########## 10. 导出对话（/session/export） ##########')
  // 导出是**只读**操作：稿件要能被人读懂，也不能因为导出而改动会话本身。
  toolCallMode = 'list_scripts'
  await stream('/chat/stream', { sessionId: 'export-1', message: '看看工程里有哪些脚本' })
  toolCallMode = 'none'
  const sessionFile = path.join(SESSION_DIR, 'export-1.json')
  const beforeExport = fs.readFileSync(sessionFile, 'utf8')
  const exported = (await json('/session/export', 'POST', { sessionId: 'export-1' })).data
  check('导出成功并给出 .md 文件名', exported.ok === true && /\.md$/.test(String(exported.filename)), String(exported.filename))
  check('导出稿落在宿主数据目录、绝不落进用户工程',
    !!exported.path && fs.existsSync(exported.path) && !path.resolve(exported.path).startsWith(path.resolve(PROJECT)),
    String(exported.path))
  const markdown = exported.path ? fs.readFileSync(exported.path, 'utf8') : String(exported.markdown || '')
  check('稿件里有用户原话与助手回话', markdown.includes('### 你') && markdown.includes('看看工程里有哪些脚本') && markdown.includes('### AI 助手'))
  check('工具步骤记成一行「执行：」', /- 执行：/.test(markdown))
  check('头部交代会话 ID 与规模', markdown.includes('**会话 ID**') && markdown.includes('**规模**'))
  const rawSession = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'export-1.json'), 'utf8'))
  const systemText = String((rawSession.messages.find(item => item.role === 'system') || {}).content || '')
  const toolText = String((rawSession.messages.find(item => item.role === 'tool') || {}).content || '')
  check('system 提示词不进稿子（只在头部记条数）', systemText.length > 200 && !markdown.includes(systemText.slice(0, 120)))
  check('工具结果原文不进正文（只留步骤行）', !toolText || !markdown.includes(toolText.slice(0, 120)))
  const injected = rawSession.messages.filter(item => item.role === 'user' && /^【系统干预指引】/.test(String(item.content))).length
  check('宿主自动追加的说明不许被写成用户发言', !markdown.includes('### 你\n\n【系统干预指引】'), '本轮干预 ' + injected + ' 条')
  check('干预说明仍完整收进稿件（只换标题）', injected === 0 || markdown.includes('### 系统提示（宿主自动追加，非用户发言）'))
  const everything = (await json('/session/export', 'POST', { all: true })).data
  const allText = everything.path && fs.existsSync(everything.path) ? fs.readFileSync(everything.path, 'utf8') : ''
  check('导出全部：带目录且含各段会话',
    everything.ok === true && everything.sessions >= 1 && allText.includes('## 目录') && allText.includes('export-1'),
    'sessions=' + everything.sessions)
  const missing = (await json('/session/export', 'POST', { sessionId: 'no-such-session' })).data
  check('导出不存在的会话如实报错（不返回空稿）', missing.ok === false && /没有找到/.test(String(missing.error)), String(missing.error))
  check('导出（单段 + 全量）是只读操作：会话文件一个字节都没变', fs.readFileSync(sessionFile, 'utf8') === beforeExport)
  console.log('\n########## 11. 界面演示的审批粒度（ui_steps） ##########')
  // 上一轮把整个 ui_steps 并进 OTHER_MUTATIONS，副作用是"演给你看"也要弹确认卡 —— 用户要的"边做边演示"就没了。
  // 现在按步骤类型细分：focus/goto/wait 只是看，set/click 才是改。
  toolCallMode = 'ui_focus'
  const demoEvents = await stream('/chat/stream', { sessionId: 'ui-demo-1', message: '演给我看' })
  toolCallMode = 'none'
  check('纯演示（只有高亮）不再弹确认卡', !demoEvents.some(event => event.type === 'result' && event.status === 'approval'))
  check('演示仍然真的走了一遍工具（跑不通也如实回报）', demoEvents.some(event => event.type === 'tool' && event.name === 'ui_steps'))
  toolCallMode = 'ui_set'
  const setEvents = await stream('/chat/stream', { sessionId: 'ui-demo-2', message: '改个属性给我看' })
  toolCallMode = 'none'
  check('真改控件的演示照旧先确认（set 仍要用户点「执行修改」）',
    setEvents.some(event => event.type === 'result' && event.status === 'approval'))

  console.log('\n########## 12. 工具预算（换个关键词接着查也要停） ##########')
  // 实测踩过：模型换了 5 组关键词连着检索、宿主连提示 6 次它照旧往下查，最后 2 轮 37 次调用还没收尾。
  // per-name 的软提示拦不住，所以有一道硬闸：单工具 8 次 / 单轮 30 次，到点如实停下。
  const callsBefore = modelCallCount
  budgetLoopCalls = 0
  toolCallMode = 'budget_loop'
  const budgetEvents = await stream('/chat/stream', { sessionId: 'budget-1', message: '随便看看' })
  toolCallMode = 'none'
  const budgetResult = budgetEvents.find(event => event.type === 'result') || {}
  check('单工具刷到上限就如实停下（status=stuck）', budgetResult.status === 'stuck', String(budgetResult.status))
  check('停下时说清是哪个工具、刷了多少次',
    /列出资源/.test(String(budgetResult.message)) && /次/.test(String(budgetResult.message)),
    String(budgetResult.message).slice(0, 90))
  check('是宿主预算拦下的，不是撞到模型自己的第 16 次调用', modelCallCount - callsBefore <= 12, 'calls=' + (modelCallCount - callsBefore))
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
