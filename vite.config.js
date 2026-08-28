import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

import { exec } from 'child_process'

// 自定义 Vite 开发服务器插件：确保本地 dev 环境下支持唤起 explorer.exe 以及 tools 路由映射
function localDevToolsPlugin() {
  return {
    name: 'local-dev-tools-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()

        // 1. 本地直接唤起 Windows explorer.exe 系统文件管理器
        if (req.url.startsWith('/api/open-in-explorer') || req.url.startsWith('/yami-tools/api/open-in-explorer')) {
          const urlObj = new URL(req.url, 'http://localhost')
          let targetPath = urlObj.searchParams.get('path') || ''
          if (targetPath) {
            targetPath = path.normalize(targetPath.trim().replace(/^["']|["']$/g, ''))
            const isFile = fs.existsSync(targetPath) ? fs.statSync(targetPath).isFile() : /\.[a-zA-Z0-9]+$/.test(targetPath)
            const cmd = isFile
              ? `explorer.exe /select,"${targetPath}"`
              : `explorer.exe "${targetPath}"`

            exec(cmd, (err) => {
              res.setHeader('Content-Type', 'application/json')
              if (err) {
                res.statusCode = 500
                res.end(JSON.stringify({ ok: false, error: err.message }))
              } else {
                res.end(JSON.stringify({ ok: true, path: targetPath }))
              }
            })
            return
          }
        }

        // 2. 映射 legacy tools
        const [urlPath, query] = req.url.split('?')
        const match = urlPath.match(/(?:\/yami-tools)?\/tools\/([a-zA-Z0-9_-]+)(?:\/|\/index\.html)?$/)
        if (match) {
          const toolName = match[1]
          const htmlPath = path.resolve(__dirname, 'public/tools', toolName, 'index.html')
          if (fs.existsSync(htmlPath)) {
            if (!urlPath.endsWith('/index.html')) {
              req.url = `/yami-tools/tools/${toolName}/index.html` + (query ? `?${query}` : '')
            }
          }
        }
        next()
      })
    }
  }
}

// GitHub Pages 仓库地址为 https://github.com/bajibaji/yami-tools
// 部署后访问路径为 /yami-tools/，base 必须与此保持一致。
export default defineConfig({
  base: '/yami-tools/',
  server: {
    watch: {
      // 忽略编辑器/工具的原子写临时目录，避免 EBUSY 崩溃
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.tmp/**']
    }
  },
  plugins: [react(), localDevToolsPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})