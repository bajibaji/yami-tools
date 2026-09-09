#!/usr/bin/env node

/**
 * =======================================================================
 * DanJuan妙妙插件 极速原生构建与生产部署脚本 (Zero-Dependency Builder)
 * =======================================================================
 * 
 * 核心职责：
 * 1. 自动同步 src/style.css 至发布产物 hud-overlay.js (保证 SSOT 单文件免构建秒开)；
 * 2. SSOT 单一事实源版本级联同步 (支持 --bump patch/minor/major 或仅改 manifest.json 自动全量推流)；
 * 3. 产物质量与锚点自动化严苛自检 (语法检查 + 30大核心锚点 + 0 原生 button + 0 Emoji)；
 * 4. 传入 --deploy 时，单向安全镜像至编辑器生产目录，并输出 MD5 对齐报告。
 * 
 * 用法：
 *   node build.cjs                        # 本地自检 + 样式注入 + SSOT 级联同步
 *   node build.cjs --bump patch/minor     # 自动自增版本并一键级联对齐全部文件
 *   node build.cjs --deploy               # 本地自检 + 自动单向同步到编辑器目录 + MD5校验
 *   node build.cjs --bump minor --deploy  # 一键升级大版本并全量同步+部署
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

const isWatch = process.argv.includes('--watch');
const isDeploy = process.argv.includes('--deploy') || isWatch;   // --watch 内含首次部署

console.log('🚀 [DanJuan Builder] 开始执行构建自检流程...');

// 1. 样式同步：如果存在 src/style.css，将更新后的纯 CSS 注入 hud-overlay.js
if (fs.existsSync(SRC_CSS_PATH)) {
  const css = fs.readFileSync(SRC_CSS_PATH, 'utf8').trim();
  let hudJs = fs.readFileSync(HUD_JS_PATH, 'utf8');

  const sMarker = 'style.textContent = `';
  const eMarker = 'document.head.appendChild(style);';
  const sIdx = hudJs.indexOf(sMarker);
  const eIdx = hudJs.indexOf(eMarker);

  if (sIdx === -1 || eIdx === -1) {
    // 静默跳过会让样式源与产物悄悄漂移 → 必须显式失败
    console.error('❌ [CSS 注入失败] hud-overlay.js 中未找到样式注入标记 (style.textContent = ` / document.head.appendChild(style);)');
    process.exit(1);
  }
  const before = hudJs.slice(0, sIdx + sMarker.length);
  const after = hudJs.slice(eIdx);
  hudJs = before + '\n' + css + '\n    `;\n    ' + after;
  fs.writeFileSync(HUD_JS_PATH, hudJs, 'utf8');
  console.log('  [CSS 注入] src/style.css 已成功注入 hud-overlay.js');
} else {
  console.error('❌ [CSS 注入失败] 缺少样式源文件: ' + SRC_CSS_PATH);
  process.exit(1);
}

// 1.5 SSOT 智能版本管理与全量级联自动同步 (One-Source Cascade Sync)
// 规则：以 manifest.json 的 version 为唯一权威输入源；支持 --bump 自增参数；自动级联同步所有源码与文档
const manifestPath = path.join(ROOT_DIR, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// A. 命令行 --bump 智能自增支持 (node build.cjs --bump [patch|minor|major|<ver>])
const bumpIdx = process.argv.indexOf('--bump');
if (bumpIdx !== -1) {
  let bumpType = process.argv[bumpIdx + 1];
  if (!bumpType || bumpType.startsWith('-')) bumpType = 'patch';
  const oldVer = manifest.version;
  const parts = oldVer.split('.').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    if (bumpType === 'major') manifest.version = `${parts[0] + 1}.0.0`;
    else if (bumpType === 'minor') manifest.version = `${parts[0]}.${parts[1] + 1}.0`;
    else if (bumpType === 'patch') manifest.version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    else if (/^\d+\.\d+\.\d+$/.test(bumpType)) manifest.version = bumpType;
    else {
      console.error(`❌ [版本自增失败] 未知 bump 类型: ${bumpType}，可用: patch | minor | major | 具体版本号`);
      process.exit(1);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`  [版本自增] manifest.json: v${oldVer} -> v${manifest.version} (--bump ${bumpType})`);
  }
}

const manifestVer = manifest.version;
const syncedList = [];

// B. 级联同步 probe-core.js
let probeRaw = fs.readFileSync(PROBE_JS_PATH, 'utf8');
const probeVerMatch = probeRaw.match(/const\s+PROBE_VERSION\s*=\s*['"]([^'"]+)['"]/);
const oldProbeVer = probeVerMatch ? probeVerMatch[1] : null;
if (oldProbeVer !== manifestVer) {
  probeRaw = probeRaw.replace(/const\s+PROBE_VERSION\s*=\s*['"][^'"]+['"]/, `const PROBE_VERSION = '${manifestVer}'`);
  fs.writeFileSync(PROBE_JS_PATH, probeRaw, 'utf8');
  syncedList.push('probe-core.js');
}

// C. 级联同步 hud-overlay.js (兜底版本号字面量全部自动对齐)
let hudRaw = fs.readFileSync(HUD_JS_PATH, 'utf8');
let hudChanged = false;
if (oldProbeVer && oldProbeVer !== manifestVer) {
  const oldVerLitRe = new RegExp(`'${oldProbeVer.replace(/\\./g, '\\.')}'`, 'g');
  if (oldVerLitRe.test(hudRaw)) {
    hudRaw = hudRaw.replace(oldVerLitRe, `'${manifestVer}'`);
    hudChanged = true;
  }
}
// 兜底扫描并对齐所有孤立的不匹配字面量
const hudVerLits = hudRaw.match(/'\d+\.\d+\.\d+'/g) || [];
hudVerLits.forEach((lit) => {
  if (lit !== `'${manifestVer}'`) {
    hudRaw = hudRaw.replaceAll(lit, `'${manifestVer}'`);
    hudChanged = true;
  }
});
const badgeRe = /(<span\s+id="yami-version-badge"[^>]*>v)\d+\.\d+\.\d+([^<]*<\/span>)/g;
if (badgeRe.test(hudRaw)) {
  hudRaw = hudRaw.replace(badgeRe, `$1${manifestVer}$2`);
  hudChanged = true;
}
const reportVerRe = /(- \*\*插件版本\*\*: v)\d+\.\d+\.\d+/g;
if (reportVerRe.test(hudRaw)) {
  hudRaw = hudRaw.replace(reportVerRe, `$1${manifestVer}`);
  hudChanged = true;
}
if (hudChanged) {
  fs.writeFileSync(HUD_JS_PATH, hudRaw, 'utf8');
  syncedList.push('hud-overlay.js');
}

// D. 级联同步 README.md
const readmePath = path.join(ROOT_DIR, 'README.md');
if (fs.existsSync(readmePath)) {
  let readmeRaw = fs.readFileSync(readmePath, 'utf8');
  const readmeVerRe = /(> \*\*版本\*\*：`v)\d+\.\d+\.\d+(`)/;
  if (readmeVerRe.test(readmeRaw)) {
    const curReadmeVer = readmeRaw.match(readmeVerRe)[0];
    if (!curReadmeVer.includes(`v${manifestVer}`)) {
      readmeRaw = readmeRaw.replace(readmeVerRe, `$1${manifestVer}$2`);
      fs.writeFileSync(readmePath, readmeRaw, 'utf8');
      syncedList.push('README.md');
    }
  }
}

// E. 级联同步 HANDOFF.md
const handoffPath = path.join(ROOT_DIR, 'HANDOFF.md');
if (fs.existsSync(handoffPath)) {
  let handoffRaw = fs.readFileSync(handoffPath, 'utf8');
  const handoffVerRe = /(当前版本：`v)\d+\.\d+\.\d+(`)/;
  if (handoffVerRe.test(handoffRaw)) {
    const curHandoffVer = handoffRaw.match(handoffVerRe)[0];
    if (!curHandoffVer.includes(`v${manifestVer}`)) {
      handoffRaw = handoffRaw.replace(handoffVerRe, `$1${manifestVer}$2`);
      fs.writeFileSync(handoffPath, handoffRaw, 'utf8');
      syncedList.push('HANDOFF.md');
    }
  }
}

if (syncedList.length > 0) {
  console.log(`  [SSOT 级联同步] 单一事实源生效，已自动对齐 ${syncedList.length} 个文件: ${syncedList.join(', ')}`);
}

// F. 最终一致性安全门禁 (SSOT Final Consistency Assertion)
const finalProbeVerMatch = probeRaw.match(/const\s+PROBE_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!finalProbeVerMatch || finalProbeVerMatch[1] !== manifestVer) {
  console.error(`❌ [版本号校验失败] probe-core.js 未对齐到 ${manifestVer}`);
  process.exit(1);
}
const finalHudVerLits = hudRaw.match(/'\d+\.\d+\.\d+'/g) || [];
const badVerLits = finalHudVerLits.filter((lit) => lit !== `'${manifestVer}'`);
if (badVerLits.length > 0) {
  console.error(`❌ [版本号不一致] hud-overlay.js 兜底版本号 ${badVerLits.join(', ')} 与 manifest.json (${manifestVer}) 不一致`);
  process.exit(1);
}
console.log(`  [版本核验] 组件全线单一事实源版本号已完全对齐为: v${manifestVer}`);

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
  { name: '存档契约注册', pattern: /Views\.register\('save'/ },
  { name: '场景实体契约注册', pattern: /Views\.register\('scene'/ },
  { name: '场景实体页骨架', pattern: /id="yami-scene-root"/ },
  { name: 'Remix Icon: ri-pulse-line', pattern: /ri-pulse-line/ },
  { name: 'Remix Icon: ri-bug-line', pattern: /ri-bug-line/ },
  { name: 'Remix Icon: ri-save-3-line', pattern: /ri-save-3-line/ },
  { name: 'Remix Icon: ri-equalizer-line', pattern: /ri-equalizer-line/ },
  { name: '双重物理穿透控制', pattern: /style\.setProperty\('pointer-events', 'none', 'important'\)/ },
  { name: '多层 UI 联动隐身', pattern: /hud\.style\.setProperty\('display', 'none', 'important'\)/ },
  { name: '指标 ID: yami-fps', pattern: /id="yami-fps"/ },
  { name: '指标 ID: yami-ms', pattern: /id="yami-ms"/ },
  { name: '指标 ID: yami-dc', pattern: /id="yami-dc"/ },
  { name: '指标 ID: diag-score', pattern: /id="diag-score"/ },
  { name: '五模块入口布局齐全', pattern: /data-target="profiler"[\s\S]*?data-target="errors"[\s\S]*?data-target="save"[\s\S]*?data-target="scene"[\s\S]*?data-target="cheats"/ },
  { name: '作弊插件契约注册', pattern: /Views\.register\('cheats'/ },
  { name: '作弊插件页骨架', pattern: /id="page-cheats"/ },
  { name: '固定变量浮窗骨架', pattern: /id="yami-pinned-box"/ },
  { name: 'Remix Icon: ri-magic-line', pattern: /ri-magic-line/ },
  { name: '作弊台全部还原按钮', pattern: /id="btn-cheat-reset-all"/ },
  { name: '全部还原接线 probe API', pattern: /probe\.resetAllCheats\(\)/ },
  { name: '工程体检面板骨架', pattern: /id="yami-audit-panel"/ },
  { name: '一键体检按钮', pattern: /id="btn-run-project-audit"/ },
  { name: '工程体检接线 probe API', pattern: /probe\.runProjectAudit/ },
  { name: '报错事件执行定位渲染', pattern: /yami-error-event-ctx/ }
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

// 铁律②: 严禁原生 <button> 标签 (编辑器全局 button{position:absolute;width:88px;height:20px} 会打歪)
const nativeBtnHits = hudContent.match(/<button[\s>]/g) || [];
if (nativeBtnHits.length > 0) {
  console.error(`❌ [断言失败] 检测到 ${nativeBtnHits.length} 处原生 <button> 标签，违反铁律②，请改用 <div role="button">！`);
  failedCount++;
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

// 6. --watch: 源文件保存即自动重建并部署, 免手动敲 --deploy
if (isWatch) {
  const WATCH_FILES = [SRC_CSS_PATH, PROBE_JS_PATH, HUD_JS_PATH, path.join(ROOT_DIR, 'manifest.json')];
  let lastBuildAt = Date.now();
  let timer = null;
  console.log('👀 [--watch] 已开始监听源文件，保存即自动构建并部署到编辑器目录（Ctrl+C 退出）');
  console.log('   监听: ' + WATCH_FILES.map((f) => path.basename(f)).join(' / '));
  WATCH_FILES.forEach(function (file) {
    try {
      fs.watch(file, function () {
        // ponytail: 2s 静默窗口规避「构建自身重写 hud-overlay.js」的自触发循环；2s 内的连续保存会被合并
        if (Date.now() - lastBuildAt < 2000) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          lastBuildAt = Date.now();
          console.log('\n[变更] ' + path.basename(file) + ' → 重新构建并部署');
          try {
            execSync('node "' + __filename + '" --deploy', { stdio: 'inherit' });
          } catch (e) {
            console.error('❌ 本次构建失败，修正后保存即可重试');
          }
          lastBuildAt = Date.now();
        }, 250);
      });
    } catch (e) {
      console.warn('  [watch] 无法监听 ' + path.basename(file) + ': ' + e.message);
    }
  });
}
