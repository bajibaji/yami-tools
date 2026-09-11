'use strict'

/**
 * 消息序列自愈：保证 assistant.tool_calls 与 tool 应答严格配对（单一事实源）
 *
 * 为什么必须有这个模块（真实事故）：
 *   Chat Completions 对消息序列有硬约束——一条带 tool_calls 的 assistant 消息，后面必须紧跟
 *   覆盖**每一个** tool_call_id 的 tool 消息。我们的会话是持久化的，只要有任何一条退出路径
 *   漏了回填（空转保护、用户打断、工具批处理中途取消、上下文压缩切点），坏序列就会落盘并
 *   **长期污染整个会话**：此后每一次请求都被上游 400 拒绝（insufficient tool messages），
 *   面板上只显示一句跟设置毫无关系的报错，用户完全无从下手，只能放弃这个会话。
 *
 *   所以"序列合法"不能依赖每条退出路径自觉回填，必须在**发送前**统一体检：
 *   · 缺失的应答补一条"未执行"占位（模型据此知道别再重复这次调用）；
 *   · 越界的工具消息（其 assistant 已被折叠进摘要、或重复回填）直接剔除；
 *   · 空的 tool_calls 数组摘掉（部分上游会因此报错）。
 */

/** 给"没有执行的工具调用"生成的应答内容：既补齐序列，也让模型知道不要再重复这次调用 */
function notExecutedResult(reason) {
  const why = String(reason || '本轮提前结束')
  return JSON.stringify({
    ok: false,
    notExecuted: true,
    reason: why,
    message: '该工具调用没有执行（' + why + '）。不要重复这次调用；需要继续时先说明当前进展，或换一种做法。'
  })
}

/**
 * 把压缩切点对齐到「消息组」边界：切点若压在一条 tool 消息上，说明它的
 * assistant(tool_calls) 会被折进摘要，序列立刻非法——此时向前扩展到该组的开头。
 * （DSH 用 tool-pairing balance 表达同一件事：切点前不能有未应答的工具调用。）
 */
function alignStartIndex(messages, index) {
  const list = Array.isArray(messages) ? messages : []
  let start = Math.max(1, Math.min(Math.floor(Number(index) || 1), list.length))
  while (start > 1 && list[start] && list[start].role === 'tool') start--
  return start
}

/**
 * 计算压缩历史时的尾部起点：切点必须落在"消息组"边界上。
 * 若切点正好压在一条 tool 消息上，说明它的 assistant(tool_calls) 会被折进摘要，
 * 序列立刻非法——此时向前扩展到该组的开头（宁可多留几条，也不能切断配对）。
 */
function alignTailStart(messages, keepRecent) {
  const list = Array.isArray(messages) ? messages : []
  const keep = Math.max(1, Number(keepRecent) || 1)
  return alignStartIndex(list, Math.max(1, list.length - keep))
}

/**
 * 体检并修复消息序列。返回新数组与修复统计，不修改入参。
 * options.reason 用于占位文案（例如"用户打断了这次操作"）。
 */
function repairToolPairs(messages, options) {
  const reason = (options && options.reason) || '本轮提前结束'
  const list = Array.isArray(messages) ? messages : []
  const fixes = { filled: 0, droppedOrphan: 0, droppedDuplicate: 0, droppedEmptyCalls: 0 }
  const out = []

  // 先收集所有被声明过的 tool_call id：用来区分"孤儿工具消息"（assistant 已被折叠）
  // 与"重复回填"（同一 id 应答了两次）。
  const declared = new Set()
  for (const message of list) {
    if (message && message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) if (call && call.id) declared.add(call.id)
    }
  }

  let open = null   // 当前待回填的 assistant(tool_calls)：{ ids, filled }
  const closeOpen = () => {
    if (!open) return
    for (const id of open.ids) {
      if (open.filled.has(id)) continue
      out.push({ role: 'tool', tool_call_id: id, content: notExecutedResult(reason) })
      fixes.filled++
    }
    open = null
  }

  for (const message of list) {
    if (!message || typeof message !== 'object') continue

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      closeOpen()
      const ids = message.tool_calls.map(call => call && call.id).filter(Boolean)
      if (!ids.length) {
        // 空 tool_calls（或全部缺 id）都是非法序列，摘掉字段后当普通助手消息保留
        const rest = Object.assign({}, message)
        delete rest.tool_calls
        out.push(rest)
        fixes.droppedEmptyCalls++
        continue
      }
      out.push(message)
      open = { ids, filled: new Set() }
      continue
    }

    if (message.role === 'tool') {
      const id = message.tool_call_id
      if (!id) { fixes.droppedDuplicate++; continue }
      if (open && open.ids.includes(id) && !open.filled.has(id)) {
        open.filled.add(id)
        out.push(message)
        if (open.filled.size === open.ids.length) open = null
        continue
      }
      if (declared.has(id)) fixes.droppedDuplicate++
      else fixes.droppedOrphan++
      continue
    }

    // 任何其他角色出现前，必须先把未完成的配对补齐——工具应答必须**紧跟**其 assistant
    closeOpen()
    out.push(message)
  }
  closeOpen()

  const changed = fixes.filled + fixes.droppedOrphan + fixes.droppedDuplicate + fixes.droppedEmptyCalls > 0
  return { messages: out, fixes, changed }
}

/** 校验序列是否合法（测试与诊断用）：返回问题描述数组，空数组表示合法 */
function findSequenceProblems(messages) {
  const list = Array.isArray(messages) ? messages : []
  const problems = []
  const declared = new Set()
  for (const message of list) {
    if (message && message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) if (call && call.id) declared.add(call.id)
    }
  }
  let open = null
  const flush = index => {
    if (!open) return
    const missing = open.ids.filter(id => !open.filled.has(id))
    if (missing.length) problems.push(`第 ${open.index} 条 assistant 的 tool_calls 缺少应答：${missing.join('、')}`)
    open = null
  }
  list.forEach((message, index) => {
    if (!message || typeof message !== 'object') return
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      flush(index)
      const ids = message.tool_calls.map(call => call && call.id).filter(Boolean)
      if (!ids.length) problems.push(`第 ${index} 条 assistant 的 tool_calls 为空或缺少 id`)
      else open = { index, ids, filled: new Set() }
      return
    }
    if (message.role === 'tool') {
      const id = message.tool_call_id
      if (open && open.ids.includes(id) && !open.filled.has(id)) {
        open.filled.add(id)
        if (open.filled.size === open.ids.length) open = null
      } else if (!declared.has(id)) {
        problems.push(`第 ${index} 条 tool 消息没有对应的 assistant 调用：${id || '（缺少 tool_call_id）'}`)
      } else {
        problems.push(`第 ${index} 条 tool 消息重复应答或位置越界：${id}`)
      }
      return
    }
    flush(index)
  })
  flush(list.length)
  return problems
}

module.exports = { repairToolPairs, findSequenceProblems, alignTailStart, alignStartIndex, notExecutedResult }
