'use strict'
/**
 * 待办清单（todo_write）回归测试（零依赖）
 *
 * 覆盖：
 *   1. 纯逻辑：字符串/对象数组规整、非法项拒绝、统计与话术、进度不可倒退、纯文本渲染；
 *   2. MCP 端到端：写清单 → 更新状态 → 进度回报 → 禁止进度倒退 → 清空；
 *   3. 与改动小结联动：project_changelog 会带上当前计划与进度。
 *
 * 用法: node tests/test-todos.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MCP = path.join(ROOT, 'runtime', 'yami-mcp', 'server.js')
const FIXTURE = process.env.YAMI_TEST_PROJECT || '/home/deck/yami-fixture'

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-todo-'))
  for (const entry of ['Assets', 'Data', 'Script']) {
    const from = path.join(FIXTURE, entry)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, entry), { recursive: true })
  }
  for (const file of ['tsconfig.json', 'game.yamirpg']) {
    const from = path.join(FIXTURE, file)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file))
  }
  return dir
}

function startMcp(projectDir) {
  const child = spawn(process.execPath, [MCP, '--root', projectDir], {
    env: { ...process.env, YAMI_MCP_GUARDED: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = ''
  let nextId = 1
  const pending = new Map()
  child.stdout.on('data', chunk => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      const entry = pending.get(message.id)
      if (entry) { pending.delete(message.id); entry(message) }
    }
  })
  const call = (name, args) => new Promise(resolve => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n')
  const parse = async (name, args) => {
    const raw = await call(name, args)
    if (!raw || !raw.result || !raw.result.content) throw new Error('MCP 调用失败: ' + name)
    return JSON.parse(raw.result.content[0].text)
  }
  return { child, parse }
}

async function main() {
  console.log('\n########## 1. 纯逻辑 ##########')
  const { normalizeTodos, summarizeTodos, validateTransition, renderTodos, MAX_ITEMS } = require(path.join(ROOT, 'runtime', 'yami-mcp', 'modules', 'todos.js'))

  const strings = normalizeTodos(['改脚本', '跑编译'])
  check('字符串数组被规整为待做项', strings.items.length === 2 && strings.items.every(item => item.status === 'pending' && item.id))
  const objects = normalizeTodos([{ text: '第一步', status: 'done' }, { text: '第二步', status: 'in_progress' }])
  check('对象数组保留状态', objects.items[0].status === 'done' && objects.items[1].status === 'in_progress')
  const bad = normalizeTodos([{ text: '' }, 42, '正常项'])
  check('非法项被拒绝但不影响其余', bad.items.length === 1 && bad.rejected.length === 2, JSON.stringify(bad.rejected))
  check('非数组输入被拒绝', normalizeTodos('改脚本').items.length === 0)
  const many = normalizeTodos(Array.from({ length: MAX_ITEMS + 3 }, (_, i) => '步骤' + i))
  check('步数上限生效', many.items.length === MAX_ITEMS && many.rejected.some(text => /步骤过多/.test(text)))

  const summary = summarizeTodos([{ text: 'a', status: 'done' }, { text: 'b', status: 'in_progress' }, { text: 'c', status: 'pending' }])
  check('统计与话术正确', summary.total === 3 && summary.done === 1 && summary.percent === 33 && /正在做：b/.test(summary.headline), summary.headline)

  const regress = validateTransition([{ text: 'a', status: 'done' }], [{ text: 'a', status: 'pending' }])
  check('进度倒退被识别', regress.ok === false && regress.regressed[0] === 'a')
  check('正常推进被允许', validateTransition([{ text: 'a', status: 'in_progress' }], [{ text: 'a', status: 'done' }]).ok === true)

  const rendered = renderTodos([{ text: 'a', status: 'done' }, { text: 'b', status: 'in_progress' }, { text: 'c', status: 'pending' }])
  check('纯文本渲染带状态标记', /\[完成\] a/.test(rendered) && /\[进行中\] b/.test(rendered) && /\[待做\] c/.test(rendered))

  console.log('\n########## 2. MCP 端到端 ##########')
  const project = copyFixture()
  const { child, parse } = startMcp(project)
  await new Promise(resolve => setTimeout(resolve, 700))
  try {
    const created = await parse('todo_write', { todos: ['先看现状', '改脚本', '跑编译', '试玩确认'] })
    check('创建清单成功', created.ok === true && created.items.length === 4, String(created.progress || ''))
    check('回报进度话术', /进度 0\/4/.test(String(created.progress || '')), String(created.progress || ''))
    check('给出下一步提示', /继续做/.test(String(created.hint || '')))

    const progressed = await parse('todo_write', { todos: [
      { text: '先看现状', status: 'done' },
      { text: '改脚本', status: 'in_progress' },
      { text: '跑编译', status: 'pending' },
      { text: '试玩确认', status: 'pending' }
    ] })
    check('推进状态成功', progressed.ok === true && progressed.summary.done === 1 && /正在做：改脚本/.test(progressed.progress), progressed.progress)

    const regressed = await parse('todo_write', { todos: [
      { text: '先看现状', status: 'pending' },
      { text: '改脚本', status: 'in_progress' }
    ] })
    check('禁止把已完成改回未完成', regressed.ok === false && Array.isArray(regressed.regressed) && regressed.regressed[0] === '先看现状', String(regressed.error || '').slice(0, 40))

    const finished = await parse('todo_write', { todos: [
      { text: '先看现状', status: 'done' },
      { text: '改脚本', status: 'done' },
      { text: '跑编译', status: 'done' },
      { text: '试玩确认', status: 'done' }
    ] })
    check('全部完成时提示可收尾', finished.ok === true && finished.summary.percent === 100 && /全部完成/.test(String(finished.hint || '')), String(finished.hint || ''))

    console.log('\n########## 3. 与改动小结联动 ##########')
    await parse('project_changelog', { reset: true })
    const log = await parse('project_changelog', {})
    check('小结带上当前计划与进度', Array.isArray(log.todos) && log.todos.length === 4 && log.todoSummary && log.todoSummary.done === 4, JSON.stringify(log.todoSummary || {}))

    const cleared = await parse('todo_write', { clear: true })
    check('清空清单成功', cleared.ok === true && cleared.items.length === 0)
    const afterClear = await parse('project_changelog', {})
    check('清空后小结不再带计划', !afterClear.todos || afterClear.todos.length === 0)
  } finally {
    child.kill()
    fs.rmSync(project, { recursive: true, force: true })
  }

  console.log(`\n########## 待办清单测试: ${passed} PASS / ${failed} FAIL ##########`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
