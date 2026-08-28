// 缩略图极速生成器：严格限制并发数（最大 2 个任务），防止瞬间并发解码大图造成 OOM 网页崩溃
import { entryBlob } from './scanner.js'
import { dbGet, dbPut } from './idb-store.js'

const SIZE = 64
const memCache = new Map() // key -> objectURL
const queue = [] // [{ entry, key, resolve, reject }]
let running = 0
const MAX_CONCURRENT = 2 // 最大并发解码数，保护浏览器内存与显存

// 内存中最多保留 150 个缩略图 URL，防止内存泄漏
function setMemCache (key, url) {
  if (memCache.size > 150) {
    const firstKey = memCache.keys().next().value
    const oldUrl = memCache.get(firstKey)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    memCache.delete(firstKey)
  }
  memCache.set(key, url)
}

export function thumbKey (entry) {
  return (entry.rel || entry.name) + '|' + (entry.size || 0) + '|' + SIZE
}

export function getMemCachedThumb (entry) {
  if (!entry) return null
  const key = thumbKey(entry)
  return memCache.get(key) || null
}

async function processQueue () {
  if (running >= MAX_CONCURRENT || queue.length === 0) return
  const item = queue.shift()
  running++

  try {
    const file = await entryBlob(item.entry)
    // 超过 25MB 的超大文件跳过生成缩略图，避免解码爆显存
    if (file.size > 25 * 1024 * 1024) {
      item.resolve(null)
      return
    }

    // 优先使用 createImageBitmap 进行高效缩放
    const bmp = await createImageBitmap(file)
    const cv = document.createElement('canvas')
    cv.width = SIZE
    cv.height = SIZE
    const ctx = cv.getContext('2d')
    const scale = Math.min(SIZE / bmp.width, SIZE / bmp.height)
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bmp, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
    bmp.close && bmp.close()

    const blob = await new Promise(res => cv.toBlob(res, 'image/webp', 0.8))
    if (blob) {
      const url = URL.createObjectURL(blob)
      setMemCache(item.key, url)
      dbPut('thumb', item.key, blob).catch(() => {})
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

// 请求缩略图：内存有直接秒回；DB 有秒回；没有则进入排队队列
export async function getThumbUrl (entry) {
  if (!entry) return null
  const key = thumbKey(entry)
  if (memCache.has(key)) return memCache.get(key)

  try {
    const cached = await dbGet('thumb', key)
    if (cached) {
      const url = URL.createObjectURL(cached)
      setMemCache(key, url)
      return url
    }
  } catch (e) {
    // ignore
  }

  return new Promise((resolve, reject) => {
    queue.push({ entry, key, resolve, reject })
    processQueue()
  })
}
