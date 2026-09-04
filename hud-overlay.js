(() => {
  'use strict';

  // HTML 转义统一工具 (IIFE 顶层公共作用域): 游戏数据/报错信息一律先转义再进 innerHTML
  // (防 XSS 与 UI 破坏)。esc 与 escapeHtml 是同一函数的两个别名, 全文件唯一事实源。
  function esc(v) {
    return String(v == null ? '' : v)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  const escapeHtml = esc;

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
            /* 穿透模式：最高优先级物理穿透到游戏 Canvas，顶栏保留操作 */
      .yami-perf-dock.show.through {
        pointer-events: none !important;
        opacity: 0.75 !important;
      }
      .yami-perf-dock.show.through * {
        pointer-events: none !important;
      }
      .yami-perf-dock.show.through .yami-perf-dock-header,
      .yami-perf-dock.show.through .yami-perf-dock-header * {
        pointer-events: auto !important;
      }
      .yami-pin-btn {
        font-size: 11px !important;
        color: #909090 !important;
        background: #222222 !important;
        border: 1px solid #181818 !important;
        border-radius: 2px !important;
        padding: 2px 7px !important;
        cursor: pointer !important;
        user-select: none !important;
        line-height: 16px !important;
        transition: all 0.15s ease !important;
      }
      .yami-pin-btn:hover {
        color: #ffffff !important;
        background: #2c2c2c !important;
        border-color: #383838 !important;
      }
      .yami-pin-btn.active {
        color: #1cff9b !important;
        background: rgba(28, 255, 155, 0.12) !important;
        border-color: #1cff9b !important;
      }

      /* 页面容器与主控台样式 */
      .yami-suite-page {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
      }
      .yami-nav-back-btn {
        display: none;
        background: #222222 !important;
        border: 1px solid #161616 !important;
        color: #d8d8d8 !important;
        font-size: 11px !important;
        padding: 2px 8px !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        align-items: center !important;
        gap: 4px !important;
        transition: all 0.15s ease !important;
        user-select: none !important;
        line-height: 18px !important;
      }
      .yami-nav-back-btn:hover {
        background: #303030 !important;
        color: #ffffff !important;
        border-color: #0080c0 !important;
      }
      .yami-home-summary-card {
        background: #1e1e1e !important;
        border: 1px solid #141414 !important;
        border-radius: 2px !important;
        padding: 8px 12px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        font-size: 11px !important;
      }
      .yami-home-summary-item {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      .yami-dot-indicator {
        width: 7px !important;
        height: 7px !important;
        border-radius: 50% !important;
        display: inline-block !important;
      }
      .yami-dot-indicator.green {
        background: #1cff9b !important;
        box-shadow: 0 0 6px rgba(28, 255, 155, 0.4) !important;
      }
      .yami-dot-indicator.red {
        background: #ff4040 !important;
        box-shadow: 0 0 6px rgba(255, 64, 64, 0.6) !important;
        animation: yami-pulse 1s infinite !important;
      }
      .yami-home-modules {
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
      }
      .yami-home-module-item {
        background: #202020 !important;
        border: 1px solid #161616 !important;
        border-radius: 2px !important;
        padding: 10px 12px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
        user-select: none !important;
      }
      .yami-home-module-item:hover {
        background: #262626 !important;
        border-color: #383838 !important;
        transform: translateY(-1px) !important;
      }
      .yami-home-module-item.disabled {
        opacity: 0.5 !important;
        cursor: not-allowed !important;
      }
      .yami-home-module-item.disabled:hover {
        background: #202020 !important;
        border-color: #161616 !important;
        transform: none !important;
      }
      .yami-home-module-main {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
      }
      .yami-home-module-icon-box {
        width: 32px !important;
        height: 32px !important;
        background: #181818 !important;
        border: 1px solid #141414 !important;
        border-radius: 2px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex-shrink: 0 !important;
        color: #989898 !important;
        transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease !important;
      }
      .yami-home-module-item:hover .yami-home-module-icon-box {
        color: #ffffff !important;
        border-color: #282828 !important;
        background: #1a1a1a !important;
      }
      .yami-home-module-title {
        font-size: 12px !important;
        font-weight: 600 !important;
        color: #ffffff !important;
      }
      .yami-home-module-desc {
        font-size: 11px !important;
        color: #888888 !important;
        margin-top: 2px !important;
      }
      .yami-home-module-badge {
        font-size: 10px !important;
        padding: 1px 6px !important;
        border-radius: 2px !important;
        background: #2a2a2a !important;
        color: #aaaaaa !important;
        border: 1px solid #1a1a1a !important;
      }
      .yami-home-module-badge.active {
        background: rgba(0, 128, 192, 0.15) !important;
        color: #0080c0 !important;
        border-color: #0080c0 !important;
      }
      .yami-home-module-badge.danger {
        background: rgba(255, 64, 64, 0.15) !important;
        color: #ff4040 !important;
        border-color: #ff4040 !important;
        font-weight: 600 !important;
      }
      .yami-error-empty {
        background: #1c1c1c !important;
        border: 1px dashed #242424 !important;
        border-radius: 2px !important;
        padding: 36px 16px !important;
        text-align: center !important;
        color: #888888 !important;
        font-size: 12px !important;
      }
      .yami-error-card {
        background: #221c1c !important;
        border: 1px solid #3c1e1e !important;
        border-left: 3px solid #ff4040 !important;
        border-radius: 2px !important;
        padding: 8px 10px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
        font-size: 11px !important;
      }
      .yami-error-card-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
      }
      .yami-error-type {
        font-weight: 600 !important;
        color: #ff4040 !important;
        font-size: 11px !important;
      }
      .yami-error-time {
        color: #777777 !important;
        font-size: 10px !important;
        font-family: Consolas, monospace !important;
      }
      .yami-error-msg {
        background: #161212 !important;
        border: 1px solid #281414 !important;
        padding: 4px 6px !important;
        border-radius: 2px !important;
        color: #ff8888 !important;
        font-family: Consolas, monospace !important;
        font-size: 11px !important;
        word-break: break-all !important;
        line-height: 15px !important;
      }
      .yami-error-source {
        color: #1cff9b !important;
        font-family: Consolas, monospace !important;
        font-size: 10px !important;
      }
      .yami-error-box {
        background: rgba(255, 144, 96, 0.08) !important;
        border-left: 2px solid #ff9060 !important;
        padding: 4px 6px !important;
        border-radius: 2px !important;
        color: #ffb088 !important;
        line-height: 15px !important;
        font-size: 10px !important;
      }
      .yami-error-tip {
        background: rgba(0, 128, 192, 0.08) !important;
        border-left: 2px solid #0080c0 !important;
        padding: 4px 6px !important;
        border-radius: 2px !important;
        color: #88c8f0 !important;
        line-height: 15px !important;
        font-size: 10px !important;
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

      
      /* ============================================================
       * Yami 原生经典素材图标体系 (替换 Emoji，暗黑工业风)
       * ============================================================ */
      .yami-icon {
        display: inline-block !important;
        width: 14px !important;
        height: 14px !important;
        background-size: contain !important;
        background-repeat: no-repeat !important;
        background-position: center !important;
        vertical-align: middle !important;
        flex-shrink: 0 !important;
        margin-right: 5px !important;
        /* 核心反转：纯黑原图转为明亮银白 (#d8d8d8)，暗黑背景上清晰高对比 */
        filter: brightness(0) invert(0.85) !important;
        transition: filter 0.12s ease !important;
      }
      .yami-perf-tab:hover .yami-icon {
        filter: brightness(0) invert(0.95) !important;
      }
      .yami-perf-tab.active .yami-icon {
        filter: brightness(0) invert(1) !important;
      }
      .yami-icon-settings {
        background-image: url('data:image/png;base64,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/GMzLdsAADoTaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/Pgo8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjUtYzAxNCA3OS4xNTE0ODEsIDIwMTMvMDMvMTMtMTI6MDk6MTUgICAgICAgICI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOnhtcD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIKICAgICAgICAgICAgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iCiAgICAgICAgICAgIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgICAgICAgICAgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iPgogICAgICAgICA8eG1wOkNyZWF0b3JUb29sPkFkb2JlIFBob3Rvc2hvcCBDQyAoV2luZG93cyk8L3htcDpDcmVhdG9yVG9vbD4KICAgICAgICAgPHhtcDpDcmVhdGVEYXRlPjIwMjEtMTAtMTdUMjI6Mzk6MDgrMDg6MDA8L3htcDpDcmVhdGVEYXRlPgogICAgICAgICA8eG1wOk1ldGFkYXRhRGF0ZT4yMDIxLTEwLTE3VDIyOjM5OjA4KzA4OjAwPC94bXA6TWV0YWRhdGFEYXRlPgogICAgICAgICA8eG1wOk1vZGlmeURhdGU+MjAyMS0xMC0xN1QyMjozOTowOCswODowMDwveG1wOk1vZGlmeURhdGU+CiAgICAgICAgIDx4bXBNTTpJbnN0YW5jZUlEPnhtcC5paWQ6NzE3Mzg4ODYtOWJjYS00ZTQwLWE3MDUtMTc4Mjc2NzJkNTNkPC94bXBNTTpJbnN0YW5jZUlEPgogICAgICAgICA8eG1wTU06RG9jdW1lbnRJRD54bXAuZGlkOjRkMWJhZTMzLTkzOWEtZWI0Ni1hOTdjLWZkNTA3Yzk2YjE5MjwveG1wTU06RG9jdW1lbnRJRD4KICAgICAgICAgPHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD54bXAuZGlkOjRkMWJhZTMzLTkzOWEtZWI0Ni1hOTdjLWZkNTA3Yzk2YjE5MjwveG1wTU06T3JpZ2luYWxEb2N1bWVudElEPgogICAgICAgICA8eG1wTU06SGlzdG9yeT4KICAgICAgICAgICAgPHJkZjpTZXE+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6YWN0aW9uPmNyZWF0ZWQ8L3N0RXZ0OmFjdGlvbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0Omluc3RhbmNlSUQ+eG1wLmlpZDo0ZDFiYWUzMy05MzlhLWViNDYtYTk3Yy1mZDUwN2M5NmIxOTI8L3N0RXZ0Omluc3RhbmNlSUQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDp3aGVuPjIwMjEtMTAtMTdUMjI6Mzk6MDgrMDg6MDA8L3N0RXZ0OndoZW4+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpzb2Z0d2FyZUFnZW50PkFkb2JlIFBob3Rvc2hvcCBDQyAoV2luZG93cyk8L3N0RXZ0OnNvZnR3YXJlQWdlbnQ+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmFjdGlvbj5zYXZlZDwvc3RFdnQ6YWN0aW9uPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6aW5zdGFuY2VJRD54bXAuaWlkOjcxNzM4ODg2LTliY2EtNGU0MC1hNzA1LTE3ODI3NjcyZDUzZDwvc3RFdnQ6aW5zdGFuY2VJRD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OndoZW4+MjAyMS0xMC0xN1QyMjozOTowOCswODowMDwvc3RFdnQ6d2hlbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OnNvZnR3YXJlQWdlbnQ+QWRvYmUgUGhvdG9zaG9wIENDIChXaW5kb3dzKTwvc3RFdnQ6c29mdHdhcmVBZ2VudD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmNoYW5nZWQ+Lzwvc3RFdnQ6Y2hhbmdlZD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAgPC94bXBNTTpIaXN0b3J5PgogICAgICAgICA8ZGM6Zm9ybWF0PmltYWdlL3BuZzwvZGM6Zm9ybWF0PgogICAgICAgICA8cGhvdG9zaG9wOkNvbG9yTW9kZT4zPC9waG90b3Nob3A6Q29sb3JNb2RlPgogICAgICAgICA8cGhvdG9zaG9wOklDQ1Byb2ZpbGU+c1JHQiBJRUM2MTk2Ni0yLjE8L3Bob3Rvc2hvcDpJQ0NQcm9maWxlPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICAgICA8dGlmZjpYUmVzb2x1dGlvbj43MjAwMDAvMTAwMDA8L3RpZmY6WFJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjcyMDAwMC8xMDAwMDwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6UmVzb2x1dGlvblVuaXQ+MjwvdGlmZjpSZXNvbHV0aW9uVW5pdD4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT4xPC9leGlmOkNvbG9yU3BhY2U+CiAgICAgICAgIDxleGlmOlBpeGVsWERpbWVuc2lvbj4zMjwvZXhpZjpQaXhlbFhEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOlBpeGVsWURpbWVuc2lvbj4zMjwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+MLpvnAAAACBjSFJNAAB6JQAAgIMAAPn/AACA6QAAdTAAAOpgAAA6mAAAF2+SX8VGAAAAj0lEQVR42uyWwQ7AIAhD6bL//+XuZOLBCdMQEcdVIVrwWZCUlXHJ4ri1DQDeJIKIyKyCcRRo3BSWAh2FukES4WYAgzWQ+xWUXjV6fw4HcpMQGsk0BUr+KDHjKDBKtIoD/LKeioRTxIzPAe8/IT4HzIWMvNh3Bry8YWhP6OoNU5LwcA5s64j+AzwAAAD//wMA5fk0Up6HhToAAAAASUVORK5CYII=') !important;
      }
      .yami-icon-cube {
        background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAA7EAAAOxAGVKw4bAAA7g2lUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS41LWMwMTQgNzkuMTUxNDgxLCAyMDEzLzAzLzEzLTEyOjA5OjE1ICAgICAgICAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgICAgICAgICAgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIgogICAgICAgICAgICB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIKICAgICAgICAgICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIKICAgICAgICAgICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPHhtcDpDcmVhdG9yVG9vbD5BZG9iZSBQaG90b3Nob3AgQ0MgKFdpbmRvd3MpPC94bXA6Q3JlYXRvclRvb2w+CiAgICAgICAgIDx4bXA6Q3JlYXRlRGF0ZT4yMDIyLTA5LTE2VDEyOjQ1OjM5KzA4OjAwPC94bXA6Q3JlYXRlRGF0ZT4KICAgICAgICAgPHhtcDpNb2RpZnlEYXRlPjIwMjItMDktMTZUMjE6MjA6MDUrMDg6MDA8L3htcDpNb2RpZnlEYXRlPgogICAgICAgICA8eG1wOk1ldGFkYXRhRGF0ZT4yMDIyLTA5LTE2VDIxOjIwOjA1KzA4OjAwPC94bXA6TWV0YWRhdGFEYXRlPgogICAgICAgICA8ZGM6Zm9ybWF0PmltYWdlL3BuZzwvZGM6Zm9ybWF0PgogICAgICAgICA8cGhvdG9zaG9wOkNvbG9yTW9kZT4zPC9waG90b3Nob3A6Q29sb3JNb2RlPgogICAgICAgICA8eG1wTU06SW5zdGFuY2VJRD54bXAuaWlkOmYyN2Q0MzU4LWJjMjgtZDI0Yi1iNGE0LWE3N2Y2MWI5ODJiNTwveG1wTU06SW5zdGFuY2VJRD4KICAgICAgICAgPHhtcE1NOkRvY3VtZW50SUQ+eG1wLmRpZDo3OWJiNTZmMS1mMTJkLWVmNDctYjRjMC1lZWEwYTM1ODgzOTg8L3htcE1NOkRvY3VtZW50SUQ+CiAgICAgICAgIDx4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ+eG1wLmRpZDo3OWJiNTZmMS1mMTJkLWVmNDctYjRjMC1lZWEwYTM1ODgzOTg8L3htcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD4KICAgICAgICAgPHhtcE1NOkhpc3Rvcnk+CiAgICAgICAgICAgIDxyZGY6U2VxPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmFjdGlvbj5jcmVhdGVkPC9zdEV2dDphY3Rpb24+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDppbnN0YW5jZUlEPnhtcC5paWQ6NzliYjU2ZjEtZjEyZC1lZjQ3LWI0YzAtZWVhMGEzNTg4Mzk4PC9zdEV2dDppbnN0YW5jZUlEPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6d2hlbj4yMDIyLTA5LTE2VDEyOjQ1OjM5KzA4OjAwPC9zdEV2dDp3aGVuPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6c29mdHdhcmVBZ2VudD5BZG9iZSBQaG90b3Nob3AgQ0MgKFdpbmRvd3MpPC9zdEV2dDpzb2Z0d2FyZUFnZW50PgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDphY3Rpb24+c2F2ZWQ8L3N0RXZ0OmFjdGlvbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0Omluc3RhbmNlSUQ+eG1wLmlpZDowZmNiNjIzZC1iZGU2LTk1NGMtOTZlZS0xZTU3MDVlYjRhNDY8L3N0RXZ0Omluc3RhbmNlSUQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDp3aGVuPjIwMjItMDktMTZUMTM6MjcrMDg6MDA8L3N0RXZ0OndoZW4+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpzb2Z0d2FyZUFnZW50PkFkb2JlIFBob3Rvc2hvcCBDQyAoV2luZG93cyk8L3N0RXZ0OnNvZnR3YXJlQWdlbnQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpjaGFuZ2VkPi88L3N0RXZ0OmNoYW5nZWQ+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmFjdGlvbj5zYXZlZDwvc3RFdnQ6YWN0aW9uPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6aW5zdGFuY2VJRD54bXAuaWlkOmYyN2Q0MzU4LWJjMjgtZDI0Yi1iNGE0LWE3N2Y2MWI5ODJiNTwvc3RFdnQ6aW5zdGFuY2VJRD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OndoZW4+MjAyMi0wOS0xNlQyMToyMDowNSswODowMDwvc3RFdnQ6d2hlbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OnNvZnR3YXJlQWdlbnQ+QWRvYmUgUGhvdG9zaG9wIENDIChXaW5kb3dzKTwvc3RFdnQ6c29mdHdhcmVBZ2VudD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmNoYW5nZWQ+Lzwvc3RFdnQ6Y2hhbmdlZD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAgPC94bXBNTTpIaXN0b3J5PgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICAgICA8dGlmZjpYUmVzb2x1dGlvbj45NjAwMDAvMTAwMDA8L3RpZmY6WFJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjk2MDAwMC8xMDAwMDwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6UmVzb2x1dGlvblVuaXQ+MjwvdGlmZjpSZXNvbHV0aW9uVW5pdD4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT42NTUzNTwvZXhpZjpDb2xvclNwYWNlPgogICAgICAgICA8ZXhpZjpQaXhlbFhEaW1lbnNpb24+MjU2PC9leGlmOlBpeGVsWERpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjI1NjwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+TC/N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') !important;
      }
      .yami-icon-scene {
        background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAA7EAAAOxAGVKw4bAAA50WlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS41LWMwMTQgNzkuMTUxNDgxLCAyMDEzLzAzLzEzLTEyOjA5OjE1ICAgICAgICAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgICAgICAgICAgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIgogICAgICAgICAgICB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIKICAgICAgICAgICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIKICAgICAgICAgICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPHhtcDpDcmVhdG9yVG9vbD5BZG9iZSBQaG90b3Nob3AgQ0MgKFdpbmRvd3MpPC94bXA6Q3JlYXRvclRvb2w+CiAgICAgICAgIDx4bXA6Q3JlYXRlRGF0ZT4yMDIyLTA5LTE2VDAyOjA4OjM4KzA4OjAwPC94bXA6Q3JlYXRlRGF0ZT4KICAgICAgICAgPHhtcDpNb2RpZnlEYXRlPjIwMjItMDktMTZUMjE6NDk6MzErMDg6MDA8L3htcDpNb2RpZnlEYXRlPgogICAgICAgICA8eG1wOk1ldGFkYXRhRGF0ZT4yMDIyLTA5LTE2VDIxOjQ5OjMxKzA4OjAwPC94bXA6TWV0YWRhdGFEYXRlPgogICAgICAgICA8ZGM6Zm9ybWF0PmltYWdlL3BuZzwvZGM6Zm9ybWF0PgogICAgICAgICA8cGhvdG9zaG9wOkNvbG9yTW9kZT4zPC9waG90b3Nob3A6Q29sb3JNb2RlPgogICAgICAgICA8eG1wTU06SW5zdGFuY2VJRD54bXAuaWlkOmI2ZGFmYWU4LTJiNWItMDU0Ny05NDIwLTgyZGRjYTY5MGU0ZTwveG1wTU06SW5zdGFuY2VJRD4KICAgICAgICAgPHhtcE1NOkRvY3VtZW50SUQ+eG1wLmRpZDpkNTEwMTZmOS05Yjk3LTliNGMtYTgyMS1iODJhZDM3NGY5NzQ8L3htcE1NOkRvY3VtZW50SUQ+CiAgICAgICAgIDx4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ+eG1wLmRpZDpkNTEwMTZmOS05Yjk3LTliNGMtYTgyMS1iODJhZDM3NGY5NzQ8L3htcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD4KICAgICAgICAgPHhtcE1NOkhpc3Rvcnk+CiAgICAgICAgICAgIDxyZGY6U2VxPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmFjdGlvbj5jcmVhdGVkPC9zdEV2dDphY3Rpb24+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDppbnN0YW5jZUlEPnhtcC5paWQ6ZDUxMDE2ZjktOWI5Ny05YjRjLWE4MjEtYjgyYWQzNzRmOTc0PC9zdEV2dDppbnN0YW5jZUlEPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6d2hlbj4yMDIyLTA5LTE2VDAyOjA4OjM4KzA4OjAwPC9zdEV2dDp3aGVuPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6c29mdHdhcmVBZ2VudD5BZG9iZSBQaG90b3Nob3AgQ0MgKFdpbmRvd3MpPC9zdEV2dDpzb2Z0d2FyZUFnZW50PgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDphY3Rpb24+c2F2ZWQ8L3N0RXZ0OmFjdGlvbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0Omluc3RhbmNlSUQ+eG1wLmlpZDpiNmRhZmFlOC0yYjViLTA1NDctOTQyMC04MmRkY2E2OTBlNGU8L3N0RXZ0Omluc3RhbmNlSUQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDp3aGVuPjIwMjItMDktMTZUMjE6NDk6MzErMDg6MDA8L3N0RXZ0OndoZW4+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpzb2Z0d2FyZUFnZW50PkFkb2JlIFBob3Rvc2hvcCBDQyAoV2luZG93cyk8L3N0RXZ0OnNvZnR3YXJlQWdlbnQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpjaGFuZ2VkPi88L3N0RXZ0OmNoYW5nZWQ+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICA8L3JkZjpTZXE+CiAgICAgICAgIDwveG1wTU06SGlzdG9yeT4KICAgICAgICAgPHRpZmY6T3JpZW50YXRpb24+MTwvdGlmZjpPcmllbnRhdGlvbj4KICAgICAgICAgPHRpZmY6WFJlc29sdXRpb24+OTYwMDAwLzEwMDAwPC90aWZmOlhSZXNvbHV0aW9uPgogICAgICAgICA8dGlmZjpZUmVzb2x1dGlvbj45NjAwMDAvMTAwMDA8L3RpZmY6WVJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOlJlc29sdXRpb25Vbml0PjI8L3RpZmY6UmVzb2x1dGlvblVuaXQ+CiAgICAgICAgIDxleGlmOkNvbG9yU3BhY2U+NjU1MzU8L2V4aWY6Q29sb3JTcGFjZT4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjI1NjwvZXhpZjpQaXhlbFhEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOlBpeGVsWURpbWVuc2lvbj4yNTY8L2V4aWY6UGl4ZWxZRGltZW5zaW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAKPD94cGFja2V0IGVuZD0idyI/Pr/bWAsAAAAgY0hSTQAAeiUAAICDAAD5/wAAgOkAAHUwAADqYAAAOpgAABdvkl/FRgAAIn9JREFUeNrsnWtwXNWV78+j+3S3+qXWw7Ijv8DymHHjKSNjYYQBR1e2QREghJGNH7IwjoZrXHNJ8cWFFcLEqasPSiVUKYW5FLLnIhhKUxhhZCJuZEWYhKlbNo/UONw4BaEcnJrYWNiWX3r22fdD2kz3OrvVp1v92Kf7/6vqD31qS73XPmv/99pr77OPzBiTAAD5iYImAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAAAACAACAAAAAIAAAAAgAABAAAEDeYhO5crIs4w6lF3ajqdEUaWxkxiAAIO2dmKuh0/2doihXJUnSdV1n8com+RtAcGSR1QkRwH8RCARWj46O1oRCoXtlWZ4/MTFRYaYJE+zQchICIEmSJGma9gVj7CtVVY+5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') !important;
      }
      .yami-icon-event {
        background-image: url('data:image/png;base64,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') !important;
      }

      /* 标签导航栏：强制独立 flex 布局，免疫任何外部污染 */
      .yami-perf-tabs {
        display: none !important;
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

      
      /* ============================================================
       * 双模系统 (普通小白体检模式 vs 极客专业调试模式)
       * ============================================================ */
      .yami-mode-switch {
        display: flex !important;
        background: #181818 !important;
        border: 1px solid #141414 !important;
        border-radius: 12px !important;
        padding: 2px !important;
        gap: 2px !important;
        user-select: none !important;
      }
      .yami-mode-btn {
        padding: 2px 9px !important;
        font-size: 10px !important;
        font-weight: 500 !important;
        border-radius: 10px !important;
        cursor: pointer !important;
        color: #888888 !important;
        transition: all 0.15s ease !important;
        line-height: 16px !important;
      }
      .yami-mode-btn:hover {
        color: #ffffff !important;
      }
      .yami-mode-btn.active {
        background: #0080c0 !important; /* 恢复原版专业高亮蓝 */
        color: #ffffff !important;
        font-weight: 600 !important;
        box-shadow: 0 1px 4px rgba(0, 128, 192, 0.4) !important;
      }

      /* 普通体检模式看板 */
      .yami-simple-view {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
      }
      .yami-health-banner {
        background: #202020 !important;
        border: 1px solid #181818 !important;
        border-radius: 3px !important;
        padding: 10px 12px !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
      }
      .yami-health-score-circle {
        width: 52px !important;
        height: 52px !important;
        border-radius: 50% !important;
        border: 3px solid #1cff9b !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: Consolas, monospace !important;
        font-size: 17px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
        flex-shrink: 0 !important;
        box-shadow: 0 0 10px rgba(28, 255, 155, 0.25) !important;
      }
      .yami-health-score-circle.warn {
        border-color: #f06000 !important;
        box-shadow: 0 0 10px rgba(240, 96, 0, 0.25) !important;
      }
      .yami-health-score-circle.bad {
        border-color: #ff4040 !important;
        box-shadow: 0 0 12px rgba(255, 64, 64, 0.4) !important;
        animation: yami-pulse 1s infinite !important;
      }
      .yami-health-info {
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
        flex: 1 !important;
      }
      .yami-health-title {
        font-size: 13px !important;
        font-weight: 600 !important;
        color: #ffffff !important;
      }
      .yami-health-desc {
        font-size: 11px !important;
        color: #888888 !important;
        line-height: 15px !important;
      }
      .yami-health-chips {
        display: flex !important;
        gap: 5px !important;
        margin-top: 3px !important;
        flex-wrap: wrap !important;
      }
      .yami-health-chip {
        background: #181818 !important;
        border: 1px solid #121212 !important;
        padding: 1px 6px !important;
        border-radius: 2px !important;
        font-size: 10px !important;
        font-family: Consolas, monospace !important;
        color: #b0b0b0 !important;
      }

      /* 真凶定位卡片 */
      .yami-culprit-card {
        background: #252020 !important;
        border: 1px solid #4a2222 !important;
        border-left: 3px solid #ff4040 !important;
        border-radius: 2px !important;
        padding: 8px 10px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 5px !important;
        font-size: 11px !important;
      }
      .yami-culprit-card.warn {
        background: #252320 !important;
        border-color: #4a3622 !important;
        border-left-color: #f06000 !important;
      }
      .yami-culprit-head {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        font-weight: 600 !important;
        color: #ffffff !important;
      }
      .yami-culprit-file-box {
        background: #181818 !important;
        border: 1px solid #141414 !important;
        border-radius: 2px !important;
        padding: 4px 6px !important;
        font-family: Consolas, monospace !important;
        font-size: 11px !important;
        color: #1cff9b !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        user-select: text !important;
      }
      .yami-culprit-copy-btn {
        background: #303030 !important;
        color: #d8d8d8 !important;
        border: none !important;
        padding: 2px 6px !important;
        font-size: 10px !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        position: static !important;
        user-select: none !important;
      }
      .yami-culprit-copy-btn:hover {
        background: #0080c0 !important;
        color: #ffffff !important;
      }
      .yami-culprit-reason {
        color: #a0a0a0 !important;
        line-height: 15px !important;
      }
      .yami-culprit-tip {
        color: #ff9060 !important;
        background: rgba(255, 144, 96, 0.08) !important;
        padding: 4px 6px !important;
        border-radius: 2px !important;
        line-height: 15px !important;
      }

      /* 快速测试排查组 */
      .yami-quick-toggles {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 6px !important;
      }
      .yami-quick-btn {
        background: #222222 !important;
        border: 1px solid #181818 !important;
        padding: 7px 8px !important;
        border-radius: 2px !important;
        font-size: 11px !important;
        color: #a0a0a0 !important;
        cursor: pointer !important;
        text-align: center !important;
        transition: all 0.12s ease !important;
      }
      .yami-quick-btn:hover {
        background: #282828 !important;
        color: #ffffff !important;
      }
      .yami-quick-btn.active {
        background: #402020 !important;
        border-color: #702828 !important;
        color: #ff6060 !important;
        font-weight: 600 !important;
      }

      
      /* 自动更新提示条 */
      .yami-update-banner {
        display: none !important;
        background: linear-gradient(90deg, #182838, #203040) !important;
        border: 1px solid #0080c0 !important;
        border-radius: 3px !important;
        padding: 8px 12px !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 10px !important;
        animation: yami-pulse 2s infinite !important;
        font-size: 11px !important;
        box-sizing: border-box !important;
      }
      .yami-update-banner.show {
        display: flex !important;
      }
      .yami-update-btn {
        background: #0080c0 !important;
        color: #ffffff !important;
        border: none !important;
        padding: 0 10px !important;
        height: 26px !important;
        line-height: 26px !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        font-size: 11px !important;
        position: static !important;
        user-select: none !important;
        white-space: nowrap !important;
        flex-shrink: 0 !important;
        min-width: 86px !important;
        text-align: center !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        transition: all 0.15s ease !important;
      }
      .yami-update-btn:hover {
        background: #00a0f0 !important;
      }
      .yami-update-btn[disabled],
      .yami-update-btn.disabled {
        background: #384858 !important;
        color: #b0c0d0 !important;
        cursor: not-allowed !important;
        opacity: 0.8 !important;
        pointer-events: none !important;
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

      /* 嫌疑开关 (A/B 实验) */
      .yami-perf-sus-row { display: flex !important; flex-wrap: wrap !important; gap: 5px !important; align-items: center !important; }
      .yami-perf-sus-pill {
        display: inline-block !important; padding: 3px 10px !important; border-radius: 10px !important;
        font-size: 11px !important; cursor: pointer !important; border: 1px solid #333333 !important;
        background: #262626 !important; color: #707070 !important; user-select: none !important;
        position: static !important; width: auto !important; height: auto !important;
      }
      .yami-perf-sus-pill:hover { background: #303030 !important; color: #d8d8d8 !important; }
      .yami-perf-sus-pill.on { background: #3a2410 !important; color: #ffb060 !important; border-color: #7a4a20 !important; }

      /* 卡顿详情面板 */
      .yami-perf-jank-item { cursor: pointer !important; }
      .yami-perf-jank-item:hover { border-color: #f06000 !important; background: #38241c !important; }
      .yami-perf-jank-detail { display: none !important; margin-top: 6px !important; background: #1c1c1c !important; border: 1px solid #2e2e2e !important; border-radius: 3px !important; padding: 8px !important; font-size: 11px !important; }
      .yami-perf-jank-detail.show { display: block !important; }
      .yami-perf-wave { width: 100% !important; height: 64px !important; background: #141414 !important; border: 1px solid #262626 !important; border-radius: 2px !important; display: block !important; }
      .yami-perf-objrow { display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 2px 6px !important; border-radius: 2px !important; }
      .yami-perf-objrow:nth-child(odd) { background: rgba(255,255,255,0.03) !important; }
      .yami-perf-kind { color: #909090 !important; margin-right: 6px !important; font-size: 10px !important; }

      /* 胶囊异常红光抖动动画 */
      .yami-perf-capsule.shake {
        animation: yami-capsule-shake 0.5s ease-in-out !important;
        border-color: #ff4d4f !important;
        box-shadow: 0 0 10px rgba(255, 77, 79, 0.6) !important;
      }
      @keyframes yami-capsule-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-4px); }
        40%, 80% { transform: translateX(4px); }
      }

      /* 胶囊正下方轻量报错弹窗气泡 */
      .yami-error-bubble {
        display: none !important;
        margin-top: 6px !important;
        background: #231515 !important;
        border: 1px solid #752828 !important;
        border-radius: 3px !important;
        padding: 6px 10px !important;
        color: #ff9b9b !important;
        font-size: 11px !important;
        line-height: 1.4 !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.75) !important;
        cursor: pointer !important;
        max-width: 260px !important;
        min-width: 180px !important;
        transition: opacity 0.2s, transform 0.2s !important;
        transform: translateY(-4px) !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .yami-error-bubble.show {
        display: block !important;
        transform: translateY(0) !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      .yami-error-bubble:hover {
        background: #321c1c !important;
        border-color: #ff4d4f !important;
        color: #ffffff !important;
      }


      /* ============================================================
         DanJuan妙妙插件 · 存档管理 (Save Lab) 模块样式 (ui-ux-pro-max)
         ============================================================ */
      .yami-save-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        height: 100%;
        box-sizing: border-box;
        overflow-y: auto;
      }

      /* 槽位选择条 */
      .yami-save-slots-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 2px;
      }
      .yami-save-slots-wrap::-webkit-scrollbar {
        height: 3px;
      }
      .yami-save-slots-wrap::-webkit-scrollbar-thumb {
        background: #333333;
        border-radius: 2px;
      }
      .yami-save-slot-btn {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #1e1e1e;
        border: 1px solid #303030;
        border-radius: 4px;
        padding: 5px 10px;
        color: #aaaaaa;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
      }
      .yami-save-slot-btn:hover {
        background: #282828;
        color: #ffffff;
        border-color: #444444;
      }
      .yami-save-slot-btn.active {
        background: #102436;
        border-color: #0080c0;
        color: #38bdf8;
        font-weight: 600;
      }
      .yami-save-slot-time {
        font-size: 10px;
        color: #666666;
      }
      .yami-save-slot-btn.active .yami-save-slot-time {
        color: #0284c7;
      }

      /* 便当盒概览卡片 (Bento Grid) */
      .yami-save-bento {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        background: #181818;
        border: 1px solid #282828;
        border-radius: 6px;
        padding: 10px;
      }
      .yami-save-bento-cell {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .yami-save-bento-label {
        font-size: 10px;
        color: #707070;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .yami-save-bento-value {
        font-size: 13px;
        font-weight: 600;
        color: #e2e8f0;
        font-family: Consolas, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .yami-save-bento-value.highlight {
        color: #fbbf24;
      }
      .yami-save-bento-value.blue {
        color: #38bdf8;
      }

      /* 子模式导航 Tabs */
      .yami-save-subnav {
        display: flex;
        background: #161616;
        border-radius: 4px;
        padding: 2px;
        border: 1px solid #282828;
        gap: 2px;
      }
      .yami-save-subnav-btn {
        flex: 1;
        text-align: center;
        padding: 6px 0;
        font-size: 11px;
        color: #888888;
        cursor: pointer;
        border-radius: 3px;
        transition: all 0.12s ease;
        user-select: none;
      }
      .yami-save-subnav-btn:hover {
        color: #ffffff;
        background: #202020;
      }
      .yami-save-subnav-btn.active {
        color: #ffffff;
        background: #2a2a2a;
        font-weight: 600;
        box-shadow: 0 1px 3px rgba(0,0,0,0.5);
      }

      /* 面板容器 */
      .yami-save-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* 常用速改表单 */
      .yami-save-section-card {
        background: #1a1a1a;
        border: 1px solid #282828;
        border-radius: 5px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .yami-save-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        font-weight: 600;
        color: #cccccc;
        border-bottom: 1px solid #222222;
        padding-bottom: 6px;
      }
      .yami-save-form-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .yami-save-form-label {
        font-size: 12px;
        color: #999999;
        min-width: 70px;
      }
      .yami-save-input-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        justify-content: flex-end;
      }
      .yami-save-input {
        background: #111111;
        border: 1px solid #333333;
        border-radius: 3px;
        color: #ffffff;
        padding: 4px 8px;
        font-size: 12px;
        font-family: Consolas, monospace;
        width: 90px;
        text-align: right;
        box-sizing: border-box;
      }
      .yami-save-input:focus {
        border-color: #0080c0;
        outline: none;
      }
      .yami-save-mini-btn {
        background: #252525;
        border: 1px solid #3a3a3a;
        border-radius: 3px;
        color: #cccccc;
        font-size: 10px;
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.12s;
        white-space: nowrap;
        user-select: none;
      }
      .yami-save-mini-btn:hover {
        background: #333333;
        color: #ffffff;
        border-color: #555555;
      }
      .yami-save-mini-btn.primary {
        background: #0f3d5c;
        border-color: #0080c0;
        color: #38bdf8;
      }
      .yami-save-mini-btn.primary:hover {
        background: #155580;
        color: #ffffff;
      }

      /* 变量与开关搜索及列表 */
      .yami-save-search-input {
        width: 100%;
        background: #121212;
        border: 1px solid #2e2e2e;
        border-radius: 4px;
        color: #e0e0e0;
        font-size: 11px;
        padding: 6px 10px;
        box-sizing: border-box;
      }
      .yami-save-search-input:focus {
        border-color: #0080c0;
        outline: none;
      }
      .yami-save-vars-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 280px;
        overflow-y: auto;
        padding-right: 4px;
      }
      .yami-save-vars-list::-webkit-scrollbar {
        width: 4px;
      }
      .yami-save-vars-list::-webkit-scrollbar-thumb {
        background: #333333;
        border-radius: 2px;
      }
      .yami-save-var-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #1a1a1a;
        border: 1px solid #262626;
        border-radius: 4px;
        padding: 6px 8px;
        font-size: 11px;
        gap: 8px;
      }
      .yami-save-var-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow: hidden;
        flex: 1;
      }
      .yami-save-var-name {
        color: #d1d5db;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .yami-save-var-id {
        font-size: 9px;
        color: #64748b;
        font-family: Consolas, monospace;
      }

      /* 现代开关 Toggle */
      .yami-save-toggle {
        position: relative;
        display: inline-block;
        width: 32px;
        height: 18px;
        flex-shrink: 0;
      }
      .yami-save-toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .yami-save-toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: #333333;
        border-radius: 18px;
        transition: .2s;
      }
      .yami-save-toggle-slider:before {
        position: absolute;
        content: "";
        height: 12px;
        width: 12px;
        left: 3px;
        bottom: 3px;
        background-color: #ffffff;
        border-radius: 50%;
        transition: .2s;
      }
      .yami-save-toggle input:checked + .yami-save-toggle-slider {
        background-color: #0080c0;
      }
      .yami-save-toggle input:checked + .yami-save-toggle-slider:before {
        transform: translateX(14px);
      }

      /* JSON 树形检视区 */
      .yami-save-tree-box {
        background: #111111;
        border: 1px solid #242424;
        border-radius: 4px;
        padding: 8px;
        max-height: 320px;
        overflow: auto;
        font-family: Consolas, monospace;
        font-size: 11px;
        color: #cccccc;
      }
      .yami-save-tree-node {
        margin-left: 12px;
        line-height: 1.6;
      }
      .yami-save-tree-key {
        color: #38bdf8;
      }
      .yami-save-tree-val-str { color: #a3e635; }
      .yami-save-tree-val-num { color: #fbbf24; }
      .yami-save-tree-val-bool { color: #f472b6; }
      .yami-save-tree-val-null { color: #94a3b8; }
      .yami-save-tree-annotate {
        color: #f97316;
        margin-left: 6px;
        font-size: 10px;
        font-style: italic;
      }

      /* 底部保存与回滚动作条 */
      .yami-save-footer-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid #242424;
        margin-top: auto;
      }
      .yami-save-act-btn {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 12px;
        font-size: 11px;
        font-weight: 500;
        border-radius: 4px;
        cursor: pointer;
        user-select: none;
        transition: all 0.15s ease;
      }
      .yami-save-act-btn.default {
        background: #202020;
        border: 1px solid #333333;
        color: #cccccc;
      }
      .yami-save-act-btn.default:hover {
        background: #2b2b2b;
        color: #ffffff;
      }
      .yami-save-act-btn.primary {
        background: #0080c0;
        border: 1px solid #0099e6;
        color: #ffffff;
        font-weight: 600;
        box-shadow: 0 2px 6px rgba(0, 128, 192, 0.4);
      }
      .yami-save-act-btn.primary:hover {
        background: #0094de;
        box-shadow: 0 3px 8px rgba(0, 128, 192, 0.6);
      }


      /* ============================================================
         Open Yami 官方深色系统色彩对齐 (SSOT: Project/css/foundation.css)
         ============================================================ */

      /* 1. 外壳与顶栏 */
      .yami-perf-dock {
        background: #282828 !important; /* --nav-bar-background: #282828 */
        border: 1px solid #181818 !important;
        color: #d8d8d8 !important; /* --text-color: #d8d8d8 */
      }
      .yami-perf-dock-header {
        background: #202020 !important; /* --title-background: #202020 */
        border-bottom: 1px solid #181818 !important;
      }
      .yami-dock-title-text {
        color: #ffffff !important; /* --text-color-active: #ffffff */
        font-weight: 600 !important;
      }
      .yami-dock-btn {
        background: #383838 !important; /* --fieldset-background: #383838 */
        border: 1px solid #242424 !important;
        color: #d8d8d8 !important;
      }
      .yami-dock-btn:hover {
        background: #484848 !important; /* --button-background-hover: #505050 */
        color: #ffffff !important;
      }

      /* 2. 主页卡片与状态条 */
      .yami-home-status-card {
        background: #343434 !important;
        border: 1px solid #202020 !important;
      }
      .yami-home-subtitle {
        color: #a0a0a0 !important; /* --recent-card-stat-color: #a0a0a0 */
      }
      .yami-home-module-item {
        background: #383838 !important; /* --summary-background: #383838 */
        border: 1px solid #242424 !important;
        border-radius: 3px !important;
      }
      .yami-home-module-item:hover {
        background: #404040 !important; /* --summary-background-hover: #404040 */
        border-color: #181818 !important;
      }
      .yami-home-module-title {
        color: #ffffff !important; /* --text-color-active: #ffffff */
        font-weight: 600 !important;
      }
      .yami-home-module-desc {
        color: #a0a0a0 !important; /* --recent-card-stat-color: #a0a0a0 */
      }

      /* 3. 主页卡片徽章与图标色彩 (蓝、绿、黄、灰、红) */
      /* 模块 1: 性能分析 (蓝色) */
      .yami-home-module-icon-box {
        color: #38bdf8 !important;
      }
      .yami-home-module-badge.active {
        background: #102e47 !important;
        border: 1px solid #084872 !important; /* --selected-background: #084872 */
        color: #38bdf8 !important;
        font-weight: 600 !important;
      }

      /* 模块 2: 控制台报错 (绿色进入) */
      .yami-home-module-icon-box.green {
        color: #4ade80 !important;
      }
      .yami-home-module-badge.green {
        background: #143823 !important;
        border: 1px solid #1e6b45 !important;
        color: #4ade80 !important;
        font-weight: 600 !important;
      }
      .yami-home-module-badge.green:hover {
        background: #1b4d30 !important;
        color: #ffffff !important;
      }

      /* 模块 3: 存档管理 (黄色进入) */
      .yami-home-module-icon-box.yellow {
        color: #fbbf24 !important;
      }
      .yami-home-module-badge.yellow {
        background: #3d2f10 !important;
        border: 1px solid #7d5f19 !important;
        color: #fbbf24 !important;
        font-weight: 600 !important;
      }
      .yami-home-module-badge.yellow:hover {
        background: #544116 !important;
        color: #ffffff !important;
      }

      /* 规划中徽章 (灰色) */
      .yami-home-module-badge.plan,
      .yami-home-module-item.disabled .yami-home-module-badge {
        background: #2a2a2a !important;
        border: 1px solid #202020 !important;
        color: #606060 !important; /* --text-color-disabled: #606060 */
      }

      /* 报警异常徽章 (红色) */
      .yami-home-module-badge.danger {
        background: #45151b !important;
        border: 1px solid #8c2634 !important;
        color: #ff8595 !important;
        font-weight: 600 !important;
      }

      /* 4. 存档管理面板色彩对齐 */
      .yami-save-bento {
        background: #303030 !important; /* --window-background: #303030 */
        border: 1px solid #202020 !important;
      }
      .yami-save-bento-label {
        color: #808080 !important; /* --text-color-unit: #808080 */
      }
      .yami-save-bento-value {
        color: #ffffff !important; /* --text-color-active: #ffffff */
      }
      .yami-save-bento-value.highlight {
        color: #ffd700 !important; /* --command-color-inventory: #ffd700 */
      }
      .yami-save-bento-value.blue {
        color: #b0e0e6 !important; /* --text-color-strong: #b0e0e6 */
      }

      /* 槽位选择条 */
      .yami-save-slot-btn {
        background: #383838 !important; /* --fieldset-background: #383838 */
        border: 1px solid #242424 !important;
        color: #d8d8d8 !important;
      }
      .yami-save-slot-btn:hover {
        background: #444444 !important;
        color: #ffffff !important;
      }
      .yami-save-slot-btn.active {
        background: #084872 !important; /* --selected-background: #084872 */
        border-color: #0080ff !important; /* --input-border-color-focus: #0080ff */
        color: #ffffff !important;
      }
      .yami-save-slot-time {
        color: #808080 !important; /* --text-color-unit: #808080 */
      }
      .yami-save-slot-btn.active .yami-save-slot-time {
        color: #90d4ff !important;
      }

      /* 子导航 Tabs */
      .yami-save-subnav {
        background: #202020 !important; /* --tab-item-background: #202020 */
        border: 1px solid #181818 !important;
      }
      .yami-save-subnav-btn {
        color: #a0a0a0 !important;
      }
      .yami-save-subnav-btn:hover {
        background: #2c2c2c !important;
        color: #ffffff !important;
      }
      .yami-save-subnav-btn.active {
        background: #383838 !important;
        color: #ffffff !important;
        font-weight: 600 !important;
      }

      /* 速改与变量卡片 */
      .yami-save-section-card {
        background: #383838 !important;
        border: 1px solid #242424 !important;
      }
      .yami-save-section-head {
        color: #ffffff !important;
        border-bottom: 1px solid #2c2c2c !important;
      }
      .yami-save-form-label {
        color: #d8d8d8 !important;
      }
      .yami-save-var-item {
        background: #343434 !important;
        border: 1px solid #242424 !important;
      }
      .yami-save-var-name {
        color: #ffffff !important;
      }
      .yami-save-var-id {
        color: #808080 !important;
      }

      /* 输入框 (1:1 遵循 Yami --input-background: #18191a) */
      .yami-save-input,
      .yami-save-search-input {
        background: #18191a !important; /* --input-background: #18191a */
        border: 1px solid #080808 !important; /* --input-border: 1px solid #080808 */
        color: #d8d8d8 !important; /* --text-color: #d8d8d8 */
      }
      .yami-save-input:focus,
      .yami-save-search-input:focus {
        border-color: #0080ff !important; /* --input-border-color-focus: #0080ff */
      }

      /* 按钮 (1:1 遵循 Yami --button-background: #484848) */
      .yami-save-mini-btn,
      .yami-save-act-btn.default,
      .yami-perf-btn {
        background: #484848 !important; /* --button-background: #484848 */
        border: 1px solid #282828 !important;
        color: #d8d8d8 !important;
      }
      .yami-save-mini-btn:hover,
      .yami-save-act-btn.default:hover,
      .yami-perf-btn:hover {
        background: #505050 !important; /* --button-background-hover: #505050 */
        color: #ffffff !important;
      }
      .yami-save-mini-btn.primary,
      .yami-save-act-btn.primary {
        background: #084872 !important; /* --selected-background: #084872 */
        border: 1px solid #0080ff !important;
        color: #ffffff !important;
      }
      .yami-save-mini-btn.primary:hover,
      .yami-save-act-btn.primary:hover {
        background: #0c5b8f !important;
      }
      .yami-save-tree-box {
        background: #18191a !important;
        border: 1px solid #080808 !important;
      }


      /* 槽位选择栏升级为 3 列响应式网格 (告别单行截断点不到) */
      .yami-save-container {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        padding: 10px 12px 14px 12px !important;
        box-sizing: border-box !important;
        height: auto !important;
      }
      .yami-save-slots-wrap {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr) !important;
        gap: 6px !important;
        max-height: 120px !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        padding-right: 2px !important;
      }
      .yami-save-slots-wrap::-webkit-scrollbar {
        width: 4px !important;
      }
      .yami-save-slots-wrap::-webkit-scrollbar-thumb {
        background: #383838 !important;
        border-radius: 2px !important;
      }
      .yami-save-slot-btn {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-start !important;
        justify-content: center !important;
        padding: 6px 8px !important;
        min-width: 0 !important;
        border-radius: 3px !important;
        box-sizing: border-box !important;
      }
      .yami-save-slot-title {
        font-size: 11px !important;
        font-weight: 600 !important;
        color: #d8d8d8 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        width: 100% !important;
        text-align: left !important;
      }
      .yami-save-slot-time {
        font-size: 9px !important;
        color: #808080 !important;
        margin-top: 2px !important;
        white-space: nowrap !important;
      }
      .yami-save-slot-btn.active .yami-save-slot-title {
        color: #ffffff !important;
      }
      .yami-save-slot-btn.active .yami-save-slot-time {
        color: #90d4ff !important;
      }


      /* 模式切换按钮：2px 工业级硬朗微圆角 (告别 12px 大圆角) */
      .yami-mode-switch {
        display: flex !important;
        background: #18191a !important;
        border: 1px solid #141414 !important;
        border-radius: 2px !important;
        padding: 1px !important;
        gap: 2px !important;
        user-select: none !important;
      }
      .yami-mode-btn {
        padding: 2px 7px !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        color: #888888 !important;
        transition: all 0.12s ease !important;
      }
      .yami-mode-btn.active {
        background: #0080c0 !important; /* 恢复原版专业高亮蓝 */
        color: #ffffff !important;
        font-weight: 600 !important;
        box-shadow: 0 1px 4px rgba(0, 128, 192, 0.4) !important;
      }

      /* 穿透模式物理级绝对隔离：禁止对模式切换器等进行任何点击 */
      .yami-perf-dock.show.through #yami-mode-switch,
      .yami-perf-dock.show.through #yami-mode-switch * {
        pointer-events: none !important;
        opacity: 0.35 !important;
      }
      .yami-perf-dock.show.through #btn-clear-errors {
        pointer-events: none !important;
        opacity: 0.35 !important;
      }
      /* 仅顶栏穿透控制按钮与退出按钮可接收点击 */
      .yami-perf-dock.show.through #btn-dock-pin {
        pointer-events: auto !important;
        opacity: 1 !important;
      }
      .yami-perf-dock.show.through #btn-dock-close,
      .yami-perf-dock.show.through #btn-suite-back {
        pointer-events: auto !important;
      }

      /* ============================================================
         用户认可的统一标准工业深灰配色体系 (对齐右下角按钮标准 #333333)
         ============================================================ */

      /* 1. 大盘基底 (深邃深黑灰 #222222，沉稳托底) */
      .yami-perf-dock {
        background: #202020 !important;
        border: 1px solid #141414 !important;
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.85) !important;
        color: #d8d8d8 !important;
      }
      .yami-perf-dock-header {
        background: #191919 !important;
        border-bottom: 1px solid #121212 !important;
      }
      .yami-perf-dock-footer {
        background: #191919 !important;
        border-top: 1px solid #121212 !important;
      }

      /* 2. 主页卡片 (对齐右下角按钮质感: #333333 底色 + #3d3d3d 边框) */
      .yami-home-status-card {
        background: #2a2a2a !important;
        border: 1px solid #363636 !important;
        border-radius: 3px !important;
      }
      .yami-home-module-item {
        background: #303030 !important; /* 彻底告别死黑，采用正统深灰 */
        border: 1px solid #3c3c3c !important;
        border-radius: 3px !important;
        transition: all 0.12s ease !important;
      }
      .yami-home-module-item:hover {
        background: #3a3a3a !important; /* 悬浮高亮反馈 */
        border-color: #4a4a4a !important;
      }
      .yami-home-module-title {
        color: #ffffff !important;
        font-weight: 600 !important;
      }
      .yami-home-module-desc {
        color: #a8a8a8 !important;
      }

      /* 3. 存档管理卡片与槽位 (全线对齐 #303030 / #333333 质感) */
      .yami-save-bento {
        background: #2b2b2b !important;
        border: 1px solid #383838 !important;
        border-radius: 4px !important;
      }
      .yami-save-section-card {
        background: #303030 !important;
        border: 1px solid #3c3c3c !important;
        border-radius: 4px !important;
      }
      .yami-save-slot-btn {
        background: #303030 !important;
        border: 1px solid #3c3c3c !important;
        color: #d8d8d8 !important;
        border-radius: 3px !important;
      }
      .yami-save-slot-btn:hover {
        background: #3a3a3a !important;
        border-color: #4a4a4a !important;
        color: #ffffff !important;
      }
      .yami-save-slot-btn.active {
        background: #084872 !important; /* Yami 经典选中高亮蓝 */
        border-color: #0080ff !important;
        color: #ffffff !important;
      }

      /* 4. 按钮统一标准 (#333333 实体色) */
      .yami-save-mini-btn,
      .yami-save-act-btn.default,
      .yami-perf-btn,
      .yami-dock-btn {
        background: #333333 !important;
        border: 1px solid #3d3d3d !important;
        border-radius: 2px !important;
        color: #e0e0e0 !important;
      }
      .yami-save-mini-btn:hover,
      .yami-save-act-btn.default:hover,
      .yami-perf-btn:hover,
      .yami-dock-btn:hover {
        background: #404040 !important;
        border-color: #555555 !important;
        color: #ffffff !important;
      }

      /* 5. 变量行与树形框 */
      .yami-save-var-item {
        background: #2b2b2b !important;
        border: 1px solid #383838 !important;
      }
      .yami-save-tree-box {
        background: #18191a !important;
        border: 1px solid #282828 !important;
      }

      /* 6. 输入框 (黑底凹陷，极佳可读性) */
      .yami-save-input,
      .yami-save-search-input {
        background: #141414 !important;
        border: 1px solid #242424 !important;
        border-radius: 2px !important;
        color: #ffffff !important;
      }
      .yami-save-input:focus,
      .yami-save-search-input:focus {
        border-color: #0080ff !important;
      }

      /* 7. 主页彩色徽章强化 */
      .yami-home-module-badge.active {
        background: #0d2f47 !important;
        border: 1px solid #084872 !important;
        color: #38bdf8 !important;
        font-weight: 600 !important;
      }
      .yami-home-module-badge.green {
        background: #143d22 !important;
        border: 1px solid #22c55e !important;
        color: #4ade80 !important;
        font-weight: 600 !important;
      }
      .yami-home-module-badge.green:hover {
        background: #1e5230 !important;
        color: #ffffff !important;
      }
      .yami-home-module-badge.yellow {
        background: #453208 !important;
        border: 1px solid #eab308 !important;
        color: #fbbf24 !important;
        font-weight: 600 !important;
      }
      .yami-home-module-badge.yellow:hover {
        background: #5c430c !important;
        color: #ffffff !important;
      }


      /* 槽位网格：彻底放开高度限制，全量展开展现，告别死矮框与滚动条 */
      .yami-save-slots-wrap {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr) !important;
        gap: 6px !important;
        max-height: none !important;
        height: auto !important;
        overflow: visible !important;
        padding-right: 0 !important;
      }

      /* 普通/专业模式切换按钮：2px 硬朗微圆角 + 原版高亮蓝 (#0080c0) */
      .yami-mode-switch {
        display: flex !important;
        background: #141414 !important;
        border: 1px solid #0c0c0c !important;
        border-radius: 2px !important;
        padding: 1px !important;
        gap: 2px !important;
        user-select: none !important;
      }
      .yami-mode-btn {
        padding: 2px 7px !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        color: #888888 !important;
        transition: all 0.12s ease !important;
      }
      .yami-mode-btn:hover {
        color: #ffffff !important;
      }
      .yami-mode-btn.active {
        background: #0080c0 !important; /* 恢复原版专业高亮蓝 */
        color: #ffffff !important;
        font-weight: 600 !important;
        box-shadow: 0 1px 4px rgba(0, 128, 192, 0.4) !important;
      }


      /* ============================================================
         DanJuan妙妙插件 - 存档管理子面板最大弹窗高度自适应贯通
         解决“常用速改/变量与开关/JSON树形图仅显示一部分”的局促矮小问题
         ============================================================ */
      #page-save.yami-suite-page {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }

      .yami-save-container {
        display: flex !important;
        flex-direction: column !important;
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        gap: 8px !important;
        padding: 2px 2px 4px 2px !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }

      .yami-save-slots-wrap,
      .yami-save-bento,
      .yami-save-subnav,
      .yami-save-footer-actions {
        flex-shrink: 0 !important;
      }

      .yami-save-panel {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }

      /* 1. 常用速改：纵向自由弹性流动，滚动条原生舒适 */
      .yami-save-quick-scroll {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        overflow-y: auto !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        padding-right: 3px !important;
      }
      .yami-save-quick-scroll::-webkit-scrollbar {
        width: 4px !important;
      }
      .yami-save-quick-scroll::-webkit-scrollbar-thumb {
        background: #383838 !important;
        border-radius: 2px !important;
      }

      /* 2. 变量与开关：卡片与列表自适应吞噬全部垂直空间，贯通到底部 */
      .yami-save-vars-wrapper {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 8px 10px !important;
      }

      .yami-save-var-list {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        max-height: none !important;
        overflow-y: auto !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
        padding-right: 4px !important;
      }
      .yami-save-var-list::-webkit-scrollbar {
        width: 4px !important;
      }
      .yami-save-var-list::-webkit-scrollbar-thumb {
        background: #383838 !important;
        border-radius: 2px !important;
      }

      /* 3. JSON 树形图：彻底放开 320px 死高度限制，全屏最大化呈现代码视窗 */
      .yami-save-tree-wrapper {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
        overflow: hidden !important;
      }

      .yami-save-tree-box {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        max-height: none !important;
        overflow: auto !important;
        background: #141414 !important;
        border: 1px solid #282828 !important;
        border-radius: 4px !important;
        padding: 8px 10px !important;
        margin: 0 !important;
        box-sizing: border-box !important;
      }
      .yami-save-tree-box::-webkit-scrollbar {
        width: 5px !important;
        height: 5px !important;
      }
      .yami-save-tree-box::-webkit-scrollbar-thumb {
        background: #383838 !important;
        border-radius: 2px !important;
      }


      /* ============================================================
         DanJuan妙妙插件 - 控制台报错 (Error Debugger) 深度增强样式
         ============================================================ */
      .yami-errors-container {
        display: flex !important;
        flex-direction: column !important;
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        gap: 8px !important;
        overflow: hidden !important;
      }

      /* 顶部工具栏 (搜索 + 导出诊断报告 + 清空) */
      .yami-error-toolbar {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
        flex-shrink: 0 !important;
      }
      .yami-error-search-box {
        flex: 1 !important;
        display: flex !important;
        align-items: center !important;
        background: #141414 !important;
        border: 1px solid #242424 !important;
        border-radius: 2px !important;
        padding: 2px 6px !important;
      }
      .yami-error-search-input {
        background: transparent !important;
        border: none !important;
        outline: none !important;
        color: #ffffff !important;
        font-size: 11px !important;
        width: 100% !important;
      }

      /* 分类过滤标签栏 (弹性自动换行，所有分类 100% 完整可见直达) */
      .yami-error-filter-bar {
        display: flex !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        gap: 4px 5px !important;
        flex-shrink: 0 !important;
        padding: 2px 0 2px 0 !important;
      }
      .yami-error-filter-btn {
        flex-shrink: 0 !important;
        font-size: 10px !important;
        padding: 2px 7px !important;
        background: #242424 !important;
        border: 1px solid #303030 !important;
        color: #888888 !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        user-select: none !important;
        transition: all 0.12s ease !important;
      }
      .yami-error-filter-btn:hover {
        background: #303030 !important;
        color: #ffffff !important;
      }
      .yami-error-filter-btn.active {
        background: #084872 !important;
        border-color: #0080ff !important;
        color: #ffffff !important;
        font-weight: 600 !important;
      }

      /* 异常列表满高滚动容器 */
      .yami-errors-scroll-list {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        overflow-y: auto !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        padding-right: 4px !important;
      }
      .yami-errors-scroll-list::-webkit-scrollbar {
        width: 4px !important;
      }
      .yami-errors-scroll-list::-webkit-scrollbar-thumb {
        background: #383838 !important;
        border-radius: 2px !important;
      }

      /* 频次聚合徽章 */
      .yami-error-count-badge {
        font-size: 9px !important;
        font-weight: 700 !important;
        font-family: Consolas, monospace !important;
        padding: 1px 5px !important;
        background: #451212 !important;
        border: 1px solid #702020 !important;
        color: #ff6060 !important;
        border-radius: 2px !important;
        margin-left: 6px !important;
        animation: pulseCount 2s infinite ease-in-out !important;
      }

      /* 源码上下文就地折叠预览 */
      .yami-error-code-wrapper {
        margin-top: 4px !important;
        background: #141414 !important;
        border: 1px solid #282828 !important;
        border-radius: 2px !important;
        overflow: hidden !important;
      }
      .yami-error-code-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 3px 8px !important;
        background: #181818 !important;
        border-bottom: 1px solid #222222 !important;
        font-size: 10px !important;
        color: #888888 !important;
        cursor: pointer !important;
        user-select: none !important;
      }
      .yami-error-code-header:hover {
        background: #202020 !important;
        color: #cccccc !important;
      }
      .yami-error-code-box {
        padding: 4px 6px !important;
        font-family: Consolas, "Courier New", monospace !important;
        font-size: 10.5px !important;
        line-height: 1.45 !important;
        background: #101010 !important;
        overflow-x: auto !important;
      }
      .yami-error-code-line {
        display: flex !important;
        align-items: flex-start !important;
        gap: 8px !important;
        white-space: pre !important;
        color: #aaaaaa !important;
      }
      .yami-error-code-line .line-num {
        color: #555555 !important;
        width: 32px !important;
        text-align: right !important;
        user-select: none !important;
        flex-shrink: 0 !important;
      }
      .yami-error-code-line.target {
        background: rgba(255, 64, 64, 0.15) !important;
        color: #ff9999 !important;
        font-weight: 600 !important;
        border-left: 2px solid #ff4040 !important;
        padding-left: 2px !important;
      }
      .yami-error-code-line.target .line-num {
        color: #ff4040 !important;
        font-weight: 700 !important;
      }

      /* 操作按钮扩展 */
      .yami-error-actions {
        display: flex !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 6px !important;
        margin-top: 4px !important;
      }
      .yami-error-btn {
        font-size: 10px !important;
        padding: 2px 7px !important;
        background: #303030 !important;
        border: 1px solid #3c3c3c !important;
        color: #d8d8d8 !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        user-select: none !important;
        transition: all 0.12s ease !important;
      }
      .yami-error-btn:hover {
        background: #3a3a3a !important;
        color: #ffffff !important;
        border-color: #4a4a4a !important;
      }
      .yami-error-btn.primary {
        background: #084872 !important;
        border-color: #0080ff !important;
        color: #ffffff !important;
      }
      .yami-error-btn.primary:hover {
        background: #0c5b8f !important;
      }
      /* ============================================================
         DanJuan妙妙插件 - 场景实体检查台 (Scene Inspector)
         ============================================================ */
      #page-scene.yami-suite-page {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }
      .yami-scene-container {
        display: flex !important;
        flex-direction: column !important;
        flex: 1 1 0 !important;
        min-height: 0 !important;
        height: 100% !important;
        gap: 8px !important;
        padding: 2px 2px 4px 2px !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }
      .yami-scene-head {
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
        flex-shrink: 0 !important;
        background: #202020 !important;
        border: 1px solid #3d3d3d !important;
        border-radius: 3px !important;
        padding: 8px 10px !important;
      }
      .yami-scene-map-name {
        font-size: 13px !important;
        font-weight: 600 !important;
        color: #e8e8e8 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .yami-scene-map-path {
        font-size: 10px !important;
        color: #808080 !important;
        line-height: 1.6 !important;
        word-break: break-all !important;
        font-family: Consolas, monospace !important;
      }
      .yami-scene-chips {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 6px !important;
      }
      .yami-scene-chip {
        display: inline-flex !important;
        gap: 6px !important;
        align-items: center !important;
        font-size: 10px !important;
        color: #a0a0a0 !important;
        background: #181818 !important;
        border: 1px solid #303030 !important;
        border-radius: 2px !important;
        padding: 2px 7px !important;
        user-select: none !important;
      }
      .yami-scene-chip b {
        color: #e0e0e0 !important;
        font-weight: 600 !important;
        font-family: Consolas, monospace !important;
      }
      .yami-scene-cam {
        font-size: 10px !important;
        color: #808080 !important;
        font-family: Consolas, monospace !important;
      }
      .yami-scene-toolbar {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        flex-shrink: 0 !important;
        flex-wrap: wrap !important;
      }
      .yami-scene-search {
        flex: 1 1 140px !important;
        min-width: 120px !important;
        height: 24px !important;
        background: #181818 !important;
        border: 1px solid #3d3d3d !important;
        border-radius: 2px !important;
        color: #d8d8d8 !important;
        font-size: 11px !important;
        padding: 0 8px !important;
        outline: none !important;
        box-sizing: border-box !important;
      }
      .yami-scene-search:focus {
        border-color: #0080c0 !important;
      }
      .yami-scene-kinds {
        display: inline-flex !important;
        gap: 4px !important;
      }
      .yami-scene-kind {
        font-size: 11px !important;
        color: #9a9a9a !important;
        background: #202020 !important;
        border: 1px solid #3d3d3d !important;
        padding: 2px 9px !important;
        border-radius: 2px !important;
        cursor: pointer !important;
        white-space: nowrap !important;
        user-select: none !important;
      }
      .yami-scene-kind.on {
        color: #0aa0d8 !important;
        border-color: #0080c0 !important;
        background: #10242c !important;
      }
      .yami-scene-vis {
        font-size: 11px !important;
        color: #9a9a9a !important;
        cursor: pointer !important;
        padding: 2px 4px !important;
        white-space: nowrap !important;
        user-select: none !important;
      }
      .yami-scene-vis.on {
        color: #20c080 !important;
      }
      .yami-scene-groups {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        overflow-y: auto !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        padding-right: 2px !important;
      }
      .yami-scene-groups::-webkit-scrollbar {
        width: 4px !important;
      }
      .yami-scene-groups::-webkit-scrollbar-track {
        background: #181818 !important;
      }
      .yami-scene-groups::-webkit-scrollbar-thumb {
        background: #383838 !important;
        border-radius: 2px !important;
      }
      .yami-scene-groups::-webkit-scrollbar-thumb:hover {
        background: #4a4a4a !important;
      }
      .yami-scene-group {
        border: 1px solid #3d3d3d !important;
        border-radius: 3px !important;
        background: #1c1c1c !important;
        overflow: hidden !important;
        flex-shrink: 0 !important;
      }
      .yami-scene-group-title {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 7px 10px !important;
        background: #242424 !important;
        border-bottom: 1px solid #101010 !important;
      }
      .yami-scene-dot {
        width: 6px !important;
        height: 6px !important;
        border-radius: 50% !important;
        flex-shrink: 0 !important;
      }
      .yami-scene-dot.actors { background: #e0a040 !important; }
      .yami-scene-dot.regions { background: #20a080 !important; }
      .yami-scene-group-title b {
        font-size: 12px !important;
        color: #d8d8d8 !important;
      }
      .yami-scene-group-title em {
        font-style: normal !important;
        font-size: 10px !important;
        color: #808080 !important;
        margin-left: auto !important;
      }
      .yami-scene-subgroup-title {
        display: flex !important;
        align-items: center !important;
        padding: 5px 12px !important;
        font-size: 10px !important;
        color: #888888 !important;
        background: #202020 !important;
        border-bottom: 1px solid #1a1a1a !important;
      }
      .yami-scene-subgroup-title span {
        margin-left: auto !important;
        color: #666666 !important;
        font-family: Consolas, monospace !important;
      }
      .yami-scene-row {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 6px 12px !important;
        cursor: pointer !important;
        border-bottom: 1px solid #161616 !important;
        user-select: none !important;
        font-size: 12px !important;
        background: transparent !important;
        color: #e0e0e0 !important;
      }
      .yami-scene-row:hover { background: #262626 !important; }
      .yami-scene-row.open { background: #232a2e !important; }
      .yami-scene-arrow {
        color: #666666 !important;
        font-size: 10px !important;
        width: 10px !important;
        text-align: center !important;
        flex-shrink: 0 !important;
      }
      .yami-scene-name {
        color: #e0e0e0 !important;
        min-width: 0 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .yami-scene-tags {
        display: inline-flex !important;
        gap: 4px !important;
        flex-shrink: 0 !important;
      }
      .yami-scene-tag {
        font-style: normal !important;
        font-size: 9px !important;
        padding: 1px 5px !important;
        border-radius: 2px !important;
        background: #181818 !important;
        color: #a0a0a0 !important;
        border: 1px solid #303030 !important;
        white-space: nowrap !important;
      }
      .yami-scene-tag.player { color: #ffd76a !important; border-color: #8a7420 !important; background: #221c08 !important; }
      .yami-scene-tag.member { color: #7fc8ff !important; border-color: #28506e !important; background: #0d1a24 !important; }
      .yami-scene-tag.move { color: #8ee6b0 !important; border-color: #1f6b43 !important; background: #0c1e14 !important; }
      .yami-scene-tag.hide { color: #b0b0b0 !important; border-color: #4a4a4a !important; background: #191919 !important; }
      .yami-scene-tag.warn { color: #ff9c6a !important; border-color: #8a4a20 !important; background: #241207 !important; }
      .yami-scene-tag.inside { color: #6ac2c2 !important; border-color: #2a6a6a !important; background: #0b1a1a !important; }
      .yami-scene-coord {
        margin-left: auto !important;
        font-family: Consolas, monospace !important;
        font-size: 10px !important;
        color: #9a9a9a !important;
        flex-shrink: 0 !important;
        padding-left: 8px !important;
      }
      .yami-scene-meta {
        font-size: 10px !important;
        color: #707070 !important;
        flex-shrink: 1 !important;
        min-width: 0 !important;
        max-width: 130px !important;
        text-align: right !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .yami-scene-detail {
        background: #16181a !important;
        border-bottom: 1px solid #161616 !important;
        padding: 8px 12px !important;
      }
      .yami-scene-dl {
        display: grid !important;
        grid-template-columns: auto 1fr !important;
        gap: 3px 14px !important;
        font-size: 11px !important;
      }
      .yami-scene-dl span {
        color: #808080 !important;
        white-space: nowrap !important;
      }
      .yami-scene-dl b {
        color: #d8d8d8 !important;
        font-weight: 500 !important;
        line-height: 1.7 !important;
        word-break: break-all !important;
      }
      .yami-scene-empty {
        color: #888888 !important;
        font-size: 11px !important;
        padding: 10px 12px !important;
        text-align: center !important;
        line-height: 1.8 !important;
      }
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
      <div id="yami-error-bubble" class="yami-error-bubble" title="点击打开控制台报错黑匣子查看详情">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
          <span id="yami-error-bubble-title" style="font-weight: 600; color: #ff5252;">[控制台异常]</span>
          <span style="color: #888888; font-size: 10px;">点击排查 &gt;</span>
        </div>
        <div id="yami-error-bubble-text" style="color: #f0f0f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">捕获到未处理错误</div>
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
        <div class="yami-perf-dock-title" id="yami-dock-title-box">
          <div class="yami-nav-back-btn" id="btn-suite-back" role="button" style="display: none;">
            <span>&lt; 返回</span>
          </div>
          <span id="yami-dock-title-text">DanJuan妙妙插件</span>
        </div>
        <div class="yami-perf-dock-actions" id="yami-dock-actions">
          <div class="yami-mode-switch" id="yami-mode-switch" style="display: none;">
            <div class="yami-mode-btn active" data-mode="simple" role="button">普通模式</div>
            <div class="yami-mode-btn" data-mode="pro" role="button">专业模式</div>
          </div>
          <div class="yami-nav-back-btn" id="btn-clear-errors" role="button" style="display: none; padding: 1px 6px;">清空</div>
          <div class="yami-pin-btn" id="btn-dock-pin" role="button" title="点击开启穿透 (可直接操作底层游戏)">穿透</div>
          <div class="yami-perf-icon-btn" id="btn-dock-close" role="button" title="收起 (Home / ESC)">×</div>
        </div>
      </div>

      <!-- 新版本升级提醒条 (有新版时自动浮现) -->
      <div class="yami-update-banner" id="yami-update-banner" style="margin: 0 12px 10px 12px;">
        <div style="display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1;">
          <span style="font-weight: 600; color: #ffffff;">[新版本] 发现更新组件 <span id="yami-latest-ver" style="color: #1cff9b;">--</span></span>
          <span style="color: #88a0b0; font-size: 10px;">与 GitHub 最新代码同步</span>
        </div>
        <div class="yami-update-btn" id="btn-do-update" role="button">一键热更新</div>
      </div>

      <div class="yami-perf-tabs" id="yami-tabs-bar" style="display: none !important;">
        <div class="yami-perf-tab active" data-ptab="overview" role="button"><i class="yami-icon yami-icon-settings"></i><span>性能总览</span></div>
        <div class="yami-perf-tab" data-ptab="render" role="button"><i class="yami-icon yami-icon-cube"></i><span>渲染DrawCall</span></div>
        <div class="yami-perf-tab" data-ptab="scene" role="button"><i class="yami-icon yami-icon-scene"></i><span>场景实体</span></div>
        <div class="yami-perf-tab" data-ptab="events" role="button"><i class="yami-icon yami-icon-event"></i><span>活跃事件</span></div>
      </div>

      <div class="yami-perf-dock-body">
        <!-- 页面 1: DanJuan妙妙插件 主页大厅 -->
        <div class="yami-suite-page" id="page-home">
          <!-- 轻量运行状态条 -->
          <div class="yami-home-summary-card">
            <div class="yami-home-summary-item">
              <span class="yami-dot-indicator green" id="yami-home-status-dot"></span>
              <span id="yami-home-status-text">运行健康</span>
            </div>
            <div style="color: #888888; font-family: Consolas, monospace;" id="yami-home-status-stats">
              60 FPS · 8 DC
            </div>
          </div>

          <!-- 精简明快的功能入口列表 (Remix Icon 官方线性图标) -->
          <div class="yami-home-modules">
            <!-- 模块 1: 性能分析 (Remix Icon: ri-pulse-line) -->
            <div class="yami-home-module-item" data-target="profiler" role="button">
              <div class="yami-home-module-main">
                <div class="yami-home-module-icon-box" title="RemixIcon: ri-pulse-line">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 7.53856L15 21.5386L18.6594 13H23V11H17.3406L15 16.4614L9 2.46143L5.34064 11H1V13H6.65936L9 7.53856Z"></path></svg>
                </div>
                <div>
                  <div class="yami-home-module-title">性能分析</div>
                  <div class="yami-home-module-desc">帧率、耗时与 DrawCall</div>
                </div>
              </div>
              <div class="yami-home-module-badge active">进入</div>
            </div>

            <!-- 模块 2: 控制台报错 (Remix Icon: ri-bug-line) -->
            <div class="yami-home-module-item" data-target="errors" role="button">
              <div class="yami-home-module-main">
                <div class="yami-home-module-icon-box green" title="RemixIcon: ri-bug-line">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 10H20.618C20.8655 9.33644 21 8.66356 21 8H19C19 6.89543 18.1046 6 17 6H15.8293C15.3441 5.3727 14.7176 4.88603 14 4.56846V2H10V4.56846C9.28238 4.88603 8.65588 5.3727 8.17071 6H7C5.89543 6 5 6.89543 5 8H3C3 8.66356 3.13451 9.33644 3.38197 10H5V11C5 11.3409 5.03433 11.674 5.10014 12H3V14H5.38197C5.86714 15.3273 6.84333 16.4022 8.12154 16.8944L6.29289 18.7231L7.70711 20.1373L9.93934 17.9051C10.5794 17.9678 11.2338 18 11.9 18C12.5662 18 13.2206 17.9678 13.8607 17.9051L16.0929 20.1373L17.5071 18.7231L15.6785 16.8944C16.9567 16.4022 17.9329 15.3273 18.418 14H21V12H18.8999C18.9657 11.674 19 11.3409 19 11V10ZM17 8V11C17 13.7614 14.7614 16 12 16C9.23858 16 7 13.7614 7 11V8H17ZM9 10H11V12H9V10ZM13 10H15V12H13V10Z"></path></svg>
                </div>
                <div>
                  <div class="yami-home-module-title">控制台报错</div>
                  <div class="yami-home-module-desc">未捕获异常与智能分析</div>
                </div>
              </div>
              <div class="yami-home-module-badge green" id="yami-home-error-badge">进入</div>
            </div>

            <!-- 模块 3: 存档管理 (Remix Icon: ri-save-3-line) -->
            <div class="yami-home-module-item" data-target="save" role="button">
              <div class="yami-home-module-main">
                <div class="yami-home-module-icon-box yellow" title="RemixIcon: ri-save-3-line">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 19V13H17V19H19V7.82843L16.1716 5H5V19H7ZM4 3H17L21.7071 7.70711C21.8946 7.89464 22 8.149 22 8.41421V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H4ZM9 15V19H15V15H9Z"></path></svg>
                </div>
                <div>
                  <div class="yami-home-module-title">存档管理</div>
                  <div class="yami-home-module-desc">槽位速改、数据解密与变量调试</div>
                </div>
              </div>
              <div class="yami-home-module-badge yellow">进入</div>
            </div>

            <!-- 模块 4: 场景实体 (Scene Inspector) -->
            <div class="yami-home-module-item" data-target="scene" role="button">
              <div class="yami-home-module-main">
                <div class="yami-home-module-icon-box" title="RemixIcon: ri-equalizer-line">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6.17071 18C6.58254 16.8348 7.69378 16 9 16C10.3062 16 11.4175 16.8348 11.8293 18H22V20H11.8293C11.4175 21.1652 10.3062 22 9 22C7.69378 22 6.58254 21.1652 6.17071 20H2V18H6.17071ZM12.1707 11C12.5825 9.83481 13.6938 9 15 9C16.3062 9 17.4175 9.83481 17.8293 11H22V13H17.8293C17.4175 14.1652 16.3062 15 15 15C13.6938 15 12.5825 14.1652 12.1707 13H2V11H12.1707ZM6.17071 4C6.58254 2.83481 7.69378 2 9 2C10.3062 2 11.4175 2.83481 11.8293 4H22V6H11.8293C11.4175 7.16519 10.3062 8 9 8C7.69378 8 6.58254 7.16519 6.17071 6H2V4H6.17071ZM9 6C9.55228 6 10 5.55228 10 5C10 4.44772 9.55228 4 9 4C8.44772 4 8 4.44772 8 5C8 5.55228 8.44772 6 9 6ZM15 13C15.5523 13 16 12.5523 16 12C16 11.4477 15.5523 11 15 11C14.4477 11 14 11.4477 14 12C14 12.5523 14.4477 13 15 13ZM9 20C9.55228 20 10 19.5523 10 19C10 18.4477 9.55228 18 9 18C8.44772 18 8 18.4477 8 19C8 19.5523 8.44772 20 9 20Z"></path></svg>
                </div>
                <div>
                  <div class="yami-home-module-title">场景实体</div>
                  <div class="yami-home-module-desc">角色、区域与碰撞体检视</div>
                </div>
              </div>
              <div class="yami-home-module-badge active">进入</div>
            </div>
          </div>
        </div>

        <!-- 页面 2: 控制台异常与错误分析 -->
        <div class="yami-suite-page yami-errors-container" id="page-errors" style="display: none;">
          <!-- 顶部工具栏 (搜索 + 导出诊断报告 + 清空) -->
          <div class="yami-error-toolbar">
            <div class="yami-error-search-box">
              <input class="yami-error-search-input" id="yami-error-search" type="text" placeholder="搜索报错信息、文件名、调用栈..." />
            </div>
            <div class="yami-error-btn primary" id="btn-export-error-report" role="button" title="导出 Markdown 结构化诊断报告">导出报告</div>
            
          </div>

          <!-- 分类筛选器 -->
          <div class="yami-error-filter-bar" id="yami-error-filter-bar">
            <div class="yami-error-filter-btn active" data-filter="all">全部 (0)</div>
            <div class="yami-error-filter-btn" data-filter="high-freq">高频 (0)</div>
            <div class="yami-error-filter-btn" data-filter="NullPointer">空指针 (0)</div>
            <div class="yami-error-filter-btn" data-filter="MissingFunction">方法丢失 (0)</div>
            <div class="yami-error-filter-btn" data-filter="PluginError">插件指令 (0)</div>
            <div class="yami-error-filter-btn" data-filter="SceneError">场景地形 (0)</div>
            <div class="yami-error-filter-btn" data-filter="ResourceNotFound">资源404 (0)</div>
            <div class="yami-error-filter-btn" data-filter="console">控制台 (0)</div>
          </div>

          <!-- 异常记录列表 (自适应满高独立滚动) -->
          <div class="yami-errors-scroll-list" id="yami-errors-list">
            <div class="yami-error-empty">
              后台运行健康，未捕获到任何未处理异常。
            </div>
          </div>
        </div>

        <!-- 页面 3: 性能分析与排查 (原视图) -->
        <div class="yami-suite-page" id="page-profiler" style="display: none;">
        <!-- 普通小白体检模式视图 (默认展示) -->
        <div class="yami-simple-view" id="yami-view-simple">
          <div class="yami-health-banner">
            <div class="yami-health-score-circle" id="diag-score">100</div>
            <div class="yami-health-info">
              <div class="yami-health-title" id="diag-status-title">丝滑如飞 · 极佳状态</div>
              <div class="yami-health-desc" id="diag-status-desc">各项指标都在预算内，CPU 与显卡毫无压力。</div>
              <div class="yami-health-chips">
                <span class="yami-health-chip" id="diag-chip-fps">60 FPS</span>
                <span class="yami-health-chip" id="diag-chip-ms">0.0 ms</span>
                <span class="yami-health-chip" id="diag-chip-dc">0 DC</span>
                <span class="yami-health-chip" id="diag-chip-actors">0 角色</span>
              </div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>卡顿真凶定位档案 (具体文件与指令)</span>
              <span id="diag-culprit-count" style="color: #808080;">0 个瓶颈</span>
            </div>
            <div id="diag-culprits-list" style="display: flex; flex-direction: column; gap: 6px;">
              <div style="color: #1cff9b; font-size: 11px; text-align: center; padding: 12px; background: #1a241e; border: 1px solid #203828; border-radius: 2px;">
                [OK] 主线程与渲染管线未发现卡顿真凶，运行顺畅。
              </div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>一键快速排查测试 (点一下观察帧率)</span>
              <span style="color: #808080; font-size: 10px;">不影响真实工程与存档</span>
            </div>
            <div class="yami-quick-toggles">
              <div class="yami-quick-btn" id="btn-quick-mute-actors" role="button">⏸ 冻结怪物与NPC (主角正常)</div>
              <div class="yami-quick-btn" id="btn-quick-mute-particles" role="button">⏸ 临时关闭粒子</div>
              <div class="yami-quick-btn" id="btn-quick-mute-events" role="button">⏸ 临时暂停公共事件</div>
              <div class="yami-quick-btn" id="btn-quick-mute-audio" role="button">⏸ 临时静音音效SE (排查音频)</div>
              <div class="yami-quick-btn" id="btn-quick-mute-ui" role="button" style="grid-column: span 2;">⏸ 临时隐藏界面与飘字UI</div>
            </div>
          </div>
        </div>

        <!-- 专业极客调试模式视图 (包含4大原生深度Tab) -->
        <div id="yami-view-pro" style="display: none; flex-direction: column; gap: 10px;">
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
              <span>嫌疑开关 (A/B 实验)</span>
              <span style="color: #808080;">点击暂停某类对象更新 · 卡顿消失即真凶</span>
            </div>
            <div class="yami-perf-sus-row" id="sus-row" style="padding: 2px 0;">
              <span style="color: #606060; font-size: 10px;">角色 / 动画 / 粒子 / 触发器 / 界面 / 事件</span>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>模块耗时排行 (TOP 耗时)</span>
              <span>总耗时</span>
            </div>
            <div id="box-updaters-list" style="display: flex; flex-direction: column; gap: 5px;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">正在采集...</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>严重掉帧记录 (>33.3ms)</span>
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
              <span>渲染子系统明细 (Renderers)</span>
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
              <span>对象级耗时排行 (总 / 均 / 峰 · 卡顿真凶)</span>
              <span id="val-objwrapped" style="color: #808080;">0 已包装</span>
            </div>
            <div id="box-objects-list" style="display: flex; flex-direction: column; gap: 3px;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 6px;">正在采集对象级耗时...</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>场景环境与摄像机视口状态</span>
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
              <span>正在运行的活跃事件 (Active Events)</span>
            </div>
            <div id="box-active-events-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">主线程当前无活跃后台/并行事件</div>
            </div>
          </div>

          <div class="yami-perf-box">
            <div class="yami-perf-box-title">
              <span>最近事件触发执行流水 (Activity Log)</span>
            </div>
            <div id="box-history-events-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto;">
              <div style="color: #808080; font-size: 11px; text-align: center; padding: 8px;">尚未捕获到事件触发执行</div>
            </div>
          </div>
        </div>
        </div>
      </div><!-- end page-profiler -->

      <!-- 页面 4: 存档管理 (Save Lab) 位于 dock-body 内部 -->
      <div class="yami-suite-page" id="page-save" style="display: none !important;">
        <div class="yami-save-container" id="yami-save-root">
          <!-- 动态装载 SaveLab 视图 -->
        </div>
      </div>

      <!-- 页面 5: 场景实体检查台 (Scene Inspector) -->
      <div class="yami-suite-page" id="page-scene" style="display: none !important;">
        <div class="yami-scene-container" id="yami-scene-root">
          <!-- 动态装载 SceneLab 视图 -->
        </div>
      </div>

      </div><!-- end yami-perf-dock-body -->

      <div class="yami-perf-dock-footer">
        <div style="color: #808080; display: flex; align-items: center; gap: 8px;">
          <span id="yami-version-badge" style="color: #0080c0; cursor: pointer; text-decoration: underline;" title="点击检查 GitHub 最新版本">v0.5.0 (检查更新)</span>
        </div>
        <div id="yami-dock-export-group" style="display: none !important; gap: 6px;">
          <div class="yami-perf-btn" id="dock-btn-copy" role="button">复制 JSON</div>
          <div class="yami-perf-btn" id="dock-btn-dl" role="button">保存报告</div>
        </div>
      </div>
    `;
    document.body.appendChild(dock);

    // ============================================================
    // DanJuan妙妙插件 路由控制器与物理级穿透
    // ============================================================
    const titleTextEl = document.getElementById('yami-dock-title-text');
    const backBtnEl = document.getElementById('btn-suite-back');
    const modeSwitchEl = document.getElementById('yami-mode-switch');
    const clearErrorsBtnEl = document.getElementById('btn-clear-errors');
    const tabsBarEl = document.getElementById('yami-tabs-bar');
    const exportGroupEl = document.getElementById('yami-dock-export-group');
    const homeErrorBadgeEl = document.getElementById('yami-home-error-badge');
    const homeStatusDotEl = document.getElementById('yami-home-status-dot');
    const homeStatusTextEl = document.getElementById('yami-home-status-text');
    const homeStatusStatsEl = document.getElementById('yami-home-status-stats');
    const errorsListEl = document.getElementById('yami-errors-list');

    const pages = {
      home: document.getElementById('page-home'),
      profiler: document.getElementById('page-profiler'),
      errors: document.getElementById('page-errors'),
      save: document.getElementById('page-save'),
      scene: document.getElementById('page-scene')
    };

    // ============================================================
    // DanJuan妙妙插件 页面契约中心 (Views Registry)
    // 壳只负责基础框架/顶栏/穿透/胶囊/时钟调度，页面实现标准契约
    // ============================================================
    const Views = {
      registry: {},
      current: null,
      register(id, def) {
        this.registry[id] = def;
      },
      get(id) {
        return this.registry[id];
      }
    };

    let currentView = localStorage.getItem('yami-suite-active-view') || 'home';

    function switchView(target) {
      const nextView = Views.get(target) ? target : 'home';
      if (Views.current && Views.current.id !== nextView) {
        const prev = Views.get(Views.current.id);
        if (prev && prev.destroy) {
          try { prev.destroy(); } catch (e) { console.error(e); }
        }
      }

      currentView = nextView;
      localStorage.setItem('yami-suite-active-view', nextView);

      const pageDef = Views.get(nextView);
      Views.current = { id: nextView, def: pageDef };

      // 调度顶栏元素显隐 (由契约声明式驱动)
      if (titleTextEl) titleTextEl.textContent = pageDef.title || 'DanJuan妙妙插件';
      if (backBtnEl) backBtnEl.style.setProperty('display', pageDef.showBack ? 'inline-flex' : 'none', 'important');
      if (modeSwitchEl) modeSwitchEl.style.setProperty('display', pageDef.showModeSwitch ? 'flex' : 'none', 'important');
      if (clearErrorsBtnEl) clearErrorsBtnEl.style.setProperty('display', pageDef.showClearErrors ? 'inline-flex' : 'none', 'important');
      if (tabsBarEl) {
        const isPro = localStorage.getItem('yami-perf-mode') === 'pro';
        tabsBarEl.style.setProperty('display', (pageDef.showTabs && isPro) ? 'flex' : 'none', 'important');
      }

      // 底栏导出按钮组显隐调度：仅当进入性能分析 (profiler) 视图时精准浮现，其余视图绝对隐藏
      if (exportGroupEl) {
        exportGroupEl.style.setProperty('display', pageDef.showExportBtns ? 'flex' : 'none', 'important');
      }

      // 调度页面容器显隐
      Object.keys(pages).forEach(function(id) {
        const el = pages[id];
        if (el) el.style.setProperty('display', id === nextView ? 'flex' : 'none', 'important');
      });

      // 触发进入时的视图刷新
      if (pageDef.refresh) {
        try { pageDef.refresh(ctx); } catch (e) { console.warn("[DanJuan view refresh]", e); }
      }
    }

    // 绑定穿透按钮交互 (点击后允许鼠标穿透操作底层游戏)
    const pinBtn = document.getElementById('btn-dock-pin');
    let isThrough = false;

    function applyThroughState(enable) {
      isThrough = enable;
      dock.classList.toggle('through', isThrough);
      if (pinBtn) pinBtn.classList.toggle('active', isThrough);
      
      const body = dock.querySelector('.yami-perf-dock-body');
      const header = dock.querySelector('.yami-perf-dock-header');

      if (isThrough) {
        // 双重硬核保证：类名 + 内联属性，确保在任何宿主环境下物理穿透
        dock.style.setProperty('pointer-events', 'none', 'important');
        dock.style.setProperty('opacity', '0.75', 'important');
        if (body) body.style.setProperty('pointer-events', 'none', 'important');
        if (header) header.style.setProperty('pointer-events', 'auto', 'important');
        if (pinBtn) pinBtn.textContent = '已穿透';
        showToast('已开启鼠标穿透 (可直接操作底层游戏)', 2000);
      } else {
        dock.style.removeProperty('pointer-events');
        dock.style.removeProperty('opacity');
        if (body) body.style.removeProperty('pointer-events');
        if (header) header.style.removeProperty('pointer-events');
        if (pinBtn) pinBtn.textContent = '穿透';
        showToast('已退出鼠标穿透', 2000);
      }
    }

    if (pinBtn) {
      pinBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        applyThroughState(!isThrough);
      });
    }

    // 绑定返回按钮
    if (backBtnEl) {
      backBtnEl.addEventListener('click', function(e) {
        e.stopPropagation();
        switchView('home');
      });
    }

    // 绑定主页功能入口点击
    document.querySelectorAll('.yami-home-module-item[data-target]').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        const target = item.getAttribute('data-target');
        if (target) switchView(target);
      });
    });

    // 清空错误列表
    if (clearErrorsBtnEl) {
      clearErrorsBtnEl.addEventListener('click', function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (probe && probe.clearErrors) {
          probe.clearErrors();
          showToast('错误记录已清空');
          renderErrorsList();
          updateHomeStatus();
        }
      });
    }

    // 渲染错误卡片
    // 控制台报错过滤与搜索状态
    let errorActiveFilter = 'all';
    let errorSearchKeyword = '';

// (escapeHtml 已统一提升为模块顶级公共转义函数)

    // 导出 Markdown 结构化错误诊断报告
    function exportErrorReport() {
      const probe = window.__YAMI_PERF_PROBE__;
      const errors = (probe && probe.getErrors) ? probe.getErrors() : [];
      if (errors.length === 0) {
        showToast('当前无异常记录，无需导出报告');
        return;
      }

      const now = new Date().toLocaleString('zh-CN', { hour12: false });
      const snap = probe.state && probe.state.samples && probe.state.samples[probe.state.samples.length - 1];
      const fps = snap ? snap.fps : 60;
      const dc = snap ? snap.drawCalls : 0;

      const report = [
        '# Open Yami 游戏运行期错误诊断报告',
        '- **生成时间**: ' + now,
        '- **插件版本**: v0.5.0 (DanJuan妙妙插件)',
        '- **运行时状态**: FPS ' + fps + ' · DrawCall ' + dc,
        '- **异常总类数**: ' + errors.length + ' 项 (已按同源指纹智能聚合)',
        '',
        '---',
        '',
        '## 异常诊断清单',
        ''
      ];

      errors.forEach(function(err, idx) {
        const a = err.analysis || {};
        const countStr = (err.count && err.count > 1) ? ' [累计发生 ' + err.count + ' 次]' : '';
        report.push('### [' + (idx + 1) + '] [' + (a.category || err.type) + '] ' + (a.title || err.message) + countStr);
        report.push('- **发生频次**: ' + (err.count || 1) + ' 次 (首次: ' + (err.firstTime || err.time) + ' · 最近: ' + (err.latestTime || err.time) + ')');
        report.push('- **报错来源**: `' + err.source + '`' + (err.lineno ? ' (第 ' + err.lineno + ' 行)' : ''));
        report.push('- **诊断原因**: ' + (a.reason || '运行期发生未处理错误'));
        report.push('- **建议排查**: ' + (a.suggestion || '检查代码上下文与变量状态'));

        if (err.codeContext && Array.isArray(err.codeContext.lines)) {
          report.push('');
          report.push('**报错位置源码上下文 (' + err.codeContext.fileName + '):**');
          report.push('```typescript');
          err.codeContext.lines.forEach(function(l) {
            const prefix = l.isTarget ? '>> ' : '   ';
            const num = String(l.line).padStart(4, ' ');
            report.push(prefix + num + ' | ' + l.content);
          });
          report.push('```');
        }

        if (err.stack) {
          report.push('');
          report.push('<details><summary>点击展开完整调用栈 (Stack Trace)</summary>');
          report.push('');
          report.push('```');
          report.push(err.stack);
          report.push('```');
          report.push('</details>');
        }
        report.push('');
        report.push('---');
        report.push('');
      });

      const mdContent = report.join('\n');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(mdContent).then(function() {
          showToast('诊断报告已生成并复制到剪贴板！');
        }).catch(function() {
          showToast('诊断报告已生成');
        });
      }

      // 写入本地文件
      try {
        if (typeof require === 'function') {
          const fs = require('fs');
          const path = require('path');
          const saveDir = (typeof SaveLab !== 'undefined' && SaveLab.getGameDir && SaveLab.getGameDir()) || process.cwd();
          const fname = 'error-report-' + Date.now() + '.md';
          const p = path.join(saveDir, fname);
          fs.writeFileSync(p, mdContent, 'utf8');
          showToast('诊断报告已落盘: ' + fname);
        }
      } catch (e) {}
    }

    // 渲染错误卡片与全套过滤器
    function renderErrorsList() {
      if (!errorsListEl) return;
      const probe = window.__YAMI_PERF_PROBE__;
      const errors = (probe && probe.getErrors) ? probe.getErrors() : [];

      // 1. 动态统计各分类数量并更新 Filter Bar
      const counts = {
        all: errors.length,
        'high-freq': 0,
        NullPointer: 0,
        MissingFunction: 0,
        PluginError: 0,
        SceneError: 0,
        ResourceNotFound: 0,
        console: 0
      };

      errors.forEach(function(e) {
        if ((e.count || 1) > 1) counts['high-freq']++;
        if (e.type === 'console_error') counts['console']++;
        const cat = e.analysis && e.analysis.category;
        if (cat && counts[cat] !== undefined) counts[cat]++;
      });

      const filterBarEl = document.getElementById('yami-error-filter-bar');
      // 分类中文标签 (小白直读, 过滤器按钮与卡片头部共用)
      const CAT_LABEL = {
        all: '全部',
        'high-freq': '高频',
        NullPointer: '空指针',
        MissingFunction: '方法丢失',
        PluginError: '插件指令',
        SceneError: '场景地形',
        ResourceNotFound: '资源404',
        console: '控制台'
      };
      if (filterBarEl) {
        filterBarEl.querySelectorAll('.yami-error-filter-btn').forEach(function(btn) {
          const f = btn.getAttribute('data-filter');
          btn.textContent = (CAT_LABEL[f] || f) + ' (' + (counts[f] || 0) + ')';
          btn.classList.toggle('active', f === errorActiveFilter);
        });
      }

      // 2. 根据当前过滤器与搜索词筛选
      const kw = errorSearchKeyword.toLowerCase().trim();
      const filtered = errors.filter(function(err) {
        const a = err.analysis || {};
        // 分类过滤
        if (errorActiveFilter === 'high-freq' && (err.count || 1) <= 1) return false;
        if (errorActiveFilter === 'console' && err.type !== 'console_error') return false;
        if (errorActiveFilter !== 'all' && errorActiveFilter !== 'high-freq' && errorActiveFilter !== 'console') {
          if (a.category !== errorActiveFilter) return false;
        }
        // 关键字过滤
        if (kw) {
          const matchMsg = String(err.message || '').toLowerCase().includes(kw);
          const matchSrc = String(err.source || '').toLowerCase().includes(kw);
          const matchTitle = String(a.title || '').toLowerCase().includes(kw);
          const matchReason = String(a.reason || '').toLowerCase().includes(kw);
          const matchStack = String(err.stack || '').toLowerCase().includes(kw);
          if (!matchMsg && !matchSrc && !matchTitle && !matchReason && !matchStack) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        errorsListEl.innerHTML = '<div class="yami-error-empty">'
          + (errors.length === 0 ? '后台运行健康，未捕获到任何未处理异常。' : '未检索到符合筛选条件的异常记录。')
          + '</div>';
        return;
      }

      // 3. 渲染卡片列表
      errorsListEl.innerHTML = filtered.map(function(err) {
        const a = err.analysis || {};
        const countBadge = (err.count && err.count > 1)
          ? '<span class="yami-error-count-badge" title="该错误已累计高频发生 ' + err.count + ' 次">[x' + err.count + '次]</span>'
          : '';

        const timeInfo = (err.count && err.count > 1)
          ? '首发 ' + (err.firstTime || err.time) + ' · 最近 ' + (err.latestTime || err.time)
          : (err.time || '');

        // 源码上下文预览块
        let codeSnippetHtml = '';
        if (err.codeContext && Array.isArray(err.codeContext.lines)) {
          const linesHtml = err.codeContext.lines.map(function(l) {
            return '<div class="yami-error-code-line ' + (l.isTarget ? 'target' : '') + '">'
              + '<span class="line-num">' + l.line + '</span>'
              + '<code>' + escapeHtml(l.content) + '</code>'
              + '</div>';
          }).join('');

          codeSnippetHtml = '<div class="yami-error-code-wrapper">'
            + '<div class="yami-error-code-header" data-toggle-code="' + err.id + '" role="button">'
            + '<span>[源码上下文] ' + escapeHtml(err.codeContext.fileName) + ' (第 ' + err.codeContext.targetLine + ' 行)</span>'
            + '<span style="font-size: 9px; color: #0080c0;" class="code-toggle-text">展开源码</span>'
            + '</div>'
            + '<div class="yami-error-code-box" id="code-box-' + err.id + '" style="display: none;">'
            + linesHtml
            + '</div>'
            + '</div>';
        }

        // 文件定位按钮
        const locateBtnHtml = (err.codeContext && err.codeContext.filePath)
          ? '<div class="yami-error-btn btn-locate-file" data-path="' + encodeURIComponent(err.codeContext.filePath) + '" role="button" title="在操作系统资源管理器中定位此文件">定位文件</div>'
          : '';

        return '<div class="yami-error-card">'
          + '<div class="yami-error-card-header">'
          + '<div style="display: flex; align-items: center;">'
          + '<span class="yami-error-type">[异常] ' + (CAT_LABEL[a.category] || a.category || err.type) + '</span>'
          + countBadge
          + '</div>'
          + '<span class="yami-error-time">' + timeInfo + '</span>'
          + '</div>'
          + '<div class="yami-error-msg">' + escapeHtml(err.message) + '</div>'
          + '<div class="yami-error-source">来源: ' + escapeHtml(err.source) + (err.lineno ? ' (第 ' + err.lineno + ' 行)' : '') + '</div>'
          + codeSnippetHtml
          + '<div class="yami-error-box">'
          + '<div style="font-weight: 600; margin-bottom: 2px;">诊断原因: ' + escapeHtml(a.title || '代码异常') + '</div>'
          + '<div>' + escapeHtml(a.reason || '运行期发生未处理错误') + '</div>'
          + '</div>'
          + '<div class="yami-error-tip">'
          + '<div style="font-weight: 600; margin-bottom: 2px;">建议排查:</div>'
          + '<div>' + escapeHtml(a.suggestion || '检查代码上下文与变量状态') + '</div>'
          + '</div>'
          + '<div class="yami-error-actions">'
          + locateBtnHtml
          + '<div class="yami-error-btn primary btn-copy-err-stack" data-stack="' + encodeURIComponent(err.stack || err.message) + '" role="button">复制调用栈</div>'
          + '</div>'
          + '</div>';
      }).join('');

      // 4. 事件绑定
      // 4.1 源码折叠展开
      errorsListEl.querySelectorAll('[data-toggle-code]').forEach(function(header) {
        header.addEventListener('click', function(e) {
          e.stopPropagation();
          const id = header.getAttribute('data-toggle-code');
          const box = document.getElementById('code-box-' + id);
          const toggleText = header.querySelector('.code-toggle-text');
          if (box) {
            const isHidden = box.style.display === 'none';
            box.style.display = isHidden ? 'block' : 'none';
            if (toggleText) toggleText.textContent = isHidden ? '收起源码' : '展开源码';
          }
        });
      });

      // 4.2 复制调用栈
      errorsListEl.querySelectorAll('.btn-copy-err-stack').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const raw = decodeURIComponent(btn.getAttribute('data-stack') || '');
          if (navigator.clipboard) {
            navigator.clipboard.writeText(raw).then(function() {
              showToast('错误调用栈已复制到剪贴板');
            });
          }
        });
      });

      // 4.3 定位文件
      errorsListEl.querySelectorAll('.btn-locate-file').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const filePath = decodeURIComponent(btn.getAttribute('data-path') || '');
          if (!filePath) return;
          try {
            if (typeof require === 'function') {
              const electron = require('electron');
              if (electron && electron.shell && electron.shell.showItemInFolder) {
                electron.shell.showItemInFolder(filePath);
                showToast('已在文件夹中高亮定位文件');
                return;
              }
            }
          } catch (err) {}
          showToast('文件路径: ' + filePath);
        });
      });
    }

    // 绑定报错工作台全局交互事件 (过滤器点击 + 搜索输入 + 导出报告 + 清空)
    function bindErrorsToolbarEvents() {
      const filterBarEl = document.getElementById('yami-error-filter-bar');
      if (filterBarEl) {
        filterBarEl.addEventListener('click', function(e) {
          const btn = e.target.closest('.yami-error-filter-btn');
          if (!btn) return;
          const filter = btn.getAttribute('data-filter');
          if (filter) {
            errorActiveFilter = filter;
            renderErrorsList();
          }
        });
      }

      const searchInput = document.getElementById('yami-error-search');
      if (searchInput) {
        searchInput.addEventListener('input', function(e) {
          errorSearchKeyword = e.target.value || '';
          renderErrorsList();
        });
      }

      const exportBtn = document.getElementById('btn-export-error-report');
      if (exportBtn) {
        exportBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          exportErrorReport();
        });
      }

}
        bindErrorsToolbarEvents();

    function updateHomeStatus() {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!probe) return;
      const errCount = probe.getErrorCount ? probe.getErrorCount() : 0;
      const snap = probe.state && probe.state.samples && probe.state.samples[probe.state.samples.length - 1];
      const fps = snap ? snap.fps : 60;
      const dc = snap ? snap.drawCalls : 0;

      if (homeStatusStatsEl) {
        homeStatusStatsEl.textContent = fps + ' FPS · ' + dc + ' DC';
      }

      if (errCount > 0) {
        if (homeStatusDotEl) {
          homeStatusDotEl.className = 'yami-dot-indicator red';
        }
        if (homeStatusTextEl) {
          homeStatusTextEl.innerHTML = '<span style="color: #ff4040; font-weight: 600;">' + errCount + ' 处异常</span>';
        }
        if (homeErrorBadgeEl) {
          homeErrorBadgeEl.className = 'yami-home-module-badge danger';
          homeErrorBadgeEl.textContent = errCount + ' 处';
        }
      } else {
        if (homeStatusDotEl) {
          homeStatusDotEl.className = 'yami-dot-indicator green';
        }
        if (homeStatusTextEl) {
          homeStatusTextEl.textContent = '运行健康';
        }
        if (homeErrorBadgeEl) {
          homeErrorBadgeEl.className = 'yami-home-module-badge green';
          homeErrorBadgeEl.textContent = '进入';
        }
      }
    }

    // 监听新错误事件 (胶囊红光抖动 + 下方气泡弹窗)
    // 已见错误 key 记忆: 进入过大盘(已读)或已提示过的同源错误不再重复打扰气泡;
    // 黑匣子列表、计数与主页徽章仍全量更新, 只有"新类型"错误才弹一次气泡。
    const seenErrorKeys = new Set();
    function errKeyOf(r) {
      return String((r && (r.message || '')) || '') + '|' + String((r && (r.source || '')) || '');
    }
    function markSeenExistingErrors() {
      try {
        const probe = window.__YAMI_PERF_PROBE__;
        const list = (probe && probe.getErrors) ? probe.getErrors() : [];
        for (const r of list) seenErrorKeys.add(errKeyOf(r));
        if (seenErrorKeys.size > 600) seenErrorKeys.clear();
      } catch (e) {}
    }
    let errorBubbleTimer = null;
    const errorBubbleEl = document.getElementById('yami-error-bubble');
    const errorBubbleTitleEl = document.getElementById('yami-error-bubble-title');
    const errorBubbleTextEl = document.getElementById('yami-error-bubble-text');
    const capsuleEl = document.getElementById('yami-capsule');

    if (errorBubbleEl) {
      errorBubbleEl.addEventListener('click', function(e) {
        e.stopPropagation();
        errorBubbleEl.classList.remove('show');
        switchView('errors');
        toggleDock(true);
      });
    }

    // 全局测试快捷指令: 在 F12 控制台敲 __testDanJuanError() 即可测试
    window.__testDanJuanError = function() {
      toggleDock(false);
      setTimeout(function() {
        console.error(new TypeError("DanJuan测试异常: Cannot read properties of undefined (reading 'hp')"));
      }, 500);
    };

    window.addEventListener('yami-perf-new-error', function(e) {
      updateHomeStatus();
      if (currentView === 'errors') {
        renderErrorsList();
      }

      // 已查看/已提示过的同源错误不再重复弹气泡
      const detail = e.detail;
      const freshType = !(detail && seenErrorKeys.has(errKeyOf(detail)));
      if (detail) seenErrorKeys.add(errKeyOf(detail));

      // 如果大盘未展开，触发右上角浮窗抖动 + 在浮窗下方弹窗显示
      if (!isDockOpen && freshType) {
        if (capsuleEl) {
          capsuleEl.classList.remove('shake');
          void capsuleEl.offsetWidth; // 触发 reflow 重置动画
          capsuleEl.classList.add('shake');
        }

        if (errorBubbleEl && errorBubbleTextEl) {
          const analysis = detail && detail.analysis;
          if (errorBubbleTitleEl) {
            errorBubbleTitleEl.textContent = (analysis && analysis.title) ? `[异常] ${analysis.title}` : '[控制台异常]';
          }
          const rawMsg = (detail && (detail.summary || detail.message)) ? (detail.summary || detail.message) : '捕获到未捕获错误';
          errorBubbleTextEl.textContent = rawMsg;
          errorBubbleEl.classList.add('show');

          if (errorBubbleTimer) clearTimeout(errorBubbleTimer);
          errorBubbleTimer = setTimeout(function() {
            errorBubbleEl.classList.remove('show');
          }, 4500);
        }
      }
    });

    
    // 显式注入的跨模块共享上下文
    const ctx = {
      get probe() { return window.__YAMI_PERF_PROBE__; },
      dock,
      hud,
      get isDockOpen() { return isDockOpen; },
      get isThrough() { return isThrough; },
      get currentMode() { return currentMode; },
      get currentView() { return currentView; },
      showToast,
      safeRestoreInput,
      safePreventInput,
      switchView,
      esc
    };

    // 页面 1: 主页大厅契约
    Views.register('home', {
      showExportBtns: false,
      title: 'DanJuan妙妙插件',
      showBack: false,
      showModeSwitch: false,
      showClearErrors: false,
      showTabs: false,
      mount(root, ctx) {},
      refresh(ctx) {
        updateHomeStatus();
      },
      destroy() {}
    });

    // 页面 2: 控制台报错黑匣子契约
    Views.register('errors', {
      showExportBtns: false,
      title: '控制台报错',
      showBack: true,
      showModeSwitch: false,
      showClearErrors: true,
      showTabs: false,
      mount(root, ctx) {
        renderErrorsList();
      },
      refresh(ctx) {
        renderErrorsList();
      },
      destroy() {}
    });

    // 页面 3: 性能排查与诊断契约
    Views.register('profiler', {
      showExportBtns: true,
      title: '性能分析',
      showBack: true,
      showModeSwitch: true,
      showClearErrors: false,
      showTabs: true,
      mount(root, ctx) {},
      refresh(ctx) {
        if (!isDockOpen) return;
        try {
          if (currentMode === 'simple') {
            if (typeof refreshSimpleDiagnosis === 'function') refreshSimpleDiagnosis();
          } else {
            if (typeof refreshDockData === 'function') refreshDockData();
          }
        } catch (e) {
          console.warn('[DanJuan profiler refresh warn]', e);
        }
      },
      destroy() {}
    });

    // 默认激活路由
    
    // ============================================================
    // DanJuan妙妙插件 · 存档台 (Save Lab) 微内核实现
    // ============================================================
    const SaveLab = {
      ctx: null,
      gameDir: '',
      saveFiles: [],
      currentSlot: '',
      currentData: null,
      currentMeta: null,
      currentSubTab: 'quick',
      varKeyword: '',
      dict: {
        guidMap: new Map(),
        attributes: new Map(),
        variables: new Map(),
        teams: new Map()
      },
      isDictLoaded: false,

      getGameDir() {
        try {
          if (typeof require !== 'undefined') {
            const fs = require('fs');
            const path = require('path');
            const os = require('os');

            // 1. 最高优先级：游戏试玩运行时环境 (Game Runtime)
            // 只要在试玩独立窗口中，window.location 即代表当前游戏绝对真实位置
            if (typeof window !== 'undefined' && window.location && window.location.pathname) {
              let p = decodeURIComponent(window.location.pathname);
              if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
              // 排除 Open Yami 编辑器自身安装路径
              if (!p.includes('resources/app') && !p.includes('resources\\app')) {
                let dir = path.dirname(p);
                for (let i = 0; i < 5; i++) {
                  if (fs.existsSync(path.join(dir, 'Data', 'manifest.json')) || fs.existsSync(path.join(dir, 'Save'))) {
                    this.gameDir = dir.replace(/\\/g, '/');
                    return this.gameDir;
                  }
                  const parent = path.dirname(dir);
                  if (parent === dir) break;
                  dir = parent;
                }
              }
            }

            // 2. 次高优先级：Open Yami 编辑器主窗口环境 (Editor Host)
            if (typeof document !== 'undefined') {
              let isWelcomeHome = false;
              try {
                // Open Yami 原生 PageManager 状态识别
                const manager = document.getElementById('workspace-page-manager');
                if (manager && manager.index === 'home') isWelcomeHome = true;
                const visibleHome = document.querySelector('page-frame[value="home"].visible');
                if (visibleHome) isWelcomeHome = true;
              } catch (e) {}

              // 若确认为编辑器启动时的空白欢迎页且未打开任何工程，则不盲目扫描
              if (isWelcomeHome) {
                this.gameDir = '';
                return '';
              }
            }

            // 3. 编辑器已打开工程：通过 window.File.root 获取
            if (typeof window !== 'undefined' && window.File && typeof window.File.root === 'string' && window.File.root) {
              const root = window.File.root.replace(/[\\/]+$/, '').replace(/\\/g, '/');
              if (fs.existsSync(root) && (fs.existsSync(path.join(root, 'Data')) || fs.existsSync(path.join(root, 'Save')))) {
                this.gameDir = root;
                return root;
              }
            }

            // 4. 编辑器全自动跟随：从 ~/.openyami/config.json 获取当前打开的 project
            try {
              const cfgPath = path.join(os.homedir(), '.openyami', 'config.json');
              if (fs.existsSync(cfgPath)) {
                const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                if (cfg && typeof cfg.project === 'string' && cfg.project) {
                  const pDir = path.dirname(cfg.project).replace(/\\/g, '/');
                  if (fs.existsSync(pDir) && (fs.existsSync(path.join(pDir, 'Data')) || fs.existsSync(path.join(pDir, 'Save')))) {
                    this.gameDir = pDir;
                    return pDir;
                  }
                }
              }
            } catch (errCfg) {}

            // 5. 进程当前工作目录探测 (排除编辑器安装路径)
            if (typeof process !== 'undefined' && process.cwd) {
              const cwd = process.cwd().replace(/\\/g, '/');
              if (!cwd.includes('Open Yami RPG Editor') && (fs.existsSync(path.join(cwd, 'Data')) || fs.existsSync(path.join(cwd, 'Save')))) {
                this.gameDir = cwd;
                return cwd;
              }
            }
          }
        } catch (e) {
          console.warn('[SaveLab] 检测工程异常:', e);
        }
        this.gameDir = '';
        return '';
      },

      loadDictionaries() {
        try {
          if (typeof require === 'undefined') return;
          const fs = require('fs');
          const path = require('path');
          const dir = this.getGameDir();
          if (!dir) return;

          // 1. Data/manifest.json -> GUID 中文字典
          const manifestPath = path.join(dir, 'Data', 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            for (const [type, group] of Object.entries(manifest)) {
              if (Array.isArray(group)) {
                for (const item of group) {
                  if (item && item.path) {
                    const m = String(item.path).match(/\.([0-9a-f]{16})\.\S+$/);
                    if (m) {
                      const guid = m[1];
                      const base = String(item.path).split('/').pop() || item.path;
                      const disp = base.replace(/\.[0-9a-f]{16}\.\S+$/, '').replace(/\.[^.]+$/, '');
                      this.dict.guidMap.set(guid, { type, display: disp, fullPath: item.path });
                    }
                  }
                }
              }
            }
          }

          // 2. Data/variables.json -> 变量与开关完整元信息字典 (名称、类型、分组文件夹、备注)
          const varsPath = path.join(dir, 'Data', 'variables.json');
          if (fs.existsSync(varsPath)) {
            const vData = JSON.parse(fs.readFileSync(varsPath, 'utf8'));
            const walk = (items, folderName = '') => {
              if (!Array.isArray(items)) return;
              for (const it of items) {
                if (it && it.id && it.name) {
                  this.dict.variables.set(it.id, {
                    id: it.id,
                    name: it.name,
                    type: typeof it.value,
                    defaultValue: it.value,
                    folder: folderName || '默认分组',
                    note: it.note || ''
                  });
                }
                if (it && it.children) {
                  walk(it.children, it.name || folderName);
                }
              }
            };
            walk(Array.isArray(vData) ? vData : (vData.list || []));
          }

          // 3. Data/attribute.json -> 属性名 (包含 aData.keys)
          const attrPath = path.join(dir, 'Data', 'attribute.json');
          if (fs.existsSync(attrPath)) {
            const aData = JSON.parse(fs.readFileSync(attrPath, 'utf8'));
            const walkAttr = (items) => {
              if (!Array.isArray(items)) return;
              for (const it of items) {
                if (it && it.key && it.name) this.dict.attributes.set(it.key, it.name);
                if (it && it.id && it.name) this.dict.attributes.set(it.id, it.name);
                if (it && it.children) walkAttr(it.children);
              }
            };
            walkAttr(Array.isArray(aData) ? aData : (aData.keys || aData.list || []));
          }

          this.isDictLoaded = true;
        } catch (e) {
          console.warn('[SaveLab] 字典加载异常:', e);
        }
      },

      scanSaveFiles() {
        try {
          if (typeof require === 'undefined') return;
          const fs = require('fs');
          const path = require('path');
          const saveDir = path.join(this.getGameDir(), 'Save');
          if (!fs.existsSync(saveDir)) {
            this.saveFiles = [];
            return;
          }
          const files = fs.readdirSync(saveDir);

          // 兼容 .save (Yami 原生真实存档) 与 .json 格式，排除临时与备份文件
          this.saveFiles = files
            .filter(f => {
              if (f.startsWith('.') || f.endsWith('.bak') || f.endsWith('.tmp') || f.endsWith('.meta')) return false;
              return f.endsWith('.save') || f.endsWith('.json');
            })
            .map(name => {
              const fullPath = path.join(saveDir, name);
              const stat = fs.statSync(fullPath);
              const isSaveExt = name.endsWith('.save');
              return {
                name,
                path: fullPath,
                mtime: stat.mtimeMs,
                size: stat.size,
                priority: isSaveExt ? 1 : 0
              };
            })
            .sort((a, b) => {
              if (b.priority !== a.priority) return b.priority - a.priority;
              return b.mtime - a.mtime;
            });

          if (!this.currentSlot || !this.saveFiles.some(f => f.name === this.currentSlot)) {
            if (this.saveFiles.length > 0) this.currentSlot = this.saveFiles[0].name;
            else this.currentSlot = '';
          }
        } catch (e) {
          console.warn('[SaveLab] 扫描存档失败:', e);
        }
      },

      loadCurrentSave() {
        if (!this.currentSlot) {
          this.currentData = null;
          this.currentMeta = null;
          return;
        }
        try {
          const fs = require('fs');
          const path = require('path');
          const saveDir = path.join(this.getGameDir(), 'Save');
          const p = path.join(saveDir, this.currentSlot);
          if (fs.existsSync(p)) {
            this.currentData = JSON.parse(fs.readFileSync(p, 'utf8'));
          } else {
            this.currentData = null;
          }

          // 尝试读取同名 .meta 文件 (获取时间戳与高清截图)
          const baseName = this.currentSlot.replace(/\.(save|json)$/i, '');
          const metaPath = path.join(saveDir, baseName + '.meta');
          if (fs.existsSync(metaPath)) {
            this.currentMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          } else {
            this.currentMeta = null;
          }
        } catch (e) {
          this.currentData = null;
          this.currentMeta = null;
        }
      },

      formatTime(sec) {
        if (typeof sec !== 'number' || isNaN(sec)) return '--:--:--';
        const s = Math.floor(sec);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sc = s % 60;
        return [h, m, sc].map(v => String(v).padStart(2, '0')).join(':');
      },

      formatRelativeTime(mtime) {
        const diff = Math.max(0, Math.floor((Date.now() - mtime) / 1000));
        if (diff < 60) return '刚刚';
        if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
        if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
        const d = new Date(mtime);
        return (d.getMonth() + 1) + '-' + d.getDate();
      },

      getLeadActor(data) {
        if (!data || !Array.isArray(data.actors) || data.actors.length === 0) return null;
        const playerFileId = data.party && data.party.player;
        if (playerFileId) {
          const found = data.actors.find(a => a.fileId === playerFileId || a.entityId === playerFileId);
          if (found) return found;
        }
        return data.actors[0];
      },

      render() {
        const root = document.getElementById('yami-save-root');
        if (!root) return;

        // 每次 render 均实时探测当前工程 (跟随用户切换工程)
        const dir = this.getGameDir();
        if (dir && this.dict.variables.size === 0) {
          this.loadDictionaries();
        }
        if (!dir) {
          root.innerHTML = `
            <div style="text-align: center; color: #808080; padding: 50px 14px;">
              <div style="font-size: 13px; font-weight: 600; color: #ffffff; margin-bottom: 8px;">[未打开游戏工程]</div>
              <div style="font-size: 11px; color: #a0a0a0; line-height: 1.6; margin-bottom: 16px;">
                Open Yami 当前处于欢迎页或未打开工程<br>
                在编辑器中打开工程后即可自动显示
              </div>
              <div class="yami-save-act-btn primary" id="save-btn-rescan" style="display: inline-flex; width: auto; padding: 6px 20px;" role="button">
                检测并同步当前工程
              </div>
            </div>
          `;
          const rescanBtn = root.querySelector('#save-btn-rescan');
          if (rescanBtn) {
            rescanBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.isDictLoaded = false;
              this.gameDir = '';
              this.init(this.ctx);
              if (this.ctx && this.ctx.showToast) {
                const nowDir = this.getGameDir();
                if (nowDir) this.ctx.showToast('已成功识别当前工程: ' + nowDir, 2000);
                else this.ctx.showToast('未检测到已打开的工程，请先打开项目', 2000);
              }
            });
          }
          return;
        }

        if (this.saveFiles.length === 0) {
          root.innerHTML = `
            <div style="text-align: center; color: #808080; padding: 40px 14px;">
              <div style="font-size: 13px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">[当前工程暂无存档]</div>
              <div style="font-size: 11px; color: #888888; margin-bottom: 6px; word-break: break-all;">已连接工程: ${dir}</div>
              <div style="font-size: 11px; color: #a0a0a0;">请在游戏内执行一次【保存】或【自动存档】</div>
              <div class="yami-save-act-btn default" id="save-btn-rescan" style="display: inline-flex; width: auto; margin-top: 14px; padding: 5px 16px;" role="button">
                重新扫描存档
              </div>
            </div>
          `;
          const rescanBtn = root.querySelector('#save-btn-rescan');
          if (rescanBtn) {
            rescanBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.refresh();
              if (this.ctx && this.ctx.showToast) this.ctx.showToast('已重新扫描存档目录', 1500);
            });
          }
          return;
        }

        const data = this.currentData || {};

        // 1. 顶部槽位条
        const slotsHtml = this.saveFiles.map(f => {
          const isActive = f.name === this.currentSlot;
          let label = f.name.replace(/\.(save|json)$/i, '');
          if (label.toLowerCase() === 'global') label = '全局 (Global)';
          else if (label.toLowerCase() === 'autosave') label = '自动存档';
          else if (/^save\d+$/i.test(label)) label = '存档 ' + label.replace(/[^0-9]/g, '');

          const relTime = this.formatRelativeTime(f.mtime);
          return `<div class="yami-save-slot-btn ${isActive ? 'active' : ''}" data-slot="${f.name}" role="button" title="${label} (${relTime})">
            <span class="yami-save-slot-title">${label}</span>
            <span class="yami-save-slot-time">${relTime}</span>
          </div>`;
        }).join('');

        // 2. 便当盒核心数据
        const playTimeStr = this.formatTime(data.playTime);
        const lead = this.getLeadActor(data);

        // 金钱 (优先从 lead.inventory.money 读取，其次从 data.gold / data.money)
        let goldVal = 0;
        if (lead && lead.inventory && typeof lead.inventory.money === 'number') {
          goldVal = lead.inventory.money;
        } else if (typeof data.gold === 'number') {
          goldVal = data.gold;
        } else if (typeof data.money === 'number') {
          goldVal = data.money;
        }

        // 队伍领队信息
        let actorDesc = '暂无队伍信息';
        if (lead) {
          let actorName = lead.name;
          if (!actorName && lead.fileId && this.dict.guidMap.has(lead.fileId)) {
            actorName = this.dict.guidMap.get(lead.fileId).display;
          }
          if (!actorName) actorName = '主角';
          const lv = (lead.attributes && lead.attributes.level !== undefined) ? lead.attributes.level : (lead.level || 1);
          actorDesc = `Lv.${lv} ${actorName}`;
        }

        // 地图名称 (优先从 scene.contexts[active].id 解密)
        let sceneName = '未知区域';
        if (data.scene) {
          let sceneGuid = '';
          if (Array.isArray(data.scene.contexts) && data.scene.contexts.length > 0) {
            const actIdx = data.scene.active || 0;
            const ctx = data.scene.contexts[actIdx] || data.scene.contexts[0];
            if (ctx && ctx.id) sceneGuid = ctx.id;
          } else if (typeof data.scene === 'string') {
            sceneGuid = data.scene;
          } else if (data.scene.id) {
            sceneGuid = data.scene.id;
          }

          if (sceneGuid && this.dict.guidMap.has(sceneGuid)) {
            sceneName = this.dict.guidMap.get(sceneGuid).display;
          } else if (sceneGuid) {
            sceneName = '地图 ' + String(sceneGuid).slice(0, 8);
          }
        }

        // 截图预览 (若有 meta screenshot)
        let screenshotHtml = '';
        if (this.currentMeta && this.currentMeta.screenshot) {
          screenshotHtml = `
            <div style="margin-top: 6px; border-radius: 4px; overflow: hidden; max-height: 90px; border: 1px solid #282828;">
              <img src="${this.currentMeta.screenshot}" style="width: 100%; height: 90px; object-fit: cover; display: block;" />
            </div>
          `;
        }

        // 3. 子模式导航
        const subNavHtml = `
          <div class="yami-save-subnav">
            <div class="yami-save-subnav-btn ${this.currentSubTab === 'quick' ? 'active' : ''}" data-subtab="quick" role="button">常用速改</div>
            <div class="yami-save-subnav-btn ${this.currentSubTab === 'vars' ? 'active' : ''}" data-subtab="vars" role="button">变量与开关</div>
            <div class="yami-save-subnav-btn ${this.currentSubTab === 'tree' ? 'active' : ''}" data-subtab="tree" role="button">JSON 树形图</div>
          </div>
        `;

        // 4. 当前子面板内容
        let panelHtml = '';
        if (this.currentSubTab === 'quick') {
          panelHtml = this.renderQuickPanel(data, lead, goldVal);
        } else if (this.currentSubTab === 'vars') {
          panelHtml = this.renderVarsPanel(data);
        } else if (this.currentSubTab === 'tree') {
          panelHtml = this.renderTreePanel(data);
        }

        root.innerHTML = `
          <div class="yami-save-slots-wrap">
            ${slotsHtml}
          </div>

          <div class="yami-save-bento">
            <div class="yami-save-bento-cell">
              <span class="yami-save-bento-label">游玩时长</span>
              <span class="yami-save-bento-value">${playTimeStr}</span>
            </div>
            <div class="yami-save-bento-cell">
              <span class="yami-save-bento-label">持有金钱</span>
              <span class="yami-save-bento-value highlight">${goldVal.toLocaleString()} G</span>
            </div>
            <div class="yami-save-bento-cell">
              <span class="yami-save-bento-label">队伍领队</span>
              <span class="yami-save-bento-value blue">${actorDesc}</span>
            </div>
            <div class="yami-save-bento-cell">
              <span class="yami-save-bento-label">当前位置</span>
              <span class="yami-save-bento-value">${sceneName}</span>
            </div>
          </div>
          ${screenshotHtml}

          ${subNavHtml}

          <div class="yami-save-panel">
            ${panelHtml}
          </div>

          <div class="yami-save-footer-actions">
            <div class="yami-save-act-btn default" id="save-btn-open-backups" role="button">备份目录</div>
            <div class="yami-save-act-btn primary" id="save-btn-commit" role="button">保存并写回存档</div>
          </div>
        `;

        this.bindEvents(root);
      },

      renderQuickPanel(data, lead, goldVal) {
        let hpVal = 100, maxHpVal = 100, mpVal = 50, maxMpVal = 50, lvVal = 1;
        if (lead) {
          const attr = lead.attributes || {};
          lvVal = attr.level !== undefined ? attr.level : (lead.level || 1);
          hpVal = attr.health !== undefined ? attr.health : (attr.hp !== undefined ? attr.hp : 100);
          maxHpVal = attr.maxHealth !== undefined ? attr.maxHealth : (attr.maxHp !== undefined ? attr.maxHp : hpVal);
          mpVal = attr.mana !== undefined ? attr.mana : (attr.mp !== undefined ? attr.mp : 50);
          maxMpVal = attr.maxMana !== undefined ? attr.maxMana : (attr.maxMp !== undefined ? attr.maxMp : mpVal);
        }

        return `
          <div class="yami-save-quick-scroll">
            <div class="yami-save-section-card">
              <div class="yami-save-section-head">
                <span>金钱修改</span>
                <span style="font-size: 10px; color: #666666;">单位: G</span>
              </div>
              <div class="yami-save-form-row">
                <span class="yami-save-form-label">金钱数量</span>
                <div class="yami-save-input-group">
                  <input class="yami-save-input" id="quick-input-gold" type="number" value="${goldVal}" />
                  <div class="yami-save-mini-btn" data-act="gold-add" data-val="1000" role="button">+1000</div>
                  <div class="yami-save-mini-btn" data-act="gold-add" data-val="10000" role="button">+1万</div>
                  <div class="yami-save-mini-btn primary" data-act="gold-set" data-val="999999" role="button">满金币</div>
                </div>
              </div>
            </div>

            <div class="yami-save-section-card">
              <div class="yami-save-section-head">
                <span>领队状态调整</span>
                <div class="yami-save-mini-btn primary" data-act="heal-all" role="button">一键回满</div>
              </div>
              <div class="yami-save-form-row">
                <span class="yami-save-form-label">等级 (Level)</span>
                <div class="yami-save-input-group">
                  <input class="yami-save-input" id="quick-input-level" type="number" min="1" max="99" value="${lvVal}" />
                  <div class="yami-save-mini-btn" data-act="lv-add" data-val="1" role="button">+1级</div>
                  <div class="yami-save-mini-btn" data-act="lv-set" data-val="99" role="button">满级</div>
                </div>
              </div>
              <div class="yami-save-form-row">
                <span class="yami-save-form-label">当前生命 (HP)</span>
                <div class="yami-save-input-group">
                  <input class="yami-save-input" id="quick-input-hp" type="number" value="${hpVal}" />
                  <span style="color: #666; font-size: 11px;">/ ${maxHpVal}</span>
                </div>
              </div>
              <div class="yami-save-form-row">
                <span class="yami-save-form-label">当前魔法 (MP)</span>
                <div class="yami-save-input-group">
                  <input class="yami-save-input" id="quick-input-mp" type="number" value="${mpVal}" />
                  <span style="color: #666; font-size: 11px;">/ ${maxMpVal}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      },

      renderVarsPanel(data) {
        // 保证字典实时可用
        if (this.dict.variables.size === 0) {
          this.loadDictionaries();
        }

        const varsObj = data.variables || {};
        const switchesObj = data.switches || {};
        const allKeys = Array.from(new Set([...Object.keys(varsObj), ...Object.keys(switchesObj), ...this.dict.variables.keys()]));

        const kw = this.varKeyword.toLowerCase().trim();
        const items = [];

        for (const key of allKeys) {
          const meta = this.dict.variables.get(key);
          let name = '';
          let folder = '未分类';
          let type = 'number';
          let note = '';

          if (meta) {
            if (typeof meta === 'string') {
              name = meta;
            } else {
              name = meta.name || '';
              folder = meta.folder || '未分类';
              type = meta.type || 'number';
              note = meta.note || '';
            }
          }
          if (!name) name = '变量 ' + key;

          // 综合判断是否为布尔开关 (Switch)
          const currentVal = switchesObj[key] !== undefined ? switchesObj[key] : varsObj[key];
          const isSwitch = (type === 'boolean') || (typeof currentVal === 'boolean') || (switchesObj[key] !== undefined);

          if (kw) {
            const matchName = name.toLowerCase().includes(kw);
            const matchKey = String(key).toLowerCase().includes(kw);
            const matchFolder = folder.toLowerCase().includes(kw);
            if (!matchName && !matchKey && !matchFolder) continue;
          }

          items.push({
            key,
            name,
            folder,
            type,
            note,
            isSwitch,
            val: currentVal !== undefined ? currentVal : (meta && meta.defaultValue !== undefined ? meta.defaultValue : (isSwitch ? false : 0))
          });
        }

        // 优先展示已有存档值的变量，其次按分类和名称排序
        items.sort((a, b) => {
          const aHas = (varsObj[a.key] !== undefined || switchesObj[a.key] !== undefined) ? 1 : 0;
          const bHas = (varsObj[b.key] !== undefined || switchesObj[b.key] !== undefined) ? 1 : 0;
          if (bHas !== aHas) return bHas - aHas;
          if (a.folder !== b.folder) return a.folder.localeCompare(b.folder, 'zh-Hans-CN');
          return a.name.localeCompare(b.name, 'zh-Hans-CN');
        });

        const listHtml = items.slice(0, 100).map(it => {
          const typeTag = it.isSwitch ? '[开关]' : (it.type === 'string' ? '[文本]' : '[数值]');
          const tagColor = it.isSwitch ? '#4ade80' : (it.type === 'string' ? '#38bdf8' : '#eab308');

          if (it.isSwitch) {
            const checked = Boolean(it.val);
            return `
              <div class="yami-save-var-item">
                <div class="yami-save-var-meta">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="yami-save-var-name">${it.name}</span>
                    <span style="font-size: 9px; padding: 1px 4px; border-radius: 2px; background: #141414; color: ${tagColor}; border: 1px solid #282828;">${typeTag}</span>
                    <span style="font-size: 9px; color: #808080;">${it.folder}</span>
                  </div>
                  <span class="yami-save-var-id">ID: ${it.key}${it.note ? (' · ' + it.note) : ''}</span>
                </div>
                <label class="yami-save-toggle">
                  <input type="checkbox" class="var-switch-input" data-key="${it.key}" ${checked ? 'checked' : ''} />
                  <span class="yami-save-toggle-slider"></span>
                </label>
              </div>
            `;
          } else {
            const displayVal = it.val !== undefined ? it.val : '';
            return `
              <div class="yami-save-var-item">
                <div class="yami-save-var-meta">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="yami-save-var-name">${it.name}</span>
                    <span style="font-size: 9px; padding: 1px 4px; border-radius: 2px; background: #141414; color: ${tagColor}; border: 1px solid #282828;">${typeTag}</span>
                    <span style="font-size: 9px; color: #808080;">${it.folder}</span>
                  </div>
                  <span class="yami-save-var-id">ID: ${it.key}${it.note ? (' · ' + it.note) : ''}</span>
                </div>
                <input class="yami-save-input var-number-input" data-key="${it.key}" type="text" value="${displayVal}" style="width: 110px; text-align: right;" />
              </div>
            `;
          }
        }).join('');

        return `
          <div class="yami-save-section-card yami-save-vars-wrapper">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-shrink: 0;">
              <span class="yami-save-section-title">变量与开关检视 (${items.length} 项)</span>
              <input class="yami-save-search-input" id="save-vars-search" type="text" placeholder="搜索变量/开关名称或ID..." value="${this.varKeyword}" style="width: 180px;" />
            </div>
            <div class="yami-save-var-list">
              ${listHtml || '<div style="text-align: center; color: #666666; padding: 20px;">未搜索到匹配的变量或开关</div>'}
            </div>
          </div>
        `;
      },

      renderTreePanel(data) {
        const jsonStr = JSON.stringify(data, null, 2);
        return `
          <div class="yami-save-tree-wrapper">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
              <span style="font-size: 11px; color: #888888;">原始 JSON 快速检视</span>
              <div class="yami-save-mini-btn primary" id="save-btn-copy-raw" role="button">复制全量 JSON</div>
            </div>
            <div class="yami-save-tree-box">
              <pre style="margin: 0; white-space: pre-wrap; word-break: break-all; font-family: Consolas, monospace; font-size: 11px; color: #90d4ff;">${jsonStr.slice(0, 25000) + (jsonStr.length > 25000 ? '\n\n... (数据过长已截断预览)' : '')}</pre>
            </div>
          </div>
        `;
      },

      bindEvents(root) {
        root.querySelectorAll('.yami-save-slot-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const slot = btn.getAttribute('data-slot');
            if (slot && slot !== this.currentSlot) {
              this.currentSlot = slot;
              this.loadCurrentSave();
              this.render();
            }
          });
        });

        root.querySelectorAll('.yami-save-subnav-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const subtab = btn.getAttribute('data-subtab');
            if (subtab) {
              this.currentSubTab = subtab;
              this.render();
            }
          });
        });

        const searchInput = root.querySelector('#save-vars-search');
        if (searchInput) {
          searchInput.addEventListener('input', (e) => {
            this.varKeyword = e.target.value;
            const listEl = root.querySelector('.yami-save-vars-list');
            if (listEl) {
              const newHtml = this.renderVarsPanel(this.currentData || {});
              const temp = document.createElement('div');
              temp.innerHTML = newHtml;
              const newList = temp.querySelector('.yami-save-vars-list');
              if (newList) listEl.innerHTML = newList.innerHTML;
              this.bindVarInputs(root);
            }
          });
        }

        root.querySelectorAll('[data-act]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = btn.getAttribute('data-act');
            const val = Number(btn.getAttribute('data-val'));
            const data = this.currentData;
            if (!data) return;

            const lead = this.getLeadActor(data);

            if (act === 'gold-add') {
              let cur = 0;
              if (lead && lead.inventory && typeof lead.inventory.money === 'number') cur = lead.inventory.money;
              else if (typeof data.gold === 'number') cur = data.gold;
              else if (typeof data.money === 'number') cur = data.money;

              const next = cur + val;
              if (lead && lead.inventory) lead.inventory.money = next;
              if (data.gold !== undefined) data.gold = next;
              if (data.money !== undefined) data.money = next;

              const inp = root.querySelector('#quick-input-gold');
              if (inp) inp.value = next;
              this.ctx.showToast(`金币已调整为: ${next} G`, 1500);
            } else if (act === 'gold-set') {
              if (lead && lead.inventory) lead.inventory.money = val;
              if (data.gold !== undefined) data.gold = val;
              if (data.money !== undefined) data.money = val;

              const inp = root.querySelector('#quick-input-gold');
              if (inp) inp.value = val;
              this.ctx.showToast(`金币已设置为: ${val} G`, 1500);
            } else if (act === 'lv-add') {
              if (lead) {
                if (!lead.attributes) lead.attributes = {};
                lead.attributes.level = (lead.attributes.level || lead.level || 1) + val;
                lead.level = lead.attributes.level;
                const inp = root.querySelector('#quick-input-level');
                if (inp) inp.value = lead.attributes.level;
                this.ctx.showToast(`领队等级调整为: Lv.${lead.attributes.level}`, 1500);
              }
            } else if (act === 'lv-set') {
              if (lead) {
                if (!lead.attributes) lead.attributes = {};
                lead.attributes.level = val;
                lead.level = val;
                const inp = root.querySelector('#quick-input-level');
                if (inp) inp.value = val;
                this.ctx.showToast(`领队等级调整为: Lv.${val}`, 1500);
              }
            } else if (act === 'heal-all') {
              if (Array.isArray(data.actors)) {
                for (const actor of data.actors) {
                  const attr = actor.attributes || {};
                  const maxH = attr.maxHealth || attr.maxHp || 100;
                  const maxM = attr.maxMana || attr.maxMp || 50;
                  attr.health = maxH;
                  attr.mana = maxM;
                  actor.hp = maxH;
                  actor.mp = maxM;
                }
                this.ctx.showToast('[全员恢复] 队伍全体生命与魔法已回满！', 2000);
                this.render();
              }
            }
          });
        });

        this.bindVarInputs(root);

        const copyRawBtn = root.querySelector('#save-btn-copy-raw');
        if (copyRawBtn) {
          copyRawBtn.addEventListener('click', () => {
            const str = JSON.stringify(this.currentData, null, 2);
            navigator.clipboard.writeText(str).then(() => {
              this.ctx.showToast('全量存档数据已复制到剪贴板', 2000);
            });
          });
        }

        const openBakBtn = root.querySelector('#save-btn-open-backups');
        if (openBakBtn) {
          openBakBtn.addEventListener('click', () => {
            try {
              const { shell } = require('electron');
              const path = require('path');
              const bakDir = path.join(this.getGameDir(), 'Save', 'Backups');
              const fs = require('fs');
              if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
              shell.openPath(bakDir);
            } catch (e) {
              this.ctx.showToast('无法打开备份目录: ' + e.message, 2500);
            }
          });
        }

        const commitBtn = root.querySelector('#save-btn-commit');
        if (commitBtn) {
          commitBtn.addEventListener('click', () => {
            this.commitChanges();
          });
        }
      },

      bindVarInputs(root) {
        root.querySelectorAll('.var-switch-input').forEach(sw => {
          sw.addEventListener('change', (e) => {
            const key = sw.getAttribute('data-key');
            const checked = e.target.checked;
            if (!this.currentData) return;
            if (!this.currentData.switches) this.currentData.switches = {};
            this.currentData.switches[key] = checked;
            if (this.currentData.variables && this.currentData.variables[key] !== undefined) {
              this.currentData.variables[key] = checked;
            }
            this.ctx.showToast(`开关 [${this.dict.variables.get(key) || key}] 切换为: ${checked ? 'ON' : 'OFF'}`, 1500);
          });
        });

        root.querySelectorAll('.var-number-input').forEach(inp => {
          inp.addEventListener('change', (e) => {
            const key = inp.getAttribute('data-key');
            let val = e.target.value;
            if (!isNaN(Number(val)) && val.trim() !== '') val = Number(val);
            if (!this.currentData) return;
            if (!this.currentData.variables) this.currentData.variables = {};
            this.currentData.variables[key] = val;
            this.ctx.showToast(`变量 [${this.dict.variables.get(key) || key}] 改为: ${val}`, 1500);
          });
        });
      },

      commitChanges() {
        if (!this.currentSlot || !this.currentData) {
          this.ctx.showToast('[异常] 没有可写入的有效存档数据', 2000);
          return;
        }

        const lead = this.getLeadActor(this.currentData);

        const goldInp = document.getElementById('quick-input-gold');
        if (goldInp) {
          const gVal = Number(goldInp.value);
          if (!isNaN(gVal)) {
            if (lead && lead.inventory) lead.inventory.money = gVal;
            if (this.currentData.gold !== undefined) this.currentData.gold = gVal;
            if (this.currentData.money !== undefined) this.currentData.money = gVal;
          }
        }
        const lvInp = document.getElementById('quick-input-level');
        if (lvInp && lead) {
          const lv = Number(lvInp.value);
          if (!isNaN(lv)) {
            if (!lead.attributes) lead.attributes = {};
            lead.attributes.level = lv;
            lead.level = lv;
          }
        }
        const hpInp = document.getElementById('quick-input-hp');
        if (hpInp && lead) {
          const hp = Number(hpInp.value);
          if (!isNaN(hp)) {
            if (!lead.attributes) lead.attributes = {};
            lead.attributes.health = hp;
            lead.hp = hp;
          }
        }
        const mpInp = document.getElementById('quick-input-mp');
        if (mpInp && lead) {
          const mp = Number(mpInp.value);
          if (!isNaN(mp)) {
            if (!lead.attributes) lead.attributes = {};
            lead.attributes.mana = mp;
            lead.mp = mp;
          }
        }

        try {
          const fs = require('fs');
          const path = require('path');
          const saveDir = path.join(this.getGameDir(), 'Save');
          const filePath = path.join(saveDir, this.currentSlot);

          const bakDir = path.join(saveDir, 'Backups');
          if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });

          const now = new Date();
          const ts = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '_' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0') + String(now.getSeconds()).padStart(2,'0');
          const bakFile = path.join(bakDir, `${this.currentSlot.replace(/\.(save|json)$/i, '')}_${ts}.bak`);

          if (fs.existsSync(filePath)) {
            fs.copyFileSync(filePath, bakFile);
          }

          fs.writeFileSync(filePath, JSON.stringify(this.currentData, null, 2), 'utf8');

          this.ctx.showToast(`[完成] 存档 ${this.currentSlot} 已成功保存，并生成安全备份！`, 3000);
          this.refresh();
        } catch (e) {
          this.ctx.showToast('[失败] 写入存档失败: ' + e.message, 3500);
        }
      },

      init(ctx) {
        this.ctx = ctx;
        this.loadDictionaries();
        this.scanSaveFiles();
        this.loadCurrentSave();
        this.render();
      },

      refresh(ctx) {
        if (ctx) this.ctx = ctx;
        this.scanSaveFiles();
        this.loadCurrentSave();
        this.render();
      },

      destroy() {}
    };

    Views.register('save', {
      showExportBtns: false,
      title: '存档管理',
      showBack: true,
      showModeSwitch: false,
      showClearErrors: false,
      showTabs: false,
      mount(root, ctx) {
        SaveLab.init(ctx);
      },
      refresh(ctx) {
        SaveLab.refresh(ctx);
      },
      destroy() {
        SaveLab.destroy();
      }
    });

    // ============================================================
    // DanJuan妙妙插件 · 场景实体检查台 (Scene Inspector) 微内核实现
    // 数据通道: probe.getSceneEntities() 500ms 节流轮询, 快照 JSON 相等则跳过重建
    // ============================================================
    const SceneLab = {
      ctx: null,
      root: null,
      kw: '',
      kind: 'all',          // all | actors | regions
      onlyVisible: false,
      open: {},             // 展开行 key 集: 角色 l0/g1, 区域 r0 (key 存源数组索引)
      limit: 200,
      lastJson: '',
      lastPullAt: 0,
      snap: null,

      init(ctx) {
        this.ctx = ctx;
        this._ensureRoot();
        this.refresh(ctx);
      },

      _ensureRoot() {
        if (!this.root) this.root = document.getElementById('yami-scene-root');
        if (!this._bound && this.root) {
          this._bound = true;
          this.root.addEventListener('click', this._onClick.bind(this));
          this.root.addEventListener('input', this._onInput.bind(this));
        }
      },

      refresh(ctx) {
        if (ctx) this.ctx = ctx;
        this._ensureRoot();
        const now = Date.now();
        if (now - this.lastPullAt < 500) return;   // ponytail: 500ms 轮询节流, 确有更实时需求再降
        this.lastPullAt = now;
        let probe = null;
        if (ctx && typeof ctx.probe === 'function') {
          try { probe = ctx.probe(); } catch (e) {}
        }
        if (!probe && typeof window !== 'undefined') probe = window.__YAMI_PERF_PROBE__;
        if (!probe || typeof probe.getSceneEntities !== 'function') return;
        let snap = null;
        try { snap = probe.getSceneEntities(); } catch (e) { snap = null; }
        if (!snap) return;
        const json = JSON.stringify(snap);
        if (json === this.lastJson && this.root && this.root.innerHTML) return;
        this.lastJson = json;
        this.snap = snap;
        this.render();
      },

      destroy() {
        this.open = {};
        this.lastJson = '';
        this.snap = null;
        this.root = null;
        this._bound = false;
        this.ctx = null;
      },

      _onClick(e) {
        const t = e.target || e;
        const row = t.closest ? t.closest('[data-open-key]') : null;
        if (row) { this._toggleDetail(row.getAttribute('data-open-key'), row); return; }
        const chip = t.closest ? t.closest('[data-kind]') : null;
        if (chip) { this.kind = chip.getAttribute('data-kind'); this.render(); return; }
        const vis = t.closest ? t.closest('[data-role="yami-scene-vis"]') : null;
        if (vis) { this.onlyVisible = !this.onlyVisible; this.render(); }
      },

      _onInput(e) {
        const inp = e.target;
        if (inp && inp.classList && inp.classList.contains('yami-scene-search')) {
          this.kw = inp.value;
          this.render();
        }
      },

      _toggleDetail(key, rowEl) {
        const wasOpen = !!this.open[key];
        let d = rowEl.nextElementSibling;
        if (d && d.classList && d.classList.contains('yami-scene-detail')) {
          d.parentNode.removeChild(d);
        }
        if (wasOpen) {
          delete this.open[key];
          rowEl.classList.remove('open');
          return;
        }
        this.open[key] = 1;
        rowEl.classList.add('open');
        const entry = this._entry(key);
        const html = entry ? (key.charAt(0) === 'r' ? this._regionDetail(entry) : this._actorDetail(entry)) : '';
        if (!html) return;
        const div = document.createElement('div');
        div.className = 'yami-scene-detail';
        div.innerHTML = html;
        rowEl.parentNode.insertBefore(div, rowEl.nextSibling);
      },

      _entry(key) {
        const s = this.snap;
        if (!s) return null;
        const m = /^([lg])(\d+)$/.exec(key);
        if (m) {
          const arr = m[1] === 'g' ? s.actors.global : s.actors.local;
          return (arr && arr[Number(m[2])]) || null;
        }
        const rm = /^r(\d+)$/.exec(key);
        if (rm) return s.regions[Number(rm[1])] || null;
        return null;
      },

      _matchesActor(a) {
        if (a.visible === false && this.onlyVisible) return false;
        const q = this.kw.trim().toLowerCase();
        if (!q) return true;
        return String(a.name || '').toLowerCase().indexOf(q) >= 0
          || String(a.fileId || a.presetId || '').toLowerCase().indexOf(q) >= 0;
      },

      _matchesRegion(r) {
        const q = this.kw.trim().toLowerCase();
        if (!q) return true;
        return String(r.name || '').toLowerCase().indexOf(q) >= 0;
      },

      // ---------- 渲染 ----------
      render() {
        const root = this.root;
        const s = this.snap;
        if (!root) return;
        if (!s) { root.innerHTML = ''; return; }
        if (!s.ok) { this._empty(root, '场景数据读取异常: ' + escapeHtml(s.error || '未知错误')); return; }
        if (!s.scene) { this._empty(root, '未检测到游戏场景——请进入「试玩」窗口检视'); return; }
        const localAll = s.actors.local || [];
        const globalAll = s.actors.global || [];
        const regionsAll = s.regions || [];
        let h = this._topHtml(s) + this._toolbarHtml();
        h += '<div class="yami-scene-groups">';
        if (this.kind !== 'regions') h += this._actorGroupHtml(localAll, globalAll);
        if (this.kind !== 'actors') h += this._regionGroupHtml(regionsAll);
        h += '</div>';
        root.innerHTML = h;
      },

      _empty(root, msg) {
        root.innerHTML = '<div class="yami-scene-empty" style="padding: 28px 12px; text-align: center; color: #888888; font-size: 12px; line-height: 1.8;">' + escapeHtml(msg) + '</div>';
      },

      _topHtml(s) {
        const c = s.counts || {};
        const meta = s.meta || {};
        const mapPath = meta.path || '';
        const mapName = mapPath ? String(mapPath).split('/').pop().replace(/\.[^.]*$/, '') : (meta.sceneId || '当前地图');
        const chips = [
          ['角色', c.actors || 0], ['触发区域', (s.regions || []).length],
          ['动画', c.animations || 0], ['粒子', c.particles || 0],
          ['触发器', c.triggers || 0], ['光源', c.lights || 0]
        ];
        const cam = s.camera;
        let size = '';
        if (meta.width) size += meta.width + 'x' + meta.height + ' 图块';
        if (meta.tileWidth) size += (size ? ' · ' : '') + meta.tileWidth + 'px/格';
        return '<div class="yami-scene-head">'
          + '<div class="yami-scene-head-map">'
          + '<div class="yami-scene-map-name">' + escapeHtml(mapName) + '</div>'
          + '<div class="yami-scene-map-path">' + escapeHtml(mapPath || meta.sceneId || '') + (size ? ' · ' + size : '') + '</div>'
          + '</div>'
          + '<div class="yami-scene-chips">'
          + chips.map(function (k) {
              return '<span class="yami-scene-chip">' + k[0] + '<b>' + k[1] + '</b></span>';
            }).join('')
          + '</div>'
          + (cam ? '<div class="yami-scene-cam">镜头 (' + Math.round(cam.x) + ', ' + Math.round(cam.y) + ') · ' + Number(cam.zoom).toFixed(2) + 'x · ' + cam.width + 'x' + cam.height + '</div>' : '')
          + '</div>';
      },

      _toolbarHtml() {
        const kinds = [['all', '全部'], ['actors', '角色'], ['regions', '区域']];
        return '<div class="yami-scene-toolbar">'
          + '<input class="yami-scene-search" type="text" value="' + escapeHtml(this.kw) + '" placeholder="搜索名称 / 文件ID / 预设ID…" spellcheck="false">'
          + '<div class="yami-scene-kinds">'
          + kinds.map(function (k) {
              return '<span class="yami-scene-kind' + (this.kind === k[0] ? ' on' : '') + '" data-kind="' + k[0] + '" role="button">' + k[1] + '</span>';
            }.bind(this)).join('')
          + '</div>'
          + '<div class="yami-scene-vis' + (this.onlyVisible ? ' on' : '') + '" data-role="yami-scene-vis" role="button">仅可见</div>'
          + '</div>';
      },

      _actorGroupHtml(localAll, globalAll) {
        let h = '<div class="yami-scene-group"><div class="yami-scene-group-title"><span class="yami-scene-dot actors"></span><b>角色</b><em>共 ' + (localAll.length + globalAll.length) + '</em></div>';
        let hitLocal = 0;
        let hitGlobal = 0;
        for (let i = 0; i < localAll.length; i++) if (this._matchesActor(localAll[i])) hitLocal++;
        for (let i = 0; i < globalAll.length; i++) if (this._matchesActor(globalAll[i])) hitGlobal++;
        if (hitLocal + hitGlobal === 0 && (this.kw || this.onlyVisible)) {
          h += '<div class="yami-scene-subgroup"><div class="yami-scene-empty">无匹配实体</div></div>';
        } else {
          h += this._actorRowsHtml('l', '场景放置', localAll);
          h += this._actorRowsHtml('g', '全局角色', globalAll);
        }
        return h + '</div>';
      },

      _actorRowsHtml(prefix, label, arr) {
        let h = '<div class="yami-scene-subgroup"><div class="yami-scene-subgroup-title">' + label + ' <span>0 / ' + arr.length + '</span></div>';
        if (arr.length === 0) {
          h = h.replace('0 / ' + arr.length, '0 / 0');
          return h + '<div class="yami-scene-empty">无' + label + '</div></div>';
        }
        let matched = 0;
        let rows = '';
        for (let i = 0; i < arr.length; i++) {
          if (!this._matchesActor(arr[i])) continue;
          matched++;
          if (matched <= this.limit) rows += this._actorRowHtml(prefix + i, arr[i]);
        }
        h = '<div class="yami-scene-subgroup"><div class="yami-scene-subgroup-title">' + label + ' <span>' + Math.min(matched, this.limit) + (matched > this.limit ? '+' : '') + ' / ' + arr.length + '</span></div>';
        if (matched === 0) {
          h += '<div class="yami-scene-empty">无匹配实体</div>';
        } else {
          h += rows;
          if (matched > this.limit) h += '<div class="yami-scene-empty">…共 ' + matched + ' 条，超出展示上限，请缩小搜索范围</div>';
        }
        return h + '</div>';
      },

      _actorRowHtml(key, a) {
        const open = !!this.open[key];
        let h = '<div class="yami-scene-row' + (open ? ' open' : '') + '" data-open-key="' + key + '" role="button">'
          + '<span class="yami-scene-arrow">' + (open ? '▾' : '▸') + '</span>'
          + '<span class="yami-scene-name">' + escapeHtml(a.name) + '</span>'
          + '<span class="yami-scene-tags">';
        if (a.isPlayer) h += '<i class="yami-scene-tag player">主角</i>';
        else if (a.isMember) h += '<i class="yami-scene-tag member">队员</i>';
        if (a.visible === false) h += '<i class="yami-scene-tag hide">隐藏</i>';
        if (a.nav && a.nav.moving) h += '<i class="yami-scene-tag move">移动</i>';
        if (a.anim && a.anim.ended) h += '<i class="yami-scene-tag warn">动画结束</i>';
        h += '</span>'
          + '<span class="yami-scene-coord">(' + a.x + ', ' + a.y + ')</span>'
          + '<span class="yami-scene-meta">' + this._colText(a) + '</span>'
          + '</div>';
        if (open) h += this._actorDetail(a);
        return h;
      },

      _regionGroupHtml(regionsAll) {
        let h = '<div class="yami-scene-group"><div class="yami-scene-group-title"><span class="yami-scene-dot regions"></span><b>触发区域</b><em>共 ' + regionsAll.length + '</em></div>';
        if (regionsAll.length === 0) {
          h += '<div class="yami-scene-subgroup"><div class="yami-scene-empty">当前无触发区域</div></div>';
        } else {
          h += '<div class="yami-scene-subgroup"><div class="yami-scene-subgroup-title">矩形区域 <span>' + regionsAll.length + ' / ' + regionsAll.length + '</span></div>';
          let matched = 0;
          for (let i = 0; i < regionsAll.length; i++) {
            if (!this._matchesRegion(regionsAll[i])) continue;
            matched++;
            if (matched <= this.limit) h += this._regionRowHtml('r' + i, regionsAll[i]);
          }
          if (matched === 0) h += '<div class="yami-scene-empty">无匹配区域</div>';
          else if (matched > this.limit) h += '<div class="yami-scene-empty">…共 ' + matched + ' 条，超出展示上限，请缩小搜索范围</div>';
          h += '</div>';
        }
        return h + '</div>';
      },

      _regionRowHtml(key, r) {
        const open = !!this.open[key];
        let h = '<div class="yami-scene-row' + (open ? ' open' : '') + '" data-open-key="' + key + '" role="button">'
          + '<span class="yami-scene-arrow">' + (open ? '▾' : '▸') + '</span>'
          + '<span class="yami-scene-name">' + escapeHtml(r.name) + '</span>'
          + '<span class="yami-scene-tags">' + (r.actorCount > 0 ? '<i class="yami-scene-tag inside">区内 ' + r.actorCount + '</i>' : '') + '</span>'
          + '<span class="yami-scene-coord">(' + r.x + ', ' + r.y + ')</span>'
          + '<span class="yami-scene-meta">' + this._c(r.width) + 'x' + this._c(r.height) + '</span>'
          + '</div>';
        if (open) h += this._regionDetail(r);
        return h;
      },

      // ---------- 详情字段 ----------
      _dl(items) {
        return '<div class="yami-scene-dl">' + items.map(function (it) {
          return '<span>' + it[0] + '</span><b>' + it[1] + '</b>';
        }).join('') + '</div>';
      },

      _c(v) {
        return (v == null || isNaN(v)) ? '—' : String(Math.round(v * 100) / 100);
      },

      _colText(a) {
        if (!a.collider) return '';
        const cd = a.collider;
        return (cd.shape === 'rect' ? '矩形' : '圆形') + ' ' + cd.size + (cd.immovable ? ' · 固定' : '');
      },

      _actorDetail(a) {
        const cd = a.collider;
        const nav = a.nav;
        const anim = a.anim;
        const MODE_CN = { stop: '静止', keep: '持续', navigate: '寻路', follow: '跟随' };
        const items = [
          ['坐标', '(' + this._c(a.x) + ', ' + this._c(a.y) + ') · 朝向 ' + this._c(a.angle) + '° · 优先级 ' + this._c(a.priority)],
          ['身份', a.isPlayer ? '玩家主角' : (a.isMember ? '队伍成员' : '普通角色')]
        ];
        if (a.fileId || a.presetId) items.push(['文件', escapeHtml(a.fileId || '—') + (a.presetId ? ' · 预设 ' + escapeHtml(a.presetId) : '')]);
        if (a.visible === false) items.push(['可见', '已隐藏']);
        if (typeof a.passage === 'number') items.push(['通行码', a.passage]);
        items.push(['碰撞体', cd
          ? ((cd.shape === 'rect' ? '矩形' : '圆形') + ' 直径 ' + cd.size + ' 图块' + (cd.immovable ? ' · 不可推动' : ' · 可推动') + (cd.moved ? ' · 本帧位移' : ''))
          : '无碰撞体']);
        items.push(['导航', nav
          ? (MODE_CN[nav.mode] || nav.mode) + (nav.speed ? ' · ' + this._c(nav.speed) + ' 图块/秒' : '') + (nav.hasPath ? ' · 寻路中' : '')
          : '无导航器']);
        items.push(['动画', anim
          ? (anim.motion ? escapeHtml(anim.motion) : '主动画') + (anim.paused ? ' · 暂停' : '') + (anim.ended ? ' · 已播完' : '') + (anim.visible === false ? ' · 不可见' : '')
          : '无动画播放器']);
        return this._dl(items);
      },

      _regionDetail(r) {
        const items = [
          ['范围', '中心 (' + this._c(r.x) + ', ' + this._c(r.y) + ') · 宽 ' + this._c(r.width) + ' x 高 ' + this._c(r.height) + ' 图块']
        ];
        if (r.presetId) items.push(['预设', escapeHtml(r.presetId)]);
        items.push(['区内角色', r.actorCount
          ? (r.actors.join('、') + (r.actorCount > r.actors.length ? ' 等 ' + r.actorCount + ' 个' : ''))
          : '无 (空区域)']);
        return this._dl(items);
      }
    };

    Views.register('scene', {
      showExportBtns: false,
      title: '场景实体',
      showBack: true,
      showModeSwitch: false,
      showClearErrors: false,
      showTabs: false,
      mount(root, ctx) {
        SceneLab.init(ctx);
      },
      refresh(ctx) {
        SceneLab.refresh(ctx);
      },
      destroy() {
        SceneLab.destroy();
      }
    });

    switchView(currentView);


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


    // 嫌疑开关 (A/B 实验)：暂停某类对象更新，卡顿消失即真凶
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
        return '<div class="yami-perf-sus-pill' + (on ? ' on' : '') + '" data-sus="' + k[0] + '" role="button">' + (on ? '恢复 ' : '暂停 ') + k[1] + '</div>';
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
        showToast(next ? ('已暂停' + label + '更新 — 观察 FPS 是否回升 (真凶验证)') : ('已恢复' + label + '更新'), 2000);
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
        // 大盘展开时，彻底隐藏右上角迷你帧数浮窗，防止穿透或半透明时穿帮透出
        if (hud) hud.style.setProperty('display', 'none', 'important');
        if (errorBubbleEl) errorBubbleEl.classList.remove('show');
        // 进入大盘即视为已读: 已存在错误类型全部记入 seen, 退出后同源错误不再弹气泡
        markSeenExistingErrors();
        refreshDockData();
      } else {
        // 大盘收起时，恢复右上角迷你帧数浮窗
        if (hud) hud.style.removeProperty('display');
        // 收起时防御性清理错误气泡与其计时器, 杜绝任何红框残留
        if (errorBubbleEl) errorBubbleEl.classList.remove('show');
        if (errorBubbleTimer) { clearTimeout(errorBubbleTimer); errorBubbleTimer = null; }
        safeRestoreInput();
        if (typeof isThrough !== 'undefined' && isThrough && typeof applyThroughState === 'function') {
          applyThroughState(false);
        }
      }
    }

    document.getElementById('yami-capsule').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDock();
    });

    // 关闭按钮
    document.getElementById('btn-dock-close').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDock(false);
    });

    
    // ============================================================
    // 双模切换控制器 (普通模式·小白专属 vs 专业模式·极客深入)
    // ============================================================
    let currentMode = localStorage.getItem('yami-perf-mode') || 'simple';

    const modeBtns = dock.querySelectorAll('.yami-mode-btn');
    const viewSimple = document.getElementById('yami-view-simple');
    const viewPro = document.getElementById('yami-view-pro');
    const tabsBar = document.getElementById('yami-tabs-bar');

    function updateModeUI() {
      modeBtns.forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.mode === currentMode);
      });
      if (currentMode === 'simple') {
        if (viewSimple) viewSimple.style.setProperty('display', 'flex', 'important');
        if (viewPro) viewPro.style.setProperty('display', 'none', 'important');
        if (tabsBar) tabsBar.style.setProperty('display', 'none', 'important');
      } else {
        if (viewSimple) viewSimple.style.setProperty('display', 'none', 'important');
        if (viewPro) viewPro.style.setProperty('display', 'flex', 'important');
        if (tabsBar) tabsBar.style.setProperty('display', (currentView === 'profiler') ? 'flex' : 'none', 'important');
      }
      localStorage.setItem('yami-perf-mode', currentMode);
      refreshDockData();
    }

    modeBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        currentMode = btn.dataset.mode || 'simple';
        updateModeUI();
      });
    });

    // A/B 快速排查开关绑定
    const quickMuteActors = document.getElementById('btn-quick-mute-actors');
    const quickMuteParticles = document.getElementById('btn-quick-mute-particles');
    const quickMuteEvents = document.getElementById('btn-quick-mute-events');
    const quickMuteAudio = document.getElementById('btn-quick-mute-audio');
    const quickMuteUI = document.getElementById('btn-quick-mute-ui');

    function updateQuickBtnsUI() {
      const probe = window.__YAMI_PERF_PROBE__;
      if (!probe || !probe.getSuspend) return;
      const s = probe.getSuspend();
      if (quickMuteActors) {
        quickMuteActors.classList.toggle('active', s.actors === true);
        quickMuteActors.textContent = s.actors ? '▶ 恢复怪物与NPC (已冻结)' : '⏸ 冻结怪物与NPC (主角正常)';
      }
      if (quickMuteParticles) {
        quickMuteParticles.classList.toggle('active', s.emitters === true);
        quickMuteParticles.textContent = s.emitters ? '▶ 恢复粒子 (已关闭)' : '⏸ 临时关闭粒子';
      }
      if (quickMuteEvents) {
        quickMuteEvents.classList.toggle('active', s.events === true);
        quickMuteEvents.textContent = s.events ? '▶ 恢复公共事件 (已暂停)' : '⏸ 临时暂停公共事件';
      }
      if (quickMuteAudio) {
        quickMuteAudio.classList.toggle('active', s.audio === true);
        quickMuteAudio.textContent = s.audio ? '▶ 恢复音效播放 (已静音)' : '⏸ 临时静音音效SE (排查音频)';
      }
      if (quickMuteUI) {
        quickMuteUI.classList.toggle('active', s.ui === true);
        quickMuteUI.textContent = s.ui ? '▶ 恢复界面UI (已隐藏)' : '⏸ 临时隐藏界面与飘字UI';
      }
    }

    if (quickMuteActors) {
      quickMuteActors.addEventListener('click', function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe) return;
        const next = probe.suspend('actors', !(probe.getSuspend().actors === true));
        updateQuickBtnsUI();
        showToast(next ? '已定格场景全部怪物与NPC(主角仍可正常移动攻击)，观察 FPS 是否回升' : '已恢复怪物与NPC逻辑');
      });
    }
    if (quickMuteParticles) {
      quickMuteParticles.addEventListener('click', function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe) return;
        const next = probe.suspend('emitters', !(probe.getSuspend().emitters === true));
        updateQuickBtnsUI();
        showToast(next ? '已临时关闭粒子特效，观察右上角 FPS 是否回升' : '已恢复粒子特效');
      });
    }
    if (quickMuteEvents) {
      quickMuteEvents.addEventListener('click', function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe) return;
        const next = probe.suspend('events', !(probe.getSuspend().events === true));
        updateQuickBtnsUI();
        showToast(next ? '已临时暂停公共事件，观察右上角 FPS 是否回升' : '已恢复公共事件');
      });
    }
    if (quickMuteAudio) {
      quickMuteAudio.addEventListener('click', function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe) return;
        const next = probe.suspend('audio', !(probe.getSuspend().audio === true));
        updateQuickBtnsUI();
        showToast(next ? '已临时静音所有音效SE，排查音频解码与并发卡顿' : '已恢复音效播放');
      });
    }
    if (quickMuteUI) {
      quickMuteUI.addEventListener('click', function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe) return;
        const next = probe.suspend('ui', !(probe.getSuspend().ui === true));
        updateQuickBtnsUI();
        showToast(next ? '已临时隐藏界面 UI，观察右上角 FPS 是否回升' : '已恢复界面 UI');
      });
    }

    // 普通小白模式数据刷新函数
    function refreshSimpleDiagnosis() {
      try {
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe || !probe.getDiagnosisReport) return;
        const diag = probe.getDiagnosisReport();
        if (!diag) return;

        const scoreEl = document.getElementById('diag-score');
        const titleEl = document.getElementById('diag-status-title');
        const descEl = document.getElementById('diag-status-desc');
        const chipFps = document.getElementById('diag-chip-fps');
        const chipMs = document.getElementById('diag-chip-ms');
        const chipDc = document.getElementById('diag-chip-dc');
        const chipActors = document.getElementById('diag-chip-actors');

        if (scoreEl) {
          scoreEl.textContent = diag.score;
          scoreEl.className = 'yami-health-score-circle' + (diag.status === 'bad' ? ' bad' : (diag.status === 'warn' ? ' warn' : ''));
        }
        if (titleEl) titleEl.textContent = diag.statusText;
        if (descEl) descEl.textContent = diag.statusDesc;

        if (chipFps) chipFps.textContent = diag.fps + ' FPS';
        if (chipMs) chipMs.textContent = diag.computeAvg + ' ms';
        if (chipDc) chipDc.textContent = diag.drawCalls + ' DC';
        if (chipActors) chipActors.textContent = diag.actors + ' 角色';

        const culpritListEl = document.getElementById('diag-culprits-list');
        const countEl = document.getElementById('diag-culprit-count');

        if (countEl) countEl.textContent = (diag.culprits ? diag.culprits.length : 0) + ' 个瓶颈';

        if (culpritListEl) {
          if (!diag.culprits || diag.culprits.length === 0) {
            culpritListEl.innerHTML = '<div style="color: #1cff9b; font-size: 11px; text-align: center; padding: 12px; background: #1a241e; border: 1px solid #203828; border-radius: 2px;">[OK] 主线程与渲染管线未发现卡顿真凶，运行顺畅。</div>';
          } else {
            culpritListEl.innerHTML = diag.culprits.map(function(c) {
              return '<div class="yami-culprit-card ' + (c.level === 'warn' ? 'warn' : '') + '">'
                + '<div class="yami-culprit-head">'
                + '<span>' + c.title + '</span>'
                + '<span style="font-size: 10px; color: ' + (c.level === 'bad' ? '#ff4040' : '#f06000') + ';">[' + (c.level === 'bad' ? '严重卡顿' : '轻微警告') + ']</span>'
                + '</div>'
                + '<div class="yami-culprit-file-box">'
                + '<span title="' + c.file + '">' + c.file + '</span>'
                + '<div class="yami-culprit-copy-btn" data-copy="' + c.file + '" role="button">复制文件</div>'
                + '</div>'
                + '<div style="color: #ffffff; font-size: 10px; font-weight: 500;">位置: ' + c.location + '</div>'
                + '<div class="yami-culprit-reason">诊断原因: ' + c.reason + '</div>'
                + '<div class="yami-culprit-tip">建议方案: ' + c.suggestion + '</div>'
                + '</div>';
            }).join('');

            culpritListEl.querySelectorAll('.yami-culprit-copy-btn').forEach(function(btn) {
              btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const text = btn.dataset.copy;
                if (text) {
                  navigator.clipboard.writeText(text).then(function() {
                    showToast('已复制文件路径: ' + text);
                  });
                }
              });
            });
          }
        }
        updateQuickBtnsUI();
      } catch (err) {
        console.error('[YAMI PERF] refreshSimpleDiagnosis error:', err);
      }
    }

    
    // ============================================================
    // 自动更新前端交互绑定
    // ============================================================
    const updateBanner = document.getElementById('yami-update-banner');
    const updateVerSpan = document.getElementById('yami-latest-ver');
    const updateBtn = document.getElementById('btn-do-update');
    const versionBadge = document.getElementById('yami-version-badge');

    function refreshVersionBadge() {
      if (!versionBadge) return;
      const probe = window.__YAMI_PERF_PROBE__;
      const cur = (probe && probe.version) ? probe.version : '0.5.0';
      versionBadge.textContent = 'v' + cur + ' (检查更新)';
    }
    refreshVersionBadge();

    // 监听发现新版本事件
    window.addEventListener('yami-perf-update-found', function(e) {
      const info = e.detail;
      if (!info || !info.hasUpdate) return;
      if (updateBanner) updateBanner.classList.add('show');
      if (updateVerSpan) updateVerSpan.textContent = 'v' + info.latestVersion;
      if (versionBadge) versionBadge.textContent = '发现新版 v' + info.latestVersion;
    });

    // 监听无新版本事件 (确保横幅隐匿)
    window.addEventListener('yami-perf-update-none', function() {
      if (updateBanner) updateBanner.classList.remove('show');
    });

    // 点击一键热更新按钮
    if (updateBtn) {
      updateBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe || !probe.performAutoUpdate) return;

        updateBtn.classList.add('disabled');
        updateBtn.textContent = '连接中...';

        try {
          const res = await probe.performAutoUpdate(function(cur, total, file) {
            updateBtn.textContent = '更新中 ' + cur + '/' + total;
          });
          updateBtn.textContent = '[完成] 更新成功';
          showToast('[已同步] 最新代码已拉取！重启工程即可生效', 4500);
          setTimeout(function() {
            if (updateBanner) updateBanner.classList.remove('show');
          }, 3500);
        } catch (err) {
          updateBtn.classList.remove('disabled');
          updateBtn.textContent = '重试更新';
          showToast('更新失败: ' + err.message, 3000);
        }
      });
    }

    // 点击版本号手动检查更新
    if (versionBadge) {
      versionBadge.addEventListener('click', async function(e) {
        e.stopPropagation();
        const probe = window.__YAMI_PERF_PROBE__;
        if (!probe || !probe.checkUpdate) return;
        showToast('正在检测 GitHub 仓库最新版本...');
        const res = await probe.checkUpdate();
        if (res.hasUpdate) {
          showToast('发现新版本 v' + res.latestVersion + '，请点击顶部一键更新！');
        } else {
          showToast('当前已是最新版本 (v' + (probe.version || '0.5.0') + ')');
          refreshVersionBadge();
        }
      });
    }

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
        showToast('完整探针分析 JSON 已复制到剪贴板');
      }
    });

    document.getElementById('dock-btn-dl').addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.__YAMI_PERF_PROBE__) {
        window.__YAMI_PERF_PROBE__.download();
        showToast('探针报告 JSON 文件已下载');
      }
    });

    // 刷新数据函数
    const OBJ_KIND_LABEL = { actors: '角色', animations: '动画', emitters: '粒子', triggers: '触发器', ui: '界面', events: '事件' };

    function refreshDockData() {
      if (currentMode === "simple") {
        refreshSimpleDiagnosis();
        return;
      }
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
              const who = esc(topObj ? ('' + (OBJ_KIND_LABEL[topObj.kind] || topObj.kind) + '·' + topObj.name) : topMod);
              const upInfo = (j.textureUploadKB || 0) > 0 ? ('⤴ ' + j.textureUploadKB + 'KB ') : '';
              return `
                <div class="yami-perf-jank-item" data-jframe="${j.frame}" role="button" style="display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; background: #2e2020; border: 1px solid #482020; border-radius: 2px; font-size: 10px;">
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><b>#${j.frame}</b> <b style="color: #ff4040;">${j.compute}ms</b> <span style="color: #c8a050; font-size: 10px;">${who}</span></span>
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
                <span class="yami-perf-event-name" title="${esc(ev.path || ev.name)}">${esc(ev.name)}</span>
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
                <span class="yami-perf-event-name" title="${esc(h.name)}">${esc(h.name)}</span>
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

    // 卡顿详情面板: 点击卡顿记录展开完整归因 + 60帧波形
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
        + '<div><div style="color:#ff9060; padding: 2px 0;">对象归因 (当帧)</div>' + renderJankRows(j.objects) + '</div>'
        + '<div><div style="color:#ffc860; padding: 2px 0;">️ 系统模块 (当帧)</div>' + renderModuleRows(j.updaters) + '</div>'
        + '</div>'
        + (j.events && j.events.length ? '<div style="margin-top: 4px;"><div style="color:#7fd0ff; padding: 2px 0;">活跃事件 (当帧)</div>' + renderModuleRows(j.events) + '</div>' : '')
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
    updateModeUI();

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
      showToast(`掉帧告警: ${detail.compute}ms (${detail.culprit})`, 2500);
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

        if (currentMode === 'simple') {
          fpsText.textContent = `${fps} FPS`;
          const diag = probe.getDiagnosisReport ? probe.getDiagnosisReport() : null;
          if (diag && diag.culprits && diag.culprits.length > 0) {
            const topC = diag.culprits[0];
            msText.textContent = topC.type === 'event' ? '事件死循环' : (topC.type === 'actor' ? '角色过载' : '掉帧告警');
            dcText.textContent = `${diag.score}分`;
          } else {
            msText.textContent = '丝滑';
            dcText.textContent = `${diag ? diag.score : 100}分`;
          }
        } else {
          fpsText.textContent = `${fps} FPS`;
          msText.textContent = `${compute.toFixed(1)}ms`;
          dcText.textContent = `${dc} DC`;
        }

        if (compute > 33.3 || fps < 35) {
          badge.className = 'yami-perf-badge bad';
        } else if (compute > 16.7 || fps < 55) {
          badge.className = 'yami-perf-badge warn';
        } else {
          badge.className = 'yami-perf-badge';
        }

        // 契约化统一心跳：当前激活页面按需刷新，彻底消灭面条式 if-else
        if (isDockOpen && Views.current && Views.current.def && Views.current.def.refresh) {
          Views.current.def.refresh(ctx);
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