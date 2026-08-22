/* Electron 性能分析台 · perf-lab v0.3.0
 * 只分析现成工具导出的报告：Electron/Chrome DevTools Performance trace + Spector.js capture。
 * 不运行游戏、不注入自研采集器、不读写游戏工程。
 */
(() => {
  'use strict'

  const core = window.YamiPerfAnalyzer
  const BASELINE_KEY = 'yami-perf-analysis-baseline-v1'
  const state = { reports: [], activeTab: 'overview', baseline: loadBaseline() }
  const $ = (id) => document.getElementById(id)
  const els = {
    traceInput: $('trace-input'), spectorInput: $('spector-input'), traceDrop: $('trace-drop'), spectorDrop: $('spector-drop'),
    clear: $('clear-reports'), saveBaseline: $('save-baseline'), clearBaseline: $('clear-baseline'), exportReport: $('export-report'),
    sourceList: $('source-list'), status: $('status-text'), baselineInfo: $('baseline-info'),
    empty: $('empty-view'), dashboard: $('dashboard'), metrics: $('metrics-grid'), findings: $('findings'),
    hotspotBody: $('hotspot-body'), taskBody: $('task-body'), webglBody: $('webgl-body'), contextFacts: $('context-facts'),
    tabs: [...document.querySelectorAll('[data-tab]')], panels: [...document.querySelectorAll('[data-panel]')], toast: $('toast-region'),
  }

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
  function formatBytes(value) {
    if (!Number.isFinite(value)) return '--'
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${Math.round(value)} B`
  }

  async function importFiles(files, expectedKind) {
    const list = [...files]
    if (!list.length) return
    for (const file of list) {
      try {
        const raw = JSON.parse(await file.text())
        const analysis = core.analyze(raw)
        if (expectedKind && analysis.kind !== expectedKind) {
          throw new Error(expectedKind === 'trace' ? '这不是 DevTools Performance trace' : '这不是 Spector.js capture')
        }
        state.reports = state.reports.filter((entry) => entry.kind !== analysis.kind)
        state.reports.push({ ...analysis, fileName: file.name, importedAt: Date.now() })
        toast(`已分析 ${file.name}`, 'success')
      } catch (error) {
        toast(`${file.name}：${error.message}`, 'error')
      }
    }
    render()
  }

  function render() {
    const hasReports = state.reports.length > 0
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
    switchTab(state.activeTab)
  }

  function renderSources() {
    if (!state.reports.length) {
      els.sourceList.innerHTML = '<div class="empty-state small">尚未导入报告</div>'
      return
    }
    els.sourceList.innerHTML = state.reports.map((report) => `
      <div class="source-row">
        <span class="source-icon">${report.kind === 'trace' ? 'CPU' : 'GL'}</span>
        <span class="source-copy"><b>${escapeHtml(report.fileName)}</b><small>${report.kind === 'trace' ? 'DevTools Performance' : 'Spector.js WebGL'}</small></span>
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
    return {
      durationMs: trace?.metrics.durationMs,
      frameP95Ms: trace?.metrics.frameP95Ms,
      maxTaskMs: trace?.metrics.maxTaskMs,
      longTaskCount: trace?.metrics.longTaskCount,
      gcMs: trace?.metrics.gcMs,
      drawCalls: spector?.metrics.drawCalls,
      glCommands: spector?.metrics.commandCount,
      gpuMemory: spector?.metrics.frameMemoryBytes,
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
      ['采集时长', formatMs(summary.durationMs), deltaFor('durationMs', summary.durationMs)],
      ['帧间隔 P95', formatMs(summary.frameP95Ms), deltaFor('frameP95Ms', summary.frameP95Ms)],
      ['最长主线程任务', formatMs(summary.maxTaskMs), deltaFor('maxTaskMs', summary.maxTaskMs)],
      ['长任务数量', Number.isFinite(summary.longTaskCount) ? summary.longTaskCount : '--', deltaFor('longTaskCount', summary.longTaskCount)],
      ['GC 总耗时', formatMs(summary.gcMs), deltaFor('gcMs', summary.gcMs)],
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
    els.findings.innerHTML = findings.map((finding) => `<div class="finding ${finding.level}"><span class="finding-source">${finding.source === 'trace' ? 'CPU' : 'GL'}</span><b>${escapeHtml(finding.title)}</b><span>${escapeHtml(finding.detail)}</span></div>`).join('')
  }

  function renderCpu() {
    const trace = state.reports.find((report) => report.kind === 'trace')
    if (!trace) {
      els.hotspotBody.innerHTML = '<tr><td colspan="4">导入 DevTools Performance trace 后显示</td></tr>'
      els.taskBody.innerHTML = '<tr><td colspan="3">导入 DevTools Performance trace 后显示</td></tr>'
      return
    }
    els.hotspotBody.innerHTML = trace.hotspots.length ? trace.hotspots.slice(0, 30).map((item) => `<tr><td title="${escapeHtml(item.url)}">${escapeHtml(item.name)}</td><td>${formatMs(item.totalMs)}</td><td>${item.samples}</td><td>${escapeHtml(item.location)}</td></tr>`).join('') : '<tr><td colspan="4">该 trace 没有 CPU Profile 样本</td></tr>'
    els.taskBody.innerHTML = trace.longTasks.length ? trace.longTasks.slice(0, 30).map((item) => `<tr><td>${formatMs(item.startMs)}</td><td>${formatMs(item.durationMs)}</td><td>${escapeHtml(item.name)}</td></tr>`).join('') : '<tr><td colspan="3">没有超过 50ms 的主线程任务</td></tr>'
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

  bindDrop(els.traceDrop, els.traceInput, 'trace')
  bindDrop(els.spectorDrop, els.spectorInput, 'spector')
  els.tabs.forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)))
  els.clear.addEventListener('click', () => { state.reports = []; render() })
  els.saveBaseline.addEventListener('click', saveBaseline)
  els.clearBaseline.addEventListener('click', clearBaseline)
  els.exportReport.addEventListener('click', exportAnalysis)
  render()
})()
