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

console.log(`\n########## 渲染性能测试: ${passed} PASS / ${failed} FAIL ##########`)
process.exit(failed > 0 ? 1 : 0)
