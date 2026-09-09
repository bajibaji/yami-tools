// 自动更新引擎端到端自回归 (extension 分支): 真实网络 raw 通道 + 内存 fs 防真写盘
// 覆盖: compareVersion / checkUpdate(最新与旧版两态) / performAutoUpdate(顺序+内容+进度+版本门闩)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function makeSandbox() {
  const events = [];
  const sandbox = {
    console,
    setTimeout, clearTimeout,
    performance: { now: () => Date.now(), memory: { usedJSHeapSize: 1, totalJSHeapSize: 1 } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setInterval: () => 1, clearInterval: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    BroadcastChannel: class { constructor() {} postMessage() {} close() {} },
    Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || {}; } },
    Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set,
    fetch: (...a) => globalThis.fetch(...a),   // 真实网络: raw.githubusercontent.com
    AbortController, TextEncoder
  };
  sandbox.window = {
    __YAMI_PERF_PROBE__: undefined,
    dispatchEvent: (ev) => { events.push(ev.type); if (ev.type === 'yami-perf-update-found') events.push(ev.detail); return true; },
    addEventListener: () => {}, devicePixelRatio: 1
  };
  sandbox._events = events;
  return sandbox;
}

// ---------- 内存 fs: 探测候选目录存在 + 写盘只进内存, 绝不触碰真实磁盘 ----------
const writes = [];
const memFs = new Map();
const mockFs = {
  existsSync: (p) => String(p).includes('manifest.json'),
  writeFileSync: (p, content, enc) => { memFs.set(p, content); writes.push({ p, bytes: Buffer.byteLength(content, 'utf8') }); },
  readFileSync: (p, enc) => memFs.get(p),
  mkdirSync: () => {}
};
const mockPath = { join: (...a) => a.join('/') };
const mockProcess = { cwd: () => 'C:/mock', resourcesPath: undefined };

const srcClean = probeSrc.replace(/setTimeout\(function\(\) \{ checkUpdate\(\); \}, 3500\);/, '');
// 模拟旧版: 无论当前版本号是多少, 统一替换为 0.1.9
const srcOld = srcClean.replace(/const PROBE_VERSION = '[\d.]+';/, "const PROBE_VERSION = '0.1.9';");

// 远端真实版本: raw 主通道 + jsDelivr 兜底 (单通道抖动时不误判为回归)
let remoteVer = '0.0.0';
for (const url of [
  'https://raw.githubusercontent.com/bajibaji/yami-tools/extension/manifest.json',
  'https://cdn.jsdelivr.net/gh/bajibaji/yami-tools@extension/manifest.json'
]) {
  try {
    const rm = await (await fetch(url)).json();
    if (rm && rm.version) {
      remoteVer = rm.version;
      console.log('远端版本:', remoteVer, url.includes('jsdelivr') ? '(jsDelivr 兜底)' : '(raw)');
      break;
    }
  } catch (e) { /* 换下一条通道 */ }
}
if (remoteVer === '0.0.0') console.warn('⚠️ 远端版本不可达 (raw + jsDelivr 均失败), 远端相关断言将跳过 — 这是环境问题, 不是回归');

// 远端不可达时无法对未知值做等值断言: 显式跳过而非误报失败
const checkRemote = (name, cond, extra = '') => {
  if (remoteVer === '0.0.0') { console.log('  SKIP  ' + name + '  [远端不可达]'); return; }
  check(name, cond, extra);
};

async function main() {
  console.log('=== 1. compareVersion 语义 ===');
  const v = (a, b) => {
    const s = makeSandbox();
    vm.createContext(s); vm.runInContext(srcClean, s);
    return s.window.__YAMI_PERF_PROBE__.compareVersion(a, b);
  };
  check('0.2.0 > 0.1.1 => 1', v('0.2.0', '0.1.1') === 1);
  check('0.2.0 = 0.2.0 => 0', v('0.2.0', '0.2.0') === 0);
  check('0.1.9 < 0.2.0 => -1', v('0.1.9', '0.2.0') === -1);
  check('0.10.0 > 0.9.9 => 1 (非字典序)', v('0.10.0', '0.9.9') === 1);
  check('1.2.3 > 0.99.99 => 1', v('1.2.3', '0.99.99') === 1);
  check('v 前缀容忍', v('v0.2.0', '0.2.0') === 0);

  console.log('=== 2. checkUpdate: 本地已最新 (0.2.0 vs 远端 raw) ===');
  const sCur = makeSandbox();
  vm.createContext(sCur); vm.runInContext(srcClean, sCur);
  const curProbe = sCur.window.__YAMI_PERF_PROBE__;
  const r1 = await curProbe.checkUpdate();
  check('hasUpdate = false', r1.hasUpdate === false, 'ver=' + (r1.latestVersion || '?'));
  checkRemote('latestVersion = 远端真实版本 (raw 无缓存)', r1.latestVersion === remoteVer, r1.latestVersion);
  check('事件 update-none 已派发', sCur._events.includes('yami-perf-update-none'));

  console.log('=== 3. checkUpdate: 旧版本地 (0.1.9) 应发现 0.2.0 ===');
  const sOld = makeSandbox();
  vm.createContext(sOld); vm.runInContext(srcOld, sOld);
  const oldProbe = sOld.window.__YAMI_PERF_PROBE__;
  const r2 = await oldProbe.checkUpdate();
  check('hasUpdate = true', r2.hasUpdate === true);
  checkRemote('latestVersion = 远端真实版本', r2.latestVersion === remoteVer, r2.latestVersion);
  check('currentVersion = 0.1.9', r2.currentVersion === '0.1.9');
  check('事件 update-found 已派发', sOld._events.includes('yami-perf-update-found'));

  console.log('=== 4. performAutoUpdate: 下载 5 文件 + 版本门闩顺序 + 进度 ===');
  const sUp = makeSandbox();
  sUp.require = (name) => {
    if (name === 'fs') return mockFs;
    if (name === 'path') return mockPath;
    if (name === 'http') return { createServer: () => ({ listen: () => {}, on: () => {}, close: () => {} }) };
    throw new Error('no ' + name);
  };
  sUp.process = mockProcess;
  vm.createContext(sUp); vm.runInContext(srcOld, sUp);
  const upProbe = sUp.window.__YAMI_PERF_PROBE__;
  let progress = [];
  const res = await upProbe.performAutoUpdate((cur, total, file) => progress.push(cur + '/' + total + ':' + file));
  check('success = true', res.success === true);
  checkRemote('内存版本升至远端版本', res.version === remoteVer && upProbe.version === remoteVer, res.version);
  check('更新文件数 = 5', res.updatedFiles === 5, 'files=' + res.updatedFiles);
  check('进度回调 5 次', progress.length === 5);
  check('目标目录 = 生产目录候选', String(res.targetDir).includes('extension/yami-perf-extension'));
  const names = writes.map(w => w.p.split('/').pop());
  check('写盘顺序: probe-core.js 最先', names[0] === 'probe-core.js', names.join(','));
  check('写盘顺序: manifest.json 最后 (版本门闩)', names[names.length - 1] === 'manifest.json', names.join(','));
  const probeTxt = writes.find(w => w.p.endsWith('probe-core.js'));
  const manifestTxt = writes.find(w => w.p.endsWith('manifest.json'));
  check('probe-core.js 内容真实下载 (体积合理)', probeTxt && probeTxt.bytes > 10000);
  checkRemote('probe-core.js 含远端 PROBE_VERSION', probeTxt && memFs.get(probeTxt.p).includes("PROBE_VERSION = '" + remoteVer + "'"));
  checkRemote('manifest.json 内容真实下载 (version=' + remoteVer + ')', manifestTxt && JSON.parse(memFs.get(manifestTxt.p)).version === remoteVer);
  const hudTxt = writes.find(w => w.p.endsWith('hud-overlay.js'));
  check('hud-overlay.js 内容真实下载', hudTxt && hudTxt.bytes > 50000);

  console.log('=== 5. 容灾: 网络全断时 checkUpdate 静默降级 ===');
  const sNet = makeSandbox();
  sNet.fetch = async () => { throw new Error('net down'); };
  vm.createContext(sNet); vm.runInContext(srcClean, sNet);
  const r3 = await sNet.window.__YAMI_PERF_PROBE__.checkUpdate();
  check('hasUpdate = false + error 字段 (不抛异常)', r3.hasUpdate === false && !!r3.error);

  console.log('\n========== 自动更新测试: ' + passed + ' PASS / ' + failed + ' FAIL ==========');
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('测试执行异常:', e); process.exit(2); });
