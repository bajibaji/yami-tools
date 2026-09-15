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

  // 第一个文件当探针（必须两个基址都有），其余按依赖顺序：渲染核心要在 ai-agent 之前
  const FILES = ['probe-core.js', 'ai-render-core.js', 'hud-overlay.js', 'ai-agent.js'];
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


  /* ------------------------------------------------------------------
   * 更新恢复（真机事故的兜底）：一键热更新把新版本写坏时，症状是「重启后插件整个消失」，
   * 而且控制台一条报错都没有 —— 用户没有任何出路。这里在注入**之前**先看更新器留下的
   * 「进行中」标记：标记还在 = 上一次更新没走完（写盘崩了 / 编辑器被杀），
   * 此时把 _backup/previous 里的旧版本原样拷回来，插件自己活过来，不用人工拷贝。
   * 前提：主世界有 Node（引擎两个窗口都是 nodeIntegration: true + contextIsolation: false）。
   * ------------------------------------------------------------------ */
  const UPDATE_MARKER = '.yami-update-in-progress.json';
  const BACKUP_DIR = '_backup/previous';
  const RECOVERY_ENTRY = ['manifest.json'].concat(FILES);

  function nodeModules() {
    try {
      if (typeof require !== 'function') return null;
      return { fs: require('fs'), path: require('path'), zlib: require('zlib') };
    } catch (e) { return null; }
  }

  /** 把插件目录从 chrome-extension:// / file:// 基址反推出来（主世界可用 fs 直接读） */
  function resolvePluginDir(fs, path) {
    const bases = candidateBases();
    for (let i = 0; i < bases.length; i++) {
      let dir = '';
      try {
        const base = bases[i];
        // 交给 URL 解析，别自己切前缀：file:///D:/x 剥掉协议后开头会多一个 '/'，
        // path.join('/D:/x', 'manifest.json') 在 Windows 上会被当成 UNC 路径（\\D:\x…）而查不到文件 ——
        // 源码布局的安装就靠这条路径恢复，错了等于恢复功能不存在。
        // 只认扩展基址与 file: 基址；Chrome 给的三段斜杠形式由 pathname 统一处理。
        if (base.slice(0, 19) === 'chrome-extension://' || base.slice(0, 7) === 'file://') {
          dir = decodeURIComponent(new URL(base).pathname);
          if (/^\/[a-zA-Z]:/.test(dir)) dir = dir.slice(1);
        } else {
          continue;
        }
      } catch (e) { continue; }
      if (!dir) continue;
      try { if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir; } catch (e) {}
    }
    return '';
  }

  function showRecoveryNotice(text) {
    try {
      const paint = () => {
        try {
          if (document.getElementById('yami-recovery-notice')) return;
          const el = document.createElement('div');
          el.id = 'yami-recovery-notice';
          el.setAttribute('style', 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;'
            + 'background:#1e293b;color:#e2e8f0;border:1px solid #f59e0b;border-radius:6px;padding:8px 14px;'
            + 'font:13px/1.6 system-ui,sans-serif;max-width:80vw;box-shadow:0 4px 16px rgba(0,0,0,.4)');
          el.textContent = text;
          (document.body || document.documentElement).appendChild(el);
          setTimeout(() => { try { el.remove() } catch (e) {} }, 15000);
        } catch (e) {}
      };
      if (document.body) paint();
      else document.addEventListener('DOMContentLoaded', paint, { once: true });
    } catch (e) {}
  }

  async function recoverFromInterruptedUpdate() {
    const mods = nodeModules();
    if (!mods) return '';   // 没有 Node 权限时不要卡住装载流程
    const { fs, path } = mods;
    const dir = resolvePluginDir(fs, path);
    if (!dir) return '';
    let markerRaw = null;
    try { markerRaw = fs.readFileSync(path.join(dir, UPDATE_MARKER), 'utf8'); } catch (e) { return ''; }
    const info = (function () { try { return JSON.parse(markerRaw) } catch (e) { return {} } })();
    const backupRoot = path.join(dir, BACKUP_DIR);
    const notice = 'DanJuan妙妙插件：检测到上次更新没有正常完成，已把插件回退到更新前的版本（v'
      + String(info && info.previousVersion || '?') + '）。重开一次窗口即可正常使用；想再试更新请先看控制台日志。';
    try {
      let restored = 0;
      for (let i = 0; i < RECOVERY_ENTRY.length; i++) {
        const rel = RECOVERY_ENTRY[i];
        const from = path.join(backupRoot, rel.split('/').join(path.sep));
        if (!fs.existsSync(from)) continue;
        fs.writeFileSync(path.join(dir, rel.split('/').join(path.sep)), fs.readFileSync(from));
        restored++;
      }
      // 入口文件必须都回来了才算恢复成功；回不来就留着标记，等下一次（或用户手动换插件目录）
      if (restored < RECOVERY_ENTRY.length) return '';
      try { fs.rmSync(path.join(dir, UPDATE_MARKER), { force: true }); } catch (e) {}
      showRecoveryNotice(notice);
      return notice;
    } catch (e) { return ''; }
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
    for (let i = 1; i < FILES.length; i++) {
      // 单个文件失败要指名道姓地报出来，否则前端只会表现成"内容空白"，无从排查
      if (!(await loadScript(base + FILES[i]))) console.warn('[DanJuan妙妙插件] 注入失败：' + base + FILES[i]);
    }
    return true;
  }

  async function main() {
    for (let i = 0; i < 60 && !document.documentElement; i++) {
      await new Promise(resolve => setTimeout(resolve, 4));
    }
    // 先把上一次没走完的更新回退掉，再注入界面（顺序不能反：注入的是刚回退回来的旧版本）
    try {
      const recovered = await recoverFromInterruptedUpdate();
      if (recovered) console.warn('[DanJuan妙妙插件] ' + recovered);
    } catch (e) {}
    const bases = candidateBases();
    for (const base of bases) {
      if (await injectFrom(base)) return;
    }
    // 注入失败不静默：面板/HUD 全都不在时，这行日志是唯一的线索
    console.warn('[DanJuan妙妙插件] 主世界装载失败，已尝试: ' + (bases.join(' , ') || '无可用基址'));
  }

  main();
})();
