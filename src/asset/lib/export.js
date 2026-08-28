// 导出工具：下载 / 写入目录 / 复制路径 / 命名模板 / GIF 编码(gifenc)
import { entryBlob } from './scanner.js'
import gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc

export const DEFAULT_TEMPLATE = '{anim}_{frame}.png'

export function sanitize (name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_')
}

export function expandTemplate (template, vars) {
  return template
    .replace(/{(anim|pack|dir|frame|size)}/g, (m, k) => (vars[k] ?? ''))
    .replace(/{}/g, '')
}

export function pad (n, width = 4) {
  return String(n).padStart(width, '0')
}

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

// 动画 → 导出条目（name + blob 提供器），命名模板默认 {anim}_{frame}.png
export async function buildExportItems (anim, frameData, template = DEFAULT_TEMPLATE) {
  const items = []
  if (!anim) return items
  const vars = { pack: anim.pack || '', dir: anim.dir || '', anim: sanitize(anim.name), size: '' }

  if (anim.type === 'gif') {
    const blob = await entryBlob(anim.entry)
    items.push({ name: anim.entry.name, blob })
    return items
  }

  if (anim.type === 'single') {
    const blob = await entryBlob(anim.entry)
    items.push({ name: expandTemplate(template, { ...vars, frame: pad(1) }), blob })
    return items
  }

  if (anim.type === 'sequence') {
    for (let i = 0; i < anim.files.length; i++) {
      const f = anim.files[i]
      const blob = await entryBlob(f)
      items.push({ name: expandTemplate(template, { ...vars, frame: pad(i + 1) }), blob })
    }
    return items
  }

  if (anim.type === 'sheet' && frameData) {
    const { image, frames } = frameData
    const original = await entryBlob(anim.entry)
    items.push({ name: anim.entry.name, blob: original })
    for (let i = 0; i < frames.length; i++) {
      const rf = frames[i]
      items.push({
        name: expandTemplate(template, { ...vars, frame: pad(i + 1) }),
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

// 绘制一帧到 canvas 并取 RGBA
function frameRgba (frameData, i) {
  const cv = document.createElement('canvas')
  if (frameData.kind === 'sheet') {
    const rf = frameData.frames[i]
    cv.width = rf.w
    cv.height = rf.h
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(frameData.image, rf.x, rf.y, rf.w, rf.h, 0, 0, rf.w, rf.h)
  } else {
    const bmp = frameData.frames[i]
    cv.width = bmp.width
    cv.height = bmp.height
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bmp, 0, 0)
  }
  return cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height)
}

// 浏览器端 GIF 编码（gifenc，256 色调色板），进度回调
export async function exportAnimToGif (frameData, name, fps = 15, onProgress) {
  if (!frameData || !frameData.frames || frameData.frames.length < 2) return null
  const gif = GIFEncoder()
  const count = frameData.frames.length
  for (let i = 0; i < count; i++) {
    const { data, width, height } = frameRgba(frameData, i)
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, width, height, { palette, delay: Math.max(1, Math.round(1000 / (fps || 15))) })
    onProgress && onProgress(Math.round(((i + 1) / count) * 100))
    await new Promise(r => setTimeout(r, 0))
  }
  gif.finish()
  return new Blob([gif.bytes()], { type: 'image/gif' })
}