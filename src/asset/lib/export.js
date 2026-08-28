// 导出工具：下载 / 写入目录 / 复制路径
import { entryBlob } from './scanner.js'

export function downloadBlob (blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function writeToDirectory (dirHandle, name, blob) {
  const fh = await dirHandle.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(blob)
  await w.close()
}

export async function downloadFrames (items, { gap = 180 } = {}) {
  for (const it of items) {
    const blob = typeof it.blob === 'function' ? await it.blob() : it.blob
    downloadBlob(blob, it.name)
    await new Promise(r => setTimeout(r, gap))
  }
}

export async function exportFramesToFolder (dirHandle, items) {
  for (const it of items) {
    const blob = typeof it.blob === 'function' ? await it.blob() : it.blob
    await writeToDirectory(dirHandle, it.name, blob)
  }
}

export async function copyText (text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    return false
  }
}

// 动画 → 导出条目（name + blob 提供器）
export async function buildExportItems (anim, frameData) {
  const items = []
  if (!anim) return items
  if (anim.type === 'gif' || anim.type === 'single') {
    const blob = await entryBlob(anim.entry)
    items.push({ name: anim.entry.name, blob })
    return items
  }
  if (anim.type === 'sequence') {
    for (const f of anim.files) {
      const blob = await entryBlob(f)
      items.push({ name: f.name, blob })
    }
    return items
  }
  if (anim.type === 'sheet' && frameData) {
    const { image, frames } = frameData
    const base = anim.name.replace(/[\\/:*?"<>|]/g, '_')
    const original = await entryBlob(anim.entry)
    items.push({ name: anim.entry.name, blob: original })
    for (let i = 0; i < frames.length; i++) {
      const rf = frames[i]
      items.push({
        name: base + '_' + String(i + 1).padStart(3, '0') + '.png',
        blob: async () => {
          const cv = document.createElement('canvas')
          cv.width = rf.w
          cv.height = rf.h
          const ctx = cv.getContext('2d')
          ctx.drawImage(image, rf.x, rf.y, rf.w, rf.h, 0, 0, rf.w, rf.h)
          return new Promise(res => cv.toBlob(res, 'image/png'))
        }
      })
    }
  }
  return items
}
