/**
 * MCP 工具「提示 vs 声明」一致性检查（零依赖，秒级，不起进程）
 *
 * 事故背景：read_resource 的实现支持 key / forceFull（大文件截断后的唯一出路），
 * 但注册给模型的 inputSchema 里只声明了 path。工具返回的提示又让模型"改用 key 参数"，
 * 模型看不到这个参数，只能拿同样的 path 反复重读同一个 2.3MB 的 .ui 文件，
 * 三次之后被"打转保护"掐断——用户看到的是"模型在重复执行同一批操作（读取资源）"，
 * 而根子在工具描述不全。
 *
 * 检查两件事：
 *   ① 工具返回的提示里点名让模型传的参数，必须在同一工具的 inputSchema 里声明过；
 *   ② 关键工具 read_resource 的出路参数（key / forceFull）确实声明了。
 * 故意不做"实现里读到的每个 args.X 都要声明"的全量比对——
 * 那需要解析工具注册结构，太脆（试过，一处匹配错位就整体误报），
 * 框架内部传入的参数（如删除确认令牌）本来也不该暴露给模型。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SERVER = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')

/** 取出从 start 处 '{' 开始的块（按花括号配平） */
function readBlock(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return text.slice(start + 1)
}

/** 工具条目：源码里固定以 `\n  {\n    name: 'x'` 起头 */
function toolEntries(src) {
  const marks = [...src.matchAll(/\n {2}\{\n {4}name: '([a-z_][a-z0-9_]*)'/g)]
    .map(m => ({ name: m[1], at: m.index }))
  return marks.map((mark, i) => {
    // 最后一条的边界是工具数组的结尾 '\n]'，不是文件末尾——
    // 否则会把后面的整套工具实现算进最后一个工具的"提示"里（会误报）
    const nextAt = i + 1 < marks.length ? marks[i + 1].at : (src.indexOf('\n]', mark.at) === -1 ? src.length : src.indexOf('\n]', mark.at))
    return { name: mark.name, text: src.slice(mark.at, nextAt) }
  })
}

/** 该工具 inputSchema.properties 里声明的参数名（同文件缩进风格统一，按行首键名抓） */
function declaredParams(entryText) {
  const names = new Set()
  const propAt = entryText.indexOf('properties')
  if (propAt === -1) return names
  const braceAt = entryText.indexOf('{', propAt)
  if (braceAt === -1) return names
  const body = readBlock(entryText, braceAt)
  for (const m of body.matchAll(/(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*:\s*\{/g)) names.add(m[1])
  return names
}

/** 提示里点名让模型传的参数：如"请改用 key 参数"、"传 forceFull=true" */
function hintedParams(entryText) {
  const names = new Set()
  for (const m of entryText.matchAll(/(?:改用|使用|传|用)\s*([A-Za-z_][\w]*)\s*(?:参数|=)/g)) {
    if (['type', 'object', 'string', 'boolean', 'number', 'array'].includes(m[1])) continue
    names.add(m[1])
  }
  return names
}

function main() {
  const src = fs.readFileSync(SERVER, 'utf8').replace(/\r\n/g, '\n')
  const entries = toolEntries(src)
  assert.ok(entries.length >= 30, '工具条目解析数量异常：' + entries.length)

  // 声明集合：所有工具 inputSchema 里出现过的参数名
  const allDeclared = new Set()
  for (const entry of entries) for (const name of declaredParams(entry.text)) allDeclared.add(name)

  // 提示集合：整个文件里"让模型传某个参数"的措辞。
  // 提示写在实现分支里、schema 写在注册条目里，两边分别定位再比对，
  // 不去猜"哪条提示属于哪个工具"——那需要脆弱的配对，配错就整体误报。
  const hinted = new Set()
  for (const entry of entries) for (const name of hintedParams(entry.text)) hinted.add(name)
  for (const name of hintedParams(src)) hinted.add(name)
  const problems = [...hinted].filter(name => !allDeclared.has(name))
  console.log(`工具提示一致性: 解析 ${entries.length} 个工具，Schema 共声明 ${allDeclared.size} 个参数名，提示里点名 ${hinted.size} 个，核对是否都已声明`)
  assert.equal(problems.length, 0, '以下参数只出现在提示里、模型却传不进来（会导致反复重试直到被判空转）:\n   ' + problems.join('\n   '))

  // 关键出路参数：大文件截断后模型唯一的办法
  const readResource = entries.find(e => e.name === 'read_resource')
  assert.ok(readResource, '必须能找到 read_resource 工具')
  const declared = declaredParams(readResource.text)
  for (const param of ['path', 'key', 'forceFull']) {
    assert.ok(declared.has(param), `read_resource 必须声明 ${param}（大文件截断后模型靠它继续，否则只会反复重读）`)
  }
  console.log('read_resource 出路参数: path / key / forceFull 均已声明')
  console.log('MCP 工具提示一致性检查通过')
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
