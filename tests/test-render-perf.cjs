/**
 * 流式渲染性能回归（零依赖，纯逻辑，不起进程）
 *
 * 背景：AI 助手的正文与思考是逐 token 推送的。旧实现每来一个片段就
 *   ① 把「全文」重新赋给 textContent（O(n) 拷贝 × n 个片段 = O(n²)）
 *   ② 同步把滚动条拉到底（强制重排）
 * 结果就是用户反馈的"上下文一长，界面卡死不动"。
 * 这里把修复后的核心逻辑（帧合并调度 / 增量缓冲 / 单行预览 / 历史窗口）逐条钉住。
 */
const assert = require('assert')
const path = require('path')

const core = require(path.resolve(__dirname, '..', 'ai-render-core.js'))

let passed = 0
let failed = 0
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')) }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')) }
}

// 可手动驱动的"帧"，用来观察合并效果
function fakeFrames() {
  const queue = []
  return {
    raf: fn => { queue.push(fn); return queue.length },
    flush() { const n = queue.length; while (queue.length) queue.shift()(); return n },
    pending: () => queue.length
  }
}

console.log('\n########## 1. 帧合并：片段再多，一帧只写一次 DOM ##########')
{
  const frames = fakeFrames()
  const scheduler = core.createScheduler(frames.raf)
  let writes = 0
  for (let i = 0; i < 5000; i++) scheduler.schedule(() => { writes++ })
  check('5000 次调度只排了一帧', frames.pending() === 1, '待执行帧=' + frames.pending())
  frames.flush()
  check('一帧只触发一次渲染', writes === 1, '渲染次数=' + writes)
  check('渲染计数可读（便于诊断）', scheduler.runs() === 1, 'runs=' + scheduler.runs())

  scheduler.schedule(() => { writes++ })
  check('下一帧可以继续排', frames.pending() === 1)
  frames.flush()
  check('第二帧正常执行', writes === 2, '渲染次数=' + writes)
}

console.log('\n########## 2. 增量缓冲：只拼接新片段，不复制全文 ##########')
{
  const buf = core.createTextBuffer()
  const pieces = ['你好', '，这是', '一段', '流式', '输出。']
  let copied = 0
  for (const piece of pieces) { buf.append(piece); copied += piece.length }
  check('拼接结果正确', buf.toString() === '你好，这是一段流式输出。', buf.toString())
  check('长度即为已写入字符数（线性增长）', buf.length() === copied, `${buf.length()} / ${copied}`)

  // 与旧写法对比：旧写法每个片段都重设全文，累计拷贝量是平方级
  const n = 2000
  let oldCost = 0
  let text = ''
  for (let i = 0; i < n; i++) { text += 'x'; oldCost += text.length }
  const fresh = core.createTextBuffer()
  let newCost = 0
  for (let i = 0; i < n; i++) { fresh.append('x'); newCost += 1 }
  check('同样 2000 个片段，新写法拷贝量是线性的', newCost === n && oldCost === n * (n + 1) / 2, `旧=${oldCost} 新=${newCost}`)
  check('内容仍然一致', fresh.toString().length === n)
}

console.log('\n########## 2.4 缓冲的"最后一行"（思考实时预览靠它，不许每帧 split 全文）##########')
{
  const buf = core.createTextBuffer()
  buf.append('第一行')
  check('没有换行时最后一行就是全部', buf.lastLine() === '第一行', buf.lastLine())
  buf.append('\n第二行')
  check('换行后取到新的一行', buf.lastLine() === '第二行', buf.lastLine())
  buf.append('\n\n')
  check('空行不算最后一行', buf.lastLine() === '第二行', JSON.stringify(buf.lastLine()))
  buf.append('x'.repeat(400))
  check('超长只保留末尾（预览靠右侧看最新）', buf.lastLine(50).length === 50 && buf.lastLine(50) === 'x'.repeat(50))
  const fresh = core.createTextBuffer()
  check('空缓冲不炸', fresh.lastLine() === '')
  fresh.append('a\nb\nc')
  check('反复读结果稳定（增量维护不漂移）', fresh.lastLine() === 'c' && fresh.lastLine() === 'c')
}

console.log('\n########## 2.5 思考分段：一个回合里的多轮推理各成一段 ##########')
{
  const seg = core.createThinkingSegments()
  check('回合开始时第一条思考增量开第 1 段', seg.accept() === 1 && seg.round() === 1)
  check('同一轮内的连续增量仍归第 1 段（不换块）', seg.accept() === 0 && seg.accept() === 0 && seg.round() === 1)
  check('工具调用把这一段封上', seg.seal() === true && seg.sealed() === true)
  check('工具跑完后的思考增量开第 2 段', seg.accept() === 2 && seg.round() === 2)
  check('重复封段不重复计数（工具 start/done 都会调）', seg.seal() === true && seg.seal() === false && seg.round() === 2)
  check('已在封口状态再封一次是空操作（封段幂等）', seg.seal() === false && seg.sealed() === true)
  check('正文开始封段后，下一轮思考另起第 3 段', seg.accept() === 3 && seg.round() === 3 && seg.sealed() === false)
  seg.reset()
  check('新回合归零', seg.round() === 0 && seg.sealed() === true && seg.accept() === 1)
}

console.log('\n########## 2.6 轮次过程收起与每轮用量（参考 DSH 的紧凑模式语义）##########')
{
  const title = core.processFoldTitle
  check('标题按「思考秒数 · 段数 · 步数」拼', title({ seconds: 12, rounds: 3, steps: 5 }) === '思考 12 秒 · 3 段 · 5 步', title({ seconds: 12, rounds: 3, steps: 5 }))
  check('单段任务不报段数（单段没有编号噪音）', title({ seconds: 4, rounds: 1, steps: 0 }) === '思考 4 秒', title({ seconds: 4, rounds: 1, steps: 0 }))
  check('零活动给「已思考」而不是空标题', title({ seconds: 0, rounds: 0, steps: 0 }) === '已思考')
  check('调用方可以关掉兜底文案', title({ seconds: 0, rounds: 0, steps: 0, empty: '' }) === '')

  const fold = core.turnProcessFold
  check('紧凑模式 + 有最终正文 → 收起', fold({ mode: 'compact', hasAnswer: true, rounds: 2, steps: 3, seconds: 9 }).fold === true)
  check('收起后标题就是汇总', fold({ mode: 'compact', hasAnswer: true, rounds: 2, steps: 3, seconds: 9 }).title === '思考 9 秒 · 2 段 · 3 步')
  check('标准模式永不自动收起', fold({ mode: 'standard', hasAnswer: true, rounds: 2, steps: 3 }).fold === false)
  check('没有最终正文时不收起（保留全部过程证据）', fold({ mode: 'compact', hasAnswer: false, rounds: 2, steps: 3 }).fold === false)
  check('焦点还在过程里时不收起', fold({ mode: 'compact', hasAnswer: true, rounds: 1, steps: 1, focusInside: true }).fold === false)
  check('整轮什么都没发生时不收起（没什么可收的）', fold({ mode: 'compact', hasAnswer: true, rounds: 0, steps: 0 }).fold === false)
  check('模式缺省按紧凑（默认就是紧凑）', fold({ hasAnswer: true, rounds: 1, steps: 1 }).fold === true)

  const usage = core.formatTurnUsage
  check('记账完整才出行', usage({ complete: true, calls: 2, promptTokens: 11000, completionTokens: 2500, cost: 0.0042 }).show === true)
  check('行内用 k 缩写', usage({ complete: true, calls: 2, promptTokens: 11000, completionTokens: 2500, cost: 0.0042 }).text === '本轮 2 次调用 · 13.5k tokens · 约 0.0042 元', usage({ complete: true, calls: 2, promptTokens: 11000, completionTokens: 2500, cost: 0.0042 }).text)
  check('详情给原始 token 与缓存命中', /输入 11000 tokens（缓存命中 \d+）/.test(usage({ complete: true, calls: 1, promptTokens: 11000, completionTokens: 2500 }).detail))
  check('记账不全 → 整行不显示（不拿部分总量冒充完整）', usage({ complete: false, calls: 2, promptTokens: 11000, completionTokens: 2500 }).show === false)
  check('零调用不显示', usage({ complete: true, calls: 0, promptTokens: 0, completionTokens: 0 }).show === false)
  check('拿不到 tokens 不显示', usage({ complete: true, calls: 1 }).show === false)
  check('没价目表时不编花费', usage({ complete: true, calls: 1, promptTokens: 500, completionTokens: 100 }).text === '本轮 1 次调用 · 600 tokens', usage({ complete: true, calls: 1, promptTokens: 500, completionTokens: 100 }).text)
}

console.log('\n########## 3. 单行预览：用最后一行，不每次 split 全文 ##########')
{
  const buf = core.createTextBuffer()
  buf.append('第一步：读工程结构')
  check('没有换行时最后一行就是全部内容', buf.lastLine() === '第一步：读工程结构', buf.lastLine())
  buf.append('\n第二步：定位报错脚本')
  check('出现换行后取到新的一行', buf.lastLine() === '第二步：定位报错脚本', buf.lastLine())
  buf.append('\n\n')
  check('空行不算最后一行', buf.lastLine() === '第二步：定位报错脚本', buf.lastLine())
  const long = core.createTextBuffer()
  long.append('x'.repeat(400))
  check('超长单行会截断到 160 字以内', long.lastLine(160).length === 160, String(long.lastLine(160).length))
  long.reset()
  check('reset 后清空', long.length() === 0 && long.lastLine() === '')
}

console.log('\n########## 4. 滚动跟随：用户往上翻时不许把他拽回去 ##########')
{
  const bottom = { scrollHeight: 1000, scrollTop: 400, clientHeight: 600 }
  const scrolledUp = { scrollHeight: 1000, scrollTop: 100, clientHeight: 600 }
  const nearBottom = { scrollHeight: 1000, scrollTop: 380, clientHeight: 600 }
  check('停在底部 → 跟随', core.shouldStickToBottom(bottom) === true)
  check('往上翻看历史 → 不跟随', core.shouldStickToBottom(scrolledUp) === false)
  check('离底部很近仍算跟随（阈值内）', core.shouldStickToBottom(nearBottom) === true)
  // 前端实际用的是收紧后的 24px：80px 的旧阈值会让"刚往上滚一点"的用户仍被算作在底部，
  // 于是每来一段新内容就被拽回去一次，历史根本看不成
  check('阈值收紧后，离底 30px 不再跟随', core.shouldStickToBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 70 }, 24) === false)
  check('阈值收紧后，贴底仍然跟随', core.shouldStickToBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 95 }, 24) === true)
}

console.log('\n########## 4b. 滚动跟随状态机：判据来自用户意图，不看事后距离 ##########')
{
  const follow = core.createFollowState(24)
  const atBottom = { scrollHeight: 1000, scrollTop: 900, clientHeight: 100 }
  const scrolledUp = { scrollHeight: 1000, scrollTop: 300, clientHeight: 100 }
  check('默认跟随最新内容', follow.onAppend() === 'scroll' && follow.follow === true)
  follow.onUserScrollUp()
  check('滚轮一上滚就停止跟随', follow.follow === false)
  check('暂停后追加内容不动视口', follow.onAppend() === 'hold' && follow.pending === true, 'pending=' + follow.pending)
  check('暂停期间再次追加仍是 hold（提示"有新内容"）', follow.onAppend() === 'hold' && follow.pending === true)
  follow.onScroll(atBottom)
  check('滚回底部自动恢复跟随并清掉提示', follow.follow === true && follow.pending === false)
  check('恢复后追加内容继续跟随', follow.onAppend() === 'scroll')
  follow.onScroll(scrolledUp)
  check('拖动滚动条上翻同样停止跟随', follow.follow === false)
  check('force 强制回到最新（发消息/切会话用）', follow.force() === 'scroll' && follow.follow === true && follow.pending === false)
  // 关键回归：内容追加会让 scrollHeight 变大，若"追加后再算距离"就会把一直待在底部的用户
  // 误判成在看历史——判据必须来自滚动事件，而不是事后距离
  const f2 = core.createFollowState(24)
  f2.onScroll(atBottom)
  const grew = { scrollHeight: 4000, scrollTop: 900, clientHeight: 100 }   // 追加后：内容变长、scrollTop 未变
  check('内容变长不会被误判成"在看历史"', f2.follow === true && f2.onAppend() === 'scroll', 'distance=' + (grew.scrollHeight - grew.scrollTop - grew.clientHeight))
}

console.log('\n########## 4c. 思考单行预览：显示最后一行（此刻在想什么） ##########')
{
  check('取最后一行而不是开头', core.previewLine('先看工程结构\n再看脚本目录\n最后决定读取主菜单的界面资源文件') === '最后决定读取主菜单的界面资源文件')
  check('跳过空行', core.previewLine('甲\n\n\n乙'.repeat(1)) === '甲 乙' || core.previewLine('甲\n\n\n乙') === '乙', JSON.stringify(core.previewLine('甲\n\n\n乙')))
  check('末行太短时往前并一行', core.previewLine('这是一句比较长的思考内容\n工具名').includes('这是一句比较长的思考内容'))
  check('过长时保留末尾最新那段', core.previewLine('开头'.repeat(200)).charAt(0) === '…')
  check('空文本返回空串', core.previewLine('') === '' && core.previewLine(null) === '')
}

console.log('\n########## 5. 历史窗口：长会话只渲染最近若干条 ##########')
{
  const many = Array.from({ length: 500 }, (_, i) => ({ role: 'user', content: 'm' + i }))
  const win = core.historyWindow(many, 60)
  check('只渲染最近 60 条', win.shown.length === 60, 'shown=' + win.shown.length)
  check('被折叠的数量如实给出', win.hiddenCount === 440, 'hidden=' + win.hiddenCount)
  check('保留的是最后一条', win.shown[win.shown.length - 1].content === 'm499')
  const few = core.historyWindow(many.slice(0, 10), 60)
  check('短会话原样渲染', few.shown.length === 10 && few.hiddenCount === 0)
  check('空输入不炸', core.historyWindow(null, 60).shown.length === 0)
}

console.log('\n########## 6. 加载形态：Electron 里 module 与 window 同时存在 ##########')
{
  // 实测事故：UMD 写成"二选一"（有 module 就只走 CommonJS），
  // 而 Electron 渲染进程两者都有 → window.YamiAiRenderCore 永远 undefined →
  // 依赖它的前端渲染不出一个字。这里用 vm 还原那个环境。
  const vm = require('vm')
  const fs = require('fs')
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'ai-render-core.js'), 'utf8')
  const sandbox = { module: { exports: {} }, setTimeout, console }
  sandbox.self = sandbox            // 模拟 window/self
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  check('Electron 环境（module 与 self 并存）必须挂上全局', !!sandbox.YamiAiRenderCore, typeof sandbox.YamiAiRenderCore)
  check('同时仍可被 Node require（单测要用）', !!(sandbox.module.exports && sandbox.module.exports.createScheduler))
  check('两个入口拿到的是同一份 API', sandbox.YamiAiRenderCore === sandbox.module.exports)

  // 渲染降级：缺渲染核心时正文必须还能显示（静态确认前端留了兜底分支）
  const agent = fs.readFileSync(path.resolve(__dirname, '..', 'ai-agent.js'), 'utf8')
  check('前端在缺少渲染核心时有直写兜底', /if \(!contentBuffer\) \{ bubble\.textContent = text\$; return; \}/.test(agent))
  check('缺渲染核心时会明确告警', /渲染核心 ai-render-core\.js 未加载/.test(agent))
}

console.log(`\n########## 渲染性能测试: ${passed} PASS / ${failed} FAIL ##########`)
process.exit(failed > 0 ? 1 : 0)
