(() => {
  'use strict';
  if (window.__YAMI_PERF_HUD__) return;
  window.__YAMI_PERF_HUD__ = true;

  function initHUD() {
    if (!document.body) {
      requestAnimationFrame(initHUD);
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      /* ============================================================
       * Yami 原生深色调设计系统 (完全非阻塞停靠大盘)
       * ============================================================ */
      #yami-perf-mini-hud {
        position: fixed;
        top: 8px;
        right: 8px;
        z-index: 999998;
        font-family: Inter, "Microsoft YaHei UI", sans-serif;
        font-size: 12px;
        user-select: none;
      }
      .yami-perf-capsule {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #202020;
        border: 1px solid #101010;
        border-radius: 3px;
        padding: 3px 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
        cursor: pointer;
        color: #d8d8d8;
        transition: background 0.12s, border-color 0.12s;
      }
      .yami-perf-capsule:hover {
        background: #303030;
        border-color: #0080c0;
        color: #ffffff;
      }
      .yami-perf-badge {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #1cff9b;
        box-shadow: 0 0 5px rgba(28, 255, 155, 0.6);
      }
      .yami-perf-badge.warn { background: #f06000; box-shadow: 0 0 5px rgba(240, 96, 0, 0.6); }
      .yami-perf-badge.bad { background: #ff4040; box-shadow: 0 0 6px rgba(255, 64, 64, 0.8); animation: yami-pulse 0.8s infinite; }
      @keyframes yami-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

      /* 非阻塞式右侧停靠大盘 (游戏可正常操作) */
      .yami-perf-dock {
        position: fixed;
        top: 8px;
        right: 8px;
        bottom: 8px;
        width: 440px;
        max-width: 48vw;
        background: rgba(40, 40, 40, 0.96);
        border: 1px solid #101010;
        border-radius: 3px;
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.7);
        color: #d8d8d8;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: Inter, "Microsoft YaHei UI", sans-serif;
        opacity: 0;
        transform: translateX(105%);
        pointer-events: none;
        transition: transform 0.2s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.15s ease;
      }
      .yami-perf-dock.show {
        opacity: 1;
        transform: translateX(0);
        pointer-events: auto;
      }
      .yami-perf-dock.pinned {
        opacity: 0.65;
        pointer-events: none;
      }
      .yami-perf-dock.pinned:hover {
        opacity: 0.9;
        pointer-events: auto;
      }

      .yami-perf-dock-header {
        height: 34px;
        padding: 0 10px;
        background: #303030;
        border-bottom: 1px solid #181818;
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
      }
      .yami-perf-dock-title {
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #ffffff;
      }
      .yami-perf-dock-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .yami-perf-icon-btn {
        background: transparent;
        border: 1px solid transparent;
        color: #a0a0a0;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 2px;
        cursor: pointer;
        line-height: 18px;
      }
      .yami-perf-icon-btn:hover {
        background: #484848;
        color: #ffffff;
        border-color: #282828;
      }
      .yami-perf-icon-btn.active {
        background: #084872;
        color: #ffffff;
        border-color: #0080c0;
      }

      /* 标签栏 */
      .yami-perf-tabs {
        display: flex;
        background: #242424;
        border-bottom: 1px solid #181818;
        padding: 0 6px;
        gap: 2px;
      }
      .yami-perf-tab {
        padding: 6px 10px;
        font-size: 11px;
        color: #909090;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
      }
      .yami-perf-tab:hover {
        color: #d8d8d8;
      }
      .yami-perf-tab.active {
        color: #ffffff;
        font-weight: 600;
        border-bottom-color: #0080c0;
        background: rgba(255, 255, 255, 0.03);
      }

      /* 主体面板内容 */
      .yami-perf-dock-body {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #1e1e1e;
      }
      .yami-perf-dock-body::-webkit-scrollbar { width: 5px; }
      .yami-perf-dock-body::-webkit-scrollbar-track { background: #181818; }
      .yami-perf-dock-body::-webkit-scrollbar-thumb { background: #404040; border-radius: 2px; }

      .yami-perf-tab-content { display: none; flex-direction: column; gap: 10px; }
      .yami-perf-tab-content.active { display: flex; }

      .yami-perf-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      .yami-perf-card {
        background: #282828;
        border: 1px solid #181818;
        border-radius: 2px;
        padding: 6px 8px;
      }
      .yami-perf-card-label { font-size: 11px; color: #808080; }
      .yami-perf-card-value {
        font-size: 15px;
        font-weight: 700;
        margin-top: 2px;
        color: #ffffff;
        font-family: Consolas, monospace;
      }

      .yami-perf-box {
        background: #252525;
        border: 1px solid #181818;
        border-radius: 2px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .yami-perf-box-title {
        font-size: 11px;
        font-weight: 600;
        color: #b0b0b0;
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
      }

      .yami-perf-bar-row { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
      .yami-perf-bar-head { display: flex; justify-content: space-between; color: #d8d8d8; }
      .yami-perf-bar-track { height: 4px; background: #18191a; border-radius: 2px; overflow: hidden; }
      .yami-perf-bar-fill { height: 100%; background: #0080c0; border-radius: 2px; }
      .yami-perf-bar-fill.bad { background: #f06000; }

      .yami-perf-event-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 6px;
        background: #202020;
        border: 1px solid #181818;
        border-radius: 2px;
        font-size: 11px;
      }
      .yami-perf-event-name { font-weight: 500; color: #ffffff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
      .yami-perf-event-tag { font-size: 10px; color: #808080; background: #181818; padding: 1px 4px; border-radius: 2px; }

      .yami-perf-dock-footer {
        height: 34px;
        padding: 0 10px;
        background: #2c2c2c;
        border-top: 1px solid #181818;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
      }
      .yami-perf-btn {
        background: #404040;
        border: 1px solid #282828;
        color: #d8d8d8;
        padding: 3px 8px;
        border-radius: 2px;
        font-size: 11px;
        cursor: pointer;
      }
      .yami-perf-btn:hover { background: #505050; color: #ffffff; }

      .yami-perf-toast {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 1000001;
        background: #282828;
        border: 1px solid #101010;
        border-left: 3px solid #1cff9b;
        color: #d8d8d8;
        padding: 5px 12px;
        border-radius: 2px;
        font-size: 11px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
        opacity: 0;
        transform: translateY(6px);
        transition: all 0.15s ease;
        pointer-events: none;
      }
      .yami-perf-toast.show { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);

    // 迷你 HUD 胶囊
    const hud = document.createElement('div');
    hud.id = 'yami-perf-mini-hud';
    hud.innerHTML = `
      <div class="yami-perf-capsule" id="yami-capsule" title="点击展开/收起性能大盘 (快捷键: Home)">
        <div class="yami-perf-badge" id="yami-badge"></div>
        <span id="yami-fps" style="font-weight: 600; color: #ffffff;">60 FPS</span>
        <span style="color: #606060;">|</span>
        <span id="yami-ms" style="color: #a0a0a0; font-family: Consolas, monospace;">16.7ms</span>
        <span style="color: #606060;">|</span>
        <span id="yami-dc" style="color: #0080c0; font-family: Consolas, monospace;">0 DC</span>
      </div>
    `;
    document.body.appendChild(hud);

    // 非阻塞停靠侧栏
    const dock = document.createElement('div');
    dock.className = 'yami-perf-dock';
    dock.id = 'yami-perf-dock';
    dock.innerHTML = `
      <div class="yami-perf-dock-header">
        <div class="yami-perf-dock-title">
          <span>⌁ YAMI 实时性能探查</span>
          <span style="font-size: 10px; color: #808080;">(Home 切换)</span>
        </div>
        <div class="yami-perf-dock-actions">
          <button class="yami-perf-icon-btn" id="btn-pin" title="穿透模式 (开启后可在游戏内无阻点击，面板半透明)">📌 穿透</button>
          <button class="yami-perf-icon-btn" id="btn-dock-close" title="收起 (Home / ESC)">×</button>
        </div>
      </div>

      <nav class="yami-perf-tabs">
        <button class="yami-perf-tab active" data-ptab="overview">⚡ 瓶颈与总览</button>
        <button class="yami-perf-tab" data-ptab="render">🎨 渲染与DC</button>
        <button class="yami-perf-tab" data-ptab="scene">🎬 场景与对象</button>
        <button class="yami-perf-tab" data-ptab="events">📜 活跃事件</button>
      </nav>

      <div class="yami-perf-dock-body">
        <!-- 选项卡 1: 总览与瓶颈 -->
        <div class="yami-perf-tab-content active" id="ptab-overview">
          <div class="yami-perf-grid">
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">实时 / P95 帧率</div>
              <div class="yami-perf-card-value" id="val-fps" style="color: #1cff9b;">60 FPS</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">计算耗时 (均值 / P99)</div>
              <div class="yami-perf-card-value" id="val-compute">-- ms</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">超预算帧数 (>16.7ms)</div>
              <div class="yami-perf-card-value" id="val-overbudget" style="color: #f06000;">0 帧</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">JS 堆内存 (已用/总)</div>
              <div class="yami-perf-card-value" id="val-memory">-- MB</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>🔥 模块超帧耗时排行 (卡顿元凶)</span>
              <span>总耗时</span>
            </div>
            <div id="box-updaters-list" style="display: flex; flex-direction: column; gap: 5px;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">正在采集...</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>⚠️ 严重卡顿瞬间 (>33.3ms)</span>
              <span id="val-jank-count">0 次</span>
            </div>
            <div id="box-jank-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">暂无严重掉帧</div>
            </div>
          </div>
        </div>

        <!-- 选项卡 2: 渲染与 WebGL -->
        <div class="yami-perf-tab-content" id="ptab-render">
          <div class="yami-perf-grid">
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">实时 DrawCall</div>
              <div class="yami-perf-card-value" id="val-dc" style="color: #0080c0;">0 次</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">同屏面数 (Triangles)</div>
              <div class="yami-perf-card-value" id="val-triangles">0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">着色器切换 (UseProgram)</div>
              <div class="yami-perf-card-value" id="val-shaders">0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">纹理绑定 (BindTexture)</div>
              <div class="yami-perf-card-value" id="val-textures">0</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>🎨 渲染子系统明细 (Renderers)</span>
            </div>
            <div id="box-renderers-list" style="display: flex; flex-direction: column; gap: 5px;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">正在统计渲染耗时...</div>
            </div>
          </div>
        </div>

        <!-- 选项卡 3: 场景与对象 -->
        <div class="yami-perf-tab-content" id="ptab-scene">
          <div class="yami-perf-grid">
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">角色实体 (Actors)</div>
              <div class="yami-perf-card-value" id="val-actors">0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">光源数量 (Lights)</div>
              <div class="yami-perf-card-value" id="val-lights">0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">粒子系统 (Particles)</div>
              <div class="yami-perf-card-value" id="val-particles">0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">子弹/投射物 (Bullets)</div>
              <div class="yami-perf-card-value" id="val-bullets">0</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>🎬 场景环境与视口状态</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #d8d8d8;">
              <div style="display: flex; justify-content: space-between;"><span>当前天气效果:</span><b id="val-weather" style="color: #ffffff;">无</b></div>
              <div style="display: flex; justify-content: space-between;"><span>摄像机坐标 (X / Y):</span><b id="val-cam-pos" style="color: #ffffff; font-family: monospace;">0, 0</b></div>
              <div style="display: flex; justify-content: space-between;"><span>摄像机缩放倍率:</span><b id="val-cam-zoom" style="color: #ffffff; font-family: monospace;">1.0x</b></div>
            </div>
          </div>
        </div>

        <!-- 选项卡 4: 活跃事件 -->
        <div class="yami-perf-tab-content" id="ptab-events">
          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>📜 当前正在执行的活跃事件列表</span>
              <span id="val-events-count">0 个</span>
            </div>
            <div id="box-active-events-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">当前暂无运行中的事件</div>
            </div>
          </div>
        </div>
      </div>

      <div class="yami-perf-dock-footer">
        <div style="color: #808080;">💡 游戏未暂停，鼠标可自由操作</div>
        <div style="display: flex; gap: 6px;">
          <button class="yami-perf-btn" id="dock-btn-copy">复制 JSON</button>
          <button class="yami-perf-btn" id="dock-btn-dl">保存报告</button>
        </div>
      </div>
    `;
    document.body.appendChild(dock);

    // Toast
    const toast = document.createElement('div');
    toast.className = 'yami-perf-toast';
    toast.id = 'yami-perf-toast';
    document.body.appendChild(toast);

    function showToast(msg, duration) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), duration || 2000);
    }

    const badge = document.getElementById('yami-badge');
    const fpsText = document.getElementById('yami-fps');
    const msText = document.getElementById('yami-ms');
    const dcText = document.getElementById('yami-dc');
    const btnPin = document.getElementById('btn-pin');

    let isDockOpen = false;
    let isPinned = false;
    let activeTab = 'overview';

    function toggleDock(force) {
      isDockOpen = typeof force === 'boolean' ? force : !isDockOpen;
      dock.classList.toggle('show', isDockOpen);
      if (isDockOpen) {
        refreshDockData();
      }
    }

    btnPin.addEventListener('click', () => {
      isPinned = !isPinned;
      dock.classList.toggle('pinned', isPinned);
      btnPin.classList.toggle('active', isPinned);
      btnPin.textContent = isPinned ? '📌 已穿透' : '📌 穿透';
      showToast(isPinned ? '已开启穿透模式（鼠标可穿透面板直接操作游戏）' : '已恢复面板控制模式');
    });

    document.getElementById('btn-dock-close').addEventListener('click', () => toggleDock(false));
    document.getElementById('yami-capsule').addEventListener('click', () => toggleDock());

    // 选项卡切换
    const tabs = dock.querySelectorAll('.yami-perf-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        dock.querySelectorAll('.yami-perf-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        activeTab = tab.dataset.ptab;
        document.getElementById(`ptab-${activeTab}`)?.classList.add('active');
        refreshDockData();
      });
    });

    function refreshDockData() {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!probe) return;
      const report = probe.getReport();
      const mem = probe.getMemoryInfo ? probe.getMemoryInfo() : { used: 0, total: 0 };
      const scene = probe.getSceneDetails ? probe.getSceneDetails() : {};
      const activeEvents = probe.getActiveEvents ? probe.getActiveEvents() : [];
      const gl = report.webgl || {};

      // 1. 总览数据
      const fpsEl = document.getElementById('val-fps');
      const computeEl = document.getElementById('val-compute');
      const overEl = document.getElementById('val-overbudget');
      const memEl = document.getElementById('val-memory');
      const updatersList = document.getElementById('box-updaters-list');
      const jankList = document.getElementById('box-jank-list');
      const jankCount = document.getElementById('val-jank-count');

      if (fpsEl) fpsEl.textContent = `${(typeof Time !== 'undefined' && Time.fps) || 60} FPS`;
      if (computeEl) computeEl.textContent = `${report.compute.avg} ms (P99: ${report.compute.p99}ms)`;
      if (overEl) {
        const total = report.samples || 1;
        const count = report.compute.overBudgetCount || 0;
        const pct = ((count / total) * 100).toFixed(1);
        overEl.textContent = `${count} 帧 (${pct}%)`;
      }
      if (memEl) memEl.textContent = `${mem.used} MB / ${mem.total} MB`;

      // 排行榜
      if (updatersList) {
        const list = [...(report.updaters || []), ...(report.events || [])].sort((a, b) => b.total - a.total).slice(0, 6);
        if (list.length) {
          const maxTotal = list[0].total || 1;
          updatersList.innerHTML = list.map(item => {
            const pct = Math.min(100, Math.round((item.total / maxTotal) * 100));
            const isBad = item.max > 16.7;
            return `
              <div class="yami-perf-bar-row">
                <div class="yami-perf-bar-head">
                  <span style="color: #ffffff; font-weight: 500;">${item.name}</span>
                  <span style="font-family: Consolas, monospace; color: ${isBad ? '#f06000' : '#808080'};">
                    总 ${item.total}ms | 均 ${item.avg}ms | 峰 ${item.max}ms
                  </span>
                </div>
                <div class="yami-perf-bar-track">
                  <div class="yami-perf-bar-fill ${isBad ? 'bad' : ''}" style="width: ${pct}%;"></div>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // 卡顿记录
      if (jankList && jankCount) {
        const janks = (report.overBudgetFrames || []).filter(f => f.compute > 33.3).slice(-6).reverse();
        jankCount.textContent = `${janks.length} 次`;
        if (janks.length) {
          jankList.innerHTML = janks.map(j => {
            const topMod = (j.updaters && j.updaters[0] && j.updaters[0].name) || 'Game Update';
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; background: #2e2020; border: 1px solid #482020; border-radius: 2px; font-size: 10px;">
                <span>⚠️ <b>#${j.frame}</b> <b style="color: #ff4040;">${j.compute}ms</b> (${topMod})</span>
                <span style="color: #808080; font-family: Consolas, monospace;">+${j.elapsedMs}ms</span>
              </div>
            `;
          }).join('');
        } else {
          jankList.innerHTML = '<div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">暂无严重掉帧</div>';
        }
      }

      // 2. 渲染选项卡
      const dcEl = document.getElementById('val-dc');
      const triEl = document.getElementById('val-triangles');
      const shaderEl = document.getElementById('val-shaders');
      const texEl = document.getElementById('val-textures');
      const renderersList = document.getElementById('box-renderers-list');

      if (dcEl) dcEl.textContent = `${gl.lastDrawCalls || 0} 次`;
      if (triEl) triEl.textContent = `${gl.lastTriangles || 0}`;
      if (shaderEl) shaderEl.textContent = `${gl.lastProgramSwitches || 0} 次`;
      if (texEl) texEl.textContent = `${gl.lastTextureBinds || 0} 次`;

      if (renderersList && report.renderers) {
        const rList = report.renderers.slice(0, 5);
        if (rList.length) {
          const maxR = rList[0].total || 1;
          renderersList.innerHTML = rList.map(item => `
            <div class="yami-perf-bar-row">
              <div class="yami-perf-bar-head">
                <span style="color: #ffffff;">${item.name}</span>
                <span style="font-family: Consolas, monospace; color: #808080;">总 ${item.total}ms | 均 ${item.avg}ms</span>
              </div>
              <div class="yami-perf-bar-track">
                <div class="yami-perf-bar-fill" style="width: ${Math.min(100, Math.round((item.total / maxR) * 100))}%;"></div>
              </div>
            </div>
          `).join('');
        }
      }

      // 3. 场景选项卡
      document.getElementById('val-actors').textContent = scene.actors || 0;
      document.getElementById('val-lights').textContent = scene.lights || 0;
      document.getElementById('val-particles').textContent = scene.particles || 0;
      document.getElementById('val-bullets').textContent = scene.bullets || 0;
      document.getElementById('val-weather').textContent = scene.weather || '无';
      if (scene.camera) {
        document.getElementById('val-cam-pos').textContent = `${scene.camera.x}, ${scene.camera.y}`;
        document.getElementById('val-cam-zoom').textContent = `${scene.camera.zoom}x`;
      }

      // 4. 活跃事件选项卡
      const eventsCountEl = document.getElementById('val-events-count');
      const eventsListEl = document.getElementById('box-active-events-list');
      if (eventsCountEl && eventsListEl) {
        eventsCountEl.textContent = `${activeEvents.length} 个`;
        if (activeEvents.length) {
          eventsListEl.innerHTML = activeEvents.map(ev => `
            <div class="yami-perf-event-row">
              <span class="yami-perf-event-name" title="${ev.path || ev.name}">▶ ${ev.name}</span>
              <span class="yami-perf-event-tag">指令 #${ev.index}</span>
            </div>
          `).join('');
        } else {
          eventsListEl.innerHTML = '<div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">当前暂无运行中的后台事件</div>';
        }
      }
    }

    // 复制与下载
    document.getElementById('dock-btn-copy').addEventListener('click', () => {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.copy();
        showToast('✓ 完整探针分析 JSON 已复制到剪贴板');
      }
    });

    document.getElementById('dock-btn-dl').addEventListener('click', () => {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.download();
        showToast('✓ 探针报告 JSON 文件已下载');
      }
    });

    // 快捷键 Home 呼出/收起，ESC 收起
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Home' || e.code === 'Home') {
        e.preventDefault();
        toggleDock();
      } else if (e.key === 'Escape' && isDockOpen && !isPinned) {
        toggleDock(false);
      }
    });

    // 胶囊实时数据刷新与告警
    window.addEventListener('yami-perf-jank', (e) => {
      const detail = e.detail || {};
      badge.className = 'yami-perf-badge bad';
      showToast(`⚠️ 掉帧告警: ${detail.compute}ms (${detail.culprit})`, 2500);
      setTimeout(() => { badge.className = 'yami-perf-badge'; }, 2500);
      if (isDockOpen) refreshDockData();
    });

    setInterval(() => {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!probe || !probe.state.samples.length) return;
      const last = probe.state.samples[probe.state.samples.length - 1];
      const fps = last.fps || 60;
      const compute = last.compute || 0;
      const dc = last.drawCalls || 0;

      fpsText.textContent = `${fps} FPS`;
      msText.textContent = `${compute.toFixed(1)}ms`;
      dcText.textContent = `${dc} DC`;

      if (compute > 33.3 || fps < 35) {
        badge.className = 'yami-perf-badge bad';
      } else if (compute > 16.7 || fps < 55) {
        badge.className = 'yami-perf-badge warn';
      } else {
        badge.className = 'yami-perf-badge';
      }

      if (isDockOpen && probe.state.frameSeq % 20 === 0) {
        refreshDockData();
      }
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHUD);
  } else {
    initHUD();
  }
})();