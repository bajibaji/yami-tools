/* Electron 性能分析台 · perf-lab v0.5.0
 * 分析三类真机报告：DevTools Performance trace、Spector.js capture、Yami 真机逐帧探针。
 * 新增「超帧定位」：导入探针 JSON 后，按“哪段代码最常导致帧超过 16.7ms”排序展示。
 */
(() => {
  'use strict'

  const core = window.YamiPerfAnalyzer
  const BASELINE_KEY = 'yami-perf-analysis-baseline-v2'
  const state = { reports: [], activeTab: 'live', baseline: loadBaseline() }
  const $ = (id) => document.getElementById(id)
  const els = {
    traceInput: $('trace-input'), spectorInput: $('spector-input'), probeInput: $('probe-input'),
    traceDrop: $('trace-drop'), spectorDrop: $('spector-drop'), probeDrop: $('probe-drop'),
    copyProbe: $('copy-probe'), probeScript: $('probe-script'), autoInstallExt: $('auto-install-ext'),
    liveIndicator: $('live-indicator'), liveStatusText: $('live-status-text'),
    liveValFps: $('live-val-fps'), liveValCompute: $('live-val-compute'),
    liveValActors: $('live-val-actors'), liveValTop: $('live-val-top'),
    liveCanvas: $('live-canvas'), liveSubsystemsList: $('live-subsystems-list'),
    liveJankList: $('live-jank-list'),
    helpButton: $('help-button'), helpModal: $('help-modal'), helpClose: $('help-close'),
    clear: $('clear-reports'), saveBaseline: $('save-baseline'), clearBaseline: $('clear-baseline'), exportReport: $('export-report'),
    sourceList: $('source-list'), status: $('status-text'), baselineInfo: $('baseline-info'),
    empty: $('empty-view'), dashboard: $('dashboard'), metrics: $('metrics-grid'), findings: $('findings'),
    hotspotBody: $('hotspot-body'), taskBody: $('task-body'), webglBody: $('webgl-body'), contextFacts: $('context-facts'),
    probeCauses: $('probe-causes'), probeFrames: $('probe-frames'), probeModules: $('probe-modules'),
    tabs: [...document.querySelectorAll('[data-tab]')], panels: [...document.querySelectorAll('[data-panel]')], toast: $('toast-region'),
  }

  const PROBE_SCRIPT = `(() => {
  'use strict'
  const PROBE_VERSION = 2
  if (window.__YAMI_PERF_PROBE__) {
    if (window.__YAMI_PERF_PROBE__.version >= PROBE_VERSION) return window.__YAMI_PERF_PROBE__
    console.warn('当前游戏窗口仍装着旧版性能探针。请关闭并重新打开游戏窗口，再粘贴新版脚本；旧包装无法安全热升级。')
    return window.__YAMI_PERF_PROBE__
  }
  const BUDGET = 16.7
  const MAX_SAMPLES = 12000
  const state = { running: true, startedAt: Date.now(), startedPerf: performance.now(), frameSeq: 0, hooked: { game: false, updaters: 0, renderers: 0, events: 0 }, samples: [], overBudgetFrames: [], updaterTotal: new Map(), rendererTotal: new Map(), eventTotal: new Map() }
  let frameUpdate = 0
  let frameRender = 0
  let frameUpdaterMs = new Map()
  let frameRendererMs = new Map()
  let frameEventMs = new Map()
  const now = () => performance.now()
  const finite = (v, f) => Number.isFinite(Number(v)) ? Number(v) : (f || 0)
  const round2 = (v) => Math.round(finite(v, 0) * 100) / 100
  const round3 = (v) => Math.round(finite(v, 0) * 1000) / 1000
  function rec(map, name, ms) { const s = map.get(name) || { name: name, sum: 0, count: 0, max: 0 }; s.sum += ms; s.count += 1; if (ms > s.max) s.max = ms; map.set(name, s) }
  function addFrame(map, name, ms) { map.set(name, (map.get(name) || 0) + ms) }
  function moduleName(mod, list, index, kind) {
    const known = []
    try { if (typeof Callback !== 'undefined') known.push(['Callback', Callback]) } catch (e) {}
    try { if (typeof Loader !== 'undefined') known.push(['Loader', Loader]) } catch (e) {}
    try { if (typeof File !== 'undefined') known.push(['File', File]) } catch (e) {}
    try { if (typeof Input !== 'undefined') known.push(['Input', Input]) } catch (e) {}
    try { if (typeof Timer !== 'undefined') known.push(['Timer', Timer]) } catch (e) {}
    try { if (typeof Scene !== 'undefined') known.push(['Scene', Scene]) } catch (e) {}
    try { if (typeof Camera !== 'undefined') known.push(['Camera', Camera]) } catch (e) {}
    try { if (typeof EventManager !== 'undefined') known.push(['EventManager', EventManager]) } catch (e) {}
    try { if (typeof Trigger !== 'undefined') known.push(['Trigger', Trigger]) } catch (e) {}
    try { if (typeof UI !== 'undefined') known.push(['UI', UI]) } catch (e) {}
    try { if (typeof AudioManager !== 'undefined') known.push(['AudioManager', AudioManager]) } catch (e) {}
    try { if (typeof CacheList !== 'undefined') known.push(['CacheList', CacheList]) } catch (e) {}
    try { if (typeof OffscreenStart !== 'undefined') known.push(['OffscreenStart', OffscreenStart]) } catch (e) {}
    try { if (typeof OffscreenEnd !== 'undefined') known.push(['OffscreenEnd', OffscreenEnd]) } catch (e) {}
    for (const entry of known) if (entry[1] === mod) return entry[0] + (entry[0] === 'Callback' ? '#' + index : '')
    try { for (const key of Object.keys(list.moduleMap || {})) if (list.moduleMap[key] === mod) return key } catch (e) {}
    const ctor = mod && mod.constructor && mod.constructor.name
    return ctor && ctor !== 'Object' && ctor !== 'Function' ? ctor : kind + '#' + index
  }
  function wrapModules(list, method, totalMap, kind) {
    try { Array.from(list || []).forEach(function (mod, index) { const mark = '__yamiPerfProbeWrapped_' + method + '__'; if (!mod || typeof mod[method] !== 'function' || mod[mark]) return; const name = moduleName(mod, list, index, kind); const orig = mod[method].bind(mod); Object.defineProperty(mod, mark, { value: true, configurable: true }); mod[method] = function () { const t0 = now(); let r; try { r = orig.apply(this, arguments) } finally { const ms = now() - t0; rec(totalMap, name, ms); addFrame(method === 'render' ? frameRendererMs : frameUpdaterMs, name, ms) } return r } }) } catch (e) {}
  }
  function wrapEventHandlers() {
    try { const list = (typeof EventManager !== 'undefined' && EventManager.activeEvents) ? EventManager.activeEvents : []; for (const event of Array.from(list)) { if (!event || typeof event.update !== 'function' || event.__yamiPerfProbeEventWrapped__) continue; let name = 'event'; try { const initial = event.initial || event.commands || {}; const eventType = event.type || initial.type || ''; const eventPath = event.path || initial.path || ''; const file = String(eventPath || '').split('/').pop() || ''; const parentName = (event.parent && event.parent.constructor && event.parent.constructor.name) ? '(' + event.parent.constructor.name + ')' : ''; name = (eventType || 'event') + ' :: ' + (file || parentName || 'unknown') } catch (e) {} const orig = event.update.bind(event); Object.defineProperty(event, '__yamiPerfProbeEventWrapped__', { value: true, configurable: true }); event.update = function () { const t0 = now(); let r; try { r = orig.apply(this, arguments) } finally { const ms = now() - t0; rec(state.eventTotal, name, ms); addFrame(frameEventMs, name, ms) } return r } } } catch (e) {}
  }
  function hookGame() {
    const G = typeof Game !== 'undefined' ? Game : null
    if (!G || typeof G.update !== 'function' || G.__yamiPerfProbeHooked__) return
    state.hooked.game = true
    const u = G.update.bind(G); G.update = function () { const t0 = now(); try { return u.apply(this, arguments) } finally { frameUpdate += now() - t0 } }
    if (typeof G.deferredRendering === 'function') { const r = G.deferredRendering.bind(G); G.deferredRendering = function () { const t0 = now(); try { return r.apply(this, arguments) } finally { frameRender += now() - t0 } } }
    Object.defineProperty(G, '__yamiPerfProbeHooked__', { value: true, configurable: true })
  }
  function refresh() { hookGame(); if (typeof Game !== 'undefined') { wrapModules(Game.updaters, 'update', state.updaterTotal, 'Updater'); wrapModules(Game.renderers, 'render', state.rendererTotal, 'Renderer'); state.hooked.updaters = (Game.updaters && Game.updaters.length) || 0; state.hooked.renderers = (Game.renderers && Game.renderers.length) || 0 } wrapEventHandlers(); if (typeof EventManager !== 'undefined' && EventManager.activeEvents) state.hooked.events = EventManager.activeEvents.length }
  refresh()
  let lastTick = now()
  function tick() {
    requestAnimationFrame(tick)
    const t = now(); const interval = t - lastTick; lastTick = t
    if (!state.running) return
    const compute = frameUpdate + frameRender
    state.frameSeq += 1
    state.samples.push({ frame: state.frameSeq, elapsedMs: round2(t - state.startedPerf), interval: interval, update: frameUpdate, render: frameRender, compute: compute, fps: (typeof Time !== 'undefined' && Time.fps) || 0 })
    if (state.samples.length > MAX_SAMPLES) state.samples.shift()
    if (compute > BUDGET) {
      const top = (map) => Array.from(map.entries()).map(function (e) { return { name: e[0], ms: round3(e[1]) } }).sort(function (a, b) { return b.ms - a.ms }).slice(0, 5)
      const updaterItems = top(frameUpdaterMs); const rendererItems = top(frameRendererMs); const eventItems = top(frameEventMs)
      const attributedUpdate = Array.from(frameUpdaterMs.values()).reduce(function (a, b) { return a + b }, 0)
      const attributedRender = Array.from(frameRendererMs.values()).reduce(function (a, b) { return a + b }, 0)
      state.overBudgetFrames.push({ frame: state.frameSeq, elapsedMs: round2(t - state.startedPerf), compute: round2(compute), update: round2(frameUpdate), render: round2(frameRender), attributedUpdate: round2(attributedUpdate), attributedRender: round2(attributedRender), unattributed: round2(Math.max(0, compute - attributedUpdate - attributedRender)), updaters: updaterItems, renderers: rendererItems, events: eventItems })
    }
    frameUpdate = 0; frameRender = 0; frameUpdaterMs = new Map(); frameRendererMs = new Map(); frameEventMs = new Map()
  }
  requestAnimationFrame(tick)
  setInterval(refresh, 1000)
  function stat(map) { return Array.from(map.values()).map(function (s) { return { name: s.name, avg: round2(s.sum / s.count), max: round2(s.max), count: s.count, total: round2(s.sum) } }).sort(function (a, b) { return b.total - a.total }) }
  function stop() {
    state.running = false
    const samples = state.samples
    const comp = samples.map(function (s) { return s.compute }).sort(function (a, b) { return a - b })
    const p = function (q) { return comp.length ? comp[Math.min(comp.length - 1, Math.round(q * (comp.length - 1)))] : 0 }
    const frameValues = samples.map(function (s) { return s.interval }).sort(function (a, b) { return a - b })
    const out = {
      kind: 'yami-probe', version: PROBE_VERSION, budgetMs: BUDGET, startedAt: new Date(state.startedAt).toISOString(), durationMs: Date.now() - state.startedAt, samples: samples.length,
      compute: { avg: round2(samples.reduce(function (a, b) { return a + b.compute }, 0) / Math.max(1, samples.length)), p95: round2(p(0.95)), p99: round2(p(0.99)), max: round2(comp.length ? comp[comp.length - 1] : 0), overBudgetCount: state.overBudgetFrames.length },
      frame: { avg: round2(samples.reduce(function (a, b) { return a + b.interval }, 0) / Math.max(1, samples.length)), p95: round2(frameValues.length ? frameValues[Math.min(frameValues.length - 1, Math.round(0.95 * (frameValues.length - 1)))] : 0), max: round2(frameValues.length ? frameValues[frameValues.length - 1] : 0) },
      updaters: stat(state.updaterTotal), renderers: stat(state.rendererTotal), events: stat(state.eventTotal), overBudgetFrames: state.overBudgetFrames.slice(), timeline: samples.map(function (s) { return { frame: s.frame, elapsedMs: s.elapsedMs, interval: round2(s.interval), update: round2(s.update), render: round2(s.render), compute: round2(s.compute) } }),
      hooked: state.hooked,
      scene: (typeof Scene !== 'undefined') ? { actors: ((Scene.visibleActors && Scene.visibleActors.count) || 0) + '/' + ((Scene.actor && Scene.actor.list) ? Scene.actor.list.length : 0), uiElements: (typeof UI !== 'undefined' && UI.manager && UI.manager.list) ? UI.manager.list.length : 0, textures: (typeof GL !== 'undefined' && GL.textureManager) ? (GL.textureManager.count || 0) : 0 } : null
    }
    window.__YAMI_PERF_PROBE_LAST__ = out
    return out
  }
  window.__YAMI_PERF_PROBE__ = {
    version: PROBE_VERSION,
    start: function () { state.samples.length = 0; state.overBudgetFrames.length = 0; state.updaterTotal.clear(); state.rendererTotal.clear(); state.eventTotal.clear(); state.hooked = { game: false, updaters: 0, renderers: 0, events: 0 }; state.running = true; state.startedAt = Date.now(); state.startedPerf = now(); state.frameSeq = 0; refresh(); return true },
    stop: stop,
    snapshot: function () { return { running: state.running, samples: state.samples.length, overBudget: state.overBudgetFrames.length } },
    check: function () { return { game: state.hooked.game, updaters: state.hooked.updaters, renderers: state.hooked.renderers, events: state.hooked.events, samples: state.samples.length } },
    copy: function () { const out = stop(); if (!out.hooked.game || !out.samples) console.warn('探针未采集到有效数据：hooked.game=' + out.hooked.game + '，samples=' + out.samples + '。请确认在 Electron 游戏窗口的 DevTools Console 运行，并在游玩一段时间后再导出。'); try { copy(JSON.stringify(out)) } catch (e) { console.log(JSON.stringify(out)) } return out },
    download: function () { const out = stop(); if (!out.hooked.game || !out.samples) console.warn('探针未采集到有效数据：hooked.game=' + out.hooked.game + '，samples=' + out.samples + '。请确认在 Electron 游戏窗口的 DevTools Console 运行，并在游玩一段时间后再导出。'); const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'yami-probe-' + Date.now() + '.json'; document.body.appendChild(a); a.click(); setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url) }, 3000); return out }
  }
  return window.__YAMI_PERF_PROBE__
})()`

  els.probeScript.value = PROBE_SCRIPT

  function toast(message, kind = '') {
    const node = document.createElement('div')
    node.className = `toast ${kind}`
    node.textContent = message
    els.toast.appendChild(node)
    setTimeout(() => node.remove(), 4000)
  }

  function loadBaseline() {
    try { return JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null') } catch { return null }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
  }

  function formatMs(value) { return Number.isFinite(value) ? `${value.toFixed(2)} ms` : '--' }
  function formatDuration(value) {
    if (!Number.isFinite(value)) return '--'
    if (value < 1000) return formatMs(value)
    const seconds = value / 1000
    if (seconds < 60) return `${seconds.toFixed(2)} 秒`
    return `${Math.floor(seconds / 60)} 分 ${(seconds % 60).toFixed(1)} 秒`
  }
  function formatBytes(value) {
    if (!Number.isFinite(value)) return '--'
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${Math.round(value)} B`
  }

  function importRawData(raw, fileName = '探针报告', autoSwitch = false) {
    try {
      const analysis = core.analyze(raw)
      state.reports = state.reports.filter((entry) => entry.kind !== analysis.kind)
      state.reports.push({ ...analysis, fileName, importedAt: Date.now() })
      toast(`已分析 ${fileName}`, 'success')
      if (autoSwitch && analysis.kind === 'probe') {
        state.activeTab = 'probe'
      }
      render()
      return true
    } catch (error) {
      toast(`${fileName}：${error.message}`, 'error')
      return false
    }
  }

  async function importFiles(files, expectedKind) {
    const list = [...files]
    if (!list.length) return
    for (const file of list) {
      try {
        const raw = JSON.parse(await file.text())
        const analysis = core.analyze(raw)
        if (expectedKind && analysis.kind !== expectedKind) {
          const names = { trace: 'DevTools Performance trace', spector: 'Spector.js capture', probe: 'Yami 真机探针' }
          throw new Error(`这不是 ${names[expectedKind] || expectedKind}`)
        }
        importRawData(raw, file.name, analysis.kind === 'probe')
      } catch (error) {
        toast(`${file.name}：${error.message}`, 'error')
      }
    }
  }

  function render() {
    const hasReports = state.reports.length > 0 || state.activeTab === 'live'
    els.empty.classList.toggle('hidden', hasReports)
    els.dashboard.classList.toggle('hidden', !hasReports)
    els.clear.disabled = !hasReports
    els.exportReport.disabled = !hasReports
    els.saveBaseline.disabled = !hasReports
    els.clearBaseline.disabled = !state.baseline
    els.status.textContent = hasReports ? `已载入 ${state.reports.length} 份真机报告` : '等待导入真机报告'
    renderSources()
    renderBaseline()
    if (!hasReports) return
    renderMetrics()
    renderFindings()
    renderCpu()
    renderWebgl()
    renderProbe()
    switchTab(state.activeTab)
  }

  function renderSources() {
    if (!state.reports.length) {
      els.sourceList.innerHTML = '<div class="empty-state small">尚未导入报告</div>'
      return
    }
    els.sourceList.innerHTML = state.reports.map((report) => `
      <div class="source-row">
        <span class="source-icon">${report.kind === 'trace' ? 'CPU' : report.kind === 'spector' ? 'GL' : 'FR'}</span>
        <span class="source-copy"><b>${escapeHtml(report.fileName)}</b><small>${report.kind === 'trace' ? 'DevTools Performance' : report.kind === 'spector' ? 'Spector.js WebGL' : 'Yami 真机探针'}</small></span>
        <button class="icon-button" type="button" data-remove="${report.kind}" title="移除报告" aria-label="移除报告">×</button>
      </div>`).join('')
    els.sourceList.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => {
      state.reports = state.reports.filter((report) => report.kind !== button.dataset.remove)
      render()
    }))
  }

  function combinedSummary() {
    const trace = state.reports.find((report) => report.kind === 'trace')
    const spector = state.reports.find((report) => report.kind === 'spector')
    const probe = state.reports.find((report) => report.kind === 'probe')
    return {
      durationMs: trace?.metrics.durationMs ?? probe?.metrics.durationMs,
      frameP95Ms: probe?.metrics.frameP95Ms ?? trace?.metrics.frameP95Ms,
      maxTaskMs: trace?.metrics.maxActionableTaskMs,
      longTaskCount: trace?.metrics.longTaskCount,
      gcMs: trace?.metrics.gcMs,
      drawCalls: spector?.metrics.drawCalls,
      glCommands: spector?.metrics.commandCount,
      gpuMemory: spector?.metrics.frameMemoryBytes,
      probeComputeP95: probe?.metrics.computeP95Ms,
      probeComputeAvg: probe?.metrics.computeAvgMs,
      probeComputeMax: probe?.metrics.computeMaxMs,
      probeOverBudget: probe?.metrics.overBudgetFrames,
      probeAttribution: probe?.metrics.attributionCoverage,
      probeSlowCluster: probe?.metrics.longestSlowCluster,
    }
  }

  function deltaFor(key, value) {
    const previous = state.baseline?.summary?.[key]
    if (!Number.isFinite(value) || !Number.isFinite(previous)) return ''
    const delta = value - previous
    const betterWhenLower = key !== 'durationMs'
    const bad = betterWhenLower && delta > 0
    return `<small class="metric-delta ${bad ? 'bad' : ''}">${delta > 0 ? '+' : ''}${delta.toFixed(2)}</small>`
  }

  function renderMetrics() {
    const summary = combinedSummary()
    const cards = [
      ['采集时长', formatDuration(summary.durationMs), deltaFor('durationMs', summary.durationMs)],
      ['帧间隔 P95', formatMs(summary.frameP95Ms), deltaFor('frameP95Ms', summary.frameP95Ms)],
      ['最长主线程任务', formatMs(summary.maxTaskMs), deltaFor('maxTaskMs', summary.maxTaskMs)],
      ['长任务数量', Number.isFinite(summary.longTaskCount) ? summary.longTaskCount : '--', deltaFor('longTaskCount', summary.longTaskCount)],
      ['GC 总耗时', formatMs(summary.gcMs), deltaFor('gcMs', summary.gcMs)],
      ['探针计算 P95', formatMs(summary.probeComputeP95), deltaFor('probeComputeP95', summary.probeComputeP95)],
      ['探针平均计算', formatMs(summary.probeComputeAvg), deltaFor('probeComputeAvg', summary.probeComputeAvg)],
      ['探针最大计算', formatMs(summary.probeComputeMax), deltaFor('probeComputeMax', summary.probeComputeMax)],
      ['探针超预算帧', Number.isFinite(summary.probeOverBudget) ? summary.probeOverBudget : '--', deltaFor('probeOverBudget', summary.probeOverBudget)],
      ['探针归因覆盖率', Number.isFinite(summary.probeAttribution) ? `${summary.probeAttribution.toFixed(1)}%` : '--', deltaFor('probeAttribution', summary.probeAttribution)],
      ['最长持续卡顿', Number.isFinite(summary.probeSlowCluster) ? `${summary.probeSlowCluster} 帧` : '--', deltaFor('probeSlowCluster', summary.probeSlowCluster)],
      ['WebGL Draw Call', Number.isFinite(summary.drawCalls) ? summary.drawCalls : '--', deltaFor('drawCalls', summary.drawCalls)],
      ['WebGL 命令', Number.isFinite(summary.glCommands) ? summary.glCommands : '--', deltaFor('glCommands', summary.glCommands)],
      ['帧资源内存', formatBytes(summary.gpuMemory), deltaFor('gpuMemory', summary.gpuMemory)],
    ]
    els.metrics.innerHTML = cards.map(([label, value, delta]) => `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div>${delta}</div>`).join('')
  }

  function renderFindings() {
    const findings = state.reports.flatMap((report) => report.findings.map((finding) => ({ ...finding, source: report.kind })))
    if (!findings.length) {
      els.findings.innerHTML = '<div class="finding ok"><b>未发现明确瓶颈</b><span>当前导入范围内没有超过分析阈值的项目。</span></div>'
      return
    }
    els.findings.innerHTML = findings.map((finding) => `<div class="finding ${finding.level}"><span class="finding-source">${finding.source === 'trace' ? 'CPU' : finding.source === 'spector' ? 'GL' : 'FR'}</span><b>${escapeHtml(finding.title)}</b><span>${escapeHtml(finding.detail)}</span></div>`).join('')
  }

  function renderCpu() {
    const trace = state.reports.find((report) => report.kind === 'trace')
    if (!trace) {
      els.hotspotBody.innerHTML = '<tr><td colspan="4">导入 DevTools Performance trace 后显示</td></tr>'
      els.taskBody.innerHTML = '<tr><td colspan="3">导入 DevTools Performance trace 后显示</td></tr>'
      return
    }
    els.hotspotBody.innerHTML = trace.hotspots.length ? trace.hotspots.slice(0, 30).map((item) => `<tr><td title="${escapeHtml(item.url)}">${escapeHtml(item.name)}</td><td>${formatMs(item.totalMs)}</td><td>${item.samples}</td><td>${escapeHtml(item.location)}</td></tr>`).join('') : `<tr><td colspan="4">${trace.profile?.probeMs > 1 ? '本次 CPU Profile 被真机探针污染，无法得出游戏热点；关闭探针后单独重录 DevTools' : trace.profile?.samples ? '本次录制没有采到可映射到游戏源码的热点' : '该 trace 没有 CPU Profile 样本'}</td></tr>`
    els.taskBody.innerHTML = trace.longTasks.length ? trace.longTasks.slice(0, 30).map((item) => `<tr><td>${formatMs(item.startMs)}</td><td>${formatMs(item.durationMs)}</td><td>${escapeHtml(item.cause || item.name)}</td><td>${escapeHtml(item.evidence?.map((entry) => `${entry.name} ${entry.durationMs}ms`).join(' / ') || '—')}</td></tr>`).join('') : '<tr><td colspan="4">没有可归因的游戏长任务；DevTools 自身启动开销已排除</td></tr>'
  }

  function renderWebgl() {
    const report = state.reports.find((entry) => entry.kind === 'spector')
    if (!report) {
      els.webglBody.innerHTML = '<tr><td colspan="3">导入 Spector.js capture 后显示</td></tr>'
      els.contextFacts.innerHTML = '<div class="empty-state small">暂无 WebGL 上下文</div>'
      return
    }
    els.webglBody.innerHTML = report.commands.slice(0, 40).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.count}</td><td>${formatMs(item.totalMs)}</td></tr>`).join('')
    els.contextFacts.innerHTML = Object.entries(report.context).map(([key, value]) => `<div class="fact"><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join('')
  }

    function renderProbeModules(probe) {
      const rows = []
      for (const [kind, list] of [['更新器', probe.updaters || []], ['渲染器', probe.renderers || []], ['事件', probe.events || []]]) {
        for (const item of list.slice(0, 8)) rows.push({ kind, name: item.name, avg: item.avg, max: item.max, total: item.total, count: item.count })
      }
      rows.sort((a, b) => b.total - a.total)
      if (!rows.length) {
        els.probeModules.innerHTML = '<div class="empty-state small">暂无模块/事件数据</div>'
        return
      }
      els.probeModules.innerHTML = `<table class="batch-table"><thead><tr><th>类型</th><th>模块/事件</th><th>平均</th><th>最大</th><th>总耗时</th><th>次数</th></tr></thead><tbody>` + rows.map((item) => `<tr><td>${item.kind}</td><td title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</td><td>${formatMs(item.avg)}</td><td>${formatMs(item.max)}</td><td>${formatMs(item.total)}</td><td>${item.count}</td></tr>`).join('') + '</tbody></table>'
    }


  function renderProbe() {
    const probe = state.reports.find((entry) => entry.kind === 'probe')
    if (!probe) {
      els.probeCauses.innerHTML = '<div class="empty-state small">导入 Yami 真机探针 JSON 后显示</div>'
      els.probeModules.innerHTML = '<div class="empty-state small">暂无模块/事件数据</div>'
      els.probeFrames.innerHTML = '<tr><td colspan="8">导入后显示</td></tr>'
      return
    }
    renderProbeModules(probe)

    if (probe.causes.length) {
      els.probeCauses.innerHTML = probe.causes.map((cause) => `
        <div class="finding bad">
          <span class="finding-source">${cause.kind}</span>
          <b>${escapeHtml(cause.name)}</b>
          <span>出现在 ${cause.count} 个超帧帧中，累计 ${formatMs(cause.totalMs)}，单帧最大 ${formatMs(cause.maxMs)}。</span>
        </div>`).join('')
    } else if (probe.metrics.overBudgetFrames) {
      els.probeCauses.innerHTML = `<div class="finding bad"><span class="finding-source">证据</span><b>无法点名具体元凶</b><span>存在 ${probe.metrics.overBudgetFrames} 个超预算帧，但帧内归因覆盖率只有 ${probe.metrics.attributionCoverage.toFixed(1)}%。请用新版探针重新采集。</span></div>`
    } else {
      els.probeCauses.innerHTML = '<div class="finding ok"><b>没有超预算帧</b><span>探针采集期间没有帧计算耗时超过 16.7ms。</span></div>'
    }
    els.probeFrames.innerHTML = probe.worstFrames.length ? probe.worstFrames.map((frame) => {
      const topUpdater = frame.updaters?.[0]?.name ? `${frame.updaters[0].name} ${formatMs(frame.updaters[0].ms)}` : '—'
      const topEvent = frame.events?.[0]?.name ? `${frame.events[0].name} ${formatMs(frame.events[0].ms)}` : '—'
      const compute = Number(frame.compute) || 0
      const attributed = (Number(frame.attributedUpdate) || 0) + (Number(frame.attributedRender) || 0)
      const coverage = compute ? Math.min(100, attributed / compute * 100) : 0
      return `<tr><td>${frame.frame}</td><td>${formatMs(frame.elapsedMs)}</td><td>${formatMs(frame.compute)}</td><td>${formatMs(frame.update)}</td><td>${formatMs(frame.render)}</td><td>${coverage.toFixed(1)}%</td><td title="${escapeHtml(topUpdater)}">${escapeHtml(topUpdater)}</td><td title="${escapeHtml(topEvent)}">${escapeHtml(topEvent)}</td></tr>`
    }).join('') : '<tr><td colspan="8">没有超过预算的帧</td></tr>'
  }

  function renderBaseline() {
    if (!state.baseline) {
      els.baselineInfo.textContent = '尚未保存分析基线'
      return
    }
    els.baselineInfo.textContent = `基线：${new Date(state.baseline.savedAt).toLocaleString()} · ${state.baseline.sources.join(' + ')}`
  }

  function saveBaseline() {
    state.baseline = { savedAt: Date.now(), sources: state.reports.map((report) => report.kind), summary: combinedSummary() }
    localStorage.setItem(BASELINE_KEY, JSON.stringify(state.baseline))
    toast('分析基线已保存', 'success')
    render()
  }

  function clearBaseline() {
    localStorage.removeItem(BASELINE_KEY)
    state.baseline = null
    toast('分析基线已清除')
    render()
  }

  function exportAnalysis() {
    const payload = { version: 1, createdAt: new Date().toISOString(), summary: combinedSummary(), reports: state.reports }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `yami-performance-analysis-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  function switchTab(tab) {
    state.activeTab = tab
    els.tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab))
    els.panels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== tab))
  }

  function bindDrop(zone, input, kind) {
    zone.addEventListener('click', () => input.click())
    zone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') input.click() })
    for (const eventName of ['dragenter', 'dragover']) zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add('dragging') })
    for (const eventName of ['dragleave', 'drop']) zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove('dragging') })
    zone.addEventListener('drop', (event) => importFiles(event.dataTransfer.files, kind))
    input.addEventListener('change', () => { importFiles(input.files, kind); input.value = '' })
  }

  els.copyProbe.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(PROBE_SCRIPT)
      toast('探针脚本已复制，粘贴到 Electron DevTools 控制台即可', 'success')
    } catch {
      els.probeScript.select()
      document.execCommand('copy')
      toast('探针脚本已复制（兼容模式）', 'success')
    }
  })

  function openHelp() { els.helpModal.classList.remove('hidden') }
  function closeHelp() { els.helpModal.classList.add('hidden') }
  els.helpButton.addEventListener('click', openHelp)
  els.helpClose.addEventListener('click', closeHelp)
  els.helpModal.addEventListener('click', (event) => { if (event.target.hasAttribute('data-help-close')) closeHelp() })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !els.helpModal.classList.contains('hidden')) closeHelp() })


  async function installExtensionDirectly() {
    if (!('showDirectoryPicker' in window)) {
      toast('当前浏览器环境不支持直接写入目录，请点击「下载 ZIP」解压到 extension 文件夹', 'error')
      document.getElementById('download-ext-zip')?.click()
      return
    }

    try {
      toast('请在弹出的系统窗口中选择「Open Yami RPG Editor」安装目录或其 extension 文件夹...', 'info')
      const dirHandle = await window.showDirectoryPicker({
        id: 'yami-editor-root',
        mode: 'readwrite',
        startIn: 'desktop'
      })

      let targetExtDir = dirHandle
      if (dirHandle.name !== 'extension') {
        targetExtDir = await dirHandle.getDirectoryHandle('extension', { create: true })
      }

      const pluginDir = await targetExtDir.getDirectoryHandle('yami-perf-extension', { create: true })
      const files = ['manifest.json', 'probe-core.js', 'hud-overlay.js']
      for (const file of files) {
        const res = await fetch(`./extension/${file}`)
        if (!res.ok) throw new Error(`无法获取 ${file}`)
        const content = await res.text()
        const fileHandle = await pluginDir.getFileHandle(file, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(content)
        await writable.close()
      }

      toast('🎉 性能探针扩展安装成功！重启 Open Yami 编辑器即可生效（试玩时按 Home 直通分析）。', 'success')
    } catch (err) {
      if (err.name === 'AbortError') return
      toast(`安装失败: ${err.message}，请使用「下载 ZIP」手动解压安装`, 'error')
    }
  }

  els.autoInstallExt?.addEventListener('click', installExtensionDirectly)

  bindDrop(els.traceDrop, els.traceInput, 'trace')
  bindDrop(els.spectorDrop, els.spectorInput, 'spector')
  bindDrop(els.probeDrop, els.probeInput, 'probe')
  els.tabs.forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)))
  els.clear.addEventListener('click', () => { state.reports = []; render() })
  els.saveBaseline.addEventListener('click', saveBaseline)
  els.clearBaseline.addEventListener('click', clearBaseline)
  els.exportReport.addEventListener('click', exportAnalysis)
  render()

  // ---------------- 实时监控大盘与流式渲染器 ----------------
  const liveHistory = [] // 存放最近 120 个点（约 24 秒）
  const liveJankHistory = []
  let lastStreamTick = 0
  const canvas = els.liveCanvas
  const ctx = canvas ? canvas.getContext('2d') : null

  function updateLiveUI(data) {
    lastStreamTick = Date.now()
    if (els.liveIndicator) {
      els.liveIndicator.classList.add('online')
      els.liveStatusText.textContent = `🟢 游戏实时在线 (${data.fps} FPS | ${data.compute}ms)`
    }
    if (els.liveValFps) els.liveValFps.textContent = `${data.fps} FPS`
    if (els.liveValCompute) els.liveValCompute.textContent = `${data.compute} ms`
    if (els.liveValActors) els.liveValActors.textContent = `${data.actors} 个`
    
    const topMod = (data.updaters && data.updaters[0]) ? `${data.updaters[0].name} (${data.updaters[0].ms}ms)` : '--'
    if (els.liveValTop) els.liveValTop.textContent = topMod

    // 记录波形历史
    liveHistory.push(data)
    if (liveHistory.length > 120) liveHistory.shift()

    // 渲染子系统条形图
    if (els.liveSubsystemsList && data.updaters && data.updaters.length) {
      const maxMs = Math.max(16.7, ...data.updaters.map(u => u.ms))
      els.liveSubsystemsList.innerHTML = data.updaters.map(u => {
        const pct = Math.min(100, Math.round((u.ms / maxMs) * 100))
        const isBad = u.ms > 10
        return `
          <div class="live-bar-item">
            <div class="live-bar-header">
              <span>${escapeHtml(u.name)}</span>
              <span style="font-family: monospace; font-weight: 600; color: ${isBad ? 'var(--red)' : 'var(--text)'};">${u.ms} ms</span>
            </div>
            <div class="live-bar-track">
              <div class="live-bar-fill" style="width: ${pct}%; background: ${isBad ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #4f46e5, #06b6d4)'};"></div>
            </div>
          </div>
        `
      }).join('')
    }

    drawLiveWaveform()
  }

  function drawLiveWaveform() {
    if (!ctx || !canvas || state.activeTab !== 'live') return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // 绘制背景网格
    ctx.strokeStyle = '#202635'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let y = 30; y < h; y += 40) {
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()

    // 绘制 16.7ms (60 FPS) 预算基准虚线
    const budgetY = h - (16.7 / 50) * (h - 30) - 20
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, budgetY)
    ctx.lineTo(w, budgetY)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = '#ef4444'
    ctx.font = '10px monospace'
    ctx.fillText('16.7ms 预算线', 8, budgetY - 4)

    if (liveHistory.length < 2) return

    const step = w / 120
    const startX = w - (liveHistory.length - 1) * step

    // 1. 绘制单帧计算耗时区域 (蓝色渐变)
    ctx.beginPath()
    ctx.moveTo(startX, h)
    for (let i = 0; i < liveHistory.length; i++) {
      const x = startX + i * step
      const ms = liveHistory[i].compute
      const y = Math.max(10, h - (ms / 50) * (h - 40) - 20)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(79, 70, 229, 0.45)')
    grad.addColorStop(1, 'rgba(79, 70, 229, 0.02)')
    ctx.fillStyle = grad
    ctx.fill()

    // 2. 绘制耗时折线
    ctx.beginPath()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#818cf8'
    for (let i = 0; i < liveHistory.length; i++) {
      const x = startX + i * step
      const ms = liveHistory[i].compute
      const y = Math.max(10, h - (ms / 50) * (h - 40) - 20)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // 3. 绘制 FPS 折线 (绿色)
    ctx.beginPath()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#10b981'
    for (let i = 0; i < liveHistory.length; i++) {
      const x = startX + i * step
      const fps = Math.min(60, liveHistory[i].fps || 60)
      const y = Math.max(10, h - (fps / 60) * (h - 40) - 10)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // 离线心跳检测 (2秒无数据则置为等待)
  setInterval(() => {
    if (lastStreamTick && Date.now() - lastStreamTick > 2500) {
      if (els.liveIndicator) {
        els.liveIndicator.classList.remove('online')
        els.liveStatusText.textContent = '⚪ 等待游戏在线...'
      }
    }
  }, 1000)

  // ---------------- 自动化桥接与广播监听 ----------------
  try {
    const channel = new BroadcastChannel('yami-perf-lab-channel')
    channel.addEventListener('message', (event) => {
      const msg = event.data
      if (!msg) return

      if (msg.type === 'PERF_STREAM_TICK' && msg.data) {
        updateLiveUI(msg.data)
      } else if (msg.type === 'PERF_STREAM_JANK' && msg.data) {
        const jank = msg.data
        liveJankHistory.unshift(jank)
        if (liveJankHistory.length > 20) liveJankHistory.pop()
        
        if (els.liveJankList) {
          els.liveJankList.innerHTML = liveJankHistory.map(j => `
            <div class="live-jank-item" title="点击展开此卡顿分析">
              <span>⚠️ 帧 #${j.frame} 掉帧 <b>${j.compute}ms</b> (${escapeHtml((j.updaters[0] && j.updaters[0].name) || 'Update')})</span>
              <span style="color: var(--muted);">${new Date(j.elapsedMs).toLocaleTimeString ? new Date().toLocaleTimeString() : ''}</span>
            </div>
          `).join('')
        }
      } else if (msg.type === 'PERF_REPORT_SYNC' && msg.data) {
        importRawData(msg.data, `自动同步探针 (${new Date().toLocaleTimeString()})`, true)
        toast('⚡ 已接收到游戏端最新性能快照！', 'success')
      }
    })
  } catch (e) {
    console.warn('BroadcastChannel 不受支持或被限制')
  }

  // ---------------- 5966 端口 SSE 跨域长连接直通 ----------------
  function connectLocalSSE() {
    try {
      const sse = new EventSource('http://127.0.0.1:5966/stream')
      sse.addEventListener('tick', (e) => {
        try {
          const data = JSON.parse(e.data)
          updateLiveUI(data)
        } catch (err) {}
      })
      sse.addEventListener('jank', (e) => {
        try {
          const jank = JSON.parse(e.data)
          liveJankHistory.unshift(jank)
          if (liveJankHistory.length > 20) liveJankHistory.pop()
          if (els.liveJankList) {
            els.liveJankList.innerHTML = liveJankHistory.map(j => `
              <div class="live-jank-item" title="点击查看详情">
                <span>⚠️ 帧 #${j.frame} 掉帧 <b>${j.compute}ms</b> (${escapeHtml((j.updaters[0] && j.updaters[0].name) || 'Update')})</span>
                <span style="color: var(--muted);">${new Date().toLocaleTimeString()}</span>
              </div>
            `).join('')
          }
        } catch (err) {}
      })
      sse.addEventListener('report', (e) => {
        try {
          const report = JSON.parse(e.data)
          importRawData(report, `实时同步探针 (${new Date().toLocaleTimeString()})`, true)
          toast('⚡ 已接收到游戏端最新性能快照！', 'success')
        } catch (err) {}
      })
      sse.onerror = () => {
        pollHttpFallback()
      }
    } catch (e) {
      pollHttpFallback()
    }
  }

  let isPolling = false
  async function pollHttpFallback() {
    if (isPolling) return
    isPolling = true
    try {
      const res = await fetch('http://127.0.0.1:5966/live')
      if (res.ok) {
        const data = await res.json()
        updateLiveUI(data)
      }
    } catch (e) {}
    isPolling = false
  }

  connectLocalSSE()
  setInterval(pollHttpFallback, 1000)

  // 启动时检查是否有最近未消费的同步数据
  try {
    const cached = localStorage.getItem('yami-perf-lab-latest-report')
    if (cached) {
      const data = JSON.parse(cached)
      if (data && Date.now() - new Date(data.generatedAt || 0).getTime() < 60000) {
        importRawData(data, '最近实时探针', true)
      }
    }
  } catch (e) {}
})()
