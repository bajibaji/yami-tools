# YAHZJ 快速本地化 Handoff

> 最后整理：2026-08-13
> 代码仓库：`D:\Documents\GitHub\yami-tools`
> 游戏工程：`D:\new-game`（Yami RPG Maker 工程）
> 本地地址：`http://127.0.0.1:4173/tools/localization-lab/`
> 线上地址：<https://bajibaji.github.io/yami-tools/tools/localization-lab/>

## 1. 当前状态

快速本地化（v0.1.0）是工具合集第四号工具，用于找出工程中**尚未本地化的硬编码中文/英文文本**、**缺翻译条目**与**孤儿引用**，导出多语言 Excel 供翻译，翻译完成后导入写回工程。

- 分支：`main`（未提交、未推送、未部署，等用户验收）
- 工具版本：`v0.1.0`（`tools/version.json`）
- 资源缓存版本：`20260813-localization-lab-1`
- **已用真实工程 `D:\new-game` 完成验收**（用户授权，2026-08-13）：扫描/导入/写回/恢复全链路通过，验收细节见 §9
- 已知缺陷：无阻塞项；英文候选含误报（置信度列人工过滤），孤儿引用只报告不修复

## 2. 文件职责

| 文件 | 职责 |
| --- | --- |
| `tools/localization-lab/index.html` | 顶栏（工程选择/导出/导入）、统计卡片、候选列表、导入预览区 |
| `tools/localization-lab/styles.css` | 沿用 idle-lab 视觉语言（变量体系/卡片/表格/toast） |
| `tools/localization-lab/app.js` | 顶部纯函数核心（`globalThis.LocalizationLabCore`，node 可跑）+ 底部 DOM 装配（`document` 检测双模式） |
| `tools/localization-lab/self-check.js` | 11 组 assert 单测（判定/分段/合并/孤儿/路径/替换/校验/幂等/序列化） |

注册改动：`tools/version.json` 加 `localization-lab` 键、hub `index.html` 第 4 张卡片（`icon-local` + `order` 数组）、`tools/bump-version.js` 工具数组加 `'localization-lab'`、`assets/hub.css` 加 `.icon-local`。

依赖：`vendor/exceljs.min.js`（全局 script，浏览器导出/导入 xlsx）。E2E 目录 `.e2e-tmp/node_modules` 里有 node 版 exceljs 供测试校验。

## 3. 工程数据生态（已探索实测）

- `Data/localization.json`：`{list: 树}`——文件夹节点 `{class:"folder", name, expanded, children}`，叶子 `{id:16hex, name, contents:{zh-CN,en}}`。真实工程 189 叶子，**187 条缺 en**、1 条 en 是占位符。
- 引用格式 `<ref:16hexID>`，可夹带在文本中间，常与 `<color:#hex>`、`<local:变量>`、`<global:16hex>` 混排。
- 引擎 `Script/local.ts` `Local.replace()`：按当前语言替换 ref；查不到/缺语言时**原样保留 tag**（英文包空时英文用户看到 `<ref:xxx>`）。
- 硬编码中文分布在 `attributes[].value`（attribute.json `type:'string'` 属性）与事件命令树的 `value/content/comment/tag/operand` 字段；`.actor` 无可见文本、`Script/*.ts` 中文只在注释、`name` key 的 CJK 全是 `.ui` 编辑器标签。
- **Yami 原生序列化 = 2 空格缩进 + CRLF + 无尾随换行**（实测 `000 - 治疗药剂.9bb9eeccaf5c50a5.item`）——写回必须仿生，见 §7。

## 4. 核心功能与判定算法

扫描范围：manifest 的 items/equipments/skills/states/events/ui/triggers（`.ui` 只走命令树）。

**未本地化判定（三层信号）**：

1. **字段级白名单**：`attributes[].value` 限 attribute.json `type==='string'` 属性（`loopList` 属性 ID 自动排除——语义键匹配，兜底 GUID `4cb407bd71929620`）；命令树只收 `value/content/comment/tag/operand` ∪ 本趟已见 `<ref:` 的 key（ref 先例），排除 `name`/`script`/`description`/`namespace`/`id`/`key`/`type` 等元数据 key；`attributes` 数组跳过命令树遍历（防重复扫描）。
2. **字符串特征**：先剥 `path`（含中文路径也算路径）→ 含 CJK → `high`；排除 16hex GUID/32hex、纯数字表达式、`<local:>` 纯变量、`<color:>` 纯标签、单 ASCII 字符、命令 tag 枚举（`COMMAND_TAG_DENYLIST`，ponytail 按工程噪声起步）；纯英文 → `medium`（误报由 Excel 置信度列人工过滤）。
3. **人工兜底**：Excel 置信度列 + UI 勾选 + 处理方式列（替换/忽略）。

**分段**：`splitRefSegments` 按 `<ref:ID>` 切分——无 ref → `kind='full'` 整值候选；有 ref → `kind='segment'` 只处理非 ref 段（ref 段保留）。

**合并（用户拍板）**：`normalizeText`（剥 color/local/global 标签 + 折叠空白）相等 → 同候选同 ID，`locations: [{file, path, raw, segmentIdx, kind}]` 记录全部出现位置，翻译一次处处生效。

**缺翻译**：config 语言列表中除首个（zh-CN）外任一语言为空即计入（16 国时自动覆盖全部语言）。

**孤儿引用**：ref ID 不在 localization.json id 集合（真实工程现存 5 个，全在设置界面.ui）。

## 5. 16 国语言扩展（全链路零硬编码，已核实引擎机制）

- 引擎侧零改动：`local.ts` 的 `contents[语言键]` 是任意键 map，`compileTextContents()` 遍历 config 语言列表编译所有语言。
- **加语言的唯一动作**：往 `Data/config.json localization.languages`（对象数组 `{name, font, scale}`）加一项并重新导出；工具与引擎均零改动。
- 工具侧三点全由 config 驱动：语言列表（取 `lang.name`）、缺翻译判定、Excel 列与导入写入（按列头语言键写 `contents[语言名]`）。
- 引擎语言别名（zh-HK→zh-TW）在引擎内做，工具不处理。

## 6. Excel 导出/导入

**导出** `localization-导出-YYYYMMDD_HHmmss.xlsx`，四 sheet：
- 待本地化：ID（**导出时预分配 16 位随机 hex**，导入按 ID 匹配幂等）/ 原文(zh-CN) / 各语言列 / 处理方式（默认替换）/ 置信度 / 来源 / 出现位置（多条换行）
- 缺翻译：ID / 名称 / 中文 / 各语言列 / 缺语言 / 备注（已有值疑似占位符提示）
- 孤儿引用：引用ID / 文件 / 位置
- 说明：填写指引

**导入**：选 Excel → 纯函数校验（ID 格式/表内重复**按 sheet 分开**/与现有条目冲突/原文空/补译行 ID 必须存在）→ 渲染预览（新增 N / 补译 M / 错误红字）→ 确认后才写入。语言列动态识别（按表头定位 ID/原文/处理方式列，中间列即语言）。

**导入安全（勿削弱）**：
1. 导入前强制重扫工程，按 `文件+路径` 定位校验当前值与导出时一致（不匹配=外部改动 → **整个中止**）；
2. 同一候选同一文件的多个位置**先全部校验后统一替换**（`applyAssetReplacement` 加 file 参数，DOM 按「候选×文件」分组调用——否则第一个替换成 `<ref:ID>` 后第二个校验失败）；
3. `Lootsmith Backups/<时间戳>/` 备份 localization.json + 全部待写资产文件，写后回读校验；
4. 写回失败用备份恢复；
5. 幂等：ID 已存在且原文一致 → 跳过；同 Excel 二次导入 = no-op；
6. fallback（webkitdirectory）导入模式只读，导入按钮禁用。

## 7. 写回格式（真实工程验证）

- 资产文件替换：`kind='full'` 整值 → `<ref:ID>`；`kind='segment'` 只替换命中段保留其余 ref/标签。本地化条目 zh-CN = 原文**原样**（含 color/local 标签，引擎替换后照常渲染）。
- **`serializeLike(data, 原文本)` 仿生写回**：2 空格缩进 + 按原文本换行风格（CRLF/LF）+ 尾随换行有无跟随原文件——不仿生会让 Yami 编辑器产生全文件 diff。
- 新增条目插入 localization.json **根级「快速本地化」文件夹**（不存在则创建；ponytail 按类型分组有需求再加）；`name` 字段取原文前 20 字符。

## 8. 关键函数（app.js）

纯函数核心（self-check 覆盖）：`buildStringAttributeIds` / `loopListAttributeId` / `localizationIds` / `collectRefKeys` / `collectCandidates` / `classifyText` / `splitRefSegments` / `normalizeText` / `mergeCandidates` / `findMissingTranslations` / `buildScanResult` / `locateValue`（路径不存在返回 undefined）/ `setValue` / `replaceSegment` / `applyAssetReplacement` / `localizationInsertion` / `validateImportRows` / `serializeLike` / `randomHex16`。

DOM：`scanProject`（root 模式）/ `scanProjectFiles`（fallback，**webkitRelativePath 首段是所选目录名需剥掉**）/ `buildExportWorkbook` / `readImportWorkbook` / `confirmImport` / `startAutoSync`（watchPaths 5s 轮询，变化 toast 提示不自动重扫）。

## 9. 验收记录（2026-08-13，真实工程 D:\new-game）

**真实扫描**：268 文件 → 674 候选（高 377 / 中 297，共 1125 处）、缺翻译 187、孤儿 5——与探索基线完全吻合（「治疗药剂」合并 6 处生效）。

**真实导入链路**（`.e2e-tmp/verify-real.js`）：构造 3 新增 + 3 补译 → 校验 0 错误 → 内存替换 4 文件生效 → localization 插入校验通过 → **真实写回 5 文件生效**（换行格式与原文件一致）→ 备份恢复无残留。测试产生的备份目录已清理。

**真实数据暴露并修复的 3 个 bug**：
1. 同文件多个相同文本 → 先校验后替换 + 候选×文件分组（见 §6.2）；
2. `locateValue` 路径不存在抛 TypeError → 返回 undefined 转「位置不一致」中止；
3. 写回格式 LF+尾随换行 vs Yami 原生 CRLF 无尾随换行 → `serializeLike` 仿生（见 §7）。

**验证命令**：`node --check tools/localization-lab/app.js`、`node tools/localization-lab/self-check.js`、`node .e2e-tmp/test-localize.js`（浏览器 E2E：fallback 扫描 187 缺翻译对账 + 导出 xlsx 结构 + 零 pageerror）、`node .e2e-tmp/verify-real.js`（真实工程验收，先备份后恢复不残留）。

## 10. 边界与注意事项

- **不要直接改 `D:\new-game` 做测试**（用户授权过一次真实验收，日常仍用临时副本）；写回必须保留备份/恢复流程。
- 不要删除「快速本地化」文件夹逻辑与预分配 ID 机制（幂等依赖）。
- 不要把 `applyAssetReplacement` 改回逐位置调用（同文件多文本会误中止）。
- 不要移除 `serializeLike` 仿生（写回格式是 Yami 编辑器兼容底线）。
- 英文候选是启发式（中置信），依赖人工过滤；命令 tag 排除清单按当前工程噪声起步。
- 孤儿引用当前只报告不修复；占位符（en="shit"）无法自动识别。
- 后续若新增语言：只改 `Data/config.json localization.languages`，不要动工具代码。

## 11. 下一步候选

1. 孤儿引用的自动修复（对照 localization.json 邻近条目或提示手工处理）；
2. 导入前「处理方式=忽略」的行从预览中明示剔除；
3. 按来源类型分文件夹（有真实需求再加）；
4. 手工验收建议：选真实工程 → 导出 Excel → 填几条英文 → 导入 → 在 Yami 编辑器确认条目与替换生效 → 切英文语言实测显示。
