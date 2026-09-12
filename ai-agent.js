(() => {
  'use strict';
  if (window.__DANJUAN_AI_AGENT__) return;

  const PORT = 5968;
  function sharedToken() {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const dir = path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite');
      const file = path.join(dir, 'agent-token');
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
      fs.mkdirSync(dir, { recursive: true });
      const token = newToken();
      fs.writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
      return token;
    } catch (e) { return localStorage.getItem('danjuan-ai-token') || ''; }
  }
  const state = {
    token: '',
    child: null,
    sessionId: localStorage.getItem('danjuan-ai-session') || ('session-' + Date.now().toString(36)),
    busy: false,
    pending: null,
    mounted: false,
    balance: null,
    abort: null,
    thinkingView: null,
    processFold: null,
    // 繁忙时按发送的行为：queue 排队（默认）/ interrupt 打断当前轮再发这条
    busySend: null,
    // 繁忙时用户打的话：queue = 排队（本轮结束后依次发出），queueSeq 只用来给每项一个稳定 id
    queue: [],
    queueSeq: 0
  };
  state.token = sharedToken();
  localStorage.setItem('danjuan-ai-session', state.sessionId);

  // 当前这一轮的思考过程块与起始时刻（严格模式下必须显式声明，否则出现隐式全局）
  let currentThinkingEl = null;
  let thinkingStartedAt = 0;
  // 思考按「模型轮次」分段：工具调用或正文一到，本段就封口，下一次思考增量另起一段。
  // 以前整回合只有一块，多轮推理（思考→调工具→再思考→…）糊成一堵墙，用户看到的就是
  // "只有一个思考窗口"。分段只影响视图，会话落盘本来就是每轮一条助手消息、各带自己的
  // reasoning_content，所以回放能一一对上。
  // 分段状态机（accept/seal/round）放在渲染核心里：纯逻辑、可单测，面板只负责建块与换缓冲
  let thinkingTotalMs = 0;      // 已封口各段的累计思考耗时（过程区头部用）
  // 当前回合容器：过程区（思考+工具）与正文槽都挂在它下面
  let currentTurn = null;
  // 轮次导航轨道的刷新钩子（面板建好后才有值）
  let refreshRail = null;

  // 逐 token 的流式渲染必须按帧合并：片段再多，一帧也只写一次 DOM。
  // 旧实现每来一个片段就重设全文 + 拉滚动条，是 O(n^2)，上下文一长整页卡死。
  const renderCore = (typeof window !== 'undefined' && window.YamiAiRenderCore) || null;
  // 核心缺失（注入顺序异常/文件缺了）时用同一套语义的内联兜底，绝不能因为少个文件就分不了段
  const createThinkingSegments = (renderCore && typeof renderCore.createThinkingSegments === 'function')
    ? renderCore.createThinkingSegments
    : function () {
        let round = 0;
        let sealed = true;
        return {
          accept: function () { if (!sealed) return 0; sealed = false; round += 1; return round; },
          seal: function () { if (sealed) return false; sealed = true; return true; },
          round: function () { return round; },
          sealed: function () { return sealed; },
          reset: function () { round = 0; sealed = true; }
        };
      };
  const thinkingSegments = createThinkingSegments();
  if (!renderCore) {
    // 缺了它不能让对话变空白：下面所有渲染都会退回直写模式，同时把原因说清楚
    console.warn('[DanJuan AI] 渲染核心 ai-render-core.js 未加载，已退回直写模式（重启编辑器可恢复并拿回性能优化）');
  }
  const scheduler = renderCore ? renderCore.createScheduler() : null;
  const messageList = () => document.getElementById('yami-ai-messages');

  function scheduleRender(fn) {
    if (scheduler) { scheduler.schedule(fn); return; }
    fn();
  }

  /* ------------------------------ 滚动跟随 ------------------------------
   * 状态机在 ai-render-core.js（纯逻辑、可单测），这里只负责接线：
   * scroll/wheel 事件喂意图，内容追加后按它的裁决决定滚不滚。
   * 核心缺失时退回等价的最小实现，保证降级模式下行为一致。 */
  const TAIL_THRESHOLD = 24;   // 距底一行以内算"贴着底"（旧值 80px 会让刚上滚的用户仍被拽回）
  const follow = (renderCore && typeof renderCore.createFollowState === 'function')
    ? renderCore.createFollowState(TAIL_THRESHOLD)
    : {
        follow: true,
        pending: false,
        nearBottom: function (m) { return m.scrollHeight - m.scrollTop - m.clientHeight <= TAIL_THRESHOLD; },
        onScroll: function (m) { this.follow = this.nearBottom(m); if (this.follow) this.pending = false; return this.follow; },
        onUserScrollUp: function () { this.follow = false; return this.follow; },
        onAppend: function () { if (this.follow) { this.pending = false; return 'scroll'; } this.pending = true; return 'hold'; },
        force: function () { this.follow = true; this.pending = false; return 'scroll'; }
      };
  const scrollMetrics = list => ({ scrollHeight: list.scrollHeight, scrollTop: list.scrollTop, clientHeight: list.clientHeight });

  /** 某个滚动容器此刻是否贴着底（思考块内部与主消息区共用同一套阈值） */
  function isNearBottom(el) {
    const metrics = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight };
    if (renderCore && typeof renderCore.shouldStickToBottom === 'function') {
      return renderCore.shouldStickToBottom(metrics, TAIL_THRESHOLD);
    }
    return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= TAIL_THRESHOLD;
  }

  /** 自动跟随最新内容；force=true 用于刚发消息、切会话、清空这类"就该看最新"的时机 */
  function autoScroll(force) {
    const list = messageList();
    if (!list) return;
    const action = force ? follow.force() : follow.onAppend();
    if (action === 'scroll') list.scrollTop = list.scrollHeight;
    updateJumpButton();
  }

  /** 「有新内容」提示：暂停跟随时才出现，点一下回到最新 */
  function updateJumpButton() {
    const btn = document.getElementById('yami-ai-jump');
    if (!btn) return;
    // 这段流式期间每帧都会被调到：只在真的变化时才碰 DOM
    const visible = !follow.follow;
    const display = visible ? 'block' : 'none';
    if (btn.style.display !== display) btn.style.display = display;
    if (!visible) return;
    const text = follow.pending ? '↓ 有新内容' : '↓ 回到最新';
    if (btn.textContent !== text) btn.textContent = text;
  }

  function ensureJumpButton() {
    const list = messageList();
    if (!list) return null;
    const existing = document.getElementById('yami-ai-jump');
    if (existing && existing.isConnected) return existing;
    const btn = document.createElement('div');
    btn.id = 'yami-ai-jump';
    btn.className = 'yami-ai-jump';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', '回到最新内容');
    btn.textContent = '↓ 回到最新';
    btn.style.display = 'none';
    activate(btn, () => autoScroll(true));
    // order 样式把它永远排在消息末尾，不受后续 appendChild 影响
    list.appendChild(btn);
    return btn;
  }

  /** 绑定滚动意图：用户一往上滚就暂停跟随，滚回底部再自动恢复（面板常驻，只需绑一次） */
  function bindFollowScroll() {
    const list = messageList();
    if (!list || list.dataset.followBound === '1') return;
    list.dataset.followBound = '1';
    ensureJumpButton();
    list.addEventListener('scroll', () => {
      const before = follow.follow;
      follow.onScroll(scrollMetrics(list));   // 程序滚到底时这里判定为"贴底"，跟随状态不变
      if (before !== follow.follow) updateJumpButton();
    }, { passive: true });
    // 滚轮是最早、最准的"人要看历史"信号：不等滚出阈值就先松开跟随，
    // 否则刚开始上滚那一下就会被新内容拽回去
    list.addEventListener('wheel', event => {
      if (event.deltaY < 0 && follow.follow) { follow.onUserScrollUp(); updateJumpButton(); }
    }, { passive: true });
    list.addEventListener('touchmove', () => {
      if (follow.follow && !follow.nearBottom(scrollMetrics(list))) { follow.onUserScrollUp(); updateJumpButton(); }
    }, { passive: true });
    list.addEventListener('keydown', event => {
      if (['PageUp', 'ArrowUp', 'Home'].includes(event.key)) { follow.onUserScrollUp(); updateJumpButton(); }
      else if (['PageDown', 'ArrowDown', 'End'].includes(event.key)) autoScroll(true);
    });
  }

  function editorProjectRoot() {
    try {
      // 引擎内部接口：源码版在 window.YamiEngine.File，老打包版直接是 window.File
      const engineFile = (window.YamiEngine && window.YamiEngine.File) || null;
      if (engineFile && typeof engineFile.root === 'string' && engineFile.root) return engineFile.root;
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const configPath = path.join(os.homedir(), '.openyami', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config && config.project) return path.dirname(config.project);
      }
    } catch (e) {}
    return '';
  }

  function pluginRoot() {
    // 主世界有 Node，但不同跑法（源码/dev/打包）工作目录不一样，
    // 所以除了 cwd 再按页面地址反推一份，避免「找不到插件目录」把整个面板卡死
    let pageDerived = '';
    try {
      const href = String(location.href).split('?')[0].split('#')[0];
      if (href.startsWith('file://')) {
        const dir = href.slice(0, href.lastIndexOf('/') + 1);
        pageDerived = decodeURIComponent(dir + '../extension/yami-perf-extension');
      }
    } catch (e) {}
    if (typeof require !== 'function') {
      throw new Error('AI 助手运行在隔离世界（没有 Node 能力）：请重启 Open Yami；若仍如此，说明主世界装载器 bootstrap.js 没生效');
    }
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      pageDerived,
      path.join(process.cwd(), 'extension', 'yami-perf-extension'),
      path.join(process.resourcesPath || '', '..', 'extension', 'yami-perf-extension'),
      'D:/Program Files/Open Yami RPG Editor/extension/yami-perf-extension'
    ].filter(Boolean);
    return candidates.find(dir => fs.existsSync(path.join(dir, 'ai-host.js'))) || '';
  }

  function newToken() {
    try { return require('crypto').randomBytes(24).toString('hex'); } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  }

  async function request(route, body) {
    const response = await fetch('http://127.0.0.1:' + PORT + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'x-yami-agent-token': state.token },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({ ok: false, error: 'AI 助手响应无法解析' }));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'AI 助手请求失败');
    return data;
  }

  async function ensureHost() {
    if (!state.token) {
      state.token = newToken();
      localStorage.setItem('danjuan-ai-token', state.token);
    }
    try { return await request('/status'); } catch (e) {}
    const root = pluginRoot();
    if (!root) throw new Error('找不到插件运行目录（ai-host.js）：确认插件装在 <引擎根>/extension/yami-perf-extension 后重启编辑器');
    const { spawn } = require('child_process');
    state.child = spawn(process.execPath, [require('path').join(root, 'ai-host.js')], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        YAMI_AI_TOKEN: state.token,
        YAMI_AI_PORT: String(PORT),
        YAMI_AI_PARENT_PID: String(process.pid),
        YAMI_PROJECT_ROOT: editorProjectRoot()
      }
    });
    state.child.stderr.on('data', data => console.log('[DanJuan AI]', data.toString().trim()));
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      try { return await request('/status'); } catch (e) {}
    }
    throw new Error('AI 助手启动超时，请重启 Open Yami 后重试');
  }

  function activate(el, handler) {
    el.addEventListener('click', handler);
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handler(event); }
    });
  }

  /** 开一个新回合：过程（思考+工具）集中在上，正文在下，符合"先看过程再看答案"的阅读习惯 */
  function beginTurn() {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return null;
    const root = document.createElement('div');
    root.className = 'yami-ai-turn';
    list.appendChild(root);
    currentTurn = { root, process: null, body: null };
    if (refreshRail) refreshRail();
    return currentTurn;
  }

  function endTurn() { currentTurn = null; }

  /** 过程区：思考过程与工具步骤都收在这里，默认展开、可一键收起成一行 */
  function processArea() {
    if (!currentTurn) return null;
    if (currentTurn.process) return currentTurn.process;
    const box = document.createElement('div');
    box.className = 'yami-ai-process';
    box.dataset.steps = '0';
    const head = document.createElement('div');
    head.className = 'yami-ai-process-head';
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    const title = document.createElement('span');
    title.className = 'yami-ai-process-title';
    title.textContent = '执行过程';
    const meta = document.createElement('span');
    meta.className = 'yami-ai-process-meta';
    const toggle = document.createElement('span');
    toggle.className = 'yami-ai-process-toggle';
    toggle.textContent = '▾';
    head.appendChild(title);
    head.appendChild(meta);
    head.appendChild(toggle);
    const body = document.createElement('div');
    body.className = 'yami-ai-process-body';
    activate(head, event => {
      event.stopPropagation();
      const collapsed = box.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▸' : '▾';
      head.title = collapsed ? '展开执行过程' : '收起执行过程';
    });
    head.title = '收起执行过程';
    box.appendChild(head);
    box.appendChild(body);
    currentTurn.root.appendChild(box);
    currentTurn.process = { box, body, meta, steps: 0 };
    return currentTurn.process;
  }

  /** 过程区头部摘要：思考多久、跑了几步 */
  function refreshProcessMeta() {
    if (!currentTurn || !currentTurn.process) return;
    // 这段在流式过程中每帧都会被调到：计数走变量，绝不去遍历 DOM
    const area = currentTurn.process;
    // 累计口径：已封口各段之和 + 正在写的那段。分段后单看"当前段"的秒数会越来越小，
    // 用户读到的是"这个任务一共想了多久"。
    const liveMs = thinkingStartedAt ? (Date.now() - thinkingStartedAt) : 0;
    const info = {
      seconds: Math.round((thinkingTotalMs + liveMs) / 1000),
      rounds: thinkingSegments.round(),
      steps: area.steps
    };
    // 标题口径与"收起后"共用渲染核心那一份（纯逻辑可单测），免得两处说法不一致；
    // 核心缺失时退回本地拼接 —— 用空标题而不是「已思考」：回合刚开始不该说"已思考"。
    const text = (renderCore && typeof renderCore.processFoldTitle === 'function')
      ? renderCore.processFoldTitle({ seconds: info.seconds, rounds: info.rounds, steps: info.steps, empty: '' })
      : [
          info.seconds > 0 ? '思考 ' + info.seconds + ' 秒' : '',
          info.rounds > 1 ? info.rounds + ' 段' : '',
          info.steps > 0 ? info.steps + ' 步' : ''
        ].filter(Boolean).join(' · ');
    if (area.meta.textContent !== text) area.meta.textContent = text;
  }

  /** 正文槽：过程区之后的位置，AI 的回答写在这里 */
  function messageSlot() {
    if (!currentTurn) return null;
    if (!currentTurn.body) {
      const el = document.createElement('div');
      el.className = 'yami-ai-turn-body';
      currentTurn.root.appendChild(el);
      currentTurn.body = el;
    }
    return currentTurn.body;
  }

  function addMessage(kind, text) {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return null;
    const item = document.createElement('div');
    item.className = 'yami-ai-message ' + kind;
    item.textContent = String(text || '');
    // AI 的回答进当前回合的正文槽（排在过程之后）；历史回放/用户消息直接进列表
    const host = kind === 'assistant' && currentTurn ? (messageSlot() || list) : list;
    host.appendChild(item);
    autoScroll();
    return item;
  }

  function pushNotice(text, mode) {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return null;
    const item = document.createElement('div');
    item.className = 'yami-ai-notice' + (mode ? ' ' + mode : '');
    item.textContent = text;
    const area = currentTurn ? processArea() : null;
    (area ? area.body : list).appendChild(item);
    if (area) { area.steps++; refreshProcessMeta(); }
    autoScroll();
    return item;
  }

  /** 上下文占用指示：让用户随时知道还剩多少预算（对标 Claude Code 的上下文提示） */
  function renderContext(context) {
    const el = document.getElementById('yami-ai-context');
    if (!el) return;
    if (!context) { el.textContent = ''; el.classList.remove('show'); return; }
    // 刻度文案由宿主按 token 与真实窗口算好（label 形如「320k/1M · 32%」），前端只负责显示，
    // 避免两处各算一套、又把字符数当上下文长度糊弄用户
    const suffix = context.summary ? ' · 已压缩' : (context.nearLimit ? ' · 即将自动压缩' : '');
    el.textContent = '上下文 ' + context.label + suffix;
    el.classList.add('show');
    el.classList.toggle('warn', !!context.nearLimit);
    el.title = context.calibrated
      ? '按模型真实用量计（1M token 窗口，占用达到 80% 自动压缩：先精简长工具结果，再折叠成结构化检查点）'
      : '按官方换算估算（中文 0.6 token/字、英文 0.3 token/字符；发起一次对话后改用真实用量）';
  }

  async function refreshContext() {
    try {
      const data = await request('/status?sessionId=' + encodeURIComponent(state.sessionId));
      renderContext(data.context);
    } catch (e) { /* 宿主没起来时不打扰用户 */ }
  }

  /** 会话切换后重建消息区 */
  function clearMessages(placeholder) {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return;
    list.innerHTML = '';
    // 清空会把「回到最新」提示一起清掉，重建一个（否则上滚后就没有回去的入口了）
    ensureJumpButton();
    if (placeholder) addMessage('assistant', placeholder);
    autoScroll(true);
  }

  /** 撤销面板：只列本次对话里 AI 改过的文件，一点即可退回它动手之前 */
  async function renderUndoList() {
    const panel = document.getElementById('yami-ai-undo');
    if (!panel) return;
    panel.innerHTML = '<div class="yami-ai-history-empty">正在读取可回退的改动…</div>';
    panel.classList.add('show');
    try {
      const data = await request('/backups', { sessionId: state.sessionId });
      const files = data.files || [];
      panel.innerHTML = '';
      if (!files.length) {
        const empty = document.createElement('div');
        empty.className = 'yami-ai-history-empty';
        empty.textContent = data.hint || '本次对话还没有修改过工程文件。';
        panel.appendChild(empty);
        return;
      }
      const tip = document.createElement('div');
      tip.className = 'yami-ai-undo-tip';
      tip.textContent = '以下文件在本对话中被 AI 改过。点【撤销】退回它动手之前（回退本身也能再撤回）。';
      panel.appendChild(tip);
      // 当前批量授权（勾过"不再逐条确认"的文件）在此处可随时取消
      try {
        const grantsData = await request('/grants', { sessionId: state.sessionId });
        const grants = grantsData.grants || [];
        if (grants.length) {
          const gbox = document.createElement('div');
          gbox.className = 'yami-ai-grants';
          const ghead = document.createElement('div');
          ghead.className = 'yami-ai-undo-tip';
          ghead.textContent = '已授权本次任务内免逐条确认：';
          gbox.appendChild(ghead);
          for (const grant of grants) {
            const grow = document.createElement('div');
            grow.className = 'yami-ai-grant-row';
            const gtext = document.createElement('span');
            gtext.className = 'yami-ai-undo-path';
            gtext.textContent = (grant.toolLabel || grant.tool) + ' · ' + grant.path;
            const grevoke = document.createElement('div');
            grevoke.className = 'yami-ai-undo-btn';
            grevoke.setAttribute('role', 'button');
            grevoke.setAttribute('tabindex', '0');
            grevoke.textContent = '取消授权';
            activate(grevoke, async () => {
              try {
                await request('/grants', { sessionId: state.sessionId, revoke: grant.key });
                addMessage('system', '已取消该文件的批量授权，之后会重新逐条确认。');
                renderUndoList();
              } catch (e) { addMessage('error', '取消失败：' + e.message); }
            });
            grow.appendChild(gtext);
            grow.appendChild(grevoke);
            gbox.appendChild(grow);
          }
          panel.appendChild(gbox);
        }
      } catch (e) { /* 授权信息读不到不影响撤销列表 */ }
      for (const file of files) {
        const row = document.createElement('div');
        row.className = 'yami-ai-undo-item';
        const info = document.createElement('div');
        info.className = 'yami-ai-undo-info';
        const name = document.createElement('div');
        name.className = 'yami-ai-undo-path';
        name.textContent = file.path;
        const meta = document.createElement('div');
        meta.className = 'yami-ai-history-meta';
        const when = file.oldest ? new Date(file.oldest) : null;
        meta.textContent = '改动前的版本：' + (when ? when.toLocaleString('zh-CN', { hour12: false }) : '未知')
          + ' · 可回退版本 ' + file.backupCount + ' 个';
        info.appendChild(name);
        info.appendChild(meta);
        const btn = document.createElement('div');
        btn.className = 'yami-ai-undo-btn';
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.textContent = '撤销';
        activate(btn, async () => {
          if (state.busy) return;
          btn.textContent = '回退中';
          try {
            const result = await request('/backup-undo', { path: file.path });
            addMessage('system', result.message || ('已回退 ' + file.path));
            if (result.diffStat) pushNotice('回退差异：+' + result.diffStat.added + ' / -' + result.diffStat.removed, 'ok');
            renderUndoList();
          } catch (e) {
            addMessage('error', '回退失败：' + e.message);
            btn.textContent = '撤销';
          }
        });
        row.appendChild(info);
        row.appendChild(btn);
        panel.appendChild(row);
      }
    } catch (e) {
      panel.innerHTML = '<div class="yami-ai-history-empty">读取失败：' + String(e.message || e) + '</div>';
    }
  }

  /** 变更小结卡片：这次到底动了什么、编译过没过、试玩有没有坏、下一步做什么 */
  function renderChangelog(changelog) {
    if (!changelog || !changelog.summary) return;
    const list = document.getElementById('yami-ai-messages');
    if (!list) return;
    const card = document.createElement('div');
    card.className = 'yami-ai-changelog';
    const head = document.createElement('div');
    head.className = 'yami-ai-changelog-head';
    head.textContent = '本次改动小结';
    const line = document.createElement('div');
    line.className = 'yami-ai-changelog-line';
    line.textContent = changelog.headline || '';
    card.appendChild(head);
    card.appendChild(line);
    for (const file of (changelog.files || []).slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'yami-ai-changelog-file';
      const kindText = file.kind === 'created' ? '新建' : file.kind === 'deleted' ? '删除' : '修改';
      const compileText = file.compileOk === undefined ? '' : (file.compileOk ? ' · 编译通过' : ' · 编译未通过');
      row.textContent = '[' + kindText + '] ' + file.path + (file.toolLabel ? '（' + file.toolLabel + '）' : '') + compileText;
      if (file.compileOk === false) row.classList.add('bad');
      card.appendChild(row);
    }
    if (changelog.playtest && changelog.playtest.message) {
      const smoke = document.createElement('div');
      smoke.className = 'yami-ai-changelog-line';
      smoke.textContent = changelog.playtest.message;
      card.appendChild(smoke);
    }
    if (changelog.nextSteps && changelog.nextSteps.length) {
      const next = document.createElement('div');
      next.className = 'yami-ai-changelog-next';
      next.textContent = '建议：' + changelog.nextSteps.slice(0, 3).join('；');
      card.appendChild(next);
    }
    (currentTurn ? (messageSlot() || list) : list).appendChild(card);
    autoScroll();
  }

  /** 任务计划卡片：多步任务有进度骨架，原地刷新 */
  function renderPlan(items, summary) {
    const list = document.getElementById('yami-ai-messages');
    if (!list || !Array.isArray(items) || !items.length) return;
    let card = document.getElementById('yami-ai-plan');
    if (!card || !card.isConnected) {
      card = document.createElement('div');
      card.className = 'yami-ai-plan';
      card.id = 'yami-ai-plan';
      (currentTurn ? (messageSlot() || list) : list).appendChild(card);
    }
    card.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'yami-ai-plan-head';
    const stats = summary || {};
    head.textContent = '任务计划（' + (stats.done || 0) + '/' + (stats.total || items.length) + '）';
    card.appendChild(head);
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'yami-ai-plan-item ' + (item.status || 'pending');
      const mark = item.status === 'done' ? '[完成]' : item.status === 'in_progress' ? '[进行中]' : '[待做]';
      row.textContent = mark + ' ' + item.text;
      card.appendChild(row);
    }
    autoScroll();
  }

  function clearPlan() {
    const card = document.getElementById('yami-ai-plan');
    if (card) card.remove();
  }

  async function renderHistory() {
    const panel = document.getElementById('yami-ai-history');
    if (!panel) return;
    panel.innerHTML = '<div class="yami-ai-history-empty">正在读取历史…</div>';
    panel.classList.add('show');
    try {
      const data = await request('/sessions');
      const sessions = (data.sessions || []).filter(item => item.messageCount > 0);
      if (!sessions.length) {
        panel.innerHTML = '<div class="yami-ai-history-empty">还没有历史对话。每次对话都会自动保存，可随时切回来继续。</div>';
        return;
      }
      panel.innerHTML = '';
      for (const item of sessions) {
        const row = document.createElement('div');
        row.className = 'yami-ai-history-item' + (item.id === state.sessionId ? ' current' : '');
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        const title = document.createElement('div');
        title.className = 'yami-ai-history-title';
        title.textContent = item.title || '新对话';
        const meta = document.createElement('div');
        meta.className = 'yami-ai-history-meta';
        const when = item.updatedAt ? new Date(item.updatedAt) : null;
        meta.textContent = (when ? when.toLocaleString('zh-CN', { hour12: false }) + ' · ' : '') + item.messageCount + ' 条消息';
        const del = document.createElement('div');
        del.className = 'yami-ai-history-del';
        del.setAttribute('role', 'button');
        del.setAttribute('tabindex', '0');
        del.setAttribute('title', '删除这段对话');
        del.textContent = '删除';
        activate(row, () => loadSession(item.id, item.title));
        activate(del, async event => {
          event.stopPropagation();
          try { await request('/session/delete', { sessionId: item.id }); } catch (e) { /* 忽略 */ }
          if (item.id === state.sessionId) startNewSession(false);
          renderHistory();
        });
        row.appendChild(title);
        row.appendChild(meta);
        row.appendChild(del);
        panel.appendChild(row);
      }
    } catch (e) {
      panel.innerHTML = '<div class="yami-ai-history-empty">读取历史失败：' + String(e.message || e) + '</div>';
    }
  }

  async function loadSession(id, title) {
    if (state.busy) return;
    try {
      const data = await request('/session/load', { sessionId: id });
      state.sessionId = data.sessionId || id;
      localStorage.setItem('danjuan-ai-session', state.sessionId);
      state.pending = null;
      endTurn();
      document.getElementById('yami-ai-approval')?.classList.remove('show');
      clearMessages('');
      const all = data.messages || [];
      const win = renderCore ? renderCore.historyWindow(all, 60) : { shown: all, hiddenCount: 0 };
      if (win.hiddenCount) pushNotice('更早的 ' + win.hiddenCount + ' 条消息已折叠（完整记录仍在历史面板里，可随时切回）');
      // 回放要跟实时长得一样：一段思考一块、中间的工具步骤一行不少。
      // 磁盘上每一轮模型调用都是一条助手消息（各带自己的 reasoning_content 与 tool_calls），
      // 所以段边界现成就有；历史块没有"耗时"可算，如实只报字数，不编造秒数。
      let replayRound = 0;
      let lastReplayThinking = null;
      for (const message of win.shown) {
        if (message.role === 'user') { replayRound = 0; lastReplayThinking = null; }
        if (message.reasoning) {
          labelThinkingRound(lastReplayThinking, replayRound);   // 上一段此刻才确定"后面还有段"，补编号
          replayRound += 1;
          lastReplayThinking = appendThinkingBlock(message.reasoning, replayThinkingMeta(replayRound, message.reasoning.length));
          markThinkingLabeled(lastReplayThinking, replayRound >= 2);
        }
        if (Array.isArray(message.steps)) {
          for (const step of message.steps) pushNotice('执行：' + step);
        }
        // 纯工具轮没有正文，不能凭空塞一个空气泡
        if (message.content) addMessage(message.role === 'user' ? 'user' : 'assistant', message.content);
      }
      autoScroll(true);   // 切过来先停在最新，历史由用户自己往上翻
      if (refreshRail) refreshRail();
      if (data.pending) renderApproval({ approval: data.pending });
      else setStatus('就绪', 'ready');
      document.getElementById('yami-ai-history')?.classList.remove('show');
      pushNotice('已切换到历史对话：' + (title || id));
      refreshContext();
    } catch (e) {
      addMessage('error', '打开历史对话失败：' + e.message);
    }
  }

  function startNewSession(notify = true) {
    state.sessionId = 'session-' + Date.now().toString(36);
    localStorage.setItem('danjuan-ai-session', state.sessionId);
    state.pending = null;
    document.getElementById('yami-ai-approval')?.classList.remove('show');
    clearMessages('新对话已开始。告诉我你想做什么。');
    clearPlan();
    document.getElementById('yami-ai-history')?.classList.remove('show');
    setStatus('就绪', 'ready');
    renderContext(null);
    if (notify) pushNotice('已开启新对话（旧对话仍可在历史里找回）');
  }

  function setStatus(text, mode) {
    const el = document.getElementById('yami-ai-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'yami-ai-status ' + (mode || 'idle');
  }

  function setBusy(on) {
    state.busy = !!on;
    const send = document.getElementById('yami-ai-send');
    if (send) {
      send.classList.toggle('stop', state.busy);
      send.setAttribute('aria-disabled', 'false');
      send.textContent = state.busy ? '停止' : '发送';
      send.title = state.busy ? '停止本轮输出（也可以按 Esc）' : '发送（Enter）';
    }
    if (!state.busy) state.abort = null;
  }

  /** 打断本轮输出：断开 SSE，宿主会同步停掉模型请求与后续工具（不是只关界面） */
  function stopStream() {
    if (!state.busy) return;
    if (state.abort) { try { state.abort.abort(); } catch (e) { /* 已经断开 */ } }
    setStatus('已打断', 'idle');
    pushNotice('已打断，AI 停下来了（已完成的改动都保留着）', 'wait');
  }

  /** 把统一 diff 文本渲染成逐行着色：新增绿、删除红、上下文灰、定位行蓝 */
  function renderDiff(target, diff) {
    if (!target) return;
    target.innerHTML = '';
    const stat = document.getElementById('yami-ai-approval-stat');
    if (stat) stat.textContent = '';
    if (!diff) return;
    for (const line of String(diff).split('\n')) {
      const row = document.createElement('div');
      row.className = 'yami-ai-diff-line';
      if (line.startsWith('+')) row.classList.add('add');
      else if (line.startsWith('-')) row.classList.add('del');
      else if (line.startsWith('@@')) row.classList.add('hunk');
      row.textContent = line;
      target.appendChild(row);
    }
    return target;
  }

  function renderApproval(data) {
    state.pending = data.approval;
    const box = document.getElementById('yami-ai-approval');
    const detail = document.getElementById('yami-ai-approval-detail');
    const diffBox = document.getElementById('yami-ai-approval-diff');
    const statBox = document.getElementById('yami-ai-approval-stat');
    const approveBtn = document.getElementById('yami-ai-approve');
    if (!box || !detail) return;
    const a = data.approval || {};
    const preview = a.preview || {};
    detail.textContent = (a.target ? '目标：' + a.target + '\n' : '')
      + (a.summary ? '操作：' + a.summary + '\n' : '')
      + (a.message || '准备执行修改');
    // 危险操作显著标红，并改按钮文案，避免"顺手一点就删了"
    const dangerous = a.risk === 'high';
    box.classList.toggle('danger', dangerous);
    if (approveBtn) approveBtn.textContent = dangerous ? '确认删除（会先备份）' : '执行修改';
    // 删除类操作不提供批量授权（不可轻易撤销的动作必须逐条确认）
    const grantBox = document.getElementById('yami-ai-grant');
    if (grantBox) {
      const grantLabel = grantBox.closest('.yami-ai-grant');
      const allowGrant = !dangerous;
      grantBox.disabled = !allowGrant;
      if (grantLabel) grantLabel.style.display = allowGrant ? '' : 'none';
      grantBox.checked = allowGrant && localStorage.getItem('danjuan-ai-grant') === '1';
    }
    if (diffBox) renderDiff(diffBox, preview.diff || '');
    if (statBox) {
      const stat = preview.diffStat;
      statBox.textContent = stat ? `+${stat.added} / -${stat.removed}${stat.truncated ? '（已截断）' : ''}` : '';
      statBox.classList.toggle('show', !!stat);
    }
    if (preview.impact) {
      const impact = preview.impact;
      detail.textContent += `\n将删除：${impact.name}（${impact.type}，${impact.bytes} 字节）`;
      if (impact.preview) detail.textContent += '\n内容开头：\n' + impact.preview;
    }
    box.classList.add('show');
    setStatus(dangerous ? '等待确认删除' : '等待确认', 'waiting');
  }

  function handleResult(data) {
    if (data.message) addMessage('assistant', data.message);
    renderTurnUsage(data.turnUsage);
    if (Array.isArray(data.undeliveredSteer)) for (const text of data.undeliveredSteer) enqueueMessage(text);
    if (data.status === 'approval') renderApproval(data);
    else { state.pending = null; document.getElementById('yami-ai-approval')?.classList.remove('show'); setStatus('就绪', 'ready'); }
  }

  /** 流式对话：逐字上屏 + 工具调用实时可见 + 审批/结果事件 */
  async function streamChat(text) {
    let bubble = null;
    let text$ = '';
    let reasoning$ = '';
    let hasReasoning = false;
    let received = false;
    let finalResult = null;
    let streamError = null;
    // 工具卡片按调用 id 匹配：只读批次是并发跑的，单槽变量会把 A 的结果写到 B 的卡片上
    const toolCards = new Map();
    const cardKeyOf = event => String((event && event.key) || (event && event.name) || '');
    state.abort = new AbortController();
    const response = await fetch('http://127.0.0.1:' + PORT + '/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-yami-agent-token': state.token },
      body: JSON.stringify({ sessionId: state.sessionId, message: text }),
      signal: state.abort.signal
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'AI 助手请求失败' }));
      throw new Error(data.error || 'AI 助手请求失败');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // 正文与思考都走增量缓冲：append 只拼接新片段，避免每帧复制全文
    const contentBuffer = renderCore ? renderCore.createTextBuffer() : null;
    // 思考缓冲按「段」重建：一段一块，缓冲也必须跟着换，否则第二段会把第一段的文字一起吞进去
    let reasoningBuffer = renderCore ? renderCore.createTextBuffer() : null;
    let bubbleTextNode = null;

    const flushContent = () => {
      if (!bubble) return;
      // 没有渲染核心（旧注入顺序/文件缺失）时退回整段直写，绝不能一个字都不显示
      if (!contentBuffer) { bubble.textContent = text$; return; }
      if (!bubbleTextNode || !bubbleTextNode.isConnected) {
        bubble.textContent = '';
        bubbleTextNode = document.createTextNode(contentBuffer.toString());
        bubble.appendChild(bubbleTextNode);
      } else if (bubbleTextNode.data.length !== contentBuffer.length()) {
        bubbleTextNode.appendData(contentBuffer.toString().slice(bubbleTextNode.data.length));
      }
    };
    const flushThinking = () => {
      if (!currentThinkingEl) return;
      if (!reasoningBuffer) { renderThinking(reasoning$); return; }
      const full = reasoningBuffer.toString();
      currentThinkingEl.dataset.text = full;
      const body = currentThinkingEl.querySelector('.yami-ai-thinking-body');
      const mode = thinkingView();
      if (body && mode === 'preview') {
        // 单行预览也要**实时**跟着走：以前只在段末刷一次，于是"刚出来的那个思考窗口"
        // 在整个思考期间都是空的（用户报的就是这个）。取值走缓冲的 lastLine（增量维护），
        // 不每帧 split 全文 —— 那正是这条流水线当初要消灭的开销。
        let span = body.firstElementChild;
        if (!span || span.tagName !== 'SPAN') {
          body.textContent = '';
          span = document.createElement('span');
          body.appendChild(span);
        }
        const line = typeof reasoningBuffer.lastLine === 'function' ? reasoningBuffer.lastLine(160) : previewLine(full);
        if (span.textContent !== line) span.textContent = line;
      } else if (body && mode === 'expand') {
        // 判断"是否贴着底"必须在写入**之前**：写完 scrollHeight 就变大了，明明贴着底的
        // 也会被判成"用户在看历史"，于是最新那几行永远沉在下面。
        let near = isNearBottom(body);
        // 文本节点必须从**当前这一块**里取。以前用的是 streamChat 的闭包变量，
        // 开新段时它仍指向上一块（而且 connected），于是新段的字全灌进了旧块、
        // 新块的正文永远是空的 —— 这就是"再次出现的思考窗口没有文字"的根因。
        const node = body.firstChild && body.firstChild.nodeType === 3 ? body.firstChild : null;
        if (!node) {
          body.textContent = '';
          body.appendChild(document.createTextNode(full));
          near = true;
        } else if (node.data.length !== full.length) {
          node.appendData(full.slice(node.data.length));
        }
        // 思考块自身是滚动容器（max-height:30vh），它不会自己跟着长
        if (near) body.scrollTop = body.scrollHeight;
      }
      const seconds = Math.max(1, Math.round((Date.now() - thinkingStartedAt) / 1000));
      setThinkingMeta(currentThinkingEl, thinkingSegments.round(), seconds, reasoningBuffer.length());
    };

    const handleEvent = event => {
      if (!event || !event.type) return;
      if (event.type === 'status') { setStatus(event.text || '正在处理', 'working'); return; }
      if (event.type === 'delta') {
        // 思考过程（reasoning_content）：一段一块，流式追加，默认展开
        if (event.reasoning) {
          hasReasoning = true;
          // 上一段已封口（中间发生过工具调用或已开始写正文）→ 这是新一轮的思考：另起一段，
          // 并且**先**把累加缓冲换成新的，再写入这一段的字。
          const segment = thinkingSegments.accept();
          if (segment || !currentThinkingEl || !currentThinkingEl.isConnected) {
            beginThinkingRound(segment - 1);
            reasoningBuffer = renderCore ? renderCore.createTextBuffer() : null;
            reasoning$ = '';
          }
          if (reasoningBuffer) reasoningBuffer.append(event.reasoning);
          else reasoning$ += event.reasoning;
          scheduleRender(() => { flushThinking(); refreshProcessMeta(); autoScroll(); });
          return;
        }
        if (!event.content) return;
        received = true;
        if (!bubble) {
          sealThinking();       // 正文开始 → 思考到此为止（工具调用之间的思考是各自独立的段）
          finalizeThinking();
          bubble = addMessage('assistant', '');
        }
        if (contentBuffer) contentBuffer.append(event.content);
        else text$ += event.content;
        scheduleRender(() => { flushContent(); autoScroll(); });
        return;
      }
      if (event.type === 'tool') {
        // 工具调用是轮次分界：它前面那段思考已经想完了，下一段思考必须另起一块
        sealThinking();
        // 工具卡片承担过去那条「执行/完成」过程条：状态只来自冻结的调用结果，
        // 截断与否、差异多少、能不能定位文件，都写在卡片上（对齐 DSH 的工具展示）。
        if (event.phase === 'start') {
          const card = pushToolCard(event);
          if (card) {
            toolCards.set(cardKeyOf(event), card);
            // 卡片表只留最近 50 张：审批卡片要跨轮等着结果，不能一轮一清，但也不能无限长
            while (toolCards.size > 50) toolCards.delete(toolCards.keys().next().value);
          }
          return;
        }
        {
          const key = cardKeyOf(event);
          const card = toolCards.get(key) || toolCards.get(String(event.name || ''));
          if (card) {
            if (event.phase === 'done') { card.done(event); toolCards.delete(key); }
            else if (event.phase === 'fail') { card.fail(event); toolCards.delete(key); }
            // 审批是跨轮的：卡片留在表里，等下一轮真正执行完的 done/fail 来收尾
            else if (event.phase === 'approval') card.wait(event);
          }
        }
        return;
      }
      if (event.type === 'system') { pushSystemRow(event); return; }
      if (event.type === 'steer') { if (event.phase === 'delivered') markSteerDelivered(String(event.text || '')); return; }
      if (event.type === 'notice') { pushNotice(event.text || '', 'wait'); return; }
      if (event.type === 'plan') { renderPlan(event.items, event.summary); return; }
      if (event.type === 'result') { finalResult = event; return; }
      if (event.type === 'error') { streamError = event.error || 'AI 助手执行失败'; }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try { handleEvent(JSON.parse(line.slice(5).trim())); } catch (e) { /* 忽略坏块 */ }
        }
      }
    }
    // 收尾前把缓冲里剩下的内容补齐，别丢最后几个字
    if (contentBuffer) text$ = contentBuffer.toString();
    if (reasoningBuffer) reasoning$ = reasoningBuffer.toString();
    flushContent();
    flushThinking();
    finalizeThinking();
    autoScroll();
    if (streamError) throw new Error(streamError);
    if (finalResult && finalResult.status !== 'approval') {
      if (!received && finalResult.message) addMessage(finalResult.ok === false ? 'error' : 'assistant', finalResult.message);
      else if ((finalResult.status === 'stuck' || finalResult.status === 'compile-failed') && finalResult.message) pushNotice(finalResult.message, 'bad');
      if (finalResult.plan) renderPlan(finalResult.plan.items, finalResult.plan.summary);
      if (finalResult.changelog) renderChangelog(finalResult.changelog);
      renderTurnUsage(finalResult.turnUsage);   // 记账不全时它自己什么都不画
      // 引导没赶上这一轮（模型已经收工）：如实放进排队区当普通消息发，绝不假装送达
      if (Array.isArray(finalResult.undeliveredSteer) && finalResult.undeliveredSteer.length) {
        for (const text of finalResult.undeliveredSteer) enqueueMessage(text);
        hudToast('有 ' + finalResult.undeliveredSteer.length + ' 条引导没赶上这一步，已放进排队区');
      }
    }
    return finalResult;
  }

  /**
   * 轮次过程收起方式：compact 紧凑（默认，轮次结束自动收起过程行）/
   * standard 标准（过程行始终可见）。参考 DSH 的「紧凑/标准」两档。
   */
  function processFoldMode() {
    if (state.processFold === 'compact' || state.processFold === 'standard') return state.processFold;
    let saved = '';
    try { saved = localStorage.getItem('danjuan-ai-process-fold') || ''; } catch (e) { saved = ''; }
    return saved === 'standard' ? 'standard' : 'compact';
  }

  /**
   * 繁忙时按发送怎么处理：queue 排队（默认，本轮结束后依次发出）/ interrupt 打断当前轮再发这条。
   * 用户明确要求"一个发送按钮就够了，别让人每次选" —— 所以这是个设置项，不是按钮。
   */
  function busySendMode() {
    if (state.busySend === 'queue' || state.busySend === 'interrupt') return state.busySend;
    let saved = '';
    try { saved = localStorage.getItem('danjuan-ai-busy-send') || ''; } catch (e) { saved = ''; }
    return saved === 'interrupt' ? 'interrupt' : 'queue';
  }

  function setBusySendMode(mode) {
    const next = mode === 'interrupt' ? 'interrupt' : 'queue';
    state.busySend = next;
    try { localStorage.setItem('danjuan-ai-busy-send', next); } catch (e) {}
    const select = document.getElementById('yami-ai-busy-send');
    if (select && select.value !== next) select.value = next;
    request('/quick-config', { busySend: next }).catch(() => {});
    return next;
  }

  /** 改「过程收起」：内存 + localStorage + 宿主配置三处都写（与思考显示同一套套路） */
  function setProcessFold(mode) {
    const next = mode === 'standard' ? 'standard' : 'compact';
    state.processFold = next;
    try { localStorage.setItem('danjuan-ai-process-fold', next); } catch (e) {}
    const select = document.getElementById('yami-ai-process-fold');
    if (select && select.value !== next) select.value = next;
    request('/quick-config', { processFold: next }).catch(() => {});
    return next;
  }

  /** 思考过程显示模式：expand 展开（默认）/ collapse 折叠 / preview 单行预览 */
  function thinkingView() {
    if (['expand', 'preview', 'collapse'].includes(state.thinkingView)) return state.thinkingView;
    let saved = '';
    try { saved = localStorage.getItem('danjuan-ai-thinking-view') || ''; } catch (e) { saved = ''; }
    // 默认单行预览：一条思考只占一行（点开可看全文），避免大段灰字横在对话中间
    return ['expand', 'preview', 'collapse'].includes(saved) ? saved : (state.thinkingView || 'preview');
  }

  /**
   * 改「思考过程显示」：内存 + localStorage + 宿主配置三处都写。
   * 用户报过"设置没办法保存"——localStorage 在某些环境下不可写，
   * 所以写不进去要如实回执，并靠宿主配置保证下次打开仍是他选的那一档。
   */
  function setThinkingView(mode, options) {
    const next = ['expand', 'preview', 'collapse'].includes(mode) ? mode : 'preview';
    state.thinkingView = next;
    let persisted = false;
    try {
      localStorage.setItem('danjuan-ai-thinking-view', next);
      persisted = localStorage.getItem('danjuan-ai-thinking-view') === next;
    } catch (e) { persisted = false; }
    const select = document.getElementById('yami-ai-thinking-view');
    if (select && select.value !== next) select.value = next;
    applyThinkingModeToAll();
    const label = { expand: '展开', preview: '单行预览', collapse: '折叠' }[next];
    if (!options || options.notify !== false) {
      addMessage('system', '思考过程显示：' + label + (persisted ? '' : '（本地存储写不进去，已存到宿主配置）'));
    }
    // 宿主侧再存一份：换窗口、清站点数据后仍能恢复
    request('/quick-config', { thinkingView: next }).catch(() => {});
    return persisted;
  }

  // 单行预览的取值规则放在渲染核心里（纯逻辑、可单测）：显示思考的最后一行，
  // 太长保留最新那段、太短往前并一行。核心缺失时退回"取最后一行"的简化版。
  const previewLine = (renderCore && typeof renderCore.previewLine === 'function')
    ? renderCore.previewLine
    : text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean).pop() || '';

  function applyThinkingMode(el) {
    if (!el) return;
    const mode = thinkingView();
    el.classList.toggle('collapsed', mode === 'collapse');
    el.classList.toggle('preview', mode === 'preview');
    const body = el.querySelector('.yami-ai-thinking-body');
    const toggle = el.querySelector('.yami-ai-thinking-toggle');
    if (toggle) {
      // 用符号而不是「收起/展开」按钮：思考块里放个带底色的按钮太抢眼
      toggle.textContent = mode === 'expand' ? '▾' : '▸';
      toggle.title = mode === 'expand' ? '收起思考过程' : '展开思考过程';
    }
    if (body && mode === 'preview') {
      // 单行预览必须让**最新**的字落在可见区：文本块右对齐、超出的部分从左边裁掉。
      // （以前用 text-overflow: ellipsis，裁的是右边——于是用户看到的永远是靠前的旧内容。）
      const text = previewLine(el.dataset.text);
      let span = body.firstElementChild;
      if (!span || span.tagName !== 'SPAN') {
        body.textContent = '';
        span = document.createElement('span');
        body.appendChild(span);
      }
      if (span.textContent !== text) span.textContent = text;
    } else if (body) {
      // 展开模式：内容一致就别重写。整段 textContent 赋值会把用户手动滚到的位置重置回顶部
      // （思考收尾、切换档位都会走到这里，而那时用户很可能正在读上面的内容）。
      const text = el.dataset.text || '';
      if (body.textContent !== text) body.textContent = text;
    }
  }

  /** 建一个思考块：流式与历史回放共用同一套结构、折叠交互与显示档位 */
  function appendThinkingBlock(text, metaText) {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return null;
    const el = document.createElement('div');
    el.className = 'yami-ai-thinking';
    el.dataset.text = String(text || '');
    const head = document.createElement('div');
    head.className = 'yami-ai-thinking-head';
    const title = document.createElement('span');
    title.className = 'yami-ai-thinking-title';
    title.textContent = '思考过程';
    const meta = document.createElement('span');
    meta.className = 'yami-ai-thinking-meta';
    meta.textContent = metaText || '';
    const toggle = document.createElement('div');
    toggle.className = 'yami-ai-thinking-toggle';
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-label', '展开或收起思考过程');
    // 闭包里绑定本元素（而不是模块级的 currentThinkingEl），历史回放的块才能独立折叠
    activate(toggle, event => {
      event.stopPropagation();
      // 手动点击：展开 <-> 折叠（单行预览状态下点击直接展开），并让全局开关跟随
      const next = el.classList.contains('collapsed') || el.classList.contains('preview') ? 'expand' : 'collapse';
      localStorage.setItem('danjuan-ai-thinking-view', next);
      const select = document.getElementById('yami-ai-thinking-view');
      if (select) select.value = next;
      applyThinkingMode(el);
    });
    const body = document.createElement('div');
    body.className = 'yami-ai-thinking-body';
    head.appendChild(title);
    head.appendChild(meta);
    head.appendChild(toggle);
    el.appendChild(head);
    el.appendChild(body);
    // 思考条进「执行过程」区，和工具步骤集中在一起；没有活跃回合（历史回放）才退回列表
    const area = processArea();
    (area ? area.body : list).appendChild(el);
    applyThinkingMode(el);
    return el;
  }

  /** 段头文字：多段时才带「第 N 段」编号（单段的任务不需要编号噪音）。
   *  编号只从**已知段号**来（第 1 段要等到"确实存在第 2 段"那一刻才敢加），
   *  所以第 2 段起由创建时就带上，第 1 段由 labelThinkingRound 事后补。 */
  function thinkingMetaText(index, seconds, chars) {
    return (index >= 2 ? '第 ' + index + ' 段 · ' : '') + '已思考 ' + seconds + ' 秒 · ' + chars + ' 字';
  }

  /** 回放用的段头（历史块没有"耗时"可算，如实只报字数，不编造秒数） */
  function replayThinkingMeta(index, chars) {
    return (index >= 2 ? '第 ' + index + ' 段 · ' : '') + '共 ' + chars + ' 字';
  }

  /** 带编号的块打上标记，避免后面再被加一次前缀 */
  function markThinkingLabeled(el, labeled) {
    if (!el || !labeled) return;
    const meta = el.querySelector('.yami-ai-thinking-meta');
    if (meta) meta.dataset.labeled = '1';
  }

  /** 刷新段头（流式中的每一帧都会走到，所以只写 textContent，不重建节点） */
  function setThinkingMeta(el, index, seconds, chars) {
    const meta = el && el.querySelector('.yami-ai-thinking-meta');
    if (!meta) return;
    meta.textContent = thinkingMetaText(index, seconds, chars);
    markThinkingLabeled(el, index >= 2);
  }

  /** 给已经定型的段补上「第 N 段」：只有"这一段的后面确实还有段"时才调用 */
  function labelThinkingRound(el, index) {
    if (!el || index < 1) return;
    const meta = el.querySelector('.yami-ai-thinking-meta');
    if (!meta || meta.dataset.labeled === '1') return;
    meta.dataset.labeled = '1';
    meta.textContent = '第 ' + index + ' 段 · ' + meta.textContent;
  }

  /** 封段：这一轮想完了（工具调用 / 正文开始 / 回合结束都会走到），耗时与字数就此定格 */
  function sealThinking() {
    thinkingSegments.seal();
    if (!currentThinkingEl || !currentThinkingEl.isConnected || !thinkingStartedAt) return;
    const elapsed = Math.max(1, Math.round((Date.now() - thinkingStartedAt) / 1000));
    thinkingTotalMs += Date.now() - thinkingStartedAt;
    thinkingStartedAt = 0;
    setThinkingMeta(currentThinkingEl, thinkingSegments.round(), elapsed, (currentThinkingEl.dataset.text || '').length);
    applyThinkingMode(currentThinkingEl);
    refreshProcessMeta();
  }

  /** 开新一段思考：上一段必然已封口，此刻才知道它后面还有段，正好补上编号 */
  function beginThinkingRound(previousIndex) {
    labelThinkingRound(currentThinkingEl, previousIndex);
    // 必须先置空：上一个块还是 connected 的，renderThinking 只在"没有块"时才新建，
    // 不置空的话新一段的字会继续灌进上一段里（分段等于没分）。
    currentThinkingEl = null;
    renderThinking('');
    refreshProcessMeta();
  }

  /** 回合计尾：最后一段也要定稿（正在写的那段不能一直挂着计时） */
  function endThinkingRounds() {
    sealThinking();
  }

  /** 创建或更新思考块（流式过程中反复调用） */
  function renderThinking(fullText) {
    if (!currentThinkingEl || !currentThinkingEl.isConnected) {
      currentThinkingEl = appendThinkingBlock(fullText, '');
      thinkingStartedAt = Date.now();
    }
    if (!currentThinkingEl) return;
    currentThinkingEl.dataset.text = fullText;
    const seconds = Math.max(1, Math.round((Date.now() - thinkingStartedAt) / 1000));
    setThinkingMeta(currentThinkingEl, thinkingSegments.round(), seconds, fullText.length);
    applyThinkingMode(currentThinkingEl);
    refreshProcessMeta();
    autoScroll();
  }

  /** 思考结束（正文开始或本轮收尾时调用） */
  function finalizeThinking() {
    if (currentThinkingEl) applyThinkingMode(currentThinkingEl);
  }

  /**
   * 轮次结束：紧凑模式下把过程行收起来（参考 DSH 的 turn process folding）。
   * 判据全在渲染核心里（纯逻辑可单测），这里只负责执行 DOM 与焦点保护：
   * 自动收起若会把键盘焦点藏掉，就保持展开 —— 整洁不能以"焦点莫名其妙没了"为代价。
   */
  function applyTurnFold() {
    if (!currentTurn || !currentTurn.process) return;
    const area = currentTurn.process;
    const hasAnswer = !!(currentTurn.body && currentTurn.body.textContent.trim());
    const focusInside = !!(document.activeElement && area.box.contains(document.activeElement));
    const info = (renderCore && typeof renderCore.turnProcessFold === 'function')
      ? renderCore.turnProcessFold({
          mode: processFoldMode(),
          hasAnswer: hasAnswer,
          focusInside: focusInside,
          seconds: Math.round(thinkingTotalMs / 1000),
          rounds: thinkingSegments.round(),
          steps: area.steps
        })
      : { fold: false, title: '' };
    if (!info.fold) return;
    area.box.classList.add('collapsed');
    area.meta.textContent = info.title;
    const toggle = area.box.querySelector('.yami-ai-process-toggle');
    if (toggle) toggle.textContent = '▸';
    const head = area.box.querySelector('.yami-ai-process-head');
    if (head) head.title = '展开执行过程';
  }

  /** 每轮用量行：记账不全就整行不出现（"完整"由渲染核心判定） */
  function renderTurnUsage(usage) {
    const info = (renderCore && typeof renderCore.formatTurnUsage === 'function')
      ? renderCore.formatTurnUsage(usage)
      : { show: false };
    if (!info.show) return null;
    const host = currentTurn ? currentTurn.root : document.getElementById('yami-ai-messages');
    if (!host) return null;
    const el = document.createElement('div');
    el.className = 'yami-ai-turn-usage';
    el.textContent = info.text;
    if (info.detail) el.title = info.detail;
    host.appendChild(el);
    autoScroll();
    return el;
  }

  // ============================================================
  // 工具卡片 / 系统提示词行 / 引导条 / 排队区 / 轮次导航轨道
  // 对齐 DSH 的 client-ui-tool 与 client-ui-chat：卡片状态只来自冻结的调用结果、
  // 被截断的输出必须如实标注、导航轨道给每一轮一个刻度。
  // ============================================================

  /**
   * 面板内的轻提示：复用 HUD 那颗 toast 节点（同款样式），没有就自己建一个。
   * 注意：**不能**直接调 hud-overlay.js 里的 showToast —— 那是另一个 IIFE 里的私有函数，
   * 跨文件根本拿不到（静态自检抓到过这个 ReferenceError，别再犯）。
   */
  function hudToast(text, duration) {
    let el = document.getElementById('yami-perf-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'yami-perf-toast';
      el.id = 'yami-perf-toast';
      document.body.appendChild(el);
    }
    el.textContent = String(text || '');
    el.classList.add('show');
    if (hudToast.timer) clearTimeout(hudToast.timer);
    hudToast.timer = setTimeout(() => el.classList.remove('show'), duration || 2200);
  }

  /** 把工程内相对路径解析成绝对路径（解析不出来就不给"定位"这个动作） */
  function absolutePathOf(rel) {
    const text = String(rel || '').trim();
    if (!text) return '';
    try {
      const path = require('path');
      if (path.isAbsolute(text)) return text;
      const root = editorProjectRoot();
      return root ? path.join(root, text) : '';
    } catch (e) { return ''; }
  }

  /** 在系统资源管理器里定位文件（与性能大盘的「定位文件」同一套做法，失败就退化成复制路径） */
  function revealPath(rel) {
    const full = absolutePathOf(rel);
    if (!full) { hudToast('这个路径没能解析到工程里：' + rel); return; }
    try {
      const electron = require('electron');
      if (electron && electron.shell && electron.shell.showItemInFolder) {
        electron.shell.showItemInFolder(full);
        hudToast('已在文件夹中定位：' + rel);
        return;
      }
    } catch (e) { /* 没有 electron 就退化成复制 */ }
    try {
      navigator.clipboard.writeText(full);
      hudToast('已复制完整路径：' + full);
    } catch (e) { hudToast('定位失败：' + full); }
  }

  function toolChipsOf(info) {
    return (renderCore && typeof renderCore.toolCardChips === 'function') ? renderCore.toolCardChips(info) : [];
  }

  function truncationOf(info) {
    return (renderCore && typeof renderCore.truncationText === 'function') ? renderCore.truncationText(info) : '';
  }

  /**
   * 工具卡片：一行摘要（谁 · 干了什么 · 结果如何），点开看细节。
   * 状态只有三种，且只由**冻结的调用结果**决定：运行中 / 成功 / 失败（另有等待确认）。
   */
  function pushToolCard(event) {
    const area = processArea();
    const host = area ? area.body : document.getElementById('yami-ai-messages');
    if (!host) return null;
    const el = document.createElement('div');
    el.className = 'yami-ai-tool collapsed';
    const head = document.createElement('div');
    head.className = 'yami-ai-tool-head';
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    const dot = document.createElement('span');
    dot.className = 'yami-ai-tool-dot run';
    const title = document.createElement('span');
    title.className = 'yami-ai-tool-title';
    title.textContent = event.label || event.name || '工具';
    const target = document.createElement('span');
    target.className = 'yami-ai-tool-target';
    target.textContent = String(event.target || '');
    const chips = document.createElement('span');
    chips.className = 'yami-ai-tool-chips';
    const toggle = document.createElement('span');
    toggle.className = 'yami-ai-tool-toggle';
    toggle.textContent = '▸';
    head.appendChild(dot); head.appendChild(title); head.appendChild(target);
    head.appendChild(chips); head.appendChild(toggle);
    const body = document.createElement('div');
    body.className = 'yami-ai-tool-body';
    el.appendChild(head); el.appendChild(body);
    host.appendChild(el);
    if (area) { area.steps++; refreshProcessMeta(); }

    if (event.target) {
      target.classList.add('clickable');
      target.title = '点击在文件夹中定位：' + event.target;
      activate(target, e => { e.stopPropagation(); revealPath(event.target); });
    }
    activate(head, e => {
      e.stopPropagation();
      const collapsed = el.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▸' : '▾';
    });
    el.querySelector('.yami-ai-tool-head').title = event.target ? '展开看细节 · ' + event.target : '展开看细节';

    const writeLine = text => {
      if (!text) return;
      body.textContent = body.textContent ? body.textContent + '\n' + text : text;
    };
    const card = {
      el: el,
      /** 成功：标签来自结构化事实；截断就如实标注（落盘了给路径） */
      done: payload => {
        dot.className = 'yami-ai-tool-dot ok';
        const info = (payload && payload.info) || null;
        const list = toolChipsOf(info);
        chips.textContent = list.join(' · ');
        const trunc = truncationOf(info);
        if (trunc) {
          chips.textContent = chips.textContent ? chips.textContent + ' · 已截断' : '已截断';
          writeLine(trunc);
          if (info && info.spill && info.spill.path) {
            const line = document.createElement('div');
            line.className = 'yami-ai-tool-spill';
            line.textContent = '打开落盘目录';
            activate(line, e => { e.stopPropagation(); revealPath(info.spill.path); });
            body.appendChild(line);
          }
        }
      },
      /** 失败：错误原文展开着给（不用用户多点一次） */
      fail: payload => {
        dot.className = 'yami-ai-tool-dot bad';
        const detail = (payload && payload.detail) || '执行失败';
        writeLine('错误：' + detail);
        el.classList.remove('collapsed');
        toggle.textContent = '▾';
      },
      /** 等待确认：卡片立刻展开，把"卡在这了"摆到眼前 */
      wait: () => {
        dot.className = 'yami-ai-tool-dot wait';
        writeLine('等待你确认');
        el.classList.remove('collapsed');
        toggle.textContent = '▾';
      }
    };
    autoScroll();
    return card;
  }

  /**
   * 系统提示词行：把模型这一轮**实际看到**的 system 文本摆出来（默认收起）。
   * 文本没变就不重复上屏（宿主负责判重）；resume 之后允许再来一次。
   */
  function pushSystemRow(event) {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return null;
    const el = document.createElement('div');
    el.className = 'yami-ai-system collapsed';
    const head = document.createElement('div');
    head.className = 'yami-ai-system-head';
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    const title = document.createElement('span');
    title.className = 'yami-ai-system-title';
    title.textContent = '系统提示词';
    const meta = document.createElement('span');
    meta.className = 'yami-ai-system-meta';
    meta.textContent = (event.hash ? event.hash + ' · ' : '') + String(event.text || '').length + ' 字';
    const toggle = document.createElement('span');
    toggle.className = 'yami-ai-system-toggle';
    toggle.textContent = '▸';
    head.appendChild(title); head.appendChild(meta); head.appendChild(toggle);
    const body = document.createElement('div');
    body.className = 'yami-ai-system-body';
    body.textContent = String(event.text || '');
    el.appendChild(head); el.appendChild(body);
    // 插在当前回合之前：这一行的语义是"这一轮请求带的系统提示词"，排在过程之上更好读
    if (currentTurn && currentTurn.root && currentTurn.root.parentNode === list) list.insertBefore(el, currentTurn.root);
    else list.appendChild(el);
    activate(head, e => {
      e.stopPropagation();
      const collapsed = el.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▸' : '▾';
    });
    autoScroll();
    return el;
  }

  /** 引导条：告诉用户"这句话会在下一步送到模型"；宿主确认送达后翻成已送达 */
  function pushSteerChip(text) {
    const area = processArea();
    const host = area ? area.body : document.getElementById('yami-ai-messages');
    if (!host) return null;
    const el = document.createElement('div');
    el.className = 'yami-ai-steer wait';
    el.textContent = '引导（将在下一步送到模型）：' + text;
    host.appendChild(el);
    if (area) { area.steps++; refreshProcessMeta(); }
    autoScroll();
    return el;
  }

  function markSteerDelivered(text) {
    const nodes = document.querySelectorAll('.yami-ai-steer.wait');
    for (const el of nodes) {
      if (el.textContent.indexOf(text) !== -1) {
        el.classList.remove('wait');
        el.classList.add('ok');
        el.textContent = '引导已送达模型：' + text;
        return true;
      }
    }
    return false;
  }

  // ---------------- 排队区（繁忙时打的话不再被吞掉） ----------------
  function enqueueMessage(text) {
    const item = { id: 'q' + (++state.queueSeq), text: String(text) };
    state.queue.push(item);
    renderQueueDock();
    return item;
  }

  function dropQueued(id) {
    state.queue = state.queue.filter(item => item.id !== id);
    renderQueueDock();
  }

  /** 排队区：一条一行，可单条撤回；轮次结束后自动发出（不进对话记录，直到真的发出） */
  function renderQueueDock() {
    const dock = document.getElementById('yami-ai-queue');
    if (!dock) return;
    dock.textContent = '';
    if (!state.queue.length) { dock.classList.remove('show'); return; }
    dock.classList.add('show');
    const head = document.createElement('div');
    head.className = 'yami-ai-queue-head';
    head.textContent = '排队中 ' + state.queue.length + ' 条（本轮结束后依次发出）';
    dock.appendChild(head);
    for (const item of state.queue) {
      const row = document.createElement('div');
      row.className = 'yami-ai-queue-item';
      const text = document.createElement('span');
      text.className = 'yami-ai-queue-text';
      text.textContent = item.text;
      const del = document.createElement('span');
      del.className = 'yami-ai-queue-del';
      del.textContent = '×';
      del.title = '撤回这条';
      activate(del, e => { e.stopPropagation(); dropQueued(item.id); });
      row.appendChild(text); row.appendChild(del);
      dock.appendChild(row);
    }
  }

  /** 一轮结束后：把排队的第一条发出去（只发一条，剩下的等下一轮结束再发） */
  function flushQueue() {
    if (state.busy || !state.queue.length) return;
    const next = state.queue.shift();
    renderQueueDock();
    if (!next) return;
    // 直接发这条排队的文本：不去动输入框（用户可能正在敲下一条）
    runMessage(next.text);
  }

  /** 输入区扩展：排队区 + 繁忙时才出现的「排队 / 引导」两颗按钮（不改原模板，降低碰坏骨架的风险） */
  function buildComposeExtras() {
    const compose = document.querySelector('#page-ai .yami-ai-compose');
    if (!compose || !compose.parentNode) return;
    if (!document.getElementById('yami-ai-queue')) {
      const dock = document.createElement('div');
      dock.className = 'yami-ai-queue';
      dock.id = 'yami-ai-queue';
      compose.parentNode.insertBefore(dock, compose);
    }
    // 输入区不放任何额外按钮：繁忙时的行为由「设置 → 繁忙时发送」决定（排队 / 打断），
    // 用户不需要每次都在按钮之间做选择。
    renderQueueDock();
  }

  /**
   * 轮次导航轨道（对齐 DSH 的 turn rail）：每一轮一个刻度，滚动时高亮当前阅读的那一轮，
   * 点刻度跳过去，悬停给一句预览。历史回放（没有 turn 容器）时按用户消息分轮。
   */
  function buildRail() {
    const page = document.getElementById('page-ai');
    const list = document.getElementById('yami-ai-messages');
    if (!page || !list || document.getElementById('yami-ai-rail')) return;
    const rail = document.createElement('div');
    rail.className = 'yami-ai-rail';
    rail.id = 'yami-ai-rail';
    rail.setAttribute('role', 'navigation');
    rail.setAttribute('aria-label', '轮次导航');
    page.appendChild(rail);
    const cache = { sig: '', ticks: [] };
    const anchorsOf = () => {
      const turns = list.querySelectorAll('.yami-ai-turn');
      if (turns.length) return Array.from(turns);
      return Array.from(list.querySelectorAll('.yami-ai-message.user'));
    };
    const refresh = force => {
      const anchors = anchorsOf();
      const sig = String(anchors.length);
      if (!force && sig === cache.sig) return;
      cache.sig = sig;
      rail.textContent = '';
      cache.ticks = anchors.map((anchor, i) => {
        const tick = document.createElement('div');
        tick.className = 'yami-ai-rail-tick';
        // 预览现算：鼠标悬停时才读一遍文本（流式期间内容一直在长，提前算好必然会过期）
        tick.addEventListener('mouseenter', () => {
          const preview = String(anchor.textContent || '').replace(/\s+/g, ' ').trim();
          tick.title = '第 ' + (i + 1) + ' 轮：' + (preview.slice(0, 50) || '（空）');
        });
        activate(tick, e => {
          e.stopPropagation();
          anchor.scrollIntoView({ block: 'start' });
        });
        rail.appendChild(tick);
        return { tick: tick, anchor: anchor };
      });
      rail.classList.toggle('show', cache.ticks.length > 1);
    };
    const layout = () => {
      const pageRect = page.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      rail.style.top = Math.round(listRect.top - pageRect.top + 6) + 'px';
      rail.style.height = Math.max(24, Math.round(listRect.height - 12)) + 'px';
    };
    const updateActive = () => {
      refresh(false);
      if (!cache.ticks.length) return;
      const offsets = cache.ticks.map(item => item.anchor.offsetTop - list.offsetTop);
      const index = (renderCore && typeof renderCore.activeTurnIndex === 'function')
        ? renderCore.activeTurnIndex(offsets, list.scrollTop, list.clientHeight)
        : 0;
      cache.ticks.forEach((item, i) => item.tick.classList.toggle('active', i === index));
    };
    const sync = () => { layout(); updateActive(); };
    layout();
    updateActive();
    list.addEventListener('scroll', () => scheduleRender(updateActive), { passive: true });
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(sync).observe(list); } catch (e) { /* 没有就算了，resize 兜底 */ }
    }
    window.addEventListener('resize', sync);
    refreshRail = sync;
  }

  /** 切换显示模式时，同步更新历史上所有思考块 */
  function applyThinkingModeToAll() {
    for (const el of document.querySelectorAll('.yami-ai-thinking')) applyThinkingMode(el);
  }

  /**
   * 繁忙时发送 = 打断：先真停当前轮（断开 SSE，宿主会停掉模型请求与工具），等它收尾后再发这条。
   * 等待是必要的：宿主那边 busy 还没释放，硬发会被"上一条还在处理"顶回来（那正是老故障）。
   */
  async function interruptThenSend(text) {
    hudToast('已打断本轮，正在发出这条消息');
    stopStream();
    for (let i = 0; i < 50 && state.busy; i++) await new Promise(resolve => setTimeout(resolve, 100));
    await runMessage(text);
  }

  /** 引导：立刻交给宿主，由它在下一个步骤边界投递给模型（宿主空闲时会如实说"直接发就行"） */
  async function sendSteer(text) {
    try {
      const res = await request('/steer', { sessionId: state.sessionId, message: text });
      if (res && res.busy) {
        pushSteerChip(text);
        hudToast('已交给模型，会在下一个步骤边界读到');
        return;
      }
      enqueueMessage(text);
      hudToast('这一轮刚好结束了，已放进排队区');
    } catch (e) {
      enqueueMessage(text);
      hudToast('引导没送出去（' + e.message + '），已放进排队区');
    }
  }

  async function sendMessage(mode) {
    const input = document.getElementById('yami-ai-input');
    const text = input && input.value.trim();
    // 繁忙时不再把用户打的字丢掉（旧行为是直接 return，字等于白打）：
    //   默认「排队」——本轮结束后依次发出；显式「引导」——立刻交给宿主，下一步骤边界投递。
    if (state.busy) {
      if (!text) return;
      input.value = '';
      // Ctrl+Enter 是保留的快捷键（不占按钮）：把这句话插进正在跑的这一轮，不打断它
      if (mode === 'steer') return await sendSteer(text);
      if (busySendMode() === 'interrupt') return await interruptThenSend(text);
      enqueueMessage(text);
      hudToast('已排队（第 ' + state.queue.length + ' 条）：本轮结束后依次发出；可在设置里改成「打断」立刻发');
      return;
    }
    // 有未确认的修改时，用户直接发新消息 = 放弃那项修改（宿主会同步作废并给它补上"未执行"应答）。
    // 以前这里直接 return，界面看着就是"卡住了、发不出去"，用户完全不知道卡在哪。
    if (state.pending) {
      state.pending = null;
      document.getElementById('yami-ai-approval')?.classList.remove('show');
    }
    if (!text) { input?.focus(); return; }
    input.value = '';
    await runMessage(text);
  }

  /** 真正发一条需求（输入框那条与排队接力那条都走这里；排队接力不许碰输入框里正在敲的草稿） */
  async function runMessage(text) {
    addMessage('user', text);
    autoScroll(true);   // 用户刚发消息：无论刚才在看哪，都回到最新（这是他自己触发的）
    currentThinkingEl = null;
    thinkingStartedAt = 0;
    thinkingSegments.reset();
    thinkingTotalMs = 0;
    beginTurn();
    setBusy(true);
    setStatus('正在处理', 'working');
    try {
      await ensureHost();
      const root = editorProjectRoot();
      if (!root) throw new Error('请先在 Open Yami 中打开一个游戏工程');
      await request('/project', { projectRoot: root });
      const result = await streamChat(text);
      if (result && result.status === 'approval') renderApproval(result);
      else { state.pending = null; document.getElementById('yami-ai-approval')?.classList.remove('show'); setStatus('就绪', 'ready'); }
      refreshContext();
      refreshFooterCost();
    } catch (e) {
      if (e && (e.name === 'AbortError' || /已打断/.test(String(e.message)))) {
        setStatus('已打断', 'idle');
      } else {
        // 上游报错原文不能无脑接一句"请检查设置"：像消息序列不合法这类错误跟设置毫无关系，
        // 会把人引到错误的方向去排查。只有确实是配置类问题才这么提示。
        const detail = String((e && e.message) || '未知错误');
        const settingIssue = /API.?Key|密钥|端点|endpoint|模型不存在|余额|余额不足/i.test(detail);
        addMessage('error', detail + (settingIssue ? '。请到设置里检查后重试。' : '。'));
        setStatus('需要处理', 'error');
      }
    } finally {
      setBusy(false);
      endThinkingRounds();   // 最后一段也要定稿（耗时/字数定格，多段任务补全编号）
      refreshProcessMeta();
      applyTurnFold();       // 紧凑模式下把过程收起来（没有最终正文/焦点在里面时不收）
      endTurn();
      flushQueue();          // 排队区还有的话，接着发下一条（它在 setBusy(false) 之后才可能进来）
    }
  }

  async function decide(approve) {
    if (state.busy || !state.pending) return;
    setBusy(true);
    setStatus(approve ? '正在执行' : '正在取消', 'working');
    try {
      const route = approve ? '/approve' : '/reject';
      const grantBox = document.getElementById('yami-ai-grant');
      const grantForSession = approve && grantBox && grantBox.checked && !grantBox.disabled;
      if (grantBox) localStorage.setItem('danjuan-ai-grant', grantBox.checked ? '1' : '0');
      const data = await request(route, { sessionId: state.sessionId, grantForSession });
      handleResult(data);
      if (grantForSession) pushNotice('已记住该文件的授权：本次任务内不再逐条确认（可在【撤销】面板旁随时取消）', 'wait');
    } catch (e) {
      addMessage('error', e.message + '。修改未完成，可重新发送需求。');
      setStatus('需要处理', 'error');
    } finally { setBusy(false); }
  }

  /** 填充输入框下方的模型下拉（始终保持当前模型在列表里） */
  function fillModelSelect(models, current) {
    const select = document.getElementById('yami-ai-model');
    if (!select) return;
    const list = Array.isArray(models) && models.length ? models.slice() : ['deepseek-flash', 'deepseek-v4-pro'];
    if (current && !list.includes(current)) list.unshift(current);
    select.innerHTML = '';
    for (const name of list) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    if (current) select.value = current;
  }

  /** 快捷调节：只提交改动的那一项，避免覆盖其余设置 */
  async function quickUpdate(patch) {
    try {
      await ensureHost();
      const config = await request('/quick-config', patch);
      state.quickConfig = config;
      setStatus('就绪', 'ready');
      refreshMoney();
      return config;
    } catch (e) {
      addMessage('error', '保存设置失败：' + e.message);
    }
  }

  /** 拉取服务端模型列表（OpenAI 兼容 /models），失败时如实提示而不是假装成功 */
  async function fetchModelList() {
    const btn = document.getElementById('yami-ai-fetch-models');
    const endpoint = document.getElementById('yami-ai-endpoint').value.trim();
    const apiKey = document.getElementById('yami-ai-key').value.trim();
    if (btn) btn.classList.add('busy');
    try {
      await ensureHost();
      // 地址或 Key 有改动时先保存，再拉列表（否则拉到的是旧地址的模型）
      if (endpoint || apiKey) await request('/config', { endpoint, baseUrl: endpoint, apiKey });
      const data = await request('/models', {});
      if (!data.ok) throw new Error(data.error || '拉取失败');
      fillModelSelect(data.models, data.current || null);
      addMessage('system', '可用模型（' + data.models.length + '）：' + data.models.slice(0, 8).join('、') + (data.models.length > 8 ? ' 等' : ''));
      setStatus('就绪', 'ready');
    } catch (e) {
      addMessage('error', '拉取模型列表失败：' + e.message + '（有些本地服务不提供 /models 接口，可直接手填模型名）');
    } finally {
      if (btn) btn.classList.remove('busy');
    }
  }

  /**
   * 底栏那一行：余额 + 本次对话花费（显示在版本号旁边，只有 AI 助手页可见）。
   * 余额走官方 /user/balance，60 秒内复用缓存，避免每轮对话都打一次接口；
   * 拿不到余额（没密钥 / 非官方端点）就只显示本次花费，不报错刷屏。
   */
  async function refreshFooterCost(force) {
    const el = document.getElementById('yami-ai-footer-cost');
    if (!el) return;
    try {
      const status = await request('/status?sessionId=' + encodeURIComponent(state.sessionId));
      const usage = (status && status.usage) || null;
      const cost = usage && usage.cost ? Number(usage.cost) : 0;
      const parts = [];
      const cached = state.balance;
      if (!cached || force || Date.now() - cached.at > 60000) {
        try {
          const balance = await request('/balance', {});
          state.balance = balance && balance.ok
            ? { at: Date.now(), total: balance.total, currency: balance.currency || 'CNY', granted: balance.granted, toppedUp: balance.toppedUp }
            : { at: Date.now(), total: null };
        } catch (e) { state.balance = { at: Date.now(), total: null }; }
      }
      const balance = state.balance;
      if (balance && balance.total !== null && balance.total !== undefined) {
        parts.push('余额 ' + balance.total + ' 元');
      }
      parts.push('本次 ' + (cost > 0 ? cost.toFixed(4) : '0') + ' 元');
      el.textContent = parts.join(' · ');
      const detail = [];
      if (usage && usage.calls) detail.push('本次调用 ' + usage.calls + ' 次、共 ' + ((usage.promptTokens || 0) + (usage.completionTokens || 0)) + ' tokens（输入 ' + (usage.promptTokens || 0) + '、输出 ' + (usage.completionTokens || 0) + '）');
      if (balance && (balance.granted || balance.toppedUp)) detail.push('赠金 ' + (balance.granted || '0') + ' / 充值 ' + (balance.toppedUp || '0'));
      el.title = detail.join('；') || '本次对话用量与账户余额';
    } catch (e) {
      el.textContent = '';
      el.title = '余额与用量暂不可用';
    }
  }

  /** 余额 / 当前时段单价 / 本次对话用量，合成一行提示（拿不到就如实说明） */
  async function refreshMoney() {
    const el = document.getElementById('yami-ai-money');
    if (!el) return;
    try {
      const [pricing, status] = await Promise.all([request('/pricing', {}), request('/status?sessionId=' + encodeURIComponent(state.sessionId))]);
      const parts = [];
      if (pricing && pricing.ok && pricing.price) {
        parts.push('当前单价 ' + (pricing.band === 'peak' ? '高峰' : '空闲')
          + '：输入 ' + pricing.price.inputCacheMiss + ' 元/百万（缓存命中 ' + pricing.price.inputCacheHit + '）、输出 ' + pricing.price.output);
      }
      el.textContent = parts.join(' · ');
    } catch (e) { el.textContent = ''; }
  }

  async function showBalance() {
    const btn = document.getElementById('yami-ai-balance');
    if (btn) btn.textContent = '查询中';
    try {
      await ensureHost();
      const data = await request('/balance', {});
      if (!data.ok) throw new Error(data.error || '查询失败');
      state.balance = { at: Date.now(), total: data.total, currency: data.currency || 'CNY', granted: data.granted, toppedUp: data.toppedUp };
      refreshFooterCost(true);
      addMessage('system', '账户余额：' + data.currency + ' ' + (data.total ?? '未知')
        + '（赠金 ' + (data.granted ?? '0') + ' / 充值 ' + (data.toppedUp ?? '0') + '）'
        + (data.isAvailable ? '' : '（账户余额不足，请及时充值）'));
    } catch (e) {
      addMessage('error', '查询余额失败：' + e.message);
    } finally {
      if (btn) btn.textContent = '查余额';
    }
  }

  async function saveSettings() {
    const endpoint = document.getElementById('yami-ai-endpoint').value.trim();
    const model = document.getElementById('yami-ai-model').value.trim();
    const apiKey = document.getElementById('yami-ai-key').value.trim();
    const approvalMode = document.getElementById('yami-ai-mode').checked ? 'auto' : 'confirm';
    try {
      await ensureHost();
      const config = await request('/config', { endpoint, baseUrl: endpoint, model, apiKey, approvalMode });
      document.getElementById('yami-ai-key').value = '';
      document.getElementById('yami-ai-key').placeholder = config.hasApiKey ? '已安全保存，留空不修改' : 'DeepSeek API Key';
      document.getElementById('yami-ai-settings').classList.remove('show');
      addMessage('system', '模型设置已保存。');
      setStatus('就绪', 'ready');
    } catch (e) { addMessage('error', e.message + '。请检查模型地址和密钥。'); }
  }

  /** 密钥状态一行话：让用户一眼看出「有没有存进去、存的是不是密钥」 */
  function renderKeyState(config) {
    const el = document.getElementById('yami-ai-key-state');
    if (!el) return;
    if (config.keyInvalidReason) { el.textContent = '密钥有问题：' + config.keyInvalidReason; el.classList.add('bad'); return; }
    el.classList.remove('bad');
    if (config.hasApiKey) el.textContent = '已保存密钥 ····' + (config.keyTail || '****') + '（留空不修改）';
    else el.textContent = '还没有密钥：填好后点【测试连接】确认能通';
  }

  /** 一键测试：地址 + 密钥 + 模型是否可用，结果如实上屏（只打免费的 /models，不花 token） */
  async function testConnection() {
    const btn = document.getElementById('yami-ai-test');
    if (btn) btn.classList.add('busy');
    try {
      await ensureHost();
      const endpoint = document.getElementById('yami-ai-endpoint').value.trim();
      const apiKey = document.getElementById('yami-ai-key').value.trim();
      // 输入框里有新地址/新密钥就先落盘，否则测的是旧配置
      if (endpoint || apiKey) await request('/config', { endpoint, baseUrl: endpoint, apiKey });
      const data = await request('/test-connection', {});
      renderKeyState(data);
      if (data.ok) {
        addMessage('system', data.message + (data.keyWarning ? '（' + data.keyWarning + '）' : ''));
        if (Array.isArray(data.models) && data.models.length) fillModelSelect(data.models, data.model || null);
      } else {
        addMessage('error', '连接失败（' + (data.step === 'key' ? '密钥' : '接口') + '）：' + data.error);
      }
      setStatus(data.ok ? '就绪' : '未就绪', data.ok ? 'ready' : 'idle');
    } catch (e) {
      addMessage('error', '测试连接失败：' + e.message);
    } finally {
      if (btn) btn.classList.remove('busy');
    }
  }

  async function loadSettings() {
    try {
      await ensureHost();
      const config = await request('/config');
      document.getElementById('yami-ai-endpoint').value = config.baseUrl || config.endpoint || '';
      document.getElementById('yami-ai-model').value = config.model || '';
      document.getElementById('yami-ai-mode').checked = config.approvalMode === 'auto';
      document.getElementById('yami-ai-thinking').checked = config.thinkingMode !== 'disabled';
      document.getElementById('yami-ai-effort').value = config.thinkingEffort || 'high';
      fillModelSelect([], config.model || '');
      refreshMoney();
      refreshFooterCost();
      // 顺手拉一次真实模型列表（失败不打扰用户，保留当前模型）
      request('/models', {}).then(data => {
        if (data && data.ok && Array.isArray(data.models) && data.models.length) fillModelSelect(data.models, data.current || config.model);
      }).catch(() => {});
      document.getElementById('yami-ai-key').placeholder = config.hasApiKey ? '已安全保存，留空不修改' : 'DeepSeek API Key';
      renderKeyState(config);
      // 本地没存过就用宿主配置回填，避免"换窗口后设置像丢了"
      if (!state.thinkingView && config && ['expand', 'preview', 'collapse'].includes(config.thinkingView)) {
        let local = '';
        try { local = localStorage.getItem('danjuan-ai-thinking-view') || ''; } catch (e) { local = ''; }
        if (!local) {
          state.thinkingView = config.thinkingView;
          const sel = document.getElementById('yami-ai-thinking-view');
          if (sel) sel.value = config.thinkingView;
        }
      }
      if (!state.busySend && config && ['queue', 'interrupt'].includes(config.busySend)) {
        let local = '';
        try { local = localStorage.getItem('danjuan-ai-busy-send') || ''; } catch (e) { local = ''; }
        if (!local) {
          state.busySend = config.busySend;
          const sel = document.getElementById('yami-ai-busy-send');
          if (sel) sel.value = config.busySend;
        }
      }
      if (!state.processFold && config && ['compact', 'standard'].includes(config.processFold)) {
        let local = '';
        try { local = localStorage.getItem('danjuan-ai-process-fold') || ''; } catch (e) { local = ''; }
        if (!local) {
          state.processFold = config.processFold;
          const sel = document.getElementById('yami-ai-process-fold');
          if (sel) sel.value = config.processFold;
        }
      }
      setStatus(config.hasApiKey || !/api\.deepseek\.com/i.test(config.endpoint) ? '就绪' : '请配置模型', config.hasApiKey ? 'ready' : 'waiting');
    } catch (e) { setStatus('尚未启动', 'idle'); }
  }

  function mount(api) {
    if (state.mounted) return;
    state.mounted = true;
    const home = document.querySelector('.yami-home-modules');
    if (!home) return;
    const card = document.createElement('div');
    card.className = 'yami-home-module-item';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = '<div class="yami-home-module-main"><div class="yami-home-module-icon-box green"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.03 2 11C2 13.84 3.46 16.37 5.74 18.02L5 22L9.29 19.85C10.16 20.06 11.07 20.17 12 20.17C17.52 20.17 22 16.14 22 11.17C22 6.2 17.52 2 12 2ZM7 10H17V12H7V10ZM9 6H15V8H9V6ZM9 14H15V16H9V14Z"></path></svg></div><div><div class="yami-home-module-title">AI 助手</div><div class="yami-home-module-desc">用白话改工程、写脚本与控制试玩</div></div></div><div class="yami-home-module-badge green">进入</div>';
    home.appendChild(card);

    const page = document.createElement('div');
    page.className = 'yami-suite-page yami-ai-page';
    page.id = 'page-ai';
    page.style.setProperty('display', 'none', 'important');
    page.innerHTML = '<div class="yami-ai-toolbar"><div class="yami-ai-status idle" id="yami-ai-status" role="status">尚未启动</div><div class="yami-ai-context" id="yami-ai-context" role="status"></div><div class="yami-ai-tool-btn" id="yami-ai-undo-toggle" role="button" tabindex="0">撤销</div><div class="yami-ai-tool-btn" id="yami-ai-history-toggle" role="button" tabindex="0">历史</div><div class="yami-ai-tool-btn" id="yami-ai-clear" role="button" tabindex="0">新对话</div><div class="yami-ai-tool-btn" id="yami-ai-settings-toggle" role="button" tabindex="0">设置</div></div><div class="yami-ai-undo" id="yami-ai-undo"></div><div class="yami-ai-history" id="yami-ai-history"></div><div class="yami-ai-settings" id="yami-ai-settings"><label for="yami-ai-endpoint">BASE URL（OpenAI 格式）</label><input id="yami-ai-endpoint" type="url" value="https://api.deepseek.com" placeholder="https://api.deepseek.com"><label for="yami-ai-key">API Key</label><input id="yami-ai-key" type="password" autocomplete="off" placeholder="DeepSeek API Key"><label class="yami-ai-check"><input id="yami-ai-mode" type="checkbox"><span>编辑器操作自动执行，工程文件仍需确认</span></label><div class="yami-ai-hint" id="yami-ai-key-state"></div><label for="yami-ai-thinking-view">思考过程显示</label><select id="yami-ai-thinking-view" title="思考过程在对话里的显示方式"><option value="expand" selected>展开</option><option value="preview">单行预览</option><option value="collapse">折叠</option></select><label for="yami-ai-process-fold">执行过程收起</label><select id="yami-ai-process-fold" title="一轮结束后，思考与工具这些过程行要不要自动收起"><option value="compact" selected>紧凑（结束后自动收起）</option><option value="standard">标准（过程始终展开）</option></select><label for="yami-ai-busy-send">繁忙时发送</label><select id="yami-ai-busy-send" title="AI 正在干活时你按发送 / 回车：排队等它做完，还是打断它立刻发这条"><option value="queue" selected>排队（等这一轮跑完再发）</option><option value="interrupt">打断（停掉这一轮，立刻发）</option></select><div class="yami-ai-model-row"><div class="yami-ai-secondary" id="yami-ai-test" role="button" tabindex="0">测试连接</div><div class="yami-ai-secondary" id="yami-ai-balance" role="button" tabindex="0">查余额</div><div class="yami-ai-hint" id="yami-ai-money"></div></div><div class="yami-ai-primary" id="yami-ai-save-settings" role="button" tabindex="0">保存设置</div></div><div class="yami-ai-messages" id="yami-ai-messages" role="log" aria-live="polite"><div class="yami-ai-message assistant">告诉我你想做什么。我会先查看工程，涉及文件修改时会让你确认。</div></div><div class="yami-ai-approval" id="yami-ai-approval" role="alert"><div class="yami-ai-approval-title">确认执行</div><div class="yami-ai-approval-stat" id="yami-ai-approval-stat"></div><pre id="yami-ai-approval-detail"></pre><div class="yami-ai-approval-diff" id="yami-ai-approval-diff"></div><label class="yami-ai-check yami-ai-grant"><input id="yami-ai-grant" type="checkbox"><span>本次任务内，这个文件不再逐条确认（随时可撤销）</span></label><div class="yami-ai-approval-actions"><div class="yami-ai-secondary" id="yami-ai-reject" role="button" tabindex="0">取消修改</div><div class="yami-ai-primary" id="yami-ai-approve" role="button" tabindex="0">执行修改</div></div></div><div class="yami-ai-compose"><label for="yami-ai-input">你的需求</label><textarea id="yami-ai-input" rows="3" placeholder="例如：检查当前工程报错，并修复相关脚本"></textarea><div class="yami-ai-devbar"><label for="yami-ai-model">模型</label><select id="yami-ai-model" title="模型（可点【拉取模型】刷新列表）"></select><div class="yami-ai-tool-btn" id="yami-ai-fetch-models" role="button" tabindex="0" title="从服务端拉取可用模型">↻</div><label class="yami-ai-check"><input id="yami-ai-thinking" type="checkbox" checked><span>Thinking</span></label><select id="yami-ai-effort" title="思考强度"><option value="low">Low</option><option value="high" selected>High</option><option value="max">Max</option></select></div><div class="yami-ai-primary" id="yami-ai-send" role="button" tabindex="0" aria-disabled="false">发送</div></div>';
    document.querySelector('.yami-perf-dock-body').appendChild(page);
    api.registerPage('ai', page, { title: 'AI 助手', showBack: true, showModeSwitch: false, showClearErrors: false, showTabs: false, showExportBtns: false, refresh() {}, destroy() {} });
    ensureJumpButton();
    bindFollowScroll();
    buildComposeExtras();
    buildRail();
    activate(card, async () => {
      api.switchView('ai');
      loadSettings();
      refreshContext();
      // 打开面板即把当前工程状态设为基线：之后的变更小结只报这次对话的增量
      try { await ensureHost(); await request('/changelog-baseline', {}); } catch (e) { /* 没开工程时忽略 */ }
    });
    activate(document.getElementById('yami-ai-send'), () => { state.busy ? stopStream() : sendMessage(); });
    activate(document.getElementById('yami-ai-approve'), () => decide(true));
    activate(document.getElementById('yami-ai-reject'), () => decide(false));
    activate(document.getElementById('yami-ai-settings-toggle'), () => document.getElementById('yami-ai-settings').classList.toggle('show'));
    activate(document.getElementById('yami-ai-undo-toggle'), () => {
      const panel = document.getElementById('yami-ai-undo')
      if (panel && panel.classList.contains('show')) panel.classList.remove('show')
      else renderUndoList()
    })
    activate(document.getElementById('yami-ai-history-toggle'), () => {
      const panel = document.getElementById('yami-ai-history');
      if (panel && panel.classList.contains('show')) panel.classList.remove('show');
      else renderHistory();
    });
    activate(document.getElementById('yami-ai-save-settings'), saveSettings);
    activate(document.getElementById('yami-ai-fetch-models'), fetchModelList);
    activate(document.getElementById('yami-ai-balance'), showBalance);
    activate(document.getElementById('yami-ai-test'), testConnection);
    // 输入框下方的快捷调节：改动即生效，只提交改动项
    document.getElementById('yami-ai-model').addEventListener('change', event => quickUpdate({ model: event.target.value }));
    document.getElementById('yami-ai-effort').addEventListener('change', event => quickUpdate({ thinkingEffort: event.target.value }));
    document.getElementById('yami-ai-thinking').addEventListener('change', event => quickUpdate({ thinkingMode: event.target.checked ? 'enabled' : 'disabled' }));
    const viewSelect = document.getElementById('yami-ai-thinking-view');
    if (viewSelect) viewSelect.value = thinkingView();
    const foldSelect = document.getElementById('yami-ai-process-fold');
    if (foldSelect) foldSelect.value = processFoldMode();
    const busySelect = document.getElementById('yami-ai-busy-send');
    if (busySelect) busySelect.value = busySendMode();
    // 事件委托绑在设置面板上：面板内容重建也不会失效
    const settingsBox = document.getElementById('yami-ai-settings');
    if (settingsBox) {
      settingsBox.addEventListener('change', event => {
        if (event.target && event.target.id === 'yami-ai-thinking-view') setThinkingView(event.target.value);
        else if (event.target && event.target.id === 'yami-ai-process-fold') {
          setProcessFold(event.target.value);
          addMessage('system', '执行过程收起：' + (state.processFold === 'standard' ? '标准（始终展开）' : '紧凑（结束后自动收起）'));
        }
        else if (event.target && event.target.id === 'yami-ai-busy-send') {
          setBusySendMode(event.target.value);
          addMessage('system', '繁忙时发送：' + (state.busySend === 'interrupt' ? '打断当前一轮并立刻发出' : '排队，等这一轮跑完依次发出'));
        }
      });
    }
    activate(document.getElementById('yami-ai-clear'), async () => {
      if (state.pending || state.busy) return;
      try { await request('/clear', { sessionId: state.sessionId }); } catch (e) {}
      startNewSession();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !state.busy) return;
      // 只有「面板开着 + 正停在 AI 助手页」时才接管 Esc，不抢编辑器自己的 Esc 行为
      const dock = document.getElementById('yami-perf-dock');
      const page = document.getElementById('page-ai');
      const visible = dock && page && dock.classList.contains('show') && getComputedStyle(page).display !== 'none';
      if (!visible) return;
      event.preventDefault();
      stopStream();
    });
    document.getElementById('yami-ai-input').addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      // Enter = 发送（忙时的行为由设置决定：排队 / 打断）；Ctrl/Cmd+Enter = 保留的"引导"快捷键
      sendMessage(state.busy && (event.ctrlKey || event.metaKey) ? 'steer' : undefined);
    });
  }

  function waitForHud() {
    const api = window.__DANJUAN_HUD_API__;
    if (api && document.querySelector('.yami-home-modules')) mount(api);
    else setTimeout(waitForHud, 100);
  }

  window.__DANJUAN_AI_AGENT__ = { state, ensureHost, request };
  waitForHud();
})();
