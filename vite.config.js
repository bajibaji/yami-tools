import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 自定义 Vite 开发服务器插件：确保本地 dev 环境下访问 /tools/xxx/ 自动映射到 public/tools/xxx/index.html
function publicToolsDevPlugin() {
  return {
    name: 'public-tools-dev-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url) {
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
  plugins: [react(), publicToolsDevPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})