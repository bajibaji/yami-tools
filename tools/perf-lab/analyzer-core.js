/* DevTools Performance trace + Spector.js capture + Yami 真机逐帧探针 纯函数解析核心。 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.YamiPerfAnalyzer = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits))
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
  const percentile = (values, q) => {
    if (!values.length) return 0
    const sorted = values.slice().sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))]
  }

  function analyze(raw) {
    if (raw && (raw.kind === 'yami-probe' || (raw.budgetMs && Array.isArray(raw.overBudgetFrames) && raw.compute))) {
      return analyzeProbe(raw)
    }
    if (Array.isArray(raw) || Array.isArray(raw?.traceEvents)) return analyzeTrace(raw)
    const capture = raw?.capture || raw
    if (Array.isArray(capture?.commands) && capture?.context) return analyzeSpector(capture)
    throw new Error('无法识别报告格式；需要 DevTools trace、Spector.js capture 或 Yami 真机探针 JSON')
  }

  /* ============================ DevTools Performance trace ============================ */

  function analyzeTrace(raw) {
    const events = (Array.isArray(raw) ? raw : raw.traceEvents).filter((event) => event && Number.isFinite(event.ts))
    if (!events.length) throw new Error('traceEvents 为空')
    const minTs = events.reduce((min, event) => Math.min(min, event.ts), Infinity)
    const maxTs = events.reduce((max, event) => Math.max(max, event.ts + finite(event.dur)), 0)
    const metadata = new Map()
    for (const event of events) {
      if (event.ph === 'M' && event.name === 'thread_name') metadata.set(`${event.pid}:${event.tid}`, event.args?.name || event.args?.data?.name || '')
    }
    const threadScores = new Map()
    for (const event of events) {
      if (event.ph !== 'X') continue
      const key = `${event.pid}:${event.tid}`
      let score = threadScores.get(key) || 0
      if (/CrRendererMain|RendererMain|MainThread/i.test(metadata.get(key) || '')) score += 1000000
      if (/RunTask|ThreadControllerImpl::RunTask|Program|FunctionCall|EventDispatch/.test(event.name || '')) score += finite(event.dur)
      threadScores.set(key, score)
    }
    const mainKey = [...threadScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || `${events[0].pid}:${events[0].tid}`
    const [mainPid, mainTid] = mainKey.split(':').map(Number)
    const mainEvents = events.filter((event) => event.pid === mainPid && event.tid === mainTid)
    const taskEvents = mainEvents.filter((event) => event.ph === 'X' && /RunTask|ThreadControllerImpl::RunTask|Program/.test(event.name || ''))
    const tasks = taskEvents.map((event) => ({ name: event.name, startMs: (event.ts - minTs) / 1000, durationMs: finite(event.dur) / 1000 }))
    const longTasks = tasks.filter((task) => task.durationMs >= 50).sort((a, b) => b.durationMs - a.durationMs)
    const preferredFrameEvents = events.filter((event) => event.pid === mainPid && /^(BeginFrame|DrawFrame|FireAnimationFrame)$/.test(event.name || ''))
    const frameSource = preferredFrameEvents.length > 1
      ? preferredFrameEvents
      : events.filter((event) => /^(BeginFrame|DrawFrame|FireAnimationFrame)$/.test(event.name || ''))
    const frameMarkers = [...new Set(frameSource.map((event) => event.ts))].sort((a, b) => a - b)
    const frameIntervals = []
    for (let i = 1; i < frameMarkers.length; i++) {
      const interval = (frameMarkers[i] - frameMarkers[i - 1]) / 1000
      if (interval > 0 && interval < 1000) frameIntervals.push(interval)
    }
    const gcEvents = mainEvents.filter((event) => event.ph === 'X' && /(?:^|[._])(?:MajorGC|MinorGC|GC|V8.GC)|GarbageCollect/i.test(event.name || ''))
    const gcMs = gcEvents.reduce((sum, event) => sum + finite(event.dur) / 1000, 0)
    const hotspots = profileHotspots(events)
    const durationMs = (maxTs - minTs) / 1000
    const metrics = {
      durationMs: round(durationMs),
      eventCount: events.length,
      taskCount: tasks.length,
      longTaskCount: longTasks.length,
      maxTaskMs: round(tasks.reduce((max, task) => Math.max(max, task.durationMs), 0)),
      gcCount: gcEvents.length,
      gcMs: round(gcMs),
      frameCount: frameIntervals.length,
      frameP95Ms: frameIntervals.length ? round(percentile(frameIntervals, 0.95)) : null,
      frameMaxMs: frameIntervals.length ? round(frameIntervals.reduce((max, value) => Math.max(max, value), 0)) : null,
      overBudgetFrames: frameIntervals.filter((value) => value > 16.7).length,
    }
    const findings = []
    if (metrics.longTaskCount) findings.push({ level: 'bad', title: `${metrics.longTaskCount} 个主线程长任务`, detail: `最长 ${metrics.maxTaskMs}ms；优先检查 CPU 热点与对应游玩时刻。` })
    if (metrics.frameP95Ms > 16.7) findings.push({ level: 'bad', title: '帧间隔 P95 超过 16.7ms', detail: `P95 ${metrics.frameP95Ms}ms，超预算帧 ${metrics.overBudgetFrames} 个。` })
    if (durationMs && gcMs / durationMs > 0.05) findings.push({ level: 'warn', title: 'GC 占用偏高', detail: `GC 共 ${round(gcMs)}ms，占采集时间 ${round(gcMs / durationMs * 100, 1)}%。` })
    if (!hotspots.length) findings.push({ level: 'warn', title: '缺少 CPU Profile 样本', detail: '导出时需使用 DevTools Performance 录制，而不是仅保存 Performance Monitor 截图。' })
    return {
      kind: 'trace',
      metrics,
      findings,
      hotspots,
      longTasks,
      thread: { pid: mainPid, tid: mainTid, name: metadata.get(mainKey) || mainKey },
    }
  }

  function profileHotspots(events) {
    const nodes = new Map()
    const totals = new Map()
    const counts = new Map()
    for (const event of events) {
      if (event.name !== 'ProfileChunk') continue
      const data = event.args?.data || event.args || {}
      const profile = data.cpuProfile || {}
      for (const node of profile.nodes || []) nodes.set(node.id, node.callFrame || node)
      const samples = profile.samples || data.samples || []
      const deltas = data.timeDeltas || profile.timeDeltas || []
      for (let i = 0; i < samples.length; i++) {
        totals.set(samples[i], (totals.get(samples[i]) || 0) + finite(deltas[i]))
        counts.set(samples[i], (counts.get(samples[i]) || 0) + 1)
      }
    }
    return [...totals.entries()].map(([id, totalUs]) => {
      const frame = nodes.get(id) || {}
      const url = frame.url || ''
      const line = finite(frame.lineNumber, -1) + 1
      return {
        name: frame.functionName || '(anonymous)',
        url,
        location: url ? `${url.split('/').pop()}:${line}` : `node ${id}`,
        totalMs: round(totalUs / 1000),
        samples: counts.get(id) || 0,
      }
    }).sort((a, b) => b.totalMs - a.totalMs)
  }

  /* ============================ Spector.js capture ============================ */

  function analyzeSpector(capture) {
    const commands = capture.commands || []
    const commandMap = new Map()
    for (const command of commands) {
      const item = commandMap.get(command.name) || { name: command.name || 'unknown', count: 0, totalMs: 0 }
      item.count += 1
      item.totalMs += Math.max(0, finite(command.endTime) - finite(command.startTime))
      commandMap.set(item.name, item)
    }
    const commandStats = [...commandMap.values()].map((item) => ({ ...item, totalMs: round(item.totalMs) })).sort((a, b) => b.totalMs - a.totalMs)
    const drawCalls = commands.filter((command) => /^draw/i.test(command.name || '')).length
    const frameMemoryBytes = Object.values(capture.frameMemory || {}).reduce((sum, value) => sum + finite(value), 0)
    const redundant = countNamedArrays(commands, 'redundantCommandIds')
    const durationMs = Math.max(0, finite(capture.listenCommandsEndTime) - finite(capture.listenCommandsStartTime))
    const analyses = (capture.analyses || []).map((analysis) => ({ ...analysis }))
    const summary = analyses.find((analysis) => analysis.analyserName === 'CommandsSummary') || {}
    const metrics = {
      durationMs: round(durationMs),
      commandCount: commands.length,
      drawCalls: finite(summary.draw, drawCalls),
      clearCalls: finite(summary.clear),
      primitiveCount: finite(analyses.find((analysis) => analysis.analyserName === 'Primitives')?.total),
      redundantCommands: redundant,
      frameMemoryBytes,
    }
    const findings = []
    if (commands.length >= 10000) findings.push({ level: 'warn', title: 'Spector 捕获达到 10000 命令上限', detail: '报告可能被截断，请缩短捕获范围或只捕获目标帧。' })
    if (redundant) findings.push({ level: 'warn', title: `${redundant} 个冗余 WebGL 状态命令`, detail: '检查重复状态设置，减少无效 GL 调用。' })
    if (metrics.drawCalls > 1000) findings.push({ level: 'warn', title: '单帧 Draw Call 很高', detail: `${metrics.drawCalls} 次；优先检查批处理、图层和粒子。` })
    const capabilities = capture.context?.capabilities || {}
    return {
      kind: 'spector',
      metrics,
      findings,
      commands: commandStats,
      analyses,
      context: {
        Renderer: capabilities.RENDERER || '--',
        Vendor: capabilities.VENDOR || '--',
        WebGL: capabilities.VERSION || '--',
        Canvas: `${finite(capture.canvas?.width)} × ${finite(capture.canvas?.height)}`,
        Samples: capabilities.SAMPLES ?? '--',
        '最大纹理': capabilities.MAX_TEXTURE_SIZE ?? '--',
      },
    }
  }

  /* ============================ Yami 真机逐帧探针 ============================ */

  function analyzeProbe(raw) {
    const compute = raw.compute || {}
    const frame = raw.frame || {}
    const overBudgetFrames = Array.isArray(raw.overBudgetFrames) ? raw.overBudgetFrames : []
    const budgetMs = finite(raw.budgetMs, 16.7)
    const updaters = raw.updaters || []
    const renderers = raw.renderers || []
    const events = raw.events || []
    const metrics = {
      durationMs: round(raw.durationMs),
      frameCount: finite(raw.samples, 0),
      computeAvgMs: round(compute.avg),
      computeP95Ms: round(compute.p95),
      computeP99Ms: round(compute.p99),
      computeMaxMs: round(compute.max),
      frameP95Ms: round(frame.p95),
      frameMaxMs: round(frame.max),
      overBudgetFrames: finite(compute.overBudgetCount, overBudgetFrames.length),
      budgetMs,
    }
    const findings = []
    if (metrics.overBudgetFrames > 0) {
      findings.push({ level: 'bad', title: `${metrics.overBudgetFrames} 帧超过 ${budgetMs}ms 预算`, detail: `计算 P95 ${metrics.computeP95Ms}ms，最大 ${metrics.computeMaxMs}ms；查看「超帧定位」页找元凶。` })
    }
    if (metrics.computeP95Ms > budgetMs) {
      findings.push({ level: 'bad', title: '计算耗时 P95 超过帧预算', detail: `P95 ${metrics.computeP95Ms}ms > ${budgetMs}ms（60fps 预算）。` })
    }
    if (metrics.computeMaxMs > budgetMs * 2) {
      findings.push({ level: 'warn', title: '存在明显尖峰帧', detail: `最大计算耗时 ${metrics.computeMaxMs}ms，超过预算 ${budgetMs}ms 的 2 倍。` })
    }
    if (raw.hooked && !raw.hooked.game) {
      findings.push({ level: 'warn', title: '探针没有抓到游戏运行时', detail: 'hooked.game=false：探针是在不含 Game/Scene 的页面里运行的；请粘贴到 Electron 游戏窗口的 DevTools Console，确认 typeof Game 为 object。' })
    }
    const causes = aggregateOverBudgetCauses(overBudgetFrames)
    if (causes.length) {
      const top = causes[0]
      findings.push({ level: 'bad', title: `超帧元凶：${top.kind} ${top.name}`, detail: `在 ${top.count} 个超帧帧中出现，累计 ${top.totalMs}ms；优先检查该处。` })
    }
    return {
      kind: 'probe',
      metrics,
      findings,
      causes,
      worstFrames: [...overBudgetFrames].sort((a, b) => finite(b.compute) - finite(a.compute)).slice(0, 60),
      updaters,
      renderers,
      events,
      scene: raw.scene || null,
      budgetMs,
    }
  }

  function aggregateOverBudgetCauses(frames) {
    const map = new Map()
    for (const frame of frames) {
      for (const kind of ['updaters', 'renderers', 'events']) {
        for (const item of frame[kind] || []) {
          if (!item || !item.name) continue
          const key = `${kind}:${item.name}`
          const entry = map.get(key) || { kind: kind === 'updaters' ? '更新器' : kind === 'renderers' ? '渲染器' : '事件', name: item.name, count: 0, totalMs: 0, maxMs: 0 }
          entry.count += 1
          entry.totalMs += finite(item.ms)
          entry.maxMs = Math.max(entry.maxMs, finite(item.ms))
          map.set(key, entry)
        }
      }
    }
    return [...map.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 30)
  }

  function countNamedArrays(value, key) {
    let count = 0
    const seen = new Set()
    const walk = (node) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return
      seen.add(node)
      if (Array.isArray(node[key])) count += node[key].length
      for (const child of Object.values(node)) walk(child)
    }
    walk(value)
    return count
  }

  return { analyze, analyzeTrace, analyzeSpector, analyzeProbe, percentile }
})
