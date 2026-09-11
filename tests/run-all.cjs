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
  ['test-interrupt.cjs',      '打断输出(真停模型请求+工具不再执行+会话落盘)'],
  ['test-parallel-tools.cjs', '只读工具并发执行(按注册表声明+写盘独占)'],
  ['test-acceptance.cjs',     '整体验收(工作流串联+真实工程只读体检)'],
  ['test-autoupdate.mjs',   '热更新端到端 (需联网)'],
];

let failed = 0;
for (const [file, label] of SUITE) {
  console.log(`\n########## ${file} — ${label} ##########`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${file} 未通过 (退出码 ${r.status})`);
  }
}

console.log(`\n########## 汇总: ${SUITE.length - failed}/${SUITE.length} 套通过 ##########`);
process.exit(failed > 0 ? 1 : 0);
