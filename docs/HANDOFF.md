# Lootsmith · Yami 掉落编辑器 Handoff

> 本文件只负责角色编辑器。地图编辑器的当前实现、真实数据验证和后续边界见 `HANDOFF-MAP-EDITOR.md`，生产力验收标准见 `MAP_EDITOR_PRODUCTIVITY_PLAN.md`。

> 最后整理：2026-08-13
> 代码仓库：`D:\Documents\GitHub\yami-tools`  
> 游戏工程：`D:\new-game`  
> GitHub Pages：<https://bajibaji.github.io/yami-tools/>  
> 本地开发地址：<http://127.0.0.1:4173/>

## 1. 当前状态

- 当前分支：`main`
- 当前基线提交：`588a264 更新UI`（工作区有未提交修改：自动同步 + 排序 + v0.7.1）
- 当前版本标识：`v0.7.1`
- `main` 与 `origin/main` 已同步。
- 创建本文件前工作区是干净的；`HANDOFF.md` 是本次新增的交接文件，尚未要求提交或推送。
- 最新功能已经包含：资源拖拽、掉落参数弹窗、已编辑角色绿色高亮。
- 用户明确表示会自己验证和上线，后续不要未经要求自动改动游戏工程或发布。

近期关键提交：

```text
caaf6cb Update index.html                         # 版本号更新为 v0.3.1
406d701 新增拖动                                  # 拖拽、配置弹窗、绿色高亮
75cf97a 修复属性掉落误显示已禁用                  # 属性模式禁用状态修复
1c095b9 强制刷新                                  # GitHub Pages 缓存兼容
37d0835 修复卡死                                  # 无头像角色拦截全页点击修复
```

## 2. 工具目标

纯静态 Web 工具，用于扫描 Yami RPG 工程中的：

- 角色：`.actor` / `.Actor`
- 物品：`.item`
- 装备：`.equip`

用户选中角色后，可以编辑该角色的掉落物，并选择写入：

1. 角色的 `loopList` 字符串属性；
2. 角色事件中的“掉落物品”插件指令。

只有点击保存后才写回文件；直接写回前必须创建并校验备份。

## 3. 核心文件

| 文件 | 职责 |
| --- | --- |
| `index.html` | 页面结构、掉落配置弹窗、资源版本查询参数 |
| `app.js` | 扫描、解析、渲染、拖拽、保存、备份和回滚逻辑 |
| `styles.css` | 工作台布局、滚动区域、图片预览、拖拽反馈、弹窗和角色高亮 |
| `README.md` | 面向使用者的功能说明与写入格式 |

当前静态资源缓存版本：

```html
<link rel="stylesheet" href="./styles.css?v=20260813-character-editor-8" />
<script src="./app.js?v=20260813-character-editor-8"></script>
```

以后修改线上 JS/CSS 时，应同步更新这个版本参数，避免 GitHub Pages 或浏览器继续使用旧资源。

## 4. 工程元数据

扫描工程时还会读取：

- `Data/attribute.json`
- `Data/localization.json`
- `Data/enumeration.json`
- `Data/commands.json`

用途：

- 从属性定义中解析语义键，如角色名称和 `loopList`；
- 把 `<ref:本地化ID>` 解析成中文；
- 动态寻找“掉落物品”事件类型；
- 动态寻找 `dropItem` 插件指令 ID。

当前工程中的关键 ID：

```js
DROP_ATTRIBUTE_ID = '4cb407bd71929620'
DROP_EVENT_TYPE   = 'c2ba6c4f90edd668'
DROP_COMMAND_ID   = '249c9c9d4de177c9'
```

代码会优先从工程的枚举和指令定义中重新发现事件类型、指令 ID，上述常量是回退值。

## 5. 掉落数据模型

### 5.1 属性字符串模式

写入 `loopList` 的 JSON 字符串示例：

```json
[
  {
    "type": "item",
    "id": "0123456789abcdef",
    "quantity": 1,
    "min": 1,
    "max": 3,
    "dropRate": 0.04
  },
  {
    "type": "equipment",
    "id": "fedcba9876543210",
    "quantity": 1,
    "min": 1,
    "max": 1,
    "dropRate": 1
  }
]
```

规则：

- 物品支持固定数量或 `min`～`max` 范围；
- 装备固定 `min=1`、`max=1`；
- 页面显示百分比，写入时转换为 0～1 的 `dropRate`；
- 属性字符串模式不支持、也不显示禁用状态；
- 序列化结果不写入 `disabled` 字段。

写入位置优先级：

1. 根对象的 `loopList`；
2. `attributes` 中键为 `4cb407bd71929620`、`loopList` 或语义键为 `loopList` 的属性；
3. 都不存在时，在 `attributes` 中新建 `{ key: DROP_ATTRIBUTE_ID, value: '' }`。

### 5.2 角色事件模式

事件类型为“掉落物品”，每条掉落对应一条插件指令。

启用：

```json
{
  "id": "249c9c9d4de177c9",
  "params": {
    "type": "item",
    "itemId": "0123456789abcdef",
    "equipmentId": "",
    "min": 1,
    "max": 3,
    "dropRate": 0.04
  }
}
```

禁用：

```json
{
  "id": "!249c9c9d4de177c9",
  "params": { "...": "配置保留" }
}
```

注意：

- 禁用开关只属于角色事件模式；
- 保存时只替换掉落插件指令，保留同一事件中的其他未知指令；
- 会保留未知参数和事件启用状态；
- 角色没有本地掉落事件但父角色有时，会复制父事件后在当前角色本地覆盖，不直接修改父角色。

## 6. 当前功能

### 6.1 扫描与展示

- 递归扫描角色、物品、装备；
- 角色、物品和装备都有搜索；
- 三个主要列表都有独立滚动区域；
- 显示本地化后的中文名称和资源 GUID；
- 按 `portrait` / `icon` 与 `clip` 绘制头像或图标；
- 缺失图片时显示安全兜底字符，不会挡住页面点击；
- 支持角色继承链中的头像和掉落来源。
- **角色列表排序**：`#role-sort-box` 是**自定义下拉**（原生 select 弹出层在用户环境为系统白底、`color-scheme` 不生效，CSS 管不到，不要改回原生 select）。分组「文件名 / 名称 / 修改时间」× 升/降共 6 项，默认「文件名 ↑」（`basename` localeCompare zh-CN numeric）。排序模式持久化在 localStorage `loot-smith-role-sort`，刷新后保持。修改时间来自扫描时 `getFile().lastModified`（挂在 entry.lastModified 上）。**创建日期排序做不了**：浏览器无文件创建时间 API，工程文件系统 birthtime 全是复制时间戳，actor/manifest 无时间字段。

### 6.2 掉落编辑

- 点击资源后使用右侧配置区插入；
- 物品支持固定数量、数量范围和掉落几率；
- 装备固定 1 件，仅设置掉落几率；
- 可以编辑和删除现有掉落；
- 角色事件模式可以逐条启用/禁用；
- 属性字符串和角色事件拥有独立草稿。

### 6.3 拖拽功能

资源库条目包含：

```html
draggable="true"
```

拖拽流程：

1. 从“掉落物品库”拖动物品或装备；
2. 拖到 `#drop-panel`；
3. 面板出现绿色投放提示；
4. 松手后打开 `#drop-composer-modal`；
5. 配置数量与掉落几率；
6. 点击“插入掉落物”后才加入草稿。

重要函数：

- `startResourceDrag`
- `finishResourceDrag`
- `bindDropTarget`
- `handleDropOnDropList`
- `openComposerModal`
- `closeComposerModal`

自定义拖拽 MIME：

```js
RESOURCE_DRAG_MIME = 'application/x-lootsmith-resource'
```

弹窗支持：

- 关闭按钮；
- 点击遮罩关闭；
- `Escape` 关闭；
- 关闭时不插入掉落物。

### 6.4 已编辑角色高亮

- `markDirty()` 会设置 `role.edited = true`；
- 角色行增加 `.edited-role`；
- 使用半透明绿色背景、绿色左侧标记和绿色状态点；
- 切换角色后，本轮会话中编辑过的角色仍保持高亮；
- 重新扫描工程时记录会随资源重建而重置；
- 未保存角色仍由 `state.pending` 和 `dirtyModes` 管理。

### 6.5 保存、安全与恢复

- 首次选择工程后保存目录句柄；
- 下次打开可自动加载或重新授权“上次工程”；
- 保存前检查角色文件是否被外部修改；
- 在工程根目录创建：

```text
Lootsmith Backups/<时间戳>/
```

- 每个待写入角色先备份成 `.bak` 并回读校验；
- 批量保存中途失败会自动回滚已经写入的角色；
- 备份失败、文件被外部修改或回读不一致时，不覆盖原角色文件；
- 不支持 File System Access API 时进入导入预览模式，保存只下载修改副本。

### 6.6 工程文件自动同步（2026-08-13）

三个工具统一机制（细节见 `MEMORY.md` §4）：

- 优先 `FileSystemObserver`（Chrome 133+）观察工程根目录，`modified/appeared/disappeared/moved` 事件 500ms 防抖后自动重扫；不可用时回退 5 秒元数据轮询（`lastModified`+`size`），页面隐藏时暂停。
- 本工具特有保护：`state.pending.size > 0`（有未保存草稿）时**跳过自动重扫**并 toast 提示，绝不丢用户编辑；保存期间 `state.saving` 忽略自身写入触发的事件，保存完成后刷新轮询快照基线。
- 相关函数：`startAutoSync` / `stopAutoSync` / `scheduledRescan` / `onFileChange` / `captureWatchSnapshot` / `pollWatchSnapshot`（`scanProject` 之后）。
- 已知限制见代码内 `ponytail:` 注释（mtime+size 同值检测不到内容变化；保存窗口期外部变化被吞、下次自愈）。
- fallback 导入模式（无目录句柄）不启动同步。

## 7. 已修复的重要 Bug

### 7.1 无头像角色导致全页无法点击

受影响角色示例：

- `004.精英哥布林 -远程`
- `蘑菇人强化`

根因：

- 缺图时直接输出 `.resource-preview-fallback`；
- 该元素使用 `position: absolute; inset: 0`；
- 缺少自己的定位容器时会覆盖整个主区域并拦截点击。

修复：

- 缺图也始终包在 `.resource-preview` 相对定位容器中；
- 预览、画布和 fallback 全部 `pointer-events: none`；
- CSS 兼容旧缓存的 `app.js`：裸 fallback 默认保持静态定位，只有被 `.resource-preview` 包裹时才绝对定位。

不要回退这些修改。

### 7.2 属性字符串条目全部显示“已禁用”

根因是：

```js
list.map(normalizeEntry)
```

`Array.prototype.map` 会传入 `(raw, index, 原数组)`，而 `normalizeEntry` 的第三个参数是 `disabled`。原数组为真值，导致属性模式所有条目都被判为禁用。

修复后必须保留：

```js
list.map((raw, index) => normalizeEntry(raw, index, false))
```

并且：

- `normalizeEntry` 的禁用状态只使用显式传入值；
- 渲染时只有事件模式读取 `entry.disabled`；
- 属性模式新增或编辑时强制 `disabled=false`。

不要重新改回直接传函数引用的写法。

### 7.3 GitHub Pages 仍运行旧版资源

GitHub Pages 返回过正确的新文件，但无版本号的 `index.html` 会让浏览器或 CDN 继续复用旧 JS/CSS。

处理方式：

- 给 `app.js` 和 `styles.css` 加查询版本；
- 每次发布影响行为或样式的修改时更新版本字符串；
- 验证线上 HTML 是否确实返回新的资源引用。

## 8. 验证记录

已执行：

```powershell
node --check app.js
git diff --check
```

结果通过。

另外使用 Playwright Core + 系统 Chrome，在 `%TEMP%\yami-tools-drag-e2e` 创建了临时测试工程并完成浏览器回归。临时测试不在仓库中。

已覆盖：

- 扫描一个角色、一个物品和一个装备；
- 把物品拖入掉落面板；
- 弹出配置窗口；
- 修改物品固定数量并插入；
- 切换装备列表；
- 把装备拖入并确认装备数量区隐藏、装备固定说明显示；
- 插入装备；
- 掉落列表产生两条记录；
- 当前角色出现绿色 `.edited-role` 高亮；
- 属性字符串模式没有出现“已禁用”；
- 页面没有 `pageerror`。

测试输出：

```text
drag-drop browser regression passed
item/equipment drag-drop and attribute-state regression passed
```

## 9. 用户手工验收建议

使用真实工程 `D:\new-game` 验证：

1. 打开无头像角色，确认页面仍可点击；
2. 属性字符串模式拖入物品，配置固定数量和范围；
3. 确认属性列表不显示“已禁用”；
4. 拖入装备，确认数量固定为 1；
5. 修改掉落几率，确认百分比与 `dropRate` 换算正确；
6. 切换角色，确认编辑过的角色显示半透明绿色；
7. 切换到角色事件模式，验证禁用开关；
8. 保存一个角色，确认先产生备份；
9. 批量保存，确认备份清单和回滚保护；
10. GitHub Pages 发布后强制刷新并检查资源版本。

## 10. 运行方式

在工具目录启动静态服务器：

```powershell
cd D:\Documents\GitHub\yami-tools
python -m http.server 4173
```

然后打开：

```text
http://127.0.0.1:4173/
```

Chrome / Edge 在 `localhost` 或 HTTPS 环境下可以使用 File System Access API。普通不支持目录写回的浏览器会回退到文件夹导入模式。

## 11. 边界与注意事项

- 不要为了测试直接修改 `D:\new-game` 中的角色文件；通过页面保存时必须保留备份流程。
- 不要删除 `Lootsmith Backups` 排除规则，否则备份可能被扫描成游戏资源。
- 不要让属性字符串模式继承事件模式的 `disabled` 状态。
- 不要把缺图 fallback 恢复为无容器的绝对定位元素。
- 拖入资源时只是打开配置窗口，不能在 `drop` 事件中直接写入草稿或文件。
- 保存按钮才可以修改原角色文件。
- 保持物品、装备、角色列表的独立滚动。
- 装备数量必须固定为 1。
- 角色排序是自定义下拉（`#role-sort-box` + `#role-sort-menu`），不要改回原生 `<select>`；排序模式持久化（`loot-smith-role-sort`）是用户明确要求的，不要删除。
- 角色事件更新时必须保留未知命令和未知参数。
- 后续若增加自动化测试，建议把当前临时 Playwright 场景迁入仓库的 `tests/`。

## 12. 下一步候选

当前没有已知阻塞项。后续可以按优先级考虑：

1. 让拖拽弹窗显示资源图标和目标角色名称；
2. 给拖拽增加键盘等价操作和更完整的焦点陷阱；
3. 为备份恢复增加网页内的历史备份浏览器；
4. 将浏览器回归测试正式纳入仓库；
5. 增加“仅显示已编辑角色”筛选；
6. 增加未保存更改离开页面提示。
