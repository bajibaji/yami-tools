'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const fixture = require('./_fixture.cjs')

async function main() {
  const modules = process.env.YAMI_PLAYWRIGHT_DIR || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
  const { _electron } = createRequire(path.join(modules, '../package.json'))('playwright')
  const exe = process.env.YAMI_EDITOR_EXE || 'D:/Documents/GitHub/2/node_modules/electron/dist/electron.exe'
  const appPath = 'D:/Program Files/Open Yami RPG Editor/resources/app'
  const project = fixture.copyProject('danjuan-editor-real-', ['Assets', 'Data', 'Script'], ['game.yamirpg', 'tsconfig.json', 'index.html'])
  const installer = require('../runtime/region-commands/install.cjs')
  await installer.installChecked(project, installer.preview(project).commandsSha256)
  const home = fixture.tempDir('danjuan-editor-home-')
  fs.mkdirSync(path.join(home, '.openyami'), { recursive: true })
  const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openyami/config.json'), 'utf8'))
  config.project = path.join(project, 'game.yamirpg'); config.recent = []; config.zoom = 1
  fs.writeFileSync(path.join(home, '.openyami/config.json'), JSON.stringify(config))
  let app
  const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData'), YAMI_AI_CONFIG_DIR: path.join(home, 'agent') }
  fs.mkdirSync(env.APPDATA, { recursive: true })
  env.LOCALAPPDATA = path.join(home, 'LocalAppData')
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true })
  delete env.ELECTRON_RUN_AS_NODE
  try {
    app = await _electron.launch({ executablePath: exe, cwd: path.dirname(path.dirname(appPath)), env, args: [appPath, '--no-sandbox', '--user-data-dir=' + path.join(home, 'chromium')], timeout: 30000 })
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => !!document.querySelector('#menu > item[value]') && typeof document.getElementById('scene-list')?.read === 'function', null, { timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.addScriptTag({ path: path.resolve(__dirname, '../editor-tools.js') })
    await page.waitForFunction(() => window.__DANJUAN_EDITOR_TOOLS__?.state.mounted, null, { timeout: 15000 })
    await page.evaluate(() => window.__DANJUAN_EDITOR_TOOLS__.open())
    const isMounted = await page.evaluate(() => window.__DANJUAN_EDITOR_TOOLS__.state.mounted)
    assert.equal(isMounted, true, '区域工作台必须成功挂载')
    await app.evaluate(({ dialog }, projectFile) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectFile] }); }, path.join(project, 'game.yamirpg'))
    await page.evaluate(() => window.YamiEngine.Title.openProject())
    await page.waitForFunction(() => !!window.YamiEngine.Data.manifest && window.YamiEngine.Data.manifest.scenes.length > 0, null, { timeout: 15000 })
    const region = await page.evaluate(() => {
      const engine = window.YamiEngine;
      const regionOf = nodes => {
        for (const node of nodes || []) {
          if (node.class === 'region') return node;
          const child = regionOf(node.children); if (child) return child;
        }
        return null;
      };
      for (const meta of engine.Data.manifest.scenes) {
        const data = engine.Data.scenes[meta.guid];
        if (!data || !regionOf(data.objects)) continue;
        const file = engine.Directory.getFile(meta.path);
        document.getElementById('project-browser').body.openFile(file);
        return { guid: meta.guid, path: meta.path };
      }
      return null;
    })
    assert.ok(region, '临时工程须包含真实区域')
    await page.waitForTimeout(500)
    const selected = await page.evaluate(() => {
      const list = document.getElementById('scene-list');
      const find = nodes => { for (const node of nodes || []) { if (node.class === 'region') return node; const child = find(node.children); if (child) return child; } return null; };
      const target = find(list.data);
      list.select(target);
      delete window.YamiEngine; delete window.Scene;
      return window.__DANJUAN_EDITOR_TOOLS__.selectedRegion();
    })
    assert.ok(selected && selected.presetId, '没有 YamiEngine 仍须识别场景树选中区域')
    assert.equal(selected.sceneId, region.guid)
    await page.evaluate(() => {
      const events = document.getElementById('sceneRegion-events');
      events.object.target = events;
      events.object.open(events.data && events.data[0]);
    })
    await page.waitForFunction(() => Array.from(document.querySelectorAll('command-list')).some(el => el.getBoundingClientRect().width > 0), null, { timeout: 10000 })
    await page.evaluate(() => {
      const list = Array.from(document.querySelectorAll('command-list')).find(el => el.getBoundingClientRect().width > 0);
      list.select(0);
      list.focus();
      window.__DANJUAN_EDITOR_TOOLS__.open();
    })
    await page.locator('#dj-tools-region').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '获取区域信息', exact: true }).click()
    const params = await page.evaluate(() => {
      const pane = document.getElementById('scriptCommand-parameter-pane');
      return pane.getData().find(item => item.id === 'd4a9f612bc3e7805')?.parameters;
    })
    assert.ok(params, '原生指令窗口须出现')
    assert.equal(params.regionId, selected.presetId)
    assert.equal(params.operation, 'info')
    const artifact = path.resolve(__dirname, '../.e2e-tmp/editor-tools-real.png')
    await page.screenshot({ path: artifact })
    console.log('Open Yami 真机：识别真实区域 ' + selected.name + '，原生指令窗口自动预填区域 ID/操作；临时工程与用户配置隔离')
  } finally { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) } }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
