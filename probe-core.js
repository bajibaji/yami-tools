(() => {
  'use strict';
  if (window.__YAMI_PERF_PROBE__) return;

  const PROBE_VERSION = '0.11.0';
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
    // 调试与作弊控制状态
    cheats: {
      speedMultiplier: 1,
      noClip: false,
      speedBoost: false,
      godMode: false,
      origPlayerPassage: null,
      origPlayerSpeed: null,
      origTimeScale: null
    },
    variableWarnings: {},
    backgroundDrift: null,
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

  // 事件名解析: 事件文件名形如「新手村.0a1b2c3d4e5f6071.event」, GUID 段之前就是中文名。
  // 体检字典命中时优先取字典权威名, 最终回退文件名 —— 保证界面永不裸露 GUID (铁律⑱)。
  function resolveEventNameFromPath(file) {
    try {
      const name = String(file || '');
      if (!name) return '';
      const guidMatch = name.match(/\.([0-9a-f]{16})\.event$/);
      if (guidMatch && projectAudit.names && projectAudit.names.has(guidMatch[1])) {
        return projectAudit.names.get(guidMatch[1]).name;
      }
      return name.replace(/\.event$/, '').replace(/\.([0-9a-f]{16})$/, '') || '';
    } catch (e) {
      return '';
    }
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
      // 含 <global:xxx> 的文本被引擎编译成闭包函数 (local.ts)，需调用后取值，否则界面会露出 GUID
      if (typeof content === 'function') {
        try {
          const text = content();
          if (typeof text === 'string' && text.length > 0) return text;
        } catch (e) {}
      }
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
        wrapEventInstance(event);
      }
    } catch (e) {}
  }

  // 包装单个事件的 update: 微秒级耗时 + 报错定位入栈 + 事件黑匣子状态时间戳(拦截/推进)
  function wrapEventInstance(event) {
    if (!event || typeof event.update !== 'function') return false;
    // 引擎在「等待/暂停/继续」时会整体替换 event.update (event.ts set/continue/pause 分别换成 tick/wait/complete)，
    // 此时旧包装器已被顶掉 → 必须允许重新包装当前实现，否则该事件耗时从此永久丢失
    if (event.__yamiPerfProbeEventWrapped__ && event.update === event.__yamiPerfProbeWrapper__) return false;
    let name = 'event';
    try {
      const initial = event.initial || event.commands || {};
      const eventType = event.type || initial.type || '';
      const eventPath = event.path || initial.path || '';
      const file = String(eventPath || '').split('/').pop() || '';
      const parentName = event.parent && event.parent.constructor && event.parent.constructor.name ? '(' + event.parent.constructor.name + ')' : '';
      name = (eventType || 'event') + ' :: ' + (file || parentName || 'unknown');
    } catch (e) {}
    const impl = event.update;
    const orig = impl.bind(event);
    const wrapper = function () {
      if (state.suspend.events === true) return undefined;
      const t0 = now();
      let r;
      let stackEntry = null;
      const idxBefore = typeof event.index === 'number' ? event.index : -1;
      try {
        // 报错定位: 入栈记录当前事件, 异常捕获时反查「哪个事件第几步」
        stackEntry = { ev: event };
        if (eventExecStack.length < 40) eventExecStack.push(stackEntry);
        r = orig.apply(this, arguments);
      } finally {
        if (stackEntry) {
          const si = eventExecStack.lastIndexOf(stackEntry);
          if (si >= 0) eventExecStack.splice(si, 1);
        }
        const ms = now() - t0;
        rec(state.eventTotal, name, ms);
        addFrame(frameEventMs, name, ms);
        if (recentEventHistory.length > 50) recentEventHistory.shift();
        recentEventHistory.push({ name: name, ms: round3(ms), time: Date.now() });
        // 事件黑匣子: 记录「本帧被指令拦截(返回 false)」与「指令索引推进」时刻,
        // 二者配合即可区分 等待计时 / 暂停 / 挂起等外部条件 (无需依赖引擎内部私有变量)
        try {
          if (r === false) event.__yamiEventBlockedAt__ = Date.now();
          if (typeof event.index === 'number' && event.index !== idxBefore) event.__yamiEventProgressAt__ = Date.now();
        } catch (e) {}
      }
      return r;
    };
    Object.defineProperty(event, '__yamiPerfProbeEventWrapped__', { value: true, configurable: true });
    event.__yamiPerfProbeWrapper__ = wrapper;
    event.__yamiEventWrapperRef__ = wrapper;
    event.__yamiEventImplRef__ = impl;
    event.update = wrapper;
    return true;
  }

  function applyCheatsPerFrame() {
    if (!state.cheats) return;
    const c = state.cheats;
    try {
      const player = (typeof Party !== 'undefined' && Party) ? Party.player : null;
      if (player) {
        // 1. 穿墙维持
        if (c.noClip) {
          if (c.origPlayerPassage === null) c.origPlayerPassage = player.passage ?? 0;
          player.passage = -1;
        } else if (c.origPlayerPassage !== null) {
          player.passage = c.origPlayerPassage;
          c.origPlayerPassage = null;
        }

        // 2. 移速加成维持
        if (c.speedBoost && player.navigator) {
          if (c.origPlayerSpeed === null) c.origPlayerSpeed = player.navigator.movementSpeed ?? 4;
          player.navigator.movementSpeed = 12;
        } else if (!c.speedBoost && c.origPlayerSpeed !== null && player.navigator) {
          player.navigator.movementSpeed = c.origPlayerSpeed;
          c.origPlayerSpeed = null;
        }

        // 3. 锁血 (无限生命)
        if (c.godMode && player.attributes) {
          const attrs = player.attributes;
          for (const k of Object.keys(attrs)) {
            const lk = k.toLowerCase();
            if (lk === 'health' || lk === 'hp' || k === '生命值') {
              const maxVal = attrs['maxHealth'] || attrs['maxHp'] || attrs['最大生命值'] || 999999;
              attrs[k] = maxVal;
            }
          }
        }
      }
    } catch (e) {}
  }

  function hookVariableSet() {
    try {
      if (typeof Variable !== 'undefined' && Variable && !Variable.__yamiCheatsHooked__) {
        Variable.__yamiCheatsHooked__ = true;
        const origSet = Variable.set;
        Variable.set = function (key, value) {
          try {
            const currentVal = (Variable.map && typeof Variable.map === 'object') ? Variable.map[key] : undefined;
            const targetType = typeof currentVal;
            const incomingType = typeof value;
            // 键未声明时引擎 set() 会静默丢弃本次写入 (variable.ts:117-133 的 switch 无匹配分支)
            const keyMissing = !(Variable.map && typeof Variable.map === 'object' && (key in Variable.map));
            let isRejected = false;
            let isNaNVal = false;

            if (incomingType === 'number' && Number.isNaN(value)) {
              isNaNVal = true;
            }

            if (keyMissing) {
              isRejected = true;
            } else if (currentVal !== undefined) {
              if (targetType !== incomingType) {
                if (!(incomingType === 'object' && targetType === 'undefined') &&
                    !(incomingType === 'undefined' && targetType === 'object')) {
                  isRejected = true;
                }
              }
            }

            if (isRejected || isNaNVal) {
              const reason = isNaNVal ? '计算结果为NaN' : (keyMissing ? '变量不存在(写入被引擎丢弃)' : '类型冲突丢弃');
              // 关键: 只报「写不进去」对小白毫无用处, 必须同时告诉他「是谁写的」——
              // 复用事件执行栈 + 编译期指令映射, 直接落到「哪条事件第几步·什么指令·哪个场景」
              const loc = currentEventLocation();
              const prev = state.variableWarnings[key];
              const repeated = prev && prev.reason === reason && (Date.now() - Number(prev.time || 0)) < 10000;
              state.variableWarnings[key] = {
                time: Date.now(),
                key: key,
                currentVal: currentVal,
                attemptedVal: value,
                reason: reason,
                count: repeated ? (Number(prev.count) || 1) + 1 : 1,
                eventName: loc.eventName,
                sceneName: loc.sceneName,
                step: loc.step,
                total: loc.total,
                cmdDesc: loc.desc,
                located: loc.located === true
              };
            }
          } catch (err) {}
          return origSet.apply(this, arguments);
        };
      }
    } catch (e) {}
  }

  // 监听后台失焦与时间漂移提示
  let hideRealTime = 0;
  let hideGameTime = 0;
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      try {
        if (document.hidden) {
          hideRealTime = performance.now();
          hideGameTime = (typeof Time !== 'undefined' && Time && typeof Time.elapsed === 'number') ? Time.elapsed : 0;
        } else if (hideRealTime > 0) {
          const realElapsed = (performance.now() - hideRealTime) / 1000;
          const gameElapsed = (typeof Time !== 'undefined' && Time && typeof Time.elapsed === 'number') ? (Time.elapsed - hideGameTime) / 1000 : 0;
          hideRealTime = 0;
          if (realElapsed > 3 && (realElapsed - gameElapsed) > 1.5) {
            const realMin = Math.floor(realElapsed / 60);
            const realSec = Math.round(realElapsed % 60);
            const gameMin = Math.floor(gameElapsed / 60);
            const gameSec = Math.round(gameElapsed % 60);
            const realStr = realMin > 0 ? (realMin + '分' + realSec + '秒') : (realSec + '秒');
            const gameStr = gameMin > 0 ? (gameMin + '分' + gameSec + '秒') : (gameSec + '秒');
            state.backgroundDrift = '本次切入后台 ' + realStr + '，游戏内推进仅 ' + gameStr + ' (受限于引擎节流)';
          }
        }
      } catch (e) {}
    });
  }

  function hookGame() {
    const G = typeof Game !== 'undefined' ? Game : null;
    if (!G || typeof G.update !== 'function' || G.__yamiPerfProbeHooked__) return;
    state.hooked.game = true;
    const u = G.update.bind(G);
    G.update = function () {
      const t0 = now();
      try {
        applyCheatsPerFrame();
        const res = u.apply(this, arguments);
        if (state.cheats && state.cheats.speedMultiplier > 1 && !state.cheats.__inSpeedLoop) {
          state.cheats.__inSpeedLoop = true;
          try {
            const extraSteps = Math.min(9, Math.floor(state.cheats.speedMultiplier) - 1);
            for (let s = 0; s < extraSteps; s++) {
              u.apply(this, arguments);
            }
          } finally {
            state.cheats.__inSpeedLoop = false;
          }
        }
        return res;
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
    hookVariableSet();
    if (typeof Game !== 'undefined') {
      wrapModules(Game.updaters, 'update', state.updaterTotal, 'Updater');
      wrapModules(Game.renderers, 'render', state.rendererTotal, 'Renderer');
      state.hooked.updaters = (Game.updaters && Game.updaters.length) || 0;
      state.hooked.renderers = (Game.renderers && Game.renderers.length) || 0;
    }
    wrapEventHandlers();
    // 事件黑匣子: 编译期指令映射与事件启动钩子必须尽早装上 (引擎读完工程数据即编译事件)
    installEventTrace();
    installEventCallHook();
    wrapSceneObjects();
    if (state.objectTotal.size > 500) state.objectTotal.clear();
    if (typeof EventManager !== 'undefined' && EventManager.activeEvents) {
      state.hooked.events = EventManager.activeEvents.length;
    }
  }

  let lastTick = now();
  // 首帧间隔 = 注入时刻 → 游戏启动完成的等待时间(常达 1-3 秒)，会永久污染报告里的 frame.max
  let firstTickSkipped = false;
  function tick() {
    requestAnimationFrame(tick);
    const t = now();
    const interval = t - lastTick;
    lastTick = t;
    if (!state.running) return;
    if (!firstTickSkipped) {
      firstTickSkipped = true;
      if (interval > 500) return;
    }
    
    objSampling = (state.frameSeq % 3 === 0) ? 1 : 0;
    if (state.frameSeq % 60 === 0) refresh();
    scanEventTimeline();

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
    // 对象耗时每 3 帧才采样一次 → 非采样帧保留上一份快照，避免真凶卡片/胶囊以 4Hz 闪烁
    const objSnap = topObjects(state.frameObjMs, 8);
    if (objSnap.length > 0) recentObjSnap = objSnap;

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

  // ============================================================
  // 资源缓存与内存 (对标引擎盲点: loader.ts:19-23 的三张缓存表只增不减, 长时试玩内存持续爬升)
  // ------------------------------------------------------------
  // 引擎事实依据 (arpg-ts-chinese Script/loader.ts):
  //   · cachedImages[key] 既可能是「加载中的 Promise」也可能是「已加载的 <img>」—— 清理必须跳过 Promise,
  //     否则会把半途的图片清掉 (getImage 返回 null / loadImage 重入)
  //   · cachedUrls[path] 是 objectURL; 引擎在图片 onload/onerror 时若 save=false 就会 revoke 掉它
  //     (loader.ts:254-256) —— 所以清图片时**必须同步清掉 cachedUrls**, 否则下次重新加载会拿到失效 URL
  //   · cachedBlobs[url] 才是真正的二进制内存, 由 revokeBlobUrl 释放 (loader.ts:302-307)
  //   安全闸门: 只在 loader.complete !== false (没有正在进行的加载) 时才允许清理。
  //   注意(真机实测): 不同引擎构建暴露的全局词法绑定不一样 —— Command/EventHandler/Data 可达,
  //   但部分构建里 `typeof Loader` 直接 ReferenceError。故不能硬依赖名字, 见 findAssetLoader()。
  // ============================================================
  function findAssetLoader() {
    const looksLikeLoader = function (obj) {
      return !!obj && typeof obj === 'object' && !!obj.cachedImages && typeof obj.cachedImages === 'object';
    };
    const names = ['Loader', 'FileLoader', 'ResourceLoader', 'AssetLoader'];
    for (let i = 0; i < names.length; i++) {
      try {
        const cand = eval(names[i]);   // 全局词法绑定无法枚举, 只能按名字取
        if (looksLikeLoader(cand)) return cand;
      } catch (e) {}
    }
    // 兜底: 在可达的引擎对象上找「身上挂着 cachedImages 的 loader」
    const holders = ['Data', 'Scene', 'Game', 'Callback', 'UI', 'EventManager', 'Codec', 'IDB'];
    for (let i = 0; i < holders.length; i++) {
      try {
        const holder = eval(holders[i]);
        if (!holder || typeof holder !== 'object') continue;
        const keys = Object.keys(holder);
        for (let k = 0; k < keys.length; k++) {
          try {
            if (looksLikeLoader(holder[keys[k]])) return holder[keys[k]];
          } catch (e) {}
        }
      } catch (e) {}
    }
    return null;
  }

  function getCacheInfo() {
    const info = {
      ok: false, available: false, images: 0, loading: 0, urls: 0, blobs: 0, blobKB: 0,
      heapUsedMB: 0, heapTotalMB: 0, loaderBusy: false
    };
    try {
      const mem = getMemoryInfo();
      info.heapUsedMB = mem.used;
      info.heapTotalMB = mem.total;
      const loader = findAssetLoader();
      if (!loader) return info;   // 内存信息依旧可用, 只是资源缓存读不到
      info.ok = true;
      info.available = true;
      info.loaderBusy = loader.complete === false;
      const images = loader.cachedImages || {};
      for (const key in images) {
        const v = images[key];
        if (typeof Promise !== 'undefined' && v instanceof Promise) info.loading++;
        else info.images++;
      }
      info.urls = Object.keys(loader.cachedUrls || {}).length;
      const blobs = loader.cachedBlobs || {};
      for (const url in blobs) {
        info.blobs++;
        const blob = blobs[url];
        if (blob && typeof blob.size === 'number') info.blobKB += blob.size / 1024;
      }
      info.blobKB = Math.round(info.blobKB);
      return info;
    } catch (e) {
      return info;
    }
  }

  // 一键清理资源缓存: 只动 Loader 的三张表, 保守但彻底 —— 界面上的画面不会立刻变化
  // (GPU 上已上传的贴图由引擎 TextureManager 持有, 这里释放的是 JS 侧的图片元素/Blob 缓存)
  function clearAssetCache() {
    try {
      const loader = findAssetLoader();
      if (!loader) return { ok: false, reason: 'no-loader' };
      // 安全闸门: 正在加载资源时绝不动缓存
      if (loader.complete === false) return { ok: false, reason: 'loading' };
      const before = getCacheInfo();
      const images = loader.cachedImages || {};
      const urls = loader.cachedUrls || {};
      let clearedImages = 0;
      for (const key of Object.keys(images)) {
        const value = images[key];
        if (typeof Promise !== 'undefined' && value instanceof Promise) continue; // 半途加载中的条目绝不动
        delete images[key];
        clearedImages++;
        const url = urls[key];
        if (typeof url === 'string') {
          if (typeof loader.revokeBlobUrl === 'function') loader.revokeBlobUrl(url);
          delete urls[key];
        }
      }
      // 顺手释放没有对应图片条目的孤儿 Blob
      const blobs = loader.cachedBlobs || {};
      let clearedBlobs = 0;
      for (const url of Object.keys(blobs)) {
        if (typeof loader.revokeBlobUrl === 'function') loader.revokeBlobUrl(url);
        else delete blobs[url];
        clearedBlobs++;
      }
      return { ok: true, clearedImages: clearedImages, clearedBlobs: clearedBlobs, before: before, after: getCacheInfo() };
    } catch (e) {
      return { ok: false, reason: 'error', error: String((e && e.message) || e) };
    }
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

      // 统计全局注册事件总数 (引擎初始化读完即 delete Data.events，真实来源是 EventManager.guidMap)
      let totalRegistered = 0;
      try {
        if (typeof EventManager !== 'undefined' && EventManager && EventManager.guidMap) {
          totalRegistered = Object.keys(EventManager.guidMap).length;
        } else if (typeof Data !== 'undefined' && Data.events) {
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
  // 场景实体快照 (Scene Inspector): 角色实例/触发区域/场景元信息
  // ============================================================
  function getSceneEntities() {
    const empty = function (partial) {
      return Object.assign({
        ok: true, scene: false, error: null,
        meta: { sceneId: '', path: '', width: 0, height: 0, tileWidth: 0 },
        counts: {
          actors: 0, visibleActors: 0, animations: 0, visibleAnimations: 0,
          triggers: 0, visibleTriggers: 0, lights: 0, emitters: 0, particles: 0
        },
        camera: null,
        actors: { local: [], global: [] },
        regions: []
      }, partial || {});
    };

    try {
      if (typeof Scene === 'undefined' || !Scene) return empty();
      const binding = Scene.binding || null;
      if (!binding) return empty();
      const sceneData = binding.data || {};

      // 计数与相机直接复用既有诊断源 (100% 对齐引擎原生 F10)
      const det = getSceneDetails();
      const counts = {
        actors: det.actors, visibleActors: det.visibleActors,
        animations: det.animations, visibleAnimations: det.visibleAnimations,
        triggers: det.triggers, visibleTriggers: det.visibleTriggers,
        lights: det.lights, emitters: det.emitters, particles: det.particles
      };

      function entityName(e, fallback) {
        try {
          if (e && e.name) return e.name;
          if (e && e.data && e.data.name) return e.data.name;
          if (e && e.presetId) return e.presetId;
        } catch (err) {}
        return fallback || '实体';
      }

      const local = [];
      const global = [];
      try {
        const actors = (Scene.actor && Scene.actor.list) ? Scene.actor.list : [];
        for (let i = 0; i < actors.length; i++) {
          const a = actors[i];
          const row = {
            name: entityName(a, 'actor#' + i),
            fileId: (a.data && a.data.id) || null,
            presetId: a.presetId || null,
            x: Math.round((a.x || 0) * 10) / 10,
            y: Math.round((a.y || 0) * 10) / 10,
            angle: Math.round((a.angle || 0) * 180 / Math.PI),
            priority: a.priority || 0,
            visible: a.visible !== false,
            passage: typeof a.passage === 'number' ? a.passage : null,
            isPlayer: false,
            isMember: false,
            collider: null,
            nav: null,
            anim: null
          };
          try {
            if (a.collider) {
              row.collider = {
                shape: a.collider.shape || 'circle',
                size: a.collider.size || 0,
                immovable: !!a.collider.immovable,
                moved: !!a.collider.moved
              };
            }
          } catch (e) {}
          try {
            if (a.navigator) {
              const n = a.navigator;
              row.nav = {
                mode: n.mode || 'stop',
                speed: n.movementSpeed || 0,
                moving: !!(n.mode && n.mode !== 'stop'),
                hasPath: !!n.movementPath
              };
            }
          } catch (e) {}
          try {
            if (a.animation) {
              row.anim = {
                visible: a.animation.visible !== false,
                paused: !!a.animation.paused,
                ended: !!a.animation.ended,
                motion: a.animation.motionName || ''
              };
            }
          } catch (e) {}
          try {
            if (typeof Party !== 'undefined' && Party) {
              row.isPlayer = Party.player === a;
              if (Party.members) {
                row.isMember = Array.prototype.indexOf.call(Party.members, a) >= 0;
              }
            }
          } catch (e) {}

          let kind = 'local';
          try {
            if (typeof GlobalActor !== 'undefined' && a instanceof GlobalActor) kind = 'global';
          } catch (e) {}
          // 跨 realm instanceof 兜底: 编辑器场景数据显式标注 global
          if (kind === 'local' && a.data && a.data.type === 'global') kind = 'global';
          (kind === 'global' ? global : local).push(row);
        }
      } catch (e) {}

      const regions = [];
      try {
        const rl = (Scene.region && Scene.region.list) ? Scene.region.list : [];
        for (let i = 0; i < rl.length; i++) {
          const r = rl[i];
          const inside = (r.actors && r.actors.length) ? r.actors : [];
          regions.push({
            name: entityName(r, '区域#' + i),
            presetId: r.presetId || null,
            x: Math.round((r.x || 0) * 10) / 10,
            y: Math.round((r.y || 0) * 10) / 10,
            width: Math.round((r.width || 0) * 10) / 10,
            height: Math.round((r.height || 0) * 10) / 10,
            actorCount: inside.length,
            actors: inside.slice(0, 8).map(function (m) { return entityName(m, '角色'); })
          });
        }
      } catch (e) {}

      return {
        ok: true,
        scene: true,
        error: null,
        meta: {
          sceneId: binding.id || '',
          path: sceneData.path || '',
          width: sceneData.width || 0,
          height: sceneData.height || 0,
          tileWidth: sceneData.tileWidth || 0
        },
        counts: counts,
        camera: det.camera || null,
        actors: { local: local, global: global },
        regions: regions
      };
    } catch (e) {
      return empty({ ok: false, scene: false, error: String((e && e.message) || e) });
    }
  }

  // ============================================================
  // 工程体检内核 (Project Audit): 断链引用 + 废弃事件 纯静态扫描
  // 用户点击触发, 不进入任何心跳; 只读工程文件, 绝不写盘
  // ============================================================
  const projectAudit = {
    root: '',
    ready: false,
    names: new Map(),      // guid -> { name, kind, path }
    eventFiles: [],        // { guid, name, type, path }
    lastResult: null,
    scanning: false,

    // 引擎自动触发的保留事件类型白名单 (event.ts typeMap + 各 emit 点, 永不判为废弃)
    reservedTypes: new Set([
      'preload', 'startup', 'autorun', 'createscene', 'loadscene', 'loadsave',
      'showtext', 'showchoices', 'equipmentgain', 'itemgain', 'moneygain',
      'keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'doubleclick', 'wheel',
      'touchstart', 'touchmove', 'touchend',
      'gamepadbuttonpress', 'gamepadbuttonrelease', 'gamepadleftstickchange', 'gamepadrightstickchange'
    ]),

    // 扫描文件扩展名白名单 (与引擎资产类型对齐)
    scanExts: new Set(['.json', '.event', '.scene', '.actor', '.item', '.skill', '.state', '.equipment', '.animation', '.particle', '.ui', '.trigger', '.region']),

    findRoot() {
      try {
        if (typeof require !== 'function') return '';
        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        // 1. 试玩运行时窗口: window.location 即游戏工程真实位置
        if (typeof window !== 'undefined' && window.location && window.location.pathname) {
          let p = decodeURIComponent(window.location.pathname);
          if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
          if (!p.includes('resources/app') && !p.includes('resources\\app')) {
            let dir = path.dirname(p);
            for (let i = 0; i < 5; i++) {
              if (fs.existsSync(path.join(dir, 'Data', 'manifest.json')) || fs.existsSync(path.join(dir, 'Save'))) {
                return dir.replace(/\\/g, '/');
              }
              const parent = path.dirname(dir);
              if (parent === dir) break;
              dir = parent;
            }
          }
        }
        // 2. 编辑器宿主: window.File.root
        if (typeof window !== 'undefined' && window.File && typeof window.File.root === 'string' && window.File.root) {
          const root = window.File.root.replace(/[\\/]+$/, '').replace(/\\/g, '/');
          if (fs.existsSync(root) && (fs.existsSync(path.join(root, 'Data')) || fs.existsSync(path.join(root, 'Save')))) {
            return root;
          }
        }
        // 3. ~/.openyami/config.json 当前工程
        try {
          const cfgPath = path.join(os.homedir(), '.openyami', 'config.json');
          if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (cfg && typeof cfg.project === 'string' && cfg.project) {
              const pDir = path.dirname(cfg.project).replace(/\\/g, '/');
              if (fs.existsSync(pDir) && (fs.existsSync(path.join(pDir, 'Data')) || fs.existsSync(path.join(pDir, 'Save')))) {
                return pDir;
              }
            }
          }
        } catch (errCfg) {}
        // 4. 进程工作目录
        if (typeof process !== 'undefined' && process.cwd) {
          const cwd = process.cwd().replace(/\\/g, '/');
          if (!cwd.includes('Open Yami RPG Editor') && (fs.existsSync(path.join(cwd, 'Data')) || fs.existsSync(path.join(cwd, 'Save')))) {
            return cwd;
          }
        }
      } catch (e) {}
      return '';
    },

    setProjectRoot(dir) {
      if (typeof dir === 'string' && dir && dir !== this.root) {
        this.root = dir.replace(/\\/g, '/');
        this.ready = false;
        this.names.clear();
        this.eventFiles = [];
        this.lastResult = null;
      }
    },

    // 递归收集 {id(16hex) + name} 数据字典条目 (变量/属性/队伍/缓动/自动图块 通用)
    collectIdNamePairs(obj, kind, relPath, out) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const v of obj) this.collectIdNamePairs(v, kind, relPath, out);
        return;
      }
      if (typeof obj.id === 'string' && /^[0-9a-f]{16}$/.test(obj.id) && typeof obj.name === 'string') {
        if (!out.has(obj.id)) out.set(obj.id, { name: obj.name, kind: kind, path: relPath });
      }
      for (const k of Object.keys(obj)) {
        if (k === 'code') continue; // 瓦片 code 巨型字符串, 跳过
        this.collectIdNamePairs(obj[k], kind, relPath, out);
      }
    },

    ensureDictionaries() {
      try {
        if (this.ready && this.root) return true;
        if (typeof require !== 'function') return false;
        const fs = require('fs');
        const path = require('path');
        if (!this.root) this.root = this.findRoot();
        if (!this.root || !fs.existsSync(this.root)) return false;

        const names = new Map();
        // 扩展名 -> 中文资产分类 (manifest 数组键 + 文件名递归双路共用)
        const kindByExt = {
          event: '事件', scene: '场景', actor: '角色', item: '物品', skill: '技能', state: '状态',
          equipment: '装备', animation: '动画', anim: '动画', particle: '粒子', tile: '图块', tileset: '图块',
          ui: '界面', audio: '音频', ogg: '音频', mp3: '音频', wav: '音频', flac: '音频',
          image: '图片', png: '图片', jpg: '图片', jpeg: '图片', gif: '图片', webp: '图片',
          video: '视频', mp4: '视频', webm: '视频', font: '字体', ttf: '字体', otf: '字体', woff: '字体', woff2: '字体',
          script: '脚本', ts: '脚本', js: '脚本'
        };
        const kindByManifest = {
          actors: '角色', skills: '技能', triggers: '触发器', items: '物品', equipments: '装备',
          states: '状态', events: '事件', scenes: '场景', tilesets: '图块', ui: '界面',
          animations: '动画', particles: '粒子', images: '图片', audio: '音频', videos: '视频',
          fonts: '字体', script: '脚本', others: '其他'
        };
        const nameRe = /^(.*)\.([0-9a-f]{16})\.([\w]+)$/;
        // 1. 全路径递归: 文件名「名字.guid.ext」直接解析入字典
        // (不读文件内容, 零开销; 兜底 manifest.json 未刷新导致的遗漏)
        const allPaths = [];
        this.collectAllPaths(this.root, allPaths);
        for (const fp of allPaths) {
          const base = fp.split('/').pop() || '';
          const m = base.match(nameRe);
          if (m) {
            const kind = kindByExt[m[3]] || m[3];
            const rel = fp.slice(this.root.length).replace(/^[\/]+/, '').replace(/\\/g, '/');
            if (!names.has(m[2])) names.set(m[2], { name: m[1], kind: kind, path: rel });
          }
        }
        // 2. manifest.json: 按数组键确定权威分类 (修正扩展名歧义如 .png 同属图片)
        const manifestPath = path.join(this.root, 'Data', 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          for (const key of Object.keys(manifest || {})) {
            const list = manifest[key];
            if (!Array.isArray(list)) continue;
            const kind = kindByManifest[key] || key;
            for (const entry of list) {
              const p = entry && entry.path;
              if (typeof p !== 'string') continue;
              const base = p.split('/').pop() || '';
              const m = base.match(nameRe);
              if (m && names.has(m[2])) {
                const prev = names.get(m[2]);
                if (prev.kind !== '事件' && prev.kind !== '变量') names.set(m[2], { name: prev.name, kind: kind, path: p });
              }
            }
          }
        }
        // 2. variables.json: 树形变量/开关字典
        const varPath = path.join(this.root, 'Data', 'variables.json');
        if (fs.existsSync(varPath)) {
          this.collectIdNamePairs(JSON.parse(fs.readFileSync(varPath, 'utf8')), '变量', 'Data/variables.json', names);
        }
        // 3. 其余数据字典: 通用 id+name 提取 (枚举字典含快捷键/槽位/字符串枚举等引用源)
        ['attribute.json', 'teams.json', 'easings.json', 'autotiles.json', 'enumeration.json'].forEach(function(f) {
          const fp = path.join(this.root, 'Data', f);
          if (fs.existsSync(fp)) {
            this.collectIdNamePairs(JSON.parse(fs.readFileSync(fp, 'utf8')), f.replace('.json', ''), 'Data/' + f, names);
          }
        }, this);

        // 4. 事件文件清单 (读 type 用于废弃判定)
        const eventFiles = [];
        names.forEach(function(meta, guid) {
          if (meta.kind !== '事件') return;
          const item = { guid: guid, name: meta.name, type: '', path: meta.path };
          try {
            const fp = path.join(this.root, meta.path);
            if (fs.existsSync(fp)) {
              const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
              item.type = (j && j.type) || '';
            }
          } catch (e) {}
          eventFiles.push(item);
        }, this);

        this.names = names;
        this.eventFiles = eventFiles;
        this.ready = true;
        return true;
      } catch (e) {
        this.ready = false;
        return false;
      }
    },

    // 递归收集工程全部文件路径 (仅路径字符串, 零文件读取; 用于文件名字典解析)
    collectAllPaths(rootDir, out) {
      try {
        const fs = require('fs');
        const path = require('path');
        const walk = function(dir, depth) {
          if (depth > 12) return;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
          for (const ent of entries) {
            if (ent.name.startsWith('.')) continue;
            const fp = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              const low = ent.name.toLowerCase();
              if (low === 'save' || low === 'node_modules' || low === 'dist' || low === '.git') continue;
              walk(fp, depth + 1);
            } else if (ent.isFile()) {
              out.push(fp.replace(/\\/g, '/'));
            }
          }
        };
        walk(rootDir, 0);
      } catch (e) {}
    },

    // 递归收集工程资产文件列表 (按扩展名白名单, 跳过 Save/依赖/隐藏目录)
    collectAssetFiles(rootDir, out) {
      try {
        const fs = require('fs');
        const path = require('path');
        const walk = function(dir, depth) {
          if (depth > 12) return;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
          for (const ent of entries) {
            if (ent.name.startsWith('.')) continue;
            const fp = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              const low = ent.name.toLowerCase();
              if (low === 'save' || low === 'node_modules' || low === 'dist' || low === '.git') continue;
              walk(fp, depth + 1);
            } else if (ent.isFile() && this.scanExts.has(path.extname(ent.name).toLowerCase())) {
              out.push(fp);
            }
          }
        }.bind(this);
        walk(rootDir, 0);
      } catch (e) {}
    },

    run() {
      if (this.scanning) return this.lastResult;
      try {
        this.scanning = true;
        if (typeof require !== 'function') {
          return { ok: false, reason: 'no-node', issues: [] };
        }
        if (!this.ensureDictionaries()) {
          return { ok: false, reason: 'no-project', issues: [] };
        }
        const fs = require('fs');
        const path = require('path');
        const GUID_RE = /^[0-9a-f]{16}$/;

        const files = [];
        this.collectAssetFiles(this.root, files);

        // ---- 单趟扫描: 同时收集「定义」与「引用」, 再判定 ----
        // 字典(names)只覆盖「文件名 + Data/*.json」, 而资产文件内部还会定义大量 id
        // (界面元素的属性键、场景节点、动画帧…), 它们同样是被跨文件引用的合法目标
        // —— 旧版漏了这一类, 于是在真机上把大量合法引用误报成断链。
        const refMap = new Map();        // guid -> { guid, count, files: Map, samples: [] }
        const definedIds = new Set();    // 资产文件内部以 "id" 定义的 GUID
        const nodePresets = new Set();   // 节点自注册预设 (presetId/prefabId/sprites[].id)
        const callEventRefs = new Set();
        let refCount = 0;

        const scanTree = function(obj, chain, cmdId, cmdIndex, fileRel) {
          if (obj === null || obj === undefined) return;
          if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
              const nextCmdIndex = (chain[chain.length - 1] === 'commands') ? i : cmdIndex;
              scanTree(obj[i], chain, cmdId, nextCmdIndex, fileRel);
            }
            return;
          }
          if (typeof obj === 'object') {
            // 定义侧: 资产/节点/预设以 "id" 声明自身 (指令对象的 id 是指令名, GUID_RE 会滤掉)
            if (typeof obj.id === 'string' && GUID_RE.test(obj.id)) definedIds.add(obj.id);
            if (typeof obj.presetId === 'string' && GUID_RE.test(obj.presetId)) nodePresets.add(obj.presetId);
            if (typeof obj.prefabId === 'string' && GUID_RE.test(obj.prefabId)) nodePresets.add(obj.prefabId);
            if (Array.isArray(obj.sprites)) {
              for (const sp of obj.sprites) {
                if (sp && typeof sp.id === 'string' && GUID_RE.test(sp.id)) nodePresets.add(sp.id);
              }
            }
            let nextCmdId = cmdId;
            if (typeof obj.id === 'string' && obj.id) nextCmdId = obj.id;
            for (const k of Object.keys(obj)) {
              if (k === 'code') continue;
              scanTree(obj[k], chain.concat([k]), nextCmdId, cmdIndex, fileRel);
            }
            return;
          }
          if (typeof obj === 'string' && GUID_RE.test(obj)) {
            refCount++;
            const field = nextOf(chain);
            if (field === 'eventId') callEventRefs.add(obj);
            let rec = refMap.get(obj);
            if (!rec) {
              rec = { guid: obj, count: 0, files: new Map(), samples: [] };
              refMap.set(obj, rec);
            }
            rec.count++;
            rec.files.set(fileRel, (rec.files.get(fileRel) || 0) + 1);
            if (rec.samples.length < 8) {
              rec.samples.push({
                file: fileRel,
                cmdId: cmdId || '',
                cmdIndex: cmdIndex,
                field: field,
                inCommand: cmdIndex >= 0 || !!cmdId
              });
            }
          }
        }.bind(this);
        function nextOf(chain) { return chain[chain.length - 1] || ''; }

        for (const fp of files) {
          let rel = fp;
          try { rel = path.relative(this.root, fp).split(path.sep).join('/'); } catch (e) {}
          if (rel === 'Data/config.json') continue; // 编辑器工程配置, 无游戏资产语义
          // 资产清单是「目录」而不是「引用」: 它列出全部资产 GUID, 计入会让死事件判定全部失效
          if (rel === 'Data/manifest.json') continue;
          let j;
          try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
          try { scanTree(j, [], '', -1, rel); } catch (e) {}
        }

        // 脚本侧入边: 事件可能被工程脚本按 GUID 调用 (EventManager.call/emit/get)
        const scriptRefs = new Set();
        let scriptText = '';
        try {
          const scriptFiles = [];
          const walkScripts = function(dir, depth) {
            if (depth > 6 || scriptFiles.length > 600) return;
            let ents = [];
            try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const ent of ents) {
              if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'Dist') continue;
              const fp = path.join(dir, ent.name);
              if (ent.isDirectory()) { walkScripts(fp, depth + 1); continue; }
              if (/\.(ts|js)$/i.test(ent.name)) scriptFiles.push(fp);
            }
          };
          walkScripts(this.root, 0);
          for (const fp of scriptFiles) {
            let txt = '';
            try { txt = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
            if (txt.length > 512 * 1024) txt = txt.slice(0, 512 * 1024);
            scriptText += txt + '\n';
            const re = /EventManager\s*\.\s*(?:call|emit|get)\s*\(\s*['"]([0-9a-f]{16})['"]/g;
            let m;
            while ((m = re.exec(txt))) scriptRefs.add(m[1]);
          }
        } catch (e) {}

        // 引用丢失的分级 + 白话影响 (铁律⑱: 说清"这意味着什么、要不要管")
        const RESOURCE_FIELDS = { portrait: 1, image: 1, avatar: 1, icon: 1, picture: 1, face: 1, texture: 1, font: 1, video: 1, tile: 1 };
        const IMPACT_TEXT = {
          resource: '这个图片或素材已经不在工程里了 —— 游戏里会显示不出来。',
          propertyRuntime: '这个属性已经从工程里删掉了，但事件指令还在给它赋值 —— 这条指令会静默失效（不报错也不生效）。',
          propertyAsset: '这个属性已经从属性表删掉了，角色或资产里还留着它的初始值 —— 引擎载入时会默默忽略，不影响正常运行。',
          commandUnknown: '事件指令里引用的对象在工程里已经不存在了 —— 这条指令可能静默失效。',
          assetUnknown: '这个 ID 在工程里找不到定义，可能已被删除或改名。'
        };

        const brokenList = [];
        for (const rec of refMap.values()) {
          if (brokenList.length >= 300) break;
          // 合法目标的三个来源: 资产注册表(文件名+Data 字典) ∪ 资产文件内部定义的 id ∪ 节点自注册预设
          if (this.names.has(rec.guid) || definedIds.has(rec.guid) || nodePresets.has(rec.guid)) continue;
          let hasResource = false;
          let hasKeyField = false;
          let hasCommand = false;
          for (const s of rec.samples) {
            if (RESOURCE_FIELDS[s.field]) hasResource = true;
            if (s.field === 'key') hasKeyField = true;
            if (s.inCommand) hasCommand = true;
          }
          let category, level, impact;
          if (hasResource) {
            category = 'resource'; level = 'high'; impact = IMPACT_TEXT.resource;
          } else if (hasKeyField) {
            category = 'property';
            level = hasCommand ? 'mid' : 'low';
            impact = hasCommand ? IMPACT_TEXT.propertyRuntime : IMPACT_TEXT.propertyAsset;
          } else {
            category = 'unknown';
            level = hasCommand ? 'mid' : 'low';
            impact = hasCommand ? IMPACT_TEXT.commandUnknown : IMPACT_TEXT.assetUnknown;
          }
          const first = rec.samples[0] || { file: '', cmdId: '', cmdIndex: -1, field: '' };
          const fileList = Array.from(rec.files.keys());
          const stepText = first.cmdIndex >= 0 ? ('第 ' + (first.cmdIndex + 1) + ' 步指令 ') : '';
          brokenList.push({
            kind: 'broken',
            guid: rec.guid,
            file: first.file,
            cmdId: first.cmdId,
            cmdIndex: first.cmdIndex,
            field: first.field,
            count: rec.count,
            fileCount: fileList.length,
            files: fileList.slice(0, 10),
            category: category,
            level: level,
            impact: impact,
            desc: stepText + '引用了已不存在的 ID (' + rec.guid + ')'
          });
        }
        brokenList.sort(function(a, b) { return (b.count - a.count) || a.guid.localeCompare(b.guid); });

        // 废弃事件: type 非保留白名单, 且「全工程任何位置 + 脚本按 GUID/按名字」都找不到引用
        const dead = [];
        for (const ev of this.eventFiles) {
          if (this.reservedTypes.has(ev.type)) continue;
          if (callEventRefs.has(ev.guid)) continue;
          if (refMap.has(ev.guid)) continue;      // 资产/指令/界面绑定里出现过它的 GUID
          if (definedIds.has(ev.guid)) continue;  // 被某处当作 id 定义过 (例如界面元素事件绑定)
          if (scriptRefs.has(ev.guid)) continue;
          if (scriptText && ev.name && scriptText.indexOf(ev.name) >= 0) continue;   // 脚本按名字调用
          dead.push({ guid: ev.guid, name: ev.name, type: ev.type, path: ev.path });
        }

        const levelCount = { high: 0, mid: 0, low: 0 };
        for (const b of brokenList) levelCount[b.level] = (levelCount[b.level] || 0) + 1;

        this.lastResult = {
          ok: true,
          root: this.root,
          stats: {
            files: files.length,
            refs: refCount,
            variables: this.names.size,
            events: this.eventFiles.length,
            missingIds: brokenList.length,   // 折叠后的「有多少种 ID 丢了」
            missingRefs: brokenList.reduce(function(a, b) { return a + b.count; }, 0),
            levels: levelCount
          },
          issues: brokenList.concat(dead.map(function(d) {
            return {
              kind: 'dead',
              guid: d.guid,
              name: d.name,
              type: d.type,
              file: d.path,
              count: 1,
              fileCount: 1,
              files: [d.path],
              category: 'dead',
              level: 'low',
              impact: '这个公共事件没有被任何地方引用（指令、界面绑定、脚本都找不到它）—— 留着不影响运行，可以放心删。',
              desc: '公共事件从未被任何指令或资产调用'
            };
          })),
          scannedAt: Date.now()
        };
        return this.lastResult;
      } catch (e) {
        return { ok: false, reason: 'error', error: String((e && e.message) || e), issues: [] };
      } finally {
        this.scanning = false;
      }
    }
  };

  // ============================================================
  // 当前事件执行栈 (报错定位: 捕获异常时反查「哪个事件第几步」)
  // ============================================================
  const eventExecStack = [];

  // 当前场景中文名 (报错定位与变量告警共用, 从 Scene.binding 反查)
  function currentSceneName() {
    try {
      if (typeof Scene !== 'undefined' && Scene && Scene.binding) {
        const sId = Scene.binding.id;
        if (sId && projectAudit.names && projectAudit.names.has(sId)) {
          return projectAudit.names.get(sId).name;
        }
        if (Scene.binding.data) {
          const sPath = Scene.binding.data.path || '';
          const sFile = String(sPath).split('/').pop() || '';
          return sFile.replace(/\.([0-9a-f]{16})\.scene$/, '').replace(/\.scene$/, '');
        }
      }
    } catch (e) {}
    return '';
  }

  function currentEventContext() {
    try {
      const top = eventExecStack[eventExecStack.length - 1];
      if (!top || !top.ev) return null;
      const ev = top.ev;
      const initial = ev.initial || ev.commands || {};
      const p = ev.path || initial.path || '';
      const file = String(p || '').split('/').pop() || '';
      const idx = typeof ev.index === 'number' ? ev.index : 0;
      const eventName = resolveEventNameFromPath(file) || '未知事件';

      return {
        eventName: eventName,
        eventFile: file,
        eventType: ev.type || initial.type || '',
        step: idx,
        sceneName: currentSceneName()
      };
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // 事件黑匣子 (Event Black Box): 指令级时间线 + 幽灵事件侦探
  // ------------------------------------------------------------
  // 引擎事实依据 (arpg-ts-chinese 模板源码, 逐条核对过):
  //   · event.ts:766  EventHandler.call 是所有事件启动的唯一入口 (全局/角色/界面/触发器事件全部经此)
  //   · event.ts:654  update() 把「当前指令列表 + 索引」写回 this.commands / this.index (索引指向下一条)
  //   · event.ts:681  wait() → EventTimer.tick (timer.duration 逐帧倒计时)
  //   · event.ts:690  pause() 把 update 换成 EventHandler.wait; event.ts:703 finish() 换成 complete
  //   · event.ts:88   引擎初始化读完数据即 delete Data.events → 运行时无法再从 Data 反查原始指令
  //   · command.ts:120 compile() 把「原始指令数据」编译成「指令函数数组」, 禁用指令(! 前缀)不编译、
  //                   showChoices/block 等一条指令会产出多个槽位 → 编译下标 ≠ 原始下标
  //   因此本模块在编译期建立「原始指令 ↔ 编译槽位」精确映射, 运行时即可把 event.index 翻译回
  //   「事件第几步 + 那条指令在做什么」, 全程零磁盘 I/O、零引擎源码改动、零额外渲染开销。
  // ============================================================
  const EVENT_TIMELINE_MAX = 20;         // 事件流水保留条数 (蓝图: 最近 20 步)
  const EVENT_ENTRY_MERGE_MS = 600;      // 同名同动作条目合并窗口, 防高频事件把流水冲垮
  const EVENT_RUN_ENTRY_MIN_MS = 400;    // 同一事件的「执行」条目最小间隔
  const EVENT_GHOST_SUSPEND_MS = 60000;  // 挂起超过 60 秒 → 疑似滞留
  const EVENT_SUSPEND_IDLE_MS = 1000;    // 指令索引超过 1 秒没推进 → 挂起(等外部条件)
  const EVENT_DRIVEN_WINDOW_MS = 1500;   // 判定「事件是否仍在被每帧驱动」的时间窗
  const EVENT_LIVE_MAX = 200;            // 同时在册事件上限 (极端泄漏场景下的内存护栏)
  const EVENT_SCAN_MIN_MS = 80;          // 状态扫描节流 (每帧调用也只按 80ms 落地)

  // 宿主对象类型 → 小白白话 (禁止把 UIElement/GlobalActor 之类英文枚举直接透给用户, 铁律⑱)
  const EVENT_HOST_LABEL = {
    Actor: '角色',
    GlobalActor: '全局角色',
    UIElement: '界面元素',
    Trigger: '触发器',
    SceneObject: '场景对象',
    SceneRegion: '触发区域',
    SceneLight: '光源',
    SceneTilemap: '地图图层',
    SceneParallax: '视差层',
    SceneAnimation: '场景动画',
    Skill: '技能',
    State: '状态',
    Equipment: '装备',
    Item: '物品'
  };

  // 指令白话名表 (引擎 command.ts 编译器方法名 → 制作者能看懂的动作)
  const COMMAND_PLAIN = {
    showText: '显示文本', showChoices: '弹出选项', wait: '等待', setNumber: '设置数值',
    setString: '设置文本', setBoolean: '设置开关', deleteVariable: '删除变量',
    comment: '注释（不执行）', block: '指令块', independent: '独立事件', transition: '数值渐变',
    'if': '条件判断', loop: '循环', break: '跳出循环', 'continue': '继续循环',
    label: '流程标签', jumpTo: '跳转流程', return: '返回',
    callEvent: '调用公共事件', setEvent: '修改公共事件开关', registerEvent: '注册事件', stopEvent: '停止事件',
    playAudio: '播放音效', stopAudio: '停止音效', setVolume: '调整音量', setPan: '调整声场',
    setReverb: '调整混响', setLoop: '设置循环播放', saveAudio: '记录音量状态', restoreAudio: '恢复音量状态',
    playAnimation: '播放动画', setAnimation: '设置场景动画', playActorAnimation: '播放角色动画',
    stopActorAnimation: '停止角色动画', setObjectAnimation: '设置角色动画',
    createActor: '创建角色', deleteActor: '删除角色', moveActor: '移动角色', translateActor: '瞬移角色',
    followActor: '跟随角色', setMovementSpeed: '设置移动速度', setAngle: '设置朝向', fixAngle: '锁定朝向',
    setActive: '启用或禁用对象', setWeight: '设置权重', changeThreat: '调整仇恨值',
    changeActorState: '修改角色状态', changeActorTeam: '修改角色阵营', changeActorSkill: '修改角色技能',
    changeActorEquipment: '修改角色装备', changeActorPortrait: '修改角色头像', changeActorSprite: '修改角色精灵图',
    changeActorMotion: '修改角色动作', changePassableTerrain: '修改通行地形',
    createGlobalActor: '创建全局角色', transferGlobalActor: '转移全局角色', deleteGlobalActor: '删除全局角色',
    castSkill: '施放技能', setSkill: '设置技能', setPlayerActor: '设置主角', setPartyMember: '设置队伍成员',
    loadScene: '加载场景', loadSubscene: '加载子场景', unloadSubscene: '卸载子场景',
    activateScene: '激活场景', deleteScene: '删除场景', setTerrain: '设置地形', setTile: '设置图块',
    deleteTile: '删除图块', moveCamera: '移动镜头', clampCamera: '限制镜头范围', unclampCamera: '解除镜头限制',
    setZoomFactor: '设置缩放', setAmbientLight: '设置环境光', tintScreen: '画面变色', shakeScreen: '震屏',
    createElement: '创建界面元素', deleteElement: '删除界面元素', setText: '设置界面文本',
    setTextBox: '设置文本框', setDialogBox: '设置对话框', setImage: '设置界面图片',
    controlDialog: '控制对话框', setProgressBar: '设置进度条', setButton: '设置按钮',
    controlButton: '控制按钮', setVideo: '播放视频', waitForVideo: '等待视频结束', setWindow: '操作窗口',
    createObject: '创建对象', deleteObject: '删除对象', createTrigger: '创建触发器',
    setTriggerSpeed: '设置触发器速度', setTriggerAngle: '设置触发器角度', setTriggerDuration: '设置触发器时长',
    setInventory: '设置背包', useItem: '使用物品', setItem: '设置物品', setCooldown: '设置冷却',
    setShortcut: '设置快捷键', setTeamRelation: '设置阵营关系', getObjectProperty: '读取对象属性',
    setObjectProperty: '设置对象属性', requestURL: '网络请求', downloadFile: '下载文件', uploadFile: '上传文件',
    httpRequest: 'HTTP 请求', webSocketConnect: '连接网络长连接', webSocketSend: '发送网络消息',
    webSocketClose: '断开网络长连接', setGameSpeed: '设置游戏速度', pauseGame: '暂停游戏',
    continueGame: '继续游戏', preventSceneInput: '屏蔽场景输入', restoreSceneInput: '恢复场景输入',
    setCursor: '设置鼠标指针', simulateKey: '模拟按键', setLanguage: '切换语言',
    setResolution: '设置分辨率', commandLine: '执行命令行', relaunchApp: '重启应用', script: '执行脚本',
    setPixelRatio: '设置像素比', switchCollisionSystem: '切换碰撞系统', discardTargets: '清空目标列表',
    detectTargets: '检测目标', resetTargets: '重置目标', renderOutline: '描边显示',
    gameData: '读写游戏数据'
  };

  // 编译期追踪: 编译结果(指令函数列表) → { 原始指令数据, 原始下标 → 编译槽位 }
  const eventTrace = {
    hooked: false,
    compiler: null,
    byList: new WeakMap(),
    frames: []
  };

  // 事件时间线运行时状态
  const eventTimeline = {
    seq: 0,
    entries: [],
    live: new Map(),
    callHooked: false,
    lastScanAt: 0
  };

  // 推进「下一条待编译原始指令」游标: 已编译函数直接占 1 槽, 禁用指令与脏数据不占槽
  function eventTraceAdvance(frame) {
    const raw = frame.raw;
    while (frame.cursor < raw.length) {
      const item = raw[frame.cursor];
      const rawIndex = frame.cursor++;
      if (typeof item === 'function') { frame.slots++; continue; }
      if (!item || typeof item.id !== 'string') continue;
      if (item.id[0] === '!') continue;
      frame.pending = {
        id: item.id,
        rawIndex: rawIndex,
        kind: (eventTrace.compiler && (item.id in eventTrace.compiler)) ? 'method' : 'script'
      };
      return;
    }
    frame.pending = null;
  }

  // 包裹单条指令编译器: 只有「当前待编译原始指令的 id 正好等于本次调用」才会计账,
  // 因此编译器内部的辅助调用 (compileActor / compileNumber / compileJumps...) 一律不干扰映射
  function wrapCommandCompiler(name, orig) {
    const wrapper = function () {
      const frame = eventTrace.frames.length ? eventTrace.frames[eventTrace.frames.length - 1] : null;
      if (frame && frame.pending) {
        const pending = frame.pending;
        const hit = (pending.kind === 'method' && pending.id === name)
          || (pending.kind === 'script' && name === 'compileScript');
        if (hit) {
          frame.pending = null; // 先清空 → 内部嵌套 compile 不会误认这一条
          const produced = orig.apply(this, arguments);
          const count = (typeof produced === 'function') ? 1 : (Array.isArray(produced) ? produced.length : 0);
          frame.map[pending.rawIndex] = { slot: frame.slots, count: count };
          frame.slots += count;
          eventTraceAdvance(frame);
          return produced;
        }
      }
      return orig.apply(this, arguments);
    };
    wrapper.__yamiEventTraceWrapped__ = true;
    return wrapper;
  }

  // 安装编译期指令映射 (必须早于工程数据编译完成; 未就绪时返回 false 由 refresh 重试)
  function installEventTrace() {
    if (eventTrace.hooked) return true;
    try {
      if (typeof Command === 'undefined' || !Command || typeof Command.compile !== 'function') return false;
      const compiler = Command;
      eventTrace.compiler = compiler;
      const proto = Object.getPrototypeOf(compiler);
      const skip = { constructor: true, compile: true, compileIndependent: true };
      const keys = [];
      try { keys.push.apply(keys, Object.getOwnPropertyNames(proto)); } catch (e) {}
      // setNumber / setString / setBoolean 等由类字段初始化, 属于实例自有属性而非原型方法
      try { keys.push.apply(keys, Object.keys(compiler)); } catch (e) {}
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (skip[key]) continue;
        let holder = null;
        try {
          if (Object.prototype.hasOwnProperty.call(compiler, key)) {
            if (typeof compiler[key] === 'function') holder = compiler;
          } else if (typeof compiler[key] === 'function') {
            holder = proto;
          }
        } catch (e) { holder = null; }
        if (!holder) continue;
        const orig = holder[key];
        if (typeof orig !== 'function' || orig.__yamiEventTraceWrapped__) continue;
        try { holder[key] = wrapCommandCompiler(key, orig); } catch (e) {}
      }
      // 顶层编译入口: 每个编译结果登记「原始指令 → 槽位」映射表 (嵌套分支各自登记各自的表)
      const origCompile = compiler.compile;
      compiler.compile = function (commands) {
        const frame = {
          raw: (commands && typeof commands.length === 'number') ? commands : [],
          cursor: 0,
          slots: 0,
          map: [],
          pending: null
        };
        eventTrace.frames.push(frame);
        let out;
        try {
          eventTraceAdvance(frame);
          out = origCompile.apply(this, arguments);
        } finally {
          eventTrace.frames.pop();
        }
        try {
          if (out && typeof out === 'object') {
            eventTrace.byList.set(out, {
              path: (commands && commands.path) || '',
              raw: frame.raw,
              map: frame.map,
              slots: frame.slots,
              slotToRaw: null
            });
          }
        } catch (e) {}
        return out;
      };
      eventTrace.hooked = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  // 事件启动钩子: 引擎所有事件都经 EventHandler.call 起步, 在此登记在册
  function installEventCallHook() {
    if (eventTimeline.callHooked) return true;
    try {
      if (typeof EventHandler === 'undefined' || !EventHandler || typeof EventHandler.call !== 'function') return false;
      const origCall = EventHandler.call;
      EventHandler.call = function (event) {
        const result = origCall.apply(this, arguments);
        try { registerLiveEvent(event); } catch (e) {}
        return result;
      };
      eventTimeline.callHooked = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  function eventTypeOf(ev) {
    try {
      const initial = ev.initial || {};
      const type = ev.type || initial.type || '';
      if (type) return type;
      // 引擎数据层是在编译「之后」才把 type/path 挂到指令列表上的; 实例上暂时取不到时,
      // 回退到编译期留存的原始指令数据 (eventTrace 已存 raw 列表)
      const list = ev.commands || ev.initial;
      const traced = list ? eventTrace.byList.get(list) : null;
      const rawType = traced && traced.raw ? traced.raw.type : '';
      return typeof rawType === 'string' ? rawType : '';
    } catch (e) { return ''; }
  }

  function eventNameOf(ev) {
    try {
      const list = ev.commands || ev.initial;
      const traced = list ? eventTrace.byList.get(list) : null;
      const p = ev.path || (ev.initial && ev.initial.path) || (traced && traced.path) || '';
      const file = String(p || '').split('/').pop() || '';
      const resolved = resolveEventNameFromPath(file);
      if (resolved) return resolved;
      const type = eventTypeOf(ev);
      return type ? (type + ' 事件') : '未知事件';
    } catch (e) { return '未知事件'; }
  }

  // 宿主描述: 角色「勇者」/ 界面元素 / 触发器… (英文类名一律经中文映射后再进界面)
  // 优先用 instanceof 判别 (类名在压缩构建下可能被改名), 类名映射仅作兜底
  function eventHostKind(host) {
    try {
      if (typeof GlobalActor !== 'undefined' && GlobalActor && host instanceof GlobalActor) return '全局角色';
      if (typeof Actor !== 'undefined' && Actor && host instanceof Actor) return '角色';
      if (typeof UIElement !== 'undefined' && UIElement && host instanceof UIElement) return '界面元素';
      if (typeof Trigger !== 'undefined' && Trigger && host instanceof Trigger) return '触发器';
      if (typeof SceneRegion !== 'undefined' && SceneRegion && host instanceof SceneRegion) return '触发区域';
      if (typeof SceneLight !== 'undefined' && SceneLight && host instanceof SceneLight) return '光源';
      if (typeof SceneTilemap !== 'undefined' && SceneTilemap && host instanceof SceneTilemap) return '地图图层';
      if (typeof SceneParallax !== 'undefined' && SceneParallax && host instanceof SceneParallax) return '视差层';
      if (typeof Skill !== 'undefined' && Skill && host instanceof Skill) return '技能';
      if (typeof State !== 'undefined' && State && host instanceof State) return '状态';
      if (typeof Equipment !== 'undefined' && Equipment && host instanceof Equipment) return '装备';
      if (typeof Item !== 'undefined' && Item && host instanceof Item) return '物品';
    } catch (e) {}
    const ctor = (host && host.constructor && host.constructor.name) ? host.constructor.name : '';
    return EVENT_HOST_LABEL[ctor] || '对象';
  }

  function eventHostLabel(ev) {
    try {
      const host = ev.parent;
      if (!host) return '';
      const kind = eventHostKind(host);
      const rawName = host.name || (host.data && host.data.name) || '';
      const name = typeof rawName === 'string' ? rawName : '';
      return name ? (kind + '「' + name + '」') : kind;
    } catch (e) { return ''; }
  }

  // 当前实现体 (被探针包装时取包装前的原始实现)
  function eventImplOf(ev) {
    try {
      if (ev.__yamiEventWrapperRef__ && ev.update === ev.__yamiEventWrapperRef__) return ev.__yamiEventImplRef__;
      return ev.update;
    } catch (e) { return null; }
  }

  // 事件状态判定: 完成 / 暂停(等继续) / 等待计时 / 挂起(等外部条件) / 执行中
  // 注意: 引擎 EventHandler.prototype.update 返回的是 this.complete, 事件未跑完时**每帧都返回 false**,
  // 因此不能拿「返回 false」当挂起依据 —— 真正的信号是「指令索引多久没有推进」。
  function eventStateOf(ev, rec) {
    try {
      if (ev.complete === true) return { kind: 'done' };
      const cls = ev.constructor;
      const impl = eventImplOf(ev);
      if (cls && impl === cls.wait) return { kind: 'paused' };
      if (cls && impl === cls.complete) return { kind: 'done' };
      const timer = ev.timer;
      if (timer && typeof timer.duration === 'number' && timer.duration > 0) {
        return { kind: 'waiting', remainMs: Math.round(timer.duration) };
      }
      const nowMs = Date.now();
      const progressAt = Number(ev.__yamiEventProgressAt__) || 0;
      const since = progressAt || (rec ? rec.startedAt : 0) || nowMs;
      const idleMs = Math.max(0, nowMs - since);
      if (idleMs >= EVENT_SUSPEND_IDLE_MS) {
        return { kind: 'suspended', idleMs: idleMs };
      }
      return { kind: 'running', idleMs: idleMs };
    } catch (e) {
      return { kind: 'unknown' };
    }
  }

  // 变量引用可能是 GUID 字符串, 也可能是 {type:'global', key} 包装 —— 统一抽出 GUID 供界面解密为中文名
  function commandVarKey(variable) {
    try {
      if (!variable) return '';
      if (typeof variable === 'string') return /^[0-9a-f]{16}$/.test(variable) ? variable : '';
      if (typeof variable === 'object') {
        const key = variable.key || variable.variable || variable.id || '';
        return (typeof key === 'string' && /^[0-9a-f]{16}$/.test(key)) ? key : '';
      }
    } catch (e) {}
    return '';
  }

  // 原始指令 → 白话描述
  function describeEventCommand(raw) {
    const out = { text: '', varKey: '' };
    try {
      if (!raw || typeof raw.id !== 'string') return out;
      const id = raw.id;
      const params = raw.params || {};
      const base = COMMAND_PLAIN[id] || '';
      switch (id) {
        case 'wait': {
          const d = params.duration;
          out.text = (typeof d === 'number') ? ('等待 ' + Math.round(d) + ' 毫秒') : '等待一段时间';
          return out;
        }
        case 'showText': {
          const text = String(params.content == null ? '' : params.content)
            .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
          out.text = text ? ('显示文本「' + (text.length > 12 ? text.slice(0, 12) + '…' : text) + '」') : '显示文本';
          return out;
        }
        case 'showChoices': {
          const n = Array.isArray(params.choices) ? params.choices.length : 0;
          out.text = n > 0 ? ('弹出选项（' + n + ' 项）') : '弹出选项';
          return out;
        }
        case 'setNumber':
        case 'setString':
        case 'setBoolean':
        case 'deleteVariable': {
          out.text = base || '修改变量';
          out.varKey = commandVarKey(params.variable);
          return out;
        }
        default: {
          out.text = base || '执行事件指令';
          return out;
        }
      }
    } catch (e) {
      return out;
    }
  }

  // event.index 指向「下一条」, 故当前那条 = index - 1; 再经编译映射翻译回原始指令下标
  // 编译槽位 → 原始指令下标 (惰性建表缓存; 一条指令可占多槽, 空槽位返回 undefined)
  function eventTraceSlotToRaw(info, slot) {
    if (!info || slot < 0) return undefined;
    if (!info.slotToRaw) {
      const table = [];
      for (let i = 0; i < info.map.length; i++) {
        const m = info.map[i];
        if (!m || m.count <= 0) continue;
        for (let s = 0; s < m.count; s++) table[m.slot + s] = i;
      }
      info.slotToRaw = table;
    }
    return info.slotToRaw[slot];
  }

  function eventStepInfo(ev) {
    const out = { step: 0, total: 0, desc: '', varKey: '', traced: false };
    try {
      const list = ev.commands || ev.initial;
      const index = typeof ev.index === 'number' ? ev.index : 0;
      const slot = index - 1;
      if (slot < 0 || !list) return out;
      const info = eventTrace.byList.get(list);
      if (!info) {
        out.step = slot + 1;
        return out;
      }
      out.traced = true;
      out.total = info.raw ? info.raw.length : 0;
      const rawIndex = eventTraceSlotToRaw(info, slot);
      if (typeof rawIndex !== 'number') {
        out.step = slot + 1;
        return out;
      }
      out.step = rawIndex + 1;
      const described = describeEventCommand(info.raw[rawIndex]);
      out.desc = described.text;
      out.varKey = described.varKey;
      return out;
    } catch (e) {
      return out;
    }
  }

  // 「这件事是谁干的」 —— 供变量告警等诊断复用:
  // 引擎的 while (CommandList[CommandIndex++]?.()) 会把游标推过当前这条指令, 故当前指令槽 = CommandIndex - 1;
  // 再经编译期映射表翻译成原始第几步 + 白话指令。取不到引擎游标时, 回退到事件实例上的 index。
  function currentEventLocation() {
    const out = { eventName: '', sceneName: '', step: 0, total: 0, desc: '', varKey: '', located: false };
    try {
      const top = eventExecStack.length ? eventExecStack[eventExecStack.length - 1] : null;
      const ev = top ? top.ev : null;
      let list = null;
      let slot = -1;
      try {
        if (typeof CommandList !== 'undefined' && CommandList && typeof CommandIndex === 'number') {
          list = CommandList;
          slot = CommandIndex - 1;
        }
      } catch (eGlobal) { list = null; }
      if (!list && ev) {
        list = ev.commands || ev.initial;
        slot = (typeof ev.index === 'number' ? ev.index : 0) - 1;
      }
      if (ev) {
        out.eventName = eventNameOf(ev);
        out.sceneName = currentSceneName();
      }
      if (!list || slot < 0) return out;
      const info = eventTrace.byList.get(list);
      if (!info) return out;
      out.total = info.raw ? info.raw.length : 0;
      const rawIndex = eventTraceSlotToRaw(info, slot);
      if (typeof rawIndex !== 'number') return out;
      out.step = rawIndex + 1;
      const described = describeEventCommand(info.raw[rawIndex]);
      out.desc = described.text;
      out.varKey = described.varKey;
      out.located = out.step > 0;
      return out;
    } catch (e) {
      return out;
    }
  }

  // 写入一条事件流水 (同名同动作同步骤在 600ms 内自动合并计数, 杜绝高频事件刷屏)
  function pushEventEntry(rec, action, extra) {
    try {
      const time = Date.now();
      const step = (extra && extra.step) || 0;
      const desc = (extra && extra.desc) || '';
      const remainMs = (extra && extra.remainMs) || 0;
      const last = eventTimeline.entries.length ? eventTimeline.entries[eventTimeline.entries.length - 1] : null;
      if (last && last.action === action && last.name === rec.name && last.step === step
        && last.desc === desc && time - last.time < EVENT_ENTRY_MERGE_MS) {
        last.count = (last.count || 1) + 1;
        last.time = time;
        return last;
      }
      const entry = {
        id: ++eventTimeline.seq,
        time: time,
        eventId: rec.id,
        name: rec.name,
        type: rec.type,
        host: rec.host,
        action: action || 'run',
        step: step,
        total: (extra && extra.total) || 0,
        desc: desc,
        varKey: (extra && extra.varKey) || '',
        remainMs: remainMs,
        count: 1
      };
      eventTimeline.entries.push(entry);
      if (eventTimeline.entries.length > EVENT_TIMELINE_MAX) eventTimeline.entries.shift();
      return entry;
    } catch (e) {
      return null;
    }
  }

  function registerLiveEvent(ev) {
    try {
      if (!ev || typeof ev !== 'object') return null;
      const existed = eventTimeline.live.get(ev);
      if (existed) return existed;
      if (eventTimeline.live.size >= EVENT_LIVE_MAX) return null;
      wrapEventInstance(ev);
      const rec = {
        id: ++eventTimeline.seq,
        ev: ev,
        name: eventNameOf(ev),
        type: eventTypeOf(ev),
        host: eventHostLabel(ev),
        startedAt: Date.now(),
        changedAt: Date.now(),
        state: '',
        stateKey: '',
        step: 0,
        total: 0,
        desc: '',
        varKey: '',
        remainMs: 0,
        lastRunAt: 0
      };
      eventTimeline.live.set(ev, rec);
      pushEventEntry(rec, 'start', eventStepInfo(ev));
      return rec;
    } catch (e) {
      return null;
    }
  }

  // 幽灵判定: 宿主已被销毁(严重) 或 长时间挂起无进展(疑似滞留)
  function eventGhostInfo(rec, nowMs) {
    const info = { ghost: false, hostGone: false, stale: false, suspendMs: 0, driven: false };
    try {
      const host = rec.ev && rec.ev.parent;
      if (host && host.destroyed === true) info.hostGone = true;
      // 事件是否仍在被每帧驱动 (宿主销毁后常被移出更新器 → 彻底停更, 属更严重的滞留)
      const blockedAt = Number(rec.ev && rec.ev.__yamiEventBlockedAt__) || 0;
      info.driven = blockedAt > 0 && (nowMs - blockedAt) < EVENT_DRIVEN_WINDOW_MS;
      if (rec.state === 'paused' || rec.state === 'suspended') {
        info.suspendMs = Math.max(rec.idleMs || 0, nowMs - rec.changedAt);
        info.stale = info.suspendMs >= EVENT_GHOST_SUSPEND_MS;
      } else if (rec.state === 'waiting') {
        info.suspendMs = Math.max(0, nowMs - rec.changedAt);
      }
      info.ghost = info.hostGone || info.stale;
      return info;
    } catch (e) {
      return info;
    }
  }

  function scanEventTimeline(force) {
    try {
      if (!eventTrace.hooked) installEventTrace();
      if (!eventTimeline.callHooked) installEventCallHook();
      const nowMs = Date.now();
      if (!force && nowMs - eventTimeline.lastScanAt < EVENT_SCAN_MIN_MS) return;
      eventTimeline.lastScanAt = nowMs;

      // 1) 补齐在册: 钩子安装之前就启动、或挂在更新器上的事件
      try {
        if (typeof EventManager !== 'undefined' && EventManager && EventManager.activeEvents) {
          const list = EventManager.activeEvents;
          for (let i = 0; i < list.length; i++) registerLiveEvent(list[i]);
        }
      } catch (e) {}

      // 2) 状态推进与状态迁移入流水
      const finished = [];
      eventTimeline.live.forEach(function (rec, ev) {
        const st = eventStateOf(ev, rec);
        const step = eventStepInfo(ev);
        if (st.kind === 'done') {
          if (rec.state !== 'done') rec.state = 'done';
          finished.push(rec);
          return;
        }
        const key = st.kind + '|' + step.step;
        if (key !== rec.stateKey) {
          rec.stateKey = key;
          rec.changedAt = nowMs;
          if (st.kind === 'waiting') {
            pushEventEntry(rec, 'wait', { step: step.step, total: step.total, desc: step.desc, varKey: step.varKey, remainMs: st.remainMs });
          } else if (st.kind === 'paused') {
            pushEventEntry(rec, 'pause', step);
          } else if (st.kind === 'suspended') {
            pushEventEntry(rec, 'suspend', step);
          }
        }
        if (st.kind === 'running' && step.step > 0 && nowMs - rec.lastRunAt >= EVENT_RUN_ENTRY_MIN_MS) {
          rec.lastRunAt = nowMs;
          pushEventEntry(rec, 'run', step);
        }
        rec.state = st.kind;
        rec.step = step.step;
        rec.total = step.total;
        rec.desc = step.desc;
        rec.varKey = step.varKey;
        rec.remainMs = st.remainMs || 0;
        rec.idleMs = st.idleMs || 0;
      });

      // 3) 已结束的事件写一条「结束」并释放强引用 (长时挂机不积压)
      for (let i = 0; i < finished.length; i++) {
        const rec = finished[i];
        pushEventEntry(rec, 'end', { step: rec.step, total: rec.total, desc: rec.desc, varKey: rec.varKey });
        eventTimeline.live.delete(rec.ev);
        rec.ev = null;
      }

      // 4) 在册上限护栏
      if (eventTimeline.live.size > EVENT_LIVE_MAX) {
        let drop = eventTimeline.live.size - EVENT_LIVE_MAX;
        eventTimeline.live.forEach(function (rec, ev) {
          if (drop <= 0) return;
          drop--;
          eventTimeline.live.delete(ev);
          rec.ev = null;
        });
      }
    } catch (e) {}
  }

  // 事件黑匣子对外快照 (读一次即扫描一次, 保证界面与真机状态一致)
  function getEventBlackbox() {
    try { scanEventTimeline(true); } catch (e) {}
    const nowMs = Date.now();
    const active = [];
    try {
      eventTimeline.live.forEach(function (rec) {
        if (!rec.ev) return;
        const ghost = eventGhostInfo(rec, nowMs);
        active.push({
          id: rec.id,
          name: rec.name,
          type: rec.type,
          host: rec.host,
          state: rec.state || 'running',
          step: rec.step,
          total: rec.total,
          desc: rec.desc,
          varKey: rec.varKey,
          remainMs: rec.remainMs,
          runningMs: Math.max(0, nowMs - rec.startedAt),
          idleMs: rec.idleMs || 0,
          driven: ghost.driven,
          suspendMs: ghost.suspendMs,
          hostGone: ghost.hostGone,
          stale: ghost.stale,
          ghost: ghost.ghost
        });
      });
    } catch (e) {}
    active.sort(function (a, b) {
      const ga = a.ghost ? 1 : 0;
      const gb = b.ghost ? 1 : 0;
      if (ga !== gb) return gb - ga;
      return b.suspendMs - a.suspendMs;
    });
    let ghostCount = 0;
    for (let i = 0; i < active.length; i++) { if (active[i].ghost) ghostCount++; }
    return {
      ok: true,
      trace: eventTrace.hooked,
      callHooked: eventTimeline.callHooked,
      entries: eventTimeline.entries.slice().reverse(),
      active: active,
      ghostCount: ghostCount,
      thresholds: { suspendMs: EVENT_GHOST_SUSPEND_MS, maxEntries: EVENT_TIMELINE_MAX }
    };
  }

  // 一键结束滞留事件: 调引擎原生 event.finish() 触发结束回调与引用摘除
  function finishEventById(id) {
    try {
      const target = Number(id);
      let hit = null;
      eventTimeline.live.forEach(function (rec) {
        if (!hit && rec.id === target && rec.ev) hit = rec;
      });
      if (!hit || !hit.ev || typeof hit.ev.finish !== 'function') return false;
      hit.ev.finish();
      pushEventEntry(hit, 'end', { step: hit.step, total: hit.total, desc: hit.desc, varKey: hit.varKey });
      eventTimeline.live.delete(hit.ev);
      hit.ev = null;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  // 控制台异常与后台错误黑匣子分析引擎 (Error Analyzer)
  // ============================================================
  
  // 源码上下文缓存: 同一 文件+行号 只读盘一次 (死循环报错场景下的同步 I/O 防护)
  const codeContextCache = new Map();

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

      const cacheKey = targetPath + ':' + targetLine;
      if (codeContextCache.has(cacheKey)) return codeContextCache.get(cacheKey);

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

      // 行号越界 (磁盘文件与报错产物不一致时) → 返回 null，避免 UI 出现「有按钮但展开是空白」
      if (snippetLines.length === 0) {
        codeContextCache.set(cacheKey, null);
        return null;
      }

      const result = {
        filePath: targetPath,
        fileName: path.basename(targetPath),
        targetLine: targetLine,
        lines: snippetLines
      };
      if (codeContextCache.size > 50) codeContextCache.clear();
      codeContextCache.set(cacheKey, result);
      return result;
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
      // 仅在该指纹首次缺失上下文时补算一次: 死循环报错每秒 60 次也只会读盘一次
      if (!existing.codeContext) existing.codeContext = extractCodeContext(item.source, item.lineno, item.stack);
      if (!existing.eventContext) existing.eventContext = currentEventContext();

      // 移动至队列最前端 (保持最近发生优先)
      const idx = state.errorHistory.indexOf(existing);
      if (idx > 0) {
        state.errorHistory.splice(idx, 1);
        state.errorHistory.unshift(existing);
      }
      // 聚合错误发生时未读计数封顶为当前实际条数 (上限 100)，杜绝长时死循环无界爆大数
      state.errorUnreadCount = Math.min(state.errorHistory.length, (state.errorUnreadCount || 0) + 1);
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
        codeContext: extractCodeContext(item.source, item.lineno, item.stack),
        eventContext: currentEventContext()
      };
      state.errorHistory.unshift(errRecord);
      if (state.errorHistory.length > 100) state.errorHistory.pop();
      state.errorUnreadCount = Math.min(state.errorHistory.length, (state.errorUnreadCount || 0) + 1);
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
          let text = '';
          // 代理体绝不可向调用方抛异常: 游戏里 console.error(循环引用对象) 曾会反噬业务逻辑
          try {
            const args = Array.prototype.slice.call(arguments);
            text = args.map(function(a) {
              if (typeof a === 'object' && a !== null) {
                if (a.message) return String(a.message);
                if (a.stack) return String(a.stack);
                try { return JSON.stringify(a); } catch (err) { return '[对象: 无法序列化]'; }
              }
              return String(a);
            }).join(' ');
          } catch (err) {
            text = '[日志参数解析失败]';
          }
          if (!/\[yami perf\]/i.test(text)) {
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
    getSceneEntities: getSceneEntities,
    getMemoryInfo: getMemoryInfo,
    // 资源缓存与内存: 只增不减的 Loader 三张表 (统计 + 安全一键清理)
    getCacheInfo: getCacheInfo,
    clearAssetCache: clearAssetCache,
    getActiveEvents: getActiveEventsDetails,
    // 事件黑匣子: 指令级时间线 + 幽灵事件侦探 (读一次即扫描一次)
    getEventBlackbox: getEventBlackbox,
    finishEvent: finishEventById,
    runProjectAudit: function () { return projectAudit.run(); },
    getAuditResult: function () { return projectAudit.lastResult; },
    setProjectRoot: function (dir) { projectAudit.setProjectRoot(dir); },
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
              if (AudioManager.se.gain && AudioManager.se.gain.gain) {
                // 记下玩家/游戏原有音量，还原时不能用硬编码 1 顶掉
                if (typeof state.origSeGain !== 'number') state.origSeGain = AudioManager.se.gain.gain.value;
                AudioManager.se.gain.gain.value = 0;
              }
            } else {
              if (AudioManager.se.gain && AudioManager.se.gain.gain) {
                AudioManager.se.gain.gain.value = (typeof state.origSeGain === 'number') ? state.origSeGain : 1;
                state.origSeGain = null;
              }
            }
          }
        } catch (e) {}
      }
      return state.suspend[kind];
    },
    getSuspend: function () {
      return Object.assign({}, state.suspend);
    },
    getCheats: function () {
      return {
        speedMultiplier: (state.cheats && state.cheats.speedMultiplier) || 1,
        noClip: !!(state.cheats && state.cheats.noClip),
        speedBoost: !!(state.cheats && state.cheats.speedBoost),
        godMode: !!(state.cheats && state.cheats.godMode),
        backgroundDrift: state.backgroundDrift
      };
    },
    setCheat: function (key, value) {
      if (!state.cheats) return;
      if (key === 'speedMultiplier') {
        const num = Number(value) || 1;
        state.cheats.speedMultiplier = num;
        if (typeof Time !== 'undefined' && Time) {
          // 首次改动前记下游戏自身的 timeScale (子弹时间等)，否则「全部还原」会把游戏永久锁在 1x
          if (state.cheats.origTimeScale === null || state.cheats.origTimeScale === undefined) {
            state.cheats.origTimeScale = (typeof Time.timeScale === 'number') ? Time.timeScale : 1;
          }
          if (num === 0.5) {
            Time.timeScale = 0.5;
          } else if (num === 1) {
            Time.timeScale = state.cheats.origTimeScale;
            state.cheats.origTimeScale = null;
          } else {
            Time.timeScale = 1;
          }
        }
      } else if (key in state.cheats) {
        state.cheats[key] = !!value;
      }
      applyCheatsPerFrame();
      return state.cheats[key];
    },
    // 一键全部还原: 关闭所有作弊开关并复原主角原本属性 (发布前防状态残留)
    resetAllCheats: function () {
      if (!state.cheats) return false;
      const c = state.cheats;
      c.speedMultiplier = 1;
      c.noClip = false;
      c.speedBoost = false;
      c.godMode = false;
      c.__inSpeedLoop = false;
      try {
        if (typeof Time !== 'undefined' && Time) {
          // 还原游戏自身 timeScale，而不是硬写 1 (否则游戏原本的慢动作/加速被永久覆盖)
          const orig = (typeof c.origTimeScale === 'number') ? c.origTimeScale : 1;
          Time.timeScale = orig;
        }
        c.origTimeScale = null;
      } catch (e) {}
      // 立即复原一次, 不等下一帧; 原值还原后 applyCheatsPerFrame 会清空 orig*
      applyCheatsPerFrame();
      return true;
    },
    killAllMonsters: function () {
      let count = 0;
      try {
        if (typeof Scene !== 'undefined' && Scene.binding && Scene.actor && Scene.actor.list) {
          const list = Scene.actor.list;
          const player = (typeof Party !== 'undefined' && Party) ? Party.player : null;
          const members = (typeof Party !== 'undefined' && Party && Party.members) ? Party.members : [];
          for (let i = 0; i < list.length; i++) {
            const actor = list[i];
            if (!actor || actor === player || (members && members.indexOf(actor) >= 0)) continue;
            if (actor.attributes) {
              let killed = false;
              for (const k of Object.keys(actor.attributes)) {
                const lk = k.toLowerCase();
                if (lk === 'health' || lk === 'hp' || k === '生命值') {
                  actor.attributes[k] = 0;
                  killed = true;
                }
              }
              if (killed) {
                count++;
                // 真正移除必须走 destroy(): 它内部会 emit('destroy') + GlobalEntityManager.remove + parent.remove
                // (引擎 actor.ts destroy())。只 emit('destroy') 角色仍留在 Scene.actor.list 里继续寻路/占碰撞
                try {
                  if (typeof actor.destroy === 'function') actor.destroy();
                  else if (typeof actor.emit === 'function') actor.emit('destroy');
                } catch (e) {}
              }
            }
          }
        }
      } catch (e) {}
      return count;
    },
    getVariableWarnings: function () {
      return Object.assign({}, state.variableWarnings);
    },
    clearVariableWarning: function (key) {
      if (key) {
        delete state.variableWarnings[key];
      } else {
        state.variableWarnings = {};
      }
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