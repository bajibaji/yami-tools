'use strict'

/**
 * event-builder.js — 高阶事件指令流装配器
 * 将大模型输入的自然语义/简化指令结构，自动编译为 Open Yami 引擎合法的嵌套槽位，
 * 并支持自动将自定义指令名称反查为 16 位 hex GUID，免除大模型手写复杂 JSON 易错的痛点。
 */

const fs = require('fs')
const path = require('path')
const { resolveInside, writeAtomic } = require('./file-ops')

class EventBuilder {
  constructor(projectRoot) {
    this.root = projectRoot
    this.customCommandMap = null // 名称/别名 -> GUID 缓存
  }

  /**
   * 加载自定义指令名称到 GUID 的映射表
   */
  loadCustomCommands() {
    if (this.customCommandMap) return this.customCommandMap
    const map = new Map()

    // 1. 从 Data/commands.json 读取
    const cmdJsonPath = path.join(this.root, 'Data', 'commands.json')
    if (fs.existsSync(cmdJsonPath)) {
      try {
        const list = JSON.parse(fs.readFileSync(cmdJsonPath, 'utf8'))
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.id) {
              if (item.alias) map.set(item.alias.trim(), item.id)
              if (item.name) map.set(item.name.trim(), item.id)
            }
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 2. 从 Assets/插件/自定义指令/ 目录下的文件名解析
    const cmdDir = path.join(this.root, 'Assets', '插件', '自定义指令')
    if (fs.existsSync(cmdDir)) {
      try {
        const files = fs.readdirSync(cmdDir)
        for (const f of files) {
          const m = f.match(/^(.*?)\.([0-9a-f]{16})\.ts$/)
          if (m) {
            const rawName = m[1].replace(/\.指令$/, '').trim()
            map.set(rawName, m[2])
            map.set(m[1].trim(), m[2])
          }
        }
      } catch (e) {
        // 忽略目录扫描错误
      }
    }

    this.customCommandMap = map
    return map
  }

  /**
   * 将指令标识解析为合法 ID（如果是自定义指令中文名，则转换为 GUID）
   */
  resolveCommandId(rawId) {
    if (!rawId || typeof rawId !== 'string') return ''
    const trimmed = rawId.trim()
    // 如果已经是 16 位 hex GUID 或内置小驼峰指令名，直接使用
    if (/^[0-9a-f]{16}$/.test(trimmed) || /^[a-z][a-zA-Z0-9]*$/.test(trimmed)) {
      return trimmed
    }
    const map = this.loadCustomCommands()
    if (map.has(trimmed)) {
      return map.get(trimmed)
    }
    // 尝试去词尾 .指令
    const clean = trimmed.replace(/\.指令$/, '')
    if (map.has(clean)) {
      return map.get(clean)
    }
    throw new Error(`未找到自定义指令：${trimmed}`)
  }

  normalizeCommands(commands) {
    if (!Array.isArray(commands)) return []
    return commands.map(command => this.normalizeCommand(command))
  }

  normalizeNestedParams(params) {
    if (!params || typeof params !== 'object') return params
    const output = Array.isArray(params) ? params.map(value => this.normalizeNestedParams(value)) : { ...params }
    if (!Array.isArray(output)) {
      for (const key of ['commands', 'elseCommands', 'defaultCommands']) {
        if (Array.isArray(output[key])) output[key] = this.normalizeCommands(output[key])
      }
      for (const key of ['branches', 'choices']) {
        if (Array.isArray(output[key])) {
          output[key] = output[key].map(item => {
            const next = { ...item }
            if (Array.isArray(next.commands)) next.commands = this.normalizeCommands(next.commands)
            return next
          })
        }
      }
    }
    return output
  }

  /**
   * 将高阶自然指令对象转换为引擎合法的 { id, params }
   */
  normalizeCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') {
      throw new Error('指令必须为对象')
    }

    // 已经是标准的 { id, params }
    if (typeof cmd.id === 'string' && cmd.params && typeof cmd.params === 'object') {
      return {
        id: this.resolveCommandId(cmd.id),
        params: this.normalizeNestedParams(cmd.params)
      }
    }

    const type = cmd.type || cmd.name || cmd.command
    if (!type) {
      throw new Error(`无法识别指令类型: ${JSON.stringify(cmd)}`)
    }

    switch (type) {
      case 'comment':
      case '注释':
        return {
          id: 'comment',
          params: { comment: String(cmd.comment || cmd.text || cmd.content || '') }
        }

      case 'script':
      case '脚本':
      case 'js':
        return {
          id: 'script',
          params: { script: String(cmd.script || cmd.code || '') }
        }

      case 'wait':
      case '等待':
        return {
          id: 'wait',
          params: { duration: Number(cmd.duration ?? cmd.time ?? cmd.ms ?? 1000) }
        }

      case 'showText':
      case '显示文本':
      case '对话':
        if (String(cmd.content ?? cmd.text ?? '') === '') throw new Error('对话内容不能为空')
        return {
          id: 'showText',
          params: {
            target: cmd.target || { type: 'trigger' },
            parameters: String(cmd.parameters || ''),
            content: String(cmd.content ?? cmd.text ?? '')
          }
        }

      case 'showChoices':
      case '显示选项':
      case '选项':
        if (!Array.isArray(cmd.choices) || cmd.choices.length === 0) throw new Error('选项列表不能为空')
        return {
          id: 'showChoices',
          params: {
            choices: (cmd.choices || []).map(choice => ({
              content: String(choice.content ?? choice.text ?? ''),
              commands: this.normalizeCommands(choice.commands || [])
            })),
            parameters: String(cmd.parameters || '')
          }
        }

      case 'if':
      case '条件分支':
      case '如果': {
        const params = {
          branches: (cmd.branches || []).map(branch => ({
            mode: branch.mode || 'all',
            conditions: Array.isArray(branch.conditions) ? branch.conditions : [],
            commands: this.normalizeCommands(branch.commands || [])
          }))
        }
        if (Array.isArray(cmd.elseCommands)) params.elseCommands = this.normalizeCommands(cmd.elseCommands)
        return { id: 'if', params }
      }

      case 'callEvent':
      case '调用事件':
        return {
          id: 'callEvent',
          params: {
            type: cmd.eventType || 'global',
            eventId: String(cmd.eventId || cmd.guid || cmd.id || '')
          }
        }

      case 'setNumber':
      case '设置数值':
        return {
          id: 'setNumber',
          params: {
            variable: {
              type: cmd.variableType || 'global',
              key: String(cmd.variableId || cmd.key || cmd.variable || '')
            },
            operator: cmd.operator || '=',
            operand: {
              type: cmd.operandType || 'constant',
              value: Number(cmd.value !== undefined ? cmd.value : 0)
            }
          }
        }

      case 'setString':
      case '设置文本':
        return {
          id: 'setString',
          params: {
            variable: {
              type: cmd.variableType || 'global',
              key: String(cmd.variableId || cmd.key || cmd.variable || '')
            },
            operator: cmd.operator || '=',
            operand: {
              type: cmd.operandType || 'constant',
              value: String(cmd.value ?? '')
            }
          }
        }

      default: {
        // 自定义指令或直接透传
        const resolvedId = this.resolveCommandId(type)
        return {
          id: resolvedId,
          params: this.normalizeNestedParams(cmd.params || { ...cmd, type: undefined, name: undefined, command: undefined })
        }
      }
    }
  }

  /**
   * 向指定 .event 文件追加或插入指令
   * @param {Object} options
   * @param {string} options.path 事件文件相对路径（如 Assets/! 事件/测试.event）
   * @param {Array<Object>} options.commands 要追加的指令列表
   * @param {string|number} [options.position='end'] 插入位置：'end' | 'start' | 索引数字
   * @param {boolean} [options.dryRun=true] 是否仅预览
   */
  appendCommands({ path: relPath, commands, position = 'end', dryRun = true }) {
    if (!relPath || typeof relPath !== 'string') {
      return { ok: false, error: '缺少 path 参数' }
    }
    if (!Array.isArray(commands) || commands.length === 0) {
      return { ok: false, error: 'commands 必须为非空数组' }
    }

    let absPath
    try { absPath = resolveInside(this.root, relPath) } catch (e) { return { ok: false, error: e.message } }
    if (!fs.existsSync(absPath)) {
      return { ok: false, error: `事件文件不存在: ${relPath}` }
    }

    let eventData
    try {
      eventData = JSON.parse(fs.readFileSync(absPath, 'utf8'))
    } catch (e) {
      return { ok: false, error: `读取解析事件文件失败: ${e.message}` }
    }

    if (!Array.isArray(eventData.commands)) {
      eventData.commands = []
    }

    const compiledCommands = []
    for (let i = 0; i < commands.length; i++) {
      try {
        compiledCommands.push(this.normalizeCommand(commands[i]))
      } catch (err) {
        return { ok: false, error: `第 ${i + 1} 条指令装配失败: ${err.message}` }
      }
    }

    if (position === 'start') {
      eventData.commands.unshift(...compiledCommands)
    } else if (typeof position === 'number' && position >= 0 && position <= eventData.commands.length) {
      eventData.commands.splice(position, 0, ...compiledCommands)
    } else {
      eventData.commands.push(...compiledCommands)
    }

    const outputJson = JSON.stringify(eventData, null, 2) + '\n'

    if (dryRun !== false) {
      return {
        ok: true,
        dryRun: true,
        path: relPath,
        appendedCount: compiledCommands.length,
        totalCommands: eventData.commands.length,
        previewCommands: compiledCommands,
        message: `校验通过：成功装配 ${compiledCommands.length} 条指令（未落盘，dryRun）`
      }
    }

    try {
      const written = writeAtomic(this.root, relPath, outputJson)
      return {
        ok: true,
        dryRun: false,
        path: relPath,
        appendedCount: compiledCommands.length,
        totalCommands: eventData.commands.length,
        ...written,
        message: `成功向 ${relPath} 写入 ${compiledCommands.length} 条指令（总计 ${eventData.commands.length} 步）`
      }
    } catch (e) {
      return { ok: false, error: `写入事件文件失败: ${e.message}` }
    }
  }
}

module.exports = EventBuilder
