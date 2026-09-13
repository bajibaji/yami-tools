'use strict'
/**
 * 测试工程解析（跨平台）
 *
 * 铁律：绝不把某一个开发者机器的绝对路径写成默认值。
 * 此前十几个套件的默认值都是 '/home/deck/yami-fixture' —— 那是某台 Linux 机器的路径，
 * 于是在 Windows 上这些套件要么整片失败（exit 2），要么一直"优雅跳过"，
 * 看起来是绿的，其实一次都没跑过。
 *
 * 解析顺序：
 *   1. YAMI_TEST_PROJECT 环境变量（CI / 换机器时唯一的指定入口）；
 *   2. Windows 本机开发目录 D:\\new-game；
 *   3. Open Yami 源码仓库自带的模板工程；
 *   4. /home/deck/yami-fixture（保留，兼容原有开发机习惯）。
 * 判定口径与 ai-host.isProjectRoot 完全一致：game.yamirpg 或（Assets + Data）。
 *
 * 一个都找不到时返回空串，由调用方自己决定是"跳过"还是"失败"——
 * 这个模块不替测试做决定。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function isProjectRoot(dir) {
  try {
    const target = path.resolve(String(dir || ''))
    if (!target) return false
    return fs.existsSync(path.join(target, 'game.yamirpg')) ||
      (fs.existsSync(path.join(target, 'Assets')) && fs.existsSync(path.join(target, 'Data')))
  } catch (e) {
    return false
  }
}

function projectCandidates() {
  return [
    process.env.YAMI_TEST_PROJECT,
    'D:\\new-game',
    path.resolve(ROOT, '..', '2', 'Project', 'Templates', 'arpg-ts-chinese'),
    '/home/deck/yami-fixture'
  ].filter(Boolean)
}

function resolveProject() {
  for (const dir of projectCandidates()) {
    if (isProjectRoot(dir)) return path.resolve(dir)
  }
  return ''
}

module.exports = { resolveProject, isProjectRoot, projectCandidates }
