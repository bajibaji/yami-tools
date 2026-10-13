(function(factory) {
  'use strict';
  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const core = factory();
    if (!window.__DANJUAN_EDITOR_TOOLS__) core.mount(window, document);
  }
})(function() {
  'use strict';

  function calculateBounds(region) {
    if (!region) return { left: 0, top: 0, right: 0, bottom: 0 };
    const x = Number(region.x) || 0;
    const y = Number(region.y) || 0;
    const width = Number(region.width) || 0;
    const height = Number(region.height) || 0;
    return {
      left: Math.round(x - width / 2),
      top: Math.round(y - height / 2),
      right: Math.round(x + width / 2),
      bottom: Math.round(y + height / 2)
    };
  }

  function samePin(pin, root, sceneId, presetId) {
    const norm = value => {
      const text = String(value || '').replace(/\\/g, '/').replace(/\/$/, '');
      return /^[A-Za-z]:\//.test(text) ? text.toLowerCase() : text;
    };
    return !!pin && norm(pin.root) === norm(root) && pin.sceneId === sceneId && pin.presetId === presetId;
  }

  function mount(win, doc) {
    const state = {
      pin: null,
      logs: [],
      signature: '',
      previousFocus: null,
      commandList: null,
      busy: false,
      mounted: false,
      remote: null,
      polling: false,
      activeTab: 'region',
      radarFilter: 'all',
      radarSearchQuery: '',
      radarViewMode: 'cards', // 'cards' (聚合独立卡片) | 'stream' (原始时间线流水)
      selectedCardKey: null,  // 选中的单独卡片 key (展开检视)
      autoFocus: true,        // 动作驱动: 试玩触发新动作时自动聚焦其专属卡片
      lastTotalCount: 0,
      pollingRadar: false,
      remoteRadar: null
    };

    win.__DANJUAN_EDITOR_TOOLS__ = {
      state,
      selectedRegion,
      calculateBounds,
      refresh,
      open,
      monitor: monitorSnapshot,
      insertClampCameraCommand,
      insertUnclampCameraCommand,
      insertRegionCommand,
      installCommands,
      refreshAudioRadar,
      getAudioRadarData
    };

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
        const pin = data.pin && typeof data.pin.presetId === 'string' ? data.pin : null;
        if (JSON.stringify(pin) !== JSON.stringify(state.pin)) {
          state.logs = [];
          state.remote = null;
        }
        state.pin = pin;
      } catch (e) {}
    }

    function saveConfig() {
      const value = { pin: state.pin };
      if (configFile) {
        const fs = require('fs'), path = require('path');
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        const tmp = configFile + '.tmp-' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(tmp, configFile);
      } else {
        win.localStorage.setItem('danjuan-editor-tools', JSON.stringify(value));
      }
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
      const bounds = calculateBounds(node);
      return {
        root: projectRoot(),
        sceneId: meta && meta.guid || match && match[1] || '',
        path,
        presetId: node.presetId,
        name: node.name || '未命名区域',
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        enabled: node.enabled !== false,
        events: node.events || [],
        scripts: node.scripts || []
      };
    }

    function status(text, error) {
      const el = doc.getElementById('dj-tools-status');
      if (el) {
        el.textContent = text;
        el.classList.toggle('error', !!error);
      }
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

    function insertCommand(id) {
      const list = currentList();
      if (!list || typeof list.insert !== 'function') throw new Error('请先打开事件并选择插入位置');
      list.focus();
      list.insert(id);
    }

    async function insertClampCameraCommand(region) {
      const r = region || selectedRegion();
      if (!r) throw new Error('请先选择一个场景区域');
      const bounds = calculateBounds(r);
      insertCommand('clampCamera');

      // 尝试自动填入参数输入框
      for (let i = 0; i < 6; i++) {
        await new Promise(resolve => win.setTimeout(resolve, 50));
        const leftInput = doc.getElementById('clampCamera-left');
        const topInput = doc.getElementById('clampCamera-top');
        const rightInput = doc.getElementById('clampCamera-right');
        const bottomInput = doc.getElementById('clampCamera-bottom');
        if (leftInput && topInput && rightInput && bottomInput) {
          if (typeof leftInput.write === 'function') {
            leftInput.write({ type: 'number', value: bounds.left });
            topInput.write({ type: 'number', value: bounds.top });
            rightInput.write({ type: 'number', value: bounds.right });
            bottomInput.write({ type: 'number', value: bounds.bottom });
            status(`已自动填入边界限制指令 (L:${bounds.left} T:${bounds.top} R:${bounds.right} B:${bounds.bottom})`);
            return;
          }
        }
      }
      try {
        await win.navigator.clipboard.writeText(`Left: ${bounds.left}, Top: ${bounds.top}, Right: ${bounds.right}, Bottom: ${bounds.bottom}`);
        status(`已插入锁定指令，边界数值已复制到剪贴板 (L:${bounds.left} T:${bounds.top} R:${bounds.right} B:${bounds.bottom})`);
      } catch (e) {
        status(`已插入锁定指令 (边界 L:${bounds.left} T:${bounds.top} R:${bounds.right} B:${bounds.bottom})`);
      }
    }

    function insertUnclampCameraCommand() {
      insertCommand('unclampCamera');
      status('已插入解除摄像机边界指令');
    }

    async function insertRegionCommand(operation, region) {
      const r = region || selectedRegion();
      if (!r || r.root !== projectRoot()) throw new Error('请先选择当前工程的有效区域');
      insertCommand('d4a9f612bc3e7805');
      let pane = null;
      for (let i = 0; i < 6; i++) {
        await new Promise(resolve => win.setTimeout(resolve, 50));
        pane = doc.getElementById('scriptCommand-parameter-pane');
        if (pane && typeof pane.getData === 'function' && typeof pane.rewrite === 'function') break;
      }
      const scripts = pane && typeof pane.getData === 'function' ? pane.getData() : [];
      const script = scripts.find(item => item.id === 'd4a9f612bc3e7805');
      if (script && pane && typeof pane.rewrite === 'function') {
        script.parameters.regionId = r.presetId;
        script.parameters.operation = operation;
        if (operation === 'setPosition') {
          script.parameters.x = r.x;
          script.parameters.y = r.y;
        } else if (operation === 'setSize') {
          script.parameters.width = r.width;
          script.parameters.height = r.height;
        }
        pane.rewrite(script.parameters, 'regionId');
        pane.rewrite(script.parameters, 'operation');
        status('已填入区域与操作参数，请确认指令');
      } else {
        status('已插入区域工具指令，请在参数窗口中确认区域与操作');
      }
    }

    function pinSelected() {
      const region = selectedRegion();
      if (!region || !region.root || !region.sceneId) throw new Error('请先在地图中选中一个区域');
      state.pin = {
        root: region.root,
        sceneId: region.sceneId,
        presetId: region.presetId,
        name: region.name,
        path: region.path
      };
      state.logs = [];
      saveConfig();
      refreshRegion();
      status('已固定监视区域：' + region.name);
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
      return {
        ok: true,
        root: projectRoot(),
        pin: state.pin,
        text: runtime.text,
        region: region ? {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          actors: (region.actors || []).map(actor => actor.name || actor.data && actor.data.name || '未命名角色'),
          playerInside: (region.actors || []).includes(engine('Party') && engine('Party').player)
        } : null,
        logs: state.logs.slice(0, 50)
      };
    }

    function pollRuntime() {
      if (!state.pin || state.polling || engine('Scene') && engine('Scene').binding) return;
      try {
        const fs = require('fs'), path = require('path'), os = require('os');
        const dir = process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite');
        let port = 5966;
        try {
          const value = Number(fs.readFileSync(path.join(dir, 'runtime-port'), 'utf8'));
          if (value > 0 && value < 65536) port = value;
        } catch (e) {}
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

    function addButton(parent, label, fn, title, isPrimary) {
      const button = doc.createElement('div');
      button.className = 'dj-tool-button' + (isPrimary ? ' primary' : '');
      button.setAttribute('role', 'button');
      button.tabIndex = 0;
      button.textContent = label;
      if (title) button.title = title;
      const invoke = event => {
        event.stopPropagation();
        Promise.resolve().then(fn).catch(error => status(error.message, true));
      };
      button.addEventListener('click', invoke);
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          invoke(event);
        }
      });
      parent.appendChild(button);
      return button;
    }

    function details(parent, rows) {
      const list = doc.createElement('dl');
      list.className = 'dj-tools-details';
      for (const [key, value] of rows) {
        const dt = doc.createElement('dt'), dd = doc.createElement('dd');
        dt.textContent = key;
        dd.textContent = String(value == null ? '' : value);
        list.appendChild(dt);
        list.appendChild(dd);
      }
      parent.appendChild(list);
    }

    function refreshRegion() {
      const root = doc.getElementById('dj-tools-region');
      if (!root) return;
      const selected = selectedRegion(), runtime = state.remote || monitorSnapshot(), r = runtime.region;
      const signature = JSON.stringify([selected, state.pin, runtime]);
      if (signature === state.signature) return;
      state.signature = signature;
      root.textContent = '';

      // 卡片 1: 选中场景区域与视野边界
      const cardRegion = doc.createElement('div');
      cardRegion.className = 'dj-card';
      cardRegion.innerHTML = `
        <div class="dj-card-header">
          <div class="dj-card-title">选中场景区域</div>
          <span class="dj-card-badge ${selected ? 'green' : 'gray'}">${selected ? '[已选中]' : '[未选中]'}</span>
        </div>
        <div class="dj-card-desc">实时获取场景树与地图中选中的 Region 实体，计算绝对坐标与摄像机视野</div>
        <div class="dj-card-body" id="dj-card-body-region"></div>
      `;
      root.appendChild(cardRegion);

      const bodyRegion = cardRegion.querySelector('#dj-card-body-region');
      if (selected) {
        details(bodyRegion, [
          ['名称', selected.name],
          ['场景', selected.path.split('/').pop()],
          ['状态', selected.enabled ? '已启用' : '未启用'],
          ['中心坐标', `${selected.x}, ${selected.y}`],
          ['尺寸', `${selected.width} × ${selected.height}`],
          ['事件/脚本', `${selected.events.length} 个事件 / ${selected.scripts.length} 个脚本`]
        ]);

        // 摄像机边界范围卡片
        const boundsCard = doc.createElement('div');
        boundsCard.className = 'dj-tools-bounds-card';
        boundsCard.innerHTML = `
          <div class="dj-tools-bounds-title">摄像机视野边界 (clampCamera 绝对数值)</div>
          <div class="dj-tools-bounds-grid">
            <div class="dj-bounds-item"><span class="dj-bounds-k">Left:</span> <span class="dj-bounds-v">${selected.left}</span></div>
            <div class="dj-bounds-item"><span class="dj-bounds-k">Top:</span> <span class="dj-bounds-v">${selected.top}</span></div>
            <div class="dj-bounds-item"><span class="dj-bounds-k">Right:</span> <span class="dj-bounds-v">${selected.right}</span></div>
            <div class="dj-bounds-item"><span class="dj-bounds-k">Bottom:</span> <span class="dj-bounds-v">${selected.bottom}</span></div>
          </div>
        `;
        bodyRegion.appendChild(boundsCard);

        const cameraActions = doc.createElement('div');
        cameraActions.className = 'dj-tools-actions';
        bodyRegion.appendChild(cameraActions);

        addButton(cameraActions, '设为摄像机边界', () => insertClampCameraCommand(selected), '向当前事件插入 clampCamera 并自动填入边界数值', true);
        addButton(cameraActions, '解除摄像机边界', insertUnclampCameraCommand, '向当前事件插入 unclampCamera 指令');
        addButton(cameraActions, '复制边界数值', () => {
          win.navigator.clipboard.writeText(`Left: ${selected.left}, Top: ${selected.top}, Right: ${selected.right}, Bottom: ${selected.bottom}`);
          status(`已复制边界：Left: ${selected.left}, Top: ${selected.top}, Right: ${selected.right}, Bottom: ${selected.bottom}`);
        }, '复制 Left/Top/Right/Bottom 数值到剪贴板');
        addButton(cameraActions, '固定监视', pinSelected, '在下方试玩监视器中监视该区域');
        addButton(cameraActions, '复制区域 ID', () => {
          win.navigator.clipboard.writeText(selected.presetId);
          status('已复制区域预设 ID: ' + selected.presetId);
        });
        addButton(cameraActions, '打开区域事件', () => {
          const el = doc.getElementById('sceneRegion-events');
          if (!el) throw new Error('请先打开区域检视器');
          el.focus();
          el.scrollIntoView({ block: 'nearest' });
        });
      } else {
        details(bodyRegion, [['当前状态', '请在场景树或地图中点击选中一个区域']]);
      }

      // 卡片 2: 扩展事件指令
      const cardCommands = doc.createElement('div');
      cardCommands.className = 'dj-card';
      cardCommands.innerHTML = `
        <div class="dj-card-header">
          <div class="dj-card-title">扩展事件指令</div>
          <span class="dj-card-badge gray">[预设 GUID: d4a9f612bc3e7805]</span>
        </div>
        <div class="dj-card-desc">向当前打开的事件指令列表中一键插入区域增强指令（自动填入区域 ID）</div>
        <div class="dj-card-body" id="dj-card-body-commands"></div>
      `;
      root.appendChild(cardCommands);

      const bodyCommands = cardCommands.querySelector('#dj-card-body-commands');
      const commands = doc.createElement('div');
      commands.className = 'dj-tools-actions';
      bodyCommands.appendChild(commands);

      const ops = [
        ['info', '获取区域信息'],
        ['actors', '获取区内角色'],
        ['count', '获取角色数量'],
        ['contains', '判断角色在区内'],
        ['setPosition', '设置区域位置'],
        ['setSize', '设置区域尺寸'],
        ['setEnabled', '切换启用状态'],
        ['follow', '绑定角色跟随'],
        ['unfollow', '解除角色跟随'],
        ['clampCamera', '指令锁定镜头']
      ];
      for (const [operation, label] of ops) {
        addButton(commands, label, () => insertRegionCommand(operation, selected));
      }

      // 卡片 3: 试玩实时运行监视
      const cardWatch = doc.createElement('div');
      cardWatch.className = 'dj-card';
      cardWatch.innerHTML = `
        <div class="dj-card-header">
          <div class="dj-card-title">试玩实时监视</div>
          <span class="dj-card-badge ${state.pin ? 'green' : 'gray'}">${state.pin ? '[正在监视]' : '[未监视]'}</span>
        </div>
        <div class="dj-card-desc">在试玩进行时实时捕获角色与玩家进出区域事件并记录流水黑匣子</div>
        <div class="dj-card-body" id="dj-card-body-watch"></div>
      `;
      root.appendChild(cardWatch);

      const bodyWatch = cardWatch.querySelector('#dj-card-body-watch');
      details(bodyWatch, [
        ['监视区域', state.pin && state.pin.name || '未设置'],
        ['运行状态', runtime.text],
        ['区内角色数', r ? r.actors.length + ' 个' : '--'],
        ['玩家在区内', r ? (r.playerInside ? '是' : '否') : '--'],
        ['角色名单', r ? r.actors.join('、') || '空区域' : '--']
      ]);

      const watchActions = doc.createElement('div');
      watchActions.className = 'dj-tools-actions';
      bodyWatch.appendChild(watchActions);

      addButton(watchActions, '取消监视', () => {
        state.pin = null;
        state.logs = [];
        saveConfig();
        refreshRegion();
        status('已取消监视');
      });
      addButton(watchActions, '安装/更新区域指令', installCommands);
      addButton(watchActions, '插入区域工具指令', () => insertCommand('d4a9f612bc3e7805'));

      const logHeading = doc.createElement('div');
      logHeading.className = 'dj-tools-log-title';
      logHeading.textContent = '实时进出流水日志';
      bodyWatch.appendChild(logHeading);

      const log = doc.createElement('div');
      log.className = 'dj-tools-log';
      log.textContent = runtime.logs.join('\n') || '暂无进入 / 离开记录（在试玩中进出监视区域将在此实时记录）';
      bodyWatch.appendChild(log);
    }

    function resolvePluginDir() {
      const path = require('path'), fs = require('fs');
      const bases = [];
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
          const base = chrome.runtime.getURL('');
          if (base) bases.push(base);
        }
      } catch (e) {}
      try {
        if (win.location.protocol === 'file:') {
          const href = String(win.location.href).split('?')[0].split('#')[0];
          const dir = href.slice(0, href.lastIndexOf('/') + 1);
          bases.push(dir + '../extension/yami-perf-extension/');
          bases.push(dir + 'extension/yami-perf-extension/');
          bases.push(dir + '../../extension/yami-perf-extension/');
        }
      } catch (e) {}
      const script = Array.from(doc.scripts).find(el => /\/editor-tools\.js(?:\?|$)/.test(el.src));
      if (script && script.src) bases.push(script.src);
      const candidates = [];
      for (const base of bases) {
        try {
          if (base.startsWith('chrome-extension://') || base.startsWith('file://')) {
            let dir = decodeURIComponent(new URL(base).pathname);
            if (/^\/[a-zA-Z]:/.test(dir)) dir = dir.slice(1);
            if (dir.endsWith('/editor-tools.js')) dir = path.dirname(dir);
            candidates.push(dir);
          }
        } catch (e) {}
      }
      candidates.push(process.cwd());
      candidates.push(path.join(process.cwd(), 'extension', 'yami-perf-extension'));
      candidates.push(path.join(path.dirname(process.execPath), 'extension', 'yami-perf-extension'));
      if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, '..', '..', 'extension', 'yami-perf-extension'));
      return candidates.find(dir => fs.existsSync(path.join(dir, 'runtime', 'region-commands', 'install.cjs'))) || '';
    }

    async function installCommands() {
      if (state.busy) return;
      const root = projectRoot();
      if (!root) throw new Error('请先打开游戏工程');
      const pluginDir = resolvePluginDir();
      if (!pluginDir) throw new Error('找不到区域指令安装包，请重新安装插件');
      const path = require('path');
      const installer = require(path.join(pluginDir, 'runtime', 'region-commands', 'install.cjs'));
      const plan = installer.preview(root);
      if (plan.installed) {
        status('区域指令已安装并处于最新状态');
        return;
      }
      const data = engine('Data');
      if (data && data.manifest && data.manifest.changes.some(meta => meta.path === 'Data/commands.json')) {
        throw new Error('指令列表有未保存修改，请先保存工程');
      }
      if (!win.confirm('安装区域工具箱指令到当前工程？\n' + root + '\n\n添加脚本并注册 Data/commands.json，原注册表会自动备份。')) return;
      state.busy = true;
      try {
        await installer.installChecked(root, plan.commandsSha256);
        const file = engine('File'), directory = engine('Directory');
        if (data && file && typeof file.get === 'function') data.commands = await file.get({ path: 'Data/commands.json', type: 'json' });
        if (directory && typeof directory.update === 'function') await directory.update();
        status('区域工具箱已安装并编译检查完成，请重新打开自定义指令窗口');
      } finally {
        state.busy = false;
      }
    }

    function pollAudioRadar() {
      if (state.pollingRadar || (win.__DANJUAN_AUDIO_RADAR__)) return;
      try {
        const fs = require('fs'), path = require('path'), os = require('os');
        const dir = process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite');
        let port = 5966;
        try {
          const value = Number(fs.readFileSync(path.join(dir, 'runtime-port'), 'utf8'));
          if (value > 0 && value < 65536) port = value;
        } catch (e) {}
        state.pollingRadar = true;
        const req = require('http').get('http://127.0.0.1:' + port + '/audio-radar', { timeout: 800 }, res => {
          let raw = '';
          res.on('data', data => { raw += data; if (raw.length > 200000) req.destroy(); });
          res.on('end', () => {
            state.pollingRadar = false;
            try {
              state.remoteRadar = JSON.parse(raw);
            } catch (e) { state.remoteRadar = null; }
          });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => { state.pollingRadar = false; state.remoteRadar = null; });
        req.on('close', () => { state.pollingRadar = false; });
      } catch (e) { state.pollingRadar = false; }
    }

    function getAudioRadarData() {
      if (typeof win !== 'undefined' && win.__DANJUAN_AUDIO_RADAR__) {
        try { return win.__DANJUAN_AUDIO_RADAR__.getSnapshot(); } catch (e) {}
      }
      if (typeof window !== 'undefined' && window.__DANJUAN_AUDIO_RADAR__) {
        try { return window.__DANJUAN_AUDIO_RADAR__.getSnapshot(); } catch (e) {}
      }
      if (typeof win !== 'undefined' && win.__YAMI_PERF_PROBE__ && typeof win.__YAMI_PERF_PROBE__.getAudioRadar === 'function') {
        try { return win.__YAMI_PERF_PROBE__.getAudioRadar(); } catch (e) {}
      }
      if (state.remoteRadar) return state.remoteRadar;
      return { ok: true, enabled: true, focusMode: 'player', entries: [], totalCount: 0 };
    }

    function generateHandoffMarkdown(entry) {
      const durSec = (entry.timing.durationMs / 1000).toFixed(2);
      const hitSec = (entry.timing.hitPointMs / 1000).toFixed(2);
      return [
        '### 音效制作对接卡: ' + entry.caster.name + ' · ' + entry.medium.name + ' [' + entry.kindLabel + ']',
        '- **出招主体**: ' + entry.caster.name + (entry.caster.isPlayer ? ' (玩家主角)' : ''),
        '- **媒介/技能**: ' + entry.medium.name + (entry.medium.id ? (' (ID: ' + entry.medium.id + ')') : ''),
        '- **受击主体**: ' + entry.target.name + (entry.target.id ? (' (ID: ' + entry.target.id + ')') : ''),
        '- **时间轴参数**: 起手 0ms -> 接触重音点 ~' + entry.timing.hitPointMs + 'ms -> 动作总时长 ~' + entry.timing.durationMs + 'ms',
        '- **建议音效时长**: ' + durSec + ' 秒 (重点: 重音接触点锁定在 ' + hitSec + ' 秒)',
        '- **建议文件命名**: `' + entry.suggestedName + '`',
        '- **工程挂载槽位**: `' + (entry.medium.assetPath || entry.medium.name) + '` -> `' + entry.slot + '` 事件',
        '- **当前接入状态**: ' + entry.audioStatus.label
      ].join('\n');
    }

    function getAggregatedActionCards(entries) {
      const map = new Map();
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry) continue;
        const key = (entry.kind || 'unknown') + '::' + ((entry.medium && (entry.medium.id || entry.medium.name)) || '') + '::' + ((entry.caster && entry.caster.name) || '');
        if (!map.has(key)) {
          const targetsMap = new Map();
          if (entry.target && entry.target.name) targetsMap.set(entry.target.name, 1);
          map.set(key, {
            key: key,
            kind: entry.kind,
            kindLabel: entry.kindLabel,
            slot: entry.slot,
            caster: Object.assign({}, entry.caster),
            medium: Object.assign({}, entry.medium),
            target: Object.assign({}, entry.target),
            timing: Object.assign({}, entry.timing),
            audioStatus: Object.assign({}, entry.audioStatus),
            suggestedName: entry.suggestedName,
            keyframes: (entry.keyframes && entry.keyframes.length > 0) ? entry.keyframes.slice() : [],
            samplesCount: 1,
            targetsMap: targetsMap,
            lastTimeStr: entry.timeStr,
            lastTimestamp: entry.timestamp,
            sampleEntry: entry,
            entries: [entry]
          });
        } else {
          const card = map.get(key);
          card.samplesCount++;
          card.entries.push(entry);
          if (entry.target && entry.target.name) {
            const count = card.targetsMap.get(entry.target.name) || 0;
            card.targetsMap.set(entry.target.name, count + 1);
          }
          if (entry.keyframes && entry.keyframes.length > 0) {
            card.keyframes = entry.keyframes.slice();
          }
          card.lastTimeStr = entry.timeStr;
          card.lastTimestamp = entry.timestamp;
          if (!card.audioStatus.configured && entry.audioStatus.configured) {
            card.audioStatus = Object.assign({}, entry.audioStatus);
          }
        }
      }
      return Array.from(map.values());
    }

    function matchesSearch(item, query) {
      if (!query) return true;
      const q = query.toLowerCase().trim();
      const casterName = (item.caster && item.caster.name || '').toLowerCase();
      const mediumName = (item.medium && (item.medium.name + ' ' + (item.medium.id || '')) || '').toLowerCase();
      const targetName = (item.target && item.target.name || '').toLowerCase();
      const kindLabel = (item.kindLabel || '').toLowerCase();
      const suggested = (item.suggestedName || '').toLowerCase();
      const audioLabel = (item.audioStatus && item.audioStatus.label || '').toLowerCase();
      return casterName.includes(q) || mediumName.includes(q) || targetName.includes(q) || kindLabel.includes(q) || suggested.includes(q) || audioLabel.includes(q);
    }

    // 自动化操作 1: 在编辑器中打开并定位对应事件资产
    function openAssetInEditor(assetPath) {
      const p = assetPath || '';
      try {
        if (win.Editor && typeof win.Editor.open === 'function' && p) {
          win.Editor.open(p);
          status('已在编辑器中打开资产: ' + p);
          return true;
        }
        if (win.File && typeof win.File.open === 'function' && p) {
          win.File.open(p);
          status('已在编辑器中打开资产: ' + p);
          return true;
        }
      } catch (e) {}
      if (p) {
        win.navigator.clipboard.writeText(p);
        status('已复制工程资产路径: ' + p + ' (请在编辑器中打开)');
      }
      return false;
    }

    // 自动化操作 2: 自动向对应事件/指令列表插入 playAudio 指令
    async function insertPlayAudioCommand(card) {
      const suggestedAudio = card.suggestedName || 'se_hit.ogg';
      const audioRelPath = 'Audio/SE/' + suggestedAudio;

      // 方式 A: 若当前在编辑器中打开了事件指令列表
      const list = currentList();
      if (list && typeof list.insert === 'function') {
        try {
          list.focus();
          list.insert('playAudio');
          for (let i = 0; i < 6; i++) {
            await new Promise(resolve => win.setTimeout(resolve, 50));
            const audioInput = doc.getElementById('playAudio-audio') || doc.querySelector('input[name="audio"]');
            if (audioInput && typeof audioInput.write === 'function') {
              audioInput.write({ type: 'string', value: audioRelPath });
              break;
            }
          }
          card.audioStatus = { configured: true, label: '[已配音效] 播放音效: ' + audioRelPath, audioId: audioRelPath };
          status('已成功在当前事件中插入 playAudio 指令 (' + audioRelPath + ')');
          refreshAudioRadar();
          return true;
        } catch (e) {}
      }

      // 方式 B: 若在 Node/Electron 环境，尝试安全写入对应资产文件
      try {
        if (typeof require === 'function') {
          const fs = require('fs');
          const path = require('path');
          const root = projectRoot();
          if (root && card.medium && card.medium.assetPath) {
            const filePath = path.join(root, card.medium.assetPath);
            if (fs.existsSync(filePath)) {
              const raw = fs.readFileSync(filePath, 'utf8');
              const json = JSON.parse(raw);
              let targetCommands = null;
              if (Array.isArray(json.commands)) {
                targetCommands = json.commands;
              } else if (Array.isArray(json.events)) {
                const slotType = card.slot || (card.medium && card.medium.type === 'trigger' ? 'hitactor' : 'skillcast');
                let targetEvent = json.events.find(e => e && e.type === slotType);
                if (!targetEvent && json.events.length > 0) targetEvent = json.events[0];
                if (!targetEvent) {
                  targetEvent = { type: slotType, enabled: true, commands: [] };
                  json.events.push(targetEvent);
                }
                if (!Array.isArray(targetEvent.commands)) targetEvent.commands = [];
                targetCommands = targetEvent.commands;
              }

              if (targetCommands) {
                targetCommands.push({
                  id: 'playAudio',
                  params: { type: 'se', audio: audioRelPath, volume: 1 }
                });
                fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
                card.audioStatus = { configured: true, label: '[已配音效] ' + audioRelPath, audioId: audioRelPath };
                status('已自动向 ' + card.medium.assetPath + ' 追加写入 playAudio 指令！');
                refreshAudioRadar();
                return true;
              }
            }
          }
        }
      } catch (e) {}

      // 方式 C: 复制指令 JSON 兜底
      const cmdCode = JSON.stringify({
        id: 'playAudio',
        params: { type: 'se', audio: audioRelPath, volume: 1 }
      }, null, 2);
      win.navigator.clipboard.writeText(cmdCode);
      status('已复制 playAudio 指令 JSON 到剪贴板，可在事件中直接粘贴！');
      return false;
    }

    function refreshAudioRadar() {
      const root = doc.getElementById('dj-tools-audio-radar');
      if (!root) return;
      const data = getAudioRadarData();
      const rawEntries = data.entries || [];
      const filter = state.radarFilter || 'all';
      const search = (state.radarSearchQuery || '').trim();

      // 聚合独立卡片
      const allAggregatedCards = getAggregatedActionCards(rawEntries);

      // 动作驱动自动对焦: 试玩触发新动作时自动聚焦该动作的专属任务卡
      if (state.autoFocus && data.totalCount && data.totalCount > (state.lastTotalCount || 0)) {
        state.lastTotalCount = data.totalCount;
        if (allAggregatedCards.length > 0) {
          const latest = allAggregatedCards[0];
          if (state.selectedCardKey !== latest.key) {
            state.selectedCardKey = latest.key;
            status('动作驱动自动对焦: ' + latest.caster.name + ' · ' + latest.medium.name);
          }
        }
      } else if (data.totalCount) {
        state.lastTotalCount = data.totalCount;
      }

      // 计算统计数字
      const missingRawCount = rawEntries.filter(e => !e.audioStatus.configured).length;
      const missingCardsCount = allAggregatedCards.filter(c => !c.audioStatus.configured).length;

      // 同步更新大厅入口徽章数字
      const portalBadge = doc.getElementById('dj-portal-radar-badge');
      if (portalBadge) {
        portalBadge.textContent = '[待接入 ' + missingCardsCount + ']';
        portalBadge.className = 'dj-tools-portal-badge ' + (missingCardsCount > 0 ? 'amber' : 'green');
      }

      // 确保 Toolbar 容器存在且不重复重建（防 input 失焦清空）
      let toolbar = root.querySelector('.dj-radar-toolbar-card');
      if (!toolbar) {
        toolbar = doc.createElement('div');
        toolbar.className = 'dj-card dj-radar-toolbar-card';
        toolbar.innerHTML = `
          <div class="dj-card-header">
            <div class="dj-card-title">音效触发雷达</div>
            <div class="dj-radar-status-badge ${data.enabled ? 'active' : 'paused'}">
              <span class="dj-radar-dot"></span>
              <span id="dj-radar-status-lbl">${data.enabled ? '[正在监听]' : '[已暂停]'}</span>
            </div>
          </div>
          <div class="dj-card-desc">试玩出招即时嗅探因果主体、重音时间轴并生成自动化接入任务卡</div>

          <!-- 动作驱动自动对焦开关栏 -->
          <div class="dj-radar-autofocus-bar">
            <span>[动作驱动] 试玩中按键出招或命中目标，自动聚焦对应专属任务卡</span>
            <div class="dj-radar-autofocus-switch" id="btn-toggle-autofocus" role="button">
              ${state.autoFocus ? '[自动对焦: 开启]' : '[自动对焦: 关闭]'}
            </div>
          </div>

          <!-- 搜索与模式控制栏 -->
          <div class="dj-radar-search-row">
            <div class="dj-radar-search-box">
              <svg class="dj-radar-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M18.031 16.617l4.283 4.282-1.415 1.415-4.282-4.283A8.96 8.96 0 0 1 11 20c-4.968 0-9-4.032-9-9s4.032-9 9-9 9 4.032 9 9a8.96 8.96 0 0 1-1.969 5.617zm-2.006-.742A6.977 6.977 0 0 0 18 11c0-3.868-3.133-7-7-7-3.868 0-7 3.132-7 7 0 3.867 3.132 7 7 7a6.977 6.977 0 0 0 4.875-1.975l.15-.15z"/>
              </svg>
              <input type="text" class="dj-radar-search-input" id="dj-radar-search-input" placeholder="搜索技能名、角色名、受击目标或音效..." value="${state.radarSearchQuery}" />
              <div class="dj-radar-search-clear" id="dj-radar-search-clear" role="button" title="清空搜索" style="display:${state.radarSearchQuery ? 'block' : 'none'};">x</div>
            </div>
            <div class="dj-radar-mode-switcher">
              <div class="dj-radar-mode-btn ${state.radarViewMode === 'cards' ? 'active' : ''}" data-mode="cards" role="button" title="聚合成独立动作卡片视图">独立卡片</div>
              <div class="dj-radar-mode-btn ${state.radarViewMode === 'stream' ? 'active' : ''}" data-mode="stream" role="button" title="原始事件时间线流水视图">时间线</div>
            </div>
          </div>

          <!-- 焦点与统计 -->
          <div class="dj-radar-controls">
            <div class="dj-radar-focus-selector">
              <span class="dj-radar-focus-lbl">焦点范围:</span>
              <div class="dj-tool-button ${data.focusMode === 'player' ? 'primary' : ''}" id="btn-focus-player" role="button">玩家主角</div>
              <div class="dj-tool-button ${data.focusMode === 'all' ? 'primary' : ''}" id="btn-focus-all" role="button">全场实体</div>
            </div>
            <div class="dj-radar-stats">
              <span class="dj-card-badge gray" id="dj-radar-stat-total">[动作 ${allAggregatedCards.length} / 流水 ${rawEntries.length}]</span>
              <span class="dj-card-badge ${missingCardsCount > 0 ? 'amber' : 'green'}" id="dj-radar-stat-missing">[待接入 ${missingCardsCount}]</span>
            </div>
          </div>

          <!-- 快速过滤 Chips -->
          <div class="dj-radar-filters">
            <span class="dj-radar-filter-lbl">过滤:</span>
            <div class="dj-radar-chip ${filter === 'all' ? 'active' : ''}" data-filter="all" role="button">全部</div>
            <div class="dj-radar-chip ${filter === 'missing' ? 'active' : ''}" data-filter="missing" role="button">仅未接入</div>
            <div class="dj-radar-chip ${filter === 'configured' ? 'active' : ''}" data-filter="configured" role="button">已配音效</div>
            <div class="dj-radar-chip ${filter === 'player' ? 'active' : ''}" data-filter="player" role="button">主角相关</div>
            <div class="dj-radar-chip ${filter === 'skill' ? 'active' : ''}" data-filter="skill" role="button">技能施放</div>
            <div class="dj-radar-chip ${filter === 'hit' ? 'active' : ''}" data-filter="hit" role="button">触发命中</div>
            <div class="dj-radar-chip clear" id="btn-radar-clear" role="button" title="清空全部雷达流水与卡片">清空流水</div>
          </div>
        `;
        root.appendChild(toolbar);

        // 绑定自动对焦开关
        const btnToggleFocus = toolbar.querySelector('#btn-toggle-autofocus');
        if (btnToggleFocus) {
          btnToggleFocus.addEventListener('click', () => {
            state.autoFocus = !state.autoFocus;
            btnToggleFocus.textContent = state.autoFocus ? '[自动对焦: 开启]' : '[自动对焦: 关闭]';
            status('动作驱动自动对焦已' + (state.autoFocus ? '开启' : '关闭'));
          });
        }

        // 绑定搜索输入事件
        const searchInput = toolbar.querySelector('#dj-radar-search-input');
        const searchClear = toolbar.querySelector('#dj-radar-search-clear');
        if (searchInput) {
          searchInput.addEventListener('input', e => {
            state.radarSearchQuery = e.target.value;
            if (searchClear) searchClear.style.display = state.radarSearchQuery ? 'block' : 'none';
            renderRadarContent();
          });
        }
        if (searchClear) {
          searchClear.addEventListener('click', () => {
            state.radarSearchQuery = '';
            if (searchInput) { searchInput.value = ''; searchInput.focus(); }
            searchClear.style.display = 'none';
            renderRadarContent();
          });
        }

        // 绑定模式切换
        toolbar.querySelectorAll('.dj-radar-mode-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-mode');
            if (state.radarViewMode === mode) return;
            state.radarViewMode = mode;
            state.selectedCardKey = null;
            toolbar.querySelectorAll('.dj-radar-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
            renderRadarContent();
          });
        });

        // 绑定焦点与清空
        const btnPlayer = toolbar.querySelector('#btn-focus-player');
        if (btnPlayer) btnPlayer.addEventListener('click', () => {
          if (win.__DANJUAN_AUDIO_RADAR__) win.__DANJUAN_AUDIO_RADAR__.setFocus('player');
          refreshAudioRadar();
          status('雷达焦点已设为：玩家主角（仅追踪主角出招与受击）');
        });
        const btnAll = toolbar.querySelector('#btn-focus-all');
        if (btnAll) btnAll.addEventListener('click', () => {
          if (win.__DANJUAN_AUDIO_RADAR__) win.__DANJUAN_AUDIO_RADAR__.setFocus('all');
          refreshAudioRadar();
          status('雷达焦点已设为：全场实体（追踪场景全部怪物与技能）');
        });
        const btnClear = toolbar.querySelector('#btn-radar-clear');
        if (btnClear) btnClear.addEventListener('click', () => {
          if (win.__DANJUAN_AUDIO_RADAR__) win.__DANJUAN_AUDIO_RADAR__.clear();
          state.remoteRadar = null;
          state.selectedCardKey = null;
          refreshAudioRadar();
          status('已清空音效雷达全部动作卡片与流水');
        });

        // 绑定过滤 chips
        toolbar.querySelectorAll('.dj-radar-chip[data-filter]').forEach(chip => {
          chip.addEventListener('click', () => {
            state.radarFilter = chip.getAttribute('data-filter');
            toolbar.querySelectorAll('.dj-radar-chip[data-filter]').forEach(c => c.classList.toggle('active', c === chip));
            renderRadarContent();
          });
        });
      } else {
        // Toolbar 容器已存在，仅更新状态徽章和激活样式
        const statusBadge = toolbar.querySelector('.dj-radar-status-badge');
        const statusLbl = toolbar.querySelector('#dj-radar-status-lbl');
        if (statusBadge) {
          statusBadge.className = 'dj-radar-status-badge ' + (data.enabled ? 'active' : 'paused');
          if (statusLbl) statusLbl.textContent = data.enabled ? '[正在监听]' : '[已暂停]';
        }
        const statTotal = toolbar.querySelector('#dj-radar-stat-total');
        if (statTotal) statTotal.textContent = '[动作 ' + allAggregatedCards.length + ' / 流水 ' + rawEntries.length + ']';
        const statMissing = toolbar.querySelector('#dj-radar-stat-missing');
        if (statMissing) {
          statMissing.className = 'dj-card-badge ' + (missingCardsCount > 0 ? 'amber' : 'green');
          statMissing.textContent = '[待接入 ' + missingCardsCount + ']';
        }
        const btnPlayer = toolbar.querySelector('#btn-focus-player');
        if (btnPlayer) btnPlayer.className = 'dj-tool-button ' + (data.focusMode === 'player' ? 'primary' : '');
        const btnAll = toolbar.querySelector('#btn-focus-all');
        if (btnAll) btnAll.className = 'dj-tool-button ' + (data.focusMode === 'all' ? 'primary' : '');
        toolbar.querySelectorAll('.dj-radar-chip[data-filter]').forEach(chip => {
          chip.classList.toggle('active', chip.getAttribute('data-filter') === filter);
        });
        toolbar.querySelectorAll('.dj-radar-mode-btn').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-mode') === state.radarViewMode);
        });
      }

      // 确保内容容器存在
      let contentContainer = root.querySelector('#dj-radar-content');
      if (!contentContainer) {
        contentContainer = doc.createElement('div');
        contentContainer.id = 'dj-radar-content';
        contentContainer.className = 'dj-radar-content';
        root.appendChild(contentContainer);
      }

      // 核心渲染逻辑
      function renderRadarContent() {
        if (!contentContainer) return;
        contentContainer.textContent = '';

        // 分支 1: 单独卡片全景检视模式
        if (state.selectedCardKey) {
          const currentCard = allAggregatedCards.find(c => c.key === state.selectedCardKey);
          if (currentCard) {
            renderSingleCardView(contentContainer, currentCard);
            return;
          } else {
            state.selectedCardKey = null;
          }
        }

        // 分支 2: 独立动作卡片聚合视图 (默认)
        if (state.radarViewMode === 'cards') {
          const filteredCards = allAggregatedCards.filter(card => {
            if (filter === 'missing') return !card.audioStatus.configured;
            if (filter === 'configured') return !!card.audioStatus.configured;
            if (filter === 'player') return card.caster.isPlayer || card.target.isPlayer;
            if (filter === 'skill') return card.kind === 'skillcast';
            if (filter === 'hit') return card.kind === 'hitactor';
            return true;
          }).filter(card => matchesSearch(card, search));

          if (filteredCards.length === 0) {
            renderEmptyState(contentContainer, allAggregatedCards.length > 0);
            return;
          }

          const list = doc.createElement('div');
          list.className = 'dj-radar-list';
          contentContainer.appendChild(list);

          for (let i = 0; i < filteredCards.length; i++) {
            const card = filteredCards[i];
            const cardEl = doc.createElement('div');
            cardEl.className = 'dj-card dj-radar-card aggregate ' + (card.audioStatus.configured ? 'configured' : 'missing');

            let keyframesHtml = '';
            if (card.keyframes && card.keyframes.length > 0) {
              keyframesHtml = `
                <div class="dj-radar-visual-strip">
                  <div class="dj-radar-visual-title">动作关键帧连拍采样</div>
                  <div class="dj-radar-frames">
                    ${card.keyframes.map(f => `
                      <div class="dj-radar-frame-box">
                        <img class="dj-radar-thumb" src="${f.data}" alt="${f.label}" />
                        <span class="dj-radar-frame-lbl">${f.label} (${f.time}ms)</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }

            const targetsSampleStr = Array.from(card.targetsMap.keys()).slice(0, 3).join(', ') + (card.targetsMap.size > 3 ? (' 等' + card.targetsMap.size + '个') : '');

            cardEl.innerHTML = `
              <div class="dj-card-header">
                <div class="dj-radar-header-left">
                  <span class="dj-radar-tag kind-${card.kind}">[${card.kindLabel}]</span>
                  <span class="dj-radar-tag ${card.audioStatus.configured ? 'green' : 'amber'}">[${card.audioStatus.label}]</span>
                </div>
                <div class="dj-radar-aggregate-badge">[触发 ${card.samplesCount} 次]</div>
              </div>

              <div class="dj-radar-roles-grid">
                <div class="dj-radar-role-col">
                  <div class="dj-radar-role-k">出招主体</div>
                  <div class="dj-radar-role-v" title="${card.caster.name}">
                    ${card.caster.name} ${card.caster.isPlayer ? '<span class="dj-radar-sub-tag">[主角]</span>' : ''}
                  </div>
                </div>
                <div class="dj-radar-role-col">
                  <div class="dj-radar-role-k">媒介/技能</div>
                  <div class="dj-radar-role-v" title="${card.medium.name}">
                    ${card.medium.name}
                  </div>
                </div>
                <div class="dj-radar-role-col">
                  <div class="dj-radar-role-k">受击采样</div>
                  <div class="dj-radar-role-v" title="${targetsSampleStr}">
                    ${targetsSampleStr || '无'}
                  </div>
                </div>
              </div>

              <div class="dj-radar-aggregate-meta">
                <span>接触重音: <strong style="color:#f472b6;">~${card.timing.hitPointMs}ms</strong> / 时长: <strong>~${card.timing.durationMs}ms</strong></span>
                <span class="dj-radar-target-samples">最新: ${card.lastTimeStr}</span>
              </div>

              ${keyframesHtml}

              <!-- 自动化与操作工具栏 -->
              <div class="dj-tools-actions">
                <div class="dj-tool-button inspect-btn" id="btn-inspect-card" role="button" title="进入该动作的独立大卡片全景检视面板">查看单独卡片</div>
                <div class="dj-tool-button locate-btn" id="btn-locate-event" role="button" title="在编辑器中定位并打开对应事件文件">定位事件</div>
                <div class="dj-tool-button insert-btn" id="btn-insert-playaudio" role="button" title="向该事件自动插入 playAudio 音效播放指令">自动插入音效</div>
                <div class="dj-tool-button primary" id="btn-copy-handoff" role="button" title="生成标准 Markdown 对接卡给音效制作人员">复制对接卡</div>
              </div>
            `;
            list.appendChild(cardEl);

            const btnInspect = cardEl.querySelector('#btn-inspect-card');
            if (btnInspect) {
              btnInspect.addEventListener('click', (e) => {
                e.stopPropagation();
                state.selectedCardKey = card.key;
                renderRadarContent();
              });
            }
            const btnLocate = cardEl.querySelector('#btn-locate-event');
            if (btnLocate) {
              btnLocate.addEventListener('click', (e) => {
                e.stopPropagation();
                openAssetInEditor(card.medium.assetPath || card.medium.name);
              });
            }
            const btnInsert = cardEl.querySelector('#btn-insert-playaudio');
            if (btnInsert) {
              btnInsert.addEventListener('click', (e) => {
                e.stopPropagation();
                insertPlayAudioCommand(card);
              });
            }
            const btnHandoff = cardEl.querySelector('#btn-copy-handoff');
            if (btnHandoff) {
              btnHandoff.addEventListener('click', (e) => {
                e.stopPropagation();
                const text = generateHandoffMarkdown(card.sampleEntry);
                win.navigator.clipboard.writeText(text);
                status('已复制音效对接卡（' + card.caster.name + ' · ' + card.medium.name + '）');
              });
            }
          }
          return;
        }

        // 分支 3: 原始时间线流水视图
        const filteredRaw = rawEntries.filter(e => {
          if (filter === 'missing') return !e.audioStatus.configured;
          if (filter === 'configured') return !!e.audioStatus.configured;
          if (filter === 'player') return e.caster.isPlayer || e.target.isPlayer;
          if (filter === 'skill') return e.kind === 'skillcast';
          if (filter === 'hit') return e.kind === 'hitactor';
          return true;
        }).filter(e => matchesSearch(e, search));

        if (filteredRaw.length === 0) {
          renderEmptyState(contentContainer, rawEntries.length > 0);
          return;
        }

        const rawList = doc.createElement('div');
        rawList.className = 'dj-radar-list';
        contentContainer.appendChild(rawList);

        for (let i = 0; i < filteredRaw.length; i++) {
          const entry = filteredRaw[i];
          const itemEl = doc.createElement('div');
          itemEl.className = 'dj-card dj-radar-card ' + (entry.audioStatus.configured ? 'configured' : 'missing');

          let keyframesHtml = '';
          if (entry.keyframes && entry.keyframes.length > 0) {
            keyframesHtml = `
              <div class="dj-radar-visual-strip">
                <div class="dj-radar-visual-title">画面关键帧采样</div>
                <div class="dj-radar-frames">
                  ${entry.keyframes.map(f => `
                    <div class="dj-radar-frame-box">
                      <img class="dj-radar-thumb" src="${f.data}" alt="${f.label}" />
                      <span class="dj-radar-frame-lbl">${f.label} (${f.time}ms)</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          itemEl.innerHTML = `
            <div class="dj-card-header">
              <div class="dj-radar-header-left">
                <span class="dj-radar-tag kind-${entry.kind}">[${entry.kindLabel}]</span>
                <span class="dj-radar-tag ${entry.audioStatus.configured ? 'green' : 'amber'}">[${entry.audioStatus.label}]</span>
              </div>
              <span class="dj-radar-time">${entry.timeStr}</span>
            </div>
            <div class="dj-radar-roles-grid">
              <div class="dj-radar-role-col">
                <div class="dj-radar-role-k">出招主体</div>
                <div class="dj-radar-role-v" title="${entry.caster.name}">${entry.caster.name}</div>
              </div>
              <div class="dj-radar-role-col">
                <div class="dj-radar-role-k">媒介/技能</div>
                <div class="dj-radar-role-v" title="${entry.medium.name}">${entry.medium.name}</div>
              </div>
              <div class="dj-radar-role-col">
                <div class="dj-radar-role-k">受击主体</div>
                <div class="dj-radar-role-v" title="${entry.target.name}">${entry.target.name}</div>
              </div>
            </div>
            <div class="dj-radar-timing-bar">
              <span>接触重音: <strong>~${entry.timing.hitPointMs}ms</strong></span>
              <span>时长: <strong>~${entry.timing.durationMs}ms</strong></span>
              <span>命名: <code>${entry.suggestedName}</code></span>
            </div>
            ${keyframesHtml}
            <div class="dj-tools-actions">
              <div class="dj-tool-button locate-btn" id="btn-locate-raw" role="button">定位事件</div>
              <div class="dj-tool-button primary" id="btn-copy-handoff" role="button">复制对接卡</div>
              <div class="dj-tool-button" id="btn-copy-path" role="button">复制资产路径</div>
            </div>
          `;
          rawList.appendChild(itemEl);

          const btnLocate = itemEl.querySelector('#btn-locate-raw');
          if (btnLocate) btnLocate.addEventListener('click', () => {
            openAssetInEditor(entry.medium.assetPath || entry.medium.name);
          });
          const btnHandoff = itemEl.querySelector('#btn-copy-handoff');
          if (btnHandoff) btnHandoff.addEventListener('click', () => {
            const text = generateHandoffMarkdown(entry);
            win.navigator.clipboard.writeText(text);
            status('已复制音效对接卡');
          });
          const btnPath = itemEl.querySelector('#btn-copy-path');
          if (btnPath) btnPath.addEventListener('click', () => {
            const p = entry.medium.assetPath || entry.medium.name;
            win.navigator.clipboard.writeText(p);
            status('已复制资产路径: ' + p);
          });
        }
      }

      function renderEmptyState(container, hasTotal) {
        const empty = doc.createElement('div');
        empty.className = 'dj-radar-empty';
        empty.innerHTML = `
          <div class="dj-radar-empty-icon">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
              <path d="M12 2c5.523 0 10 4.477 10 10a9.96 9.96 0 0 1-2.929 7.071l-1.414-1.414A7.965 7.965 0 0 0 20 12c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 2.21.896 4.21 2.343 5.657l-1.414 1.414A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2zm0 4a6 6 0 0 1 6 6c0 1.657-.672 3.156-1.757 4.243l-1.415-1.415A3.978 3.978 0 0 0 16 12a4 4 0 0 0-4-4c-1.105 0-2.105.448-2.828 1.172L7.757 7.757A5.978 5.978 0 0 1 12 6zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
            </svg>
          </div>
          <div class="dj-radar-empty-title">音效触发雷达监听中</div>
          <div class="dj-radar-empty-desc">${hasTotal ? '未匹配到符合搜索与筛选条件的动作记录' : '在试玩中施放技能或命中目标，雷达将实时捕获因果主体、触发事件与画面特征并自动对焦任务卡'}</div>
        `;
        container.appendChild(empty);
      }

      // 渲染【单独卡片全景检视面板】
      function renderSingleCardView(container, card) {
        const view = doc.createElement('div');
        view.className = 'dj-radar-single-view';

        const hitPct = Math.min(95, Math.max(5, Math.round((card.timing.hitPointMs / (card.timing.durationMs || 500)) * 100)));
        const targetListHtml = Array.from(card.targetsMap.entries()).map(([name, count]) => `
          <span class="dj-radar-target-chip">${name} (${count}次)</span>
        `).join('') || '<span style="color:#777;">暂无受击目标采样</span>';

        view.innerHTML = `
          <!-- 顶栏返回与标题 -->
          <div class="dj-radar-single-navbar">
            <div class="dj-radar-single-back-btn" id="btn-back-card-list" role="button">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M7.828 11H20v2H7.828l5.364 5.364-1.414 1.414L4 12l7.778-7.778 1.414 1.414z"/>
              </svg>
              <span>返回卡片列表</span>
            </div>
            <div class="dj-radar-single-title">
              <span>[单独卡片] ${card.caster.name} · ${card.medium.name}</span>
              <span class="dj-radar-tag ${card.audioStatus.configured ? 'green' : 'amber'}">[${card.audioStatus.label}]</span>
            </div>
          </div>

          <!-- 单独卡片主体内容 -->
          <div class="dj-radar-single-panel">
            <!-- 1. 自动化核心动作区 (直达痛点) -->
            <div class="dj-radar-single-section-title">自动化工程闭环操作</div>
            <div class="dj-tools-actions">
              <div class="dj-tool-button locate-btn" id="btn-single-locate" role="button" title="直接在编辑器中定位并打开此事件/技能文件">在编辑器中定位事件</div>
              <div class="dj-tool-button insert-btn" id="btn-single-insert" role="button" title="自动向工程事件插入建议的 playAudio 音效指令">自动插入 playAudio 指令</div>
              <div class="dj-tool-button primary" id="btn-single-handoff" role="button" title="一键复制给音效师的标准制作对接卡">复制音效师对接卡</div>
            </div>

            <!-- 2. 关键帧高清连拍对比画廊 -->
            <div class="dj-radar-single-section-title">画面关键帧连拍采样</div>
            ${card.keyframes && card.keyframes.length > 0 ? `
              <div class="dj-radar-gallery-grid">
                ${card.keyframes.map(f => `
                  <div class="dj-radar-gallery-card">
                    <img class="dj-radar-gallery-img" src="${f.data}" alt="${f.label}" />
                    <div class="dj-radar-gallery-meta">
                      <span class="dj-radar-gallery-phase">[${f.label}]</span>
                      <span class="dj-radar-gallery-ms">${f.time}ms</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div style="font-size:11px;color:#777;padding:12px;background:#181818;border-radius:4px;text-align:center;">
                正在等待画布关键帧特征连拍采样（请在试玩中再次施放以抓拍）
              </div>
            `}

            <!-- 3. 可视化毫秒时间轴刻度尺 -->
            <div class="dj-radar-single-section-title">毫秒时间轴与重音冲击点标尺</div>
            <div class="dj-radar-timeline-visualizer">
              <div class="dj-radar-ruler-track">
                <div class="dj-radar-ruler-fill" style="width:${hitPct}%;"></div>
                <div class="dj-radar-ruler-pin" style="left:${hitPct}%;">
                  <span class="dj-radar-ruler-pin-label">重音点 ~${card.timing.hitPointMs}ms</span>
                </div>
              </div>
              <div class="dj-radar-ruler-footer">
                <span>起手 0ms</span>
                <span>核心重音锁定 ~${card.timing.hitPointMs}ms</span>
                <span>动作收招 ~${card.timing.durationMs}ms</span>
              </div>
            </div>

            <!-- 4. 音效制作黄金参数指导框 -->
            <div class="dj-radar-guidance-card">
              <div class="dj-radar-guidance-row">
                <span class="dj-radar-guidance-k">建议音效总长</span>
                <span class="dj-radar-guidance-v">${(card.timing.durationMs / 1000).toFixed(2)} 秒</span>
              </div>
              <div class="dj-radar-guidance-row">
                <span class="dj-radar-guidance-k">核心重音接触点锁定</span>
                <span class="dj-radar-guidance-v" style="color:#f472b6;">${(card.timing.hitPointMs / 1000).toFixed(2)} 秒 (~${card.timing.hitPointMs}ms)</span>
              </div>
              <div class="dj-radar-guidance-row">
                <span class="dj-radar-guidance-k">标准工业文件命名</span>
                <span class="dj-radar-guidance-v">${card.suggestedName}</span>
              </div>
              <div class="dj-radar-guidance-row">
                <span class="dj-radar-guidance-k">工程挂载槽位</span>
                <span class="dj-radar-guidance-v">${card.medium.assetPath || card.medium.name} -> ${card.slot} 事件</span>
              </div>
            </div>

            <!-- 5. 因果三主体档案与受击样本 -->
            <div class="dj-radar-single-section-title">因果主体与受击样本档案</div>
            <div class="dj-radar-roles-grid">
              <div class="dj-radar-role-col">
                <div class="dj-radar-role-k">出招主体</div>
                <div class="dj-radar-role-v">${card.caster.name} ${card.caster.isPlayer ? '<span class="dj-radar-sub-tag">[主角]</span>' : ''}</div>
              </div>
              <div class="dj-radar-role-col">
                <div class="dj-radar-role-k">媒介/技能定义</div>
                <div class="dj-radar-role-v">${card.medium.name}</div>
              </div>
              <div class="dj-radar-role-col">
                <div class="dj-radar-role-k">累计触发样本</div>
                <div class="dj-radar-role-v" style="color:#67e8f9;">${card.samplesCount} 次触发</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <span style="font-size:10px;color:#888;">已捕获的受击对象样本：</span>
              <div class="dj-radar-target-chip-list">${targetListHtml}</div>
            </div>

            <!-- 6. 辅助复制工具栏 -->
            <div class="dj-tools-actions">
              <div class="dj-tool-button" id="btn-single-code" role="button">复制 callEvent 指令代码</div>
              <div class="dj-tool-button" id="btn-single-path" role="button">复制资产槽位路径</div>
              <div class="dj-tool-button" id="btn-single-guid" role="button">复制资产 GUID</div>
            </div>
          </div>
        `;
        container.appendChild(view);

        const btnBack = view.querySelector('#btn-back-card-list');
        if (btnBack) {
          btnBack.addEventListener('click', () => {
            state.selectedCardKey = null;
            renderRadarContent();
          });
        }
        const btnLocate = view.querySelector('#btn-single-locate');
        if (btnLocate) {
          btnLocate.addEventListener('click', () => {
            openAssetInEditor(card.medium.assetPath || card.medium.name);
          });
        }
        const btnInsert = view.querySelector('#btn-single-insert');
        if (btnInsert) {
          btnInsert.addEventListener('click', () => {
            insertPlayAudioCommand(card);
          });
        }
        const btnHandoff = view.querySelector('#btn-single-handoff');
        if (btnHandoff) {
          btnHandoff.addEventListener('click', () => {
            const text = generateHandoffMarkdown(card.sampleEntry);
            win.navigator.clipboard.writeText(text);
            status('已复制音效制作对接卡（' + card.caster.name + ' · ' + card.medium.name + '）');
          });
        }
        const btnCode = view.querySelector('#btn-single-code');
        if (btnCode) {
          btnCode.addEventListener('click', () => {
            const code = JSON.stringify({
              id: 'callEvent',
              params: {
                type: 'global',
                eventId: '72a36c94f48af009',
                comment: '播放打击音效'
              }
            }, null, 2);
            win.navigator.clipboard.writeText(code);
            status('已复制音效调用指令 JSON');
          });
        }
        const btnPath = view.querySelector('#btn-single-path');
        if (btnPath) {
          btnPath.addEventListener('click', () => {
            const p = card.medium.assetPath || card.medium.name;
            win.navigator.clipboard.writeText(p);
            status('已复制资产路径: ' + p);
          });
        }
        const btnGuid = view.querySelector('#btn-single-guid');
        if (btnGuid) {
          btnGuid.addEventListener('click', () => {
            const g = card.medium.id || '';
            win.navigator.clipboard.writeText(g);
            status('已复制 GUID: ' + g);
          });
        }
      }

      renderRadarContent();
    }
    function refresh() {
      hookRegions();
      pollRuntime();
      pollAudioRadar();
      if (state.activeTab === 'radar') {
        refreshAudioRadar();
      } else {
        refreshRegion();
      }
    }

    function open() {
      const hud = win.__DANJUAN_HUD_API__;
      if (hud && typeof hud.switchView === 'function') {
        hud.switchView('editor-tools');
        if (hud.ctx && hud.ctx.dockState === 'collapsed' && typeof hud.toggleDock === 'function') {
          hud.toggleDock();
        }
      }
      refresh();
    }

    function ensureEntry() {
      if (doc.getElementById('dj-tools-entry')) return;
      const modules = doc.querySelector('.yami-home-modules');
      if (!modules) return;

      const card = doc.createElement('div');
      card.id = 'dj-tools-entry';
      card.className = 'yami-home-module-item';
      card.setAttribute('data-target', 'editor-tools');
      card.setAttribute('role', 'button');
      card.innerHTML = `
        <div class="yami-home-module-main">
          <div class="yami-home-module-icon-box pink" title="RemixIcon: ri-focus-3-line">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"></path>
            </svg>
          </div>
          <div>
            <div class="yami-home-module-title">痛点解决</div>
            <div class="yami-home-module-desc">区域工作台与音效雷达</div>
          </div>
        </div>
        <div class="yami-home-module-badge pink">进入</div>
      `;
      card.addEventListener('click', e => {
        e.stopPropagation();
        open();
      });

      const aiCard = Array.from(modules.children).find(child => {
        const title = child.querySelector && child.querySelector('.yami-home-module-title');
        return title && /AI\s*助手/i.test(title.textContent || '') || child.id === 'yami-home-card-ai';
      });

      if (aiCard) {
        modules.insertBefore(card, aiCard);
      } else {
        const cheat = doc.getElementById('yami-home-card-cheat');
        if (cheat && cheat.parentElement === modules) {
          modules.insertBefore(card, cheat);
        } else {
          modules.appendChild(card);
        }
      }
    }

    function ensurePage() {
      if (doc.getElementById('page-editor-tools')) return;
      const body = doc.querySelector('#yami-perf-dock .yami-perf-dock-body');
      if (!body) return;
      const page = doc.createElement('div');
      page.id = 'page-editor-tools';
      page.className = 'yami-suite-page dj-tools';
      page.style.setProperty('display', 'none', 'important');
      page.innerHTML = `
        <!-- 痛点解决功能入口卡片大厅 (平级分离，后续新增功能平铺增加) -->
        <div class="dj-tools-portal-grid" role="tablist">
          <div class="dj-tools-portal-card dj-tools-tab-item active" data-tab="region" role="button" tabindex="0">
            <div class="dj-tools-portal-header">
              <span class="dj-tools-portal-title">区域工作台</span>
              <span class="dj-tools-portal-badge green">[已就绪]</span>
            </div>
            <div class="dj-tools-portal-desc">摄像机边界限制、动态跟随与进出事件联动</div>
          </div>
          <div class="dj-tools-portal-card dj-tools-tab-item" data-tab="radar" role="button" tabindex="0">
            <div class="dj-tools-portal-header">
              <span class="dj-tools-portal-title">音效触发雷达</span>
              <span class="dj-tools-portal-badge amber" id="dj-portal-radar-badge">[待接入 0]</span>
            </div>
            <div class="dj-tools-portal-desc">动作因果嗅探、时间轴重音点与自动化接入工单</div>
          </div>
        </div>
        <div id="dj-tools-status" role="status">请在地图或场景树中选中区域后执行操作</div>
        <div class="dj-tools-container" id="dj-tools-region"></div>
        <div class="dj-tools-container" id="dj-tools-audio-radar" style="display:none;"></div>
      `;
      body.appendChild(page);

      const tabItems = page.querySelectorAll('.dj-tools-tab-item');
      tabItems.forEach(tab => {
        const switchTab = () => {
          const target = tab.getAttribute('data-tab');
          if (state.activeTab === target) return;
          state.activeTab = target;
          tabItems.forEach(t => t.classList.toggle('active', t === tab));
          const regContainer = doc.getElementById('dj-tools-region');
          const radarContainer = doc.getElementById('dj-tools-audio-radar');
          if (regContainer) regContainer.style.display = target === 'region' ? '' : 'none';
          if (radarContainer) radarContainer.style.display = target === 'radar' ? '' : 'none';
          if (target === 'radar') {
            status('音效雷达：实时捕获动作主体、触发事件与画面连拍特征');
            refreshAudioRadar();
          } else {
            status('请在地图或场景树中选中区域后执行操作');
            refreshRegion();
          }
        };
        tab.addEventListener('click', switchTab);
        tab.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(); }
        });
      });

      const hud = win.__DANJUAN_HUD_API__;
      if (hud && typeof hud.registerPage === 'function') {
        hud.registerPage('editor-tools', page, {
          title: '痛点解决',
          showBack: true,
          showModeSwitch: false,
          showClearErrors: false,
          showTabs: false,
          showExportBtns: false,
          refresh,
          destroy() {}
        });
      }
    }

    function setupObserver() {
      const observer = new win.MutationObserver(() => {
        ensureEntry();
        ensurePage();
      });
      observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    }

    win.setInterval(() => {
      hookRegions();
      pollRuntime();
      pollAudioRadar();
      if (doc.getElementById('page-editor-tools') && doc.getElementById('page-editor-tools').style.display !== 'none') {
        if (state.activeTab === 'radar') {
          refreshAudioRadar();
        } else {
          refreshRegion();
        }
      }
    }, 1000);

    // 监听来自 5967 桥的定位通知
    win.addEventListener('yami-audio-locate-requested', (e) => {
      const data = e.detail || {};
      const assetPath = data.assetPath || '';
      const mediumName = data.mediumName || '';
      status('[DanJuan 闪电定位] 已在编辑器中打开 ' + (mediumName || assetPath) + ' -> 可直接插入 playAudio 音效指令');
      if (state.activeTab === 'radar') {
        refreshAudioRadar();
      }
    });

    // 监听 BroadcastChannel 跨窗口通知
    try {
      if (typeof win.BroadcastChannel !== 'undefined') {
        const bc = new win.BroadcastChannel('yami-perf-lab-channel');
        bc.addEventListener('message', (ev) => {
          if (ev.data && ev.data.type === 'AUDIO_RADAR_LOCATE') {
            const trigger = ev.data.trigger || {};
            const medium = trigger.medium || {};
            openAssetInEditor(medium.assetPath || medium.name);
            status('[DanJuan 闪电定位] 已在编辑器中打开 ' + (medium.name || medium.assetPath) + ' -> 可直接插入 playAudio 音效指令');
            if (state.activeTab === 'radar') {
              refreshAudioRadar();
            }
          }
        });
      }
    } catch (e) {}

    ensureEntry();
    ensurePage();
    setupObserver();
    state.mounted = true;
  }

  return {
    calculateBounds,
    samePin,
    mount
  };
});
