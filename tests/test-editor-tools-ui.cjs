'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')

function playwright() {
  try { return require('playwright') } catch {}
  const dir = process.env.YAMI_PLAYWRIGHT_DIR || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
  return createRequire(path.join(dir, '../package.json'))('playwright')
}
const ROOT = path.resolve(__dirname, '..')
const css = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8')
const js = fs.readFileSync(path.join(ROOT, 'editor-tools.js'), 'utf8')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
body{margin:0;background:#181818}#yami-perf-dock{position:static!important;transform:none!important;opacity:1!important;pointer-events:auto!important;width:440px!important;max-width:100%!important;margin-inline:auto!important;height:100vh!important}.yami-perf-dock-body{overflow:auto!important}menu-list{display:none}</style></head><body>
<div id="menu"><item value="window">窗口</item></div><div id="context-target">右键目标</div><tab-bar id="title-tabBar"></tab-bar><node-list id="scene-list"></node-list><div id="region-panel"><div id="sceneRegion-events" tabindex="0"></div></div>
<div id="yami-perf-dock"><div class="yami-perf-dock-body"><div class="yami-home-modules"></div></div></div>
<script>
window.counter=0;window.confirm=()=>true;
class MenuList extends HTMLElement { popup(options,items){this.state='open';this.dataItems=items;document.body.appendChild(this)} close(){this.state='closed';this.remove()} }
customElements.define('menu-list',MenuList);
document.querySelector('#menu item').addEventListener('pointerdown',()=>new MenuList().popup({},[{label:'数据',submenu:[{label:'变量',click(){window.counter++}},{label:'禁用',enabled:false,click(){window.counter+=100}}]}]));
document.getElementById('context-target').addEventListener('contextmenu',event=>{event.preventDefault();new MenuList().popup({},[{label:'深层',submenu:[{label:'右键操作',click(){window.counter+=10}}]}]);});
document.getElementById('scene-list').read=()=>({class:'region',name:'测试区域',presetId:'r1',x:0,y:0,width:4,height:4,events:[],scripts:[]});
document.getElementById('title-tabBar').read=()=>({type:'scene',meta:{path:'Assets/场景/测试.abcdef1234567890.scene',guid:'abcdef1234567890'}});
window.YamiEngine={File:{root:'D:/test'},Scene:{meta:{path:'Assets/场景/测试.abcdef1234567890.scene'}}};
window.__DANJUAN_HUD_API__={ctx:{currentView:'home'},registerPage(id,page,def){this.page=page;this.def=def},toggleDock(){},switchView(id){this.ctx.currentView=id;this.page.style.setProperty('display',id==='editor-tools'?'flex':'none','important');this.def.refresh()}};
</script><script src="/editor-tools.js"></script></body></html>`

async function main() {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/editor-tools.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'); res.end(req.url === '/editor-tools.js' ? js : html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await playwright().chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:' + server.address().port)
    await page.locator('#dj-tools-entry').click()
    await page.getByLabel('搜索操作').fill('变量')
    await page.getByRole('button', { name: '窗口 > 数据 > 变量', exact: true }).click()
    assert.equal(await page.evaluate(() => window.counter), 1)
    await page.locator('[data-dj-tab="keys"]').click()
    await page.getByRole('button', { name: 'Ctrl+Shift+P', exact: true }).click()
    await page.keyboard.press('Control+S')
    await page.getByRole('status').filter({ hasText: '这个按键已由编辑器' }).waitFor()
    await page.keyboard.press('Control+Alt+P')
    await page.getByRole('button', { name: 'Ctrl+Alt+P', exact: true }).waitFor()
    await page.keyboard.press('Control+Alt+P')
    await page.getByLabel('搜索操作').waitFor({ state: 'visible' })
    await page.locator('[data-dj-tab="region"]').click()
    await page.getByText('测试区域', { exact: true }).waitFor()
    await page.getByRole('button', { name: '固定监视', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__DANJUAN_EDITOR_TOOLS__.state.pin.presetId), 'r1')
    await page.evaluate(() => {
      const actor = { name: '玩家' };
      const region = { name: '测试区域', presetId: 'r1', x: 0, y: 0, width: 4, height: 4, actors: [actor], parent: { scene: { id: 'abcdef1234567890' } }, emit() {} };
      window.Party = { player: actor };
      window.YamiEngine.Scene.binding = { id: 'abcdef1234567890' };
      window.YamiEngine.Scene.region = { list: [region] };
    })
    await page.getByText('正在监视', { exact: true }).waitFor()
    await page.getByText('1 个', { exact: true }).waitFor()
    await page.evaluate(() => window.YamiEngine.Scene.region.list[0].emit('playerenter', window.Party.player))
    await page.locator('.dj-tools-log').filter({ hasText: '玩家进入' }).waitFor()
    await page.evaluate(() => { window.YamiEngine.Scene.region.list = []; window.YamiEngine.Scene.binding.id = 'other-scene'; })
    await page.getByText('当前试玩位于其它场景', { exact: true }).waitFor()
    await page.evaluate(() => { window.YamiEngine.Scene.binding.id = 'abcdef1234567890'; })
    await page.getByText('区域未启用或已删除', { exact: true }).waitFor()
    await page.getByRole('button', { name: '取消监视', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__DANJUAN_EDITOR_TOOLS__.state.pin), null)
    for (const width of [1280, 640, 320]) {
      await page.setViewportSize({ width, height: 800 })
      const overflow = await page.locator('#page-editor-tools').evaluate(el => el.scrollWidth > el.clientWidth + 1)
      assert.equal(overflow, false, '窗口宽度 ' + width + ' 不得横向溢出')
    }
    await page.locator('[data-dj-tab="commands"]').click()
    await page.getByLabel('搜索操作').fill('变量')
    await page.getByLabel('搜索操作').press('ArrowDown')
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('dj-tools-command')), true)
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth)
    assert.notEqual(ring, '0px')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForFunction(() => !!customElements.get('menu-list').prototype.__danjuanMenuHook)
    await page.locator('#context-target').click({ button: 'right' })
    await page.keyboard.press('Control+Alt+P')
    await page.getByLabel('搜索操作').fill('右键操作')
    await page.getByRole('button', { name: '当前右键菜单 > 深层 > 右键操作', exact: true }).click()
    assert.equal(await page.evaluate(() => window.counter), 11)
    const oldAction = await page.evaluate(() => window.__DANJUAN_EDITOR_TOOLS__.state.contextActions[0].id)
    await page.locator('#context-target').click()
    await page.evaluate(id => window.__DANJUAN_EDITOR_TOOLS__.runAction(id), oldAction)
    assert.equal(await page.evaluate(() => window.counter), 11, '选择改变后旧右键回调必须被拒绝')
    const snapshots = path.join(ROOT, '.e2e-tmp')
    fs.mkdirSync(snapshots, { recursive: true })
    await page.screenshot({ path: path.join(snapshots, 'editor-tools-320.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.locator('[data-dj-tab="region"]').click()
    await page.screenshot({ path: path.join(snapshots, 'editor-tools-desktop.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('快捷操作 UI：实际菜单回调、搜索、快捷键冲突/重绑、区域选择/固定/取消、桌面/320px、键盘焦点与零页面异常全部通过')
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
