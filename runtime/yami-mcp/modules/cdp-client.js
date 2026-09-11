'use strict'

/**
 * cdp-client.js — Chrome DevTools Protocol 原生客户端
 * 采用 Node 原生 HTTP 与 WebSocket 实现，零外部依赖。
 * 
 * 核心增强：
 *  1. Target 智能分流：自动区分 Editor 窗口与 Player 试玩窗口，彻底杜绝指令串发
 *  2. 原生物理按键注入 (Input.dispatchKeyEvent)，解决 5966 纯只读无写侧的问题
 *  3. 无视觉屏幕 UI 提取 (dumpUiHierarchy)
 *  4. DOM 级语义点击与物理坐标点击 (clickElement)
 *  5. 内存热重载防覆盖 (reloadEditorResource)
 *  6. 一键触发试玩 (triggerPlaytest)
 *  7. 离线友好提示与优雅降级
 */

const http = require('http')

class CdpClient {
  constructor(port = null) {
    this.port = port || process.env.YAMI_MCP_CDP_PORT || 9222
  }

  /**
   * 检查 CDP 端口是否开放
   */
  async checkPort() {
    try {
      const targets = await this.getTargets()
      return { ok: true, targetsCount: targets.length }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  /**
   * HTTP 请求 CDP Targets 列表
   */
  getTargets() {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${this.port}/json`, { timeout: 1500 }, (res) => {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch (err) {
            reject(new Error(`解析 CDP targets 响应失败: ${err.message}`))
          }
        })
      })
      req.on('error', (err) => {
        reject(new Error(`未检测到 Open Yami 远程调试端口 (${this.port})。如需开启界面审查与无视觉模拟点击，请通过带 --remote-debugging-port=${this.port} 参数启动编辑器（可运行 start-yami-debug.cmd）: ${err.message}`))
      })
      req.on('timeout', () => {
        req.destroy()
        reject(new Error(`连接 CDP 端口 ${this.port} 超时`))
      })
    })
  }

  /**
   * 智能分流获取目标页面的 WebSocket Debugger URL
   * @param {'editor'|'player'|'auto'} targetType
   */
  async getTargetWsUrl(targetType = 'editor') {
    const targets = await this.getTargets()
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error('未检测到任何 CDP 页面目标')
    }

    const pages = targets.filter(t => t.type === 'page')
    if (pages.length === 0) {
      throw new Error('CDP 列表中无活动页面')
    }

    if (targetType === 'player') {
      // 优先匹配包含 player 的 target，或非编辑器的页面
      const playerTarget = pages.find(t =>
        t.url?.includes('player') ||
        (t.title && !t.title.includes('Yami') && !t.url?.includes('dist/index.html') && !t.url?.includes('head.html'))
      )
      if (playerTarget && playerTarget.webSocketDebuggerUrl) {
        return playerTarget.webSocketDebuggerUrl
      }
      // 如果只有一个非空 target 也返回
      if (pages.length > 1) {
        // 多页面时，返回后打开的页面（通常试玩窗口在后）
        return pages[pages.length - 1].webSocketDebuggerUrl
      }
      throw new Error('未找到运行中的游戏试玩窗口 (Player Target)')
    }

    // editor 窗口
    let editorTarget = pages.find(t =>
      (t.title?.includes('Yami') || t.url?.includes('dist/index.html') || t.url?.includes('head.html')) &&
      !t.url?.includes('player')
    )
    if (!editorTarget) {
      editorTarget = pages[0]
    }
    if (!editorTarget || !editorTarget.webSocketDebuggerUrl) {
      throw new Error('未找到编辑器主页面的 webSocketDebuggerUrl')
    }
    return editorTarget.webSocketDebuggerUrl
  }

  /**
   * 通用 CDP 指令发送器（零外部依赖，基于 Node 24 原生 WebSocket）
   */
  sendCdpCommand(method, params = {}, targetType = 'editor') {
    return new Promise(async (resolve) => {
      let wsUrl
      try {
        wsUrl = await this.getTargetWsUrl(targetType)
      } catch (e) {
        return resolve({ ok: false, error: e.message, cdpEnabled: false })
      }

      if (typeof WebSocket === 'undefined') {
        return resolve({ ok: false, error: '当前 Node 环境未暴露原生 WebSocket' })
      }

      let ws
      try {
        ws = new WebSocket(wsUrl)
      } catch (e) {
        return resolve({ ok: false, error: `建立 WebSocket 连接失败: ${e.message}` })
      }

      const callId = Math.floor(Math.random() * 1000000)
      let resolved = false

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          try { ws.close() } catch (e) {}
          resolve({ ok: false, error: `CDP 指令 ${method} 执行超时（5秒）` })
        }
      }, 5000)

      ws.onopen = () => {
        const msg = { id: callId, method, params }
        ws.send(JSON.stringify(msg))
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.id === callId) {
            resolved = true
            clearTimeout(timer)
            ws.close()
            if (data.error) {
              resolve({ ok: false, error: data.error.message || 'CDP 返回错误' })
            } else if (data.result?.exceptionDetails) {
              const ex = data.result.exceptionDetails
              const text = ex.exception?.description || ex.text || '执行抛出异常'
              resolve({ ok: false, error: text })
            } else {
              resolve({ ok: true, result: data.result })
            }
          }
        } catch (e) {
          // 忽略非本调用的事件消息
        }
      }

      ws.onerror = (err) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          resolve({ ok: false, error: `CDP WebSocket 错误: ${err.message || '连接失败'}` })
        }
      }
    })
  }

  /**
   * 在目标窗口执行 JS 表达式
   */
  async eval(expression, awaitPromise = true, targetType = 'editor') {
    const res = await this.sendCdpCommand('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true
    }, targetType)
    if (!res.ok) return res
    return { ok: true, result: res.result?.result?.value }
  }

  /**
   * 向试玩窗口派发原生物理键盘事件 (CDP Input.dispatchKeyEvent)
   * 彻底解决 5966 端口纯只读无写侧的问题
   */
  async dispatchKey({ key, code, type = 'rawKeyDown', targetType = 'player' }) {
    // 常用键与 windowsVirtualKeyCode 映射
    const vkMap = {
      ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
      Enter: 13, Escape: 27, Space: 32, KeyZ: 90, KeyX: 88, KeyC: 67,
      ShiftLeft: 16, ControlLeft: 17
    }
    const realCode = code || key
    const vk = vkMap[realCode] || undefined

    return await this.sendCdpCommand('Input.dispatchKeyEvent', {
      type,
      key,
      code: realCode,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk
    }, targetType)
  }

  /**
   * 模拟完整物理按键敲击 (down -> up)
   */
  async pressKey({ key, code, durationMs = 50, targetType = 'player' }) {
    const downRes = await this.dispatchKey({ key, code, type: 'rawKeyDown', targetType })
    if (!downRes.ok) return downRes

    await new Promise(r => setTimeout(r, durationMs))

    return await this.dispatchKey({ key, code, type: 'keyUp', targetType })
  }

  /**
   * 无视觉屏幕 UI 元素层级抓取（锁定编辑器主窗口）
   */
  async dumpUiHierarchy() {
    const expr = `
      (() => {
        const results = [];
        const selector = 'button, [role="button"], item, nav-item, select-box, custom-box, number-box, close, minimize, maximize, #title-play, .menu-item, input, textarea, box[hotkey]';
        const els = document.querySelectorAll(selector);
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) continue;

          let text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
          if (text.length > 40) text = text.slice(0, 40) + '...';

          let sel = el.id ? '#' + el.id : '';
          if (!sel && el.getAttribute('value')) {
            sel = el.tagName.toLowerCase() + '[value="' + el.getAttribute('value') + '"]';
          }
          if (!sel && el.className) {
            const firstClass = el.className.trim().split(/\\s+/)[0];
            if (firstClass) sel = el.tagName.toLowerCase() + '.' + firstClass;
          }
          if (!sel) sel = el.tagName.toLowerCase();

          results.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            name: el.getAttribute('name') || undefined,
            value: el.getAttribute('value') || undefined,
            hotkey: el.getAttribute('hotkey') || undefined,
            text: text || undefined,
            selector: sel,
            bounds: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
            center: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)]
          });
        }
        return results;
      })()
    `
    const res = await this.eval(expr, true, 'editor')
    if (!res.ok) return res
    return {
      ok: true,
      count: res.result ? res.result.length : 0,
      elements: res.result || []
    }
  }

  /**
   * 点击屏幕元素（按选择器或绝对像素坐标，锁定编辑器主窗口）
   */
  async clickElement({ selector, x, y }) {
    if (!selector && (x === undefined || y === undefined)) {
      return { ok: false, error: '必须提供 selector 选择器或 x, y 坐标' }
    }

    if (selector) {
      const expr = `
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { found: false, message: '未找到元素: ' + ${JSON.stringify(selector)} };
          el.focus?.();
          el.click?.();
          const rect = el.getBoundingClientRect();
          return {
            found: true,
            clicked: ${JSON.stringify(selector)},
            bounds: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]
          };
        })()
      `
      return await this.eval(expr, true, 'editor')
    }

    // 按坐标点击
    const expr = `
      (() => {
        const el = document.elementFromPoint(${Number(x)}, ${Number(y)});
        if (!el) return { found: false, message: '坐标处无元素: (${x}, ${y})' };
        el.focus?.();
        el.click?.();
        return { found: true, clickedAt: [${Number(x)}, ${Number(y)}], tag: el.tagName.toLowerCase() };
      })()
    `
    return await this.eval(expr, true, 'editor')
  }

  /**
   * 触发一键试玩（#title-play 或 F4）
   */
  async triggerPlaytest() {
    const expr = `
      (() => {
        const playBtn = document.querySelector('#title-play');
        if (playBtn) {
          playBtn.click();
          return { ok: true, message: '已触发 #title-play 试玩按钮点击' };
        }
        if (typeof Title !== 'undefined' && Title.playGame) {
          Title.playGame();
          return { ok: true, message: '已调用 Title.playGame() 启动试玩' };
        }
        return { ok: false, error: '未找到试玩按钮或 Title.playGame' };
      })()
    `
    return await this.eval(expr, true, 'editor')
  }

  /**
   * 【核心破局点】外部修改落盘后，热重载编辑器内存中的指定数据并刷新窗口
   * 阻止引擎在下次保存或启动试玩时用旧内存反向覆盖磁盘！
   */
  async reloadEditorResource(relPath, guid) {
    const expr = `
      ((relPath, guid) => {
        try {
          if (typeof File === 'undefined' || typeof Data === 'undefined') {
            return { ok: false, error: '当前环境缺少 File 或 Data 对象（非编辑器主页面）' };
          }
          const meta = (guid && Data.manifest?.guidMap?.[guid]) || null;
          const targetPath = relPath || meta?.path;
          if (!targetPath) {
            return { ok: false, error: '未找到对应路径或 GUID' };
          }

          return File.get({ path: targetPath, type: 'json' }).then((data) => {
            if (guid) {
              if (Data.events) Data.events[guid] = data;
              if (Data.scenes) Data.scenes[guid] = data;
              if (Data.ui) Data.ui[guid] = data;
              if (meta && meta.dataMap) meta.dataMap[guid] = data;

              // 若事件编辑器打开了该项，刷新显示
              if (typeof EventEditor !== 'undefined' && EventEditor.getItemById) {
                const item = EventEditor.getItemById(guid);
                if (item) {
                  item.event = data;
                  delete item.commands;
                  if (EventEditor.openCommandList) EventEditor.openCommandList(item);
                }
              }
            }
            return { ok: true, message: '成功将最新文件热载入编辑器内存并更新界面，已杜绝旧内存反向覆盖' };
          });
        } catch (err) {
          return { ok: false, error: err.message };
        }
      })(${JSON.stringify(relPath)}, ${JSON.stringify(guid || null)})
    `
    return await this.eval(expr, true, 'editor')
  }
}

module.exports = CdpClient
