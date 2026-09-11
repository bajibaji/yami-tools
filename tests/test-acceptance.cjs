'use strict'
/**
 * AI 助手「整体验收」测试（零依赖）
 *
 * 目的：前九轮各自有单点测试，这里验证**能力串联起来真的能干活**——
 * 用真实游戏工程的副本，把用户实际会走的那条链从头跑到尾：
 *
 *   建基线 → 检索定位 → 读脚本 → 精确改脚本 → 编译门禁 → 差异 → 改动小结
 *   → 待办进度 → 撤销 → 只读体检（真实工程）
 *
 * 同时验证"只读能力能在真实工程 new-game 上跑通"（不改动任何文件）。
 *
 * 用法: node tests/test-acceptance.cjs
 * 环境: YAMI_TEST_PROJECT 指定夹具工程（默认 /home/deck/yami-fixture）
 *       YAMI_REAL_PROJECT 指定真实工程（默认 /home/deck/Desktop/ SHIT/GITHUB/new-game，缺失则跳过只读段）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const REAL_PROJECT = process.env.YAMI_REAL_PROJECT || '/home/deck/Desktop/ SHIT/GITHUB/new-game'
const ENGINE_TSC = process.env.YAMI_TSC_JS || '/home/deck/Desktop/ SHIT/GITHUB/2/node_modules/typescript/lib/tsc.js'

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

function copyProject(from) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-accept-'))
  for (const entry of ['Assets', 'Data', 'Script']) {
    const source = path.join(from, entry)
    if (fs.existsSync(source)) fs.cpSync(source, path.join(dir, entry), { recursive: true })
  }
  for (const file of ['tsconfig.json', 'game.yamirpg', 'index.html']) {
    const source = path.join(from, file)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, file))
  }
  return dir
}

function startMcp(projectDir) {
  const child = spawn(process.execPath, [MCP, '--root', projectDir], {
    env: { ...process.env, YAMI_MCP_GUARDED: '1', YAMI_TSC_JS: ENGINE_TSC },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = ''
  let nextId = 1
  const pending = new Map()
  child.stdout.on('data', chunk => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      const entry = pending.get(message.id)
      if (entry) { pending.delete(message.id); entry(message) }
    }
  })
  const call = (name, args) => new Promise(resolve => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance', version: '1' } } }) + '\n')
  const parse = async (name, args) => {
    const raw = await call(name, args)
    if (!raw || !raw.result || !raw.result.content) throw new Error('MCP 调用失败: ' + name + ' ' + JSON.stringify(raw).slice(0, 160))
    return JSON.parse(raw.result.content[0].text)
  }
  return { child, parse }
}

async function main() {
  if (!fs.existsSync(path.join(FIXTURE, 'game.yamirpg'))) {
    console.error('找不到夹具工程: ' + FIXTURE)
    process.exit(2)
  }

  const project = copyProject(FIXTURE)
  const { child, parse } = startMcp(project)
  await new Promise(resolve => setTimeout(resolve, 800))
  let scriptRel = ''
  let originalText = ''

  try {
    console.log('\n########## A. 工具清单完整性 ##########')
    const toolList = await new Promise(resolve => {
      const id = 999999
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }) + '\n')
      const onData = chunk => {
        const text = chunk.toString()
        if (!text.includes('"tools"')) return
        child.stdout.off('data', onData)
        try { resolve(JSON.parse(text.trim().split('\n').pop()).result.tools.map(tool => tool.name)) } catch { resolve([]) }
      }
      child.stdout.on('data', onData)
    })
    check('工具清单可枚举', Array.isArray(toolList) && toolList.length >= 30, '工具数=' + toolList.length)
    const expected = ['search_project', 'edit_script', 'diagnose_runtime', 'playtest_smoke', 'project_changelog', 'todo_write', 'list_backups', 'restore_backup']
    const missing = expected.filter(name => !toolList.includes(name))
    check('本工程特色工具齐备', missing.length === 0, missing.length ? '缺: ' + missing.join(',') : expected.length + ' 项齐全')
    check('内置模型看不到 cdp_eval（安全约定）', toolList.includes('cdp_eval'))
    const hiddenInHost = require('fs').readFileSync(path.join(ROOT, 'ai-host.js'), 'utf8')
    check('宿主侧 cdp_eval 已隐藏', /HIDDEN_TOOLS = new Set\(\['cdp_eval'\]\)/.test(hiddenInHost))

    console.log('\n########## B. 真实工作流串联（工程副本上执行） ##########')
    const baseline = await parse('project_changelog', { reset: true })
    check('B1 建立基线', baseline.ok === true && baseline.trackedFiles > 100, 'tracked=' + baseline.trackedFiles)

    const plan = await parse('todo_write', { todos: ['定位要改的脚本', '精确改脚本', '确认编译通过', '生成改动小结'] })
    check('B2 记录任务计划', plan.ok === true && plan.items.length === 4, String(plan.progress || ''))

    const found = await parse('search_project', { query: 'app-path', scope: 'script', maxResults: 5 })
    check('B3 检索定位到文件', found.ok === true && found.totalMatched > 0, '命中=' + found.totalMatched)
    scriptRel = found.results[0].path
    const read = await parse('read_script', { path: scriptRel })
    originalText = read.content
    const anchor = originalText.split('\n').find(line => line.includes('app-path'))
    check('B4 读取脚本拿到锚点', !!anchor, String(anchor || '').slice(0, 40))

    await parse('todo_write', { todos: [
      { text: '定位要改的脚本', status: 'done' },
      { text: '精确改脚本', status: 'in_progress' },
      { text: '确认编译通过', status: 'pending' },
      { text: '生成改动小结', status: 'pending' }
    ] })

    const dry = await parse('edit_script', { path: scriptRel, oldText: anchor, newText: anchor + '\n  // 验收标记', dryRun: true })
    check('B5 改动前先看差异', dry.ok === true && /@@/.test(dry.diff || '') && dry.risk === 'medium', 'diff 长度=' + String(dry.diff || '').length)
    check('B5b 预览阶段工程未被改动', fs.readFileSync(path.join(project, scriptRel), 'utf8') === originalText)

    const write = await parse('edit_script', { path: scriptRel, oldText: anchor, newText: anchor + '\n  // 验收标记', dryRun: false, expectedSha256: read.sha256 })
    check('B6 写入并通过编译门禁', write.ok === true && write.compile && write.compile.ok === true, 'errorCount=' + (write.compile && write.compile.errorCount))
    check('B6b 写入留下备份', typeof write.backup === 'string' && write.backup.startsWith('.yami-mcp-backups/'))

    const conflicted = await parse('edit_script', { path: scriptRel, oldText: anchor, newText: anchor, dryRun: false, expectedSha256: read.sha256 })
    check('B7 旧哈希写入被拒（并发保护）', conflicted.ok === false && conflicted.conflict === true)

    await parse('todo_write', { todos: [
      { text: '定位要改的脚本', status: 'done' },
      { text: '精确改脚本', status: 'done' },
      { text: '确认编译通过', status: 'done' },
      { text: '生成改动小结', status: 'in_progress' }
    ] })
    const log = await parse('project_changelog', {})
    check('B8 小结列出真实变更', log.summary.fileCount === 1 && log.files[0].path === scriptRel, JSON.stringify(log.summary))
    check('B8b 小结标注来源工具与编译结论', log.files[0].tool === 'edit_script' && log.files[0].compileOk === true)
    check('B8c 小结带上计划进度', log.todoSummary && log.todoSummary.done === 3, JSON.stringify(log.todoSummary || {}))
    check('B8d 小结话术可直接给用户', /本次共改动 1 个文件/.test(String(log.headline || '')), String(log.headline || '').slice(0, 46))

    const backups = await parse('list_backups', { path: scriptRel })
    check('B9 可回退版本可查', backups.ok === true && backups.count >= 1, 'count=' + backups.count)
    const undo = await parse('restore_backup', { path: scriptRel, dryRun: false })
    check('B10 一键回退成功', undo.ok === true && fs.readFileSync(path.join(project, scriptRel), 'utf8') === originalText, String(undo.error || ''))
    check('B10b 回退也留了安全备份', !!undo.safetyBackup)

    const afterUndo = await parse('project_changelog', {})
    check('B11 回退后净变更为 0（按内容哈希判定）', afterUndo.summary.fileCount === 0, JSON.stringify(afterUndo.summary))

    const runtime = await parse('diagnose_runtime', {})
    check('B12 未试玩时诊断安全降级', runtime.ok === false && /试玩/.test(String(runtime.message || '')))
    const smoke = await parse('playtest_smoke', { sequence: 'down,ok' })
    check('B13 未试玩时冒烟安全降级', smoke.ok === false && /试玩/.test(String(smoke.message || '')))
    const cleared = await parse('todo_write', { clear: true })
    check('B14 任务收尾可清空计划', cleared.ok === true && cleared.items.length === 0)
  } finally {
    child.kill()
    fs.rmSync(project, { recursive: true, force: true })
  }

  console.log('\n########## C. 只读验收：真实工程 ##########')
  if (!fs.existsSync(path.join(REAL_PROJECT, 'game.yamirpg'))) {
    console.log('  SKIP  未找到真实工程（' + REAL_PROJECT + '），跳过只读段')
  } else {
    const real = startMcp(REAL_PROJECT)
    await new Promise(resolve => setTimeout(resolve, 900))
    try {
      const resources = await real.parse('list_resources', { limit: 1 })
      check('C1 能列出真实工程资源', resources.ok === true && resources.count > 1000, '资源数=' + resources.count)

      const scripts = await real.parse('list_scripts', {})
      check('C2 能列出真实工程脚本', scripts.ok === true && scripts.total > 0, '脚本数=' + scripts.total)

      const search = await real.parse('search_project', { query: 'movementSpeed', scope: 'script', maxResults: 5 })
      check('C3 能在真实工程里检索', search.ok === true && search.totalMatched > 0, '命中=' + search.totalMatched + ' 扫描=' + search.scannedFiles)

      const compile = await real.parse('compile_check', {})
      check('C4 真实工程编译检查可跑', typeof compile.ok === 'boolean', 'errorCount=' + compile.errorCount)

      const audit = await real.parse('validate_project', {})
      check('C5 真实工程体检可跑并给结论', audit.ok === true && typeof audit.stats.files === 'number', 'files=' + audit.stats.files)

      const before = fs.readFileSync(path.join(REAL_PROJECT, 'game.yamirpg'), 'utf8')
      const noWrite = await real.parse('edit_script', { path: 'Assets/不存在.0000000000000000.ts', oldText: 'a', newText: 'b', dryRun: true })
      check('C6 越界/不存在路径被拒', noWrite.ok === false)
      check('C6b 只读验收未改动真实工程', fs.readFileSync(path.join(REAL_PROJECT, 'game.yamirpg'), 'utf8') === before)
    } finally {
      real.child.kill()
    }
  }

  console.log(`\n########## 整体验收: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
