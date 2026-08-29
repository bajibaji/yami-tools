// 素材管理器 Pro 核心复用组件：专业视口工作台 / 胶片时间轴 / 画廊卡片 / 虚拟列表 / 缩略图懒加载
import React, { useCallback, useEffect, useRef, useState, useMemo, memo } from 'react'
import { motion } from 'framer-motion'
import { entryBlob } from '../asset/lib/scanner.js'
import { resolveSheetFrames, resolveStripFrames } from '../asset/lib/sheet.js'
import { parseSheetTxt, parseSheetJson } from '../asset/lib/cluster.js'
import { getThumbUrl, getMemCachedThumb } from '../asset/lib/thumb.js'
import {
  IconStar,
  IconLayers,
  IconFilm,
  IconImage,
  IconSparkles,
  IconPalette,
  IconPlay,
  IconPause,
  IconCrosshair,
  IconStepBack,
  IconStepForward,
  IconEye,
  IconX,
  IconDownload,
  IconTag
} from './icons.jsx'

const VARIANT_COLORS = [
  '#f7768e', // 1: 烈焰红
  '#7aa2f7', // 2: 冰霜蓝
  '#9ece6a', // 3: 翡翠绿
  '#e0af68', // 4: 琥珀金
  '#bb9af7', // 5: 柔光紫
  '#ff9e64', // 6: 熔岩橙
  '#73daca', // 7: 极光青
  '#f43f5e', // 8: 霓虹粉
  '#38bdf8', // 9: 苍穹蓝
  '#a855f7'  // 10: 虚空紫
]

// 极速提取条带图中各行真实特征主色（使用 16x16 离屏微缩采样，耗时 < 0.2ms，零性能损耗）
const _colorSampleCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
const _colorSampleCtx = _colorSampleCanvas ? _colorSampleCanvas.getContext('2d', { willReadFrequently: true }) : null

export function extractRowDominantColors (image, rowCount) {
  if (!image || !rowCount || rowCount <= 1 || !_colorSampleCtx) return []
  const imgW = image.width
  const imgH = image.height
  const rowH = imgH / rowCount
  const colors = []

  const SAMPLE_SIZE = 16
  _colorSampleCanvas.width = SAMPLE_SIZE
  _colorSampleCanvas.height = SAMPLE_SIZE

  for (let r = 0; r < rowCount; r++) {
    _colorSampleCtx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    try {
      _colorSampleCtx.drawImage(
        image,
        0, r * rowH, imgW, rowH,
        0, 0, SAMPLE_SIZE, SAMPLE_SIZE
      )
      const imgData = _colorSampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
      let totalR = 0, totalG = 0, totalB = 0, count = 0
      let maxSat = -1, bestR = 122, bestG = 162, bestB = 247

      for (let i = 0; i < imgData.length; i += 4) {
        const a = imgData[i + 3]
        if (a < 50) continue
        const red = imgData[i]
        const green = imgData[i + 1]
        const blue = imgData[i + 2]

        const max = Math.max(red, green, blue)
        const min = Math.min(red, green, blue)
        const delta = max - min
        const brightness = (red + green + blue) / 3

        if (brightness < 25 || brightness > 240) continue

        const sat = max === 0 ? 0 : delta / max
        if (sat > maxSat) {
          maxSat = sat
          bestR = red
          bestG = green
          bestB = blue
        }

        totalR += red
        totalG += green
        totalB += blue
        count++
      }

      if (maxSat > 0.2) {
        colors.push(`rgb(${bestR}, ${bestG}, ${bestB})`)
      } else if (count > 0) {
        colors.push(`rgb(${Math.round(totalR / count)}, ${Math.round(totalG / count)}, ${Math.round(totalB / count)})`)
      } else {
        colors.push(VARIANT_COLORS[r % VARIANT_COLORS.length])
      }
    } catch (e) {
      colors.push(VARIANT_COLORS[r % VARIANT_COLORS.length])
    }
  }

  return colors
}

// 加载单个动画的帧位图（只为当前选中的单个动画服务，避免内存暴涨）
export async function loadAnimData (anim, cfg) {
  if (!anim) return null
  if (anim.type === 'gif') {
    const blob = await entryBlob(anim.entry)
    let w = 128, h = 128
    try {
      const bmp = await createImageBitmap(blob)
      w = bmp.width
      h = bmp.height
    } catch (e) {
      // fallback
    }
    return { kind: 'gif', url: URL.createObjectURL(blob), width: w, height: h, frames: [], file: blob }
  }
  if (anim.type === 'single' || (anim.type === 'sequence' && anim.files?.length === 1)) {
    const blob = await entryBlob(anim.entry)
    const image = await createImageBitmap(blob)
    // 智能检测：如果单图尺寸是横向连帧（宽 >= 1.8 * 高，如 Paimon Acid VFX 01.png）或大网格图，自动切片为精灵表动画
    if (image.width >= 1.8 * image.height || (image.width % 64 === 0 && image.height % 64 === 0 && image.width >= 128)) {
      const combinedCfg = { ...(anim.presetCfg || {}), ...(cfg || {}) }
      const frames = resolveSheetFrames(image, null, combinedCfg, anim.entry?.name || anim.name)
      if (frames.length > 1) {
        return {
          kind: 'sheet',
          image,
          frames,
          fps: anim.fps || 15
        }
      }
    }
    return { kind: 'sequence', frames: [image], fps: 0 }
  }
  if (anim.type === 'sequence') {
    const frames = await decodeFrames(anim.files)
    return { kind: 'sequence', frames, fps: anim.fps || 15 }
  }
  if (anim.type === 'strip') {
    const blob = await entryBlob(anim.entry)
    const image = await createImageBitmap(blob)
    const frames = resolveStripFrames(image, { ...(anim.presetCfg || {}), ...(cfg || {}) })
    return {
      kind: 'sheet',
      image,
      frames: frames || [{ x: 0, y: 0, w: image.width, h: image.height }],
      fps: anim.fps || 15,
      strip: true
    }
  }
  if (anim.type === 'sheet') {
    const blob = await entryBlob(anim.entry)
    const image = await createImageBitmap(blob)
    let metaFrames = anim.metaFrames
    if (!metaFrames && anim.metaEntry) {
      try {
        const metaBlob = await entryBlob(anim.metaEntry)
        const text = await metaBlob.text()
        metaFrames = parseSheetTxt(text) || parseSheetJson(text)
      } catch (e) {
        // ignore
      }
    }
    const combinedCfg = { ...(anim.presetCfg || {}), ...(cfg || {}) }
    const frames = resolveSheetFrames(image, metaFrames, combinedCfg, anim.entry?.name || anim.name)
    return {
      kind: frames.length ? 'sheet' : 'sequence',
      image,
      frames: frames.length ? frames : [{ x: 0, y: 0, w: image.width, h: image.height }],
      fps: anim.fps || 15
    }
  }
  return null
}

// 并行解码帧（最多 4 并发，避免长序列串行卡顿）
async function decodeFrames (files) {
  const out = new Array(files.length)
  let next = 0
  const CONCURRENCY = 4
  async function worker () {
    while (next < files.length) {
      const i = next++
      try {
        const blob = await entryBlob(files[i])
        out[i] = await createImageBitmap(blob)
      } catch (e) { out[i] = null }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker))
  return out.filter(Boolean)
}

// 显存与内存安全释放工具：彻底释放 ImageBitmap / ObjectURL，杜绝显存泄漏
export function freeAnimData (d) {
  if (!d) return
  if (d.image && typeof d.image.close === 'function') {
    try { d.image.close() } catch (e) {}
  }
  if (Array.isArray(d.frames)) {
    for (const f of d.frames) {
      if (f && typeof f.close === 'function') {
        try { f.close() } catch (e) {}
      }
    }
  }
  if (d.kind === 'gif' && d.url) {
    URL.revokeObjectURL(d.url)
  }
}

// 预览数据 MRU 缓存：避免来回切换动画重复解码，LRU 上限 12 个动画（淘汰时严格关闭 ImageBitmap）
const previewCache = new Map()
const PREVIEW_CACHE_MAX = 12
const previewKey = (anim, cfg) => anim.id + '|' + JSON.stringify(cfg || {})

export function loadAnimDataCached (anim, cfg) {
  const key = previewKey(anim, cfg || {})
  const hit = previewCache.get(key)
  if (hit) {
    hit.last = Date.now()
    return hit.promise
  }
  const promise = loadAnimData(anim, cfg || {})
  previewCache.set(key, { last: Date.now(), promise })
  if (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = [...previewCache.entries()].sort((a, b) => a[1].last - b[1].last)[0]
    if (oldest) {
      previewCache.delete(oldest[0])
      oldest[1].promise.then(d => freeAnimData(d)).catch(() => {})
    }
  }
  return promise
}

// ---------- 虚拟滚动列表 ----------
export const VirtualList = React.memo(function VirtualList ({ items, rowHeight, overscan = 8, renderRow, className = 'am-vlist' }) {
  const ref = useRef(null)
  const [range, setRange] = useState({ start: 0, end: 40 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan)
      const end = Math.min(items.length, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + overscan)
      setRange(r => (r.start !== start || r.end !== end) ? { start, end } : r)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [items.length, rowHeight, overscan])

  const start = Math.min(range.start, items.length)
  const end = Math.min(range.end, items.length)
  const slice = items.slice(start, end)

  return (
    <div className={className} ref={ref}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${start * rowHeight}px)` }}>
          {slice.map((item, i) => (
            <div key={item.id ?? item.rel ?? (start + i)} style={{ height: rowHeight }}>
              {renderRow(item, start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

// ---------- 视口懒加载缩略图 (Lazy Thumb) ----------
// 多行网格动画缩略图规格：取每行第 2 帧排成方块（BDragon strip / 多行 sheet 通用）
export const GRID_THUMB_SPEC = { mode: 'grid2nd' }

// 全局单例 IntersectionObserver：避免成百上千个组件实例监听风暴
let globalThumbObserver = null
const thumbObserverCallbacks = new Map()

function getGlobalThumbObserver () {
  if (typeof IntersectionObserver === 'undefined') return null
  if (!globalThumbObserver) {
    globalThumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cb = thumbObserverCallbacks.get(entry.target)
          if (cb) {
            cb()
            thumbObserverCallbacks.delete(entry.target)
            globalThumbObserver.unobserve(entry.target)
          }
        }
      }
    }, { rootMargin: '150px' })
  }
  return globalThumbObserver
}

export const Thumb = memo(function Thumb ({ entry, size = 32, className = 'am-thumb', thumbSpec = null }) {
  const [url, setUrl] = useState(() => getMemCachedThumb(entry, thumbSpec))
  const [isVisible, setIsVisible] = useState(() => Boolean(getMemCachedThumb(entry, thumbSpec)))
  const containerRef = useRef(null)

  useEffect(() => {
    const cached = getMemCachedThumb(entry, thumbSpec)
    if (cached) {
      setUrl(cached)
      setIsVisible(true)
      return
    }

    const el = containerRef.current
    if (!el) return
    const obs = getGlobalThumbObserver()
    if (!obs) {
      setIsVisible(true)
      return
    }
    thumbObserverCallbacks.set(el, () => setIsVisible(true))
    obs.observe(el)
    return () => {
      thumbObserverCallbacks.delete(el)
      obs.unobserve(el)
    }
  }, [entry?.rel, entry?.size, thumbSpec])

  useEffect(() => {
    let alive = true
    if (!isVisible || !entry) return
    getThumbUrl(entry, thumbSpec).then(u => {
      if (alive && u) setUrl(u)
    }).catch(() => {})
    return () => { alive = false }
  }, [isVisible, entry?.rel, entry?.size, thumbSpec])

  return (
    <span ref={containerRef} className={className} style={{ width: size, height: size }}>
      {url ? <img src={url} width={size} height={size} alt="" loading="lazy" /> : <span className="thumb-ph">▪</span>}
    </span>
  )
})

// ---------- 画廊网格卡片（原生 GPU 加速 CSS，0 JS 动画开销，支持卡片快捷收藏） ----------
const gifPreviewCache = new Map() // rel -> objectURL, LRU 64
function gifPreviewUrl (entry) {
  if (!entry) return null
  const cached = gifPreviewCache.get(entry.rel)
  if (cached) return cached
  return null
}

export const GalleryCard = memo(function GalleryCard ({
  anim,
  selected,
  isFav,
  isMultiSelected = false,
  showCheckbox = false,
  thumbSize = 84,
  tags = [],
  onSelect,
  onToggleFav,
  onToggleMulti,
  onTagClick,
  onDoubleClick
}) {
  const [hover, setHover] = useState(false)
  const [previewGifUrl, setPreviewGifUrl] = useState(() => gifPreviewUrl(anim.previewEntry))

  useEffect(() => {
    let alive = true
    if (hover && anim.previewEntry && !previewGifUrl) {
      entryBlob(anim.previewEntry).then(blob => {
        if (!alive) return
        let url = gifPreviewUrl(anim.previewEntry)
        if (!url) {
          url = URL.createObjectURL(blob)
          gifPreviewCache.set(anim.previewEntry.rel, url)
          if (gifPreviewCache.size > 64) {
            const first = gifPreviewCache.keys().next().value
            const old = gifPreviewCache.get(first)
            gifPreviewCache.delete(first)
            if (old) URL.revokeObjectURL(old)
          }
        }
        setPreviewGifUrl(url)
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [hover, anim.previewEntry, previewGifUrl])

  const renderTypeIcon = () => {
    if (anim.type === 'sheet') return <IconLayers size={9} />
    if (anim.type === 'strip') return <IconFilm size={9} />
    if (anim.type === 'sequence') return <IconSparkles size={9} />
    return <IconImage size={9} />
  }

  const renderTypeLabel = () => {
    if (anim.type === 'sequence') return 'SEQ'
    if (anim.type === 'sheet') return 'SHEET'
    if (anim.type === 'strip') return 'STRIP'
    if (anim.type === 'single') return 'IMG'
    return anim.type ? anim.type.toUpperCase() : 'IMG'
  }

  return (
    <div
      data-anim-id={anim.id}
      className={`gallery-card ${selected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
      onClick={() => onSelect(anim.id)}
      onDoubleClick={() => onDoubleClick?.(anim)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="gallery-thumb-wrap">
        {showCheckbox && (
          <input
            type="checkbox"
            className="gallery-select-checkbox"
            checked={isMultiSelected}
            onClick={e => e.stopPropagation()}
            onChange={() => onToggleMulti?.(anim.id)}
            title="勾选加入批量操作"
          />
        )}
        <Thumb
          entry={anim.entry}
          size={thumbSize}
          className={`gallery-thumb-img ${hover && previewGifUrl ? 'thumb-hidden' : ''}`}
          thumbSpec={(anim.type === 'strip' || anim.type === 'sheet') ? GRID_THUMB_SPEC : null}
        />
        {hover && previewGifUrl && (
          <img src={previewGifUrl} className="gallery-thumb-img" alt="" />
        )}

        <div className="gallery-badges">
          <span className={`type-badge type-${anim.type}`}>
            {renderTypeIcon()}
            <span>{renderTypeLabel()}</span>
          </span>
          {anim.dupCount ? (
            <span className="count-badge dup-badge" title="重复素材份数">{anim.dupCount} 份</span>
          ) : anim.count > 1 ? (
            <span className="count-badge">{anim.count} 帧</span>
          ) : null}
          {anim.asepriteEntry && <span className="count-badge ase-badge" title="含 Aseprite 原工程源文件">.ASE</span>}
          {tags.length > 0 && <span className="count-badge tag-badge" title={tags.join(', ')}>{tags.length} 标签</span>}
        </div>

        {/* 缩略图左上角标签按钮 + 右上角收藏星星按钮 */}
        {onTagClick && (
          <button
            type="button"
            className={`card-tag-btn ${tags.length ? 'active' : ''} ${showCheckbox ? 'has-checkbox' : ''}`}
            onClick={e => {
              e.stopPropagation()
              onTagClick(anim.id)
            }}
            title={tags.length ? ('标签：' + tags.join(', ')) : '添加标签'}
          >
            <IconTag size={13} />
          </button>
        )}
        <button
          type="button"
          className={`card-fav-btn ${isFav ? 'active' : ''}`}
          onClick={e => {
            e.stopPropagation()
            onToggleFav(anim.id)
          }}
          title={isFav ? '取消收藏' : '加入收藏'}
        >
          <IconStar size={13} filled={isFav} />
        </button>
      </div>

      <div className="gallery-info">
        <div className="gallery-title" title={anim.name}>{anim.name}</div>
        <div className="gallery-dir" title={anim.dir || anim.pack}>
          {anim.pack}{anim.dir ? ` / ${anim.dir}` : ''}
        </div>
      </div>
    </div>
  )
})

// ---------- 逐帧胶片带 (Filmstrip Timeline) ----------
export const Filmstrip = memo(function Filmstrip ({ data, currentIdx, onSelectFrame }) {
  if (!data || data.kind === 'gif' || !data.frames || data.frames.length <= 1) return null

  return (
    <div className="filmstrip-bar">
      <div className="filmstrip-track">
        {data.frames.map((frame, idx) => {
          const isCurrent = idx === currentIdx
          const fw = data.kind === 'sheet' ? frame.w : frame.width
          const fh = data.kind === 'sheet' ? frame.h : frame.height

          return (
            <div
              key={idx}
              className={`filmstrip-frame ${isCurrent ? 'active' : ''}`}
              onClick={() => onSelectFrame(idx)}
              title={`第 ${idx + 1} 帧 (${fw} × ${fh})`}
            >
              <div className="filmstrip-idx">{idx + 1}</div>
              <FilmstripFrameCanvas data={data} frame={frame} />
            </div>
          )
        })}
      </div>
    </div>
  )
})

const FilmstripFrameCanvas = memo(function FilmstripFrameCanvas ({ data, frame }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    const fw = data.kind === 'sheet' ? frame.w : frame.width
    const fh = data.kind === 'sheet' ? frame.h : frame.height

    if (cv.width !== fw || cv.height !== fh) {
      cv.width = fw
      cv.height = fh
    }
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, fw, fh)

    if (data.kind === 'sheet') {
      ctx.drawImage(data.image, frame.x, frame.y, frame.w, frame.h, 0, 0, fw, fh)
    } else {
      ctx.drawImage(frame, 0, 0)
    }
  }, [data, frame])

  return <canvas ref={canvasRef} className="filmstrip-canvas" />
})

// ---------- 原始图片大图查看弹窗 (Raw Image Modal) ----------
export const RawImageModal = memo(function RawImageModal ({ anim, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [blobFile, setBlobFile] = useState(null)
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)
  const [rawDim, setRawDim] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [bgStyle, setBgStyle] = useState('checker-dark')

  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const stageRef = useRef(null)

  const files = anim?.files || (anim?.entry ? [anim.entry] : [])
  const currentFile = files[selectedFileIdx] || anim?.sheetEntry || anim?.entry

  useEffect(() => {
    let alive = true
    if (!currentFile) return
    let currentUrl = null
    entryBlob(currentFile).then(async (blob) => {
      if (!alive) return
      currentUrl = URL.createObjectURL(blob)
      setBlobUrl(currentUrl)
      setBlobFile(blob)
      try {
        const bmp = await createImageBitmap(blob)
        if (alive) {
          setRawDim({ w: bmp.width, h: bmp.height })
          bmp.close()
        }
      } catch (e) {}
    }).catch(() => {})

    return () => {
      alive = false
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  }, [currentFile])

  // ESC 键关闭
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // 鼠标滚轮缩放 (Wheel Zoom)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -1 : 1
      setZoom(prev => {
        let step = 0.25
        if (prev < 1) step = 0.1
        else if (prev >= 4) step = 1
        else step = 0.5
        const next = Math.max(0.1, Math.min(32, +(prev + delta * step).toFixed(2)))
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 鼠标按住拖拽平移 (Drag Pan)
  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y
    }
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleDownload = () => {
    if (!blobFile || !currentFile) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = currentFile.name || 'original_image.png'
    a.click()
  }

  return (
    <div className="pro-modal-backdrop" onClick={onClose}>
      <div className="raw-image-modal" onClick={e => e.stopPropagation()}>
        <div className="raw-modal-header">
          <div className="raw-modal-title-wrap">
            <IconImage size={18} className="modal-logo" />
            <div className="raw-modal-titles">
              <h3>原始完整图像：{currentFile?.name || anim?.name}</h3>
              <div className="raw-modal-meta">
                {rawDim && <span className="raw-badge highlight">{rawDim.w} × {rawDim.h} px</span>}
                <span className="raw-badge">{anim?.type?.toUpperCase() || 'PNG'}</span>
                {files.length > 1 && <span className="raw-badge">{files.length} 帧序列</span>}
                <span className="raw-path" title={currentFile?.rel}>{currentFile?.rel || anim?.rel}</span>
              </div>
            </div>
          </div>

          <div className="raw-modal-tools">
            <div className="bg-switcher" title="切换画布背景">
              <button
                type="button"
                className={`bg-btn bg-dark ${bgStyle === 'checker-dark' ? 'active' : ''}`}
                onClick={() => setBgStyle('checker-dark')}
                title="深色棋盘格"
              />
              <button
                type="button"
                className={`bg-btn bg-light ${bgStyle === 'checker-light' ? 'active' : ''}`}
                onClick={() => setBgStyle('checker-light')}
                title="浅色棋盘格"
              />
              <button
                type="button"
                className={`bg-btn bg-black ${bgStyle === 'black' ? 'active' : ''}`}
                onClick={() => setBgStyle('black')}
                title="纯黑背景"
              />
              <button
                type="button"
                className={`bg-btn bg-white ${bgStyle === 'white' ? 'active' : ''}`}
                onClick={() => setBgStyle('white')}
                title="纯白背景"
              />
            </div>

            <div className="zoom-controls">
              <button type="button" className="zoom-btn" onClick={() => setZoom(z => Math.max(0.1, +(z <= 1 ? z - 0.25 : z - 1).toFixed(2)))}>−</button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button type="button" className="zoom-btn" onClick={() => setZoom(z => Math.min(32, +(z < 1 ? z + 0.25 : z + 1).toFixed(2)))}>＋</button>
              <button type="button" className="zoom-fit-btn" onClick={resetView} title="恢复 100% 原始比例并居中">1:1</button>
            </div>

            <button type="button" className="folder-close-btn" onClick={onClose} title="关闭 (Esc)">
              <IconX size={15} />
            </button>
          </div>
        </div>

        <div
          ref={stageRef}
          className={`raw-modal-body stage-${bgStyle}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {blobUrl ? (
            <div
              className="raw-image-scroll-pane"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                cursor: isDragging ? 'grabbing' : 'grab'
              }}
            >
              <img
                src={blobUrl}
                alt=""
                draggable={false}
                className="raw-full-image"
              />
            </div>
          ) : (
            <div className="raw-modal-loading">正在载入原始图像…</div>
          )}
        </div>

        {/* 序列帧平铺选择带：直接平铺展示所有帧供用户点击切换 */}
        {files.length > 1 && (
          <div className="raw-frame-strip-bar">
            <div className="raw-frame-strip-info">
              <IconSparkles size={13} style={{ color: 'var(--am-accent)' }} />
              <span>序列帧平铺选择 ({files.length} 帧)</span>
              <span className="raw-frame-strip-hint">直接点击下方任意帧快速切换当前原图</span>
            </div>
            <div className="raw-frame-strip-track">
              {files.map((f, i) => {
                const isActive = i === selectedFileIdx
                return (
                  <div
                    key={i}
                    className={`raw-frame-tile ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedFileIdx(i)
                      resetView()
                    }}
                    title={`第 ${i + 1} 帧：${f.name}`}
                  >
                    <div className="raw-frame-tile-idx">#{i + 1}</div>
                    <div className="raw-frame-tile-thumb">
                      <Thumb entry={f} size={48} className="frame-thumb-img" />
                    </div>
                    <div className="raw-frame-tile-name" title={f.name}>{f.name}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="raw-modal-footer">
          <div className="footer-file-info">
            <span>文件：<code>{currentFile?.name}</code></span>
            {currentFile?.size ? <span>大小：{(currentFile.size / 1024).toFixed(1)} KB</span> : null}
            <span className="raw-tip-text">提示：支持鼠标滚轮缩放、按住鼠标左键任意拖拽平移</span>
          </div>
          <div className="footer-buttons">
            <button type="button" className="raw-download-btn" onClick={handleDownload} title="下载保存原始完整图片文件">
              <IconDownload size={14} style={{ marginRight: 4 }} /> 下载原始图片
            </button>
            <button type="button" className="raw-done-btn" onClick={onClose}>
              完成并返回
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

// ---------- 专业视口工作台 (Pro Canvas Viewport) ----------
export function PreviewPane ({ anim, cfg, onFrameData, onToast, onCfgChange, onOpenFolder }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const stageRef = useRef(null)
  const sliderRef = useRef(null)
  const counterRef = useRef(null)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [fps, setFps] = useState(anim?.fps || 15)
  const [zoom, setZoom] = useState(4)
  const [isFit, setIsFit] = useState(() => {
    try {
      const s = localStorage.getItem('am_viewport_fit')
      return s !== null ? s === 'true' : true
    } catch (e) {
      return true
    }
  })
  const isFitRef = useRef(true)
  isFitRef.current = isFit
  const [playMode, setPlayMode] = useState('loop') // 'loop' | 'once' | 'pingpong'
  const [direction, setDirection] = useState(1)
  const [bgStyle, setBgStyle] = useState('checker-dark') // 'checker-dark' | 'checker-light' | 'black' | 'white' | 'green'
  const [showCrosshair, setShowCrosshair] = useState(false)
  const [showRawModal, setShowRawModal] = useState(false)

  const idxRef = useRef(0)
  idxRef.current = idx
  const playingRef = useRef(true)
  playingRef.current = playing
  const fpsRef = useRef(fps)
  fpsRef.current = fps
  const playModeRef = useRef(playMode)
  playModeRef.current = playMode
  const directionRef = useRef(direction)
  directionRef.current = direction
  const dataRef = useRef(null)
  dataRef.current = data

  const onFrameDataRef = useRef(onFrameData)
  onFrameDataRef.current = onFrameData
  const onToastRef = useRef(onToast)
  onToastRef.current = onToast
  const onCfgChangeRef = useRef(onCfgChange)
  onCfgChangeRef.current = onCfgChange
  const onOpenFolderRef = useRef(onOpenFolder)
  onOpenFolderRef.current = onOpenFolder
  const animRef = useRef(anim)
  animRef.current = anim

  const animId = anim?.id
  const cfgKey = useMemo(() => JSON.stringify(cfg || {}), [cfg])

  const [selectedVariantKey, setSelectedVariantKey] = useState(null)

  useEffect(() => {
    setSelectedVariantKey(null)
  }, [animId])

  // 当前实际用于视口渲染的动画对象（支持 Large / Small 动态切换）
  const activePreviewAnim = useMemo(() => {
    if (!anim) return null
    if (selectedVariantKey && anim.variants && anim.variants[selectedVariantKey]) {
      const v = anim.variants[selectedVariantKey]
      return {
        ...anim,
        name: v.name || anim.name,
        type: v.type || anim.type,
        files: v.files || anim.files,
        entry: v.entry || anim.entry,
        count: v.count || anim.count,
        sheetEntry: v.sheetEntry || anim.sheetEntry,
        sheetMetaEntry: v.sheetMetaEntry || anim.sheetMetaEntry
      }
    }
    return anim
  }, [anim, selectedVariantKey])

  const activeAnimRef = useRef(activePreviewAnim)
  activeAnimRef.current = activePreviewAnim

  useEffect(() => {
    setFps(activePreviewAnim?.fps || 15)
    setIdx(0)
    idxRef.current = 0
    setPlaying(true)
    playingRef.current = true
    setDirection(1)
  }, [animId, selectedVariantKey])

  const loadTokenRef = useRef(0)

  useEffect(() => {
    if (!animId || !activeAnimRef.current) {
      setData(null)
      onFrameDataRef.current?.(null)
      setLoading(false)
      return
    }

    const token = ++loadTokenRef.current
    setLoading(true)
    loadAnimDataCached(activeAnimRef.current, cfg)
      .then(d => {
        if (token !== loadTokenRef.current) {
          if (d?.kind === 'gif' && d.url) URL.revokeObjectURL(d.url)
          return
        }
        setData(d)
        dataRef.current = d
        onFrameDataRef.current?.(d)
        setIdx(0)
        idxRef.current = 0
        if (isFitRef.current) {
          requestAnimationFrame(() => applyFitZoom(d))
        }
      })
      .catch(e => {
        if (token === loadTokenRef.current) onToastRef.current?.('预览失败：' + e.message)
      })
      .finally(() => {
        if (token === loadTokenRef.current) setLoading(false)
      })
  }, [animId, cfgKey, activePreviewAnim])

  const frameCount = data && data.kind !== 'gif' ? (data.frames?.length || 0) : 0

  const stripRowCount = useMemo(() => {
    if (!data?.image) return 1
    const h = data.image.height
    const w = data.image.width
    let cellH = cfg?.cellH
    if (!cellH) {
      const candidates = [64, 32, 48, 80, 96, 128, 160]
      for (const c of candidates) {
        if (w % c === 0 && h % c === 0) {
          cellH = c
          break
        }
      }
    }
    cellH = cellH || 64
    return Math.max(1, Math.round(h / cellH))
  }, [data, cfg])

  const rowColors = useMemo(() => {
    if (!data?.image || stripRowCount <= 1) return []
    return extractRowDominantColors(data.image, stripRowCount)
  }, [data?.image, stripRowCount])

  const renderFrameToCanvas = useCallback((frameIndex) => {
    const cv = canvasRef.current
    const currentData = dataRef.current
    if (!cv || !currentData || currentData.kind === 'gif' || !currentData.frames?.length) return

    const fIdx = Math.max(0, Math.min(frameIndex, currentData.frames.length - 1))
    const frame = currentData.frames[fIdx]
    if (!frame) return

    const ctx = cv.getContext('2d')
    const fw = currentData.kind === 'sheet' ? frame.w : frame.width
    const fh = currentData.kind === 'sheet' ? frame.h : frame.height

    if (cv.width !== fw || cv.height !== fh) {
      cv.width = fw
      cv.height = fh
    }

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, fw, fh)

    if (currentData.kind === 'sheet') {
      ctx.drawImage(currentData.image, frame.x, frame.y, frame.w, frame.h, 0, 0, fw, fh)
    } else {
      ctx.drawImage(frame, 0, 0)
    }
  }, [])

  useEffect(() => {
    if (!data || data.kind === 'gif' || frameCount <= 1) return

    let reqId = null
    let lastTime = performance.now()

    const animate = (now) => {
      if (playingRef.current) {
        const interval = 1000 / (fpsRef.current || 15)
        const elapsed = now - lastTime

        if (elapsed >= interval) {
          lastTime = now - (elapsed % interval)

          let nextIdx = idxRef.current
          const mode = playModeRef.current

          if (mode === 'once') {
            if (nextIdx >= frameCount - 1) {
              setPlaying(false)
              playingRef.current = false
              setIdx(frameCount - 1)
              return
            } else {
              nextIdx++
            }
          } else if (mode === 'pingpong') {
            let dir = directionRef.current
            nextIdx += dir
            if (nextIdx >= frameCount) {
              dir = -1
              setDirection(-1)
              nextIdx = Math.max(0, frameCount - 2)
            } else if (nextIdx < 0) {
              dir = 1
              setDirection(1)
              nextIdx = Math.min(frameCount - 1, 1)
            }
          } else {
            nextIdx = (nextIdx + 1) % frameCount
          }

          idxRef.current = nextIdx
          renderFrameToCanvas(nextIdx)
          if (sliderRef.current) sliderRef.current.value = nextIdx
          if (counterRef.current) counterRef.current.innerHTML = `<strong>${nextIdx + 1}</strong> / ${frameCount} 帧`
        }
      }
      reqId = requestAnimationFrame(animate)
    }

    reqId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(reqId)
  }, [data, frameCount, renderFrameToCanvas])

  useEffect(() => {
    if (!playingRef.current) {
      renderFrameToCanvas(idx)
    }
  }, [idx, renderFrameToCanvas])

  const frameW = data && data.kind !== 'gif' && data.frames?.[0] ? (data.kind === 'sheet' ? data.frames[0].w : (data.frames[0].width || data.frames[0].w || 0)) : (data?.kind === 'gif' ? (data.width || 128) : (data?.image ? data.image.width : 0))
  const frameH = data && data.kind !== 'gif' && data.frames?.[0] ? (data.kind === 'sheet' ? data.frames[0].h : (data.frames[0].height || data.frames[0].h || 0)) : (data?.kind === 'gif' ? (data.height || 128) : (data?.image ? data.image.height : 0))

  const applyFitZoom = useCallback((currentData = dataRef.current) => {
    const stage = stageRef.current || containerRef.current
    if (!stage) return
    // 精确获取视口舞台的实际像素大小（预留 24px 呼吸内边距）
    const stageW = Math.max(40, stage.clientWidth - 24)
    const stageH = Math.max(40, stage.clientHeight - 24)
    if (stageW <= 0 || stageH <= 0) return

    let fw = 0
    let fh = 0
    if (currentData) {
      if (currentData.kind === 'sheet' && currentData.frames?.[0]) {
        fw = currentData.frames[0].w
        fh = currentData.frames[0].h
      } else if (currentData.kind === 'sequence' && currentData.frames?.[0]) {
        fw = currentData.frames[0].width || currentData.frames[0].w
        fh = currentData.frames[0].height || currentData.frames[0].h
      } else if (currentData.kind === 'gif') {
        fw = currentData.width || 128
        fh = currentData.height || 128
      } else if (currentData.image) {
        fw = currentData.image.width
        fh = currentData.image.height
      }
    }
    if (!fw || !fh) return

    // 适应视口的高度与宽度（严格按比例缩放至填满舞台）
    const scaleW = stageW / fw
    const scaleH = stageH / fh
    const fitScale = Math.min(scaleW, scaleH)

    if (fitScale <= 0) return

    // 完美填满画布舞台高度/宽度（保留 2 位小数精确缩放，例如 1.85x, 2.7x, 5.2x）
    const targetScale = Math.min(32, Math.max(0.1, Math.round(fitScale * 100) / 100))
    setZoom(targetScale)
  }, [])

  // 处于 Fit 模式时，切换不同尺寸素材或尺寸加载完成自动 Fit
  useEffect(() => {
    if (isFit && data) {
      applyFitZoom(data)
    }
  }, [isFit, data, applyFitZoom])

  // 容器/视口舞台尺寸变动时自动重新计算 Fit
  useEffect(() => {
    if (!isFit || !stageRef.current) return
    const el = stageRef.current
    const ro = new ResizeObserver(() => {
      applyFitZoom(dataRef.current)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isFit, applyFitZoom])

  const handleManualZoom = (delta) => {
    setIsFit(false)
    isFitRef.current = false
    try { localStorage.setItem('am_viewport_fit', 'false') } catch (e) {}
    setZoom(z => {
      let next
      if (delta > 0) {
        next = z < 1 ? Math.min(1, Math.round((z + 0.25) * 100) / 100) : Math.floor(z + 1)
      } else {
        next = z <= 1 ? Math.max(0.1, Math.round((z - 0.25) * 100) / 100) : Math.ceil(z - 1)
      }
      return Math.min(32, Math.max(0.1, next))
    })
  }

  const handleToggleFit = () => {
    setIsFit(prev => {
      const next = !prev
      isFitRef.current = next
      try { localStorage.setItem('am_viewport_fit', String(next)) } catch (e) {}
      if (next) {
        applyFitZoom(dataRef.current)
      }
      return next
    })
  }

  // 视口工作台原生滚轮直接放大/缩小（无需按住 Ctrl，直接滑轮 1x~32x）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -1 : 1
      setIsFit(false)
      isFitRef.current = false
      try { localStorage.setItem('am_viewport_fit', 'false') } catch (e) {}
      setZoom(z => {
        const step = z >= 4 ? 1 : z >= 1 ? 0.5 : 0.1
        const next = Math.round((z + delta * step) * 100) / 100
        return Math.min(32, Math.max(0.1, next))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const stepFrame = (step) => {
    if (frameCount <= 1) return
    setPlaying(false)
    playingRef.current = false
    const next = (idxRef.current + step + frameCount) % frameCount
    idxRef.current = next
    setIdx(next)
    renderFrameToCanvas(next)
    if (sliderRef.current) sliderRef.current.value = next
    if (counterRef.current) counterRef.current.innerHTML = `<strong>${next + 1}</strong> / ${frameCount} 帧`
  }

  const handleTogglePlay = () => {
    const nextPlay = !playing
    setPlaying(nextPlay)
    playingRef.current = nextPlay
    if (!nextPlay) {
      setIdx(idxRef.current)
      if (sliderRef.current) sliderRef.current.value = idxRef.current
      if (counterRef.current) counterRef.current.innerHTML = `<strong>${idxRef.current + 1}</strong> / ${frameCount} 帧`
    }
  }

  return (
    <div className="pro-viewport-panel" ref={containerRef}>
      <div className="viewport-header">
        <div className="viewport-left-tools">
          <span className="viewport-title">
            {anim ? (
              <>
                <strong className="anim-heading">{anim.name}</strong>
                <span className="dim-info">{frameW > 0 ? `${frameW} × ${frameH} px` : ''}</span>
              </>
            ) : (
              <span className="dim-info">视口工作台 (Viewport)</span>
            )}
          </span>
        </div>

        <div className="viewport-right-tools">
          {anim?.variants && Object.keys(anim.variants).length > 1 && (
            <div className="size-variant-switcher" title="切换特效尺寸变体（高清大图 / 像素小图）">
              <span className="dim-info">尺寸</span>
              <div className="size-btn-group">
                {Object.entries(anim.variants).map(([key, v]) => {
                  const isCurActive = (selectedVariantKey || (anim.variants.large ? 'large' : Object.keys(anim.variants)[0])) === key
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`size-btn ${isCurActive ? 'active' : ''}`}
                      onClick={() => setSelectedVariantKey(key)}
                    >
                      {key === 'large' ? 'Large (大)' : key === 'small' ? 'Small (小)' : (v.label || key)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {(activePreviewAnim?.type === 'strip' || anim?.type === 'strip') && stripRowCount > 1 && (
            <div className="strip-variant-group" title="切换特效颜色变体（每一行对应一种颜色）">
              <span className="variant-label">变体</span>
              <div className="variant-pill-bar">
                <button
                  type="button"
                  className={`variant-pill-btn ${(cfg?.variant === 'all' || cfg?.variant === undefined) ? 'active' : ''}`}
                  onClick={() => onCfgChangeRef.current?.({ variant: 'all' })}
                  title="全部颜色（连续播放）"
                >
                  全部
                </button>
                {Array.from({ length: stripRowCount }, (_, i) => {
                  const color = rowColors[i] || VARIANT_COLORS[i % VARIANT_COLORS.length]
                  const isActive = cfg?.variant === i
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`variant-pill-btn num-btn ${isActive ? 'active' : ''}`}
                      style={{
                        '--var-color': color,
                        borderColor: isActive ? color : `${color}66`,
                        color: isActive ? '#090c13' : color,
                        backgroundColor: isActive ? color : `${color}18`,
                        boxShadow: isActive ? `0 0 10px ${color}88` : undefined
                      }}
                      onClick={() => onCfgChangeRef.current?.({ variant: i })}
                      title={`颜色变体 ${i + 1}`}
                    >
                      <span className="var-dot" style={{ backgroundColor: color }} />
                      <span>{i + 1}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="bg-switcher" title="切换画布背景">
            <button
              type="button"
              className={`bg-btn bg-dark ${bgStyle === 'checker-dark' ? 'active' : ''}`}
              onClick={() => setBgStyle('checker-dark')}
              title="深色棋盘格"
            />
            <button
              type="button"
              className={`bg-btn bg-light ${bgStyle === 'checker-light' ? 'active' : ''}`}
              onClick={() => setBgStyle('checker-light')}
              title="浅色棋盘格"
            />
            <button
              type="button"
              className={`bg-btn bg-black ${bgStyle === 'black' ? 'active' : ''}`}
              onClick={() => setBgStyle('black')}
              title="纯黑背景"
            />
            <button
              type="button"
              className={`bg-btn bg-white ${bgStyle === 'white' ? 'active' : ''}`}
              onClick={() => setBgStyle('white')}
              title="纯白背景"
            />
            <button
              type="button"
              className={`bg-btn bg-green ${bgStyle === 'green' ? 'active' : ''}`}
              onClick={() => setBgStyle('green')}
              title="绿幕扣像"
            />
          </div>

          <button
            type="button"
            className="tool-toggle-btn raw-view-btn"
            onClick={() => setShowRawModal(true)}
            disabled={!anim}
            title="查看当前素材未切片的原始完整图片 (Spritesheet / 原图)"
          >
            <IconEye size={12} style={{ marginRight: 4 }} /> 查看原始图片
          </button>

          <button
            type="button"
            className={`tool-toggle-btn ${showCrosshair ? 'active' : ''}`}
            onClick={() => setShowCrosshair(!showCrosshair)}
            title="中心十字对齐辅助线"
          >
            <IconCrosshair size={12} style={{ marginRight: 4 }} /> 十字线
          </button>

          <div className="zoom-controls">
            <button type="button" className="zoom-btn" onClick={() => handleManualZoom(-1)}>−</button>
            <span className="zoom-value">{Number(zoom.toFixed(2))}x</span>
            <button type="button" className="zoom-btn" onClick={() => handleManualZoom(1)}>＋</button>
            <button
              type="button"
              className={`zoom-fit-btn ${isFit ? 'active' : ''}`}
              onClick={handleToggleFit}
              title={isFit ? '已开启视口自适应 (点击退出)' : '开启自适应视口 (切换素材自动 Fit)'}
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`pro-canvas-stage stage-${bgStyle}`}
        onDoubleClick={() => anim && setShowRawModal(true)}
        title="双击直接查看原始完整大图 (也可点击右上角「查看原始图片」按钮)"
      >
        {loading && <div className="canvas-loading"><span>正在加载像素帧数据…</span></div>}

        {!anim && !loading && (
          <div className="canvas-empty">
            <IconPalette size={40} className="empty-icon" style={{ opacity: 0.5, marginBottom: 8 }} />
            <h3>欢迎使用素材管理器</h3>
            <p>从左侧目录中选择任意素材，即可在此处进行专业像素预览、逐帧微调与一键导出</p>
          </div>
        )}

        {anim && !loading && data && data.kind === 'gif' && (
          <div className="canvas-wrapper" style={{ width: Math.round((data.width || 128) * zoom), height: Math.round((data.height || 128) * zoom) }}>
            <img src={data.url} alt={anim.name} className="pro-gif-img" style={{ width: '100%', height: '100%' }} />
          </div>
        )}

        {anim && !loading && data && data.kind !== 'gif' && frameW > 0 && frameH > 0 && (
          <div className="canvas-wrapper" style={{ width: Math.round(frameW * zoom), height: Math.round(frameH * zoom) }} onDoubleClick={() => setShowRawModal(true)} title="双击直接查看原始完整大图">
            <canvas ref={canvasRef} style={{ width: Math.round(frameW * zoom), height: Math.round(frameH * zoom) }} className="pro-canvas" />
            {showCrosshair && (
              <div className="canvas-crosshair">
                <div className="crosshair-h" />
                <div className="crosshair-v" />
              </div>
            )}
          </div>
        )}
      </div>

      {anim && data && data.kind !== 'gif' && (
        <Filmstrip
          data={data}
          currentIdx={idx}
          onSelectFrame={step => {
            setPlaying(false)
            playingRef.current = false
            idxRef.current = step
            setIdx(step)
            renderFrameToCanvas(step)
            if (sliderRef.current) sliderRef.current.value = step
            if (counterRef.current) counterRef.current.innerHTML = `<strong>${step + 1}</strong> / ${frameCount} 帧`
          }}
        />
      )}

      {anim && data && data.kind !== 'gif' && (
        <div className="pro-transport-bar">
          <div className="transport-left">
            <button
              type="button"
              className="transport-btn step-btn"
              onClick={() => stepFrame(-1)}
              disabled={frameCount <= 1}
              title="上一帧 (←)"
            >
              <IconStepBack size={14} />
            </button>
            <button
              type="button"
              className={`transport-btn play-btn ${playing ? 'playing' : ''}`}
              onClick={handleTogglePlay}
              disabled={frameCount <= 1}
              title="播放 / 暂停 (Space)"
            >
              {playing ? (
                <>
                  <IconPause size={12} style={{ verticalAlign: -1, marginRight: 4 }} />暂停
                </>
              ) : (
                <>
                  <IconPlay size={12} style={{ verticalAlign: -1, marginRight: 4 }} />播放
                </>
              )}
            </button>
            <button
              type="button"
              className="transport-btn step-btn"
              onClick={() => stepFrame(1)}
              disabled={frameCount <= 1}
              title="下一帧 (→)"
            >
              <IconStepForward size={14} />
            </button>

            <div className="playmode-group">
              <button
                type="button"
                className={`playmode-btn ${playMode === 'loop' ? 'active' : ''}`}
                onClick={() => setPlayMode('loop')}
                title="循环播放"
              >
                循环
              </button>
              <button
                type="button"
                className={`playmode-btn ${playMode === 'pingpong' ? 'active' : ''}`}
                onClick={() => setPlayMode('pingpong')}
                title="往返播放"
              >
                往返
              </button>
              <button
                type="button"
                className={`playmode-btn ${playMode === 'once' ? 'active' : ''}`}
                onClick={() => setPlayMode('once')}
                title="单次播放"
              >
                单次
              </button>
            </div>
          </div>

          <div className="transport-center">
            <input
              ref={sliderRef}
              type="range"
              min={0}
              max={Math.max(frameCount - 1, 0)}
              defaultValue={idx}
              disabled={frameCount <= 1}
              onChange={e => {
                const next = +e.target.value
                setPlaying(false)
                playingRef.current = false
                idxRef.current = next
                setIdx(next)
                renderFrameToCanvas(next)
                if (counterRef.current) counterRef.current.innerHTML = `<strong>${next + 1}</strong> / ${frameCount} 帧`
              }}
              className="timeline-slider"
            />
            <span ref={counterRef} className="frame-counter">
              <strong>{idx + 1}</strong> / {frameCount} 帧
            </span>
          </div>

          <div className="transport-right">
            <label className="fps-label" title="调整动画帧率">
              <span>FPS: <strong>{fps}</strong></span>
              <input
                type="range"
                min={1}
                max={60}
                value={fps}
                onChange={e => setFps(+e.target.value)}
                className="fps-slider"
              />
            </label>
          </div>
        </div>
      )}

      {showRawModal && (
        <RawImageModal
          anim={activePreviewAnim || anim}
          onClose={() => setShowRawModal(false)}
        />
      )}
    </div>
  )
}