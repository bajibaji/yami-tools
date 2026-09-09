// 作弊台「全部还原」回归 (extension 分支): resetAllCheats 状态复位 + 主角原本属性复原 + hud 接线契约
// 用法: node tests/test-cheats-reset.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---------- 沙箱: 最小 Party / Time / Scene ----------
const player = {
  passage: 3,
  navigator: { movementSpeed: 4 },
  attributes: { health: 37, maxHealth: 100 }
};
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
  TextEncoder, fetch: async () => ({ ok: false, json: async () => ({}) }),
  Party: { player, members: [player] },
  Time: { timeScale: 1, deltaTime: 16.6 },
  Scene: { binding: {}, actor: { list: [player] } }
};
sandbox.window = {
  __YAMI_PERF_PROBE__: undefined,
  dispatchEvent: () => true, addEventListener: () => {}, devicePixelRatio: 1
};
vm.createContext(sandbox);
vm.runInContext(probeSrc, sandbox);
const probe = sandbox.window.__YAMI_PERF_PROBE__;

console.log('=== 1. 作弊开启: 原值被记录且实际生效 ===');
probe.setCheat('noClip', true);
probe.setCheat('speedBoost', true);
probe.setCheat('godMode', true);
probe.setCheat('speedMultiplier', 5);
check('穿墙生效 (passage=-1)', player.passage === -1, 'passage=' + player.passage);
check('加速跑生效 (movementSpeed=12)', player.navigator.movementSpeed === 12, 'speed=' + player.navigator.movementSpeed);
check('锁血生效 (health 刷满 100)', player.attributes.health === 100, 'health=' + player.attributes.health);
const before = probe.getCheats();
check('getCheats 反映全部开启', before.noClip && before.speedBoost && before.godMode && before.speedMultiplier === 5);

console.log('=== 2. 全部还原: 开关归零 + 主角原本属性复原 ===');
const ret = probe.resetAllCheats();
const after = probe.getCheats();
check('resetAllCheats 返回 true', ret === true);
check('变速复位 1x', after.speedMultiplier === 1, 'speed=' + after.speedMultiplier);
check('穿墙关闭', after.noClip === false);
check('加速跑关闭', after.speedBoost === false);
check('锁血关闭', after.godMode === false);
check('主角原本通行能力复原 (passage=3)', player.passage === 3, 'passage=' + player.passage);
check('主角原本移速复原 (movementSpeed=4)', player.navigator.movementSpeed === 4, 'speed=' + player.navigator.movementSpeed);
check('Time.timeScale 复位 1', sandbox.Time.timeScale === 1, 'timeScale=' + sandbox.Time.timeScale);
check('内部原值缓存已清空', probe.state.cheats.origPlayerPassage === null && probe.state.cheats.origPlayerSpeed === null);

console.log('=== 3. 还原后不再干预游戏数值 ===');
player.attributes.health = 20;
probe.setCheat('godMode', false);
check('还原后血量可正常扣减 (不再刷满)', player.attributes.health === 20, 'health=' + player.attributes.health);
player.passage = 2;
probe.setCheat('noClip', false);
check('还原后通行能力不再被改写', player.passage === 2, 'passage=' + player.passage);

console.log('=== 4. hud 接线契约 (静态) ===');
check('作弊页存在全部还原按钮锚点', /id="btn-cheat-reset-all"/.test(hudSrc));
check('按钮接线 probe.resetAllCheats()', /probe\.resetAllCheats\(\)/.test(hudSrc));
check('状态指示锚点存在', /id="cheat-reset-indicator"/.test(hudSrc));
check('全库零原生 <button> 标签 (铁律②)', (hudSrc.match(/<button[\s>]/g) || []).length === 0);

console.log(`\n=== 汇总: ${passed} 通过 / ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
