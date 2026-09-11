'use strict'

const http = require('http')

class EditorBridge {
  constructor(port = 5967) {
    this.port = Number(process.env.YAMI_EDITOR_BRIDGE_PORT || port)
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

  async action(action, params = {}) {
    const live = await this.request('GET', '/token')
    if (!live.ok) return live
    const token = live.data.bridgeToken
    if (!token) return { ok: false, error: '编辑器桥未返回令牌' }
    const result = await this.request('POST', '/action', { action, ...params }, 1800, token)
    return result.ok ? result.data : result
  }

  async dumpUiHierarchy() {
    return await this.action('dumpUi')
  }

  async clickElement(params) {
    return await this.action('click', params)
  }
}

module.exports = EditorBridge
