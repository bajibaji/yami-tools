/**
 * 测试用工程夹具（拷真工程）—— 两条规矩，都是拿 23GB 换来的：
 *
 * ① **不拷媒体素材**：以前整份 Assets 拷进 %TEMP%（音频一个 wav 就 17MB），单次夹具 440MB。
 *    按**扩展名**跳过音频/图片/视频/字体/压缩包 —— 注意不能用"体积大于 N 就跳过"：
 *    实测那样会把 `Script/electron/electron.d.ts`（1.01MB）和 `Data/manifest.json`（2.85MB）
 *    一起跳过，结果 tsc 少一个类型声明直接报错，测试拿着假错误来冤枉产品代码。
 * ② **退出时自己删**：以前从不清理，本机攒了 49 个 `yami-selection-*` 残留 = 21.08GB，
 *    把用户的 C 盘塞爆了（2026-09-15 用户报）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const FIXTURE = require('./resolve-project.cjs').resolveProject()
// 只跳媒体与打包物：这些是"体积的全部来源"，而测试要的是工程结构、数据与代码
const SKIP_EXT = new Set([
  '.wav', '.mp3', '.ogg', '.flac', '.m4a',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.psd', '.tga',
  '.mp4', '.webm', '.mov', '.avi',
  '.ttf', '.otf', '.woff', '.woff2',
  '.zip', '.7z', '.rar', '.gz', '.tar', '.pack', '.map'
])
const created = []
let hooked = false

function hookExit() {
  if (hooked) return
  hooked = true
  process.on('exit', () => {
    for (const dir of created) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不该影响测试结论 */ }
    }
  })
}

/** 建一个"退出时自动删"的临时目录 */
function tempDir(prefix) {
  hookExit()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

/** 拷贝真工程的一部分（跳过媒体素材），返回临时工程目录；进程退出时自动删 */
function copyProject(prefix, entries, files) {
  const dir = tempDir(prefix)
  const keep = src => !SKIP_EXT.has(path.extname(src).toLowerCase())
  for (const entry of entries || []) {
    const from = path.join(FIXTURE, entry)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, entry), { recursive: true, filter: keep })
  }
  for (const file of files || []) {
    const from = path.join(FIXTURE, file)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file))
  }
  return dir
}

/**
 * 最小可用工程：只把"形状"造出来（game.yamirpg + Assets + Data），不拷任何真资源。
 * 给那些只需要"宿主认这个目录是工程"的流程用（打断 / 上下文计量 / 消息自愈的端到端）。
 */
function minimalProject(prefix) {
  const dir = tempDir(prefix || 'yami-mini-')
  fs.writeFileSync(path.join(dir, 'game.yamirpg'), JSON.stringify({ title: '测试工程' }))
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Data'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Data', 'config.json'), JSON.stringify({ title: '测试工程' }))
  fs.writeFileSync(path.join(dir, 'Data', 'manifest.json'), JSON.stringify({ guidMap: {}, pathMap: {}, project: {} }))
  return dir
}

module.exports = { copyProject, minimalProject, tempDir, FIXTURE, SKIP_EXT }
