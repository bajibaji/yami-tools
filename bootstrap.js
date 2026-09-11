/**
 * bootstrap.js — 主世界装载器（内容脚本 / 隔离世界）
 *
 * 为什么需要它：
 *   Electron 20 的扩展内容脚本跑在「隔离世界」里，那里没有 `require` / `process`，
 *   而本插件的核心能力（AI 宿主进程、5966 试玩桥、5967 编辑器桥、项目根定位）
 *   全都依赖 Node。隔离世界里这些接口一律拿到 `require is not defined`，
 *   于是面板只能报错、宿主永远起不来。
 *   引擎两个窗口都是 nodeIntegration: true + contextIsolation: false，
 *   也就是说「主世界」才有 Node —— 所以这里把真正的三个脚本以 <script> 方式
 *   注入主世界执行，插件其余代码无需任何改动。
 *
 * 兼容性：
 *   · manifest 里 content_scripts.world = "MAIN" 是 Chrome 111+ 才有的字段，
 *     Electron 20 直接忽略，所以只能自己注入。
 *   · 依次尝试 chrome-extension:// 与页面相对路径两类基址，哪个先成功用哪个：
 *     扩展基址需要 manifest 的 web_accessible_resources 放行（已声明）；
 *     页面相对基址对应引擎「<根>/dist/index.html + <根>/extension/...」的源码布局。
 */
(() => {
  'use strict';
  if (window.__YAMI_BOOTSTRAP__) return;
  window.__YAMI_BOOTSTRAP__ = true;
  if (window.top !== window) return; // 只装主文档，避免子 iframe 里重复挂一套界面

  // 顺序有讲究：ai-render-core 提供流式渲染的帧合并/增量缓冲，ai-agent 依赖它
  const FILES = ['ai-render-core.js', 'probe-core.js', 'hud-overlay.js', 'ai-agent.js'];
  const LOAD_TIMEOUT = 4000;

  function candidateBases() {
    const bases = [];
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        const base = chrome.runtime.getURL('');
        if (base) bases.push(base);
      }
    } catch (e) {}
    try {
      const href = String(location.href).split('?')[0].split('#')[0];
      if (href.slice(0, 7) === 'file://') {
        const dir = href.slice(0, href.lastIndexOf('/') + 1);
        bases.push(dir + '../extension/yami-perf-extension/');
        bases.push(dir + 'extension/yami-perf-extension/');
        bases.push(dir + '../../extension/yami-perf-extension/');
      }
    } catch (e) {}
    return bases.filter((v, i) => v && bases.indexOf(v) === i);
  }

  function loadScript(src) {
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => { if (!settled) { settled = true; resolve(ok); } };
      let el;
      try {
        el = document.createElement('script');
        el.src = src;
        el.async = false;
      } catch (e) { return finish(false); }
      el.addEventListener('load', () => finish(true));
      el.addEventListener('error', () => finish(false));
      setTimeout(() => finish(false), LOAD_TIMEOUT);
      const host = document.head || document.documentElement;
      if (!host) return finish(false);
      host.appendChild(el);
    });
  }

  // 用 probe-core.js 当探针：它加载成功才说明这个基址可用，剩下两个再跟着进去
  async function injectFrom(base) {
    if (!(await loadScript(base + FILES[0]))) return false;
    for (let i = 1; i < FILES.length; i++) await loadScript(base + FILES[i]);
    return true;
  }

  async function main() {
    for (let i = 0; i < 60 && !document.documentElement; i++) {
      await new Promise(resolve => setTimeout(resolve, 4));
    }
    const bases = candidateBases();
    for (const base of bases) {
      if (await injectFrom(base)) return;
    }
    // 注入失败不静默：面板/HUD 全都不在时，这行日志是唯一的线索
    console.warn('[DanJuan妙妙插件] 主世界装载失败，已尝试: ' + (bases.join(' , ') || '无可用基址'));
  }

  main();
})();
