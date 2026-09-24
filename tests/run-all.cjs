#!/usr/bin/env node
/**
 * DanJuan妙妙插件 回归测试总入口 (零依赖, 纯 Node.js)
 * 用法: node tests/run-all.cjs
 * 发布前必跑: node build.cjs && node tests/run-all.cjs
 */
const { spawnSync } = require('child_process');
const path = require('path');

const SUITE = [
  ['verify-perf-probe.mjs', '探针原型挂起语义 + 接线契约'],
  ['test-errflow.mjs',      '错误黑匣子指纹聚合与广播节流'],
  ['test-scene-lab.mjs',    '场景实体快照与渲染集成'],
  ['test-cheats-reset.mjs', '作弊台全部还原与状态复原'],
  ['test-fix-regressions.mjs', '缺陷修复回归 (引擎假设/数据语义/文案映射)'],
  ['test-project-audit.mjs', '工程体检(断链+死事件)与报错事件级定位'],
  ['test-event-blackbox.mjs', '事件黑匣子(指令级时间线+幽灵事件侦探)'],
  ['test-diagnosis-gaps.mjs', '诊断断点(变量告警定位+缓存与内存清理安全)'],
  ['test-ai-agent.cjs',       'AI Agent(鉴权+密钥+MCP工具+写入审批)'],
  ['test-ai-session.cjs',     'AI 会话与上下文(流式+持久化+压缩+打转保护)'],
  ['test-mcp-ai-tools.cjs',   'MCP 特色工具(内容检索+精确改脚本+运行时诊断)'],
  ['test-ai-repair.cjs',      '编译失败自动修复(报错回喂+最小改动+如实失败)'],
  ['test-mcp-approval-diff.cjs', '审批差异预览与删除二次确认'],
  ['test-playtest-smoke.cjs',  '试玩冒烟(动作脚本+诊断对比+端到端)'],
  ['test-changelog.cjs',       '变更小结(基线+真实变更+来源与编译标注)'],
  ['test-todos.cjs',           '待办清单(规整+进度不可倒退+与小节联动)'],
  ['test-pricing.cjs',         '价目与计费(对官方价目+时段判定)'],
  ['test-thinking-mode.cjs',   '思考模式(开关+强度+reasoning回传+用量)'],
  ['test-static-health.cjs',   '静态健康(隐式全局+CSS结构, 秒级无进程)'],
  ['test-render-perf.cjs',     '流式渲染性能(帧合并+增量缓冲+历史窗口)'],
  ['test-tool-schema.cjs',     'MCP工具提示一致性(提示点名的参数必须在schema里)'],
  ['test-interrupt.cjs',      '打断输出(真停模型请求+工具不再执行+会话落盘)'],
  ['test-message-pairs.cjs',  '消息序列自愈(悬挂调用补应答+坏会话自动治好)'],
  ['test-context-meter.cjs',  '上下文计量与自动压缩(1M窗口+80%阈值+检查点结构)'],
  ['test-compiler-lookup.cjs','编译器查找与降级语义(跨平台tsc+没得校验不回滚)'],
  ['test-parallel-tools.cjs', '只读工具并发执行(按注册表声明+写盘独占)'],
  ['test-acceptance.cjs',     '整体验收(工作流串联+真实工程只读体检)'],
  ['test-ui-operation.cjs',   '界面操作(收束边框+步骤执行+急停)'],
  ['test-subviews-floating.cjs', '子视图全屏与自由悬浮窗(高亮+排他+拖拽+尺寸)'],
  ['test-ai-selection-grant.cjs', '选中文件默认放行(打开着的直接改+打开之外要先确认)'],
  ['test-mcp-meta-rules.cjs',   'MCP 元数据对齐引擎(CRLF解析+类型守卫+默认值校验+生成器自检)'],
  ['test-mcp-command-name.cjs', '指令中文名解析(按编辑器显示名→GUID+未知名字如实拒绝)'],
  ['test-mcp-data-rules.cjs', 'MCP 数据规则(RLE真编解码+属性查询+插件lint+变量体检)'],
  ['test-update-recovery.cjs',  '更新失败自愈(bootstrap 把写坏的插件回退到旧版本)'],
  ['test-ai-host-port.cjs',   'AI Host 端口自适应(5968 被占自动换端口)'],
  ['test-autoupdate.mjs',   '热更新端到端 (需联网)'],
];

/* 起跑前先扫一遍上一次留下的临时夹具。
   这些套件都往 %TEMP% 里拷工程副本，一旦被 Ctrl+C / 崩溃打断就会留下几十上百 MB 的垃圾 ——
   2026-09-15 用户报"C 盘拉屎"时本机攒了 49 个 yami-selection-*（21GB）。
   只删 2 小时前的（正在跑的这套不动），删掉多少如实打出来。 */
const fs = require('fs')
const os = require('os')
const TEMP_PREFIXES = ['yami-', 'danjuan-']
const SWEEP_MIN_AGE_MS = 2 * 60 * 60 * 1000
function sizeOf(target) {
  let total = 0
  const stack = [target]
  while (stack.length) {
    const cur = stack.pop()
    let st
    try { st = fs.lstatSync(cur) } catch { continue }
    if (st.isDirectory()) {
      let kids = []
      try { kids = fs.readdirSync(cur) } catch { /* 读不到就跳过 */ }
      for (const kid of kids) stack.push(path.join(cur, kid))
    } else {
      total += st.size
    }
  }
  return total
}
function sweepTemp() {
  let freed = 0
  let count = 0
  let entries = []
  try { entries = fs.readdirSync(os.tmpdir()) } catch { return }
  const now = Date.now()
  for (const name of entries) {
    if (!TEMP_PREFIXES.some(prefix => name.startsWith(prefix))) continue
    const full = path.join(os.tmpdir(), name)
    try {
      if (now - fs.statSync(full).mtimeMs < SWEEP_MIN_AGE_MS) continue
      freed += sizeOf(full)
      fs.rmSync(full, { recursive: true, force: true })
      count++
    } catch { /* 删不掉就留着，不阻断测试 */ }
  }
  if (count) console.log("[清理] 删掉 " + count + " 个上次遗留的临时夹具，回收 " + (freed / 1048576).toFixed(1) + " MB")
}

sweepTemp()

/* 失败时留现场。套件里有几个是负载/时序敏感的（2026-09-15 起记在 HANDOFF 3.3：
   全量跑 6 次有 1 次退出码非 0，单跑就绿，一直没抓到是哪条断言）——
   原因是 stdio: 'inherit' 把子进程输出直接送终端、一个字节都不留，事后无从可查。
   失败就当场重跑一次并留全文（重跑常常就过了，那不代表"修好了"，只代表这次没抓到；
   但两次输出摆在一起，才看得出是不是时序）。 */
const LOG_PATH = path.join(__dirname, '..', '_last-run.txt');
const LOG_TAIL_CHARS = 20000;
function rerunAndLog(file, label, firstStatus) {
  const again = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  const body = [
    `===== ${new Date().toISOString()} · ${file} — ${label} =====`,
    `首跑退出码 ${firstStatus}；以下是失败后立刻重跑的完整输出（重跑退出码 ${again.status}）`,
    '',
    (again.stdout || '').slice(-LOG_TAIL_CHARS),
    (again.stderr || '').slice(-LOG_TAIL_CHARS),
    '',
  ].join('\n');
  try {
    fs.appendFileSync(LOG_PATH, body);
    return LOG_PATH;
  } catch {
    return null; // 留档失败不阻断测试本身
  }
}

let failed = 0;
for (const [file, label] of SUITE) {
  console.log(`\n########## ${file} — ${label} ##########`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${file} 未通过 (退出码 ${r.status})`);
    const logged = rerunAndLog(file, label, r.status);
    if (logged) console.error(`  失败现场已留档（含重跑输出）: ${logged}`);
  }
}

console.log(`\n########## 汇总: ${SUITE.length - failed}/${SUITE.length} 套通过 ##########`);
process.exit(failed > 0 ? 1 : 0);
