/**
 * 静态健康检查（无需起进程，秒级返回）
 *
 * 存在意义：有两类致命问题，`node --check` 和运行时测试都抓不住——
 *  ① 严格模式下的「隐式全局」：给未声明标识符赋值会当场抛 ReferenceError。
 *     实例：思考过程块里写了 `currentThinkingEl = ...` 但从未声明，
 *           语法检查全绿、构建全绿，一到真机点开对话就整轮崩掉。
 *  ② style.css 结构损坏：手工往滚动条选择器组里追加容器时把 `A:hover,`
 *     写成了 `A:hover {`，浏览器会静默丢掉整段规则，页面毫无报错。
 * 这两条都在这里把关，改动样式或前端脚本后跑一遍即可。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// 浏览器/Node 环境自带的全局量（不是隐式全局）
const KNOWN_GLOBALS = new Set([
  'window', 'document', 'localStorage', 'sessionStorage', 'console', 'process', 'module', 'exports',
  'require', 'globalThis', 'navigator', 'location', 'history', 'screen', 'fetch', 'File', 'Image',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'performance', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame',
  'cancelAnimationFrame', 'TextDecoder', 'TextEncoder', 'Uint8Array', 'ArrayBuffer', 'URL', 'URLSearchParams',
  'Blob', 'AbortController', 'AbortSignal', 'CustomEvent', 'Event', 'crypto', 'structuredClone',
  'atob', 'btoa', 'Buffer', '__dirname', '__filename', 'arguments', 'undefined', 'NaN', 'Infinity',
  'JSON', 'Math', 'Date', 'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect',
  'Number', 'String', 'Boolean', 'Object', 'Array', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'eval', 'Function', 'Intl', 'BigInt', 'SharedArrayBuffer', 'Atomics',
  'WebSocket', 'Worker', 'MessageChannel', 'MessagePort', 'Audio', 'HTMLElement', 'Element', 'Node',
  'EventTarget', 'DOMParser', 'XMLHttpRequest', 'alert', 'confirm', 'prompt', 'postMessage', 'self',
  'top', 'parent', 'frames', 'name', 'status', 'origin', 'close', 'open', 'focus', 'blur', 'scroll',
  'scrollTo', 'scrollBy', 'getComputedStyle', 'matchMedia', 'devicePixelRatio', 'innerWidth',
  'innerHeight', 'outerWidth', 'outerHeight', 'pageXOffset', 'pageYOffset', 'scrollX', 'scrollY'
])

/**
 * 把注释清成空格、把字符串/模板字面量换成一个 `0` 占位（换行数保持，行号不变）。
 * 两个原因缺一不可：
 *  ① 注释与 HTML 模板里出现的 "let"、"{" 会让声明收集跑偏，产生误报——静态检查一旦误报就会被绕过；
 *  ② 字面量若清成空格，`let buffer = ''` 会变成 `let buffer =`，
 *     看起来像「声明未结束」，续行判断就会把后面几十行全吞进来，真声明反而被漏掉。
 */
function blankOutLiterals(src) {
  const out = src.split('')
  const blank = (from, to, ch) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ch
  }
  const placeholder = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '
    out[from] = '0'
  }
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end === -1 ? n : end + 2
      blank(i, j)
      i = j
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) { j++; break }
        if (src[j] === '\n' && c !== '`') break
        j++
      }
      placeholder(i, j)
      i = j
      continue
    }
    // 正则字面量：前一个有效字符决定 `/` 是除号还是正则开头
    if (c === '/') {
      let k = i - 1
      while (k >= 0 && /\s/.test(src[k])) k--
      const prev = k >= 0 ? src[k] : ''
      if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
        let j = i + 1
        let inClass = false
        let closed = false
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue }
          if (src[j] === '[') inClass = true
          else if (src[j] === ']') inClass = false
          else if (src[j] === '/' && !inClass) { closed = true; break }
          j++
        }
        if (closed) {
          placeholder(i, j + 1)
          i = j + 1
          continue
        }
      }
    }
    i++
  }
  return out.join('')
}

/** 收集一个脚本里「被声明过」的标识符（变量/常量/函数/类/形参/catch 参数/解构） */
function collectDeclared(src) {
  const declared = new Set()
  const idRe = /[A-Za-z_$][\w$]*/g

  // ① let / const / var：逐行截取声明头（必要时吃续行），只解析绑定模式，不解析右侧值
  //    —— 逐行是为了让一处解析偏差不会连带漏掉后面所有声明
  const lines = src.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const kwRe = /\b(let|const|var|function|class)\b/g
    let m
    while ((m = kwRe.exec(line))) {
      if (m[1] === 'function' || m[1] === 'class') {
        const id = /^\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line.slice(kwRe.lastIndex))
        if (id) declared.add(id[1])
        continue
      }
      let seg = line.slice(kwRe.lastIndex)
      let end = li
      for (let guard = 0; guard < 40 && end + 1 < lines.length; guard++) {
        const opens = (seg.match(/[([{]/g) || []).length
        const closes = (seg.match(/[)\]}]/g) || []).length
        if (opens <= closes && !/[,=]\s*$/.test(seg)) break
        end++
        seg += '\n' + lines[end]
      }
      const parts = []
      let buf = ''
      let depth = 0
      for (const c of seg) {
        if (c === '(' || c === '[' || c === '{') depth++
        else if (c === ')' || c === ']' || c === '}') depth--
        if (c === ',' && depth === 0) { parts.push(buf); buf = ''; continue }
        buf += c
      }
      parts.push(buf)
      for (const part of parts) {
        // `=` 左侧才是绑定模式，右侧是取值表达式（避免把对象字面量的 key 当成声明）
        let eq = -1
        depth = 0
        for (let i = 0; i < part.length; i++) {
          const c = part[i]
          if (c === '(' || c === '[' || c === '{') depth++
          else if (c === ')' || c === ']' || c === '}') depth--
          else if (c === '=' && depth === 0 && part[i + 1] !== '=' && part[i - 1] !== '=' && part[i - 1] !== '!' && part[i - 1] !== '<' && part[i - 1] !== '>') { eq = i; break }
        }
        const binding = eq === -1 ? part : part.slice(0, eq)
        const head = /^\s*([A-Za-z_$][\w$]*)/.exec(binding)
        if (head) declared.add(head[1])
        for (const block of binding.matchAll(/[{[]([^}\]]*)[}\]]/g)) {
          for (const id of block[1].match(idRe) || []) declared.add(id)
        }
      }
    }
  }

  // ② 形参（function / 箭头函数）
  for (const p of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const id of p[1].match(idRe) || []) declared.add(id)
  }
  // ③ catch (e) 与 for (const x of ...)
  for (const p of src.matchAll(/\bcatch\s*\(([^)]*)\)/g)) {
    for (const id of p[1].match(idRe) || []) declared.add(id)
  }
  for (const p of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(p[1])
  return declared
}

/** 找出「行首缩进标识符 = 值」却不是声明、也不是已知全局的赋值（严格模式会抛错） */
function findImplicitGlobals(src) {
  const declared = collectDeclared(src)
  const hits = new Map()
  const lines = src.split('\n')
  lines.forEach((line, index) => {
    const m = /^(\s+)([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(line)
    if (!m) return
    const name = m[2]
    if (declared.has(name) || KNOWN_GLOBALS.has(name)) return
    if (!hits.has(name)) hits.set(name, index + 1)
  })
  return hits
}

function checkImplicitGlobals(file) {
  const full = path.join(ROOT, file)
  if (!fs.existsSync(full)) return null
  const src = fs.readFileSync(full, 'utf8')
  const strict = /['"]use strict['"]/.test(src.slice(0, 600)) || /^\s*['"]use strict['"]/m.test(src)
  const hits = findImplicitGlobals(blankOutLiterals(src))
  if (strict && hits.size > 0) {
    const detail = [...hits].map(([name, line]) => `${name} (第 ${line} 行)`).join(' / ')
    assert.fail(`${file} 存在隐式全局（严格模式下赋值会当场抛 ReferenceError）: ${detail}\n   修法: 在模块作用域显式 let/const 声明这些变量`)
  }
  return { file, strict, count: hits.size }
}

function checkCssStructure(file) {
  const full = path.join(ROOT, file)
  if (!fs.existsSync(full)) return null
  const src = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const stack = []
  let line = 1
  let error = null
  for (let i = 0; i < src.length && !error; i++) {
    const c = src[i]
    if (c === '\n') { line++; continue }
    if (c === '{') {
      if (stack.length > 0 && !stack[stack.length - 1]) {
        error = `第 ${line} 行: 普通规则块内又出现 '{'（多半是选择器组漏了逗号）`
        break
      }
      const head = src.slice(Math.max(0, i - 400), i)
      const seg = head.slice(Math.max(head.lastIndexOf('{'), head.lastIndexOf('}'), head.lastIndexOf(';')) + 1)
      stack.push(/^\s*@/.test(seg))
      continue
    }
    if (c === '}') {
      if (stack.length === 0) { error = `第 ${line} 行: 多余的 '}'`; break }
      stack.pop()
    }
  }
  if (!error && stack.length > 0) error = `文件结尾有 ${stack.length} 个 '{' 未闭合`
  assert.equal(error, null, `${file} 结构损坏 -> ${error}`)
  return { file, ok: true }
}

/**
 * 插件装配自检：主世界装载器 / manifest / 热更新清单 / 部署清单 必须互相咬合。
 * 历史事故：Electron 20 的内容脚本跑在隔离世界（没有 require），
 * 插件却直接把三个脚本挂进 content_scripts，结果 AI 宿主起不来、5966/5967 桥永不监听。
 */
function checkPluginWiring() {
  const shipped = ['bootstrap.js', 'ai-render-core.js', 'probe-core.js', 'hud-overlay.js', 'ai-agent.js', 'ai-host.js']
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
  const bootstrap = fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8')

  const scripts = (manifest.content_scripts || []).flatMap(entry => entry.js || [])
  assert.ok(scripts.includes('bootstrap.js'), 'manifest 必须挂载主世界装载器 bootstrap.js')
  for (const file of ['ai-render-core.js', 'probe-core.js', 'hud-overlay.js', 'ai-agent.js']) {
    assert.ok(!scripts.includes(file), `${file} 不能直接挂进 content_scripts（隔离世界没有 Node），必须由 bootstrap.js 注入主世界`)
    assert.ok(bootstrap.includes(`'${file}'`), `bootstrap.js 必须注入 ${file}`)
  }
  const firstScript = (manifest.content_scripts || [])[0] || {}
  assert.ok(!('world' in firstScript), 'manifest 不要声明 world 字段：Chrome 111+ 才有，Electron 20 会忽略（写了等于假装生效）')

  const war = (manifest.web_accessible_resources || []).flatMap(entry => entry.resources || [])
  for (const file of ['ai-render-core.js', 'probe-core.js', 'hud-overlay.js', 'ai-agent.js']) {
    assert.ok(war.includes(file), `web_accessible_resources 必须放行 ${file}（主世界按扩展基址取脚本）`)
  }

  const probe = fs.readFileSync(path.join(ROOT, 'probe-core.js'), 'utf8')
  const declared = (probe.match(/updateFiles:\s*\[([\s\S]*?)\]/) || ['', ''])[1]
  for (const file of shipped) {
    assert.ok(declared.includes(`'${file}'`), `热更新清单 updateFiles 必须包含 ${file}，否则老用户热更新后缺文件`)
  }

  // 引擎接口兼容：源码版把内部对象挂在 window.YamiEngine 下（打包版才是裸全局），
  // 插件三处取值点都必须认这个命名空间，否则「保存/撤销/刷新/试玩」在源码版又全废。
  const probeSrc = fs.readFileSync(path.join(ROOT, 'probe-core.js'), 'utf8')
  assert.ok(/function engineApi\(/.test(probeSrc), 'probe-core 必须用 engineApi() 统一取引擎接口（兼容 window.YamiEngine 与裸全局）')
  assert.ok(/const engine = engineApi\(\)/.test(probeSrc), '编辑器动作桥必须绑定 engineApi() 的结果，后续裸引用才两套都兼容')
  const server = fs.readFileSync(path.join(ROOT, 'runtime/yami-mcp/server.js'), 'utf8')
  assert.ok(/window\.YamiEngine \|\| \{\}/.test(server), 'MCP 的 editor_action 必须经 window.YamiEngine 取 File/Directory/Title/UndoManager')
  const agent = fs.readFileSync(path.join(ROOT, 'ai-agent.js'), 'utf8')
  assert.ok(/window\.YamiEngine && window\.YamiEngine\.File/.test(agent), 'ai-agent 定位工程根也必须认 window.YamiEngine.File')

  const builder = fs.readFileSync(path.join(ROOT, 'build.cjs'), 'utf8')
  const syncList = (builder.match(/const syncFiles = \[([^\]]*)\]/) || ['', ''])[1]
  for (const file of shipped) {
    assert.ok(syncList.includes(`'${file}'`), `部署清单 syncFiles 必须包含 ${file}，否则镜像里少文件`)
  }
  return { files: shipped.length, bootstrap: 3 }
}

function main() {
  const scripts = ['ai-agent.js', 'ai-render-core.js', 'ai-host.js', 'hud-overlay.js', 'probe-core.js', 'runtime/yami-mcp/server.js']
  const checked = []
  for (const file of scripts) {
    const result = checkImplicitGlobals(file)
    if (result) checked.push(`${result.file}${result.strict ? '' : '(非严格模式, 仅记录)'}`)
  }
  console.log(`隐式全局扫描: ${checked.length} 个脚本，无未声明赋值 -> ${checked.join(' / ')}`)

  const css = checkCssStructure('src/style.css')
  assert.ok(css, 'src/style.css 必须存在')
  console.log('CSS 结构检查: 花括号配平、无规则块嵌套')

  const wiring = checkPluginWiring()
  console.log(`插件装配检查: 主世界装载器 -> 3 个脚本 / manifest / 热更新清单 / 部署清单 (${wiring.files} 个发布文件) 全部咬合`)

  console.log('静态健康检查: 隐式全局 / CSS 结构 / 插件装配 全部通过')
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.stack || error.message)
    process.exit(1)
  }
}

module.exports = { blankOutLiterals, collectDeclared, findImplicitGlobals, checkImplicitGlobals, checkCssStructure, checkPluginWiring }
