'use strict'

const fs = require('fs')
const path = require('path')
const { sha256, writeAtomic, restoreBackup } = require('../yami-mcp/modules/file-ops')
const GUID = 'd4a9f612bc3e7805'
const SCRIPT = 'Assets/插件/DanJuan/区域工具.' + GUID + '.ts'

function preview(root) {
  root = fs.realpathSync(path.resolve(root))
  if (!fs.existsSync(path.join(root, 'Assets')) || !fs.existsSync(path.join(root, 'Data', 'commands.json'))) throw new Error('请先打开有效的游戏工程')
  const text = fs.readFileSync(path.join(root, 'Data', 'commands.json'), 'utf8')
  const commands = JSON.parse(text)
  if (!Array.isArray(commands)) throw new Error('Data/commands.json 不是有效指令列表，未改动工程')
  const source = fs.readFileSync(path.join(__dirname, 'RegionTools.' + GUID + '.ts'), 'utf8')
  const target = path.join(root, SCRIPT)
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  // GUID 已被其它文件使用时不能注册第二份，名称与路径不能拿来推测身份。
  const stack = [path.join(root, 'Assets')]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.includes('.' + GUID + '.') && full !== target) throw new Error('区域工具 GUID 已被其它文件使用，未改动工程')
    }
  }
  if (existing !== null && existing !== source) throw new Error('已安装的区域工具被修改过，保留你的版本，不自动覆盖')
  return { root, script: SCRIPT, source, commands, commandsSha256: sha256(text),
    installed: existing === source && commands.some(item => item && item.id === GUID),
    files: [SCRIPT, 'Data/commands.json'] }
}

function install(root, expectedSha256) {
  const plan = preview(root)
  if (!expectedSha256 || expectedSha256 !== plan.commandsSha256) throw new Error('指令注册表已变化，请重新预览安装')
  if (plan.installed) return { ok: true, installed: true, files: [] }
  // 拒绝 junction/symlink 写入目标，防止工程路径表面合法却指向工程外。
  for (const rel of ['Assets', 'Assets/插件', 'Assets/插件/DanJuan', SCRIPT, 'Data', 'Data/commands.json']) {
    const full = path.join(plan.root, rel)
    if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink()) throw new Error('安装路径包含链接，未改动工程')
  }
  const target = path.join(plan.root, SCRIPT)
  const created = !fs.existsSync(target)
  let registration = null
  try {
    if (created) writeAtomic(plan.root, SCRIPT, plan.source, { tool: 'install-region-commands' })
    if (!plan.commands.some(item => item && item.id === GUID)) {
      plan.commands.push({ id: GUID, enabled: true, alias: '区域工具', keywords: 'region area 区域 获取 判断' })
      registration = writeAtomic(plan.root, 'Data/commands.json', JSON.stringify(plan.commands, null, 2), { tool: 'install-region-commands' })
    }
    return { ok: true, files: plan.files, backup: registration && registration.backup }
  } catch (error) {
    if (registration && registration.backup) restoreBackup(plan.root, 'Data/commands.json', registration.backup)
    if (created && fs.existsSync(target)) fs.unlinkSync(target)
    throw error
  }
}

async function installChecked(root, expectedSha256) {
  const plan = preview(root)
  const target = path.join(plan.root, SCRIPT)
  const created = !fs.existsSync(target)
  const result = install(root, expectedSha256)
  if (!result.files.length) return result
  const { spawn } = require('child_process')
  const compile = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, '../yami-mcp/server.js'), '--root', plan.root], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    })
    let buffer = '', settled = false
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); resolve(value) }
    const timer = setTimeout(() => finish({ ok: false, error: '编译检查超时' }), 130000)
    child.on('error', error => finish({ ok: false, error: error.message }))
    child.on('exit', () => finish({ ok: false, error: '编译检查进程已退出' }))
    child.stdout.on('data', data => {
      buffer += data.toString()
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        try {
          const message = JSON.parse(line)
          if (message.id === 1 && message.result) finish(JSON.parse(message.result.content[0].text))
        } catch {}
      }
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compile_check', arguments: {} } }) + '\n')
  })
  if (!compile.ok) {
    if (result.backup) restoreBackup(plan.root, 'Data/commands.json', result.backup)
    if (created) fs.unlinkSync(target)
    throw new Error('区域指令编译未通过，已撤回安装：' + (compile.error || compile.output || '请检查工程编译错误'))
  }
  return { ...result, compile }
}

module.exports = { GUID, SCRIPT, preview, install, installChecked }
