'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error('缺少文件路径')
  }
  const rel = relPath.replace(/\\/g, '/')
  if (rel.includes('\0') || path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel)) {
    throw new Error('文件路径必须是工程根目录内的相对路径')
  }
  const rootAbs = path.resolve(root)
  const abs = path.resolve(rootAbs, rel)
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep
  if (abs !== rootAbs && !abs.startsWith(prefix)) {
    throw new Error('文件路径越过工程根目录，已拒绝')
  }
  return abs
}

function relativePath(root, relPath) {
  const abs = resolveInside(root, relPath)
  return path.relative(path.resolve(root), abs).replace(/\\/g, '/')
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function backupPath(root, absPath) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
  const digest = sha256(absPath).slice(0, 10)
  return path.join(root, '.yami-mcp-backups', `${stamp}-${digest}-${path.basename(absPath)}.bak`)
}

/**
 * 备份旁挂元数据（同名 .json）。
 * 有了它，"这个备份是谁改的、改的哪个文件、什么时候"才可查——撤销能力依赖这份记录。
 * 没有它就只能靠文件名猜，用户永远看不到"能回退到哪一步"。
 */
function backupMetaPath(backupFile) {
  return backupFile.replace(/\.bak$/, '.json')
}

function writeBackupMeta(root, backupFile, meta) {
  try {
    fs.writeFileSync(backupMetaPath(backupFile), JSON.stringify({
      path: meta.path,
      tool: meta.tool || '',
      savedAt: meta.savedAt || new Date().toISOString(),
      sha256: meta.sha256 || '',
      bytes: meta.bytes || 0,
      kind: meta.kind || 'update'
    }, null, 2), 'utf8')
  } catch {
    /* 元数据写失败不影响备份本身 */
  }
}

function readBackupMeta(backupFile) {
  try {
    return JSON.parse(fs.readFileSync(backupMetaPath(backupFile), 'utf8'))
  } catch {
    return null
  }
}

function writeAtomic(root, relPath, text, options = {}) {
  const absPath = resolveInside(root, relPath)
  const content = String(text)
  fs.mkdirSync(path.dirname(absPath), { recursive: true })

  let backup = null
  let backupRelative = null
  if (fs.existsSync(absPath)) {
    const before = fs.readFileSync(absPath, 'utf8')
    backup = backupPath(root, absPath)
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.copyFileSync(absPath, backup)
    writeBackupMeta(root, backup, {
      path: relativePath(root, relPath),
      tool: options.tool || '',
      sha256: sha256(before),
      bytes: Buffer.byteLength(before),
      kind: options.kind || 'update'
    })
    backupRelative = path.relative(root, backup).split(path.sep).join('/')
  }

  const tmpPath = `${absPath}.yami-tmp-${process.pid}-${Date.now()}`
  const oldPath = `${absPath}.yami-old-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(tmpPath, content, 'utf8')
    if (fs.existsSync(absPath)) fs.renameSync(absPath, oldPath)
    fs.renameSync(tmpPath, absPath)
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
    return { path: relativePath(root, relPath), bytes: Buffer.byteLength(content), backup: backupRelative, sha256: sha256(content) }
  } catch (error) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch {}
    try {
      if (fs.existsSync(oldPath) && !fs.existsSync(absPath)) fs.renameSync(oldPath, absPath)
    } catch {}
    throw error
  }
}

function restoreBackup(root, relPath, backup) {
  const target = resolveInside(root, relPath)
  // backup 可能是相对工程根的路径（writeAtomic 现在的返回口径），也可能是绝对路径，两种都要能还原。
  // 历史坑：writeAtomic 改成返回相对路径后这里仍按绝对路径处理，path.relative 会算出 ../../…，
  // 于是"编译失败自动回滚"静默失败（报"路径越过工程根目录"）。
  const raw = String(backup || '').replace(/\\/g, '/')
  const source = path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)
    ? path.resolve(raw)
    : resolveInside(root, raw)
  if (!fs.existsSync(source)) throw new Error('备份文件不存在')
  fs.copyFileSync(source, target)
  return { path: relativePath(root, relPath), restoredFrom: path.relative(path.resolve(root), source).split(path.sep).join('/') }
}

const BACKUP_DIR = '.yami-mcp-backups'

/** 列出备份（按时间倒序）。meta 缺失的老备份也能列出来，靠文件名解析时间与归属。 */
function listBackups(root, filterPath = '') {
  const dir = path.join(root, BACKUP_DIR)
  if (!fs.existsSync(dir)) return []
  const entries = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.bak')) continue
    const full = path.join(dir, name)
    let stat
    try { stat = fs.statSync(full) } catch { continue }
    if (!stat.isFile()) continue
    const meta = readBackupMeta(full)
    const parsed = name.match(/^(\d{17})-([0-9a-f]{10})-(.+?)\.bak$/)
    const stamp = parsed ? parsed[1] : ''
    const savedAt = meta && meta.savedAt
      ? meta.savedAt
      : (stamp
          ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}.${stamp.slice(14, 17)}Z`
          : stat.mtime.toISOString())
    const relPath = (meta && meta.path) || (parsed ? parsed[3] : name.replace(/\.bak$/, ''))
    if (filterPath && relPath !== filterPath) continue
    entries.push({
      backup: `${BACKUP_DIR}/${name}`,
      path: relPath,
      savedAt,
      mtimeMs: stat.mtimeMs,
      tool: (meta && meta.tool) || '',
      bytes: (meta && meta.bytes) || stat.size,
      kind: (meta && meta.kind) || 'update',
      hasMeta: !!meta
    })
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

module.exports = {
  resolveInside, relativePath, sha256, writeAtomic, restoreBackup,
  listBackups, readBackupMeta, writeBackupMeta, backupPath, BACKUP_DIR
}
