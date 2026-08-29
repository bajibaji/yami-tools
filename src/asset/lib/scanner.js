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

import { dbPut, dbGet } from './idb-store.js'

export async function saveRootHandle (handle) {
  try {
    await dbPut('root', 'root', handle)
  } catch (e) {
    console.warn('[Scanner] 保存根目录句柄失败:', e)
  }
}

export async function loadRootHandle () {
  try {
    return await dbGet('root', 'root')
  } catch (e) {
    return null
  }
}

function isImageName (name) { return IMG_EXTS.includes(extOf(name)) }
function isMetaName (name) { return META_EXTS.includes(extOf(name)) }

// 工业级流式扫描：支持 10万+ 文件的平稳迭代，分块回调，极速响应
export async function streamScanRootHandle (root, { onBatch, onProgress, shouldAbort, chunkSize = 1000 } = {}) {
  clearDirHandleCache()
  let scanned = 0
  let chunk = []
  const abort = () => shouldAbort && shouldAbort()

  async function walkDir (dir, rel) {
    if (abort()) return true
    try {
      for await (const [name, h] of dir.entries()) {
        if (abort()) return true
        if (name.startsWith('.') || name === 'node_modules') continue
        const full = rel ? `${rel}/${name}` : name

        if (h.kind === 'directory') {
          const stopped = await walkDir(h, full)
          if (stopped) return true
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
              size: 0,
              isImg,
              isMeta,
              pack: full.includes('/') ? full.split('/')[0] : '(根目录)'
            })

            if (chunk.length >= chunkSize) {
              if (onBatch) await onBatch(chunk, scanned)
              chunk = []
            }
          }

          if (scanned % 300 === 0 && onProgress) {
            onProgress(scanned, full)
          }
        }
      }
    } catch (err) {
      console.warn('[Scanner] 遍历子目录跳过受限项:', rel, err)
    }
    return false
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

// 目录句柄多级高速缓存池（绑定 rootHandle 名称隔离）
const dirHandleCache = new Map()

export function clearDirHandleCache () {
  dirHandleCache.clear()
}

export async function fileForRel (rootHandle, rel) {
  const parts = rel.split('/')
  const fileName = parts.pop()
  const dirPath = parts.join('/')
  const rootKey = rootHandle.name || 'root'

  let dir = rootHandle
  if (dirPath) {
    const cacheKey = `${rootKey}:${dirPath}`
    if (dirHandleCache.has(cacheKey)) {
      dir = dirHandleCache.get(cacheKey)
    } else {
      let cur = rootHandle
      let accum = ''
      for (const seg of parts) {
        accum = accum ? `${accum}/${seg}` : seg
        const segKey = `${rootKey}:${accum}`
        if (dirHandleCache.has(segKey)) {
          cur = dirHandleCache.get(segKey)
        } else {
          cur = await cur.getDirectoryHandle(seg)
          dirHandleCache.set(segKey, cur)
        }
      }
      dir = cur
    }
  }

  const fh = await dir.getFileHandle(fileName)
  return fh.getFile()
}

export function cachedEntry (meta, rootHandle) {
  if (!meta) return null
  if (meta.file instanceof Blob || meta.file instanceof File) {
    return {
      name: meta.name,
      rel: meta.rel,
      dir: meta.dir,
      ext: meta.ext,
      size: meta.size,
      file: meta.file,
      getFile: async () => meta.file
    }
  }
  return {
    name: meta.name,
    rel: meta.rel,
    dir: meta.dir,
    ext: meta.ext,
    size: meta.size,
    rootHandle,
    getFile: async () => {
      if (meta.file instanceof Blob || meta.file instanceof File) return meta.file
      if (rootHandle) return fileForRel(rootHandle, meta.rel)
      throw new Error(`缺少文件访问句柄：${meta.rel}`)
    }
  }
}

export async function entryBlob (entry) {
  if (!entry) throw new Error('条目为空')
  if (entry.file instanceof Blob || entry.file instanceof File) return entry.file
  if (typeof entry.getFile === 'function') return entry.getFile()
  if (entry.handle && typeof entry.handle.getFile === 'function') return entry.handle.getFile()
  if (entry.rootHandle && entry.rel) return fileForRel(entry.rootHandle, entry.rel)
  throw new Error(`无法读取文件：${entry.rel}`)
}