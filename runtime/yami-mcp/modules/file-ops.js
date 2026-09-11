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

function writeAtomic(root, relPath, text, options = {}) {
  const absPath = resolveInside(root, relPath)
  const content = String(text)
  fs.mkdirSync(path.dirname(absPath), { recursive: true })

  let backup = null
  if (fs.existsSync(absPath)) {
    backup = backupPath(root, absPath)
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.copyFileSync(absPath, backup)
  }

  const tmpPath = `${absPath}.yami-tmp-${process.pid}-${Date.now()}`
  const oldPath = `${absPath}.yami-old-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(tmpPath, content, 'utf8')
    if (fs.existsSync(absPath)) fs.renameSync(absPath, oldPath)
    fs.renameSync(tmpPath, absPath)
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
    return { path: relativePath(root, relPath), bytes: Buffer.byteLength(content), backup, sha256: sha256(content) }
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
  const source = resolveInside(root, path.relative(root, backup))
  if (!fs.existsSync(source)) throw new Error('备份文件不存在')
  fs.copyFileSync(source, target)
  return { path: relativePath(root, relPath), restoredFrom: source }
}

module.exports = { resolveInside, relativePath, sha256, writeAtomic, restoreBackup }
