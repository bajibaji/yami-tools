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
  IconStepForward
} from './icons.jsx'

// 加载单个动画的帧位图（只为当前选中的单个动画服务，避免内存暴涨）
export async function loadAnimData (anim, cfg) {
  if (!anim) return null
  if (anim.type === 'gif') {
    const blob = await entryBlob(anim.entry)
    return { kind: 'gif', url: URL.createObjectURL(blob), frames: [], file: blob }
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
    const frames = resolveStripFrames(image, cfg)
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

// 预览数据 MRU 缓存：避免来回切换动画重复解码，LRU 上限 8 个动画
const previewCache = new Map()
const PREVIEW_CACHE_MAX = 8
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
      oldest[1].promise.then(d => {
        if (d && d.frames) for (const bmp of d.frames) bmp.close && bmp.close()
        if (d && d.kind === 'gif' && d.url) URL.revokeObjectURL(d.url)
      }).catch(() => {})
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

export const Thumb = memo(function Thumb ({ entry, size = 32, className = 'am-thumb', thumbSpec = null }) {
  const [url, setUrl] = useState(() => getMemCachedThumb(entry, thumbSpec))
  const [isVisible, setIsVisible] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    const cached = getMemCachedThumb(entry, thumbSpec)
    if (cached) {
      setUrl(cached)
      return
    }

    const el = containerRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setIsVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '100px' })
    observer.observe(el)
    return () => observer.disconnect()
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

// ---------- 文件夹 GIF 预览 ----------
export function FolderPreview ({ entry, size = 28 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    if (!entry) return
    entryBlob(entry).then(blob => { if (alive) setUrl(URL.createObjectURL(blob)) }).catch(() => {})
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [entry?.rel])
  return (
    <span className="am-thumb" style={{ width: size, height: size, flex: 'none' }}>
      {url ? <img src={url} width={size} height={size} alt="" style={{ objectFit: 'cover' }} /> : null}
    </span>
  )
}

// ---------- 画廊网格卡片（轻量高效，0 内存浪费，支持卡片快捷收藏） ----------
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
  onSelect,
  onToggleFav,
  onToggleMulti,
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
    if (anim.type === 'sheet') return <IconLayers size={10} />
    if (anim.type === 'strip') return <IconFilm size={10} />
    if (anim.type === 'sequence') return <IconSparkles size={10} />
    return <IconImage size={10} />
  }

  return (
    <motion.div
      data-anim-id={anim.id}
      className={`gallery-card ${selected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
      onClick={() => onSelect(anim.id)}
      onDoubleClick={() => onDoubleClick?.(anim)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
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
        {hover && previewGifUrl ? (
          <img src={previewGifUrl} className="gallery-thumb-img" alt="" />
        ) : (
          <Thumb entry={anim.entry} size={thumbSize} className="gallery-thumb-img" thumbSpec={(anim.type === 'strip' || anim.type === 'sheet') ? GRID_THUMB_SPEC : null} />
        )}

        <div className="gallery-badges">
          <span className={`type-badge type-${anim.type}`}>
            {renderTypeIcon()}
            <span>{anim.type === 'strip' ? 'STRIP' : anim.type.toUpperCase()}</span>
          </span>
          {anim.count > 1 && <span className="count-badge">{anim.count} 帧</span>}
          {anim.asepriteEntry && <span className="count-badge ase-badge" title="含 Aseprite 原工程源文件">.ASE</span>}
        </div>

        {/* 缩略图快捷收藏星星按钮 */}
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
    </motion.div>
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

// ---------- 专业视口工作台 (Pro Canvas Viewport) ----------
export function PreviewPane ({ anim, cfg, onFrameData, onToast, onCfgChange, onOpenFolder }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [fps, setFps] = useState(anim?.fps || 15)
  const [zoom, setZoom] = useState(4)
  const [playMode, setPlayMode] = useState('loop') // 'loop' | 'once' | 'pingpong'
  const [direction, setDirection] = useState(1)
  const [bgStyle, setBgStyle] = useState('checker-dark') // 'checker-dark' | 'checker-light' | 'black' | 'white' | 'green'
  const [showCrosshair, setShowCrosshair] = useState(false)

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

  useEffect(() => {
    setFps(anim?.fps || 15)
    setIdx(0)
    idxRef.current = 0
    setPlaying(true)
    setDirection(1)
  }, [animId])

  const loadTokenRef = useRef(0)

  useEffect(() => {
    if (!animId || !animRef.current) {
      setData(null)
      onFrameDataRef.current?.(null)
      setLoading(false)
      return
    }

    const token = ++loadTokenRef.current
    setLoading(true)
    loadAnimDataCached(animRef.current, cfg)
      .then(d => {
        if (token !== loadTokenRef.current) {
          if (d?.kind === 'gif' && d.url) URL.revokeObjectURL(d.url)
          return
        }
        setData(d)
        onFrameDataRef.current?.(d)
        setIdx(0)
        idxRef.current = 0
      })
      .catch(e => {
        if (token === loadTokenRef.current) onToastRef.current?.('预览失败：' + e.message)
      })
      .finally(() => {
        if (token === loadTokenRef.current) setLoading(false)
      })
  }, [animId, cfgKey])

  const frameCount = data && data.kind !== 'gif' ? (data.frames?.length || 0) : 0

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
          setIdx(nextIdx)
          renderFrameToCanvas(nextIdx)
        }
      }
      reqId = requestAnimationFrame(animate)
    }

    reqId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(reqId)
  }, [data, frameCount, renderFrameToCanvas])

  useEffect(() => {
    renderFrameToCanvas(idx)
  }, [idx, renderFrameToCanvas])

  const frameW = data && data.kind !== 'gif' && data.frames[0] ? (data.kind === 'sheet' ? data.frames[0].w : data.frames[0].width) : 0
  const frameH = data && data.kind !== 'gif' && data.frames[0] ? (data.kind === 'sheet' ? data.frames[0].h : data.frames[0].height) : 0

  // 视口工作台原生滚轮直接放大/缩小（无需按住 Ctrl，直接滑轮 1x~32x）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -1 : 1
      setZoom(z => Math.max(1, Math.min(32, z + delta)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const stepFrame = (step) => {
    if (frameCount <= 1) return
    setPlaying(false)
    const next = (idx + step + frameCount) % frameCount
    idxRef.current = next
    setIdx(next)
    renderFrameToCanvas(next)
  }

  const handleFit = () => {
    if (!frameW || !frameH || !containerRef.current) return
    const cw = containerRef.current.clientWidth - 80
    const ch = containerRef.current.clientHeight - 80
    const scale = Math.max(1, Math.floor(Math.min(cw / frameW, ch / frameH)))
    setZoom(Math.min(16, scale))
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
          {animRef.current?.type === 'strip' && (
            <label className="strip-variant-select" title="切换颜色变体（每一行一种颜色，在视口处操作）">
              <span className="dim-info">变体</span>
              <select
                value={cfg?.variant ?? 'all'}
                onChange={e => {
                  const v = e.target.value === 'all' ? 'all' : +e.target.value
                  onCfgChangeRef.current?.({ variant: v })
                }}
              >
                <option value="all">全部颜色</option>
                {Array.from({ length: Math.max(1, Math.round(((data?.image && data.image.height) || 576) / 64)) }, (_, i) => (
                  <option key={i} value={i}>{'颜色 ' + (i + 1)}</option>
                ))}
              </select>
            </label>
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
            className={`tool-toggle-btn ${showCrosshair ? 'active' : ''}`}
            onClick={() => setShowCrosshair(!showCrosshair)}
            title="中心十字对齐辅助线"
          >
            <IconCrosshair size={12} style={{ marginRight: 4 }} /> 十字线
          </button>

          <div className="zoom-controls">
            <button type="button" className="zoom-btn" onClick={() => setZoom(z => Math.max(1, z - 1))}>−</button>
            <span className="zoom-value">{zoom}x</span>
            <button type="button" className="zoom-btn" onClick={() => setZoom(z => Math.min(16, z + 1))}>＋</button>
            <button type="button" className="zoom-fit-btn" onClick={handleFit} title="适应视口">Fit</button>
          </div>
        </div>
      </div>

      <div
        className={`pro-canvas-stage stage-${bgStyle}`}
        onDoubleClick={() => onOpenFolder?.(anim)}
        title="双击直接在系统文件管理器中定位打开所在文件夹"
      >
        {loading && <div className="canvas-loading"><span>正在加载像素帧数据…</span></div>}

        {!anim && !loading && (
          <div className="canvas-empty">
            <IconPalette size={40} className="empty-icon" style={{ opacity: 0.5, marginBottom: 8 }} />
            <h3>欢迎使用素材管理器 Pro</h3>
            <p>从左侧目录中选择任意素材，即可在此处进行专业像素预览、逐帧微调与一键导出</p>
          </div>
        )}

        {anim && !loading && data && data.kind === 'gif' && (
          <div className="canvas-img-container" style={{ transform: `scale(${zoom / 2})` }}>
            <img src={data.url} alt={anim.name} className="pro-gif-img" />
          </div>
        )}

        {anim && !loading && data && data.kind !== 'gif' && (
          <div className="canvas-wrapper" style={{ width: frameW * zoom, height: frameH * zoom }} onDoubleClick={() => onOpenFolderRef.current && onOpenFolderRef.current(animRef.current)} title="双击：在应用内定位到所在文件夹">
            <canvas ref={canvasRef} style={{ width: frameW * zoom, height: frameH * zoom }} className="pro-canvas" />
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
            idxRef.current = step
            setIdx(step)
            renderFrameToCanvas(step)
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
              onClick={() => setPlaying(!playing)}
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
              type="range"
              min={0}
              max={Math.max(frameCount - 1, 0)}
              value={idx}
              disabled={frameCount <= 1}
              onChange={e => {
                const next = +e.target.value
                setPlaying(false)
                idxRef.current = next
                setIdx(next)
                renderFrameToCanvas(next)
              }}
              className="timeline-slider"
            />
            <span className="frame-counter">
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
    </div>
  )
}