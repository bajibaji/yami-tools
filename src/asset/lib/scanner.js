// 素材库扫描：优先 File System Access API（授权一次、句柄存 IndexedDB），
// 不支持时降级为 <input webkitdirectory> 上传式读取（无写回能力）。
export const IMG_EXTS = ['png', 'gif', 'jpg', 'jpeg', 'webp']
export const META_EXTS = ['json', 'txt']

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

// 目录句柄全量扫描；onProgress(scannedCount) 用于进度条
export async function scanRootHandle (root, onProgress) {
  const images = []
  const metas = []
  let scanned = 0
  const tick = () => {
    scanned++
    if (onProgress && scanned % 512 === 0) onProgress(scanned)
  }
  async function walk (dir, rel) {
    for await (const [name, handle] of dir.entries()) {
      const full = rel ? rel + '/' + name : name
      if (handle.kind === 'directory') {
        if (name.startsWith('.')) continue
        await walk(handle, full)
      } else {
        tick()
        if (isImageName(name)) images.push({ name, rel: full, dir: rel || '', ext: extOf(name), size: handle.size ?? 0, handle })
        else if (isMetaName(name)) metas.push({ name, rel: full, dir: rel || '', ext: extOf(name), handle })
      }
    }
  }
  await walk(root, '')
  if (onProgress) onProgress(scanned)
  return { images, metas }
}

// fallback：webkitdirectory 文件列表（webkitRelativePath 去掉根目录名）
export function scanFallbackFiles (fileList, onProgress) {
  const images = []
  const metas = []
  const files = Array.from(fileList)
  files.forEach((file, i) => {
    let rel = file.webkitRelativePath || file.name
    if (rel.includes('/')) rel = rel.split('/').slice(1).join('/')
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    const name = file.name
    const entry = { name, rel, dir, ext: extOf(name), size: file.size, file }
    if (isImageName(name)) images.push(entry)
    else if (isMetaName(name)) metas.push(entry)
    if (onProgress && (i + 1) % 512 === 0) onProgress(i + 1)
  })
  if (onProgress) onProgress(files.length)
  return { images, metas }
}

export async function entryBlob (entry) {
  if (entry.file instanceof Blob) return entry.file
  if (entry.handle) return entry.handle.getFile()
  throw new Error('无法读取文件：' + entry.rel)
}
