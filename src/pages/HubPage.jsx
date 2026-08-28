import { Link } from 'react-router-dom'
import { TOOLS, HUB_VERSION } from '../data/tools.js'

export default function HubPage () {
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
        <div className="hub-status-badge"><span className="status-dot"></span><span>100% 本地环境运行 · GitHub Pages</span></div>
      </header>

      <main className="hub-main">
        <section className="hub-hero">
          <div className="hero-kicker"><span className="status-dot"></span> TOOLKIT HUB / 00</div>
          <h1>专为 Yami 引擎打造的<em>开发利器。</em></h1>
          <p>所有工具均在浏览器内安全处理本地文件，无需上传网络，保存即备份。</p>
        </section>

        <section className="hub-grid">
          {TOOLS.map(tool => {
            const inner = (
              <>
                <div className="tool-card-header">
                  <span className="tool-icon">{tool.icon}</span>
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
              ? <Link key={tool.id} className="tool-card" to={tool.route}>{inner}</Link>
              : <a key={tool.id} className="tool-card" href={tool.fullHref}>{inner}</a>
          })}
        </section>
      </main>

      <footer className="hub-footer">
        <span>YAMI TOOLKIT HUB · 为每一份数据保留秩序</span>
        <span>本地工具 · 数据无上传 · {HUB_VERSION}</span>
      </footer>
    </div>
  )
}
