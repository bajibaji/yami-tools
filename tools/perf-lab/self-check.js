'use strict'

const assert = require('assert')
const core = require('./analyzer-core.js')

const trace = core.analyze({ traceEvents: [
  { ph: 'M', name: 'thread_name', pid: 1, tid: 2, ts: 0, args: { name: 'CrRendererMain' } },
  { ph: 'X', name: 'RunTask', pid: 1, tid: 2, ts: 0, dur: 80000 },
  { ph: 'X', name: 'MajorGC', pid: 1, tid: 2, ts: 20000, dur: 10000 },
  { ph: 'I', name: 'BeginFrame', pid: 9, tid: 9, ts: 0 },
  { ph: 'I', name: 'BeginFrame', pid: 9, tid: 9, ts: 20000 },
  { ph: 'P', name: 'ProfileChunk', pid: 1, tid: 2, ts: 30000, args: { data: { cpuProfile: { nodes: [{ id: 7, callFrame: { functionName: 'Scene.update', url: 'scene.js', lineNumber: 9 } }], samples: [7, 7] }, timeDeltas: [5000, 7000] } } },
] })
assert.strictEqual(trace.kind, 'trace')
assert.strictEqual(trace.metrics.longTaskCount, 1)
assert.strictEqual(trace.metrics.gcMs, 10)
assert.strictEqual(trace.metrics.frameP95Ms, 20)
assert.strictEqual(trace.hotspots[0].name, 'Scene.update')
assert.strictEqual(trace.hotspots[0].totalMs, 12)
assert.strictEqual(trace.hotspots[0].samples, 2)

const spector = core.analyze({
  canvas: { width: 1920, height: 1080 },
  context: { capabilities: { RENDERER: 'ANGLE GPU', VENDOR: 'Google', VERSION: 'WebGL 2.0', SAMPLES: 4, MAX_TEXTURE_SIZE: 16384 } },
  commands: [
    { name: 'drawArrays', startTime: 1, endTime: 4, DrawState: { redundantCommandIds: [1, 2] } },
    { name: 'drawElements', startTime: 4, endTime: 8 },
  ],
  listenCommandsStartTime: 1,
  listenCommandsEndTime: 8,
  frameMemory: { Texture2d: 1048576, Buffer: 1024 },
  analyses: [{ analyserName: 'CommandsSummary', total: 2, draw: 2, clear: 0 }],
})
assert.strictEqual(spector.kind, 'spector')
assert.strictEqual(spector.metrics.drawCalls, 2)
assert.strictEqual(spector.metrics.redundantCommands, 2)
assert.strictEqual(spector.metrics.frameMemoryBytes, 1049600)
assert.strictEqual(spector.context.Renderer, 'ANGLE GPU')

assert.throws(() => core.analyze({ nope: true }), /无法识别/)
const probe = core.analyze({
  kind: 'yami-probe',
  budgetMs: 16.7,
  durationMs: 10,
  samples: 600,
  compute: { avg: 8, p95: 20, p99: 25, max: 30, overBudgetCount: 5 },
  frame: { avg: 16.7, p95: 20, max: 30 },
  updaters: [{ name: 'SceneManager', avg: 5, max: 12, count: 600, total: 3000 }],
  renderers: [],
  events: [{ name: 'common :: 刷怪.event', avg: 4, max: 15, count: 600, total: 2400 }],
  overBudgetFrames: [
    { frame: 10, compute: 21, update: 12, render: 9, updaters: [{ name: 'SceneManager', ms: 8 }], renderers: [], events: [{ name: 'common :: 刷怪.event', ms: 6 }] },
    { frame: 11, compute: 22, update: 13, render: 9, updaters: [{ name: 'SceneManager', ms: 9 }], renderers: [], events: [{ name: 'common :: 刷怪.event', ms: 5 }] },
  ],
})
assert.strictEqual(probe.kind, 'probe')
assert.strictEqual(probe.metrics.overBudgetFrames, 5)
assert.strictEqual(probe.causes[0].name, 'SceneManager')
assert.strictEqual(probe.causes[0].count, 2)
assert.strictEqual(probe.worstFrames[0].frame, 11)

const noGameProbe = core.analyze({
  kind: 'yami-probe', budgetMs: 16.7, samples: 10,
  compute: { avg: 0, p95: 0, p99: 0, max: 0, overBudgetCount: 0 },
  frame: { avg: 5, p95: 5, max: 5 },
  updaters: [], renderers: [], events: [], overBudgetFrames: [],
  hooked: { game: false, updaters: 0, renderers: 0, events: 0 },
})
assert.ok(noGameProbe.findings.some((finding) => finding.title.includes('没有抓到游戏运行时')))

// 真实报告回归：元数据 ts=0 不得把 60 秒录制拉成数小时；Profiler 启动不是游戏长任务；
// 两个 profile 可复用相同 node id，但只能选择 Renderer 进程自己的 profile。
const realShapeTrace = core.analyze({ traceEvents: [
  { ph: 'M', name: 'process_name', pid: 10, tid: 0, ts: 0, args: { name: 'Renderer' } },
  { ph: 'M', name: 'thread_name', pid: 10, tid: 20, ts: 0, args: { name: 'CrRendererMain' } },
  { ph: 'M', name: 'process_name', pid: 30, tid: 0, ts: 0, args: { name: 'Browser' } },
  { ph: 'X', name: 'RunTask', pid: 10, tid: 20, ts: 100000000, dur: 63000 },
  { ph: 'X', name: 'CpuProfiler::StartProfiling', pid: 10, tid: 20, ts: 100000100, dur: 62500 },
  { ph: 'I', name: 'FireAnimationFrame', pid: 10, tid: 20, ts: 100100000 },
  { ph: 'I', name: 'FireAnimationFrame', pid: 10, tid: 20, ts: 100116700 },
  { ph: 'P', name: 'ProfileChunk', id: 'renderer', pid: 10, tid: 21, ts: 100100000, args: { data: { cpuProfile: { nodes: [
    { id: 3, callFrame: { functionName: '(idle)' } },
    { id: 4, callFrame: { functionName: 'Scene.update', url: 'scene.js', lineNumber: 9 } },
  ], samples: [3, 4] }, timeDeltas: [5000, 7000] } } },
  { ph: 'P', name: 'ProfileChunk', id: 'browser', pid: 30, tid: 31, ts: 100100000, args: { data: { cpuProfile: { nodes: [
    { id: 4, callFrame: { functionName: 'emit', url: 'node:events', lineNumber: 1 } },
  ], samples: [4] }, timeDeltas: [9000] } } },
] })
assert.ok(realShapeTrace.metrics.durationMs < 1000)
assert.strictEqual(realShapeTrace.metrics.longTaskCount, 0)
assert.strictEqual(realShapeTrace.toolingTasks.length, 1)
assert.strictEqual(realShapeTrace.hotspots[0].name, 'Scene.update')
assert.ok(!realShapeTrace.hotspots.some((item) => item.name === 'emit'))

// 旧探针回归：帧内明细为空时不得把 0.xms unknown 事件称为超帧元凶。
const brokenProbe = core.analyze({
  kind: 'yami-probe', version: 1, budgetMs: 16.7, durationMs: 78.58, samples: 7918,
  compute: { avg: 6.22, p95: 33.9, p99: 92.9, max: 143.2, overBudgetCount: 627 },
  frame: { avg: 9.92, p95: 35, max: 1957.6 },
  updaters: [{ name: 'anonymous', avg: 0.7, max: 139.8, count: 55406, total: 38999.7 }],
  renderers: [{ name: 'Object', avg: 0.01, max: 0.9, count: 4133, total: 30.5 }],
  events: [{ name: 'event :: unknown', avg: 0, max: 0.4, count: 14524, total: 11.6 }],
  scene: { actors: '114/0', uiElements: 0, textures: 223 },
  overBudgetFrames: Array.from({ length: 20 }, (_, index) => ({ frame: 100 + index, compute: 100, update: 100, render: 0, updaters: [], renderers: [], events: [{ name: 'event :: unknown', ms: 0.1 }] })),
})
assert.strictEqual(brokenProbe.metrics.durationMs, 78580)
assert.strictEqual(brokenProbe.metrics.attributionCoverage, 0)
assert.strictEqual(brokenProbe.causes.length, 0)
assert.ok(brokenProbe.findings.some((finding) => finding.title.includes('未记录到卡顿帧内部证据')))
assert.ok(brokenProbe.findings.some((finding) => finding.title.includes('Scene 角色更新链')))
assert.ok(!brokenProbe.findings.some((finding) => finding.title.includes('unknown')))

console.log('perf-analysis self-check passed')
