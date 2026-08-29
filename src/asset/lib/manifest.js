// 素材库本地清单（.yami-manifest.json）：用于清除浏览器数据/换电脑后秒建索引。
// v2 紧凑格式：files 只存 {rel, size, ext}，其余字段（name/dir/pack/isImg/isMeta）由 rel+ext 推导，体积约为 v1 的 1/5。
import { IMG_EXTS, META_EXTS } from './scanner.js'

export const MANIFEST_NAME = '.yami-manifest.json'
export const MANIFEST_MAX_BYTES = 200 * 1024 * 1024

// 由紧凑记录重建完整文件记录（与扫描器输出结构一致）
export function expandManifestFile (f) {
  if (!f || !f.rel) return null
  const rel = f.rel
  const ext = f.ext || (rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '')
  const name = f.name || rel.split('/').pop() || rel
  const dir = f.dir || (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
  const pack = f.pack || (rel.includes('/') ? rel.split('/')[0] : '(根目录)')
  return {
    rel, name, dir, ext, size: f.size || 0,
    isImg: IMG_EXTS.includes(ext),
    isMeta: META_EXTS.includes(ext),
    pack
  }
}

// 把本次扫描的全部文件记录写入库根目录（浏览器 File System Access 直写；v2 紧凑格式）
export async function writeManifest (rootHandle, records, packs) {
  if (!rootHandle) return false
  try {
    const fh = await rootHandle.getFileHandle(MANIFEST_NAME, { create: true })
    const writable = await fh.createWritable()
    const payload = JSON.stringify({
      v: 2,
      generatedAt: Date.now(),
      packs,
      files: records.map(r => ({ rel: r.rel, size: r.size || 0, ext: r.ext || '' }))
    })
    await writable.write(payload)
    await writable.close()
    return true
  } catch (e) {
    return false
  }
}

// 读取清单：统一返回 { v, generatedAt, packs, files }，files 元素为紧凑记录（v1 自动转换）
export async function readManifest (rootHandle) {
  if (!rootHandle) return null
  try {
    const fh = await rootHandle.getFileHandle(MANIFEST_NAME)
    const file = await fh.getFile()
    if (!file || file.size <= 0 || file.size >= MANIFEST_MAX_BYTES) return null
    const data = JSON.parse(await file.text())
    if (!data || !Array.isArray(data.files)) return null
    const out = { v: 2, generatedAt: data.generatedAt || 0, packs: data.packs || [], files: [] }
    if (data.v === 1) {
      // 旧格式：字段齐全，直接转紧凑存储
      out.files = data.files.map(f => ({ rel: f.rel, size: f.size || 0, ext: f.ext || '' })).filter(f => f.rel)
    } else if (data.v === 2) {
      out.files = data.files.filter(f => f && f.rel)
    } else {
      return null
    }
    return out
  } catch (e) {
    return null
  }
}
