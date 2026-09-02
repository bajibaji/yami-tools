(() => {
  'use strict';
  if (window.__YAMI_PERF_PROBE__) return;

  const PROBE_VERSION = 2;
  const BUDGET = 16.7;
  const MAX_SAMPLES = 12000;
  const BRIDGE_PORT = 5966;
  
  const state = {
    running: true,
    startedAt: Date.now(),
    startedPerf: performance.now(),
    frameSeq: 0,
    hooked: { game: false, updaters: 0, renderers: 0, events: 0 },
    samples: [],
    overBudgetFrames: [],
    updaterTotal: new Map(),
    rendererTotal: new Map(),
    eventTotal: new Map(),
    lastJankTime: 0,
    lastJankEvent: null
  };

  let frameUpdate = 0;
  let frameRender = 0;
  let frameUpdaterMs = new Map();
  let frameRendererMs = new Map();
  let frameEventMs = new Map();

  let recentUpdaterSnap = [];
  let recentEventSnap = [];

  const now = () => performance.now();
  const finite = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : (f || 0));
  const round2 = (v) => Math.round(finite(v, 0) * 100) / 100;
  const round3 = (v) => Math.round(finite(v, 0) * 1000) / 1000;

  function rec(map, name, ms) {
    const s = map.get(name) || { name: name, sum: 0, count: 0, max: 0 };
    s.sum += ms;
    s.count += 1;
    if (ms > s.max) s.max = ms;
    map.set(name, s);
  }

  function addFrame(map, name, ms) {
    map.set(name, (map.get(name) || 0) + ms);
  }

  function moduleName(mod, list, index, kind) {
    const known = [];
    try { if (typeof Callback !== 'undefined') known.push(['Callback', Callback]); } catch (e) {}
    try { if (typeof Loader !== 'undefined') known.push(['Loader', Loader]); } catch (e) {}
    try { if (typeof File !== 'undefined') known.push(['File', File]); } catch (e) {}
    try { if (typeof Input !== 'undefined') known.push(['Input', Input]); } catch (e) {}
    try { if (typeof Timer !== 'undefined') known.push(['Timer', Timer]); } catch (e) {}
    try { if (typeof Scene !== 'undefined') known.push(['Scene', Scene]); } catch (e) {}
    try { if (typeof Camera !== 'undefined') known.push(['Camera', Camera]); } catch (e) {}
    try { if (typeof EventManager !== 'undefined') known.push(['EventManager', EventManager]); } catch (e) {}
    try { if (typeof Trigger !== 'undefined') known.push(['Trigger', Trigger]); } catch (e) {}
    try { if (typeof UI !== 'undefined') known.push(['UI', UI]); } catch (e) {}
    try { if (typeof AudioManager !== 'undefined') known.push(['AudioManager', AudioManager]); } catch (e) {}
    try { if (typeof CacheList !== 'undefined') known.push(['CacheList', CacheList]); } catch (e) {}
    try { if (typeof OffscreenStart !== 'undefined') known.push(['OffscreenStart', OffscreenStart]); } catch (e) {}
    try { if (typeof OffscreenEnd !== 'undefined') known.push(['OffscreenEnd', OffscreenEnd]); } catch (e) {}

    for (const entry of known) {
      if (entry[1] === mod) return entry[0] + (entry[0] === 'Callback' ? '#' + index : '');
    }
    try {
      for (const key of Object.keys(list.moduleMap || {})) {
        if (list.moduleMap[key] === mod) return key;
      }
    } catch (e) {}
    const ctor = mod && mod.constructor && mod.constructor.name;
    return ctor && ctor !== 'Object' && ctor !== 'Function' ? ctor : kind + '#' + index;
  }

  function wrapModules(list, method, totalMap, kind) {
    try {
      Array.from(list || []).forEach(function (mod, index) {
        const mark = '__yamiPerfProbeWrapped_' + method + '__';
        if (!mod || typeof mod[method] !== 'function' || mod[mark]) return;
        const name = moduleName(mod, list, index, kind);
        const orig = mod[method].bind(mod);
        Object.defineProperty(mod, mark, { value: true, configurable: true });
        mod[method] = function () {
          const t0 = now();
          let r;
          try {
            r = orig.apply(this, arguments);
          } finally {
            const ms = now() - t0;
            rec(totalMap, name, ms);
            addFrame(method === 'render' ? frameRendererMs : frameUpdaterMs, name, ms);
          }
          return r;
        };
      });
    } catch (e) {}
  }

  function wrapEventHandlers() {
    try {
      const list = typeof EventManager !== 'undefined' && EventManager.activeEvents ? EventManager.activeEvents : [];
      for (const event of Array.from(list)) {
        if (!event || typeof event.update !== 'function' || event.__yamiPerfProbeEventWrapped__) continue;
        let name = 'event';
        try {
          const initial = event.initial || event.commands || {};
          const eventType = event.type || initial.type || '';
          const eventPath = event.path || initial.path || '';
          const file = String(eventPath || '').split('/').pop() || '';
          const parentName = event.parent && event.parent.constructor && event.parent.constructor.name ? '(' + event.parent.constructor.name + ')' : '';
          name = (eventType || 'event') + ' :: ' + (file || parentName || 'unknown');
        } catch (e) {}
        const orig = event.update.bind(event);
        Object.defineProperty(event, '__yamiPerfProbeEventWrapped__', { value: true, configurable: true });
        event.update = function () {
          const t0 = now();
          let r;
          try {
            r = orig.apply(this, arguments);
          } finally {
            const ms = now() - t0;
            rec(state.eventTotal, name, ms);
            addFrame(frameEventMs, name, ms);
          }
          return r;
        };
      }
    } catch (e) {}
  }

  function hookGame() {
    const G = typeof Game !== 'undefined' ? Game : null;
    if (!G || typeof G.update !== 'function' || G.__yamiPerfProbeHooked__) return;
    state.hooked.game = true;
    const u = G.update.bind(G);
    G.update = function () {
      const t0 = now();
      try {
        return u.apply(this, arguments);
      } finally {
        frameUpdate += now() - t0;
      }
    };
    if (typeof G.deferredRendering === 'function') {
      const r = G.deferredRendering.bind(G);
      G.deferredRendering = function () {
        const t0 = now();
        try {
          return r.apply(this, arguments);
        } finally {
          frameRender += now() - t0;
        }
      };
    }
    Object.defineProperty(G, '__yamiPerfProbeHooked__', { value: true, configurable: true });
  }

  function refresh() {
    hookGame();
    if (typeof Game !== 'undefined') {
      wrapModules(Game.updaters, 'update', state.updaterTotal, 'Updater');
      wrapModules(Game.renderers, 'render', state.rendererTotal, 'Renderer');
      state.hooked.updaters = (Game.updaters && Game.updaters.length) || 0;
      state.hooked.renderers = (Game.renderers && Game.renderers.length) || 0;
    }
    wrapEventHandlers();
    if (typeof EventManager !== 'undefined' && EventManager.activeEvents) {
      state.hooked.events = EventManager.activeEvents.length;
    }
  }

  let lastTick = now();
  function tick() {
    requestAnimationFrame(tick);
    const t = now();
    const interval = t - lastTick;
    lastTick = t;
    if (!state.running) return;
    
    if (state.frameSeq % 60 === 0) refresh();

    const compute = frameUpdate + frameRender;
    state.frameSeq += 1;
    const currentFps = (typeof Time !== 'undefined' && Time.fps) || Math.round(1000 / (interval || 16.6));
    const currentSample = {
      frame: state.frameSeq,
      elapsedMs: round2(t - state.startedPerf),
      interval: interval,
      update: frameUpdate,
      render: frameRender,
      compute: compute,
      fps: currentFps
    };
    state.samples.push(currentSample);
    if (state.samples.length > MAX_SAMPLES) state.samples.shift();

    const top = function(map) {
      return Array.from(map.entries())
        .map(function (e) { return { name: e[0], ms: round3(e[1]) }; })
        .sort(function (a, b) { return b.ms - a.ms; })
        .slice(0, 5);
    };

    recentUpdaterSnap = top(frameUpdaterMs);
    recentEventSnap = top(frameEventMs);

    if (compute > BUDGET) {
      const updaterItems = recentUpdaterSnap;
      const rendererItems = top(frameRendererMs);
      const eventItems = recentEventSnap;
      const attributedUpdate = Array.from(frameUpdaterMs.values()).reduce(function (a, b) { return a + b; }, 0);
      const attributedRender = Array.from(frameRendererMs.values()).reduce(function (a, b) { return a + b; }, 0);

      const jankRecord = {
        frame: state.frameSeq,
        elapsedMs: round2(t - state.startedPerf),
        compute: round2(compute),
        update: round2(frameUpdate),
        render: round2(frameRender),
        attributedUpdate: round2(attributedUpdate),
        attributedRender: round2(attributedRender),
        unattributed: round2(Math.max(0, compute - attributedUpdate - attributedRender)),
        updaters: updaterItems,
        renderers: rendererItems,
        events: eventItems
      };
      state.overBudgetFrames.push(jankRecord);

      if (compute > 33.3 && t - state.lastJankTime > 800) {
        state.lastJankTime = t;
        const mainCulprit = (updaterItems[0] && updaterItems[0].name) || (eventItems[0] && eventItems[0].name) || 'Game Update';
        state.lastJankEvent = {
          time: t,
          compute: round2(compute),
          culprit: mainCulprit
        };
        window.dispatchEvent(new CustomEvent('yami-perf-jank', { detail: state.lastJankEvent }));
        
        broadcastSSE('jank', jankRecord);
        if (channel) channel.postMessage({ type: 'PERF_STREAM_JANK', data: jankRecord });
      }
    }

    frameUpdate = 0;
    frameRender = 0;
    frameUpdaterMs = new Map();
    frameRendererMs = new Map();
    frameEventMs = new Map();
  }

  const probeInterval = setInterval(function() {
    refresh();
    if (state.hooked.game) {
      clearInterval(probeInterval);
      requestAnimationFrame(tick);
      console.log('⚡ [Yami Perf-Lab Auto Bridge] 探针已成功自动注入并开始监控！');
    }
  }, 100);

  function percentile(arr, q) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort(function(a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
  }

  function formatList(map) {
    return Array.from(map.values()).map(function (item) {
      return {
        name: item.name,
        count: item.count,
        total: round2(item.sum),
        avg: round3(item.count ? item.sum / item.count : 0),
        max: round2(item.max)
      };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  function buildReport() {
    const computeList = state.samples.map(function (s) { return s.compute; });
    const intervalList = state.samples.map(function (s) { return s.interval; });
    const computeSum = computeList.reduce(function (a, b) { return a + b; }, 0);
    const computeAvg = computeList.length ? computeSum / computeList.length : 0;
    
    return {
      kind: 'yami-probe',
      version: PROBE_VERSION,
      generatedAt: new Date().toISOString(),
      durationMs: round2(now() - state.startedPerf),
      samples: state.samples.length,
      budgetMs: BUDGET,
      hooked: state.hooked,
      scene: {
        actors: (typeof Scene !== 'undefined' && Scene.actors) ? Scene.actors.length + ' 个' : '0 个'
      },
      compute: {
        avg: round2(computeAvg),
        p95: round2(percentile(computeList, 0.95)),
        p99: round2(percentile(computeList, 0.99)),
        max: round2(computeList.reduce(function (max, v) { return Math.max(max, v); }, 0)),
        overBudgetCount: state.overBudgetFrames.length
      },
      frame: {
        p95: round2(percentile(intervalList, 0.95)),
        max: round2(intervalList.reduce(function (max, v) { return Math.max(max, v); }, 0))
      },
      updaters: formatList(state.updaterTotal),
      renderers: formatList(state.rendererTotal),
      events: formatList(state.eventTotal),
      overBudgetFrames: state.overBudgetFrames,
      timeline: state.samples.slice(-300)
    };
  }

  // ---------------- 本地轻量 SSE / HTTP 服务 (解决跨浏览器跨域隔离) ----------------
  const sseClients = new Set();
  function broadcastSSE(event, data) {
    if (!sseClients.size) return;
    const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    for (const res of sseClients) {
      try { res.write(payload); } catch (e) { sseClients.delete(res); }
    }
  }

  try {
    if (typeof require === 'function') {
      const http = require('http');
      const server = http.createServer(function(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.url === '/stream') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          sseClients.add(res);
          req.on('close', function() { sseClients.delete(res); });
          return;
        }

        if (req.url === '/live') {
          const recent = state.samples.slice(-15);
          const avgCompute = recent.length ? recent.reduce(function(s, x) { return s + x.compute; }, 0) / recent.length : 0;
          const last = recent[recent.length - 1] || {};
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            fps: last.fps || 60,
            compute: Number(avgCompute.toFixed(2)),
            frameTime: Number((last.interval || 16.6).toFixed(2)),
            update: Number((last.update || 0).toFixed(2)),
            render: Number((last.render || 0).toFixed(2)),
            actors: (typeof Scene !== 'undefined' && Scene.actors) ? Scene.actors.length : 0,
            updaters: recentUpdaterSnap || [],
            events: recentEventSnap || [],
            timestamp: Date.now()
          }));
          return;
        }

        if (req.url === '/report') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(buildReport()));
          return;
        }

        res.writeHead(404);
        res.end();
      });

      server.on('error', function(err) {
        if (err.code !== 'EADDRINUSE') console.warn('调试端口错误:', err.message);
      });

      server.listen(BRIDGE_PORT, '127.0.0.1', function() {
        console.log('⚡ [Yami Perf Bridge] 本地实时调试服务已就绪: http://127.0.0.1:' + BRIDGE_PORT);
      });
    }
  } catch (e) {
    console.warn('Node.js http bridge 未启动:', e);
  }

  let channel = null;
  try {
    channel = new BroadcastChannel('yami-perf-lab-channel');
  } catch (e) {}

  // ---------------- 实时数据流广播 (每 200ms 推送一次) ----------------
  setInterval(function() {
    if (!state.running || !state.samples.length) return;
    const recent = state.samples.slice(-15);
    if (!recent.length) return;
    const avgCompute = recent.reduce(function(s, x) { return s + x.compute; }, 0) / recent.length;
    const last = recent[recent.length - 1];
    
    const streamPacket = {
      fps: last.fps || 60,
      compute: Number(avgCompute.toFixed(2)),
      frameTime: Number(last.interval.toFixed(2)),
      update: Number(last.update.toFixed(2)),
      render: Number(last.render.toFixed(2)),
      actors: (typeof Scene !== 'undefined' && Scene.actors) ? Scene.actors.length : 0,
      updaters: recentUpdaterSnap || [],
      events: recentEventSnap || [],
      timestamp: Date.now()
    };

    broadcastSSE('tick', streamPacket);
    if (channel) channel.postMessage({ type: 'PERF_STREAM_TICK', data: streamPacket });
  }, 200);

  window.__YAMI_PERF_PROBE__ = {
    version: PROBE_VERSION,
    state: state,
    getReport: buildReport,
    copy: function () {
      const json = JSON.stringify(buildReport(), null, 2);
      navigator.clipboard.writeText(json).then(function() { console.log('✅ 性能报告已复制到剪贴板'); });
      return json;
    },
    download: function () {
      const json = JSON.stringify(buildReport(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'yami-probe-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 3000);
      return json;
    },
    sendToPerfLab: function () {
      const report = buildReport();
      broadcastSSE('report', report);
      if (channel) channel.postMessage({ type: 'PERF_REPORT_SYNC', data: report });
      try {
        localStorage.setItem('yami-perf-lab-latest-report', JSON.stringify(report));
      } catch (e) {}
      console.log('⚡ [Yami Perf-Lab] 数据已广播至分析台！');
      return report;
    }
  };
})();