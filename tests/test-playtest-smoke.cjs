'use strict'
/**
 * 试玩冒烟测试（playtest_smoke）回归测试（零依赖）
 *
 * 覆盖：
 *   1. 动作脚本规整：字符串简写、对象数组、按键别名、按住时长、非法按键拒绝、步数上限；
 *   2. 诊断对比：新报错 / 变频繁 / 新卡住事件 / 性能恶化 判定与结论话术；
 *   3. MCP 侧端到端：无试玩时安全降级（不假装成功，并明确告诉用户先启动试玩）；
 *      空动作脚本被拒绝；非法按键被如实列出。
 *
 * 用法: node tests/test-playtest-smoke.cjs
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-smoke-'))
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

function startMcp(projectDir, extraEnv = {}) {
  const child = spawn(process.execPath, [MCP, '--root', projectDir], {
    env: { ...process.env, YAMI_MCP_GUARDED: '1', ...extraEnv },
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
  console.log('\n########## 1. 动作脚本规整 ##########')
  const { normalizeSequence, diffDiagnosis, describeVerdict, MAX_STEPS } = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'playtest.js'))

  const short = normalizeSequence('down,down,ok')
  check('字符串简写解析为按键步骤', short.steps.length === 3 && short.steps[0].key === 'ArrowDown' && short.steps[2].key === 'Enter')
  check('按键别名生效（ok→Enter/down→ArrowDown）', short.steps[1].key === 'ArrowDown' && short.rejected.length === 0)

  const mixed = normalizeSequence([{ key: 'left', holdMs: 800, waitMs: 1200 }, { waitMs: 500 }])
  check('对象数组支持按住时长与等待', mixed.steps[0].holdMs === 800 && mixed.steps[0].waitMs === 1200 && mixed.steps[1].kind === 'wait')
  check('按住时长按需下发（不传则不带字段）', normalizeSequence('ok').steps[0].holdMs === undefined)

  const bad = normalizeSequence([{ key: '不存在的键' }, { key: 'up' }])
  check('非法按键被拒绝且不影响其余步骤', bad.rejected.length === 1 && bad.steps.length === 1 && /不支持的按键/.test(bad.rejected[0].reason))

  const many = normalizeSequence(Array.from({ length: MAX_STEPS + 5 }, () => 'ok'))
  check('步骤数被限制在上限内', many.steps.length === MAX_STEPS && many.rejected.some(item => /步骤过多/.test(item.reason)))

  check('空脚本解析为空步骤', normalizeSequence('').steps.length === 0)

  console.log('\n########## 2. 诊断对比判定 ##########')
  const base = {
    errors: [{ category: '空指针', message: 'x', file: 'a.ts', lineno: 10, count: 2 }],
    stuckEvents: [],
    performance: { fps: 60, frameP95Ms: 18, computeP95Ms: 4 },
    summary: { errorKinds: 1, errorTotal: 2, stuckEvents: 0, overBudgetFrames: 0 }
  }
  const same = diffDiagnosis(base, JSON.parse(JSON.stringify(base)))
  check('无变化判为 ok', same.verdict === 'ok' && same.newErrors.length === 0 && same.reasons.length === 0)
  check('ok 结论话术明确', /没有新报错/.test(describeVerdict(same, 3)))

  const worse = JSON.parse(JSON.stringify(base))
  worse.errors = [
    { category: '空指针', message: 'x', file: 'a.ts', lineno: 10, count: 9 },
    { category: '资源404', message: 'y', file: 'b.ts', lineno: 3, count: 1 }
  ]
  worse.stuckEvents = [{ event: '剧情A', host: '角色B', step: 2, suspendMs: 8000 }]
  worse.performance = { fps: 24, frameP95Ms: 60, computeP95Ms: 20 }
  worse.summary = { errorKinds: 2, errorTotal: 10, stuckEvents: 1, overBudgetFrames: 8 }
  const diff = diffDiagnosis(base, worse)
  check('新报错被识别', diff.newErrors.length === 1 && diff.newErrors[0].file === 'b.ts')
  check('报错变频繁被识别', diff.worsenedErrors.length === 1 && diff.worsenedErrors[0].addedCount === 7)
  check('新卡住事件被识别', diff.newStuckEvents.length === 1 && diff.newStuckEvents[0].event === '剧情A')
  check('性能恶化被识别', diff.perf.regressed === true)
  check('判为 bad 且列出全部原因', diff.verdict === 'bad' && diff.reasons.length === 4, diff.reasons.join('；'))
  check('bad 结论话术可直接给用户', /发现问题/.test(describeVerdict(diff, 5)) && /新出现 1 类报错/.test(describeVerdict(diff, 5)))

  console.log('\n########## 3. MCP 端到端（无试玩时安全降级） ##########')
  const project = copyFixture()
  const { child, parse } = startMcp(project)
  await new Promise(resolve => setTimeout(resolve, 700))
  try {
    const degraded = await parse('playtest_smoke', { sequence: 'down,ok' })
    check('无试玩时不假装成功', degraded.ok === false && degraded.running === false)
    check('明确告诉用户先启动试玩', /试玩/.test(String(degraded.message || '')), String(degraded.message || '').slice(0, 40))

    const empty = await parse('playtest_smoke', { sequence: '' })
    check('空脚本被拒绝并给出示例', empty.ok === false && /sequence/.test(String(empty.error || '')), String(empty.error || '').slice(0, 40))

  } finally {
    child.kill()
    fs.rmSync(project, { recursive: true, force: true })
  }


  console.log('\n########## 4. 完整成功路径（模拟 5966 试玩桥） ##########')
  // 起一个假试玩桥：第一次诊断是干净的，收到按键之后第二次诊断带出新报错与卡住事件
  let keyPresses = []
  let diagnosisCalls = 0
  const bridge = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    const send = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (url === '/token') return send({ bridgeToken: 'test-token' })
    if (url === '/action' && req.method === 'POST') {
      let raw = ''
      req.on('data', chunk => { raw += chunk })
      req.on('end', () => {
        try { const body = JSON.parse(raw || '{}'); if (body.key) keyPresses.push(body.key) } catch {}
        send({ ok: true })
      })
      return
    }
    if (url === '/diagnose') {
      diagnosisCalls++
      const dirty = keyPresses.length > 0
      return send(dirty ? {
        kind: 'yami-diagnosis',
        summary: { errorKinds: 1, errorTotal: 3, stuckEvents: 1, overBudgetFrames: 0 },
        performance: { fps: 55, frameP95Ms: 19, computeP95Ms: 5, drawCalls: 30 },
        errors: [{ category: '空指针', title: '读取了不存在的对象', message: "Cannot read properties of undefined (reading 'hp')", file: 'actor.ts', lineno: 120, count: 3, codeContext: [] }],
        stuckEvents: [{ event: '剧情A', host: '角色B', step: 2, suspendMs: 9000 }]
      } : {
        kind: 'yami-diagnosis',
        summary: { errorKinds: 0, errorTotal: 0, stuckEvents: 0, overBudgetFrames: 0 },
        performance: { fps: 60, frameP95Ms: 17, computeP95Ms: 4, drawCalls: 28 },
        errors: [],
        stuckEvents: []
      })
    }
    send({ error: 'not found' }, 404)
  })
  const bridgePort = 15966 + Math.floor(Math.random() * 200)
  await new Promise(resolve => bridge.listen(bridgePort, '127.0.0.1', resolve))

  const project2 = copyFixture()
  const smoke = startMcp(project2, { YAMI_RUNTIME_BRIDGE_PORT: String(bridgePort) })
  await new Promise(resolve => setTimeout(resolve, 700))
  try {
    const result = await smoke.parse('playtest_smoke', { sequence: 'down,down,ok', settleMs: 200 })
    check('冒烟成功执行并返回结论', result.ok === true && typeof result.message === 'string', String(result.message || '').slice(0, 60))
    check('按键真的下发到了运行时桥', keyPresses.join(',') === 'ArrowDown,ArrowDown,Enter', keyPresses.join(','))
    check('执行步骤被如实记录', result.steps === 3 && result.executed.every(item => item.ok !== false))
    check('诊断被前后各取一次', diagnosisCalls >= 2, 'calls=' + diagnosisCalls)
    check('识别出新出现的报错（带文件与行号）', result.problems.newErrors.length === 1 && result.problems.newErrors[0].lineno === 120, JSON.stringify(result.problems.newErrors[0] || {}).slice(0, 80))
    check('识别出新卡住的事件', result.problems.newStuckEvents.length === 1 && result.problems.newStuckEvents[0].event === '剧情A')
    check('结论判为 bad 并给出定位提示', result.verdict === 'bad' && /search_project/.test(String(result.hint || '')))
    check('给出前后性能快照', !!result.perf && result.perf.before.frameP95Ms === 17 && result.perf.after.frameP95Ms === 19)
  } finally {
    smoke.child.kill()
    bridge.close()
    fs.rmSync(project2, { recursive: true, force: true })
  }

  console.log(`\n########## 试玩冒烟测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
