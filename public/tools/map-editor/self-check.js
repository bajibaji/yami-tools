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

const iconEvent = {
  commands: [{
    id: 'switch',
    params: {
      branches: [
        {
          conditions: [{ value: 0 }],
          commands: [{ id: 'comment', params: { comment: '前哨站' } }, { id: 'setImage', params: { properties: [{ key: 'image', value: '20F00101F4C70FFC' }] } }],
        },
        {
          conditions: [{ value: 100 }, { value: 101 }, { value: 102 }],
          commands: [{ id: 'comment', params: { comment: '主城' } }, { id: 'setImage', params: { properties: [{ key: 'image', value: '294ef0b713c3d593' }] } }],
        },
      ],
    },
  }],
}
const iconTypes = core.parseIconDefinitions(iconEvent)
assert.deepEqual(iconTypes.map(({ value, label, imageGuid }) => [value, label, imageGuid]), [
  [-1, '无地点', ''],
  [0, '前哨站', '20f00101f4c70ffc'],
  [100, '主城', '294ef0b713c3d593'],
  [101, '主城', '294ef0b713c3d593'],
  [102, '主城', '294ef0b713c3d593'],
])

console.log('map editor self-check passed')
