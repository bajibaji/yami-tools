'use strict'

const http = require('http')

class EditorBridge {
  constructor(port = 0) {
    // 端口来源见 modules/bridge-port.js：环境变量 > 插件数据目录里的 editor-port > 5967 ——
    // 编辑器桥被别的程序占用时会自适应换端口，客户端必须读文件才知道真实端口
    this.port = Number(process.env.YAMI_EDITOR_BRIDGE_PORT) || port || require('./bridge-port').editorPort()
  }

  request(method, route, body = null, timeoutMs = 1800, token = '') {
    return new Promise((resolve) => {
      const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8')
      const req = http.request({
        hostname: '127.0.0.1', port: this.port, path: route, method,
        timeout: timeoutMs,
        headers: Object.assign({ Accept: 'application/json' }, token ? { 'x-yami-bridge-token': token } : {}, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
      }, (res) => {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          try {
            const data = JSON.parse(raw || '{}')
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false, data })
          } catch (e) { resolve({ ok: false, error: '编辑器桥响应无法解析: ' + e.message }) }
        })
      })
      req.on('error', error => resolve({ ok: false, error: `编辑器桥未启动（端口 ${this.port}）: ${error.message}` }))
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '编辑器桥请求超时' }) })
      if (payload) req.write(payload)
      req.end()
    })
  }

  async whoami() {
    const res = await this.request('GET', '/whoami', null, 800)
    return res.ok ? res.data : { ok: false, error: res.error || '获取编辑器实例信息失败' }
  }

  async action(action, params = {}, expectedProjectRoot = '') {
    const root = expectedProjectRoot || process.env.YAMI_PROJECT_ROOT || ''
    if (root) {
      const who = await this.whoami()
      if (who.ok && who.projectRoot) {
        const normWho = String(who.projectRoot).replace(/\\/g, '/').toLowerCase()
        const normExp = String(root).replace(/\\/g, '/').toLowerCase()
        if (!normWho.includes(normExp) && !normExp.includes(normWho)) {
          return { ok: false, error: `检测到另一个编辑器实例占用端口（目标工程: ${who.projectRoot}，当前工程: ${root}），已拒绝操作以防串工程` }
        }
      }
    }
    const live = await this.request('GET', '/token')
    if (!live.ok) return live
    const token = live.data.bridgeToken
    if (!token) return { ok: false, error: '编辑器桥未返回令牌' }
    const body = { ...params }
    if (action === 'interact' && params.action) body.operation = params.action
    body.action = action
    const timeout = action === 'uiSteps' ? 30000 : 1800
    const result = await this.request('POST', '/action', body, timeout, token)
    if (result.ok) return result.data
    // 非 2xx 时正文里往往带着结构化的失败原因（failedAt / done / engineUnavailable / 具体原因），
    // 直接透给调用方与模型，它们才知道到底死在哪一步、为什么 —— 只回一句"失败"等于把线索扔掉。
    if (result.data && typeof result.data.ok === 'boolean') return result.data
    return result
  }

  async dumpUiHierarchy() {
    return await this.action('dumpUi')
  }

  async clickElement(params) {
    return await this.action('click', params)
  }

  async getContext() {
    const res = await this.request('GET', '/context', null, 800)
    return res.ok ? res.data : { ok: false, error: res.error || '获取编辑器上下文失败' }
  }

  async uiSteps(steps, expectedProjectRoot = '') {
    return await this.action('uiSteps', { steps }, expectedProjectRoot)
  }
}

module.exports = EditorBridge
