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
    const metadata = new Map()
    const processNames = new Map()
    for (const event of events) {
      if (event.ph === 'M' && event.name === 'thread_name') metadata.set(`${event.pid}:${event.tid}`, event.args?.name || event.args?.data?.name || '')
      if (event.ph === 'M' && event.name === 'process_name') processNames.set(event.pid, event.args?.name || event.args?.data?.name || '')
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
    const timedMainEvents = mainEvents.filter((event) => event.ts > 0 && event.ph !== 'M')
    const minTs = timedMainEvents.reduce((min, event) => Math.min(min, event.ts), Infinity)
    const maxTs = timedMainEvents.reduce((max, event) => Math.max(max, event.ts + finite(event.dur)), 0)
    const taskEvents = mainEvents.filter((event) => event.ph === 'X' && /RunTask|ThreadControllerImpl::RunTask|Program/.test(event.name || ''))
    const tasks = taskEvents.map((event) => {
      const durationMs = finite(event.dur) / 1000
      const evidence = durationMs >= 50 ? taskEvidence(event, mainEvents, minTs) : { tooling: false, cause: '', evidence: [] }
      return { ...evidence, name: event.name, startMs: (event.ts - minTs) / 1000, durationMs }
    })
    const toolingTasks = tasks.filter((task) => task.durationMs >= 50 && task.tooling)
    const longTasks = tasks.filter((task) => task.durationMs >= 50 && !task.tooling).sort((a, b) => b.durationMs - a.durationMs)
    const frameStream = selectFrameStream(events, mainPid, mainTid)
    const frameMarkers = frameStream.events.map((event) => event.ts).sort((a, b) => a - b)
    const frameIntervals = []
    for (let i = 1; i < frameMarkers.length; i++) {
      const interval = (frameMarkers[i] - frameMarkers[i - 1]) / 1000
      if (interval > 0 && interval < 1000) frameIntervals.push(interval)
    }
    const gcEvents = mainEvents.filter((event) => event.ph === 'X' && /^(?:MajorGC|MinorGC|GarbageCollect)$/.test(event.name || ''))
    const gcMs = gcEvents.reduce((sum, event) => sum + finite(event.dur) / 1000, 0)
    const profile = profileHotspots(events, mainPid, processNames)
    const hotspots = profile.hotspots
    const durationMs = (maxTs - minTs) / 1000
    const metrics = {
      durationMs: round(durationMs),
      eventCount: events.length,
      taskCount: tasks.length,
      longTaskCount: longTasks.length,
      maxTaskMs: round(tasks.reduce((max, task) => Math.max(max, task.durationMs), 0)),
      maxActionableTaskMs: round(longTasks.reduce((max, task) => Math.max(max, task.durationMs), 0)),
      gcCount: gcEvents.length,
      gcMs: round(gcMs),
      frameCount: frameIntervals.length,
      frameP95Ms: frameIntervals.length ? round(percentile(frameIntervals, 0.95)) : null,
      frameMaxMs: frameIntervals.length ? round(frameIntervals.reduce((max, value) => Math.max(max, value), 0)) : null,
      overBudgetFrames: frameIntervals.filter((value) => value > 16.7).length,
      frameStream: frameStream.name,
      effectiveFps: frameIntervals.length ? round(1000 / percentile(frameIntervals, 0.5), 1) : null,
    }
    const findings = []
    if (toolingTasks.length) findings.push({ level: 'warn', title: '已排除 DevTools 录制启动开销', detail: `${toolingTasks.length} 个长任务来自 CpuProfiler::StartProfiling，最长 ${round(toolingTasks.reduce((max, task) => Math.max(max, task.durationMs), 0))}ms，不是游戏瓶颈。` })
    if (metrics.longTaskCount) findings.push({ level: 'bad', title: `${metrics.longTaskCount} 个可归因主线程长任务`, detail: `最长 ${metrics.maxActionableTaskMs}ms；${longTasks[0]?.cause ? `主要活动：${longTasks[0].cause}。` : '查看长任务证据。'}` })
    if (metrics.frameP95Ms > 16.7) findings.push({ level: 'bad', title: '帧间隔 P95 超过 16.7ms', detail: `P95 ${metrics.frameP95Ms}ms，超预算帧 ${metrics.overBudgetFrames} 个。` })
    if (durationMs && gcMs / durationMs > 0.05) findings.push({ level: 'warn', title: 'GC 占用偏高', detail: `GC 共 ${round(gcMs)}ms，占采集时间 ${round(gcMs / durationMs * 100, 1)}%。` })
    if (profile.probePollutionMs > 1) findings.push({ level: 'bad', title: 'CPU Profile 被真机探针污染', detail: `探针 tick/hookGame 等函数占 ${round(profile.probePollutionMs)}ms。录制 DevTools Performance 时不要同时运行真机探针，否则热点结论失真。` })
    if (!hotspots.length) findings.push({ level: 'warn', title: 'CPU Profile 没有可操作的游戏函数', detail: profile.samples ? '采样主要落在 idle/program/探针自身，无法映射到游戏源码；请关闭探针后单独重录 DevTools。' : '导出时需使用 DevTools Performance 录制，而不是仅保存 Performance Monitor 截图。' })
    return {
      kind: 'trace',
      metrics,
      findings,
      hotspots,
      longTasks,
      toolingTasks,
      profile: profile.summary,
      thread: { pid: mainPid, tid: mainTid, name: metadata.get(mainKey) || mainKey },
    }
  }

  function selectFrameStream(events, mainPid, mainTid) {
    const groups = new Map()
    for (const event of events) {
      if (!/^(?:BeginFrame|DrawFrame|FireAnimationFrame)$/.test(event.name || '')) continue
      const key = `${event.name}:${event.pid}:${event.tid}`
      const group = groups.get(key) || { name: event.name, pid: event.pid, tid: event.tid, events: [] }
      group.events.push(event)
      groups.set(key, group)
    }
    const priority = (group) => {
      let score = group.events.length
      if (group.pid === mainPid && group.tid === mainTid) score += 1000000
      if (group.pid === mainPid) score += 100000
      if (group.name === 'FireAnimationFrame') score += 10000
      return score
    }
    return [...groups.values()].sort((a, b) => priority(b) - priority(a))[0] || { name: '', events: [] }
  }

  function taskEvidence(task, mainEvents, minTs) {
    const end = task.ts + finite(task.dur)
    const children = mainEvents.filter((event) => event !== task && event.ph === 'X' && event.ts >= task.ts && event.ts + finite(event.dur) <= end)
    const profiler = children.find((event) => event.name === 'CpuProfiler::StartProfiling' && finite(event.dur) >= finite(task.dur) * 0.7)
    const functionCall = children.filter((event) => /^(?:FunctionCall|EvaluateScript|TimerFire|EventDispatch)$/.test(event.name || '')).sort((a, b) => finite(b.dur) - finite(a.dur))[0]
    const data = functionCall?.args?.data || {}
    return {
      tooling: Boolean(profiler),
      cause: profiler ? 'DevTools CPU Profiler 启动' : data.functionName || data.url || functionCall?.name || '',
      evidence: children.slice().sort((a, b) => finite(b.dur) - finite(a.dur)).slice(0, 5).map((event) => ({ name: event.name, durationMs: round(finite(event.dur) / 1000), startMs: round((event.ts - minTs) / 1000), functionName: event.args?.data?.functionName || '', url: event.args?.data?.url || '' })),
    }
  }

  function profileHotspots(events, rendererPid, processNames) {
    const profiles = new Map()
    for (const event of events) {
      if (event.name !== 'ProfileChunk') continue
      const profileId = event.id ?? event.args?.data?.id ?? ''
      const key = `${event.pid}:${event.tid}:${profileId}`
      const bucket = profiles.get(key) || { key, pid: event.pid, tid: event.tid, nodes: new Map(), totals: new Map(), counts: new Map(), samples: 0, totalUs: 0 }
      const data = event.args?.data || event.args || {}
      const profile = data.cpuProfile || {}
      for (const node of profile.nodes || []) bucket.nodes.set(node.id, node.callFrame || node)
      const samples = profile.samples || data.samples || []
      const deltas = data.timeDeltas || profile.timeDeltas || []
      for (let i = 0; i < samples.length; i++) {
        const delta = finite(deltas[i])
        bucket.totals.set(samples[i], (bucket.totals.get(samples[i]) || 0) + delta)
        bucket.counts.set(samples[i], (bucket.counts.get(samples[i]) || 0) + 1)
        bucket.samples += 1
        bucket.totalUs += delta
      }
      profiles.set(key, bucket)
    }
    const candidates = [...profiles.values()].filter((profile) => profile.pid === rendererPid)
    const selected = candidates.sort((a, b) => b.totalUs - a.totalUs)[0] || [...profiles.values()].sort((a, b) => b.totalUs - a.totalUs)[0]
    if (!selected) return { hotspots: [], samples: 0, probePollutionMs: 0, summary: null }
    const probeNames = new Set(['tick', 'hookGame', 'refresh', 'moduleName', 'wrapModules', 'wrapEventHandlers', 'custom_gc', 'now', 'requestAnimationFrame'])
    let idleUs = 0
    let gcUs = 0
    let probeUs = 0
    const rows = [...selected.totals.entries()].map(([id, totalUs]) => {
      const frame = selected.nodes.get(id) || {}
      const url = frame.url || ''
      const line = finite(frame.lineNumber, -1) + 1
      const name = frame.functionName || '(anonymous)'
      if (name === '(idle)') idleUs += totalUs
      if (name === '(garbage collector)') gcUs += totalUs
      if (probeNames.has(name)) probeUs += totalUs
      return {
        name,
        url,
        location: url ? `${url.split('/').pop()}:${line}` : `node ${id}`,
        totalMs: round(totalUs / 1000),
        samples: selected.counts.get(id) || 0,
      }
    })
    const hotspots = rows.filter((row) => !/^\((?:idle|program|garbage collector)\)$/.test(row.name) && !probeNames.has(row.name)).sort((a, b) => b.totalMs - a.totalMs)
    return {
      hotspots,
      samples: selected.samples,
      probePollutionMs: probeUs / 1000,
      summary: { pid: selected.pid, tid: selected.tid, process: processNames.get(selected.pid) || '', samples: selected.samples, sampledMs: round(selected.totalUs / 1000), idleMs: round(idleUs / 1000), gcMs: round(gcUs / 1000), probeMs: round(probeUs / 1000) },
    }
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
    const oldDurationSeconds = finite(raw.version, 1) < 2
    const durationMs = oldDurationSeconds ? finite(raw.durationMs) * 1000 : finite(raw.durationMs)
    const attribution = attributionSummary(overBudgetFrames)
    const clusters = clusterOverBudgetFrames(overBudgetFrames)
    const metrics = {
      durationMs: round(durationMs),
      frameCount: finite(raw.samples, 0),
      computeAvgMs: round(compute.avg),
      computeP95Ms: round(compute.p95),
      computeP99Ms: round(compute.p99),
      computeMaxMs: round(compute.max),
      frameP95Ms: round(frame.p95),
      frameMaxMs: round(frame.max),
      overBudgetFrames: finite(compute.overBudgetCount, overBudgetFrames.length),
      budgetMs,
      attributionCoverage: round(attribution.coverage * 100, 1),
      longestSlowCluster: clusters[0]?.count || 0,
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
    if (!metrics.frameCount) {
      findings.push({ level: 'warn', title: '探针没有采集到帧样本', detail: 'samples=0。请在 Electron 游戏窗口的 DevTools Console 运行探针，游玩一段时间后再执行 download()/copy()。' })
    }
    const causes = attribution.coverage >= 0.3 ? aggregateOverBudgetCauses(overBudgetFrames) : []
    if (causes.length && causes[0].maxMs >= budgetMs * 0.25) {
      const top = causes[0]
      findings.push({ level: 'bad', title: `高置信超帧元凶：${top.kind} ${top.name}`, detail: `在 ${top.count} 个超帧帧中出现，单帧最高 ${round(top.maxMs)}ms，累计 ${round(top.totalMs)}ms。` })
    } else if (metrics.overBudgetFrames && attribution.coverage < 0.3) {
      findings.push({ level: 'bad', title: '旧探针未记录到卡顿帧内部证据', detail: `最差帧仅解释 ${metrics.attributionCoverage}% 的计算耗时，不能点名具体元凶。全局统计显示：${globalProbeEvidence(updaters, renderers, events, metrics)}。请用页面里的新版探针重新采集。` })
    }
    if (clusters[0]?.count >= 10) {
      findings.push({ level: 'bad', title: `持续性卡顿：连续 ${clusters[0].count} 个超预算样本`, detail: `帧 ${clusters[0].start}–${clusters[0].end}，峰值 ${round(clusters[0].maxMs)}ms；这不是单次 GC 尖峰，更像持续更新负载或同步阻塞。` })
    }
    const visibleActors = parseInt(String(raw.scene?.actors || '').split('/')[0], 10) || 0
    const topUpdater = updaters.slice().sort((a, b) => finite(b.max) - finite(a.max))[0]
    const topRenderer = renderers.slice().sort((a, b) => finite(b.max) - finite(a.max))[0]
    if (attribution.coverage < 0.3 && visibleActors >= 80 && finite(topUpdater?.max) >= metrics.computeMaxMs * 0.7 && finite(topRenderer?.max) < metrics.computeMaxMs * 0.2) {
      findings.push({ level: 'warn', title: '优先复测 Scene 角色更新链', detail: `卡顿现场有 ${visibleActors} 个可见角色，且尖峰在 update（${finite(topUpdater?.max)}ms）而非 render（${finite(topRenderer?.max)}ms）。这是中置信假设：先用同场景减少角色数量做 A/B，若耗时随角色数明显下降，再查角色更新、碰撞和寻路。` })
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
      clusters,
      attribution,
      timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
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
    return [...map.values()].filter((entry) => entry.totalMs >= 0.05).sort((a, b) => b.totalMs - a.totalMs).slice(0, 30)
  }

  function attributionSummary(frames) {
    let compute = 0
    let attributed = 0
    for (const frame of frames) {
      const frameCompute = finite(frame.compute)
      compute += frameCompute
      if (Number.isFinite(Number(frame.attributedUpdate)) || Number.isFinite(Number(frame.attributedRender))) {
        attributed += finite(frame.attributedUpdate) + finite(frame.attributedRender)
      } else {
        attributed += [...(frame.updaters || []), ...(frame.renderers || [])].reduce((sum, item) => sum + finite(item.ms), 0)
      }
    }
    return { computeMs: round(compute), attributedMs: round(attributed), unattributedMs: round(Math.max(0, compute - attributed)), coverage: compute ? Math.min(1, attributed / compute) : 0 }
  }

  function clusterOverBudgetFrames(frames) {
    const sorted = frames.slice().sort((a, b) => finite(a.frame) - finite(b.frame))
    const clusters = []
    let current = null
    for (const frame of sorted) {
      const number = finite(frame.frame)
      if (!current || number > current.end + 2) {
        current = { start: number, end: number, count: 1, maxMs: finite(frame.compute), totalMs: finite(frame.compute) }
        clusters.push(current)
      } else {
        current.end = number
        current.count += 1
        current.maxMs = Math.max(current.maxMs, finite(frame.compute))
        current.totalMs += finite(frame.compute)
      }
    }
    return clusters.sort((a, b) => b.count - a.count || b.maxMs - a.maxMs)
  }

  function globalProbeEvidence(updaters, renderers, events, metrics) {
    const topUpdater = updaters.slice().sort((a, b) => finite(b.max) - finite(a.max))[0]
    const topRenderer = renderers.slice().sort((a, b) => finite(b.max) - finite(a.max))[0]
    if (topUpdater && finite(topUpdater.max) >= metrics.computeMaxMs * 0.7 && (!topRenderer || finite(topRenderer.max) < metrics.computeMaxMs * 0.2)) {
      return `瓶颈在更新阶段，${topUpdater.name} 单次最高 ${finite(topUpdater.max)}ms；渲染器最高仅 ${finite(topRenderer?.max)}ms`
    }
    return '现有模块明细不足以解释整帧耗时'
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

  return { analyze, analyzeTrace, analyzeSpector, analyzeProbe, percentile, clusterOverBudgetFrames, attributionSummary }
})
