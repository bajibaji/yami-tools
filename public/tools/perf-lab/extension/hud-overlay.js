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
       * Yami 原生深色调设计规范
       * 底层工作区: #181818 | 窗口背景: #282828 | 标题/头部: #303030
       * 面板卡片: #252525 | 边框: #181818 / #101010
       * 文本: #d8d8d8 (主) / #ffffff (强调) / #808080 (辅助/次要)
       * 状态色: #1cff9b (正常高亮) / #f06000 (警戒) / #ff4040 (掉帧)
       * 强调/选区: #084872 / #0080c0 | 字体: Inter, Microsoft YaHei UI
       * ============================================================ */
      #yami-perf-mini-hud {
        position: fixed;
        top: 8px;
        right: 8px;
        z-index: 999999;
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

      /* 游戏内置诊断大盘 (Yami 原生暗黑风格) */
      .yami-perf-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease;
      }
      .yami-perf-modal-overlay.show {
        opacity: 1;
        pointer-events: auto;
      }
      .yami-perf-modal {
        width: 820px;
        max-width: 95vw;
        max-height: 90vh;
        background: #282828;
        border: 1px solid #101010;
        border-radius: 3px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        color: #d8d8d8;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: Inter, "Microsoft YaHei UI", sans-serif;
      }
      .yami-perf-modal-header {
        height: 34px;
        padding: 0 12px;
        background: #303030;
        border-bottom: 1px solid #181818;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .yami-perf-modal-title {
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #ffffff;
      }
      .yami-perf-tag {
        font-size: 11px;
        color: #b0e0e6;
        background: #084872;
        padding: 1px 6px;
        border-radius: 2px;
        border: 1px solid #101010;
      }
      .yami-perf-close-btn {
        background: transparent;
        border: none;
        color: #808080;
        font-size: 18px;
        cursor: pointer;
        padding: 0 6px;
        line-height: 24px;
        border-radius: 2px;
      }
      .yami-perf-close-btn:hover {
        background: #e81123;
        color: #ffffff;
      }
      .yami-perf-modal-body {
        padding: 12px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #202020;
      }
      .yami-perf-modal-body::-webkit-scrollbar {
        width: 6px;
      }
      .yami-perf-modal-body::-webkit-scrollbar-track {
        background: #181818;
      }
      .yami-perf-modal-body::-webkit-scrollbar-thumb {
        background: #484848;
        border-radius: 2px;
      }

      .yami-perf-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .yami-perf-card {
        background: #282828;
        border: 1px solid #181818;
        border-radius: 3px;
        padding: 8px 10px;
      }
      .yami-perf-card-label {
        font-size: 11px;
        color: #808080;
      }
      .yami-perf-card-value {
        font-size: 16px;
        font-weight: 700;
        margin-top: 3px;
        color: #ffffff;
        font-family: Consolas, Menlo, monospace;
      }

      .yami-perf-section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 5px;
      }
      .yami-perf-section-head span:first-child {
        font-size: 12px;
        font-weight: 600;
        color: #d8d8d8;
      }
      .yami-perf-section-head span:last-child {
        font-size: 11px;
        color: #808080;
      }

      .yami-perf-panel-box {
        background: #282828;
        border: 1px solid #181818;
        border-radius: 3px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .yami-perf-bar-row {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 12px;
      }
      .yami-perf-bar-head {
        display: flex;
        justify-content: space-between;
        color: #d8d8d8;
      }
      .yami-perf-bar-track {
        height: 5px;
        background: #18191a;
        border-radius: 2px;
        overflow: hidden;
        border: 1px solid #101010;
      }
      .yami-perf-bar-fill {
        height: 100%;
        background: #0080c0;
        border-radius: 2px;
      }
      .yami-perf-bar-fill.bad {
        background: #f06000;
      }

      .yami-perf-modal-footer {
        height: 38px;
        padding: 0 12px;
        background: #303030;
        border-top: 1px solid #181818;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .yami-perf-btn {
        background: #484848;
        border: 1px solid #282828;
        color: #d8d8d8;
        padding: 4px 10px;
        border-radius: 2px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.1s, border-color 0.1s;
      }
      .yami-perf-btn:hover {
        background: #505050;
        color: #ffffff;
        border-color: #383838;
      }
      .yami-perf-btn:active {
        background: #303840;
      }

      .yami-perf-toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 1000001;
        background: #282828;
        border: 1px solid #101010;
        border-left: 3px solid #1cff9b;
        color: #d8d8d8;
        padding: 6px 14px;
        border-radius: 2px;
        font-size: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
        opacity: 0;
        transform: translateY(6px);
        transition: all 0.15s ease;
        pointer-events: none;
      }
      .yami-perf-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    // 迷你 HUD 胶囊
    const hud = document.createElement('div');
    hud.id = 'yami-perf-mini-hud';
    hud.innerHTML = `
      <div class="yami-perf-capsule" id="yami-capsule" title="点击展开性能诊断台 (快捷键: Home)">
        <div class="yami-perf-badge" id="yami-badge"></div>
        <span id="yami-fps" style="font-weight: 600; color: #ffffff;">60 FPS</span>
        <span style="color: #606060;">|</span>
        <span id="yami-ms" style="color: #a0a0a0; font-family: Consolas, monospace;">16.7ms</span>
      </div>
    `;
    document.body.appendChild(hud);

    // 内置大盘 Modal
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'yami-perf-modal-overlay';
    modalOverlay.id = 'yami-perf-modal-overlay';
    modalOverlay.innerHTML = `
      <div class="yami-perf-modal">
        <div class="yami-perf-modal-header">
          <div class="yami-perf-modal-title">
            <span>⌁ YAMI 运行时性能诊断</span>
            <span class="yami-perf-tag">Home 键呼出/隐藏</span>
          </div>
          <button class="yami-perf-close-btn" id="yami-modal-close" title="关闭 (ESC)">×</button>
        </div>
        <div class="yami-perf-modal-body">
          <div class="yami-perf-grid">
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">实时 / P95 帧率</div>
              <div class="yami-perf-card-value" id="modal-val-fps" style="color: #1cff9b;">60 FPS</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">单帧计算耗时 (均值 / P99)</div>
              <div class="yami-perf-card-value" id="modal-val-compute">-- ms</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">超预算帧数 (>16.7ms)</div>
              <div class="yami-perf-card-value" id="modal-val-overbudget" style="color: #f06000;">0 帧</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">当前活动实体 (Scene.actors)</div>
              <div class="yami-perf-card-value" id="modal-val-actors">--</div>
            </div>
          </div>

          <div>
            <div class="yami-perf-section-head">
              <span>超帧定位与模块耗时排行 (卡顿元凶)</span>
              <span>按总耗时排序</span>
            </div>
            <div class="yami-perf-panel-box" id="modal-updaters-list">
              <div style="color: #808080; font-size: 12px; text-align: center; padding: 10px;">正在采集运行数据...</div>
            </div>
          </div>

          <div>
            <div class="yami-perf-section-head">
              <span>严重掉帧现场快照 (>33.3ms)</span>
              <span id="modal-jank-count">已捕获 0 次</span>
            </div>
            <div class="yami-perf-panel-box" id="modal-jank-list" style="max-height: 140px; overflow-y: auto;">
              <div style="color: #808080; font-size: 12px; text-align: center; padding: 10px;">运行平稳，暂无严重掉帧</div>
            </div>
          </div>
        </div>

        <div class="yami-perf-modal-footer">
          <div style="font-size: 11px; color: #808080;">
            提示：按 <b>Home</b> 或 <b>ESC</b> 键随时返回游戏
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="yami-perf-btn" id="modal-btn-copy">复制分析 JSON</button>
            <button class="yami-perf-btn" id="modal-btn-dl">保存报告文件</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalOverlay);

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
    let isModalOpen = false;

    function toggleModal(force) {
      isModalOpen = typeof force === 'boolean' ? force : !isModalOpen;
      modalOverlay.classList.toggle('show', isModalOpen);
      if (isModalOpen) {
        refreshModalContent();
      }
    }

    function refreshModalContent() {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!probe) return;
      const report = probe.getReport();

      const fpsEl = document.getElementById('modal-val-fps');
      const computeEl = document.getElementById('modal-val-compute');
      const overEl = document.getElementById('modal-val-overbudget');
      const actorsEl = document.getElementById('modal-val-actors');
      const updatersList = document.getElementById('modal-updaters-list');
      const jankList = document.getElementById('modal-jank-list');
      const jankCount = document.getElementById('modal-jank-count');

      if (fpsEl) fpsEl.textContent = `${(typeof Time !== 'undefined' && Time.fps) || 60} FPS`;
      if (computeEl) computeEl.textContent = `${report.compute.avg} ms (P99: ${report.compute.p99}ms)`;
      if (overEl) {
        const total = report.samples || 1;
        const count = report.compute.overBudgetCount || 0;
        const pct = ((count / total) * 100).toFixed(1);
        overEl.textContent = `${count} 帧 (${pct}%)`;
      }
      if (actorsEl) actorsEl.textContent = report.scene.actors;

      // 渲染耗时排行
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
                  <span style="color: #ffffff;">${item.name}</span>
                  <span style="font-family: Consolas, monospace; font-size: 11px; color: ${isBad ? '#f06000' : '#a0a0a0'};">
                    总计 ${item.total}ms | 均值 ${item.avg}ms | 峰值 ${item.max}ms
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

      // 渲染卡顿快照
      if (jankList && jankCount) {
        const janks = (report.overBudgetFrames || []).filter(f => f.compute > 33.3).slice(-8).reverse();
        jankCount.textContent = `已捕获 ${janks.length} 次严重掉帧`;
        if (janks.length) {
          jankList.innerHTML = janks.map(j => {
            const topMod = (j.updaters && j.updaters[0] && j.updaters[0].name) || 'Game Update';
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: #2e2020; border: 1px solid #482020; border-radius: 2px; font-size: 11px;">
                <span>⚠️ <b>帧 #${j.frame}</b> 耗时 <b style="color: #ff4040;">${j.compute}ms</b> (归因: <b>${topMod}</b>)</span>
                <span style="color: #808080; font-family: Consolas, monospace;">+${j.elapsedMs}ms</span>
              </div>
            `;
          }).join('');
        } else {
          jankList.innerHTML = '<div style="color: #808080; font-size: 12px; text-align: center; padding: 10px;">运行平稳，暂无严重掉帧</div>';
        }
      }
    }

    // 事件绑定
    document.getElementById('yami-capsule').addEventListener('click', () => toggleModal(true));
    document.getElementById('yami-modal-close').addEventListener('click', () => toggleModal(false));
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) toggleModal(false);
    });

    document.getElementById('modal-btn-copy').addEventListener('click', () => {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.copy();
        showToast('✓ 完整探针分析 JSON 已复制到剪贴板');
      }
    });

    document.getElementById('modal-btn-dl').addEventListener('click', () => {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.download();
        showToast('✓ 探针报告 JSON 文件已下载');
      }
    });

    // 快捷键 Home 开关面板，ESC 关闭
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Home' || e.code === 'Home') {
        e.preventDefault();
        toggleModal();
      } else if (e.key === 'Escape' && isModalOpen) {
        toggleModal(false);
      }
    });

    // 掉帧变红提醒
    window.addEventListener('yami-perf-jank', (e) => {
      const detail = e.detail || {};
      badge.className = 'yami-perf-badge bad';
      showToast(`⚠️ 掉帧告警: ${detail.compute}ms (${detail.culprit}) [按 Home 查看]`, 3000);
      setTimeout(() => { badge.className = 'yami-perf-badge'; }, 3000);
      if (isModalOpen) refreshModalContent();
    });

    // 胶囊实时 FPS / 耗时刷新
    setInterval(() => {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!probe || !probe.state.samples.length) return;
      const last = probe.state.samples[probe.state.samples.length - 1];
      const fps = last.fps || 60;
      const compute = last.compute || 0;

      fpsText.textContent = `${fps} FPS`;
      msText.textContent = `${compute.toFixed(1)}ms`;

      if (compute > 33.3 || fps < 35) {
        badge.className = 'yami-perf-badge bad';
      } else if (compute > 16.7 || fps < 55) {
        badge.className = 'yami-perf-badge warn';
      } else {
        badge.className = 'yami-perf-badge';
      }

      if (isModalOpen && probe.state.frameSeq % 30 === 0) {
        refreshModalContent();
      }
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHUD);
  } else {
    initHUD();
  }
})();