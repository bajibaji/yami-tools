#!/usr/bin/env node
'use strict'
/**
 * AI Host 端口自适应测试：5968 被别的程序占用时（实测 Steam 常占），助手要自己往后换端口，
 * 并把真实端口写进 CONFIG_DIR/agent-port —— 用户不需要设置任何东西，也不需要去关别的程序。
 * 背景：用户报"拉取模型列表失败：AI 助手启动超时"，根因就是 5968 被 Steam 占着、助手起不来。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const http = require('http')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const HOST = path.join(ROOT, 'ai-host.js')
const TOKEN = 'port-fallback-test-token'

let passed = 0
let failed = 0
function check(name, cond, detail) {
  const extra = detail === undefined ? '' : '  [' + detail + ']'
  if (cond) { passed++; console.log('  PASS  ' + name + extra) }
  else { failed++; console.error('  FAIL  ' + name + extra) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function getJson(port, route) {
  return new Promise(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: 'GET', headers: { 'x-yami-agent-token': TOKEN }, timeout: 1500 }, res => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => { try { resolve(JSON.parse(raw)) } catch { resolve(null) } })
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end()
  })
}

async function main() {
  const blocker = net.createServer()
  const port = 19300 + Math.floor(Math.random() * 300)
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(port, '127.0.0.1', resolve) })
  const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-hostport-'))
  const portFile = path.join(CONFIG_DIR, 'agent-port')
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', YAMI_AI_TOKEN: TOKEN, YAMI_AI_PORT: String(port), YAMI_AI_CONFIG_DIR: CONFIG_DIR, YAMI_AI_PARENT_PID: String(process.pid), YAMI_PROJECT_ROOT: ROOT }
  const host = spawn(process.execPath, [HOST], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env })
  let stderr = ''
  host.stderr.on('data', c => { stderr += c.toString() })
  try {
    let written = 0
    for (let i = 0; i < 60 && !written; i++) {
      await sleep(150)
      try { written = Number(String(fs.readFileSync(portFile, 'utf8')).trim()) || 0 } catch { written = 0 }
    }
    check('端口被占时助手仍然起来了，并把真实端口写进 agent-port', written === port + 1, '写的是 ' + written + '，期望 ' + (port + 1))
    check('日志里如实说明换了端口', /被其它程序占用，改试/.test(stderr), stderr.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 120))
    const status = await getJson(port + 1, '/status')
    check('换过去的端口上 /status 真的能应答', !!(status && status.ok), JSON.stringify(status).slice(0, 80))

    // 老行为不能丢：端口上是"我们自己的"助手时，新实例要认领失败并退出（前端复用已有实例）
    const second = spawn(process.execPath, [HOST], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env })
    let secondErr = ''
    second.stderr.on('data', c => { secondErr += c.toString() })
    const code = await new Promise(resolve => { second.on('exit', resolve); setTimeout(() => { second.kill(); resolve('timeout') }, 6000) })
    check('端口上已是我们的助手时，新实例识趣退出（不抢端口）', code === 0, '退出码=' + code + ' ' + secondErr.trim().slice(0, 80))
    const still = await getJson(port + 1, '/status')
    check('原实例仍然活着', !!(still && still.ok))
  } finally {
    try { host.kill() } catch { /* 忽略 */ }
    try { blocker.close() } catch { /* 忽略 */ }
    await sleep(200)
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true })
  }

  console.log('\n########## AI Host 端口自适应: ' + passed + ' PASS / ' + failed + ' FAIL ##########')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error('测试自身崩了: ' + (err && err.stack || err)); process.exit(1) })
