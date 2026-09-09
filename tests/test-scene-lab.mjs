// Scene Inspector (v0.5.0) 自回归: probe.getSceneEntities 快照 + hud SceneLab 渲染集成
// 用法: node tests/test-scene-lab.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---------- 通用基座 ----------
function baseSandbox() {
  const sb = {
    console, setTimeout, clearTimeout,
    performance: { now: () => Date.now(), memory: { usedJSHeapSize: 1, totalJSHeapSize: 1 } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setInterval: () => 1, clearInterval: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    BroadcastChannel: class { constructor() {} postMessage() {} close() {} },
    Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || {}; } },
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    ResizeObserver: class { constructor() {} observe() {} disconnect() {} },
    Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set, TextEncoder
  };
  sb.window = { __YAMI_PERF_PROBE__: undefined, dispatchEvent: () => true, addEventListener: () => {}, devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080 };
  return sb;
}

// ---------- 引擎 stub ----------
class Actor {
  constructor(name, opts = {}) {
    this.name = name;
    this.x = opts.x ?? 10; this.y = opts.y ?? 12;
    this.angle = opts.angle ?? 0;
    this.priority = opts.priority ?? 0;
    this.visible = opts.visible ?? true;
    this.passage = opts.passage ?? 0;
    this.data = { id: opts.fileId || null, type: opts.dataType || 'local', name: opts.fileName || name };
    this.presetId = opts.presetId || null;
    this.collider = opts.collider ? { shape: opts.collider.shape || 'circle', size: opts.collider.size ?? 1, half: (opts.collider.size ?? 1) / 2, immovable: !!opts.collider.immovable, moved: !!opts.collider.moved } : null;
    this.navigator = opts.nav ? { mode: opts.nav.mode || 'stop', movementSpeed: opts.nav.speed || 0, movementFactor: 1, movementPath: opts.nav.path ? {} : null, velocityX: 0, velocityY: 0, target: null } : null;
    this.animation = opts.anim ? { visible: true, paused: false, ended: false, motionName: opts.anim || '', length: 4, index: 0 } : null;
  }
}
class GlobalActor extends Actor {}
class SceneRegion {
  constructor(name, opts = {}) {
    this.name = name;
    this.x = opts.x ?? 5; this.y = opts.y ?? 6;
    this.width = opts.width ?? 4; this.height = opts.height ?? 3;
    this.actors = (opts.inside || []).slice();
    this.presetId = opts.presetId || null;
  }
}
const Data = {};

function buildScene(withRegion = true) {
  const local1 = new Actor('新手村守卫', { x: 3, y: 4, dataType: 'local', fileId: 'npc_guard', presetId: 'preset_guard', collider: { shape: 'circle', size: 1, immovable: true }, passage: 15, anim: 'idle' });
  const localHidden = new Actor('隐形怪物', { x: 8, y: 9, visible: false, dataType: 'local', fileId: 'mon_hide', collider: { shape: 'rect', size: 2 } });
  const heroG = new GlobalActor('勇者', { x: 5, y: 5, dataType: 'global', fileId: 'hero', collider: { shape: 'circle', size: 1, moved: true }, nav: { mode: 'navigate', speed: 3, path: true }, anim: 'move' });
  const boss = new GlobalActor('最终Boss', { x: 20, y: 20, dataType: 'global', fileId: 'boss', visible: false, nav: { mode: 'follow', speed: 1.5 } });
  const Party = { player: heroG, members: [heroG] };
  const region = withRegion ? new SceneRegion('事件触发区', { x: 5, y: 6, width: 4, height: 3, inside: [heroG, local1], presetId: 'preset_region' }) : null;
  const Scene = {
    binding: { id: 'MAP001', data: { path: 'map/新城镇.map', width: 40, height: 30, tileWidth: 48 } },
    visibleActors: { count: 2 }, visibleAnimations: { count: 1 }, visibleTriggers: { count: 0 },
    particleCount: 12,
    actor: { list: [local1, localHidden, heroG, boss] },
    region: { list: region ? [region] : [] },
    animation: { list: [{ name: 'flame' }] },
    emitter: { list: [{ name: 'smoke' }] },
    trigger: { list: [] },
    light: { list: [] }
  };
  return { Scene, Party, actorRefs: { local1, localHidden, heroG, boss, region } };
}

// ============================================================
// 第一部分: probe.getSceneEntities 纯逻辑
// ============================================================
console.log('=== 1. probe 导出 ===');
const sb1 = baseSandbox();
Object.assign(sb1, { Data });
vm.createContext(sb1);
vm.runInContext(probeSrc, sb1);
const probe = sb1.window.__YAMI_PERF_PROBE__;
check('getSceneEntities 已导出', typeof probe.getSceneEntities === 'function');

console.log('=== 2. 空态 (无 Scene 全局) ===');
const empty = probe.getSceneEntities();
check('无 Scene -> ok 且 scene=false', empty.ok === true && empty.scene === false);
check('无 Scene -> 空 counts 与空列表', empty.actors.local.length === 0 && empty.regions.length === 0 && empty.counts.actors === 0);

console.log('=== 3. 未绑定地图 (binding null) ===');
const sbN = baseSandbox();
const N = buildScene(false);
Object.assign(sbN, N, { Data, Actor, GlobalActor, SceneRegion });
vm.createContext(sbN);
vm.runInContext(probeSrc, sbN);
const probeN = sbN.window.__YAMI_PERF_PROBE__;
const origBinding = N.Scene.binding;
N.Scene.binding = null;
const noMap = probeN.getSceneEntities();
check('binding null -> scene=false 且不抛错', noMap.ok === true && noMap.scene === false && noMap.error === null);
N.Scene.binding = origBinding;

console.log('=== 4. 正常场景 schema ===');
const sb2 = baseSandbox();
const S = buildScene(true);
const heroRef = S.actorRefs.heroG;
Object.assign(sb2, S, { Data, Actor, GlobalActor, SceneRegion, ActorManager: { idMap: {} } });
vm.createContext(sb2);
vm.runInContext(probeSrc, sb2);
const probe2 = sb2.window.__YAMI_PERF_PROBE__;
const snap = probe2.getSceneEntities();
check('ok 且 scene=true', snap.ok === true && snap.scene === true, JSON.stringify(snap.error || ''));
check('meta 地图信息', snap.meta.sceneId === 'MAP001' && snap.meta.path === 'map/新城镇.map' && snap.meta.width === 40 && snap.meta.tileWidth === 48, JSON.stringify(snap.meta));
check('counts 计数合并', snap.counts.actors === 4 && snap.counts.animations === 1 && snap.counts.particles === 12, JSON.stringify(snap.counts));
check('角色分组: 2 场景放置 + 2 全局', snap.actors.local.length === 2 && snap.actors.global.length === 2, 'l=' + snap.actors.local.length + ' g=' + snap.actors.global.length);
const gHero = snap.actors.global.find(a => a.name === '勇者');
check('global 角色字段 (collider/nav/anim/player)', gHero && gHero.isPlayer === true && gHero.collider.shape === 'circle' && gHero.collider.immovable === false && gHero.nav.mode === 'navigate' && gHero.nav.moving === true && gHero.nav.hasPath === true && gHero.anim.motion === 'move', JSON.stringify(gHero));
const gGuard = snap.actors.local.find(a => a.name === '新手村守卫');
check('local 角色坐标/通行/文件名', gGuard && gGuard.x === 3 && gGuard.y === 4 && gGuard.fileId === 'npc_guard' && gGuard.passage === 15 && gGuard.collider.shape === 'circle' && gGuard.collider.immovable === true);
check('隐藏实体可见性标记', snap.actors.local.find(a => a.name === '隐形怪物').visible === false && snap.actors.global.find(a => a.name === '最终Boss').visible === false);
check('区域 schema (范围/区内角色)', snap.regions.length === 1 && snap.regions[0].name === '事件触发区' && snap.regions[0].width === 4 && snap.regions[0].height === 3 && snap.regions[0].actorCount === 2 && snap.regions[0].actors.indexOf('勇者') >= 0 && snap.regions[0].actors.length === 2, JSON.stringify(snap.regions[0]));
check('区域坐标保留中心', snap.regions[0].x === 5 && snap.regions[0].y === 6);

console.log('=== 5. 数据变化一致性 ===');
const snapBefore = JSON.stringify(snap);
heroRef.x = 99;
const snap2 = probe2.getSceneEntities();
check('实体坐标变化 -> 快照 JSON 变化', JSON.stringify(snap2) !== snapBefore);
check('变化后的 x 反映', snap2.actors.global.find(a => a.name === '勇者').x === 99);

// ============================================================
// 第二部分: hud SceneLab 集成 (轻量 Proxy-DOM 冒烟)
// ============================================================
console.log('=== 6. hud 接线静态契约 ===');
const staticChecks = [
  ['register(scene) 存在', /Views\.register\('scene'/.test(hudSrc)],
  ['pages map 含 scene', /scene:\s*document\.getElementById\('page-scene'\)/.test(hudSrc)],
  ['#page-scene 骨架 + 渲染挂点', /id="page-scene"/.test(hudSrc) && /id="yami-scene-root"/.test(hudSrc)],
  ['主页第 4 卡 data-target=scene', /data-target="scene"/.test(hudSrc) && !/yami-home-module-item disabled[\s\S]*变量与开关/.test(hudSrc)]
];
staticChecks.forEach(c => check(c[0], c[1]));

console.log('=== 7. hud 集成渲染冒烟 (Proxy-DOM) ===');
function makeEl(id) {
  const el = {
    id: id || '', _html: '', _text: '', _children: [],
    style: { setProperty() {}, getPropertyValue: () => '', cssText: '' },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text; },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild(c) { this._children.push(c); return c; },
    insertBefore(c) { return c; }, removeChild() {}, replaceChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    closest: () => null, contains: () => false, focus() {}, blur() {}, value: '', checked: false
  };
  return el;
}
const byId = {};
const bodyEl = makeEl('body');
const docStub = {
  getElementById(id) { return byId[id] || (byId[id] = makeEl(id)); },
  createElement() { return makeEl(''); },
  createTextNode() { return {}; },
  body: bodyEl, head: makeEl('head'), documentElement: { style: {} },
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], title: ''
};
const lsStore = { 'yami-suite-active-view': 'scene', 'yami-perf-mode': 'basic' };
const sbHud = baseSandbox();
Object.assign(sbHud, S, { Data, Actor, GlobalActor, SceneRegion });
Object.assign(sbHud, {
  document: docStub,
  localStorage: { getItem: (k) => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = v; }, removeItem: (k) => { delete lsStore[k]; } },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
});
vm.createContext(sbHud);
vm.runInContext(probeSrc, sbHud);
const probeHud = sbHud.window.__YAMI_PERF_PROBE__;
check('hud 环境 probe 就绪', typeof probeHud.getSceneEntities === 'function');
try {
  vm.runInContext(hudSrc, sbHud, { filename: 'hud-overlay.js' });
  const rootEl = byId['yami-scene-root'];
  const html = (rootEl && rootEl._html) || '';
  check('hud IIFE 执行并进入 scene 渲染', html.length > 0 && html.indexOf('新手村守卫') >= 0, 'html=' + html.length);
  check('渲染含全局角色组与主角徽章', html.indexOf('全局角色') >= 0 && html.indexOf('主角') >= 0);
  check('渲染含触发区域组', html.indexOf('触发区域') >= 0 && html.indexOf('事件触发区') >= 0);
  check('渲染含过滤控件', html.indexOf('仅可见') >= 0 && html.indexOf('yami-scene-search') >= 0);
  const dockHtml = bodyEl._children.map(c => (c._html || '')).join('') + headEls();
  check('主页 dock 含第 4 卡入口', dockHtml.indexOf('data-target="scene"') >= 0 && dockHtml.indexOf('场景实体') >= 0, 'dock=' + dockHtml.length);
  function headEls() { try { return (docStub.head && docStub.head._children ? docStub.head._children.map(c => (c._html || '')).join('') : ''); } catch (e) { return ''; } }
} catch (err) {
  check('hud 集成渲染(无异常)', false, String((err && err.stack) || err).slice(0, 200));
}

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
