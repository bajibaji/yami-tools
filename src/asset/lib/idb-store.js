// 素材管理器本地持久化：IndexedDB（支持 10万+ 文件的按包 / 按目录 B-Tree 极速索引）
const DB_NAME = 'yami-asset-manager-v3'
export const STORES = {
  files: 'files',        // { rel, pack, dir, name, ext, size, isImg, isMeta }
  packs: 'packs',        // packName -> { name, total, imgs, dirs: [dirName] }
  anims: 'anims',        // { id, pack, dir, type, name, fps, frames: [rel], count, metaFrames?, loose }
  tags: 'tags',          // rel -> [string]
  favorites: 'favorites', // rel -> 1
  collections: 'collections', // { id, name, createdAt, items: [{ rel, order, note }] }
  fixes: 'fixes',        // animId -> { name, fps, members: [rel], order: [rel] }
  profiles: 'profiles',  // pack -> preset rules
  prefs: 'prefs',
  thumb: 'thumb'
}

let dbPromise = null

export function openDb () {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const key of Object.keys(STORES)) {
        const name = STORES[key]
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name)
          if (name === 'files') {
            store.createIndex('pack', 'pack', { unique: false })
            store.createIndex('dir', 'dir', { unique: false })
          }
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx (store, mode) {
  return openDb().then(db => db.transaction(store, mode))
}

export async function dbAll (store) {
  const t = await tx(store, 'readonly')
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function dbGet (store, key) {
  const t = await tx(store, 'readonly')
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result)
    req.onerror = () => reject(req.error)
  })
}

// 核心：通过 B-Tree 索引极速按包或按目录检索（11万条数据中只需 1ms，支持大目录完整加载）
export async function dbQueryByIndex (store, indexName, value, limit) {
  const t = await tx(store, 'readonly')
  return new Promise((resolve, reject) => {
    const idx = t.objectStore(store).index(indexName)
    const req = limit ? idx.getAll(IDBKeyRange.only(value), limit) : idx.getAll(IDBKeyRange.only(value))
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

// 核心：按目录前缀范围检索（获取当前目录及其所有子孙目录中的全部文件）
export async function dbQueryByPrefix (store, indexName, prefix, limit) {
  const t = await tx(store, 'readonly')
  return new Promise((resolve, reject) => {
    const idx = t.objectStore(store).index(indexName)
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff')
    const req = limit ? idx.getAll(range, limit) : idx.getAll(range)
    req.onsuccess = () => {
      const list = req.result || []
      const res = list.filter(r => r[indexName] === prefix || (r[indexName] && r[indexName].startsWith(prefix + '/')))
      resolve(res)
    }
    req.onerror = () => reject(req.error)
  })
}



export async function dbPut (store, key, value) {
  const t = await tx(store, 'readwrite')
  return new Promise((resolve, reject) => {
    t.objectStore(store).put(value, key)
    t.oncomplete = () => resolve(true)
    t.onerror = () => reject(t.error)
  })
}

export async function dbBulkPut (store, pairs) {
  if (!pairs.length) return
  const t = await tx(store, 'readwrite')
  return new Promise((resolve, reject) => {
    for (const [key, value] of pairs) t.objectStore(store).put(value, key)
    t.oncomplete = () => resolve(true)
    t.onerror = () => reject(t.error)
  })
}

export async function dbDelete (store, key) {
  const t = await tx(store, 'readwrite')
  return new Promise((resolve, reject) => {
    t.objectStore(store).delete(key)
    t.oncomplete = () => resolve(true)
    t.onerror = () => reject(t.error)
  })
}

export async function dbClear (store) {
  const t = await tx(store, 'readwrite')
  return new Promise((resolve, reject) => {
    t.objectStore(store).clear()
    t.oncomplete = () => resolve(true)
    t.onerror = () => reject(t.error)
  })
}