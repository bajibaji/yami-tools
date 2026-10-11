(function(factory) {
  'use strict';
  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) module.exports = factory();
      else {
    const core = factory();
    if (!window.__DANJUAN_EDITOR_TOOLS__) core.mount(window, document);
  }
})(function() {
  'use strict';
  const DEFAULT_KEYS = { 'tools.commands': 'Ctrl+Shift+KeyP', 'tools.region': 'Ctrl+Shift+KeyR', 'tools.pin': '' };
  const RESERVED = new Set(['Ctrl+KeyS', 'Ctrl+KeyO', 'Ctrl+KeyN', 'Ctrl+KeyZ', 'Ctrl+KeyY', 'Ctrl+KeyC', 'Ctrl+KeyV', 'Ctrl+KeyX', 'Ctrl+KeyA', 'Ctrl+KeyW', 'Home', 'Escape', 'F1', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);
  function chord(event) {
    if (/^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(event.code || '')) return '';
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(event.code || event.key || '');
    return parts.join('+');
  }
  function keyLabel(value) { return String(value || '').replace(/Key(?=[A-Z])/g, '').replace(/Digit(?=[0-9])/g, '') || '未设置'; }
  function bindingError(id, value, keys) {
    if (!value) return '';
    if (!/^(?:(?:Ctrl|Alt|Shift)\+)*(?:Key[A-Z]|Digit[0-9]|F\d{1,2}|Arrow(?:Up|Down|Left|Right)|Space|Insert|Delete|Home|End|Escape)$/.test(value)) return '请录入一个有效组合键';
    if (RESERVED.has(value)) return '这个按键已由编辑器或文本编辑使用';
    if (!value.includes('Ctrl+') && !value.includes('Alt+') && !/^F\d+$/.test(value)) return '请使用 Ctrl 或 Alt 组合键，避免影响输入和地图操作';
    const other = Object.keys(keys).find(key => key !== id && keys[key] === value);
    return other ? '这个按键已绑定到其它操作' : '';
  }
  function flattenMenu(items, prefix, output = [], parentEnabled = true) {
    for (const item of items || []) {
      if (!item || item.type === 'separator' || !item.label) continue;
      const path = prefix.concat(String(item.label));
      const enabled = parentEnabled && item.enabled !== false;
      if (Array.isArray(item.submenu)) flattenMenu(item.submenu, path, output, enabled);
      else if (typeof item.click === 'function') output.push({ id: 'menu:' + path.join('/'), label: String(item.label), path: path.join(' > '), enabled, run: () => item.click(), accelerator: item.accelerator || '' });
    }
    return output;
  }
  function rank(actions, query, recent, favorites) {
    const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return actions.filter(item => terms.every(term => (item.label + ' ' + item.path).toLowerCase().includes(term)))
      .slice().sort((a, b) => {
        const score = item => (favorites.includes(item.id) ? 100 : 0) + (recent.includes(item.id) ? 20 - recent.indexOf(item.id) : 0) + (terms.length && item.label.toLowerCase().startsWith(terms[0]) ? 50 : 0);
        return score(b) - score(a);
      });
  }
  function samePin(pin, root, sceneId, presetId) {
    const norm = value => { const text = String(value || '').replace(/\\/g, '/').replace(/\/$/, ''); return /^[A-Za-z]:\//.test(text) ? text.toLowerCase() : text; };
    return !!pin && norm(pin.root) === norm(root) && pin.sceneId === sceneId && pin.presetId === presetId;
  }
  function mount(win, doc) {
    const state = { tab: 'commands', actions: [], menuActions: [], contextActions: [], rightTarget: null, collecting: false, keys: Object.assign({}, DEFAULT_KEYS), recent: [], favorites: [], pin: null, logs: [], signature: '', previousFocus: null, commandList: null, capturing: '', busy: false, mounted: false, remote: null, polling: false };
    win.__DANJUAN_EDITOR_TOOLS__ = { state, selectedRegion, refresh, open, runAction, monitor: monitorSnapshot };
    let configFile = '';
    try {
      const path = require('path'), os = require('os');
      const dir = process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite');
      configFile = path.join(dir, 'editor-tools.json');
    } catch (e) {}
    function readConfig() {
      try {
        const raw = configFile ? require('fs').readFileSync(configFile, 'utf8') : win.localStorage.getItem('danjuan-editor-tools');
        const data = raw ? JSON.parse(raw) : {};
        const keys = Object.assign({}, DEFAULT_KEYS);
        for (const [id, value] of Object.entries(data.keys || {})) if (typeof value === 'string' && !bindingError(id, value, keys)) keys[id] = value;
        state.keys = keys;
        state.recent = Array.isArray(data.recent) ? data.recent.filter(x => typeof x === 'string').slice(0, 20) : [];
        state.favorites = Array.isArray(data.favorites) ? data.favorites.filter(x => typeof x === 'string').slice(0, 100) : [];
        const pin = data.pin && typeof data.pin.presetId === 'string' ? data.pin : null;
        if (JSON.stringify(pin) !== JSON.stringify(state.pin)) { state.logs = []; state.remote = null; }
        state.pin = pin;
      } catch (e) {}
    }
    function saveConfig() {
      const value = { keys: state.keys, recent: state.recent, favorites: state.favorites, pin: state.pin };
      if (configFile) {
        const fs = require('fs'), path = require('path');
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        const tmp = configFile + '.tmp-' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(tmp, configFile);
      } else win.localStorage.setItem('danjuan-editor-tools', JSON.stringify(value));
    }
    readConfig();
    function engine(name) {
      if (name === 'Scene' && typeof Scene !== 'undefined') return Scene;
      if (name === 'Party' && typeof Party !== 'undefined') return Party;
      return (win.YamiEngine && win.YamiEngine[name]) || win[name];
    }
    function projectRoot() {
      const file = engine('File');
      if (file && typeof file.root === 'string' && file.root) return file.root;
      try {
        const fs = require('fs'), path = require('path'), os = require('os');
        if (win.location.protocol === 'file:') {
          const { fileURLToPath } = require('url');
          const dir = path.dirname(fileURLToPath(win.location.href.split('#')[0].split('?')[0]));
          if (fs.existsSync(path.join(dir, 'Data', 'config.json')) && fs.existsSync(path.join(dir, 'Assets'))) return dir;
        }
        if (doc.querySelector('#home.visible')) return '';
        const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openyami', 'config.json'), 'utf8'));
        return cfg.project ? path.dirname(cfg.project) : '';
      } catch (e) { return ''; }
    }
    function selectedRegion() {
      const scene = engine('Scene');
      const list = doc.getElementById('scene-list');
      const node = (list && typeof list.read === 'function' && list.read()) || (scene && scene.target);
      if (!node || node.class !== 'region' || !node.presetId) return null;
      const tabBar = doc.getElementById('title-tabBar');
      const tab = tabBar && typeof tabBar.read === 'function' ? tabBar.read() : null;
      if (tab && tab.type !== 'scene') return null;
      const meta = tab && tab.type === 'scene' ? tab.meta : scene && scene.meta;
      const path = meta && meta.path || '';
      const match = path.match(/\.([0-9a-f]{16})\.scene$/i);
      if (!path) return null;
      return { root: projectRoot(), sceneId: meta && meta.guid || match && match[1] || '', path,
        presetId: node.presetId, name: node.name || '未命名区域', x: node.x, y: node.y,
        width: node.width, height: node.height, enabled: node.enabled !== false,
        events: node.events || [], scripts: node.scripts || [] };
    }
    function status(text, error) {
      const el = doc.getElementById('dj-tools-status');
      if (el) { el.textContent = text; el.classList.toggle('error', !!error); }
    }
    function currentList() {
      if (state.commandList && state.commandList.isConnected && state.commandList.start !== null && state.commandList.getBoundingClientRect().width > 0) return state.commandList;
      return Array.from(doc.querySelectorAll('command-list')).find(el => el.start !== null && el.getBoundingClientRect().width > 0) || null;
    }
    doc.addEventListener('focusin', event => {
      const list = event.target.closest && event.target.closest('command-list');
      if (list) state.commandList = list;
      if (event.target.closest && !event.target.closest('#yami-perf-dock')) state.previousFocus = event.target;
    }, true);
    function menuOpen(menuId) {
      const el = doc.querySelector('#menu > item[value="' + menuId + '"]');
      if (!el) return [];
      el.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      const menu = Array.from(doc.querySelectorAll('menu-list')).find(item => item.state === 'open' && item.dataItems);
      if (!menu) return [];
      const label = el.textContent.trim();
      const actions = flattenMenu(menu.dataItems, [label]);
      if (typeof menu.close === 'function') menu.close();
      return actions;
    }
    function collectMenus() {
      const all = [];
      state.collecting = true;
      for (const el of doc.querySelectorAll('#menu > item[value]')) {
        const key = el.getAttribute('value');
        for (const item of menuOpen(key)) {
          item.menu = key;
          all.push(item);
        }
      }
      state.collecting = false;
      state.menuActions = all;
    }
    function hookMenus() {
      const type = win.customElements && win.customElements.get('menu-list');
      if (!type || type.prototype.__danjuanMenuHook) return;
      const original = type.prototype.popup;
      type.prototype.__danjuanMenuHook = true;
      type.prototype.popup = function(options, items) {
        if (!state.collecting && state.rightTarget && (!options || !options.parent || !options.parent.closest('#menu'))) {
          const parent = state.rightTarget;
          state.contextActions = flattenMenu(items, ['当前右键菜单']).map(item => Object.assign(item, { context: parent, enabled: item.enabled }));
        }
        return Reflect.apply(original, this, arguments);
      };
    }
    doc.addEventListener('pointerdown', event => {
      if (event.target.closest && !event.target.closest('#yami-perf-dock, menu-list, #menu')) {
        state.contextActions = [];
        state.rightTarget = event.button === 2 ? event.target : null;
      }
    }, true);
    function collectActions() {
      const built = [
        { id: 'tools.commands', label: '搜索菜单与指令', path: 'DanJuan > 快捷操作', run: () => open('commands') },
        { id: 'tools.region', label: '查看选中区域', path: 'DanJuan > 区域工具', run: () => open('region') },
        { id: 'tools.pin', label: '固定监视选中区域', path: 'DanJuan > 区域工具', run: pinSelected }
      ];
      const suggestions = doc.getElementById('command-suggestions');
      if (suggestions && typeof suggestions.updateCommandNames === 'function') {
        try { suggestions.updateCommandNames(); } catch (e) {}
      }
      const data = suggestions && (suggestions.data || (typeof suggestions.read === 'function' && suggestions.data));
      const scan = (nodes, path) => {
        for (const node of Array.isArray(nodes) ? nodes : []) {
          if (node.children) scan(node.children, path.concat(node.name || node.value));
          else if (node.value) built.push({ id: 'command:' + node.value, label: node.name || node.value, path: '事件指令 > ' + path.join(' > '), run: () => insertCommand(node.value) });
        }
      };
      scan(data, []);
      state.actions = built.concat(state.menuActions, state.contextActions);
    }
    function insertCommand(id) {
      const list = currentList();
      if (!list || typeof list.insert !== 'function') throw new Error('请先打开事件并选择插入位置');
      list.focus();
      list.insert(id);
    }
    function insertRegionCommand(operation, region) {
      if (!region || region.root !== projectRoot()) throw new Error('请先选择当前工程的区域');
      insertCommand('d4a9f612bc3e7805');
      const pane = doc.getElementById('scriptCommand-parameter-pane');
      const scripts = pane && typeof pane.getData === 'function' ? pane.getData() : [];
      const script = scripts.find(item => item.id === 'd4a9f612bc3e7805');
      if (!script || !pane || typeof pane.rewrite !== 'function') throw new Error('请先安装区域指令并重新打开自定义指令窗口');
      script.parameters.regionId = region.presetId;
      script.parameters.operation = operation;
      pane.rewrite(script.parameters, 'regionId');
      pane.rewrite(script.parameters, 'operation');
      status('已填入区域，请选择结果变量后确认指令');
    }
    async function runAction(id) {
      const item = state.actions.find(action => action.id === id);
      if (!item) { status('操作入口已变化，请重新打开快捷操作', true); return; }
      try {
        if (item.context && !state.contextActions.includes(item)) throw new Error('右键菜单的选择已变化，请重新右键选择目标');
        if (item.context && !item.enabled) throw new Error('这项操作在当前选择中不可用');
        if (item.menu) {
          if (state.previousFocus && state.previousFocus.isConnected) state.previousFocus.focus();
          const fresh = menuOpen(item.menu).find(action => action.id === id);
          if (!fresh || !fresh.enabled) throw new Error('这项操作在当前页面不可用');
          fresh.run();
        } else await item.run();
        state.recent = [id].concat(state.recent.filter(value => value !== id)).slice(0, 20);
        saveConfig();
        status('已执行：' + item.label);
      } catch (error) { status(error.message, true); }
    }
    function pinSelected() {
      const region = selectedRegion();
      if (!region || !region.root || !region.sceneId) throw new Error('请先在地图中选中一个区域');
      state.pin = { root: region.root, sceneId: region.sceneId, presetId: region.presetId, name: region.name, path: region.path };
      state.logs = [];
      saveConfig();
      refreshRegion();
    }
    const seenHooks = new WeakSet();
    function hookRegions() {
      if (!state.pin) return;
      const scene = engine('Scene');
      for (const region of scene && scene.region && scene.region.list || []) {
        if (seenHooks.has(region) || typeof region.emit !== 'function') continue;
        seenHooks.add(region);
        const original = region.emit;
        region.emit = function(type, actor) {
          const parent = this.parent && this.parent.scene;
          const id = parent && (parent.id || parent.data && parent.data.id) || scene.binding && scene.binding.id;
          if (samePin(state.pin, projectRoot(), id, this.presetId) && ['actorenter', 'actorleave', 'playerenter', 'playerleave'].includes(type)) {
            const words = { actorenter: '角色进入', actorleave: '角色离开', playerenter: '玩家进入', playerleave: '玩家离开' };
            state.logs.unshift(new Date().toLocaleTimeString() + ' ' + words[type] + '：' + (actor && (actor.name || actor.data && actor.data.name) || '未命名角色'));
            state.logs.length = Math.min(state.logs.length, 50);
          }
          return Reflect.apply(original, this, arguments);
        };
      }
    }
    function regionRuntime() {
      const pin = state.pin;
      if (!pin) return { text: '尚未固定监视区域', region: null };
      if (!samePin(pin, projectRoot(), pin.sceneId, pin.presetId)) return { text: '监视目标属于其它工程', region: null };
      const scene = engine('Scene');
      if (!scene || !scene.binding) return { text: '等待试玩加载该场景', region: null };
      const region = (scene.region && scene.region.list || []).find(item => {
        const parent = item.parent && item.parent.scene;
        return samePin(pin, projectRoot(), parent && parent.id || scene.binding.id, item.presetId);
      });
      if (!region) return { text: scene.binding.id === pin.sceneId ? '区域未启用或已删除' : '当前试玩位于其它场景', region: null };
      return { text: region.destroyed ? '区域已删除' : '正在监视', region: region.destroyed ? null : region };
    }
    function monitorSnapshot() {
      const runtime = regionRuntime(), region = runtime.region;
      return { ok: true, root: projectRoot(), pin: state.pin, text: runtime.text,
        region: region ? { x: region.x, y: region.y, width: region.width, height: region.height,
          actors: (region.actors || []).map(actor => actor.name || actor.data && actor.data.name || '未命名角色'),
          playerInside: (region.actors || []).includes(engine('Party') && engine('Party').player) } : null,
        logs: state.logs.slice(0, 50) };
    }
    function pollRuntime() {
      if (!state.pin || state.polling || engine('Scene') && engine('Scene').binding) return;
      try {
        const fs = require('fs'), path = require('path'), os = require('os');
        const dir = process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite');
        let port = 5966;
        try { const value = Number(fs.readFileSync(path.join(dir, 'runtime-port'), 'utf8')); if (value > 0 && value < 65536) port = value; } catch (e) {}
        state.polling = true;
        const req = require('http').get('http://127.0.0.1:' + port + '/region-monitor', { timeout: 800 }, res => {
          let raw = '';
          res.on('data', data => { raw += data; if (raw.length > 100000) req.destroy(); });
          res.on('end', () => {
            state.polling = false;
            try {
              const data = JSON.parse(raw);
              state.remote = samePin(state.pin, data.root, data.pin && data.pin.sceneId, data.pin && data.pin.presetId) ? data : null;
            } catch (e) { state.remote = null; }
          });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => { state.polling = false; state.remote = null; });
        req.on('close', () => { state.polling = false; });
      } catch (e) { state.polling = false; }
    }
    function addButton(parent, label, fn, title) {
      const button = doc.createElement('div');
      button.className = 'dj-tool-button';
      button.setAttribute('role', 'button'); button.tabIndex = 0;
      button.textContent = label; if (title) button.title = title;
      const invoke = event => { event.stopPropagation(); Promise.resolve().then(fn).catch(error => status(error.message, true)); };
      button.addEventListener('click', invoke);
      button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); invoke(event); } });
      parent.appendChild(button);
      return button;
    }
    function details(parent, rows) {
      const list = doc.createElement('dl'); list.className = 'dj-tools-details';
      for (const [key, value] of rows) {
        const dt = doc.createElement('dt'), dd = doc.createElement('dd');
        dt.textContent = key; dd.textContent = String(value == null ? '' : value);
        list.appendChild(dt); list.appendChild(dd);
      }
      parent.appendChild(list);
    }
    function refreshRegion() {
      const root = doc.getElementById('dj-tools-region'); if (!root) return;
      const selected = selectedRegion(), runtime = state.remote || monitorSnapshot(), r = runtime.region;
      const signature = JSON.stringify([selected, state.pin, runtime]);
      if (signature === state.signature) return;
      state.signature = signature; root.textContent = '';
      const heading = doc.createElement('h3'); heading.textContent = '选中区域'; root.appendChild(heading);
      if (selected) {
        details(root, [['名称', selected.name], ['场景', selected.path.split('/').pop()], ['状态', selected.enabled ? '已启用' : '未启用'], ['位置', selected.x + ', ' + selected.y], ['尺寸', selected.width + ' × ' + selected.height], ['事件', selected.events.length + ' 项'], ['脚本', selected.scripts.length + ' 项']]);
        const actions = doc.createElement('div'); actions.className = 'dj-tools-actions'; root.appendChild(actions);
        addButton(actions, '固定监视', pinSelected);
        addButton(actions, '复制区域 ID', () => win.navigator.clipboard.writeText(selected.presetId));
        addButton(actions, '打开区域事件', () => { const el = doc.getElementById('sceneRegion-events'); if (!el) throw new Error('请先打开区域检视器'); el.focus(); el.scrollIntoView({ block: 'nearest' }); });
        const commands = doc.createElement('div'); commands.className = 'dj-tools-actions'; root.appendChild(commands);
        for (const [operation, label] of [['info', '获取区域信息'], ['actors', '获取区内角色'], ['count', '获取角色数量'], ['contains', '判断角色在区域内']]) {
          addButton(commands, label, () => insertRegionCommand(operation, selected));
        }
      } else details(root, [['选择状态', '请在场景树或地图中选择一个区域']]);
      const watch = doc.createElement('h3'); watch.textContent = '试玩监视'; root.appendChild(watch);
      details(root, [['区域', state.pin && state.pin.name || '未设置'], ['状态', runtime.text], ['区内角色', r ? r.actors.length + ' 个' : '--'], ['玩家在区内', r ? (r.playerInside ? '是' : '否') : '--'], ['角色名单', r ? r.actors.join('、') || '空区域' : '--']]);
      const actions = doc.createElement('div'); actions.className = 'dj-tools-actions'; root.appendChild(actions);
      addButton(actions, '取消监视', () => { state.pin = null; state.logs = []; saveConfig(); refreshRegion(); });
      addButton(actions, '安装区域指令', installCommands);
      addButton(actions, '插入区域工具指令', () => insertCommand('d4a9f612bc3e7805'));
      const log = doc.createElement('div'); log.className = 'dj-tools-log'; log.textContent = runtime.logs.join('\n') || '暂无进入 / 离开记录'; root.appendChild(log);
    }
    async function installCommands() {
      if (state.busy) return;
      const root = projectRoot(); if (!root) throw new Error('请先打开游戏工程');
      const script = Array.from(doc.scripts).find(el => /\/editor-tools\.js(?:\?|$)/.test(el.src));
      const path = require('path'), fs = require('fs'), fileURLToPath = require('url').fileURLToPath;
      const candidates = [];
      if (script && script.src.startsWith('file:')) candidates.push(path.dirname(fileURLToPath(script.src)));
      candidates.push(path.join(process.cwd(), 'extension', 'yami-perf-extension'));
      candidates.push(path.join(path.dirname(process.execPath), 'extension', 'yami-perf-extension'));
      if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, '..', '..', 'extension', 'yami-perf-extension'));
      const pluginDir = candidates.find(dir => fs.existsSync(path.join(dir, 'runtime', 'region-commands', 'install.cjs')));
      if (!pluginDir) throw new Error('找不到区域指令安装包，请重新安装插件');
      const installer = require(path.join(pluginDir, 'runtime', 'region-commands', 'install.cjs'));
      const plan = installer.preview(root);
      if (plan.installed) { status('区域指令已安装'); return; }
      const data = engine('Data');
      if (data && data.manifest && data.manifest.changes.some(meta => meta.path === 'Data/commands.json')) throw new Error('指令列表有未保存修改，请先保存工程');
      if (!win.confirm('安装区域工具指令到当前工程？\n' + root + '\n\n添加脚本并注册 Data/commands.json，原注册表会自动备份。')) return;
      state.busy = true;
      try {
        await installer.installChecked(root, plan.commandsSha256);
        const file = engine('File'), directory = engine('Directory');
        if (data && file && typeof file.get === 'function') data.commands = await file.get({ path: 'Data/commands.json', type: 'json' });
        if (directory && typeof directory.update === 'function') await directory.update();
        status('区域工具已安装并编译检查完成，请重新打开自定义指令窗口');
      } finally { state.busy = false; }
    }
    function renderCommands() {
      const list = doc.getElementById('dj-tools-results'); if (!list) return;
      list.textContent = '';
      const input = doc.getElementById('dj-tools-query');
      const matches = rank(state.actions, input.value, state.recent, state.favorites);
      for (const item of matches.slice(0, 200)) {
        const row = doc.createElement('div'); row.className = 'dj-tools-row';
        const button = addButton(row, item.path + (state.keys[item.id] ? ' [' + keyLabel(state.keys[item.id]) + ']' : ''), () => runAction(item.id));
        button.classList.add('dj-tools-command');
        if (!item.enabled && item.menu) { button.setAttribute('aria-disabled', 'true'); button.classList.add('disabled'); }
        addButton(row, state.favorites.includes(item.id) ? '取消固定' : '固定', () => { state.favorites = state.favorites.includes(item.id) ? state.favorites.filter(id => id !== item.id) : state.favorites.concat(item.id); saveConfig(); renderCommands(); });
        list.appendChild(row);
      }
      if (!matches.length) list.textContent = '未找到匹配操作';
      const count = doc.getElementById('dj-tools-count'); count.textContent = matches.length > 200 ? '显示前 200 项 / 共 ' + matches.length + ' 项' : '共 ' + matches.length + ' 项';
    }
    function renderKeys() {
      const root = doc.getElementById('dj-tools-keys'); if (!root) return;
      root.textContent = '';
      for (const item of state.actions) {
        const row = doc.createElement('div'); row.className = 'dj-tools-row';
        const label = doc.createElement('span'); label.textContent = item.path; row.appendChild(label);
        addButton(row, state.capturing === item.id ? '按下组合键' : keyLabel(state.keys[item.id]), () => { state.capturing = item.id; renderKeys(); });
        addButton(row, '清除', () => { state.keys[item.id] = ''; saveConfig(); renderKeys(); });
        root.appendChild(row);
      }
      addButton(root, '恢复默认快捷键', () => { if (!win.confirm('恢复默认快捷键并清除自定义绑定？')) return; state.keys = Object.assign({}, DEFAULT_KEYS); saveConfig(); renderKeys(); });
    }
    function refresh() {
      if (state.tab === 'region') refreshRegion();
    }
    function open(tab) {
      const hud = win.__DANJUAN_HUD_API__; if (!hud || !state.mounted) return;
      if (!doc.activeElement || !doc.activeElement.closest('#yami-perf-dock')) state.previousFocus = doc.activeElement;
      if (tab !== 'region') { collectMenus(); collectActions(); }
      state.tab = tab || 'commands'; state.signature = '';
      hud.toggleDock(true); hud.switchView('editor-tools');
      doc.querySelectorAll('[data-dj-tab]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.djTab === state.tab)); el.classList.toggle('active', el.dataset.djTab === state.tab); });
      for (const key of ['commands', 'keys', 'region']) doc.getElementById('dj-tools-' + key).hidden = key !== state.tab;
      if (state.tab === 'commands') { renderCommands(); doc.getElementById('dj-tools-query').focus(); }
      else if (state.tab === 'keys') renderKeys();
      else refreshRegion();
    }
    win.addEventListener('keydown', event => {
      if (event.isComposing || event.repeat || event.keyCode === 229) return;
      if (state.capturing) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.code === 'Escape') { state.capturing = ''; renderKeys(); return; }
        const value = chord(event); if (!value) return;
        let error = bindingError(state.capturing, value, state.keys);
        const display = keyLabel(value).replace(/\s/g, '').toLowerCase();
        if (!error && state.menuActions.some(item => String(item.accelerator).replace(/\s/g, '').replace(/⌘/g, 'Ctrl').toLowerCase() === display)) error = '这个按键已由原生菜单使用';
        if (error) { status(error, true); return; }
        state.keys[state.capturing] = value; state.capturing = ''; saveConfig(); renderKeys(); status('快捷键已保存'); return;
      }
      const value = chord(event), id = Object.keys(state.keys).find(key => state.keys[key] && state.keys[key] === value);
      if (!id) return;
      const active = doc.activeElement;
      if (active && active.closest('input, textarea, [contenteditable="true"], .monaco-editor') && id !== 'tools.commands' && id !== 'tools.region') return;
      const modal = Array.from(doc.querySelectorAll('window-frame')).some(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
      const inEventList = active && active.closest('command-list');
      if (modal && !id.startsWith('tools.') && !(id.startsWith('command:') && inEventList)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (id === 'tools.commands') open('commands');
      else if (id === 'tools.region') open('region');
      else { collectMenus(); collectActions(); runAction(id); }
    }, true);
    function init() {
      const hud = win.__DANJUAN_HUD_API__, home = doc.querySelector('.yami-home-modules');
      if (!hud || !home) { win.setTimeout(init, 100); return; }
      state.mounted = true;
      const page = doc.createElement('div'); page.id = 'page-editor-tools'; page.className = 'yami-suite-page dj-tools';
      page.style.setProperty('display', 'none', 'important');
      page.innerHTML = '<div class="dj-tools-tabs"><div role="button" tabindex="0" data-dj-tab="commands">命令搜索</div><div role="button" tabindex="0" data-dj-tab="keys">快捷键</div><div role="button" tabindex="0" data-dj-tab="region">区域工具</div></div><div id="dj-tools-status" role="status"></div><div id="dj-tools-commands"><label for="dj-tools-query">搜索操作</label><input id="dj-tools-query" type="search" autocomplete="off" placeholder="例如：变量、保存、显示文本"><div id="dj-tools-count"></div><div id="dj-tools-results"></div></div><div id="dj-tools-keys" hidden></div><div id="dj-tools-region" hidden></div>';
      doc.querySelector('.yami-perf-dock-body').appendChild(page);
      hud.registerPage('editor-tools', page, { title: '快捷操作', showBack: true, refresh, destroy() { state.capturing = ''; } });
      const entry = addButton(home, '快捷操作', () => open('commands')); entry.classList.add('yami-home-module-item'); entry.id = 'dj-tools-entry';
      for (const el of page.querySelectorAll('[data-dj-tab]')) {
        const go = () => open(el.dataset.djTab); el.classList.add('dj-tool-button'); el.addEventListener('click', go);
        el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } });
      }
      const input = doc.getElementById('dj-tools-query'); input.addEventListener('input', renderCommands);
      page.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); hud.switchView('home'); if (state.previousFocus && state.previousFocus.isConnected) state.previousFocus.focus(); return; }
        if (state.tab !== 'commands' || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || event.isComposing) return;
        const items = Array.from(page.querySelectorAll('.dj-tools-command:not(.disabled)'));
        if (!items.length) return;
        if (event.key === 'Enter' && event.target === input) { event.preventDefault(); items[0].click(); }
        else if (event.key !== 'Enter') {
          event.preventDefault(); const index = items.indexOf(doc.activeElement);
          items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        }
      });
      const regionEvents = doc.getElementById('sceneRegion-events');
      if (regionEvents && regionEvents.parentElement) addButton(regionEvents.parentElement, '区域工具', () => open('region'));
      collectActions();
      let tick = 0;
      win.setInterval(() => {
        if (++tick % 10 === 0 && !state.capturing) readConfig();
        hookRegions();
        hookMenus();
        if (hud.ctx && hud.ctx.currentView === 'editor-tools') { if (state.tab === 'region') pollRuntime(); refresh(); }
      }, 500);
    }
    init();
  }
  return { chord, keyLabel, bindingError, flattenMenu, rank, samePin, mount };
});
