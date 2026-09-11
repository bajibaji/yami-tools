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
  if (latestUser && latestUser.content.includes('只读') && !hasToolAfterUser) {
    message = { role: 'assistant', content: '', tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'list_scripts', arguments: '{}' } }] }
  } else if (latestUser && latestUser.content.includes('修改') && !hasToolAfterUser) {
    message = {
      role: 'assistant', content: '准备修改事件描述。',
      tool_calls: [{ id: 'write-1', type: 'function', function: { name: 'patch_resource', arguments: JSON.stringify({ path: EVENT_REL, patch: { description: 'AI E2E preview only' } }) } }]
    }
  } else {
    message = { role: 'assistant', content: latestUser && latestUser.content.includes('修改') ? '修改已取消，工程未变化。' : '只读工具调用完成。' }
  }
  json(res, 200, { choices: [{ message }] })
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
    assert.ok(/cancelToken\.onCancel\(\(\) => \{ try \{ req\.destroy\(\)/.test(hostSource), '取消时要真正销毁上游模型请求')
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
    assert.ok(/shouldStickToBottom/.test(agentSource), '滚动跟随必须先判断用户是否停在底部')
    // 思考过程显示：本地存储 + 宿主配置双写，事件委托绑定（面板重建也不失效）
    assert.ok(/function setThinkingView\(/.test(agentSource) && /localStorage\.setItem\('danjuan-ai-thinking-view'/.test(agentSource), '思考显示要写本地存储')
    assert.ok(/request\('\/quick-config', \{ thinkingView: next \}\)/.test(agentSource), '同时要写宿主配置（本地存储不可写时靠它兜底）')
    assert.ok(/settingsBox\.addEventListener\('change'/.test(agentSource), '改档要用事件委托绑定，别绑死在单个节点上')
    assert.ok(/写不进去，已存到宿主配置/.test(agentSource), '本地存储写失败要如实回执')
    assert.ok(/已思考 /.test(agentSource), '思考块必须显示已思考时长与字数')
    console.log('前端接线检查: 流式 / 历史面板 / 上下文刻度 / 工具事件 / 思考过程显示 全部接上')
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
