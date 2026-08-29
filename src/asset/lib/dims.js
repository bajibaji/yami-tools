// 只读文件头解析图片尺寸（PNG / GIF / WebP），不整文件解码，供尺寸筛选索引使用
import { entryBlob } from './scanner.js'

export async function readImageDims (entry) {
  try {
    const blob = await entryBlob(entry)
    const head = await blob.slice(0, 64).arrayBuffer()
    return parseImageDimsFromHeader(head)
  } catch (e) {
    return null
  }
}

export function parseImageDimsFromHeader (buf) {
  if (!buf || buf.byteLength < 24) return null
  const dv = new DataView(buf)
  const b = new Uint8Array(buf)
  const ok = (w, h) => (w > 0 && h > 0 && w <= 32768 && h <= 32768) ? { w, h } : null

  // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR，宽高在 16/20 处（大端）
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    return ok(dv.getUint32(16), dv.getUint32(20))
  }

  // GIF: 宽高在 6/8 处（小端 16 位）
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return ok(dv.getUint16(6, true), dv.getUint16(8, true))
  }

  // WebP: RIFF....WEBP + VP8 /VP8X
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (fourcc === 'VP8 ') return ok((dv.getUint16(26, true) & 0x3fff), (dv.getUint16(28, true) & 0x3fff))
    if (fourcc === 'VP8X') return ok((dv.getUint32(24, true) & 0xffffff) + 1, (dv.getUint32(27, true) & 0xffffff) + 1)
  }

  // JPEG: 从标记段里找 SOF0/SOF2 取尺寸（仅解析前 64 字节，超长头放弃）
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue }
      const marker = b[i + 1]
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue }
      if (marker === 0xC0 || marker === 0xC2) return ok(dv.getUint16(i + 7), dv.getUint16(i + 5))
      const len = dv.getUint16(i + 2)
      if (len < 2) break
      i += 2 + len
    }
  }

  return null
}