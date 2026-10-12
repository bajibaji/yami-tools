'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const vm = require('node:vm')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'danjuan-region-types-'))
const source = path.resolve(__dirname, '../runtime/region-commands/RegionTools.d4a9f612bc3e7805.ts')
const fixture = require('./resolve-project.cjs').resolveProject().replace(/\\/g, '/')
const runtimeName = 'typescript-' + process.platform + '-' + process.arch
const bin = process.platform === 'win32' ? 'tsc.exe' : 'tsc'
const tsc = process.env.YAMI_TSC_EXE || path.join(process.env.YAMI_ENGINE_ROOT || 'D:/Program Files/Open Yami RPG Editor', 'resources/app/node_modules/@typescript', runtimeName, 'lib', bin)
async function main() {
try {
  assert.ok(fs.existsSync(tsc), '需要本机 Open Yami 编译器验证区域指令')
  const config = path.join(temp, 'tsconfig.json')
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', strict: true, skipLibCheck: true, noEmit: true }, include: [fixture + '/Script/**/*.ts', source.replace(/\\/g, '/')] }))
  const checked = spawnSync(tsc, ['--pretty', 'false', '-p', config], { encoding: 'utf8', windowsHide: true })
  assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  const installer = require('../runtime/region-commands/install.cjs')
  const project = path.join(temp, 'project')
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(project, 'Data'))
  fs.writeFileSync(path.join(project, 'Data/commands.json'), '[]')
  fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', strict: true, skipLibCheck: true, noEmit: true }, include: [fixture + '/Script/**/*.ts', path.join(project, 'Assets/**/*.ts').replace(/\\/g, '/')] }))
  const installed = await installer.installChecked(project, installer.preview(project).commandsSha256)
  assert.equal(installed.compile.ok, true)
  const broken = path.join(temp, 'broken-project')
  fs.mkdirSync(path.join(broken, 'Assets'), { recursive: true }); fs.mkdirSync(path.join(broken, 'Data'))
  fs.writeFileSync(path.join(broken, 'Data/commands.json'), '[]')
  fs.writeFileSync(path.join(broken, 'Assets/Broken.ts'), 'const broken = = 1')
  fs.writeFileSync(path.join(broken, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', strict: true, skipLibCheck: true, noEmit: true }, include: [fixture + '/Script/**/*.ts', path.join(broken, 'Assets/**/*.ts').replace(/\\/g, '/')] }))
  await assert.rejects(installer.installChecked(broken, installer.preview(broken).commandsSha256), /已撤回安装/)
  assert.equal(fs.existsSync(path.join(broken, installer.SCRIPT)), false)
  assert.equal(fs.readFileSync(path.join(broken, 'Data/commands.json'), 'utf8'), '[]')
  // 由已安装 esbuild 转译实际发布脚本，再执行真实 call()，不是另写查询算法。
  const esbuild = require('../node_modules/esbuild')
  const js = esbuild.transformSync(fs.readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs' }).code
  class Actor { constructor(x, y) { this.x = x; this.y = y; this.active = true; this.destroyed = false } }
  class SceneRegion {}
  const a = new Actor(-2, -2), b = new Actor(2, 2), inactive = new Actor(0, 0)
  inactive.active = false
  const manager = { partition: { get() { return { 0: [a, b, inactive], count: 1 } } } }
  for (const actor of [a, b, inactive]) actor.parent = manager
  const region = Object.assign(new SceneRegion(), { name: '测试', presetId: 'r1', x: 0, y: 0, width: 4, height: 4, parent: { scene: { actor: manager } }, destroyed: false })
  const box = { module: { exports: {} }, exports: {}, SceneRegion, Actor, Scene: { entity: { get(id) { return id === 'r1' ? region : b } } }, CurrentEvent: { triggerRegion: region }, Set }
  vm.runInNewContext(js, box)
  const command = new box.module.exports.default()
  let result
  command.result = { set(value) { result = value } }
  command.regionId = 'r1'; command.operation = 'actors'; command.call()
  assert.equal(result.length, 1); assert.equal(result[0], a)
  // 模拟角色存在循环引用（如 parent 引用或自身双向引用），验证存档序列化不崩溃
  a.circularRef = a
  assert.doesNotThrow(() => JSON.stringify({ variables: { list: result } }), '返回的角色必须支持安全存档序列化')
  command.operation = 'count'; command.call(); assert.equal(result, 1)
  command.operation = 'contains'; command.actor = a; command.call(); assert.equal(result, true)
  command.actor = b; command.call(); assert.equal(result, false)
  command.actor = inactive; command.call(); assert.equal(result, false)
  command.operation = 'info'; command.call(); assert.equal(result.presetId, 'r1')
  region.destroyed = true; command.call(); assert.equal(result.available, false)
  command.operation = 'actors'; command.call(); assert.equal(result.length, 0)
  region.destroyed = false; command.regionId = 'actor-not-region'; command.operation = 'count'; command.call(); assert.equal(result, 0)
  command.regionId = ''; command.call(); assert.equal(result, 1)
  console.log('区域指令：真实工程类型检查、发布脚本执行、左上包含/右下排除、未激活过滤、销毁、误类型和事件触发区域全部通过')
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
