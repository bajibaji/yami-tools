(() => {
  'use strict';

  function initHUD() {
    if (!document.body) {
      requestAnimationFrame(initHUD);
      return;
    }

    // 彻底清除旧节点
    document.getElementById('yami-perf-style')?.remove();
    document.getElementById('yami-perf-mini-hud')?.remove();
    document.getElementById('yami-perf-dock')?.remove();
    document.getElementById('yami-perf-toast')?.remove();

    const style = document.createElement('style');
    style.id = 'yami-perf-style';
    style.textContent = `
      /* ============================================================
       * 全局样式污染彻底隔离层 (免疫 Yami 编辑器 components.css 污染)
       * ============================================================ */
      #yami-perf-mini-hud, #yami-perf-dock {
        box-sizing: border-box !important;
        font-family: Inter, "Microsoft YaHei UI", sans-serif !important;
        line-height: normal !important;
        letter-spacing: normal !important;
      }
      #yami-perf-mini-hud *, #yami-perf-dock * {
        box-sizing: border-box !important;
      }
      /* 核心防御：强制覆盖可能导致绝对定位堆叠的全局 button 规则 */
      #yami-perf-dock button,
      #yami-perf-dock div[role="button"] {
        position: static !important;
        margin: 0 !important;
        outline: none !important;
      }

      /* 迷你 HUD 胶囊 */
      #yami-perf-mini-hud {
        position: fixed !important;
        top: 40px !important;
        right: 10px !important;
        z-index: 999998 !important;
        font-size: 12px !important;
        user-select: none !important;
      }
      .yami-perf-capsule {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: #202020 !important;
        border: 1px solid #101010 !important;
        border-radius: 3px !important;
        padding: 4px 9px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6) !important;
        cursor: pointer !important;
        color: #d8d8d8 !important;
        transition: background 0.12s, border-color 0.12s !important;
      }
      .yami-perf-capsule:hover {
        background: #303030 !important;
        border-color: #0080c0 !important;
        color: #ffffff !important;
      }
      .yami-perf-badge {
        width: 7px !important;
        height: 7px !important;
        border-radius: 50% !important;
        background: #1cff9b !important;
        box-shadow: 0 0 5px rgba(28, 255, 155, 0.6) !important;
      }
      .yami-perf-badge.warn { background: #f06000 !important; box-shadow: 0 0 5px rgba(240, 96, 0, 0.6) !important; }
      .yami-perf-badge.bad { background: #ff4040 !important; box-shadow: 0 0 6px rgba(255, 64, 64, 0.8) !important; animation: yami-pulse 0.8s infinite !important; }
      @keyframes yami-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

      /* 非阻塞式右侧停靠大盘 */
      .yami-perf-dock {
        position: fixed !important;
        top: 38px !important;
        right: 8px !important;
        bottom: 8px !important;
        width: 440px !important;
        max-width: 48vw !important;
        background: #242424 !important;
        border: 1px solid #101010 !important;
        border-radius: 3px !important;
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.8) !important;
        color: #d8d8d8 !important;
        z-index: 999999 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        opacity: 0 !important;
        transform: translateX(105%) !important;
        pointer-events: none !important;
        transition: transform 0.2s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.15s ease !important;
      }
      .yami-perf-dock.show {
        opacity: 1 !important;
        transform: translateX(0) !important;
        pointer-events: auto !important;
      }

      .yami-perf-dock-header {
        height: 34px !important;
        min-height: 34px !important;
        flex-shrink: 0 !important;
        padding: 0 10px !important;
        background: #303030 !important;
        border-bottom: 1px solid #181818 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        user-select: none !important;
      }
      .yami-perf-dock-title {
        font-size: 12px !important;
        font-weight: 600 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        color: #ffffff !important;
      }
      .yami-perf-dock-actions {
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
      }
      .yami-perf-icon-btn {
        background: transparent !important;
        border: 1px solid transparent !important;
        color: #a0a0a0 !important;
        font-size: 14px !important;
        padding: 2px 8px !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        line-height: 18px !important;
      }
      .yami-perf-icon-btn:hover {
        background: #e81123 !important;
        color: #ffffff !important;
      }

      /* 标签导航栏：强制独立 flex 布局，免疫任何外部污染 */
      .yami-perf-tabs {
        display: flex !important;
        flex-direction: row !important;
        height: 34px !important;
        min-height: 34px !important;
        max-height: 34px !important;
        flex-shrink: 0 !important;
        background: #202020 !important;
        border-bottom: 1px solid #141414 !important;
        padding: 0 4px !important;
        gap: 4px !important;
        align-items: stretch !important;
        user-select: none !important;
      }
      .yami-perf-tab {
        position: relative !important;
        flex: 1 1 0% !important;
        width: 25% !important;
        height: 100% !important;
        min-width: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        color: #999999 !important;
        background: transparent !important;
        border: none !important;
        border-bottom: 2px solid transparent !important;
        border-radius: 2px 2px 0 0 !important;
        cursor: pointer !important;
        white-space: nowrap !important;
        padding: 0 4px !important;
        transition: all 0.12s ease !important;
      }
      .yami-perf-tab:hover {
        color: #ffffff !important;
        background: rgba(255, 255, 255, 0.05) !important;
      }
      .yami-perf-tab.active {
        color: #ffffff !important;
        font-weight: 600 !important;
        border-bottom: 2px solid #0080c0 !important;
        background: rgba(255, 255, 255, 0.08) !important;
      }

      /* 主体内容容器 */
      .yami-perf-dock-body {
        flex: 1 !important;
        overflow-y: auto !important;
        padding: 10px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        background: #1c1c1c !important;
        position: relative !important;
      }
      .yami-perf-dock-body::-webkit-scrollbar { width: 5px !important; }
      .yami-perf-dock-body::-webkit-scrollbar-track { background: #181818 !important; }
      .yami-perf-dock-body::-webkit-scrollbar-thumb { background: #404040 !important; border-radius: 2px !important; }

      /* 非 active 视图强隔离 */
      .yami-perf-tab-content {
        display: none !important;
      }
      .yami-perf-tab-content.active {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
      }

      .yami-perf-grid {
        display: grid !important;
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 6px !important;
      }
      .yami-perf-card {
        background: #252525 !important;
        border: 1px solid #181818 !important;
        border-radius: 2px !important;
        padding: 6px 8px !important;
      }
      .yami-perf-card-label { font-size: 11px !important; color: #808080 !important; }
      .yami-perf-card-value {
        font-size: 15px !important;
        font-weight: 700 !important;
        margin-top: 2px !important;
        color: #ffffff !important;
        font-family: Consolas, monospace !important;
      }

      .yami-perf-box {
        background: #222222 !important;
        border: 1px solid #181818 !important;
        border-radius: 2px !important;
        padding: 8px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
      }
      .yami-perf-box-title {
        font-size: 11px !important;
        font-weight: 600 !important;
        color: #b0b0b0 !important;
        display: flex !important;
        justify-content: space-between !important;
        margin-bottom: 2px !important;
      }

      .yami-perf-bar-row { display: flex !important; flex-direction: column !important; gap: 3px !important; font-size: 11px !important; }
      .yami-perf-bar-head { display: flex !important; justify-content: space-between !important; color: #d8d8d8 !important; }
      .yami-perf-bar-track { height: 4px !important; background: #18191a !important; border-radius: 2px !important; overflow: hidden !important; }
      .yami-perf-bar-fill { height: 100% !important; background: #0080c0 !important; border-radius: 2px !important; }
      .yami-perf-bar-fill.bad { background: #f06000 !important; }

      .yami-perf-event-row {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 4px 6px !important;
        background: #1e1e1e !important;
        border: 1px solid #181818 !important;
        border-radius: 2px !important;
        font-size: 11px !important;
      }
      .yami-perf-event-name { font-weight: 500 !important; color: #ffffff !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; max-width: 250px !important; }
      .yami-perf-event-tag { font-size: 10px !important; color: #808080 !important; background: #181818 !important; padding: 1px 4px !important; border-radius: 2px !important; font-family: Consolas, monospace !important; }

      .yami-perf-dock-footer {
        height: 36px !important;
        min-height: 36px !important;
        flex-shrink: 0 !important;
        padding: 0 10px !important;
        background: #2c2c2c !important;
        border-top: 1px solid #181818 !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        font-size: 11px !important;
      }
      .yami-perf-btn {
        background: #404040 !important;
        border: 1px solid #282828 !important;
        color: #d8d8d8 !important;
        padding: 4px 10px !important;
        border-radius: 2px !important;
        font-size: 11px !important;
        cursor: pointer !important;
        transition: background 0.1s !important;
      }
      .yami-perf-btn:hover { background: #505050 !important; color: #ffffff !important; }

      .yami-perf-toast {
        position: fixed !important;
        bottom: 16px !important;
        right: 16px !important;
        z-index: 1000001 !important;
        background: #282828 !important;
        border: 1px solid #101010 !important;
        border-left: 3px solid #1cff9b !important;
        color: #d8d8d8 !important;
        padding: 5px 12px !important;
        border-radius: 2px !important;
        font-size: 11px !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
        opacity: 0 !important;
        transform: translateY(6px) !important;
        transition: all 0.15s ease !important;
        pointer-events: none !important;
      }
      .yami-perf-toast.show { opacity: 1 !important; transform: translateY(0) !important; }

      /* 🧪 嫌疑开关 (A/B 实验) */
      .yami-perf-sus-row { display: flex !important; flex-wrap: wrap !important; gap: 5px !important; align-items: center !important; }
      .yami-perf-sus-pill {
        display: inline-block !important; padding: 3px 10px !important; border-radius: 10px !important;
        font-size: 11px !important; cursor: pointer !important; border: 1px solid #333333 !important;
        background: #262626 !important; color: #707070 !important; user-select: none !important;
        position: static !important; width: auto !important; height: auto !important;
      }
      .yami-perf-sus-pill:hover { background: #303030 !important; color: #d8d8d8 !important; }
      .yami-perf-sus-pill.on { background: #3a2410 !important; color: #ffb060 !important; border-color: #7a4a20 !important; }

      /* ⚠️ 卡顿详情面板 */
      .yami-perf-jank-item { cursor: pointer !important; }
      .yami-perf-jank-item:hover { border-color: #f06000 !important; background: #38241c !important; }
      .yami-perf-jank-detail { display: none !important; margin-top: 6px !important; background: #1c1c1c !important; border: 1px solid #2e2e2e !important; border-radius: 3px !important; padding: 8px !important; font-size: 11px !important; }
      .yami-perf-jank-detail.show { display: block !important; }
      .yami-perf-wave { width: 100% !important; height: 64px !important; background: #141414 !important; border: 1px solid #262626 !important; border-radius: 2px !important; display: block !important; }
      .yami-perf-objrow { display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 2px 6px !important; border-radius: 2px !important; }
      .yami-perf-objrow:nth-child(odd) { background: rgba(255,255,255,0.03) !important; }
      .yami-perf-kind { color: #909090 !important; margin-right: 6px !important; font-size: 10px !important; }
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

    // 恢复历史坐标
    try {
      const savedPos = localStorage.getItem('yami-perf-capsule-pos');
      if (savedPos) {
        const pos = JSON.parse(savedPos);
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
          hud.style.left = Math.max(4, Math.min(window.innerWidth - 120, pos.left)) + 'px';
          hud.style.top = Math.max(4, Math.min(window.innerHeight - 40, pos.top)) + 'px';
          hud.style.right = 'auto';
        }
      }
    } catch (e) {}

    // 非阻塞停靠侧栏 (注意：全面改用 role="button" 的 div，彻底脱离 editor 全局 button 污染)
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
          <div class="yami-perf-icon-btn" id="btn-dock-close" role="button" title="收起 (Home / ESC)">×</div>
        </div>
      </div>

      <div class="yami-perf-tabs" id="yami-tabs-bar">
        <div class="yami-perf-tab active" data-ptab="overview" role="button">⚡ 性能总览</div>
        <div class="yami-perf-tab" data-ptab="render" role="button">🎨 渲染DrawCall</div>
        <div class="yami-perf-tab" data-ptab="scene" role="button">🎬 场景与对象</div>
        <div class="yami-perf-tab" data-ptab="events" role="button">📜 活跃事件</div>
      </div>

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
              <span>🧪 嫌疑开关 (A/B 实验)</span>
              <span style="color: #808080;">点击暂停某类对象更新 · 卡顿消失即真凶</span>
            </div>
            <div class="yami-perf-sus-row" id="sus-row" style="padding: 2px 0;">
              <span style="color: #606060; font-size: 10px;">角色 / 动画 / 粒子 / 触发器 / 界面 / 事件</span>
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
            <div class="yami-perf-jank-detail" id="box-jank-detail"></div>
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
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">纹理上传 (texImage2D · 本帧)</div>
              <div class="yami-perf-card-value" id="val-uploads" style="color: #f0b000;">0 次 / 0 KB</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">超大规模绘制 (>2万顶点)</div>
              <div class="yami-perf-card-value" id="val-bigdraws" style="color: #f06000;">0 次</div>
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

        <!-- 选项卡 3: 场景与对象 (100% 对齐引擎 F10 原生数据) -->
        <div class="yami-perf-tab-content" id="ptab-scene">
          <div class="yami-perf-grid">
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">角色 (Actors: 可见/总数)</div>
              <div class="yami-perf-card-value" id="val-actors" style="color: #1cff9b;">0 / 0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">动画与触发器 (Anims / Triggers)</div>
              <div class="yami-perf-card-value" id="val-anims-triggers" style="font-size: 13px;">0/0 | 0/0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">粒子与光源 (Particles / Lights)</div>
              <div class="yami-perf-card-value" id="val-particles" style="font-size: 13px;">粒子 0 | 光源 0</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">界面元素 / 纹理 (Elements/Textures)</div>
              <div class="yami-perf-card-value" id="val-elements-textures" style="font-size: 13px; color: #0080c0;">0 界面 | 0 纹理</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>🔍 对象级耗时排行 (总 / 均 / 峰 · 卡顿真凶)</span>
              <span id="val-objwrapped" style="color: #808080;">0 已包装</span>
            </div>
            <div id="box-objects-list" style="display: flex; flex-direction: column; gap: 3px;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">正在采集对象级耗时...</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>🎬 场景环境与摄像机视口状态</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: #d8d8d8;">
              <div style="display: flex; justify-content: space-between;"><span>画布原生分辨率:</span><b id="val-native-res" style="color: #1cff9b; font-family: Consolas, monospace;">1920x1080</b></div>
              <div style="display: flex; justify-content: space-between;"><span>摄像机中心 (X / Y):</span><b id="val-cam-pos" style="color: #ffffff; font-family: Consolas, monospace;">0, 0</b></div>
              <div style="display: flex; justify-content: space-between;"><span>摄像机缩放率 (Zoom):</span><b id="val-cam-zoom" style="color: #ffffff; font-family: Consolas, monospace;">1.0x</b></div>
            </div>
          </div>
        </div>

        <!-- 选项卡 4: 活跃事件 -->
        <div class="yami-perf-tab-content" id="ptab-events">
          <div class="yami-perf-grid" style="grid-template-columns: 1fr 1fr;">
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">当前正在执行活跃事件</div>
              <div class="yami-perf-card-value" id="val-events-active-count" style="color: #1cff9b;">0 个</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">全局注册事件总数</div>
              <div class="yami-perf-card-value" id="val-events-reg-count">0 个</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>⚡ 正在运行的活跃事件 (Active Events)</span>
            </div>
            <div id="box-active-events-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">主线程当前无活跃后台/并行事件</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>🕒 最近事件触发执行流水 (Activity Log)</span>
            </div>
            <div id="box-history-events-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">尚未捕获到事件触发执行</div>
            </div>
          </div>
        </div>
      </div>

      <div class="yami-perf-dock-footer">
        <div style="color: #808080;">💡 游戏未暂停，鼠标可自由操作</div>
        <div style="display: flex; gap: 6px;">
          <div class="yami-perf-btn" id="dock-btn-copy" role="button">复制 JSON</div>
          <div class="yami-perf-btn" id="dock-btn-dl" role="button">保存报告</div>
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

    // HTML 转义: 游戏数据中的对象名/事件名/模块名一律先转义再进 innerHTML (防 XSS 与 UI 破坏)
    function esc(v) {
      return String(v == null ? '' : v)
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }

    // 🧪 嫌疑开关 (A/B 实验)：暂停某类对象更新，卡顿消失即真凶
    const SUS_KINDS = [
      ['actors', '角色'], ['animations', '动画'], ['emitters', '粒子'],
      ['triggers', '触发器'], ['ui', '界面'], ['events', '事件']
    ];
    const susRow = document.getElementById('sus-row');

    function renderSusPills() {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!susRow || !probe || !probe.getSuspend) return;
      const st = probe.getSuspend();
      susRow.innerHTML = SUS_KINDS.map(function (k) {
        const on = st[k[0]] === true;
        return '<div class="yami-perf-sus-pill' + (on ? ' on' : '') + '" data-sus="' + k[0] + '" role="button">' + (on ? '▶ 恢复 ' : '⏸ 暂停 ') + k[1] + '</div>';
      }).join('');
    }
    if (susRow) {
      susRow.addEventListener('click', function (e) {
        e.stopPropagation();
        const pill = e.target.closest('.yami-perf-sus-pill');
        if (!pill) return;
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe || !probe.suspend || !probe.getSuspend) return;
        const kind = pill.dataset.sus;
        const next = probe.suspend(kind, !(probe.getSuspend()[kind] === true));
        renderSusPills();
        const label = (SUS_KINDS.find(function (k) { return k[0] === kind; }) || [])[1] || kind;
        showToast(next ? ('⏸ 已暂停' + label + '更新 — 观察 FPS 是否回升 (真凶验证)') : ('▶ 已恢复' + label + '更新'), 2000);
      });
    }
    renderSusPills();

    // 防穿透隔离
    let isPreventingInput = false;

    function safePreventInput() {
      if (!isPreventingInput) {
        isPreventingInput = true;
        try {
          if (typeof Scene !== 'undefined' && typeof Scene.preventInput === 'function') {
            Scene.preventInput();
          }
          if (typeof Input !== 'undefined' && Input.buttons) {
            Input.buttons[0] = 0;
            Input.buttons[1] = 0;
            Input.buttons[2] = 0;
          }
        } catch (e) {}
      }
    }

    function safeRestoreInput() {
      if (isPreventingInput) {
        isPreventingInput = false;
        try {
          if (typeof Scene !== 'undefined' && typeof Scene.restoreInput === 'function') {
            Scene.restoreInput();
          }
        } catch (e) {}
      }
    }

    dock.addEventListener('mouseenter', safePreventInput);
    dock.addEventListener('mouseleave', safeRestoreInput);
    hud.addEventListener('mouseenter', safePreventInput);
    hud.addEventListener('mouseleave', safeRestoreInput);

    dock.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      safePreventInput();
    });
    hud.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      safePreventInput();
    });

    const badge = document.getElementById('yami-badge');
    const fpsText = document.getElementById('yami-fps');
    const msText = document.getElementById('yami-ms');
    const dcText = document.getElementById('yami-dc');

    let isDockOpen = false;
    let activeTab = 'overview';

    function toggleDock(force) {
      isDockOpen = typeof force === 'boolean' ? force : !isDockOpen;
      dock.classList.toggle('show', isDockOpen);
      if (isDockOpen) {
        refreshDockData();
      } else {
        safeRestoreInput();
      }
    }

    // 胶囊点击
    document.getElementById('yami-capsule').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDock();
    });

    // 关闭按钮
    document.getElementById('btn-dock-close').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDock(false);
    });

    // Tab 切换逻辑
    const tabButtons = dock.querySelectorAll('.yami-perf-tab');
    const tabContents = dock.querySelectorAll('.yami-perf-tab-content');

    tabButtons.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const ptab = tab.dataset.ptab;
        if (!ptab) return;

        tabButtons.forEach(b => b.classList.toggle('active', b === tab));
        tabContents.forEach(c => {
          c.classList.toggle('active', c.id === `ptab-${ptab}`);
        });

        activeTab = ptab;
        refreshDockData();
      });
    });

    // 复制与下载
    document.getElementById('dock-btn-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.copy();
        showToast('✓ 完整探针分析 JSON 已复制到剪贴板');
      }
    });

    document.getElementById('dock-btn-dl').addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.download();
        showToast('✓ 探针报告 JSON 文件已下载');
      }
    });

    // 刷新数据函数
    const OBJ_KIND_LABEL = { actors: '角色', animations: '动画', emitters: '粒子', triggers: '触发器', ui: '界面', events: '事件' };

    function refreshDockData() {
      try {
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe) return;
        const report = probe.getReport ? probe.getReport() : null;
        if (!report) return;

        const mem = probe.getMemoryInfo ? probe.getMemoryInfo() : { used: 0, total: 0 };
        const scene = probe.getSceneDetails ? probe.getSceneDetails() : {};
        const eventsData = probe.getActiveEvents ? probe.getActiveEvents() : { active: [], history: [], totalRegistered: 0 };
        if (susRow && susRow.querySelectorAll('.yami-perf-sus-pill').length === 0) renderSusPills();
        const gl = report.webgl || {};
        const comp = report.compute || { avg: 0, p99: 0, overBudgetCount: 0 };

        // 1. 总览数据
        const fpsEl = document.getElementById('val-fps');
        const computeEl = document.getElementById('val-compute');
        const overEl = document.getElementById('val-overbudget');
        const memEl = document.getElementById('val-memory');
        const updatersList = document.getElementById('box-updaters-list');
        const jankList = document.getElementById('box-jank-list');
        const jankCount = document.getElementById('val-jank-count');

        if (fpsEl) fpsEl.textContent = `${(typeof Time !== 'undefined' && Time.fps) || 60} FPS`;
        if (computeEl) computeEl.textContent = `${comp.avg || 0} ms (P99: ${comp.p99 || 0}ms)`;
        if (overEl) {
          const total = report.samples || 1;
          const count = comp.overBudgetCount || 0;
          const pct = ((count / total) * 100).toFixed(1);
          overEl.textContent = `${count} 帧 (${pct}%)`;
        }
        if (memEl) memEl.textContent = `${mem.used || 0} MB / ${mem.total || 0} MB`;

        // 模块耗时排行榜
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
                    <span style="color: #ffffff; font-weight: 500;">${esc(item.name)}</span>
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
              const topObj = j.objects && j.objects[0];
              const topMod = (j.updaters && j.updaters[0] && j.updaters[0].name) || 'Game Update';
              const who = esc(topObj ? ('🎯 ' + (OBJ_KIND_LABEL[topObj.kind] || topObj.kind) + '·' + topObj.name) : topMod);
              const upInfo = (j.textureUploadKB || 0) > 0 ? ('⤴ ' + j.textureUploadKB + 'KB ') : '';
              return `
                <div class="yami-perf-jank-item" data-jframe="${j.frame}" role="button" style="display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; background: #2e2020; border: 1px solid #482020; border-radius: 2px; font-size: 10px;">
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">⚠️ <b>#${j.frame}</b> <b style="color: #ff4040;">${j.compute}ms</b> <span style="color: #c8a050; font-size: 10px;">${who}</span></span>
                  <span style="color: #808080; font-family: Consolas, monospace; flex-shrink: 0; margin-left: 6px;">${upInfo}+${j.elapsedMs}ms</span>
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
        const upEl = document.getElementById('val-uploads');
        const bigEl = document.getElementById('val-bigdraws');
        if (upEl) upEl.textContent = `${gl.lastTextureUploads || 0} 次 / ${gl.lastTextureUploadKB || 0} KB`;
        if (bigEl) bigEl.textContent = `${gl.lastBigDraws || 0} 次`;

        if (renderersList && report.renderers) {
          const rList = report.renderers.slice(0, 5);
          if (rList.length) {
            const maxR = rList[0].total || 1;
            renderersList.innerHTML = rList.map(item => `
              <div class="yami-perf-bar-row">
                <div class="yami-perf-bar-head">
                  <span style="color: #ffffff;">${esc(item.name)}</span>
                  <span style="font-family: Consolas, monospace; color: #808080;">总 ${item.total}ms | 均 ${item.avg}ms</span>
                </div>
                <div class="yami-perf-bar-track">
                  <div class="yami-perf-bar-fill" style="width: ${Math.min(100, Math.round((item.total / maxR) * 100))}%;"></div>
                </div>
              </div>
            `).join('');
          }
        }

        // 3. 场景选项卡 (100% 对齐 F10 原生数据)
        const actorsEl = document.getElementById('val-actors');
        const animsTriggersEl = document.getElementById('val-anims-triggers');
        const particlesEl = document.getElementById('val-particles');
        const elementsTexturesEl = document.getElementById('val-elements-textures');
        const nativeResEl = document.getElementById('val-native-res');
        const camPosEl = document.getElementById('val-cam-pos');
        const camZoomEl = document.getElementById('val-cam-zoom');

        if (actorsEl) actorsEl.textContent = `${scene.visibleActors || 0} / ${scene.actors || 0}`;
        if (animsTriggersEl) animsTriggersEl.textContent = `${scene.visibleAnimations || 0}/${scene.animations || 0} | ${scene.visibleTriggers || 0}/${scene.triggers || 0}`;
        if (particlesEl) particlesEl.textContent = `粒子 ${scene.particles || 0} (发射器: ${scene.emitters || 0})`;
        if (elementsTexturesEl) elementsTexturesEl.textContent = `界面: ${scene.elements || 0} | 纹理: ${scene.textures || 0}`;
        if (nativeResEl) nativeResEl.textContent = scene.resolution || '1920x1080';

        if (scene.camera) {
          if (camPosEl) camPosEl.textContent = `${scene.camera.x}, ${scene.camera.y}`;
          if (camZoomEl) camZoomEl.textContent = `${scene.camera.zoom}x`;
        }

        // 3.5 对象级耗时排行 (卡顿真凶)
        const objectsListEl = document.getElementById('box-objects-list');
        const objWrappedEl = document.getElementById('val-objwrapped');
        if (objWrappedEl && report.wrappedObjects) {
          const w = report.wrappedObjects;
          const parts = [];
          for (const k of ['actors', 'animations', 'emitters', 'triggers', 'ui']) {
            if (w[k]) parts.push((OBJ_KIND_LABEL[k] || k) + ' ' + w[k]);
          }
          objWrappedEl.textContent = parts.length ? '已包装 ' + parts.join(' · ') : '';
        }
        if (objectsListEl) {
          const objList = report.objects || [];
          if (objList.length) {
            const maxTotal = objList[0].total || 1;
            objectsListEl.innerHTML = objList.slice(0, 8).map(function (item) {
              const isBad = item.max > 16.7;
              const k = OBJ_KIND_LABEL[item.kind] || item.kind;
              return '<div class="yami-perf-objrow">'
                + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span class="yami-perf-kind">' + esc(k) + '</span><span style="color:#ffffff;">' + esc(item.name) + '</span></span>'
                + '<span style="font-family: Consolas, monospace; color: ' + (isBad ? '#f06000' : '#808080') + '; flex-shrink: 0; margin-left: 8px;">总 ' + item.total + 'ms | 均 ' + item.avg + 'ms | 峰 ' + item.max + 'ms</span>'
                + '</div>'
                + '<div class="yami-perf-bar-track"><div class="yami-perf-bar-fill' + (isBad ? ' bad' : '') + '" style="width:' + Math.min(100, Math.round(item.total / maxTotal * 100)) + '%;"></div></div>';
            }).join('');
          } else {
            objectsListEl.innerHTML = '<div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">暂无对象级耗时数据 (场景对象更新中自动采集)</div>';
          }
        }

        // 4. 活跃事件选项卡
        const activeCountEl = document.getElementById('val-events-active-count');
        const regCountEl = document.getElementById('val-events-reg-count');
        const activeListEl = document.getElementById('box-active-events-list');
        const historyListEl = document.getElementById('box-history-events-list');

        if (activeCountEl) activeCountEl.textContent = `${eventsData.active.length} 个`;
        if (regCountEl) regCountEl.textContent = `${eventsData.totalRegistered || 0} 个`;

        if (activeListEl) {
          if (eventsData.active.length) {
            activeListEl.innerHTML = eventsData.active.map(ev => `
              <div class="yami-perf-event-row">
                <span class="yami-perf-event-name" title="${esc(ev.path || ev.name)}">▶ ${esc(ev.name)}</span>
                <span class="yami-perf-event-tag">指令 #${ev.index} / ${ev.total}</span>
              </div>
            `).join('');
          } else {
            activeListEl.innerHTML = '<div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">主线程当前无活跃后台/并行事件</div>';
          }
        }

        if (historyListEl) {
          if (eventsData.history && eventsData.history.length) {
            historyListEl.innerHTML = eventsData.history.map(h => `
              <div class="yami-perf-event-row">
                <span class="yami-perf-event-name" title="${esc(h.name)}">⚡ ${esc(h.name)}</span>
                <span class="yami-perf-event-tag" style="color: ${h.ms > 5 ? '#f06000' : '#1cff9b'};">${h.ms}ms</span>
              </div>
            `).join('');
          } else {
            historyListEl.innerHTML = '<div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">尚未捕获到事件触发执行</div>';
          }
        }
      } catch (err) {
        console.error('[YAMI PERF] refreshDockData error:', err);
      }
    }

    // ⚠️ 卡顿详情面板: 点击卡顿记录展开完整归因 + 60帧波形
    let currentJankFrame = null;

    function drawJankWave(canvas, timeline, jank) {
      if (!canvas || !timeline || !jank) return;
      const ctx2 = canvas.getContext('2d');
      const W = canvas.width || 460;
      const H = canvas.height || 64;
      ctx2.clearRect(0, 0, W, H);
      // 定位 jank 帧在 timeline 中的索引
      let idx = timeline.length - 1;
      for (let i = 0; i < timeline.length; i++) {
        if (timeline[i].elapsedMs >= jank.elapsedMs) { idx = i; break; }
      }
      const from = Math.max(0, idx - 30);
      const to = Math.min(timeline.length - 1, idx + 30);
      const slice = timeline.slice(from, to + 1);
      if (!slice.length) return;
      const maxC = Math.max(50, jank.compute || 50);
      const pad = 2;
      const xStep = (W - pad * 2) / Math.max(1, slice.length - 1);
      const y = (v, m) => H - pad - (Math.min(v, m) / m) * (H - pad * 2 - 8);
      ctx2.strokeStyle = '#2a2a2a';
      ctx2.lineWidth = 1;
      // 16.7ms 与 33.3ms 参考线
      ctx2.strokeStyle = '#3a3a3a'; ctx2.beginPath();
      ctx2.moveTo(0, y(16.7, maxC)); ctx2.lineTo(W, y(16.7, maxC)); ctx2.stroke();
      ctx2.strokeStyle = '#4a2020'; ctx2.beginPath();
      ctx2.moveTo(0, y(33.3, maxC)); ctx2.lineTo(W, y(33.3, maxC)); ctx2.stroke();
      // compute 曲线
      ctx2.strokeStyle = '#ff8060'; ctx2.lineWidth = 1.2; ctx2.beginPath();
      for (let i = 0; i < slice.length; i++) {
        const x = pad + i * xStep;
        const yy = y(slice[i].compute || 0, maxC);
        if (i === 0) ctx2.moveTo(x, yy); else ctx2.lineTo(x, yy);
      }
      ctx2.stroke();
      // jank 点
      ctx2.fillStyle = '#ff4040';
      ctx2.fillRect(pad + (idx - from) * xStep - 1.5, y(jank.compute, maxC) - 1.5, 3, 3);
      ctx2.fillStyle = '#7a7a7a';
      ctx2.font = '8px Consolas, monospace';
      ctx2.fillText('16.7ms', 4, y(16.7, maxC) - 2);
      ctx2.fillText('33.3ms', 4, y(33.3, maxC) - 2);
    }

    function renderJankRows(arr) {
      if (!arr || !arr.length) return '<div style="color: #707070;">—</div>';
      return arr.slice(0, 6).map(function (x) {
        return '<div class="yami-perf-objrow">'
          + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span class="yami-perf-kind">' + esc(OBJ_KIND_LABEL[x.kind] || x.kind || '') + '</span><span style="color:#e8e8e8;">' + esc(x.name || '') + '</span></span>'
          + '<span style="font-family: Consolas, monospace; color: #ff9060; flex-shrink: 0; margin-left: 8px;">' + x.ms + 'ms</span>'
          + '</div>';
      }).join('');
    }
    function renderModuleRows(arr) {
      if (!arr || !arr.length) return '<div style="color: #707070;">—</div>';
      return arr.slice(0, 6).map(function (x) {
        return '<div class="yami-perf-objrow"><span style="color:#e8e8e8;">' + esc(x.name || '') + '</span>'
          + '<span style="font-family: Consolas, monospace; color: #a0a0a0; flex-shrink: 0; margin-left: 8px;">' + x.ms + 'ms</span></div>';
      }).join('');
    }

    function toggleJankDetail(frame) {
      const detail = document.getElementById('box-jank-detail');
      const probe = window.__YAMI_PERF_PROBE__;
      if (!detail || !probe || !probe.getReport) return;
      if (currentJankFrame === frame) {
        currentJankFrame = null;
        detail.classList.remove('show');
        detail.innerHTML = '';
        return;
      }
      currentJankFrame = frame;
      const report = probe.getReport();
      const janks = (report.overBudgetFrames || []).filter(function (f) { return f.compute > 33.3; }).slice(-6).reverse();
      const j = janks.find(function (f) { return f.frame === frame; });
      if (!j) return;
      detail.innerHTML = ''
        + '<div style="display: flex; justify-content: space-between; color: #909090; padding-bottom: 4px; border-bottom: 1px solid #262626; margin-bottom: 6px;">'
        + '<span>帧 #' + j.frame + ' · compute <b style="color:#ff4040;">' + j.compute + 'ms</b> (update ' + j.update + ' / render ' + j.render + ' / 未归因 ' + (j.unattributed || 0) + ')</span>'
        + '<span>DC ' + (j.drawCalls || 0) + ' · 上传 ' + (j.textureUploadKB || 0) + 'KB · 大绘制 ' + (j.bigDraws || 0) + '</span>'
        + '</div>'
        + '<canvas class="yami-perf-wave" id="jank-wave-canvas"></canvas>'
        + '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px;">'
        + '<div><div style="color:#ff9060; padding: 2px 0;">🎯 对象归因 (当帧)</div>' + renderJankRows(j.objects) + '</div>'
        + '<div><div style="color:#ffc860; padding: 2px 0;">⚙️ 系统模块 (当帧)</div>' + renderModuleRows(j.updaters) + '</div>'
        + '</div>'
        + (j.events && j.events.length ? '<div style="margin-top: 4px;"><div style="color:#7fd0ff; padding: 2px 0;">📜 活跃事件 (当帧)</div>' + renderModuleRows(j.events) + '</div>' : '')
        + '<div style="color:#808080; padding-top: 4px;">点击记录可收起 · 波形为前后 60 帧计算耗时 (红色=本卡顿帧)</div>';
      detail.classList.add('show');
      const canvas = document.getElementById('jank-wave-canvas');
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 420;
        canvas.width = w * dpr;
        canvas.height = 64 * dpr;
        canvas.style.height = '64px';
        drawJankWave(canvas, report.timeline || [], j);
      }
    }

    // 卡顿列表点击委派 (dock 内)
    dock.addEventListener('click', function (e) {
      e.stopPropagation();
      const item = e.target.closest('.yami-perf-jank-item');
      if (item && item.dataset.jframe) {
        toggleJankDetail(Number(item.dataset.jframe));
      }
    });

    // 快捷键 Home 呼出/收起，ESC 收起
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Home' || e.code === 'Home') {
        e.preventDefault();
        toggleDock();
      } else if (e.key === 'Escape' && isDockOpen) {
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
      try {
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
      } catch (e) {}
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHUD);
  } else {
    initHUD();
  }
})();