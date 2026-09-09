// Yami Perf Extension v3 自回归: 原型级挂起语义完整验证 (extension 分支根目录)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

let _now = 1000;
const sleep = (ms) => { _now += ms; };
const rafQ = [];
let intervals = []; let intervalSeq = 0;
const jankEvents = [];
const broadcastPackets = [];

const sandbox = {
  console,
  setTimeout, clearTimeout,
  performance: { now: () => _now, memory: { usedJSHeapSize: 220 * 1048576, totalJSHeapSize: 1024 * 1048576 } },
  requestAnimationFrame: (cb) => { rafQ.push(cb); return rafQ.length; },
  cancelAnimationFrame: () => {},
  setInterval: (cb) => { intervals.push({ cb, id: ++intervalSeq }); return intervalSeq; },
  clearInterval: (id) => { intervals = intervals.filter(t => t.id !== id); },
  navigator: { clipboard: { writeText: async () => {} } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  BroadcastChannel: class { constructor() {} postMessage(d) { broadcastPackets.push(d); } close() {} },
  Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || {}; } },
  Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set, fetch: async () => ({ ok: false, json: async () => ({}) })
};
sandbox.window = {
  __YAMI_PERF_PROBE__: undefined,
  dispatchEvent: (ev) => { if (ev && ev.type === 'yami-perf-jank') jankEvents.push(ev); return true; },
  addEventListener: () => {}, devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080
};

// ---------- 类定义(供原型级拦截) ----------
const jankFlag = { on: false, ms: 38 };
class Actor {
  constructor(name, opts = {}) {
    this.name = name;
    this.isPlayer = !!opts.player;
    this.ms = opts.ms ?? 0.2;
    this.dyn = !!opts.dyn;
    this.calls = 0;
  }
  update() {
    this.calls++;
    sleep(this.dyn && jankFlag.on ? jankFlag.ms : this.ms);
  }
}
class EventHandler {
  constructor(path, type, ms = 0.3) { this.path = path; this.initial = { path, type }; this.type = type; this.commands = []; this.index = 0; this.ms = ms; this.calls = 0; }
  update() { this.calls++; sleep(this.ms); }
}
class SceneParticleEmitterManager {
  constructor(list = []) { this.list = list; this.calls = 0; }
  update() { this.calls++; for (const e of this.list) e.update(); }
}
const emitterItem = { name: '火焰雨', calls: 0, update() { this.calls++; sleep(0.8); } };

// ---------- 引擎全局 ----------
const Local = { active: 'zh-CN', language: 'zh-CN', textMap: { 'anim_fire': { contents: { 'zh-CN': '烈焰爆发' } }, 'ui_main': { contents: { 'zh-CN': '主界面' } } } };
const hero = new Actor('勇者', { player: true, ms: 0.2 });
const boss = new Actor('Boss', { dyn: true, ms: 1.2 });
const ev1 = new EventHandler('common/商店.event', 'commonEvent', 0.3);

const Scene = {
  visibleActors: { count: 2 }, visibleAnimations: { count: 1 }, visibleTriggers: { count: 1 },
  particleCount: 42, preventInput() {}, restoreInput() {},
  actor: {
    list: [hero, boss],
    calls: 0,
    update() { this.calls++; for (const a of this.list) a.update(); sleep(0.5); }
  },
  animation: { list: [{ name: 'anim_fire', data: { name: 'anim_fire' }, calls: 0, update() { this.calls++; sleep(0.5); } }] },
  trigger: { list: [{ name: '传送门', calls: 0, update() { this.calls++; sleep(0.4); } }] },
  emitter: new SceneParticleEmitterManager([emitterItem])
};
const UI = {
  manager: { list: [{ name: 'ui_main', updaters: { calls: 0, update() { this.calls++; sleep(0.35); } } }] },
  calls: 0, renderCalls: 0,
  update() { this.calls++; UI.manager.list.forEach(el => el.updaters.update()); },
  render() { this.renderCalls++; }
};
const AudioManager = { se: { calls: 0, play() { this.calls++; }, stop() {}, gain: { gain: { value: 1 } } } };
const Party = { player: hero, members: [] };
const EventManager = { activeEvents: [ev1] };
const Time = { fps: 60, deltaTime: 16.6, rawDeltaTime: 16.6, update() {} };
const GL = { width: 1920, height: 1080, textureManager: { count: 100, update() {} } };
const Camera = { x: 10, y: 20, zoom: 1.5, width: 1920, height: 1080 };
const Data = {};

function WebGLRenderingContext() {}
WebGLRenderingContext.prototype = {
  drawElements() {}, drawArrays() {}, useProgram() {}, bindTexture() {}, texImage2D() {}, texSubImage2D() {}
};
function WebGL2RenderingContext() {}
WebGL2RenderingContext.prototype = {
  drawElements() {}, drawArrays() {}, useProgram() {}, bindTexture() {}, texImage2D() {}, texSubImage2D() {}, texImage3D() {}
};
const glctx = new WebGLRenderingContext();

const renderUpdater = {
  update() {
    glctx.drawElements(4, 6000, 5123, 0);
    glctx.texImage2D(3553, 0, 6408, 256, 256, 0, 6408, 5121, null);
    glctx.drawElements(4, 30000, 5123, 0);
  }
};
const Game = {
  updaters: [
    { update() {
        Scene.actor.update(Time.deltaTime);
        for (const a of Scene.animation.list) a.update(Time.deltaTime);
        for (const t of Scene.trigger.list) t.update(Time.deltaTime);
        Scene.emitter.update(Time.deltaTime);
        UI.update();
        for (const ev of EventManager.activeEvents) ev.update(Time.deltaTime);
        AudioManager.se.play();
        renderUpdater.update();
      } },
  ],
  renderers: [{ render() { UI.render(); } }], paused: false,
  update() { this.updaters.forEach(m => m.update()); },
  deferredRendering() {},
  defer: { then: (fn) => { fn(); } }
};

Object.assign(sandbox, {
  Game, Scene, UI, EventManager, Time, GL, Camera, Data, Local,
  Actor, EventHandler, SceneParticleEmitterManager, AudioManager, Party,
  WebGLRenderingContext, WebGL2RenderingContext, glctx
});

const context = vm.createContext(sandbox);
vm.runInContext(probeSrc, context, { filename: 'probe-core.js' });
const probe = sandbox.window.__YAMI_PERF_PROBE__;

console.log('=== 1. 注入与原型拦截 ===');
check('probe API', !!probe && typeof probe.suspend === 'function');

function flushIntervals() { intervals.slice().forEach(t => { try { t.cb(); } catch (e) {} }); }
flushIntervals(); flushIntervals(); flushIntervals();
function stepFrame() {
  if (rafQ.length) rafQ.shift()();
  Game.update();
  Game.renderers.forEach(function (m) { m.render(); });
  flushIntervals();
}

console.log('=== 2. 对象级归因 ===');
for (let i = 0; i < 30; i++) stepFrame();
const objNames = (probe.getReport().objects || []).map(o => o.kind + ':' + o.name);
check('主角/怪物/本地化/碰撞差额入榜', objNames.includes('actors:勇者') && objNames.includes('actors:Boss') && objNames.some(n => n.includes('烈焰爆发')) && objNames.includes('actors:碰撞与分区(集合)'), objNames.join(' | '));
check('粒子/触发器/界面归因', objNames.some(n => n.startsWith('emitters:')) && objNames.some(n => n.startsWith('triggers:')) && objNames.some(n => n.startsWith('ui:')), objNames.join(' | '));

console.log('=== 3. WebGL ===');
for (let i = 0; i < 3; i++) stepFrame();
const wgl = probe.getReport().webgl || {};
check('纹理上传/大绘制/DC', (wgl.lastTextureUploads || 0) >= 1 && (wgl.lastTextureUploadKB || 0) >= 256 && (wgl.lastBigDraws || 0) >= 1 && (wgl.lastDrawCalls || 0) >= 2, JSON.stringify(wgl));

console.log('=== 4. 挂起语义: 主角放行/怪物冻结 ===');
const h1 = hero.calls, b1 = boss.calls, mg1 = Scene.actor.calls;
probe.suspend('actors', true);
check('原型层已装(首次suspend惰性触发)', Actor.prototype.__yamiPerfSuspendHooked__ === true && EventHandler.prototype.__yamiPerfSuspendHooked__ === true && SceneParticleEmitterManager.prototype.__yamiPerfSuspendHooked__ === true && UI.__yamiPerfSuspendHooked__ === true, 'actor=' + !!Actor.prototype.__yamiPerfSuspendHooked__);
for (let i = 0; i < 10; i++) stepFrame();
check('非主角(Boss)冻结', boss.calls === b1, b1 + '->' + boss.calls);
check('主角(勇者)放行', hero.calls > h1, h1 + '->' + hero.calls);
check('管理器(碰撞)持续执行', Scene.actor.calls > mg1, mg1 + '->' + Scene.actor.calls);
probe.suspend('actors', false);
for (let i = 0; i < 3; i++) stepFrame();
check('怪物恢复', boss.calls > b1, b1 + '->' + boss.calls);

console.log('=== 5. 五系统挂起 ===');
const pm1 = Scene.emitter.calls, ev1c = ev1.calls, ui1 = UI.calls, uiR1 = UI.renderCalls, se1 = AudioManager.se.calls;
probe.suspend('emitters', true); probe.suspend('events', true); probe.suspend('ui', true); probe.suspend('audio', true);
for (let i = 0; i < 5; i++) stepFrame();
check('粒子管理器停(原型层)', Scene.emitter.calls === pm1, pm1 + '->' + Scene.emitter.calls);
check('事件停(原型层)', ev1.calls === ev1c, ev1c + '->' + ev1.calls);
check('UI 更新停', UI.calls === ui1, ui1 + '->' + UI.calls);
check('UI 渲染停', UI.renderCalls === uiR1, uiR1 + '->' + UI.renderCalls);
check('音频 SE 停', AudioManager.se.calls === se1, se1 + '->' + AudioManager.se.calls);
probe.suspend('emitters', false); probe.suspend('events', false); probe.suspend('ui', false); probe.suspend('audio', false);
for (let i = 0; i < 3; i++) stepFrame();
check('全部恢复', Scene.emitter.calls > pm1 && ev1.calls > ev1c && UI.calls > ui1, '恢复OK');
check('音频恢复(调用计数)', AudioManager.se.calls > se1, se1 + '->' + AudioManager.se.calls);

console.log('=== 6. 卡顿归因 ===');
for (let i = 0; i < 300 && !jankEvents.length; i++) {
  if (i % 3 === 0) jankFlag.on = true;
  stepFrame();
  jankFlag.on = false;
}
check('jank 事件', jankEvents.length >= 1, 'n=' + jankEvents.length);
const jr = (probe.getReport().overBudgetFrames || []).filter(f => f.compute > 33.3);
check('culprit/objects 对象级', !!jankEvents[0] && /Boss/.test(jankEvents[0].detail.culprit), jankEvents[0] && jankEvents[0].detail.culprit);
check('objects[0]=Boss≈38ms', jr.length >= 1 && jr[0].objects && jr[0].objects[0] && jr[0].objects[0].name === 'Boss' && jr[0].objects[0].ms >= 30, JSON.stringify(jr[0] && jr[0].objects && jr[0].objects[0]));
check('jank 带纹理上传字段', jr.length >= 1 && 'textureUploadKB' in jr[0], jr[0] && 'kb=' + jr[0].textureUploadKB);

console.log('=== 7. 错误捕获 ===');
// 触发一次错误
sandbox.console.error('[test-error] 模拟异常 abc123');
check('console.error 被捕获', typeof probe.getErrorCount === 'function' && probe.getErrorCount() >= 1, 'count=' + (probe.getErrorCount ? probe.getErrorCount() : '?'));
check('clearErrors 可清', probe.clearErrors() === true && probe.getErrorCount() === 0);

console.log('=== 8. hud 静态 ===');
const idsInHtml = new Set();
let m; const idRe = /id="([a-zA-Z0-9_-]+)"/g;
while ((m = idRe.exec(hudSrc))) idsInHtml.add(m[1]);
const created = new Set(['yami-perf-toast', 'yami-capsule', 'yami-perf-dock', 'yami-perf-mini-hud', 'jank-wave-canvas', 'yami-perf-style']);
const missing = [];
// 外部宿主元素豁免: 插件需探测 Open Yami 编辑器自身 DOM(如 PageManager), 不属于插件 HTML 属正常
const hostIds = new Set(['workspace-page-manager']);
const gidRe = /getElementById\(['"]([^'"]+)['"]\)/g;
while ((m = gidRe.exec(hudSrc))) if (!idsInHtml.has(m[1]) && !created.has(m[1]) && !hostIds.has(m[1])) missing.push(m[1]);
check('id 引用完整', missing.length === 0, missing.join(','));
check('无粒子微粒/独立微粒', !hudSrc.includes('粒子微粒') && !/粒子微粒|(?<![粒子])微粒/.test(hudSrc));
check('Remix 内联+零网络', hudSrc.includes('<path d="M') && !hudSrc.includes('@font-face') && !hudSrc.includes('.woff'));
check('穿透双保险', hudSrc.includes('applyThroughState') && hudSrc.includes('.show.through'));
check('胶囊联动隐身', /hud.*setProperty\(['"]display['"],\s*['"]none['"]/s.test(hudSrc));
check('btn-dock-close HTML 唯一', (hudSrc.match(/id="btn-dock-close"/g) || []).length === 1);
check('XSS 转义函数', hudSrc.includes('function esc('));
check('广播带 objects', broadcastPackets.some(p => p.type === 'PERF_STREAM_TICK' && Array.isArray(p.data.objects)));

console.log('\n========== v3 结果: ' + passed + ' PASS / ' + failed + ' FAIL ==========');
process.exit(failed === 0 ? 0 : 1);