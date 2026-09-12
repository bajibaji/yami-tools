/**
 * 编译器查找与「没得校验」的语义（跨平台回归）
 *
 * 真实事故（2026-09-12 实测发现）：
 *   `findCompiler` 把包名写死成 `@typescript/typescript-win32-x64`，引擎根又是按
 *   「往上三级再拼字符串 '2'」推断的。于是 Linux 源码版上永远找不到 tsc——而写脚本的路径是
 *   「编译不过就回滚」，找不到编译器等于**每次改代码都被撤销**：AI 在非 Windows 平台上
 *   根本改不了脚本。所有测试都显式设了 `YAMI_TSC_JS`，所以一路全绿，把这个洞整整盖住了。
 *
 * 这里守住三件事：
 *   ① 按当前平台找引擎自带的 tsc（linux-x64 / darwin-arm64 / win32-x64 都认）；
 *   ② 「找不到编译器」与「代码没通过编译」必须区分——前者不触发回滚，但如实标注未校验；
 *   ③ 真找到编译器时，门禁必须真的拦得住语法错误（否则就是把门禁改成了摆设）。
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const ENGINE_ROOT = process.env.YAMI_ENGINE_ROOT || '/home/deck/Desktop/ SHIT/GITHUB/2'
const SCRIPT_REL = 'Assets/插件/全局插件/Steamworks.2aafc4d56d4590d8.ts'
const SAFE_ANCHOR = '@lang ru'   // @plugin 注释块内的无害片段，用于"真实写入"用例
const CODE_ANCHOR = 'const regexp = /^--app-path=(.+)$/'   // 唯一的真代码锚点，用于制造语法错误

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-compiler-'))
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

function startMcp(projectDir, extraEnv) {
  const env = { ...process.env, YAMI_MCP_GUARDED: '1', ...extraEnv }
  const child = spawn(process.execPath, [MCP, '--root', projectDir], { env, stdio: ['pipe', 'pipe', 'pipe'] })
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
    const content = raw && raw.result && raw.result.content
    if (!content || !content[0]) return { ok: false, error: '工具没有返回内容' }
    try { return JSON.parse(content[0].text) } catch (e) { return { ok: false, error: '返回无法解析' } }
  }
  return { call: parse, stop: () => child.kill() }
}

async function main() {
  if (!fs.existsSync(path.join(FIXTURE, 'Assets'))) {
    console.log('跳过：找不到夹具工程 ' + FIXTURE + '（可用 YAMI_TEST_PROJECT 指定）')
    process.exit(0)
  }

  console.log('\n########## 1. 静态：不许再把平台写死 ##########')
  const source = fs.readFileSync(MCP, 'utf8')
  check('存在按平台拼包名的实现', /typescript-\$\{platform\}-\$\{arch\}/.test(source) || /pkg: `typescript-/.test(source))
  check('引擎根不再靠「往上三级拼 2」推断', !/'\.\.', '\.\.', '\.\.', '2'/.test(source))
  check('保留 Windows 默认安装路径作为候选', /Open Yami RPG Editor/.test(source))

  const dir = copyFixture()

  console.log('\n########## 2. 找不到编译器：不许回滚，但要如实标注 ##########')
  const blind = startMcp(dir, { YAMI_ENGINE_ROOT: path.join(os.tmpdir(), 'no-such-engine-root'), YAMI_TSC_JS: '', YAMI_TSC_EXE: '' })
  try {
    const compile = await blind.call('compile_check', {})
    check('compile_check 明确回报「没得校验」而非含糊失败', compile.ok === false && compile.unavailable === true, String(compile.error || '').slice(0, 60))
    check('错误信息带上当前平台', new RegExp(process.platform).test(String(compile.error || '')), process.platform)

    const before = fs.readFileSync(path.join(dir, SCRIPT_REL), 'utf8')
    const write = await blind.call('edit_script', { path: SCRIPT_REL, oldText: SAFE_ANCHOR, newText: SAFE_ANCHOR + '_x', dryRun: false })
    check('写入没有被误判成编译失败而回滚', write.ok === true, String(write.error || '').slice(0, 80))
    check('结果如实标注「未能编译校验」', write.compileSkipped === true)
    const after = fs.readFileSync(path.join(dir, SCRIPT_REL), 'utf8')
    check('文件确实被改了（证明没回滚）', after !== before && after.includes(SAFE_ANCHOR + '_x'))
    const restore = await blind.call('edit_script', { path: SCRIPT_REL, oldText: SAFE_ANCHOR + '_x', newText: SAFE_ANCHOR, dryRun: false })
    check('改回原样', restore.ok === true)
  } finally { blind.stop() }

  console.log('\n########## 3. 按平台找到引擎自带的 tsc（Linux 场景） ##########')
  const tscName = process.platform === 'win32' ? 'tsc.exe' : 'tsc'
  const expected = path.join(ENGINE_ROOT, 'node_modules', '@typescript', `typescript-${process.platform}-${process.arch}`, 'lib', tscName)
  check('本机确实存在平台原生的 tsc（前置条件）', fs.existsSync(expected), expected)

  const sighted = startMcp(dir, { YAMI_ENGINE_ROOT: ENGINE_ROOT, YAMI_TSC_JS: '', YAMI_TSC_EXE: '' })
  try {
    const compile = await sighted.call('compile_check', {})
    check('自动找到编译器并跑通编译', compile.ok === true, 'errorCount=' + compile.errorCount)
    check('没有再报「未找到编译器」', compile.unavailable !== true)

    const write = await sighted.call('edit_script', { path: SCRIPT_REL, oldText: SAFE_ANCHOR, newText: SAFE_ANCHOR + '_y', dryRun: false })
    check('真实写入过了编译门禁', write.ok === true && write.compile && write.compile.ok === true, 'errorCount=' + (write.compile && write.compile.errorCount))
    check('没有标注跳过校验', write.compileSkipped !== true)

    // 门禁必须真的拦得住：把一处唯一的真代码片段改成语法错误
    // （锚点必须唯一，否则 edit_script 会以"多处匹配"拒绝，测不到编译门禁）
    const broken = await sighted.call('edit_script', {
      path: SCRIPT_REL,
      oldText: CODE_ANCHOR,
      newText: CODE_ANCHOR + ' {{{',
      dryRun: false
    })
    check('语法错误被编译门禁拦下', broken.ok === false && broken.compile && broken.compile.ok === false, 'errorCount=' + (broken.compile && broken.compile.errorCount))
    check('被拦下时自动回滚', !!broken.rollback && !broken.rollback.error)
    const restored = fs.readFileSync(path.join(dir, SCRIPT_REL), 'utf8')
    check('磁盘上是回滚后的干净内容', !restored.includes('{{{') && restored.includes(SAFE_ANCHOR + '_y'))
  } finally { sighted.stop() }

  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n########## 编译器查找与降级语义: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
