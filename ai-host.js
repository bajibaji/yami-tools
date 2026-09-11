#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { spawn } = require('child_process')

const PORT = Number(process.env.YAMI_AI_PORT || 5968)
const TOKEN = process.env.YAMI_AI_TOKEN || crypto.randomBytes(24).toString('hex')
const PARENT_PID = Number(process.env.YAMI_AI_PARENT_PID || 0)
const CONFIG_DIR = process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite')
const CONFIG_PATH = path.join(CONFIG_DIR, 'ai-config.json')
const MCP_PATH = path.join(__dirname, 'runtime', 'yami-mcp', 'server.js')
const sessions = new Map()
let projectRoot = process.env.YAMI_PROJECT_ROOT || ''
let mcp = null

const FILE_MUTATIONS = new Set([
  'write_resource', 'create_script', 'write_script', 'patch_resource',
  'delete_resource', 'append_event_commands', 'upsert_database_item'
])
const OTHER_MUTATIONS = new Set(['click_element', 'trigger_playtest', 'editor_action', 'interact_editor', 'send_player_input', 'send_player_pointer'])
const HIDDEN_TOOLS = new Set(['cdp_eval'])

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-yami-agent-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  res.end(JSON.stringify(data))
}

function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => {
      raw += chunk
      if (raw.length > limit) { reject(new Error('请求内容过大')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { reject(new Error('请求 JSON 无法解析')) }
    })
    req.on('error', reject)
  })
}

function isProjectRoot(root) {
  try {
    const dir = path.resolve(String(root || ''))
    return fs.existsSync(path.join(dir, 'game.yamirpg')) || (fs.existsSync(path.join(dir, 'Assets')) && fs.existsSync(path.join(dir, 'Data')))
  } catch { return false }
}

function psDpapi(mode, value) {
  if (process.platform !== 'win32') return Promise.resolve(mode === 'protect' ? Buffer.from(value, 'utf8').toString('base64') : Buffer.from(value, 'base64').toString('utf8'))
  const code = mode === 'protect'
    ? "[Reflection.Assembly]::LoadWithPartialName('System.Security')|Out-Null;$v=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))"
    : "[Reflection.Assembly]::LoadWithPartialName('System.Security')|Out-Null;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))"
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || 'Windows 密钥保护失败')))
    child.stdin.end(String(value))
  })
}

function readStoredConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return {
      endpoint: data.endpoint || 'https://api.deepseek.com/chat/completions',
      model: data.model || 'deepseek-chat',
      encryptedKey: data.encryptedKey || '',
      approvalMode: data.approvalMode === 'auto' ? 'auto' : 'confirm'
    }
  } catch {
    return { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', encryptedKey: '', approvalMode: 'confirm' }
  }
}

async function saveConfig(input) {
  const current = readStoredConfig()
  const next = {
    endpoint: String(input.endpoint || current.endpoint).trim(),
    model: String(input.model || current.model).trim(),
    approvalMode: input.approvalMode === 'auto' ? 'auto' : 'confirm',
    encryptedKey: current.encryptedKey
  }
  if (!/^https?:\/\//i.test(next.endpoint)) throw new Error('模型地址必须以 http:// 或 https:// 开头')
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) next.encryptedKey = await psDpapi('protect', input.apiKey.trim())
  if (input.clearApiKey === true) next.encryptedKey = ''
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  return publicConfig(next)
}

function publicConfig(config = readStoredConfig()) {
  return { endpoint: config.endpoint, model: config.model, approvalMode: config.approvalMode, hasApiKey: !!(config.encryptedKey || process.env.DEEPSEEK_API_KEY) }
}

async function getApiKey(config) {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  return config.encryptedKey ? await psDpapi('unprotect', config.encryptedKey) : ''
}

class McpClient {
  constructor(root) {
    this.root = root
    this.child = null
    this.buffer = ''
    this.id = 1
    this.pending = new Map()
    this.tools = []
  }

  async start() {
    if (!fs.existsSync(MCP_PATH)) throw new Error('插件内置 yami-mcp 缺失，请重新安装或更新插件')
    if (!isProjectRoot(this.root)) throw new Error('当前没有打开有效的 Open Yami 工程')
    this.child = spawn(process.execPath, [MCP_PATH, '--root', this.root], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', YAMI_PROJECT_ROOT: this.root }
    })
    this.child.stdout.on('data', chunk => this.onData(chunk))
    this.child.stderr.on('data', chunk => process.stderr.write('[embedded-mcp] ' + chunk.toString()))
    this.child.on('exit', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('内置 MCP 进程已退出'))
      this.pending.clear()
      this.child = null
    })
    await this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'danjuan-ai', version: '1.0.0' } })
    const list = await this.rpc('tools/list', {})
    this.tools = (list.tools || []).filter(tool => !HIDDEN_TOOLS.has(tool.name))
    return this
  }

  onData(chunk) {
    this.buffer += chunk.toString()
    let index
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const pending = this.pending.get(msg.id)
      if (pending) { this.pending.delete(msg.id); msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result) }
    }
  }

  rpc(method, params) {
    if (!this.child) return Promise.reject(new Error('内置 MCP 未启动'))
    const id = this.id++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 超时')) }, 180000)
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  async call(name, args) {
    const result = await this.rpc('tools/call', { name, arguments: args || {} })
    const text = result.content && result.content[0] && result.content[0].text
    return text ? JSON.parse(text) : { ok: !result.isError }
  }

  close() { if (this.child) this.child.kill() }
}

async function ensureMcp() {
  if (!mcp) mcp = await new McpClient(projectRoot).start()
  return mcp
}

function modelTools(tools) {
  return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema || { type: 'object', properties: {} } } }))
}

function requestModel(config, apiKey, messages, tools) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.endpoint)
    const transport = url.protocol === 'http:' ? http : https
    const body = Buffer.from(JSON.stringify({ model: config.model, messages, tools, tool_choice: 'auto', temperature: 0.2 }), 'utf8')
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': body.length }
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey
    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: 'POST', headers, timeout: 120000 }, res => {
      let raw = ''
      res.on('data', chunk => {
        raw += chunk
        if (raw.length > 16 * 1024 * 1024) { reject(new Error('模型响应过大')); req.destroy() }
      })
      res.on('end', () => {
        let data
        try { data = JSON.parse(raw) } catch { return reject(new Error('模型响应无法解析')) }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(data.error && data.error.message || `模型请求失败：HTTP ${res.statusCode}`))
        const message = data.choices && data.choices[0] && data.choices[0].message
        if (!message) return reject(new Error('模型没有返回消息'))
        resolve(message)
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('模型请求超时，请检查网络或模型地址')) })
    req.end(body)
  })
}

const SYSTEM_PROMPT = `你是 Open Yami RPG Editor 内置开发副驾。用简体中文回答，面向不懂代码的用户。
你可以通过工具读取和操作当前工程。遵守以下规则：
1. 修改前先读取目标和相关调用方，优先复用现有脚本、事件和引擎能力。
2. 工程文件写入工具先预览；系统会统一处理确认和正式写入，不要绕过确认。
3. TS 修改后调用 compile_check；资源修改后调用 validate_resource，跨资源改动后调用 validate_project。
4. 不暴露 GUID 等内部细节，除非用户明确询问；结果用白话说明改了什么、验证是否通过。
5. 不承诺没有验证的结果。遇到错误时说明恢复办法。不要请求或输出 API Key。`

function sessionFor(id) {
  if (!sessions.has(id)) sessions.set(id, { messages: [{ role: 'system', content: SYSTEM_PROMPT }], pending: null })
  return sessions.get(id)
}

function safeArgs(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}) } catch { return {} }
}

function summarizePending(name, args, preview) {
  const target = args.path || args.table || args.action || args.key || ''
  const summary = name === 'write_script' ? `替换完整脚本，共 ${String(args.content || '').length} 个字符`
    : name === 'patch_resource' ? `修改字段：${Object.keys(args.patch || {}).join('、') || '未提供'}`
      : name === 'append_event_commands' ? `写入 ${Array.isArray(args.commands) ? args.commands.length : 0} 条事件指令`
        : name === 'upsert_database_item' ? `更新 ${args.table || '数据表'} 中的一项`
          : name === 'delete_resource' ? '删除此资源并保留备份'
            : name === 'create_script' ? `新建 ${args.nameZh || args.className || '脚本'}`
              : `执行 ${name}`
  return {
    tool: name,
    target: String(target),
    summary,
    message: preview && (preview.message || preview.error) || `准备执行 ${name}`,
    preview: preview ? {
      dryRun: preview.dryRun === true,
      changedBytes: preview.changedBytes,
      oldSha256: preview.oldSha256,
      newSha256: preview.newSha256
    } : null
  }
}

async function continueSession(session, config) {
  const client = await ensureMcp()
  const key = await getApiKey(config)
  if (!key && /^https:\/\/api\.deepseek\.com/i.test(config.endpoint)) throw new Error('请先在设置中填写 DeepSeek API Key')
  for (let step = 0; step < 12; step++) {
    const assistant = await requestModel(config, key, session.messages, modelTools(client.tools))
    session.messages.push(assistant)
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : []
    if (!calls.length) return { ok: true, status: 'done', message: assistant.content || '任务已完成' }
    const approval = await processToolCalls(session, calls, config, assistant.content)
    if (approval) return approval
  }
  throw new Error('本次任务步骤过多，已停止。请把需求拆成更小的任务后重试')
}

async function processToolCalls(session, calls, config, assistantContent = '') {
  const client = await ensureMcp()
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index]
    const name = call.function && call.function.name
    const args = safeArgs(call.function && call.function.arguments)
    const isFileMutation = FILE_MUTATIONS.has(name)
    const needsApproval = isFileMutation || (OTHER_MUTATIONS.has(name) && config.approvalMode !== 'auto')
    if (needsApproval) {
      const preview = isFileMutation ? await client.call(name, { ...args, dryRun: true }) : null
      if (preview && preview.ok === false) {
        session.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(preview) })
        continue
      }
      session.pending = { call, name, args, preview, remaining: calls.slice(index + 1) }
      return { ok: true, status: 'approval', message: assistantContent || '这一步会修改工程或控制编辑器，请确认。', approval: summarizePending(name, args, preview) }
    }
    const result = await client.call(name, args)
    session.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
  }
  return null
}

async function handle(pathname, body) {
  if (pathname === '/config') return await saveConfig(body)
  if (pathname === '/project') {
    if (!isProjectRoot(body.projectRoot)) throw new Error('没有找到有效的 Open Yami 工程目录')
    const next = path.resolve(body.projectRoot)
    if (next !== projectRoot) { if (mcp) mcp.close(); mcp = null; projectRoot = next; sessions.clear() }
    await ensureMcp()
    return { ok: true, projectRoot }
  }
  if (pathname === '/chat') {
    const text = String(body.message || '').trim()
    if (!text) throw new Error('请输入要完成的事情')
    const session = sessionFor(String(body.sessionId || 'default'))
    if (session.pending) throw new Error('请先执行或取消上一项修改')
    session.messages.push({ role: 'user', content: text })
    return await continueSession(session, readStoredConfig())
  }
  if (pathname === '/approve' || pathname === '/reject') {
    const session = sessionFor(String(body.sessionId || 'default'))
    if (!session.pending) throw new Error('没有等待确认的操作')
    const pending = session.pending
    session.pending = null
    let result
    if (pathname === '/reject') result = { ok: false, rejected: true, message: '用户取消了这项操作' }
    else {
      const args = FILE_MUTATIONS.has(pending.name)
        ? { ...pending.args, expectedSha256: pending.preview && pending.preview.oldSha256, dryRun: false }
        : pending.args
      result = await (await ensureMcp()).call(pending.name, args)
    }
    session.messages.push({ role: 'tool', tool_call_id: pending.call.id, content: JSON.stringify(result) })
    if (pending.remaining && pending.remaining.length) {
      const approval = await processToolCalls(session, pending.remaining, readStoredConfig())
      if (approval) return approval
    }
    return await continueSession(session, readStoredConfig())
  }
  if (pathname === '/clear') { sessions.delete(String(body.sessionId || 'default')); return { ok: true } }
  throw new Error('未知请求')
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {})
  if (req.headers['x-yami-agent-token'] !== TOKEN) return sendJson(res, 401, { ok: false, error: 'AI 助手令牌无效' })
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  try {
    if (req.method === 'GET' && pathname === '/status') return sendJson(res, 200, { ok: true, projectRoot, mcpReady: !!mcp, config: publicConfig() })
    if (req.method === 'GET' && pathname === '/config') return sendJson(res, 200, { ok: true, ...publicConfig() })
    if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'Not found' })
    const body = await readJson(req)
    sendJson(res, 200, { ok: true, ...(await handle(pathname, body)) })
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message })
  }
})

server.on('error', error => { process.stderr.write('[danjuan-ai] ' + error.message + '\n'); process.exit(1) })
server.listen(PORT, '127.0.0.1', () => process.stderr.write(`[danjuan-ai] ready http://127.0.0.1:${PORT}\n`))

if (PARENT_PID > 0) {
  setInterval(() => {
    try { process.kill(PARENT_PID, 0) } catch { if (mcp) mcp.close(); process.exit(0) }
  }, 3000).unref()
}

process.on('SIGTERM', () => { if (mcp) mcp.close(); process.exit(0) })
