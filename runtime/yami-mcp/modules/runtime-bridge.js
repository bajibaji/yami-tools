'use strict'

/**
 * runtime-bridge.js — 试玩运行时数据与控制桥接器
 * 联动 DanJuan 妙妙插件 5966 端口与试玩窗口，提供：
 *  1. 运行时健康度、帧率与当前场景对象查询 (getRuntimeLive)
 *  2. 运行时完整黑匣子报错与诊断报告 (getRuntimeReport)
 *  3. 原生物理按键模拟 (sendPlayerInput，直通 CDP 原生 Input 域派发至 Player 窗口)
 */

const http = require('http')
const { normalizeSequence, diffDiagnosis, describeVerdict } = require('./playtest')

class RuntimeBridge {
  constructor(port = 5966, cdpClient = null) {
    // 端口可被环境变量覆盖：真机默认 5966，测试可指向模拟桥以便验证整条链路
    this.port = Number(process.env.YAMI_RUNTIME_BRIDGE_PORT) || port
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
   * 获取「给 AI 读的」诊断摘要：报错黑匣子（带可疑文件名+行号+就地源码）、卡住/幽灵事件、
   * 性能离群点与内存。体积约十几 KB，用于替代整份 /report（数百 KB 且含 300 帧时间线，会挤爆上下文）。
   */
  async getDiagnosis() {
    const res = await this.requestJson('/diagnose', 3000)
    if (res.ok) return { ok: true, running: true, data: res.data }
    // 老版本插件没有 /diagnose 端点：退回 /report 只保留关键部分，保证仍可用
    const fallback = await this.requestJson('/report', 3000)
    if (!fallback.ok) {
      return {
        ok: false,
        running: false,
        message: '游戏未在试玩运行中（端口 5966 未响应）。请先启动试玩，让问题复现一次，再调用本工具。'
      }
    }
    const report = fallback.data || {}
    return {
      ok: true,
      running: true,
      degraded: true,
      message: '当前插件的 /diagnose 端点不可用（旧版本），已退回精简版报告',
      data: {
        kind: 'yami-diagnosis-fallback',
        performance: {
          computeP95Ms: report.compute && report.compute.p95,
          frameP95Ms: report.frame && report.frame.p95,
          drawCalls: report.webgl && report.webgl.lastDrawCalls,
          topUpdaters: report.updaters,
          topRenderers: report.renderers,
          topEvents: report.events
        },
        memory: report.memory,
        scene: report.scene,
        activeEvents: (report.activeEvents && report.activeEvents.active) || [],
        hint: '建议升级插件以获得带源码上下文的完整诊断'
      }
    }
  }

  /**
   * 向试玩窗口派发物理按键输入（支持方向移动、确认、取消、技能键）
   * 优先使用 CDP 原生 Input.dispatchKeyEvent 注入物理击键，直达 Player 目标
   * @param {string} key 按键（'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'KeyZ', 'Space' 等）
   * @param {string} [action='press'] 'press' | 'down' | 'up'
   */
  async sendInput(key, action = 'press', holdMs) {
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
        const payload = Buffer.from(JSON.stringify({
          type: 'key',
          key: realKey,
          action,
          ...(Number.isFinite(Number(holdMs)) ? { durationMs: Number(holdMs) } : {})
        }), 'utf8')
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

  /**
   * 试玩冒烟：按脚本驱动一遍游戏，报告「这一趟跑坏了没有」。
   *
   * 与 Claude Code 那种通用编码助手最大的不同点就在这：它能直接让游戏跑起来、
   * 走两步、再把运行时黑匣子的变化读回来，形成"改完 → 真跑一遍 → 看有没有坏"的闭环。
   *
   * @param {string|Array} sequence 按键脚本（'down,down,ok' 或对象数组）
   * @param {{settleMs?:number}} [options] settleMs：脚本跑完后再等多久收数据（默认 1200ms）
   */
  async playtestSmoke(sequence, options = {}) {
    const { steps, rejected } = normalizeSequence(sequence)
    const settleMs = Math.min(Math.max(Number(options.settleMs) || 1200, 200), 10000)
    if (!steps.length) {
      return { ok: false, error: '没有可执行的动作步骤；sequence 示例："down,down,ok" 或 [{ key:"left", waitMs:800 }]', rejected }
    }

    const before = await this.getDiagnosis()
    if (!before.ok) {
      return {
        ok: false,
        running: false,
        message: '游戏没有在试玩中，无法冒烟。请先在编辑器里点【试玩】把游戏跑起来，再让我执行这一步。'
      }
    }

    const executed = []
    for (const step of steps) {
      if (step.kind === 'wait') {
        await delay(step.waitMs)
        executed.push({ kind: 'wait', waitMs: step.waitMs })
        continue
      }
      const sent = await this.sendInput(step.key, step.action, step.holdMs)
      executed.push({ kind: 'key', key: step.key, action: step.action, ok: !!(sent && sent.ok), error: sent && sent.ok ? undefined : (sent && sent.error) })
      await delay(step.waitMs)
    }
    await delay(settleMs)

    const after = await this.getDiagnosis()
    if (!after.ok) {
      return {
        ok: true,
        running: false,
        executed,
        rejected,
        message: '脚本执行到一半游戏退出了（可能崩溃或用户关闭了试玩窗口），没有拿到事后诊断。',
        before: summarizeDiagnosis(before.data)
      }
    }

    const diff = diffDiagnosis(before.data, after.data)
    const failedSteps = executed.filter(item => item.kind === 'key' && item.ok === false)
    return {
      ok: true,
      running: true,
      verdict: diff.verdict,
      message: describeVerdict(diff, executed.length) + (failedSteps.length ? `（另有 ${failedSteps.length} 步按键没有送达）` : ''),
      executed,
      rejected,
      steps: executed.length,
      before: summarizeDiagnosis(before.data),
      after: summarizeDiagnosis(after.data),
      problems: {
        newErrors: diff.newErrors,
        worsenedErrors: diff.worsenedErrors,
        newStuckEvents: diff.newStuckEvents,
        performanceRegressed: diff.perf.regressed
      },
      perf: diff.perf,
      hint: diff.verdict === 'ok'
        ? '这一段没有跑坏。需要更彻底就换更长的路径再跑一遍。'
        : '用 problems 里的文件名+行号配合 search_project / read_script 定位，改完再跑一次同样的脚本对比。'
    }
  }
}

function summarizeDiagnosis(data) {
  const diagnosis = data || {}
  const perf = diagnosis.performance || {}
  const summary = diagnosis.summary || {}
  return {
    fps: perf.fps || 0,
    frameP95Ms: perf.frameP95Ms || 0,
    computeP95Ms: perf.computeP95Ms || 0,
    drawCalls: perf.drawCalls || 0,
    errorKinds: summary.errorKinds || 0,
    errorTotal: summary.errorTotal || 0,
    stuckEvents: summary.stuckEvents || 0,
    overBudgetFrames: summary.overBudgetFrames || 0
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

module.exports = RuntimeBridge
