(() => {
  'use strict';
  if (window.__YAMI_PERF_HUD__) return;
  window.__YAMI_PERF_HUD__ = true;

  function initHUD() {
    if (!document.body) {
      requestAnimationFrame(initHUD);
      return;
    }

    // 注入样式
    const style = document.createElement('style');
    style.textContent = `
      #yami-perf-mini-hud {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
        user-select: none;
      }
      .yami-perf-capsule {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(10px);
        padding: 5px 12px;
        border-radius: 20px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .yami-perf-capsule:hover {
        transform: translateY(-1px);
        border-color: #818cf8;
        background: rgba(15, 23, 42, 0.96);
      }
      .yami-perf-badge {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
        transition: background 0.3s;
      }
      .yami-perf-badge.warn { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
      .yami-perf-badge.bad { background: #ef4444; box-shadow: 0 0 8px #ef4444; animation: yami-pulse 0.8s infinite; }
      @keyframes yami-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

      /* 内置性能大盘 Modal */
      .yami-perf-modal-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(6px);
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }
      .yami-perf-modal-overlay.show {
        opacity: 1;
        pointer-events: auto;
      }
      .yami-perf-modal {
        width: 820px;
        max-width: 92vw;
        max-height: 88vh;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
        color: #f1f5f9;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .yami-perf-modal-header {
        padding: 12px 18px;
        background: #1e293b;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .yami-perf-modal-title {
        font-size: 15px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #e2e8f0;
      }
      .yami-perf-close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .yami-perf-close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .yami-perf-modal-body {
        padding: 16px 18px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .yami-perf-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }
      .yami-perf-card {
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        padding: 10px 12px;
      }
      .yami-perf-card-label {
        font-size: 11px;
        color: #94a3b8;
      }
      .yami-perf-card-value {
        font-size: 18px;
        font-weight: 700;
        margin-top: 4px;
        font-family: monospace;
      }
      .yami-perf-section-title {
        font-size: 13px;
        font-weight: 600;
        color: #cbd5e1;
        margin: 4px 0 6px;
        display: flex;
        justify-content: space-between;
      }
      .yami-perf-section-title small {
        font-size: 11px;
        font-weight: 400;
        color: #94a3b8;
      }
      .yami-perf-list {
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .yami-perf-bar-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
      }
      .yami-perf-bar-head {
        display: flex;
        justify-content: space-between;
      }
      .yami-perf-bar-track {
        height: 6px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 3px;
        overflow: hidden;
      }
      .yami-perf-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #6366f1, #06b6d4);
        border-radius: 3px;
      }
      .yami-perf-bar-fill.bad {
        background: linear-gradient(90deg, #f59e0b, #ef4444);
      }
      .yami-perf-modal-footer {
        padding: 10px 18px;
        background: #1e293b;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .yami-perf-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #f1f5f9;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .yami-perf-btn:hover {
        background: #4f46e5;
        border-color: #6366f1;
      }
      .yami-perf-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 1000001;
        background: rgba(15, 23, 42, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #fff;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        opacity: 0;
        transform: translateY(8px);
        transition: all 0.2s;
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
      <div class="yami-perf-capsule" id="yami-capsule" title="点击展开内置性能分析台 (快捷键: Home)">
        <div class="yami-perf-badge" id="yami-badge"></div>
        <span id="yami-fps" style="font-weight: 700; font-size: 12px; color: #f8fafc;">60 FPS</span>
        <span style="color: #64748b;">|</span>
        <span id="yami-ms" style="color: #cbd5e1; font-family: monospace; font-size: 12px;">16ms</span>
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
            <span>⚡ YAMI 本地性能诊断台</span>
            <span style="font-size: 11px; font-weight: 400; color: #818cf8; background: rgba(99, 102, 241, 0.15); padding: 2px 8px; border-radius: 12px;">Home 键呼出/关闭</span>
          </div>
          <button class="yami-perf-close-btn" id="yami-modal-close" title="关闭 (ESC)">×</button>
        </div>
        <div class="yami-perf-modal-body">
          <div class="yami-perf-grid">
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">当前 / P95 帧率</div>
              <div class="yami-perf-card-value" id="modal-val-fps" style="color: #10b981;">60 FPS</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">计算耗时 (均值 / P99)</div>
              <div class="yami-perf-card-value" id="modal-val-compute">-- ms</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">超预算帧数 (>16.7ms)</div>
              <div class="yami-perf-card-value" id="modal-val-overbudget" style="color: #f59e0b;">0 帧</div>
            </div>
            <div class="yami-perf-card">
              <div class="yami-perf-card-label">当前活动实体 (Scene)</div>
              <div class="yami-perf-card-value" id="modal-val-actors">--</div>
            </div>
          </div>

          <div>
            <div class="yami-perf-section-title">
              <span>🔥 超帧定位与子系统耗时排行 (卡顿元凶)</span>
              <small>按总耗时排序</small>
            </div>
            <div class="yami-perf-list" id="modal-updaters-list">
              <div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 12px;">正在采集运行数据...</div>
            </div>
          </div>

          <div>
            <div class="yami-perf-section-title">
              <span>⚠️ 最近严重掉帧现场 (>33.3ms)</span>
              <small id="modal-jank-count">已捕获 0 次</small>
            </div>
            <div class="yami-perf-list" id="modal-jank-list" style="max-height: 160px; overflow-y: auto;">
              <div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 12px;">运行平稳，暂无严重卡顿</div>
            </div>
          </div>
        </div>

        <div class="yami-perf-modal-footer">
          <div style="font-size: 11px; color: #64748b;">
            💡 提示：按 <b>Home</b> 或 <b>ESC</b> 键随时返回游戏
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="yami-perf-btn" id="modal-btn-copy">📋 复制探针 JSON</button>
            <button class="yami-perf-btn" id="modal-btn-dl">💾 保存报告文件</button>
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

      // 渲染排行榜
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
                  <span style="font-weight: 500;">${item.name}</span>
                  <span style="font-family: monospace; color: ${isBad ? '#ef4444' : '#cbd5e1'};">
                    总计 ${item.total}ms | 均值 ${item.avg}ms | 最大 ${item.max}ms
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

      // 渲染最近卡顿帧
      if (jankList && jankCount) {
        const janks = (report.overBudgetFrames || []).filter(f => f.compute > 33.3).slice(-10).reverse();
        jankCount.textContent = `已捕获 ${janks.length} 次严重掉帧`;
        if (janks.length) {
          jankList.innerHTML = janks.map(j => {
            const topMod = (j.updaters && j.updaters[0] && j.updaters[0].name) || 'Game Update';
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 5px; font-size: 11px;">
                <span>⚠️ <b>帧 #${j.frame}</b> 耗时 <b style="color: #ef4444;">${j.compute}ms</b> (归因: <b>${topMod}</b>)</span>
                <span style="color: #94a3b8; font-family: monospace;">+${j.elapsedMs}ms</span>
              </div>
            `;
          }).join('');
        } else {
          jankList.innerHTML = '<div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 12px;">运行平稳，暂无严重卡顿</div>';
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
        showToast('📋 完整探针分析 JSON 已复制到剪贴板！');
      }
    });

    document.getElementById('modal-btn-dl').addEventListener('click', () => {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.download();
        showToast('💾 探针报告 JSON 文件已下载！');
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