# Lootsmith 人物属性编辑模式实施方案

> 本文用于交给其他模型或开发者直接实施。  
> 只提供方案，不在本次任务中实现功能。  
> 目标仓库：`D:\Documents\GitHub\yami-tools`  
> 真实工程参考：`D:\new-game`

## 1. 需求目标

在现有 Lootsmith 掉落编辑器中增加一个独立的“人物属性编辑”模式：

1. 读取当前角色 `.actor` 文件中的 `attributes` 数组；
2. 根据 `Data/attribute.json` 的角色属性定义解析中文名称、语义键、类型、分组和枚举；
3. 把当前角色的本地属性和继承属性列出来；
4. 允许修改已有的本地人物属性；
5. 允许从“角色属性”定义中手动选择并添加新的本地属性；
6. 所有更改先进入草稿，只有点击现有保存按钮后才写回角色文件；
7. 保存必须继续使用现有的备份、外部修改检测和失败回滚机制。

## 2. 必须遵守的产品边界

### 2.1 默认仍是掉落编辑

- 页面启动、刷新、重新扫描工程后，必须默认显示现有掉落编辑器；
- 人物属性编辑器只能由用户主动点击“人物属性编辑”按钮后打开；
- 不要把人物属性模式保存在 `localStorage` 或 IndexedDB；
- 不要因为用户上一次打开过人物属性模式，就在下次自动进入；
- 用户从人物属性模式切回掉落模式时，未保存草稿要保留，不能丢失。

建议新增顶层状态：

```js
state.workspaceMode = 'drop' // 'drop' | 'actor-attributes'
```

注意：现有的 `state.storageMode` 已经表示掉落写入位置：

```js
state.storageMode = 'attribute' // 'attribute' | 'event'
```

**不要复用、重命名或混淆这两个状态。**

### 2.2 只编辑 `attributes`，不增加任意根字段

本需求中的“对象属性”特指角色文件中的：

```json
{
  "attributes": [
    { "key": "14be8e355e490991", "value": 10 }
  ]
}
```

MVP 不允许用户随意创建角色根对象字段，例如：

```json
{
  "任意新字段": "不允许"
}
```

“添加新属性”只能从 `Data/attribute.json` 的**角色属性分组**中选择已定义的属性。

### 2.3 文件中的属性键必须写定义 ID

`Data/attribute.json` 叶子示例：

```json
{
  "id": "14be8e355e490991",
  "key": "STR",
  "type": "number",
  "name": "力量",
  "enum": "",
  "note": ""
}
```

写回 `.actor` 时必须使用：

```json
{ "key": "14be8e355e490991", "value": 10 }
```

不能错误写成：

```json
{ "key": "STR", "value": 10 }
```

即：

- `definition.id`：写入 `attributes[].key` 的 16 位 GUID；
- `definition.key`：只用于界面显示、搜索和语义识别；
- `definition.name`：中文显示名称。

## 3. 已核实的真实工程结构

`D:\new-game\Data\attribute.json`：

```json
{
  "settings": {
    "actor": "4a9869f39acd85ed"
  },
  "keys": [
    {
      "class": "folder",
      "id": "4a9869f39acd85ed",
      "name": "角色属性",
      "children": []
    }
  ]
}
```

当前角色属性定义共 85 项：

| 类型 | 数量 |
| --- | ---: |
| `number` | 76 |
| `string` | 4 |
| `enum` | 3 |
| `boolean` | 2 |

角色属性定义叶子字段：

```ts
interface ActorAttributeDefinition {
  id: string
  key: string
  type: 'number' | 'string' | 'enum' | 'boolean'
  name: string
  enum: string
  note: string
  folderId: string
  folderPath: string[]
}
```

当前枚举属性包括：

- 职业：枚举组 `dc35e21ae8cbee5f`
- 状态：枚举组 `8b7080b7a502997f`
- 正在释放的技能快捷键：枚举组 `27b0dbea0d85631c`

枚举值写入的是枚举叶子的 `id`，不是 `value`。

示例：

```json
{
  "id": "9d8664dcb88c5e72",
  "value": "warrior",
  "name": "战士"
}
```

角色文件正确写法：

```json
{
  "key": "fe5c2daaadda1b45",
  "value": "9d8664dcb88c5e72"
}
```

真实工程存在枚举值已经不在当前枚举定义中的情况，例如部分怪物职业值为未知 ID。实现时必须显示并保留未知值，不能自动改成下拉框第一项。

## 4. UI 与交互方案

## 4.1 顶层模式入口

在角色编辑区域顶部增加顶层模式切换：

```text
[ 掉落编辑（默认） ] [ 人物属性编辑 ]
```

推荐 DOM：

```html
<div class="workspace-mode-switch" role="tablist">
  <button data-workspace-mode="drop" class="active">掉落编辑</button>
  <button data-workspace-mode="actor-attributes">人物属性编辑</button>
</div>
```

对应内容：

```html
<section id="drop-editor-view">现有掉落编辑器</section>
<section id="actor-attribute-editor-view" class="hidden">新增属性编辑器</section>
```

行为：

- 初始化固定 `workspaceMode='drop'`；
- 选中角色后仍默认展示掉落编辑；
- 用户必须主动点击人物属性按钮；
- 切换视图不能丢失任一模式的草稿；
- 没有选中角色时，人物属性按钮禁用或显示“请先选择角色”。

可选安全增强：本次会话第一次进入时显示一次简短提示：

```text
人物属性会影响战斗、AI 和存档兼容性。修改仅在保存时写回，并会先创建备份。
```

## 4.2 人物属性编辑器布局

建议包含：

1. 标题和来源摘要；
2. 搜索框；
3. 筛选：全部 / 本地 / 继承 / 已修改 / 未知；
4. 属性列表；
5. “添加人物属性”按钮；
6. 新增属性弹窗或侧边抽屉。

摘要示例：

```text
本地 22 · 继承 8 · 可添加 55 · 未知 1
```

列表行建议显示：

```text
力量
STR · 14be8e355e490991 · 角色属性 / 基础属性
[number] [本地]
[ 10 ]
```

继承属性示例：

```text
力量
STR · 14be8e355e490991
[number] [继承自 @2 通用怪物角色]
[ 10（只读） ] [创建本地覆盖]
```

## 4.3 分组和搜索

按照 `attribute.json` 的文件夹路径分组，例如：

```text
角色属性
角色属性 / 基础属性
角色属性 / 战斗属性
```

搜索应匹配：

- 中文名称 `name`；
- 语义键 `key`；
- 16 位属性 ID；
- 文件夹路径；
- `note`；
- 当前值。

属性数量只有约 85 项，不需要虚拟滚动，但列表必须有独立滚动区域。

## 4.4 类型化编辑控件

### number

```html
<input type="number" step="any" />
```

规则：

- 允许 0、负数和小数；
- 必须使用 `Number.isFinite()` 验证；
- 不能使用 `Number(value) || fallback`，因为会错误吞掉合法的 0；
- 空值、`NaN`、`Infinity` 不允许保存。

### boolean

使用复选框或显式开关，写回实际布尔值：

```json
true
```

不能写成字符串：

```json
"true"
```

### string

使用文本框或可自动扩展的 textarea，写回原始字符串。

如果值包含：

```text
<ref:0123456789abcdef>
```

应显示本地化预览，但不能自动把原始引用替换成中文文本。

### enum

使用下拉框，选项格式：

```text
战士 · warrior · 9d8664dcb88c5e72
```

写回值必须是枚举叶子 ID：

```text
9d8664dcb88c5e72
```

当前值不在枚举定义中时：

```text
未知枚举值 · f8adcc6157168c3f（保持原值）
```

不能静默替换成第一项。

## 4.5 添加属性

“添加人物属性”弹窗只显示：

- `attribute.json.settings.actor` 对应文件夹下的叶子；
- 当前角色本地尚未拥有的定义。

禁止自由输入任意属性 ID，MVP 不实现“自定义未知属性”。

新增流程：

1. 搜索并选择属性定义；
2. 显示类型、ID、语义键、说明和来源分组；
3. 输入初始值；
4. 验证类型；
5. 点击“添加到当前角色”；
6. 只加入草稿并将角色标记为未保存；
7. 新属性追加到 `attributes` 数组末尾。

默认值建议：

| 类型 | 新增默认值 |
| --- | --- |
| number | `0` |
| boolean | `false` |
| string | `""` |
| enum | 不预选，要求用户主动选择 |

如果属性已经继承但没有本地值：

- 按钮显示“创建本地覆盖”；
- 默认复制当前继承值；
- 写入当前角色的 `attributes`；
- 绝不修改父角色文件。

如果属性已经有本地值：

- 不允许重复添加；
- 在选择器中显示“当前角色已存在”；
- 引导用户回到现有属性行编辑。

## 4.6 删除属性

建议允许删除当前角色的本地属性，以便撤销误添加：

- 删除动作只修改草稿；
- 删除前显示属性名称和 ID；
- 继承属性不能直接删除父角色数据；
- 删除本地覆盖后，如果父角色有同名属性，应立即显示继承值；
- 未知本地属性也可删除，但必须二次确认。

## 5. 特殊属性保护

## 5.1 `loopList` 必须由掉落编辑器管理

掉落列表定义：

```text
id: 4cb407bd71929620
key: loopList
type: string
name: 掉落列表
```

人物属性编辑器中应：

- 显示该属性；
- 标记“由掉落编辑器管理”；
- 禁止直接修改、删除或手动添加；
- 提供“前往掉落编辑”按钮；
- 不允许通用字符串输入破坏其中的 JSON。

这是为了避免人物属性草稿和掉落草稿相互覆盖。

## 5.2 名称属性

名称属性可能包含本地化引用：

```text
<ref:2ebac16949e4e0f3><ref:6cfe04fd3afa191b>
```

可以允许编辑原始字符串，但必须：

- 同时显示中文预览；
- 明确提示修改原始引用可能影响本地化；
- 不自动生成或修改 `localization.json`。

## 6. 数据层设计

## 6.1 专用定义索引

不要只依赖现有 `walkDefinitions()` 的简化 `{key, name}` 数据。

新增：

```js
state.actorAttributeDefinitions = new Map()
state.actorAttributeTree = []
state.enumGroups = new Map()
```

推荐函数：

```js
parseActorAttributeDefinitions(attributeJson)
parseEnumerationGroups(enumerationJson)
flattenActorAttributeTree(nodes, folderPath, output)
```

`actorAttributeDefinitions` 的值至少包含：

```js
{
  id,
  key,
  type,
  name,
  enumId,
  note,
  folderPath,
}
```

`enumGroups`：

```js
Map<groupId, {
  id,
  name,
  items: Array<{ id, value, name, note, folderPath }>
}>
```

保留现有 `walkDefinitions()` 行为，避免破坏掉落属性识别。

## 6.2 每个角色的属性草稿

现有角色 store：

```js
role.stores.attribute // loopList 字符串掉落模式
role.stores.event     // 角色事件掉落模式
```

新增时不要叫 `attribute`，避免冲突。建议：

```js
role.stores.actorAttributes = {
  mode: 'actorAttributes',
  entries: [],
  originalEntries: [],
}
```

每条本地草稿应保留原对象：

```js
{
  key: '14be8e355e490991',
  value: 10,
  raw: { key: '14be8e355e490991', value: 10 },
  localIndex: 3,
}
```

原因：未来属性对象如果出现未知字段，保存时应保留，而不是重建成只有 `key/value`。

使用深拷贝：

```js
const cloneJson = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value))
```

不要在输入过程中直接修改 `role.data.attributes`。

## 6.3 继承解析

角色可以通过：

```json
{ "inherit": "父角色GUID" }
```

继承其他角色。

新增安全解析：

```js
resolveEffectiveActorAttributes(role, roleMap, seen = new Set())
```

要求：

- 当前角色本地值优先；
- 递归读取父角色；
- 使用 `seen` 防止循环继承；
- 每个有效属性记录 `sourceRole`、`inherited`、`depth`；
- 编辑继承属性时创建当前角色本地覆盖；
- 绝不直接修改父角色。

未知属性也要参与继承解析并保留。

## 6.4 未知属性

如果 `.actor` 中存在当前 `attribute.json` 找不到的 ID：

- 不能隐藏；
- 不能在保存时删除；
- 放入“未知属性”分组；
- 显示原始 ID 和原始值；
- 默认只读；
- 可以提供“高级原始值编辑”，但必须显式解锁并做 JSON 类型校验；
- 删除必须二次确认。

MVP 可以先只读和删除，不必实现任意 JSON 编辑。

## 7. 与现有保存系统集成

## 7.1 新增写入模式

现有：

```js
role.dirtyModes = new Set(['attribute', 'event'])
```

新增：

```js
role.dirtyModes.add('actorAttributes')
```

现有 `markDirty()` 可以继续使用，并让角色列表保持绿色高亮。

## 7.2 `updateRoleData()` 必须改成显式 switch

当前实现不能继续使用“不是 attribute 就当 event”的隐式分支。

正确结构：

```js
function updateRoleData(role, mode) {
  switch (mode) {
    case 'actorAttributes':
      updateActorAttributeStore(role)
      break
    case 'attribute':
      updateAttributeStore(role)
      break
    case 'event':
      updateEventStore(role)
      break
    default:
      throw new Error(`未知写入模式：${mode}`)
  }
}
```

## 7.3 必须固定保存顺序

人物属性和 `loopList` 都可能位于 `role.data.attributes` 数组。

如果添加、删除人物属性，`loopList` 在数组中的索引可能改变。若仍使用旧 `ownSlot.index`，可能把掉落字符串写进错误属性。

必须固定顺序：

```text
1. actorAttributes
2. attribute（loopList）
3. event
```

建议：

```js
const WRITE_MODE_ORDER = ['actorAttributes', 'attribute', 'event']
```

在 `writeRoleModes()` 中排序：

```js
const normalizedModes = WRITE_MODE_ORDER.filter(mode => dirtyModes.has(mode))
```

`updateActorAttributeStore()` 更新数组后必须重新查找掉落槽位：

```js
role.stores.attribute.ownSlot = findDropSlot(role.data)
```

如果掉落字符串也有未保存修改，随后执行 `updateAttributeStore()`，让最新掉落草稿最终覆盖旧值。

人物属性编辑器禁止编辑 `loopList`，但保存时仍要保留其原始对象和当前值。

## 7.4 更新备份草稿和回滚

现有 `createBackupBatch()` 的草稿快照只处理：

```js
attribute
event
```

必须加入：

```js
actorAttributes
```

示例：

```js
draftEntries: {
  attribute: ...,
  event: ...,
  actorAttributes: role.stores.actorAttributes.entries.map(cloneEntry),
  dirtyModes: [...role.dirtyModes],
}
```

`rollbackRoles()` 恢复原文件后，也要重新挂回三种草稿：

```js
for (const mode of ['attribute', 'event', 'actorAttributes']) {
  // 恢复用户未保存草稿
}
```

要求：

- 保存失败时原角色文件自动恢复；
- 用户的人物属性草稿仍保留为未保存状态；
- 角色绿色高亮仍存在；
- 回滚失败时提示备份目录。

## 7.5 `updateActorAttributeStore()`

推荐：

```js
function updateActorAttributeStore(role) {
  const store = role.stores.actorAttributes
  role.data.attributes = store.entries.map(entry => ({
    ...(entry.raw && typeof entry.raw === 'object' ? cloneJson(entry.raw) : {}),
    key: entry.key,
    value: cloneJson(entry.value),
  }))

  // 数组长度和索引可能改变，必须刷新掉落属性槽位。
  role.stores.attribute.ownSlot = findDropSlot(role.data)
}
```

但要确保：

- `loopList` 条目仍在 store 中且不可被通用编辑器删除；
- 未知属性完整保留；
- 原顺序不变；
- 新属性只追加到末尾；
- 已删除的本地属性不再写回。

## 8. 草稿与脏状态

编辑控件只修改：

```js
role.stores.actorAttributes.entries
```

任何真实变化后：

```js
markDirty(role, 'actorAttributes')
```

要求：

- 切换角色不丢草稿；
- 切换掉落/人物属性模式不丢草稿；
- 保存当前角色保存该角色所有 dirty modes；
- 保存全部处理所有 `state.pending` 角色；
- “取消单行编辑/恢复原值”在恢复后应重新计算是否仍脏；
- 如果人物属性完全恢复到原始状态，应从 `dirtyModes` 删除 `actorAttributes`；
- 角色是否还有其它掉落草稿要一起考虑，不能误清掉整个 pending。

推荐新增：

```js
syncRoleDirtyState(role, 'actorAttributes')
```

使用稳定深比较判断草稿是否与原始值一致。

## 9. 文件级实施步骤

## 9.1 `app.js`

1. 增加 `state.workspaceMode`；
2. 增加角色属性定义树、定义 Map 和枚举 Map；
3. 在 `readProjectMetadata()` 中解析角色属性定义和枚举；
4. 在 `initializeRoleStores()` 中增加 `actorAttributes` store；
5. 增加继承解析和有效属性视图；
6. 增加类型验证和类型化输入处理；
7. 增加属性新增、覆盖、删除、恢复操作；
8. 增加人物属性列表和选择器渲染；
9. 扩展 dirty modes、备份快照、回滚和保存；
10. 固定写入顺序并刷新 `loopList` 槽位；
11. 所有 DOM 查询仅作用于新增人物属性视图，不破坏拖拽掉落功能；
12. 增加错误边界，单个未知属性不能导致整个页面不可用。

## 9.2 `index.html`

1. 增加顶层“掉落编辑 / 人物属性编辑”切换；
2. 用容器包住现有掉落编辑区；
3. 新增隐藏的人物属性编辑视图；
4. 增加属性搜索、筛选、列表、统计和添加按钮；
5. 增加“添加人物属性”弹窗；
6. 保留现有拖拽掉落配置弹窗；
7. 修改后更新 `app.js` / `styles.css` 查询版本。

## 9.3 `styles.css`

1. 新增顶层模式切换样式；
2. 新增属性列表独立滚动；
3. 新增本地、继承、未知、已修改状态颜色；
4. 新增类型徽章；
5. 新增属性选择器和添加弹窗；
6. 响应式适配 1100px 和 720px；
7. 不改变现有无头像 `pointer-events: none` 修复；
8. 不覆盖现有拖拽、绿色角色高亮样式。

## 9.4 `README.md`

增加：

- 人物属性模式必须手动打开；
- 支持的四种类型；
- 继承属性只读及本地覆盖；
- 未知属性保留策略；
- `loopList` 受保护；
- 保存仍会备份；
- 修改角色属性可能影响旧存档。

## 10. 验证与测试方案

## 10.1 单元级测试

覆盖：

1. 从真实 `attribute.json` 解析到 85 个角色属性；
2. 类型统计为 number 76、string 4、enum 3、boolean 2；
3. 文件夹路径正确；
4. 枚举组正确解析；
5. 枚举写入叶子 ID，而不是 `value`；
6. 未知枚举值保持原值；
7. number 允许 0、负数和小数；
8. boolean 写实际布尔值；
9. 防止重复添加本地属性；
10. 未知属性序列化后不丢失；
11. 循环继承不会无限递归；
12. 子角色本地值覆盖父角色；
13. 删除本地覆盖后重新显示继承值。

## 10.2 浏览器测试工程

创建临时工程，不修改 `D:\new-game`：

```text
临时工程/
├── Data/
│   ├── attribute.json
│   ├── enumeration.json
│   ├── localization.json
│   └── commands.json
└── Assets/
    ├── 父角色.<GUID>.actor
    └── 子角色.<GUID>.actor
```

测试角色：

- 父角色含 number、string、boolean、enum；
- 子角色继承父角色，含自己的 number；
- 加一个未知属性；
- 加一个未知枚举 ID；
- 加 `loopList`。

浏览器断言：

1. 页面首次打开显示掉落编辑；
2. 必须手动点击人物属性模式；
3. 本地和继承属性来源正确；
4. 继承属性默认只读；
5. 创建本地覆盖不修改父角色；
6. 添加四种类型属性；
7. `loopList` 只读；
8. 未知属性仍显示；
9. 切换角色和模式后草稿仍在；
10. 角色列表显示绿色高亮；
11. 恢复全部更改后 dirty 状态正确；
12. 保存输出类型正确。

## 10.3 与现有功能的回归测试

必须重新验证：

- 无头像角色不会拦截点击；
- `004.精英哥布林 -远程` 可正常操作；
- `蘑菇人强化` 可正常操作；
- 属性字符串掉落不显示“已禁用”；
- 角色事件禁用开关仍有效；
- 物品和装备仍可拖入掉落列表；
- 拖入后仍弹出掉落配置；
- 装备固定数量为 1；
- 掉落概率百分比转换正确；
- 保存前备份、外部修改检测和回滚仍有效；
- GitHub Pages 强制加载新版本资源。

## 11. 验收标准

全部满足才算完成：

1. 默认始终为掉落编辑模式；
2. 用户主动点击后才显示人物属性编辑器；
3. 真实工程角色属性按中文名、语义键、ID、类型和分组展示；
4. 本地属性可按类型编辑；
5. 继承属性显示来源，不能直接修改父角色；
6. 可创建当前角色本地覆盖；
7. 可从 85 个角色属性定义中添加尚未存在的属性；
8. 不允许添加其它对象类型的属性；
9. number、boolean、string、enum 写回类型正确；
10. 未知属性和未知枚举值不丢失；
11. `loopList` 受保护且掉落编辑不受影响；
12. 切换角色和模式不丢草稿；
13. 保存前创建并验证备份；
14. 保存失败自动回滚且用户草稿保留；
15. 添加或编辑属性后角色显示半透明绿色高亮；
16. 页面无控制台错误；
17. `node --check app.js` 和 `git diff --check` 通过；
18. 修改静态资源后更新缓存版本参数。

## 12. 禁止事项

- 不要直接修改 `D:\new-game` 作为测试手段；
- 不要自动进入人物属性模式；
- 不要把 `workspaceMode` 和现有 `storageMode` 混为一谈；
- 不要把 `definition.key` 写入 `attributes[].key`；
- 不要把枚举的 `value` 写进角色，必须写枚举叶子 ID；
- 不要静默替换未知枚举值；
- 不要删除未知属性；
- 不要允许通用属性编辑器直接编辑 `loopList`；
- 不要修改父角色来编辑子角色继承值；
- 不要直接在输入过程中修改 `role.data`；
- 不要绕过备份和回滚；
- 不要因重建 `attributes` 数组而继续使用失效的 `loopList` 索引；
- 不要回退无头像点击修复和属性模式禁用修复；
- 未经用户要求不要自动提交、推送或部署。

## 13. 可直接交给实现模型的提示词

```text
你现在要在 D:\Documents\GitHub\yami-tools 的 Lootsmith 静态 Web 工具中实现“人物属性编辑”模式。

请完整阅读：
1. D:\Documents\GitHub\yami-tools\CHARACTER_ATTRIBUTE_EDITOR_PLAN.md
2. D:\Documents\GitHub\yami-tools\HANDOFF.md（如果存在）
3. D:\new-game\DANJUAN TOOLS\项目架构文档.md
4. D:\new-game\DANJUAN TOOLS\Yami引擎编写规则.md 中 .actor / attribute 相关章节

核心要求：
- 默认仍是掉落编辑；人物属性模式只能由用户手动打开，且不持久化为默认模式。
- 读取 Data/attribute.json 中 settings.actor 对应的角色属性树。
- 读取角色 data.attributes，按定义显示中文名、语义键、GUID、分组和类型。
- 支持 number/string/boolean/enum 类型化编辑。
- 枚举保存叶子 id，不保存 value；未知枚举值必须保留。
- 支持从角色属性定义中添加当前角色尚未拥有的属性。
- 支持继承属性展示和“创建本地覆盖”，绝不修改父角色。
- 未知属性必须显示和保留。
- loopList 只能由现有掉落编辑器管理，在人物属性编辑器中只读且不可删除/添加。
- 草稿不得直接修改 role.data，只有保存时写回。
- 新增 role.stores.actorAttributes 和 dirty mode actorAttributes。
- 扩展现有备份、回滚和保存逻辑。
- 保存顺序必须为 actorAttributes -> attribute(loopList) -> event；重建 attributes 后重新执行 findDropSlot，避免 loopList 索引错位。
- 保留现有无头像角色点击修复、属性字符串误禁用修复、拖拽掉落和绿色角色高亮。
- 使用临时工程做测试，不直接修改 D:\new-game。
- 跑 node --check app.js、git diff --check 和浏览器回归测试。
- 修改 app.js/styles.css 后更新 index.html 中的缓存版本参数。
- 用户未明确要求时不要提交、推送或部署。

先检查现有代码和仓库状态，再按方案分阶段实现。完成后报告变更文件、测试结果、已知风险和手工验收步骤。
```
