'use strict'
/**
 * AI 助手「编译失败自动修复循环」回归测试（零依赖）
 *
 * 场景：模型写的脚本没过引擎 tsc → 工具返回里带 tsc 原始报错并已自动回滚
 *      → 宿主必须把报错**喂回模型**并让它继续修，而不是把失败直接甩给用户。
 *
 * 本测试用一个"先写坏、收到报错后改对"的假模型来验证整条回路：
 *   1. 第一次请求：模型用 edit_script 写入会破坏编译的片段；
 *   2. 宿主发现 compile.ok === false → 生成修复指令（含报错原文）→ 再次请求模型；
 *   3. 第二次请求：模型收到修复指令后改对，宿主返回 done；
 *   4. 超过上限仍修不好时，必须如实返回 status='compile-failed' 而不是假装成功。
 *
 * 用法: node tests/test-ai-repair.cjs
 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const ENGINE_TSC = process.env.YAMI_TSC_JS || '/home/deck/Desktop/ SHIT/GITHUB/2/node_modules/typescript/lib/tsc.js'
const SCRIPT_REL = 'Assets/插件/全局插件/Steamworks.2aafc4d56d4590d8.ts'
const CODE_ANCHOR = 'const regexp = /^--app-path=(.+)$/'   // 真代码锚点（不是注释，编译器一定会检查）

const TOKEN = crypto.randomBytes(24).toString('hex')
const AI_PORT = 17968 + Math.floor(Math.random() * 400)
const MODEL_PORT = AI_PORT + 400
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'danjuan-repair-test-'))

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ============================== 临时工程副本（绝不碰真实工程） ============================== */
function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-repair-'))
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

/* ============================== 假模型：先写坏、收到报错后改对 ============================== */
const modelRequests = []          // 记录每次发给模型的 messages，供断言
let modelMode = 'repair'          // repair | always-broken
let repairedOnce = false          // 桩状态：收到修复指令并改对之后，不再重复调用工具
let writeOnly = false             // 桩模式：只做一次干净写入（用于制造可回退版本）

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  for (const chunk of chunks) res.write('data: ' + JSON.stringify(chunk) + '\n\n')
  res.write('data: [DONE]\n\n')
  res.end()
}

function toolTurn(res, args, note) {
  const call = { id: 'call_' + modelRequests.length, type: 'function', function: { name: 'edit_script', arguments: JSON.stringify(args) } }
  sse(res, [
    { choices: [{ delta: { content: note } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: 'edit_script', arguments: call.function.arguments } }] } }] }
  ])
}

const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch { /* 忽略 */ }
    const messages = body.messages || []
    modelRequests.push(messages)

    const repairAsked = messages.some(message => message.role === 'user' && /编译检查|编译器原始输出/.test(String(message.content || '')))
    const userIndex = messages.map(m => m.role).lastIndexOf('user')
    const hasToolAfterUser = userIndex >= 0 && messages.slice(userIndex + 1).some(m => m.role === 'tool')

    if (writeOnly && !hasToolAfterUser) {
      return toolTurn(res, { path: SCRIPT_REL, oldText: CODE_ANCHOR, newText: CODE_ANCHOR + '\n  // 撤销接口测试改动', dryRun: false }, '改一下。')
    }
    if (!repairAsked && !hasToolAfterUser) {
      // 第一轮：写入会破坏编译的片段（语法错误，且位于真代码里）
      return toolTurn(res, { path: SCRIPT_REL, oldText: CODE_ANCHOR, newText: CODE_ANCHOR + '\nconst __dj_broken = = 1', dryRun: false }, '先改这段代码。')
    }
    if (repairAsked && modelMode === 'always-broken') {
      // 故意一直修不好，用来验证"超过上限必须如实报 compile-failed"
      return toolTurn(res, { path: SCRIPT_REL, oldText: CODE_ANCHOR, newText: CODE_ANCHOR + '\nconst __dj_broken2 = = 2', dryRun: false }, '再试一次。')
    }
    if (repairAsked) {
      if (modelMode === 'repair' && !repairedOnce) {
        // 按报错改对：把破坏编译的那行删掉
        repairedOnce = true
        return toolTurn(res, { path: SCRIPT_REL, oldText: CODE_ANCHOR + '\nconst __dj_broken = = 1', newText: CODE_ANCHOR, dryRun: false }, '按报错把那行删掉。')
      }
      return sse(res, [{ choices: [{ delta: { content: '已按编译器报错改好，并确认编译通过。' } }] }])
    }
    return sse(res, [{ choices: [{ delta: { content: '收到。' } }] }])
  })
})

/* ============================== 宿主 ============================== */
function startHost(extraEnv = {}) {
  return spawn(process.execPath, [path.join(ROOT, 'ai-host.js')], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      YAMI_AI_PORT: String(AI_PORT),
      YAMI_AI_TOKEN: TOKEN,
      YAMI_AI_CONFIG_DIR: CONFIG_DIR,
      YAMI_AI_SESSION_DIR: path.join(CONFIG_DIR, 'sessions'),
      YAMI_PROJECT_ROOT: PROJECT,
      YAMI_TSC_JS: ENGINE_TSC,
      ...extraEnv
    }
  })
}

let host = null
let hostStderr = ''

function json(route, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method,
      headers: Object.assign({ 'x-yami-agent-token': TOKEN }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function stream(route, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: AI_PORT, path: route, method: 'POST',
      headers: { 'x-yami-agent-token': TOKEN, 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, res => {
      const events = []
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk
        let index
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const line = block.split('\n').find(one => one.startsWith('data:'))
          if (!line) continue
          try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 忽略 */ }
        }
      })
      res.on('end', () => resolve(events))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await json('/status'); if (r.ok) return } catch { /* 等等 */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('AI host 启动超时\n' + hostStderr)
}

let PROJECT = ''

async function main() {
  if (!fs.existsSync(path.join(FIXTURE, 'game.yamirpg'))) {
    console.error('找不到夹具工程: ' + FIXTURE)
    process.exit(2)
  }
  PROJECT = copyFixture()
  const scriptAbs = path.join(PROJECT, SCRIPT_REL)
  const original = fs.readFileSync(scriptAbs, 'utf8')

  await new Promise(resolve => model.listen(MODEL_PORT, '127.0.0.1', resolve))
  host = startHost()
  host.stderr.on('data', data => { hostStderr += data.toString() })
  await waitReady()

  // 修复循环要连续写盘，因此主流程用自动模式；审批门禁在下面单独一段验证
  await json('/config', 'POST', { endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake', apiKey: 'k', approvalMode: 'auto' })
  await json('/project', 'POST', { projectRoot: PROJECT })

  console.log('\n########## 1. 编译失败 → 报错喂回模型 → 自动重修 ##########')
  const events = await stream('/chat/stream', { sessionId: 'repair-1', message: '帮我改一下这个脚本' })
  const firstResult = events.find(event => event.type === 'result')
  const stoppedForApproval = firstResult && firstResult.status === 'approval'
  check('自动模式下文件写依然先预览等确认（设计如此）', stoppedForApproval === true, firstResult && firstResult.status)
  // 用户点「执行修改」——这才是真正写盘并触发编译门禁的时刻
  const approved = await json('/approve', 'POST', { sessionId: 'repair-1' })
  const result = approved
  check('批准后才真正写盘并进入编译闭环', approved.status === 'done' || approved.status === 'compile-failed', approved.status)
  // 本场景里那次写入最终编译失败被回滚 → 净变更为 0，所以不该伪造出小结
  check('收尾如实统计净变更（回滚后为 0）', approved.changedFiles === 0 || (approved.changelog && approved.changelog.summary.fileCount > 0), 'changedFiles=' + approved.changedFiles)
  check('模型收到报错并改对后收工', !!result && result.status === 'done', result && result.status)
  check('批准后的返回里带编译结论', !!approved.compile || /编译|回滚|改好/.test(String(approved.message || '')), String(approved.message || '').slice(0, 40))

  const repairRequest = modelRequests.find(messages => messages.some(m => m.role === 'user' && /编译器原始输出/.test(String(m.content || ''))))
  check('宿主确实把修复指令发回给了模型', !!repairRequest)
  const repairText = repairRequest ? String(repairRequest.find(m => m.role === 'user' && /编译器原始输出/.test(String(m.content))).content) : ''
  check('修复指令里带编译器原始报错', /error TS\d+/.test(repairText), (repairText.match(/error TS\d+[^\n]*/) || [''])[0])
  check('修复指令要求最小片段替换', /edit_script/.test(repairText) && /不要整份重写/.test(repairText))
  check('修复指令说明工程已回滚', /已自动回滚/.test(repairText))
  check('报错定位到真代码行（文件:行号）', new RegExp(SCRIPT_REL.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(\\d+,\\d+\\)').test(repairText))
  check('工程已回滚到修改前（未留半成品）', fs.readFileSync(scriptAbs, 'utf8') === original)


  console.log('\n########## 3. 撤销接口（宿主 /backups 与 /backup-undo） ##########')
  // 先做一次真写入，制造可回退版本
  writeOnly = true
  modelRequests.length = 0
  const writeEvents = await stream('/chat/stream', { sessionId: 'undo-1', message: '改一下这个脚本' })
  const writeResult = writeEvents.find(event => event.type === 'result')
  check('写入流程完成', !!writeResult)

  const backups = await json('/backups', 'POST', { sessionId: 'undo-1' })
  check('/backups 只列本对话改过的文件', backups.ok === true && Array.isArray(backups.files) && backups.files.some(f => f.path === SCRIPT_REL), JSON.stringify((backups.files || []).map(f => f.path)).slice(0, 90))
  const fileEntry = (backups.files || []).find(f => f.path === SCRIPT_REL)
  check('列出可回退版本数与最早时间', !!fileEntry && fileEntry.backupCount >= 1 && !!fileEntry.oldest, fileEntry ? ('count=' + fileEntry.backupCount) : 'n/a')

  writeOnly = false
  const undone = await json('/backup-undo', 'POST', { path: SCRIPT_REL })
  check('/backup-undo 回退成功', undone.ok === true && !!undone.diff, String(undone.error || '').slice(0, 40))
  check('回退后内容回到最初', fs.readFileSync(scriptAbs, 'utf8') === original)
  check('回退返回差异统计', !!undone.diffStat && typeof undone.diffStat.added === 'number', JSON.stringify(undone.diffStat || {}))

  console.log('\n########## 4. 修不好时必须如实报 compile-failed ##########')
  modelMode = 'always-broken'
  repairedOnce = false
  modelRequests.length = 0
  const stuckEvents = await stream('/chat/stream', { sessionId: 'repair-2', message: '再来一次' })
  let stuckResult = stuckEvents.find(event => event.type === 'result')
  // 每次重修都会重新弹审批，这里模拟用户"一直点执行"直到宿主不再重试为止
  let approvals = 0
  while (stuckResult && stuckResult.status === 'approval' && approvals < 6) {
    approvals++
    stuckResult = await json('/approve', 'POST', { sessionId: 'repair-2' })
  }
  check('超过修复上限后返回 compile-failed', !!stuckResult && stuckResult.status === 'compile-failed', stuckResult && stuckResult.status)
  check('失败文案里带最后一次报错', !!stuckResult && /error TS\d+/.test(String(stuckResult.message || '')))
  check('失败文案说明工程保持完好', !!stuckResult && /回滚/.test(String(stuckResult.message || '')))
  check('未超过修复上限就停止（未无限重试）', modelRequests.length <= Number(process.env.YAMI_AI_REPAIR_LIMIT || 2) + 2, '模型请求数=' + modelRequests.length)
  check('工程仍未留下半成品', fs.readFileSync(scriptAbs, 'utf8') === original)


  console.log('\n########## 6. 审批门禁：edit_script 必须走确认（不能绕过写盘审批） ##########')
  await json('/config', 'POST', { endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake', apiKey: 'k', approvalMode: 'confirm' })
  writeOnly = true
  modelRequests.length = 0
  const beforeGate = fs.readFileSync(scriptAbs, 'utf8')
  const gateEvents = await stream('/chat/stream', { sessionId: 'gate-1', message: '改一下' })
  const gateResult = gateEvents.find(event => event.type === 'result')
  check('edit_script 在确认模式下停在审批', !!gateResult && gateResult.status === 'approval', gateResult && gateResult.status)
  check('审批卡片带真实差异', !!gateResult && !!gateResult.approval && !!gateResult.approval.preview && /@@/.test(gateResult.approval.preview.diff || ''))
  check('审批前工程未被改动', fs.readFileSync(scriptAbs, 'utf8') === beforeGate)
  const rejected = await json('/reject', 'POST', { sessionId: 'gate-1' })
  check('取消后工程仍未改动', fs.readFileSync(scriptAbs, 'utf8') === beforeGate, String(rejected.error || '').slice(0, 40))
  writeOnly = false
  await json('/config', 'POST', { endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake', apiKey: 'k', approvalMode: 'auto' })


  console.log('\n########## 5. 会话内批量授权 ##########')
  await json('/config', 'POST', { endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake', apiKey: 'k', approvalMode: 'confirm' })
  writeOnly = true
  modelRequests.length = 0

  // 第一次：正常停在审批，勾选"本次任务内不再逐条确认"后批准
  const grantFirst = await stream('/chat/stream', { sessionId: 'grant-1', message: '改一下' })
  const grantFirstResult = grantFirst.find(event => event.type === 'result')
  check('首次仍需确认', !!grantFirstResult && grantFirstResult.status === 'approval', grantFirstResult && grantFirstResult.status)
  const grantApprove = await json('/approve', 'POST', { sessionId: 'grant-1', grantForSession: true })
  check('勾选授权后本次写入执行', grantApprove.ok === true || grantApprove.status === 'done', String(grantApprove.status || grantApprove.error))

  const grants = await json('/grants', 'POST', { sessionId: 'grant-1' })
  check('/grants 列出授权', grants.ok === true && (grants.grants || []).length === 1, JSON.stringify(grants.grants || []))
  check('授权项带工具中文名与文件', (grants.grants || [])[0] && grants.grants[0].toolLabel === '精确改脚本' && !!grants.grants[0].path, JSON.stringify((grants.grants || [])[0] || {}).slice(0, 80))

  // 第二次：同一文件同一工具应免确认（不再停在 approval）
  const after = fs.readFileSync(scriptAbs, 'utf8')
  const grantSecond = await stream('/chat/stream', { sessionId: 'grant-1', message: '再改一次' })
  const grantSecondResult = grantSecond.find(event => event.type === 'result')
  check('已授权文件不再逐条打断', !!grantSecondResult && grantSecondResult.status !== 'approval', grantSecondResult && grantSecondResult.status)
  check('免打扰时工程确实被改了', fs.readFileSync(scriptAbs, 'utf8') !== after)
  check('推送了"已授权"过程提示', grantSecond.some(event => event.type === 'notice' && /已授权/.test(String(event.text || ''))))

  // 撤销授权后应恢复逐条确认
  const revoke = await json('/grants', 'POST', { sessionId: 'grant-1', revoke: (grants.grants || [])[0] && grants.grants[0].key })
  check('撤销授权成功', revoke.ok === true && (revoke.grants || []).length === 0, String(revoke.message || '').slice(0, 30))
  const grantThird = await stream('/chat/stream', { sessionId: 'grant-1', message: '第三次改' })
  const grantThirdResult = grantThird.find(event => event.type === 'result')
  check('撤销后重新逐条确认', !!grantThirdResult && grantThirdResult.status === 'approval', grantThirdResult && grantThirdResult.status)
  await json('/reject', 'POST', { sessionId: 'grant-1' })

  // 删除类操作不提供批量授权
  const deleteGrant = await json('/grants', 'POST', { sessionId: 'grant-1' })
  check('授权列表不含删除类', (deleteGrant.grants || []).every(item => item.tool !== 'delete_resource'))

  writeOnly = false
  await json('/config', 'POST', { endpoint: `http://127.0.0.1:${MODEL_PORT}/chat/completions`, model: 'fake', apiKey: 'k', approvalMode: 'auto' })

  console.log(`\n########## 编译自动修复测试: ${passed} PASS / ${failed} FAIL ##########`)
  host.kill()
  model.close()
  fs.rmSync(PROJECT, { recursive: true, force: true })
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  if (hostStderr) console.error('host stderr:\n' + hostStderr.slice(-2000))
  if (host) host.kill()
  process.exit(1)
})
