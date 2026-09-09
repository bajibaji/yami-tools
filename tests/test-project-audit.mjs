// 工程体检 (断链+死事件) 与报错事件定位回归测试
// 用法: node tests/test-project-audit.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const probeSrc = readFileSync(new URL('../probe-core.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../hud-overlay.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// 构造虚拟文件系统用于静态工程体检测试
const vfs = {
  // 1. 数据字典
  'C:/mock-game/Data/manifest.json': JSON.stringify({
    events: [{ path: 'Assets/事件/@1 启动游戏.1111222233334444.event' }],
    scenes: [{ path: 'Assets/场景/新手村.5555666677778888.scene' }]
  }),
  'C:/mock-game/Data/variables.json': JSON.stringify([
    { id: 'aaaa1111bbbb2222', name: '金币', type: 'number' },
    { id: 'cccc3333dddd4444', name: '主线开启', type: 'boolean' }
  ]),
  'C:/mock-game/Data/attribute.json': JSON.stringify({
    keys: [{ id: 'eeee5555ffff6666', name: '攻击力' }]
  }),

  // 2. 资产文件
  // 事件A: 引擎自动触发的 startup 事件 (永不判死)
  'C:/mock-game/Assets/事件/@1 启动游戏.1111222233334444.event': JSON.stringify({
    type: 'startup',
    commands: [
      { id: 'setNumber', params: { variable: { type: 'global', key: 'aaaa1111bbbb2222' }, value: 100 } },
      // 引用合法存在的公共事件C
      { id: 'callEvent', params: { eventId: '7777888899990000' } },
      // 故意引用不存在的幽灵变量 GUID (断链)
      { id: 'setNumber', params: { variable: { type: 'global', key: 'deadbeefdeadbeef' }, value: 1 } }
    ]
  }),

  // 事件B: 自定义公共事件 (从未被调用 -> 死事件)
  'C:/mock-game/Assets/事件/未使用的分支.6666777788889999.event': JSON.stringify({
    type: 'common',
    commands: []
  }),

  // 事件C: 被事件A通过 callEvent 引用的普通公共事件 (正常存活)
  'C:/mock-game/Assets/事件/公共奖励.7777888899990000.event': JSON.stringify({
    type: 'common',
    commands: []
  }),

  // 场景文件
  'C:/mock-game/Assets/场景/新手村.5555666677778888.scene': JSON.stringify({
    width: 20,
    height: 15,
    objects: []
  })
};

const mockFs = {
  existsSync(p) {
    const norm = String(p).replace(/\\/g, '/');
    return norm in vfs || Object.keys(vfs).some(k => k.startsWith(norm + '/'));
  },
  readFileSync(p) {
    const norm = String(p).replace(/\\/g, '/');
    if (norm in vfs) return vfs[norm];
    throw new Error('ENOENT: ' + p);
  },
  readdirSync(p, opts) {
    const norm = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
    const prefix = norm + '/';
    const names = new Set();
    const isDirent = opts && opts.withFileTypes;
    for (const k of Object.keys(vfs)) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        const part = rest.split('/')[0];
        names.add(part);
      }
    }
    const arr = Array.from(names);
    if (!isDirent) return arr;
    return arr.map(n => {
      const sub = prefix + n;
      const isDir = Object.keys(vfs).some(k => k.startsWith(sub + '/'));
      return {
        name: n,
        isDirectory: () => isDir,
        isFile: () => !isDir
      };
    });
  }
};

// 模拟 require
const customRequire = (name) => {
  if (name === 'fs') return mockFs;
  if (name === 'path') return {
    join: (...args) => args.join('/').replace(/\\/g, '/').replace(/\/+/g, '/'),
    dirname: (p) => p.split('/').slice(0, -1).join('/') || '.',
    relative: (from, to) => to.replace(from + '/', ''),
    extname: (p) => { const i = p.lastIndexOf('.'); return i >= 0 ? p.slice(i) : ''; },
    sep: '/'
  };
  if (name === 'os') return { homedir: () => 'C:/Users/mock' };
  if (name === 'http') return { createServer: () => ({ listen: () => ({ on: () => {} }), on: () => {}, close: () => {} }) };
  throw new Error('no mock for ' + name);
};

console.log('=== 1. 工程体检内核 (Project Audit) 静态扫描 ===');
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
  require: customRequire,
  process: { platform: 'win32', cwd: () => 'C:/mock-game' },
  Party: { player: null, members: [] },
  Time: { timeScale: 1, deltaTime: 16.6 },
  Scene: { binding: { id: '5555666677778888', data: { path: 'Assets/场景/新手村.5555666677778888.scene' } } }
};
sandbox.window = {
  __YAMI_PERF_PROBE__: undefined,
  location: { pathname: 'C:/mock-game/index.html' },
  dispatchEvent: () => true, addEventListener: () => {}, devicePixelRatio: 1
};

vm.createContext(sandbox);
vm.runInContext(probeSrc, sandbox);
const probe = sandbox.window.__YAMI_PERF_PROBE__;

check('probe 导出了 runProjectAudit', typeof probe.runProjectAudit === 'function');
check('probe 导出了 getAuditResult', typeof probe.getAuditResult === 'function');

probe.setProjectRoot('C:/mock-game');
const result = probe.runProjectAudit();

check('体检扫描成功', result && result.ok === true);
check('统计资产文件数', result.stats && result.stats.files >= 4, 'files=' + result.stats.files);
check('统计注册变量数', result.stats && result.stats.variables >= 3, 'vars=' + result.stats.variables);

// 检查断链
const broken = result.issues.filter(i => i.kind === 'broken');
check('精准捕获到 1 处断链引用', broken.length === 1, 'broken=' + broken.length);
check('断链包含丢失 GUID deadbeefdeadbeef', broken[0] && broken[0].guid === 'deadbeefdeadbeef');
check('断链定位到具体文件与步骤', broken[0] && broken[0].cmdIndex === 2);
check('断链包含白话描述 desc', broken[0] && String(broken[0].desc).includes('第 3 步指令'));

// 检查死事件
const dead = result.issues.filter(i => i.kind === 'dead');
check('精准捕获到 1 个死事件', dead.length === 1, 'dead=' + dead.length);
check('死事件定位到未使用的分支.event', dead[0] && dead[0].name === '未使用的分支');
check('startup 事件未被误判为死事件', !dead.some(d => d.name.includes('启动游戏')));
check('被 callEvent 引用的公共奖励事件未被误判为死事件', !dead.some(d => d.name.includes('公共奖励')));

console.log('=== 2. HUD 接线静态契约与门禁断言 ===');
check('HUD 模板包含工程体检面板骨架', hudSrc.includes('id="yami-audit-panel"'));
check('HUD 模板包含一键体检按钮', hudSrc.includes('id="btn-run-project-audit"'));
check('HUD 接线 probe.runProjectAudit', hudSrc.includes('probe.runProjectAudit'));
check('HUD 报错卡片包含事件执行定位徽标渲染', hudSrc.includes('yami-error-event-ctx'));
check('HUD 包含 renderAuditPanel 函数', hudSrc.includes('function renderAuditPanel'));
check('HUD 包含 runProjectAuditUI 函数', hudSrc.includes('function runProjectAuditUI'));
check('Views.register(errors) mount 包含 renderAuditPanel 调用', hudSrc.includes('renderAuditPanel();') && hudSrc.includes("Views.register('errors'"));

// 铁律② 机器断言
const nativeBtnHits = hudSrc.match(/<button[\s>]/g) || [];
check('全库绝对零原生 <button> 标签 (铁律②)', nativeBtnHits.length === 0, 'hits=' + nativeBtnHits.length);

console.log('\n========== 工程体检与报错定位回归: ' + passed + ' PASS / ' + failed + ' FAIL ==========');
process.exit(failed > 0 ? 1 : 0);
