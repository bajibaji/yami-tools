// 缩略图极速生成器：并发3 + 内存LRU(300) + IndexedDB批量写（合并事务，减少频闪）
// spec 支持两种：{x,y,w,h} 单格裁剪；{mode:'grid2nd'} 多行网格 → 取每行第2帧排成方块
import { entryBlob } from './scanner.js'
import { dbGet, dbBulkPut, openDb } from './idb-store.js'

const SIZE = 64
const memCache = new Map()
const queue = []
let running = 0
const MAX_CONCURRENT = 3

const pendingWrites = new Map()
let flushTimer = null
function queueStoreWrite (key, blob) {
  pendingWrites.set(key, blob)
  if (flushTimer) return
  flushTimer = setTimeout(async () => {
    flushTimer = null
    if (!pendingWrites.size) return
    const pairs = [...pendingWrites.entries()]
    pendingWrites.clear()
    try { await dbBulkPut('thumb', pairs) } catch (e) { /* ignore */ }
  }, 300)
}

function setMemCache (key, url) {
  if (memCache.size >= 300) {
    const firstKey = memCache.keys().next().value
    const oldUrl = memCache.get(firstKey)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    memCache.delete(firstKey)
  }
  memCache.set(key, url)
}

function specKey (spec) {
  if (!spec) return ''
  if (spec.mode) return spec.mode
  return spec.x + ',' + spec.y + ',' + spec.w + ',' + spec.h
}

export function thumbKey (entry, spec) {
  return (entry.rel || entry.name) + '|' + (entry.size || 0) + '|' + SIZE + '|' + specKey(spec)
}

export function getMemCachedThumb (entry, spec) {
  if (!entry) return null
  return memCache.get(thumbKey(entry, spec)) || null
}

export async function prewarmThumbCache (entries, spec = null) {
  if (!entries || !entries.length) return
  const keys = entries.map(e => thumbKey(e, spec)).filter(k => !memCache.has(k))
  if (!keys.length) return
  try {
    const db = await openDb()
    const tx = db.transaction('thumb', 'readonly')
    const store = tx.objectStore('thumb')
    await Promise.all(keys.map(k => new Promise(resolve => {
      const req = store.get(k)
      req.onsuccess = () => {
        if (req.result && !memCache.has(k)) setMemCache(k, URL.createObjectURL(req.result))
        resolve()
      }
      req.onerror = () => resolve()
    })))
  } catch (e) { /* ignore */ }
}

// 画缩略图：grid2nd = 多行网格取每行第2帧排成方块（适合 BDragon strip / 多行 sheet / SoggySocks 横条）
function drawThumb (ctx, bmp, spec) {
  ctx.imageSmoothingEnabled = false
  if (spec && spec.mode === 'grid2nd') {
    if (bmp.width % 64 === 0 && bmp.height % 64 === 0) {
      const cols = Math.round(bmp.width / 64)
      const rows = Math.round(bmp.height / 64)
      if (cols >= 2 && rows >= 2) {
        const cellW = bmp.width / cols
        const cellH = bmp.height / rows
        const grid = Math.ceil(Math.sqrt(rows))
        const cell = Math.floor(SIZE / grid)
        for (let r = 0; r < rows; r++) {
          const gx = (r % grid) * cell
          const gy = Math.floor(r / grid) * cell
          const scale = Math.min(cell / cellW, cell / cellH)
          const dw = Math.max(1, Math.round(cellW * scale))
          const dh = Math.max(1, Math.round(cellH * scale))
          ctx.drawImage(bmp, cellW, r * cellH, cellW, cellH, gx + (cell - dw) / 2, gy + (cell - dh) / 2, dw, dh)
        }
        return
      }
    }
    // 单行横向连帧（如 SoggySocks 的 sheet：宽是高的数倍）：取中间关键帧清晰展示
    if (bmp.width > 1.5 * bmp.height) {
      const cellW = bmp.height
      const cellH = bmp.height
      const cols = Math.max(1, Math.round(bmp.width / cellW))
      const targetCol = cols >= 3 ? Math.floor(cols / 3) : 0
      const sx = Math.min(bmp.width - cellW, targetCol * cellW)
      ctx.drawImage(bmp, sx, 0, cellW, cellH, 0, 0, SIZE, SIZE)
      return
    }
  }
  if (spec && spec.x !== undefined) {
    const scale = Math.min(SIZE / spec.w, SIZE / spec.h)
    const w = Math.max(1, Math.round(spec.w * scale))
    const h = Math.max(1, Math.round(spec.h * scale))
    ctx.drawImage(bmp, spec.x, spec.y, spec.w, spec.h, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
    return
  }
  const scale = Math.min(SIZE / bmp.width, SIZE / bmp.height)
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  ctx.drawImage(bmp, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
}

async function processQueue () {
  if (running >= MAX_CONCURRENT || queue.length === 0) return
  const item = queue.shift()
  running++
  try {
    const file = await entryBlob(item.entry)
    if (file.size > 25 * 1024 * 1024) { item.resolve(null); return }
    const bmp = await createImageBitmap(file)
    const cv = document.createElement('canvas')
    cv.width = SIZE
    cv.height = SIZE
    const ctx = cv.getContext('2d')
    drawThumb(ctx, bmp, item.spec)
    bmp.close && bmp.close()
    const blob = await new Promise(res => cv.toBlob(res, 'image/webp', 0.8))
    if (blob) {
      const url = URL.createObjectURL(blob)
      setMemCache(item.key, url)
      queueStoreWrite(item.key, blob)
      item.resolve(url)
    } else {
      item.resolve(null)
    }
  } catch (e) {
    item.resolve(null)
  } finally {
    running--
    setTimeout(processQueue, 0)
  }
}

export async function getThumbUrl (entry, spec) {
  if (!entry) return null
  const key = thumbKey(entry, spec)
  if (memCache.has(key)) return memCache.get(key)
  try {
    const cached = await dbGet('thumb', key)
    if (cached) {
      const url = URL.createObjectURL(cached)
      setMemCache(key, url)
      return url
    }
  } catch (e) { /* ignore */ }
  return new Promise((resolve, reject) => {
    queue.push({ entry, key, spec, resolve, reject })
    processQueue()
  })
}
