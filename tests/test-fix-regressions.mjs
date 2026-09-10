// 缺陷修复回归 (extension 分支): 引擎 API 假设 / 数据语义 / 文案映射 / 代理健壮性
// 用法: node tests/test-fix-regressions.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---------- 沙箱: 最小引擎模拟 ----------
const player = { passage: 3, navigator: { movementSpeed: 4 }, attributes: { health: 37, maxHealth: 100 } };
let monsterDestroyed = false;
const monster = {
  attributes: { health: 50, maxHealth: 50 },
  destroy() { monsterDestroyed = true; },
  emit() { /* 引擎 emit 只派发事件，不负责移除 */ }
};
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout, clearTimeout,
  performance: { now: () => Date.now(), memory: { usedJSHeapSize: 1, totalJSHeapSize: 1 } },
  // 捕获 rAF 回调以便手动驱动帧循环: refresh() 在第 0 帧安装 Variable.set 钩子
  requestAnimationFrame: (cb) => { sandbox.__raf = cb; return 1; },
  cancelAnimationFrame: () => {},
  // 捕获定时器回调: probe-core 用 setInterval(...,100) 反复 refresh() 直到引擎就绪
  setInterval: (cb) => { sandbox.__timers = sandbox.__timers || []; sandbox.__timers.push(cb); return 1; },
  clearInterval: () => {},
  navigator: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  BroadcastChannel: class { constructor() {} postMessage() {} close() {} },
  Blob: class {}, URL: { createObjectURL: () => 'x', revokeObjectURL: () => {} },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || {}; } },
  Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set,
  TextEncoder, fetch: async () => ({ ok: false, json: async () => ({}) }),
  Party: { player, members: [player] },
  // 游戏自身处于慢动作: 「全部还原」必须还回 0.3，而不是硬写 1
  Time: { timeScale: 0.3, deltaTime: 16.6 },
  Scene: { binding: {}, actor: { list: [player, monster] } },
  // 引擎 Variable.set 语义: 键不存在或类型不符时静默丢弃 (variable.ts:117-133)
  Variable: {
    map: {},
    set(k, v) { const t = typeof this.map[k]; if (typeof v === t) this.map[k] = v; }
  },
  // 引擎初始化后 Data.events 被 delete，事件总数真实来源是 EventManager.guidMap (event.ts:45/88)
  EventManager: { activeEvents: [], guidMap: { a: 1, b: 2, c: 3 } }
};
sandbox.window = {
  __YAMI_PERF_PROBE__: undefined,
  dispatchEvent: () => true, addEventListener: () => {}, devicePixelRatio: 1
};
vm.createContext(sandbox);
vm.runInContext(probeSrc, sandbox);
const probe = sandbox.window.__YAMI_PERF_PROBE__;

// 驱动探针定时器与帧循环: refresh() → 安装 Variable.set 写入告警钩子
for (const timer of sandbox.__timers || []) { try { timer(); } catch (e) {} }
for (let i = 0; i < 2 && sandbox.__raf; i++) {
  try { sandbox.__raf(); } catch (e) { /* 帧循环依赖大量引擎对象, 异常不影响断言 */ }
}
check('Variable.set 写入告警钩子已安装', sandbox.Variable.__yamiCheatsHooked__ === true);

console.log('=== 1. 变速/全部还原: 还回游戏自身 timeScale (而非硬写 1) ===');
probe.setCheat('speedMultiplier', 2);
check('2x 时 timeScale 归 1 (倍数靠追帧实现)', sandbox.Time.timeScale === 1, 'timeScale=' + sandbox.Time.timeScale);
probe.resetAllCheats();
check('全部还原后还回游戏原有 timeScale', sandbox.Time.timeScale === 0.3, 'timeScale=' + sandbox.Time.timeScale);
probe.setCheat('speedMultiplier', 0.5);
check('0.5x 走 timeScale', sandbox.Time.timeScale === 0.5, 'timeScale=' + sandbox.Time.timeScale);
probe.setCheat('speedMultiplier', 1);
check('切回 1x 还回游戏原有 timeScale', sandbox.Time.timeScale === 0.3, 'timeScale=' + sandbox.Time.timeScale);

console.log('=== 2. 秒杀全图怪: 必须真正销毁角色实例 ===');
const killed = probe.killAllMonsters();
check('返回击杀数 1 (不含主角)', killed === 1, 'count=' + killed);
check('怪物走 destroy() 真正移除', monsterDestroyed === true);
check('怪物血量归零', monster.attributes.health === 0, 'health=' + monster.attributes.health);
check('主角未被误伤', player.attributes.health === 37, 'health=' + player.attributes.health);

console.log('=== 3. 全局事件总数: 取 EventManager.guidMap ===');
const ev = probe.getActiveEvents();
check('totalRegistered = guidMap 条目数 3', ev.totalRegistered === 3, 'total=' + ev.totalRegistered);

console.log('=== 4. 变量写入告警: 键不存在必须提醒 (引擎静默丢弃) ===');
sandbox.Variable.set('不存在的变量', 5);
const warns = probe.getVariableWarnings();
check('缺失键写入被记录告警', !!warns['不存在的变量']);
check('告警原因标明「变量不存在」', !!warns['不存在的变量'] && /不存在/.test(warns['不存在的变量'].reason), warns['不存在的变量'] ? warns['不存在的变量'].reason : 'none');

console.log('=== 5. console.error 代理: 循环引用对象不得把异常抛回游戏 ===');
const circular = {}; circular.self = circular;
let threw = false;
const beforeCount = probe.getErrors().length;
try { sandbox.console.error('节点异常', circular); } catch (e) { threw = true; }
check('代理调用未抛异常', threw === false);
check('循环引用被安全降级记录', probe.getErrors().length > beforeCount, 'errors=' + probe.getErrors().length);

console.log('=== 6. 文案映射: 诊断分类必须全部有中文标签 (铁律⑱) ===');
const catKeys = new Set();
const catBlock = hudSrc.slice(hudSrc.indexOf('const CAT_LABEL = {'), hudSrc.indexOf('};', hudSrc.indexOf('const CAT_LABEL = {')));
for (const m of catBlock.matchAll(/(?:'([^']+)'|([A-Za-z][A-Za-z0-9]*))\s*:/g)) catKeys.add(m[1] || m[2]);
const probeCats = new Set();
// 只扫 analyzeError 函数体内的分类: 工程体检用的是另一套「引用丢失性质」分类域,
// 全库通扫会把它的 category 也当成报错分类, 属测试自身的跨域误匹配 (v0.11.0 修)
const analyzeStart = probeSrc.indexOf('function analyzeError');
const analyzeNext = analyzeStart >= 0 ? probeSrc.indexOf('\n  function ', analyzeStart + 10) : -1;
const analyzeBody = analyzeStart >= 0 ? probeSrc.slice(analyzeStart, analyzeNext > 0 ? analyzeNext : probeSrc.length) : '';
for (const m of analyzeBody.matchAll(/category\s*[:=]\s*'([A-Za-z][A-Za-z0-9]*)'/g)) probeCats.add(m[1]);
const missing = [...probeCats].filter((c) => !catKeys.has(c));
check('analyzeError 全部分类都有中文标签', missing.length === 0, '缺: ' + (missing.join(',') || '无'));
check('hud 卡片头部走统一映射函数', hudSrc.includes('catLabel(a.category, err.type)'));

console.log('=== 7. UI 接线契约 (静态) ===');
check('存档台具备脏标记守卫', hudSrc.includes('if (this.dirty) return;'));
check('小窗取数源为 Variable.map', hudSrc.includes("Variable.map && typeof Variable.map === 'object'"));
check('场景台 destroy 显式解绑监听', hudSrc.includes("removeEventListener('click', this._onClickBound)"));
check('报错列表具备重建签名守卫', hudSrc.includes('renderSig === errorsRenderSig'));

console.log('\n========== 修复回归: ' + passed + ' PASS / ' + failed + ' FAIL ==========');
process.exit(failed > 0 ? 1 : 0);
