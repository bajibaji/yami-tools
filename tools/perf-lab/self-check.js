'use strict'

const assert = require('assert')
const fs = require('fs')
const vm = require('vm')

let clock = 0
let receivedTimestamp = null
const frames = []

class SharedModule {
  update() { clock += 2 }
  render() { clock += 3 }
}

class Actor {
  constructor(data) {
    this.data = data
    this.name = '测试角色'
    this.presetId = 'actor'
    this.teamId = 'team'
    this.x = 1
    this.y = 2
    this.parent = null
  }
  setTeam(teamId) { this.teamId = teamId }
  setPosition(x, y) { this.x = x; this.y = y }
  updateAngle() {}
  setScale() {}
}

class ActorList extends Array {
  append(actor) {
    actor.parent = this
    this.push(actor)
    return true
  }
}

const shared = new SharedModule()
const actors = new ActorList()
actors.append(new Actor({ id: 'actor-data' }))

const context = {
  console,
  performance: { now: () => clock },
  requestAnimationFrame: (callback) => { frames.push(callback); return frames.length },
  setTimeout,
  Data: { manifest: {} },
  Time: { fps: 60 },
  EventManager: { activeEvents: [] },
  UI: { manager: { list: [] } },
  GL: { textureManager: { count: 0 } },
  Scene: {
    binding: null,
    actors,
    visibleActors: [],
    visibleAnimations: [],
    visibleTriggers: [],
    load: async () => {},
  },
  Game: {
    updaters: [shared],
    renderers: [shared],
    update(timestamp) {
      receivedTimestamp = timestamp
      for (const module of this.updaters) module.update()
      for (const module of this.renderers) module.render()
    },
    loop() {},
  },
}
context.window = context

vm.runInNewContext(fs.readFileSync(__dirname + '/perf-core.js', 'utf8'), context)
const probe = context.__YAMI_PERF__
assert(probe, '探针应成功安装')
assert.strictEqual(probe.isSceneReady(), true, '默认空场景的旧版 Scene.actors 应被识别为就绪')

probe.start()
context.Game.update(123)
frames.shift()(clock)

const snapshot = probe.stop()
assert.strictEqual(receivedTimestamp, 123, '包装 Game.update 后必须保留 timestamp 参数')
assert(snapshot.compute.p95 >= 5, '旧版 Game.update 内含更新和渲染时应记录完整帧耗时')
assert(snapshot.updaters.some((item) => item.name === 'SharedModule'), '同一模块的 update 应被统计')
assert(snapshot.renderers.some((item) => item.name === 'SharedModule'), '同一模块的 render 也应被统计')

context.Scene.binding = { id: 'old-scene' }
const pressure = probe.pressure('x2')
assert.strictEqual(pressure.original, 1)
assert.strictEqual(pressure.target, 2)
assert.strictEqual(pressure.cloned, 1, 'x2 表示最终总数为两倍，不是额外克隆两倍')
assert.strictEqual(actors.length, 2, '旧版 Scene.actors.append 压测路径应可用')

console.log('perf-lab self-check passed')
