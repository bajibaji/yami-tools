import { Link } from 'react-router-dom'
import { TOOLS, HUB_VERSION } from '../data/tools.js'

export default function HubPage () {
  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }

  return (
    <div className="hub-shell">
      <header className="hub-header">
        <div className="brand-block">
          <div className="brand-mark">◫</div>
          <div>
            <div className="eyebrow">OPEN YAMI TOOLKIT</div>
            <div className="brand-name">YA TOOLS<span>妙妙工具箱 <em className="version-tag" data-hub-version>{HUB_VERSION}</em></span></div>
          </div>
        </div>
        <div className="hub-header-actions">
          <a
            className="hub-github-link"
            href="https://github.com/bajibaji/yami-tools"
            target="_blank"
            rel="noopener noreferrer"
            title="查看 GitHub 源代码"
            aria-label="查看 GitHub 源代码"
          >
            <svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>GitHub</span>
          </a>
          <div className="hub-status-badge"><span className="status-dot"></span><span>100% 本地环境运行 · GitHub Pages</span></div>
        </div>
      </header>

      <main className="hub-main">
        <section className="hub-hero">
          <div className="hero-glow"></div>
          <div className="hero-content">
            <div className="hero-kicker"><span className="status-dot"></span> TOOLKIT HUB / 00</div>
            <h1>专为 Yami 引擎打造的<em>开发利器。</em></h1>
            <p>所有工具均在浏览器内安全处理工程文件，无需上传网络，保存即备份。</p>
          </div>
        </section>

        <section className="hub-grid">
          {TOOLS.map(tool => {
            const inner = (
              <>
                <div className="card-glow"></div>
                <div className="tool-card-header">
                  <span className={`tool-icon ${tool.iconClass || ''}`}>{tool.icon}</span>
                  <span className={'tool-version' + (tool.beta ? ' beta' : '')}>{tool.version}{tool.beta ? ' · beta' : ''}</span>
                </div>
                <div className="tool-card-body">
                  <h2 className="tool-card-title">{tool.title}<span className="card-arrow">→</span></h2>
                  <p className="tool-card-desc">{tool.desc}</p>
                </div>
                <div className="tool-card-footer">
                  <span className="tool-tag">{tool.tags.join(' · ')}</span>
                  <span className="tool-action">{tool.action || '启动工具'}</span>
                </div>
              </>
            )
            return tool.route
              ? <Link key={tool.id} className="tool-card" to={tool.route} onMouseMove={handleMouseMove}>{inner}</Link>
              : <a key={tool.id} className="tool-card" href={tool.fullHref} onMouseMove={handleMouseMove}>{inner}</a>
          })}
        </section>
      </main>

      <footer className="hub-footer">
        <div className="footer-left">
          <span>YAMI TOOLKIT HUB</span>
          <span className="footer-divider"></span>
          <span>为每一份数据保留秩序</span>
        </div>
        <div className="footer-right">本地工具 · 数据无上传 · <em>{HUB_VERSION}</em></div>
      </footer>
    </div>
  )
}
