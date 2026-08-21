/* 性能测试台 · perf-lab v0.2.0（回归测试台）
 * A 批量场景 + 压测：勾选多个场景，逐个在沙箱 iframe 里真实运行、可选克隆角色压测，产出对比表；
 * B 基线 + 改版 diff：保存基线，之后每次运行自动对比 P95/平均/分模块耗时，标红退化；
 * C 事件级定位：探针统计 EventManager 每个激活事件处理器的耗时（事件类型 :: 事件文件名）。
 *
 * 工程位置与 yami-tools 其他工具联动（IndexedDB loot-smith-settings / last-project-handle）。
 * 纯只读：不写回游戏工程任何文件；游戏运行时存档落在工具页同源 IndexedDB（沙箱隔离）。
 */
(() => {
  'use strict'

  const APP_VERSION = '0.2.0'
  const SW_VERSION = '20260821-perf-lab-2'
  const RUN_PATH = './run/index.html'
  const BASELINE_STORAGE_KEY = 'perf-lab-baseline'

  // ---------- 小工具 ----------
  const $ = (id) => document.getElementById(id)
  const els = {
    projectState: $('project-state'),
    restoreProject: $('restore-project'),
    pickProject: $('pick-project'),
    btnRescan: $('btn-rescan'),
    folderFallback: $('folder-fallback'),
    scenarioList: $('scenario-list'),
    scenarioCount: $('scenario-count'),
    btnSelectAll: $('btn-select-all'),
    btnSelectNone: $('btn-select-none'),
    pressureSelect: $('pressure-select'),
    durationInput: $('duration-input'),
    budgetInput: $('budget-input'),
    btnStart: $('btn-start'),
    btnStop: $('btn-stop'),
    runHint: $('run-hint'),
    baselineInfo: $('baseline-info'),
    btnBaselineSave: $('btn-baseline-save'),
    btnBaselineClear: $('btn-baseline-clear'),
    btnExportJson: $('btn-export-json'),
    btnExportMd: $('btn-export-md'),
    eventBars: $('event-bars'),
    updaterBars: $('updater-bars'),
    rendererBars: $('renderer-bars'),
    gameWrap: $('game-wrap'),
    gameFrame: $('game-frame'),
    gameOverlay: $('game-overlay'),
    batchProgress: $('batch-progress'),
    batchTableWrap: $('batch-table-wrap'),
    batchTableBody: document.querySelector('#batch-table tbody'),
    mFps: $('m-fps'),
    mAvg: $('m-avg'),
    mP95: $('m-p95'),
    mMax: $('m-max'),
    mBudget: $('m-budget'),
    mVerdict: $('m-verdict'),
    verdictCard: document.querySelector('.metric-card.verdict'),
    sceneInfo: $('scene-info'),
    runInfo: $('run-info'),
    statusText: $('status-text'),
    budgetText: $('budget-text'),
    toastRegion: $('toast-region'),
  }

  const state = {
    root: null,                // FileSystemDirectoryHandle | null
    virtual: null,             // fallback 模式虚拟文件树 { path: File }
    rootName: '',
    scenes: [],                // { path, name, guid, size }
    manifestAt: null,
    providerReady: false,
    running: false,
    runQueue: [],
    runIndex: 0,
    pollTimer: null,
    fsObserver: null,
    syncPollTimer: null,
    batchResults: [],          // { key, label, ok, report?, error? }
    baseline: null,            // { project, savedAt, entries: { key: {...} } }
    lastReport: null,
    fileCache: new Map(),
  }

  // ---------- Toast / 状态 ----------
  function toast(message, kind = '') {
    const node = document.createElement('div')
    node.className = `toast ${kind}`
    node.textContent = message
    els.toastRegion.appendChild(node)
    setTimeout(() => node.remove(), 4200)
  }
  function setStatus(text) { els.statusText.textContent = text }

  // ---------- 工程记忆（与其他工具同库同键联动） ----------
  let settingsDatabasePromise = null
  function openSettingsDatabase() {
    if (settingsDatabasePromise) return settingsDatabasePromise
    settingsDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('loot-smith-settings', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return settingsDatabasePromise
  }
  function setting(key, value) {
    return openSettingsDatabase().then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction('settings', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('settings')
      const request = value === undefined ? store.get(key) : store.put(value, key)
      request.onsuccess = () => resolve(value === undefined ? request.result : value)
      request.onerror = () => reject(request.error)
    }))
  }

  // ---------- 工程加载 ----------
  async function rememberRoot(root) { try { await setting('last-project-handle', root) } catch {} }

  async function restoreLastProject() {
    let root
    try { root = await setting('last-project-handle') } catch {}
    if (!root) { toast('没有找到上次的工程记录', 'error'); return }
    try {
      let permission = await root.queryPermission({ mode: 'readwrite' })
      if (permission !== 'granted') permission = await root.requestPermission({ mode: 'readwrite' })
      if (permission !== 'granted') { toast('上次工程授权已失效，请重新选择', 'error'); return }
      await setupRoot(root)
    } catch (error) {
      console.warn(error)
      toast('读取上次工程失败：' + error.message, 'error')
    }
  }

  async function pickProject() {
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' })
      await setupRoot(root)
    } catch (error) {
      if (error && error.name === 'AbortError') return
      console.warn(error)
      toast('选择工程失败：' + error.message, 'error')
    }
  }

  async function setupRoot(root) {
    state.root = root
    state.virtual = null
    state.rootName = root.name
    await rememberRoot(root)
    els.pickProject.textContent = '切换工程'
    els.restoreProject.classList.add('hidden')
    els.btnRescan.classList.remove('hidden')
    await scanProject()
  }

  // fallback：无 File System Access API 时的文件夹导入（只读）
  async function pickFallback(files) {
    const rel = (file) => {
      const p = file.webkitRelativePath || file.name || ''
      const i = p.indexOf('/')
      return i === -1 ? p : p.slice(i + 1)
    }
    const virtual = {}
    for (const file of files) virtual[rel(file)] = file
    if (!virtual['index.html'] || !virtual['Data/manifest.json']) {
      toast('未在导入的文件夹里找到游戏工程（需要根目录下有 index.html 与 Data/manifest.json）', 'error')
      return
    }
    state.root = null
    state.virtual = virtual
    state.rootName = (files[0] && (files[0].webkitRelativePath || '').split('/')[0]) || '导入工程'
    els.restoreProject.classList.add('hidden')
    els.pickProject.textContent = '导入工程'
    els.btnRescan.classList.remove('hidden')
    toast('导入模式：工程文件在内存中，只读测试', '')
    await scanProject()
  }

  // ---------- 文件读取 ----------
  async function getHandle(root, path) {
    const parts = String(path).split('/').filter(Boolean)
    let directory = root
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
    return directory.getFileHandle(parts.at(-1))
  }

  async function readJsonSafe(relPath) {
    try {
      let text
      if (state.root) text = await (await (await getHandle(state.root, relPath)).getFile()).text()
      else {
        const file = state.virtual[relPath]
        if (!file) throw new Error('文件不存在：' + relPath)
        text = await file.text()
      }
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  const MIME_BY_EXT = {
    '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.cur': 'image/x-icon', '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.css': 'text/css', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  function mimeFor(rel) {
    const ext = String(rel).toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || ''
    return MIME_BY_EXT[ext] || 'application/octet-stream'
  }

  async function readProjectFile(rel) {
    if (state.fileCache.has(rel)) return state.fileCache.get(rel)
    let blob
    let mime
    if (state.root) {
      const file = await (await getHandle(state.root, rel)).getFile()
      blob = file
      mime = file.type || mimeFor(rel)
    } else {
      const file = state.virtual[rel]
      if (!file) throw new Error(`工程里没有这个文件：${rel}`)
      blob = file
      mime = file.type || mimeFor(rel)
    }
    const out = { blob, mime }
    state.fileCache.set(rel, out)
    if (state.fileCache.size > 256) state.fileCache.delete(state.fileCache.keys().next().value)
    return out
  }

  // ---------- 工程扫描 ----------
  const SCENE_GUID_RE = /\.([0-9a-f]{16})\.scene$/i

  async function scanProject() {
    stopSync()
    state.fileCache.clear()
    setStatus('正在扫描工程…')
    els.btnStart.disabled = true
    try {
      const probes = ['index.html', 'Dist/Script/main.js', 'Data/manifest.json']
      for (const rel of probes) {
        let ok = false
        if (state.root) {
          try { await getHandle(state.root, rel); ok = true } catch { ok = false }
        } else {
          ok = !!state.virtual[rel]
        }
        if (!ok) throw new Error(`缺少游戏文件：${rel}（请选择游戏工程根目录，且工程已编译出 Dist）`)
      }

      const manifest = await readJsonSafe('Data/manifest.json')
      const scenes = []
      if (manifest && Array.isArray(manifest.scenes)) {
        for (const s of manifest.scenes) {
          const path = s && s.path
          if (typeof path !== 'string') continue
          const base = path.split('/').pop() || path
          const m = base.match(SCENE_GUID_RE)
          if (!m) continue
          scenes.push({ path, name: base.replace(/\.[0-9a-f]{16}\.scene$/i, ''), guid: m[1], size: s.size || 0 })
        }
      }
      state.scenes = scenes
      renderScenarioList()
      startSync()
      setStatus(`工程就绪：${state.rootName}，识别到 ${scenes.length} 个场景；可开始测试`)
      els.projectState.textContent = state.rootName
      els.btnStart.disabled = false
      els.budgetText.textContent = `帧预算：${Number(els.budgetInput.value) || 16.7} ms/帧`
      loadBaseline()
    } catch (error) {
      setStatus('扫描失败：' + error.message)
      els.btnStart.disabled = true
      toast(error.message, 'error')
    }
  }

  function renderScenarioList() {
    const list = els.scenarioList
    list.innerHTML = ''
    list.appendChild(scenarioRow('__startup', '启动流程（默认启动）', true))
    for (const s of state.scenes) {
      list.appendChild(scenarioRow(s.guid, `${s.name}（${s.guid.slice(0, 8)}…，${(s.size / 1024).toFixed(1)}KB）`, false))
    }
    updateScenarioCount()
  }

  function scenarioRow(value, label, checked) {
    const row = document.createElement('label')
    row.className = 'check-row'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'scenario-check'
    input.value = value
    input.checked = checked
    input.addEventListener('change', updateScenarioCount)
    const span = document.createElement('span')
    span.className = 'check-text'
    span.textContent = label
    row.appendChild(input)
    row.appendChild(span)
    return row
  }

  function selectedScenarioKeys() {
    return Array.from(els.scenarioList.querySelectorAll('.scenario-check:checked')).map((input) => input.value)
  }

  function updateScenarioCount() {
    const n = selectedScenarioKeys().length
    els.scenarioCount.textContent = `已选 ${n} 项`
    els.btnStart.disabled = n === 0 || !state.root && !state.virtual
  }

  function labelFor(key) {
    if (key === '__startup') return '启动流程'
    return state.scenes.find((s) => s.guid === key)?.name || key.slice(0, 8)
  }

  // ---------- 工程自动同步 ----------
  let rescanTimer = null
  function scheduleRescan() {
    clearTimeout(rescanTimer)
    rescanTimer = setTimeout(async () => {
      if (state.running) {
        toast('工程文件已变化；测试结束后点「重新扫描」即可生效', '')
        return
      }
      await scanProject()
      toast('检测到工程变化，已重新扫描', '')
    }, 500)
  }

  async function startSync() {
    stopSync()
    if (state.root && window.FileSystemObserver) {
      try {
        state.fsObserver = new FileSystemObserver(() => scheduleRescan())
        await state.fsObserver.observe(state.root, { recursive: true })
      } catch {
        state.fsObserver = null
      }
    }
    if (state.fsObserver) return
    if (state.root) {
      state.syncPollTimer = setInterval(async () => {
        try {
          const file = await (await getHandle(state.root, 'Data/manifest.json')).getFile()
          const stamp = file.lastModified + ':' + file.size
          if (state.manifestAt !== null && stamp !== state.manifestAt) scheduleRescan()
          state.manifestAt = stamp
        } catch { /* manifest 暂时不存在时忽略 */ }
      }, 5000)
    }
  }

  function stopSync() {
    if (state.fsObserver) {
      try { state.fsObserver.disconnect() } catch {}
      state.fsObserver = null
    }
    clearInterval(state.syncPollTimer)
    state.syncPollTimer = null
    state.manifestAt = null
  }

  // ---------- Service Worker 虚拟文件服务 ----------
  function waitFor(predicate, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      const timer = setInterval(() => {
        let value = false
        try { value = predicate() } catch {}
        if (value) { clearInterval(timer); resolve(true); return }
        if (Date.now() - startedAt > timeoutMs) { clearInterval(timer); reject(new Error(message || '等待超时')) }
      }, 200)
    })
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) throw new Error('当前浏览器不支持 Service Worker（请用 Chrome/Edge 最新版，且必须 https 或 localhost）')
    const registration = await navigator.serviceWorker.register(`./sw.js?v=${SW_VERSION}`, { scope: './' })
    await navigator.serviceWorker.ready
    await waitFor(() => navigator.serviceWorker.controller === registration.active, 5000, 'Service Worker 接管页面超时').catch(() => {})
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      let done = false
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('Service Worker 握手超时，请刷新页面重试')) } }, 10000)
      channel.port1.onmessage = (event) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(event.data && event.data.type === 'perf-provider-ok')
      }
      registration.active.postMessage({ type: 'perf-provider-hello' }, [channel.port2])
    })
    state.providerReady = true
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      const data = event.data || {}
      if (data.type !== 'perf-file-request') return
      const port = event.ports && event.ports[0]
      if (!port) return
      try {
        const { blob, mime } = await readProjectFile(String(data.rel))
        port.postMessage({ type: 'perf-file-response', id: data.id, ok: true, blob, mime })
      } catch (error) {
        port.postMessage({ type: 'perf-file-response', id: data.id, ok: false, status: 404, error: error.message })
      }
    })
  }

  // ---------- 配置读取 ----------
  function getBudget() {
    const value = Number(els.budgetInput.value)
    return Number.isFinite(value) && value > 0 ? value : 16.7
  }
  function getDurationMs() {
    const value = Number(els.durationInput.value)
    return Math.min(600000, Math.max(5000, (Number.isFinite(value) && value > 0 ? value : 30) * 1000))
  }

  function perfWindow() {
    const win = els.gameFrame.contentWindow
    return win && win.__YAMI_PERF__ ? win : null
  }

  // ---------- 单场景测试 ----------
  async function runScenarioOnce(key) {
    const label = labelFor(key)
    const budget = getBudget()
    setStatus(`正在加载：${label} …`)
    els.gameOverlay.classList.remove('hidden')
    els.gameOverlay.innerHTML = '<div class="overlay-title">⏱ 正在加载游戏</div><div class="overlay-text">场景：' + escapeHtml(label) + '</div><div class="overlay-text">真实运行工程源码，请稍候…</div>'

    const runUrl = new URL(RUN_PATH, location.href)
    runUrl.searchParams.set('t', String(Date.now()))
    els.gameFrame.src = runUrl.href
    await waitFor(() => !!perfWindow(), 120000, '游戏页面加载超时：探针未注入。请确认工程 index.html 存在、Dist/Script/main.js 已编译')

    const win = els.gameFrame.contentWindow
    const probe = win.__YAMI_PERF__
    await waitFor(() => probe.isReady(), 120000, '游戏初始化超时（Data.manifest 未就绪）')

    if (key !== '__startup') {
      setStatus('正在切换场景：' + label)
      try {
        await waitFor(() => probe.isSceneReady(), 60000, '场景系统初始化超时（Scene.actor/entity 未就绪）')
        await probe.loadScene(key)
      } catch (error) {
        return { key, label, ok: false, error: '场景加载失败：' + error.message }
      }
    }

    const pressureLevel = els.pressureSelect.value
    let pressureResult = { level: pressureLevel, cloned: 0, original: 0 }
    if (pressureLevel !== 'none') {
      setStatus(`正在施加压测（${pressureLevel}）：${label}`)
      try {
        const p = probe.pressure(pressureLevel) || {}
        pressureResult = p
        if (!p.ok) toast(`压测未生效：${p.error || '未知原因'}（将按原始负载测试）`, '')
      } catch (error) {
        toast('压测失败：' + error.message + '（将按原始负载测试）', 'error')
      }
    }

    probe.start()
    els.gameOverlay.classList.add('hidden')
    const startedAt = Date.now()
    const duration = getDurationMs()
    setStatus(`测试中（${(duration / 1000).toFixed(0)} 秒，预算 ${budget}ms/帧，${pressureResult.cloned ? '克隆角色 ' + pressureResult.cloned + ' 个' : '无压测'}）…`)

    return new Promise((resolve) => {
      state.pollTimer = setInterval(() => {
        let snap = null
        try {
          const frameWin = perfWindow()
          if (!frameWin) return
          snap = frameWin.__YAMI_PERF__.snapshot(budget)
          renderLive(snap, budget)
        } catch (error) {
          clearInterval(state.pollTimer)
          state.pollTimer = null
          resolve({ key, label, ok: false, error: '采样中断：' + error.message })
          return
        }
        if (!state.running || Date.now() - startedAt >= duration) {
          clearInterval(state.pollTimer)
          state.pollTimer = null
          try {
            const frameWin = perfWindow()
            const finalSnap = frameWin ? frameWin.__YAMI_PERF__.stop() : snap
            const samples = frameWin ? frameWin.__YAMI_PERF__.samples() : []
            const report = buildReport(key, label, budget, finalSnap || snap, samples, pressureResult, state.running ? '时长结束' : '手动停止')
            resolve({ key, label, ok: true, report })
          } catch (error) {
            resolve({ key, label, ok: false, error: '收尾失败：' + error.message })
          }
        }
      }, 500)
    })
  }

  function buildReport(key, label, budget, snap, samples, pressureResult, reason) {
    const compute = snap.compute || {}
    const verdict = {
      pass: compute.p95 <= budget && compute.avg <= budget,
      p95: compute.p95,
      avg: compute.avg,
      budget,
      reason,
    }
    return {
      key,
      label,
      appVersion: APP_VERSION,
      probeVersion: snap.version,
      project: state.rootName,
      budgetMs: budget,
      pressure: pressureResult || { level: 'none' },
      verdict,
      compute,
      frame: snap.frame || {},
      fps: snap.fps,
      updaters: snap.updaters || [],
      renderers: snap.renderers || [],
      events: snap.events || [],
      scene: snap.scene || null,
      samples,
      startedAt: new Date().toISOString(),
    }
  }

  // ---------- 批量调度 ----------
  async function startRun() {
    if (state.running) return
    if (!state.root && !state.virtual) { toast('请先选择游戏工程', 'error'); return }
    const keys = selectedScenarioKeys()
    if (!keys.length) { toast('请至少勾选一个测试场景', 'error'); return }
    state.running = true
    state.runQueue = keys
    state.batchResults = []
    state.lastReport = null
    els.btnStart.disabled = true
    els.btnStop.classList.remove('hidden')
    els.runHint.classList.remove('hidden')
    els.batchTableWrap.classList.remove('hidden')
    renderBatchTable()
    els.btnExportJson.disabled = true
    els.btnExportMd.disabled = true
    els.budgetText.textContent = `帧预算：${getBudget()} ms/帧`
    try {
      await ensureServiceWorker()
      for (let i = 0; i < keys.length; i++) {
        if (!state.running) break
        state.runIndex = i
        els.batchProgress.classList.remove('hidden')
        els.batchProgress.textContent = `批量进度：${i + 1}/${keys.length} — ${labelFor(keys[i])}`
        const result = await runScenarioOnce(keys[i])
        state.batchResults.push(result)
        if (result.ok) {
          state.lastReport = result.report
          renderFinal(result.report)
        }
        renderBatchTable()
      }
      const okCount = state.batchResults.filter((r) => r.ok).length
      const failCount = state.batchResults.length - okCount
      setStatus(`批量测试完成：${okCount} 成功 / ${failCount} 失败`)
      if (okCount) toast(`完成：${okCount} 个场景已测试${failCount ? '，' + failCount + ' 个失败' : ''}`, failCount ? '' : 'success')
    } catch (error) {
      console.error(error)
      setStatus('测试启动失败：' + error.message)
      toast(error.message, 'error')
      els.gameOverlay.innerHTML = '<div class="overlay-title">启动失败</div><div class="overlay-text">' + escapeHtml(error.message) + '</div>'
    } finally {
      clearInterval(state.pollTimer)
      state.pollTimer = null
      state.running = false
      els.btnStart.disabled = false
      els.btnStop.classList.add('hidden')
      els.runHint.classList.add('hidden')
      els.batchProgress.classList.add('hidden')
      const hasOk = state.batchResults.some((r) => r.ok)
      els.btnExportJson.disabled = !hasOk
      els.btnExportMd.disabled = !hasOk
      els.btnBaselineSave.disabled = !hasOk
      updateScenarioCount()
    }
  }

  function stopRun() {
    if (!state.running) return
    state.running = false
    setStatus('正在停止（等待当前场景收尾）…')
  }

  // ---------- 基线 ----------
  function loadBaseline() {
    try {
      state.baseline = JSON.parse(localStorage.getItem(BASELINE_STORAGE_KEY) || 'null')
    } catch {
      state.baseline = null
    }
    renderBaselineInfo()
  }

  function saveBaseline() {
    const okResults = state.batchResults.filter((r) => r.ok)
    if (!okResults.length) { toast('没有可保存的成功测试结果', 'error'); return }
    const entries = {}
    for (const result of okResults) {
      const r = result.report
      entries[result.key] = {
        label: result.label,
        p95: r.compute.p95,
        avg: r.compute.avg,
        max: r.compute.max,
        fps: r.fps,
        samples: r.samples.length,
        updaters: moduleAvgMap(r.updaters),
        renderers: moduleAvgMap(r.renderers),
        events: moduleAvgMap(r.events),
      }
    }
    state.baseline = { project: state.rootName, savedAt: Date.now(), entries }
    try { localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(state.baseline)) } catch (error) { toast('基线保存失败：' + error.message, 'error'); return }
    renderBaselineInfo()
    renderBatchTable()
    toast('基线已保存：之后每次测试自动对比', 'success')
  }

  function clearBaseline() {
    localStorage.removeItem(BASELINE_STORAGE_KEY)
    state.baseline = null
    renderBaselineInfo()
    renderBatchTable()
    toast('基线已清除', '')
  }

  function moduleAvgMap(list) {
    const map = {}
    for (const m of list || []) map[m.name] = m.avg
    return map
  }

  function renderBaselineInfo() {
    els.btnBaselineClear.disabled = !state.baseline
    if (!state.baseline) {
      els.baselineInfo.textContent = '还没有基线：跑完一次测试后可保存为基线，之后每次自动对比。'
      return
    }
    const sameProject = state.baseline.project === state.rootName
    const time = new Date(state.baseline.savedAt).toLocaleString()
    const entryCount = Object.keys(state.baseline.entries || {}).length
    els.baselineInfo.textContent = `${sameProject ? '✓' : '⚠（不同工程）'} 基线：${state.baseline.project} · ${time} · ${entryCount} 个场景。${sameProject ? '测试结果会自动对比并显示 ΔP95。' : '请对本工程重新保存基线。'}`
  }

  function baselineEntryFor(key) {
    if (!state.baseline || state.baseline.project !== state.rootName) return null
    return (state.baseline.entries || {})[key] || null
  }

  function diffFor(report) {
    const base = baselineEntryFor(report.key)
    if (!base) return null
    const dp95 = +(report.compute.p95 - base.p95).toFixed(2)
    const dAvg = +(report.compute.avg - base.avg).toFixed(2)
    const regress = dp95 > Math.max(0.5, base.p95 * 0.15)
    const regressions = []
    for (const [kind, list, baseMap] of [
      ['更新器', report.updaters, base.updaters],
      ['渲染器', report.renderers, base.renderers],
      ['事件', report.events, base.events],
    ]) {
      for (const m of list) {
        const baseAvg = baseMap && baseMap[m.name]
        if (baseAvg === undefined) continue
        const delta = +(m.avg - baseAvg).toFixed(2)
        if (delta > Math.max(0.2, baseAvg * 0.15)) regressions.push({ kind, name: m.name, delta, avg: m.avg, baseAvg })
      }
    }
    regressions.sort((a, b) => b.delta - a.delta)
    return { base, dp95, dAvg, regress, regressions: regressions.slice(0, 5) }
  }

  // ---------- 渲染 ----------
  function fmt(v, unit = 'ms') { return Number.isFinite(v) ? `${Number(v).toFixed(2)} ${unit}` : '--' }

  function renderLive(snap, budget) {
    if (!snap) return
    els.mFps.textContent = snap.fps || '--'
    els.mAvg.textContent = fmt(snap.compute.avg)
    els.mP95.textContent = fmt(snap.compute.p95)
    els.mMax.textContent = fmt(snap.compute.max)
    els.mBudget.textContent = snap.compute.p95 > 0 ? `${Math.round((snap.compute.p95 / budget) * 100)}%` : '--'
    els.runInfo.textContent = `采样：${snap.samples} 帧 · 更新 ${fmt(snap.compute.avg)} · 帧间隔 avg ${fmt(snap.frame.avg)}`
    if (snap.scene) {
      els.sceneInfo.textContent = `场景统计：角色 ${snap.scene.actors} · 动画 ${snap.scene.animations} · 触发器 ${snap.scene.triggers} · 粒子 ${snap.scene.particles} · UI ${snap.scene.uiElements} · 纹理 ${snap.scene.textures}`
    }
    renderBars(els.updaterBars, snap.updaters, budget)
    renderBars(els.rendererBars, snap.renderers, budget)
    renderBars(els.eventBars, snap.events, budget)
  }

  function renderBars(container, list, budget) {
    if (!list || !list.length) {
      container.innerHTML = '<div class="empty-state small">暂无数据</div>'
      return
    }
    const maxAvg = Math.max(...list.map((m) => m.avg), 0.001)
    container.innerHTML = list.map((m) => {
      const pct = Math.min(100, (m.avg / maxAvg) * 100)
      const bad = m.avg > budget * 0.25
      return `<div class="bar-row ${bad ? 'bad' : 'warn'}">
        <div style="min-width:0">
          <div class="bar-head"><span title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span><span>avg ${m.avg.toFixed(2)}ms · max ${m.max.toFixed(2)}ms</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`
    }).join('')
  }

  function renderFinal(report) {
    renderLive({
      fps: report.fps,
      compute: report.compute,
      frame: report.frame,
      samples: report.samples.length,
      updaters: report.updaters,
      renderers: report.renderers,
      events: report.events,
      scene: report.scene,
    }, report.budgetMs)
    const v = report.verdict
    els.mVerdict.textContent = v.pass ? 'PASS' : 'FAIL'
    els.verdictCard.classList.remove('pass', 'fail')
    els.verdictCard.classList.add(v.pass ? 'pass' : 'fail')
    els.runInfo.textContent = `采样：${report.samples.length} 帧 · ${v.reason} · 超预算帧：${report.compute.overBudgetCount ?? 0}`
  }

  function renderBatchTable() {
    const rows = state.batchResults
    els.batchTableBody.innerHTML = rows.map((result) => {
      if (!result.ok) {
        return `<tr class="row-error"><td>${escapeHtml(result.label)}</td><td colspan="8">${escapeHtml(result.error || '失败')}</td></tr>`
      }
      const r = result.report
      const diff = diffFor(r)
      const dp95Html = diff
        ? `<span class="${diff.regress ? 'delta-bad' : 'delta-good'}">${diff.dp95 > 0 ? '+' : ''}${diff.dp95}</span>`
        : '<span class="delta-none">—</span>'
      const bottleneck = topBottleneck(r)
      const pressureText = r.pressure && r.pressure.level !== 'none' ? `${r.pressure.level} ×${r.pressure.cloned}` : '无'
      return `<tr class="${r.verdict.pass ? 'row-pass' : 'row-fail'}">
        <td title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</td>
        <td>${pressureText}</td>
        <td>${r.samples.length}</td>
        <td>${r.fps || '--'}</td>
        <td>${r.compute.p95.toFixed(2)}</td>
        <td>${dp95Html}</td>
        <td>${r.compute.overBudgetCount ?? 0}</td>
        <td><b>${r.verdict.pass ? 'PASS' : 'FAIL'}</b></td>
        <td title="${escapeHtml(bottleneck.full || '')}">${escapeHtml(bottleneck.short || '—')}</td>
      </tr>`
    }).join('')
  }

  function topBottleneck(report) {
    let top = null
    for (const m of report.updaters || []) if (!top || m.avg > top.avg) top = m
    return top ? { full: `更新器 ${top.name} avg ${top.avg.toFixed(2)}ms`, short: `${top.name} ${top.avg.toFixed(2)}ms` } : null
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  }

  // ---------- 报告导出 ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  function exportPayload() {
    return {
      appVersion: APP_VERSION,
      project: state.rootName,
      budgetMs: getBudget(),
      pressure: els.pressureSelect.value,
      createdAt: new Date().toISOString(),
      baseline: state.baseline && state.baseline.project === state.rootName ? { savedAt: state.baseline.savedAt } : null,
      results: state.batchResults.map((result) => {
        if (!result.ok) return { key: result.key, label: result.label, ok: false, error: result.error }
        const report = result.report
        const diff = diffFor(report)
        return { ...report, diff }
      }),
    }
  }

  function exportJson() {
    if (!state.batchResults.some((r) => r.ok)) return
    download(`perf-report-${Date.now()}.json`, JSON.stringify(exportPayload(), null, 2), 'application/json')
  }

  function exportMarkdown() {
    if (!state.batchResults.some((r) => r.ok)) return
    const payload = exportPayload()
    const lines = [
      `# 性能测试报告 · ${payload.project}`,
      '',
      `- 帧预算：${payload.budgetMs} ms/帧（60fps = 16.7ms）`,
      `- 压测强度：${payload.pressure === 'none' ? '无' : payload.pressure}`,
      `- 基线：${payload.baseline ? new Date(payload.baseline.savedAt).toLocaleString() : '无'}`,
      '',
      '## 结果总表',
      '',
      '| 场景 | 压测 | 帧数 | FPS | 平均 | P95 | ΔP95(基线) | 超预算帧 | 判定 |',
      '|---|---|---|---|---|---|---|---|---|',
    ]
    for (const result of payload.results) {
      if (!result.ok) {
        lines.push(`| ${result.label} | 失败 | - | - | - | - | - | - | ${result.error} |`)
        continue
      }
      const r = result
      const diff = result.diff
      lines.push(`| ${r.label} | ${r.pressure.level} | ${r.samples.length} | ${r.fps} | ${r.compute.avg} | ${r.compute.p95} | ${diff ? (diff.dp95 > 0 ? '+' : '') + diff.dp95 : '—'} | ${r.compute.overBudgetCount ?? 0} | ${r.verdict.pass ? '✅ PASS' : '❌ FAIL'} |`)
    }
    lines.push('')
    for (const result of payload.results) {
      if (!result.ok) continue
      const r = result
      lines.push(`## ${r.label}`, '')
      lines.push(`- 判定：**${r.verdict.pass ? '✅ PASS' : '❌ FAIL'}**（P95 ${r.compute.p95}ms vs 预算 ${r.budgetMs}ms，${r.verdict.reason}）`)
      lines.push(`- 计算耗时：avg ${r.compute.avg} / P95 ${r.compute.p95} / P99 ${r.compute.p99} / max ${r.compute.max} ms`)
      lines.push(`- 帧间隔：avg ${r.frame.avg} / P95 ${r.frame.p95} ms；实时 FPS ${r.fps}`)
      if (r.pressure && r.pressure.level !== 'none') lines.push(`- 压测：${r.pressure.level}（原 ${r.pressure.original} 个角色 → 克隆 ${r.pressure.cloned} 个）`)
      if (r.scene) lines.push(`- 场景统计：角色 ${r.scene.actors} · 动画 ${r.scene.animations} · 触发器 ${r.scene.triggers} · 粒子 ${r.scene.particles} · UI ${r.scene.uiElements} · 纹理 ${r.scene.textures}`)
      if (result.diff) {
        lines.push(`- 基线对比：ΔP95 ${result.diff.dp95 > 0 ? '+' : ''}${result.diff.dp95}ms，Δavg ${result.diff.dAvg > 0 ? '+' : ''}${result.diff.dAvg}ms${result.diff.regress ? '，**有退化**' : ''}`)
        if (result.diff.regressions.length) {
          lines.push('- 退化模块/事件：')
          for (const reg of result.diff.regressions) lines.push(`  - ${reg.kind} ${reg.name}：${reg.baseAvg}ms → ${reg.avg}ms（+${reg.delta}ms）`)
        }
      }
      lines.push('', '| 更新器 Top | avg | max |', '|---|---|---|')
      for (const m of r.updaters.slice(0, 5)) lines.push(`| ${m.name} | ${m.avg} | ${m.max} |`)
      lines.push('', '| 渲染器 Top | avg | max |', '|---|---|---|')
      for (const m of r.renderers.slice(0, 5)) lines.push(`| ${m.name} | ${m.avg} | ${m.max} |`)
      lines.push('', '| 事件 Top | avg | max |', '|---|---|---|')
      for (const m of r.events.slice(0, 8)) lines.push(`| ${m.name} | ${m.avg} | ${m.max} |`)
      lines.push('')
    }
    lines.push('> 口径：计算耗时 = Game.update（逻辑）+ Game.deferredRendering（渲染）；判定标准 P95 ≤ 帧预算；ΔP95 为相对已保存基线的变化。', '')
    download(`perf-report-${Date.now()}.md`, lines.join('\n'), 'text/markdown')
  }

  // ---------- 事件绑定 ----------
  els.pickProject.addEventListener('click', pickProject)
  els.restoreProject.addEventListener('click', restoreLastProject)
  els.btnRescan.addEventListener('click', () => scanProject())
  els.folderFallback.addEventListener('change', () => {
    if (els.folderFallback.files && els.folderFallback.files.length) pickFallback(els.folderFallback.files)
  })
  els.btnSelectAll.addEventListener('click', () => {
    els.scenarioList.querySelectorAll('.scenario-check').forEach((input) => { input.checked = true })
    updateScenarioCount()
  })
  els.btnSelectNone.addEventListener('click', () => {
    els.scenarioList.querySelectorAll('.scenario-check').forEach((input) => { input.checked = false })
    updateScenarioCount()
  })
  els.btnStart.addEventListener('click', startRun)
  els.btnStop.addEventListener('click', stopRun)
  els.btnBaselineSave.addEventListener('click', saveBaseline)
  els.btnBaselineClear.addEventListener('click', clearBaseline)
  els.btnExportJson.addEventListener('click', exportJson)
  els.btnExportMd.addEventListener('click', exportMarkdown)
  els.budgetInput.addEventListener('change', () => {
    els.budgetText.textContent = `帧预算：${getBudget()} ms/帧`
  })

  window.addEventListener('beforeunload', stopSync)

  if (!window.showDirectoryPicker) {
    toast('当前浏览器不支持直接选择目录，将使用文件夹导入模式（只读）', '')
  }

  // 尝试恢复上次工程（与其他工具联动）
  restoreLastProject()
})()
