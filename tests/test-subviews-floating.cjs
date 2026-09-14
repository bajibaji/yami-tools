'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'src', 'style.css');
const HUD_PATH = path.join(ROOT, 'hud-overlay.js');
const AGENT_PATH = path.join(ROOT, 'ai-agent.js');

console.log('🧪 开始执行子视图全屏与自由悬浮窗专项测试...');

const cssContent = fs.readFileSync(CSS_PATH, 'utf8');
const hudContent = fs.readFileSync(HUD_PATH, 'utf8');
const agentContent = fs.readFileSync(AGENT_PATH, 'utf8');

// 1. 悬浮窗核心样式断言
assert.ok(cssContent.includes('.yami-dock-float-btn'), 'src/style.css 必须包含 .yami-dock-float-btn 样式');
assert.ok(cssContent.includes('.yami-perf-dock.floating'), 'src/style.css 必须包含 .yami-perf-dock.floating 悬浮窗样式');
assert.ok(cssContent.includes('.yami-perf-dock.switching-mode'), 'src/style.css 必须包含 .switching-mode 模式切换平滑淡出过渡样式');
assert.ok(cssContent.includes('visibility: hidden') && cssContent.includes('visibility: visible'), '悬浮窗必须使用 visibility+opacity 组合实现丝滑淡入淡出');
assert.ok(cssContent.includes('.yami-dock-resizer'), 'src/style.css 必须包含 .yami-dock-resizer 缩放手柄样式');
assert.ok(cssContent.includes('cursor: se-resize'), '缩放手柄必须具有右下缩放手势 cursor: se-resize');

// 2. 悬浮窗 HUD 结构与逻辑断言
assert.ok(hudContent.includes('id="btn-dock-float"'), 'hud-overlay.js 必须包含 #btn-dock-float 悬浮窗切换按钮');
assert.ok(hudContent.includes('id="yami-dock-resizer"'), 'hud-overlay.js 必须包含 #yami-dock-resizer 拖拽手柄节点');
assert.ok(hudContent.includes('applyFloatingState'), 'hud-overlay.js 必须实现 applyFloatingState 函数');
assert.ok(hudContent.includes('switching-mode'), 'hud-overlay.js 必须在模式切换时调度 switching-mode 平滑动画');
assert.ok(hudContent.includes('isSwitchingMode'), 'hud-overlay.js 必须包含 isSwitchingMode 动画互斥锁防抖');
assert.ok(hudContent.includes('yami-perf-dock-floating'), '悬浮窗状态必须持久化到 localStorage: yami-perf-dock-floating');
assert.ok(hudContent.includes('yami-perf-dock-pos'), '悬浮窗位置必须持久化到 localStorage: yami-perf-dock-pos');
assert.ok(hudContent.includes('yami-perf-dock-size'), '悬浮窗尺寸必须持久化到 localStorage: yami-perf-dock-size');

// 3. 历史与撤销按钮高亮样式与交互断言
assert.ok(cssContent.includes('.yami-ai-tool-btn.active'), 'src/style.css 必须包含 .yami-ai-tool-btn.active 高亮样式');
assert.ok(agentContent.includes('function setSubView('), 'ai-agent.js 必须包含 setSubView 视图调度函数');
assert.ok(agentContent.includes("view === 'undo'"), 'setSubView 必须支持 undo 视图');
assert.ok(agentContent.includes("view === 'history'"), 'setSubView 必须支持 history 视图');
assert.ok(agentContent.includes("view === 'settings'"), 'setSubView 必须支持 settings 视图');
assert.ok(agentContent.includes("undoToggle.classList.add('active')"), '激活 undo 视图时撤销按钮必须加 active 类');
assert.ok(agentContent.includes("historyToggle.classList.add('active')"), '激活 history 视图时历史按钮必须加 active 类');

// 4. 全屏子视图遮罩与排他展示断言 (不留其他内容)
assert.ok(cssContent.includes('.yami-ai-page.view-undo #yami-ai-messages'), 'src/style.css 在 view-undo 下必须隐藏消息流');
assert.ok(cssContent.includes('.yami-ai-page.view-history #yami-ai-messages'), 'src/style.css 在 view-history 下必须隐藏消息流');
// 关键：选择器**指到的元素必须真的存在**。
// 以前这里只断言"CSS 文本里含这串选择器"，于是 v1.7.0 写的 #yami-ai-quick-bar / #yami-ai-composer
// （两个 id 在插件里根本不存在）照样全绿——"进子视图隐藏输入区"从发布起就没生效过（审计 G-10(d)）。
const subviewRule = (cssContent.match(/\/\* 全界面子视图排版[\s\S]*?\}/) || [''])[0];
assert.ok(subviewRule.length > 0, 'src/style.css 必须包含「全界面子视图排版」隐藏规则');
const subviewTokens = Array.from(new Set(subviewRule.match(/[#.]yami-ai-[a-z-]+/g) || []));
const required = ['yami-ai-messages', 'yami-ai-compose', 'yami-ai-devbar', 'yami-ai-scope'];
const missingRequired = required.filter(name => !subviewTokens.some(token => token.slice(1) === name));
assert.strictEqual(missingRequired.length, 0, '子视图隐藏规则必须覆盖消息流 / 输入区(compose+devbar) / 环境行，缺少: ' + missingRequired.join(', '));
const dangling = subviewTokens.filter(token => {
  const name = token.slice(1);
  if (token[0] === '#') return !agentContent.includes('id="' + name + '"');
  // 类名可能写在 className 赋值里（如 page.className = '… yami-ai-page'），
  // 所以只要求这个名字在面板脚本里出现过；id 则必须真的有 id="…" 声明
  return !agentContent.includes(name);
});
assert.strictEqual(dangling.length, 0, '子视图隐藏规则里有指向不存在元素的选择器（写了也不生效）: ' + dangling.join(', '));
assert.ok(cssContent.includes('.yami-ai-subpage-header'), 'src/style.css 必须包含子视图头部说明条 .yami-ai-subpage-header');
assert.ok(agentContent.includes('yami-ai-subpage-back'), 'ai-agent.js 必须在撤销和历史面板提供返回对话入口');
assert.ok(agentContent.includes("setSubView('chat')"), '返回对话必须调用 setSubView 还原主对话');

// 5. Home 快捷键捕获阶段监听与视口防脱逸自愈断言
assert.ok(hudContent.includes("window.addEventListener('keydown', onGlobalKeyDown, true)"), 'Home 键必须使用 capture: true 捕获阶段监听，免疫编辑器内部截断');
assert.ok(hudContent.includes("document.addEventListener('keydown', onGlobalKeyDown, true)"), 'document 必须同步挂载 capture: true 捕获监听');
assert.ok(hudContent.includes("e.code === 'NumpadHome'") && hudContent.includes('keyCode === 36'), 'Home 键判定必须兼容小键盘与各平台 keyCode: 36');
assert.ok(hudContent.includes('isTextInput') && hudContent.includes('active.tagName === \'INPUT\''), 'Home 键必须包含可编辑文本框原生输入保护');
assert.ok(hudContent.includes('window.__YAMI_PERF_TOGGLE_DOCK__ = toggleDock'), 'toggleDock 必须挂载至全局 __YAMI_PERF_TOGGLE_DOCK__');
assert.ok(hudContent.includes('minVisible = 60'), 'toggleDock 必须包含悬浮窗视口安全自愈检查');

// 6. 0 原生 button 与 0 Emoji 断言 (此项为钢铁铁律)
const nativeButtonRegex = /<button\b[^>]*>/i;
assert.ok(!nativeButtonRegex.test(hudContent), 'hud-overlay.js 严禁包含原生 <button> 标签');
assert.ok(!nativeButtonRegex.test(agentContent), 'ai-agent.js 严禁包含原生 <button> 标签');

const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/u;
assert.ok(!emojiRegex.test(hudContent), 'hud-overlay.js 严禁包含 Emoji');
assert.ok(!emojiRegex.test(agentContent), 'ai-agent.js 严禁包含 Emoji');
assert.ok(!emojiRegex.test(cssContent), 'src/style.css 严禁包含 Emoji');

console.log('✅ 子视图全屏与自由悬浮窗专项测试全部通过 (21/21 断言 PASS)！');
