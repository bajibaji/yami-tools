import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 仓库地址为 https://github.com/bajibaji/yami-tools
// 部署后访问路径为 /yami-tools/，base 必须与此保持一致。
export default defineConfig({
  base: '/yami-tools/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
