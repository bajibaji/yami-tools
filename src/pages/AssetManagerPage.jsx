// 素材管理器 Pro：工业级 100K+ 引擎（支持目录折叠 + 视口工作台自由拖拽调高）
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
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
  exportAnimAsSpritesheet,
  exportAnimsToZip,
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
  dbQueryByIndex
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

// 将平铺路径列表构建为嵌套目录树
function buildDirectoryTree (dirs, packName) {
  if (!dirs || !dirs.length) return []
  const root = { children: {} }

  for (const d of dirs) {
    const rel = d.startsWith(packName + '/') ? d.slice(packName.length + 1) : d
    const parts = rel.split('/').filter(Boolean)

    let cur = root
    let curPath = packName
    for (const part of parts) {
      curPath += '/' + part
      if (!cur.children[part]) {
        cur.children[part] = {
          name: part,
          path: curPath,
          children: {}
        }
      }
      cur = cur.children[part]
    }
  }

  function toArray (node, depth = 1) {
    const list = []
    const keys = Object.keys(node.children).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    for (const k of keys) {
      const child = node.children[k]
      const subList = toArray(child, depth + 1)
      list.push({
        name: child.name,
        path: child.path,
        depth,
        hasChildren: subList.length > 0,
        children: subList
      })
    }
    return list
  }

  return toArray(root, 1)
}

const DirectoryTreeNode = memo(function DirectoryTreeNode ({
  node,
  packName,
  selectedPack,
  dirFilter,
  expandedDirs,
  onToggleExpand,
  onSelectDir
}) {
  const isExpanded = expandedDirs.has(node.path)
  const isActive = selectedPack === packName && dirFilter === node.path
  const hasChildren = node.hasChildren

  return (
    <div className="dir-tree-node">
      <button
        type="button"
        className={`tree-row sub ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 14 + node.depth * 14 }}
        onClick={() => onSelectDir(packName, node.path)}
        title={node.path}
      >
        <span
          className={`tree-toggle-arrow ${hasChildren ? 'clickable' : ''}`}
          onClick={e => {
            if (hasChildren) {
              e.stopPropagation()
              onToggleExpand(node.path)
            }
          }}
          title={hasChildren ? (isExpanded ? '折叠子目录' : '展开子目录') : ''}
        >
          {hasChildren ? (
            isExpanded ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />
          ) : (
            <span style={{ opacity: 0.25 }}>•</span>
          )}
        </span>
        <IconFolder size={12} className="tree-ico" style={{ opacity: isActive ? 1 : 0.7 }} />
        <span className="tree-name">{node.name}</span>
      </button>

      {hasChildren && isExpanded && (
        <div className="dir-tree-children">
          {node.children.map(child => (
            <DirectoryTreeNode
              key={child.path}
              node={child}
              packName={packName}
              selectedPack={selectedPack}
              dirFilter={dirFilter}
              expandedDirs={expandedDirs}
              onToggleExpand={onToggleExpand}
              onSelectDir={onSelectDir}
            />
          ))}
        </div>
      )}
    </div>
  )
})

function useToast () {
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const toast = useCallback(text => {
    setMsg(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 3600)
  }, [])
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
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
  const rootInfoRef = useRef(null)
  rootInfoRef.current = rootInfo // 镜像 ref：供 useCallback 读取最新值而不随引用重建（否则挂载 effect 会循环刷新）
  // 素材库本地完整根路径（如 D:\YAHZJ\技能素材），选库时一次性询问并持久化，用于拼接绝对路径
  const [rootAbs, setRootAbs] = useState(() => {
    try { return localStorage.getItem('yami_root_abs') || '' } catch (e) { return '' }
  })
  const rootAbsRef = useRef(rootAbs)
  rootAbsRef.current = rootAbs
  const [dirHandle, setDirHandle] = useState(null)
  const dirHandleRef = useRef(null)
  dirHandleRef.current = dirHandle
  const fallbackFilesMapRef = useRef(new Map()) // 降级模式下的内存文件映射 rel -> File
  const [phase, setPhase] = useState('idle') // 'idle' | 'scanning' | 'ready' | 'error'
  const [totalFileCount, setTotalFileCount] = useState(0)

  // 顶级包索引列表
  const [packs, setPacks] = useState([]) // [{ name, count, dirs: [] }]
  const [selectedPack, setSelectedPack] = useState(null)
  const [dirFilter, setDirFilter] = useState(null)
  const [expandedPacks, setExpandedPacks] = useState(new Set()) // 包折叠状态集合
  const [expandedDirs, setExpandedDirs] = useState(new Set()) // 子目录多层嵌套折叠状态集合

  // 缓存各包的多层级树结构
  const packTrees = useMemo(() => {
    const map = new Map()
    for (const p of packs) {
      if (p.dirs && p.dirs.length) {
        map.set(p.name, buildDirectoryTree(p.dirs, p.name))
      }
    }
    return map
  }, [packs])

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
  const [cardSize, setCardSize] = useState(() => {
    return localStorage.getItem('am_card_size') || 'M'
  })
  const handleCardSizeChange = (sz) => {
    setCardSize(sz)
    localStorage.setItem('am_card_size', sz)
  }
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
  const [folderModalAnim, setFolderModalAnim] = useState(null)
  const [gifBusy, setGifBusy] = useState(false)
  const [gifProgress, setGifProgress] = useState(0)

  // 扫描控制
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState('')
  const [pendingReauth, setPendingReauth] = useState(null)
  const abortRef = useRef(false)

  // 当前选中的动画对象
  const selected = useMemo(() => {
    if (!selectedId) return null
    return activeAnims.find(a => a.id === selectedId) || null
  }, [activeAnims, selectedId])

  // 所在文件夹弹窗关联的所有动画素材
  const folderAnims = useMemo(() => {
    if (!folderModalAnim) return []
    return activeAnims.filter(a => a.pack === folderModalAnim.pack && a.dir === folderModalAnim.dir)
  }, [folderModalAnim, activeAnims])

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
        fileRecords = (searchIndexRef.current || []).filter(r => r.nameL.includes(q) || r.relL.includes(q)).slice(0, 500)
      } else if (dirPath) {
        fileRecords = await dbQueryByIndex('files', 'dir', dirPath)
      } else if (packName) {
        fileRecords = await dbQueryByIndex('files', 'pack', packName)
      }

      if (myReq !== loadReqRef.current) return
      const isFallback = rootInfoRef.current?.type === 'fallback'
      if (fileRecords.length > 0 && (dirHandle || isFallback)) {
        const images = fileRecords.filter(f => f.isImg).map(m => {
          const item = (isFallback && !m.file) ? { ...m, file: fallbackFilesMapRef.current.get(m.rel) } : m
          return cachedEntry(item, dirHandle)
        })
        const metas = fileRecords.filter(f => f.isMeta).map(m => {
          const item = (isFallback && !m.file) ? { ...m, file: fallbackFilesMapRef.current.get(m.rel) } : m
          return cachedEntry(item, dirHandle)
        })
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
      console.warn('[AssetManager] 载入目录数据异常:', e)
    } finally {
      if (myReq === loadReqRef.current) setLoadingDir(false)
    }
  }, [dirHandle]) // 注意：buildSearchIndex 在下方声明，只能在回调运行时引用（闭包绑定已初始化）；降级分支经 rootInfoRef 读取，不入依赖防循环刷新

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

  // ---------- 专门点击箭头折叠/展开包 ----------
  const handleToggleExpand = (e, packName) => {
    e.stopPropagation()
    setExpandedPacks(prev => {
      const next = new Set(prev)
      if (next.has(packName)) next.delete(packName); else next.add(packName)
      return next
    })
  }

  // ---------- 专门点击箭头折叠/展开子目录 ----------
  const handleToggleExpandDir = (dirPath) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath)
      return next
    })
  }

  // ---------- 选择子目录 ----------
  const handleSelectDir = (packName, dirPath) => {
    setSelectedPack(packName)
    setDirFilter(dirPath)
    setQuery('')
  }

  // ---------- 素材库完整根路径：一次询问，之后统一拼接绝对路径 ----------
  const saveRootAbs = useCallback((v) => {
    const val = (v || '').trim()
    setRootAbs(val)
    rootAbsRef.current = val
    try { localStorage.setItem('yami_root_abs', val) } catch (e) { /* ignore */ }
  }, [])

  const askRootAbs = useCallback(async () => {
    const typed = window.prompt(
      '请粘贴素材库根目录完整本地路径（仅首次，之后自动记忆）\r\n例如：D:\\YAHZJ\\技能素材',
      rootAbsRef.current || rootInfoRef.current?.name || ''
    )
    if (typed && typed.trim()) {
      saveRootAbs(typed)
      return typed.trim()
    }
    return null
  }, [saveRootAbs])

  // 选库成功后自动记录根路径（若尚未记录）
  const ensureRootAbs = useCallback(async () => {
    if (rootAbsRef.current) return rootAbsRef.current
    return askRootAbs()
  }, [askRootAbs])

  // 相对路径 → 完整本地路径（无根路径时返回 null）
  const absPathOf = useCallback((rel) => {
    const root = rootAbsRef.current
    if (!root || !rel) return null
    return root.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\')
  }, [])

  // ---------- 复制绝对路径（有根路径直接拼接；无则先询问一次并记忆） ----------
  const handleCopyAbs = useCallback(async (target) => {
    if (!target || !target.rel) return ''
    let root = rootAbsRef.current
    if (!root) {
      const typed = await askRootAbs()
      if (typed) root = typed
    }
    const abs = root ? absPathOf(target.rel) : null
    if (abs) {
      await copyText(abs)
      return abs
    }
    await copyText(target.rel)
    return ''
  }, [askRootAbs, absPathOf]) // rootInfo/rootAbs 经 ref 读取，不入依赖防循环刷新

  // ---------- 打开所在文件夹：弹出同目录素材浏览器弹窗 + 复制绝对路径 ----------
  const handleOpenFolder = useCallback(async (anim) => {
    const target = anim || selected
    if (!target) return
    if (typeof handleLocateFolder === 'function') handleLocateFolder(target)
    const relPath = target.rel || target.dir || ''
    const folderDir = target.dir || (relPath.includes('/') ? relPath.replace(/\/[^/]+$/, '') : '')

    // 完整本地路径：有根路径直接复制；无根路径时静默降级为相对路径，不再弹窗打断（不阻塞双击）
    const abs = absPathOf(target.rel)
    let shown = abs
    if (abs) {
      await copyText(abs)
    } else {
      await copyText(target.rel).catch(() => {})
      shown = target.rel
    }

    // 弹出「所在文件夹素材浏览器」弹窗，展示同目录全部关联素材与工程源文件
    setFolderModalAnim(target)
    toast(shown ? `已复制路径：${shown}` : '已打开同目录素材浏览器')
  }, [selected, toast, absPathOf])

  // ---------- 导出 PNG 序列帧 (ZIP) ----------
  const handleExportFrames = async () => {
    if (!selected) return
    try {
      toast('正在打包单帧序列…')
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const animName = sanitize(selected.name || 'animation')

      if (selected.type === 'sequence' && selected.files && selected.files.length) {
        for (let i = 0; i < selected.files.length; i++) {
          const f = selected.files[i]
          const blob = await entryBlob(f)
          const ext = f.ext || 'png'
          zip.file(`${animName}_${String(i + 1).padStart(3, '0')}.${ext}`, blob)
        }
      } else if (frameData && frameData.frames && frameData.frames.length) {
        const items = await buildExportItems(selected, frameData)
        for (const it of items) {
          const b = typeof it.blob === 'function' ? await it.blob() : it.blob
          zip.file(it.name, b)
        }
      } else if (selected.entry) {
        const b = await entryBlob(selected.entry)
        zip.file(selected.entry.name, b)
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `${animName}_frames.zip`)
      toast(`已成功导出 PNG 序列帧：${animName}_frames.zip`)
    } catch (e) {
      toast(`导出序列帧失败：${e.message}`)
    }
  }

  // ---------- 导出 Spritesheet 精灵表 (PNG + TXT/JSON) ----------
  const handleExportSpritesheet = async () => {
    if (!selected) return
    try {
      toast('正在导出 Spritesheet 精灵表…')
      const zipBlob = await exportAnimAsSpritesheet(selected, frameData)
      if (zipBlob) {
        const animName = sanitize(selected.name || 'spritesheet')
        downloadBlob(zipBlob, `${animName}_spritesheet.zip`)
        toast(`已导出 Spritesheet 精灵表：${animName}_spritesheet.zip`)
      } else {
        toast('暂无可用帧数据生成 Spritesheet')
      }
    } catch (e) {
      toast(`导出 Spritesheet 失败：${e.message}`)
    }
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
    if (anim.dir) {
      const parts = anim.dir.replace(packName + '/', '').split('/')
      let cur = packName
      setExpandedDirs(prev => {
        const next = new Set(prev)
        for (const pt of parts) {
          cur += '/' + pt
          next.add(cur)
        }
        return next
      })
    }
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
    const isFallback = rootInfoRef.current?.type === 'fallback'
    if ((!dh && !isFallback) || !packList || !packList.length) return
    for (const p of packList.slice(0, 8)) {
      await new Promise(r => setTimeout(r, 0))
      if (animsCacheRef.current.has('pack:' + p.name)) continue
      try {
        const recs = await dbQueryByIndex('files', 'pack', p.name)
        const images = recs.filter(f => f.isImg).map(m => {
          const item = (isFallback && !m.file) ? { ...m, file: fallbackFilesMapRef.current.get(m.rel) } : m
          return cachedEntry(item, dh)
        })
        const metas = recs.filter(f => f.isMeta).map(m => {
          const item = (isFallback && !m.file) ? { ...m, file: fallbackFilesMapRef.current.get(m.rel) } : m
          return cachedEntry(item, dh)
        })
        animsCacheRef.current.set('pack:' + p.name, await clusterFiles(images, metas, {}, {}))
      } catch (e) {
        console.warn('[AssetManager] 预热包聚类异常:', e)
      }
    }
  }, []) // rootInfo/dirHandle 经 ref 读取，不入依赖防循环刷新

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
      ensureRootAbs()
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
        ensureRootAbs()
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

  // ---------- 降级文件夹选取处理（Firefox / Safari 等无 showDirectoryPicker 环境） ----------
  const handleFallbackFilesPicked = async (e) => {
    const fileList = e.target.files
    if (!fileList || !fileList.length) return
    try {
      setPacks([])
      setPhase('scanning')
      setScanInfo('正在遍历文件…')
      const records = scanFallbackFiles(fileList, count => setScanInfo(`已读取 ${count.toLocaleString()} 个文件`))
      const rootDirName = fileList[0]?.webkitRelativePath?.split('/')[0] || '本地素材库'
      setRootInfo({ type: 'fallback', name: rootDirName })
      ensureRootAbs()
      fallbackFilesMapRef.current.clear()
      for (const r of records) {
        if (r.file) fallbackFilesMapRef.current.set(r.rel, r.file)
      }

      await dbClear('files')
      await dbClear('packs')
      // IDB 只存元数据，File 对象仅保留在 fallbackFilesMapRef 内存映射（避免 10 万级 File 双存撑爆存储）
      for (let i = 0; i < records.length; i += 5000) {
        const metaOnly = records.slice(i, i + 5000).map(f => {
          const { file, ...rest } = f
          return [f.rel, rest]
        })
        await dbBulkPut('files', metaOnly)
        await new Promise(r => setTimeout(r, 0))
      }

      const packMap = new Map()
      for (const r of records) {
        const pName = r.pack || '(根目录)'
        if (!packMap.has(pName)) packMap.set(pName, { name: pName, count: 0, dirs: [] })
        const p = packMap.get(pName)
        p.count++
        if (r.dir && !p.dirs.includes(r.dir)) p.dirs.push(r.dir)
      }
      const packList = Array.from(packMap.values())
      await dbBulkPut('packs', packList.map(p => [p.name, p]))
      setPacks(packList)
      setSelectedPack(packList[0] ? packList[0].name : null)
      setExpandedPacks(packList[0] ? new Set([packList[0].name]) : new Set())
      setPhase('ready')
      buildSearchIndex()
      toast(`已成功载入 ${records.length.toLocaleString()} 个文件`)
    } catch (err) {
      console.warn('[AssetManager] 降级文件载入异常:', err)
      toast(`加载文件夹失败：${err.message}`)
      setPhase('ready')
    }
  }

  // ---------- 快捷键 ----------
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (folderModalAnim) {
          setFolderModalAnim(null)
          return
        }
        if (shortcutsOpen) {
          setShortcutsOpen(false)
          return
        }
      }
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

      // ---------- 方向键全能切换选中的动画素材 (2D 智能网格感知) ----------
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd', 'h', 'j', 'k', 'l'].includes(e.key)) {
        if (!filteredAnims.length) return
        e.preventDefault()

        const curIdx = filteredAnims.findIndex(a => a.id === selectedId)
        let targetIdx = curIdx >= 0 ? curIdx : 0

        // 计算当前画廊网格每行有多少列
        let cols = 1
        if (viewLayout !== 'table' && catalogScrollRef.current) {
          const containerWidth = catalogScrollRef.current.clientWidth - 32
          const minColWidth = cardSize === 'S' ? 104 : cardSize === 'L' ? 180 : cardSize === 'XL' ? 230 : 132
          cols = Math.max(1, Math.floor(containerWidth / (minColWidth + 12)))
        }

        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'h') {
          targetIdx = Math.max(0, curIdx - 1)
        } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'l') {
          targetIdx = Math.min(filteredAnims.length - 1, curIdx + 1)
        } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'k') {
          if (viewLayout === 'table') {
            targetIdx = Math.max(0, curIdx - 1)
          } else {
            targetIdx = Math.max(0, curIdx - cols)
          }
        } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'j') {
          if (viewLayout === 'table') {
            targetIdx = Math.min(filteredAnims.length - 1, curIdx + 1)
          } else {
            targetIdx = Math.min(filteredAnims.length - 1, curIdx + cols)
          }
        }

        const nextAnim = filteredAnims[targetIdx]
        if (nextAnim && nextAnim.id !== selectedId) {
          setSelectedId(nextAnim.id)
        }
      } else if (e.key === '?') {
        setShortcutsOpen(s => !s)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredAnims, visibleAnims, selectedId, folderModalAnim, shortcutsOpen, viewLayout, cardSize])

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

  const handleSelectAllCurrent = () => {
    setMultiSel(new Set(visibleAnims.map(a => a.id)))
    toast(`已全选当前 ${visibleAnims.length} 个素材`)
  }

  const handleClearMulti = () => {
    setMultiSel(new Set())
  }

  const handleBatchExportZip = async () => {
    const list = activeAnims.filter(a => multiSel.has(a.id))
    if (!list.length) return
    try {
      toast(`正在将 ${list.length} 个素材打包为 ZIP...`)
      const zipBlob = await exportAnimsToZip(list)
      downloadBlob(zipBlob, `${sanitize(selectedPack || 'gallery')}_batch_${list.length}.zip`)
      toast(`已成功导出 ${list.length} 个素材的 ZIP 压缩包！`)
    } catch (e) {
      toast(`批量打包失败：${e.message}`)
    }
  }

  const handleBatchFav = () => {
    const list = activeAnims.filter(a => multiSel.has(a.id))
    if (!list.length) return
    list.forEach(a => {
      if (!favAnims.has(a.id)) toggleFav(a.id)
    })
    toast(`已将 ${list.length} 个素材批量加入收藏`)
  }

  const handleBatchCopyPaths = async () => {
    const list = activeAnims.filter(a => multiSel.has(a.id))
    if (!list.length) return
    const rootAbs = (() => { try { return localStorage.getItem('yami_root_abs') || '' } catch (e) { return '' } })()
    const text = list.map(a => rootAbs ? rootAbs.replace(/[\\/]+$/, '') + '\\' + a.rel.replace(/\//g, '\\') : a.rel).join('\n')
    const ok = await copyText(text)
    toast(ok ? `已批量复制 ${list.length} 个绝对路径` : '复制失败')
  }

  // 渲染表格行（useCallback 稳定引用，避免 VirtualList 每帧重建）
  const renderTableRow = useCallback((anim) => {
    const isSelected = anim.id === selectedId
    const isMulti = multiSel.has(anim.id)
    const isFav = favAnims.has(anim.id)

    return (
      <div
        data-anim-id={anim.id}
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
  // 当 selectedId 改变时，确保画廊卡片/表格行平滑自动滚动到可视区域
  useEffect(() => {
    if (!selectedId) return
    const container = catalogScrollRef.current
    if (!container) return
    requestAnimationFrame(() => {
      const el = container.querySelector(`[data-anim-id="${CSS.escape(selectedId)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    })
  }, [selectedId])

  return (
    <div className={`am-pro-shell ${isDraggingResizer ? 'user-resizing' : ''}`}>
      {/* 1. 顶部工具栏 */}
      <header className="am-pro-header">
        <div className="header-left">
          <Link className="hub-back-btn" to="/" title="返回工具箱主页"><IconArrowLeft size={14} /> 妙妙工具箱</Link>
          <div className="header-brand">
            <IconPackage size={18} className="brand-logo" />
            <span className="brand-title">ASSET WORKBENCH</span>
            <span className="pro-pill">v1.1.0 PRO</span>
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
          <input ref={fileInputRef} type="file" webkitdirectory="true" multiple onChange={handleFallbackFilesPicked} hidden />
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

                    {/* 逐级嵌套多层级子目录树 */}
                    {isExpanded && hasDirs && (
                      <div className="pack-subdirs">
                        {(packTrees.get(p.name) || []).map(node => (
                          <DirectoryTreeNode
                            key={node.path}
                            node={node}
                            packName={p.name}
                            selectedPack={selectedPack}
                            dirFilter={dirFilter}
                            expandedDirs={expandedDirs}
                            onToggleExpand={handleToggleExpandDir}
                            onSelectDir={handleSelectDir}
                          />
                        ))}
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

              <div className="catalog-right-controls" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {viewLayout === 'gallery' && (
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={multiSel.size === visibleAnims.length && visibleAnims.length > 0 ? handleClearMulti : handleSelectAllCurrent}
                    title="在画廊模式下全选或取消全选当前目录全部素材"
                  >
                    {multiSel.size === visibleAnims.length && visibleAnims.length > 0 ? '取消全选' : '全选当前'}
                  </button>
                )}

                <div className="card-size-switcher" title="缩略图尺寸档位">
                  {['S', 'M', 'L', 'XL'].map(sz => (
                    <button
                      key={sz}
                      type="button"
                      className={`size-pill-btn ${cardSize === sz ? 'active' : ''}`}
                      onClick={() => handleCardSizeChange(sz)}
                      title={`缩略图尺寸：${sz}`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>

                <div className="catalog-stats-meta">
                  <span>当前目录：<strong>{filteredAnims.length}</strong> 个动画 {loadingDir ? ' (检索中…)' : ''}</span>
                </div>
              </div>
            </div>

            <div className="catalog-content-area" ref={catalogScrollRef} onScroll={handleCatalogScroll}>
              {phase === 'idle' && (
                <div className="pro-empty-panel">
                  <div className="empty-logo"><IconFolderOpen size={48} /></div>
                  <h3>尚未选择素材库</h3>
                  <p>点击上方或下方按钮授权本地素材文件夹（如 <code>D:\YAHZJ\技能素材</code>，支持 11万+ 文件秒级流式载入）</p>
                  <button type="button" className="btn primary" onClick={pickLibrary}>
                    <IconFolder size={14} style={{ marginRight: 6 }} /> 立即选择素材库文件夹
                  </button>
                </div>
              )}

              {phase === 'scanning' && !packs.length && (
                <div className="pro-empty-panel">
                  <div className="pulse-icon spin-icon"><IconRefresh size={48} /></div>
                  <h3>正在流式建立 B-Tree 索引…</h3>
                  <p>{scanInfo || '正在极速索引十万级文件，内存安全无溢出…'}</p>
                </div>
              )}

              {phase === 'ready' && !filteredAnims.length && !loadingDir && (
                <div className="pro-empty-panel">
                  <div className="empty-logo"><IconSearch size={48} /></div>
                  <h3>当前目录下未发现动画素材</h3>
                  <p>请点击左侧素材包或具体子文件夹查看</p>
                </div>
              )}

              {/* 画廊网格 */}
              {phase === 'ready' && viewLayout !== 'table' && filteredAnims.length > 0 && (
                <>
                  <div className={`pro-gallery-grid grid-size-${cardSize.toLowerCase()}`}>
                    {visibleAnims.map(anim => (
                      <GalleryCard
                        key={anim.id}
                        anim={anim}
                        thumbSize={cardSize === 'S' ? 64 : cardSize === 'L' ? 128 : cardSize === 'XL' ? 170 : 84}
                        selected={anim.id === selectedId}
                        isFav={favAnims.has(anim.id)}
                        showCheckbox={viewLayout === 'gallery'}
                        isMultiSelected={multiSel.has(anim.id)}
                        onSelect={setSelectedId}
                        onToggleFav={toggleFav}
                        onToggleMulti={toggleMulti}
                        onDoubleClick={handleOpenFolder}
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
                onOpenFolder={handleOpenFolder}
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
                <div className="icon"><IconImage size={38} style={{ opacity: 0.35 }} /></div>
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
                      onClick={handleExportFrames}
                      disabled={!frameData || !frameData.frames || !frameData.frames.length}
                      title="将当前动画全部单帧导出为 PNG 序列图（ZIP 打包）"
                    >
                      <IconDownload size={16} className="btn-ico" />
                      <div className="btn-text">
                        <strong>导出 PNG 序列帧</strong>
                        <small>连续编号单帧图包 (ZIP)</small>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="action-btn"
                      onClick={handleExportSpritesheet}
                      disabled={!frameData || !frameData.frames || !frameData.frames.length}
                      title="导出整张 Spritesheet 大图及 TXT/JSON 坐标数据"
                    >
                      <IconLayers size={16} className="btn-ico" />
                      <div className="btn-text">
                        <strong>导出 Spritesheet</strong>
                        <small>PNG 大图 + TXT 坐标</small>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="action-btn"
                      onClick={handleExportGif}
                      disabled={!frameData || !frameData.frames || frameData.frames.length < 2}
                      title="一键将该动画合成为 GIF 动图并下载"
                    >
                      <IconFilm size={16} className="btn-ico" />
                      <div className="btn-text">
                        <strong>导出 GIF 动图</strong>
                        <small>动态预览图 (256色)</small>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => handleOpenFolder(selected)}
                      title="弹出同目录素材浏览器并复制该素材的完整本地路径"
                    >
                      <IconFolderOpen size={16} className="btn-ico" />
                      <div className="btn-text">
                        <strong>打开所在文件夹</strong>
                        <small>同目录预览 + 复制完整路径</small>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="action-btn"
                      onClick={async () => {
                        const abs = await handleCopyAbs(selected)
                        toast(abs ? `已复制系统路径：${abs}（文件管理器地址栏 Ctrl+L 粘贴即达）` : '复制失败（未记录素材库根路径）')
                      }}
                      title="复制本地绝对路径，在 Windows 文件管理器地址栏粘贴回车即可打开"
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
                  <div className="card-header"><IconActivity size={13} style={{ marginRight: 6 }} /> 规格与元数据</div>
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

                {(selected.type === 'sheet' || selected.type === 'strip') && (
                  <div className="inspector-card">
                    <div className="card-header"><IconLayers size={13} style={{ marginRight: 6 }} /> 精灵表切片微调</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--am-text-dim)' }}>
                        <span>当前切片:</span>
                        <strong style={{ color: 'var(--am-accent)' }}>
                          {frameData?.frames?.length || 0} 帧 ({frameData?.frames?.[0]?.w || frameData?.frames?.[0]?.width || 0} × {frameData?.frames?.[0]?.h || frameData?.frames?.[0]?.height || 0} px)
                        </strong>
                      </div>

                      {/* 快速切片预设 */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={() => setSheetCfg(s => ({ ...s, [selectedId]: {} }))}
                          title="恢复系统智能自动等宽与间隙切分"
                        >
                          智能自动
                        </button>
                        {['4', '6', '8', '10', '12', '16'].map(col => (
                          <button
                            key={col}
                            type="button"
                            className={`btn ${sheetCfg[selectedId]?.cols === +col ? 'primary' : ''}`}
                            style={{ fontSize: 10, padding: '2px 6px' }}
                            onClick={() => setSheetCfg(s => ({ ...s, [selectedId]: { cols: +col, rows: 1 } }))}
                            title={`强制单行等分 ${col} 帧`}
                          >
                            {col} 帧
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {['32', '48', '64', '80', '96', '128'].map(sz => (
                          <button
                            key={sz}
                            type="button"
                            className={`btn ${sheetCfg[selectedId]?.cellW === +sz ? 'primary' : ''}`}
                            style={{ fontSize: 10, padding: '2px 6px' }}
                            onClick={() => setSheetCfg(s => ({ ...s, [selectedId]: { cellW: +sz, cellH: +sz } }))}
                            title={`按 ${sz}×${sz} px 正方形单元格切分`}
                          >
                            {sz}px
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
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

      {/* 4. 所在文件夹素材浏览器弹窗 (Folder Asset Explorer Modal) */}
      <AnimatePresence>
        {folderModalAnim && (
          <div
            className="pro-modal-backdrop"
            onClick={() => setFolderModalAnim(null)}
          >
            <motion.div
              className="folder-explorer-modal"
              onClick={e => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.1, ease: 'easeOut' }}
            >
              <div className="folder-modal-header">
                <div className="folder-modal-title-wrap">
                  <IconFolderOpen size={18} style={{ color: 'var(--am-accent)' }} />
                  <h3>所在文件夹素材浏览器</h3>
                  <div className="folder-modal-path" title={folderModalAnim.rel}>
                    {absPathOf(folderModalAnim.rel) || `${folderModalAnim.rel.replace(/\//g, '\\')}`}
                  </div>
                </div>
                <div className="folder-modal-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={async () => {
                      const fileAbs = absPathOf(folderModalAnim.rel)
                      const dirOnly = fileAbs ? fileAbs.substring(0, fileAbs.lastIndexOf('\\')) : ''
                      const ok = await copyText(dirOnly || folderModalAnim.dir || folderModalAnim.rel)
                      toast(ok ? `已复制文件夹完整路径：${dirOnly || folderModalAnim.dir || folderModalAnim.rel}` : '复制失败')
                    }}
                    title="复制该文件夹的完整本地路径（浏览器无法直接唤起资源管理器，复制后到文件管理器 Ctrl+L 粘贴即达）"
                  >
                    <IconFolderOpen size={13} style={{ marginRight: 4 }} /> 复制系统文件夹路径
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setFolderModalAnim(null)}
                    title="关闭 (Esc)"
                  >
                    <IconX size={15} />
                  </button>
                </div>
              </div>

              <div className="folder-modal-body">
                {/* 同目录下的动画素材网格 */}
                <div className="folder-section">
                  <div className="folder-section-title">
                    <IconLayers size={13} />
                    <span>同目录动画素材 ({folderAnims.length} 个)</span>
                  </div>
                  <div className="folder-anims-grid">
                    {folderAnims.map(a => (
                      <div
                        key={a.id}
                        className={`gallery-card ${a.id === selectedId ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedId(a.id)
                          toast(`已在主工作台切换至：${a.name}`)
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="gallery-thumb-wrap" style={{ height: 84 }}>
                          <Thumb entry={a.entry} size={72} className="gallery-thumb-img" thumbSpec={(a.type === 'strip' || a.type === 'sheet') ? GRID_THUMB_SPEC : null} />
                        </div>
                        <div className="gallery-info">
                          <div className="gallery-title" title={a.name}>{a.name}</div>
                          <div className="gallery-dir">{a.count || 1} 帧 · {a.type.toUpperCase()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 同目录关联源文件列表 */}
                {(folderModalAnim.asepriteEntry || folderModalAnim.htmlEntry || folderModalAnim.metaEntry) && (
                  <div className="folder-section">
                    <div className="folder-section-title">
                      <IconSparkles size={13} />
                      <span>工程与配套源文件</span>
                    </div>
                    <div className="folder-files-list">
                      {folderModalAnim.asepriteEntry && (
                        <div className="folder-file-item">
                          <div className="folder-file-name" title={folderModalAnim.asepriteEntry.name}>
                            <IconPalette size={13} style={{ verticalAlign: -2, marginRight: 6, color: '#bb9af7' }} />
                            {folderModalAnim.asepriteEntry.name}
                          </div>
                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={async () => {
                              const blob = await entryBlob(folderModalAnim.asepriteEntry)
                              downloadBlob(blob, folderModalAnim.asepriteEntry.name)
                              toast(`已导出工程源文件：${folderModalAnim.asepriteEntry.name}`)
                            }}
                          >
                            下载
                          </button>
                        </div>
                      )}

                      {folderModalAnim.htmlEntry && (
                        <div className="folder-file-item">
                          <div className="folder-file-name" title={folderModalAnim.htmlEntry.name}>
                            <IconExternalLink size={13} style={{ verticalAlign: -2, marginRight: 6, color: '#73daca' }} />
                            {folderModalAnim.htmlEntry.name}
                          </div>
                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={async () => {
                              const blob = await entryBlob(folderModalAnim.htmlEntry)
                              const url = URL.createObjectURL(blob)
                              window.open(url, '_blank')
                            }}
                          >
                            预览
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="folder-modal-footer">
                <span>当前文件夹：<strong>{folderModalAnim.dir || folderModalAnim.pack || '(根目录)'}</strong></span>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setFolderModalAnim(null)}
                >
                  完成并返回
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. 画廊多选批量操作悬浮条 (Batch Floating Bar) */}
      <AnimatePresence>
        {viewLayout === 'gallery' && multiSel.size > 0 && (
          <motion.div
            className="batch-floating-bar"
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <span className="batch-count-badge">已选 {multiSel.size} 项</span>
            <button type="button" className="batch-btn primary" onClick={handleBatchExportZip} title="将选中的全部素材源文件打包下载为 ZIP 压缩包">
              <IconDownload size={13} /> 批量打包 ZIP
            </button>
            <button type="button" className="batch-btn" onClick={handleBatchFav} title="批量加入收藏夹">
              <IconStar size={13} filled style={{ color: '#ffd166' }} /> 批量收藏
            </button>
            <button type="button" className="batch-btn" onClick={handleBatchCopyPaths} title="批量复制相对路径">
              <IconTable size={13} /> 复制路径
            </button>
            <button type="button" className="batch-btn" onClick={handleClearMulti} title="取消多选">
              <IconX size={12} /> 清空选择
            </button>
          </motion.div>
        )}
      </AnimatePresence>



      {/* 7. Toast 提示 */}
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
