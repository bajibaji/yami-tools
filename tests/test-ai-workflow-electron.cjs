'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const fixture = require('./_fixture.cjs')

const ROOT = path.resolve(__dirname, '..')
async function main() {
  const dir = process.env.YAMI_PLAYWRIGHT_DIR || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
  const { _electron } = createRequire(path.join(dir, '../package.json'))('playwright')
  const exe = process.env.YAMI_EDITOR_EXE || 'D:/Documents/GitHub/2/node_modules/electron/dist/electron.exe'
  const appPath = 'D:/Program Files/Open Yami RPG Editor/resources/app'
  const project = fixture.copyProject('yami-ai-native-project-', ['Assets', 'Data', 'Script'], ['game.yamirpg', 'tsconfig.json', 'index.html'])
  const home = fixture.tempDir('yami-ai-native-home-')
  const plugin = path.join(home, 'extension', 'yami-perf-extension')
  fs.mkdirSync(plugin, { recursive: true })
  for (const file of ['manifest.json', 'bootstrap.js', 'probe-core.js', 'hud-overlay.js', 'ai-render-core.js', 'ai-agent.js', 'ai-host.js', 'editor-tools.js', 'icons', 'runtime']) fs.cpSync(path.join(ROOT, file), path.join(plugin, file), { recursive: true })
  fs.mkdirSync(path.join(home, '.openyami'), { recursive: true })
  const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openyami/config.json'), 'utf8'))
  config.project = path.join(project, 'game.yamirpg'); config.recent = []; config.zoom = 1
  fs.writeFileSync(path.join(home, '.openyami/config.json'), JSON.stringify(config))
  const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData'), LOCALAPPDATA: path.join(home, 'LocalAppData'), YAMI_AI_CONFIG_DIR: path.join(home, 'agent') }
  for (const folder of [env.APPDATA, env.LOCALAPPDATA]) fs.mkdirSync(folder, { recursive: true })
  delete env.ELECTRON_RUN_AS_NODE
  let targetPath = ''
  const model = http.createServer((req, res) => {
    if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake' }], balance_infos: [] })); return }
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      const messages = body.messages || []
      const userIndex = messages.map(item => item.role).lastIndexOf('user')
      const toolCount = messages.slice(userIndex + 1).filter(item => item.role === 'tool').length
      const tool = !toolCount ? { name: 'read_resource', args: { path: targetPath } }
        : toolCount === 1 ? { name: 'patch_resource', args: { path: targetPath, patch: { __native_workflow_probe: 1 }, dryRun: false } } : null
      const message = tool ? { role: 'assistant', content: '准备草案', tool_calls: [{ id: 'native-' + toolCount, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }
        : { role: 'assistant', content: '草案已准备，尚未写入。' }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message }] }))
    })
  })
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
  let app
  try {
    app = await _electron.launch({ executablePath: exe, cwd: home, env, args: [appPath, '--user-data-dir=' + path.join(home, 'chromium')], timeout: 30000 })
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.hide() })
    const page = await app.firstWindow()
    await page.waitForFunction(() => window.__YAMI_PERF_PROBE__ && document.getElementById('title-tabBar') && document.getElementById('scene-list') && window.__DANJUAN_AI_AGENT__?.state.mounted, null, { timeout: 30000 })
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, path.join(project, 'game.yamirpg'))
    await page.evaluate(() => window.YamiEngine.Title.openProject())
    await page.waitForFunction(() => window.YamiEngine.Data.manifest && window.YamiEngine.Data.manifest.skills.length, null, { timeout: 20000 })
    const selected = await page.evaluate(() => {
      const E = window.YamiEngine
      const meta = E.Data.manifest.skills[0]
      const file = meta.file || E.Directory.getFile(meta.path)
      if (!file) throw new Error('真实技能文件尚未加载：' + meta.path)
      const browser = document.getElementById('project-browser').body
      browser.openFile(file)
      browser.select(file)
      return { path: file.path }
    })
    targetPath = selected.path
    const before = fs.readFileSync(path.join(project, targetPath), 'utf8')
    const context = await page.evaluate(() => window.__YAMI_PERF_PROBE__.getEditorContext())
    assert.equal(context.schemaVersion, 2)
    assert.ok(context.selectedFiles.some(file => file.path === targetPath), JSON.stringify(context))
    const scene = await page.evaluate(() => {
      const E = window.YamiEngine
      const meta = E.Data.manifest.scenes[0]
      document.getElementById('project-browser').body.openFile(meta.file || E.Directory.getFile(meta.path))
      return { path: meta.path }
    })
    await page.waitForTimeout(500)
    const sceneContext = await page.evaluate(() => {
      const list = document.getElementById('scene-list')
      const find = nodes => { for (const node of nodes || []) { if (node.presetId && node.class !== 'folder') return node; const found = find(node.children); if (found) return found } return null }
      const object = find(list.data)
      if (object) list.select(object)
      return window.__YAMI_PERF_PROBE__.getEditorContext()
    })
    assert.equal(sceneContext.activeFile.path, scene.path)
    assert.ok(sceneContext.selectedObject && sceneContext.selectedObject.presetId, JSON.stringify(sceneContext))
    await page.evaluate(() => { window.__DANJUAN_HUD_API__.switchView('home'); window.__DANJUAN_HUD_API__.toggleDock(true) })
    await page.locator('#yami-ai-entry').click()
    await page.waitForFunction(() => window.__DANJUAN_AI_AGENT__.state.token, null, { timeout: 10000 })
    await page.evaluate(async endpoint => {
      const agent = window.__DANJUAN_AI_AGENT__
      await agent.ensureHost()
      await agent.request('/config', { endpoint, model: 'fake', thinkingMode: 'disabled' })
    }, 'http://127.0.0.1:' + model.address().port)
    await page.locator('#yami-ai-input').fill('修改 @' + targetPath)
    await page.locator('#yami-ai-input').press('Enter')
    await page.locator('#yami-ai-approval.show').waitFor({ timeout: 30000 })
    assert.equal(fs.readFileSync(path.join(project, targetPath), 'utf8'), before)
    await page.locator('#yami-ai-approve').click()
    await page.waitForFunction(() => document.querySelector('.yami-ai-validation')?.textContent.includes('资源校验：通过'), null, { timeout: 30000 })
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, targetPath), 'utf8')).__native_workflow_probe, 1)
    await page.screenshot({ path: path.join(ROOT, '.e2e-tmp/ai-workflow-electron.png') })
    console.log('Open Yami 原生验收：权威资源选择、场景实例身份、草案零写入、确认后事务提交与资源校验全部通过')
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
    await new Promise(resolve => model.close(resolve))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
