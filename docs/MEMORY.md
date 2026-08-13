# Yami Tools 项目记忆（MEMORY）

> 本文档沉淀历次对话的关键事实、用户偏好、技术决策与待办，供后续会话快速恢复上下文。
> 最后更新：2026-08-13（角色编辑器：搜索修复 + 价格/总价值/掉率小数 + 继承事件开关，多轮反馈定型）

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
| 结构 | `index.html`（工具合集主页）+ `assets/hub.css` + `vendor/exceljs.min.js` + `tools/character-editor/`（角色编辑器）+ `tools/map-editor/`（地图编辑器）+ `tools/idle-lab/`（挂机验证台）+ `tools/localization-lab/`（快速本地化） |

版本历史：v0.3.x（早期掉落编辑器）→ v0.4.1 → v0.5.1（继承/折叠/高亮等）→ v0.6.0（工具合集拆分+地图编辑器首版）→ v0.7.0（发布：主页新设计+合集+地图编辑器+方案文档）→ **v0.7.1（角色编辑器：排序自定义下拉 + 三工具工程自动同步，2026-08-13）** → **v0.1.0（快速本地化：第四工具，2026-08-13 新建）**。角色编辑器已升 **v0.7.2**（用户自行更新 version.json，2026-08-13）。**改 JS/CSS 必须同步更新各 `index.html` 里的 `?v=` 缓存参数**（否则 GitHub Pages/浏览器不刷新）。

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

## 5. 快速本地化（tools/localization-lab/，v0.1.0，2026-08-13 新建）

- 功能：扫描工程**未本地化硬编码中文/英文**（资产 `attributes[].value` 与事件命令树里没包 `<ref:ID>` 的文本）、**缺翻译条目**（config 语言列表中任一语言为空）、**孤儿引用**（ref 指向不存在的 ID，真实工程现存 5 个）；导出多语言 Excel 供翻译（「待本地化/缺翻译/孤儿引用/说明」四 sheet，导出时预分配 16hex ID）；翻译后导入写回：新增条目进 localization.json 根级「快速本地化」文件夹 + 资产原文替换为 `<ref:ID>`（full 整值替换/segment 只替换命中段，保留 `<color:>`/`<local:>` 标签）。
- **未本地化判定（三层信号）**：① 字段级白名单——`attributes[].value` 限 attribute.json `type==='string'` 属性（排除 loopList），命令树只收 `value/content/comment/tag/operand` ∪ 本趟已见 `<ref:` 的 key（ref 先例），排除 `name`（.ui 编辑器标签 596 处）/`script`/元数据；② 字符串特征——含 CJK → high 置信，纯英文 → medium（GUID/纯数字/`<local:>` 纯变量/路径/命令 tag 枚举排除）；③ 人工兜底——Excel 置信度列 + UI 勾选。
- **16 国语言扩展（引擎机制已核实，全链路零硬编码）**：语言列、缺翻译判定、导入写入全部由 `Data/config.json localization.languages`（对象数组 `{name,font,scale}`）驱动；加语言 = config 加一项 + 重导出，工具与引擎（`local.ts` contents 任意键 map）均零改动。引擎别名（zh-HK→zh-TW）工具不处理。
- **合并策略（用户拍板）**：同文本同 ID——`normalizeText` 剥 color/local/global 标签后相等即合并为同一候选，翻译一次处处生效，locations 记录全部出现位置。
- 导入安全：导入前**强制重扫**并按位置校验当前值与导出时一致（不匹配=外部改动，**整个中止**）；`Lootsmith Backups/<时间戳>/` 备份 localization.json + 全部待写资产文件；失败回滚；同 Excel 二次导入幂等（ID 已存在且原文一致跳过）。
- 复用模式：indexedDB `loot-smith-settings`/`last-project-handle` 工程记忆、fallback（webkitdirectory）只读导入、watchPaths 5s 轮询（变化 toast 提示**不自动重扫**，手动点「重新扫描」）。
- E2E（`.e2e-tmp/test-localize.js`）：fallback 导入 → 扫描（缺翻译 187 与独立计算一致、候选含「治疗药剂」）→ 导出 xlsx 校验（待本地化行数=候选数、ID 16hex、缺翻译行数、零 pageerror）已过。
- **真实工程验收（`.e2e-tmp/verify-real.js`，2026-08-13 用户授权用 D:\new-game 实测）**：真实扫描 268 文件 → 674 候选（高 377/中 297、1125 处）、缺翻译 187、孤儿 5（全部在设置界面.ui）与探索基线吻合；构造 3 新增+3 补译 → 备份 → **真实写回生效** → 回读校验 → 备份恢复无残留。修复了真实数据暴露的 3 个 bug：① 同文件多个相同文本必须先全部校验后统一替换（`applyAssetReplacement` 加 file 参数，DOM 按「候选×文件」分组调用）；② `locateValue` 路径不存在返回 undefined 不抛错；③ **Yami 原生序列化 = 2 空格缩进 + CRLF + 无尾随换行**（实测治疗药剂.item），写回用 `serializeLike(data, 原文本)` 仿生，避免编辑器大 diff。
- 已知限制（代码 ponytail 注释）：命令 tag 排除清单按当前工程噪声起步（英文误报由置信度列人工过滤）；孤儿引用只报告不自动修复；占位符（如 en="shit"）无法自动识别。

## 6. 已知未完成 / 待用户确认

- **阶段 3（游戏侧，需用户拍板）**：改造 `读取excel.3739667372fedf5f.event` 统一入口（保持 GUID）→ 调 `地图JSON读取` 指令；路线 A 拆分五个旧全局变量；路线 B 刷怪算法按 weight/lvMin/lvMax。改前先备份事件文件，只能在用户 Yami 编辑器验证。
- **地图编辑器重做**：用户不满意，交他人接手 → 见 `HANDOFF-MAP-EDITOR.md`（16 项缺陷改进清单：图标色板 100 系列、错误定位、批量/撤销、拖放提示、视觉统一等）。
- 画布拖拽修复（2026-08-13，3 个文件 `tools/map-editor/{app.js,index.html,styles.css}` +60/-18）**已改未提交**；**角色编辑器版本已定 v0.7.2**（用户拍板，2026-08-13 更新 version.json），地图编辑器画布修复的版本号仍待用户定。
- `地图格数据` GUID 未登记 `Data/manifest.json`。
- Yami MCP 服务器当前不可用（`DANJUAN TOOLS/yami-mcp/server.js` 缺失，报 MODULE_NOT_FOUND）。

## 7. 验证方法（E2E）

- 临时环境：`mkdir .e2e-tmp && cd .e2e-tmp && npm install playwright-core exceljs`；真实数据复制：`D:\new-game\Data\{attribute,enumeration,localization,commands}.json`、`地图格.xlsx`。`.e2e-tmp/test-sync.js` 为排序/同步回归脚本：临时工程 `%TEMP%\yami-tools-sync-e2e`（真实 Data 四件套 + 伪造 manifest + 4 个 actor 带不同 mtime），覆盖排序六选项、持久化（reload 验证）、三工具 fallback 导入零报错。`.e2e-tmp/test-localize.js` 为快速本地化浏览器回归（fallback 扫描 + 导出 xlsx 校验）。`.e2e-tmp/verify-real.js` 为**真实工程验收脚本**（直接对 D:\new-game 扫描→导入→写回→备份恢复无残留，会创建 Lootsmith Backups 目录测试后删除）——用户已授权用真实工程验收。
- Chrome：`C:/Program Files/Google/Chrome/Application/chrome.exe`（headless）；服务器：`python -m http.server 4173`。
- 关键断言信号：导入完成用 `#status-source` 文本（`btn-download` 初始即启用，不可作完成信号）。
- 静态检查：`node --check <file>`、`git diff --check`（delivery 模式禁止 `node -e`/`python -c` 内联脚本）。

## 8. 关键文档

- `HANDOFF.md`（角色编辑器交接）、`HANDOFF-MAP-EDITOR.md`（地图编辑器专项交接）、`HANDOFF-LOCALIZATION.md`（快速本地化专项交接，2026-08-13 新建，含真实工程验收记录）
- `CHARACTER_ATTRIBUTE_EDITOR_PLAN.md`（人物属性模式方案）
- `小工具合集与地图编辑器方案.txt`（v2：合集+地图编辑器完整方案，含 JSON Schema 第四章）
- `小工具合集与地图Excel导出方案.txt`（v1 旧版）
