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
    mounted: false
  };
  state.token = sharedToken();
  localStorage.setItem('danjuan-ai-session', state.sessionId);

  function editorProjectRoot() {
    try {
      if (window.File && typeof window.File.root === 'string' && window.File.root) return window.File.root;
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
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(process.cwd(), 'extension', 'yami-perf-extension'),
      path.join(process.resourcesPath || '', '..', 'extension', 'yami-perf-extension'),
      'D:/Program Files/Open Yami RPG Editor/extension/yami-perf-extension'
    ];
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
    if (!root) throw new Error('找不到插件运行目录，请重新安装 DanJuan妙妙插件');
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

  function addMessage(kind, text) {
    const list = document.getElementById('yami-ai-messages');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'yami-ai-message ' + kind;
    item.textContent = String(text || '');
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
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
      send.classList.toggle('disabled', state.busy);
      send.setAttribute('aria-disabled', state.busy ? 'true' : 'false');
      send.textContent = state.busy ? '处理中' : '发送';
    }
  }

  function renderApproval(data) {
    state.pending = data.approval;
    const box = document.getElementById('yami-ai-approval');
    const detail = document.getElementById('yami-ai-approval-detail');
    if (!box || !detail) return;
    const a = data.approval || {};
    detail.textContent = (a.target ? '目标：' + a.target + '\n' : '') + (a.summary ? '操作：' + a.summary + '\n' : '') + (a.message || '准备执行修改');
    box.classList.add('show');
    setStatus('等待确认', 'waiting');
  }

  function handleResult(data) {
    if (data.message) addMessage('assistant', data.message);
    if (data.status === 'approval') renderApproval(data);
    else { state.pending = null; document.getElementById('yami-ai-approval')?.classList.remove('show'); setStatus('就绪', 'ready'); }
  }

  async function sendMessage() {
    if (state.busy || state.pending) return;
    const input = document.getElementById('yami-ai-input');
    const text = input && input.value.trim();
    if (!text) { input?.focus(); return; }
    input.value = '';
    addMessage('user', text);
    setBusy(true);
    setStatus('正在处理', 'working');
    try {
      await ensureHost();
      const root = editorProjectRoot();
      if (!root) throw new Error('请先在 Open Yami 中打开一个游戏工程');
      await request('/project', { projectRoot: root });
      handleResult(await request('/chat', { sessionId: state.sessionId, message: text }));
    } catch (e) {
      addMessage('error', e.message + '。请检查设置后重试。');
      setStatus('需要处理', 'error');
    } finally { setBusy(false); }
  }

  async function decide(approve) {
    if (state.busy || !state.pending) return;
    setBusy(true);
    setStatus(approve ? '正在执行' : '正在取消', 'working');
    try {
      const route = approve ? '/approve' : '/reject';
      handleResult(await request(route, { sessionId: state.sessionId }));
    } catch (e) {
      addMessage('error', e.message + '。修改未完成，可重新发送需求。');
      setStatus('需要处理', 'error');
    } finally { setBusy(false); }
  }

  async function saveSettings() {
    const endpoint = document.getElementById('yami-ai-endpoint').value.trim();
    const model = document.getElementById('yami-ai-model').value.trim();
    const apiKey = document.getElementById('yami-ai-key').value.trim();
    const approvalMode = document.getElementById('yami-ai-mode').checked ? 'auto' : 'confirm';
    try {
      await ensureHost();
      const config = await request('/config', { endpoint, model, apiKey, approvalMode });
      document.getElementById('yami-ai-key').value = '';
      document.getElementById('yami-ai-key').placeholder = config.hasApiKey ? '已安全保存，留空不修改' : 'DeepSeek API Key';
      document.getElementById('yami-ai-settings').classList.remove('show');
      addMessage('system', '模型设置已保存。');
      setStatus('就绪', 'ready');
    } catch (e) { addMessage('error', e.message + '。请检查模型地址和密钥。'); }
  }

  async function loadSettings() {
    try {
      await ensureHost();
      const config = await request('/config');
      document.getElementById('yami-ai-endpoint').value = config.endpoint || '';
      document.getElementById('yami-ai-model').value = config.model || '';
      document.getElementById('yami-ai-mode').checked = config.approvalMode === 'auto';
      document.getElementById('yami-ai-key').placeholder = config.hasApiKey ? '已安全保存，留空不修改' : 'DeepSeek API Key';
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
    page.innerHTML = '<div class="yami-ai-toolbar"><div class="yami-ai-status idle" id="yami-ai-status" role="status">尚未启动</div><div class="yami-ai-tool-btn" id="yami-ai-clear" role="button" tabindex="0">新对话</div><div class="yami-ai-tool-btn" id="yami-ai-settings-toggle" role="button" tabindex="0">设置</div></div><div class="yami-ai-settings" id="yami-ai-settings"><label for="yami-ai-endpoint">模型地址</label><input id="yami-ai-endpoint" type="url" value="https://api.deepseek.com/chat/completions"><label for="yami-ai-model">模型名称</label><input id="yami-ai-model" type="text" value="deepseek-chat"><label for="yami-ai-key">API Key</label><input id="yami-ai-key" type="password" autocomplete="off" placeholder="DeepSeek API Key"><label class="yami-ai-check"><input id="yami-ai-mode" type="checkbox"><span>编辑器操作自动执行，工程文件仍需确认</span></label><div class="yami-ai-primary" id="yami-ai-save-settings" role="button" tabindex="0">保存设置</div></div><div class="yami-ai-messages" id="yami-ai-messages" role="log" aria-live="polite"><div class="yami-ai-message assistant">告诉我你想做什么。我会先查看工程，涉及文件修改时会让你确认。</div></div><div class="yami-ai-approval" id="yami-ai-approval" role="alert"><div class="yami-ai-approval-title">确认执行</div><pre id="yami-ai-approval-detail"></pre><div class="yami-ai-approval-actions"><div class="yami-ai-secondary" id="yami-ai-reject" role="button" tabindex="0">取消修改</div><div class="yami-ai-primary" id="yami-ai-approve" role="button" tabindex="0">执行修改</div></div></div><div class="yami-ai-compose"><label for="yami-ai-input">你的需求</label><textarea id="yami-ai-input" rows="3" placeholder="例如：检查当前工程报错，并修复相关脚本"></textarea><div class="yami-ai-primary" id="yami-ai-send" role="button" tabindex="0" aria-disabled="false">发送</div></div>';
    document.querySelector('.yami-perf-dock-body').appendChild(page);
    api.registerPage('ai', page, { title: 'AI 助手', showBack: true, showModeSwitch: false, showClearErrors: false, showTabs: false, showExportBtns: false, refresh() {}, destroy() {} });
    activate(card, () => { api.switchView('ai'); loadSettings(); });
    activate(document.getElementById('yami-ai-send'), sendMessage);
    activate(document.getElementById('yami-ai-approve'), () => decide(true));
    activate(document.getElementById('yami-ai-reject'), () => decide(false));
    activate(document.getElementById('yami-ai-settings-toggle'), () => document.getElementById('yami-ai-settings').classList.toggle('show'));
    activate(document.getElementById('yami-ai-save-settings'), saveSettings);
    activate(document.getElementById('yami-ai-clear'), async () => {
      if (state.pending || state.busy) return;
      try { await request('/clear', { sessionId: state.sessionId }); } catch (e) {}
      state.sessionId = 'session-' + Date.now().toString(36);
      localStorage.setItem('danjuan-ai-session', state.sessionId);
      document.getElementById('yami-ai-messages').innerHTML = '<div class="yami-ai-message assistant">新对话已开始。告诉我你想做什么。</div>';
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
