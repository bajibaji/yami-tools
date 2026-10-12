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
body{margin:0;background:#181818}#yami-perf-dock{position:static!important;transform:none!important;opacity:1!important;pointer-events:auto!important;width:440px!important;max-width:100%!important;margin-inline:auto!important;height:100vh!important}.yami-perf-dock-body{overflow:auto!important}</style></head><body>
<tab-bar id="title-tabBar"></tab-bar><node-list id="scene-list"></node-list><div id="region-panel"><div id="sceneRegion-events" tabindex="0"></div></div>
<div id="yami-perf-dock"><div class="yami-perf-dock-body"><div class="yami-home-modules"><div id="yami-home-card-ai"><div class="yami-home-module-title">AI助手</div></div></div></div></div>
<script>
window.insertedCommands = [];
window.confirm = () => true;
document.getElementById('scene-list').read = () => ({ class: 'region', name: '测试区域', presetId: 'r1', x: 100, y: 100, width: 64, height: 48, events: [], scripts: [] });
document.getElementById('title-tabBar').read = () => ({ type: 'scene', meta: { path: 'Assets/场景/测试.abcdef1234567890.scene', guid: 'abcdef1234567890' } });
window.YamiEngine = { File: { root: 'D:/test' }, Scene: { meta: { path: 'Assets/场景/测试.abcdef1234567890.scene' } } };
window.__DANJUAN_HUD_API__ = {
  ctx: { currentView: 'home', dockState: 'expanded' },
  registerPage(id, page, def) { this.page = page; this.def = def },
  toggleDock() {},
  switchView(id) {
    this.ctx.currentView = id;
    if (this.page) {
      this.page.style.setProperty('display', id === 'editor-tools' ? 'flex' : 'none', 'important');
    }
    if (this.def && typeof this.def.refresh === 'function') this.def.refresh();
  }
};
</script><script src="/editor-tools.js"></script></body></html>`

async function main() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/editor-tools.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(req.url === '/editor-tools.js' ? js : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright().chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);

    // 1. 验证卡片名称与粉色视觉
    assert.equal(await page.locator('#dj-tools-entry .yami-home-module-title').textContent(), '痛点解决');
    assert.equal(await page.locator('#dj-tools-entry .yami-home-module-icon-box').evaluate(el => el.classList.contains('pink')), true, '图标盒必须使用 pink 粉色类名');
    assert.equal(await page.locator('#dj-tools-entry .yami-home-module-badge').evaluate(el => el.classList.contains('pink')), true, '进入徽章必须使用 pink 粉色类名');

    // 2. 验证卡片物理位置位于 AI 助手正上方
    const isAboveAI = await page.evaluate(() => {
      const entry = document.getElementById('dj-tools-entry');
      const ai = document.getElementById('yami-home-card-ai');
      return entry && ai && entry.nextElementSibling === ai;
    });
    assert.equal(isAboveAI, true, '痛点解决必须严格插入在 AI 助手正上方');

    // 3. 点击进入区域工作台
    await page.locator('#dj-tools-entry').click();
    await page.getByText('区域工作台', { exact: true }).waitFor();
    await page.getByText('选中场景区域', { exact: true }).waitFor();
    await page.getByText('测试区域', { exact: true }).waitFor();

    // 4. 验证边界范围卡片数值计算 (x=100, y=100, w=64, h=48 -> L:68, T:76, R:132, B:124)
    await page.getByText('摄像机视野边界').waitFor();
    assert.equal(await page.locator('.dj-bounds-v').nth(0).textContent(), '68');
    assert.equal(await page.locator('.dj-bounds-v').nth(1).textContent(), '76');
    assert.equal(await page.locator('.dj-bounds-v').nth(2).textContent(), '132');
    assert.equal(await page.locator('.dj-bounds-v').nth(3).textContent(), '124');

    // 5. 验证固定监视与试玩进出日志
    await page.getByRole('button', { name: '固定监视', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__DANJUAN_EDITOR_TOOLS__.state.pin.presetId), 'r1');

    await page.evaluate(() => {
      const actor = { name: '主角' };
      const region = { name: '测试区域', presetId: 'r1', x: 100, y: 100, width: 64, height: 48, actors: [actor], parent: { scene: { id: 'abcdef1234567890' } }, emit() {} };
      window.Party = { player: actor };
      window.YamiEngine.Scene.binding = { id: 'abcdef1234567890' };
      window.YamiEngine.Scene.region = { list: [region] };
    });
    await page.getByText('正在监视', { exact: true }).waitFor();
    await page.getByText('1 个', { exact: true }).waitFor();

    await page.evaluate(() => window.YamiEngine.Scene.region.list[0].emit('playerenter', window.Party.player));
    await page.locator('.dj-tools-log').filter({ hasText: '玩家进入' }).waitFor();

    // 6. 验证取消监视
    await page.getByRole('button', { name: '取消监视', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__DANJUAN_EDITOR_TOOLS__.state.pin), null);

    // 7. 响应式与无横向溢出验证
    for (const width of [1280, 640, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.locator('#page-editor-tools').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, '窗口宽度 ' + width + ' 不得横向溢出');
    }

    assert.equal(errors.length, 0, '页面严禁发生任何未捕获错误：' + errors.join('; '));
    console.log('UI 端到端测试全绿通过：卡片定位、粉色主题、边界计算、监视日志与响应式完全合格');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
