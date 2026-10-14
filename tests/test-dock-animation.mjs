'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const HUD_PATH = path.join(ROOT, 'hud-overlay.js');
const CSS_PATH = path.join(ROOT, 'src', 'style.css');

console.log('🧪 开始执行悬浮窗与主页展开/收起配合动效测试...');

const hudSrc = fs.readFileSync(HUD_PATH, 'utf8');
const cssSrc = fs.readFileSync(CSS_PATH, 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition, extra) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${extra ? '  [' + extra + ']' : ''}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${extra ? '  [' + extra + ']' : ''}`);
  }
}

console.log('\n=== 1. 悬浮窗 (Mini HUD) 配合淡入淡出体系 ===');
check('CSS 包含 #yami-perf-mini-hud 平滑过渡规则', cssSrc.includes('#yami-perf-mini-hud') && cssSrc.includes('transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s'));
check('CSS 包含 #yami-perf-mini-hud.fade-out 淡出样式', cssSrc.includes('#yami-perf-mini-hud.fade-out') && cssSrc.includes('opacity: 0 !important'));
check('淡出态包含 pointer-events: none 防止淡出中误触', cssSrc.includes('#yami-perf-mini-hud.fade-out') && cssSrc.includes('pointer-events: none !important'));

console.log('\n=== 2. 侧栏停靠大盘展开与收起动效 (淡入左滑 / 淡出右滑) ===');
check('停靠大盘默认退场态包含 translateX(100%) 与 opacity: 0', cssSrc.includes('transform: translateX(100%) !important') && cssSrc.includes('opacity: 0 !important'));
check('停靠大盘展开 .show 态包含 translateX(0) 与 opacity: 1', cssSrc.includes('transform: translateX(0) !important') && cssSrc.includes('opacity: 1 !important'));
check('停靠大盘具备进场贝塞尔缓动过渡', cssSrc.includes('transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease-out !important'));
check('停靠大盘具备出场反向缓动过渡', cssSrc.includes('transition: transform 0.18s cubic-bezier(0.4, 0, 1, 1), opacity 0.15s ease-in !important'));

console.log('\n=== 3. 自由悬浮模式原地纯淡入淡出 (彻底杜绝任何滑动位移) ===');
check('悬浮模式基础态设置 transform: none (无位移)', cssSrc.includes('.yami-perf-dock.floating') && cssSrc.includes('transform: none !important'));
check('悬浮模式 .show 态设置 transform: none (无位移)', cssSrc.includes('.yami-perf-dock.floating.show') && cssSrc.includes('transform: none !important'));
check('悬浮模式仅保留 opacity 与 visibility 过渡 (原地纯淡入淡出)', cssSrc.includes('transition: opacity 0.14s ease, visibility 0.14s !important') && cssSrc.includes('transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important'));

console.log('\n=== 4. JS toggleDock 展开与收起时序联动 ===');
check('展开时悬浮窗先增加 fade-out 类淡出', hudSrc.includes("hud.classList.add('fade-out')"));
check('展开时定时执行 display: none 确保不穿帮并保卫门禁', /hud.*setProperty\(['"]display['"],\s*['"]none['"]/s.test(hudSrc));
check('收起时移除 display 属性', hudSrc.includes("hud.style.removeProperty('display')"));
check('收起时先保持 fade-out 并在延时后移除实现反向平滑淡入', hudSrc.includes("hudFadeTimer = setTimeout") && hudSrc.includes("hud.classList.remove('fade-out')"));

console.log('\n=== 5. DanJuan DevSuite 视觉规范 ===');
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
check('hud-overlay.js 严格零 Emoji', !emojiRegex.test(hudSrc));
check('src/style.css 严格零 Emoji', !emojiRegex.test(cssSrc));
check('动效逻辑零原生 <button>', !/<button\b[^>]*>/i.test(hudSrc));

console.log(`\n========== 动效打磨测试完成: ${passed} PASS / ${failed} FAIL ==========`);
if (failed > 0) {
  process.exit(1);
}
