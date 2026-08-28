import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { extOf, supportsDirectoryPicker, scanRootHandle, scanFallbackFiles, saveRootHandle, loadRootHandle, entryBlob } from '../asset/lib/scanner.js'
import { clusterFiles, naturalCompare } from '../asset/lib/cluster.js'
import { resolveSheetFrames } from '../asset/lib/sheet.js'
import { downloadBlob, downloadFrames, exportFramesToFolder, buildExportItems, copyText } from '../asset/lib/export.js'

const TYPE_ICON = { sequence: '▶', sheet: '▦', gif: '🖼', single: '▢' }
const PAGE_SIZE = 400

function useToast () {
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const toast = useCallback(text => {
    setMsg(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 3200)
  }, [])
  return { msg, toast }
}

// ---------- 预览面板 ----------
const previewCache = new Map()

async function loadAnimData (anim, cfg) {
  if (anim.type === 'gif') {
    const blob = await entryBlob(anim.entry)
    return { kind: 'gif', url: URL.createObjectURL(blob), frames: [], file: blob }
  }
  if (anim.type === 'single') {
    const blob = await entryBlob(anim.entry)
    return { kind: 'sequence', frames: [await createImageBitmap(blob)], fps: 0 }
  }
  if (anim.type === 'sequence') {
    const frames = []
    for (const f of anim.files) {
      const blob = await entryBlob(f)
      frames.push(await createImageBitmap(blob))
    }
    return { kind: 'sequence', frames, fps: anim.fps || 15 }
  }
  if (anim.type === 'sheet') {
    const blob = await entryBlob(anim.entry)
    const image = await createImageBitmap(blob)
    const frames = resolveSheetFrames(image, anim.metaFrames, cfg)
    return { kind: frames.length ? 'sheet' : 'sequence', image, frames: frames.length ? frames : [{ x: 0, y: 0, w: image.width, h: image.height }], fps: anim.fps || 15 }
  }
  return null
}

function PreviewPane ({ anim, cfg, onFrameData, onToast }) {
  const canvasRef = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [fps, setFps] = useState(anim?.fps || 15)
  const [loop, setLoop] = useState(true)
  const [zoom, setZoom] = useState(4)

  useEffect(() => { setFps(anim?.fps || 15); setZoom(4); setIdx(0); setPlaying(true) }, [anim?.id])

  useEffect(() => {
    let cancelled = false
    setData(null)
    onFrameData(null)
    if (!anim) return
    const key = anim.id + '|' + (anim.type === 'sheet' ? JSON.stringify(cfg || {}) : '')
    setLoading(true)
    const cached = previewCache.get(key)
    const p = cached || loadAnimData(anim, cfg)
    if (!cached) previewCache.set(key, p)
    p
      .then(d => { if (!cancelled) { setData(d); onFrameData(d); setIdx(0) } })
      .catch(e => { if (!cancelled) onToast('预览失败：' + e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [anim, cfg, onFrameData, onToast])

  const frameCount = data && data.kind !== 'gif' ? (data.frames?.length || 0) : 0
  useEffect(() => {
    if (!data || data.kind === 'gif' || !playing || frameCount <= 1) return
    const t = setInterval(() => {
      setIdx(i => loop ? (i + 1) % frameCount : Math.min(i + 1, frameCount - 1))
    }, (1000 / (fps || 15)))
    return () => clearInterval(t)
  }, [data, playing, fps, loop, frameCount])

  // 绘制
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !data || data.kind === 'gif') return
    const frame = data.frames[Math.min(idx, data.frames.length - 1)]
    if (!frame) return
    const ctx = cv.getContext('2d')
    if (data.kind === 'sheet') {
      cv.width = frame.w
      cv.height = frame.h
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, frame.w, frame.h)
      ctx.drawImage(data.image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h)
    } else {
      cv.width = frame.width
      cv.height = frame.height
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(frame, 0, 0)
    }
  }, [data, idx])

  const frameW = data && data.kind !== 'gif' && data.frames[0] ? (data.kind === 'sheet' ? data.frames[0].w : data.frames[0].width) : 0
  const frameH = data && data.kind !== 'gif' && data.frames[0] ? (data.kind === 'sheet' ? data.frames[0].h : data.frames[0].height) : 0

  return (
    <>
      <div className="am-preview">
        {!anim && <div className="empty">从左侧选择一个素材<br />支持 单帧连播 / spritesheet / GIF</div>}
        {anim && loading && <div className="empty">加载中…</div>}
        {anim && !loading && data && data.kind === 'gif' && (
          <img src={data.url} alt={anim.name} style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }} />
        )}
        {anim && !loading && data && data.kind !== 'gif' && (
          <canvas
            ref={canvasRef}
            style={{ width: frameW * zoom, height: frameH * zoom, imageRendering: 'pixelated' }}
          />
        )}
      </div>
      {anim && data && data.kind !== 'gif' && (
        <div className="am-controls">
          <div className="playbar">
            <button type="button" onClick={() => setPlaying(p => !p)} disabled={frameCount <= 1}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
            <input type="range" min={0} max={Math.max(frameCount - 1, 0)} value={idx} disabled={frameCount <= 1}
              onChange={e => { setIdx(+e.target.value); setPlaying(false) }} />
            <span className="frame-label">{frameCount > 0 ? (idx + 1) + ' / ' + frameCount : '—'}</span>
          </div>
          <div className="playbar" style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>fps
              <input type="range" min={1} max={30} value={fps} style={{ width: 120, marginLeft: 8 }} onChange={e => setFps(+e.target.value)} />
              {fps}
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>缩放
              <input type="range" min={1} max={16} value={zoom} style={{ width: 120, marginLeft: 8 }} onChange={e => setZoom(+e.target.value)} />
              {zoom}x
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> 循环
            </label>
          </div>
        </div>
      )}
    </>
  )
}

// ---------- 主页面 ----------
export default function AssetManagerPage () {
  const { msg: toastMsg, toast } = useToast()
  const fileInputRef = useRef(null)
  const [rootInfo, setRootInfo] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | scanning | ready | error
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState(null)
  const [images, setImages] = useState([])
  const [anims, setAnims] = useState([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [sheetCfg, setSheetCfg] = useState({})
  const [frameData, setFrameData] = useState(null)

  const selected = useMemo(() => anims.find(a => a.id === selectedId) || null, [anims, selectedId])

  const runScan = useCallback(async (rootOrFiles, isHandle) => {
    setPhase('scanning')
    setProgress(0)
    setImages([]); setAnims([]); setSelectedId(null)
    try {
      const res = isHandle
        ? await scanRootHandle(rootOrFiles, p => setProgress(p))
        : scanFallbackFiles(rootOrFiles, p => setProgress(p))
      setImages(res.images)
      const list = await clusterFiles(res.images, res.metas)
      setAnims(list)
      setSelectedId(list[0] ? list[0].id : null)
      setStats({ images: res.images.length, anims: list.length, root: isHandle ? rootOrFiles.name : '(所选文件夹)' })
      setPhase('ready')
      toast('扫描完成：' + res.images.length + ' 张图 / ' + list.length + ' 个动画组')
    } catch (e) {
      setPhase('error')
      toast('扫描失败：' + e.message)
    }
  }, [toast])

  // 启动时尝试恢复上次授权目录
  useEffect(() => {
    (async () => {
      if (!supportsDirectoryPicker()) return
      const handle = await loadRootHandle()
      if (!handle || handle.kind !== 'directory') return
      try {
        const perm = await handle.queryPermission({ mode: 'read' })
        if (perm === 'granted') {
          setRootInfo({ type: 'handle', name: handle.name })
          await runScan(handle, true)
        }
      } catch (e) { /* 忽略：等待用户手动选择 */ }
    })()
  }, [runScan])

  const pickLibrary = async () => {
    if (supportsDirectoryPicker()) {
      try {
        const handle = await window.showDirectoryPicker({ id: 'asset-library', mode: 'readwrite' })
        await saveRootHandle(handle)
        setRootInfo({ type: 'handle', name: handle.name })
        await runScan(handle, true)
      } catch (e) {
        if (e.name !== 'AbortError') toast('选择目录失败：' + e.message)
      }
    } else {
      fileInputRef.current?.click()
    }
  }

  const onFallbackFiles = async e => {
    const list = e.target.files
    if (!list || !list.length) return
    setRootInfo({ type: 'fallback', name: '(所选择文件夹)' })
    await runScan(list, false)
    e.target.value = ''
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return anims
    const q = query.trim().toLowerCase()
    return anims.filter(a => a.name.toLowerCase().includes(q) || a.rel.toLowerCase().includes(q) || a.dir.toLowerCase().includes(q))
  }, [anims, query])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const a of filtered) {
      const pack = a.dir ? a.dir.split('/')[0] : '(根目录)'
      if (!map.has(pack)) map.set(pack, [])
      map.get(pack).push(a)
    }
    return Array.from(map.entries())
  }, [filtered])

  const shown = useMemo(() => {
    const out = []
    let left = visible
    for (const [pack, list] of grouped) {
      if (left <= 0) break
      const take = list.slice(0, left)
      out.push([pack, take])
      left -= take.length
    }
    return out
  }, [grouped, visible])

  const exportItems = useMemo(() => {
    if (!selected || !frameData) return []
    if (selected.type === 'single') return [{ name: selected.entry.name, blob: frameData.file || null, rel: selected.rel }]
    if (selected.type === 'gif') return [{ name: selected.entry.name, blob: frameData.file || null, rel: selected.rel }]
    return null
  }, [selected, frameData])

  const handleExport = async mode => {
    if (!selected) return
    if (mode === 'folder' && !modalSafe()) { toast('此浏览器不支持写入导出目录'); return }
    try {
      const items = await buildExportItems(selected, frameData)
      if (!items.length) { toast('没有可导出的帧'); return }
      if (mode === 'folder') {
        const dest = await window.showDirectoryPicker({ mode: 'readwrite', id: 'asset-export' })
        await exportFramesToFolder(dest, items)
        toast('已导出 ' + items.length + ' 个文件到所选文件夹')
      } else {
        await downloadFrames(items)
        toast('已开始下载 ' + items.length + ' 个文件')
      }
    } catch (e) {
      if (e.name !== 'AbortError') toast('导出失败：' + e.message)
    }
  }

  const handleCopyPath = async () => {
    if (!selected) return
    const ok = await copyText(selected.rel)
    toast(ok ? '已复制相对路径：' + selected.rel : '复制失败')
  }

  const onDropExport = async e => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    const anim = anims.find(a => a.id === id)
    if (!anim) return
    setSelectedId(anim.id)
    toast('拖拽导出：' + anim.name)
    try {
      const items = await buildExportItems(anim, null)
      await downloadFrames(items)
      toast('已开始下载：' + anim.name)
    } catch (err) {
      toast('拖拽导出失败：' + err.message)
    }
  }

  const onDragOver = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }

  return (
    <motion.div
      className="am-shell"
      initial={{ opacity: 0, scale: 0.98, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -16, filter: 'blur(4px)' }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="am-header">
        <Link className="hub-back" to="/">← 工具合集</Link>
        <div className="am-title">🖼 素材管理器 <em className="version-tag">v0.1.0 · beta</em></div>
        <button className="btn primary" type="button" onClick={pickLibrary}>
          {rootInfo ? '重新选择素材库' : '选择素材库'}
        </button>
        {rootInfo && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{rootInfo.name}</span>}
        <input ref={fileInputRef} type="file" webkitdirectory multiple hidden onChange={onFallbackFiles} />
      </header>

      <div className="am-body">
        <aside className="am-side">
          <div className="am-side-top">
            <input className="am-search" placeholder="🔍 搜索动画名 / 路径…" value={query}
              onChange={e => { setQuery(e.target.value); setVisible(PAGE_SIZE) }} />
          </div>
          <div className="am-list">
            {phase === 'scanning' && <div className="empty">扫描中… {progress.toLocaleString()} 个文件</div>}
            {phase === 'idle' && <div className="empty">点击「选择素材库」<br />授权 D:\YAHZJ\技能素材</div>}
            {phase !== 'scanning' && phase !== 'idle' && !shown.length && <div className="empty">无匹配素材</div>}
            {shown.map(([pack, list]) => (
              <div key={pack}>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '6px 10px 2px' }}>{pack}</div>
                {list.map(a => (
                  <div key={a.id} className={'anim-row' + (a.id === selectedId ? ' selected' : '')}
                    draggable onClick={() => { setSelectedId(a.id); setVisible(visible) }}
                    onDragStart={e => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'copy' }}
                    title={a.rel}>
                    <span className="icon">{TYPE_ICON[a.type] || '▪'}</span>
                    <span className="meta">
                      <div className="name">{a.name}</div>
                      <div className="dir">{a.dir || '(根目录)'}{a.loose ? ' · 序列池' : ''}</div>
                    </span>
                    <span className="count">{a.count || ''}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {filtered.length > visible && (
            <button className="am-more" type="button" onClick={() => setVisible(v => v + PAGE_SIZE)}>
              显示更多（{filtered.length - visible} 个待显示）
            </button>
          )}
        </aside>

        <main className="am-main">
          {selected && (
            <PreviewPane
              anim={selected}
              cfg={sheetCfg[selected.id]}
              onFrameData={setFrameData}
              onToast={toast}
            />
          )}
          {!selected && (
            <div className="am-preview">
              <div className="empty">请从左侧列表选择一个动画或图片</div>
            </div>
          )}
        </main>

        <aside className="am-info">
          <h2>素材属性</h2>
          {!selected && <div className="empty">未选中任何素材</div>}
          {selected && (
            <>
              <div className="info-grid">
                <span className="k">类型</span><span className="v">{selected.type.toUpperCase()}</span>
                <span className="k">名称</span><span className="v">{selected.name}</span>
                <span className="k">帧数</span><span className="v">{selected.count || (frameData?.frames?.length || 1)}</span>
                {frameData && (
                  <>
                    <span className="k">尺寸</span>
                    <span className="v">
                      {frameData.frames?.[0] ? `${frameData.frames[0].w || frameData.frames[0].width} × ${frameData.frames[0].h || frameData.frames[0].height}` : '--'}
                    </span>
                  </>
                )}
              </div>

              <div className="path-box">
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>相对路径（浏览器安全限制，不提供绝对路径）</div>
                {selected.rel}
              </div>

              <div className="am-actions">
                <button className="btn" type="button" onClick={handleCopyPath}>📋 复制路径</button>
                <button className="btn" type="button" onClick={() => handleExport('download')} disabled={!exportItems && !(frameData && frameData.frames && frameData.frames.length)}>
                  ⬇ 导出全部帧
                </button>
                <button className="btn" type="button" onClick={() => handleExport('folder')} disabled={!exportItems && !(frameData && frameData.frames && frameData.frames.length)}>
                  📁 导出到文件夹…
                </button>
                {[ 'single', 'gif' ].includes(selected.type) && exportItems && exportItems[0] && (
                  <button className="btn" type="button" onClick={async () => {
                    try {
                      const blob = frameData?.file || await entryBlob(selected.entry)
                      downloadBlob(blob, selected.entry.name)
                      toast('已下载：' + selected.entry.name)
                    } catch (e) { toast(e.message) }
                  }}>⬇ 下载原文件</button>
                )}
              </div>

              {selected.type === 'sheet' && (
                <div className="sheet-cfg">
                  <h3>spritesheet 切分 {selected.metaFrames ? '（已读取 txt 元数据 ✓）' : '（无元数据，自动/手动）'}</h3>
                  {!selected.metaFrames && (
                    <>
                      <label>列数 <input type="number" min={1} value={sheetCfg[selectedId]?.cols || ''} placeholder="自动"
                        onChange={e => setSheetCfg(s => ({ ...s, [selectedId]: { ...s[selectedId], cols: +e.target.value || undefined } }))} /></label>
                      <label>行数 <input type="number" min={1} value={sheetCfg[selectedId]?.rows || ''} placeholder="自动"
                        onChange={e => setSheetCfg(s => ({ ...s, [selectedId]: { ...s[selectedId], rows: +e.target.value || undefined } }))} /></label>
                      <label>帧宽 <input type="number" min={1} value={sheetCfg[selectedId]?.cellW || ''} placeholder="自动"
                        onChange={e => setSheetCfg(s => ({ ...s, [selectedId]: { ...s[selectedId], cellW: +e.target.value || undefined } }))} /></label>
                      <label>帧高 <input type="number" min={1} value={sheetCfg[selectedId]?.cellH || ''} placeholder="自动"
                        onChange={e => setSheetCfg(s => ({ ...s, [selectedId]: { ...s[selectedId], cellH: +e.target.value || undefined } }))} /></label>
                    </>
                  )}
                </div>
              )}

              <div className={'am-dropzone'} onDragOver={onDragOver} onDrop={onDropExport}>
                🎯 把左侧素材拖到这里 → 自动下载导出
              </div>
            </>
          )}
        </aside>
      </div>

      <footer className="am-footer">
        <span>{stats ? stats.images.toLocaleString() + ' 张图片' : '未扫描'}</span>
        <span>{stats ? stats.anims.toLocaleString() + ' 个动画组' : ''}</span>
        <span>{rootInfo ? (rootInfo.type === 'handle' ? 'File System Access · 已记忆授权' : 'webkitdirectory · 临时读取') : ''}</span>
        <span style={{ marginLeft: 'auto' }}>本地处理 · 不上传服务器</span>
      </footer>

      <AnimatePresence>
        {toastMsg && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function modalSafe () {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}