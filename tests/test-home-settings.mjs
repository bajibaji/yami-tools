'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const HUD_PATH = path.join(ROOT, 'hud-overlay.js');
const CSS_PATH = path.join(ROOT, 'src', 'style.css');

console.log('🧪 开始执行主页偏好设置与右上角悬浮窗 FPS 精简模式测试...');

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

console.log('\n=== 1. 主页右下角设置按钮与偏好设置弹窗骨架 ===');
check('主页模板包含右下角设置按钮 #btn-home-settings', hudSrc.includes('id="btn-home-settings"'));
check('设置按钮采用 role="button" 杜绝原生 button 污染', !hudSrc.includes('<button id="btn-home-settings"'));
check('主页模板包含偏好设置对话框 #yami-home-settings-dialog', hudSrc.includes('id="yami-home-settings-dialog"'));
check('包含设置弹窗关闭按钮 #btn-close-home-settings', hudSrc.includes('id="btn-close-home-settings"'));
check('包含遮罩层 #yami-settings-modal-backdrop', hudSrc.includes('id="yami-settings-modal-backdrop"'));
check('包含精简模式开关 #chk-capsule-fps-only', hudSrc.includes('id="chk-capsule-fps-only"'));
check('包含报错气泡开关 #chk-error-bubble-alert', hudSrc.includes('id="chk-error-bubble-alert"'));
check('包含掉帧告警开关 #chk-jank-toast-alert', hudSrc.includes('id="chk-jank-toast-alert"'));
check('包含布局复位按钮 #btn-reset-dock-layout', hudSrc.includes('id="btn-reset-dock-layout"'));
check('复位按钮采用非 button 纯 div/role 规范', !hudSrc.includes('<button id="btn-reset-dock-layout"'));
check('设置图标内嵌正统 Remix Icon 官方矢量路径', hudSrc.includes('M12 1L21.5 6.5V17.5L12 23L2.5 17.5V6.5L12 1ZM12 3.311L4.5 7.65311V16.3469L12 20.689L19.5 16.3469V7.65311L12 3.311ZM12 16C9.79086'));

console.log('\n=== 2. 迷你胶囊精简模式 (仅显示 FPS) DOM 结构与样式 ===');
check('胶囊内耗时与 DrawCall 节点带有 yami-capsule-extra 类', hudSrc.includes('class="yami-capsule-extra"'));
check('CSS 包含 .yami-perf-capsule.fps-only 紧凑内边距', cssSrc.includes('.yami-perf-capsule.fps-only'));
check('CSS 包含 .fps-only 下隐藏 extra 元素规则', cssSrc.includes('.yami-perf-capsule.fps-only .yami-capsule-extra') && cssSrc.includes('display: none !important'));
check('底栏 footer 结构包含设置按钮 #btn-home-settings', hudSrc.includes('id="btn-home-settings"') && hudSrc.includes('yami-perf-dock-footer'));
check('switchView 支持底栏设置按钮显隐调度', hudSrc.includes('homeSettingsBtn.style.setProperty'));
check('CSS 包含设置按钮 .yami-home-settings-btn 样式', cssSrc.includes('.yami-home-settings-btn'));
check('CSS 包含偏好设置弹窗 .yami-settings-modal 样式', cssSrc.includes('.yami-settings-modal'));
check('CSS 包含设置列表滚动容器与微滚动条', cssSrc.includes('.yami-settings-modal-body::-webkit-scrollbar'));
check('CSS 包含工业级操作按钮 .yami-settings-action-btn 样式', cssSrc.includes('.yami-settings-action-btn'));

console.log('\n=== 3. 偏好设置持久化与交互逻辑 ===');
check('包含持久化键名 yami-perf-capsule-fps-only', hudSrc.includes('yami-perf-capsule-fps-only'));
check('包含持久化键名 yami-perf-error-bubble-enabled', hudSrc.includes('yami-perf-error-bubble-enabled'));
check('包含持久化键名 yami-perf-jank-toast-enabled', hudSrc.includes('yami-perf-jank-toast-enabled'));
check('报错气泡具备免打扰判断逻辑', hudSrc.includes('isBubbleAlertEnabled'));
check('掉帧告警具备免打扰判断逻辑', hudSrc.includes('isJankAlertEnabled'));
check('包含布局一键复位清除 localStorage 逻辑', hudSrc.includes('localStorage.removeItem(\'yami-perf-capsule-pos\')'));
check('包含 applyCapsuleFpsOnly 状态切换函数', hudSrc.includes('function applyCapsuleFpsOnly('));
check('包含 openHomeSettingsDialog 打开函数', hudSrc.includes('function openHomeSettingsDialog('));
check('包含 closeHomeSettingsDialog 关闭函数', hudSrc.includes('function closeHomeSettingsDialog('));
check('switchView 切页面时自动联动收起设置浮层', hudSrc.includes('closeHomeSettingsDialog()'));
check('ESC 键优先关闭设置浮层', hudSrc.includes('if (typeof closeHomeSettingsDialog === \'function\') closeHomeSettingsDialog();'));

console.log('\n=== 4. DanJuan DevSuite 视觉规范 ===');
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
check('hud-overlay.js 严格零 Emoji', !emojiRegex.test(hudSrc));
check('src/style.css 严格零 Emoji', !emojiRegex.test(cssSrc));
check('偏好设置相关代码零原生 <button>', !/<button[^>]*class="[^"]*yami-home-settings/i.test(hudSrc));

console.log(`\n========== 主页偏好设置测试完成: ${passed} PASS / ${failed} FAIL ==========`);
if (failed > 0) {
  process.exit(1);
}
