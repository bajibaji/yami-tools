# Yami Tools 项目记忆（MEMORY）

> 本文档沉淀历次对话的关键事实、用户偏好、技术决策与待办，供后续会话快速恢复上下文。
> 最后更新：2026-08-14（快速本地化 v0.2.1 准确算法版：两个核心功能 = 找「已本地化且会在界面出现的中文」编辑译文原文 + 找「未本地化但会在界面出现的中文」；界面候选/数据属性分档（完工 121+129、半成品 82+43）、setText 占位模板排除、已本地化按引用路径分档、疑似占位只判脏词、富文本标签解析显示（颜色索引/全局变量名/图片/嵌套 ref）+ 条目视图「默认富文本、✎ 切多行可拖拽 textarea 源代码、✓ 收尾」双态编辑；引擎格式 open-yami Excel + 增量刷新等 v0.2.0 功能集完整保留，双真实工程验证）

## 0. 沟通规则（用户 AGENTS.md，最高优先级）

- 所有回复**必须中文**；所有回复以「**爷，不肉。**」开头。
- 执行任务时运用四象限：共同已知 / 我的已知你的未知 / 我的未知你的已知 / 共同未知（信息不足时最多问 3 个关键问题，能推进就先做探索版）。
- 用户会自己验证和上线；**未经用户明确要求，不自动提交、推送、部署**。用户说「git 上去」「发」才提交。
- 测试期**禁止直接修改 `D:\new-game`** 作为测试手段（用临时副本）；实施类部署（写游戏工程）也需用户确认，可逆的新增文件可先做。
- 用户对 UI 视觉要求高：主页曾被用户自己重做；地图编辑器被评价「烂」并交由他人重做（见 HANDOFF-MAP-EDITOR.md）。

## 1. 项目概况

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\Documents\GitHub\yami-tools` |
| 游戏工程 | `D:\new-game`（Yami RPG Maker 工程） |
| 线上 | GitHub Pages：`https://bajibaji.github.io/yami-tools/` |
| 本地开发 | 仓库根 `python -m http.server 4173` |
| 性质 | 纯静态网页工具，无构建无框架（原生 JS/CSS） |
| 结构 | `index.html`（工具合集主页）+ `assets/hub.css` + `vendor/exceljs.min.js` + `tools/character-editor/`（角色编辑器）+ `tools/map-editor/`（地图编辑器）+ `tools/idle-lab/`（挂机验证台）+ `tools/perf-lab/`（性能测试台，2026-08-21 起）+ `tools/localization-lab/`（快速本地化） |

版本历史：v0.3.x（早期掉落编辑器）→ v0.4.1 → v0.5.1（继承/折叠/高亮等）→ v0.6.0（工具合集拆分+地图编辑器首版）→ v0.7.0（发布：主页新设计+合集+地图编辑器+方案文档）→ **v0.7.1（角色编辑器：排序自定义下拉 + 三工具工程自动同步，2026-08-13）** → **v0.1.0（快速本地化：第四工具，2026-08-13 新建）** → **v0.2.0 beta（快速本地化：引用过滤/孤儿修复/占位识别/已本地化视图/单语言模式/唯一 ID/立即本地化/备份还原面板/增量刷新，2026-08-14 未提交待验收）** → **v0.2.1 beta（快速本地化：open-yami 引擎格式 Excel 导入导出 + 缺翻译/疑似占位中文原文可编辑 + 候选噪声大清洗，2026-08-14）**。角色编辑器已升 **v0.7.2**（用户自行更新 version.json，2026-08-13）。**改 JS/CSS 必须同步更新各 `index.html` 里的 `?v=` 缓存参数**（否则 GitHub Pages/浏览器不刷新）。

## 2. 角色编辑器（tools/character-editor/）

- 扫描 Yami 工程 `.actor`/`.item`/`.equip`；选中角色编辑掉落物，写入两种存储：① `loopList` 字符串属性（GUID `4cb407bd71929620`）② 角色事件中的「掉落物品」插件指令（指令 `249c9c9d4de177c9`，事件类型 `c2ba6c4f90edd668`）。
- 保存流程：备份 → 写文件 → 失败回滚；角色列表已编辑浅蓝高亮（`.edited-role`），选中绿色（`.selected`），两者不同。
- 属性继承：角色文件 `inherit` 字段指向父角色 GUID；有效属性 = 本地 + 继承（seen 防环）。继承行只读，可「创建本地覆盖」。
- **掉落事件继承（用户拍板的行为）**：怪物自身无掉落事件时**不显示模板的掉落条目**，但显示「继承角色：XXX」加粗标识（说明编辑保存后会创建独立事件）；用户编辑掉落并保存 → 在 actor 本地创建**空掉落事件**（只含用户编辑的指令，不复制模板事件）。loopList（属性字符串）的继承显示保留。
- 人物属性模式：从 `Data/attribute.json` 解析 85 个角色属性（分组/类型/枚举），`enumeration.json` 解析枚举值；未知属性/未知枚举值只读保留；未知折叠区可展开。
- **列表搜索（2026-08-13 修复）**：角色/物品/装备搜索统一走 `recordSearchText()`，路径**去扩展名**后匹配——此前搜「it」会因 `.item` 后缀子串误命中全部物品、搜「ac」误命中全部角色（用户反馈的 bug）。搜索字段 = name + localizationId + 去扩展名 path + guid。
- **角色列表排序（2026-08-13，用户多轮反馈后定型）**：**自定义下拉**（非原生 select——原生弹出层在用户环境为系统白底且 `color-scheme` 不生效，CSS 管不到），深色弹出菜单 `#role-sort-menu`，分组文件名/名称/修改时间 × 升/降共 6 项，默认「文件名 ↑」（`basename` localeCompare zh-CN numeric）；**排序模式持久化** localStorage `loot-smith-role-sort`（刷新后记住，用户明确要求）；物品/装备列表排序未动。**创建日期排序做不了**：浏览器 File API 只有 `lastModified`，工程文件系统 birthtime 全是复制时间戳，actor/manifest 无时间字段。
- **价格/总价值/掉率（2026-08-13，用户多轮反馈定型）**：物品/装备价格读 `getValue(data,'price')`（item ID `49574fd687a9bd27`、equip ID `9c6c39e76efa5356`，货币单位 G 已核对 UI 模板 `价格 <local:_price>G`）；掉落列表标题显示总价值 `Σ(价格×掉率×期望数量)`（范围用 min/max 中值，装备固定 1，禁用不计）；**价格标签紧跟名字右侧**（`catalog-row-name` 内 flex，名字 ellipsis + 价格固定），添加按钮 flex 行尾对齐——**最终布局**：右对齐和 grid 独立列方案均被用户否决（grid auto 列宽顶歪按钮、右对齐贴按钮）；**关键坑：`catalog-name-text` 绝不能设 `flex:1`**（会把名字撑满剩余宽度、价格推到行右端远离名字——这就是前几轮"价格位置不对"的根因，务必保持名字自然宽度）；**掉率支持小数**（输入与滑块 step 0.01，0~1% 可 0.01 精度微调，min=0）——**「最低 1% 限制」是用户推翻的错误决策，勿恢复**。
- **继承事件开关（2026-08-13）**：掉落事件模式 checkbox「继承事件」，保存时在掉落命令最上方插入 `{id:'callEvent', params:{type:'inherited'}}`（引擎 `Command.compileInheritedCommandTuple()`），关闭移除，读取时自动识别恢复勾选；属性模式不显示。实例参考 `@1 通用英雄角色`（引擎 API 文档示例）。

## 3. 地图编辑器（tools/map-editor/）与地图数据

- **输出 JSON 格式（铁律）**：根节点为纯二维数组 10×10（无外壳）。每格：
  ```json
  { "name": "边境哨所", "icon": 3,
    "Passability": { "down": false, "right": true },
    "levelRange": { "min": 5, "max": 30 },
    "monsters": [ { "id": "d4bf5e107664f5c1", "lvMin": 5, "lvMax": 30, "weight": 1 } ] }
  ```
  - `Passability` 大写；**方向映射：旧 Excel 通行串第一位 → right，第二位 → down**（已核实 UI 事件 lineX/lineY）。
  - `icon`：`-1` 空地；`0` 与正整数合法；**真实工程有 100/101/102** 大值，不可截断。
  - 空格：`{name:"",icon:-1,Passability:{down:false,right:false},monsters:[]}`，无 levelRange 键。
  - 导出必须是 10×10；怪物 id 16 位 hex、`lvMin>=1`、`lvMax>=lvMin`、`weight>0`、同格不重复。
- **Excel 源**：`地图格.34eee41059f43f30.xlsx` 五张表（名称/等级区间/图标/通行状态/刷怪列表）；ExcelJS 会把格式残留撑到 200 行×12 列，只允许裁剪全空区域并警告；刷怪列表 `GUID,GUID` 或 `-`，weight 默认 1，等级取该格等级区间。
- **画布交互（近期修复）**：平移必须用 `canvas-world` 的 `transform: translate`（滚动条无法表达无溢出方向的平移——这就是「只能上下不能左右」的根因）；中键或空格+左键拖动、抓手光标、拖动后抑制点击、双击空白重置居中；滚轮缩放锚点按「指针下格子格内分数坐标」补偿（漂移 0.0px），指针不在格子上时退回网格整体锚点。
- 真实数据样例：边境哨所(0) `right:false,down:true`；芦苇平原(1) 3 怪物 5-30 权重 1；旧王城废墟(6) `right:true,down:false` 80-99；32 格有等级无怪物。
- 已部署游戏工程（新增可逆文件）：`地图JSON读取.指令.4a3b5fe613b04a77.ts`（fs/fetch 双环境、校验通过才 `Variable.set`）、`地图格数据.2c1c219af5b9e43a.json`（10×10，未登记 manifest）。

## 4. 工程自动同步（2026-08-13，三工具通用）

- 用户需求：游戏工程文件被外部修改后工具自动更新数据。**技术栈未更换**（GitHub Pages 只是静态托管，代码在本地浏览器执行；换前端框架对文件 I/O 与监听机制无收益）。
- 机制：优先 `FileSystemObserver`（Chrome 133+ 默认启用，`observe(rootHandle, {recursive:true})`，modified/appeared/disappeared/moved 即事件，500ms 防抖重扫）；不存在或 observe 失败时回退 5 秒元数据轮询（`getFile()` 读 `lastModified`+`size`，不读内容；页面隐藏时暂停）。`errored/unknown` 记录 → 重建 observer + 重扫。
- 各工具差异：character-editor 有 `pending.size` 草稿保护（有未保存修改跳过重扫并 toast；保存期间 `state.saving` 忽略全部事件，保存后刷新轮询快照基线）；idle-lab 重扫清 `results` 但保留玩家参数与 overrides；map-editor 重扫只更新工程资源不动 grid/历史，并新增 `#btn-rescan`「重新扫描」按钮（root 模式才显示）。fallback 导入模式（无目录句柄）不启动同步。
- 已知限制（代码内 ponytail 注释）：轮询按 mtime+size 判断，同值但内容变化检测不到；保存窗口期的外部变化被吞、下次变化自愈；FSO 观察整个工程根，游戏存档等无关事件也会触发重扫（低频可接受）。
- E2E（`.e2e-tmp/test-sync.js`，临时工程 `%TEMP%\yami-tools-sync-e2e`）：排序、三工具 fallback 导入、btn-rescan 隐藏、零 pageerror 已过。**root 模式自动同步无法自动化**（showDirectoryPicker 系统弹窗无法接管），需用户手工验证。

## 5. 快速本地化（tools/localization-lab/，v0.2.1 beta，2026-08-13 起）

- 功能（v0.2.1 用户定义的两个核心）：① 找**已经本地化且会在游戏界面出现的中文**——界面显示路径引用的条目，快速编辑译文与原文；② 快速找**还未本地化但会在游戏界面出现的中文**——界面显示路径的硬编码文本。辅助：缺翻译/孤儿引用/疑似占位/**数据属性（第六张卡：数据文件名称/描述独立 tab）**；导出七 sheet Excel（首表 open-yami 引擎格式 + 待本地化 + **数据属性** + 缺翻译 + 疑似占位 + 孤儿引用 + 说明）；翻译后导入写回；孤儿可一键按现有引用 ID 创建缺失条目。
- **只扫已引用资产（2026-08-13 用户拍板「打包算法就是只打包使用的资产」）**：`referencedFileIds` 复刻引擎打包算法（编辑器 `data-object.js createReferencedFileIDMap:334-387` + `deploy-project-window.js`）——① 全部资产内容（ui/scenes/actors/skills/triggers/items/equipments/states/events/animations/particles/tilesets）+ plugins/commands/config 里的**纯 16hex GUID 字符串值**；② **UI/场景预设元素映射**（事件的 `createElement presetId` 经 `uiPresets/scenePresets` 反查所在文件——漏了这层会把对话框等按预设引用的 UI 全判成未引用，这是关键坑）；③ 自动触发事件（type≠common）；④ 脚本 meta 自标记 + 代码内引号 GUID。默认过滤，工具栏「含未引用资产」可关（`rescanFromCache` 不重读文件）。缺翻译/疑似占位同步按「被已引用资产 `<ref:>` 引用 + 条目内嵌套闭包」过滤（`referencedLocalizationIds`；插件脚本实测无 `<ref:`）。真实基线（会随用户实时编辑漂移）：new-game 跳过未引用 92 → **界面候选 82 + 数据属性 43**/缺翻译 124/孤儿 16/疑似占位 1（shit）/已本地化 界面 42 + 属性 83；GAME-20240905 跳过 560 → **界面候选 121 + 数据属性 129**/缺翻译 3/孤儿 0/**疑似占位 0**/已本地化 界面 750 + 属性 746。**完工 ≠ 100% 本地化**：界面候选 121 里仍含运行时被脚本覆盖的模板（setText 目标已排除，其余覆盖方式无法静态识别）；数据属性 129 = 怪物/内部技能名、通用武器（开发者选择不本地化的内部资产）。
- **未本地化判定（三层信号，v0.2.1 准确算法版）**：**候选范围 = 界面显示路径**——扫 .ui 文本节点 `content` + 命令树 `content`（对话框）+ `properties[n].value`（setText 写界面）+ `operand.value` 显示模板；**数据属性 `attributes[].value` 永远扫描但独立成 `attributeCandidates`（数据属性 tab，不混进界面候选）**；**占位模板排除（准确算法核心）**：`collectSetTextTargets` 全工程收集 setText 命令的 `element.presetId`，被覆盖节点的编辑器内容是模板——不进候选，其 ref 也不计入已本地化（运行时显示的是写入值，已由 properties[n].value 扫描）。依据：引擎运行时只有「最终进入 UI.Text.content 的字符串」才走 `Local.replace`（项目 Script/ui.js content setter + local.js refRegexp，实测唯一调用点）。① 字段级白名单——`attributes[].value` 限 attribute.json `type==='string'` 属性（排除 loopList），命令树只收 `value/content/tag/operand` ∪ 本趟已见 `<ref:` 的 key（ref 先例），排除 `name`（.ui 编辑器标签，但作为孤儿建议来源）/`script`/**`comment`（开发者注释永不显示——完工工程 677 处注释是最大误报源）**/元数据；**位置规则**：`conditions` 数组整段跳过（条件比较=标识），`value` 只留 `operand.value`（setValue 字符串常量，按「含标签/含空格/剥标签后 ≥5 字」判显示模板，短单 token 物资/树/按下=标识跳过）与 `properties[n].value`（setText 文本），其余 params.value 是数据标识。依据：**引擎运行时只有「最终进入 UI.Text.content 的字符串」才走 `Local.replace`**（项目 Script/ui.js content setter + local.js refRegexp，实测唯一调用点）；② 字符串特征——含 CJK → high，无 CJK 残留**必须含 ≥2 字母单词**才 medium（HP/OK/Del/Attack 保留；`]x2`/`X10`/`x2`/`5x`/裸 `<italic>` 这类 ref 后缀与占位丢弃），GUID/纯数字/纯标签残留/8hex 与 #6hex 颜色码/路径/命令 tag 枚举排除（判定前剥**全部引擎标签** `<tag>`/`</tag>`/`<tag:参数>`）；③ 人工兜底——Excel 置信度列 + UI 勾选。
- **孤儿引用（v0.2.0 重做）**：`collectOrphanRefs` 全树扫描（不依赖文本字段白名单，任何字符串值里的 `<ref:ID>` 都检查，记录 attrKey→属性语义名/`.ui` 节点 name/refIndex/refCount），按 refId 分组；建议文本推导 = 名称属性 ref ← 文件名核心（剥 `序号.` 与 ` -后缀`，多文件取最短核心）+ .ui 节点编辑器标签；后缀 ref（同值第 2 个）与备注属性留空人工填。**修复用现有引用 ID 建条目（不要给孤儿分配随机新 ID）**。
- **疑似占位（v0.2.1 用户拍板重做）**：**只判占位脏词整值**（shit/fuck/xxx/test/todo/待翻译/未翻译/占位…）→「占位词」；「与原文相同」不再判定——完工工程 188 条 zh-TW + 40 条 ja 与 zh-CN 相同是开发者有意状态（该语言没翻译），不是占位符；空译文归缺翻译视图。完工工程疑似占位从 161 → 0。**已本地化按引用路径分档**：`refPathKind`——`.content`/`properties[n].value`/`operand.value` = 界面显示路径（已本地化视图）；`attributes[i].value` = 数据属性 tab；注释/条件/标签里的 ref 不计。
- **16 国语言扩展（引擎机制已核实，全链路零硬编码）**：语言列、缺翻译/疑似占位判定、导入写入全部由 `Data/config.json localization.languages` 驱动；加语言 = config 加一项 + 重导出。引擎别名（zh-HK→zh-TW）工具不处理。
- **合并策略（用户拍板）**：同文本同 ID——`normalizeText` 剥 color/local/global 标签后相等即合并为同一候选，翻译一次处处生效。
- 导入安全：导入前**强制重扫**并按位置校验当前值与导出时一致（不匹配=外部改动，**整个中止**）；`Lootsmith Backups/<时间戳>/` 备份；失败回滚；同 Excel 二次导入幂等。**忽略行**（处理方式=忽略/孤儿空建议/幂等已存在）预览单独明示。**新增条目按来源类型分「快速本地化」子文件夹**（物品/装备/技能/状态/事件/界面/触发器/角色/孤儿修复）。**open-yami 引擎格式 Excel（v0.2.1）**：导出首表（`openYamiRows` 复刻引擎 to-excel——列 ID|Name|各语言|parentID|isDir，子行在前、文件夹行在后、文件夹每次导出重新生成 16hex ID、叶子保留真实 ID）；导入识别到该表 → **整树替换**（`localizationFromOpenYami` 复刻引擎 from-excel——dataMap + parentID 挂载，未知 parentID 空名文件夹占位、文件夹行后到合并子级），预览按叶子 ID 统计新增/更新/移除与文件夹数变化，确认后备份 + `localization.list` 整体替换 + 增量刷新；**表格里没有的条目会被删除（引擎语义，勿改合并式）**。
- 复用模式：indexedDB `loot-smith-settings`/`last-project-handle` 工程记忆、fallback（webkitdirectory）只读导入（导入/孤儿修复/补译保存/备份面板均禁用）、watchPaths 5s 轮询（变化 toast 提示**不自动重扫**）。
- **界面编辑与备份（2026-08-13 用户要求）**：① 原文富文本解析（v0.2.1）——`renderRichText` 把标签显示成实际内容：`<color:RRGGBB[AA]>`/`<color:索引>`（config.indexedColors 调色板）彩色、`<global:ID>` → variables.json 变量名（`::` 加 @）、`<ref:ID>` → 引用条目中文（递归）、`<image:guid[,cx,cy,cw,ch]>` → `hydrateImages` 异步读图片文件 canvas 剪裁填 `<img>`（dataURL 缓存）、`<local:xxx>` → 变量名徽标；**候选行 ✎→startTextEdit textarea 显示源代码；已本地化/缺翻译/疑似占位/数据属性条目默认富文本展示、✎（richCell）切到源代码输入框、✓ 收尾**；编辑框都是多行可拖拽 textarea（fill-textarea / .edit-cell textarea，resize: vertical + 输入自动增高）（用户要求：展示要具体的，编辑要源代码）；hydrateImages 异步读图片文件填 <img>；数据属性 tab 由 renderAttributeRows（候选段 + 已本地化段）渲染；② 原文内联编辑——候选行 ✎ 按钮改原文，条目 zh-CN/导出用新文本，**导入替换校验仍按扫描原文**（`candidate.originalZhCN` 首次编辑锁定）；③ **单语言模式**——工具栏「译文语言」下拉（默认第一个非原文语言），缺翻译/疑似占位/候选的译文列只显示当前语言；候选视图的译文输入预填进 Excel 导出；④ **已本地化视图（第 5 张统计卡）**——**界面显示路径引用的条目**（new-game 42 条 / GAME-20240905 750 条；属性引用的条目在数据属性 tab，83/746 条），**中文原文与译文都直接可编辑**，「保存修改」备份后写回 localization.json（zh-CN 编辑=改游戏显示文本，用户明确要求）；**候选唯一 ID（2026-08-13 用户要求）**——候选原文下方显示 16hex ID（`state.candidateIdMap` 按 normalized 文本分配，会话内稳定、重扫不换，与引擎 GUID 同格式；Excel 导出共用同一 ID），缺翻译/疑似占位/已本地化的条目 ID 也显示在文本下方；**「本地化」按钮**——单条立即创建条目+替换文件（`localizeCandidateNow`，先校验后替换→备份→仿生写回，译文随界面输入一起写入）；**写回后增量刷新（2026-08-13 用户反馈「点本地化就重扫很蠢」）**——所有写回收尾走 `finishAfterWrite`：内存同步已写回内容（`applyInMemoryWrites`）+ 刷新被写文件监控戳（`refreshWatchStamps`）+ `rescanFromCache` 重算渲染，**零磁盘重读**；只有备份还原仍整工程重扫。测试教训：E2E 夹具改为**全自造确定性数据**（不复制真实工程——用户实时编辑 D:\new-game 会让硬编码基线漂移，且夹具 GUID 必须是合法 hex：`gggg...` 不是 hex！）；verify-real2 改**动态基线**（不硬编码数字，孤儿按建议动态挑选，条目按 ID 查找）；⑤ **备份与还原面板**——列出 `Lootsmith Backups/<时间戳>/`（文件名 = 路径 `/`→`__`），支持立即备份、还原（**还原前自动快照「还原前-<时间戳>」可反悔**）、删除；⑥ 扫描时屏幕最上方 3px 进度条（determinate 计数 / indeterminate 写回动画）。fill 只写非空值（不支持清空为「」）。**缺翻译/疑似占位视图中文原文可编辑（v0.2.1）**——zh-CN 列内联输入框（key `${id}::${primary}` 进 `fillDrafts`），保存修改时与译文一起备份写回；**Excel 导出 open-yami 表列定义必须带 `key`**（ExcelJS `addRow(对象)` 无 key 时行内容序列化丢失——排障实录：导出首表行数为 0，加 key 后与引擎一致）。
- E2E（`.e2e-tmp/test-localize.js`，**全自造确定性夹具**，不复制真实工程）：fallback 导入 → 扫描对账（界面候选 1/数据属性 2/缺翻译 1/孤儿 1/疑似占位 1（shit）/已本地化 界面 2 + 属性 1/未引用 2；夹具内置噪声路径（注释/条件/短标识/普通 value）与 **setText 占位节点（占位模板文本不进候选）**）→ 导出七 sheet 校验（待本地化/数据属性行数、ID 16hex、open-yami 表 4 行与表头）→ 颜色渲染/原文 ID/语言下拉/疑似占位视图/已本地化视图（只含界面引用条目）/数据属性 tab（治疗药剂+村里最好的剑）/「含未引用资产」切换/进度条元素断言 → 零 pageerror 已过。
- **双真实工程验收（`.e2e-tmp/verify-real2.js`，2026-08-13 用户授权，08-14 改动态基线）**：只读扫描 `D:\new-game`（跳过未引用 92 → 界面候选 82 + 数据属性 43/缺翻译 124/孤儿 16/疑似占位 1/已本地化 界面 42 + 属性 83，孤儿建议 兽人/黄金巨人骷髅/左右/上方/关闭 全对）+ `D:\GAME-20240905`（跳过 560 → 界面候选 121 + 数据属性 129/缺翻译 3/疑似占位 0/孤儿 0/已本地化 界面 750 + 属性 746）；写回链路在副本上以数据属性候选跑（物品/角色在其中）；`%TEMP%` 副本跑完整写回链路（孤儿修复按引用 ID 建条目 → 来源分文件夹 → 忽略行 → 幂等 → 写回格式仿生 → 重扫孤儿归零 → 备份恢复无残留），真实工程零写入。**基线是动态的：用户实时编辑工程会让数字漂移，脚本不硬编码数字、孤儿按建议动态挑选、条目按 ID 查找。**v0.1.0 真实工程验收修复的 3 个 bug（候选×文件分组校验、locateValue 不抛错、serializeLike 仿生）仍然有效勿回退。
- 已知限制：命令 tag 排除清单按当前工程噪声起步（英文误报由置信度列人工过滤）；孤儿建议是参考值需人工过目（后缀 ref/备注属性不推导）；脏词表按样本起步；**setText 之外的运行时覆盖方式（脚本直接写元素内容）仍可能漏判占位模板**——这是完工工程界面候选剩 121 而非 0 的原因；数据属性的内部资产名（怪物技能名/通用武器名）在数据属性 tab，不进界面候选。

## 6. 已知未完成 / 待用户确认

- **快速本地化 v0.2.1 beta 已改未提交、未推送、未部署**（`tools/localization-lab/` 四个文件 + `docs/HANDOFF-LOCALIZATION.md`/`MEMORY.md`/`README.md`/hub 卡片），等用户验收后按用户指示提交。
- **阶段 3（游戏侧，需用户拍板）**：改造 `读取excel.3739667372fedf5f.event` 统一入口（保持 GUID）→ 调 `地图JSON读取` 指令；路线 A 拆分五个旧全局变量；路线 B 刷怪算法按 weight/lvMin/lvMax。改前先备份事件文件，只能在用户 Yami 编辑器验证。
- **地图编辑器重做**：用户不满意，交他人接手 → 见 `HANDOFF-MAP-EDITOR.md`（16 项缺陷改进清单：图标色板 100 系列、错误定位、批量/撤销、拖放提示、视觉统一等）。
- 画布拖拽修复（2026-08-13，3 个文件 `tools/map-editor/{app.js,index.html,styles.css}` +60/-18）**已改未提交**；**角色编辑器版本已定 v0.7.2**（用户拍板，2026-08-13 更新 version.json），地图编辑器画布修复的版本号仍待用户定。
- `地图格数据` GUID 未登记 `Data/manifest.json`。
- Yami MCP 服务器当前不可用（`DANJUAN TOOLS/yami-mcp/server.js` 缺失，报 MODULE_NOT_FOUND）。

## 7. 验证方法（E2E）

- 临时环境：`mkdir .e2e-tmp && cd .e2e-tmp && npm install playwright-core exceljs`；真实数据复制：`D:\new-game\Data\{attribute,enumeration,localization,commands}.json`、`地图格.xlsx`。`.e2e-tmp/test-sync.js` 为排序/同步回归脚本：临时工程 `%TEMP%\yami-tools-sync-e2e`（真实 Data 四件套 + 伪造 manifest + 4 个 actor 带不同 mtime），覆盖排序六选项、持久化（reload 验证）、三工具 fallback 导入零报错。`.e2e-tmp/test-localize.js` 为快速本地化浏览器回归（fallback 扫描 + 导出六 sheet 校验，含 open-yami 引擎格式表）。`.e2e-tmp/verify-real.js` 为 v0.1.0 **真实工程验收脚本**（直接对 D:\new-game 扫描→导入→写回→备份恢复无残留）；`.e2e-tmp/verify-real2.js` 为 v0.2.0 验收脚本（**只读**扫描 D:\new-game 与 D:\GAME-20240905 两个真实工程 + `%TEMP%` 副本跑完整写回链路，真实工程零写入）——用户已授权用两个真实工程验证。
- Chrome：`C:/Program Files/Google/Chrome/Application/chrome.exe`（headless）；服务器：`python -m http.server 4173`。
- 关键断言信号：导入完成用 `#status-source` 文本（`btn-download` 初始即启用，不可作完成信号）。
- 静态检查：`node --check <file>`、`git diff --check`（delivery 模式禁止 `node -e`/`python -c` 内联脚本）。

## 8. 关键文档

- `HANDOFF.md`（角色编辑器交接）、`HANDOFF-MAP-EDITOR.md`（地图编辑器专项交接）、`HANDOFF-LOCALIZATION.md`（快速本地化专项交接，2026-08-13 新建、08-14 更新至 v0.2.1，含双真实工程验收记录）
- `CHARACTER_ATTRIBUTE_EDITOR_PLAN.md`（人物属性模式方案）
- `小工具合集与地图编辑器方案.txt`（v2：合集+地图编辑器完整方案，含 JSON Schema 第四章）
- `小工具合集与地图Excel导出方案.txt`（v1 旧版）


## 9. Electron 性能分析台（tools/perf-lab/，v0.3.0）

- 2026-08-22 用户否决浏览器模拟口径：浏览器沙箱、iframe、Service Worker、角色克隆压测和自研运行时探针全部删除，不再给“真机性能”结论。
- 当前定位：只分析真实 Electron 游戏正常游玩时由成熟工具采集的离线报告；网页不运行游戏、不读写工程。
- CPU/GC/长帧采集：Electron 内置 Chromium DevTools Performance，导入 trace JSON；解析主线程长任务、帧间隔 P95、GC 和 `ProfileChunk` CPU 热点。
- WebGL 采集：上游 [BabylonJS/Spector.js](https://github.com/BabylonJS/Spector.js) 原版扩展（MIT），导入 capture JSON；解析 Draw Call、GL 命令、冗余状态、帧资源内存和 WebGL 上下文。
- 核心文件：`analyzer-core.js`（Node/浏览器共用纯函数）、`app.js`（导入/渲染/基线/导出）、`self-check.js`（双格式最小回归）。
- 验证：自造 DevTools trace + Spector.js 上游 `test/integration/fixtures/captured-frame.json` 均通过；浏览器实际导入后总览、CPU、WebGL 和基线视图正常。
- 交接文档：`docs/HANDOFF-PERF-LAB.md`。


- 主页卡片顺序（用户 2026-08-21 明确）：性能测试台卡片放**最后一个**（存档台之后）；`index.html` 的 `order` 数组同步为 `...,'save-lab','perf-lab'`，不要移回中间。
