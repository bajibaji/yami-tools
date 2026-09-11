'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PROJECT = 'D:\\new-game'
const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 15968 + Math.floor(Math.random() * 1000)
const MODEL_PORT = AI_PORT + 1000
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'danjuan-ai-test-'))
const EVENT_PATH = path.join(PROJECT, 'Assets', '! 事件', '@1 启动游戏事件.896108c7557627ff.event')
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
      tool_calls: [{ id: 'write-1', type: 'function', function: { name: 'patch_resource', arguments: JSON.stringify({ path: 'Assets/! 事件/@1 启动游戏事件.896108c7557627ff.event', patch: { description: 'AI E2E preview only' } }) } }]
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
      endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake-model', apiKey: 'test-secret', approvalMode: 'confirm'
    })
    assert.equal(saved.data.ok, true, saved.data.error)
    assert.equal(saved.data.hasApiKey, true)
    assert.equal(JSON.stringify(saved.data).includes('test-secret'), false, 'API Key 不得返回面板')

    const project = await request('/project', 'POST', { projectRoot: PROJECT })
    assert.equal(project.data.ok, true, project.data.error)

    const read = await request('/chat', 'POST', { sessionId: 'read', message: '执行只读检查' })
    assert.equal(read.data.status, 'done', JSON.stringify(read.data))
    assert.match(read.data.message, /只读工具调用完成/)

    const preview = await request('/chat', 'POST', { sessionId: 'write', message: '修改事件描述' })
    assert.equal(preview.data.status, 'approval', JSON.stringify(preview.data))
    assert.equal(preview.data.approval.tool, 'patch_resource')
    assert.equal(preview.data.approval.target, 'Assets/! 事件/@1 启动游戏事件.896108c7557627ff.event')
    assert.equal(fs.readFileSync(EVENT_PATH, 'utf8'), originalEvent, '预览阶段不得修改工程')

    const rejected = await request('/reject', 'POST', { sessionId: 'write' })
    assert.equal(rejected.data.status, 'done', JSON.stringify(rejected.data))
    assert.match(rejected.data.message, /取消/)
    assert.equal(fs.readFileSync(EVENT_PATH, 'utf8'), originalEvent, '取消后工程不得变化')

    console.log('AI Agent E2E: 鉴权、密钥保护、只读工具、写入预览、取消回滚全部通过')
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
