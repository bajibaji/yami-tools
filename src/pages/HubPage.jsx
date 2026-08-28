import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { TOOLS, CATEGORIES, HUB_VERSION, BASE } from '../data/tools.js'

// 容器 Stagger 渐进动效
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.05
    }
  }
}

// 卡片入场动效
const cardVariants = {
  hidden: { opacity: 0, y: 22, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 380,
      damping: 28
    }
  },
  exit: {
    opacity: 0,
    scale: 0.94,
    transition: { duration: 0.16 }
  }
}

export default function HubPage () {
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [toolVersions, setToolVersions] = useState({})
  const [launchingId, setLaunchingId] = useState(null)
  const [recentToolId, setRecentToolId] = useState(() => {
    try {
      return localStorage.getItem('yami_last_tool') || ''
    } catch {
      return ''
    }
  })

  const searchInputRef = useRef(null)
  const navigate = useNavigate()

  // 动态读取并同步 version.json
  useEffect(() => {
    const applyVersions = (versionsObj) => {
      if (versionsObj && typeof versionsObj === 'object') {
        setToolVersions(versionsObj)
      }
    }

    if (window.TOOL_VERSIONS) {
      applyVersions(window.TOOL_VERSIONS)
    } else {
      fetch(`${BASE}tools/version.json?_t=${Date.now()}`)
        .then(res => res.text())
        .then(code => {
          try {
            const jsonStr = code.replace(/window\.TOOL_VERSIONS\s*=\s*/, '').replace(/;\s*$/, '')
            const parsed = JSON.parse(jsonStr)
            applyVersions(parsed)
          } catch (e) {
            // ignore
          }
        })
        .catch(() => {})
    }
  }, [])

  // 触发启动并执行丝滑过渡
  const launchTool = (tool) => {
    if (launchingId) return
    setLaunchingId(tool.id)
    setRecentToolId(tool.id)
    try {
      localStorage.setItem('yami_last_tool', tool.id)
    } catch {}

    setTimeout(() => {
      if (tool.route) {
        navigate(tool.route)
      } else if (tool.fullHref) {
        window.location.href = tool.fullHref
      }
    }, 150)
  }

  // 快捷键支持：1-8 直达工具，/ 聚焦搜索，Escape 清空
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement === searchInputRef.current) {
        if (e.key === 'Escape') {
          setSearchQuery('')
          searchInputRef.current?.blur()
        }
        return
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= TOOLS.length) {
        const targetTool = TOOLS[num - 1]
        if (targetTool) {
          launchTool(targetTool)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate, launchingId])

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }

  // 过滤卡片列表
  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return TOOLS.filter(tool => {
      const matchCat = selectedCategory === 'all' || tool.category === selectedCategory
      if (!matchCat) return false
      if (!q) return true
      const titleMatch = tool.title.toLowerCase().includes(q)
      const descMatch = tool.desc.toLowerCase().includes(q)
      const tagsMatch = tool.tags.some(t => t.toLowerCase().includes(q))
      return titleMatch || descMatch || tagsMatch
    })
  }, [selectedCategory, searchQuery])

  const hubDisplayVersion = (toolVersions.hub && toolVersions.hub.version)
    ? `v${toolVersions.hub.version}`
    : HUB_VERSION

  return (
    <motion.div
      className="hub-shell"
      initial={{ opacity: 0, scale: 0.98, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -16, filter: 'blur(4px)' }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* 顶部状态栏 */}
      <motion.header
        className="hub-header"
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <div className="brand-block">
          <motion.div
            className="brand-mark"
            whileHover={{ rotate: 12, scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
          >
            ◫
          </motion.div>
          <div>
            <div className="eyebrow">OPEN YAMI TOOLKIT</div>
            <div className="brand-name">
              YA TOOLS
              <span>
                妙妙工具箱 <em className="version-tag" data-hub-version>{hubDisplayVersion}</em>
              </span>
            </div>
          </div>
        </div>

        <div className="hub-header-actions">
          <motion.a
            className="hub-github-link"
            href="https://github.com/bajibaji/yami-tools"
            target="_blank"
            rel="noopener noreferrer"
            title="查看 GitHub 源代码"
            aria-label="查看 GitHub 源代码"
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.96 }}
          >
            <svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>GitHub</span>
          </motion.a>

          <div className="hub-status-badge">
            <span className="status-dot"></span>
            <span>100% 本地环境运行 · GitHub Pages</span>
          </div>
        </div>
      </motion.header>

      {/* 主体内容 */}
      <main className="hub-main">
        {/* Banner 英雄区 */}
        <motion.section
          className="hub-hero"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.08 }}
        >
          <motion.div
            className="hero-glow"
            animate={{
              opacity: [0.1, 0.22, 0.1],
              scale: [1, 1.08, 1]
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
          />
          <div className="hero-content">
            <div className="hero-kicker">
              <span className="status-dot"></span> TOOLKIT HUB / 00
            </div>
            <h1>专为 Yami 引擎打造的<em>开发利器。</em></h1>
            <p>所有工具均在浏览器内安全处理工程文件，无需上传网络，保存即备份。支持按键盘 <kbd>1</kbd>-<kbd>8</kbd> 快捷启动，按 <kbd>/</kbd> 搜索。</p>
          </div>
        </motion.section>

        {/* 控制工具条：分类筛选与实时搜索 */}
        <motion.section
          className="hub-toolbar"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12 }}
        >
          <div className="category-tabs" role="tablist">
            {CATEGORIES.map(cat => (
              <motion.button
                key={cat.id}
                type="button"
                className={`category-tab ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                {cat.name}
                {cat.id === 'all' && <span className="cat-count">{TOOLS.length}</span>}
              </motion.button>
            ))}
          </div>

          <div className="hub-search-box">
            <span className="search-icon">⌕</span>
            <input
              ref={searchInputRef}
              type="search"
              placeholder="搜索工具、标签或功能描述..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="hub-search-input"
            />
            {searchQuery ? (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="清空搜索"
              >
                ✕
              </button>
            ) : (
              <kbd className="search-shortcut">/</kbd>
            )}
          </div>
        </motion.section>

        {/* 工具卡片网格 */}
        <motion.section
          className="hub-grid"
          layout
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {filteredTools.map(tool => {
              const liveVersion = (toolVersions[tool.id] && toolVersions[tool.id].version)
                ? `v${toolVersions[tool.id].version}`
                : tool.version
              const isRecent = recentToolId === tool.id
              const isLaunching = launchingId === tool.id

              return (
                <motion.div
                  key={tool.id}
                  className={`tool-card ${isLaunching ? 'launching' : ''}`}
                  onMouseMove={handleMouseMove}
                  onClick={(e) => {
                    e.preventDefault()
                    launchTool(tool)
                  }}
                  variants={cardVariants}
                  layout
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  whileHover={!isLaunching ? {
                    y: -5,
                    scale: 1.015,
                    transition: { duration: 0.2 }
                  } : {}}
                  whileTap={!isLaunching ? { scale: 0.985 } : {}}
                >
                  <div className="card-glow"></div>

                  <div className="tool-card-header">
                    <div className="tool-icon-group">
                      <motion.span
                        className={`tool-icon ${tool.iconClass || ''}`}
                        whileHover={{ scale: 1.15, rotate: [-2, 2, 0] }}
                        transition={{ duration: 0.2 }}
                      >
                        {tool.icon}
                      </motion.span>
                      {tool.shortcut && (
                        <span className="tool-shortcut-badge" title={`按键盘 ${tool.shortcut} 快捷启动`}>
                          {tool.shortcut}
                        </span>
                      )}
                    </div>

                    <div className="tool-version-group">
                      {isRecent && <span className="recent-badge">上次使用</span>}
                      <span className={'tool-version' + (tool.beta ? ' beta' : '')}>
                        {liveVersion}{tool.beta ? ' · beta' : ''}
                      </span>
                    </div>
                  </div>

                  <div className="tool-card-body">
                    <h2 className="tool-card-title">
                      {tool.title}
                      <span className="card-arrow">→</span>
                    </h2>
                    <p className="tool-card-desc">{tool.desc}</p>
                  </div>

                  <div className="tool-card-footer">
                    <span className="tool-tag">{tool.tags.join(' · ')}</span>
                    <span className="tool-action">
                      {isLaunching ? '启动中…' : (tool.action || '启动工具')}
                    </span>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

          {filteredTools.length === 0 && (
            <motion.div
              className="hub-empty-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="empty-icon">🔍</div>
              <p>未找到匹配 “<strong>{searchQuery}</strong>” 的工具</p>
              <button
                type="button"
                className="btn primary"
                onClick={() => { setSelectedCategory('all'); setSearchQuery('') }}
              >
                重置筛选条件
              </button>
            </motion.div>
          )}
        </motion.section>
      </main>

      {/* 页脚 footer */}
      <motion.footer
        className="hub-footer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.4 }}
      >
        <div className="footer-left">
          <span>YAMI TOOLKIT HUB</span>
          <span className="footer-divider"></span>
          <span>为每一份数据保留秩序</span>
        </div>
        <div className="footer-right">
          本地工具 · 数据无上传 · <em>{hubDisplayVersion}</em>
        </div>
      </motion.footer>
    </motion.div>
  )
}
