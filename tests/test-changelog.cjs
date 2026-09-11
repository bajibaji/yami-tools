'use strict'
/**
 * 变更小结（project_changelog）回归测试（零依赖）
 *
 * 覆盖：
 *   1. 纯逻辑：快照对比（修改/新建/删除、哈希不变即无变更）与小结话术；
 *   2. MCP 端到端：建立/重置基线、识别真实变更、标注来源工具与编译结论；
 *   3. 关键语义：**写了又改回去不算变更**（按内容哈希判定），编译失败回滚也能如实标注。
 *
 * 用法: node tests/test-changelog.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const ENGINE_TSC = process.env.YAMI_TSC_JS || '/home/deck/Desktop/ SHIT/GITHUB/2/node_modules/typescript/lib/tsc.js'
const SCRIPT_REL = 'Assets/插件/全局插件/Steamworks.2aafc4d56d4590d8.ts'
const CODE_ANCHOR = 'const regexp = /^--app-path=(.+)$/'

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-log-'))
  for (const entry of ['Assets', 'Data', 'Script']) {
    const from = path.join(FIXTURE, entry)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, entry), { recursive: true })
  }
  for (const file of ['tsconfig.json', 'game.yamirpg']) {
    const from = path.join(FIXTURE, file)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file))
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
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n')
  const parse = async (name, args) => {
    const raw = await call(name, args)
    if (!raw || !raw.result || !raw.result.content) throw new Error('MCP 调用失败: ' + name)
    return JSON.parse(raw.result.content[0].text)
  }
  return { child, parse }
}

async function main() {
  console.log('\n########## 1. 纯逻辑：快照对比与小结 ##########')
  const { diffSnapshot, buildChangelog, describeChangelog } = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'changelog.js'))

  const before = new Map([['a.ts', 'h1'], ['b.ts', 'h2']])
  const after = new Map([['a.ts', 'h1'], ['b.ts', 'h9'], ['c.ts', 'h3']])
  const diff = diffSnapshot(before, after)
  check('识别修改与新建', diff.modified.length === 1 && diff.modified[0] === 'b.ts' && diff.created[0] === 'c.ts')
  check('识别删除', diffSnapshot(after, before).deleted.includes('c.ts'))
  check('内容哈希不变则无变更', diffSnapshot(before, new Map(before)).modified.length === 0)

  const log = buildChangelog({
    snapshotDiff: { modified: ['b.ts'], created: ['c.ts'], deleted: [] },
    writes: [{ path: 'b.ts', tool: 'edit_script', compileOk: true }],
    playtest: { verdict: 'ok', message: '试玩冒烟：没有发现问题', steps: 3, problems: {} }
  })
  check('小结统计正确', log.summary.fileCount === 2 && log.summary.created === 1 && log.summary.modified === 1, JSON.stringify(log.summary))
  const entry = log.files.find(item => item.path === 'b.ts')
  check('标注来源工具与编译结论', entry.toolLabel === '精确改脚本' && entry.compileOk === true)
  check('话术含编译通过', /编译检查 1 次全部通过/.test(log.headline), log.headline)
  check('话术含试玩结论', /试玩冒烟没有发现问题/.test(log.headline))
  check('无改动时另有话术', /没有改动工程里的文件/.test(describeChangelog({ fileCount: 0, compileChecked: 0, compileFailed: 0 })))
  check('全部回滚时如实说明', /被自动回滚/.test(describeChangelog({ fileCount: 0, compileChecked: 1, compileFailed: 1 })))

  const failLog = buildChangelog({
    snapshotDiff: { modified: ['x.ts'], created: [], deleted: [] },
    writes: [{ path: 'x.ts', tool: 'edit_script', compileOk: false, errorCount: 2, firstError: 'x.ts(3,1): error TS1109', rolledBack: true }]
  })
  check('编译失败的写入被标注', failLog.files[0].compileOk === false && failLog.files[0].rolledBack === true && failLog.summary.compileFailed === 1)
  check('编译失败时给出补救建议', failLog.nextSteps.some(text => /编译/.test(text)), String(failLog.nextSteps[0]).slice(0, 30))

  console.log('\n########## 2. MCP 端到端：基线与真实变更 ##########')
  const project = copyFixture()
  const { child, parse } = startMcp(project)
  await new Promise(resolve => setTimeout(resolve, 800))
  try {
    const base = await parse('project_changelog', { reset: true })
    check('建立基线并回报跟踪文件数', base.ok === true && base.baseline === true && base.trackedFiles > 100, 'tracked=' + base.trackedFiles)

    const empty = await parse('project_changelog', {})
    check('无改动时结论为空', empty.summary.fileCount === 0 && /没有改动/.test(empty.headline), String(empty.headline).slice(0, 30))

    const write = await parse('edit_script', { path: SCRIPT_REL, oldText: CODE_ANCHOR, newText: CODE_ANCHOR + '\n  // 变更小结测试', dryRun: false })
    check('写入成功', write.ok === true, String(write.error || '').slice(0, 40))

    const log1 = await parse('project_changelog', {})
    check('识别出被修改的文件', log1.summary.fileCount === 1 && log1.summary.modified === 1, JSON.stringify(log1.summary))
    check('标注来源工具与编译结论', log1.files[0].tool === 'edit_script' && log1.files[0].compileOk === true, JSON.stringify(log1.files[0]).slice(0, 80))
    check('小结话术含编译通过', /编译检查 1 次全部通过/.test(log1.headline), String(log1.headline).slice(0, 50))
    check('给出下一步建议', Array.isArray(log1.nextSteps) && log1.nextSteps.length > 0, String(log1.nextSteps[0]).slice(0, 26))

    // 写了又改回去 —— 不应算作变更（按内容哈希判定的意义所在）
    await parse('edit_script', { path: SCRIPT_REL, oldText: '  // 变更小结测试\n', newText: '', dryRun: false })
    const log2 = await parse('project_changelog', {})
    check('写入又改回去不计入变更', log2.summary.fileCount === 0, JSON.stringify(log2.summary))

    // 新建脚本
    const guidResult = await parse('generate_guid', { count: 1 })
    const created = await parse('create_script', {
      type: 'command',
      path: `Assets/插件/自定义指令/变更小结测试.${guidResult.guids[0]}.ts`,
      nameZh: '变更小结测试指令',
      className: 'LogProbe',
      dryRun: false
    })
    check('新建脚本成功', created.ok === true, String(created.error || '').slice(0, 50))
    const log3 = await parse('project_changelog', {})
    check('新建文件被计入变更', log3.summary.created >= 1 || log3.summary.modified >= 1, JSON.stringify(log3.summary))

    await parse('project_changelog', { reset: true })
    const log4 = await parse('project_changelog', {})
    check('重置基线后回到空', log4.summary.fileCount === 0, JSON.stringify(log4.summary))
  } finally {
    child.kill()
    fs.rmSync(project, { recursive: true, force: true })
  }

  console.log(`\n########## 变更小结测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
