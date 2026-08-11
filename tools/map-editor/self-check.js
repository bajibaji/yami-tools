'use strict'

const assert = require('node:assert/strict')
require('./app.js')

const core = globalThis.MapEditorCore
const blank = core.newBlankGrid()
assert.equal(blank.length, 10)
assert.equal(blank.every((row) => row.length === 10), true)
assert.deepEqual(core.validateGrid(blank), [])

const errors = []
assert.deepEqual(core.parsePassability('1,0', '测试', errors), { right: true, down: false })
assert.deepEqual(core.parsePassability('0,1', '测试', errors), { right: false, down: true })
assert.deepEqual(errors, [])

const rectangle = core.rectangleCoords({ r: 1, c: 2 }, { r: 2, c: 4 })
assert.equal(rectangle.length, 6)
assert.deepEqual(rectangle[0], { r: 1, c: 2 })
assert.deepEqual(rectangle.at(-1), { r: 2, c: 4 })

const snapshot = core.cloneValue(blank)
snapshot[0][0].name = '独立快照'
assert.equal(blank[0][0].name, '')

blank[0][0].monsters.push({ id: 'not-a-guid', lvMin: 5, lvMax: 1, weight: 0 })
assert.equal(core.validateGrid(blank).length >= 3, true)

console.log('map editor self-check passed')
