'use strict'

/**
 * DeepSeek 价目表与用量计费（单一事实源）
 *
 * 价格来源：官方「模型 & 价格」页 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 核对日期：2026-09-11（官方保留调价权利，变更时只需改这里的表）
 *
 * 计费规则（官方文档）：
 *   · 单价按「百万 tokens」计；
 *   · **空闲时段价格为高峰时段的一半**；
 *   · 高峰时段 = 北京时间（UTC+8）周一至周五 09:00–12:00 与 14:00–18:00，其余为空闲时段；
 *   · 输入区分「缓存命中 / 缓存未命中」，输出单独计价。
 *
 * 注意：这里只做**估算**。真实账单以官方为准（并发、缓存判定、四舍五入都可能造成差异）。
 */

const MILLION = 1_000_000

// 单位：元 / 百万 tokens
const PRICE_TABLE = {
  'deepseek-flash': {
    inputCacheHit: { offPeak: 0.02, peak: 0.04 },
    inputCacheMiss: { offPeak: 1, peak: 2 },
    output: { offPeak: 4, peak: 8 }
  },
  'deepseek-v4-pro': {
    inputCacheHit: { offPeak: 0.15, peak: 0.30 },
    inputCacheMiss: { offPeak: 4.5, peak: 9.0 },
    output: { offPeak: 13.5, peak: 27.0 }
  }
}

const PEAK_WINDOWS = [[9, 12], [14, 18]]   // 北京时间（UTC+8）周一至周五

/** 判定某个时刻是否处于高峰时段 */
function isPeakTime(date = new Date()) {
  const beijing = new Date(date.getTime() + 8 * 3600 * 1000)
  const day = beijing.getUTCDay()               // 0=周日
  if (day === 0 || day === 6) return false
  const hour = beijing.getUTCHours() + beijing.getUTCMinutes() / 60
  return PEAK_WINDOWS.some(([from, to]) => hour >= from && hour < to)
}

/** 取某模型当前时段的单价；未知模型返回 null（不猜价格） */
function priceOf(model, date = new Date()) {
  const entry = PRICE_TABLE[String(model || '').trim()]
  if (!entry) return null
  const band = isPeakTime(date) ? 'peak' : 'offPeak'
  return {
    band,
    inputCacheHit: entry.inputCacheHit[band],
    inputCacheMiss: entry.inputCacheMiss[band],
    output: entry.output[band]
  }
}

/**
 * 估算单次调用的费用。
 * @param {{model:string, promptTokens:number, completionTokens:number, cachedTokens?:number, at?:Date}} usage
 * @returns {{ok:boolean, currency?:string, cost?:number, breakdown?:object, reason?:string}}
 */
function estimateCost(usage = {}) {
  const price = priceOf(usage.model, usage.at || new Date())
  if (!price) return { ok: false, reason: '价目表里没有这个模型，不做估算' }
  const promptTokens = Math.max(0, Number(usage.promptTokens) || 0)
  const completionTokens = Math.max(0, Number(usage.completionTokens) || 0)
  const cachedTokens = Math.min(promptTokens, Math.max(0, Number(usage.cachedTokens) || 0))
  const missTokens = promptTokens - cachedTokens
  const cost = (cachedTokens / MILLION) * price.inputCacheHit
    + (missTokens / MILLION) * price.inputCacheMiss
    + (completionTokens / MILLION) * price.output
  return {
    ok: true,
    currency: 'CNY',
    cost: Number(cost.toFixed(6)),
    band: price.band,
    breakdown: {
      cachedTokens,
      missTokens,
      completionTokens,
      pricePerMillion: price
    }
  }
}

/** 累加用量（一次对话的累计） */
function addUsage(total, usage) {
  const base = total || { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, calls: 0 }
  const cost = estimateCost(usage)
  return {
    promptTokens: base.promptTokens + (Number(usage.promptTokens) || 0),
    completionTokens: base.completionTokens + (Number(usage.completionTokens) || 0),
    cachedTokens: base.cachedTokens + (Number(usage.cachedTokens) || 0),
    cost: Number((base.cost + (cost.ok ? cost.cost : 0)).toFixed(6)),
    calls: base.calls + 1
  }
}

/** 给人看的一句话用量小结 */
function describeUsage(usage) {
  if (!usage || !usage.calls) return ''
  const total = (usage.promptTokens || 0) + (usage.completionTokens || 0)
  const cost = usage.cost > 0 ? `，估算花费约 ${usage.cost.toFixed(4)} 元` : ''
  return `本次调用 ${usage.calls} 次、共 ${total} tokens（输入 ${usage.promptTokens}、输出 ${usage.completionTokens}）${cost}`
}

module.exports = { PRICE_TABLE, isPeakTime, priceOf, estimateCost, addUsage, describeUsage, MILLION }
