'use strict'

/**
 * event-builder.js — 高阶事件指令流装配器
 * 将大模型输入的自然语义/简化指令结构，自动编译为 Open Yami 引擎合法的嵌套槽位，
 * 并支持自动将自定义指令名称反查为 16 位 hex GUID，免除大模型手写复杂 JSON 易错的痛点。
 */

const fs = require('fs')
const path = require('path')
const { resolveInside, sha256, writeAtomic } = require('./file-ops')
const { unifiedDiff } = require('./diff')


/** 取语言包里的第一个语言代码（优先 zh） */
function pickFirstLang(langs) {
  const keys = Object.keys(langs || {})
  return keys[0] || ''
}

/**
 * 只取脚本 @lang 段里的 #plugin 显示名（引擎 plugin.ts 的 LanguageMap：overview 用 #plugin）。
 * 刻意不引 server.js 的解析器：event-builder 是被 require 的模块，反过来引会把依赖绕成环。
 */
function parsePluginMeta(code) {
  const block = /\/\*[\s\S]*?@plugin[\s\S]*?\*\//.exec(String(code || ''))
  if (!block) return { ok: false, langMap: {} }
  const langMap = {}
  // 【坑】引擎脚本里的 @lang 行**不带星号**（不是 JSDoc 那种 "* @lang"），旧正则要求有星号，
  // 于是第二个语言块起全被并进第一块 —— 34 个自定义指令里 9 个的「编辑器中文名」查不到。
  // 星号改成可选，两种写法都认。
  const langRe = /@lang\s+([a-zA-Z-]+)(?:\s+extends\s+([a-zA-Z-]+))?([\s\S]*?)(?=\r?\n\s*\*?\s*@lang|\r?\n\s*\*\/|$)/g
  let m
  while ((m = langRe.exec(block[0])) !== null) {
    const props = {}
    const propRe = /#(\S+)[ \t]+([^\r\n]*)/g
    let p
    while ((p = propRe.exec(m[3] || '')) !== null) {
      const name = p[1]
      if (!props['#' + name]) props['#' + name] = String(p[2] || '').trim()
    }
    langMap[m[1]] = { name: m[1], extends: m[2] || null, props }
  }
  return { ok: true, langMap }
}
/**
 * 编辑器里显示的中文名 → 引擎指令 id。
 * 【为什么必须钉死】引擎真名与「直觉中文名」撞车过两次，都**不报错、只改语义**：
 *   · 条件分支 = switch（引擎里的 if 叫「如果」）—— 判成 if 会把条件清空，分支恒真；
 *   · 设置文本 = setText（改界面文字元素）；写变量那条叫「设置字符串」= setString。
 * 真名出处：Project/Locales/zh-CN.简体中文.json（switch:994 / if:915 / setText:1117 / setString:863 /
 * setBoolean:724 / setObject:891 / setList:894 / loop:1002 / forEach:1006 / showChoices:714）。
 */
const ENGINE_COMMAND_NAMES = {
  '注释': 'comment',
  '脚本': 'script',
  '等待': 'wait',
  '显示文本': 'showText',
  '显示选项': 'showChoices',
  '弹出选项': 'showChoices',
  '如果': 'if',
  '条件分支': 'switch',
  '调用事件': 'callEvent',
  '设置数值': 'setNumber',
  '设置布尔值': 'setBoolean',
  '设置字符串': 'setString',
  '设置文本': 'setText',
  '设置对象': 'setObject',
  '设置列表': 'setList',
  '循环': 'loop',
  '遍历': 'forEach'
}

/** 数值/字符串赋值的运算符：编辑器写法 ↔ 引擎 operation 取值（setNumber.ts:18-33 / setString.ts:12-15） */
const OPERATION_NAMES = {
  '=': 'set', '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div', '%=': 'mod',
  set: 'set', add: 'add', sub: 'sub', mul: 'mul', div: 'div', mod: 'mod'
}

/** 变量访问器：模型可能给对象（引擎形状）也可能给 id 字符串，两种都要认 */
function toVariableGetter(cmd) {
  const v = cmd.variable
  if (v && typeof v === 'object' && typeof v.type === 'string') {
    return { type: v.type, key: String(v.key === undefined ? '' : v.key) }
  }
  const key = cmd.variableId !== undefined ? cmd.variableId
    : (typeof v === 'string' ? v : (cmd.key !== undefined ? cmd.key : ''))
  return { type: cmd.variableType || 'global', key: String(key === undefined ? '' : key) }
}

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

    // 2. 从 Assets/插件/自定义指令/ 目录下的文件名 + 脚本里的中文显示名解析
    //    【规则实据】编辑器里那条指令的中文名来自脚本 @lang 段的 #plugin（plugin.ts 的 LanguageMap：
    //    overview 用 #plugin、参数用 #key）；而 Data/commands.json 只有 { id, enabled, alias, keywords }，
    //    alias 实测（本机 30 条）**全是空串**、也没有 name 字段 —— 只认 alias/name 的那条路等于永远走不到，
    //    模型照着「编辑器里看到的名字」下指令就会失败。
    const cmdDir = path.join(this.root, 'Assets', '插件', '自定义指令')
    if (fs.existsSync(cmdDir)) {
      try {
        const files = fs.readdirSync(cmdDir)
        for (const f of files) {
          const m = f.match(/^(.*?)\.([0-9a-f]{16})\.ts$/)
          if (!m) continue
          const guid = m[2]
          const rawName = m[1].replace(/\.指令$/, '').trim()
          map.set(rawName, guid)
          map.set(m[1].trim(), guid)
          // 脚本里的中文显示名：模型与用户都按这个名字说话
          try {
            const meta = parsePluginMeta(fs.readFileSync(path.join(cmdDir, f), 'utf8'))
            const langs = (meta && meta.langMap) || {}
            // 引擎按编辑器当前语言取包（plugin.ts:1200-1213），这里优先中文包，取不到再退第一个
            const zhKey = Object.keys(langs).find(k => k === 'zh' || k === 'zh-CN' || k === 'zh-Hans')
              || Object.keys(langs).find(k => /^zh/i.test(k))
            const pack = (zhKey && langs[zhKey]) || langs[pickFirstLang(langs)]
            const display = pack && pack.props && pack.props['#plugin']
            if (display) map.set(String(display).trim(), guid)
          } catch (e) { /* 单个脚本解析失败不影响其它指令 */ }
        }
      } catch (e) {
        // 忽略目录扫描错误
      }
    }

    this.customCommandMap = map
    return map
  }

  /**
   * 将指令标识解析为合法 ID（自定义指令中文名 → GUID；保留 `!` 前缀）。
   *
   * 【引擎规则】`!` 前缀 = **这条指令被禁用**：
   *   · 解析（显示）时剥掉前缀：schema.ts:324 `if (id[0] === '!') id = id.slice(1)`；
   *   · 执行时直接跳过：command-parse.ts:54 `if (id == null || id[0] === '!') continue`；
   *   · 列表里启用/禁用就是加/去这个前缀：command-list.ts:1100-1114。
   * 真实工程里这种 id 很常见（本机实测 14 种、上百条），旧实现会把它当未知指令直接抛错 ——
   * 既读不了既有事件，也没法让 AI 把某条指令停掉。
   */
  resolveCommandId(rawId) {
    if (!rawId || typeof rawId !== 'string') return ''
    const trimmed = rawId.trim()
    const disabled = trimmed.startsWith('!')
    const bare = disabled ? trimmed.slice(1) : trimmed
    // 如果已经是 16 位 hex GUID 或内置小驼峰指令名，直接使用（前缀原样带回）
    if (/^[0-9a-f]{16}$/.test(bare) || /^[a-z][a-zA-Z0-9]*$/.test(bare)) {
      return disabled ? '!' + bare : bare
    }
    // 引擎真名（中文）先落到引擎 id：判错名字比报错更危险（见 ENGINE_COMMAND_NAMES 注释）
    const engineName = ENGINE_COMMAND_NAMES[bare]
    if (engineName) return disabled ? '!' + engineName : engineName
    const map = this.loadCustomCommands()
    if (map.has(bare)) {
      const resolved = map.get(bare)
      return disabled ? '!' + resolved : resolved
    }
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

    const rawType = cmd.type || cmd.name || cmd.command
    if (!rawType) {
      throw new Error(`无法识别指令类型: ${JSON.stringify(cmd)}`)
    }
    // 中文名先落成引擎 id，再进 switch —— 否则「条件分支/设置文本」这类撞车名会走到错的分支
    const type = ENGINE_COMMAND_NAMES[rawType] || rawType

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
      case '等待': {
        // 引擎：wait(duration) → getTimer().set(duration)，单位毫秒。
        // duration 还可以是**对象**（变量取值），实测真实事件里两种都有 —— 所以对象原样透传，不硬转成数字。
        const rawDuration = cmd.duration !== undefined ? cmd.duration : (cmd.time !== undefined ? cmd.time : cmd.ms)
        const duration = rawDuration === undefined ? 1000
          : (rawDuration && typeof rawDuration === 'object' ? rawDuration : Number(rawDuration))
        return { id: 'wait', params: { duration } }
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
      case '如果': {   // 引擎里「条件分支」是 switch，不是 if —— 别名表已把它引到 switch 分支
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
      case '调用事件': {
        // 引擎契约：{ type, eventId, eventArgs?, eventResult? }（编辑器 callEvent.ts:526-543）。
        // 参数与返回值过去被静默丢掉 → 带参全局事件拿到空参、返回值写不回变量。
        const src = (cmd.params && typeof cmd.params === 'object') ? cmd.params : {}
        const params = {
          type: cmd.eventType || src.type || 'global',
          eventId: String(cmd.eventId || src.eventId || cmd.guid || (typeof cmd.id === 'string' ? cmd.id : '') || '')
        }
        const args = cmd.eventArgs !== undefined ? cmd.eventArgs : src.eventArgs
        const result = cmd.eventResult !== undefined ? cmd.eventResult : src.eventResult
        if (args !== undefined) params.eventArgs = args
        if (result !== undefined) params.eventResult = result
        return { id: 'callEvent', params: this.normalizeNestedParams(params) }
      }

      case 'setNumber':
      case '设置数值': {
        // 引擎契约：{ variable, operation: set|add|sub|mul|div|mod, operands: [{operation,type,value}] }
        // 出处：编辑器 module/command/setNumber.ts:72-107、运行时 command.ts:2641-2661。
        // 旧实现写的是 operator/operand（单数），引擎一个都不认：编辑期编译直接抛错 → 整局起不来。
        const raw = cmd.operand !== undefined ? cmd.operand : (cmd.value !== undefined ? cmd.value : 0)
        const operands = Array.isArray(cmd.operands) && cmd.operands.length
          ? cmd.operands
          : [(raw && typeof raw === 'object')
            ? raw
            : { type: cmd.operandType || 'constant', value: Number(raw) }]
        return {
          id: 'setNumber',
          params: {
            variable: toVariableGetter(cmd),
            operation: OPERATION_NAMES[cmd.operator || cmd.operation || '='] || 'set',
            // 首元素 operation 固定 'add'（编辑器 setNumber.ts:105 保存时就是这么纠正的）
            operands: this.normalizeNestedParams(operands.map(function (op, i) {
              if (!op || typeof op !== 'object') return { operation: 'add', type: 'constant', value: Number(op) || 0 }
              return i === 0 && op.operation === undefined ? { ...op, operation: 'add' } : op
            }))
          }
        }
      }

      case 'setString':
      case '设置字符串': {
        // 引擎契约：{ variable, operation: set|add, operand: {type,value,...} }（运行时 command.ts:2935-2945）。
        // 注意：「设置文本」不在这里 —— 那是 setText（改界面文字元素），由别名表引到默认透传分支。
        const raw = cmd.operand !== undefined ? cmd.operand : cmd.value
        const operand = (raw && typeof raw === 'object') ? raw : { type: cmd.operandType || 'constant', value: String(raw === undefined ? '' : raw) }
        return {
          id: 'setString',
          params: {
            variable: toVariableGetter(cmd),
            operation: (cmd.operator === '+=' || cmd.operation === 'add') ? 'add' : 'set',
            operand: this.normalizeNestedParams(operand)
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
  appendCommands({ path: relPath, commands, position = 'end', expectedSha256, dryRun = true }) {
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
    let originalText
    try {
      originalText = fs.readFileSync(absPath, 'utf8')
      if (expectedSha256 && sha256(originalText) !== expectedSha256) return { ok: false, conflict: true, error: '事件文件已被其他操作修改，请重新读取后再改' }
      eventData = JSON.parse(originalText)
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
    const diffRes = unifiedDiff(originalText, outputJson, { label: relPath })
    const diffStat = { added: diffRes.added, removed: diffRes.removed, truncated: diffRes.truncated }

    if (dryRun !== false) {
      return {
        ok: true,
        dryRun: true,
        path: relPath,
        oldSha256: sha256(originalText),
        newSha256: sha256(outputJson),
        appendedCount: compiledCommands.length,
        totalCommands: eventData.commands.length,
        previewCommands: compiledCommands,
        diff: diffRes.text,
        diffStat,
        message: `校验通过：成功装配 ${compiledCommands.length} 条指令（未落盘，dryRun）`
      }
    }

    try {
      const written = writeAtomic(this.root, relPath, outputJson, { tool: 'append_event_commands' })
      return {
        ok: true,
        dryRun: false,
        path: relPath,
        oldSha256: sha256(originalText),
        newSha256: sha256(outputJson),
        appendedCount: compiledCommands.length,
        totalCommands: eventData.commands.length,
        diff: diffRes.text,
        diffStat,
        ...written,
        message: `成功向 ${relPath} 写入 ${compiledCommands.length} 条指令（总计 ${eventData.commands.length} 步）`
      }
    } catch (e) {
      return { ok: false, error: `写入事件文件失败: ${e.message}` }
    }
  }
}

module.exports = EventBuilder
