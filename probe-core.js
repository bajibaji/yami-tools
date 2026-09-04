(() => {
  'use strict';
  if (window.__YAMI_PERF_PROBE__) return;

  const PROBE_VERSION = '0.4.0';
  const BUDGET = 16.7;
  const MAX_SAMPLES = 12000;
  const BRIDGE_PORT = 5966;
  
  const state = {
    running: true,
    startedAt: Date.now(),
    startedPerf: performance.now(),
    frameSeq: 0,
    hooked: { game: false, updaters: 0, renderers: 0, events: 0, webgl: false },
    samples: [],
    overBudgetFrames: [],
    updaterTotal: new Map(),
    rendererTotal: new Map(),
    eventTotal: new Map(),
    objectTotal: new Map(),
    lastJankTime: 0,
    lastJankEvent: null,
    // 嫌疑开关: 挂起某类对象的真实更新(用于 A/B 实验验证真凶)
    suspend: { actors: false, animations: false, emitters: false, triggers: false, ui: false, events: false, audio: false },
    // 已包装对象集合(防重复 + 恢复计数)
    objWrapped: { actors: 0, animations: 0, emitters: 0, triggers: 0, ui: 0 },
    frameObjMs: new Map(),
    errorHistory: [],
    errorUnreadCount: 0
  };

  let frameUpdate = 0;
  let frameRender = 0;
  let frameUpdaterMs = new Map();
  let frameRendererMs = new Map();
  let frameEventMs = new Map();

  let recentUpdaterSnap = [];
  let recentEventSnap = [];

  // WebGL 实时统计
  const glStats = {
    drawCalls: 0,
    triangles: 0,
    programSwitches: 0,
    textureBinds: 0,
    textureUploads: 0,
    textureUploadKB: 0,
    bigDraws: 0,
    lastDrawCalls: 0,
    lastTriangles: 0,
    lastProgramSwitches: 0,
    lastTextureBinds: 0,
    lastTextureUploads: 0,
    lastTextureUploadKB: 0,
    lastBigDraws: 0
  };

  // 估计一次纹理上传的字节数(KB), 按方法签名分流取宽高(texImage2D: 新9参签名 width=args[3],height=args[4]; texSubImage2D: width=args[4],height=args[5]; 老签名/带source时从源对象取)
  function texUploadKB(method, args) {
    try {
      let width = 0, height = 0;
      const n = args.length;
      if (method === 'texImage2D' && n >= 9) {
        if (typeof args[3] === 'number' && typeof args[4] === 'number') { width = args[3]; height = args[4]; }
      } else if (method === 'texSubImage2D' && n >= 9) {
        if (typeof args[4] === 'number' && typeof args[5] === 'number') { width = args[4]; height = args[5]; }
      } else if (method === 'texImage3D' && n >= 10) {
        if (typeof args[3] === 'number' && typeof args[4] === 'number' && typeof args[5] === 'number') {
          width = args[3]; height = args[4] * Math.max(1, args[5]);
        }
      }
      if (width <= 0 || height <= 0) {
        const src = args[n - 1];
        if (src && typeof src === 'object') {
          const w = src.width || src.naturalWidth || 0;
          const h = src.height || src.naturalHeight || 0;
          if (w > 0 && h > 0) { width = width > 0 ? width : w; height = height > 0 ? height : h; }
        }
      }
      if (width <= 0 || height <= 0) return 0;
      const kb = width * height * 4 / 1024;
      if (kb > 1048576) return 0;   // 单帧上传 >1GB 视为异常数据
      return Math.max(1, Math.round(kb));
    } catch (e) { return 0; }
  }

  function hookTexUpload(proto, methodName) {
    if (!proto || proto['__yamiTexHook_' + methodName + '__']) return;
    const orig = proto[methodName];
    if (typeof orig !== 'function') return;
    Object.defineProperty(proto, '__yamiTexHook_' + methodName + '__', { value: true, configurable: true });
    proto[methodName] = function () {
      const kb = texUploadKB(methodName, arguments);
      if (kb > 0) {
        glStats.textureUploads++;
        glStats.textureUploadKB += kb;
      }
      return orig.apply(this, arguments);
    };
  }

  function hookWebGL() {
    if (state.hooked.webgl) return;
    const hookProto = function(proto) {
      if (!proto || proto.__yamiGlHooked__) return;
      proto.__yamiGlHooked__ = true;
      state.hooked.webgl = true;

      const origDrawElements = proto.drawElements;
      proto.drawElements = function(mode, count, type, offset) {
        glStats.drawCalls++;
        if (count > 20000) glStats.bigDraws++;
        if (mode === 4 /* TRIANGLES */) glStats.triangles += count / 3;
        return origDrawElements.apply(this, arguments);
      };

      const origDrawArrays = proto.drawArrays;
      proto.drawArrays = function(mode, first, count) {
        glStats.drawCalls++;
        if (count > 20000) glStats.bigDraws++;
        if (mode === 4) glStats.triangles += count / 3;
        return origDrawArrays.apply(this, arguments);
      };

      const origUseProgram = proto.useProgram;
      proto.useProgram = function(p) {
        glStats.programSwitches++;
        return origUseProgram.apply(this, arguments);
      };

      const origBindTexture = proto.bindTexture;
      proto.bindTexture = function(t, tex) {
        glStats.textureBinds++;
        return origBindTexture.apply(this, arguments);
      };
    };

    try {
      if (typeof WebGLRenderingContext !== 'undefined') {
        hookProto(WebGLRenderingContext.prototype);
        hookTexUpload(WebGLRenderingContext.prototype, 'texImage2D');
        hookTexUpload(WebGLRenderingContext.prototype, 'texSubImage2D');
      }
      if (typeof WebGL2RenderingContext !== 'undefined') {
        hookProto(WebGL2RenderingContext.prototype);
        hookTexUpload(WebGL2RenderingContext.prototype, 'texImage2D');
        hookTexUpload(WebGL2RenderingContext.prototype, 'texSubImage2D');
        hookTexUpload(WebGL2RenderingContext.prototype, 'texImage3D');
      }
    } catch (e) {}
  }
  hookWebGL();

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

  // ============ ① 对象级归因下沉: 包装场景对象实例的 update(角色/动画/触发器/粒子/界面) ============
  // 帧级对象计时采样开关(隔帧采样降低开销): 0=本帧不测 1=本帧测量
  let objSampling = 0;
  let recentObjSnap = [];

  // 本地化文本反查(对象名字若是本地化ID则转为显示文本)
  function localizeText(name) {
    try {
      if (typeof Local === 'undefined' || !Local || !Local.textMap) return null;
      const item = Local.textMap[name];
      if (!item || !item.contents) return null;
      const lang = (typeof Local.active === 'string' && Local.active) ? Local.active : 'zh-CN';
      const content = item.contents[lang];
      if (typeof content === 'string' && content.length > 0) return content;
    } catch (e) {}
    return null;
  }

  function shortName(v) {
    const s = localizeText(v) || v;
    return s.length > 36 ? s.slice(0, 36) : s;
  }

  
  // 识别玩家主角/队伍成员(冻结怪物时必须放行主角，保证玩家正常移动与放技能)
  function isPlayerActor(actor) {
    if (!actor) return false;
    try {
      if (typeof Party !== 'undefined' && Party) {
        if (Party.player === actor) return true;
        if (Party.members && Array.isArray(Party.members) && Party.members.indexOf(actor) !== -1) return true;
      }
    } catch (e) {}
    try {
      if (actor.isPlayer || actor.player) return true;
    } catch (e) {}
    return false;
  }

  function resolveObjectName(obj, kind, index) {
    if (!obj) return kind + '#' + index;
    const candidates = [];
    try { if (typeof obj.name === 'string' && obj.name) candidates.push(obj.name); } catch (e) {}
    try { if (typeof obj.title === 'string' && obj.title) candidates.push(obj.title); } catch (e) {}
    try { if (typeof obj.key === 'string' && obj.key) candidates.push(obj.key); } catch (e) {}
    try {
      const d = obj.data || obj.preset;
      if (d) {
        for (const k of ['name', 'title']) {
          const v = d[k];
          if (typeof v === 'string' && v) { candidates.push(v); break; }
        }
      }
    } catch (e) {}
    for (const c of candidates) {
      if (c === 'default' || /^[0-9a-f]{16}$/i.test(c)) continue;
      return shortName(c);
    }
    const ctor = obj && obj.constructor && obj.constructor.name;
    return ctor && ctor !== 'Object' && ctor !== 'Function' ? ctor : kind + '#' + index;
  }

  function topObjects(map, n) {
    return Array.from(map.entries())
      .map(function (e) {
        const sep = e[0].indexOf('::');
        return { kind: e[0].slice(0, sep), name: e[0].slice(sep + 2), ms: round3(e[1]) };
      })
      .sort(function (a, b) { return b.ms - a.ms; })
      .slice(0, n || 8);
  }

  function formatObjList(map) {
    return Array.from(map.entries()).map(function (entry) {
      const sep = entry[0].indexOf('::');
      const v = entry[1];
      return {
        kind: entry[0].slice(0, sep),
        name: entry[0].slice(sep + 2),
        count: v.count,
        total: round2(v.sum),
        avg: round3(v.count ? v.sum / v.count : 0),
        max: round2(v.max)
      };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  function recordObjectMs(kind, name, ms) {
    if (!(ms > 0)) return;
    const key = kind + '::' + name;
    rec(state.objectTotal, key, ms);
    addFrame(state.frameObjMs, key, ms);
  }

  // 包装单个场景对象: 挂起开关在包装层短路真实更新, 达到"嫌疑开关"效果
  function wrapOneObject(obj, kind, index) {
    try {
      if (!obj || typeof obj.update !== 'function' || obj.__yamiPerfObjWrapped__) return false;
      const name = resolveObjectName(obj, kind, index);
      const orig = obj.update.bind(obj);
      Object.defineProperty(obj, '__yamiPerfObjWrapped__', { value: true, configurable: true });
      obj.update = function () {
        if (state.suspend[kind] === true) {
          // 核心保护: 冻结角色时只冻结非主角(怪物、NPC)，主角保持全速响应
          if (kind === 'actors' && isPlayerActor(obj)) {
            // 主角正常放行
          } else {
            return undefined;
          }
        }
        const t0 = objSampling === 1 ? now() : 0;
        let r;
        try {
          r = orig.apply(this, arguments);
        } finally {
          if (objSampling === 1) {
            const ms = now() - t0;
            if (ms > 0) recordObjectMs(kind, name, ms);
          }
        }
        return r;
      };
      return true;
    } catch (e) { return false; }
  }

  // 角色管理器差额归因: SceneActorManager.update = Σactor.update + 碰撞检测/网格分区(集合级开销)
  // 引擎 scene.ts: manager.update 内除对象分发外还有 ActorCollider.handle*Collisions 等,
  // 大场景碰撞是常见卡顿元凶, 必须把差额归因出来, 否则对象榜会漏掉它。
  function wrapActorManager(mgr) {
    try {
      if (!mgr || typeof mgr.update !== 'function' || mgr.__yamiPerfMgrWrapped__) return;
      const orig = mgr.update.bind(mgr);
      Object.defineProperty(mgr, '__yamiPerfMgrWrapped__', { value: true, configurable: true });
      mgr.update = function () {
        // 注: 角色过滤在具体的 actor.update 中做细粒度放行，不在此处全停，确保主角不受影响
        const t0 = objSampling === 1 ? now() : 0;
        let r;
        try {
          r = orig.apply(this, arguments);
        } finally {
          if (objSampling === 1) {
            const ms = now() - t0;
            let objSum = 0;
            state.frameObjMs.forEach(function (v, k) {
              if (k.indexOf('actors::') === 0) objSum += v;
            });
            const diff = ms - objSum;
            if (diff > 0.05) recordObjectMs('actors', '碰撞与分区(集合)', diff);
          }
        }
        return r;
      };
    } catch (e) {}
  }

  // 周期重扫场景/界面对象列表(对象会随场景切换增删, 每60帧增量包装新对象)
  function wrapSceneObjects() {
    try {
      const s = typeof Scene !== 'undefined' ? Scene : null;
      if (s) {
        wrapActorManager(s.actor);
        const groups = [
          ['actors', s.actor && s.actor.list],
          ['animations', s.animation && s.animation.list],
          ['triggers', s.trigger && s.trigger.list],
          ['emitters', s.emitter && s.emitter.list]
        ];
        for (const g of groups) {
          const kind = g[0];
          const list = g[1];
          if (!list || !list.length) continue;
          let count = 0;
          for (let i = 0; i < list.length; i++) {
            if (wrapOneObject(list[i], kind, i)) count++;
          }
          if (count > 0) state.objWrapped[kind] += count;
        }
      }
      // 界面元素: 每个已连接元素的更新器列表(引擎 ui.ts: element.updaters.update)
      if (typeof UI !== 'undefined' && UI.manager && UI.manager.list && UI.manager.list.length) {
        let count = 0;
        for (let i = 0; i < UI.manager.list.length; i++) {
          const el = UI.manager.list[i];
          if (!el || !el.updaters || typeof el.updaters.update !== 'function' || el.updaters.__yamiPerfUIRegWrapped__) continue;
          const name = resolveObjectName(el, 'ui', i);
          const orig = el.updaters.update.bind(el.updaters);
          Object.defineProperty(el.updaters, '__yamiPerfUIRegWrapped__', { value: true, configurable: true });
          el.updaters.update = function () {
            if (state.suspend.ui === true) return undefined;
            const t0 = objSampling === 1 ? now() : 0;
            let r;
            try {
              r = orig.apply(this, arguments);
            } finally {
              if (objSampling === 1) {
                const ms = now() - t0;
                if (ms > 0) recordObjectMs('ui', name, ms);
              }
            }
            return r;
          };
          count++;
        }
        if (count > 0) state.objWrapped.ui += count;
      }
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
          if (state.suspend.events === true) return undefined;
          const t0 = now();
          let r;
          try {
            r = orig.apply(this, arguments);
          } finally {
            const ms = now() - t0;
            rec(state.eventTotal, name, ms);
            addFrame(frameEventMs, name, ms);
            if (recentEventHistory.length > 50) recentEventHistory.shift();
            recentEventHistory.push({ name: name, ms: round3(ms), time: Date.now() });
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

  
  function hookAudio() {
    try {
      if (typeof AudioManager === 'undefined' || !AudioManager) return;
      const se = AudioManager.se;
      if (se && !se.__yamiPerfAudioHooked__) {
        se.__yamiPerfAudioHooked__ = true;
        const origPlay = se.play ? se.play.bind(se) : null;
        if (origPlay) {
          se.play = function () {
            if (state.suspend.audio === true) return undefined;
            return origPlay.apply(this, arguments);
          };
        }
        const origPlayDist = se.playWithDistance ? se.playWithDistance.bind(se) : null;
        if (origPlayDist) {
          se.playWithDistance = function () {
            if (state.suspend.audio === true) return undefined;
            return origPlayDist.apply(this, arguments);
          };
        }
      }
    } catch (e) {}
  }

  
  // ============================================================
  // 内核级原型链挂起拦截器 (100% 绝对生效的嫌疑排除利器)
  // ============================================================
  function installKernelSuspendHooks() {
    // 1. 角色系统: 直接拦截 Actor.prototype.update (老怪、新怪一网打尽，主角严格放行)
    try {
      if (typeof Actor !== 'undefined' && Actor.prototype && !Actor.prototype.__yamiPerfSuspendHooked__) {
        Actor.prototype.__yamiPerfSuspendHooked__ = true;
        const origActorUpdate = Actor.prototype.update;
        Actor.prototype.update = function () {
          if (state.suspend.actors === true) {
            if (isPlayerActor(this)) {
              return origActorUpdate.apply(this, arguments);
            }
            return undefined; // 场景所有其它怪物、NPC 瞬间原地定格！
          }
          return origActorUpdate.apply(this, arguments);
        };
      }
    } catch (e) {}

    // 2. 粒子系统: 直接拦截 SceneParticleEmitterManager.prototype.update
    try {
      if (typeof SceneParticleEmitterManager !== 'undefined' && SceneParticleEmitterManager.prototype && !SceneParticleEmitterManager.prototype.__yamiPerfSuspendHooked__) {
        SceneParticleEmitterManager.prototype.__yamiPerfSuspendHooked__ = true;
        const origEmitterUpdate = SceneParticleEmitterManager.prototype.update;
        SceneParticleEmitterManager.prototype.update = function () {
          if (state.suspend.emitters === true) return undefined; // 全图粒子瞬间静止！
          return origEmitterUpdate.apply(this, arguments);
        };
      }
    } catch (e) {}

    // 3. 事件系统: 直接拦截 EventHandler.prototype.update
    try {
      if (typeof EventHandler !== 'undefined' && EventHandler.prototype && !EventHandler.prototype.__yamiPerfSuspendHooked__) {
        EventHandler.prototype.__yamiPerfSuspendHooked__ = true;
        const origEventUpdate = EventHandler.prototype.update;
        EventHandler.prototype.update = function () {
          if (state.suspend.events === true) return false; // 所有活跃事件指令立即暂停执行！
          return origEventUpdate.apply(this, arguments);
        };
      }
    } catch (e) {}

    // 4. 音效音频系统: 拦截 SE 播放器与主增益节点
    try {
      if (typeof AudioManager !== 'undefined' && AudioManager && AudioManager.se && !AudioManager.se.__yamiPerfAudioHooked__) {
        AudioManager.se.__yamiPerfAudioHooked__ = true;
        const se = AudioManager.se;
        const origPlay = se.play ? se.play.bind(se) : null;
        if (origPlay) {
          se.play = function () {
            if (state.suspend.audio === true) return undefined;
            return origPlay.apply(this, arguments);
          };
        }
        const origPlayDist = se.playWithDistance ? se.playWithDistance.bind(se) : null;
        if (origPlayDist) {
          se.playWithDistance = function () {
            if (state.suspend.audio === true) return undefined;
            return origPlayDist.apply(this, arguments);
          };
        }
      }
    } catch (e) {}

    // 5. 界面 UI 系统: 直接拦截 UI.render 与 UI.update
    try {
      if (typeof UI !== 'undefined' && UI && !UI.__yamiPerfSuspendHooked__) {
        UI.__yamiPerfSuspendHooked__ = true;
        const origUiRender = UI.render ? UI.render.bind(UI) : null;
        if (origUiRender) {
          UI.render = function () {
            if (state.suspend.ui === true) return undefined; // 彻底跳过 UI 渲染！画面瞬间隐藏！
            return origUiRender.apply(this, arguments);
          };
        }
        const origUiUpdate = UI.update ? UI.update.bind(UI) : null;
        if (origUiUpdate) {
          UI.update = function () {
            if (state.suspend.ui === true) return undefined; // 彻底跳过界面更新！
            return origUiUpdate.apply(this, arguments);
          };
        }
      }
    } catch (e) {}
  }

  function refresh() {
    hookGame();
    hookWebGL();
    if (typeof Game !== 'undefined') {
      wrapModules(Game.updaters, 'update', state.updaterTotal, 'Updater');
      wrapModules(Game.renderers, 'render', state.rendererTotal, 'Renderer');
      state.hooked.updaters = (Game.updaters && Game.updaters.length) || 0;
      state.hooked.renderers = (Game.renderers && Game.renderers.length) || 0;
    }
    wrapEventHandlers();
    wrapSceneObjects();
    if (state.objectTotal.size > 500) state.objectTotal.clear();
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
    
    objSampling = (state.frameSeq % 3 === 0) ? 1 : 0;
    if (state.frameSeq % 60 === 0) refresh();

    // 固化上一帧 WebGL 计数
    glStats.lastDrawCalls = glStats.drawCalls;
    glStats.lastTriangles = Math.round(glStats.triangles);
    glStats.lastProgramSwitches = glStats.programSwitches;
    glStats.lastTextureBinds = glStats.textureBinds;
    glStats.lastTextureUploads = glStats.textureUploads;
    glStats.lastTextureUploadKB = glStats.textureUploadKB;
    glStats.lastBigDraws = glStats.bigDraws;
    glStats.drawCalls = 0;
    glStats.triangles = 0;
    glStats.programSwitches = 0;
    glStats.textureBinds = 0;
    glStats.textureUploads = 0;
    glStats.textureUploadKB = 0;
    glStats.bigDraws = 0;

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
      fps: currentFps,
      drawCalls: glStats.lastDrawCalls,
      triangles: glStats.lastTriangles
    };
    state.samples.push(currentSample);
    if (state.samples.length > MAX_SAMPLES) state.samples.shift();

    const top = function(map) {
      return Array.from(map.entries())
        .map(function (e) { return { name: e[0], ms: round3(e[1]) }; })
        .sort(function (a, b) { return b.ms - a.ms; })
        .slice(0, 6);
    };

    recentUpdaterSnap = top(frameUpdaterMs);
    recentEventSnap = top(frameEventMs);
    recentObjSnap = topObjects(state.frameObjMs, 8);

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
        drawCalls: glStats.lastDrawCalls,
        textureUploads: glStats.lastTextureUploads,
        textureUploadKB: glStats.lastTextureUploadKB,
        bigDraws: glStats.lastBigDraws,
        updaters: updaterItems,
        renderers: rendererItems,
        events: eventItems,
        objects: recentObjSnap
      };
      state.overBudgetFrames.push(jankRecord);
      if (state.overBudgetFrames.length > 200) state.overBudgetFrames.splice(0, state.overBudgetFrames.length - 200);

      if (compute > 33.3 && t - state.lastJankTime > 800) {
        state.lastJankTime = t;
        const topObj = recentObjSnap[0];
        const mainCulprit = (topObj && topObj.ms > 5) ? topObj.name
          : (updaterItems[0] && updaterItems[0].name) || (eventItems[0] && eventItems[0].name) || 'Game Update';
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
    state.frameObjMs = new Map();
  }

  setTimeout(function() { checkUpdate(); }, 3500);

  const probeInterval = setInterval(function() {
    refresh();
    if (state.hooked.game) {
      clearInterval(probeInterval);
      requestAnimationFrame(tick);
      console.log('[Yami Perf-Lab Auto Bridge] 探针已成功自动注入并开始监控！');
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

  function getMemoryInfo() {
    try {
      if (typeof performance !== 'undefined' && performance.memory) {
        return {
          used: Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)),
          total: Number((performance.memory.totalJSHeapSize / 1048576).toFixed(1))
        };
      }
    } catch (e) {}
    return { used: 0, total: 0 };
  }

  function getSceneDetails() {
    const s = typeof Scene !== 'undefined' ? Scene : null;
    if (!s) return {
      actors: 0, visibleActors: 0,
      animations: 0, visibleAnimations: 0,
      triggers: 0, visibleTriggers: 0,
      lights: 0, emitters: 0, particles: 0,
      elements: 0, textures: 0,
      resolution: '0x0',
      camera: null
    };
    
    // 100% 对齐 Yami 引擎原生 F10 调试数据源
    const actorCount = (s.actor && s.actor.list) ? s.actor.list.length : 0;
    const visibleActorCount = s.visibleActors ? (s.visibleActors.count || 0) : 0;
    const animCount = (s.animation && s.animation.list) ? s.animation.list.length : 0;
    const visibleAnimCount = s.visibleAnimations ? (s.visibleAnimations.count || 0) : 0;
    const triggerCount = (s.trigger && s.trigger.list) ? s.trigger.list.length : 0;
    const visibleTriggerCount = s.visibleTriggers ? (s.visibleTriggers.count || 0) : 0;
    const lightCount = (s.light && s.light.list) ? s.light.list.length : 0;
    const emitterCount = (s.emitter && s.emitter.list) ? s.emitter.list.length : 0;
    const particleTotal = s.particleCount || 0;

    const uiElements = (typeof UI !== 'undefined' && UI.manager && UI.manager.list) ? UI.manager.list.length : 0;
    const textureCount = (typeof GL !== 'undefined' && GL.textureManager) ? GL.textureManager.count : 0;
    const res = (typeof GL !== 'undefined') ? `${GL.width}x${GL.height}` : '0x0';

    let cam = null;
    if (typeof Camera !== 'undefined') {
      cam = {
        x: Math.round(Camera.x || 0),
        y: Math.round(Camera.y || 0),
        zoom: Number((Camera.zoom || 1).toFixed(2)),
        width: Math.round(Camera.width || 0),
        height: Math.round(Camera.height || 0)
      };
    }

    return {
      actors: actorCount,
      visibleActors: visibleActorCount,
      animations: animCount,
      visibleAnimations: visibleAnimCount,
      triggers: triggerCount,
      visibleTriggers: visibleTriggerCount,
      lights: lightCount,
      emitters: emitterCount,
      particles: particleTotal,
      elements: uiElements,
      textures: textureCount,
      resolution: res,
      camera: cam
    };
  }

  // 最近执行事件轨迹
  const recentEventHistory = [];

  function getActiveEventsDetails() {
    try {
      const em = typeof EventManager !== 'undefined' ? EventManager : null;
      if (!em) return { active: [], history: recentEventHistory.slice(-10).reverse(), totalRegistered: 0 };
      
      const list = Array.from(em.activeEvents || []);
      const active = list.map(function(ev) {
        const initial = ev.initial || ev.commands || {};
        const p = ev.path || initial.path || '';
        const name = p ? p.split('/').pop() : (ev.type || initial.type || '事件');
        const cmdIndex = typeof ev.index === 'number' ? ev.index : 0;
        const cmdTotal = (ev.commands && ev.commands.length) || 0;
        return {
          name: name,
          type: ev.type || initial.type || 'event',
          path: p,
          index: cmdIndex,
          total: cmdTotal,
          priority: !!ev.priority
        };
      });

      // 统计全局注册事件总数
      let totalRegistered = 0;
      try {
        if (typeof Data !== 'undefined' && Data.events) {
          totalRegistered = Object.keys(Data.events).length;
        }
      } catch (e) {}

      return {
        active: active,
        history: recentEventHistory.slice(-10).reverse(),
        totalRegistered: totalRegistered
      };
    } catch (e) {
      return { active: [], history: [], totalRegistered: 0 };
    }
  }

  
  // ============================================================
  // 控制台异常与后台错误黑匣子分析引擎 (Error Analyzer)
  // ============================================================
  
  // 智能提取本地真实报错源码上下文 (报错行上下各 3 行)
  function extractCodeContext(source, lineno, stack) {
    try {
      if (typeof require !== 'function') return null;
      const fs = require('fs');
      const path = require('path');

      let targetPath = '';
      let targetLine = Number(lineno) || 0;

      // 1. 优先从 source 提取
      if (typeof source === 'string' && source) {
        let clean = source.replace(/\?.*$/, ''); // 去除 ?t=... 等查询参数
        if (clean.startsWith('file:///')) clean = clean.slice(8);
        if (process.platform === 'win32' && clean.startsWith('/')) clean = clean.slice(1);
        clean = decodeURIComponent(clean).replace(/\\/g, '/');
        if (fs.existsSync(clean) && fs.statSync(clean).isFile()) {
          targetPath = clean;
        }
      }

      // 2. 次选从 stack 正则匹配真实物理工程文件
      if (!targetPath && typeof stack === 'string' && stack) {
        const lines = stack.split('\n');
        for (const line of lines) {
          const match = line.match(/(?:at\s+.*\()?([a-zA-Z]:[/\\][^:?()]+):(\d+)(?::(\d+))?\)?/);
          if (match) {
            let candidate = match[1].replace(/\\/g, '/');
            if (!candidate.includes('node_modules') && fs.existsSync(candidate)) {
              targetPath = candidate;
              if (!targetLine) targetLine = Number(match[2]);
              break;
            }
          }
        }
      }

      if (!targetPath || !targetLine || targetLine <= 0) return null;

      // 读取文件并提取上下文代码
      const content = fs.readFileSync(targetPath, 'utf8');
      const allLines = content.split(/\r?\n/);
      const startLine = Math.max(1, targetLine - 3);
      const endLine = Math.min(allLines.length, targetLine + 3);

      const snippetLines = [];
      for (let i = startLine; i <= endLine; i++) {
        snippetLines.push({
          line: i,
          content: allLines[i - 1] || '',
          isTarget: i === targetLine
        });
      }

      return {
        filePath: targetPath,
        fileName: path.basename(targetPath),
        targetLine: targetLine,
        lines: snippetLines
      };
    } catch (e) {
      return null;
    }
  }

  function analyzeError(msg, stack, url) {
    const text = String(msg || '');
    const stackText = String(stack || '');
    let category = 'RuntimeError';
    let title = '脚本运行时未知异常';
    let reason = '代码执行过程中抛出异常，未能正常捕获';
    let suggestion = '检查报错文件所在行号的上下文逻辑';

    // 1. 空指针 / 未定义属性访问
    if (/Cannot read propert/i.test(text) || /is (null|undefined)/i.test(text)) {
      category = 'NullPointer';
      const propMatch = text.match(/reading ['"]?([^'")\s]+)['"]?/i) || text.match(/of (null|undefined)/i);
      const propName = propMatch ? propMatch[1] : '属性';
      title = '尝试访问空对象的属性 [' + propName + ']';
      reason = '目标对象尚未生成、已被销毁，或变量未被正确初始化，此时直接读取其属性导致引擎崩溃。';
      suggestion = '在访问前添加判空保护: 例如 if (target && target.' + propName + ')，避免对 null 进行解引用。';
    }
    // 2. 方法不存在
    else if (/is not a function/i.test(text)) {
      category = 'MissingFunction';
      const funcMatch = text.match(/['"]?([^'")\s]+)['"]? is not a function/i);
      const funcName = funcMatch ? funcMatch[1] : '方法';
      title = '调用的函数不存在 [' + funcName + '()]';
      reason = '尝试调用一个对象上未定义的方法。通常是因为函数名拼写错误、依赖的前置插件未启用，或引擎版本 API 差异。';
      suggestion = '核对函数名大小写拼写，或在调用前检查: if (typeof target.' + funcName + ' === "function")。';
    }
    // 3. 变量未声明
    else if (/is not defined/i.test(text)) {
      category = 'UndefinedVariable';
      const varMatch = text.match(/['"]?([^'")\s]+)['"]? is not defined/i);
      const varName = varMatch ? varMatch[1] : '变量';
      title = '使用了未声明的变量 [' + varName + ']';
      reason = '直接访问了一个从未声明、或者拼写错误的全局/局部变量。';
      suggestion = '检查变量名拼写，或确认在使用前是否通过 let/const/var 或全局 Variable 进行了初始化。';
    }
    // 4. 事件死循环 / 堆栈溢出
    else if (/Maximum call stack size exceeded/i.test(text) || stackText.includes('Event.call') || stackText.includes('Trigger.execute')) {
      category = 'StackOverflow';
      title = '事件死锁或逻辑死循环 (爆栈)';
      reason = '事件互相调用或递归函数在极短时间内循环触发数万次，导致浏览器调用栈彻底溢出。';
      suggestion = '排查涉及的公共事件与并行触发器，确认递归退出分支，或在循环事件末尾添加【等待 1 帧】切断同步死锁。';
    }
    // 5. 地图场景加载与 Autotile 越界
    else if (/Scene\.load|Scene\.change|autotile|tilemap|map\.json/i.test(text) || /Scene/i.test(stackText) && /load/i.test(stackText)) {
      category = 'SceneError';
      title = '地图场景切换与地形图块加载异常';
      reason = '引擎尝试加载目标地图或图块数据失败。可能是目标地图文件丢失、Autotile 编号越界或图层索引错误。';
      suggestion = '检查地图数据表是否包含该地图 ID，核对场景传送指令的目标地图编号与坐标有效性。';
    }
    // 6. 插件与自定义指令执行异常
    else if (/Command|Plugin|Assets[/\\]插件|Custom Commands/i.test(text) || stackText.includes('Command.execute')) {
      category = 'PluginError';
      title = '插件自定义指令执行失败';
      reason = '游戏事件中调用的自定义插件指令抛出异常。常见于指令参数类型不匹配、插件代码未正确编译或缺失前置库。';
      suggestion = '在编辑器【插件管理器】中检查该插件配置项，核对事件调用的参数是否符合指令定义。';
    }
    // 7. WebGL 图形与纹理渲染异常
    else if (/WebGL|gl\.|bindTexture|createShader|compileShader|drawElements/i.test(text) || stackText.includes('webgl.ts')) {
      category = 'RenderError';
      title = 'WebGL 图形渲染管线异常';
      reason = '图形渲染阶段发生异常，可能是显卡纹理单元丢失、贴图尺寸超限（非 2 的幂或过大）或 Shader 语法错误。';
      suggestion = '排查最近绘制的大图资源，避免在同一帧大量上传未压缩超大纹理，或排查自定义材质着色器。';
    }
    // 8. 游戏资源 404 / 文件丢失
    else if (/404|not found|ERR_FILE_NOT_FOUND/i.test(text)) {
      category = 'ResourceNotFound';
      title = '游戏素材资源文件丢失 (404)';
      reason = '游戏引擎尝试从硬盘加载贴图、音频或数据文件，但文件在对应路径下不存在。';
      suggestion = '检查工程对应 Assets 目录下是否存在该文件，核对文件名大小写拼写及后缀扩展名。';
    }
    // 9. JSON 存档与配置文件损坏
    else if (/Unexpected token|JSON/i.test(text)) {
      category = 'JSONParseError';
      title = '数据文件或 JSON 格式损坏';
      reason = '尝试读取并解析 JSON 存档或配置文件时遇到语法格式错误（如多余逗号、特殊不可见字符、未闭合括号）。';
      suggestion = '检查对应 .json 或 .save 文件格式是否规范，或在 JSON.parse 处增加 try...catch 保护。';
    }
    // 10. 音频解码与播放异常
    else if (/Audio|WebAudio|decodeAudioData|Sound/i.test(text)) {
      category = 'AudioError';
      title = '音频文件解码或播放受阻';
      reason = '音频文件格式不兼容、音频通道被占用，或在用户未产生交互前触发了浏览器的自动播放策略。';
      suggestion = '确认音频为标准 .mp3 或 .ogg 格式，并确保背景音乐在进入游戏有点击交互后再行启动。';
    }
    // 11. 数值溢出与无效计算 (NaN / Infinity)
    else if (/NaN|Infinity|toPrecision|toFixed/i.test(text)) {
      category = 'NumericError';
      title = '无效数值计算 (NaN / 溢出)';
      reason = '未初始化的变量参与了数学运算，或者发生了除以零、未定义属性参与了累加操作。';
      suggestion = '核对数值公式各入参是否有初值，使用 || 0 进行防御性数值兜底。';
    }

    return {
      category: category,
      title: title,
      reason: reason,
      suggestion: suggestion
    };
  }

  // 同源错误广播节流表: key=fingerprint -> 最近广播时间戳
  const errDispatchTs = new Map();

  function recordError(item) {
    const analysis = analyzeError(item.message, item.stack, item.source);
    const codeContext = extractCodeContext(item.source, item.lineno, item.stack);

    // 错误唯一指纹计算 (类型 + 消息 + 来源 + 行号)
    const fingerprint = (item.type || 'error') + '::' + String(item.message || '').slice(0, 100) + '::' + String(item.source || '') + '::' + String(item.lineno || 0);

    const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const nowTs = Date.now();

    // 检查是否已存在同指纹错误进行智能聚合
    const existing = state.errorHistory.find(e => e.fingerprint === fingerprint);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.latestTime = nowStr;
      existing.latestTimestamp = nowTs;
      if (item.stack) existing.stack = item.stack;
      if (codeContext && !existing.codeContext) existing.codeContext = codeContext;

      // 移动至队列最前端 (保持最近发生优先)
      const idx = state.errorHistory.indexOf(existing);
      if (idx > 0) {
        state.errorHistory.splice(idx, 1);
        state.errorHistory.unshift(existing);
      }
      state.errorUnreadCount++;
    } else {
      const errRecord = {
        id: 'err_' + nowTs + '_' + Math.random().toString(36).slice(2, 6),
        fingerprint: fingerprint,
        count: 1,
        time: nowStr,
        firstTime: nowStr,
        latestTime: nowStr,
        timestamp: nowTs,
        latestTimestamp: nowTs,
        type: item.type,
        message: item.message,
        source: item.source,
        lineno: item.lineno,
        colno: item.colno,
        stack: item.stack,
        analysis: analysis,
        codeContext: codeContext
      };
      state.errorHistory.unshift(errRecord);
      if (state.errorHistory.length > 100) state.errorHistory.pop();
      state.errorUnreadCount++;
    }

    // 同源错误广播节流: 同一指纹在 2 秒内只向外派发一次事件, 防止循环死循环造成事件风暴
    try {
      const lastTs = errDispatchTs.get(fingerprint) || 0;
      if (nowTs - lastTs >= 2000) {
        errDispatchTs.set(fingerprint, nowTs);
        if (errDispatchTs.size > 200) errDispatchTs.clear();
        const activeRecord = existing || state.errorHistory[0];
        window.dispatchEvent(new CustomEvent('yami-perf-new-error', { detail: activeRecord }));
      }
    } catch (e) {}
  }

  function installGlobalErrorHooks() {
    try {
      // 1. 全局未捕获异常
      const origOnError = window.onerror;
      window.onerror = function(message, source, lineno, colno, error) {
        recordError({
          type: 'error',
          message: String(message),
          source: source || '运行时脚本',
          lineno: lineno || 0,
          colno: colno || 0,
          stack: (error && error.stack) ? error.stack : (source + ':' + lineno + ':' + colno)
        });
        if (typeof origOnError === 'function') {
          return origOnError.apply(this, arguments);
        }
        return false;
      };

      // 2. Promise 未捕获拒绝
      window.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason;
        const msg = reason ? (reason.message || String(reason)) : 'Promise 被拒绝';
        const stack = reason ? (reason.stack || '') : '';
        recordError({
          type: 'unhandled_rejection',
          message: msg,
          source: 'Promise 异步逻辑',
          lineno: 0,
          colno: 0,
          stack: stack
        });
      });

      // 3. 代理 console.error
      if (console && console.error) {
        const origConsoleError = console.error.bind(console);
        console.error = function() {
          const args = Array.prototype.slice.call(arguments);
          const text = args.map(function(a) {
            return (typeof a === 'object' && a !== null) ? (a.message || a.stack || JSON.stringify(a)) : String(a);
          }).join(' ');
          if (!text.includes('[Yami Perf]')) {
            recordError({
              type: 'console_error',
              message: text,
              source: 'console.error',
              lineno: 0,
              colno: 0,
              stack: (new Error()).stack
            });
          }
          return origConsoleError.apply(console, arguments);
        };
      }
    } catch (e) {}
  }
  installGlobalErrorHooks();

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
      scene: getSceneDetails(),
      memory: getMemoryInfo(),
      webgl: {
        lastDrawCalls: glStats.lastDrawCalls,
        lastTriangles: glStats.lastTriangles,
        lastProgramSwitches: glStats.lastProgramSwitches,
        lastTextureBinds: glStats.lastTextureBinds,
        lastTextureUploads: glStats.lastTextureUploads,
        lastTextureUploadKB: glStats.lastTextureUploadKB,
        lastBigDraws: glStats.lastBigDraws
      },
      activeEvents: getActiveEventsDetails(),
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
      objects: formatObjList(state.objectTotal).slice(0, 12),
      wrappedObjects: Object.assign({}, state.objWrapped),
      suspend: Object.assign({}, state.suspend),
      overBudgetFrames: state.overBudgetFrames,
      timeline: state.samples.slice(-300)
    };
  }

  // ---------------- 本地轻量 SSE / HTTP 服务 ----------------
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
            drawCalls: glStats.lastDrawCalls,
            triangles: glStats.lastTriangles,
            memory: getMemoryInfo(),
            scene: getSceneDetails(),
            updaters: recentUpdaterSnap || [],
            events: recentEventSnap || [],
            objects: recentObjSnap || [],
            textureUploads: glStats.lastTextureUploads,
            textureUploadKB: glStats.lastTextureUploadKB,
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
        console.log('[Yami Perf Bridge] 本地实时调试服务已就绪: http://127.0.0.1:' + BRIDGE_PORT);
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
      drawCalls: glStats.lastDrawCalls,
      triangles: glStats.lastTriangles,
      memory: getMemoryInfo(),
      scene: getSceneDetails(),
      updaters: recentUpdaterSnap || [],
      events: recentEventSnap || [],
      objects: recentObjSnap || [],
      textureUploads: glStats.lastTextureUploads,
      textureUploadKB: glStats.lastTextureUploadKB,
      timestamp: Date.now()
    };

    broadcastSSE('tick', streamPacket);
    if (channel) channel.postMessage({ type: 'PERF_STREAM_TICK', data: streamPacket });
  }, 200);

  // ============ ③ 普通模式·健康体检与具体文件真凶定位引擎 ============
  function getDiagnosisReport() {
    try {
      const recent = state.samples.slice(-20);
      const avgCompute = recent.length ? (recent.reduce(function(s, x) { return s + x.compute; }, 0) / recent.length) : 0;
      const last = recent[recent.length - 1] || {};
      const fps = (typeof Time !== 'undefined' && Time.fps) || last.fps || 60;
      const dc = glStats.lastDrawCalls || 0;
      const scene = getSceneDetails();
      const eventsData = getActiveEventsDetails();

      // 计算健康分 (0 - 100)
      let score = 100;
      if (fps < 30) score -= 35;
      else if (fps < 50) score -= 18;
      else if (fps < 58) score -= 8;

      if (avgCompute > 25) score -= 30;
      else if (avgCompute > 16.7) score -= 18;
      else if (avgCompute > 10) score -= 8;

      const isSmoothGame = (fps >= 55 && avgCompute < 14);
      if (!isSmoothGame) {
        if (dc > 100) score -= 20;
        else if (dc > 60) score -= 10;
      } else if (dc > 100) {
        score -= 5; // 满帧顺畅时仅轻微扣 5 分，依然保持 90+ 绿标！
      }

      if (scene.particles > 600) score -= 15;
      else if (scene.particles > 300) score -= 8;

      if (scene.actors > 60) score -= 12;

      score = Math.max(10, Math.min(100, Math.round(score)));

      let status = 'good';
      let statusText = '丝滑如飞 · 极佳状态';
      let statusDesc = '各项指标都在预算内，CPU 与显卡毫无压力。';

      if (score < 65 || fps < 35 || avgCompute > 25) {
        status = 'bad';
        statusText = '严重卡顿 · 发现瓶颈';
        statusDesc = '存在严重单帧超载或高频狂跑逻辑，建议根据下方真凶定位排查！';
      } else if (score < 85 || fps < 55 || avgCompute > 12) {
        status = 'warn';
        statusText = '轻微压力 · 偶发负载';
        statusDesc = '部分指标稍高，在低配设备上可能会出现微小掉帧。';
      }

      // 实时卡顿真凶归因分析 (Culprits)
      const culprits = [];

      // 1. 检查事件死循环 / 高频狂跑 (具体到 .event 文件与指令行号)
      if (eventsData.active && eventsData.active.length > 0) {
        eventsData.active.forEach(function(ev) {
          const path = ev.path || 'Assets/Event/Unknown.event';
          const cmdIdx = (typeof ev.index === 'number' ? ev.index : 0) + 1;
          const isHeavy = ev.total > 200 || (ev.priority && avgCompute > 10);
          if (isHeavy || avgCompute > 18) {
            culprits.push({
              level: avgCompute > 25 ? 'bad' : 'warn',
              type: 'event',
              title: '公共/场景事件高频执行: [' + ev.name + ']',
              file: path,
              location: '第 ' + cmdIdx + ' 步指令 (共 ' + ev.total + ' 步)',
              reason: '事件正在高速连续循环执行，大量占用 CPU 时间片',
              suggestion: '打开该事件，在循环末尾添加【等待 1 帧】，避免持续抽干主线程。',
              targetId: ev.path || ev.name
            });
          }
        });
      }

      // 2. 检查对象级耗时 (具体到角色/怪物 .actor 文件)
      const topObj = recentObjSnap && recentObjSnap[0];
      if (topObj && topObj.ms > 4) {
        if (topObj.kind === 'actors' && topObj.name.indexOf('碰撞') === -1) {
          culprits.push({
            level: topObj.ms > 10 ? 'bad' : 'warn',
            type: 'actor',
            title: '角色行为计算超时: [' + topObj.name + ']',
            file: 'Assets/Actor/' + topObj.name + '.actor',
            location: '场景实体: ' + topObj.name + ' (单怪耗时 ' + topObj.ms + 'ms)',
            reason: '单个角色实例在当前帧消耗了过多寻路、状态机或脚本逻辑',
            suggestion: '降低该角色的寻路频率（如改为每 5 帧寻路一次），或缩减其视野感知范围。',
            targetId: topObj.name
          });
        } else if (topObj.name.indexOf('碰撞') !== -1) {
          culprits.push({
            level: 'warn',
            type: 'collision',
            title: '场景角色物理碰撞密集',
            file: 'SceneActorCollider (场景网格碰撞系统)',
            location: '同屏角色总数: ' + scene.actors + ' 个',
            reason: '多个实体几何包围盒重叠排斥，触发了高密度的物理碰撞解算',
            suggestion: '将非关键怪物或装饰NPC的碰撞设为【无重量/无碰撞】，减少重叠解算。',
            targetId: 'actors'
          });
        }
      }

      // 3. 检查渲染批次 (DrawCall) - 智能自适应: 满帧时不瞎恐吓！
      if (dc > 70) {
        const isSmooth = (fps >= 55 && avgCompute < 14);
        culprits.push({
          level: isSmooth ? 'warn' : (dc > 120 ? 'bad' : 'warn'),
          type: 'render',
          title: (isSmooth ? '[低配优化建议] 绘制批次偏多' : '画面绘制批次过多') + ' (DrawCall: ' + dc + ' 次)',
          file: 'WebGL 图块与贴图材质 (Tilesets & Textures)',
          location: '每帧绘制调用: ' + dc + ' 次 (同屏面数: ' + (glStats.lastTriangles || 0) + ')',
          reason: isSmooth 
            ? '当前电脑性能强劲，运行依然丝滑；但存在较多独立碎图打断了合批'
            : '不同材质、Shader 或碎图打断了引擎合批，造成多次往返提交显卡',
          suggestion: isSmooth
            ? '若需兼顾核显与手机等低配设备，建议将散乱的地图图块合并进主图集(Tileset)。'
            : '尽量将同地图元件整合进主图集（Tileset），避免大量孤立碎图贴在地图上。',
          targetId: 'render'
        });
      }

      // 4. 检查粒子过载
      if (scene.particles > 350) {
        culprits.push({
          level: scene.particles > 600 ? 'bad' : 'warn',
          type: 'particle',
          title: '粒子过载 (' + scene.particles + ' 个)',
          file: 'SceneParticleEmitter (场景粒子发射器)',
          location: '发射器总数: ' + (scene.emitters || 0) + ' / 粒子总数: ' + scene.particles,
          reason: '同屏大量粒子正在更新位置与渲染，造成 GPU 填充率与 CPU 遍历压力',
          suggestion: '调低技能或场景发射器的【每秒生成数量 (Rate)】与【最大粒子上限】。',
          targetId: 'emitters'
        });
      }

      // 5. 检查界面元素泄漏
      if (scene.elements > 200) {
        culprits.push({
          level: 'warn',
          type: 'ui',
          title: '界面元素过多 (Elements: ' + scene.elements + ' 个)',
          file: 'UIManager (界面管理器)',
          location: '当前驻留界面元素: ' + scene.elements + ' 个',
          reason: '界面元素堆积过多，疑似战斗飘字、弹窗或提示框未彻底销毁',
          suggestion: '检查弹窗和临时战斗文本在关闭后是否调用了 destroy() 彻底从内存移除。',
          targetId: 'ui'
        });
      }

      return {
        score: score,
        status: status,
        statusText: statusText,
        statusDesc: statusDesc,
        fps: fps,
        computeAvg: Number(avgCompute.toFixed(1)),
        drawCalls: dc,
        actors: scene.actors,
        particles: scene.particles,
        elements: scene.elements,
        culprits: culprits.slice(0, 3)
      };
    } catch (e) {
      return {
        score: 100,
        status: 'good',
        statusText: '运行良好',
        statusDesc: '探针正常监听中',
        fps: 60,
        computeAvg: 0,
        drawCalls: 0,
        actors: 0,
        particles: 0,
        elements: 0,
        culprits: []
      };
    }
  }

  
  // ============================================================
  // 自动化版本管理与一键热更新引擎 (依托 GitHub + jsDelivr 免费全球加速生态)
  // ============================================================
  const UPDATE_CONFIG = {
    currentVersion: PROBE_VERSION,
    repo: 'bajibaji/yami-tools',
    branch: 'extension',
    cdnBase: 'https://cdn.jsdelivr.net/gh/bajibaji/yami-tools@extension/',
    rawBase: 'https://raw.githubusercontent.com/bajibaji/yami-tools/extension/',
    // 写盘顺序: manifest.json 必须最后落盘——它是版本门闩,
    // 若中途失败旧 manifest 仍在,下次 checkUpdate 版本判定可继续重试,避免半更新状态。
    updateFiles: [
      'probe-core.js',
      'hud-overlay.js',
      'HANDOFF.md',
      'README.md',
      'manifest.json'
    ]
  };

  // 语义化版本比对: v1 > v2 返回 1, v1 < v2 返回 -1, 相等返回 0
  function compareVersion(v1, v2) {
    const s1 = String(v1).replace(/^v/, '').split('.').map(Number);
    const s2 = String(v2).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(s1.length, s2.length); i++) {
      const n1 = s1[i] || 0;
      const n2 = s2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  // 单通道安全下载 (3.5 秒超时兜底), 失败返回 null
  async function tryFetch(url) {
    try {
      let signal = undefined;
      if (typeof AbortController !== 'undefined') {
        const c = new AbortController();
        setTimeout(function() { c.abort(); }, 3500);
        signal = c.signal;
      }
      const resp = await fetch(url, { cache: 'no-cache', signal: signal });
      if (resp.ok) return await resp.text();
    } catch (e) {}
    return null;
  }

  // 下载远端文件文本 (raw 优先串行: 直达 GitHub 无 CDN 缓存, 内容永远最新;
  // jsDelivr 边缘缓存会滞留旧版本且 ?t= 参数无法绕过, 实测曾长期卡在 v0.1.0, 仅作网络兜底)
  async function fetchRemoteText(filename) {
    const ts = Date.now();
    const text = await tryFetch(UPDATE_CONFIG.rawBase + filename)
      || await tryFetch(UPDATE_CONFIG.cdnBase + filename + '?t=' + ts);
    if (text === null) throw new Error('无法从远端拉取文件: ' + filename);
    return text;
  }

  // 双通道并行探测远端最新版本: 各自拉取 manifest 后取版本号更高者,
  // 规避 CDN 陈旧缓存(返回旧版但响应成功)与 raw 单点网络故障两类缺陷。
  async function fetchLatestManifest() {
    const ts = Date.now();
    const [rawText, cdnText] = await Promise.all([
      tryFetch(UPDATE_CONFIG.rawBase + 'manifest.json'),
      tryFetch(UPDATE_CONFIG.cdnBase + 'manifest.json?t=' + ts)
    ]);
    const parsed = [];
    if (rawText !== null) { try { parsed.push({ text: rawText, m: JSON.parse(rawText) }); } catch (e) {} }
    if (cdnText !== null) { try { parsed.push({ text: cdnText, m: JSON.parse(cdnText) }); } catch (e) {} }
    if (parsed.length === 0) throw new Error('无法从远端拉取文件: manifest.json');
    parsed.sort(function(a, b) { return compareVersion(b.m.version, a.m.version); });
    if (parsed.length === 1) {
      console.warn('[自动更新] 仅单通道可用(可能为 jsDelivr 缓存), 版本判定可能滞后。');
    }
    return parsed[0].text;
  }

  // 检查是否有新版本
  async function checkUpdate() {
    try {
      const remoteManifestText = await fetchLatestManifest();
      const remoteManifest = JSON.parse(remoteManifestText);
      const remoteVer = remoteManifest.version;
      const hasUpdate = compareVersion(remoteVer, UPDATE_CONFIG.currentVersion) > 0;
      const result = {
        hasUpdate: hasUpdate,
        currentVersion: UPDATE_CONFIG.currentVersion,
        latestVersion: remoteVer,
        description: remoteManifest.description || '发现新版本组件'
      };
      if (hasUpdate) {
        window.dispatchEvent(new CustomEvent('yami-perf-update-found', { detail: result }));
      } else {
        window.dispatchEvent(new CustomEvent('yami-perf-update-none', { detail: result }));
        console.log('[自动更新] 检查通道正常, 当前已是最新版本 ' + result.currentVersion + '。');
      }
      return result;
    } catch (e) {
      return { hasUpdate: false, error: e.message };
    }
  }

  // 执行一键热更新覆盖本地文件
  async function performAutoUpdate(onProgress) {
    if (typeof require !== 'function') {
      throw new Error('当前运行环境缺失 Node.js 模块权限，无法直接写入文件系统。');
    }
    const fs = require('fs');
    const path = require('path');

    // 智能定位本地插件安装物理目录 (多级探测)
    const candidateDirs = [
      'D:/Program Files/Open Yami RPG Editor/extension/yami-perf-extension',
      path.join(process.cwd(), 'extension/yami-perf-extension')
    ];
    try {
      if (process.resourcesPath) {
        candidateDirs.push(path.join(process.resourcesPath, '../extension/yami-perf-extension'));
      }
    } catch (e) {}

    let localDir = null;
    for (const d of candidateDirs) {
      if (fs.existsSync(path.join(d, 'manifest.json'))) {
        localDir = d;
        break;
      }
    }
    if (!localDir) {
      localDir = candidateDirs[0];
    }

    const files = UPDATE_CONFIG.updateFiles;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (typeof onProgress === 'function') {
        onProgress(i + 1, files.length, file);
      }
      const text = await fetchRemoteText(file);
      const targetPath = path.join(localDir, file);
      fs.writeFileSync(targetPath, text, 'utf8');
    }

    // 成功后同步更新内存中的版本号
    try {
      const manifestPath = path.join(localDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (updatedManifest && updatedManifest.version) {
          UPDATE_CONFIG.currentVersion = updatedManifest.version;
          if (window.__YAMI_PERF_PROBE__) window.__YAMI_PERF_PROBE__.version = updatedManifest.version;
        }
      }
    } catch (e) {}

    return {
      success: true,
      version: UPDATE_CONFIG.currentVersion,
      updatedFiles: files.length,
      targetDir: localDir
    };
  }

  window.__YAMI_PERF_PROBE__ = {
    version: PROBE_VERSION,
    state: state,
    glStats: glStats,
    getReport: buildReport,
    checkUpdate: checkUpdate,
    performAutoUpdate: performAutoUpdate,
    compareVersion: compareVersion,
    getDiagnosisReport: getDiagnosisReport,
    getErrors: function() { return state.errorHistory.slice(); },
    getErrorCount: function() { return state.errorHistory.length; },
    clearErrors: function() { state.errorHistory = []; state.errorUnreadCount = 0; return true; },
    getSceneDetails: getSceneDetails,
    getMemoryInfo: getMemoryInfo,
    getActiveEvents: getActiveEventsDetails,
    // ② 嫌疑开关: 挂起/恢复某类对象的真实更新 (actors/animations/emitters/triggers/ui/events)
        suspend: function (kind, on) {
      if (!Object.prototype.hasOwnProperty.call(state.suspend, kind)) return false;
      state.suspend[kind] = !!on;
      installKernelSuspendHooks();
      
      // 音频即时静音与还原
      if (kind === 'audio') {
        try {
          if (typeof AudioManager !== 'undefined' && AudioManager && AudioManager.se) {
            if (state.suspend.audio === true) {
              if (typeof AudioManager.se.stop === 'function') AudioManager.se.stop();
              if (AudioManager.se.gain && AudioManager.se.gain.gain) AudioManager.se.gain.gain.value = 0;
            } else {
              if (AudioManager.se.gain && AudioManager.se.gain.gain) AudioManager.se.gain.gain.value = 1;
            }
          }
        } catch (e) {}
      }
      return state.suspend[kind];
    },
    getSuspend: function () {
      return Object.assign({}, state.suspend);
    },
    copy: function () {
      const json = JSON.stringify(buildReport(), null, 2);
      navigator.clipboard.writeText(json).then(function() { console.log('[OK] 性能报告已复制到剪贴板'); });
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
      console.log('[Yami Perf-Lab] 数据已广播至分析台！');
      return report;
    }
  };
})();