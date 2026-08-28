import { stripExt } from './scanner.js'

// 文件名 → { prefix, index }：把「末尾数字」识别为帧序号
// frame0000.png → prefix:'frame', index:0
// Effect (1)1.png → prefix:'Effect (1)', index:1
// 03.png → prefix:'', index:3
// fire.png → prefix:'fire', index:null
export function parseFrameName (name) {
  const base = stripExt(name)
  const m = /^(.*?)(\d+)$/.exec(base)
  if (m) return { prefix: m[1], index: parseInt(m[2], 10) }
  return { prefix: base, index: null }
}

export function isSheetName (name) {
  return /(_sheet|spritesheet|-sheet| sheet)\.png$/i.test(name)
}

export function naturalCompare (a, b) {
  return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' })
}

// 解析 unTied 风格的 spritesheet.txt：'path = x y w h' 每行一帧
const TXT_RE = /^(.+?)\s*=\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/

export function parseSheetTxt (text) {
  const frames = []
  for (const line of text.split(/\r?\n/)) {
    const m = TXT_RE.exec(line.trim())
    if (m) frames.push({ name: m[1].trim(), x: +m[2], y: +m[3], w: +m[4], h: +m[5] })
  }
  return frames.length ? frames : null
}

function makeDirGroups (images) {
  const map = new Map()
  for (const img of images) {
    if (!map.has(img.dir)) map.set(img.dir, [])
    map.get(img.dir).push(img)
  }
  return map
}

const NAME_CNT = new Map()
function uniqueName (base, dir) {
  const key = (dir || '') + '|' + base
  const n = (NAME_CNT.get(key) || 0) + 1
  NAME_CNT.set(key, n)
  return n === 1 ? base : base + ' #' + n
}

async function readMetaText (entry) {
  if (!entry) return null
  try {
    const file = entry.handle ? await entry.handle.getFile() : (entry.file instanceof Blob ? entry.file : null)
    if (!file) return null
    return await file.text()
  } catch (e) {
    return null
  }
}

function pushSequence (anims, dir, list) {
  if (list.length === 1) {
    const f = list[0]
    anims.push({
      id: dir + '|seq|' + f.name,
      type: 'single',
      name: uniqueName(stripExt(f.name), dir),
      dir,
      rel: f.rel,
      entry: f,
      files: [f],
      count: 1,
      fps: 0
    })
    return
  }
  const sorted = [...list].sort((a, b) => {
    if (a.frameIndex != null && b.frameIndex != null) return a.frameIndex - b.frameIndex
    return naturalCompare(a, b)
  })
  const prefix = sorted[0].prefix ?? ''
  const loose = prefix === '' && sorted.every(f => f.frameIndex != null) && sorted.length > 12
  anims.push({
    id: dir + '|seq|' + prefix,
    type: 'sequence',
    name: uniqueName(prefix ? prefix : (stripExt(sorted[0].name).replace(/\d+$/, '') || '序列'), dir),
    dir,
    rel: sorted[0].rel,
    prefix,
    entry: sorted[0],
    files: sorted,
    count: sorted.length,
    fps: 15,
    loose
  })
}

// 核心聚类：把单帧 PNG 按「目录 + 文件名前缀」汇成动画组；
// spritesheet / *_sheet.png 单独成组；gif 单独成组（浏览器原生播放）。
export async function clusterFiles (images, metas = []) {
  NAME_CNT.clear()
  const dirGroups = makeDirGroups(images)
  const metaByDir = new Map()
  for (const m of metas) {
    if (!metaByDir.has(m.dir)) metaByDir.set(m.dir, [])
    metaByDir.get(m.dir).push(m)
  }
  const anims = []

  for (const [dir, files] of dirGroups) {
    const metaTexts = (metaByDir.get(dir) || []).filter(m => m.ext === 'txt')
    const gifs = files.filter(f => f.ext === 'gif')
    // 目录名含 spritesheet/sheet 且是 PNG 的也视为整图（Paimon 等包常用名字不带 _sheet）
    const sheets = files.filter(f => f.ext === 'png' && (isSheetName(f.name) || /spritesheet|sheet/i.test(f.dir || '')))
    const frames = files.filter(f => !gifs.includes(f) && !sheets.includes(f))

    // --- GIF：一个 gif 即一个动画 ---
    for (const gif of gifs) {
      anims.push({
        id: dir + '|gif|' + gif.name,
        type: 'gif',
        name: uniqueName(stripExt(gif.name), dir),
        dir,
        rel: gif.rel,
        entry: gif,
        files: [gif],
        count: 1,
        fps: 0
      })
    }

    // --- Spritesheet：优先读取同目录 spritesheet.txt 元数据 ---
    for (const s of sheets) {
      const base = stripExt(s.name)
      const metaName = /spritesheet/i.test(base) ? 'spritesheet.txt' : base + '.txt'
      const metaEntry = metaTexts.find(m => m.name.toLowerCase() === metaName.toLowerCase())
      const text = await readMetaText(metaEntry)
      const metaFrames = text ? parseSheetTxt(text) : null
      anims.push({
        id: dir + '|sheet|' + s.name,
        type: 'sheet',
        name: uniqueName(base, dir),
        dir,
        rel: s.rel,
        entry: s,
        files: [s],
        count: metaFrames ? metaFrames.length : 0,
        fps: 15,
        metaFrames,
        metaName
      })
    }

    // --- 单帧 PNG 序列 ---
    const groups = new Map()
    for (const f of frames) {
      const { prefix, index } = parseFrameName(f.name)
      const key = prefix
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ ...f, prefix, frameIndex: index })
    }
    for (const [prefix, list] of groups) {
      list.forEach(f => { f.prefix = prefix })
      pushSequence(anims, dir, list)
    }
  }

  anims.sort((a, b) => a.dir.localeCompare(b.dir, 'en') || a.name.localeCompare(b.name, 'en'))
  return anims
}