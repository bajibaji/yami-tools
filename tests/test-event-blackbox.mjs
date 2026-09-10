// 事件黑匣子 (指令级时间线 + 幽灵事件侦探) 回归测试
// 用法: node tests/test-event-blackbox.mjs
//
// 本套用「高保真伪引擎」验证核心机制: 伪 Command 编译器的循环语义与 arpg-ts-chinese 模板
// command.ts:120-179 逐条对齐 (禁用指令 ! 前缀跳过 / 一条指令可产出多槽 / null 结果不占槽 /
// 分支子列表递归编译), 从而证明 probe 在编译期建立的「原始指令 ↔ 编译槽位」映射在任何
// 组合下都能把 event.index 精确翻译回「第几步 + 那条指令在做什么」。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---------- 可控时钟 (验证「长时间无进展 → 挂起」需要推进时间) ----------
const RealDate = Date;
let fakeNowMs = RealDate.now();
function FakeDate(...args) {
  return args.length ? new RealDate(...args) : new RealDate(fakeNowMs);
}
FakeDate.now = () => fakeNowMs;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
FakeDate.prototype = RealDate.prototype;
const advanceTime = (ms) => { fakeNowMs += ms; };

// ---------- 高保真伪引擎 ----------
// 指令数据列表 (引擎里是带 path 的数组)
function makeCommands(list, path) {
  const arr = list.slice();
  arr.path = path;
  return arr;
}

class FakeActor {
  constructor(name) { this.name = name; this.destroyed = false; }
  update() { return true; }
}

// 伪 Command 编译器: 方法在原型上, setNumber 由类字段初始化 (对齐引擎实录)
class FakeCommandCompiler {
  constructor() {
    this.stack = [];
    this.labels = {};
    this.jumps = [];
    this.subLists = [];
    // 引擎 command.ts:1861 setNumber 由 IIFE 类字段初始化 → 实例自有属性而非原型方法
    this.setNumber = (function () {
      return function ({ variable, value }) { return () => true; };
    })();
  }

  // 对齐 command.ts:120 compile() 的推槽语义
  compile(commands, callback) {
    const functions = [];
    functions.path = (commands && commands.path) || '';
    const length = commands.length;
    for (let i = 0; i < length; i++) {
      const command = commands[i];
      if (typeof command === 'function') { functions.push(command); continue; }
      const id = command.id;
      if (id[0] === '!') continue;                       // 禁用指令: 不编译不占槽
      const fn = (id in this) ? this[id](command.params) : this.compileScript(command);
      if (fn === null) continue;                          // null: 不占槽
      if (typeof fn === 'function') { functions.push(fn); continue; }
      for (const f of fn) functions.push(f);              // 数组: 一条指令占多槽
    }
    functions.push(callback || (() => true));             // 栈尾回调占 1 槽
    return functions;
  }

  compileScript() { return () => true; }

  // ---- 原型指令编译器 (名字与引擎保持一致) ----
  setString({ variable }) { return () => true; }
  setBoolean({ variable }) { return () => true; }
  wait({ duration }) { return () => false; }
  comment() { return null; }
  label() { return null; }
  showText({ content }) { return () => true; }
  showChoices({ choices }) { return [() => true, () => true]; }   // 一条指令 → 2 槽
  block({ commands }) {
    const sub = this.compile(commands);
    this.subLists.push(sub);
    return [() => true, () => true, () => true];                  // 一条指令 → 3 槽
  }
  if({ commands }) {
    const sub = this.compile(commands, () => true);               // 分支子列表递归编译
    this.subLists.push(sub);
    return () => true;
  }
}

// 伪事件处理器 (对齐 event.ts:563 EventHandler)
class FakeEventHandler {
  constructor(commands) {
    this.complete = false;
    this.commands = commands;
    this.initial = commands;
    this.index = 0;
    this.timer = undefined;
    this.parent = undefined;
    this.priority = false;
    this.update = FakeEventHandler.prototype.update;
  }
  get type() { return this.initial.type || 'common'; }
  get path() { return this.initial.path || ''; }
  update() { return this.complete; }
  finish() {
    if (this.complete === false) {
      this.complete = true;
      this.update = FakeEventHandler.complete;
      if (this.__finishHook) this.__finishHook();
    }
  }
  onFinish(cb) { this.__finishHook = cb; }
}
FakeEventHandler.wait = () => false;
FakeEventHandler.complete = () => true;
FakeEventHandler.call = function (event) {
  if (event.update(0) === false) FakeEventManager.activeEvents.push(event);
  return event;
};

const FakeEventManager = { activeEvents: [], guidMap: {} };

// ---------- 载入探针 ----------
const sandbox = {
  console, setTimeout, clearTimeout,
  performance: { now: () => fakeNowMs, memory: { usedJSHeapSize: 1, totalJSHeapSize: 1 } },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  setInterval: () => 1, clearInterval: () => {},
  navigator: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  BroadcastChannel: class { constructor() {} postMessage() {} close() {} },
  Blob: class {}, URL: { createObjectURL: () => 'x', revokeObjectURL: () => {} },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || {}; } },
  Math, Date: FakeDate, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set, WeakMap,
  TextEncoder, fetch: async () => ({ ok: false, json: async () => ({}) }),
  require: (name) => {
    if (name === 'fs') return {
      existsSync: () => false,
      readFileSync: () => { throw new Error('ENOENT'); },
      readdirSync: () => []
    };
    if (name === 'path') return { join: (...a) => a.join('/'), dirname: (p) => String(p).split('/').slice(0, -1).join('/') };
    if (name === 'os') return { homedir: () => 'C:/Users/mock' };
    if (name === 'http') return { createServer: () => ({ listen: () => ({ on: () => {} }), on: () => {}, close: () => {} }) };
    throw new Error('no mock for ' + name);
  },
  process: { platform: 'win32', cwd: () => 'C:/mock-game' },
  Party: { player: null, members: [] },
  Time: { timeScale: 1, deltaTime: 16.6 },
  Scene: { binding: null, actor: { list: [] } },
  Actor: FakeActor,
  Command: new FakeCommandCompiler(),
  EventHandler: FakeEventHandler,
  EventManager: FakeEventManager
};
sandbox.window = {
  __YAMI_PERF_PROBE__: undefined,
  location: { pathname: 'C:/mock-game/index.html' },
  dispatchEvent: () => true, addEventListener: () => {}, devicePixelRatio: 1
};

vm.createContext(sandbox);
vm.runInContext(probeSrc, sandbox);
const probe = sandbox.window.__YAMI_PERF_PROBE__;
const Command = sandbox.Command;
const EventHandler = sandbox.EventHandler;
const EventManager = sandbox.EventManager;

// ============================================================
console.log('=== 1. 编译期指令映射 (原始指令 ↔ 编译槽位) ===');
// ============================================================
let box = probe.getEventBlackbox();
check('探测 API 存在', typeof probe.getEventBlackbox === 'function' && typeof probe.finishEvent === 'function');
check('编译期追踪已装上', box.trace === true);
check('事件启动钩子已装上', box.callHooked === true);
check('初始无在册事件', box.active.length === 0, 'n=' + box.active.length);

// 主事件: 禁用指令 / 多槽指令 / null 占位 / 已编译函数 / 分支子列表 全组合
const nestedRaw = makeCommands([
  { id: '!setString', params: {} },                            // 嵌套禁用
  { id: 'setString', params: { variable: { type: 'global', key: 'cccc3333dddd4444' } } }
], 'Assets/Event/分支块.9999888877776666.event');

const mainRaw = makeCommands([
  { id: 'setNumber', params: { variable: { type: 'global', key: 'aaaa1111bbbb2222' }, value: 100 } }, // raw0 → slot0
  { id: '!wait', params: { duration: 999 } },                                                        // 禁用   → 无槽
  { id: 'showChoices', params: { choices: [{ content: 'A' }, { content: 'B' }] } },                  // raw2 → slot1,2
  { id: 'label', params: { name: 'L1' } },                                                           // null  → 无槽
  { id: 'wait', params: { duration: 500 } },                                                         // raw4 → slot3
  { id: 'if', params: { variable: {}, commands: nestedRaw } },                                       // raw5 → slot4
  { id: 'block', params: { note: '块', asynchronous: false, commands: nestedRaw } }                   // raw6 → slot5,6,7
], 'Assets/Event/主线剧情.1111222233334444.event');

const mainList = Command.compile(mainRaw);
check('编译结果槽位数符合引擎语义', mainList.length === 9, 'len=' + mainList.length + ' (8 槽 + 栈尾回调)');
check('分支子列表已递归编译', Command.subLists.length === 2, 'n=' + Command.subLists.length);

// ============================================================
console.log('=== 2. 事件时间线: 步骤翻译与状态流转 ===');
// ============================================================
const ev = new EventHandler(mainList);
EventHandler.call(ev);
box = probe.getEventBlackbox();
check('事件启动即入册', box.active.length === 1, 'n=' + box.active.length);
check('事件名取自文件名 (无 GUID 残留)', box.active[0].name === '主线剧情', 'name=' + box.active[0].name);
check('流水含「启动」条目', box.entries.some(e => e.action === 'start' && e.name === '主线剧情'));

// 等待计时: 引擎把 update 换成计时器 tick 并设置剩余时间
ev.timer = { duration: 500 };
ev.index = 4;                                   // event.index 指向下一条 → 当前是 slot3 = raw4 (wait)
box = probe.getEventBlackbox();
let rec = box.active[0];
check('等待态识别', rec.state === 'waiting', 'state=' + rec.state);
check('等待剩余毫秒回传', rec.remainMs === 500, 'remainMs=' + rec.remainMs);
check('步骤翻译跳过禁用/null 指令', rec.step === 5, 'step=' + rec.step + ' (原始下标 4 + 1)');
check('指令白话描述', rec.desc === '等待 500 毫秒', 'desc=' + rec.desc);
check('流水含「等待」条目', box.entries.some(e => e.action === 'wait' && e.step === 5));

// 多槽指令的第 2 个槽仍应翻译回同一条原始指令 (showChoices raw2 → slot1,2)
ev.timer = undefined;
ev.index = 3;                                   // 指向下一条 → 当前 slot2 (showChoices 第 2 槽)
box = probe.getEventBlackbox();
rec = box.active[0];
check('多槽指令槽位翻译正确', rec.step === 3 && rec.desc === '弹出选项（2 项）', 'step=' + rec.step + ' desc=' + rec.desc);

// 变量类指令: 值走白话, 变量 GUID 单独回传供界面解密 (界面绝不裸露 GUID)
ev.index = 1;                                   // 当前 slot0 = raw0 (setNumber)
box = probe.getEventBlackbox();
rec = box.active[0];
check('变量指令白话 + GUID 分离回传', rec.desc === '设置数值' && rec.varKey === 'aaaa1111bbbb2222',
  'desc=' + rec.desc + ' varKey=' + rec.varKey);

// 分支子列表: 引擎切到子列表后, event.commands 指向子列表 (独立映射表)
const sub = Command.subLists[0];
ev.commands = sub;
ev.index = sub.length - 1;                      // 子列表最后一条 = setString (raw1)
box = probe.getEventBlackbox();
rec = box.active[0];
check('嵌套分支子列表独立翻译', rec.step === 2 && rec.desc === '设置文本' && rec.varKey === 'cccc3333dddd4444',
  'step=' + rec.step + ' desc=' + rec.desc);
check('子列表总步数剔除禁用指令', rec.total === 2, 'total=' + rec.total);
ev.commands = mainList;

// 暂停 (引擎把 update 换成 EventHandler.wait)
ev.update = FakeEventHandler.wait;
box = probe.getEventBlackbox();
check('暂停态识别', box.active[0].state === 'paused', 'state=' + box.active[0].state);
check('流水含「暂停」条目', box.entries.some(e => e.action === 'pause'));

// 挂起 (被指令拦截且长时间无推进) —— 走探针包装器的真实判定链路
const evSuspend = new EventHandler(mainList);
evSuspend.update = function () { return false; };   // 永远拦截, 无计时器
EventHandler.call(evSuspend);
probe.getEventBlackbox();
// 真机里事件被 EventManager 每帧驱动, 这里手动驱动等价帧
for (let f = 0; f < 3; f++) evSuspend.update(16.6);
check('刚被拦截不算挂起', probe.getEventBlackbox().active.some(a => a.state === 'running'),
  'states=' + JSON.stringify(probe.getEventBlackbox().active.map(a => a.state)));
advanceTime(1500);
evSuspend.update(16.6);
box = probe.getEventBlackbox();
const recSuspend = box.active.filter(a => a.state === 'suspended');
check('长时间无推进 → 挂起态', recSuspend.length >= 1, 'suspended=' + recSuspend.length);
check('流水含「挂起」条目', box.entries.some(e => e.action === 'suspend'));

// ============================================================
console.log('=== 3. 幽灵事件侦探: 宿主销毁 / 一键结束 ===');
// ============================================================
const host = new FakeActor('新手村守卫');
const evGhost = new EventHandler(mainList);
evGhost.parent = host;
EventHandler.call(evGhost);
box = probe.getEventBlackbox();
check('宿主存活时不判幽灵', box.active.every(a => a.hostGone !== true));
check('宿主描述已中文化', box.active.some(a => a.host === '角色「新手村守卫」'),
  'hosts=' + JSON.stringify(box.active.map(a => a.host)));

host.destroyed = true;
box = probe.getEventBlackbox();
const ghostRec = box.active.find(a => a.hostGone === true);
check('宿主已销毁 → 红标幽灵', !!ghostRec);
check('幽灵计数回传', box.ghostCount >= 1, 'ghostCount=' + box.ghostCount);
check('幽灵排在清单最前', box.active[0].ghost === true);

const ghostId = ghostRec.id;
check('一键结束滞留事件成功', probe.finishEvent(ghostId) === true);
check('事件已被引擎 finish 回调摘除', evGhost.complete === true);
box = probe.getEventBlackbox();
check('结束后不再在册', !box.active.some(a => a.id === ghostId));
check('流水含「结束」条目', box.entries.some(e => e.action === 'end'));
check('不存在的 id 结束返回 false', probe.finishEvent(999999) === false);

// 正常跑完的事件: 状态转 done 后自动出册并记一条结束
const evDone = new EventHandler(mainList);
EventHandler.call(evDone);
probe.getEventBlackbox();
const beforeDone = probe.getEventBlackbox().active.length;
evDone.complete = true;
box = probe.getEventBlackbox();
check('已完成事件自动出册', box.active.length === beforeDone - 1, beforeDone + ' -> ' + box.active.length);

// ============================================================
console.log('=== 4. 流水环形上限与防刷屏 ===');
// ============================================================
const floodRaw = makeCommands([
  { id: 'wait', params: { duration: 1 } }
], 'Assets/Event/高频触发.5555666677778888.event');
const floodList = Command.compile(floodRaw);
for (let i = 0; i < 40; i++) {
  const e = new EventHandler(floodList);
  EventHandler.call(e);
}
box = probe.getEventBlackbox();
check('流水条数封顶 20 条', box.entries.length <= 20, 'n=' + box.entries.length);
check('上限阈值公开', box.thresholds.maxEntries === 20 && box.thresholds.suspendMs === 60000);

const floodStarts = box.entries.filter(e => e.action === 'start' && e.name === '高频触发');
check('同名同动作条目在窗口内合并计数', floodStarts.length === 1 && floodStarts[0].count === 40,
  'entries=' + floodStarts.length + ' count=' + (floodStarts[0] && floodStarts[0].count));

// ============================================================
console.log('=== 5. HUD 接线静态契约 ===');
// ============================================================
check('HUD 模板包含事件流水面板骨架', hudSrc.includes('id="yami-event-flow-list"'));
check('HUD 模板包含幽灵事件侦探面板骨架', hudSrc.includes('id="yami-ghost-list"'));
check('HUD 接线 probe.getEventBlackbox', hudSrc.includes('probe.getEventBlackbox'));
check('HUD 接线 probe.finishEvent', hudSrc.includes('probe.finishEvent'));
check('HUD 包含 renderEventBlackbox 函数', hudSrc.includes('function renderEventBlackbox'));
check('运行日志页 refresh 刷新事件黑匣子', /Views\.register\('errors',[\s\S]*?renderEventBlackbox\(\)/.test(hudSrc));
const nativeBtnHits = hudSrc.match(/<button[\s>]/g) || [];
check('全库绝对零原生 <button> 标签 (铁律②)', nativeBtnHits.length === 0, 'hits=' + nativeBtnHits.length);

console.log('=== 6. hud 集成渲染冒烟 (真实探针数据 → 面板 DOM) ===');
// 造一个「宿主已销毁」的滞留事件, 保证侦探台一定有内容
const smokeHost = new FakeActor('冒烟守卫');
const evSmoke = new EventHandler(mainList);
evSmoke.parent = smokeHost;
EventHandler.call(evSmoke);
smokeHost.destroyed = true;
// 再造一条特征明显的等待流水, 保证流水里一定有可断言的白话指令
const smokeRaw = makeCommands([
  { id: 'wait', params: { duration: 4321 } }
], 'Assets/Event/冒烟检查.1234123412341234.event');
const evSmokeWait = new EventHandler(Command.compile(smokeRaw));
evSmokeWait.timer = { duration: 4321 };
evSmokeWait.index = 1;
EventHandler.call(evSmokeWait);
probe.getEventBlackbox();

function makeEl(id) {
  const el = {
    id: id || '', _html: '', _text: '', _children: [], _on: {},
    style: { setProperty() {}, getPropertyValue: () => '', cssText: '' },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text; },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild(c) { this._children.push(c); return c; },
    insertBefore(c) { return c; }, removeChild() {}, replaceChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener(type, fn) { this._on[type] = fn; }, removeEventListener() {},
    closest: () => null, contains: () => false, focus() {}, blur() {}, value: '', checked: false
  };
  return el;
}
const byId = {};
const bodyEl = makeEl('body');
const headEl = makeEl('head');
const docStub = {
  getElementById(id) { return byId[id] || (byId[id] = makeEl(id)); },
  createElement() { return makeEl(''); },
  createTextNode() { return {}; },
  body: bodyEl, head: headEl, documentElement: { style: {} },
  activeElement: null,
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], title: ''
};
const lsStore = { 'yami-suite-active-view': 'errors', 'yami-perf-mode': 'basic' };
sandbox.localStorage = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = v; },
  removeItem: (k) => { delete lsStore[k]; }
};
Object.assign(sandbox, {
  document: docStub,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
});

try {
  vm.runInContext(hudSrc, sandbox, { filename: 'hud-overlay.js' });
  const flowEl = byId['yami-event-flow-list'];
  const ghostEl = byId['yami-ghost-list'];
  const flowHtml = (flowEl && flowEl._html) || '';
  const ghostHtml = (ghostEl && ghostEl._html) || '';
  check('hud 启动即渲染事件流水', flowHtml.indexOf('yami-eventflow-row') >= 0, 'len=' + flowHtml.length);
  check('流水含中文事件名', flowHtml.indexOf('主线剧情') >= 0);
  check('流水含白话指令与步号', flowHtml.indexOf('等待 4321 毫秒') >= 0 && flowHtml.indexOf('第 1') >= 0,
    'len=' + flowHtml.length);
  check('幽灵侦探渲染「宿主已销毁」红标', ghostHtml.indexOf('宿主已销毁') >= 0, 'len=' + ghostHtml.length);
  check('幽灵卡片带中文宿主名', ghostHtml.indexOf('角色「冒烟守卫」') >= 0);
  const finishMatch = ghostHtml.match(/data-finish-event="(\d+)"/);
  check('幽灵卡片含一键结束按钮', !!finishMatch && ghostHtml.indexOf('结束事件') >= 0);

  const ghostStatus = byId['yami-ghost-status'];
  check('幽灵面板徽标显示滞留数', !!ghostStatus && ghostStatus._text.indexOf('滞留') >= 0, 'badge=' + (ghostStatus && ghostStatus._text));
  const flowStatus = byId['yami-eventflow-status'];
  check('流水面板徽标显示记录中', !!flowStatus && flowStatus._text.indexOf('记录中') >= 0, 'badge=' + (flowStatus && flowStatus._text));

  // 真点一次「结束事件」按钮, 验证接线端到端可用
  if (finishMatch && ghostEl._on && ghostEl._on.click) {
    const targetId = finishMatch[1];
    const beforeCount = probe.getEventBlackbox().active.length;
    ghostEl._on.click({
      target: { closest: () => ({ getAttribute: () => targetId }) },
      stopPropagation() {}
    });
    const afterCount = probe.getEventBlackbox().active.length;
    check('点击结束按钮真正结束滞留事件', afterCount === beforeCount - 1, beforeCount + ' -> ' + afterCount);
    check('结束结果已回填提示文案', byId['yami-ghost-summary']._text.indexOf('已结束') >= 0,
      'text=' + byId['yami-ghost-summary']._text);
  } else {
    check('点击结束按钮真正结束滞留事件', false, 'no bound listener');
    check('结束结果已回填提示文案', false, 'no bound listener');
  }
} catch (err) {
  check('hud 集成渲染(无异常)', false, String((err && err.stack) || err).slice(0, 220));
}

console.log('\n========== 事件黑匣子回归: ' + passed + ' PASS / ' + failed + ' FAIL ==========');
process.exit(failed > 0 ? 1 : 0);
