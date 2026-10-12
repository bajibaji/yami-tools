'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const core = require('../editor-tools')
const installer = require('../runtime/region-commands/install.cjs')

// 1. 边界计算单测
const r1 = { x: 100, y: 200, width: 64, height: 48 }
const b1 = core.calculateBounds(r1)
assert.equal(b1.left, 68)
assert.equal(b1.top, 176)
assert.equal(b1.right, 132)
assert.equal(b1.bottom, 224)

// 边界零值与空防护
const bEmpty = core.calculateBounds(null)
assert.equal(bEmpty.left, 0)
assert.equal(bEmpty.top, 0)
assert.equal(bEmpty.right, 0)
assert.equal(bEmpty.bottom, 0)

// 2. 监视目标相同性比对单测
assert.equal(core.samePin({ root: 'D:\\game', sceneId: 'scene1', presetId: 'r1' }, 'D:/game', 'scene1', 'r1'), true)
assert.equal(core.samePin({ root: 'D:/game', sceneId: 'scene1', presetId: 'r1' }, 'D:/other', 'scene1', 'r1'), false)
assert.equal(core.samePin({ root: 'D:/game', sceneId: 'scene1', presetId: 'r1' }, 'D:/game', 'scene2', 'r1'), false)

// 3. 区域工具箱安装事务、重复安装、用户改动保护
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'danjuan-editor-tools-'))
try {
  fs.mkdirSync(path.join(temp, 'Assets'))
  fs.mkdirSync(path.join(temp, 'Data'))
  const commands = path.join(temp, 'Data/commands.json')
  fs.writeFileSync(commands, '[]')
  const plan = installer.preview(temp)
  assert.equal(fs.existsSync(path.join(temp, installer.SCRIPT)), false)
  assert.throws(() => installer.install(temp, 'stale'), /重新预览/)
  const result = installer.install(temp, plan.commandsSha256)
  assert.equal(result.ok, true)
  assert.ok(result.backup)
  assert.equal(JSON.parse(fs.readFileSync(commands)).length, 1)
  assert.equal(installer.preview(temp).installed, true)
  installer.install(temp, installer.preview(temp).commandsSha256)
  assert.equal(JSON.parse(fs.readFileSync(commands)).length, 1)
  fs.appendFileSync(path.join(temp, installer.SCRIPT), '\n// user modification')
  assert.throws(() => installer.preview(temp), /修改过/)
} finally { fs.rmSync(temp, { recursive: true, force: true }) }

// 4. 插件资源注册一致性验证
const bootstrap = fs.readFileSync(path.join(__dirname, '../bootstrap.js'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json')))
assert.ok(bootstrap.includes("'editor-tools.js'"))
assert.ok(manifest.web_accessible_resources[0].resources.includes('editor-tools.js'))
console.log('区域工作台单元测试：边界计算、空值防御、跨场景绑定、安装事务、重复安装与改动保护全部通过')
