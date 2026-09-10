// 诊断断点补齐回归测试 (v0.10.0)
//   ① 变量写入被丢弃 → 必须能定位「哪条事件第几步·什么指令」(而不是只报症状)
//   ② 资源缓存与内存 → 统计准确 + 一键清理安全 (绝不碰加载中的条目, 同步清 objectURL)
// 用法: node tests/test-diagnosis-gaps.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---------- 伪引擎: 与 arpg-ts-chinese 的编译推槽/事件循环语义逐条对齐 ----------
function makeCommands(list, path) {
  const arr = list.slice();
  arr.path = path;
  return arr;
}

const VAR_KEY = 'aaaa1111bbbb2222';
const VAR_STATE = { [VAR_KEY]: 100 };   // 数值变量, 后面故意写入文本 → 引擎会静默丢弃

const FakeVariable = {
  map: VAR_STATE,
  set(key, value) {
    // 复刻引擎 variable.ts:117-133: 类型不匹配时什么都不做, 也不报错
    if (typeof value === typeof FakeVariable.map[key]) FakeVariable.map[key] = value;
    return undefined;
  }
};

class FakeCommandCompiler {
  constructor() {
    // 真实指令的实现体: 执行时会去写变量 —— 这样告警才能在「事件执行栈」里被定位到
    this.setString = function ({ variable }) {
      return function () {
        FakeVariable.set(variable && variable.key, '一段文本');
        return true;
      };
    };
    this.setNumber = function ({ variable, value }) {
      return function () {
        FakeVariable.set(variable && variable.key, value);
        return true;
      };
    };
  }
  compile(commands, callback) {
    const functions = [];
    functions.path = (commands && commands.path) || '';
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      if (typeof command === 'function') { functions.push(command); continue; }
      const id = command.id;
      if (id[0] === '!') continue;              // 禁用指令不编译不占槽
      const fn = (id in this) ? this[id](command.params) : this.compileScript(command);
      if (fn === null) continue;
      if (typeof fn === 'function') { functions.push(fn); continue; }
      for (const f of fn) functions.push(f);
    }
    functions.push(callback || (() => true));
    return functions;
  }
  compileScript() { return () => true; }
  wait({ duration }) { return () => false; }
  comment() { return null; }
}

// 伪事件处理器: update 采用引擎的 while (CommandList[CommandIndex++]?.()) 后自增语义
// 注意: 伪引擎的方法体运行在测试 realm, 所以引擎的「模块级执行游标」必须经由 sandbox 对象读写 ——
// 探针在 vm 内读到的是 sandbox 上的同名全局, 两边才是同一个值。
let SB = null;
class FakeEventHandler {
  constructor(commands) {
    this.complete = false;
    this.commands = commands;
    this.initial = commands;
    this.index = 0;
    this.update = FakeEventHandler.prototype.update;
  }
  get type() { return this.initial.type || 'common'; }
  get path() { return this.initial.path || ''; }
  update() {
    SB.CommandList = this.commands;
    SB.CommandIndex = this.index;
    while (SB.CommandList[SB.CommandIndex++] && SB.CommandList[SB.CommandIndex - 1]()) { /* 连跑 */ }
    this.commands = SB.CommandList;
    this.index = SB.CommandIndex;
    return this.complete;
  }
  finish() { this.complete = true; this.update = FakeEventHandler.complete; }
  onFinish(cb) { this.__finish = cb; }
}
FakeEventHandler.wait = () => false;
FakeEventHandler.complete = () => true;
FakeEventHandler.call = function (event) {
  if (event.update(0) === false) FakeEventManager.activeEvents.push(event);
  return event;
};

const FakeEventManager = { activeEvents: [], guidMap: {} };

// 伪 Loader: 一张表里同时放「已加载图片」与「加载中的 Promise」, 复刻 loader.ts 的真实形态
const revokedUrls = [];
const loadedImage = { tagName: 'IMG', complete: true, src: 'blob:game/hero' };
const pendingImage = Promise.resolve(loadedImage);
const FakeLoader = {
  complete: true,
  cachedImages: { 'Assets/图/hero.png': loadedImage, 'Assets/图/boss.png': pendingImage },
  cachedUrls: { 'Assets/图/hero.png': 'blob:game/hero', 'Assets/图/boss.png': 'blob:game/boss' },
  cachedBlobs: { 'blob:game/orphan': { size: 2048 * 1024 } },
  revokeBlobUrl(url) {
    revokedUrls.push(url);
    if (url in this.cachedBlobs) delete this.cachedBlobs[url];
  }
};

const sandbox = {
  console, setTimeout, clearTimeout,
  performance: { now: () => Date.now(), memory: { usedJSHeapSize: 64 * 1048576, totalJSHeapSize: 128 * 1048576 } },
  // 捕获 rAF 与定时器回调以便手动驱动: probe 的 refresh() 才会安装 Variable.set 告警钩子
  requestAnimationFrame: (cb) => { sandbox.__raf = cb; return 1; },
  cancelAnimationFrame: () => {},
  setInterval: (cb) => { (sandbox.__timers = sandbox.__timers || []).push(cb); return 1; },
  clearInterval: () => {},
  navigator: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  BroadcastChannel: class { constructor() {} postMessage() {} close() {} },
  Blob: class { constructor(parts) { this.size = parts && parts[0] ? parts[0].length : 0; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || {}; } },
  Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Promise, Map, Set, WeakMap,
  TextEncoder, fetch: async () => ({ ok: false, json: async () => ({}) }),
  require: (name) => {
    if (name === 'fs') return { existsSync: () => false, readFileSync: () => { throw new Error('ENOENT'); }, readdirSync: () => [] };
    if (name === 'path') return { join: (...a) => a.join('/'), dirname: (p) => String(p).split('/').slice(0, -1).join('/') };
    if (name === 'os') return { homedir: () => 'C:/Users/mock' };
    if (name === 'http') return { createServer: () => ({ listen: () => ({ on: () => {} }), on: () => {}, close: () => {} }) };
    throw new Error('no mock for ' + name);
  },
  process: { platform: 'win32', cwd: () => 'C:/mock-game' },
  Party: { player: null, members: [] },
  Time: { timeScale: 1, deltaTime: 16.6 },
  Scene: { binding: null, actor: { list: [] } },
  Variable: FakeVariable,
  Loader: FakeLoader,
  Command: new FakeCommandCompiler(),
  EventHandler: FakeEventHandler,
  EventManager: FakeEventManager,
  // 引擎的模块级执行游标 (真实引擎里是与 Command/EventHandler 同级的全局词法绑定)
  CommandList: undefined,
  CommandIndex: 0
};
sandbox.window = {
  __YAMI_PERF_PROBE__: undefined,
  location: { pathname: 'C:/mock-game/index.html' },
  dispatchEvent: () => true, addEventListener: () => {}, devicePixelRatio: 1
};

vm.createContext(sandbox);
SB = sandbox;   // 伪引擎经由该引用读写 vm 内的「模块级执行游标」全局
vm.runInContext(probeSrc, sandbox);
const probe = sandbox.window.__YAMI_PERF_PROBE__;
const Command = sandbox.Command;
const EventHandler = sandbox.EventHandler;

// 驱动探针的定时器与帧循环 → refresh() 安装 Variable.set 写入告警钩子 + 事件黑匣子钩子
for (const timer of sandbox.__timers || []) { try { timer(); } catch (e) {} }
for (let i = 0; i < 2 && sandbox.__raf; i++) {
  const cb = sandbox.__raf;
  sandbox.__raf = null;
  try { cb(); } catch (e) {}
}

// ============================================================
console.log('=== 1. 变量写入被丢弃 → 定位到「哪条事件第几步·什么指令」 ===');
// ============================================================
check('API 已导出', typeof probe.getCacheInfo === 'function' && typeof probe.clearAssetCache === 'function'
  && typeof probe.getVariableWarnings === 'function');

probe.getEventBlackbox(); // 触发钩子安装 (与真机一致: 钩子在首帧前装好)

// 指令表: raw0 = 禁用(不占槽) / raw1 = setString(真实会写变量, 但类型冲突 → 引擎静默丢弃)
const raw = makeCommands([
  { id: '!setString', params: { variable: { type: 'global', key: VAR_KEY } } },
  { id: 'setString', params: { variable: { type: 'global', key: VAR_KEY } } },
  { id: 'wait', params: { duration: 50 } }
], 'Assets/Event/新手村剧情.1111222233334444.event');
const list = Command.compile(raw);

const ev = new EventHandler(list);
EventHandler.call(ev);                 // 第一次 update(0) 在探针包装前执行 → 先产生一条「无定位」的告警
ev.index = 0;                          // 回到开头
ev.update();                           // 这次 update 已被探针包装, 事件在执行栈上 → 应带上完整定位
ev.index = 0;
ev.update();                           // 再来一次 → 计数递增

const warnings = probe.getVariableWarnings();
const w = warnings[VAR_KEY];
check('捕获到类型冲突告警', !!w && w.reason === '类型冲突丢弃', w && w.reason);
check('告警带「定位成功」标记', !!w && w.located === true);
check('告警带中文事件名', !!w && w.eventName === '新手村剧情', w && w.eventName);
check('告警带原始步号 (禁用指令被跳过 → 第 2 步)', !!w && w.step === 2, 'step=' + (w && w.step));
check('告警带该步白话指令', !!w && w.cmdDesc === '设置文本', w && w.cmdDesc);
check('告警带原始步总数', !!w && w.total === 3, 'total=' + (w && w.total));
check('重复丢弃累计次数', !!w && w.count >= 2, 'count=' + (w && w.count));
check('保留原值与试图写入的值供白话展示', !!w && w.currentVal === 100 && w.attemptedVal === '一段文本',
  JSON.stringify(w && { cur: w.currentVal, att: w.attemptedVal }));
check('引擎本身的静默语义未被破坏 (变量仍是数值)', FakeVariable.map[VAR_KEY] === 100);

// ============================================================
console.log('=== 2. 资源缓存与内存: 统计准确 + 清理安全 ===');
// ============================================================
const info = probe.getCacheInfo();
check('缓存统计可用', info.ok === true);
check('已加载图片与加载中条目分开计数', info.images === 1 && info.loading === 1,
  'images=' + info.images + ' loading=' + info.loading);
check('objectURL 表计数', info.urls === 2, 'urls=' + info.urls);
check('Blob 数量与体积统计', info.blobs === 1 && info.blobKB === 2048, 'blobs=' + info.blobs + ' blobKB=' + info.blobKB);
check('内存占用回传 (MB)', info.heapUsedMB === 64 && info.heapTotalMB === 128,
  info.heapUsedMB + '/' + info.heapTotalMB);

// 安全闸门 1: 正在加载资源时拒绝清理
FakeLoader.complete = false;
const busy = probe.clearAssetCache();
check('加载中拒绝清理 (安全闸门)', busy.ok === false && busy.reason === 'loading', JSON.stringify(busy));
check('拒绝时一个字节都没动', FakeLoader.cachedImages['Assets/图/hero.png'] === loadedImage
  && FakeLoader.cachedUrls['Assets/图/hero.png'] === 'blob:game/hero');

// 安全闸门 2: 空闲时清理
FakeLoader.complete = true;
const result = probe.clearAssetCache();
check('清理成功', result.ok === true, JSON.stringify({ ok: result.ok, imgs: result.clearedImages, blobs: result.clearedBlobs }));
check('已加载图片被清出缓存', !('Assets/图/hero.png' in FakeLoader.cachedImages));
check('加载中的 Promise 条目被完整保留 (关键安全点)', FakeLoader.cachedImages['Assets/图/boss.png'] === pendingImage);
check('对应 objectURL 同步清除 (否则下次重新加载会拿到失效 URL)',
  !('Assets/图/hero.png' in FakeLoader.cachedUrls));
check('该 URL 已被 revoke', revokedUrls.indexOf('blob:game/hero') >= 0, revokedUrls.join(','));
check('孤儿 Blob 一并释放', revokedUrls.indexOf('blob:game/orphan') >= 0 && Object.keys(FakeLoader.cachedBlobs).length === 0);
check('清理后统计归零', result.after.images === 0 && result.after.urls === 1 && result.after.blobs === 0,
  JSON.stringify({ imgs: result.after.images, urls: result.after.urls, blobs: result.after.blobs }));
check('未破坏引擎缓存的引用语义 (boss 仍可命中)', FakeLoader.cachedImages['Assets/图/boss.png'] === pendingImage);

// 安全闸门 3: 引擎构建读不到资源加载器 → 必须优雅降级 (真机实测: 部分构建里 Loader 不可达)
delete sandbox.Loader;
const noLoader = probe.getCacheInfo();
check('读不到加载器时 available=false 但内存仍可用',
  noLoader.available === false && noLoader.heapUsedMB === 64,
  JSON.stringify({ available: noLoader.available, heap: noLoader.heapUsedMB }));
const noLoaderClear = probe.clearAssetCache();
check('读不到加载器时清理返回 no-loader (不抛错)', noLoaderClear.ok === false && noLoaderClear.reason === 'no-loader',
  JSON.stringify(noLoaderClear));

// ============================================================
console.log('=== 3. HUD 接线静态契约 ===');
// ============================================================
check('HUD 含内存与缓存卡片骨架', hudSrc.includes('id="yami-cache-panel"'));
check('HUD 含一键清理按钮', hudSrc.includes('id="btn-clear-asset-cache"'));
check('HUD 接线 probe.getCacheInfo', hudSrc.includes('probe.getCacheInfo'));
check('HUD 接线 probe.clearAssetCache', hudSrc.includes('probe.clearAssetCache'));
check('HUD 含 renderCachePanel 函数', hudSrc.includes('function renderCachePanel'));
check('HUD 变量告警展示事件定位', hudSrc.includes('varWarningLocation'));
check('HUD 含读不到缓存时的降级文案', hudSrc.includes('[仅内存]'));
// 滚动条单一事实源: 新容器必须进统一选择器组 (否则暗黑大盘里露出系统亮色滚动条)
check('滚动条统一组存在', hudSrc.includes('滚动条单一事实源'));
check('事件流水列表已配滚动条', hudSrc.includes('.yami-eventflow-list::-webkit-scrollbar'));
check('幽灵侦探列表已配滚动条', hudSrc.includes('.yami-ghost-list::-webkit-scrollbar'));
check('滚动条颜色统一为暗色 (track/thumb)',
  hudSrc.includes('.yami-eventflow-list::-webkit-scrollbar-track') && hudSrc.includes('.yami-ghost-list::-webkit-scrollbar-thumb'));
const nativeBtnHits = hudSrc.match(/<button[\s>]/g) || [];
check('全库绝对零原生 <button> 标签 (铁律②)', nativeBtnHits.length === 0, 'hits=' + nativeBtnHits.length);

console.log('\n========== 诊断断点回归: ' + passed + ' PASS / ' + failed + ' FAIL ==========');
process.exit(failed > 0 ? 1 : 0);
