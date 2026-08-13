# YAHZJ 快速本地化 Handoff

> 最后整理：2026-08-13
> 代码仓库：`D:\Documents\GitHub\yami-tools`
> 游戏工程：`D:\new-game`（Yami RPG Maker 工程，半成品）
> 完工参照：`D:\GAME-20240905`（已发布、已做本地化的完整项目，13 种语言）
> 本地地址：`http://127.0.0.1:4173/tools/localization-lab/`
> 线上地址：<https://bajibaji.github.io/yami-tools/tools/localization-lab/>

## 1. 当前状态

快速本地化（v0.2.0 beta）是工具合集第四号工具：找出工程中**尚未本地化的硬编码文本**、**缺翻译条目**、**孤儿引用**与**疑似占位翻译**，导出多语言 Excel 供翻译，翻译完成后导入写回工程；孤儿引用可一键按现有引用 ID 创建缺失条目。

- 分支：`main`（未提交、未推送、未部署，等用户验收）
- 工具版本：`v0.2.0 beta`（`tools/version.json`；`index.html` 缓存参数 `?v=20260813-localization-lab-2`）
- **已用两个真实工程验证**（用户授权，2026-08-13）：`D:\new-game` 半成品 + `D:\GAME-20240905` 完工参照，全链路验收细节见 §9
- v0.2.0 新增：孤儿引用自动修复（含 actor 扫描）、按来源类型分文件夹、忽略行预览明示、疑似占位符识别、中置信噪声过滤（颜色/引擎枚举/标签剥离）、**原文颜色渲染**（`<color:hex>` 直接显示彩色）、**原文内联编辑**（✎，按扫描原文校验）、**缺翻译/疑似占位内联补译保存**（备份后写回）、**备份与还原面板**（列出/立即备份/还原/删除）、**扫描顶部进度条**、**仅扫描已引用资产**（复刻引擎打包算法，默认过滤闲置资产，可勾选「含未引用资产」关闭）、**已本地化视图**（被引用条目的原文/译文直接编辑写回）、**单语言模式**（译文语言下拉切换，列表只显示当前语言一列；候选视图可直接预填译文随 Excel 导出）、**唯一 ID 显示与立即本地化**（候选原文下方显示会话内稳定的 16hex ID——与引擎同格式；「本地化」按钮当场创建条目并替换文件，无需 Excel）
- 已知缺陷：英文候选仍是启发式（置信度列人工过滤）；同形词（如「梅林」）会进「疑似占位-请确认」软提示；孤儿建议文本是参考值需人工过目

## 2. 文件职责

| 文件 | 职责 |
| --- | --- |
| `tools/localization-lab/index.html` | 顶部进度条、顶栏（工程选择/备份与还原/导出/导入）、5 张统计卡（候选/缺翻译/孤儿/疑似占位/已本地化）、工具栏（含未引用/译文语言切换/孤儿修复/保存修改）、导入预览区、备份面板 |
| `tools/localization-lab/styles.css` | 沿用 idle-lab 视觉语言（变量体系/卡片/表格/toast）+ 孤儿输入/修复按钮/疑似占位样式 |
| `tools/localization-lab/app.js` | 顶部纯函数核心（`globalThis.LocalizationLabCore`，node 可跑）+ 底部 DOM 装配（`document` 检测双模式） |
| `tools/localization-lab/self-check.js` | 15 组 assert 单测（判定/分段/合并/孤儿/占位/路径/替换/校验/文件夹/幂等/序列化） |

注册改动：`tools/version.json` 的 `localization-lab` 键、hub `index.html` 第 4 张卡片描述、`tools/bump-version.js` 工具数组、`assets/hub.css` 的 `.icon-local`。

依赖：`vendor/exceljs.min.js`（全局 script，浏览器导出/导入 xlsx）。E2E 目录 `.e2e-tmp/node_modules` 里有 node 版 exceljs 供测试校验。

## 3. 工程数据生态（已探索实测，两工程对比）

- `Data/localization.json`：`{list: 树}`——文件夹节点 `{class:"folder", name, expanded, children}`，叶子 `{id:16hex, name, contents:{语言键}}`。
- 引用格式 `<ref:16hexID>`，可夹带在文本中间，常与 `<color:#hex>`、`<local:变量>`、`<global:16hex>`、`<image:16hex>` 混排。
- 引擎 `Script/local.ts` `Local.replace()`：按当前语言替换 ref；查不到/缺语言时**原样保留 tag**（英文包空时英文用户看到 `<ref:xxx>`）。
- 硬编码中文分布在 `attributes[].value`（attribute.json `type:'string'` 属性）与事件命令树的 `value/content/comment/tag/operand` 字段；`.ui` 节点自带 `name` 编辑器标签（对候选排除、对孤儿建议有用）。
- **actor 文件有可见文本**（v0.2.0 起扫描）：名称/备注属性是 ref；英雄角色有硬编码姓名（亚米/希露.普莱恩）与台词（「你有何事？」）、怪物有硬编码名称；事件树含大量中英双语注释（comment 字段）。
- 完工参照工程（GAME-20240905）：1716 条目 106 文件夹、13 语言；其组织方式为**语义功能分组**（帝国事件文本/教程文本/名词/怪物名字…），非来源类型分组。
- **Yami 原生序列化 = 2 空格缩进 + CRLF + 无尾随换行**（实测 `000 - 治疗药剂.9bb9eeccaf5c50a5.item`）——写回必须仿生，见 §7。

## 4. 核心功能与判定算法

扫描范围：manifest 的 items/equipments/skills/states/events/ui/triggers/**actors**（.ui 只走命令树；v0.2.0 起含 actor——英雄姓名/台词/怪物名称硬编码 + 名称/备注 ref 的孤儿检测）。

**只扫已引用资产（v0.2.0，用户拍板，复刻引擎打包算法）**：引擎打包（编辑器 `deploy-project-window.js` + `data-object.js createReferencedFileIDMap:334-387`）只打包「被引用」的文件——工具默认按同一算法过滤：

1. 全部资产文件内容（ui/scenes/actors/skills/triggers/items/equipments/states/events/animations/particles/tilesets）+ plugins/commands/config 序列化后，出现的**纯 16hex GUID 字符串值**标记为已引用；
2. **UI/场景预设元素映射**：事件的 `createElement presetId` 经 `uiPresets/scenePresets` 反查到所在 ui/scene 文件（否则对话框这类按预设引用的 UI 会被误判未引用）；
3. 自动触发事件（`type !== 'common'`）自身标记；
4. 脚本 meta（guid+code）自标记 + 脚本代码内单双引号 GUID。

未命中集合的资产 = 游戏里用不到（如 new-game 的「旧装备」「废弃人物」「哥布林证明」测试掉落）→ 默认不进候选/孤儿；工具栏「含未引用资产」可临时关掉过滤。缺翻译/疑似占位视图同步只显示**被已引用资产 `<ref:>` 引用**的条目（含条目内嵌套引用闭包；localization.json 本身整包携带，此过滤是工具侧的「游戏里真的会显示」视角）。

**未本地化判定（三层信号）**：

1. **字段级白名单**：`attributes[].value` 限 attribute.json `type==='string'` 属性（`loopList` 属性 ID 自动排除——语义键匹配，兜底 GUID `4cb407bd71929620`）；命令树只收 `value/content/comment/tag/operand` ∪ 本趟已见 `<ref:` 的 key（ref 先例），排除 `name`/`script`/`description`/`namespace`/`id`/`key`/`type` 等元数据 key；`attributes` 数组跳过命令树遍历（防重复扫描）。
2. **字符串特征**：先剥 `path`（含中文路径也算路径）→ 含 CJK → `high`；排除 16hex GUID/32hex、**8hex 与 #6hex 颜色码**、纯数字表达式、纯标签残留（**判定前剥 color/local/global/image 标签**）、单 ASCII 字符、命令 tag 枚举（`COMMAND_TAG_DENYLIST`，v0.2.0 起 value 位置单 token 引擎枚举也排除——inventory/smithy/ranged/melee/sell/buy…，多词英文保留）；纯英文 → `medium`（误报由 Excel 置信度列人工过滤）。
3. **人工兜底**：Excel 置信度列 + UI 勾选 + 处理方式列（替换/忽略）。

**分段**：`splitRefSegments` 按 `<ref:ID>` 切分——无 ref → `kind='full'` 整值候选；有 ref → `kind='segment'` 只处理非 ref 段（ref 段保留）。

**合并（用户拍板）**：`normalizeText`（剥 color/local/global 标签 + 折叠空白）相等 → 同候选同 ID，`locations: [{file, path, raw, segmentIdx, kind}]` 记录全部出现位置，翻译一次处处生效。

**缺翻译**：config 语言列表中除首个（zh-CN）外任一语言为空即计入（16 国时自动覆盖全部语言）。

**孤儿引用（v0.2.0 重做）**：`collectOrphanRefs` **全树扫描**（不依赖文本字段白名单——任何字符串值里的 `<ref:ID>` 都检查），记录上下文（attrKey→属性语义名、.ui 节点 `name`、同值内 refIndex/refCount），按 refId 分组（同 ID 多处引用合并一条）。建议文本推导：① 名称属性的 ref ← 文件名核心（剥 `序号.` 前缀与 ` -后缀`）；② .ui 节点编辑器标签（左右/上方/关闭…）；③ 其余留空人工填写。**修复 = 按现有引用 ID 在 localization.json 创建缺失条目（资产文件已引用该 ID，无需改动）**。

**疑似占位符（v0.2.0 新增）**：`findSuspiciousTranslations`——① 脏词整值（shit/fuck/xxx/test/todo/待翻译/未翻译/占位…）→「占位词」；② 与 zh-CN 原文相同且含 CJK → zh-TW 含简体独有字（`SIMPLIFIED_ONLY_RE`）判「简体未转繁（疑似未翻译）」，否则「与原文相同（可能同形，请确认）」；版本号/纯数字同值不算。只报告不自动改。

## 5. 16 国语言扩展（全链路零硬编码，已核实引擎机制）

- 引擎侧零改动：`local.ts` 的 `contents[语言键]` 是任意键 map，`compileTextContents()` 遍历 config 语言列表编译所有语言。
- **加语言的唯一动作**：往 `Data/config.json localization.languages`（对象数组 `{name, font, scale}`）加一项并重新导出；工具与引擎均零改动。
- 工具侧全部由 config 驱动：语言列表、缺翻译/疑似占位判定、Excel 列与导入写入（按列头语言键写 `contents[语言名]`）。
- 引擎语言别名（zh-HK→zh-TW）在引擎内做，工具不处理。

## 6. Excel 导出/导入

**导出** `localization-导出-YYYYMMDD_HHmmss.xlsx`，五 sheet：
- 待本地化：ID（**导出时预分配 16 位随机 hex**，导入按 ID 匹配幂等）/ 原文(zh-CN) / 各语言列 / 处理方式（默认替换，可改忽略）/ 置信度 / 来源 / 出现位置（多条换行）
- 缺翻译：ID / 名称 / 中文 / 各语言列 / 缺语言
- 疑似占位：ID / 名称 / 中文 / 各语言列 / 疑似说明（预填原因与现值，改语言列即可写回）
- 孤儿引用：引用ID / 出现文件 / 上下文 / 建议文本（**建议文本非空 → 导入时按引用 ID 创建条目**；留空跳过）
- 说明：填写指引（含新 sheet 说明与分组写入说明）

**导入**：选 Excel → 纯函数校验（ID 格式/表内重复**按 sheet 分开**/与现有条目冲突/原文空/补译行 ID 必须存在）→ 渲染预览（新增 N / 补译 M / **忽略 K 条逐行列原因** / 错误红字）→ 确认后才写入。语言列动态识别（按表头定位 ID/原文/处理方式列，中间列即语言）。

**忽略行（v0.2.0）**：处理方式=忽略、孤儿建议文本为空、幂等已存在三类行在 `validateImportRows` 里进 `ignored` 列表，预览单独明示（不创建、不替换、不写入），不计入新增数。

**导入安全（勿削弱）**：
1. 导入前强制重扫工程，按 `文件+路径` 定位校验当前值与导出时一致（不匹配=外部改动 → **整个中止**）；
2. 同一候选同一文件的多个位置**先全部校验后统一替换**（`applyAssetReplacement` 加 file 参数，DOM 按「候选×文件」分组调用——否则第一个替换成 `<ref:ID>` 后第二个校验失败）；
3. `Lootsmith Backups/<时间戳>/` 备份 localization.json + 全部待写资产文件，写后回读校验；
4. 写回失败用备份恢复；
5. 幂等：ID 已存在且原文一致 → 跳过；同 Excel 二次导入 = no-op（v0.2.0 起跳过行在预览中明示）；
6. fallback（webkitdirectory）导入模式只读，导入按钮与孤儿修复按钮禁用。

## 7. 写回格式与条目组织（真实工程验证）

- 资产文件替换：`kind='full'` 整值 → `<ref:ID>`；`kind='segment'` 只替换命中段保留其余 ref/标签。本地化条目 zh-CN = 原文**原样**（含 color/local 标签，引擎替换后照常渲染）。
- **孤儿修复只写 localization.json**（资产文件已引用该 ID）；新增条目 ID = 现有引用 ID，**不是**随机新 ID。
- **`serializeLike(data, 原文本)` 仿生写回**：2 空格缩进 + 按原文本换行风格（CRLF/LF）+ 尾随换行有无跟随原文件——不仿生会让 Yami 编辑器产生全文件 diff。
- 新增条目写入 localization.json 根级**「快速本地化」文件夹**，其下**按来源类型分子文件夹**（物品/装备/技能/状态/事件/界面/触发器/角色/孤儿修复；不存在则创建，同类型复用同一子文件夹）；`name` 字段取原文前 20 字符。

## 8. 关键函数（app.js）

纯函数核心（self-check 覆盖）：`buildStringAttributeIds` / `loopListAttributeId` / `localizationIds` / `buildAttributeNames` / `collectRefKeys` / `collectCandidates` / `collectOrphanRefs` / `orphanSuggestion` / `groupOrphans` / `classifyText` / `splitRefSegments` / `normalizeText` / `mergeCandidates` / `findMissingTranslations` / `findSuspiciousTranslations` / `buildScanResult` / `locateValue`（路径不存在返回 undefined）/ `setValue` / `replaceSegment` / `applyAssetReplacement` / `localizationInsertion` / `validateImportRows` / `serializeLike` / `randomHex16`。

DOM：`scanProject`（root 模式）/ `scanProjectFiles`（fallback，**webkitRelativePath 首段是所选目录名需剥掉**）/ `collectAssets`（扫描 + 引用类型 + 脚本全量收集，驱动进度条）/ `rescanFromCache`（切换「含未引用资产」时不重读文件）/ `buildExportWorkbook`（候选译文预填自界面输入）/ `readImportWorkbook` / `confirmImport` / `localizeCandidateNow`（单条立即本地化：按显示的唯一 ID 创建条目 + 替换文件 + 备份写回）/ `createOrphanEntries`（孤儿修复写回）/ `writeLocalizationFills`（原文/译文修改写回，含 zh-CN 编辑）/ `renderLocalizedRows`（已本地化视图）/ `renderRichText`（颜色标签渲染）/ `startTextEdit`（候选原文内联编辑，编辑格内也显示 ID）/ `openBackupPanel`·`backupNow`·`restoreBackup`·`deleteBackup`（备份与还原）/ `setScanProgress`（顶部进度条）/ `startAutoSync`（watchPaths 5s 轮询，变化 toast 提示不自动重扫）。

## 9. 验收记录（2026-08-13，两个真实工程）

**真实扫描（只读，仅已引用资产）**：
- `D:\new-game`：336 资产 → **跳过未引用 92 个**（旧装备 43/未接入怪物 33/闲置技能 9/物品 3/事件 4）→ 候选 660（高 379/中 281）、缺翻译 118（另有 69 条未被引用已跳过）、疑似占位 1（en="shit"）、**孤儿 16**、**已本地化 120 条**。孤儿建议抽查：`2ce00873427ec87f`→「兽人」、`2c73fa96888b1094`→「黄金巨人骷髅」、设置界面 →「左右/上方/关闭/标题/伤害数字方向标签」。
- `D:\GAME-20240905`（完工参照）：2501 资产 → **跳过未引用 560 个**（地图编辑器辅助技能 236/DLC 建筑 195/未接线事件 58…）→ 候选 692（v0.1.0 全量是 1068）、缺翻译 3（另有 11 条未引用已跳过）、疑似占位 161（另有 36 条未引用已跳过；zh-TW/ja 与 zh-CN 相同是真实现状）、孤儿 0（v0.1.0 报的 1 个孤儿在未引用的升级技能里）、**已本地化 1436 条**。

**写回链路**（`.e2e-tmp/verify-real2.js`，`%TEMP%` 副本，真实工程零写入）：孤儿修复 3 条按引用 ID 建条目 → 候选导入 2 新增（物品/角色分文件夹）+ 2 补译 + 1 忽略行 → 资产替换 4 文件 → localization 子文件夹（孤儿修复/物品/角色）条目与补译校验 → 二次导入 0 新增（幂等）→ 5 文件真实写回 + 格式仿生对账 → 重扫已修复孤儿归零 → 备份恢复无残留 → 临时副本清理。

**浏览器 E2E**（`.e2e-tmp/test-localize.js`）：fallback 扫描（缺翻译 187 对账、疑似占位 1 含 shit）+ 导出五 sheet 结构（待本地化行数=候选数、ID 16hex、疑似占位 sheet 1 行）+ 疑似占位视图渲染 + **颜色渲染断言**（「恢复<color:00ff00>50</color>HP」渲染成 #00ff00 span）+ 原文编辑按钮 + 进度条/备份面板元素与 fallback 禁用态 + 零 pageerror。

**验证命令**：`node --check tools/localization-lab/app.js`、`node tools/localization-lab/self-check.js`、`node .e2e-tmp/test-localize.js`、`node .e2e-tmp/verify-real2.js`。

## 10. 边界与注意事项

- **不要直接改 `D:\new-game` 做测试**（用户授权用两个真实工程验证，日常仍用临时副本）；写回必须保留备份/恢复流程。
- 不要删除「快速本地化」文件夹逻辑、按类型子文件夹与预分配 ID 机制（幂等依赖）。
- 不要把 `applyAssetReplacement` 改回逐位置调用（同文件多文本会误中止）。
- 不要移除 `serializeLike` 仿生（写回格式是 Yami 编辑器兼容底线）。
- **孤儿修复用现有引用 ID 创建条目，不要给孤儿分配随机新 ID**（资产文件已引用原 ID，新 ID 无法让 ref 生效）。
- 孤儿建议文本是参考值（文件名/编辑器标签推导），写入前必须人工过目；后缀 ref（同值第 2 个 ref，如「（远程）」）与备注属性不推导，留空人工填写。
- **原文内联编辑**：条目 zh-CN 与 Excel 导出用编辑后的文本，导入替换校验仍按扫描原文（`candidate.originalZhCN` 首次编辑时锁定）——不要改回用编辑后文本校验（文件里还是原文本，会误中止）。
- **已本地化视图的 zh-CN 编辑会直接改游戏里显示的文本**（条目 contents 写回），保存前自动备份；这是用户明确的编辑需求，不要加只读限制。
- 单语言模式：译文列跟随「译文语言」下拉；候选视图的译文输入进 Excel 导出，也会随「本地化」按钮直接写入新条目。
- **候选唯一 ID（会话内稳定）**：`renderScan` 按 normalized 文本分配（`state.candidateIdMap`），重扫/切换「含未引用资产」不换 ID；16hex 随机与引擎 GUID 同格式；Excel 导出与「本地化」按钮共用同一 ID。原文下方与编辑格内都显示该 ID（缺翻译/疑似占位/已本地化视图的条目 ID 也显示在文本下方）。
- 「本地化」按钮 = 单条 confirmImport：先读文件 → 内存校验替换（`originalZhCN` 规则同导入）→ 备份 → 写回资产 + localization.json → 重扫。
- 缺翻译/疑似占位/已本地化三个视图共用 `fillDrafts` 与「保存修改」写回；fill 只写非空值（不支持清空为「」，删值请在 Yami 编辑器做）。
- 备份文件名 = 原路径 `/` 换成 `__`；还原按 `__` 反解路径，**还原前自动快照到「还原前-<时间戳>」目录**（可反悔）；删除备份不可恢复，无确认弹窗（点了就删）。
- 备份面板只在 root 模式可用（fallback 无目录句柄）。补译保存与孤儿修复一样只写 localization.json（先备份）。
- 英文候选是启发式（中置信），依赖人工过滤；命令 tag 排除清单按当前工程噪声起步（v0.2.0 扩展到 value 位置单 token）。
- 疑似占位只报告不自动改；「与原文相同」对同形专名（梅林/史蒂夫）会有软提示误报，靠「可能同形，请确认」措辞与人工过滤。
- 占位符脏词表按当前样本起步（shit/fuck/xxx/test/todo…），整值匹配。
- **引用过滤复刻引擎打包算法**（data-object.js createReferencedFileIDMap），引擎升级后需对账（行号见源码注释）；未引用资产仍可通过「含未引用资产」勾选查看，但默认不进导出与导入。
- 缺翻译/疑似占位的引用过滤是工具侧视角（引擎打包时 localization.json 整包携带）；被脚本动态显示但无 `<ref:` 的条目理论上会被过滤——两个真实工程实测插件脚本里无 `<ref:`，风险低。
- 后续若新增语言：只改 `Data/config.json localization.languages`，不要动工具代码。

## 11. 下一步候选

1. 设置界面 5 个孤儿（标题/伤害数字方向标签/左右/上方/关闭）等无文件名线索的条目，可考虑从「邻近 .ui 节点编辑器标签」进一步人工对账（已做标签提示，未做自动填充）；
2. 占位符脏词表与「同形词」白名单（如专名清单）可按用户工程样本扩充；
3. 导入预览支持勾选排除个别新增行（现在靠 Excel 处理方式列控制）；
4. 手工验收建议：选真实工程 → 导出 Excel → 填几条英文 → 导入 → 孤儿页一键创建 → 在 Yami 编辑器确认条目与替换生效 → 切英文语言实测显示。