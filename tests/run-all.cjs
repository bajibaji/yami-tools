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
