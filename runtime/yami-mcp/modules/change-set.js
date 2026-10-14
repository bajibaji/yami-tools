'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { resolveInside, relativePath, sha256, writeAtomic, matchTextStyle } = require('./file-ops')
const { unifiedDiff } = require('./diff')

const MUTATIONS = new Set(['create_script', 'write_script', 'edit_script', 'patch_resource', 'write_resource', 'append_event_commands', 'upsert_database_item', 'delete_resource', 'restore_backup'])
const TTL = 10 * 60 * 1000

function checkedPath(root, rel) {
  const clean = relativePath(root, rel)
  if (!/^(Assets|Data|Script)\//.test(clean) || clean === 'Data/manifest.json' || /^Dist\//i.test(clean)) throw new Error('禁止修改此路径：' + clean)
  let current = path.resolve(root)
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error('拒绝通过链接工程修改文件')
  for (const part of clean.split('/')) {
    current = path.join(current, part)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('拒绝通过链接修改工程：' + clean)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return clean
}

function read(root, rel) {
  const abs = resolveInside(root, rel)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
}

function hash(text) { return text === null ? null : sha256(text) }

function saveJournal(full, journal) {
  const tmp = full + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(journal), 'utf8')
  const fd = fs.openSync(tmp, 'r+')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, full)
}

class ChangeSets {
  constructor(root) {
    this.root = root
    this.pending = new Map()
    this.active = false
    this.journalDir = path.join(root, '.yami-mcp-backups', 'transactions')
  }

  async prepare(operations, previewTool) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 50) return { ok: false, error: '变更集需包含 1 到 50 项操作' }
    const files = new Map()
    const previews = []
    try {
      for (const op of operations) {
        if (!op || !MUTATIONS.has(op.name) || !op.args || typeof op.args !== 'object' || Array.isArray(op.args)) throw new Error('变更集包含不支持的操作')
        const args = Object.fromEntries(Object.entries(op.args).filter(([key]) => !key.startsWith('__')))
        const rel = checkedPath(this.root, args.path || (op.name === 'upsert_database_item' ? 'Data/' + String(args.table || '').replace(/\.json$/i, '').toLowerCase() + '.json' : ''))
        const before = files.has(rel) ? files.get(rel).after : read(this.root, rel)
        if (args.expectedSha256 && args.expectedSha256 !== hash(before)) throw new Error('文件已变化，请重新读取：' + rel)
        const related = Object.fromEntries([...files].map(([key, file]) => [key, file.after]))
        const result = await previewTool(op.name, { ...args, dryRun: true, __prepare: true, __beforeText: before, __related: related, __generatedId: op.generatedId })
        if (!result || result.ok !== true || !Array.isArray(result.__writes)) throw new Error(result && (result.error || result.message) || '工具没有生成可执行预览：' + op.name)
        const { __writes, ...publicPreview } = result
        previews.push({ name: op.name, args, generatedId: !args.id && publicPreview.id ? publicPreview.id : undefined, preview: publicPreview })
        for (const write of __writes) {
          const target = checkedPath(this.root, write.path)
          const original = files.has(target) ? files.get(target).before : read(this.root, target)
          const prior = files.has(target) ? files.get(target).after : original
          const after = write.content === null ? null : matchTextStyle(prior, String(write.content))
          files.set(target, { path: target, before: original, after, tool: op.name })
        }
      }
      const changed = [...files.values()].filter(file => file.before !== file.after)
      // ponytail: 预览暂存内存，上限 32 MB；更大工程改动应改为磁盘 staging。
      if (changed.reduce((sum, file) => sum + Buffer.byteLength(file.before || '') + Buffer.byteLength(file.after || ''), 0) > 32 * 1024 * 1024) throw new Error('变更集超过 32 MB，请拆分任务')
      const id = crypto.randomBytes(16).toString('hex')
      const token = crypto.randomBytes(24).toString('hex')
      const at = Date.now()
      for (const [key, entry] of this.pending) if (at - entry.at > TTL) this.pending.delete(key)
      const entry = { id, token, at, files: changed, previews }
      this.pending.set(id, entry)
      const publicFiles = changed.map(file => {
        const diff = unifiedDiff(file.before || '', file.after || '', { label: file.path })
        return { path: file.path, tool: file.tool, kind: file.after === null ? 'deleted' : file.before === null ? 'created' : 'modified', oldSha256: hash(file.before), newSha256: hash(file.after), diff: diff.text, diffStat: { added: diff.added, removed: diff.removed, truncated: diff.truncated } }
      })
      return { ok: true, dryRun: true, changeSetId: id, confirmationToken: token, expiresAt: at + TTL, files: publicFiles, operations: previews.map(item => ({ name: item.name, args: item.args, ...(item.generatedId ? { generatedId: item.generatedId } : {}) })), previews: previews.map(item => ({ name: item.name, preview: item.preview })), risk: publicFiles.some(file => file.kind === 'deleted') ? 'high' : 'medium' }
    } catch (error) { return { ok: false, error: error.message } }
  }

  async commit(id, token, hooks = {}) {
    if (this.active) return { ok: false, error: '另一组变更正在提交，请等待' }
    const entry = this.pending.get(id)
    if (!entry || entry.token !== token || Date.now() - entry.at > TTL) return { ok: false, confirmRequired: true, error: '变更集确认已失效，请重新预览' }
    this.pending.delete(id)
    this.active = true
    let journal = null
    let journalPath = ''
    try {
      for (const file of entry.files) {
        checkedPath(this.root, file.path)
        if (hash(read(this.root, file.path)) !== hash(file.before)) throw new Error('文件已被其他操作修改，请重新预览：' + file.path)
        if (hooks.preflight) {
          const check = await hooks.preflight(file.path)
          if (!check || check.ok !== true) throw new Error(check && check.error || '编辑器预检失败')
        }
      }
      if (hooks.cancelled && hooks.cancelled()) throw new Error('操作已打断，未写入')
      const baseline = hooks.baseline ? await hooks.baseline() : null
      let dir = path.resolve(this.root)
      for (const segment of ['.yami-mcp-backups', 'transactions']) {
        dir = path.join(dir, segment)
        try { if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('事务备份目录不能是链接') }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      fs.mkdirSync(this.journalDir, { recursive: true })
      journalPath = path.join(this.journalDir, id + '.json')
      journal = { id, status: 'committing', files: entry.files.map(file => ({ ...file, applied: false })) }
      saveJournal(journalPath, journal)
      for (const file of journal.files) {
        if (hooks.cancelled && hooks.cancelled()) throw new Error('操作已打断')
        if (hash(read(this.root, file.path)) !== hash(file.before)) throw new Error('提交前文件已变化：' + file.path)
        if (file.after === null) {
          const saved = writeAtomic(this.root, file.path, file.before, { tool: 'delete_resource' })
          file.backup = saved.backup
          fs.unlinkSync(resolveInside(this.root, file.path))
        } else {
          const written = writeAtomic(this.root, file.path, file.after, { tool: file.tool })
          file.backup = written.backup
        }
        file.applied = true
        saveJournal(journalPath, journal)
      }
      const validation = hooks.validate ? await hooks.validate(journal.files, baseline) : { ok: true }
      if (!validation || validation.ok !== true) {
        const rollback = this.rollback(journal, journalPath)
        return { ok: false, changeSetId: id, validation, compile: validation && validation.compile, rollback, error: validation && validation.error || '校验失败，已回滚变更集' }
      }
      if (hooks.cancelled && hooks.cancelled()) throw new Error('操作已打断')
      for (const file of journal.files) if (hash(read(this.root, file.path)) !== hash(file.after)) throw new Error('验证期间检测到外部文件变化：' + file.path)
      journal.status = 'committed'
      saveJournal(journalPath, journal)
      const reload = []
      if (hooks.reload) for (const file of journal.files) reload.push(await hooks.reload(file.path))
      return { ok: true, dryRun: false, changeSetId: id, files: journal.files.map(file => ({ path: file.path, tool: file.tool, backup: file.backup, sha256: hash(file.after) })), validation, compile: validation.compile, editorReload: reload, message: '已提交变更集，' + journal.files.length + ' 个文件' }
    } catch (error) {
      const rollback = journal ? this.rollback(journal, journalPath) : { ok: true, files: [] }
      return { ok: false, changeSetId: id, rollback, error: error.message }
    } finally { this.active = false }
  }

  rollback(journal, journalPath) {
    const errors = []
    const restored = []
    for (const file of [...journal.files].reverse()) {
      try {
        checkedPath(this.root, file.path)
        const current = read(this.root, file.path)
        if (hash(current) === hash(file.before)) continue
        if (hash(current) !== hash(file.after)) throw new Error('检测到外部修改，保留当前文件与恢复日志：' + file.path)
        if (file.before === null) fs.unlinkSync(resolveInside(this.root, file.path))
        else writeAtomic(this.root, file.path, file.before, { tool: 'change_set_rollback' })
        restored.push(file.path)
      } catch (error) { errors.push(error.message) }
    }
    journal.status = errors.length ? 'recovery-required' : 'rolled-back'
    saveJournal(journalPath, journal)
    return { ok: !errors.length, files: restored, errors, journal: journalPath }
  }

  recover() {
    const results = []
    if (!fs.existsSync(this.journalDir)) return results
    if (fs.lstatSync(path.dirname(this.journalDir)).isSymbolicLink() || fs.lstatSync(this.journalDir).isSymbolicLink()) return [{ ok: false, error: '事务备份目录是链接，拒绝恢复' }]
    for (const name of fs.readdirSync(this.journalDir)) {
      if (!name.endsWith('.json')) continue
      const full = path.join(this.journalDir, name)
      try {
        if (fs.lstatSync(full).isSymbolicLink()) throw new Error('事务日志不能是链接')
        const journal = JSON.parse(fs.readFileSync(full, 'utf8'))
        if (journal.status === 'committing' || journal.status === 'recovery-required') results.push(this.rollback(journal, full))
      } catch (error) { results.push({ ok: false, error: error.message, journal: full }) }
    }
    return results
  }
}

module.exports = { ChangeSets, MUTATIONS, checkedPath }
