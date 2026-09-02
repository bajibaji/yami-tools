(() => {
  'use strict';

  function initHUD() {
    if (document.getElementById('yami-perf-mini-hud')) return;

    const style = document.createElement('style');
    style.textContent = '#yami-perf-mini-hud { position: fixed; top: 12px; right: 12px; z-index: 999999; font-family: sans-serif; font-size: 12px; color: #e2e8f0; user-select: none; }' +
      '.yami-perf-capsule { display: flex; align-items: center; gap: 8px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 20px; padding: 5px 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35); cursor: pointer; transition: all 0.2s ease; }' +
      '.yami-perf-capsule:hover { background: rgba(30, 41, 59, 0.95); border-color: rgba(99, 102, 241, 0.5); transform: translateY(-1px); }' +
      '.yami-perf-badge { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981; }' +
      '.yami-perf-badge.warn { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }' +
      '.yami-perf-badge.bad { background: #ef4444; box-shadow: 0 0 10px #ef4444; }' +
      '.yami-perf-fps { font-weight: 700; font-family: monospace; }' +
      '.yami-perf-menu { display: none; position: absolute; top: calc(100% + 8px); right: 0; width: 220px; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 10px; padding: 8px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5); flex-direction: column; gap: 6px; }' +
      '.yami-perf-menu.show { display: flex; }' +
      '.yami-perf-menu-header { font-size: 11px; color: #94a3b8; padding: 4px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; }' +
      '.yami-perf-btn { background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; color: #f8fafc; padding: 6px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; }' +
      '.yami-perf-btn:hover { background: #4f46e5; border-color: #6366f1; }' +
      '.yami-perf-btn.accent { background: #4f46e5; font-weight: 600; }' +
      '.yami-perf-toast { position: fixed; bottom: 24px; right: 24px; background: #1e1b4b; border: 1px solid #6366f1; color: #e0e7ff; padding: 8px 16px; border-radius: 8px; font-size: 13px; box-shadow: 0 8px 20px rgba(0,0,0,0.4); z-index: 1000000; opacity: 0; transform: translateY(10px); transition: all 0.3s; pointer-events: none; }' +
      '.yami-perf-toast.show { opacity: 1; transform: translateY(0); }';
    document.head.appendChild(style);

    const hud = document.createElement('div');
    hud.id = 'yami-perf-mini-hud';
    hud.innerHTML = '<div class="yami-perf-capsule" id="yami-capsule" title="点击展开性能操作 (快捷键: F8 同步)">' +
      '<div class="yami-perf-badge" id="yami-badge"></div>' +
      '<span class="yami-perf-fps" id="yami-fps">60 FPS</span>' +
      '<span style="color: #64748b;">|</span>' +
      '<span id="yami-ms" style="color: #cbd5e1; font-family: monospace;">16ms</span>' +
      '</div>' +
      '<div class="yami-perf-menu" id="yami-menu">' +
      '<div class="yami-perf-menu-header">' +
      '<span>⚡ YAMI 性能分析桥</span><span style="color: #6366f1;">F8 快捷键</span>' +
      '</div>' +
      '<button class="yami-perf-btn accent" id="btn-sync-open">🚀 一键同步至分析台</button>' +
      '<button class="yami-perf-btn" id="btn-copy-json">📋 复制探针 JSON</button>' +
      '<button class="yami-perf-btn" id="btn-dl-json">💾 下载探针报告</button>' +
      '</div>' +
      '<div class="yami-perf-toast" id="yami-toast"></div>';
    document.body.appendChild(hud);

    const capsule = document.getElementById('yami-capsule');
    const menu = document.getElementById('yami-menu');
    const badge = document.getElementById('yami-badge');
    const fpsText = document.getElementById('yami-fps');
    const msText = document.getElementById('yami-ms');
    const toast = document.getElementById('yami-toast');

    function showToast(msg, duration) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, duration || 2000);
    }

    capsule.addEventListener('click', function(e) {
      e.stopPropagation();
      menu.classList.toggle('show');
    });

    document.addEventListener('click', function(e) {
      if (!hud.contains(e.target)) menu.classList.remove('show');
    });

    function triggerSync() {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.sendToPerfLab();
        showToast('⚡ 性能数据已发送！正在唤起分析台...');
        
        const perfLabUrl = 'http://localhost:5173/dist/tools/perf-lab/index.html';
        const fallbackUrl = 'd:/Documents/GitHub/yami-tools/dist/tools/perf-lab/index.html';
        
        const w = window.open(perfLabUrl, 'YamiPerfLabWindow') || window.open(fallbackUrl, 'YamiPerfLabWindow');
        if (w) w.focus();
      }
    }

    document.getElementById('btn-sync-open').addEventListener('click', function() {
      triggerSync();
      menu.classList.remove('show');
    });

    document.getElementById('btn-copy-json').addEventListener('click', function() {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.copy();
        showToast('📋 JSON 已复制到剪贴板！');
      }
      menu.classList.remove('show');
    });

    document.getElementById('btn-dl-json').addEventListener('click', function() {
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.download();
        showToast('💾 探针 JSON 下载完成！');
      }
      menu.classList.remove('show');
    });

    window.addEventListener('keydown', function(e) {
      if (e.key === 'F8') {
        e.preventDefault();
        triggerSync();
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
        hud.style.display = hud.style.display === 'none' ? 'block' : 'none';
      }
    });

    window.addEventListener('yami-perf-jank', function(e) {
      const detail = e.detail || {};
      badge.className = 'yami-perf-badge bad';
      showToast('⚠️ 捕获卡顿: ' + detail.compute + 'ms (' + detail.culprit + ') [按 F8 查看]', 3000);
      setTimeout(function() {
        badge.className = 'yami-perf-badge';
      }, 3000);
    });

    setInterval(function() {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!probe || !probe.state.samples.length) return;
      const last = probe.state.samples[probe.state.samples.length - 1];
      const fps = last.fps || 60;
      const compute = last.compute || 0;

      fpsText.textContent = fps + ' FPS';
      msText.textContent = compute.toFixed(1) + 'ms';

      if (compute > 33.3 || fps < 35) {
        badge.className = 'yami-perf-badge bad';
      } else if (compute > 16.7 || fps < 55) {
        badge.className = 'yami-perf-badge warn';
      } else {
        badge.className = 'yami-perf-badge';
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHUD);
  } else {
    initHUD();
  }
})();