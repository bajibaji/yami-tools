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
      polling: false
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
      installCommands
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

      // 1. 选中区域与边界计算卡片
      const heading = doc.createElement('h3');
      heading.textContent = '选中场景区域';
      root.appendChild(heading);

      if (selected) {
        details(root, [
          ['名称', selected.name],
          ['场景', selected.path.split('/').pop()],
          ['状态', selected.enabled ? '已启用' : '未启用'],
          ['中心坐标', `${selected.x}, ${selected.y}`],
          ['尺寸', `${selected.width} × ${selected.height}`],
          ['事件/脚本', `${selected.events.length} 个事件 / ${selected.scripts.length} 个脚本`]
        ]);

        // 摄像机边界范围高亮卡片
        const boundsCard = doc.createElement('div');
        boundsCard.className = 'dj-tools-bounds-card';
        const boundsTitle = doc.createElement('div');
        boundsTitle.className = 'dj-tools-bounds-title';
        boundsTitle.textContent = '摄像机视野边界 (clampCamera 绝对数值)';
        boundsCard.appendChild(boundsTitle);

        const boundsGrid = doc.createElement('div');
        boundsGrid.className = 'dj-tools-bounds-grid';
        boundsGrid.innerHTML = `
          <div class="dj-bounds-item"><span class="dj-bounds-k">Left:</span> <span class="dj-bounds-v">${selected.left}</span></div>
          <div class="dj-bounds-item"><span class="dj-bounds-k">Top:</span> <span class="dj-bounds-v">${selected.top}</span></div>
          <div class="dj-bounds-item"><span class="dj-bounds-k">Right:</span> <span class="dj-bounds-v">${selected.right}</span></div>
          <div class="dj-bounds-item"><span class="dj-bounds-k">Bottom:</span> <span class="dj-bounds-v">${selected.bottom}</span></div>
        `;
        boundsCard.appendChild(boundsGrid);
        root.appendChild(boundsCard);

        // 摄像机与区域快捷操作
        const cameraActions = doc.createElement('div');
        cameraActions.className = 'dj-tools-actions';
        root.appendChild(cameraActions);

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

        // 扩展事件指令一键生成
        const cmdHeading = doc.createElement('h3');
        cmdHeading.textContent = '扩展事件指令生成';
        root.appendChild(cmdHeading);

        const commands = doc.createElement('div');
        commands.className = 'dj-tools-actions';
        root.appendChild(commands);

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
      } else {
        details(root, [['选择状态', '请在场景树或地图中选择一个区域']]);
      }

      // 2. 试玩监视与黑匣子记录
      const watch = doc.createElement('h3');
      watch.textContent = '试玩运行监视';
      root.appendChild(watch);

      details(root, [
        ['监视区域', state.pin && state.pin.name || '未设置'],
        ['运行状态', runtime.text],
        ['区内角色数', r ? r.actors.length + ' 个' : '--'],
        ['玩家在区内', r ? (r.playerInside ? '是' : '否') : '--'],
        ['角色名单', r ? r.actors.join('、') || '空区域' : '--']
      ]);

      const watchActions = doc.createElement('div');
      watchActions.className = 'dj-tools-actions';
      root.appendChild(watchActions);

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
      root.appendChild(logHeading);

      const log = doc.createElement('div');
      log.className = 'dj-tools-log';
      log.textContent = runtime.logs.join('\n') || '暂无进入 / 离开记录（在试玩中进出监视区域将在此实时记录）';
      root.appendChild(log);
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

    function refresh() {
      hookRegions();
      pollRuntime();
      refreshRegion();
    }

    function open() {
      const hud = win.__DANJUAN_HUD_API__;
      if (hud && typeof hud.switchView === 'function') {
        hud.switchView('editor-tools');
        if (hud.ctx && hud.ctx.dockState === 'collapsed' && typeof hud.toggleDock === 'function') hud.toggleDock();
      }
      refresh();
    }

    function ensureEntry() {
      if (doc.getElementById('dj-tools-entry')) return;
      const modules = doc.querySelector('.yami-home-modules');
      if (!modules) return;

      const card = doc.createElement('div');
      card.id = 'dj-tools-entry';
      card.className = 'yami-home-module-card';
      card.innerHTML = `
        <div class="yami-home-module-icon-box pink">
          <svg viewBox="0 0 24 24" class="yami-home-module-icon">
            <path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor"></path>
          </svg>
        </div>
        <div class="yami-home-module-info">
          <div class="yami-home-module-title">痛点解决</div>
          <div class="yami-home-module-desc">区域工作台与摄像机边界</div>
        </div>
        <div class="yami-home-module-badge pink">进入</div>
      `;
      card.addEventListener('click', () => open());

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
      page.className = 'yami-perf-page yami-perf-fade dj-tools';
      page.style.display = 'none';
      page.innerHTML = `
        <div class="yami-perf-page-header">
          <div class="yami-perf-page-title-group">
            <div class="yami-perf-page-title">区域工作台</div>
            <div class="yami-perf-page-subtitle">场景区域增强与边界工具</div>
          </div>
          <div class="yami-perf-page-header-actions">
            <div class="yami-perf-btn-icon" id="dj-tools-refresh-btn" title="刷新区域与监视状态">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M5.463 4.433A9.961 9.961 0 0 1 12 2c5.523 0 10 4.477 10 10 0 2.136-.67 4.116-1.81 5.74L17 12h3A8 8 0 1 0 6.46 6.46l-1-1.027z" fill="currentColor"></path>
              </svg>
            </div>
            <div class="yami-perf-btn-icon" id="dj-tools-back-btn" title="返回主页">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M12 10.586l4.95-4.95 1.414 1.414-4.95 4.95 4.95 4.95-1.414 1.414-4.95-4.95-4.95 4.95-1.414-1.414 4.95-4.95-4.95-4.95L7.05 5.636z" fill="currentColor"></path>
              </svg>
            </div>
          </div>
        </div>
        <div id="dj-tools-status" role="status">请在地图或场景树中选中区域后执行操作</div>
        <div id="dj-tools-region"></div>
      `;
      body.appendChild(page);

      const refreshBtn = page.querySelector('#dj-tools-refresh-btn');
      if (refreshBtn) refreshBtn.addEventListener('click', () => refresh());

      const backBtn = page.querySelector('#dj-tools-back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          const hud = win.__DANJUAN_HUD_API__;
          if (hud && typeof hud.switchView === 'function') hud.switchView('home');
        });
      }

      const hud = win.__DANJUAN_HUD_API__;
      if (hud && typeof hud.registerPage === 'function') {
        hud.registerPage('editor-tools', page, {
          title: '区域工作台',
          refresh
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
      if (doc.getElementById('page-editor-tools') && doc.getElementById('page-editor-tools').style.display !== 'none') {
        refreshRegion();
      }
    }, 1000);

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
