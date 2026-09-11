'use strict'

/**
 * 试玩冒烟测试的纯逻辑（与网络/引擎解耦，便于测试）
 *
 * 背景：AI 改完工程后，"真的能玩吗"这件事在 Open Yami 里只能靠人点试玩、动手走两步。
 * 本模块支撑 playtest_smoke：把一串按键/等待脚本化，跑完自动报告
 * 「新出现的报错 / 卡住的事件 / 性能是否恶化」——这是本工程特有的验证闭环。
 */

const KEY_ALIASES = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  ok: 'Enter', confirm: 'Enter', enter: 'Enter',
  cancel: 'Escape', esc: 'Escape', escape: 'Escape',
  space: 'Space', action: 'KeyZ', attack: 'KeyX', menu: 'KeyC', inventory: 'KeyB',
  skill: 'KeyA'
}

const ALLOWED_KEY = /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Escape|Space|Key[A-Z]|Digit[0-9]|F[1-12])$/
const MAX_STEPS = 40
const MAX_STEP_MS = 5000
const DEFAULT_STEP_MS = 400

/**
 * 把用户/AI 给的脚本规整成可执行步骤。
 * 支持两种写法：
 *   1. 字符串简写：'down,down,ok' → 依次按键并等待默认时长
 *   2. 对象数组：`[{ key:'down', action:'press', holdMs:600, waitMs:800 }, { waitMs:1200 }]`
 * @returns {{steps: Array<{kind:'key'|'wait', key?:string, action?:string, holdMs?:number, waitMs:number}>, rejected: Array<{input:any, reason:string}>}}
 */
function normalizeSequence(input) {
  const raw = []
  if (typeof input === 'string') {
    for (const piece of input.split(/[,，>\s]+/)) {
      if (piece) raw.push({ key: piece })
    }
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') raw.push({ key: item })
      else if (item && typeof item === 'object') raw.push(item)
    }
  }

  const steps = []
  const rejected = []
  for (const item of raw.slice(0, MAX_STEPS)) {
    if (item.key !== undefined) {
      const key = resolveKey(item.key)
      if (!key) { rejected.push({ input: item, reason: `不支持的按键: ${item.key}` }); continue }
      const action = ['press', 'down', 'up'].includes(item.action) ? item.action : 'press'
      const step = {
        kind: 'key',
        key,
        action,
        waitMs: clampMs(item.waitMs, 0, MAX_STEP_MS, DEFAULT_STEP_MS)
      }
      // 只有在显式指定按住时长时才下发 holdMs：press 由运行时桥自带默认按压时长，
      // 传 0 会让人误以为"没按住"（语义歧义），因此按需附加。
      if (item.holdMs !== undefined) step.holdMs = clampMs(item.holdMs, 10, MAX_STEP_MS, 60)
      steps.push(step)
      continue
    }
    // 纯等待步骤
    steps.push({ kind: 'wait', waitMs: clampMs(item.waitMs, 0, MAX_STEP_MS, DEFAULT_STEP_MS) })
  }
  if (raw.length > MAX_STEPS) rejected.push({ input: `…共 ${raw.length} 步`, reason: `步骤过多，只执行前 ${MAX_STEPS} 步` })
  return { steps, rejected }
}

function resolveKey(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!text) return ''
  const alias = KEY_ALIASES[text.toLowerCase()]
  if (alias) return alias
  if (ALLOWED_KEY.test(text)) return text
  return ''
}

function clampMs(value, min, max, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.round(number), min), max)
}

/**
 * 对比两次诊断快照，回答"这一趟试玩有没有跑坏"。
 * @param {object} before diagnose_runtime 的 data
 * @param {object} after  同上
 * @returns {{newErrors:Array, worsenedErrors:Array, newStuckEvents:Array, perf:{before:object, after:object, regressed:boolean}, verdict:'ok'|'warn'|'bad', reasons:string[]}}
 */
function diffDiagnosis(before, after) {
  const beforeErrors = indexErrors(before)
  const afterErrors = indexErrors(after)
  const newErrors = []
  const worsenedErrors = []
  for (const [key, item] of afterErrors) {
    const previous = beforeErrors.get(key)
    if (!previous) newErrors.push(item)
    else if ((item.count || 1) > (previous.count || 1)) {
      worsenedErrors.push({ ...item, previousCount: previous.count || 1, addedCount: (item.count || 1) - (previous.count || 1) })
    }
  }

  const beforeStuck = indexStuck(before)
  const newStuckEvents = []
  for (const [key, item] of indexStuck(after)) {
    if (!beforeStuck.has(key)) newStuckEvents.push(item)
  }

  const perfBefore = pickPerf(before)
  const perfAfter = pickPerf(after)
  // 性能回归判定：中位帧耗时上涨超过 50% 且绝对值超过 25ms，或丢帧数翻倍增长
  const frameRegressed = perfAfter.frameP95Ms > perfBefore.frameP95Ms * 1.5 && perfAfter.frameP95Ms > 25
  const overBudgetRegressed = perfAfter.overBudgetFrames > perfBefore.overBudgetFrames * 2 + 2
  const regressed = frameRegressed || overBudgetRegressed

  const reasons = []
  if (newErrors.length) reasons.push(`新出现 ${newErrors.length} 类报错`)
  if (worsenedErrors.length) reasons.push(`${worsenedErrors.length} 类报错变频繁`)
  if (newStuckEvents.length) reasons.push(`${newStuckEvents.length} 个事件卡住`)
  if (regressed) reasons.push('帧耗时明显恶化')

  const verdict = newErrors.length || newStuckEvents.length || regressed ? 'bad'
    : worsenedErrors.length ? 'warn'
      : 'ok'

  return {
    newErrors,
    worsenedErrors,
    newStuckEvents,
    perf: { before: perfBefore, after: perfAfter, regressed },
    verdict,
    reasons
  }
}

function indexErrors(diagnosis) {
  const map = new Map()
  const errors = (diagnosis && diagnosis.errors) || []
  for (const item of errors) {
    const key = [item.category || '', item.message || '', item.file || '', item.lineno || 0].join('|')
    map.set(key, {
      category: item.category || '',
      title: item.title || '',
      message: String(item.message || '').slice(0, 200),
      advice: item.advice || '',
      file: item.file || '',
      lineno: item.lineno || 0,
      count: item.count || 1
    })
  }
  return map
}

function indexStuck(diagnosis) {
  const map = new Map()
  const stuck = (diagnosis && diagnosis.stuckEvents) || []
  for (const item of stuck) {
    const key = [item.event || '', item.host || '', item.step === undefined ? '' : item.step].join('|')
    map.set(key, {
      event: item.event || '',
      host: item.host || '',
      step: item.step,
      suspendMs: item.suspendMs || 0,
      ghost: !!item.ghost,
      hostGone: !!item.hostGone
    })
  }
  return map
}

function pickPerf(diagnosis) {
  const perf = (diagnosis && diagnosis.performance) || {}
  const summary = (diagnosis && diagnosis.summary) || {}
  return {
    fps: perf.fps || 0,
    frameP95Ms: perf.frameP95Ms || 0,
    computeP95Ms: perf.computeP95Ms || 0,
    drawCalls: perf.drawCalls || 0,
    overBudgetFrames: summary.overBudgetFrames || 0,
    errorTotal: summary.errorTotal || 0
  }
}

/** 人类可读的结论（AI 直接引用给用户看） */
function describeVerdict(result, stepCount) {
  const head = `试玩冒烟：执行 ${stepCount} 步`
  if (result.verdict === 'ok') return `${head}，没有新报错、没有事件卡住，性能没有恶化。`
  return `${head}，发现问题：${result.reasons.join('；')}。`
}

module.exports = { normalizeSequence, diffDiagnosis, describeVerdict, resolveKey, MAX_STEPS }
