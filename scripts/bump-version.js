/* 版本资源刷新：界面版本号已运行时从 tools/version.json 动态读取（改版本号即生效，无需本脚本）。
   本脚本负责两件事：① 刷新各 HTML 里 app.js/css 等静态资源查询串；② 刷新 version.json 自身的查询串
   （version.json 是 <script src> 静态加载，浏览器/GitHub Pages 会缓存，必须带 ?v= 才能让新版本号生效）。
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
  // 排除 version.json 自己的查询串（由 bumpVersionJson 单独维护）
  const match = /(?<!version\.json)\?v=(\d{8})-([\w-]+?)-(\d+)/.exec(html)
  const next = match ? Number(match[3]) + 1 : 1
  const updated = html.replace(/(?<!version\.json)\?v=\d{8}-[\w-]+?-\d+/g, `?v=${today}-${tool}-${next}`)
  if (updated !== html) {
    fs.writeFileSync(absolute, updated)
    CHANGES.push(`${file} → ?v=${today}-${tool}-${next}`)
  }
}

function bumpVersionJson(file) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) return
  const html = fs.readFileSync(absolute, 'utf8')
  const match = /version\.json\?v=(\d{8})-([\w-]+?)-(\d+)/.exec(html)
  const next = match ? Number(match[3]) + 1 : 1
  const updated = html.replace(/version\.json\?v=\d{8}-[\w-]+?-\d+/g, `version.json?v=${today}-tools-version-${next}`)
  if (updated !== html) {
    fs.writeFileSync(absolute, updated)
    CHANGES.push(`${file} → version.json?v=${today}-tools-version-${next}`)
  }
}

bump('index.html', 'hub')
for (const tool of ['character-editor', 'map-editor', 'idle-lab', 'localization-lab']) bump(`tools/${tool}/index.html`, tool)
for (const file of ['index.html', 'tools/character-editor/index.html', 'tools/map-editor/index.html', 'tools/idle-lab/index.html', 'tools/localization-lab/index.html']) bumpVersionJson(file)

console.log(CHANGES.length ? CHANGES.join('\n') : '无查询串变更')
