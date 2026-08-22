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
console.log('perf-analysis self-check passed')
