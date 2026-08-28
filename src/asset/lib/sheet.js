// Spritesheet 帧解析：spritesheet.txt → 网格自动切分（透明间隙）→ 手动参数
import { parseSheetTxt, parseDimensionFromName } from './cluster.js'

export { parseSheetTxt }

// 用 alpha 检测把图切成连续帧矩形（水平/垂直/网格通用）
// 返回 [{x,y,w,h}] 源图坐标
export function autoSliceImage (image, maxDim = 1536) {
  const w = image.width
  const h = image.height
  if (w < 4 || h < 4) return []
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  let data
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch (e) {
    return []
  }

  // 统计每列/每行是否含非透明像素
  const colHas = new Uint8Array(w)
  const rowHas = new Uint8Array(h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        colHas[x] = 1
        rowHas[y] = 1
      }
    }
  }

  const runs = arr => {
    const out = []
    let start = -1
    for (let i = 0; i <= arr.length; i++) {
      if (i < arr.length && arr[i]) {
        if (start === -1) start = i
      } else if (start !== -1) {
        out.push([start, i - 1])
        start = -1
      }
    }
    return out
  }

  const colRuns = runs(colHas).filter(([a, b]) => b - a + 1 >= 3)
  const rowRuns = runs(rowHas).filter(([a, b]) => b - a + 1 >= 3)
  if (!colRuns.length) return []

  // 单行横向条：直接按列切
  if (rowRuns.length <= 1) {
    return colRuns.map(([x0, x1]) => ({ x: x0, y: 0, w: x1 - x0 + 1, h }))
  }

  // 网格：row-major 组合
  const frames = []
  for (const [y0, y1] of rowRuns) {
    for (const [x0, x1] of colRuns) {
      frames.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
    }
  }
  return frames
}

// 手动参数生成帧矩形
export function manualGridFrames (w, h, cfg) {
  const { cols, rows, cellW, cellH } = cfg || {}
  const cw = cellW || (cols ? Math.floor(w / cols) : 0)
  const ch = cellH || (rows ? Math.floor(h / rows) : 0)
  const colCount = cols || (cellW ? Math.round(w / cellW) : 0)
  const rowCount = rows || (cellH ? Math.round(h / cellH) : 1)
  if (!cw || !ch || !colCount) return []
  const frames = []
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      frames.push({ x: c * cw, y: r * ch, w: cw, h: ch })
    }
  }
  return frames
}

// 智能推断 SpriteSheet 网格参数（支持 SoggySocks / Paimon 等无元数据单行或多行精灵表）
export function inferSheetGrid (w, h) {
  if (w <= 0 || h <= 0) return null

  // 1. 最常见的单行横向精灵表：宽是高的整倍数 (w > h 且 w % h === 0)
  // 例如 640x64 -> 10 帧 64x64; 384x48 -> 8 帧 48x48; 1536x96 -> 16 帧 96x96
  if (w > h && w % h === 0 && w / h >= 2) {
    const cols = Math.round(w / h)
    return { cols, rows: 1, cellW: h, cellH: h, count: cols, mode: 'ratio_square' }
  }

  // 2. 常见正方形网格像素尺寸探测
  const candidates = [64, 32, 48, 80, 96, 112, 128, 160, 192, 256, 16, 24]
  for (const sz of candidates) {
    if (w % sz === 0 && h % sz === 0) {
      const cols = Math.round(w / sz)
      const rows = Math.round(h / sz)
      if (cols * rows >= 2) {
        return { cols, rows, cellW: sz, cellH: sz, count: cols * rows, mode: 'grid_candidate' }
      }
    }
  }

  // 3. 单行近似等分（如果宽 > 1.8 * 高，按高度作为单元格尺寸等分）
  if (w > 1.8 * h) {
    const cols = Math.max(2, Math.round(w / h))
    const cellW = Math.floor(w / cols)
    return { cols, rows: 1, cellW, cellH: h, count: cols, mode: 'approx_height' }
  }

  return null
}

// 解析优先级：手动配置 > 文件名尺寸标注 > txt/json 元数据 > 智能正方形网格推断 > alpha 自动切分
export function resolveSheetFrames (image, metaFrames, cfg, animName = '') {
  const w = image.width
  const h = image.height

  // 1. 手动配置最高优先级
  if (cfg && ((cfg.cellW && cfg.cellH) || (cfg.cols && cfg.rows))) {
    return manualGridFrames(w, h, cfg)
  }

  // 2. 从文件名提取的尺寸 (如 projectile_48x16.png, fireball_32x32.png)
  const nameDim = parseDimensionFromName(animName)
  if (nameDim && nameDim.cellW && nameDim.cellH) {
    if (w % nameDim.cellW === 0 && h % nameDim.cellH === 0) {
      return manualGridFrames(w, h, nameDim)
    }
  }

  // 3. 带有元数据文本/JSON 配置文件
  if (metaFrames && metaFrames.length) {
    return metaFrames
  }

  // 4. 智能网格推断优先（针对 SoggySocks / Paimon / VFX 等标准单行或多行精灵表）
  const inferred = inferSheetGrid(w, h)
  if (inferred && inferred.cols >= 2) {
    // 若是标准单行整倍数（如 640x64），直接使用单行等分
    if (inferred.rows === 1 && w % h === 0) {
      return manualGridFrames(w, h, inferred)
    }
  }

  // 4. Alpha 透明间隙切分
  const auto = autoSliceImage(image)
  if (auto.length >= 2) {
    // 校验切出来的帧宽是否具有基本的一致性（防止把一张长图误切成几块不均匀残片）
    const widths = auto.map(f => f.w)
    const avgW = widths.reduce((a, b) => a + b, 0) / widths.length
    const isReasonable = widths.every(fw => fw >= avgW * 0.35 && fw <= avgW * 2.8)
    if (isReasonable) {
      return auto
    }
  }

  // 5. 如果 alpha 切分只有 1 帧或不合理，回退到智能网格推断
  if (inferred) {
    return manualGridFrames(w, h, inferred)
  }

  return auto.length ? auto : [{ x: 0, y: 0, w, h }]
}

// BDragon 竖条/多行多列动画合集：每一行是一种颜色变体或动作，每一列是单帧
export function resolveStripFrames (image, cfg = {}) {
  const w = image.width
  const h = image.height

  // 智能网格尺寸测算（优先 64px，若不可整除则尝试 32/48/80/96/128，或由 cfg 指定）
  let cellW = cfg.cellW
  let cellH = cfg.cellH

  if (!cellW || !cellH) {
    const candidates = [64, 32, 48, 80, 96, 128, 160]
    for (const c of candidates) {
      if (w % c === 0 && h % c === 0) {
        cellW = c
        cellH = c
        break
      }
    }
    if (!cellW || !cellH) {
      cellW = 64
      cellH = 64
    }
  }

  const rows = Math.max(1, Math.round(h / cellH))
  const cols = Math.max(1, Math.round(w / cellW))
  const frames = []
  const variant = cfg.variant

  if (variant == null || variant === 'all') {
    // 整列同时播（单帧高度为整张图或所有行）
    for (let t = 0; t < cols; t++) {
      frames.push({ x: t * cellW, y: 0, w: cellW, h: h })
    }
  } else {
    // 提取指定的某一单行颜色变体
    const r = Math.min(rows - 1, Math.max(0, +variant || 0))
    for (let t = 0; t < cols; t++) {
      frames.push({ x: t * cellW, y: r * cellH, w: cellW, h: cellH })
    }
  }
  return frames
}
