'use strict'
/**
 * 价目与用量计费回归测试（零依赖）
 *
 * 价格来源：官方「模型 & 价格」页（核对日期 2026-09-11）。
 * 本测试把官方价格**硬编码成期望值**，一旦有人改动 modules/pricing.js 的价格表就会失败——
 * 避免"悄悄改价"导致估算与官方账单不一致。
 *
 * 用法: node tests/test-pricing.cjs
 */
const path = require('path')
const pricing = require(path.join(__dirname, '..', 'runtime', 'yami-mcp', 'modules', 'pricing.js'))

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.error('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')) }
}

// 官方价目（元 / 百万 tokens）—— 与文档表格逐项对应
const OFFICIAL = {
  'deepseek-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-pro': { hit: [0.15, 0.30], miss: [4.5, 9.0], out: [13.5, 27.0] }
}
// 北京时间：高峰=周一至周五 9:00-12:00 / 14:00-18:00
const PEAK = new Date('2026-09-11T03:00:00Z')     // 周五 11:00
const IDLE = new Date('2026-09-11T14:00:00Z')     // 周五 22:00
const WEEKEND = new Date('2026-09-12T03:00:00Z')  // 周六 11:00
const BOUNDARY_12 = new Date('2026-09-11T04:00:00Z')  // 周五 12:00 → 空闲

console.log('\n########## 1. 时段判定 ##########')
check('工作日 11:00 为高峰', pricing.isPeakTime(PEAK) === true)
check('工作日 22:00 为空闲', pricing.isPeakTime(IDLE) === false)
check('周末同一时刻为空闲', pricing.isPeakTime(WEEKEND) === false)
check('12:00 整点起为空闲（区间左闭右开）', pricing.isPeakTime(BOUNDARY_12) === false)

console.log('\n########## 2. 价目与官方一致 ##########')
for (const [model, expect] of Object.entries(OFFICIAL)) {
  const off = pricing.priceOf(model, IDLE)
  const on = pricing.priceOf(model, PEAK)
  check(model + ' 缓存命中价', off.inputCacheHit === expect.hit[0] && on.inputCacheHit === expect.hit[1], `空闲 ${off.inputCacheHit} / 高峰 ${on.inputCacheHit}`)
  check(model + ' 缓存未命中价', off.inputCacheMiss === expect.miss[0] && on.inputCacheMiss === expect.miss[1], `空闲 ${off.inputCacheMiss} / 高峰 ${on.inputCacheMiss}`)
  check(model + ' 输出价', off.output === expect.out[0] && on.output === expect.out[1], `空闲 ${off.output} / 高峰 ${on.output}`)
}
check('空闲价恰为高峰价的一半', Object.keys(OFFICIAL).every(model => {
  const off = pricing.priceOf(model, IDLE)
  const on = pricing.priceOf(model, PEAK)
  return Math.abs(off.inputCacheMiss * 2 - on.inputCacheMiss) < 1e-9 && Math.abs(off.output * 2 - on.output) < 1e-9
}))
check('未知模型不做估算', pricing.estimateCost({ model: 'gpt-x', promptTokens: 100 }).ok === false)

console.log('\n########## 3. 费用计算 ##########')
// 空闲 flash：10 万输入（全未命中）+ 2 万输出 = 0.1×1 + 0.02×4 = 0.18 元
const basic = pricing.estimateCost({ model: 'deepseek-flash', promptTokens: 100000, completionTokens: 20000, at: IDLE })
check('空闲时段费用计算正确', Math.abs(basic.cost - 0.18) < 1e-9, basic.cost + ' 元')
// 高峰 pro：5 万输入（4 万命中 + 1 万未命中）+ 1 万输出 = 0.04×0.3 + 0.01×9 + 0.01×27 = 0.372
const mixed = pricing.estimateCost({ model: 'deepseek-v4-pro', promptTokens: 50000, completionTokens: 10000, cachedTokens: 40000, at: PEAK })
check('高峰 pro 含缓存命中计算正确', Math.abs(mixed.cost - 0.372) < 1e-9, mixed.cost + ' 元')
check('缓存命中不会超过输入总量', pricing.estimateCost({ model: 'deepseek-flash', promptTokens: 100, cachedTokens: 999, at: IDLE }).breakdown.cachedTokens === 100)

console.log('\n########## 4. 累计与话术 ##########')
const one = pricing.addUsage(null, { model: 'deepseek-flash', promptTokens: 1000, completionTokens: 500, at: IDLE })
const two = pricing.addUsage(one, { model: 'deepseek-flash', promptTokens: 2000, completionTokens: 700, at: IDLE })
check('累计 token 与调用次数', two.promptTokens === 3000 && two.completionTokens === 1200 && two.calls === 2, JSON.stringify({ p: two.promptTokens, c: two.completionTokens, calls: two.calls }))
check('累计费用递增且>0', two.cost > one.cost && one.cost > 0, one.cost + ' → ' + two.cost)
check('话术含 tokens 与估算金额', /4200 tokens/.test(pricing.describeUsage(two)) && /估算花费/.test(pricing.describeUsage(two)), pricing.describeUsage(two))
check('无用量时不输出话术', pricing.describeUsage(null) === '')

console.log(`\n########## 价目与计费测试: ${passed} PASS / ${failed} FAIL ##########`)
process.exit(failed > 0 ? 1 : 0)
