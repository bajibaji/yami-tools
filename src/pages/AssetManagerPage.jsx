// 素材管理器 Pro：工业级 100K+ 引擎（支持目录折叠 + 视口工作台自由拖拽调高）
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  supportsDirectoryPicker,
  streamScanRootHandle,
  scanFallbackFiles,
  saveRootHandle,
  loadRootHandle,
  entryBlob,
  cachedEntry
} from '../asset/lib/scanner.js'
import { clusterFiles } from '../asset/lib/cluster.js'
import {
  DEFAULT_TEMPLATE,
  downloadBlob,
  downloadFrames,
  exportFramesToFolder,
  buildExportItems,
  exportAnimToGif,
  copyText,
  sanitize
} from '../asset/lib/export.js'
import {
  dbAll,
  dbBulkPut,
  dbPut,
  dbDelete,
  dbClear,
  dbGet,
  dbQueryByIndex,
  dbSearchFiles
} from '../asset/lib/idb-store.js'
import { VirtualList, Thumb, PreviewPane, GalleryCard, GRID_THUMB_SPEC } from '../asset/comps.jsx'
import { prewarmThumbCache } from '../asset/lib/thumb.js'
import { writeManifest, readManifest, MANIFEST_NAME } from '../asset/lib/manifest.js'
import {
  IconFolder,
  IconFolderOpen,
  IconPackage,
  IconStar,
  IconSearch,
  IconRefresh,
  IconKey,
  IconPlay,
  IconPause,
  IconDownload,
  IconPalette,
  IconExternalLink,
  IconGrid,
  IconSplit,
  IconTable,
  IconKeyboard,
  IconLayers,
  IconFilm,
  IconSparkles,
  IconImage,
  IconChevronRight,
  IconChevronDown,
  IconActivity,
  IconArrowLeft,
  IconX,
  IconLayoutGrid,
  IconLayoutColumns
} from '../asset/icons.jsx'

const TYPE_ICONS = {
  all: <IconSparkles size={12} />,
  sequence: <IconSparkles size={12} />,
  sheet: <IconLayers size={12} />,
  strip: <IconFilm size={12} />,
  gif: <IconImage size={12} />,
  single: <IconImage size={12} />
}

const GALLERY_PAGE_SIZE = 48
const DEFAULT_VIEWPORT_HEIGHT = 380

function useToast () {
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const toast = useCallback(text => {
    setMsg(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 3600)
  }, [])
  return { msg, toast }
}

export default function AssetManagerPage () {
  const { msg: toastMsg, toast } = useToast()
  const fileInputRef = useRef(null)
  const searchInputRef = useRef(null)
  const catalogScrollRef = useRef(null)
  const explorerScrollRef = useRef(null)

  // 基础状态
  const [rootInfo, setRootInfo] = useState(null)
  const [dirHandle, setDirHandle] = useState(null)
  const dirHandleRef = useRef(null)
  dirHandleRef.current = dirHandle
  const [phase, setPhase] = useState('idle') // 'idle' | 'scanning' | 'ready' | 'error'
  const [totalFileCount, setTotalFileCount] = useState(0)

  // 顶级包索引列表
  const [packs, setPacks] = useState([]) // [{ name, count, dirs: [] }]
  const [selectedPack, setSelectedPack] = useState(null)
  const [dirFilter, setDirFilter] = useState(null)
  const [expandedPacks, setExpandedPacks] = useState(new Set()) // 折叠状态集合

  // 视口工作台动态高度调节（支持鼠标上下拖拽 + 本地持久化）
  const [viewportHeight, setViewportHeight] = useState(() => {
    const saved = localStorage.getItem('am_viewport_h')
    return saved ? Math.max(180, Math.min(850, +saved)) : DEFAULT_VIEWPORT_HEIGHT
  })
  const [isDraggingResizer, setIsDraggingResizer] = useState(false)
  const resizerStartYRef = useRef(0)
  const resizerStartHeightRef = useRef(DEFAULT_VIEWPORT_HEIGHT)

  // 当前活动目录下的动画列表
  const [activeAnims, setActiveAnims] = useState([])
  const [loadingDir, setLoadingDir] = useState(false)

  // 用户数据
  const [favAnims, setFavAnims] = useState(new Set())
  const [exportTemplate, setExportTemplate] = useState(DEFAULT_TEMPLATE)

  // 视图状态
  const [viewLayout, setViewLayout] = useState('split') // 'split' | 'gallery' | 'table'
  const [typeFilter, setTypeFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [subdirVisible, setSubdirVisible] = useState({})
  const searchIndexRef = useRef(null)
  const searchIndexReadyRef = useRef(false)
  const loadReqRef = useRef(0)
  const [visibleCount, setVisibleCount] = useState(GALLERY_PAGE_SIZE)

  // 选择与多选
  const [selectedId, setSelectedId] = useState(null)
  const [multiSel, setMultiSel] = useState(new Set())
  const [sheetCfg, setSheetCfg] = useState({})
  const [frameData, setFrameData] = useState(null)

  // 弹窗状态
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [gifBusy, setGifBusy] = useState(false)
  const [gifProgress, setGifProgress] = useState(0)

  // 扫描控制
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState('')
  const [pendingReauth, setPendingReauth] = useState(null)
  const abortRef = useRef(false)

  // 当前选中的动画对象
  const selected = useMemo(() => {
    return activeAnims.find(a => a.id === selectedId) || activeAnims[0] || null
  }, [activeAnims, selectedId])

  const animsCacheRef = useRef(new Map())
  const favObjectsMapRef = useRef(new Map())

  // 核心：按需加载当前目录/包的文件并秒级聚类（带内存高速缓存，二次切换 0ms 响应）
  const loadDirectoryData = useCallback(async (packName, dirPath, searchKeyword) => {
    if (packName === '__fav__') {
      let favList = Array.from(favObjectsMapRef.current.values())
      if (!favList.length) {
        const dbFavs = await dbAll('favorites')
        favList = dbFavs.filter(f => f && (f.id || f.key)).map(f => {
          const id = f.id || (String(f.key).startsWith('anim:') ? f.key.slice(5) : f.key)
          const animObj = {
            id,
            name: f.name || id.split('|').pop(),
            type: f.type || 'sheet',
            pack: f.pack || '我的收藏',
            dir: f.dir || '',
            rel: f.rel || '',
            count: f.count || 1,
            fps: f.fps || 15,
            entry: dirHandle ? cachedEntry(f.entryMeta || { rel: f.rel, name: f.name }, dirHandle) : null,
            files: [dirHandle ? cachedEntry(f.entryMeta || { rel: f.rel, name: f.name }, dirHandle) : null],
            metaEntry: f.metaEntryMeta && dirHandle ? cachedEntry(f.metaEntryMeta, dirHandle) : null,
            previewEntry: f.previewMeta && dirHandle ? cachedEntry(f.previewMeta, dirHandle) : null,
            asepriteEntry: f.asepriteMeta && dirHandle ? cachedEntry(f.asepriteMeta, dirHandle) : null,
            htmlEntry: f.htmlMeta && dirHandle ? cachedEntry(f.htmlMeta, dirHandle) : null
          }
          favObjectsMapRef.current.set(id, animObj)
          return animObj
        })
      }
      setActiveAnims(favList)
      if (favList.length > 0) {
        setSelectedId(prev => (favList.some(a => a.id === prev) ? prev : favList[0].id))
      }
      return
    }

    const cacheKey = searchKeyword && searchKeyword.trim()
      ? `q:${searchKeyword.trim()}`
      : (dirPath ? `dir:${dirPath}` : (packName ? `pack:${packName}` : 'all'))

    if (animsCacheRef.current.has(cacheKey)) {
      const cached = animsCacheRef.current.get(cacheKey)
      setActiveAnims(cached)
      if (cached.length > 0) {
        setSelectedId(prev => (cached.some(a => a.id === prev) ? prev : cached[0].id))
      }
      return
    }

    const myReq = ++loadReqRef.current
    setLoadingDir(true)
    try {
      let fileRecords = []

      if (searchKeyword && searchKeyword.trim()) {
        if (!searchIndexReadyRef.current) await buildSearchIndex()
        const q = searchKeyword.trim().toLowerCase()
        fileRecords = (searchIndexRef.current || []).filter(r => r.nameL.includes(q) || r.relL.includes(q)).slice(0, 120)
      } else if (dirPath) {
        fileRecords = await dbQueryByIndex('files', 'dir', dirPath, 3000)
      } else if (packName) {
        fileRecords = await dbQueryByIndex('files', 'pack', packName, 3000)
      }

      if (myReq !== loadReqRef.current) return
      if (fileRecords.length > 0 && dirHandle) {
        const images = fileRecords.filter(f => f.isImg).map(m => cachedEntry(m, dirHandle))
        const metas = fileRecords.filter(f => f.isMeta).map(m => cachedEntry(m, dirHandle))
        const animList = await clusterFiles(images, metas, {}, {})
        if (myReq !== loadReqRef.current) return
        animsCacheRef.current.set(cacheKey, animList)
        setActiveAnims(animList)
        // 批量预读前 36 个动画的缩略图缓存（单事务，避免每张卡一次事务）
        {
          const gridEntries = []
          const otherEntries = []
          for (const a of animList.slice(0, 36)) {
            if (a && a.entry) (a.type === 'strip' || a.type === 'sheet' ? gridEntries : otherEntries).push(a.entry)
          }
          if (gridEntries.length) prewarmThumbCache(gridEntries, GRID_THUMB_SPEC).catch(() => {})
          if (otherEntries.length) prewarmThumbCache(otherEntries, null).catch(() => {})
        }
        if (animList.length > 0) {
          setSelectedId(prev => (animList.some(a => a.id === prev) ? prev : animList[0].id))
        }
      } else {
        setActiveAnims([])
      }
    } catch (e) {
      // ignore
    } finally {
      if (myReq === loadReqRef.current) setLoadingDir(false)
    }
  }, [dirHandle]) // 注意：buildSearchIndex 在下方声明，只能在回调运行时引用（闭包绑定已初始化）

  // 搜索防抖 250ms
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 250)
    return () => clearTimeout(t)
  }, [queryInput])

  // 一次性构建内存搜索索引（避免每次按键全库 IDB 光标扫描）
  const buildSearchIndex = useCallback(async () => {
    if (searchIndexReadyRef.current) return
    try {
      const records = await dbAll('files')
      searchIndexRef.current = records.map(r => ({
        rel: r.rel, name: r.name,
        nameL: (r.name || '').toLowerCase(),
        relL: (r.rel || '').toLowerCase(),
        dir: r.dir, pack: r.pack || (r.rel && r.rel.includes('/') ? r.rel.split('/')[0] : '(根目录)'),
        isImg: r.isImg, isMeta: r.isMeta, ext: r.ext, size: r.size
      }))
      searchIndexReadyRef.current = true
      if (searchIndexRef.current.length > 0) toast('搜索索引已就绪（' + searchIndexRef.current.length.toLocaleString() + ' 条）')
    } catch (e) { /* ignore */ }
  }, [toast])

  // 切换包、子目录或搜索时按需加载
  useEffect(() => {
    if (phase !== 'ready') return
    if (selectedPack === '__fav__') return
    setVisibleCount(GALLERY_PAGE_SIZE)
    loadDirectoryData(selectedPack, dirFilter, query)
  }, [phase, selectedPack, dirFilter, query, loadDirectoryData])

  // 过滤动画
  const filteredAnims = useMemo(() => {
    let list = activeAnims
    if (typeFilter !== 'all') list = list.filter(a => a.type === typeFilter)
    return list
  }, [activeAnims, typeFilter])

  const visibleAnims = useMemo(() => {
    return filteredAnims.slice(0, visibleCount)
  }, [filteredAnims, visibleCount])

  // 触底加载更多
  const handleCatalogScroll = (e) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      if (visibleCount < filteredAnims.length) {
        setVisibleCount(prev => Math.min(filteredAnims.length, prev + GALLERY_PAGE_SIZE))
      }
    }
  }

  // ---------- 视口工作台上下拖拽高度调节 (Split Resizer) ----------
  const handleResizerMouseDown = (e) => {
    e.preventDefault()
    setIsDraggingResizer(true)
    resizerStartYRef.current = e.clientY
    resizerStartHeightRef.current = viewportHeight

    const onMouseMove = (moveEvent) => {
      const deltaY = resizerStartYRef.current - moveEvent.clientY // 向上拖高度变大，向下拖高度变小
      const newHeight = Math.max(160, Math.min(850, resizerStartHeightRef.current + deltaY))
      setViewportHeight(newHeight)
      localStorage.setItem('am_viewport_h', String(newHeight))
    }

    const onMouseUp = () => {
      setIsDraggingResizer(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // ---------- 仅选中包（不自动展开） ----------
  const handleSelectPack = (packName) => {
    setSelectedPack(packName)
    setDirFilter(null)
    setQuery('')
  }

  // ---------- 专门点击箭头折叠/展开 ----------
  const handleToggleExpand = (e, packName) => {
    e.stopPropagation()
    setExpandedPacks(prev => {
      const next = new Set(prev)
      if (next.has(packName)) next.delete(packName); else next.add(packName)
      return next
    })
  }

  // ---------- 打开所在文件夹：树定位 + 目录筛选 ----------
  const handleLocateFolder = (anim) => {
    if (!anim) return
    const packName = anim.pack
    setSelectedPack(packName)
    setDirFilter(anim.dir || null)
    setQueryInput('')
    setQuery('')
    setExpandedPacks(prev => new Set(prev).add(packName))
    requestAnimationFrame(() => {
      const root = explorerScrollRef.current
      if (!root) return
      const node = root.querySelector('[data-pack="' + packName + '"]')
      if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  // ---------- 包预聚类热备：后台把每个包的动画列表先算好，切换包 0ms ----------
  const warmupPacks = useCallback(async (packList) => {
    const dh = dirHandleRef.current
    if (!dh || !packList || !packList.length) return
    for (const p of packList.slice(0, 8)) {
      await new Promise(r => setTimeout(r, 0))
      if (animsCacheRef.current.has('pack:' + p.name)) continue
      try {
        const recs = await dbQueryByIndex('files', 'pack', p.name, 3000)
        const images = recs.filter(f => f.isImg).map(m => cachedEntry(m, dh))
        const metas = recs.filter(f => f.isMeta).map(m => cachedEntry(m, dh))
        animsCacheRef.current.set('pack:' + p.name, await clusterFiles(images, metas, {}, {}))
      } catch (e) { /* ignore */ }
    }
  }, [])

  // ---------- 切换到「我的收藏夹」（同步直读，0ms 瞬切无任何卡顿） ----------
  const handleSelectFavorites = () => {
    const favList = Array.from(favObjectsMapRef.current.values())
    setSelectedPack('__fav__')
    setDirFilter(null)
    setQuery('')
    setActiveAnims(favList)
    if (favList.length > 0) {
      setSelectedId(favList[0].id)
    } else {
      setSelectedId(null)
    }
  }

  // 流式扫描入库：分块 2000 个写入 IndexedDB
  const runStreamScan = useCallback(async (rootHandle) => {
    if (!rootHandle) return
    abortRef.current = false
    searchIndexRef.current = null
    searchIndexReadyRef.current = false
    setScanning(true)
    setScanInfo('正在增量同步素材库索引…')

    const packSummary = new Map()
    let totalCount = 0
    const allRecords = []

    try {
      // 旧索引快照 → 只写新增/变更，删除已消失文件（不再全量重写 11 万条）
      const prevMap = new Map((await dbAll('files')).map(f => [f.rel, f.size]))
      const seen = new Set()
      await dbClear('packs')

      const res = await streamScanRootHandle(rootHandle, {
        chunkSize: 2000,
        shouldAbort: () => abortRef.current,
        onProgress: (scanned, current) => {
          totalCount = scanned
          setScanInfo(`已索引 ${scanned.toLocaleString()} 个文件 · ${(current || '').split('/').pop()}`)
        },
        onBatch: async (chunk) => {
          const toPut = []
          for (const f of chunk) {
            const p = f.pack || '(根目录)'
            if (!packSummary.has(p)) packSummary.set(p, { name: p, count: 0, dirs: new Set() })
            const item = packSummary.get(p)
            item.count++
            if (f.dir) item.dirs.add(f.dir)
            allRecords.push(f)
            seen.add(f.rel)
            if (!prevMap.has(f.rel) || prevMap.get(f.rel) !== f.size) toPut.push(f)
          }
          if (toPut.length) await dbBulkPut('files', toPut.map(f => [f.rel, f]))
        }
      })

      if (!res.aborted) {
        const staleKeys = [...prevMap.keys()].filter(k => !seen.has(k))
        for (let i = 0; i < staleKeys.length; i += 300) {
          await Promise.all(staleKeys.slice(i, i + 300).map(k => dbDelete('files', k)))
          await new Promise(r => setTimeout(r, 0))
        }

        const packList = Array.from(packSummary.values()).map(p => ({
          name: p.name,
          count: p.count,
          dirs: Array.from(p.dirs).sort()
        })).sort((a, b) => (a.name === '(根目录)' ? -1 : a.name.localeCompare(b.name, 'en')))

        await dbBulkPut('packs', packList.map(p => [p.name, p]))
        setPacks(packList)
        setTotalFileCount(totalCount)
        setPhase('ready')
        if (packList.length > 0) {
          setSelectedPack(packList[0].name)
          setExpandedPacks(new Set([packList[0].name]))
        }
        buildSearchIndex()
        warmupPacks(packList)
        writeManifest(rootHandle, allRecords, packList).then(ok => {
          if (ok && !abortRef.current) setTimeout(() => toast('本地清单已更新（' + MANIFEST_NAME + '）'), 800)
        }).catch(() => {})
        const delta = staleKeys.length ? ('，清理 ' + staleKeys.length + ' 个已删除文件') : ''
        toast(`索引完成：共 ${totalCount.toLocaleString()} 个文件已就绪！` + delta)
      } else {
        toast('已暂停扫描')
      }
    } catch (e) {
      setPhase('error')
      toast(`扫描出错：${e.message}`)
    }
    setScanning(false)
    setScanInfo('')
  }, [toast, buildSearchIndex, warmupPacks])

  // 从库根目录清单秒恢复（换电脑/清缓存后），再后台增量校验
  const restoreFromManifest = useCallback(async (handle) => {
    const md = await readManifest(handle)
    if (!md || !md.files || !md.files.length) return false
    try {
      await dbClear('files')
      await dbClear('packs')
      for (let i = 0; i < md.files.length; i += 5000) {
        await dbBulkPut('files', md.files.slice(i, i + 5000).map(f => [f.rel, f]))
        await new Promise(r => setTimeout(r, 0))
      }
      const packList = md.packs && md.packs.length ? md.packs : []
      await dbBulkPut('packs', packList.map(p => [p.name, p]))
      setPacks(packList)
      setTotalFileCount(packList.reduce((s, p) => s + p.count, 0))
      setSelectedPack(packList[0] ? packList[0].name : null)
      setExpandedPacks(packList[0] ? new Set([packList[0].name]) : new Set())
      setPhase('ready')
      buildSearchIndex()
      warmupPacks(packList)
      toast('已从本地清单快速恢复索引，正在后台增量校验…')
      setTimeout(() => { runStreamScan(handle) }, 400)
      return true
    } catch (e) {
      return false
    }
  }, [buildSearchIndex, warmupPacks, runStreamScan, toast])

  // 初始化：0ms 秒开恢复索引
  useEffect(() => {
    (async () => {
      try {
        const [favList, tmp] = await Promise.all([
          dbAll('favorites'),
          dbGet('prefs', 'exportTemplate')
        ])
        const fav = new Set()
        for (const f of favList) {
          const id = f.id || (String(f.key).startsWith('anim:') ? f.key.slice(5) : f.key)
          if (id) fav.add(id)
        }
        setFavAnims(fav)
        if (tmp) setExportTemplate(tmp)
      } catch (e) {
        // ignore
      }

      if (!supportsDirectoryPicker()) return
      const handle = await loadRootHandle()
      if (!handle || handle.kind !== 'directory') return

      try {
        const perm = await handle.queryPermission({ mode: 'read' })
        if (perm === 'granted') {
          setRootInfo({ type: 'handle', name: handle.name })
          setDirHandle(handle)
        } else if (perm === 'prompt') {
          setPendingReauth(handle)

          if (favList && favList.length) {
            for (const f of favList) {
              const id = f.id || (String(f.key).startsWith('anim:') ? f.key.slice(5) : f.key)
              if (id) {
                favObjectsMapRef.current.set(id, {
                  id,
                  name: f.name || id.split('|').pop(),
                  type: f.type || 'sheet',
                  pack: f.pack || '我的收藏',
                  dir: f.dir || '',
                  rel: f.rel || '',
                  count: f.count || 1,
                  fps: f.fps || 15,
                  entry: cachedEntry(f.entryMeta || { rel: f.rel, name: f.name }, handle),
                  files: [cachedEntry(f.entryMeta || { rel: f.rel, name: f.name }, handle)],
                  metaEntry: f.metaEntryMeta ? cachedEntry(f.metaEntryMeta, handle) : null,
                  previewEntry: f.previewMeta ? cachedEntry(f.previewMeta, handle) : null,
                  asepriteEntry: f.asepriteMeta ? cachedEntry(f.asepriteMeta, handle) : null,
                  htmlEntry: f.htmlMeta ? cachedEntry(f.htmlMeta, handle) : null
                })
              }
            }
          }

          const cachedPacks = await dbAll('packs')
          if (cachedPacks.length > 0) {
            setPacks(cachedPacks)
            const total = cachedPacks.reduce((s, p) => s + p.count, 0)
            setTotalFileCount(total)
            setSelectedPack(cachedPacks[0].name)
            setExpandedPacks(new Set([cachedPacks[0].name]))
            setPhase('ready')
            buildSearchIndex()
            warmupPacks(cachedPacks)
          } else {
            const ok = await restoreFromManifest(handle)
            if (!ok) {
              setPhase('scanning')
              await runStreamScan(handle)
            }
          }
        }
      } catch (e) {
        // ignore
      }
    })()
  }, [runStreamScan, buildSearchIndex])

  // 一键重新授权上次素材库（Chrome 重启后权限会复位，此为浏览器限制）
  const reauthorize = async () => {
    const handle = pendingReauth
    if (!handle) return
    try {
      const perm = await handle.requestPermission({ mode: 'read' })
      if (perm !== 'granted') { toast('授权被拒绝，可点击「选择素材库」重新选择'); return }
      setPendingReauth(null)
      setRootInfo({ type: 'handle', name: handle.name })
      setDirHandle(handle)
      const cachedPacks = await dbAll('packs')
      if (cachedPacks.length) {
        setPacks(cachedPacks)
        setTotalFileCount(cachedPacks.reduce((s, p) => s + p.count, 0))
        setSelectedPack(cachedPacks[0].name)
        setExpandedPacks(new Set([cachedPacks[0].name]))
        setPhase('ready')
        buildSearchIndex()
        warmupPacks(cachedPacks)
        toast('已恢复上次素材库')
      } else {
        setPhase('scanning')
        await runStreamScan(handle)
      }
    } catch (e) {
      toast('授权失败：' + e.message)
    }
  }

  // 选择素材库
  const pickLibrary = async () => {
    if (supportsDirectoryPicker()) {
      try {
        const handle = await window.showDirectoryPicker({ id: 'asset-library', mode: 'readwrite' })
        await saveRootHandle(handle)
        setPendingReauth(null)
        setRootInfo({ type: 'handle', name: handle.name })
        setDirHandle(handle)
        setActiveAnims([])
        setSelectedId(null)
        const cachedPacks = await dbAll('packs')
        if (cachedPacks.length) {
          setPacks(cachedPacks)
          setTotalFileCount(cachedPacks.reduce((s, p) => s + p.count, 0))
          setSelectedPack(cachedPacks[0].name)
          setExpandedPacks(new Set([cachedPacks[0].name]))
          setPhase('ready')
          buildSearchIndex()
          warmupPacks(cachedPacks)
          toast('已打开本地索引（未重扫）；素材有变动时点「重新索引」')
          return
        }
        const ok = await restoreFromManifest(handle)
        if (ok) return
        setPacks([])
        setPhase('scanning')
        await runStreamScan(handle)
      } catch (e) {
        if (e.name !== 'AbortError') toast(`选择目录失败：${e.message}`)
      }
    } else {
      fileInputRef.current?.click()
    }
  }

  // ---------- 快捷键 ----------
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement === searchInputRef.current) {
        if (e.key === 'Escape') {
          setQuery('')
          searchInputRef.current?.blur()
        }
        return
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const curIdx = filteredAnims.findIndex(a => a.id === selectedId)
        if (curIdx >= 0 && curIdx < filteredAnims.length - 1) {
          setSelectedId(filteredAnims[curIdx + 1].id)
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const curIdx = filteredAnims.findIndex(a => a.id === selectedId)
        if (curIdx > 0) {
          setSelectedId(filteredAnims[curIdx - 1].id)
        }
      } else if (e.key === '?') {
        setShortcutsOpen(s => !s)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredAnims, selectedId])

  // ---------- 导出与收藏（0ms 响应，不刷新目录，静默写入 IndexedDB） ----------
  const toggleFav = useCallback((targetId) => {
    const id = (typeof targetId === 'string' ? targetId : null) || selected?.id
    if (!id || typeof id !== 'string') return
    const anim = activeAnims.find(a => a.id === id) || (selected?.id === id ? selected : null)

    setFavAnims(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        favObjectsMapRef.current.delete(id)
        dbDelete('favorites', `anim:${id}`).catch(() => {})
        toast('已取消收藏')
      } else {
        next.add(id)
        if (anim) {
          favObjectsMapRef.current.set(id, anim)
          const record = {
            id: anim.id,
            name: anim.name,
            type: anim.type,
            pack: anim.pack,
            dir: anim.dir,
            rel: anim.rel,
            count: anim.count,
            fps: anim.fps,
            entryMeta: anim.entry ? { name: anim.entry.name, rel: anim.entry.rel, dir: anim.entry.dir, ext: anim.entry.ext, size: anim.entry.size } : null,
            metaEntryMeta: anim.metaEntry ? { name: anim.metaEntry.name, rel: anim.metaEntry.rel, dir: anim.metaEntry.dir, ext: anim.metaEntry.ext, size: anim.metaEntry.size } : null,
            previewMeta: anim.previewEntry ? { name: anim.previewEntry.name, rel: anim.previewEntry.rel, dir: anim.previewEntry.dir, ext: anim.previewEntry.ext, size: anim.previewEntry.size } : null,
            asepriteMeta: anim.asepriteEntry ? { name: anim.asepriteEntry.name, rel: anim.asepriteEntry.rel, dir: anim.asepriteEntry.dir, ext: anim.asepriteEntry.ext, size: anim.asepriteEntry.size } : null,
            htmlMeta: anim.htmlEntry ? { name: anim.htmlEntry.name, rel: anim.htmlEntry.rel, dir: anim.htmlEntry.dir, ext: anim.htmlEntry.ext, size: anim.htmlEntry.size } : null
          }
          dbPut('favorites', `anim:${id}`, record).catch(() => {})
        } else {
          dbPut('favorites', `anim:${id}`, { id, name: String(id).split('|').pop() }).catch(() => {})
        }
        toast('已加入收藏')
      }
      return next
    })
  }, [activeAnims, selected, toast])

  const handleExport = async (mode) => {
    if (!selected) return
    try {
      const items = await buildExportItems(selected, frameData, exportTemplate)
      if (!items.length) {
        toast('没有可导出的动画帧')
        return
      }
      if (mode === 'folder' && typeof window.showDirectoryPicker === 'function') {
        const dest = await window.showDirectoryPicker({ mode: 'readwrite', id: 'asset-export' })
        await exportFramesToFolder(dest, items)
        toast(`已成功导出 ${items.length} 帧至文件夹`)
      } else {
        await downloadFrames(items)
        toast(`已开始下载 ${items.length} 帧文件`)
      }
    } catch (e) {
      if (e.name !== 'AbortError') toast(`导出失败：${e.message}`)
    }
  }

  const handleExportGif = async () => {
    if (!selected || gifBusy) return
    if (!frameData || !frameData.frames || frameData.frames.length < 2) {
      toast('请等待动画加载完成（帧数须 ≥ 2）')
      return
    }
    setGifBusy(true)
    setGifProgress(0)
    try {
      const blob = await exportAnimToGif(frameData, selected.name, selected.fps || 15, p => setGifProgress(p))
      if (blob) {
        downloadBlob(blob, `${sanitize(selected.name)}.gif`)
        toast(`GIF 已下载：${sanitize(selected.name)}.gif`)
      }
    } catch (e) {
      toast(`GIF 导出失败：${e.message}`)
    } finally {
      setGifBusy(false)
    }
  }

  const toggleMulti = (id) => {
    setMultiSel(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // 渲染表格行（useCallback 稳定引用，避免 VirtualList 每帧重建）
  const renderTableRow = useCallback((anim) => {
    const isSelected = anim.id === selectedId
    const isMulti = multiSel.has(anim.id)
    const isFav = favAnims.has(anim.id)

    return (
      <div
        className={`am-table-row ${isSelected ? 'selected' : ''} ${isMulti ? 'multi' : ''}`}
        onClick={() => setSelectedId(anim.id)}
      >
        <input
          type="checkbox"
          className="row-checkbox"
          checked={isMulti}
          onClick={e => e.stopPropagation()}
          onChange={() => toggleMulti(anim.id)}
        />
        <Thumb entry={anim.entry} size={28} thumbSpec={(anim.type === 'strip' || anim.type === 'sheet') ? GRID_THUMB_SPEC : null} />
        <span className={`type-badge-mini type-${anim.type}`}>{TYPE_ICONS[anim.type]} {anim.type.toUpperCase()}</span>
        <div className="table-col-name" title={anim.name}>
          <strong>{anim.name}</strong>
          {isFav && <span className="fav-star">⭐</span>}
        </div>
        <div className="table-col-dir" title={anim.dir || anim.pack}>
          {anim.pack}{anim.dir ? ` / ${anim.dir}` : ''}
        </div>
        <div className="table-col-count">{anim.count || (anim.type === 'strip' ? 'Strip' : 1)} 帧</div>
      </div>
    )
  }, [selectedId, multiSel, favAnims])

  return (
    <div className={`am-pro-shell ${isDraggingResizer ? 'user-resizing' : ''}`}>
      {/* 1. 顶部工具栏 */}
      <header className="am-pro-header">
        <div className="header-left">
          <Link className="hub-back-btn" to="/" title="返回工具箱主页"><IconArrowLeft size={14} /> 妙妙工具箱</Link>
          <div className="header-brand">
            <IconPackage size={18} className="brand-logo" />
            <span className="brand-title">ASSET WORKBENCH</span>
            <span className="pro-pill">100K+ ENGINE</span>
          </div>

          <button type="button" className="btn select-lib-btn" onClick={pickLibrary}>
            <IconFolder size={14} className="btn-icon" />
            {rootInfo ? rootInfo.name : '选择素材库…'}
          </button>

          {pendingReauth && (
            <button type="button" className="btn reauth-btn" onClick={reauthorize} title="浏览器重启后需重新授权（Chrome 安全机制）">
              <IconKey size={14} className="btn-icon" />
              一键恢复上次素材库
            </button>
          )}

          {dirHandle && (
            <button
              type="button"
              className="btn sync-check-btn"
              onClick={() => runStreamScan(dirHandle)}
              disabled={scanning}
              title="重新流式索引"
            >
              <IconRefresh size={14} className={`btn-icon ${scanning ? 'spin-icon' : ''}`} />
              <span>{scanning ? '索引中…' : '重新索引'}</span>
            </button>
          )}

          {scanning && (
            <div className="scan-indicator" title={scanInfo}>
              <span className="pulse-dot" />
              <span className="scan-text">{scanInfo || '正在流式扫描…'}</span>
              <button type="button" className="scan-cancel-btn" onClick={() => { abortRef.current = true }} title="停止"><IconX size={12} /> 停止</button>
            </div>
          )}
        </div>

        {/* 全局搜索框 */}
        <div className="header-center">
          <div className="global-search-box">
            <IconSearch size={14} className="search-ico" />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="搜索 11万+ 文件名、相对路径 (按 / 聚焦)..."
              value={queryInput}
              onChange={e => setQueryInput(e.target.value)}
              className="search-input"
            />
            {query ? (
              <button type="button" className="search-clear" onClick={() => { setQueryInput(''); setQuery('') }}><IconX size={12} /></button>
            ) : (
              <kbd className="search-kbd">/</kbd>
            )}
          </div>
        </div>

        {/* 布局切换 */}
        <div className="header-right">
          <div className="viewmode-switcher" role="group">
            <button
              type="button"
              className={`view-btn ${viewLayout === 'split' ? 'active' : ''}`}
              onClick={() => setViewLayout('split')}
              title="双分栏工作台"
            >
              <IconLayoutColumns size={12} style={{ verticalAlign: -1, marginRight: 4 }} />工作台
            </button>
            <button
              type="button"
              className={`view-btn ${viewLayout === 'gallery' ? 'active' : ''}`}
              onClick={() => setViewLayout('gallery')}
              title="画廊网格"
            >
              <IconLayoutGrid size={12} style={{ verticalAlign: -1, marginRight: 4 }} />画廊
            </button>
            <button
              type="button"
              className={`view-btn ${viewLayout === 'table' ? 'active' : ''}`}
              onClick={() => setViewLayout('table')}
              title="数据表"
            >
              <IconTable size={12} style={{ verticalAlign: -1, marginRight: 4 }} />数据表
            </button>
          </div>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setShortcutsOpen(!shortcutsOpen)}
            title="快捷键 (?)"
          >
            <IconKeyboard size={15} />
          </button>
          <input ref={fileInputRef} type="file" webkitdirectory="true" multiple hidden />
        </div>
      </header>

      {/* 2. 主体三栏工作台 */}
      <div className={`am-pro-body layout-${viewLayout}`}>
        {/* 左侧：包与可折叠子目录树 */}
        <aside className="am-pro-explorer">
          <div className="explorer-header">
            <span className="explorer-title">ASSET EXPLORER</span>
            <span className="dim-info">{totalFileCount.toLocaleString()} 文件</span>
          </div>

          <div className="explorer-scroll" ref={explorerScrollRef}>
            <div className="explorer-group" style={{ marginBottom: 6 }}>
              <button
                type="button"
                className={`tree-row ${selectedPack === '__fav__' ? 'active' : ''}`}
                onClick={handleSelectFavorites}
              >
                <IconStar size={13} filled className="tree-ico" style={{ color: '#ffd166' }} />
                <span className="tree-name">我的收藏夹</span>
                <span className="tree-count">{favAnims.size}</span>
              </button>
            </div>

            <div className="explorer-group">
              <div className="group-label">
                <span>卖家素材包 ({packs.length})</span>
                <span className="sub-hint">点击 ▸ 展开目录</span>
              </div>

              {packs.map(p => {
                const isActive = selectedPack === p.name && !dirFilter && !query
                const isExpanded = expandedPacks.has(p.name)
                const hasDirs = p.dirs && p.dirs.length > 0

                return (
                  <div key={p.name} className="pack-node">
                    <button
                      type="button"
                      data-pack={p.name}
                      className={`tree-row pack-row ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelectPack(p.name)}
                      title={`选择查看：${p.name}`}
                    >
                      <span
                        className={`tree-toggle-arrow ${hasDirs ? 'clickable' : ''}`}
                        onClick={e => handleToggleExpand(e, p.name)}
                        title={hasDirs ? (isExpanded ? '折叠子目录' : '展开子目录') : ''}
                      >
                        {hasDirs ? (isExpanded ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />) : <span style={{ opacity: 0.25 }}>•</span>}
                      </span>
                      <span className="tree-ico">{p.name === '(根目录)' ? <IconFolder size={13} /> : <IconPackage size={13} />}</span>
                      <span className="tree-name">{p.name}</span>
                      <span className="tree-count">{p.count.toLocaleString()}</span>
                    </button>

                    {/* 可收起的子目录列表 */}
                    {isExpanded && hasDirs && (
                      <div className="pack-subdirs">
                        {p.dirs.slice(0, subdirVisible[p.name] || 60).map(d => {
                          const dirLabel = d.replace(`${p.name}/`, '')
                          const isDirActive = dirFilter === d && !query
                          return (
                            <button
                              key={d}
                              type="button"
                              className={`tree-row sub ${isDirActive ? 'active' : ''}`}
                              style={{ paddingLeft: 24 }}
                              onClick={() => {
                                setSelectedPack(p.name)
                                setDirFilter(d)
                                setQuery('')
                              }}
                              title={d}
                            >
                              <span className="tree-ico">📁</span>
                              <span className="tree-name">{dirLabel}</span>
                            </button>
                          )
                        })}
                        {(subdirVisible[p.name] || 60) < p.dirs.length && (
                          <button
                            type="button"
                            className="tree-row sub more-subdirs"
                            style={{ paddingLeft: 24 }}
                            onClick={e => {
                              e.stopPropagation()
                              setSubdirVisible(s => ({ ...s, [p.name]: (s[p.name] || 60) + 120 }))
                            }}
                          >
                            <span className="tree-ico">＋</span>
                            <span className="tree-name">显示更多子目录（还有 {p.dirs.length - (subdirVisible[p.name] || 60)} 个）</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </aside>

        {/* 中间：主工作台 */}
        <main className="am-pro-main">
          {/* 上半区：素材库浏览 */}
          <section className="am-catalog-section">
            <div className="catalog-toolbar">
              <div className="type-filter-group">
                {Object.entries(TYPE_ICONS).map(([k, icon]) => (
                  <button
                    key={k}
                    type="button"
                    className={`type-pill ${typeFilter === k ? 'active' : ''}`}
                    onClick={() => setTypeFilter(k)}
                  >
                    <span>{icon}</span>
                    <span>{k === 'all' ? '全部' : k.toUpperCase()}</span>
                  </button>
                ))}
              </div>

              <div className="catalog-stats-meta">
                <span>当前目录：<strong>{filteredAnims.length}</strong> 个动画 {loadingDir ? ' (检索中…)' : ''}</span>
              </div>
            </div>

            <div className="catalog-content-area" ref={catalogScrollRef} onScroll={handleCatalogScroll}>
              {phase === 'idle' && (
                <div className="pro-empty-panel">
                  <div className="empty-logo">📂</div>
                  <h3>尚未选择素材库</h3>
                  <p>点击上方或下方按钮授权本地素材文件夹（如 <code>D:\YAHZJ\技能素材</code>，支持 11万+ 文件秒级流式载入）</p>
                  <button type="button" className="btn primary" onClick={pickLibrary}>
                    📂 立即选择素材库文件夹
                  </button>
                </div>
              )}

              {phase === 'scanning' && !packs.length && (
                <div className="pro-empty-panel">
                  <div className="pulse-icon spin-icon">🔄</div>
                  <h3>正在流式建立 B-Tree 索引…</h3>
                  <p>{scanInfo || '正在极速索引十万级文件，内存安全无溢出…'}</p>
                </div>
              )}

              {phase === 'ready' && !filteredAnims.length && !loadingDir && (
                <div className="pro-empty-panel">
                  <div className="empty-logo">🔍</div>
                  <h3>当前目录下未发现动画素材</h3>
                  <p>请点击左侧素材包或具体子文件夹查看</p>
                </div>
              )}

              {/* 画廊网格 */}
              {phase === 'ready' && viewLayout !== 'table' && filteredAnims.length > 0 && (
                <>
                  <div className="pro-gallery-grid">
                    {visibleAnims.map(anim => (
                      <GalleryCard
                        key={anim.id}
                        anim={anim}
                        selected={anim.id === selectedId}
                        isFav={favAnims.has(anim.id)}
                        onSelect={setSelectedId}
                        onToggleFav={toggleFav}
                      />
                    ))}
                  </div>

                  {filteredAnims.length > visibleCount && (
                    <div className="gallery-load-more-wrap">
                      <button
                        type="button"
                        className="btn gallery-load-more-btn"
                        onClick={() => setVisibleCount(c => Math.min(filteredAnims.length, c + GALLERY_PAGE_SIZE))}
                      >
                        加载更多（已显示 {visibleCount} / 共 {filteredAnims.length} 个）
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* 数据表 */}
              {phase === 'ready' && viewLayout === 'table' && filteredAnims.length > 0 && (
                <VirtualList
                  items={filteredAnims}
                  rowHeight={42}
                  renderRow={renderTableRow}
                />
              )}
            </div>
          </section>

          {/* 视口工作台高度拖拽调节手柄 (Split Resizer Bar) */}
          {viewLayout !== 'gallery' && (
            <div
              className={`am-split-resizer ${isDraggingResizer ? 'active' : ''}`}
              onMouseDown={handleResizerMouseDown}
              title="按住上下拖拽调节视口工作台高度"
            >
              <div className="resizer-handle-pill">
                <span className="resizer-grip">⋯</span>
                <span className="resizer-hint">拖拽调整视口高度 ({viewportHeight}px)</span>
              </div>
              <div className="resizer-presets">
                <button
                  type="button"
                  className="resizer-preset-btn"
                  onClick={e => { e.stopPropagation(); setViewportHeight(240); localStorage.setItem('am_viewport_h', '240') }}
                  title="紧凑高度"
                >
                  小
                </button>
                <button
                  type="button"
                  className="resizer-preset-btn"
                  onClick={e => { e.stopPropagation(); setViewportHeight(380); localStorage.setItem('am_viewport_h', '380') }}
                  title="标准高度"
                >
                  中
                </button>
                <button
                  type="button"
                  className="resizer-preset-btn"
                  onClick={e => { e.stopPropagation(); setViewportHeight(560); localStorage.setItem('am_viewport_h', '560') }}
                  title="宽屏大视口"
                >
                  大
                </button>
              </div>
            </div>
          )}

          {/* 下半区：专业视口工作台（应用自定义高度） */}
          {viewLayout !== 'gallery' && (
            <section className="am-viewport-section" style={{ height: viewportHeight }}>
              <PreviewPane
                anim={selected}
                cfg={sheetCfg[selectedId]}
                onFrameData={setFrameData}
                onToast={toast}
                onCfgChange={patch => setSheetCfg(s => ({ ...s, [selectedId]: { ...(s[selectedId] || {}), ...patch } }))}
              />
            </section>
          )}
        </main>

        {/* 右侧：智能属性检查器 */}
        <aside className="am-pro-inspector">
          <div className="inspector-head">
            <span className="inspector-title">INSPECTOR & EXPORT</span>
          </div>

          <div className="inspector-scroll">
            {!selected && (
              <div className="inspector-empty">
                <div className="icon">👆</div>
                <p>在左侧选择目录并在画廊中选中素材查看属性与导出</p>
              </div>
            )}

            {selected && (
              <>
                <div className="inspector-card">
                  <div className="card-header"><IconSparkles size={13} style={{ marginRight: 6 }} /> 快捷操作</div>
                  <div className="action-buttons-grid">
                    <button
                      type="button"
                      className="action-btn primary"
                      onClick={() => handleExport('folder')}
                      disabled={!frameData || !frameData.frames.length}
                    >
                      <IconDownload size={16} className="btn-ico" />
                      <div className="btn-text">
                        <strong>导出为序列帧</strong>
                        <small>按命名规则导出全部帧</small>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => handleLocateFolder(selected)}
                      title="在左侧素材树中自动定位并展开该素材所在目录"
                    >
                      <IconFolderOpen size={16} className="btn-ico" />
                      <div className="btn-text">
                        <strong>在素材树中定位</strong>
                        <small>{selected.pack}{selected.dir ? ' / ' + selected.dir.split('/').pop() : ''}</small>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="action-btn"
                      onClick={async () => {
                        const winRel = selected.rel.replace(/\//g, '\\')
                        const fullPath = rootInfo?.name ? `${rootInfo.name}\\${winRel}` : winRel
                        const ok = await copyText(fullPath)
                        toast(ok ? `已复制系统路径！在文件管理器地址栏按 Ctrl+L 粘贴即可直达` : '复制失败')
                      }}
                      title="复制本地路径，在 Windows 文件管理器地址栏粘贴回车即可打开"
                    >
                      <IconTable size={16} className="btn-ico" />
                      <div className="btn-text">
                        <strong>复制系统文件路径</strong>
                        <small>在文件管理器粘贴即达</small>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`action-btn ${favAnims.has(selected.id) ? 'fav-active' : ''}`}
                      onClick={toggleFav}
                    >
                      <IconStar size={16} filled={favAnims.has(selected.id)} className="btn-ico" />
                      <div className="btn-text">
                        <strong>{favAnims.has(selected.id) ? '已收藏' : '加入收藏'}</strong>
                        <small>快捷键 F</small>
                      </div>
                    </button>

                    {selected.asepriteEntry && (
                      <button
                        type="button"
                        className="action-btn ase-download-btn"
                        onClick={async () => {
                          try {
                            const blob = await entryBlob(selected.asepriteEntry)
                            downloadBlob(blob, selected.asepriteEntry.name)
                            toast(`已导出 Aseprite 原工程：${selected.asepriteEntry.name}`)
                          } catch (e) {
                            toast(`导出 Aseprite 失败：${e.message}`)
                          }
                        }}
                      >
                        <IconPalette size={16} className="btn-ico" />
                        <div className="btn-text">
                          <strong>下载 .aseprite 原文件</strong>
                          <small>{selected.asepriteEntry.name}</small>
                        </div>
                      </button>
                    )}

                    {selected.htmlEntry && (
                      <button
                        type="button"
                        className="action-btn html-preview-btn"
                        onClick={async () => {
                          try {
                            const blob = await entryBlob(selected.htmlEntry)
                            const url = URL.createObjectURL(blob)
                            window.open(url, '_blank')
                          } catch (e) {
                            toast(`打开预览失败：${e.message}`)
                          }
                        }}
                      >
                        <IconExternalLink size={16} className="btn-ico" />
                        <div className="btn-text">
                          <strong>打开原作者预览页</strong>
                          <small>{selected.htmlEntry.name}</small>
                        </div>
                      </button>
                    )}
                  </div>
                </div>

                <div className="inspector-card">
                  <div className="card-header">📊 规格与元数据</div>
                  <div className="meta-grid">
                    <div className="meta-row">
                      <span className="meta-k">动画名称</span>
                      <span className="meta-v highlight">{selected.name}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-k">素材类型</span>
                      <span className="meta-v badge">
                        {selected.type === 'strip' ? 'STRIP (合集)' : selected.type.toUpperCase()}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-k">单帧分辨率</span>
                      <span className="meta-v">
                        {frameData?.frames?.[0] ? `${frameData.frames[0].w || frameData.frames[0].width} × ${frameData.frames[0].h || frameData.frames[0].height} px` : '--'}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-k">动画帧数</span>
                      <span className="meta-v">{selected.count || frameData?.frames?.length || 1} 帧</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-k">来源路径</span>
                      <span className="meta-v path-text" title={selected.rel}>{selected.rel}</span>
                    </div>
                  </div>
                </div>


              </>
            )}
          </div>
        </aside>
      </div>

      {/* 3. 底部状态栏 */}
      <footer className="am-pro-statusbar">
        <div className="status-left">
          <span className="status-item">
            <span className="status-dot green" />
            引擎状态：<strong>100K+ 流式就绪</strong>
          </span>
          <span className="status-divider">|</span>
          <span className="status-item">
            当前包：<strong>{selectedPack === '__fav__' ? '⭐ 我的收藏夹' : (selectedPack || '全部素材')}</strong>
          </span>
          {dirFilter && (
            <>
              <span className="status-divider">/</span>
              <span className="status-item"><strong>{dirFilter}</strong></span>
            </>
          )}
        </div>
        <div className="status-right">
          <span className="status-item">
            总文件数：<strong>{totalFileCount.toLocaleString()}</strong>
          </span>
          <span className="status-divider">|</span>
          <span className="status-item">
            当前动画数：<strong>{filteredAnims.length}</strong>
          </span>
          <span className="status-divider">|</span>
          <span className="status-item">
            已收藏：<strong>{favAnims.size}</strong>
          </span>
        </div>
      </footer>

      {/* Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            className="pro-toast"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
