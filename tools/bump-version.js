/* 版本资源刷新：界面版本号已运行时从 tools/version.json 动态读取（改版本号即生效，无需本脚本）。
   本脚本只负责刷新静态资源查询串，避免浏览器/GitHub Pages 使用旧缓存。
   用法：node tools/bump-version.js */
'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const CHANGES = []

function bump(file, tool) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) return
  const html = fs.readFileSync(absolute, 'utf8')
  const match = /\?v=(\d{8})-([\w-]+?)-(\d+)/.exec(html)
  const next = match ? Number(match[3]) + 1 : 1
  const updated = html.replace(/\?v=\d{8}-[\w-]+?-\d+/g, `?v=${today}-${tool}-${next}`)
  if (updated !== html) {
    fs.writeFileSync(absolute, updated)
    CHANGES.push(`${file} → ?v=${today}-${tool}-${next}`)
  }
}

bump('index.html', 'hub')
for (const tool of ['character-editor', 'map-editor', 'idle-lab']) bump(`tools/${tool}/index.html`, tool)

console.log(CHANGES.length ? CHANGES.join('\n') : '无查询串变更')
