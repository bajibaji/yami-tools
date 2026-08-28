// 工业级瞬时聚类引擎：100% 纯内存运算（0 磁盘 I/O 阻塞，0 延迟响应）
import { stripExt } from './scanner.js'
import { presetFor, packNameOf } from './presets.js'

// 从文件名解析网格尺寸标注：如 projectile_48x16.png -> { cellW: 48, cellH: 16 }
export function parseDimensionFromName (name) {
  if (!name) return null
  const base = stripExt(name)
  const m = /[_\-\s](\d{1,4})[xX*](\d{1,4})(?:[_\-\s]|$)/.exec(base)
  if (m) {
    const w = parseInt(m[1], 10)
    const h = parseInt(m[2], 10)
    if (w > 0 && h > 0 && w <= 2048 && h <= 2048) {
      return { cellW: w, cellH: h }
    }
  }
  return null
}

// 文件名 → { prefix, index }：把末尾数字/前缀识别为帧序号（智能规避 01/10 拆分问题）
export function parseFrameName (name) {
  const base = stripExt(name)

  // 1. 括号数字：foo (1) -> prefix: foo, index: 1
  const mParen = /^(.*?)\s*\((\d+)\)$/.exec(base)
  if (mParen) return { prefix: mParen[1].trim(), index: parseInt(mParen[2], 10) }

  // 2. 分隔符 + 数字：foo_01, foo-002, foo 03, foo_frame_01
  const mSep = /^(.*?)(?:[_\-\s]|frame|f)+0*(\d+)$/i.exec(base)
  if (mSep) {
    const cleanPrefix = mSep[1].replace(/[_\-\s]+$/, '') || mSep[1]
    return { prefix: cleanPrefix, index: parseInt(mSep[2], 10) }
  }

  // 3. 纯末尾数字：foo01 -> prefix: foo, index: 1
  const mEnd = /^(.*?[^\d])0*(\d+)$/.exec(base)
  if (mEnd) return { prefix: mEnd[1], index: parseInt(mEnd[2], 10) }

  return { prefix: base, index: null }
}

export function isSheetName (name) {
  // 匹配 spritesheet, sheet, grid, strip, 以及带尺寸标注如 _64x64.png, _32x32.png
  return /(_sheet|spritesheet|-sheet| sheet|sheet|_grid|_strip|[_\-\s]\d{1,4}[xX*]\d{1,4})\.png$/i.test(name)
}

function isPreviewGifName (name) {
  return /(preview|free preview|preview all|thumb|cover|banner)/i.test(name)
}

function sheetNameByDir (dir) {
  const seg = dir.split('/').pop() || ''
  return /sheet/i.test(seg)
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
  const key = `${dir}#${base}`
  const n = (NAME_CNT.get(key) || 0) + 1
  NAME_CNT.set(key, n)
  return n === 1 ? base : `${base}_${n}`
}

// 解析 unTied Games 坐标描述文本
export function parseSheetTxt (text) {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  const frames = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    const m = /^(?:([^=]+?)\s*=\s*)?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(line)
    if (m) {
      frames.push({
        name: (m[1] && m[1].trim()) || `frame_${frames.length + 1}`,
        x: +m[2],
        y: +m[3],
        w: +m[4],
        h: +m[5]
      })
      continue
    }

    const m2 = /^(\d+)[,\s]+(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(line)
    if (m2) {
      frames.push({ name: `frame_${frames.length + 1}`, x: +m2[1], y: +m2[2], w: +m2[3], h: +m2[4] })
      continue
    }

    const m3 = /frame\s*(\d+)?:?\s*x\s*[:=]\s*(\d+)\s*,?\s*y\s*[:=]\s*(\d+)\s*,?\s*w\s*[:=]\s*(\d+)\s*,?\s*h\s*[:=]\s*(\d+)/i.exec(line)
    if (m3) {
      frames.push({ name: `frame_${frames.length + 1}`, x: +m3[2], y: +m3[3], w: +m3[4], h: +m3[5] })
    }
  }
  return frames.length ? frames : null
}

// 解析 Aseprite/TexturePacker 风格 JSON
export function parseSheetJson (text) {
  let obj
  try { obj = JSON.parse(text) } catch (e) { return null }
  const raw = obj.frames
  if (!raw) return null
  const frames = []
  const push = (name, f) => {
    if (!f || !f.frame) return
    frames.push({ name: String(name), x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h, duration: f.duration })
  }
  if (Array.isArray(raw)) {
    for (const f of raw) push(f.filename || f.name, f)
  } else {
    for (const [name, f] of Object.entries(raw)) push(name, f)
  }
  return frames.length ? frames : null
}

// 序列帧与独立 Sheet 分组辅助函数
function pushSequence (anims, dir, pack, list, preset, previewGif, aseEntry, htmlEntry) {
  if (!list.length) return

  // 特殊判定：如果只有 2~3 张图片，且名称包含 VFX / Effect / 技能名，或者包名匹配 Paimon 等特效包，
  // 这类素材（如 "Acid VFX 01.png", "Acid VFX 02.png"）每一张都是独立的一行 Sprite Sheet 特效，不应错误合并为 2 帧的畸形序列
  const isVfxPack = /paimon|vfx|effect|acid|fire|ice|thunder|water|wind|holy|dark|earth|skill/i.test(pack) ||
    /vfx|effect|acid|fire|ice|thunder|water|wind|projectile|slash|hit/i.test(dir) ||
    list.some(f => /vfx|effect|acid|fire|ice|thunder|water|wind|projectile|slash|hit/i.test(f.name))

  if (isVfxPack && list.length <= 3) {
    for (const f of list) {
      const base = stripExt(f.name)
      const dim = parseDimensionFromName(f.name)
      anims.push({
        id: `${dir}|sheet|${f.name}`,
        type: 'sheet',
        name: uniqueName(base, dir),
        pack,
        dir,
        rel: f.rel,
        entry: f,
        files: [f],
        count: 0,
        fps: (preset && preset.fps) || 15,
        presetCfg: dim || null,
        previewEntry: previewGif || null,
        asepriteEntry: aseEntry || null,
        htmlEntry: htmlEntry || null
      })
    }
    return
  }

  // 1. 连续编号序列帧（数量 >= 3 或非独立特效命名），按帧序号排序
  const withIdx = list.filter(x => x.frameIndex != null)
  if (withIdx.length >= 2 && (!isVfxPack || withIdx.length >= 4)) {
    list.sort((a, b) => (a.frameIndex || 0) - (b.frameIndex || 0))
    const prefix = list[0].prefix || stripExt(list[0].name)
    anims.push({
      id: `${dir}|seq|${prefix}`,
      type: 'sequence',
      name: uniqueName(prefix, dir),
      pack,
      dir,
      rel: list[0].rel,
      entry: list[0],
      files: list,
      count: list.length,
      fps: (preset && preset.fps) || 15,
      previewEntry: previewGif || null,
      asepriteEntry: aseEntry || null,
      htmlEntry: htmlEntry || null
    })
    return
  }

  // 2. 如果无明显序号但同目录下有多张图片，若超过 1 张也聚合为 sequence
  if (list.length > 1 && (!isVfxPack || list.length >= 4)) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    const prefix = list[0].prefix || stripExt(list[0].name)
    anims.push({
      id: `${dir}|seq|${prefix}`,
      type: 'sequence',
      name: uniqueName(prefix, dir),
      pack,
      dir,
      rel: list[0].rel,
      entry: list[0],
      files: list,
      count: list.length,
      fps: (preset && preset.fps) || 15,
      previewEntry: previewGif || null,
      asepriteEntry: aseEntry || null,
      htmlEntry: htmlEntry || null
    })
    return
  }

  // 3. 独立图片（作为 sheet 或 single）
  for (const f of list) {
    const base = stripExt(f.name)
    const dim = parseDimensionFromName(f.name)
    anims.push({
      id: `${dir}|sheet|${f.name}`,
      type: 'sheet',
      name: uniqueName(base, dir),
      pack,
      dir,
      rel: f.rel,
      entry: f,
      files: [f],
      count: 0,
      fps: (preset && preset.fps) || 15,
      presetCfg: dim || null,
      previewEntry: previewGif || null,
      asepriteEntry: aseEntry || null,
      htmlEntry: htmlEntry || null
    })
  }
}

// 核心聚类函数：100% 同步纯内存计算，0 毫秒完成！
export function clusterFilesSync (images, metas = [], profiles = {}, fixesMap = {}) {
  NAME_CNT.clear()
  const dirGroups = makeDirGroups(images)
  const metaByDir = new Map()
  for (const m of metas) {
    if (!metaByDir.has(m.dir)) metaByDir.set(m.dir, [])
    metaByDir.get(m.dir).push(m)
  }
  const anims = []

  for (const [dir, files] of dirGroups) {
    const pack = packNameOf(files[0].rel)
    const preset = presetFor(pack, profiles)
    const curMetas = metaByDir.get(dir) || []
    const metaTexts = curMetas.filter(m => m.ext === 'txt' || m.ext === 'json')
    const aseMetas = curMetas.filter(m => m.ext === 'ase' || m.ext === 'aseprite')
    const htmlMetas = curMetas.filter(m => m.ext === 'html' || m.ext === 'htm')

    const gifs = files.filter(f => f.ext === 'gif')
    const sheets = files.filter(f => f.ext === 'png' && (isSheetName(f.name) || (preset.sheetByDir && sheetNameByDir(dir))))
    const frames = files.filter(f => !gifs.includes(f) && !sheets.includes(f))

    const dirPreviewGif = gifs.find(g => isPreviewGifName(g.name)) || gifs[0] || null
    const dirAseEntry = aseMetas[0] || null
    const dirHtmlEntry = htmlMetas[0] || null

    // 1. Spritesheet 动画（纯同步引用关联，不阻塞读取磁盘）
    for (const s of sheets) {
      const base = stripExt(s.name)
      const metaName = /spritesheet/i.test(base) ? 'spritesheet.txt' : `${base}.txt`
      let metaEntry = null
      if (preset.sheetMeta !== 'none') {
        metaEntry = metaTexts.find(m => m.name.toLowerCase() === metaName.toLowerCase()) ||
          (preset.sheetMeta === 'auto' ? metaTexts.find(m => m.name.toLowerCase().startsWith(base.toLowerCase())) : null) ||
          metaTexts.find(m => /spritesheet\.txt$/i.test(m.name))
      }

      const matchGif = gifs.find(g => stripExt(g.name).toLowerCase() === base.toLowerCase()) || null
      const matchAse = aseMetas.find(a => stripExt(a.name).toLowerCase() === base.toLowerCase()) || dirAseEntry
      const matchHtml = htmlMetas.find(h => stripExt(h.name).toLowerCase() === base.toLowerCase()) || dirHtmlEntry

      const dim = parseDimensionFromName(s.name)

      anims.push({
        id: `${dir}|sheet|${s.name}`,
        type: 'sheet',
        name: uniqueName(base, dir),
        pack,
        dir,
        rel: s.rel,
        entry: s,
        files: [s],
        count: 0,
        fps: (preset && preset.fps) || 15,
        metaEntry,
        metaFrames: null,
        presetCfg: dim || null,
        previewEntry: matchGif || null,
        asepriteEntry: matchAse || null,
        htmlEntry: matchHtml || null
      })
    }

    // 2. BDragon / Strip 格式
    if (preset.stripSheet) {
      for (const f of frames) {
        const base = stripExt(f.name)
        const matchGif = gifs.find(g => stripExt(g.name).toLowerCase() === base.toLowerCase()) || null
        const matchAse = aseMetas.find(a => stripExt(a.name).toLowerCase() === base.toLowerCase()) || dirAseEntry
        const matchHtml = htmlMetas.find(h => stripExt(h.name).toLowerCase() === base.toLowerCase()) || dirHtmlEntry

        anims.push({
          id: `${dir}|strip|${f.name}`,
          type: 'strip',
          name: uniqueName(base, dir),
          pack,
          dir,
          rel: f.rel,
          entry: f,
          files: [f],
          count: 0,
          fps: (preset && preset.fps) || 15,
          previewEntry: matchGif || null,
          asepriteEntry: matchAse || null,
          htmlEntry: matchHtml || null
        })
      }
    } else {
      // 3. 单帧 PNG 序列
      const groups = new Map()
      for (const f of frames) {
        const { prefix, index } = parseFrameName(f.name)
        if (!groups.has(prefix)) groups.set(prefix, [])
        groups.get(prefix).push({ ...f, prefix, frameIndex: index })
      }
      for (const [prefix, list] of groups) {
        const matchGif = gifs.find(g => stripExt(g.name).toLowerCase() === prefix.toLowerCase()) || dirPreviewGif
        const matchAse = aseMetas.find(a => stripExt(a.name).toLowerCase() === prefix.toLowerCase()) || dirAseEntry
        const matchHtml = htmlMetas.find(h => stripExt(h.name).toLowerCase() === prefix.toLowerCase()) || dirHtmlEntry
        pushSequence(anims, dir, pack, list, preset, matchGif, matchAse, matchHtml)
      }
    }

    // 4. 纯 GIF
    if (sheets.length === 0 && frames.length === 0) {
      for (const gif of gifs) {
        if (isPreviewGifName(gif.name)) continue
        anims.push({
          id: `${dir}|gif|${gif.name}`,
          type: 'gif',
          name: uniqueName(stripExt(gif.name), dir),
          pack,
          dir,
          rel: gif.rel,
          entry: gif,
          files: [gif],
          count: 1,
          fps: 15,
          previewEntry: gif
        })
      }
    }
  }

  return anims
}

// 异步兼容封装
export async function clusterFiles (images, metas = [], profiles = {}, fixesMap = {}) {
  return clusterFilesSync(images, metas, profiles, fixesMap)
}