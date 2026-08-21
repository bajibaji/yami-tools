/* 性能测试台 · perf-lab v0.1.0
 * Service Worker：把「浏览器页面」变成游戏工程的虚拟文件服务器。
 *
 * 原理：
 *  1. 工具页通过 File System Access API 持有工程目录句柄（或 fallback 内存文件树）；
 *  2. 游戏以 iframe 形式加载到 <scope>/run/index.html（相对路径解析仍落在该目录下）；
 *  3. 本 SW 拦截 <scope>/run/** 的全部请求，把相对路径翻译成工程内路径，通过
 *     MessageChannel 向工具页要文件（工具页是唯一持有目录句柄的客户端）；
 *  4. 服务 index.html 时注入 perf-core.js 运行时探针。
 *
 * 只处理 GET 且仅限 run/ 虚拟路径；工具页自己的资源（sw.js/perf-core.js/app.js 等）
 * 不在 run/ 前缀下，直接走网络，不会被拦截。
 */
'use strict'

const SCOPE = self.registration.scope                     // 绝对 URL，形如 .../tools/perf-lab/
const SCOPE_PATH = new URL(SCOPE).pathname                // 路径部分，形如 /tools/perf-lab/
const RUN_PREFIX = SCOPE_PATH + 'run/'                    // 虚拟游戏根目录（路径）
const CORE_URL = SCOPE + 'perf-core.js'                   // 注入到游戏页的探针（绝对 URL）
const CORE_VERSION = '20260821-perf-lab-2'                // 探针缓存版本（更新探针必须同步升级）

let providerClientId = null                               // 持有工程目录句柄的工具页 client.id
let requestSeq = 0
const pending = new Map()                                 // seq -> { timer }
const REQUEST_TIMEOUT_MS = 30000

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/* ---------- 工具页（provider）握手与文件回包 ---------- */
self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'perf-provider-hello') {
    providerClientId = event.source.id
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ type: 'perf-provider-ok' })
    return
  }
  if (data.type === 'perf-file-response') {
    const item = pending.get(data.id)
    if (!item) return
    pending.delete(data.id)
    clearTimeout(item.timer)
    item.resolve(data)
  }
})

/** 把虚拟请求映射为工程内相对路径；不是虚拟路径或越界返回 null */
function relFromRequest(request) {
  try {
    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return null
    if (!url.pathname.startsWith(RUN_PREFIX)) return null
    let rel = url.pathname.slice(RUN_PREFIX.length)
    if (!rel) return null
    rel = decodeURIComponent(rel)
    if (rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) return null
    return rel
  } catch {
    return null
  }
}

/** 向工具页请求一个工程文件（MessageChannel 一问一答） */
function askProvider(rel) {
  return new Promise((resolve) => {
    if (!providerClientId) {
      resolve({ ok: false, status: 503, error: 'provider 未就绪（工具页未完成握手）' })
      return
    }
    const id = ++requestSeq
    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, status: 504, error: `文件读取超时（>${REQUEST_TIMEOUT_MS / 1000}s）: ${rel}` })
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { timer, resolve })

    channel.port1.onmessage = (event) => {
      const data = event.data || {}
      clearTimeout(timer)
      pending.delete(id)
      if (!data.ok) resolve({ ok: false, status: data.status || 404, error: data.error || 'not found' })
      else resolve({ ok: true, blob: data.blob, mime: data.mime || 'application/octet-stream' })
    }

    self.clients.get(providerClientId).then((client) => {
      if (!client) {
        clearTimeout(timer)
        pending.delete(id)
        resolve({ ok: false, status: 503, error: 'provider 客户端已关闭，请重新加载工具页' })
        return
      }
      client.postMessage({ type: 'perf-file-request', id, rel }, [channel.port2])
    }).catch(() => {
      clearTimeout(timer)
      pending.delete(id)
      resolve({ ok: false, status: 503, error: 'provider 客户端查询失败' })
    })
  })
}

/* ---------- 虚拟文件服务 ---------- */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const rel = relFromRequest(event.request)
  if (rel === null) return

  event.respondWith((async () => {
    // 游戏入口：注入运行时探针（每次读取的都是工程原始文件，不会重复注入）
    if (rel === 'index.html') {
      const res = await askProvider(rel)
      if (!res.ok) return new Response(res.error || 'index.html 读取失败', { status: res.status || 502 })
      try {
        let html = await res.blob.text()
        const inject = `<script src="${CORE_URL}?v=${CORE_VERSION}"></script>`
        html = html.replace(/<\/body>/i, `${inject}\n</body>`)
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      } catch (e) {
        return new Response('index.html 解析失败: ' + e.message, { status: 500 })
      }
    }

    const res = await askProvider(rel)
    if (!res.ok) return new Response(res.error || 'Not found', { status: res.status || 404 })
    const headers = { 'Content-Type': res.mime }
    return new Response(res.blob, { status: 200, headers })
  })())
})
