'use strict'

/**
 * 轻量文本差异（零依赖）
 * 用途：写盘前的审批预览要让人**看见具体改了什么**，而不是只看字节数与哈希。
 * 输出统一 diff 风格：@@ 定位块 + 上下文行，前缀 ' ' 保留 / '-' 删除 / '+' 新增。
 */

const DEFAULT_CONTEXT = 3
const MAX_LINES = 400          // 单次预览最多输出多少行（超出截断并说明）
const MAX_CELLS = 4_000_000    // LCS 规模上限，超了退化为整段替换（避免大文件卡死）

function splitLines(text) {
  const normalized = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n')
  if (normalized === '') return []
  const lines = normalized.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 最长公共子序列 → 编辑脚本（-1 删除 / 0 保留 / 1 新增） */
function diffOps(before, after) {
  const n = before.length
  const m = after.length
  if (n * m > MAX_CELLS) {
    return { ops: [...before.map(() => -1), ...after.map(() => 1)], coarse: true }
  }
  // 滚动数组求 LCS 长度，再回溯出编辑脚本
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) { ops.push(0); i++; j++ }
    else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) { ops.push(-1); i++ }
    else { ops.push(1); j++ }
  }
  while (i < n) { ops.push(-1); i++ }
  while (j < m) { ops.push(1); j++ }
  return { ops, coarse: false }
}

/**
 * 生成统一 diff 文本
 * @param {string} before 修改前内容
 * @param {string} after 修改后内容
 * @param {{context?:number, maxLines?:number, label?:string}} [options]
 * @returns {{text:string, added:number, removed:number, truncated:boolean, coarse:boolean}}
 */
function unifiedDiff(before, after, options = {}) {
  const context = Math.max(0, Number(options.context ?? DEFAULT_CONTEXT))
  const maxLines = Math.max(10, Number(options.maxLines ?? MAX_LINES))
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)
  const { ops, coarse } = diffOps(beforeLines, afterLines)

  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op === 1) added++
    else if (op === -1) removed++
  }

  // 把编辑脚本展开成带行号的行序列，再按上下文裁剪出若干 hunk
  const rows = []
  let oldNo = 1
  let newNo = 1
  for (const op of ops) {
    if (op === 0) rows.push({ kind: ' ', text: beforeLines[oldNo - 1], oldNo, newNo }), oldNo++, newNo++
    else if (op === -1) rows.push({ kind: '-', text: beforeLines[oldNo - 1], oldNo }), oldNo++
    else rows.push({ kind: '+', text: afterLines[newNo - 1], newNo }), newNo++
  }

  const changed = rows.map((row, index) => (row.kind === ' ' ? -1 : index)).filter(index => index >= 0)
  const hunks = []
  if (changed.length) {
    let start = Math.max(0, changed[0] - context)
    let end = Math.min(rows.length - 1, changed[0] + context)
    for (let index = 1; index < changed.length; index++) {
      const nextStart = Math.max(0, changed[index] - context)
      if (nextStart <= end + 1) end = Math.min(rows.length - 1, changed[index] + context)
      else { hunks.push([start, end]); start = nextStart; end = Math.min(rows.length - 1, changed[index] + context) }
    }
    hunks.push([start, end])
  }

  const out = []
  let truncated = false
  for (const [start, end] of hunks) {
    if (out.length >= maxLines) { truncated = true; break }
    const first = rows[start]
    const last = rows[end]
    out.push(`@@ 原第 ${first.oldNo ?? first.newNo} 行起 / 共 ${end - start + 1} 行上下文 @@`)
    for (let index = start; index <= end; index++) {
      if (out.length >= maxLines) { truncated = true; break }
      const row = rows[index]
      out.push(row.kind + row.text)
    }
  }

  const header = options.label ? `${options.label}\n` : ''
  const body = out.length ? header + out.join('\n') : header + '（内容没有变化）'
  const tail = truncated ? `\n… 差异过长已截断（共 +${added} / -${removed} 行）` : ''
  return { text: body + tail, added, removed, truncated, coarse }
}

module.exports = { unifiedDiff, splitLines }
