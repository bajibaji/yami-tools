'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

/**
 * 测试工程解析（跨平台，铁律：绝不硬编码某一个开发者机器的绝对路径）
 *   1. YAMI_TEST_PROJECT 环境变量优先；
 *   2. Windows 本机开发目录 D:\new-game；
 *   3. 本机 Linux 侧 Open Yami 源码仓库自带模板工程 .../2/Project/Templates/arpg-ts-chinese。
 * 三者都要求存在 Assets 目录与至少一个 .event 事件资源。
 */
function resolveProject() {
  const candidates = [
    process.env.YAMI_TEST_PROJECT,
    'D:\\new-game',
    path.resolve(ROOT, '..', '2', 'Project', 'Templates', 'arpg-ts-chinese')
  ].filter(Boolean)
  for (const dir of candidates) {
    if (!fs.existsSync(path.join(dir, 'Assets'))) continue
    const event = findFirstEvent(path.join(dir, 'Assets'))
    if (event) return { dir: path.resolve(dir), event }
  }
  throw new Error('找不到可用的测试工程；请用 YAMI_TEST_PROJECT 指定一个 Open Yami 工程目录')
}

function findFirstEvent(assetsDir) {
  const stack = [assetsDir]
  while (stack.length) {
    const current = stack.shift()
    let entries = []
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.toLowerCase().endsWith('.event')) return full
    }
  }
  return ''
}

const LOCAL_PROJECT = resolveProject()
const PROJECT = LOCAL_PROJECT.dir
const EVENT_PATH = LOCAL_PROJECT.event
const EVENT_REL = path.relative(PROJECT, EVENT_PATH).replace(/\\/g, '/')
const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 15968 + Math.floor(Math.random() * 1000)
const MODEL_PORT = AI_PORT + 1000
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'danjuan-ai-test-'))
const VALID_KEY = 'sk-testsecret1234567890abcdefghij'
const originalEvent = fs.readFileSync(EVENT_PATH, 'utf8')

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => resolve(JSON.parse(raw || '{}')))
  })
}

const model = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/models') {
    const auth = String(req.headers.authorization || '')
    if (auth !== 'Bearer ' + VALID_KEY) {
      return json(res, 401, { error: { message: 'Authentication Fails, Your api key: ****test is invalid', type: 'authentication_error' } })
    }
    return json(res, 200, { object: 'list', data: [{ id: 'fake-model', object: 'model' }, { id: 'deepseek-flash', object: 'model' }] })
  }
  const body = await readBody(req)
  const messages = body.messages || []
  const latestUserIndex = messages.findLastIndex(message => message.role === 'user')
  const latestUser = messages[latestUserIndex]
  const hasToolAfterUser = latestUserIndex >= 0 && messages.slice(latestUserIndex + 1).some(message => message.role === 'tool')
  let message
  // 多轮思考场景：第一轮只有思考 + 只读工具调用（没有正文），第二轮再思考并给正文。
  // 历史回放必须把这种"只有思考没正文"的轮次也带出来，否则回放比实时少内容。
  if (latestUser && latestUser.content.includes('多轮思考') && !hasToolAfterUser) {
    message = {
      role: 'assistant', content: '', reasoning_content: '第一轮思考：先看看有哪些脚本。',
      tool_calls: [{ id: 'rounds-1', type: 'function', function: { name: 'list_scripts', arguments: '{}' } }]
    }
  } else if (latestUser && latestUser.content.includes('多轮思考') && hasToolAfterUser) {
    message = { role: 'assistant', content: '两轮都跑完了。', reasoning_content: '第二轮思考：看到结果了，可以收尾。' }
  } else if (latestUser && latestUser.content.includes('只读') && !hasToolAfterUser) {
    message = { role: 'assistant', content: '', tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] }
  } else if (latestUser && latestUser.content.includes('修改') && !hasToolAfterUser) {
    message = {
      role: 'assistant', content: '准备修改事件描述。',
      tool_calls: [{ id: 'write-1', type: 'function', function: { name: 'patch_resource', arguments: JSON.stringify({ path: EVENT_REL, patch: { description: 'AI E2E preview only' } }) } }]
    }
  } else if (latestUser && latestUser.content.includes('搜一下') && !hasToolAfterUser) {
    // 检索类结果天然很长：用来验证「超长输出裁剪 + 落盘」这条路
    message = { role: 'assistant', content: '', tool_calls: [{ id: 'search-1', type: 'function', function: { name: 'search_project', arguments: JSON.stringify({ query: 'e', scope: 'all', maxResults: 200 }) } }] }
  } else if (latestUser && latestUser.content.includes('搜一下') && hasToolAfterUser) {
    message = { role: 'assistant', content: '搜完了。' }
  } else if (latestUser && latestUser.content.includes('慢一点坏')) {
    // 第一轮就炸：没有步骤边界，引导不可能被投递 → 必须原样退回（铁律㊷）
    await new Promise(resolve => setTimeout(resolve, 400))
    res.writeHead(500, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: '上游炸了（模拟）', type: 'server_error' } }))
  } else if (latestUser && latestUser.content.includes('慢一点')) {
    // 故意慢一拍 + 走两轮：给"繁忙时引导"留出真实的步骤边界，让队列有机会被投递
    await new Promise(resolve => setTimeout(resolve, 500))
    message = hasToolAfterUser
      ? { role: 'assistant', content: '慢慢想完了。' }
      : { role: 'assistant', content: '先看一眼脚本。', tool_calls: [{ id: 'slow-1', type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] }
  } else if (latestUser && latestUser.content.includes('无记账')) {
    // 故意不报 usage：用来验证"记账不全就整行不显示"，而不是拿部分总量冒充完整结果
    message = { role: 'assistant', content: '这次不报用量。' }
    return json(res, 200, { choices: [{ message }] })
  } else {
    message = { role: 'assistant', content: latestUser && latestUser.content.includes('修改') ? '修改已取消，工程未变化。' : '只读工具调用完成。' }
  }
  json(res, 200, { choices: [{ message }], usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } })
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
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw || '{}') }) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** 读一次 SSE 路由，把事件数组还给测试（用于断言 system / tool / steer 这些流里的事实） */
function streamRequest(route, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method: 'POST',
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, { 'Content-Type': 'application/json', 'Content-Length': payload.length })
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        const events = []
        for (const block of raw.split('\n\n')) {
          const line = block.split('\n').find(one => one.startsWith('data:'))
          if (!line) continue
          try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 忽略坏块 */ }
        }
        resolve(events)
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const result = await request('/status')
      if (result.data.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('AI host 启动超时')
}

async function main() {
  await new Promise(resolve => model.listen(MODEL_PORT, '127.0.0.1', resolve))
  const host = spawn(process.execPath, [path.join(ROOT, 'ai-host.js')], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: CONFIG_DIR,
      // 工具结果预算压到 400 字符：让「超长输出裁剪 + 落盘(spill)」这条路在本套件里可测
      YAMI_AI_TOOL_LIMIT: '400',
      YAMI_PROJECT_ROOT: PROJECT
    }
  })
  let stderr = ''
  host.stderr.on('data', data => { stderr += data })
  try {
    await waitReady()

    const unauthorized = await new Promise(resolve => {
      http.get(`http://127.0.0.1:${AI_PORT}/status`, res => resolve(res.statusCode)).on('error', () => resolve(0))
    })
    assert.equal(unauthorized, 401, '无令牌请求必须被拒绝')

    const saved = await request('/config', 'POST', {
      endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake-model', apiKey: VALID_KEY, approvalMode: 'confirm'
    })
    assert.equal(saved.data.ok, true, saved.data.error)
    assert.equal(saved.data.hasApiKey, true)
    assert.equal(JSON.stringify(saved.data).includes(VALID_KEY), false, 'API Key 不得返回面板')

    const project = await request('/project', 'POST', { projectRoot: PROJECT })
    assert.equal(project.data.ok, true, project.data.error)

    const read = await request('/chat', 'POST', { sessionId: 'read', message: '执行只读检查' })
    assert.equal(read.data.status, 'done', JSON.stringify(read.data))
    assert.match(read.data.message, /只读工具调用完成/)

    const preview = await request('/chat', 'POST', { sessionId: 'write', message: '修改事件描述' })
    assert.equal(preview.data.status, 'approval', JSON.stringify(preview.data))
    assert.equal(preview.data.approval.tool, 'patch_resource')
    assert.equal(preview.data.approval.target, EVENT_REL)
    assert.equal(fs.readFileSync(EVENT_PATH, 'utf8'), originalEvent, '预览阶段不得修改工程')

    const rejected = await request('/reject', 'POST', { sessionId: 'write' })
    assert.equal(rejected.data.status, 'done', JSON.stringify(rejected.data))
    assert.match(rejected.data.message, /取消/)
    assert.equal(fs.readFileSync(EVENT_PATH, 'utf8'), originalEvent, '取消后工程不得变化')

    // 回放与实时同构：一个回合里的多轮思考各成一条（含"只有思考没正文"的工具轮），
    // 工具步骤也要还原成中文名 —— 否则切回旧会话就是"思考丢了、步骤也没了"。
    const rounds = await request('/chat', 'POST', { sessionId: 'rounds', message: '多轮思考：先列脚本再总结' })
    assert.equal(rounds.data.status, 'done', JSON.stringify(rounds.data))
    const replayed = await request('/session/load', 'POST', { sessionId: 'rounds' })
    assert.equal(replayed.data.ok, true, JSON.stringify(replayed.data))
    const assistants = replayed.data.messages.filter(item => item.role === 'assistant')
    assert.ok(assistants.some(item => /第一轮思考/.test(String(item.reasoning || ''))), '第一轮（只有思考没正文）的思考必须回放出来')
    assert.ok(assistants.some(item => /第二轮思考/.test(String(item.reasoning || ''))), '后续轮次的思考也必须回放出来')
    const stepped = assistants.find(item => Array.isArray(item.steps) && item.steps.length)
    assert.ok(stepped && stepped.steps.includes('列出脚本'), '工具步骤要随回放还原成中文名：' + JSON.stringify(stepped && stepped.steps))

    // 每轮用量行：记账完整才上报（前端据此决定渲染那一行）
    const usageTurn = await request('/chat', 'POST', { sessionId: 'usage', message: '多轮思考：先列脚本再总结' })
    assert.equal(usageTurn.data.status, 'done', JSON.stringify(usageTurn.data))
    const turnUsage = usageTurn.data.turnUsage || {}
    assert.equal(turnUsage.complete, true, '本轮每一次模型调用都报了 usage 时，用量必须是完整的：' + JSON.stringify(turnUsage))
    assert.ok(turnUsage.promptTokens > 0 && turnUsage.calls >= 1, '要给出本轮增量而不是累计：' + JSON.stringify(turnUsage))
    assert.ok(turnUsage.completionTokens > 0, JSON.stringify(turnUsage))
    // 借道非 SSE 降级路径（假模型返回整段 JSON）：usage 与思考都必须被读到
    const noUsageTurn = await request('/chat', 'POST', { sessionId: 'nousage', message: '无记账：只说一句话' })
    assert.equal(noUsageTurn.data.status, 'done', JSON.stringify(noUsageTurn.data))
    assert.equal((noUsageTurn.data.turnUsage || {}).complete, false, '有一次模型调用没报 usage，本轮用量就必须判为不完整（前端整行不显示）')

    // ---- 对齐 DSH 的四项机制：系统提示词行 / 工具卡片事实 / 超长输出落盘 / 引导投递 ----
    const surface = await streamRequest('/chat/stream', { sessionId: 'surface', message: '多轮思考：先列脚本再总结' })
    const sysEvents = surface.filter(event => event.type === 'system')
    assert.equal(sysEvents.length, 1, '第一轮要上一行「系统提示词」：' + JSON.stringify(surface.map(e => e.type)))
    assert.ok(String(sysEvents[0].text || '').length > 100 && /^[0-9a-f]{12}$/.test(String(sysEvents[0].hash)), '系统提示词要带原文与指纹：' + JSON.stringify(sysEvents[0]).slice(0, 120))
    const doneTool = surface.find(event => event.type === 'tool' && event.phase === 'done')
    const factKeys = ['files', 'items', 'total', 'matches', 'lines', 'bytes', 'chars', 'diffStat', 'exitCode', 'truncated', 'spill']
    assert.ok(doneTool && doneTool.info && factKeys.some(key => doneTool.info[key] !== undefined),
      '工具完成事件要带结构化事实（卡片不许从中文描述里猜数字）：' + JSON.stringify(doneTool && doneTool.info))
    const again = await streamRequest('/chat/stream', { sessionId: 'surface', message: '只读检查' })
    assert.equal(again.filter(event => event.type === 'system').length, 0, '系统文本没变时不许重复上屏（DSH 的去重语义）')

    const spilled = await streamRequest('/chat/stream', { sessionId: 'spill', message: '搜一下：定位相关脚本' })
    const spillTool = spilled.find(event => event.type === 'tool' && event.phase === 'done' && event.info && event.info.spill)
    assert.ok(spillTool, '超长工具结果要如实标注截断并落盘：' + JSON.stringify(spilled.filter(e => e.type === 'tool').map(e => e.info)))
    assert.equal(spillTool.info.truncated, true, '截断标记不能少')
    assert.ok(fs.existsSync(spillTool.info.spill.path), '落盘文件必须真的在：' + spillTool.info.spill.path)
    assert.ok(spillTool.info.spill.chars > 400, '落盘的是完整原文：' + spillTool.info.spill.chars)

    const running = request('/chat', 'POST', { sessionId: 'steer', message: '慢一点：先列脚本' })
    await new Promise(resolve => setTimeout(resolve, 200))
    const steer = await request('/steer', 'POST', { sessionId: 'steer', message: '顺带把主菜单也看一眼' })
    assert.equal(steer.data.ok, true, JSON.stringify(steer.data))
    assert.equal(steer.data.busy, true, '繁忙时引导必须被收下：' + JSON.stringify(steer.data))
    const steered = await running
    assert.equal(steered.data.status, 'done', JSON.stringify(steered.data).slice(0, 160))
    assert.equal(steered.data.undeliveredSteer, undefined, '赶上了步骤边界就不该退回排队区')
    const steerSession = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'sessions', 'steer.json'), 'utf8'))
    assert.ok(steerSession.messages.some(m => m.role === 'user' && /顺带把主菜单也看一眼/.test(String(m.content))), '引导内容必须真的进了模型可见的历史')
    const idleSteer = await request('/steer', 'POST', { sessionId: 'steer', message: '空闲时说一句' })
    assert.equal(idleSteer.data.busy, false, '空闲时引导要如实回"直接发就行"，不许假装收下')

    // 引导在"这一轮抛错"时也必须退回（收下 ≠ 送到；拿不到回执就得如实退回）
    const failingTurn = request('/chat', 'POST', { sessionId: 'steerfail', message: '慢一点坏：先列脚本' })
    await new Promise(resolve => setTimeout(resolve, 200))
    const steerFail = await request('/steer', 'POST', { sessionId: 'steerfail', message: '这句必须被退回' })
    assert.equal(steerFail.data.busy, true, '繁忙时引导要被收下：' + JSON.stringify(steerFail.data))
    const failedTurn = await failingTurn
    assert.equal(failedTurn.data.ok, false, '上游 500 要如实失败：' + JSON.stringify(failedTurn.data).slice(0, 140))
    assert.ok(Array.isArray(failedTurn.data.undeliveredSteer) && failedTurn.data.undeliveredSteer.includes('这句必须被退回'),
      '这一轮抛错时没送出去的引导必须退回：' + JSON.stringify(failedTurn.data.undeliveredSteer))


    // Base URL 口径（官方文档：BASE URL = https://api.deepseek.com，对话接口是 base + /chat/completions）
    const baseOnly = await request('/config', 'POST', { baseUrl: 'http://127.0.0.1:' + MODEL_PORT + '/', model: 'fake-model', apiKey: VALID_KEY })
    assert.ok(String(baseOnly.data.chatUrl).endsWith('/chat/completions'), '对话地址必须是 base + /chat/completions')
    assert.equal(String(baseOnly.data.chatUrl).includes('/chat/completions/chat/completions'), false, '不得把 /chat/completions 拼两次')
    const legacyFull = await request('/config', 'POST', { endpoint: 'http://127.0.0.1:' + MODEL_PORT + '/chat/completions', model: 'fake-model' })
    assert.equal(legacyFull.data.baseUrl, 'http://127.0.0.1:' + MODEL_PORT, '旧式完整地址要归一成 Base URL')
    console.log('Base URL 口径检查: 尾斜杠剥离 / 不重复拼接 / 旧地址归一 全部通过')

    // 一键测试连接：地址通不通、密钥认不认、模型在不在（实测踩过「密钥栏里存着 BASE URL」导致永远 401）
    const conn = await request('/test-connection', 'POST', {})
    assert.equal(conn.data.ok, true, JSON.stringify(conn.data))
    assert.equal(conn.data.modelAvailable, true, '配置的模型必须出现在服务端模型列表里')
    assert.ok(Array.isArray(conn.data.models) && conn.data.models.includes('fake-model'), '测试连接要带回服务端模型列表')

    const badKey = await request('/config', 'POST', { apiKey: 'sk-00000000000000000000wrongkey' })
    assert.equal(badKey.data.ok, true, JSON.stringify(badKey.data))
    const connBad = await request('/test-connection', 'POST', {})
    assert.equal(connBad.data.ok, false, '错误密钥必须如实报失败')
    assert.equal(connBad.data.step, 'models', '失败要指出卡在哪一步')
    assert.match(String(connBad.data.error), /Authentication Fails/, '要把官方原话透出来：' + connBad.data.error)

    const urlAsKey = await request('/config', 'POST', { apiKey: 'https://api.deepseek.com/' })
    assert.equal(urlAsKey.data.ok, false, '把网址当密钥必须当场拒绝')
    assert.match(String(urlAsKey.data.error), /填的是网址/, urlAsKey.data.error)

    const viewSaved = await request('/quick-config', 'POST', { thinkingView: 'expand' })
    assert.equal(viewSaved.data.thinkingView, 'expand', '思考过程显示必须能存进宿主配置：' + JSON.stringify(viewSaved.data))
    const viewReload = await request('/config')
    assert.equal(viewReload.data.thinkingView, 'expand', '重新读配置要还是用户选的那一档')
    const viewBad = await request('/quick-config', 'POST', { thinkingView: 'nonsense' })
    assert.equal(viewBad.data.thinkingView, 'expand', '非法值必须被忽略，不能把用户的选择冲掉')
    const viewBack = await request('/quick-config', 'POST', { thinkingView: 'preview' })
    assert.equal(viewBack.data.thinkingView, 'preview', '还能切回去')
    console.log('思考显示偏好: 写入 / 读回 / 拒绝非法值 全部通过')

    const keyState = await request('/config')
    assert.ok(typeof keyState.data.keyTail === 'string', '配置要回报密钥尾号，供面板显示"已保存····abcd"')
    console.log('连接体检: /test-connection 通过 / 错误密钥如实报错 / 网址当密钥被拒 全部通过')

    console.log('AI Agent E2E: 鉴权、密钥保护、只读工具、写入预览、取消回滚全部通过')

    // 前端接线检查：流式、历史面板、上下文刻度必须真的接上（防止只改宿主、前端忘了接）
    const agentSource = fs.readFileSync(path.join(ROOT, 'ai-agent.js'), 'utf8')
    const hostSource = fs.readFileSync(path.join(ROOT, 'ai-host.js'), 'utf8')
    const hudSource = fs.readFileSync(path.join(ROOT, 'hud-overlay.js'), 'utf8')
    const coreSource = fs.readFileSync(path.join(ROOT, 'ai-render-core.js'), 'utf8')
    const probeSource = fs.readFileSync(path.join(ROOT, 'probe-core.js'), 'utf8')
    assert.ok(/\/chat\/stream/.test(agentSource), '前端必须走流式 /chat/stream')
    assert.ok(/getReader\(\)/.test(agentSource), '前端必须逐块读取流式响应')
    assert.ok(/id="yami-ai-history"/.test(agentSource), '必须存在会话历史面板容器')
    assert.ok(/id="yami-ai-history-toggle"/.test(agentSource), '必须有历史入口按钮')
    assert.ok(/id="yami-ai-context"/.test(agentSource), '必须有上下文占用指示')
    assert.ok(/'\/session\/load'/.test(agentSource), '前端必须能恢复历史会话')
    assert.ok(/'\/sessions'/.test(agentSource), '前端必须能列出历史会话')
    assert.ok(/event\.type === 'tool'/.test(agentSource), '前端必须渲染工具调用事件')
    assert.ok(/id="yami-ai-approval-diff"/.test(agentSource), '审批卡片必须有差异预览容器')
    assert.ok(/renderDiff/.test(agentSource), '前端必须把差异逐行着色渲染')
    assert.ok(/risk === 'high'/.test(agentSource), '前端必须对高危操作显著提示')
    assert.ok(/confirmationToken/.test(hostSource), '宿主必须把删除的一次性确认令牌透传给 MCP')
    assert.ok(/id="yami-ai-undo"/.test(agentSource), '必须有撤销面板容器')
    assert.ok(/renderUndoList/.test(agentSource), '前端必须能列出本对话改过的文件')
    assert.ok(/'\/backup-undo'/.test(agentSource), '前端必须能一键回退')
    assert.ok(/id="yami-ai-grant"/.test(agentSource), '审批卡片必须有会话内授权勾选')
    assert.ok(/grantForSession/.test(agentSource) && /grantForSession/.test(hostSource), '授权意愿必须传到宿主')
    assert.ok(/'\/grants'/.test(agentSource) && /'\/grants'/.test(hostSource), '授权必须可查询与撤销')
    assert.ok(/DELETE_TOOLS/.test(hostSource), '删除类操作必须排除在批量授权之外')
    assert.ok(/declaredReadOnlyTools/.test(hostSource) && /readOnlyHint === true/.test(hostSource), '只读判定必须以 MCP 注册表的 readOnlyHint 为真源')
    const composeIndex = agentSource.indexOf('yami-ai-compose')
    const devbarIndex = agentSource.indexOf('yami-ai-devbar')
    assert.ok(devbarIndex > composeIndex, '模型与思考强度必须放在输入框区域（快捷调节条）')
    assert.ok(/>Low<[\s\S]*>High<[\s\S]*>Max</.test(agentSource), '思考强度选项必须是英文 Low/High/Max')
    assert.ok(/'\/quick-config'/.test(agentSource) && /'\/quick-config'/.test(hostSource), '快捷调节必须走局部更新接口，避免覆盖其它设置')
    assert.ok(/renderPlan/.test(agentSource), '前端必须能渲染任务计划卡片')
    assert.ok(/event\.type === 'plan'/.test(agentSource), '前端必须处理计划事件')
    assert.ok(/todo_write/.test(hostSource) && /onPlan/.test(hostSource), '宿主必须把待办进度推给前端')
    assert.ok(/'edit_script'/.test(hostSource) && /FILE_MUTATIONS = new Set\(\[[^\]]*edit_script/.test(hostSource), 'edit_script 必须纳入写盘审批集合')
    // 思考过程显示：默认展开流式可见，三档可切（展开 / 单行预览 / 折叠），选择要落盘
    assert.ok(/event\.reasoning/.test(agentSource), '前端必须消费流式思考片段 (reasoning)')
    assert.ok(/reasoning\$ \+=/.test(agentSource) || /reasoning \+='/.test(agentSource), '思考片段必须逐段累积后整体渲染')
    assert.ok(/renderThinking/.test(agentSource) && /id="yami-ai-messages"/.test(agentSource), '思考块必须渲染进消息列表')
    assert.ok(/'yami-ai-thinking'/.test(agentSource), '思考块必须有独立容器样式类')
    const styleSource = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8')
    assert.ok(/\.yami-ai-thinking\b/.test(styleSource) && /\.yami-ai-thinking-body\b/.test(styleSource), '思考块样式必须落到 style.css')
    assert.ok(/finalizeThinking\(\)/.test(agentSource), '正文开始时必须给思考块收尾')
    assert.ok(/let currentThinkingEl = null/.test(agentSource) && /let thinkingStartedAt = 0/.test(agentSource), '思考块状态必须显式声明（严格模式下会抛错）')
    assert.ok(/state\.thinkingView \|\| 'preview'/.test(agentSource), '思考过程默认单行预览（想看全文点开，或到设置里切「展开」）')
    assert.ok(/danjuan-ai-thinking-view/.test(agentSource), '思考显示方式必须落盘记住')
    assert.ok(/>展开<[\s\S]*>单行预览<[\s\S]*>折叠</.test(agentSource), '思考显示方式必须是 展开 / 单行预览 / 折叠 三档')
    // 位置契约：思考显示属于「设置」，不该再挂在输入框下方的快捷条里（用户明确要求）
    const panelIndex = agentSource.indexOf('id="yami-ai-settings"')
    const viewIndex = agentSource.indexOf('id="yami-ai-thinking-view"')
    const thinkingDevbarIndex = agentSource.indexOf('<div class="yami-ai-devbar">')
    assert.ok(panelIndex > 0 && viewIndex > panelIndex, '思考显示必须放进设置面板')
    assert.ok(thinkingDevbarIndex > 0 && viewIndex < thinkingDevbarIndex, '思考显示不能再留在输入框下方的快捷条里')
    // 折叠控件：纯符号，不要按钮（带底色边框挂在思考块头部太抢眼）
    assert.ok(/yami-ai-thinking-toggle/.test(agentSource) && !/yami-ai-tool-btn yami-ai-thinking-toggle/.test(agentSource), '思考块折叠控件不能再用按钮样式')
    assert.ok(/toggle\.textContent = mode === 'expand' \? '▾' : '▸'/.test(agentSource), '折叠控件要随展开状态切换符号')
    assert.ok(/\.yami-ai-thinking-toggle \{[\s\S]*?background: transparent/.test(styleSource), '折叠符号不能有按钮底色')
    assert.ok(/\.yami-ai-settings select/.test(styleSource), '搬进设置面板的下拉必须有暗色样式（否则在暗黑大盘里露出系统亮色）')
    assert.ok(/applyThinkingModeToAll/.test(agentSource), '切换显示方式必须同步已渲染的思考块')
    // 连接体检：面板必须有「测试连接」入口，且密钥状态要如实显示（踩过「存的是网址却显示已保存」）
    assert.ok(/id="yami-ai-test"/.test(agentSource) && /testConnection/.test(agentSource), '设置区必须有一键【测试连接】')
    assert.ok(/'\/test-connection'/.test(agentSource) && /'\/test-connection'/.test(hostSource), '测试连接必须由宿主真实发起（不能前端假装成功）')
    assert.ok(/renderKeyState/.test(agentSource) && /keyInvalidReason/.test(hostSource), '密钥状态必须如实回报并显示')
    assert.ok(/migrateStoredKey/.test(hostSource), '宿主启动时要体检历史密钥，清掉存成网址的假密钥')
    assert.ok(/deepseek-flash/.test(agentSource), '模型下拉必须有保底选项，不能在宿主没起来时留空')
    // 余额与花费：从对话里的长文案挪到底栏版本号那一行，且只有 AI 助手页显示
    assert.ok(!/finalResult\.usageText/.test(agentSource), '对话里不该再刷「本次调用…」长文案')
    assert.ok(/id="yami-ai-footer-cost"/.test(hudSource), '底栏版本号一行必须有余额/花费位')
    assert.ok(/nextView === 'ai' \? 'inline-flex' : 'none'/.test(hudSource), '该行只在 AI 助手页显示，其它页面必须隐藏')
    assert.ok(/refreshFooterCost/.test(agentSource) && /'\/balance'/.test(agentSource), '底栏数字必须由前端向宿主真实查询')
    assert.ok(/usage\.cost/.test(agentSource), '本次花费取宿主累计的 usage.cost')
    assert.ok(/#yami-ai-footer-cost/.test(styleSource), '底栏成本位必须有样式')
    // 打断输出：主流 agent 的基本能力——点停止要真停（不是只把界面断开）
    assert.ok(/AbortController/.test(agentSource) && /signal: state\.abort\.signal/.test(agentSource), '对话请求必须可中断')
    assert.ok(/function stopStream\(/.test(agentSource) && /state\.busy \? stopStream\(\) : sendMessage\(\)/.test(agentSource), '忙碌时发送键要变成停止键')
    assert.ok(/event\.key !== 'Escape'/.test(agentSource), '必须支持 Esc 打断')
    assert.ok(/status: 'aborted'/.test(hostSource) && /interrupted: true/.test(hostSource), '宿主必须如实回报已打断')
    assert.ok(/function createCancelToken\(/.test(hostSource), '宿主必须有贯穿模型请求与工具循环的取消令牌')
    // 取消不只是 destroy 上游请求：Node 里主动 destroy 只触发 close、不一定触发 error，
    // 光靠 req.on('error') 收尾会让任务永远悬在 await 上（"按了停止还说上一条在处理中"的根因）
    assert.ok(/cancelToken\.onCancel\(\(\) => \{[\s\S]{0,120}req\.destroy\(\)[\s\S]{0,160}finish\(new Error\(cancelToken\.reason/.test(hostSource),
      '取消时必须先销毁上游模型请求，再手工兑现 Promise（否则任务悬空、busy 永不释放）')
    assert.ok(/if \(cancelToken && cancelToken\.cancelled\) break/.test(hostSource), '取消后剩余工具一个都不许再执行')
    assert.ok(/res\.writableEnded\) return/.test(hostSource), '正常收尾不能被误判成打断（req 的 close 在请求读完就触发）')
    // 过程集中：思考与工具收进「执行过程」，正文干净；默认单行预览
    assert.ok(/function beginTurn\(/.test(agentSource) && /class = 'yami-ai-turn'|className = 'yami-ai-turn'/.test(agentSource), '每个回合要有独立容器')
    assert.ok(/function processArea\(/.test(agentSource) && /currentTurn\.process\.body|area\.body/.test(agentSource), '思考与工具步骤必须集中进过程区')
    assert.ok(/state\.thinkingView \|\| 'preview'/.test(agentSource), '思考默认单行预览，不再铺一大段灰字')
    assert.ok(/\.yami-ai-process\b/.test(styleSource) && (/#yami-ai-send\.stop/.test(styleSource)), '过程区与停止键必须有样式')
    // 流式渲染性能：逐 token 必须按帧合并 + 增量追加（旧的每帧重设全文是 O(n²)，会把界面拖死）
    assert.ok(/window\.YamiAiRenderCore/.test(agentSource) && /createScheduler\(\)/.test(agentSource), '必须用渲染核心做帧合并')
    assert.ok(/scheduleRender\(/.test(agentSource) && /createTextBuffer\(\)/.test(agentSource), '片段必须走增量缓冲 + 按帧刷新')
    assert.ok(!/text\$ \+= event\.content;[\s\S]{0,40}if \(bubble\) \{ bubble\.textContent = text\$/.test(agentSource), '不得再每帧重设全文（直写只允许出现在缺少渲染核心的兜底分支里）')
    assert.ok(!/reasoning\$ \+= event\.reasoning;[\s\S]{0,80}renderThinking\(reasoning\$\)/.test(agentSource), '思考也不得每个片段都整块重渲染')
    assert.ok(/historyWindow\(/.test(agentSource), '长会话必须只渲染最近若干条')
    assert.ok(/shouldStickToBottom/.test(coreSource), '贴底判定必须在渲染核心里有实现（前端只做接线）')
    // 思考过程显示：本地存储 + 宿主配置双写，事件委托绑定（面板重建也不失效）
    assert.ok(/function setThinkingView\(/.test(agentSource) && /localStorage\.setItem\('danjuan-ai-thinking-view'/.test(agentSource), '思考显示要写本地存储')
    assert.ok(/request\('\/quick-config', \{ thinkingView: next \}\)/.test(agentSource), '同时要写宿主配置（本地存储不可写时靠它兜底）')
    assert.ok(/settingsBox\.addEventListener\('change'/.test(agentSource), '改档要用事件委托绑定，别绑死在单个节点上')
    assert.ok(/写不进去，已存到宿主配置/.test(agentSource), '本地存储写失败要如实回执')
    assert.ok(/已思考 /.test(agentSource), '思考块必须显示已思考时长与字数')
    // 思考过程要能"回放"：磁盘上一直存着 reasoning_content，回显链路两头都得接上
    assert.ok(/reasoning: message\.reasoning_content/.test(hostSource), '宿主回显历史必须带上思考过程，否则切回旧会话就像思考凭空消失')
    assert.ok(/appendThinkingBlock\(message\.reasoning/.test(agentSource), '切回历史会话时要回放当时的思考块')

    // 思考按「模型轮次」分段（用户反馈：整回合只有一块，多轮推理糊成一堵墙）
    assert.ok(/function sealThinking\(/.test(agentSource) && /function beginThinkingRound\(/.test(agentSource), '思考必须能封段与开段：一个回合里的多轮推理各成一段')
    assert.ok(/if \(event\.type === 'tool'\) \{[\s\S]{0,200}?sealThinking\(\)/.test(agentSource), '工具调用是轮次分界：收到工具事件必须把当前段封口，下一段思考才会另起一块')
    assert.ok(/const segment = thinkingSegments\.accept\(\)/.test(agentSource) && /beginThinkingRound\(segment - 1\)/.test(agentSource), '封段之后的下一条思考增量必须另起一段（否则又并回上一块）')
    assert.ok(/renderCore\.createThinkingSegments/.test(agentSource) && /createThinkingSegments: createThinkingSegments/.test(coreSource), '分段状态机必须用渲染核心那一份（纯逻辑可单测），面板不许再写第二套判据')
    assert.ok(/function \(\) \{\s*let round = 0;/.test(agentSource), '渲染核心缺失时要有同语义的内联兜底（少个文件也不能就不分段了）')
    assert.ok(/labelThinkingRound\(currentThinkingEl, previousIndex\)/.test(agentSource) && /function labelThinkingRound\(/.test(agentSource), '第 1 段要等到"确实还有第 2 段"时才补编号，不然单段任务会挂个没意义的"第 1 段"')
    assert.ok(/function beginThinkingRound\(previousIndex\) \{[\s\S]{0,220}?currentThinkingEl = null;[\s\S]{0,80}?renderThinking\(''\)/.test(agentSource), '开新段前必须把 currentThinkingEl 置空：旧块还 connected，不置空 renderThinking 不会新建，新一段会灌进上一段')
    assert.ok(/setThinkingMeta\(currentThinkingEl, thinkingSegments\.round\(\), seconds/.test(agentSource), '每段自己的计时与字数必须写进段头')
    assert.ok(/thinkingSegments\.reset\(\)/.test(agentSource) && /thinkingTotalMs/.test(agentSource), '新回合要归零段计数，累计耗时也必须显式声明（严格模式下未声明赋值会抛错）')
    assert.ok(/endThinkingRounds\(\)/.test(agentSource), '回合结束要把最后一段也定稿，不能挂着一直计时')
    assert.ok(/renderCore\.processFoldTitle/.test(agentSource) && /rounds: thinkingSegments\.round\(\)/.test(agentSource), '过程区头部要报"想了几段"（口径与收起后共用渲染核心那一份）')
    assert.ok(/rounds > 1\) parts\.push\(rounds \+ ' 段'\)/.test(coreSource), '段数文案在渲染核心里（单段任务不报段数）')
    // 回放要与实时同构：段落边界、编号、工具步骤一个都不能少
    assert.ok(/labelThinkingRound\(lastReplayThinking, replayRound\)/.test(agentSource) && /replayThinkingMeta\(/.test(agentSource), '历史回放也要按段落分块并编号')
    assert.ok(/message\.content \|\| message\.reasoning_content/.test(hostSource), '宿主回显必须把"只有思考没正文"的工具轮也带上，否则回放比实时少内容')
    assert.ok(/steps: calls\.map\(call => toolLabel/.test(hostSource) && /Array\.isArray\(message\.steps\)/.test(agentSource), '工具步骤要随回放一起还原（回放与实时的过程区必须长得一样）')
    assert.ok(/if \(message\.content\) addMessage\(/.test(agentSource), '纯工具轮没有正文，不许塞空气泡')

    // 轮次过程收起（参考 DSH 的紧凑模式）+ 每轮用量行
    assert.ok(/function applyTurnFold\(/.test(agentSource) && /applyTurnFold\(\);/.test(agentSource), '轮次结束要按偏好决定收不收过程行')
    assert.ok(/renderCore\.turnProcessFold/.test(agentSource) && /turnProcessFold: turnProcessFold/.test(coreSource), '收起判据必须用渲染核心那一份（纯逻辑可单测），面板不许自己再写一套')
    assert.ok(/area\.box\.contains\(document\.activeElement\)/.test(agentSource), '自动收起若会把键盘焦点藏掉，必须保持展开（焦点不能莫名其妙消失）')
    assert.ok(/currentTurn\.body && currentTurn\.body\.textContent\.trim\(\)/.test(agentSource), '没有最终正文时不得收起：那轮只剩过程证据，收了等于把信息藏了')
    assert.ok(/function processFoldMode\(/.test(agentSource) && /danjuan-ai-process-fold/.test(agentSource), '紧凑/标准两档要能落盘记住')
    assert.ok(/id="yami-ai-process-fold"/.test(agentSource) && /setProcessFold\(event\.target\.value\)/.test(agentSource), '设置面板要有「执行过程收起」档并能改')
    assert.ok(/processFold: \['compact', 'standard'\]\.includes/.test(hostSource) && /processFold: config\.processFold === 'standard'/.test(hostSource), '宿主配置要校验并回传该档（换窗口后设置不丢）')
    // 「再次出现的思考窗口没有文字」的两个根因，各自钉一条断言
    assert.ok(!/thinkingTextNode/.test(agentSource), '思考的文本节点不许再用 streamChat 的闭包变量：开新段时它仍指向上一块（还 connected），新段的字会全灌进旧块、新块永远是空的')
    assert.ok(/body\.firstChild && body\.firstChild\.nodeType === 3/.test(agentSource), '展开模式的文本节点必须从当前块里取（一段一块，块与块不能共用节点）')
    assert.ok(/mode === 'preview'[\s\S]{0,560}?reasoningBuffer\.lastLine\(160\)/.test(agentSource), '单行预览必须实时刷新那一行（用缓冲的 lastLine，不许每帧 split 全文），否则刚出现的思考窗口整段都是空的')
    assert.ok(/let span = body\.firstElementChild[\s\S]{0,600}?span\.textContent !== line/.test(agentSource), '预览行要就地更新，别每帧重建节点')
    assert.ok(/renderTurnUsage\(finalResult\.turnUsage\)/.test(agentSource) && /renderTurnUsage\(data\.turnUsage\)/.test(agentSource), '流式与审批两条路径都要渲染每轮用量行')
    assert.ok(/formatTurnUsage/.test(agentSource) && /formatTurnUsage: formatTurnUsage/.test(coreSource), '用量行的"记账不全就不显示"要用渲染核心那一份')
    assert.ok(/noteModelAttempt\(session, !!\(assistant && assistant\.__usage\)\)/.test(hostSource), '每次模型调用都要记一笔（没报 usage 的那次会让整行不显示）')
    assert.ok(/async function runTurn\(session, config, events\)/.test(hostSource) && /turnUsageOf\(session\)/.test(hostSource), '每轮用量要挂在结果上交给前端')
    assert.ok(/\.yami-ai-turn-usage \{/.test(hudSource), '用量行要有样式（否则前端建了也看不见）')

    // ---- 对齐 DSH 的四项机制：工具卡片 / 系统提示词行 / 排队与引导 / 轮次导航轨道 ----
    assert.ok(/function pushToolCard\(/.test(agentSource) && /'yami-ai-tool collapsed'/.test(agentSource), '工具调用要渲染成卡片（一行摘要 + 可展开细节），不再是一行过程条')
    assert.ok(/revealPath\(event\.target\)/.test(agentSource) && /showItemInFolder/.test(agentSource), '卡片上的路径要能一键定位到文件夹（失败退化成复制路径）')
    assert.ok(/toolCardChips\(info\)/.test(agentSource) && /toolCardChips: toolCardChips/.test(coreSource), '卡片标签必须来自渲染核心那份纯逻辑（只说确定性事实，不编数字）')
    assert.ok(/function spillFullOutput\(/.test(hostSource) && /__clip/.test(hostSource), '超长工具输出要落盘，并在事件里带"已截断 + 落在哪"')
    assert.ok(/truncationText\(info\)/.test(agentSource) && /truncated: true/.test(hostSource), '被截断就必须如实标注，不许让人以为看到的是完整输出')
    assert.ok(/if \(event\.type === 'system'\)/.test(agentSource) && /function pushSystemRow\(/.test(agentSource), '要有一行可折叠的「系统提示词」（模型这一轮实际看到的原文）')
    assert.ok(/noteSystemSurface\(session, session\.messages, events\)/.test(hostSource) && /systemHashes/.test(hostSource), '系统提示词上屏要按文本指纹去重，文本没变不重复刷')
    assert.ok(/queue: \[\]/.test(agentSource) && /function enqueueMessage\(/.test(agentSource) && /function flushQueue\(/.test(agentSource), '繁忙时打的话要进排队区、本轮结束后发出，不许再被吞掉')
    assert.ok(/sendMessage\(state\.busy && \(event\.ctrlKey \|\| event\.metaKey\) \? 'steer' : undefined\)/.test(agentSource), 'Enter 发送 + Ctrl/Cmd+Enter 是保留的引导快捷键（不占按钮）')
    // 用户裁决：输入区不放任何额外按钮，繁忙时的行为由设置决定（排队 / 打断）
    assert.ok(!/yami-ai-queue-btn|yami-ai-steer-btn/.test(agentSource), '输入区不许再放「排队 / 引导」按钮：一个发送按钮就够了，别让用户每次选')
    assert.ok(/id="yami-ai-busy-send"/.test(agentSource) && /<option value="queue" selected>/.test(agentSource), '设置里要有「繁忙时发送」两档（默认排队）')
    assert.ok(/function busySendMode\(/.test(agentSource) && /danjuan-ai-busy-send/.test(agentSource), '这两档要能落盘记住')
    assert.ok(/busySend: \['queue', 'interrupt'\]\.includes/.test(hostSource) && /busySend: config\.busySend === 'interrupt'/.test(hostSource), '宿主配置要校验并回传该档（换窗口后设置不丢）')
    assert.ok(/async function interruptThenSend\(text\)/.test(agentSource) && /stopStream\(\)[\s\S]{0,220}?await runMessage\(text\)/.test(agentSource), '「打断」档要先真停当前轮、等它收尾再发，不能硬发被 busy 顶回来')
    assert.ok(/async function sendSteer\(/.test(agentSource) && /request\('\/steer'/.test(agentSource), '前端要能走引导通道')
    assert.ok(/pathname === '\/steer'/.test(hostSource) && /drainSteer\(session\)/.test(hostSource), '宿主必须有引导通道，并在步骤边界投递（不是假装收下）')
    assert.ok(/undeliveredSteer/.test(hostSource) && /undeliveredSteer/.test(agentSource), '没赶上这一轮的引导要如实退回排队区')
    assert.ok(/function buildRail\(/.test(agentSource) && /activeTurnIndex/.test(agentSource), '轮次导航轨道要按阅读线高亮当前轮（判据来自渲染核心）')
    assert.ok(/const toolCards = new Map\(\)/.test(agentSource) && /key: String\(call && call\.id \|\| name\)/.test(hostSource), '工具卡片要按调用 id 匹配：只读批次并发跑，单槽变量会把结果写到别人的卡片上')
    assert.ok(/async function runMessage\(text\)/.test(agentSource) && !/input\.value = next\.text/.test(agentSource), '排队接力不许动输入框：用户可能正在敲下一条')
    // 跨 IIFE 调私有函数是运行时 ReferenceError（静态自检抓到过一次）：面板要用自己的 hudToast
    assert.ok(!/\bshowToast\(/.test(agentSource), 'ai-agent.js 不许直接调 hud-overlay 的 showToast（那是另一个 IIFE 的私有函数），要用自己的 hudToast')
    assert.ok(/function hudToast\(/.test(agentSource) && /getElementById\('yami-perf-toast'\)/.test(agentSource), '面板轻提示要复用 HUD 那颗 toast 节点（同款样式）')
    // 这一轮"盲区排查"修掉的各处，各钉一条断言
    assert.ok(/读不到那个路径/.test(hostSource), '落盘提示不许骗模型：MCP 只认工程内相对路径，绝对路径读不了')
    assert.ok(/function resolvePendingCard\(/.test(agentSource) && /resolvePendingCard\(approve, /.test(agentSource), '审批有结论后要把那张卡片收尾，不能永远停在"等待你确认"')
    assert.ok(/takeUndeliveredSteer\(session\)[\s\S]{0,160}?error\.undeliveredSteer/.test(hostSource), '这一轮抛错时也要把没送出去的引导退回（铁律㊷）')
    assert.ok(/undeliveredSteer: error\.undeliveredSteer/.test(hostSource) && /err\.payload = data/.test(agentSource), '失败响应要带回退执，前端要能读到')
    assert.ok(/function isUnsafeSnapshotPath\(/.test(probeSource) && /isUnsafeSnapshotPath\(rel\)/.test(probeSource), '整包安装要挡住越出插件目录的路径（../ 与绝对路径）')
    assert.ok(/kept\.slice\(40\)/.test(hostSource), '落盘文件要有上限，不能无限长')
    for (const cls of ['yami-ai-tool', 'yami-ai-system', 'yami-ai-steer', 'yami-ai-queue', 'yami-ai-rail']) {
      assert.ok(new RegExp('\\.' + cls + ' \\{').test(hudSource), cls + ' 必须有样式（src/style.css 经构建注入 HUD）')
    }
    assert.ok(/\.yami-ai-system-body::-webkit-scrollbar/.test(hudSource) && /\.yami-ai-queue::-webkit-scrollbar/.test(hudSource), '新增的滚动容器必须纳入滚动条单一事实源（构建门禁会拦）')
    assert.ok(/let reasoningBuffer = renderCore \? renderCore\.createTextBuffer\(\) : null/.test(agentSource) && /reasoningBuffer = renderCore \? renderCore\.createTextBuffer\(\) : null;/.test(agentSource), '每段必须换一个思考缓冲：共用一个缓冲会让第二段把第一段的字一起吞进去')

    // 滚动跟随：生成时自动停在最新，用户往上翻历史时一个字都不许动他的视口
    assert.ok(/createFollowState/.test(coreSource) && /createFollowState/.test(agentSource), '滚动跟随状态机要放在渲染核心里实现（纯逻辑可单测）')
    assert.ok(/TAIL_THRESHOLD = 24/.test(agentSource), '贴底阈值要收紧到一行左右（80px 会让刚上滚的用户仍被拽回底部）')
    assert.ok(/addEventListener\('wheel'/.test(agentSource), '要用滚轮事件识别"用户在看历史"的意图，不能只靠事后距离判定')
    assert.ok(/function autoScroll\(force\)/.test(agentSource) && /autoScroll\(true\)/.test(agentSource), '发消息与切会话要强制回到最新')
    assert.ok(/bindFollowScroll\(\)/.test(agentSource), '面板建好后要绑上滚动意图监听')
    assert.ok(/id = 'yami-ai-jump'/.test(agentSource), '暂停跟随时要有「回到最新」提示入口')
    assert.ok(/\.yami-ai-jump\s*\{/.test(hudSource), '「回到最新」提示必须有样式（否则前端建了也不显示）')
    assert.ok(/renderCore\.previewLine|typeof renderCore\.previewLine/.test(agentSource), '思考单行预览要用渲染核心的最后一行取值')
    // 思考块显示：内容取最后一行只是"取对了"，还得保证"看得见"
    assert.ok(/justify-content: flex-end !important/.test(hudSource), '单行预览必须右对齐 + 左侧裁切，否则最新的字被右侧省略号吃掉')
    assert.ok(/yami-ai-thinking\.preview \.yami-ai-thinking-body > span/.test(hudSource), '单行预览的文本要用 span 承载（flex 的匿名文本项会被压缩，裁不到左边）')
    assert.ok(/function isNearBottom\(/.test(agentSource), '思考块内部要复用同一套贴底判定')
    // 停止必须真的"停得下来"：MCP 没有取消语义，裸 await 会让界面一直卡在 busy
    assert.ok(/function callToolWithCancel\(/.test(hostSource), '工具调用必须可取消（否则按下停止还要等工具跑完，期间新消息被 busy 顶回）')
    assert.ok(/const result = await callToolWithCancel\(client, name, args, cancelToken\)/.test(hostSource), '独占工具执行必须走可取消路径')
    assert.ok(/events, cancelToken\)\]/.test(hostSource) && /item\.args, events, cancelToken\)/.test(hostSource), '只读批处理也要把取消令牌传下去')
    assert.ok(/function repeatHint\(/.test(hostSource) && /__hint/.test(hostSource), '同一工具反复调用时要给模型一句提示，帮它自己收敛')
    assert.ok(/if \(near\) body\.scrollTop = body\.scrollHeight/.test(agentSource), '展开模式下思考块自身要跟随到最新一行（它有 max-height:30vh 的滚动区，不会自己跟着长）')
    assert.ok(/let near = isNearBottom\(body\)/.test(agentSource), '贴底判定必须发生在写入之前（写完 scrollHeight 就变大，必然误判）')
    assert.ok(/previewLine/.test(coreSource), '最后一行取值规则本身要在渲染核心里')
    assert.ok(/function appendThinkingBlock\(/.test(agentSource), '历史与流式共用同一个思考块构造函数')

    // 编辑器与场景实时环境感知断言 (方案 A + 缺陷加固)
    const mcpServerSource = fs.readFileSync(path.join(ROOT, 'runtime/yami-mcp/server.js'), 'utf8')
    assert.ok(/function getEditorContext\(/.test(probeSource) && /formatEditorContextSummary\(/.test(probeSource), 'probe-core 必须提供 getEditorContext 与环境摘要生成')
    assert.ok(/req\.method === 'GET' && req\.url === '\/context'/.test(probeSource), '5967 编辑器桥必须暴露 /context 路由')
    assert.ok(/name: 'get_editor_context'/.test(mcpServerSource), 'MCP 必须注册 get_editor_context 工具')
    assert.ok(/fetchEditorContextSummary/.test(hostSource) && /messagesForApi\(messages, envSummary\)/.test(hostSource), 'ai-host 必须在发请求前抓取环境快照并动态注入 system prompt')
    // 行为与字段真实性断言：拒绝死字段、恒空、恒假与越界
    assert.ok(/meta\.file\s*&&\s*\(meta\.file\.alias\s*\|\|\s*meta\.file\.name\)/.test(probeSource), '检视器对象名必须读取 Inspector.meta.file.alias，不能读不存在的 meta.name')
    assert.ok(/tgt\.class\s*\|\|\s*tgt\.type/.test(probeSource), '场景对象类别必须读取 Scene.target.class，不能恒为 object')
    assert.ok(/af\.alias\s*\|\|\s*af\.name/.test(probeSource), '资源树选中文件名优先使用 alias 别名，去除 16位 GUID 噪音')
    assert.ok(/full\.length > 180 \? full\.slice\(0, 177\) \+ '\.\.\.' : full/.test(probeSource), '环境摘要必须有 180 字符长度上限防爆')
    assert.ok(/window\.__YAMI_CTX__ = getEditorContext/.test(probeSource) && /window\.__YAMI_CTX_SUMMARY__/.test(probeSource), 'probe-core 必须在 window 暴露环境上下文直读钩子')
    assert.ok(/envSummary:\s*liveEnv/.test(agentSource), '前端流式请求必须直发当前窗口环境快照')
    assert.ok(/events\s*&&\s*events\.envSummary/.test(hostSource), 'ai-host 必须优先采用前端上报的环境快照，防止试玩被误报为编辑器')

    // 动态运行断言：抽取 formatEditorContextSummary 验证真实产出
    const vm = require('vm')
    const fnExtract = probeSource.match(/function formatEditorContextSummary\(ctx\) \{[\s\S]*?\n  \}/)
    assert.ok(fnExtract, '必须能提取 formatEditorContextSummary 函数实现')
    const sandbox = {}
    vm.runInNewContext(fnExtract[0] + '; result = formatEditorContextSummary({ playtest: true, scene: "测试场景", selectedFile: { name: "木剑.item", type: "item" }, sceneTarget: { name: "主角", type: "actor" }, inspector: { metaName: "木剑.item" } });', sandbox)
    assert.strictEqual(sandbox.result, '【当前环境】试玩运行中 · 场景「测试场景」 · 选中「item/木剑.item」 · 场景对象「actor:主角」 · 检视「木剑.item」', '格式化摘要必须包含准确的场景、选中项、场景对象类型与检视对象')

    console.log('前端接线检查: 流式 / 历史面板 / 上下文刻度 / 工具卡片 / 思考过程显示 / 过程收起 / 每轮用量 / 系统提示词行 / 排队与引导 / 轮次导航 / 环境感知行为 全绿通过')
  } catch (error) {
    error.message += '\nAI host stderr:\n' + stderr
    throw error
  } finally {
    host.kill()
    model.close()
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
