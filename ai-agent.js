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
    abort: null
  };
  state.token = sharedToken();
  localStorage.setItem('danjuan-ai-session', state.sessionId);

  // 当前这一轮的思考过程块与起始时刻（严格模式下必须显式声明，否则出现隐式全局）
  let currentThinkingEl = null;
  let thinkingStartedAt = 0;
  // 当前回合容器：过程区（思考+工具）与正文槽都挂在它下面
  let currentTurn = null;

  // 逐 token 的流式渲染必须按帧合并：片段再多，一帧也只写一次 DOM。
  // 旧实现每来一个片段就重设全文 + 拉滚动条，是 O(n^2)，上下文一长整页卡死。
  const renderCore = (typeof window !== 'undefined' && window.YamiAiRenderCore) || null;
  const scheduler = renderCore ? renderCore.createScheduler() : null;
  const messageList = () => document.getElementById('yami-ai-messages');

  function scheduleRender(fn) {
    if (scheduler) { scheduler.schedule(fn); return; }
    fn();
  }

  /** 只有用户本来就在底部附近才自动跟随；往上翻看历史时不要把他拽回来 */
  function autoScroll() {
    const list = messageList();
    if (!list) return;
    if (renderCore && !renderCore.shouldStickToBottom({ scrollHeight: list.scrollHeight, scrollTop: list.scrollTop, clientHeight: list.clientHeight })) return;
    autoScroll();
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
    const parts = [];
    if (thinkingStartedAt) parts.push('思考 ' + Math.max(1, Math.round((Date.now() - thinkingStartedAt) / 1000)) + ' 秒');
    if (area.steps) parts.push(area.steps + ' 步');
    const text = parts.join(' · ');
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
    const used = Math.round(context.chars / 1000);
    const budget = Math.round(context.budget / 1000);
    el.textContent = '上下文 ' + used + 'k/' + budget + 'k' + (context.summary ? ' · 已压缩' : '');
    el.classList.add('show');
    el.title = '已压缩：较早的对话被折叠成摘要，最近消息保持原样';
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
    if (placeholder) addMessage('assistant', placeholder);
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
      for (const message of win.shown) addMessage(message.role === 'user' ? 'user' : 'assistant', message.content);
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
    let toolLine = null;
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
    const reasoningBuffer = renderCore ? renderCore.createTextBuffer() : null;
    let bubbleTextNode = null;
    let thinkingTextNode = null;

    const flushContent = () => {
      if (!bubble || !contentBuffer) return;
      if (!bubbleTextNode || !bubbleTextNode.isConnected) {
        bubble.textContent = '';
        bubbleTextNode = document.createTextNode(contentBuffer.toString());
        bubble.appendChild(bubbleTextNode);
      } else if (bubbleTextNode.data.length !== contentBuffer.length()) {
        bubbleTextNode.appendData(contentBuffer.toString().slice(bubbleTextNode.data.length));
      }
    };
    const flushThinking = () => {
      if (!currentThinkingEl || !reasoningBuffer) return;
      currentThinkingEl.dataset.text = reasoningBuffer.toString();
      if (thinkingView() === 'expand') {
        const body = currentThinkingEl.querySelector('.yami-ai-thinking-body');
        if (body) {
          if (!thinkingTextNode || !thinkingTextNode.isConnected) {
            body.textContent = '';
            thinkingTextNode = document.createTextNode(reasoningBuffer.toString());
            body.appendChild(thinkingTextNode);
          } else if (thinkingTextNode.data.length !== reasoningBuffer.length()) {
            thinkingTextNode.appendData(reasoningBuffer.toString().slice(thinkingTextNode.data.length));
          }
        }
      }
      const meta = currentThinkingEl.querySelector('.yami-ai-thinking-meta');
      if (meta) {
        const seconds = Math.max(1, Math.round((Date.now() - thinkingStartedAt) / 1000));
        meta.textContent = '已思考 ' + seconds + ' 秒 · ' + reasoningBuffer.length() + ' 字';
      }
    };

    const handleEvent = event => {
      if (!event || !event.type) return;
      if (event.type === 'status') { setStatus(event.text || '正在处理', 'working'); return; }
      if (event.type === 'delta') {
        // 思考过程（reasoning_content）：单独一块，流式追加，默认展开
        if (event.reasoning) {
          hasReasoning = true;
          if (reasoningBuffer) reasoningBuffer.append(event.reasoning);
          else reasoning$ += event.reasoning;
          if (!currentThinkingEl || !currentThinkingEl.isConnected) renderThinking('');
          scheduleRender(() => { flushThinking(); refreshProcessMeta(); autoScroll(); });
          return;
        }
        if (!event.content) return;
        received = true;
        if (!bubble) {
          finalizeThinking();   // 正文开始 → 思考块收尾（补上耗时与字数）
          bubble = addMessage('assistant', '');
        }
        if (contentBuffer) contentBuffer.append(event.content);
        else text$ += event.content;
        scheduleRender(() => { flushContent(); autoScroll(); });
        return;
      }
      if (event.type === 'tool') {
        if (event.phase === 'start') { toolLine = pushNotice('执行：' + (event.label || event.name) + (event.target ? ' · ' + event.target : '')); return; }
        if (toolLine) {
          if (event.phase === 'done') { toolLine.textContent = '完成：' + (event.label || event.name) + (event.target ? ' · ' + event.target : ''); toolLine.classList.add('ok'); }
          else if (event.phase === 'fail') { toolLine.textContent = '失败：' + (event.label || event.name) + ' · ' + (event.detail || '执行失败'); toolLine.classList.add('bad'); }
          else if (event.phase === 'approval') { toolLine.textContent = '待确认：' + (event.label || event.name); toolLine.classList.add('wait'); }
          toolLine = null;
        }
        return;
      }
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
    }
    return finalResult;
  }

  /** 思考过程显示模式：expand 展开（默认）/ collapse 折叠 / preview 单行预览 */
  function thinkingView() {
    const saved = localStorage.getItem('danjuan-ai-thinking-view');
    // 默认单行预览：一条思考只占一行（点开可看全文），避免大段灰字横在对话中间
    return ['expand', 'collapse', 'preview'].includes(saved) ? saved : 'preview';
  }

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
      const lines = String(el.dataset.text || '').split('\n').filter(Boolean);
      body.textContent = lines.length ? lines[lines.length - 1].slice(0, 160) : '';
    } else if (body) {
      body.textContent = el.dataset.text || '';
    }
  }

  /** 创建或更新思考块（流式过程中反复调用） */
  function renderThinking(fullText) {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return;
    if (!currentThinkingEl || !currentThinkingEl.isConnected) {
      currentThinkingEl = document.createElement('div');
      currentThinkingEl.className = 'yami-ai-thinking';
      const head = document.createElement('div');
      head.className = 'yami-ai-thinking-head';
      const title = document.createElement('span');
      title.className = 'yami-ai-thinking-title';
      title.textContent = '思考过程';
      const meta = document.createElement('span');
      meta.className = 'yami-ai-thinking-meta';
      const toggle = document.createElement('div');
      toggle.className = 'yami-ai-thinking-toggle';
      toggle.setAttribute('role', 'button');
      toggle.setAttribute('tabindex', '0');
      toggle.setAttribute('aria-label', '展开或收起思考过程');
      activate(toggle, event => {
        event.stopPropagation();
        // 手动点击：展开 <-> 折叠（单行预览状态下点击直接展开），并让全局开关跟随
        const target = currentThinkingEl;
        if (!target) return;
        const next = target.classList.contains('collapsed') || target.classList.contains('preview') ? 'expand' : 'collapse';
        localStorage.setItem('danjuan-ai-thinking-view', next);
        const select = document.getElementById('yami-ai-thinking-view');
        if (select) select.value = next;
        applyThinkingMode(target);
      });
      const body = document.createElement('div');
      body.className = 'yami-ai-thinking-body';
      head.appendChild(title);
      head.appendChild(meta);
      head.appendChild(toggle);
      currentThinkingEl.appendChild(head);
      currentThinkingEl.appendChild(body);
      // 思考条进「执行过程」区，和工具步骤集中在一起；没有活跃回合（历史回放）才退回列表
      const area = processArea();
      (area ? area.body : list).appendChild(currentThinkingEl);
      thinkingStartedAt = Date.now();
      refreshProcessMeta();
    }
    currentThinkingEl.dataset.text = fullText;
    const meta = currentThinkingEl.querySelector('.yami-ai-thinking-meta');
    if (meta) {
      const seconds = Math.max(1, Math.round((Date.now() - thinkingStartedAt) / 1000));
      meta.textContent = '已思考 ' + seconds + ' 秒 · ' + fullText.length + ' 字';
    }
    applyThinkingMode(currentThinkingEl);
    refreshProcessMeta();
    autoScroll();
  }

  /** 思考结束（正文开始或本轮收尾时调用） */
  function finalizeThinking() {
    if (currentThinkingEl) applyThinkingMode(currentThinkingEl);
  }

  /** 切换显示模式时，同步更新历史上所有思考块 */
  function applyThinkingModeToAll() {
    for (const el of document.querySelectorAll('.yami-ai-thinking')) applyThinkingMode(el);
  }

  async function sendMessage() {
    if (state.busy || state.pending) return;
    const input = document.getElementById('yami-ai-input');
    const text = input && input.value.trim();
    if (!text) { input?.focus(); return; }
    input.value = '';
    addMessage('user', text);
    currentThinkingEl = null;
    thinkingStartedAt = 0;
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
        addMessage('error', e.message + '。请检查设置后重试。');
        setStatus('需要处理', 'error');
      }
    } finally {
      setBusy(false);
      refreshProcessMeta();
      endTurn();
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
    page.innerHTML = '<div class="yami-ai-toolbar"><div class="yami-ai-status idle" id="yami-ai-status" role="status">尚未启动</div><div class="yami-ai-context" id="yami-ai-context" role="status"></div><div class="yami-ai-tool-btn" id="yami-ai-undo-toggle" role="button" tabindex="0">撤销</div><div class="yami-ai-tool-btn" id="yami-ai-history-toggle" role="button" tabindex="0">历史</div><div class="yami-ai-tool-btn" id="yami-ai-clear" role="button" tabindex="0">新对话</div><div class="yami-ai-tool-btn" id="yami-ai-settings-toggle" role="button" tabindex="0">设置</div></div><div class="yami-ai-undo" id="yami-ai-undo"></div><div class="yami-ai-history" id="yami-ai-history"></div><div class="yami-ai-settings" id="yami-ai-settings"><label for="yami-ai-endpoint">BASE URL（OpenAI 格式）</label><input id="yami-ai-endpoint" type="url" value="https://api.deepseek.com" placeholder="https://api.deepseek.com"><label for="yami-ai-key">API Key</label><input id="yami-ai-key" type="password" autocomplete="off" placeholder="DeepSeek API Key"><label class="yami-ai-check"><input id="yami-ai-mode" type="checkbox"><span>编辑器操作自动执行，工程文件仍需确认</span></label><div class="yami-ai-hint" id="yami-ai-key-state"></div><label for="yami-ai-thinking-view">思考过程显示</label><select id="yami-ai-thinking-view" title="思考过程在对话里的显示方式"><option value="expand" selected>展开</option><option value="preview">单行预览</option><option value="collapse">折叠</option></select><div class="yami-ai-model-row"><div class="yami-ai-secondary" id="yami-ai-test" role="button" tabindex="0">测试连接</div><div class="yami-ai-secondary" id="yami-ai-balance" role="button" tabindex="0">查余额</div><div class="yami-ai-hint" id="yami-ai-money"></div></div><div class="yami-ai-primary" id="yami-ai-save-settings" role="button" tabindex="0">保存设置</div></div><div class="yami-ai-messages" id="yami-ai-messages" role="log" aria-live="polite"><div class="yami-ai-message assistant">告诉我你想做什么。我会先查看工程，涉及文件修改时会让你确认。</div></div><div class="yami-ai-approval" id="yami-ai-approval" role="alert"><div class="yami-ai-approval-title">确认执行</div><div class="yami-ai-approval-stat" id="yami-ai-approval-stat"></div><pre id="yami-ai-approval-detail"></pre><div class="yami-ai-approval-diff" id="yami-ai-approval-diff"></div><label class="yami-ai-check yami-ai-grant"><input id="yami-ai-grant" type="checkbox"><span>本次任务内，这个文件不再逐条确认（随时可撤销）</span></label><div class="yami-ai-approval-actions"><div class="yami-ai-secondary" id="yami-ai-reject" role="button" tabindex="0">取消修改</div><div class="yami-ai-primary" id="yami-ai-approve" role="button" tabindex="0">执行修改</div></div></div><div class="yami-ai-compose"><label for="yami-ai-input">你的需求</label><textarea id="yami-ai-input" rows="3" placeholder="例如：检查当前工程报错，并修复相关脚本"></textarea><div class="yami-ai-devbar"><label for="yami-ai-model">模型</label><select id="yami-ai-model" title="模型（可点【拉取模型】刷新列表）"></select><div class="yami-ai-tool-btn" id="yami-ai-fetch-models" role="button" tabindex="0" title="从服务端拉取可用模型">↻</div><label class="yami-ai-check"><input id="yami-ai-thinking" type="checkbox" checked><span>Thinking</span></label><select id="yami-ai-effort" title="思考强度"><option value="low">Low</option><option value="high" selected>High</option><option value="max">Max</option></select></div><div class="yami-ai-primary" id="yami-ai-send" role="button" tabindex="0" aria-disabled="false">发送</div></div>';
    document.querySelector('.yami-perf-dock-body').appendChild(page);
    api.registerPage('ai', page, { title: 'AI 助手', showBack: true, showModeSwitch: false, showClearErrors: false, showTabs: false, showExportBtns: false, refresh() {}, destroy() {} });
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
    if (viewSelect) {
      viewSelect.value = thinkingView();
      viewSelect.addEventListener('change', event => {
        localStorage.setItem('danjuan-ai-thinking-view', event.target.value);
        applyThinkingModeToAll();
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
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
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
