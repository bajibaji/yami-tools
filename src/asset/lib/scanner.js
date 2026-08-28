// 工业级轻量流式扫描器：专为 10万+ 超大规模文件库设计
// 特点：纯流式遍历、分批提交 (Chunk Commit)、0 内存堆积、极速不卡死
export const IMG_EXTS = ['png', 'gif', 'jpg', 'jpeg', 'webp']
export const META_EXTS = ['json', 'txt', 'ase', 'aseprite', 'html', 'htm']

export function extOf (name) {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

export function stripExt (name) {
  const i = name.lastIndexOf('.')
  return i === -1 ? name : name.slice(0, i)
}

export function supportsDirectoryPicker () {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

const DB_NAME = 'yami-asset-manager'
const DB_STORE = 'root'

function openDb () {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveRootHandle (handle) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(handle, 'root')
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadRootHandle () {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly')
      const req = tx.objectStore(DB_STORE).get('root')
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    return null
  }
}

export async function clearRootHandle () {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete('root')
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

function isImageName (name) { return IMG_EXTS.includes(extOf(name)) }
function isMetaName (name) { return META_EXTS.includes(extOf(name)) }

// 工业级流式扫描：支持 10万+ 文件的平稳迭代，分块回调，极速响应
export async function streamScanRootHandle (root, { onBatch, onProgress, shouldAbort, chunkSize = 2000 } = {}) {
  let scanned = 0
  let chunk = []
  const abort = () => shouldAbort && shouldAbort()

  async function walkDir (dir, rel) {
    if (abort()) return
    for await (const [name, h] of dir.entries()) {
      if (abort()) return
      if (name.startsWith('.') || name === 'node_modules') continue
      const full = rel ? `${rel}/${name}` : name

      if (h.kind === 'directory') {
        await walkDir(h, full)
      } else {
        scanned++
        const ext = extOf(name)
        const isImg = IMG_EXTS.includes(ext)
        const isMeta = META_EXTS.includes(ext)

        if (isImg || isMeta) {
          chunk.push({
            name,
            rel: full,
            dir: rel || '',
            ext,
            size: h.size ?? 0,
            isImg,
            isMeta,
            pack: full.includes('/') ? full.split('/')[0] : '(根目录)'
          })

          if (chunk.length >= chunkSize) {
            if (onBatch) await onBatch(chunk, scanned)
            chunk = []
          }
        }

        if (scanned % 500 === 0 && onProgress) {
          onProgress(scanned, full)
        }
      }
    }
  }

  await walkDir(root, '')

  if (chunk.length > 0 && !abort()) {
    if (onBatch) await onBatch(chunk, scanned)
  }

  if (onProgress) onProgress(scanned, '扫描完成')
  return { scanned, aborted: abort() }
}

// 降级 fallback 处理
export function scanFallbackFiles (fileList, onProgress) {
  const items = []
  const files = Array.from(fileList)
  files.forEach((file, i) => {
    let rel = file.webkitRelativePath || file.name
    if (rel.includes('/')) rel = rel.split('/').slice(1).join('/')
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    const name = file.name
    const ext = extOf(name)
    const isImg = isImageName(name)
    const isMeta = isMetaName(name)
    if (isImg || isMeta) {
      items.push({
        name,
        rel,
        dir,
        ext,
        size: file.size,
        file,
        isImg,
        isMeta,
        pack: rel.includes('/') ? rel.split('/')[0] : '(根目录)'
      })
    }
    if (onProgress && (i + 1) % 1000 === 0) onProgress(i + 1)
  })
  if (onProgress) onProgress(files.length)
  return items
}

// 目录句柄多级高速缓存池，防止频繁递归遍历目录
const dirHandleCache = new Map()

export async function fileForRel (rootHandle, rel) {
  const parts = rel.split('/')
  const fileName = parts.pop()
  const dirPath = parts.join('/')

  let dir = rootHandle
  if (dirPath) {
    if (dirHandleCache.has(dirPath)) {
      dir = dirHandleCache.get(dirPath)
    } else {
      let cur = rootHandle
      let accum = ''
      for (const seg of parts) {
        accum = accum ? `${accum}/${seg}` : seg
        if (dirHandleCache.has(accum)) {
          cur = dirHandleCache.get(accum)
        } else {
          cur = await cur.getDirectoryHandle(seg)
          dirHandleCache.set(accum, cur)
        }
      }
      dir = cur
    }
  }

  const fh = await dir.getFileHandle(fileName)
  return fh.getFile()
}

export function cachedEntry (meta, rootHandle) {
  return {
    name: meta.name,
    rel: meta.rel,
    dir: meta.dir,
    ext: meta.ext,
    size: meta.size,
    getFile: async () => fileForRel(rootHandle, meta.rel)
  }
}

export async function entryBlob (entry) {
  if (!entry) throw new Error('条目为空')
  if (typeof entry.getFile === 'function') return entry.getFile()
  if (entry.file instanceof Blob) return entry.file
  if (entry.handle && typeof entry.handle.getFile === 'function') return entry.handle.getFile()
  throw new Error(`无法读取文件：${entry.rel}`)
}