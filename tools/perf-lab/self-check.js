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

console.log('perf-analysis self-check passed')
