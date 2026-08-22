/* 性能测试台 · perf-lab v0.2.0
 * 运行时探针：由 sw.js 注入到游戏页面（在 index.html 全部脚本之后执行）。
 *
 * 测量口径（与工具页「16.7ms/帧预算」对应）：
 *   updateMs   = Game.update() 单帧逻辑更新耗时（含全部 updater 模块）
 *   renderMs   = Game.deferredRendering() 单帧渲染耗时（含全部 renderer 模块）
 *   computeMs  = updateMs + renderMs —— 即用户说的「每帧计算压力」
 *   loopMs     = Game.loop() 回调整体同步耗时（诊断参考）
 *   intervalMs = 相邻 requestAnimationFrame 的真实间隔（含垂直同步等待，诊断参考）
 *
 * 分模块/分事件统计：
 *   updaterStats  —— 每个更新器模块（Game.updaters）的耗时
 *   rendererStats —— 每个渲染器模块（Game.renderers）的耗时
 *   eventStats    —— 每个激活事件处理器（EventManager.activeEvents）的耗时（事件级定位）
 *
 * 压测 API（pressure）：按倍数克隆当前场景的本地角色（Scene.createActor），制造真实
 * 的场景更新/渲染压力；只影响测试沙箱里的这次运行，不写回工程。
 *
 * 判定标准由工具页执行：P95(computeMs) ≤ 预算阈值（默认 16.7ms）判 PASS。
 * 本探针只读包装，不改变游戏行为；只记录 start() 之后的数据。
 */
(() => {
  'use strict'
  if (window.__YAMI_PERF__) return

  const VERSION = '0.2.1'
  const MAX_SAMPLES = 12000 // 约 3.3 分钟 @60fps

  const perf = {
    running: false,
    startedAt: 0,
    samples: [],                 // { frame, interval, loop, update, render, compute, fps }
    updaterStats: new Map(),     // name -> { name, sum, count, max }
    rendererStats: new Map(),
    eventStats: new Map(),       // "事件类型 :: 文件名" -> { name, sum, count, max }
  }

  // 当前帧的累计耗时（由包装函数写入，tick 读取后清零）
  let frameUpdateMs = 0
  let frameRenderMs = 0
  let frameLoopMs = 0
  let lastTick = performance.now()

  const now = () => performance.now()

  function record(stats, name, ms) {
    let s = stats.get(name)
    if (!s) { s = { name, sum: 0, count: 0, max: 0 }; stats.set(name, s) }
    s.sum += ms
    s.count += 1
    if (ms > s.max) s.max = ms
  }

  /** 包装更新器/渲染器列表里的每个模块，只做耗时统计（不叠加进整帧合计，避免重复计算） */
  function wrapModules(list, method, stats) {
    try {
      const wrappedKey = `__yamiPerfWrapped_${method}__`
      for (const mod of Array.from(list || [])) {
        if (!mod || typeof mod[method] !== 'function' || mod[wrappedKey]) continue
        const name = (mod.constructor && mod.constructor.name) || 'anonymous'
        const orig = mod[method].bind(mod)
        Object.defineProperty(mod, wrappedKey, { value: true, configurable: true })
        mod[method] = function wrappedPerfModule(...args) {
          const t0 = now()
          let result
          try { result = orig(...args) } finally { record(stats, name, now() - t0) }
          return result
        }
      }
    } catch { /* 单模块包装失败不影响测试 */ }
  }

  /** 包装 EventManager 当前激活的事件处理器（事件级定位；周期刷新以捕获新事件） */
  function wrapEventHandlers() {
    try {
      if (typeof EventManager === 'undefined' || !Array.isArray(EventManager.activeEvents)) return
      for (const event of EventManager.activeEvents) {
        if (!event || typeof event.update !== 'function' || event.__yamiPerfEventWrapped__) continue
        let name = 'event'
        try {
          const file = String(event.path || event.initial?.path || event.commands?.path || '').split('/').pop() || 'unknown'
          const type = event.type || event.initial?.type || event.commands?.type || 'unknown'
          name = `${type} :: ${file}`
        } catch { /* 个别事件对象取不到标识就用默认名 */ }
        const orig = event.update.bind(event)
        Object.defineProperty(event, '__yamiPerfEventWrapped__', { value: true, configurable: true })
        event.update = function wrappedPerfEvent(...args) {
          const t0 = now()
          let result
          try { result = orig(...args) } finally { record(perf.eventStats, name, now() - t0) }
          return result
        }
      }
    } catch { /* 事件包装失败不影响测试 */ }
  }

  /** 包装 Game 的帧级方法（幂等）。注意：运行时是脚本顶层 let 单例，必须用裸标识符，不能走 window */
  function hookGame() {
    if (typeof Game === 'undefined' || typeof Game.update !== 'function' || Game.__yamiPerfHooked__) return
    const update = Game.update.bind(Game)
    Game.update = function perfUpdate(...args) {
      const t0 = now()
      try { return update(...args) } finally { frameUpdateMs += now() - t0 }
    }
    if (typeof Game.deferredRendering === 'function') {
      const render = Game.deferredRendering.bind(Game)
      Game.deferredRendering = function perfRender(...args) {
        const t0 = now()
        try { return render(...args) } finally { frameRenderMs += now() - t0 }
      }
    }
    if (typeof Game.loop === 'function') {
      const loop = Game.loop.bind(Game)
      Game.loop = function perfLoop(...args) {
        const t0 = now()
        try { return loop(...args) } finally { frameLoopMs = now() - t0 }
      }
    }
    Object.defineProperty(Game, '__yamiPerfHooked__', { value: true, configurable: true })
  }

  function install() {
    refreshWraps()
    if (typeof Game === 'undefined') {
      setTimeout(install, 200) // 理论上本脚本在 main.js 之后执行，这是防御分支
    }
  }

  /** 幂等刷新包装：Game.initialize 是异步的，updaters/renderers/事件处理器都可能动态增减 */
  function refreshWraps() {
    hookGame()
    if (typeof Game !== 'undefined') {
      wrapModules(Game.updaters, 'update', perf.updaterStats)
      wrapModules(Game.renderers, 'render', perf.rendererStats)
    }
    wrapEventHandlers()
  }

  let frameTicks = 0

  /* 独立 rAF：在 Game.loop 之后的同一帧里结算上一帧的测量值 */
  function tick() {
    requestAnimationFrame(tick)
    // 周期性补包新出现的 updater/renderer/事件（如启动后动态添加的模块），幂等
    if (++frameTicks % 60 === 0) refreshWraps()
    const t = now()
    const interval = t - lastTick
    lastTick = t
    if (!perf.running) {
      frameUpdateMs = 0
      frameRenderMs = 0
      frameLoopMs = 0
      return
    }
    perf.samples.push({
      frame: perf.samples.length + 1,
      interval,
      loop: frameLoopMs,
      update: frameUpdateMs,
      render: frameRenderMs,
      compute: frameUpdateMs + frameRenderMs,
      fps: typeof Time !== 'undefined' ? Time.fps : 0,
    })
    if (perf.samples.length > MAX_SAMPLES) perf.samples.shift()
    frameUpdateMs = 0
    frameRenderMs = 0
    frameLoopMs = 0
  }
  requestAnimationFrame(tick)

  /* ---------- 压测：克隆场景角色（真实压力，不影响工程） ---------- */
  function actorManager() {
    if (typeof Scene === 'undefined') return null
    return Scene.actor || Scene.actors || Scene.binding?.actor || Scene.binding?.actors || null
  }

  function actorList() {
    const manager = actorManager()
    return Array.from(manager?.list || manager || [])
  }

  function moduleCount(list) {
    try { return Array.from(list || []).length } catch { return Number(list?.length || list?.list?.length || 0) }
  }

  function createPressureActor(context, manager, source, node) {
    if (typeof context?.createActor === 'function') return context.createActor(node)
    if (!manager || typeof manager.append !== 'function' || typeof source?.constructor !== 'function') return null
    const actor = new source.constructor(node.data)
    actor.name = node.name
    actor.presetId = node.presetId
    actor.selfVarId = node.presetId
    actor.setTeam(node.teamId)
    actor.setPosition(node.x, node.y)
    actor.updateAngle(node.angle)
    if (node.scale !== 1) actor.setScale(node.scale)
    manager.append(actor)
    return actor
  }

  function pressure(level) {
    const out = { ok: false, level: level || 'none', original: 0, target: 0, cloned: 0, error: '' }
    if (!level || level === 'none') { out.ok = true; return out }
    try {
      if (typeof Scene === 'undefined') {
        out.error = 'Scene API 不可用'
        return out
      }
      const context = Scene.binding || (Scene.contexts && Scene.contexts[Scene.pointer]) || null
      const manager = actorManager()
      if (!context || !manager) {
        out.error = 'Scene API 不可用（当前场景角色管理器未就绪）'
        return out
      }
      const src = actorList()
      out.original = src.length
      if (!src.length) {
        out.error = '当前场景没有可克隆的角色'
        return out
      }
      const multiplier = level === 'x2' ? 2 : level === 'x5' ? 5 : level === 'x10' ? 10 : 0
      out.target = Math.max(out.original, Math.min(200, Math.round(src.length * multiplier)))
      const cloneTarget = Math.max(0, out.target - out.original)
      let guard = 0
      let index = 0
      while (out.cloned < cloneTarget && guard < 600) {
        const actor = src[index % src.length]
        index += 1
        guard += 1
        if (!actor || !actor.data) continue
        try {
          const node = {
            class: 'actor',
            type: 'local',
            name: (actor.name || '压测角色') + '·压测' + out.cloned,
            presetId: (actor.presetId || 'perf') + '_p' + out.cloned,
            data: actor.data,
            x: (actor.x || 0) + (out.cloned % 10) * 0.25,
            y: (actor.y || 0) + Math.floor(out.cloned / 10) * 0.25,
            teamId: actor.teamId || '',
            angle: 0,
            scale: 1,
          }
          if (createPressureActor(context, manager, actor, node)) out.cloned += 1
        } catch { /* 单个克隆失败继续 */ }
      }
      out.ok = cloneTarget === 0 || out.cloned > 0
      if (!out.ok) out.error = '克隆失败：没有角色被成功创建'
    } catch (e) {
      out.error = String((e && e.message) || e)
    }
    return out
  }

  /* ---------- 统计 ---------- */
  function quantile(sorted, q) {
    if (!sorted.length) return 0
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
    return sorted[index]
  }

  function aggregate(samples) {
    if (!samples.length) {
      return { count: 0, avg: 0, max: 0, p95: 0, p99: 0, min: 0, avgFrame: 0, p95Frame: 0, maxFrame: 0 }
    }
    const values = samples.map((s) => s.compute)
    const sorted = values.slice().sort((a, b) => a - b)
    const sum = values.reduce((a, b) => a + b, 0)
    const frameValues = samples.map((s) => s.interval)
    const frameSorted = frameValues.slice().sort((a, b) => a - b)
    const frameSum = frameValues.reduce((a, b) => a + b, 0)
    return {
      count: samples.length,
      avg: sum / samples.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      avgFrame: frameSum / samples.length,
      p95Frame: quantile(frameSorted, 0.95),
      maxFrame: frameSorted[frameSorted.length - 1],
    }
  }

  function topModules(stats, n) {
    return Array.from(stats.values())
      .sort((a, b) => b.sum - a.sum)
      .slice(0, n)
      .map((s) => ({
        name: s.name,
        avg: +(s.sum / s.count).toFixed(3),
        max: +s.max.toFixed(3),
        count: s.count,
        total: +s.sum.toFixed(2),
      }))
  }

  function sceneStats() {
    try {
      if (typeof Scene === 'undefined') return null
      const scene = Scene
      const count = (value) => Number(value?.count ?? value?.length ?? 0)
      const actors = actorList()
      const animations = Array.from(scene.animation?.list || scene.animations || scene.binding?.animations || [])
      const triggers = Array.from(scene.trigger?.list || scene.triggers || scene.binding?.triggers || [])
      return {
        sceneId: scene.binding?.id || scene.current?.id || null,
        actors: `${count(scene.visibleActors)}/${actors.length}`,
        animations: `${count(scene.visibleAnimations)}/${animations.length}`,
        triggers: `${count(scene.visibleTriggers)}/${triggers.length}`,
        particles: scene.particleCount || 0,
        uiElements: typeof UI !== 'undefined' && UI.manager ? UI.manager.list.length : 0,
        textures: typeof GL !== 'undefined' && GL.textureManager ? GL.textureManager.count : 0,
      }
    } catch {
      return null
    }
  }

  function snapshot(budget) {
    const agg = aggregate(perf.samples)
    const over = budget === undefined
      ? 0
      : perf.samples.filter((s) => s.compute > budget).length
    return {
      version: VERSION,
      running: perf.running,
      elapsedMs: perf.running ? now() - perf.startedAt : 0,
      samples: agg.count,
      fps: typeof Time !== 'undefined' ? Time.fps : 0,
      compute: {
        avg: +agg.avg.toFixed(3),
        min: +agg.min.toFixed(3),
        max: +agg.max.toFixed(3),
        p95: +agg.p95.toFixed(3),
        p99: +agg.p99.toFixed(3),
        overBudgetCount: over,
      },
      frame: {
        avg: +agg.avgFrame.toFixed(3),
        p95: +agg.p95Frame.toFixed(3),
        max: +agg.maxFrame.toFixed(3),
      },
      updaters: topModules(perf.updaterStats, 8),
      renderers: topModules(perf.rendererStats, 6),
      events: topModules(perf.eventStats, 10),
      scene: sceneStats(),
      compatibility: Array.isArray(window.__YAMI_PERF_COMPAT__) ? window.__YAMI_PERF_COMPAT__.slice() : [],
    }
  }

  window.__YAMI_PERF__ = {
    version: VERSION,
    /** 运行时就绪判断（顶层 let 单例无法从父页面 window 访问，必须由探针代查） */
    isReady() {
      return typeof Game !== 'undefined'
        && typeof Time !== 'undefined'
        && typeof Data !== 'undefined'
        && !!Data.manifest
        && moduleCount(Game.updaters) > 0
        && moduleCount(Game.renderers) > 0
    },
    /** 调试：查看关键运行时 API 在探针作用域里的可见性 */
    diag() {
        return {
          Game: typeof Game,
          GameUpdaters: typeof Game !== 'undefined' ? moduleCount(Game.updaters) : -1,
          GameRenderers: typeof Game !== 'undefined' ? moduleCount(Game.renderers) : -1,
          Time: typeof Time,
          Data: typeof Data,
          Scene: typeof Scene,
          SceneActor: typeof Scene !== 'undefined' && !!Scene.actor,
          SceneCtor: typeof Scene !== 'undefined' && Scene.constructor ? Scene.constructor.name : 'none',
          SceneProto: (() => { try { return typeof Scene !== 'undefined' ? Object.getOwnPropertyNames(Object.getPrototypeOf(Scene)).filter((n) => n.includes('create') || n.includes('actor')).slice(0, 12) : [] } catch (e) { return ['err:' + e.message] } })(),
          SceneOwn: (() => { try { return typeof Scene !== 'undefined' ? Object.getOwnPropertyNames(Scene).slice(0, 40) : [] } catch (e) { return ['err:' + e.message] } })(),
          SceneLoadType: (() => { try { return typeof Scene !== 'undefined' ? typeof Scene.load : 'no-scene' } catch (e) { return 'err:' + e.message } })(),
          SceneHasLoadOwn: (() => { try { return typeof Scene !== 'undefined' ? Object.prototype.hasOwnProperty.call(Scene, 'load') : 'no-scene' } catch (e) { return 'err:' + e.message } })(),
          SceneProtoCtor: (() => { try { const p = Object.getPrototypeOf(Scene); return p && p.constructor ? p.constructor.name : 'none' } catch (e) { return 'err:' + e.message } })(),
          SceneCreateActor: typeof Scene !== 'undefined' && typeof Scene.createActor,
          EventManager: typeof EventManager,
          activeEvents: typeof EventManager !== 'undefined' && EventManager.activeEvents ? EventManager.activeEvents.length : -1,
        }
      },
    /** 场景系统是否初始化完成（Scene.load 前置检查，避免 setObjectLists 竞态） */
    isSceneReady() {
      return typeof Scene !== 'undefined' && !!actorManager()
    },
    /** 切换到指定场景（GUID），返回 Promise */
    loadScene(guid) {
      if (typeof Scene === 'undefined' || typeof Scene.load !== 'function') {
        return Promise.reject(new Error('Scene.load 不可用'))
      }
      return Scene.load(String(guid))
    },
    /** 压测：按倍数克隆当前场景角色（同步返回结果） */
    pressure(level) {
      return pressure(level)
    },
    /** 开始采集（清空历史） */
    start() {
      refreshWraps()
      perf.samples.length = 0
      perf.updaterStats.clear()
      perf.rendererStats.clear()
      perf.eventStats.clear()
      frameUpdateMs = 0
      frameRenderMs = 0
      frameLoopMs = 0
      perf.running = true
      perf.startedAt = now()
      return snapshot()
    },
    /** 停止采集并返回最终统计 */
    stop() {
      perf.running = false
      return snapshot()
    },
    /** 实时统计（不停止） */
    snapshot(budget) {
      return snapshot(budget)
    },
    /** 导出全部帧样本（用于 JSON 报告） */
    samples() {
      return perf.samples
    },
  }

  install()
})()
