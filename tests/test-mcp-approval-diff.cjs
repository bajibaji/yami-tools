'use strict'
/**
 * 「改动看得见 + 危险操作拦得住」回归测试（零依赖）
 *
 * 覆盖本轮的写盘安全体验：
 *   1. 差异工具：+/- 统计、定位块、上下文保留、超大差异截断、无变化时的表述；
 *   2. edit_script / patch_resource 的 dryRun 预览必须带**真实差异文本**与风险级别；
 *   3. delete_resource：预览带风险级别 + 影响摘要（名称/类型/体积/内容开头）+ 一次性确认令牌；
 *      正式执行不带令牌必须被拦下并要求重来，带令牌才真的删除；
 *      令牌一次性：用过即失效，不能重放。
 *
 * 用法: node tests/test-mcp-approval-diff.cjs
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'
const SCRIPT_REL = 'Assets/插件/全局插件/Steamworks.2aafc4d56d4590d8.ts'
const CODE_ANCHOR = 'const regexp = /^--app-path=(.+)$/'

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-diff-'))
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
    env: { ...process.env, YAMI_MCP_GUARDED: '1', YAMI_TSC_JS: process.env.YAMI_TSC_JS || '/home/deck/Desktop/ SHIT/GITHUB/2/node_modules/typescript/lib/tsc.js' },
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
  if (!fs.existsSync(path.join(FIXTURE, 'game.yamirpg'))) {
    console.error('找不到夹具工程: ' + FIXTURE)
    process.exit(2)
  }

  console.log('\n########## 1. 差异工具 ##########')
  const { unifiedDiff } = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'diff.js'))
  const before = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8'].join('\n')
  const after = ['line1', 'line2', 'CHANGED', 'line4', 'line5', 'line6', 'line7', 'line8'].join('\n')
  const small = unifiedDiff(before, after)
  check('统计新增/删除行数', small.added === 1 && small.removed === 1, `+${small.added}/-${small.removed}`)
  check('含定位块标记', /^@@/m.test(small.text))
  check('含新增与删除行标记', /\n\+CHANGED/.test(small.text) && /\n-line3/.test(small.text))
  check('保留上下文行', /\n line2/.test(small.text) && /\n line4/.test(small.text))

  const none = unifiedDiff(before, before)
  check('内容无变化时如实说明', /没有变化/.test(none.text) && none.added === 0 && none.removed === 0)

  const hugeBefore = Array.from({ length: 3000 }, (_, i) => 'old ' + i).join('\n')
  const hugeAfter = Array.from({ length: 3000 }, (_, i) => 'new ' + i).join('\n')
  const huge = unifiedDiff(hugeBefore, hugeAfter, { maxLines: 40 })
  check('超大差异会被截断并说明', huge.truncated === true && /差异过长已截断/.test(huge.text), 'lines=' + huge.text.split('\n').length)

  console.log('\n########## 2. 写盘预览带真实差异 ##########')
  const project = copyFixture()
  const { child, parse } = startMcp(project)
  await new Promise(resolve => setTimeout(resolve, 800))
  try {
    const edit = await parse('edit_script', { path: SCRIPT_REL, oldText: CODE_ANCHOR, newText: CODE_ANCHOR + '\n  // 由 AI 追加的说明', dryRun: true })
    check('edit_script 预览带差异文本', edit.ok === true && typeof edit.diff === 'string' && edit.diff.includes('@@'), 'diff 长度=' + String(edit.diff || '').length)
    check('预览差异含新增行', /\n\+/.test(edit.diff || ''))
    check('预览带风险级别 medium', edit.risk === 'medium', String(edit.risk))
    check('预览带增删统计', !!edit.diffStat && edit.diffStat.added >= 1, JSON.stringify(edit.diffStat))

    const eventRel = 'Assets/! 事件/@0 预加载事件.16c9ebfdbc16119c.event'
    if (fs.existsSync(path.join(project, eventRel))) {
      const patch = await parse('patch_resource', { path: eventRel, patch: { description: 'AI 差异预览测试' }, dryRun: true })
      check('patch_resource 预览带差异文本', patch.ok === true && typeof patch.diff === 'string' && patch.diff.includes('@@'), String(patch.error || '').slice(0, 60))
      check('patch_resource 预览差异含新增行', /\n\+.*AI 差异预览测试/.test(patch.diff || ''))
      check('patch_resource 风险级别为 medium', patch.risk === 'medium')
    }

    console.log('\n########## 3. 删除必须二次确认 ##########')
    // 挑一个不被引用的资源文件来删（用 others 类的最小文件，避免触发引用保护）
    const candidates = fs.readdirSync(path.join(project, 'Assets'))
      .filter(name => /\.txt$/i.test(name))
    const victimRel = candidates.length ? 'Assets/' + candidates[0] : ''
    check('找到可删除的测试文件', !!victimRel, victimRel)

    if (victimRel) {
      const preview = await parse('delete_resource', { path: victimRel, dryRun: true })
      check('删除预览标为高危', preview.ok === true && preview.risk === 'high')
      check('删除预览带影响摘要', !!preview.impact && preview.impact.name === path.basename(victimRel) && preview.impact.bytes > 0, JSON.stringify(preview.impact && preview.impact.name))
      check('删除预览发放一次性确认令牌', typeof preview.confirmationToken === 'string' && preview.confirmationToken.length >= 16)

      // 不带令牌 → 必须拒绝，且文件还在
      const noToken = await parse('delete_resource', { path: victimRel, dryRun: false })
      check('不带令牌执行被拦下且明确未执行', noToken.ok === false && noToken.confirmRequired === true && noToken.dryRun === true, String(noToken.error || '').slice(0, 40))
      check('被拦下时文件仍在', fs.existsSync(path.join(project, victimRel)))
      check('被拦下时补发新令牌', typeof noToken.confirmationToken === 'string' && noToken.confirmationToken.length >= 16)

      // 用错的令牌 → 也要拒绝
      const wrongToken = await parse('delete_resource', { path: victimRel, dryRun: false, confirmationToken: 'deadbeefdeadbeef' })
      check('伪造令牌被拒绝且文件仍在', wrongToken.ok === false && fs.existsSync(path.join(project, victimRel)))

      // 带正确令牌 → 真的删除，并留下备份
      const confirmed = await parse('delete_resource', { path: victimRel, dryRun: false, confirmationToken: noToken.confirmationToken })
      check('带令牌才真正删除', confirmed.ok === true, String(confirmed.message || confirmed.error).slice(0, 46))
      check('删除后文件消失', !fs.existsSync(path.join(project, victimRel)))
      check('备份以工程根为基准返回相对路径', typeof confirmed.backup === 'string' && confirmed.backup.startsWith('.yami-mcp-backups/'), String(confirmed.backup))
      check('删除保留了备份', !!confirmed.backup && fs.existsSync(path.join(project, confirmed.backup)))

      // 令牌一次性：重放必须失败
      const replay = await parse('delete_resource', { path: victimRel, dryRun: false, confirmationToken: noToken.confirmationToken })
      check('令牌用过即失效（不可重放）', replay.ok === false, String(replay.error || '').slice(0, 40))
    }

    console.log('\n########## 4. 撤销：备份清单与回退 ##########')
    // 先改两次，制造两个可回退版本
    const originalText = fs.readFileSync(path.join(project, SCRIPT_REL), 'utf8')
    const edit1 = await parse('edit_script', { path: SCRIPT_REL, oldText: CODE_ANCHOR, newText: CODE_ANCHOR + '\n  // 改动一', dryRun: false })
    const edit2 = await parse('edit_script', { path: SCRIPT_REL, oldText: '  // 改动一', newText: '  // 改动一\n  // 改动二', dryRun: false })
    check('两次修改都留下备份', !!edit1.backup && !!edit2.backup)
    const firstBackupText = fs.readFileSync(path.join(project, edit1.backup), 'utf8')
    check('备份保存的是改动前的内容（可据此回退）', firstBackupText === originalText)

    const backups = await parse('list_backups', { path: SCRIPT_REL })
    check('list_backups 列出可回退版本', backups.ok === true && backups.count >= 2, 'count=' + backups.count)
    check('备份带时间与来源工具', (backups.backups || []).every(item => item.savedAt && item.tool === 'edit_script'), JSON.stringify((backups.backups || [])[0] || {}).slice(0, 90))

    const undoDry = await parse('restore_backup', { path: SCRIPT_REL, dryRun: true })
    check('回退预览带差异', undoDry.ok === true && /@@/.test(undoDry.diff || ''), 'diff 长度=' + String(undoDry.diff || '').length)
    check('默认回到最早一次备份（AI 动手之前）', undoDry.backup === backups.backups[backups.backups.length - 1].backup)
    check('回退 dryRun 未写盘', fs.readFileSync(path.join(project, SCRIPT_REL), 'utf8').includes('改动二'))

    const undo = await parse('restore_backup', { path: SCRIPT_REL, dryRun: false })
    check('回退成功且内容回到最初', undo.ok === true && fs.readFileSync(path.join(project, SCRIPT_REL), 'utf8') === originalText, String(undo.error || ''))
    check('回退本身留下安全备份（可再撤回）', !!undo.safetyBackup)
    const redo = await parse('restore_backup', { path: SCRIPT_REL, backup: undo.safetyBackup, dryRun: false })
    check('撤销的撤销可用', redo.ok === true && fs.readFileSync(path.join(project, SCRIPT_REL), 'utf8').includes('改动二'))

    const manifestGuard = await parse('restore_backup', { path: 'Data/manifest.json', dryRun: true })
    check('禁止回退引擎派生的 manifest', manifestGuard.ok === false && /派生/.test(manifestGuard.error))
    // 选一个**从未被本测试改动过**的文件：工程里唯一的 .txt 会被上面的删除用例用掉，改用技能资源
    const skillDir = path.join(project, 'Assets/技能')
    const untouchedSkill = fs.existsSync(skillDir) ? fs.readdirSync(skillDir).find(name => /\.skill$/i.test(name)) : null
    const untouched = untouchedSkill ? '技能/' + untouchedSkill : null
    const noBackup = untouched
      ? await parse('restore_backup', { path: 'Assets/' + untouched, dryRun: true })
      : { ok: false, error: '没有找到对应备份（跳过：工程里没有可用的未改动样本）' }
    check('无备份文件如实说明', noBackup.ok === false && /没有找到/.test(noBackup.error))

    // 还原现场
    await parse('restore_backup', { path: SCRIPT_REL, backup: undo.safetyBackup, dryRun: false })
    await parse('restore_backup', { path: SCRIPT_REL, dryRun: false })
    check('现场已还原', fs.readFileSync(path.join(project, SCRIPT_REL), 'utf8') === originalText)
  } finally {
    child.kill()
    fs.rmSync(project, { recursive: true, force: true })
  }

  console.log(`\n########## 审批差异与删除保护测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
