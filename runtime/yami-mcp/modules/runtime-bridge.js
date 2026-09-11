'use strict'

/**
 * runtime-bridge.js — 试玩运行时数据与控制桥接器
 * 联动 DanJuan 妙妙插件 5966 端口与试玩窗口，提供：
 *  1. 运行时健康度、帧率与当前场景对象查询 (getRuntimeLive)
 *  2. 运行时完整黑匣子报错与诊断报告 (getRuntimeReport)
 *  3. 原生物理按键模拟 (sendPlayerInput，直通 CDP 原生 Input 域派发至 Player 窗口)
 */

const http = require('http')

class RuntimeBridge {
  constructor(port = 5966, cdpClient = null) {
    this.port = port
    this.cdp = cdpClient
  }

  /**
   * HTTP GET 请求封装
   */
  requestJson(path, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.port}${path}`, { timeout: timeoutMs }, (res) => {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          try {
            const data = JSON.parse(raw)
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data, error: res.statusCode >= 300 ? data.error : null })
          } catch (e) {
            resolve({ ok: false, error: '解析响应 JSON 失败: ' + e.message })
          }
        })
      })
      req.on('error', (err) => {
        resolve({ ok: false, running: false, error: `试玩调试微服务未启动（端口 ${this.port}）: ${err.message}` })
      })
      req.on('timeout', () => {
        req.destroy()
        resolve({ ok: false, running: false, error: `请求试玩调试服务超时` })
      })
    })
  }

  /**
   * 获取游戏试玩实时数据（帧率、场景实体、当前运行事件）
   */
  async getLiveState() {
    const [res, report] = await Promise.all([this.requestJson('/live'), this.requestJson('/report', 2500)])
    if (!res.ok) {
      // 若 5966 未启动，尝试通过 CDP 查询 Player 试玩窗口兜底
      if (this.cdp) {
        const cdpRes = await this.cdp.eval(`
          (() => {
            if (typeof Game === 'undefined' && typeof Time === 'undefined') return null;
            return {
              fps: (typeof Time !== 'undefined' ? Time.fps : null) || 60,
              scene: (typeof Scene !== 'undefined' && Scene.binding) ? {
                actorsCount: Scene.actor?.list?.length || 0,
                name: Scene.binding?.name || ''
              } : null,
              hasPlayer: typeof Party !== 'undefined' && !!Party.player
            };
          })()
        `, true, 'player')
        if (cdpRes.ok && cdpRes.result) {
          return { ok: true, running: true, mode: 'cdp-fallback', data: cdpRes.result }
        }
      }
      return { ok: false, running: false, message: '游戏未在试玩运行中（端口 5966 未响应）' }
    }
    return { ok: true, running: true, data: res.data, report: report.ok ? report.data : null }
  }

  /**
   * 获取试玩运行时完整分析报告（含未捕获报错、事件黑匣子）
   */
  async getReport() {
    const res = await this.requestJson('/report')
    if (!res.ok) {
      return { ok: false, running: false, message: '游戏未在试玩运行中或暂无报告' }
    }
    return { ok: true, report: res.data }
  }

  /**
   * 向试玩窗口派发物理按键输入（支持方向移动、确认、取消、技能键）
   * 优先使用 CDP 原生 Input.dispatchKeyEvent 注入物理击键，直达 Player 目标
   * @param {string} key 按键（'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'KeyZ', 'Space' 等）
   * @param {string} [action='press'] 'press' | 'down' | 'up'
   */
  async sendInput(key, action = 'press') {
    if (!key) return { ok: false, error: '缺少 key 参数' }
    const keyMap = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      ok: 'Enter',
      confirm: 'Enter',
      cancel: 'Escape',
      esc: 'Escape',
      space: 'Space',
      z: 'KeyZ',
      x: 'KeyX',
      c: 'KeyC'
    }
    const realKey = keyMap[key.toLowerCase()] || key

    // 优先走插件 5966 运行时桥，不要求用户开启 9222 调试端口。
    const live = await this.requestJson('/token')
    if (live.ok && live.data && live.data.bridgeToken) {
      return await new Promise((resolve) => {
        const http = require('http')
        const payload = Buffer.from(JSON.stringify({ type: 'key', key: realKey, action }), 'utf8')
        const req = http.request({
          hostname: '127.0.0.1', port: this.port, path: '/action', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'x-yami-bridge-token': live.data.bridgeToken },
          timeout: 1500
        }, (res) => {
          let raw = ''
          res.on('data', chunk => { raw += chunk })
          res.on('end', () => {
            try { resolve(JSON.parse(raw || '{}')) } catch (e) { resolve({ ok: false, error: '运行时动作响应无法解析' }) }
          })
        })
        req.on('error', error => resolve({ ok: false, error: `运行时按键失败: ${error.message}` }))
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '运行时按键请求超时' }) })
        req.write(payload)
        req.end()
      })
    }

    if (!this.cdp) return { ok: false, error: '试玩桥未响应，且未连接 CDP 通道' }

    // 旧环境兜底：仍可通过 CDP 原生派发物理键盘事件。
    try {
      if (action === 'down') {
        return await this.cdp.dispatchKey({ key: realKey, type: 'rawKeyDown', targetType: 'player' })
      } else if (action === 'up') {
        return await this.cdp.dispatchKey({ key: realKey, type: 'keyUp', targetType: 'player' })
      } else {
        return await this.cdp.pressKey({ key: realKey, durationMs: 50, targetType: 'player' })
      }
    } catch (err) {
      return { ok: false, error: `派发按键失败: ${err.message}` }
    }
  }

  async sendPointer({ action = 'move', x, y, button = 0 } = {}) {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return { ok: false, error: '鼠标坐标必须是有限数值' }
    const token = await this.requestJson('/token')
    if (!token.ok || !token.data || !token.data.bridgeToken) return { ok: false, error: '试玩运行时桥未启动' }
    return await new Promise((resolve) => {
      const payload = Buffer.from(JSON.stringify({ type: 'pointer', action, x: Number(x), y: Number(y), button: Number(button) || 0 }), 'utf8')
      const req = http.request({
        hostname: '127.0.0.1', port: this.port, path: '/action', method: 'POST', timeout: 1500,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'x-yami-bridge-token': token.data.bridgeToken }
      }, res => {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(raw || '{}')) } catch { resolve({ ok: false, error: '运行时鼠标响应无法解析' }) }
        })
      })
      req.on('error', error => resolve({ ok: false, error: `运行时鼠标失败: ${error.message}` }))
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '运行时鼠标请求超时' }) })
      req.end(payload)
    })
  }
}

module.exports = RuntimeBridge
