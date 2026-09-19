'use strict'
/**
 * 桥端口的唯一真源：**环境变量 > 插件数据目录里的 <kind>-port > 默认端口**。
 *
 * 为什么要有它：桥自己会自适应端口（5966/5967 被别的程序占用时往后换），换完把真实端口写进
 * 插件数据目录；助手与 MCP 这边必须读同一个文件，否则就会出现"桥明明起来了、AI 却说没在试玩"
 * 这种假报错（实测踩过：Steam 占着端口，面板报"AI 助手启动超时"）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

function configDir() {
  return process.env.YAMI_AI_CONFIG_DIR || path.join(process.env.APPDATA || os.homedir(), 'DanJuanDevSuite')
}

function readPort(kind, fallback, envName) {
  if (envName && process.env[envName]) {
    const n = Number(process.env[envName])
    if (Number.isInteger(n) && n > 0 && n < 65536) return n
  }
  try {
    const n = Number(String(fs.readFileSync(path.join(configDir(), kind + '-port'), 'utf8')).trim())
    if (Number.isInteger(n) && n > 0 && n < 65536) return n
  } catch (e) { /* 还没写出来：用默认端口 */ }
  return fallback
}

/** 试玩运行时桥（probe-core 在试玩窗口里起的那个） */
function runtimePort() { return readPort('runtime', 5966, 'YAMI_RUNTIME_BRIDGE_PORT') }
/** 编辑器动作桥 */
function editorPort() { return readPort('editor', 5967, 'YAMI_EDITOR_BRIDGE_PORT') }

module.exports = { runtimePort, editorPort, readPort, configDir }
