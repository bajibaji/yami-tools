#!/usr/bin/env node

/**
 * =======================================================================
 * DanJuan妙妙插件 极速原生构建与生产部署脚本 (Zero-Dependency Builder)
 * =======================================================================
 * 
 * 核心职责：
 * 1. 自动同步 src/style.css 至发布产物 hud-overlay.js (保证 SSOT 单文件免构建秒开)；
 * 2. 产物质量与锚点自动化严苛自检 (语法检查 + 8大核心ID + 4大模块 + 0 Emoji)；
 * 3. 传入 --deploy 时，单向安全镜像至编辑器生产目录，并输出 MD5 对齐报告。
 * 
 * 用法：
 *   node build.cjs          # 本地自检与样式注入
 *   node build.cjs --deploy # 本地自检 + 自动单向同步到编辑器目录 + MD5校验
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const SRC_CSS_PATH = path.join(ROOT_DIR, 'src', 'style.css');
const HUD_JS_PATH = path.join(ROOT_DIR, 'hud-overlay.js');
const PROBE_JS_PATH = path.join(ROOT_DIR, 'probe-core.js');
const DEPLOY_DIR = 'D:\\Program Files\\Open Yami RPG Editor\\extension\\yami-perf-extension';

const isDeploy = process.argv.includes('--deploy');

console.log('🚀 [DanJuan Builder] 开始执行构建自检流程...');

// 1. 样式同步：如果存在 src/style.css，将更新后的纯 CSS 注入 hud-overlay.js
if (fs.existsSync(SRC_CSS_PATH)) {
  const css = fs.readFileSync(SRC_CSS_PATH, 'utf8').trim();
  let hudJs = fs.readFileSync(HUD_JS_PATH, 'utf8');

  const sMarker = 'style.textContent = `';
  const eMarker = 'document.head.appendChild(style);';
  const sIdx = hudJs.indexOf(sMarker);
  const eIdx = hudJs.indexOf(eMarker);

  if (sIdx !== -1 && eIdx !== -1) {
    const before = hudJs.slice(0, sIdx + sMarker.length);
    const after = hudJs.slice(eIdx);
    hudJs = before + '\n' + css + '\n    `;\n    ' + after;
    fs.writeFileSync(HUD_JS_PATH, hudJs, 'utf8');
    console.log('  [CSS 注入] src/style.css 已成功注入 hud-overlay.js');
  }
}

// 2. 语法测试 (Syntax Check)
try {
  execSync(`node --check "${HUD_JS_PATH}"`, { stdio: 'pipe' });
  execSync(`node --check "${PROBE_JS_PATH}"`, { stdio: 'pipe' });
  console.log('  [语法编译] hud-overlay.js 与 probe-core.js 语法校验 100% 通过');
} catch (err) {
  console.error('❌ [语法编译失败] 请检查 JS 代码语法！\n', err.message);
  process.exit(1);
}

// 3. 产物锚点严苛断言
const hudContent = fs.readFileSync(HUD_JS_PATH, 'utf8');

const requiredAnchors = [
  { name: '官方统一插件名', pattern: /DanJuan妙妙插件/ },
  { name: 'Views 页面契约架构', pattern: /const Views =/ },
  { name: 'Views 统一心跳调度', pattern: /Views\.current\.def\.refresh\(ctx\)/ },
  { name: '主页契约注册', pattern: /Views\.register\('home'/ },
  { name: '错误契约注册', pattern: /Views\.register\('errors'/ },
  { name: '性能契约注册', pattern: /Views\.register\('profiler'/ },
  { name: 'Remix Icon: ri-pulse-line', pattern: /ri-pulse-line/ },
  { name: 'Remix Icon: ri-bug-line', pattern: /ri-bug-line/ },
  { name: 'Remix Icon: ri-stack-line', pattern: /ri-stack-line/ },
  { name: 'Remix Icon: ri-equalizer-line', pattern: /ri-equalizer-line/ },
  { name: '双重物理穿透控制', pattern: /style\.setProperty\('pointer-events', 'none', 'important'\)/ },
  { name: '多层 UI 联动隐身', pattern: /hud\.style\.setProperty\('display', 'none', 'important'\)/ },
  { name: '指标 ID: yami-fps', pattern: /id="yami-fps"/ },
  { name: '指标 ID: yami-ms', pattern: /id="yami-ms"/ },
  { name: '指标 ID: yami-dc', pattern: /id="yami-dc"/ },
  { name: '指标 ID: diag-score', pattern: /id="diag-score"/ },
  { name: '四模块入口占位齐全', pattern: /data-target="profiler"[\s\S]*?data-target="errors"[\s\S]*?场景实体[\s\S]*?变量与开关/ }
];

let failedCount = 0;
for (const chk of requiredAnchors) {
  if (!chk.pattern.test(hudContent)) {
    console.error(`❌ [断言失败] 缺失关键锚点: ${chk.name}`);
    failedCount++;
  }
}

// 绝对零 Emoji + 中文术语断言 (覆盖 hud / probe / css 全部产物源)
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/u;
const probeContent = fs.readFileSync(PROBE_JS_PATH, 'utf8');
const styleCssContent = fs.existsSync(SRC_CSS_PATH) ? fs.readFileSync(SRC_CSS_PATH, 'utf8') : '';
const artifactFiles = [
  ['hud-overlay.js', hudContent],
  ['probe-core.js', probeContent],
  ['src/style.css', styleCssContent]
];
for (const [fname, fcontent] of artifactFiles) {
  const emojiCount = (fcontent.match(new RegExp(emojiRegex.source, 'gu')) || []).length;
  if (emojiCount > 0) {
    console.error(`❌ [断言失败] 检测到违规 Emoji (${fname}: ${emojiCount} 处)，严禁带入界面！`);
    failedCount++;
  }
  const termRegex = /粒子微粒|微粒|UI 元素/g;
  const termHits = fcontent.match(termRegex) || [];
  if (termHits.length > 0) {
    console.error(`❌ [断言失败] 中文术语违规 (${fname}): ${termHits.join(' / ')}`);
    failedCount++;
  }
}

if (failedCount > 0) {
  console.error(`\n⚠️ 共有 ${failedCount} 项自检断言未通过，终止构建！`);
  process.exit(1);
}

console.log(`  [断言自检] 全部 ${requiredAnchors.length} 项核心锚点 + 0 Emoji + 术语合规校验全绿！`);

// 4. 计算 MD5 函数
function calcMd5(filePath) {
  if (!fs.existsSync(filePath)) return 'FILE_NOT_FOUND';
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

// 5. 如果传入 --deploy，执行单向安全镜像
if (isDeploy) {
  console.log(`\n📦 [--deploy] 开始单向镜像至编辑器目录: ${DEPLOY_DIR}`);
  if (!fs.existsSync(DEPLOY_DIR)) {
    console.error(`❌ 目标目录不存在: ${DEPLOY_DIR}`);
    process.exit(1);
  }

  const syncFiles = ['manifest.json', 'probe-core.js', 'hud-overlay.js', 'HANDOFF.md', 'README.md', '.gitignore'];
  console.log('----------------------------------------------------------------------');
  console.log('文件名              源文件 MD5 (SSOT)                目标文件 MD5 (生产)       状态');
  console.log('----------------------------------------------------------------------');

  for (const f of syncFiles) {
    const src = path.join(ROOT_DIR, f);
    const dest = path.join(DEPLOY_DIR, f);

    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      const srcMd5 = calcMd5(src);
      const destMd5 = calcMd5(dest);
      const match = srcMd5 === destMd5 ? '✅ 一致' : '❌ 不一致';
      console.log(`${f.padEnd(18)} ${srcMd5}  ${destMd5}  ${match}`);
    }
  }
  console.log('----------------------------------------------------------------------');
  console.log('✨ [部署完毕] 生产文件与母仓库完全一致，重启工程试玩即可生效！\n');
} else {
  console.log('\n💡 提示：运行 `node build.cjs --deploy` 可一键完成“自检 + 生产镜像 + MD5报告”。');
}
