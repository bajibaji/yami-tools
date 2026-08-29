// 素材库清单生成器（Node 侧）：本机秒级遍历素材库生成 .yami-manifest.json（v2 紧凑格式），
// 浏览器打开素材管理器时从清单秒恢复索引，完全绕开浏览器 FSA 遍历 10 万+ 文件的超慢路径。
// 用法: node scripts/build-manifest.mjs [素材库路径]
import fs from 'node:fs'
import path from 'node:path'

const LIB = process.argv[2] || 'D:\\YAHZJ\\技能素材'
const MANIFEST = path.join(LIB, '.yami-manifest.json')
const IMG = new Set(['png', 'gif', 'jpg', 'jpeg', 'webp'])
const META = new Set(['json', 'txt', 'ase', 'aseprite', 'html', 'htm'])

if (!fs.existsSync(LIB)) { console.error('目录不存在:', LIB); process.exit(1) }

const t0 = Date.now()
const files = []
const packSummary = new Map()
function walk (p, rel) {
  let entries
  try { entries = fs.readdirSync(p) } catch (e) { return }
  for (const e of entries) {
    if (e.startsWith('.')) continue
    const fp = path.join(p, e)
    const full = rel ? rel + '/' + e : e
    let s
    try { s = fs.statSync(fp) } catch { continue }
    if (s.isDirectory()) {
      if (e === 'node_modules') continue
      walk(fp, full)
      continue
    }
    const ext = e.includes('.') ? e.slice(e.lastIndexOf('.') + 1).toLowerCase() : ''
    if (!IMG.has(ext) && !META.has(ext)) continue
    const pack = full.includes('/') ? full.split('/')[0] : '(根目录)'
    files.push({ rel: full, size: s.size, ext })
    if (!packSummary.has(pack)) packSummary.set(pack, { name: pack, count: 0, dirs: new Set() })
    const item = packSummary.get(pack)
    item.count++
    if (rel) item.dirs.add(rel)
  }
}
walk(LIB, '')

const packs = Array.from(packSummary.values()).map(p => ({ name: p.name, count: p.count, dirs: Array.from(p.dirs).sort() }))
  .sort((a, b) => (a.name === '(根目录)' ? -1 : a.name.localeCompare(b.name, 'en')))

const payload = JSON.stringify({ v: 2, generatedAt: Date.now(), packs, files })
fs.writeFileSync(MANIFEST, payload)

const mb = (payload.length / 1024 / 1024).toFixed(1)
console.log('完成: ' + files.length.toLocaleString() + ' 条记录 → ' + MANIFEST)
console.log('清单大小: ' + mb + ' MB, 耗时: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
console.log('包列表: ' + packs.map(p => p.name + '(' + p.count.toLocaleString() + ')').join(', '))