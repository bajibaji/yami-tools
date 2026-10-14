'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
let playwright
try { playwright = require('playwright') } catch {
  const dir = process.env.YAMI_PLAYWRIGHT_DIR || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
  playwright = createRequire(path.join(dir, '../package.json'))('playwright')
}
const source = fs.readFileSync(path.join(ROOT, 'ai-agent.js'), 'utf8')
const core = fs.readFileSync(path.join(ROOT, 'ai-render-core.js'), 'utf8')
const css = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8')
const targetPath = 'Assets/技能/很长的目录名称用于验证换行/落雷.abcdef1234567890.skill'
const set = { tool: 'commit_change_set', changeSetId: 'test-set', target: targetPath, summary: '提交 2 个文件的变更', risk: 'medium', frozenTarget: { paths: [targetPath], label: '落雷.skill' }, files: [{ path: targetPath }], preview: { diff: targetPath + '\n@@ 差异 @@\n-25\n+50\n+' + 'abcdef'.repeat(80), diffStat: { added: 2, removed: 1 } } }
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
button { position:absolute;width:88px;height:20px; }
${css}
body{margin:0;background:#181818;font-family:Arial,sans-serif}#yami-perf-dock{position:static!important;transform:none!important;opacity:1!important;pointer-events:auto!important;width:440px!important;max-width:100%!important;height:100vh!important;margin-inline:auto!important}.yami-perf-dock-body{height:100%;display:flex;flex-direction:column;overflow:hidden}#page-ai{height:100%!important;min-height:0!important} .yami-home-modules{display:none}#yami-perf-toast{display:none}
</style></head><body><div id="yami-perf-dock" class="yami-perf-dock show"><div class="yami-perf-dock-body"><div class="yami-home-modules"></div></div></div><div id="yami-perf-toast"></div>
<script>
window.process={env:{},cwd:()=>'',resourcesPath:''};
window.require=name=>name==='fs'?{existsSync:()=>false,mkdirSync(){},writeFileSync(){},readFileSync(file){if(file.endsWith('agent-token'))return 'ui-token';throw Error('missing')}}:name==='path'?{join:(...parts)=>parts.join('/'),dirname:()=> 'D:/fixture'}:name==='os'?{homedir:()=> 'D:/fixture'}:name==='crypto'?{randomBytes:()=>({toString:()=> 'ui-token'})}:{};
window.YamiEngine={File:{root:'D:/fixture'}};
window.__YAMI_PERF_PROBE__={getEditorContext:()=>({environment:'editor'}),getScope:()=>({type:'editor'}),getPresence:()=>null};
window.__DANJUAN_HUD_API__={ctx:{currentView:'ai'},registerPage(id,page){page.style.setProperty('display','flex','important')},switchView(){},toggleDock(){}};
</script><script src="/core.js"></script><script src="/agent.js"></script></body></html>`

async function main() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8')
    res.end(req.url === '/core.js' ? core : req.url === '/agent.js' ? source : html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await playwright.chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const errors = []
    const requests = []
    let approvalCount = 0
    let chatMode = 'draft'
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://127.0.0.1:5968/**', async route => {
      const req = route.request()
      const url = new URL(req.url())
      const body = req.postDataJSON() || {}
      requests.push({ path: url.pathname, body })
      const json = async value => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(value) })
      if (req.method() === 'OPTIONS') return json({ ok: true })
      if (url.pathname === '/status') return json({ ok: true, busy: false, config: { hasApiKey: true }, userTurns: 0 })
      if (url.pathname === '/files') return json({ ok: true, files: [], count: 0 })
      if (url.pathname === '/chat/stream') {
        const result = chatMode === 'alignment'
          ? { type: 'result', ok: true, status: 'alignment', message: '请选择目标' }
          : { type: 'result', ok: true, status: 'approval', approval: set }
        const content = chatMode === 'alignment'
          ? '<alignment-card>' + JSON.stringify({ id: 'align-id', summary: '选中了多个文件', questions: [{ title: '修改目标', options: ['@' + targetPath, '@Assets/other.skill'] }] }) + '</alignment-card>'
          : '草案已准备，未写入。'
        const events = chatMode === 'alignment' ? [{ type: 'delta', content }, result] : [
          { type: 'context', frozenTarget: set.frozenTarget },
          { type: 'delta', content: '读取目标。' },
          { type: 'tool', phase: 'start', key: 'read', name: 'read_resource', label: '读取资源', target: targetPath },
          { type: 'tool', phase: 'done', key: 'read', name: 'read_resource', info: {} },
          { type: 'delta', content: '准备修改。' },
          { type: 'tool', phase: 'start', key: 'patch', name: 'patch_resource', label: '准备草案', target: targetPath },
          { type: 'tool', phase: 'done', key: 'patch', name: 'patch_resource', info: { staged: true } },
          { type: 'delta', content }, result
        ]
        return route.fulfill({ contentType: 'text/event-stream', headers: { 'Access-Control-Allow-Origin': '*' }, body: events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') })
      }
      if (url.pathname === '/approve/stream' || url.pathname === '/align/stream') {
        approvalCount++
        const result = approvalCount === 1 ? { type: 'result', ok: true, status: 'approval', approval: { ...set, contextConflict: { message: '目标已变化' } } }
          : { type: 'result', ok: true, status: 'done', files: [{ path: targetPath }], validation: { ok: true, resources: [{ ok: true, issues: [] }], project: {}, playtest: { performed: false } }, message: '已写入，资源校验通过' }
        return route.fulfill({ contentType: 'text/event-stream', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'data: ' + JSON.stringify(result) + '\n\n' })
      }
      return json({ ok: true, hasApiKey: true, model: 'fake', models: ['fake'] })
    })
    await page.goto('http://127.0.0.1:' + server.address().port)
    await page.locator('#yami-ai-input').waitFor()
    await page.locator('#yami-ai-input').fill('修改选中技能')
    await page.locator('#yami-ai-input').press('Enter')
    await page.locator('#yami-ai-approval.show').waitFor()
    assert.equal(await page.locator('#yami-ai-frozen-target').textContent(), '本轮目标：落雷.skill')
    assert.equal(await page.locator('#yami-ai-grant').count(), 0)
    const answers = await page.locator('.yami-ai-message.assistant').allTextContents()
    assert.ok(answers.includes('读取目标。') && answers.includes('准备修改。') && answers.includes('草案已准备，未写入。'), JSON.stringify(answers))
    assert.ok(!answers.some(answer => answer.includes('读取目标。准备修改。')))
    await page.keyboard.press('Tab')
    await page.getByRole('button', { name: '执行修改', exact: true }).focus()
    await page.locator('#yami-ai-approve').press('Tab')
    await page.keyboard.press('Shift+Tab')
    const focus = await page.locator('#yami-ai-approve').evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, active: document.activeElement.id, visible: el.matches(':focus-visible'), box: el.getBoundingClientRect().toJSON() }))
    assert.equal(focus.outline, 'solid', JSON.stringify(focus))
    await page.locator('#yami-ai-approve').press('Enter')
    await page.getByRole('button', { name: '仍修改原目标' }).waitFor()
    assert.ok(await page.locator('#yami-ai-context-conflict').isVisible())
    await page.locator('#yami-ai-approve').press('Enter')
    await page.locator('.yami-ai-validation').waitFor()
    assert.ok((await page.locator('.yami-ai-validation').textContent()).includes('试玩：未执行'))
    assert.equal(requests.filter(req => req.path === '/approve/stream').length, 2)
    assert.equal(requests.filter(req => req.path === '/approve/stream')[1].body.confirmFrozenTarget, true)

    for (const width of [440, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.locator('#yami-ai-input').fill('再次准备草案')
      await page.locator('#yami-ai-input').press('Enter')
      await page.locator('#yami-ai-approval.show').waitFor()
      const dimensions = await page.locator('#page-ai').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
      assert.ok(dimensions.scrollWidth <= dimensions.width + 1, JSON.stringify(dimensions))
      for (const id of ['yami-ai-approve', 'yami-ai-reject']) {
        const rect = await page.locator('#' + id).boundingBox()
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1 && rect.width >= 24 && rect.height >= 24, JSON.stringify(rect))
        assert.equal(await page.locator('#' + id).evaluate(el => getComputedStyle(el).position), 'static')
      }
      fs.mkdirSync(path.join(ROOT, '.e2e-tmp'), { recursive: true })
      await page.screenshot({ path: path.join(ROOT, '.e2e-tmp', 'ai-workflow-' + width + '.png'), fullPage: true })
    }
    chatMode = 'alignment'
    await page.locator('#yami-ai-input').fill('改这个')
    await page.locator('#yami-ai-input').press('Enter')
    await page.locator('#yami-ai-align').waitFor()
    await page.getByRole('button', { name: '@Assets/other.skill', exact: true }).focus()
    await page.getByRole('button', { name: '@Assets/other.skill', exact: true }).press('Space')
    assert.equal(await page.getByRole('button', { name: '@Assets/other.skill', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: '确认目标', exact: true }).focus()
    await page.getByRole('button', { name: '确认目标', exact: true }).press('Enter')
    await page.waitForFunction(() => !document.querySelector('#yami-ai-align'))
    assert.ok(requests.some(req => req.path === '/align/stream' && req.body.alignmentId === 'align-id' && req.body.answers[0] === '@Assets/other.skill'))
    await page.setViewportSize({ width: 640, height: 900 })
    await page.locator('#page-ai').evaluate(el => { el.style.zoom = '2' })
    const reflow = await page.locator('#page-ai').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
    assert.ok(reflow.scrollWidth <= reflow.width + 1, JSON.stringify(reflow))
    const contrast = await page.evaluate(() => {
      const rgb = text => text.match(/[\d.]+/g).slice(0, 3).map(Number)
      const luma = color => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
      const color = rgb(getComputedStyle(document.querySelector('.yami-ai-primary')).color)
      const background = rgb(getComputedStyle(document.querySelector('.yami-ai-primary')).backgroundColor)
      const lights = [luma(color), luma(background)].sort((a, b) => b - a)
      return (lights[0] + 0.05) / (lights[1] + 0.05)
    })
    assert.ok(contrast >= 4.5, '主操作文本对比度 ' + contrast)
    assert.deepEqual(errors, [])
    console.log('AI workflow UI: 一次确认、目标变化、键盘选择、窄面板与长路径通过')
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
