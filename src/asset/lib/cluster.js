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

  const lastDirSeg = (dir.split('/').pop() || '').toLowerCase().trim()
  const isDedicatedFrameDir = /^(png|pngs|frames|separated|individual|images|single frames|frames_png)$/i.test(lastDirSeg)
  const isPureFrameNaming = list.length >= 2 && list.every(f => /^(\d+|frame[_\-\s]?\d+|f\d+|img[_\-\s]?\d+)$/i.test(stripExt(f.name)))

  // 特殊判定：名称包含 VFX / Effect / 技能名，或者包名匹配 Paimon 等特效包，
  // 这类素材（如 "Acid VFX 01.png", "Acid VFX 02.png", ... "Acid VFX 10.png"）
  // 每一张都是独立的一张 Sprite Sheet 特效，不应错误合并为多帧畸形序列
  const isVfxPack = Boolean(preset?.vfxPack) ||
    /paimon|vfx|effect|acid|fire|ice|thunder|water|wind|holy|dark|earth|skill|spell|hit|slash/i.test(pack) ||
    /vfx|effect|acid|fire|ice|thunder|water|wind|projectile|slash|hit|spell/i.test(dir) ||
    list.some(f => /vfx|effect|acid|fire|ice|thunder|water|wind|projectile|slash|hit|spell/i.test(f.name))

  const isIndependentVfxSheets = isVfxPack && !isDedicatedFrameDir && !isPureFrameNaming &&
    (list.some(f => /(vfx|effect|skill|spell|hit|slash|projectile|burst|impact|buff|debuff|\d+x\d+)/i.test(f.name)) || list.length <= 16)

  if (isIndependentVfxSheets && !isDedicatedFrameDir && !isPureFrameNaming) {
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

  // 兄弟 Aseprite 源文件目录配对（POZAC 等包：PNG/ 帧序列的 .aseprite 源在兄弟目录 Aseprite/ 下）
  const aseSiblingByParent = new Map()
  for (const dir of metaByDir.keys()) {
    const lastSeg = (dir.split('/').pop() || '').toLowerCase().trim()
    if (/^(aseprite|ase|asprite)$/i.test(lastSeg) && dir.includes('/')) {
      const parent = dir.slice(0, dir.lastIndexOf('/'))
      if (!aseSiblingByParent.has(parent)) aseSiblingByParent.set(parent, [])
      aseSiblingByParent.get(parent).push(dir)
    }
  }

  // 1. 预处理：识别兄弟子目录（例如 .../Explosion 1/PNG 与 .../Explosion 1/spritesheet）
  const dirMap = new Map()
  for (const [dir, files] of dirGroups) {
    dirMap.set(dir, files)
  }

  const parentPairs = new Map() // parentDir -> { pngDirs: [], sheetDirs: [] }
  for (const dir of dirGroups.keys()) {
    const lastSeg = (dir.split('/').pop() || '').toLowerCase().trim()
    const parentDir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
    const isPngFolder = /^(png|pngs|frames|single frames|images|frames_png)$/i.test(lastSeg)
    const isSheetFolder = /^(spritesheet|sprite sheet|sheet|sheets|spritesheets)$/i.test(lastSeg)

    if (parentDir && (isPngFolder || isSheetFolder)) {
      if (!parentPairs.has(parentDir)) parentPairs.set(parentDir, { pngDirs: [], sheetDirs: [] })
      const p = parentPairs.get(parentDir)
      if (isPngFolder) p.pngDirs.push(dir)
      if (isSheetFolder) p.sheetDirs.push(dir)
    }
  }

  // 被配对为附属于 PNG 目录的独立 sheet 目录集合（不在画廊中重复生成卡片）
  const pairedSheetDirs = new Set()
  const sheetSourcesForPngDir = new Map() // pngDir -> { sheetFiles, metaFiles, parentName }

  for (const [parentDir, pair] of parentPairs) {
    if (pair.pngDirs.length > 0 && pair.sheetDirs.length > 0) {
      for (const sd of pair.sheetDirs) pairedSheetDirs.add(sd)
      const allSheetFiles = pair.sheetDirs.flatMap(sd => dirMap.get(sd) || [])
      const allMetaFiles = pair.sheetDirs.flatMap(sd => metaByDir.get(sd) || [])
      const parentName = parentDir.split('/').pop() || parentDir
      for (const pd of pair.pngDirs) {
        sheetSourcesForPngDir.set(pd, { sheetFiles: allSheetFiles, metaFiles: allMetaFiles, parentName })
      }
    }
  }

  const anims = []

  for (const [dir, files] of dirGroups) {
    // 如果该目录是已经被配对到 PNG 目录的 Spritesheet 目录，跳过单独生成重复卡片！
    if (pairedSheetDirs.has(dir)) {
      continue
    }

    const pack = packNameOf(files[0].rel)
    const preset = presetFor(pack, profiles)
    const pairedSource = sheetSourcesForPngDir.get(dir) || null

    const curMetas = metaByDir.get(dir) || []
    const combinedMetas = pairedSource ? [...curMetas, ...pairedSource.metaFiles] : curMetas
    const metaTexts = combinedMetas.filter(m => m.ext === 'txt' || m.ext === 'json')
    let aseMetas = combinedMetas.filter(m => m.ext === 'ase' || m.ext === 'aseprite')
    const htmlMetas = combinedMetas.filter(m => m.ext === 'html' || m.ext === 'htm')

    // 本目录是 PNG/frames 序列目录时，把兄弟 Aseprite/ 目录下的源文件并入（按文件名前缀配对）
    if (dir.includes('/')) {
      const parent = dir.slice(0, dir.lastIndexOf('/'))
      const siblings = aseSiblingByParent.get(parent)
      if (siblings && siblings.length) {
        const extra = siblings.flatMap(sd => metaByDir.get(sd) || []).filter(m => m.ext === 'ase' || m.ext === 'aseprite')
        if (extra.length) aseMetas = [...aseMetas, ...extra.filter(e => !aseMetas.some(x => x.rel === e.rel))]
      }
    }

    const gifs = files.filter(f => f.ext === 'gif')

    // 智能识别当前目录内的 Spritesheet
    const sheets = files.filter(f => f.ext === 'png' && (
      isSheetName(f.name) ||
      (preset.sheetByDir && sheetNameByDir(dir)) ||
      metaTexts.some(m => stripExt(m.name).toLowerCase() === stripExt(f.name).toLowerCase()) ||
      (metaTexts.some(m => /spritesheet/i.test(m.name)) && files.filter(x => x.ext === 'png').length <= 2)
    ))

    let frames = files.filter(f => !gifs.includes(f) && !sheets.includes(f))
    // POZAC 等包：包根/子包根（深度<=2）的 PNG 均为 Preview 封面图（内容全部在 PNG/ 子目录），跳过避免生成垃圾卡片
    const dirDepth = dir ? dir.split('/').length : 0
    if (preset.rootPngSkip && dirDepth <= 2) frames = frames.filter(f => f.ext !== 'png')
    else if (preset.skipPreviewPng && dirDepth <= 2) frames = frames.filter(f => !isPreviewGifName(f.name))

    const dirPreviewGif = gifs.find(g => isPreviewGifName(g.name)) || gifs[0] || null
    const dirAseEntry = aseMetas[0] || null
    const dirHtmlEntry = htmlMetas[0] || null

    const dirBaseName = pairedSource?.parentName || (dir.split('/').pop() || '').trim()

    // 关联的 Spritesheet 大图与 TXT 元数据（用于导出 Spritesheet 格式）
    const companionSheetEntry = (pairedSource && pairedSource.sheetFiles.find(f => f.ext === 'png')) || sheets[0] || null
    const companionSheetMeta = (pairedSource && pairedSource.metaFiles.find(m => m.ext === 'txt' || m.ext === 'json')) || metaTexts[0] || null

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
          htmlEntry: matchHtml || null,
          sheetEntry: companionSheetEntry,
          sheetMetaEntry: companionSheetMeta
        })
      }
    } else if (frames.length > 0) {
      // 3. 核心：单帧 PNG 序列优先展示（自动合并 large / small 尺寸变体与同名 Sheet）
      const groups = new Map()
      for (const f of frames) {
        const { prefix, index } = parseFrameName(f.name)
        if (!groups.has(prefix)) groups.set(prefix, [])
        groups.get(prefix).push({ ...f, prefix, frameIndex: index })
      }

      // 按基础特效标识合并尺寸变体（如 burst_splatter_001_large 与 burst_splatter_001_small 合并为一个唯一卡片）
      const effectGroups = new Map()
      for (const [prefix, list] of groups) {
        const baseKey = prefix.toLowerCase()
          .replace(/(_large|_small|_medium|_xl|_hd|_2x|_1x|\d+x\d+)$/i, '')
          .replace(/[_\-\s]+$/, '')
          .trim() || prefix.toLowerCase()

        if (!effectGroups.has(baseKey)) {
          effectGroups.set(baseKey, { prefix, list, variants: new Map() })
        } else {
          const eg = effectGroups.get(baseKey)
          // 优先保留 large / 高清大尺寸作为主要展示卡片
          if (/large|_2x|_hd/i.test(prefix) || (!/large/i.test(eg.prefix) && list.length >= eg.list.length)) {
            eg.variants.set(eg.prefix, eg.list)
            eg.prefix = prefix
            eg.list = list
          } else {
            eg.variants.set(prefix, list)
          }
        }
      }

      for (const [baseKey, { prefix, list, variants }] of effectGroups) {
        const matchGif = gifs.find(g => stripExt(g.name).toLowerCase().startsWith(baseKey)) || dirPreviewGif
        const matchAse = aseMetas.find(a => stripExt(a.name).toLowerCase().startsWith(baseKey)) || dirAseEntry
        const matchHtml = htmlMetas.find(h => stripExt(h.name).toLowerCase().startsWith(baseKey)) || dirHtmlEntry

        const displayName = (/^(png|pngs|frames|images)$/i.test(prefix) || !prefix) && dirBaseName ? dirBaseName : prefix
        const sortedList = [...list].sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0))

        anims.push({
          id: `${dir}|seq|${prefix || 'seq'}`,
          type: 'sequence',
          name: uniqueName(displayName, dir),
          pack,
          dir,
          rel: sortedList[0]?.rel || '',
          entry: sortedList[0],
          files: sortedList,
          count: sortedList.length,
          fps: (preset && preset.fps) || 15,
          previewEntry: matchGif || null,
          asepriteEntry: matchAse || null,
          htmlEntry: matchHtml || null,
          sheetEntry: companionSheetEntry,
          sheetMetaEntry: companionSheetMeta,
          variants: variants.size ? Object.fromEntries(variants) : null
        })
      }
    } else if (sheets.length > 0) {
      // 4. 纯 Spritesheet 动画（当无单帧序列时才作为 Sheet 独立展示）
      for (const s of sheets) {
        const base = stripExt(s.name)
        const metaName = /spritesheet/i.test(base) ? 'spritesheet.txt' : `${base}.txt`
        let metaEntry = null
        if (preset.sheetMeta !== 'none') {
          metaEntry = metaTexts.find(m => m.name.toLowerCase() === metaName.toLowerCase()) ||
            (preset.sheetMeta === 'auto' ? metaTexts.find(m => m.name.toLowerCase().startsWith(base.toLowerCase())) : null) ||
            metaTexts.find(m => /spritesheet\.txt$/i.test(m.name)) ||
            metaTexts[0] || null
        }

        const matchGif = gifs.find(g => stripExt(g.name).toLowerCase() === base.toLowerCase()) || null
        const matchAse = aseMetas.find(a => stripExt(a.name).toLowerCase() === base.toLowerCase()) || dirAseEntry
        const matchHtml = htmlMetas.find(h => stripExt(h.name).toLowerCase() === base.toLowerCase()) || dirHtmlEntry

        const dim = parseDimensionFromName(s.name)
        const displayName = /^(spritesheet|sheet|_sheet)$/i.test(base) && dirBaseName ? dirBaseName : base

        anims.push({
          id: `${dir}|sheet|${s.name}`,
          type: 'sheet',
          name: uniqueName(displayName, dir),
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
          htmlEntry: matchHtml || null,
          sheetEntry: s,
          sheetMetaEntry: metaEntry
        })
      }
    }

    // 4. 纯 GIF
    if (true) { // 2026-08-29: GIF 无条件生成条目（Explosion VFX 等包即使同目录有同名 PNG 也要识别 GIF）
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

  // 5. 全局特效归一化终极合并（跨 Large / Small 目录，跨 PNG / Spritesheet 目录，彻底合并尺寸变体）
  const finalAnims = []
  const globalEffectMap = new Map()

  for (const anim of anims) {
    const parentDir = anim.dir ? anim.dir.replace(/\/(png|pngs|frames|spritesheets?|sprite[_\-\s]*sheets?|sheets?)$/i, '') : ''
    const normKey = normalizeEffectKey(anim.name) || normalizeEffectKey(stripExt(anim.entry?.name || '')) || anim.name
    const globalKey = `${anim.pack}|${parentDir}|${normKey}`

    if (!globalEffectMap.has(globalKey)) {
      globalEffectMap.set(globalKey, anim)
      finalAnims.push(anim)
    } else {
      const existing = globalEffectMap.get(globalKey)
      const isAnimLarge = /large|_2x|_hd/i.test(anim.name)
      const isExistLarge = /large|_2x|_hd/i.test(existing.name)
      const isAnimBetter = (anim.type === 'sequence' && existing.type !== 'sequence') ||
        (isAnimLarge && !isExistLarge) ||
        (anim.count > existing.count)

      const master = isAnimBetter ? anim : existing
      const slave = isAnimBetter ? existing : anim

      // 建立完整的 variants 结构供视口与检查器切换尺寸
      const vars = { ...(master.variants || {}) }
      const masterKey = /small|_1x/i.test(master.name) ? 'small' : 'large'
      const slaveKey = /small|_1x/i.test(slave.name) ? 'small' : 'large'

      if (!vars[masterKey]) {
        vars[masterKey] = {
          key: masterKey,
          name: master.name,
          label: masterKey === 'large' ? 'Large (大)' : 'Small (小)',
          files: master.files,
          count: master.count,
          entry: master.entry,
          type: master.type,
          sheetEntry: master.sheetEntry,
          sheetMetaEntry: master.sheetMetaEntry
        }
      }

      vars[slaveKey] = {
        key: slaveKey,
        name: slave.name,
        label: slaveKey === 'large' ? 'Large (大)' : 'Small (小)',
        files: slave.files,
        count: slave.count,
        entry: slave.entry,
        type: slave.type,
        sheetEntry: slave.sheetEntry || (slave.type === 'sheet' ? slave.entry : null),
        sheetMetaEntry: slave.sheetMetaEntry || slave.metaEntry
      }

      master.variants = vars
      master.sheetEntry = master.sheetEntry || slave.sheetEntry || (slave.type === 'sheet' ? slave.entry : null)
      master.sheetMetaEntry = master.sheetMetaEntry || slave.sheetMetaEntry || slave.metaEntry

      if (isAnimBetter) {
        const idx = finalAnims.indexOf(existing)
        if (idx !== -1) finalAnims[idx] = anim
        globalEffectMap.set(globalKey, anim)
      }
    }
  }

  return applyFixes(finalAnims, fixesMap)
}

// 用户手工修复覆盖：hide 隐藏 / rename 改名 / fps / sheet 重切 / merge 合并 / split 拆分
// fixesMap: animId -> { hide?, name?, fps?, mergeTarget?, splitParts?, sheet? }
export function applyFixes (anims, fixesMap = {}) {
  if (!anims || !anims.length) return anims
  const fixIds = fixesMap ? Object.keys(fixesMap).filter(k => fixesMap[k] && typeof fixesMap[k] === 'object') : []
  if (!fixIds.length) return anims

  const byId = new Map(anims.map(a => [a.id, a]))
  const removed = new Set()
  const added = []
  const relOf = f => (f && f.rel) || ''

  const rebuild = (a) => {
    a.count = (a.files || []).length
    if (!a.entry && a.files && a.files.length) a.entry = a.files[0]
    if (a.files && a.files.length && a.rel !== a.files[0].rel) a.rel = a.files[0].rel
    return a
  }

  for (const id of fixIds) {
    const fix = fixesMap[id]
    const a = byId.get(id)
    if (!a) continue

    if (fix.hide) { removed.add(id); continue }

    // 合并：本动画并入目标动画
    if (fix.mergeTarget && byId.has(fix.mergeTarget)) {
      const t = byId.get(fix.mergeTarget)
      const seen = new Set((t.files || []).map(relOf))
      for (const f of a.files || []) {
        if (f && !seen.has(relOf(f))) { t.files.push(f); seen.add(relOf(f)) }
      }
      rebuild(t)
      removed.add(id)
      continue
    }

    // 拆分：选中的帧拆为独立新动画，其余留在原动画
    if (Array.isArray(fix.splitParts) && fix.splitParts.length) {
      const moved = new Set()
      fix.splitParts.forEach((p, i) => {
        const rels = (p.rels || []).filter(r => r && !moved.has(r))
        if (!rels.length) return
        rels.forEach(r => moved.add(r))
        const files = rels.map(r => (a.files || []).find(f => f && relOf(f) === r)).filter(Boolean)
        if (!files.length) return
        added.push(rebuild({
          ...a,
          id: a.id + '|split|' + i,
          name: p.name || ('拆分 ' + (i + 1)),
          rel: files[0].rel,
          entry: files[0],
          files,
          variants: null,
          splitFrom: a.id
        }))
      })
      const keep = (a.files || []).filter(f => f && !moved.has(relOf(f)))
      if (!keep.length) { removed.add(id); continue }
      a.files = keep
      rebuild(a)
    }

    if (fix.name) a.name = fix.name
    if (fix.fps) a.fps = fix.fps
    if (fix.sheet && typeof fix.sheet === 'object') a.presetCfg = { ...(a.presetCfg || {}), ...fix.sheet }
  }

  const out = []
  for (const a of anims) if (!removed.has(a.id)) out.push(a)
  for (const a of added) out.push(a)
  return out
}

export function normalizeEffectKey (name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[_\-\s]*(large|small|medium|big|huge|tiny|mini|xl|hd|2x|1x|\d{2,4}x\d{2,4})[_\-\s]*/gi, '_')
    .replace(/^[_\-\s]+|[_\-\s]+$/g, '')
    .replace(/_+/g, '_')
    .trim()
}

// 异步兼容封装
export async function clusterFiles (images, metas = [], profiles = {}, fixesMap = {}) {
  return clusterFilesSync(images, metas, profiles, fixesMap)
}