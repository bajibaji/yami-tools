'use strict'

/**
 * 变更小结（change log）
 *
 * 目标：AI 改完东西后，能一句话说清「这次到底动了什么」——
 * 哪些文件被改/新建/删除、每次写入是否通过编译、试玩冒烟结论如何、怎么一键退回。
 * 这是把前面几轮的差异预览、备份撤销、编译门禁、试玩冒烟串成对用户可见的收尾。
 *
 * 本模块只做纯逻辑与轻量快照，不依赖 MCP：
 *  - snapshotProject / diffSnapshot：用哈希对比得出"真的变了哪些文件"（比只统计写入调用更可信：
 *    写了又改回去、写失败回滚，都不会被算成变更）；
 *  - buildChangelog：把写入记录、编译结论、试玩结论合并成一张小结。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const TEXT_EXTENSIONS = new Set([
  '.json', '.ts', '.js', '.event', '.scene', '.ui', '.actor', '.skill', '.item',
  '.equip', '.state', '.trigger', '.tile', '.anim', '.particle', '.txt', '.md', '.yaml', '.yml'
])
const SKIP_DIRS = new Set(['.git', '.yami-mcp-backups', 'node_modules', 'Dist', '.preview', 'Save'])
const MAX_FILE_BYTES = 1_500_000

function shouldTrack(relPath, size) {
  if (size > MAX_FILE_BYTES) return false
  const ext = path.extname(relPath).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

function hash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * 给工程里的文本资源拍一张"路径 → 内容哈希"的快照。
 * 只记哈希不记内容，几十兆的工程也只占几百 KB 内存。
 */
function snapshotProject(root, limit = 20000) {
  const snapshot = new Map()
  const walk = dir => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (snapshot.size >= limit) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = path.relative(root, full).split(path.sep).join('/')
      let stat
      try { stat = fs.statSync(full) } catch { continue }
      if (!shouldTrack(rel, stat.size)) continue
      try {
        const text = fs.readFileSync(full, 'utf8')
        if (text.includes('\u0000')) continue          // 二进制伪装成文本后缀的情况
        snapshot.set(rel, hash(text))
      } catch { /* 读不到就跳过，不让快照失败拖垮主流程 */ }
    }
  }
  walk(root)
  return snapshot
}

/**
 * 对比快照，得出真实变更。
 * @param {Map<string,string>} before
 * @param {Map<string,string>} after
 * @returns {{modified:string[], created:string[], deleted:string[]}}
 */
function diffSnapshot(before, after) {
  const modified = []
  const created = []
  const deleted = []
  const beforeMap = before instanceof Map ? before : new Map(Object.entries(before || {}))
  const afterMap = after instanceof Map ? after : new Map(Object.entries(after || {}))
  for (const [file, digest] of afterMap) {
    if (!beforeMap.has(file)) created.push(file)
    else if (beforeMap.get(file) !== digest) modified.push(file)
  }
  for (const file of beforeMap.keys()) {
    if (!afterMap.has(file)) deleted.push(file)
  }
  return { modified: modified.sort(), created: created.sort(), deleted: deleted.sort() }
}

const TOOL_LABELS = {
  write_resource: '写入资源', write_script: '整份替换脚本', edit_script: '精确改脚本',
  patch_resource: '改资源字段', create_script: '新建脚本', delete_resource: '删除资源',
  append_event_commands: '编排事件', upsert_database_item: '更新数据表', restore_backup: '回退版本'
}

/**
 * 合并三路信息生成变更小结。
 * @param {{snapshotDiff?:object, writes?:Array, playtest?:object|null, backups?:Array}} input
 *   writes: [{ path, tool, ok, compileOk, errorCount, firstError }]
 */
function buildChangelog(input = {}) {
  const diff = input.snapshotDiff || { modified: [], created: [], deleted: [] }
  const writings = (input.writes || []).filter(item => item && item.path)
  const writeByPath = new Map()
  for (const write of writings) writeByPath.set(write.path, write)

  const files = []
  const push = (filePath, kind) => {
    const write = writeByPath.get(filePath)
    files.push({
      path: filePath,
      kind,
      tool: write ? write.tool : '',
      toolLabel: write ? (TOOL_LABELS[write.tool] || write.tool) : '',
      compileOk: write ? write.compileOk : undefined,
      errorCount: write ? (write.errorCount || 0) : 0,
      firstError: write ? (write.firstError || '') : '',
      rolledBack: write ? write.rolledBack === true : false
    })
  }
  for (const file of diff.created) push(file, 'created')
  for (const file of diff.modified) push(file, 'modified')
  for (const file of diff.deleted) push(file, 'deleted')

  const compileChecked = files.filter(item => item.compileOk !== undefined)
  const compileFailed = compileChecked.filter(item => item.compileOk === false)
  const rolledBack = files.filter(item => item.rolledBack)

  const playtest = input.playtest || null
  const summary = {
    fileCount: files.length,
    created: diff.created.length,
    modified: diff.modified.length,
    deleted: diff.deleted.length,
    compileChecked: compileChecked.length,
    compileFailed: compileFailed.length,
    rolledBack: rolledBack.length,
    playtestVerdict: playtest ? playtest.verdict : null
  }

  return {
    files,
    summary,
    playtest: playtest
      ? { verdict: playtest.verdict, message: playtest.message, steps: playtest.steps, problems: playtest.problems }
      : null,
    headline: describeChangelog(summary),
    nextSteps: suggestNextSteps(summary, files)
  }
}

/** 一句话结论（AI 直接引用给用户） */
function describeChangelog(summary) {
  if (!summary.fileCount) {
    if (summary.compileChecked && summary.compileFailed) return `这次没有留下文件改动（${summary.compileFailed} 次写入因编译不过被自动回滚，工程保持原样）。`
    return '这次没有改动工程里的文件。'
  }
  const parts = []
  if (summary.created) parts.push(`新建 ${summary.created} 个`)
  if (summary.modified) parts.push(`修改 ${summary.modified} 个`)
  if (summary.deleted) parts.push(`删除 ${summary.deleted} 个`)
  let text = `本次共改动 ${summary.fileCount} 个文件（${parts.join('、')}）`
  if (summary.compileChecked) {
    text += summary.compileFailed
      ? `；编译检查 ${summary.compileChecked} 次，其中 ${summary.compileFailed} 次未通过`
      : `；编译检查 ${summary.compileChecked} 次全部通过`
  }
  if (summary.playtestVerdict === 'ok') text += '；试玩冒烟没有发现问题'
  else if (summary.playtestVerdict === 'warn') text += '；试玩冒烟有告警，建议看一眼'
  else if (summary.playtestVerdict === 'bad') text += '；试玩冒烟发现了问题'
  return text + '。'
}

function suggestNextSteps(summary, files) {
  const steps = []
  if (summary.compileFailed) steps.push('有写入没过编译已被自动回滚，先看编译报错再改一次')
  if (summary.playtestVerdict === 'bad') steps.push('按冒烟结果里的文件名+行号定位问题，改完再跑一次同样的脚本')
  if (!summary.compileChecked && summary.fileCount) steps.push('改了脚本建议跑一次 compile_check 确认编译')
  if (summary.fileCount && !summary.playtestVerdict) steps.push('想确认"真的还能玩"，可启动试玩后跑一次试玩冒烟')
  if (summary.fileCount) steps.push('对结果不满意可以点工具栏【撤销】退回改动前')
  if (!steps.length) steps.push(files.length ? '改动已完成' : '无需后续动作')
  return steps
}

module.exports = { snapshotProject, diffSnapshot, buildChangelog, describeChangelog, shouldTrack, hash, TOOL_LABELS }
