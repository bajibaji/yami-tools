# Yami Tools 项目记忆（MEMORY）

> 本文档沉淀历次对话的关键事实、用户偏好、技术决策与待办，供后续会话快速恢复上下文。
> 最后更新：2026-08-13（画布拖拽修复后）

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
| 结构 | `index.html`（工具合集主页）+ `assets/hub.css` + `vendor/exceljs.min.js` + `tools/character-editor/`（角色编辑器）+ `tools/map-editor/`（地图编辑器） |

版本历史：v0.3.x（早期掉落编辑器）→ v0.4.1 → v0.5.1（继承/折叠/高亮等）→ v0.6.0（工具合集拆分+地图编辑器首版）→ v0.7.0（发布：主页新设计+合集+地图编辑器+方案文档）。**改 JS/CSS 必须同步更新各 `index.html` 里的 `?v=` 缓存参数**（否则 GitHub Pages/浏览器不刷新）。

## 2. 角色编辑器（tools/character-editor/）

- 扫描 Yami 工程 `.actor`/`.item`/`.equip`；选中角色编辑掉落物，写入两种存储：① `loopList` 字符串属性（GUID `4cb407bd71929620`）② 角色事件中的「掉落物品」插件指令（指令 `249c9c9d4de177c9`，事件类型 `c2ba6c4f90edd668`）。
- 保存流程：备份 → 写文件 → 失败回滚；角色列表已编辑浅蓝高亮（`.edited-role`），选中绿色（`.selected`），两者不同。
- 属性继承：角色文件 `inherit` 字段指向父角色 GUID；有效属性 = 本地 + 继承（seen 防环）。继承行只读，可「创建本地覆盖」。
- **掉落事件继承（用户拍板的行为）**：怪物自身无掉落事件时**不显示模板的掉落条目**，但显示「继承角色：XXX」加粗标识（说明编辑保存后会创建独立事件）；用户编辑掉落并保存 → 在 actor 本地创建**空掉落事件**（只含用户编辑的指令，不复制模板事件）。loopList（属性字符串）的继承显示保留。
- 人物属性模式：从 `Data/attribute.json` 解析 85 个角色属性（分组/类型/枚举），`enumeration.json` 解析枚举值；未知属性/未知枚举值只读保留；未知折叠区可展开。

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

## 4. 已知未完成 / 待用户确认

- **阶段 3（游戏侧，需用户拍板）**：改造 `读取excel.3739667372fedf5f.event` 统一入口（保持 GUID）→ 调 `地图JSON读取` 指令；路线 A 拆分五个旧全局变量；路线 B 刷怪算法按 weight/lvMin/lvMax。改前先备份事件文件，只能在用户 Yami 编辑器验证。
- **地图编辑器重做**：用户不满意，交他人接手 → 见 `HANDOFF-MAP-EDITOR.md`（16 项缺陷改进清单：图标色板 100 系列、错误定位、批量/撤销、拖放提示、视觉统一等）。
- 画布拖拽修复（2026-08-13，3 个文件 `tools/map-editor/{app.js,index.html,styles.css}` +60/-18）**已改未提交**；版本号待用户定（v0.7.1 或补丁）。
- `地图格数据` GUID 未登记 `Data/manifest.json`。
- Yami MCP 服务器当前不可用（`DANJUAN TOOLS/yami-mcp/server.js` 缺失，报 MODULE_NOT_FOUND）。

## 5. 验证方法（E2E）

- 临时环境：`mkdir .e2e-tmp && cd .e2e-tmp && npm install playwright-core`；真实数据复制：`D:\new-game\Data\{attribute,enumeration,localization,commands}.json`、`地图格.xlsx`。
- Chrome：`C:/Program Files/Google/Chrome/Application/chrome.exe`（headless）；服务器：`python -m http.server 4173`。
- 关键断言信号：导入完成用 `#status-source` 文本（`btn-download` 初始即启用，不可作完成信号）。
- 静态检查：`node --check <file>`、`git diff --check`（delivery 模式禁止 `node -e`/`python -c` 内联脚本）。

## 6. 关键文档

- `HANDOFF.md`（早期整体交接）、`HANDOFF-MAP-EDITOR.md`（地图编辑器专项交接）
- `CHARACTER_ATTRIBUTE_EDITOR_PLAN.md`（人物属性模式方案）
- `小工具合集与地图编辑器方案.txt`（v2：合集+地图编辑器完整方案，含 JSON Schema 第四章）
- `小工具合集与地图Excel导出方案.txt`（v1 旧版）
