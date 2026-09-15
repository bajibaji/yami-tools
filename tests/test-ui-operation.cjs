'use strict'
/**
 * 界面操作与演出引擎 · 真实通道行为断言（零依赖，纯 Node.js）
 *
 * 这套测试只有一条原则：**只调产品入口，绝不在测试里把产品逻辑重写一遍**。
 *
 * 上一版把 probe.ui.ringTo 覆盖成桩、再在测试里写个 for 循环当"执行器"，
 * 于是演出引擎一行都没被跑到也全绿（甚至连 getEditorContext 抛 ReferenceError
 * 都没测出来）。现在改成三条真通道：
 *
 *   A. 把真的 probe-core.js 装进沙盒，接管 require('http') 拿到 5967 的真请求处理器，
 *      先 GET /token 取真令牌，再 POST /action —— 全链路无桩。
 *   B. 真的 spawn yami-mcp，用标准 JSON-RPC 问 tools/list，确认 ui_steps 真注册了。
 *   C. 真的把 ai-host 拉起来，用假模型截获**实际发给模型**的 system 提示词，
 *      验证"谁提问就用谁的视野"和对齐卡协议真的到达了模型。
 *
 * 用法: node tests/test-ui-operation.cjs
 */
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PROBE_SRC = fs.readFileSync(path.join(ROOT, 'probe-core.js'), 'utf8')

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ============================== 沙盒 DOM ============================== */

function createDom() {
  const all = []
  const byId = new Map()
  class El {
    constructor(tag, id) {
      this.nodeType = 1                      // 产品代码用 nodeType 判"是不是元素"，假 DOM 不能少这一项
      this.tagName = String(tag || 'div').toUpperCase()
      this.id = id || ''
      this._cls = new Set()
      this.attributes = new Map()
      this.style = {}
      this.value = ''
      this.textContent = ''
      this.children = []
      this.parentElement = null
      this.isConnected = true
      this._ls = new Map()
      this.dispatched = []
      this._rect = { x: 200, y: 100, width: 150, height: 32, top: 100, left: 200, right: 350, bottom: 132 }
      this._clicks = 0
      this._focuses = 0
      this._blurs = 0
      all.push(this)
      if (id) byId.set(id, this)
    }
    get classList() {
      const s = this._cls
      return {
        add: (...c) => c.forEach(x => s.add(x)),
        remove: (...c) => c.forEach(x => s.delete(x)),
        contains: c => s.has(c),
        toggle: c => (s.has(c) ? s.delete(c) : s.add(c))
      }
    }
    get className() { return [...this._cls].join(' ') }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)) }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null }
    setAttribute(k, v) { this.attributes.set(k, String(v)) }
    removeAttribute(k) { this.attributes.delete(k) }
    addEventListener(e, f) { if (!this._ls.has(e)) this._ls.set(e, []); this._ls.get(e).push(f) }
    removeEventListener(e, f) { const l = this._ls.get(e); if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1) } }
    dispatchEvent(ev) {
      this.dispatched.push(ev && ev.type)
      const l = this._ls.get(ev && ev.type)
      if (l) l.slice().forEach(f => f(ev))
      return true
    }
    focus() { this._focuses++; document.activeElement = this; this.dispatchEvent({ type: 'focus' }) }
    blur() { this._blurs++; if (document.activeElement === this) document.activeElement = null; this.dispatchEvent({ type: 'blur' }) }
    click() { this._clicks++; this.dispatchEvent({ type: 'click' }) }
    appendChild(c) { c.parentElement = this; this.children.push(c); if (c.id) byId.set(c.id, c); return c }
    contains(c) { return c === this || this.children.indexOf(c) >= 0 }
    remove() {
      this.isConnected = false
      if (this.parentElement) {
        const i = this.parentElement.children.indexOf(this)
        if (i >= 0) this.parentElement.children.splice(i, 1)
      }
      if (this.id) byId.delete(this.id)
    }
    getBoundingClientRect() {
      if (!this.isConnected) return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }
      return this._rect
    }
    get previousElementSibling() {
      const parent = this.parentElement
      if (!parent) return null
      const i = parent.children.indexOf(this)
      return i > 0 ? parent.children[i - 1] : null
    }
    closest(sel) {
      let node = this
      while (node && node.nodeType !== 9) {
        for (const s of String(sel).split(',')) if (matchOne(node, s)) return node
        node = node.parentElement
      }
      return null
    }
    querySelector() { return null }
    querySelectorAll() { return [] }
  }
  function matchOne(el, sel) {
    sel = sel.trim()
    if (sel.startsWith('#')) return el.id === sel.slice(1)
    if (sel.startsWith('.')) return el._cls.has(sel.slice(1))
    if (sel.startsWith('[')) {
      const m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)
      if (!m) return false
      return m[2] === undefined ? el.attributes.has(m[1]) : el.getAttribute(m[1]) === m[2]
    }
    const parts = sel.split('.')
    if (el.tagName.toLowerCase() !== parts[0].toLowerCase()) return false
    return parts.slice(1).every(c => el._cls.has(c))
  }
  const document = {
    createElement: t => new El(t),
    createTextNode(t) { const e = new El('#text'); e.nodeType = 3; e.textContent = t; return e },
    getElementById: id => byId.get(id) || null,
    querySelector(sel) {
      for (const s of String(sel).split(',')) for (const e of all) if (e.isConnected && matchOne(e, s)) return e
      return null
    },
    querySelectorAll(sel) {
      const out = []
      for (const e of all) for (const s of String(sel).split(',')) if (e.isConnected && matchOne(e, s)) { out.push(e); break }
      return out
    },
    activeElement: null,
    body: null,
    documentElement: new El('html'),
    head: new El('head'),
    // 真实的事件总线：在场感知靠 pointerover / focusin 跟踪用户停在哪，
    // 假成一个空函数就等于把这条链整个跳过（那正是我们要测的东西）
    _listeners: new Map(),
    addEventListener(type, fn) {
      if (!document._listeners.has(type)) document._listeners.set(type, [])
      document._listeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const list = document._listeners.get(type)
      if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
    },
    dispatchEvent(ev) {
      const list = document._listeners.get(ev && ev.type)
      if (list) list.slice().forEach(fn => fn(ev))
      return true
    }
  }
  document.body = new El('body')
  return { document, El, byId, all }
}

/* ============================== 把 probe-core 装进沙盒 ============================== */

const EDITOR_URL = 'file:///D:/Program%20Files/Open%20Yami%20RPG%20Editor/resources/app/dist/index.html'

async function bootProbe(options) {
  const withEngine = !options || options.engine !== false
  const { document, El, byId } = createDom()
  const servers = []
  const fakeHttp = {
    createServer(handler) {
      const s = {
        handler, port: null, errs: [],
        on(ev, fn) { if (ev === 'error') s.errs.push(fn); return s },
        listen(port, host, cb) { s.port = port; if (cb) cb(); return s },
        close() {}
      }
      servers.push(s)
      return s
    }
  }
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document,
    performance: { now: () => Date.now() },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set, Symbol,
    setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: clearTimeout,
    Event: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}) } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = (o && o.detail) || {} } },
    PointerEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}) } },
    location: { href: EDITOR_URL, pathname: '/D:/Program%20Files/Open%20Yami%20RPG%20Editor/resources/app/dist/index.html' },
    BroadcastChannel: class { postMessage() {} close() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node' },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    require: name => (name === 'http' ? fakeHttp : require(name)),
    process: { versions: { node: process.versions.node }, platform: process.platform },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
  }
  // 官方预编译版根本没有 window.YamiEngine / 裸全局，引擎接口一个都取不到。
  // 测试要能复刻这种局面：桥仍然必须起来，纯 DOM 能力不受影响。
  if (withEngine) {
    sandbox.File = { root: 'D:/Documents/GitHub/DemoGame', save: async () => {}, get: async () => ({}) }
    sandbox.Directory = { update: async () => {} }
    sandbox.Data = { manifest: { guid: 'demo-guid', changes: [], pathMap: {}, guidMap: {}, project: {} } }
    sandbox.Layout = { manager: { index: 'scene', switch(p) { sandbox.Layout.manager.index = p } } }
    sandbox.UndoManager = { undo() {}, redo() {} }
    sandbox.Title = { playGame: async () => {} }
  }
  sandbox.window = sandbox
  sandbox.global = sandbox
  sandbox.globalThis = sandbox
  vm.runInNewContext(PROBE_SRC, sandbox, { filename: 'probe-core.js' })

  const probe = sandbox.window.__YAMI_PERF_PROBE__
  if (!probe) throw new Error('沙盒里没有初始化出 window.__YAMI_PERF_PROBE__')
  for (let i = 0; i < 400 && !servers.some(s => s.port === 5967); i++) {
    await new Promise(r => setTimeout(r, 25))
  }
  return { sandbox, probe, document, El, byId, servers, editor: servers.find(s => s.port === 5967) }
}

/** 直接把请求喂给真实请求处理器（不起真实端口，但走的是同一份 handler 与同一套令牌校验） */
function call(server, method, url, body, headers) {
  return new Promise(resolve => {
    const listeners = new Map()
    const req = {
      method, url, headers: headers || {},
      on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); return req },
      destroy() {}
    }
    const res = {
      statusCode: null, body: null, headers: {},
      setHeader(k, v) { res.headers[k] = v },
      writeHead(code) { res.statusCode = code; return res },
      end(b) { res.body = b }
    }
    let thrown = null
    try { server.handler(req, res) } catch (e) { thrown = e }
    if (thrown) return resolve({ status: 0, thrown: thrown.message, json: null })
    setTimeout(() => {
      const payload = body == null ? '' : JSON.stringify(body)
      ;(listeners.get('data') || []).forEach(f => f(payload))
      ;(listeners.get('end') || []).forEach(f => f())
    }, 0)
    const started = Date.now()
    ;(function poll() {
      if (res.body != null && res.body !== undefined) {
        let json = null
        try { json = JSON.parse(res.body) } catch (e) { /* 非 JSON */ }
        return resolve({ status: res.statusCode, json })
      }
      if (Date.now() - started > 40000) return resolve({ status: res.statusCode, json: null, timeout: true })
      setTimeout(poll, 5)
    })()
  })
}

/* ============================== 假工程夹具（给 MCP / 宿主用） ============================== */

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-ui-fixture-'))
  fs.mkdirSync(path.join(dir, 'Data'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'game.yamirpg'), JSON.stringify({ title: '夹具工程' }))
  fs.writeFileSync(path.join(dir, 'Data', 'config.json'), JSON.stringify({ title: '夹具工程', window: { width: 1280, height: 720, title: '夹具工程', display: 'windowed' } }))
  fs.writeFileSync(path.join(dir, 'Data', 'manifest.json'), JSON.stringify({ guidMap: {}, pathMap: {}, project: {} }))
  // 一个真实可改的事件文件：审批时机那两条断言需要"预览能成功"，否则根本走不到确认那一步
  fs.writeFileSync(path.join(dir, 'Assets', '测试事件.0123456789abcdef.event'), JSON.stringify({ commands: [] }))
  return dir
}

/* ============================== 真通道 B：MCP 工具表 ============================== */

function askMcpTools(root) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(ROOT, 'runtime', 'yami-mcp', 'server.js'), '--root', root], {
      cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    })
    let out = ''
    let settled = false
    const finish = tools => {
      if (settled) return
      settled = true
      try { child.kill() } catch (e) {}
      resolve(tools)
    }
    child.stdout.on('data', d => {
      out += d.toString()
      for (const line of out.split('\n')) {
        if (!line.trim()) continue
        let msg = null
        try { msg = JSON.parse(line) } catch (e) { continue }
        if (msg.id === 2 && msg.result && Array.isArray(msg.result.tools)) finish(msg.result.tools)
      }
    })
    child.stderr.on('data', () => {})
    child.on('error', () => finish(null))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ui-op-test', version: '1' } } }) + '\n')
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    }, 300)
    setTimeout(() => finish(null), 12000)
  })
}

/* ============================== 真通道 C：宿主 + 假模型 ============================== */

/** plan: null=直接回文本；{name,args}=先发一次工具调用，拿到结果后再回文本 */
function startFakeModel(captured, plan) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch (e) { /* 忽略 */ }
        captured.push(body)
        const messages = body.messages || []
        const lastUser = messages.map(m => m.role).lastIndexOf('user')
        const hasToolResult = lastUser >= 0 && messages.slice(lastUser + 1).some(m => m.role === 'tool')
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        const active = plan && plan.current
        if (active && active.name && !hasToolResult) {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_probe_1', type: 'function', function: { name: active.name, arguments: JSON.stringify(active.args || {}) } }] } }] }) + '\n\n')
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n')
          res.write('data: [DONE]\n\n')
          return res.end()
        }
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '收到，我先看一眼。' } }] }) + '\n\n')
        res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

/** 把 SSE 原文切成事件数组，便于按 phase 断言 */
function parseSse(raw) {
  return String(raw || '').split('\n\n').map(block => {
    const line = block.split('\n').find(one => one.startsWith('data:'))
    if (!line) return null
    try { return JSON.parse(line.slice(5).trim()) } catch (e) { return null }
  }).filter(Boolean)
}

function jsonCall(port, route, method, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port, path: route, method,
      headers: Object.assign({ 'x-yami-agent-token': token }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { resolve({}) } })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function streamChat(port, token, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/chat/stream', method: 'POST',
      headers: { 'x-yami-agent-token': token, 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, res => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', c => { raw += c })
      res.on('end', () => resolve(raw))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function systemTextOf(body) {
  return (body.messages || []).filter(m => m.role === 'system').map(m => String(m.content || '')).join('\n')
}

/* ============================== 主流程 ============================== */

async function main() {
  const fixture = makeFixture()
  let host = null
  let model = null
  const cleanup = () => {
    try { if (host) host.kill() } catch (e) {}
    try { if (model) model.close() } catch (e) {}
    try { fs.rmSync(fixture, { recursive: true, force: true }) } catch (e) {}
  }

  try {
    /* ---------------- A. 演出引擎与操作桥（真 HTTP 通道） ---------------- */
    console.log('--- A. 演出引擎与 5967 动作桥（真请求处理器 + 真令牌）---')
    const boot = await bootProbe()
    check('5967 编辑器动作桥已启动（真实 createServer）', !!boot.editor, boot.editor ? 'port 5967' : '未启动')

    // P0 回归守卫：getEditorContext 曾经因为块级作用域引用 isEditorHostPage 而每次调用都抛
    let ctxErr = null
    let ctxVal = null
    try { ctxVal = boot.probe.getEditorContext() } catch (e) { ctxErr = e }
    check('probe.getEditorContext() 可执行（作用域回归守卫）', !ctxErr, ctxErr ? ctxErr.constructor.name + ': ' + ctxErr.message : 'environment=' + (ctxVal && ctxVal.environment))

    if (!boot.editor) throw new Error('5967 桥没起来，后面的真通道断言无法进行')
    const editor = boot.editor
    const tokenRes = await call(editor, 'GET', '/token')
    const token = tokenRes.json && tokenRes.json.bridgeToken
    check('GET /token 拿到真实桥接令牌', !!token)
    const H = { 'x-yami-bridge-token': token }

    const ctxRes = await call(editor, 'GET', '/context')
    const ctx = ctxRes.json && ctxRes.json.context
    check('GET /context 返回 ok（曾经的 ReferenceError 现场）', ctxRes.json && ctxRes.json.ok === true, JSON.stringify(ctxRes.json).slice(0, 140))
    check('上下文带 scope / page / hasPendingInput 字段', !!(ctx && ctx.scope && ctx.page !== undefined && ctx.hasPendingInput !== undefined))

    const who = await call(editor, 'GET', '/whoami')
    check('GET /whoami 报出真实工程根（File.root）', who.json && who.json.projectRoot === 'D:/Documents/GitHub/DemoGame', who.json && who.json.projectRoot)

    // --- 正常三步：真执行 + 真演出 ---
    const atk = new boot.El('input', 'fileItem-attack'); atk.value = '10'; boot.document.body.appendChild(atk)
    const def = new boot.El('input', 'fileItem-def'); def.value = '5'; boot.document.body.appendChild(def)
    const save = new boot.El('div', 'btn-save'); boot.document.body.appendChild(save)
    const scratch = new boot.El('input', 'user-scratch'); scratch.value = '用户没提交的字'; boot.document.body.appendChild(scratch)
    scratch.focus()
    const order = []
    atk.addEventListener('focus', () => order.push('focus:attack'))
    def.addEventListener('input', () => order.push('input:def'))
    save.addEventListener('click', () => order.push('click:save'))
    const step = (kind, target, extra) => Object.assign({ kind, target, holdMs: 5, settleMs: 5 }, extra || {})

    const runA = await call(editor, 'POST', '/action', {
      action: 'uiSteps',
      steps: [
        step('focus', '#fileItem-attack', { label: '聚焦攻击力' }),
        step('set', '#fileItem-def', { value: 50, label: '防御改成 50' }),
        step('click', '#btn-save', { label: '点保存' })
      ]
    }, H)
    check('uiSteps 三步全成 ok:true', runA.json && runA.json.ok === true, JSON.stringify(runA.json).slice(0, 120))
    // 中间那次 focus:attack 是 set 的"焦点保护"把焦点还给了原来聚焦的控件 —— 这是预期行为，不是重复执行
    check('三步按序真实执行，且 set 之后把焦点还原给原控件',
      order.join(';') === 'focus:attack;input:def;focus:attack;click:save', order.join(';'))
    check('DOM 真值变更（value=50 / click=1）', def.value === '50' && save._clicks === 1, 'value=' + def.value + ' clicks=' + save._clicks)
    check('set 走完 focus -> input -> change -> blur（能进撤销栈）',
      def._focuses >= 1 && def._blurs >= 1 && def.dispatched.indexOf('change') >= 0,
      'focus=' + def._focuses + ' blur=' + def._blurs + ' 事件=' + def.dispatched.join(','))
    check('操作完用户原有焦点与未提交内容无损', boot.document.activeElement === scratch && scratch.value === '用户没提交的字')

    const ring = boot.byId.get('yami-ai-ring')
    const box = ring && ring.children.find(c => String(c.className).indexOf('yami-ai-ring-box') >= 0)
    check('演出浮层 #yami-ai-ring 真被创建并挂到 body', !!ring && ring.children.length >= 3, ring ? '子节点=' + ring.children.length : '缺失')
    check('高亮框按目标 rect 定位（transform translate）', !!box && /translate\(200px, 100px\)/.test(String(box.style.transform)),
      box ? box.style.transform + ' ' + box.style.width + 'x' + box.style.height : '缺失')
    check('演出结束后浮层已收起（无残留幽灵框）', !!ring && ring.style.display === 'none')

    // --- 熔断：第 2 步目标不存在 ---
    const mp = new boot.El('input', 'fileItem-mp'); mp.value = '100'; boot.document.body.appendChild(mp)
    let step3Ran = false
    mp.addEventListener('input', () => { step3Ran = true })
    const runB = await call(editor, 'POST', '/action', {
      action: 'uiSteps',
      steps: [
        step('set', '#fileItem-attack', { value: '200' }),
        step('set', '#ghost-not-exist', { value: '999' }),
        step('set', '#fileItem-mp', { value: '999' })
      ]
    }, H)
    check('失败熔断返回 ok:false 且 failedAt=1', runB.json && runB.json.ok === false && runB.json.failedAt === 1, JSON.stringify(runB.json).slice(0, 150))
    check('第 3 步绝对没有被执行', step3Ran === false && mp.value === '100', '触发=' + step3Ran + ' mp=' + mp.value)
    check('已完成的第 1 步如实入账 done', !!(runB.json && Array.isArray(runB.json.done) && runB.json.done.length === 1))

    // --- 急停：cancel 必须在白名单里（此前 /ui-cancel 打到未知名返回 400 被吞） ---
    const cancelRes = await call(editor, 'POST', '/action', { action: 'cancel', reason: '测试停止' }, H)
    check('cancel 动作在 5967 白名单内（/ui-cancel 不再是死路）', cancelRes.status === 200 && cancelRes.json && cancelRes.json.ok === true,
      'status=' + cancelRes.status + ' ' + JSON.stringify(cancelRes.json).slice(0, 110))

    // --- 急停：打断落在 wait 步骤（曾经被 ringTo 里的 cancelled=false 吞掉） ---
    const d1 = new boot.El('input', 'd1'); boot.document.body.appendChild(d1)
    const d2 = new boot.El('input', 'd2'); boot.document.body.appendChild(d2)
    const d3 = new boot.El('input', 'd3'); boot.document.body.appendChild(d3)
    const slowRun = call(editor, 'POST', '/action', {
      action: 'uiSteps',
      steps: [
        step('set', '#d1', { value: 'A' }),
        Object.assign(step('wait', '#d2'), { duration: 500 }),
        step('set', '#d3', { value: 'C' })
      ]
    }, H)
    await new Promise(r => setTimeout(r, 150))
    boot.probe.ui.cancel('用户在停顿期间按了停')
    const runD = await slowRun
    check('急停落在 wait 步骤之间仍被尊重（回归守卫）', runD.json && runD.json.ok === false && runD.json.cancelled === true, JSON.stringify(runD.json).slice(0, 170))
    check('急停后剩余步骤没有被执行', d3.value === '', 'd3=' + JSON.stringify(d3.value))

    // --- 批量合并：用真实默认节奏测耗时 ---
    for (const n of ['m1', 'm2', 'm3', 'u1', 'u2', 'u3']) {
      const el = new boot.El('input', n); el.value = '0'; boot.document.body.appendChild(el)
    }
    const t0 = Date.now()
    const merged = await call(editor, 'POST', '/action', {
      action: 'uiSteps',
      steps: [
        { kind: 'set', target: '#m1', value: 1, mergeGroup: 'g' },
        { kind: 'set', target: '#m2', value: 2, mergeGroup: 'g' },
        { kind: 'set', target: '#m3', value: 3, mergeGroup: 'g' }
      ]
    }, H)
    const mergedMs = Date.now() - t0
    const t1 = Date.now()
    const plain = await call(editor, 'POST', '/action', {
      action: 'uiSteps',
      steps: [
        { kind: 'set', target: '#u1', value: 1 },
        { kind: 'set', target: '#u2', value: 2 },
        { kind: 'set', target: '#u3', value: 3 }
      ]
    }, H)
    const plainMs = Date.now() - t1
    check('同 mergeGroup 的三步全成', merged.json && merged.json.ok === true)
    check('合并演出耗时 <= 1400ms', mergedMs <= 1400, mergedMs + 'ms')
    check('合并确实比逐步演出快', mergedMs < plainMs, '合并 ' + mergedMs + 'ms vs 逐步 ' + plainMs + 'ms')
    check('逐步演出同样全部执行成功', plain.json && plain.json.ok === true && boot.byId.get('u3').value === '3')

    // --- 未失焦输入探测 ---
    boot.document.activeElement = null
    const idle = boot.probe.hasPendingInput()
    const focused = new boot.El('input', 'search-box'); boot.document.body.appendChild(focused)
    focused.focus()
    const busy = boot.probe.hasPendingInput()
    focused.blur()
    check('hasPendingInput：无焦点时 false', idle === false)
    check('hasPendingInput：输入框聚焦未失焦时 true', busy === true)
    check('hasPendingInput：失焦后自动解除', boot.probe.hasPendingInput() === false)

    // --- 白名单没被放宽成通配 ---
    const unknown = await call(editor, 'POST', '/action', { action: 'evalJs', expression: 'alert(1)' }, H)
    check('未知动作仍被拒（白名单没被放宽）', unknown.status === 400 && unknown.json && unknown.json.ok === false, 'status=' + unknown.status)

    /* ---------------- A3. 在场感知：用户此刻停在哪 ---------------- */
    console.log('\n--- A3. 在场感知（用户停在哪个控件上）---')
    boot.document.activeElement = null   // 别把前面几条用例留下的焦点带进来
    // 造一个"引擎控件"：tip 挂在控件本体上，鼠标实际落在它内部的 input 上
    const numBox = new boot.El('number-box', 'probe-attack-field')
    numBox.tip = '攻击力\n伤害计算用的基础值'
    numBox.setAttribute('name', '攻击力')
    numBox.value = '25'
    const innerInput = new boot.El('input')
    numBox.appendChild(innerInput)
    boot.document.body.appendChild(numBox)

    boot.document.dispatchEvent({ type: 'pointerover', target: innerInput })
    const tooEarly = boot.probe.getPresence()
    check('刚划过不算停留（未到停留阈值前不报）', !tooEarly, JSON.stringify(tooEarly))

    await new Promise(r => setTimeout(r, 750))
    const rested = boot.probe.getPresence()
    check('停在控件上会被认出来（从内部 input 往上找到控件本体的 tip）',
      !!rested && rested.label === '攻击力', JSON.stringify(rested))
    check('顺带带上控件类型与当前值', !!rested && rested.kind === 'number-box' && rested.value === '25', rested && (rested.kind + '=' + rested.value))
    check('记录停留了多久（供"他盯着这个看了很久"这类判断）', !!rested && rested.restingMs >= 600, rested && rested.restingMs + 'ms')

    const withCtx = boot.probe.getEditorContext()
    check('getEditorContext 带上了停留点', !!(withCtx.presence && withCtx.presence.label === '攻击力'))

    const shortSummary = boot.sandbox.__YAMI_CTX_SUMMARY__()
    check('环境摘要以"停在"为核心且足够短', /停在「攻击力」/.test(shortSummary) && shortSummary.length <= 60,
      shortSummary.length + ' 字: ' + shortSummary)

    // tip 是 getter 函数时同样要能读（引擎两种写法都在用）
    const fnTipEl = new boot.El('item')
    fnTipEl.tip = () => '撤销\n快捷键 Ctrl+Z'
    boot.document.body.appendChild(fnTipEl)
    boot.document.activeElement = fnTipEl
    const byFocus = boot.probe.getPresence()
    check('tip 写成 getter 函数也能读', !!byFocus && byFocus.label === '撤销', JSON.stringify(byFocus))
    check('点进去的控件优先于鼠标停留', !!byFocus && byFocus.via === 'focus', byFocus && byFocus.via)
    boot.document.activeElement = null

    // 鼠标挪到我们自己的面板上（来打字）时，必须保留"他上一个停的地方"
    const dock = new boot.El('div', 'yami-perf-dock')
    const panelInput = new boot.El('textarea', 'yami-ai-input')
    dock.appendChild(panelInput)
    boot.document.body.appendChild(dock)
    boot.document.dispatchEvent({ type: 'pointerover', target: panelInput })
    const kept = boot.probe.getPresence()
    check('鼠标移到 AI 面板上时，保留他上一个停的地方（这恰恰是最该报的时刻）',
      !!kept && kept.label === '攻击力', JSON.stringify(kept))

    // 右键"指着"某处：引擎会给它描一圈高亮边框，是"就是它"最明确的手势
    const schoolBox = new boot.El('select-box', 'probe-school-field')
    schoolBox.tip = '流派'
    boot.document.body.appendChild(schoolBox)
    boot.document.dispatchEvent({ type: 'pointerdown', button: 2, target: schoolBox })
    const byRight = boot.probe.getPresence()
    check('右键指着的控件会被认出来', !!byRight && byRight.label === '流派' && byRight.via === 'rightclick', JSON.stringify(byRight))
    check('右键（更新更明确）优先于更早的鼠标停留', !!byRight && byRight.label === '流派', byRight && byRight.via)
    const rightSummary = boot.sandbox.__YAMI_CTX_SUMMARY__()
    check('摘要随之切到右键指的东西，且仍然短', /停在「流派」/.test(rightSummary) && rightSummary.length <= 60,
      rightSummary.length + ' 字: ' + rightSummary)

    // 引擎自己记的选中态：common-list.pointerdown 里 case 0 / case 2 同一支 → select() → addClass('selected')。
    // 这才是"右键高亮那个东西"的权威来源，比悬停/焦点都硬。
    const pickedItem = new boot.El('common-item', 'probe-picked-item')
    pickedItem.tip = '火球术'
    pickedItem.classList.add('selected')
    boot.document.body.appendChild(pickedItem)
    const bySelected = boot.probe.getPresence()
    // 选中态是"持续状态"，不是"此刻在哪"：有指针/焦点信号时它不该顶掉那些信号
    check('有指针信号时，旧的选中态不会盖掉"他现在在哪儿"',
      !!bySelected && bySelected.via !== 'selected', JSON.stringify(bySelected))

    // 反过来：什么指针信号都没有时，选中态就是唯一线索，必须报出来（单开一个干净沙盒验）
    const selOnly = await bootProbe({ engine: true })
    selOnly.document.activeElement = null
    const loneItem = new selOnly.El('common-item', 'probe-lone-item')
    loneItem.tip = '火球术'
    loneItem.classList.add('selected')
    selOnly.document.body.appendChild(loneItem)
    const lone = selOnly.probe.getPresence()
    check('没有指针信号时，引擎的选中态（右键/点选出的那圈高亮）会被认出来',
      !!lone && lone.label === '火球术' && lone.via === 'selected', JSON.stringify(lone))
    const loneSummary = selOnly.sandbox.__YAMI_CTX_SUMMARY__()
    // 停留点来自"引擎选中态"（他点的那圈高亮）时，措辞是"选中"而不是"停在" ——
    // 用户点了东西却看到"停在「…」"，会以为 AI 没认出他选的是什么（实测反馈）
    check('摘要切到选中项，措辞用"选中"，仍然是一行短句', /选中「火球术」/.test(loneSummary) && loneSummary.length <= 60, loneSummary)

    // 真实检视器结构（照抄引擎静态标记）：
    //   <text>Icon</text><custom-box id="fileSkill-icon" type="file"></custom-box>
    const grid = new boot.El('detail-grid', 'fileSkill-general-grid')
    const labelText = new boot.El('text')
    labelText.textContent = 'Icon'
    const iconBox = new boot.El('custom-box', 'fileSkill-icon')
    iconBox.textContent = '双手武器精通'
    grid.appendChild(labelText)
    grid.appendChild(iconBox)
    boot.document.body.appendChild(grid)
    boot.document.activeElement = iconBox
    // 真实使用里人的动作相隔几百毫秒以上；这里也留出间隔，
    // 否则同一毫秒内三个信号撞在一起，测的就成了"排序稳定性"而不是"谁更近"
    await new Promise(r => setTimeout(r, 30))
    const field = boot.probe.getPresence()
    check('检视器字段：字段名取自紧邻的前一个 <text>，值取自控件自身文字',
      !!field && field.label === 'Icon' && field.value === '双手武器精通', JSON.stringify(field))
    check('顺带记下控件自己的 id（模型据此能用选择器定位到它）', !!field && field.where === 'fileSkill-icon', field && field.where)
    const fieldSummary = boot.sandbox.__YAMI_CTX_SUMMARY__()
    check('摘要：停在「字段名」=值，一行说完', /停在「Icon」=双手武器精通/.test(fieldSummary), fieldSummary)

    // 真实标记：<number-box id="animation-speed" …><text class="label">speed:</text></number-box>
    // 标签写在控件**内部**，不是前面的兄弟 —— 这条是被"拿引擎真实标记做覆盖率审计"找出来的
    // （1533 个控件实例里，有 85 个是这种写法，原先的实现全都取不到名字）。
    const speedBox = new boot.El('number-box', 'animation-speed')
    const speedLabel = new boot.El('text')
    speedLabel.className = 'label'
    speedLabel.textContent = 'speed:'
    speedBox.appendChild(speedLabel)
    speedBox.textContent = 'speed:1.0'   // 真 DOM 里 textContent 会把内部标签与值拼在一起
    boot.document.body.appendChild(speedBox)
    boot.document.activeElement = speedBox
    await new Promise(r => setTimeout(r, 30))
    const innerLabelled = boot.probe.getPresence()
    check('标签写在控件内部时也能取到，而且值会剥掉标签',
      !!innerLabelled && innerLabelled.label === 'speed:' && innerLabelled.value === '1.0', JSON.stringify(innerLabelled))
    boot.document.activeElement = null

    // 分两轮问：含糊的"区域级"候选不许盖掉更早的**精确**候选（实测用户踩到：点了界面树里的节点，
    // 那个列表同时拿到焦点 → 区域级「界面元素列表」把他真正点的节点整个盖掉了）。
    // 这一 boot 里前面右键过「流派」（精确），鼠标再停在 canvas 上（区域级）→ 该报那个精确的。
    boot.document.activeElement = null
    const sceneBox = new boot.El('box', 'scene-screen')
    const canvasInner = new boot.El('div')          // 无文字、无 tip、无 name
    sceneBox.appendChild(canvasInner)
    boot.document.body.appendChild(sceneBox)
    boot.document.dispatchEvent({ type: 'pointerover', target: canvasInner })
    await new Promise(r => setTimeout(r, 700))
    const onCanvas = boot.probe.getPresence()
    check('含糊的区域级候选不许盖掉更早的精确候选（右键指过的东西）',
      !!onCanvas && onCanvas.label === '流派' && onCanvas.via === 'rightclick', JSON.stringify(onCanvas))

    // 反过来：**没有任何精确候选**时，区域级停留点是弱信号 —— 他高亮选中的东西优先。
    // 实测（用户会话日志）：他明明选中了「329.落雷.skill」，鼠标停在检视器空白处，顶栏却报"停在「检视器」"。
    // 单开一个干净沙盒（没有右键残留）钉这条，容器用引擎真实标记 <page-frame id="inspector-page-manager">。
    const weakBoot = await bootProbe({ engine: true })
    weakBoot.document.activeElement = null
    const weakItem = new weakBoot.El('common-item', 'weak-picked')
    weakItem.tip = '火球术'
    weakItem.classList.add('selected')
    weakBoot.document.body.appendChild(weakItem)
    const weakFrame = new weakBoot.El('page-frame', 'inspector-page-manager')
    const weakBlank = new weakBoot.El('div')
    weakFrame.appendChild(weakBlank)
    weakBoot.document.body.appendChild(weakFrame)
    weakBoot.document.dispatchEvent({ type: 'pointerover', target: weakBlank })
    await new Promise(r => setTimeout(r, 700))
    const weakAt = weakBoot.probe.getPresence()
    check('停在检视器空白处不许报成"停在检视器"（他高亮选中的是那个技能）',
      !!weakAt && weakAt.via === 'selected' && weakAt.label === '火球术', JSON.stringify(weakAt))
    const blankSummary = weakBoot.sandbox.__YAMI_CTX_SUMMARY__()
    check('摘要里不再出现"停在「检视器」"', !/停在「检视器」/.test(blankSummary), blankSummary)

    // 反过来：什么也没选中时，区域级停留点照样要报出来（不是什么都不说）—— 单开一个干净沙盒验
    const regionOnly = await bootProbe({ engine: true })
    regionOnly.document.activeElement = null
    const rScene = new regionOnly.El('box', 'scene-screen')
    const rInner = new regionOnly.El('div')
    rScene.appendChild(rInner)
    regionOnly.document.body.appendChild(rScene)
    regionOnly.document.dispatchEvent({ type: 'pointerover', target: rInner })
    await new Promise(r => setTimeout(r, 700))
    const regionAt = regionOnly.probe.getPresence()
    check('什么也没选中时，区域级停留点照样报出来（不是什么都不说）',
      !!regionAt && regionAt.label === '场景视图' && regionAt.vague === true && regionAt.kind === 'region',
      JSON.stringify(regionAt))
    const regionSummary = regionOnly.sandbox.__YAMI_CTX_SUMMARY__()
    check('区域级停留点照样是一行短句', /停在「场景视图」/.test(regionSummary) && regionSummary.length <= 60, regionSummary)

    // 没有标签的控件：退到"所在窗口的名字"（引擎把窗口名写在 <title-bar> 里）——
    // 换个干净沙盒验，免得被这一 boot 里前面的右键残留影响（这里测的是"名字取得对不对"，不是优先级）
    // 真实标记：<window-frame id="showText"><title-bar>Show Text<close></close></title-bar><content-frame>…
    const labelBoot = await bootProbe({ engine: true })
    labelBoot.document.activeElement = null
    const win = new labelBoot.El('window-frame', 'showText')
    const winTitle = new labelBoot.El('title-bar')
    winTitle.textContent = 'Show Text'
    const winBody = new labelBoot.El('content-frame')
    const winField = new labelBoot.El('text-area', 'showText-content')
    win.appendChild(winTitle); win.appendChild(winBody); winBody.appendChild(winField)
    labelBoot.document.body.appendChild(win)
    labelBoot.document.activeElement = winField
    const inWindow = labelBoot.probe.getPresence()
    check('没标签的控件退到「所在窗口的名字」（取自引擎的 title-bar）',
      !!inWindow && inWindow.label === 'Show Text' && inWindow.vague === true, JSON.stringify(inWindow))

    // ...或者所在分组的 legend：<field-set id="event-commands-fieldset"><legend>Content</legend>…
    const fieldSet = new labelBoot.El('field-set', 'event-commands-fieldset')
    const legend = new labelBoot.El('legend')
    legend.textContent = 'Content'
    const cmdList = new labelBoot.El('command-list', 'event-commands')
    fieldSet.appendChild(legend); fieldSet.appendChild(cmdList)
    labelBoot.document.body.appendChild(fieldSet)
    labelBoot.document.activeElement = cmdList
    const inField = labelBoot.probe.getPresence()
    // legend 是紧邻的前一个兄弟 → 走精确路径拿到名字（比区域兜底更好）；区域兜底只是它够不着时的补网
    check('分组里的控件能取到 legend 当名字', !!inField && inField.label === 'Content', JSON.stringify(inField))

    // 反过来：区域兜底不许盖掉已经识别出来的具体控件
    boot.document.dispatchEvent({ type: 'pointerover', target: iconBox })
    await new Promise(r => setTimeout(r, 700))
    const backToField = boot.probe.getPresence()
    check('换回具体控件时仍然精确识别（区域兜底不会顶掉它）',
      !!backToField && backToField.label === 'Icon' && !backToField.vague, JSON.stringify(backToField))

    /* ---------------- A3d. 用户实测那一下：点界面树节点 + 列表拿到焦点 + 资源树亮着个文件夹 ---------------- */
    console.log('\n--- A3d. 界面树节点（用户截图那一下，整条链一起验）---')
    const shotBoot = await bootProbe({ engine: true })
    shotBoot.sandbox.Layout = { manager: { index: 'ui', switch(p) { shotBoot.sandbox.Layout.manager.index = p } } }
    // 界面页正在编辑的文件（引擎真实字段 UI.meta，ui-window.ts:534）
    shotBoot.sandbox.UI = {
      meta: { guid: 'aabbccdd11223344', path: 'Assets/UI/大地图.aabbccdd11223344.ui', file: { alias: '大地图.ui', path: 'Assets/UI/大地图.aabbccdd11223344.ui' } }
    }
    // 被点选的界面树节点（引擎 shape：纯名字写在 textNode；E 是"有事件"角标，后面是锁/可见性字形）
    const uiList = new shotBoot.El('node-list', 'ui-element')
    const uiNode = new shotBoot.El('node-item', 'ui-node-del')
    uiNode.textNode = { nodeValue: '删除存档数据' }
    uiNode.textContent = '删除存档数据' + 'E' + '\uE001\uE002'
    uiList.appendChild(uiNode)
    shotBoot.document.body.appendChild(uiList)
    uiNode.classList.add('selected')
    // 点节点 → 列表同时拿到焦点（那个含糊的区域级候选就是这么来的）
    shotBoot.document.activeElement = uiList
    shotBoot.document.dispatchEvent({ type: 'pointerover', target: uiNode })
    // 资源树里亮着的是个**文件夹**（用户："我没有选择项目里的粒子"）
    const shotBrowser = new shotBoot.El('file-browser', 'project-browser')
    shotBrowser.body = { activeFile: { name: '粒子', path: 'Assets/粒子' }, selections: [{ name: '粒子', path: 'Assets/粒子' }] }
    shotBoot.document.body.appendChild(shotBrowser)
    await new Promise(r => setTimeout(r, 700))
    const shotAt = shotBoot.probe.getPresence()
    check('点过的树节点不许被列表焦点（区域级）盖掉',
      !!shotAt && shotAt.label === '删除存档数据' && shotAt.via === 'selected', JSON.stringify(shotAt))
    const shotCtx = shotBoot.probe.getEditorContext()
    check('文件夹不算"选中的文件"（不然模型会去改一个目录）', !shotCtx.selectedFile, JSON.stringify(shotCtx.selectedFile))
    check('正在编辑的那个文件要给出来（界面页 = UI.meta）',
      !!(shotCtx.editingFile && shotCtx.editingFile.path === 'Assets/UI/大地图.aabbccdd11223344.ui'), JSON.stringify(shotCtx.editingFile))
    const shotSummary = shotBoot.sandbox.__YAMI_CTX_SUMMARY__()
    check('摘要 = 选中「删除存档数据」·文件「大地图.ui」→ 路径（不再出现粒子 / 界面元素列表）',
      /^【当前环境】选中「删除存档数据」·文件「大地图\.ui」 → Assets\/UI\//.test(shotSummary)
      && shotSummary.indexOf('粒子') < 0 && shotSummary.indexOf('界面元素列表') < 0, shotSummary)

    /* ---------------- A3b. 场景对象与资源树多选：模糊指代要落得到一个具体文件 ---------------- */
    console.log('\n--- A3b. 场景里选中的对象 / 资源树多选（"改这个"到底改哪个文件）---')
    const ctxBoot = await bootProbe({ engine: true })
    const browser = new ctxBoot.El('file-browser', 'project-browser')
    const pickedA = { alias: '落雷.skill', name: '落雷.627cc278af411ab0.skill', path: 'Assets/技能/012-元素使技能/落雷.627cc278af411ab0.skill', type: 'skill' }
    const pickedB = { alias: '冲撞.skill', name: '冲撞.b12d240ac180e87d.skill', path: 'Assets/技能/010-勇者技能/冲撞.b12d240ac180e87d.skill', type: 'skill' }
    browser.body = { activeFile: pickedA, selections: [pickedA, pickedB] }
    ctxBoot.document.body.appendChild(browser)
    // 场景对象按引擎真实形状造：class/name/data.guid，源文件由 Scene.getObjectFile 给（scene-utility.ts:6）
    ctxBoot.sandbox.Scene = {
      target: { class: 'actor', name: '主角', data: { guid: 'abc123def4567890' } },
      getObjectFile: () => ({ alias: '主角.actor', name: '主角.9f8e7d6c5b4a3210.actor', path: 'Assets/角色/主角.9f8e7d6c5b4a3210.actor', type: 'actor' }),
      meta: { guid: '1122334455667788', path: 'Assets/场景/新手村.1122334455667788.scene' }
    }
    const sceneCtx = ctxBoot.probe.getEditorContext()
    check('场景里选中的对象要带上它的源文件（引擎 Scene.getObjectFile 的同一口径）',
      !!(sceneCtx.sceneTarget && sceneCtx.sceneTarget.file && sceneCtx.sceneTarget.file.path === 'Assets/角色/主角.9f8e7d6c5b4a3210.actor'),
      JSON.stringify(sceneCtx.sceneTarget))
    check('当前场景文件也要给出来（对象的实例数据写在那里）',
      !!(sceneCtx.sceneFile && sceneCtx.sceneFile.path === 'Assets/场景/新手村.1122334455667788.scene'), JSON.stringify(sceneCtx.sceneFile))
    check('场景名从 Scene.meta 读得到（引擎里没有 Scene.binding，老路径永远是空的）',
      sceneCtx.scene === '新手村', JSON.stringify(sceneCtx.scene))
    check('资源树多选时报出全部选中项，而不是只报第一个',
      sceneCtx.selectedCount === 2 && Array.isArray(sceneCtx.selectedFiles) && sceneCtx.selectedFiles.length === 2,
      JSON.stringify(sceneCtx.selectedFiles))
    const sceneCtxSummary = ctxBoot.sandbox.__YAMI_CTX_SUMMARY__()
    check('摘要里场景对象带上源文件路径（模型据此直接改那个文件）',
      /选中actor:「主角」 → Assets\/角色\//.test(sceneCtxSummary) && sceneCtxSummary.length <= 120, sceneCtxSummary)

    // 多选的措辞：另开一个没有场景对象的沙盒（否则场景对象优先，占掉了那一格）
    const multiBoot = await bootProbe({ engine: true })
    const multiBrowser = new multiBoot.El('file-browser', 'project-browser')
    multiBrowser.body = { activeFile: pickedA, selections: [pickedA, pickedB] }
    multiBoot.document.body.appendChild(multiBrowser)
    multiBoot.document.activeElement = null
    const multiField = new multiBoot.El('number-box', 'multi-probe-field')
    multiField.tip = '攻击力'
    multiBoot.document.body.appendChild(multiField)
    multiBoot.document.dispatchEvent({ type: 'pointerover', target: multiField })
    await new Promise(r => setTimeout(r, 700))
    const multiSummary = multiBoot.sandbox.__YAMI_CTX_SUMMARY__()
    check('多选时摘要标出个数（不许当成"只选了那一个"）',
      /等 2 个/.test(multiSummary) && /Assets\/技能\//.test(multiSummary), multiSummary)

    /* ---------------- A3c. 树节点：名字要干净，点了就是"选中"不是"停在" ---------------- */
    console.log('\n--- A3c. 树节点（界面树/资源树）---')
    const treeBoot = await bootProbe({ engine: true })
    treeBoot.document.activeElement = null
    // 引擎真实形状：<node-item> 里是「纯名字文本节点 + 角标元素」
    // （tree-list.ts:283 element.textNode = 纯名字；E = 有事件角标，后面两坨是锁/可见性图标字形）
    const nodeItem = new treeBoot.El('node-item', 'tree-background')
    nodeItem.textNode = { nodeValue: '背景' }
    nodeItem.textContent = '背景' + 'E' + '\uE001\uE002'   // 真 DOM 的 textContent 就是这个样子
    nodeItem.appendChild(new treeBoot.El('lock-icon'))
    treeBoot.document.body.appendChild(nodeItem)
    nodeItem.classList.add('selected')                        // 用户点了它 → 引擎 addClass('selected')
    treeBoot.document.dispatchEvent({ type: 'pointerover', target: nodeItem })
    await new Promise(r => setTimeout(r, 700))
    const treeAt = treeBoot.probe.getPresence()
    check('树节点的名字取引擎写进 textNode 的纯名字（角标与图标字形不进名字）',
      !!treeAt && treeAt.label === '背景' && !treeAt.value, JSON.stringify(treeAt))
    check('树节点没有"值"（角标不许被当成值，否则摘要会出现 选中「背景」=E 这种乱码）',
      /^【当前环境】选中「背景」$/.test(treeBoot.sandbox.__YAMI_CTX_SUMMARY__()), treeBoot.sandbox.__YAMI_CTX_SUMMARY__())
    check('鼠标压在他刚点选的节点上时算"选中"，不算"划过"',
      !!treeAt && treeAt.via === 'selected', treeAt && treeAt.via)
    // 资源树里另有一个"打开着的文件"：它只是打开着，不是他刚点选的那个东西
    const treeBrowser = new treeBoot.El('file-browser', 'project-browser')
    treeBrowser.body = {
      activeFile: { alias: '003 - 法师技能.skill', name: '003 - 法师技能.aaaabbbbccccdddd.skill', path: 'Assets/技能/003-法师技能/003 - 法师技能.aaaabbbbccccdddd.skill', type: 'skill' },
      selections: []
    }
    treeBoot.document.body.appendChild(treeBrowser)
    const treeSummary = treeBoot.sandbox.__YAMI_CTX_SUMMARY__()
    check('摘要说的是"选中「背景」"，不是"停在"', /^【当前环境】选中「背景」/.test(treeSummary), treeSummary)
    check('打开着的那个文件不再冒充"选中"（两个"选中"会让人分不清他指哪个）',
      /文件「003 - 法师技能.skill」/.test(treeSummary) && treeSummary.indexOf('·选中「003') < 0, treeSummary)

    // 反向：没有点选过任何树节点时，资源树选中项照旧是"选中「…」→ 路径"
    const plainBoot = await bootProbe({ engine: true })
    const plainBrowser = new plainBoot.El('file-browser', 'project-browser')
    plainBrowser.body = {
      activeFile: { alias: '落雷.skill', name: '落雷.627cc278af411ab0.skill', path: 'Assets/技能/012-元素使技能/落雷.627cc278af411ab0.skill', type: 'skill' },
      selections: []
    }
    plainBoot.document.body.appendChild(plainBrowser)
    const plainSummary = plainBoot.sandbox.__YAMI_CTX_SUMMARY__()
    check('没有树节点选中时，资源树选中项照旧报"选中「落雷.skill」→ 路径"',
      /选中「skill\/落雷.skill」|选中「落雷.skill」/.test(plainSummary) && /Assets\/技能\//.test(plainSummary), plainSummary)

    /* ---------------- A2. 引擎接口缺失时（官方预编译版）桥仍须可用 ---------------- */
    console.log('\n--- A2. 引擎接口缺失时（官方预编译版）桥仍须可用 ---')
    const bare = await bootProbe({ engine: false })
    check('取不到引擎接口时，5967 桥依然启动', !!bare.editor, bare.editor ? 'port 5967' : '没起来（官方预编译版上界面操作会整片失效）')
    if (bare.editor) {
      const t2 = await call(bare.editor, 'GET', '/token')
      const H2 = { 'x-yami-bridge-token': t2.json && t2.json.bridgeToken }
      const who2 = await call(bare.editor, 'GET', '/whoami')
      check('/whoami 如实报出引擎接口不可用', !!(who2.json && who2.json.engineAvailable === false && Array.isArray(who2.json.engineMissing) && who2.json.engineMissing.length),
        who2.json ? 'missing=' + JSON.stringify(who2.json.engineMissing) : '')
      const ctx2 = await call(bare.editor, 'GET', '/context')
      check('/context 在无引擎时也能返回（不再 500/无响应）', !!(ctx2.json && ctx2.json.ok === true && ctx2.json.context && ctx2.json.context.engineAvailable === false))

      const eng = new bare.El('input', 'fileItem-gold'); eng.value = '10'; bare.document.body.appendChild(eng)
      const domRun = await call(bare.editor, 'POST', '/action', {
        action: 'uiSteps',
        steps: [{ kind: 'set', target: '#fileItem-gold', value: 99, label: '把金币改成 99', holdMs: 5, settleMs: 5 }]
      }, H2)
      check('无引擎时纯 DOM 的 uiSteps 照常可用（这是本次修复的关键）', !!(domRun.json && domRun.json.ok === true) && eng.value === '99', JSON.stringify(domRun.json).slice(0, 120))
      const saveRun = await call(bare.editor, 'POST', '/action', { action: 'save' }, H2)
      check('无引擎时引擎类动作给出可读原因（不是静默失败）',
        !!(saveRun.json && saveRun.json.ok === false && saveRun.json.engineUnavailable === true), JSON.stringify(saveRun.json).slice(0, 130))
      const undoRun = await call(bare.editor, 'POST', '/action', { action: 'undo' }, H2)
      check('无引擎时 undo 也如实说明（「撤销这一步」不会假装成功）',
        !!(undoRun.json && undoRun.json.ok === false && undoRun.json.engineUnavailable === true), JSON.stringify(undoRun.json).slice(0, 130))
    }

    /* ---------------- B. MCP 工具表：ui_steps 真的注册了 ---------------- */
    console.log('\n--- B. MCP 工具表（真 JSON-RPC tools/list）---')
    const tools = await askMcpTools(fixture)
    if (!tools) {
      check('MCP tools/list 可访问', false, '没拿到工具表')
    } else {
      const names = tools.map(t => t.name)
      const ui = tools.find(t => t.name === 'ui_steps')
      check('tools/list 能拿到工具表', names.length > 30, names.length + ' 个工具')
      check('ui_steps 已注册（AI 真的调得到演出引擎）', !!ui)
      check('ui_steps 必填 steps', !!(ui && ui.inputSchema && ui.inputSchema.required && ui.inputSchema.required.indexOf('steps') >= 0))
      const itemProps = ui && ui.inputSchema.properties.steps.items.properties
      check('步骤字段声明齐全（kind/target/value/label/mergeGroup）',
        !!(itemProps && itemProps.kind && itemProps.target && itemProps.value && itemProps.label && itemProps.mergeGroup),
        itemProps ? Object.keys(itemProps).join(',') : '缺失')
      check('ui_steps 声明为写操作（readOnlyHint=false，不能并发）', !!(ui && ui.readOnlyHint === false))
      check('原始工具表保留 cdp_eval（留给外部 MCP 客户端与路线 B）', names.indexOf('cdp_eval') >= 0)
    }

    /* ---------------- C. 宿主：谁提问就用谁的视野 + 对齐卡协议到达模型 ---------------- */
    console.log('\n--- C. 宿主提示词与一手环境（真 ai-host + 假模型截获）---')
    const captured = []
    const planRef = { current: null }   // 想验证审批时机时，把要发的工具调用塞进去
    const fake = await startFakeModel(captured, planRef)
    model = fake.server
    const AI_PORT = 17968 + Math.floor(Math.random() * 400)
    const AGENT_TOKEN = crypto.randomBytes(16).toString('hex')
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-ui-host-'))
    host = spawn(process.execPath, [path.join(ROOT, 'ai-host.js')], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: Object.assign({}, process.env, {
        YAMI_AI_PORT: String(AI_PORT),
        YAMI_AI_TOKEN: AGENT_TOKEN,
        YAMI_AI_CONFIG_DIR: configDir,
        YAMI_AI_SESSION_DIR: path.join(configDir, 'sessions'),
        YAMI_PROJECT_ROOT: fixture,
        // 隔离本机正在运行的编辑器：单测不应受开发者桌面上的编辑器输入框焦点状态影响
        YAMI_EDITOR_BRIDGE_PORT: '0'
      })
    })
    let hostErr = ''
    host.stderr.on('data', d => { hostErr += d.toString() })

    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      try {
        const s = await jsonCall(AI_PORT, '/status', 'GET', null, AGENT_TOKEN)
        if (s && s.ok) ready = true
      } catch (e) { /* 还没起来 */ }
      if (!ready) await new Promise(r => setTimeout(r, 100))
    }
    check('ai-host 已就绪', ready, ready ? '' : hostErr.slice(0, 160))

    if (ready) {
      await jsonCall(AI_PORT, '/config', 'POST', {
        endpoint: 'http://127.0.0.1:' + fake.port + '/chat/completions',
        model: 'fake-model', apiKey: 'test-key', approvalMode: 'confirm'
      }, AGENT_TOKEN)
      await jsonCall(AI_PORT, '/project', 'POST', { projectRoot: fixture }, AGENT_TOKEN)

      // C1：试玩窗口提问 —— 必须用提问者自己的视野，不能被编辑器串味
      await streamChat(AI_PORT, AGENT_TOKEN, {
        sessionId: 'ui-playtest',
        message: '这个怪为什么打不死',
        pageContext: { page: 'playtest', summary: '试玩运行中 · 场景「BOSS战」' }
      })
      const playtestSystem = systemTextOf(captured[captured.length - 1] || {})
      check('试玩窗口提问时，模型收到的一手环境写着"试玩运行中"', playtestSystem.indexOf('试玩运行中') >= 0)
      check('严禁把试玩窗口误标成"编辑器"', playtestSystem.indexOf('处于编辑器中') === -1)

      // C2：编辑器窗口提问 —— 用编辑器自己的视野
      await streamChat(AI_PORT, AGENT_TOKEN, {
        sessionId: 'ui-editor',
        message: '帮我看看新手村',
        pageContext: { page: 'editor', summary: '编辑器 · 页面「场景编辑」· 场景「新手村」' }
      })
      const editorSystem = systemTextOf(captured[captured.length - 1] || {})
      check('编辑器窗口提问时，模型收到的是编辑器自己的视野', editorSystem.indexOf('新手村') >= 0 && editorSystem.indexOf('试玩运行中') === -1)

      // C3：提示词协议真的到达模型（否则卡片和演示都是摆设）
      check('系统提示词里定义了 ui_steps 的用法', editorSystem.indexOf('ui_steps') >= 0)
      check('系统提示词里定义了对齐卡协议', editorSystem.indexOf('alignment-card') >= 0)
      check('系统提示词要求开工前先对齐', editorSystem.indexOf('对齐卡') >= 0)
      check('提示词里带上了界面演示的失败语义（如实说清第几步卡住）', editorSystem.indexOf('第几步卡住') >= 0)

      // C3b：模糊意图的落地规矩 —— 用户只说"这个/它/我选中的那个"时，模型必须指到环境里那个选中项。
      // 真机验证过（会话 session-mtz9o2oe）：他选中 329.落雷.skill 说"给我选中的技能…"，模型直接落到那个路径。
      // 这几条以前没有任何测试盯着 —— prompt 一改这条能力就会静默失效。
      check('提示词规定"这个/它/我选中的那个"= 环境里那个选中项', editorSystem.indexOf('我选中的那个') >= 0)
      check('提示词规定选中项就是这次要改的首要目标', editorSystem.indexOf('首要目标') >= 0)
      check('提示词规定停留点上说得含糊就按它理解、别反问', editorSystem.indexOf('别反问') >= 0)
      check('提示词规定区域级停留点信息不足该问就问', editorSystem.indexOf('信息不足') >= 0)
      check('提示词规定场景对象给的是源文件、实例数据在场景文件里',
        editorSystem.indexOf('源文件') >= 0 && editorSystem.indexOf('sceneFile') >= 0)
      check('提示词规定资源树多选时不许默认只改一个', editorSystem.indexOf('selectedFiles') >= 0)
      check('提示词分清"选中（他点选的）"与"文件（打开着的）"',
        editorSystem.indexOf('他点选的那个东西') >= 0 && editorSystem.indexOf('「文件」后面') >= 0)

      // C4：内置模型**实际拿到**的工具表 —— 这才是"模型看不看得见"的唯一真源
      const lastReq = captured[captured.length - 1] || {}
      const modelToolNames = (lastReq.tools || []).map(t => (t.function && t.function.name) || t.name)
      check('模型请求体里带上了 ui_steps（工具真的递到了模型手上）', modelToolNames.indexOf('ui_steps') >= 0, modelToolNames.length + ' 个工具')
      check('模型请求体里没有 cdp_eval（宿主侧 HIDDEN_TOOLS 真的生效）', modelToolNames.indexOf('cdp_eval') === -1)

      // C5/C6：写盘节奏 —— 预览随便看，落盘才确认（用户实测踩到的就是这条）
      const PREVIEW_TOOL = {
        name: 'append_event_commands',
        args: { path: 'Assets/测试事件.0123456789abcdef.event', commands: [{ type: '注释', params: {} }], dryRun: true }
      }
      planRef.current = PREVIEW_TOOL
      const previewEvents = parseSse(await streamChat(AI_PORT, AGENT_TOKEN, { sessionId: 'ui-preview', message: '先预览一下要加什么' }))
      const previewApprovals = previewEvents.filter(e => e.type === 'tool' && e.phase === 'approval')
      check('dryRun:true 预览不弹确认卡（用户卡住的那一条）', previewApprovals.length === 0, 'approval 事件数=' + previewApprovals.length)
      check('预览真的跑成功了（不是靠失败蒙混过关）',
        previewEvents.some(e => e.type === 'tool' && e.phase === 'done'),
        previewEvents.filter(e => e.type === 'tool').map(e => e.phase).join(','))

      planRef.current = Object.assign({}, PREVIEW_TOOL, { args: Object.assign({}, PREVIEW_TOOL.args, { dryRun: false }) })
      const writeEvents = parseSse(await streamChat(AI_PORT, AGENT_TOKEN, { sessionId: 'ui-write', message: '正式写进去' }))
      const writeApprovals = writeEvents.filter(e => e.type === 'tool' && e.phase === 'approval')
      check('dryRun:false 正式写入必须停在确认卡', writeApprovals.length === 1, 'approval 事件数=' + writeApprovals.length)
      const writeResult = writeEvents.find(e => e.type === 'result')
      check('待确认时本轮以 approval 收尾（绝不偷偷写盘）', !!(writeResult && writeResult.status === 'approval'), writeResult && writeResult.status)
    }

    try { fs.rmSync(configDir, { recursive: true, force: true }) } catch (e) {}

    console.log('\n========== 界面操作与演出测试汇总: ' + passed + '/' + (passed + failed) + ' PASS ==========')
    if (failed > 0) process.exitCode = 1
  } finally {
    cleanup()
  }
}

main().catch(err => {
  console.error('测试异常崩溃:', err && err.stack ? err.stack : err)
  process.exit(1)
})
