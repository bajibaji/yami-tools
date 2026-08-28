// 素材库本地清单（.yami-manifest.json）：用于清除浏览器数据/换电脑后秒建索引，
// 之后用增量扫描同步新增/变更/删除，无需全量遍历重建。
export const MANIFEST_NAME = '.yami-manifest.json'

// 把本次扫描的全部文件记录写入库根目录（浏览器 File System Access 直写）
export async function writeManifest (rootHandle, records, packs) {
  if (!rootHandle) return false
  try {
    const fh = await rootHandle.getFileHandle(MANIFEST_NAME, { create: true })
    const writable = await fh.createWritable()
    const payload = JSON.stringify({
      v: 1,
      generatedAt: Date.now(),
      packs,
      files: records.map(r => ({
        rel: r.rel, name: r.name, dir: r.dir, ext: r.ext,
        size: r.size, isImg: !!r.isImg, isMeta: !!r.isMeta,
        pack: r.pack || (r.rel && r.rel.includes('/') ? r.rel.split('/')[0] : '(根目录)')
      }))
    })
    await writable.write(payload)
    await writable.close()
    return true
  } catch (e) {
    return false
  }
}

export async function readManifest (rootHandle) {
  if (!rootHandle) return null
  try {
    const fh = await rootHandle.getFileHandle(MANIFEST_NAME)
    const file = await fh.getFile()
    if (file.size > 4 * 1024 * 1024 && file.size < 200 * 1024 * 1024) {
      const data = JSON.parse(await file.text())
      if (data && data.v === 1 && Array.isArray(data.files)) return data
    }
    return null
  } catch (e) {
    return null
  }
}
