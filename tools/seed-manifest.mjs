#!/usr/bin/env node
/**
 * Open Yami 工程清单（Data/manifest.json）种子生成器
 *
 * 背景：Data/manifest.json 是「纯派生缓存」——记录 Assets 下每个资源的路径与体积，
 * GUID 从文件名解析（形如 `名字.16位十六进制.ext`），它被引擎工程 .gitignore 排除，
 * 因此重新 clone 的工程里没有它，编辑器会报「Failed to read file: Data/manifest.json」。
 *
 * 本工具按引擎 FileMeta 的可序列化字段生成一份**结构等价**的种子清单：
 *   - 每个条目：{ path, size }
 *   - 场景 scene / 图块 tileset：额外带 { x, y }（引擎 FileMeta 构造时即写入的初始值）
 *   - 脚本 script：额外带 { parameters: [] }（引擎恒带该字段）
 * 真正的元数据（大小、mtime、依赖关系、场景相机位置等）由编辑器打开工程时按磁盘重新扫描补全，
 * 并在下一次保存时写回，因此种子清单只需保证结构完整、条目齐全。
 *
 * 用法：
 *   node tools/seed-manifest.mjs "<工程目录>"            # 预览（dry-run，不写盘）
 *   node tools/seed-manifest.mjs "<工程目录>" --write    # 写盘（自动备份已存在文件）
 */
import fs from 'node:fs'
import path from 'node:path'

/** 与引擎 FolderItem.extnameToTypeMap 对齐的资源类型表 */
const TYPE_BY_EXT = {
  '.actor': 'actors', '.skill': 'skills', '.trigger': 'triggers', '.item': 'items',
  '.equip': 'equipments', '.state': 'states', '.event': 'events', '.scene': 'scenes',
  '.tile': 'tilesets', '.ui': 'ui', '.anim': 'animations', '.particle': 'particles',
  '.png': 'images', '.jpg': 'images', '.jpeg': 'images', '.cur': 'images', '.webp': 'images',
  '.mp3': 'audio', '.m4a': 'audio', '.ogg': 'audio', '.wav': 'audio', '.flac': 'audio',
  '.mp4': 'videos', '.mkv': 'videos', '.webm': 'videos',
  '.js': 'script', '.ts': 'script',
  '.ttf': 'fonts', '.otf': 'fonts', '.woff': 'fonts', '.woff2': 'fonts'
}

/** 引擎 Manifest 类的字段顺序（保持与编辑器写出的文件一致，便于 diff） */
const KEY_ORDER = [
  'actors', 'skills', 'triggers', 'items', 'equipments', 'states', 'events', 'scenes',
  'tilesets', 'ui', 'animations', 'particles', 'images', 'audio', 'videos', 'fonts',
  'script', 'others'
]

/** 扫描时不进入的目录（备份目录、版本库、引擎编译产物） */
const SKIP_DIRS = new Set(['.git', '.yami-mcp-backups', 'Dist', 'node_modules', '.preview'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

function build(projectRoot) {
  const assetsDir = path.join(projectRoot, 'Assets')
  if (!fs.existsSync(assetsDir)) throw new Error('不是有效的工程目录（缺少 Assets）: ' + projectRoot)

  const buckets = Object.fromEntries(KEY_ORDER.map(key => [key, []]))
  const files = walk(assetsDir)

  for (const full of files) {
    const rel = path.relative(projectRoot, full).split(path.sep).join('/')
    const ext = path.extname(full).toLowerCase()
    const key = TYPE_BY_EXT[ext] || 'others'
    const entry = { path: rel, size: fs.statSync(full).size }
    if (key === 'scenes' || key === 'tilesets') {
      // 引擎 FileMeta：场景初始 (10,10)，图块初始 (0,0)，随后被工程实际值覆盖
      entry.x = key === 'scenes' ? 10 : 0
      entry.y = key === 'scenes' ? 10 : 0
    }
    if (key === 'script') entry.parameters = []
    buckets[key].push(entry)
  }

  for (const key of KEY_ORDER) {
    buckets[key].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }
  return { manifest: buckets, scanned: files.length }
}

const target = process.argv[2]
const write = process.argv.includes('--write')
if (!target) {
  console.error('用法: node tools/seed-manifest.mjs "<工程目录>" [--write]')
  process.exit(2)
}

const projectRoot = path.resolve(target)
const { manifest, scanned } = build(projectRoot)
const targetPath = path.join(projectRoot, 'Data', 'manifest.json')

const counts = KEY_ORDER.map(key => `${key}=${manifest[key].length}`).join(' ')
console.log('工程:', projectRoot)
console.log('扫描资源文件:', scanned)
console.log('分类统计:', counts)

const json = JSON.stringify(manifest, null, 2) + '\n'
console.log('清单体积:', Math.round(json.length / 1024) + ' KB')

if (!write) {
  console.log('\n[dry-run] 未写盘。加 --write 才会写入 ' + targetPath)
  process.exit(0)
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true })
if (fs.existsSync(targetPath)) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const backupDir = path.join(projectRoot, '.yami-mcp-backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, `manifest.json.${stamp}.bak`)
  fs.copyFileSync(targetPath, backupPath)
  console.log('已备份原清单:', backupPath)
}
fs.writeFileSync(targetPath, json, 'utf8')
console.log('已写入:', targetPath)
