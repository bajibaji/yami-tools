'use strict'
/**
 * yami-mcp「AI 特色工具」回归测试（零依赖）
 *
 * 覆盖本轮新增的三件特色能力：
 *   1. search_project —— 内容检索（grep 式）：按范围搜索、命中带行号与位置、上下文行；
 *   2. edit_script    —— 脚本精确片段替换：唯一性校验、dryRun 不写盘、expectedSha256 冲突保护、
 *                        写入后真实编译门禁、编译失败自动回滚；
 *   3. diagnose_runtime —— 运行时诊断摘要：无试玩时安全降级并给出可操作提示。
 *
 * 安全约定：所有写操作都在夹具工程的**临时副本**上进行，绝不触碰任何真实工程。
 *
 * 用法: node tests/test-mcp-ai-tools.cjs
 * 依赖: 夹具工程（默认 /home/deck/yami-fixture）与引擎自带 TypeScript（可用 YAMI_TSC_JS 覆盖）
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const ENGINE_TSC = process.env.YAMI_TSC_JS || '/home/deck/Desktop/ SHIT/GITHUB/2/node_modules/typescript/lib/tsc.js'
const SCRIPT_REL = 'Assets/插件/全局插件/Steamworks.2aafc4d56d4590d8.ts'
const UNIQUE = '@lang ru'                                   // 位于 @plugin 注释块内，用于安全的片段替换用例
const CODE_ANCHOR = 'const regexp = /^--app-path=(.+)$/'      // 真代码锚点，用于验证编译门禁与回滚

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ============================== 临时工程副本 ============================== */
function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-mcp-ai-'))
  for (const entry of ['Assets', 'Data', 'Script']) {
    const from = path.join(FIXTURE, entry)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, entry), { recursive: true })
  }
  for (const file of ['tsconfig.json', 'game.yamirpg', 'index.html']) {
    const from = path.join(FIXTURE, file)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file))
  }
  return dir
}

/* ============================== MCP 客户端 ============================== */
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
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n')
  const parse = async (name, args) => {
    const raw = await call(name, args)
    if (!raw || !raw.result || !raw.result.content) throw new Error('MCP 调用失败: ' + name + ' ' + JSON.stringify(raw).slice(0, 200))
    return JSON.parse(raw.result.content[0].text)
  }
  return { child, parse }
}

async function main() {
  if (!fs.existsSync(path.join(FIXTURE, 'game.yamirpg'))) {
    console.error('找不到夹具工程: ' + FIXTURE + '（可用 YAMI_TEST_PROJECT 指定）')
    process.exit(2)
  }
  const project = copyFixture()
  const { child, parse } = startMcp(project)
  await new Promise(resolve => setTimeout(resolve, 800))

  try {
    console.log('\n########## 1. search_project（内容检索） ##########')
    const scriptHit = await parse('search_project', { query: 'Steamworks', scope: 'script', maxResults: 5, contextLines: 1 })
    check('脚本范围检索可用', scriptHit.ok === true && scriptHit.totalMatched > 0, '命中=' + scriptHit.totalMatched + ' 扫描=' + scriptHit.scannedFiles)
    const first = (scriptHit.results || [])[0] || {}
    check('命中带文件、行号与位置', typeof first.path === 'string' && typeof first.line === 'number' && Array.isArray(first.matches) && first.matches.length > 0, first.path + ':' + first.line)
    check('带上下文行', Array.isArray(first.context) && first.context.some(line => line.current === true))
    check('脚本范围不返回非脚本文件', (scriptHit.results || []).every(item => /\.(ts|js)$/i.test(item.path)))

    const dataHit = await parse('search_project', { query: 'appId', scope: 'data', maxResults: 3 })
    check('数据范围检索可用', dataHit.ok === true, '命中=' + dataHit.totalMatched)
    check('数据范围只返回 Data/*.json', (dataHit.results || []).every(item => /^Data\/.+\.json$/.test(item.path)))

    const regexHit = await parse('search_project', { query: 'movementSpeed\\s*=', scope: 'script', maxResults: 5 })
    check('支持正则检索', regexHit.ok === true, '命中=' + regexHit.totalMatched)

    const literalHit = await parse('search_project', { query: 'a(b', scope: 'script', maxResults: 5 })
    check('非法正则退化为纯文本且不报错', literalHit.ok === true)

    const emptyHit = await parse('search_project', { query: '绝不可能出现的字符串ZZZ9', scope: 'script' })
    check('无命中时返回空列表与提示', emptyHit.ok === true && emptyHit.totalMatched === 0 && typeof emptyHit.hint === 'string')

    console.log('\n########## 2. edit_script（精确片段替换） ##########')
    const before = (await parse('read_script', { path: SCRIPT_REL })).content

    const miss = await parse('edit_script', { path: SCRIPT_REL, oldText: '不存在的片段XYZ', newText: 'x', dryRun: true })
    check('片段不存在时拒绝', miss.ok === false && /未在脚本中找到/.test(miss.error))

    const many = await parse('edit_script', { path: SCRIPT_REL, oldText: '#appId', newText: '#appId', dryRun: true })
    check('多处匹配时拒绝并给出行号', many.ok === false && many.ambiguous === true && Array.isArray(many.lines) && many.lines.length >= 2, '行号=' + JSON.stringify(many.lines))

    const dry = await parse('edit_script', { path: SCRIPT_REL, oldText: UNIQUE, newText: UNIQUE + '-ai', dryRun: true })
    check('唯一片段 dryRun 通过并给出差异', dry.ok === true && dry.dryRun === true && typeof dry.line === 'number', '行=' + dry.line)
    check('dryRun 未写盘', (await parse('read_script', { path: SCRIPT_REL })).content === before)

    const readBack = await parse('read_script', { path: SCRIPT_REL })
    const write = await parse('edit_script', { path: SCRIPT_REL, oldText: UNIQUE, newText: UNIQUE + '-ai', dryRun: false, expectedSha256: readBack.sha256 })
    check('正式写入成功', write.ok === true, String(write.message || write.error).slice(0, 46))
    check('写入后自动跑编译门禁且通过', write.compile && write.compile.ok === true, 'errorCount=' + (write.compile && write.compile.errorCount))
    const after = await parse('read_script', { path: SCRIPT_REL })
    check('文件内容已变更', after.content.includes(UNIQUE + '-ai') && after.content.length === before.length + 3)

    const conflict = await parse('edit_script', { path: SCRIPT_REL, oldText: UNIQUE + '-ai', newText: UNIQUE, dryRun: false, expectedSha256: readBack.sha256 })
    check('旧 sha 写入被拒（冲突保护）', conflict.ok === false && conflict.conflict === true)

    // 注意：必须往真代码里注入语法错误。若注入到 /* @plugin ... */ 注释块内部，
    // 那只是注释文本，编译器不会报错，会误判成"门禁没拦住"（这个坑实测踩过）。
    const broken = await parse('edit_script', { path: SCRIPT_REL, oldText: CODE_ANCHOR, newText: CODE_ANCHOR + '\nconst __ai_broken = = 1', dryRun: false })

    check('语法错误被编译门禁拦下', broken.ok === false && broken.compile && broken.compile.ok === false, 'errorCount=' + (broken.compile && broken.compile.errorCount))
    check('编译失败后自动回滚到修改前', (await parse('read_script', { path: SCRIPT_REL })).content === after.content)

    const restore = await parse('edit_script', { path: SCRIPT_REL, oldText: UNIQUE + '-ai', newText: UNIQUE, dryRun: false })
    check('还原成功', restore.ok === true && (await parse('read_script', { path: SCRIPT_REL })).content === before)

    const outside = await parse('edit_script', { path: 'Script/actor.ts', oldText: 'a', newText: 'b', dryRun: true })
    check('拒绝越界路径（只能改 Assets 内脚本）', outside.ok === false && /Assets/.test(outside.error))

    console.log('\n########## 3. diagnose_runtime（运行时诊断摘要） ##########')
    const diag = await parse('diagnose_runtime', {})
    if (diag.running === false) {
      check('无试玩时安全降级并给出可操作提示', diag.ok === false && /试玩/.test(String(diag.message || '')), String(diag.message || '').slice(0, 40))
    } else {
      check('有试玩时返回诊断结构', typeof diag.data === 'object' && Array.isArray(diag.data.errors) && !!diag.data.performance, 'errors=' + (diag.data.errors || []).length)
      check('诊断体积可控（不返回 300 帧时间线）', JSON.stringify(diag.data).length < 60000, 'chars=' + JSON.stringify(diag.data).length)
    }
  } finally {
    child.kill()
    fs.rmSync(project, { recursive: true, force: true })
  }

  console.log(`\n########## MCP AI 特色工具测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
