'use strict'

/**
 * 待办清单（todo list）
 *
 * 目的：多步开发任务里给用户一个"进度骨架"，同时约束模型别做一半跑偏——
 * 它必须先列出要做什么，每完成一步就把状态推进一步。
 *
 * 与通用编码助手不同的一点：这里的步骤文案要面向"不懂代码的策划"，
 * 所以 UI 只显示白话描述，内部 id 仅用于更新状态。
 */

const MAX_ITEMS = 20
const VALID_STATUS = new Set(['pending', 'in_progress', 'done'])
const STATUS_LABEL = { pending: '待做', in_progress: '进行中', done: '已完成' }

/**
 * 规整模型提交的清单。
 * 接受两种写法：['第一步', '第二步'] 或 [{ id, text, status }]
 * @returns {{items:Array<{id:string,text:string,status:string}>, rejected:string[]}}
 */
function normalizeTodos(input) {
  const rejected = []
  if (!Array.isArray(input)) {
    if (input === undefined || input === null) return { items: [], rejected }
    return { items: [], rejected: ['todos 必须是数组'] }
  }
  const items = []
  for (let index = 0; index < input.length && items.length < MAX_ITEMS; index++) {
    const raw = input[index]
    let text = ''
    let status = 'pending'
    let id = ''
    if (typeof raw === 'string') {
      text = raw
    } else if (raw && typeof raw === 'object') {
      text = String(raw.text || raw.title || raw.content || '')
      status = VALID_STATUS.has(raw.status) ? raw.status : 'pending'
      id = String(raw.id || '')
    } else {
      rejected.push(`第 ${index + 1} 项不是字符串或对象`)
      continue
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) { rejected.push(`第 ${index + 1} 项缺少描述`); continue }
    items.push({ id: id || `step-${items.length + 1}`, text: text.slice(0, 120), status })
  }
  if (input.length > MAX_ITEMS) rejected.push(`步骤过多，只保留前 ${MAX_ITEMS} 项`)
  if (!items.length && !rejected.length) rejected.push('清单为空')
  return { items, rejected }
}

/** 统计与一句话进度（给过程提示与收尾小结用） */
function summarizeTodos(items) {
  const list = Array.isArray(items) ? items : []
  const total = list.length
  const done = list.filter(item => item.status === 'done').length
  const current = list.find(item => item.status === 'in_progress')
  return {
    total,
    done,
    pending: total - done,
    percent: total ? Math.round((done / total) * 100) : 0,
    currentText: current ? current.text : '',
    headline: total
      ? `进度 ${done}/${total}${current ? '，正在做：' + current.text : ''}`
      : '还没有计划'
  }
}

/** 状态流转是否合法：不允许把已完成的改回待做（防止进度倒退造成的误导） */
function validateTransition(previous, next) {
  const before = Array.isArray(previous) ? previous : []
  const after = Array.isArray(next) ? next : []
  const doneText = new Set(before.filter(item => item.status === 'done').map(item => item.text))
  const regressed = after.filter(item => doneText.has(item.text) && item.status !== 'done')
  return { ok: regressed.length === 0, regressed: regressed.map(item => item.text) }
}

/** 渲染给用户看的清单文本（纯文本版，前端另有卡片） */
function renderTodos(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    const mark = item.status === 'done' ? '[完成]' : item.status === 'in_progress' ? '[进行中]' : '[待做]'
    return `${mark} ${item.text}`
  }).join('\n')
}

module.exports = { normalizeTodos, summarizeTodos, validateTransition, renderTodos, STATUS_LABEL, MAX_ITEMS }
