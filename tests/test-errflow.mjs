// 错误黑匣子广播节流回归 (extension 分支): 同源错误 3s 窗口只广播一次, 列表/未读全量
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

const events = [];
const sandbox = {
  console, setTimeout, clearTimeout,
  performance: { now: () => Date.now(), memory: { usedJSHeapSize: 1, totalJSHeapSize: 1 } },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  setInterval: () => 1, clearInterval: () => {},
  navigator: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  BroadcastChannel: class { constructor() {} postMessage() {} close() {} },
  Blob: class {}, URL: { createObjectURL: () => 'x', revokeObjectURL: () => {} },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || {}; } },
  Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set,
  TextEncoder
};
sandbox.window = {
  __YAMI_PERF_PROBE__: undefined,
  dispatchEvent: (ev) => { events.push(ev.type); return true; },
  addEventListener: () => {}, devicePixelRatio: 1
};
vm.createContext(sandbox);
vm.runInContext(probeSrc, sandbox);
const probe = sandbox.window.__YAMI_PERF_PROBE__;

console.log('=== 1. 同源错误广播节流 (3s 窗口) ===');
console.error('测试错误A: 引擎炸了');
console.error('测试错误A: 引擎炸了');   // 50ms 内同源第二次
console.error('测试错误A: 引擎炸了');   // 第三次
await new Promise(r => setTimeout(r, 50));
const newErrCount1 = events.filter(t => t === 'yami-perf-new-error').length;
check('3 连发同源错误只广播 1 次', newErrCount1 === 1, 'dispatch=' + newErrCount1);
check('同源 3 连发指纹聚合为 1 条 (count=3)', probe.getErrorCount() === 1 && probe.getErrors()[0].count === 3, 'count=' + probe.getErrorCount());
const unread = probe.state.errorUnreadCount;
check('未读计数 = 1 (条数语义封顶)', unread === 1, 'unread=' + unread);

console.log('=== 2. 不同源错误立即广播 ===');
console.error('另一个错误: 文件不存在 404');
await new Promise(r => setTimeout(r, 50));
const newErrCount2 = events.filter(t => t === 'yami-perf-new-error').length;
check('新类型错误立即广播', newErrCount2 === 2, 'dispatch=' + newErrCount2);

console.log('=== 3. 3s 窗口过后同源错误再次广播 ===');
await new Promise(r => setTimeout(r, 3150));
console.error('测试错误A: 引擎炸了');
await new Promise(r => setTimeout(r, 50));
const newErrCount3 = events.filter(t => t === 'yami-perf-new-error').length;
check('窗口过后同源错误再次广播', newErrCount3 === 3, 'dispatch=' + newErrCount3);
check('最终 2 条: 错A聚合4次 + 错B', probe.getErrorCount() === 2 && probe.getErrors()[0].count === 4, 'n=' + probe.getErrorCount());

console.log('=== 4. clearErrors 清列表与未读 ===');
probe.clearErrors();
check('clearErrors 后列表 0', probe.getErrorCount() === 0 && probe.state.errorUnreadCount === 0);

console.log('=== 5. hud 已读/去重/清理 静态锚点 ===');
check('seenErrorKeys 已读记忆存在', hudSrc.includes('const seenErrorKeys = new Set();'));
check('markSeenExistingErrors 存在', hudSrc.includes('function markSeenExistingErrors()'));
check('气泡仅新类型弹 (freshType)', hudSrc.includes('const freshType = !(detail && seenErrorKeys.has(errKeyOf(detail)));'));
check('进入大盘即已读 (toggleDock 内调用)', hudSrc.includes('markSeenExistingErrors();') && hudSrc.includes('refreshDockData();'));
check('收起大盘防御清理气泡+计时器', hudSrc.includes("if (errorBubbleTimer) { clearTimeout(errorBubbleTimer); errorBubbleTimer = null; }"));
check('errKeyOf 同源口径 = message|source', hudSrc.includes("'|' + String((r && (r.source || '')) || '')"));

console.log('\n========== 错误流测试: ' + passed + ' PASS / ' + failed + ' FAIL ==========');
process.exit(failed > 0 ? 1 : 0);
