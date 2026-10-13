# Yami 脚本与数据编写知识库

最后核验：2026-10-13
范围：当前元数据解析器、当前游戏运行时和项目写入约定。
来源根：`G:` = `D:/new-game/`；`E:` = `D:/Documents/GitHub/2/`。
入口：`00-文档总索引（AI 阅读入口）.md`。以现有功能复用为先，不新增不必要的依赖和抽象。

## K301 开发入口与注册依据
类型：FACT
验证：SOURCE
证据：`G:Script/yami/yami.script.d.ts`；`G:Script/event.ts`；`G:Script/command.ts`；`G:Data/plugins.json`；`G:Data/commands.json`

常见内容开发涉及两层：TS/JS 脚本及 @plugin 元数据，和资源 JSON/事件指令。它们不是整个引擎“有且只有两套规则”；配置、资产编码、编译与保存另有契约。

| 用途 | 挂载位置 | 调用依据 | 推荐 TS 形态 |
|---|---|---|---|
| 全局插件 | Data/plugins.json | 实例以类名挂 PluginManager | `implements Script<Plugin>` |
| 自定义指令 | Data/commands.json，事件 id 为脚本 GUID | Command.scriptMap[id].call(event) | `implements Script<Command>` |
| 场景对象脚本 | 对象/资源 scripts 数组 | 宿主生命周期 | `Script<Actor/Trigger/SceneLight/...>` |
| UI 脚本 | UI 节点 scripts 数组 | 元素生命周期 | `Script<ButtonElement/...>` |

`implements Script<T>` 只用于 TypeScript 校验，会被编译擦除；**泛型写错本身不会让编辑器自动改注册类型**。是否加载/调用由数据挂载、enabled、manifest、默认导出和方法决定。构造函数收到 owner，但参数字段还未注入；需在合适生命周期使用。

项目推荐目录为 Assets/插件 下四类目录，但已有滚动条脚本放在 Assets/UI，仍可加载。无需为符合目录描述而搬移它。

## K302 元数据块、标签作用域与语言键
类型：FACT
验证：SOURCE
证据：`E:Project/Script/plugin/plugin.ts`

parseMeta 使用 `/\/\*\s*@plugin\s[\s\S]+?(?=\*\/)/` 找首个匹配块，标签正则为 `@([a-z\-[\]]+)([\s\S]*?)(?=\s@|$)`。推荐将块放文件头方便维护；解析器实际搜索全文，不是硬性要求字符位置为 0。

每个标签使用独立行或空白隔开；参数 key 与 TS 实例属性名相同。参数用类型标签声明，如 @number speed、@string title，没有 @param 或 @name 处理器。未知标签可能被忽略，不会自动作为新参数。

alias/default/clamp/decimals/filter/cond/placeholder/suffix/prefix/readonly/hidden/validate 等针对当前参数或各自支持类型；desc 在尚无参数时可作插件描述。不能任意把修饰标签放在参数之前并期待正确作用。

`#key` 为语言键，@lang 块每行使用 `#key 内容`，支持 `@lang zh extends en` 等继承；缺键会暴露原始键名。引用键、选项别名和语言 pack 要同时维护。字符串 default 以引号包裹，color 是不带 # 的 8 位 RGBA hex，option 默认值必须来自选项集合。

## K303 当前支持标签与过滤白名单
类型：FACT
验证：SOURCE
证据：`E:Project/Script/plugin/plugin.ts`；`G:Script/event.ts`

以下是当前 parseMeta 的 processors，不承诺旧安装版支持同样扩展：

| 类别 | 标签 |
|---|---|
| 概述 | plugin、author、link、version、deprecated、require |
| 常量/值 | boolean、number、variable-number、string、number[]、string[]、keycode、color、option |
| ID/属性/枚举 | easing、team、variable、attribute、attribute-key、attribute-group、enum、enum-value、enum-group、file、element-id |
| 场景/UI 实体 | actor、region、light、animation、particle、parallax、tilemap、element |
| 访问器 | variable-getter、variable-setter、actor-getter、skill-getter、state-getter、equipment-getter、item-getter、element-getter、position-getter |
| 修饰/分组 | filter、clamp、decimals、placeholder、default、alias、desc、suffix、prefix、readonly、hidden、validate、cond、lang、group、group[] |

filter 白名单：

- file：actor/skill/trigger/item/equipment/state/event/scene/tileset/ui/animation/particle/image/audio/video/script/font/other，可空白分隔多个。
- attribute 或 attribute-key：actor/skill/state/item/equipment/element。
- enum 或 enum-value：shortcut-key/cooldown-key/equipment-slot/global-event/scene-event/actor-event/skill-event/state-event/equipment-event/item-event/region-event/light-event/animation-event/particle-event/parallax-event/tilemap-event/element-event。

group 为参数分组；group[] 会将已在指定组的参数转成 repeatable-group 列表。复杂分组改动要同时核对序列化与运行时支持，不能把编辑器控件存在当作任意嵌套 schema 可执行。

参数注入差异见 K203，特别是 file 仍为 ID 字符串，getter 已求值，setter 才是 get/set 对象。不要给 file 注入值套“实体对象”类型。

## K304 参数重构、默认值与兼容边界
类型：LIMITATION
验证：SCOPED
证据：`E:Project/Script/plugin/plugin.ts`；`G:Script/event.ts`；`G:Script/command.ts`；`G:Script/data.ts`

PluginManager.reconstruct 对脚本参数数量、键、类型和值校验；不匹配时用当前元数据重建 parameters，保留可接受值，非法值/缺项使用默认值。它运行于编辑器相关流程，不是对所有旧存档做完整业务迁移。

因此以下旧说法禁止使用：“增删参数绝对不破坏地图/事件/旧档”“改了标签引擎保证兼容”。更名 key、改变 option、默认值语义、类型或分组会改变旧数据含义；重构可能丢弃未知旧参数，读档字段迁移也不是 reconstruct 的职责。

新增参数应选稳定 key 和默认值，脚本使用处处理缺值和无效实体，存档钩子处理旧字段；有版本语义变化时做明确迁移与回归。输入数值同时校验有限性，字符串与 GUID 也需按使用边界检查。

## K305 最小脚本范例与历史案例风险
类型：FACT
验证：SOURCE
证据：`G:Script/yami/yami.script.d.ts`；`G:Script/yami/yami.data.d.ts`；`G:Script/command.ts`；`G:Assets/插件/自定义指令/获取角色id.bccb0adca29f826b.ts`；`G:Assets/插件/全局插件/伤害数字/伤害数字.ad08a4def6200207.ts`

以下范例只展示当前类型与接口，文件需另给不冲突 GUID 并正确注册，示例名不能作为已有 API 使用。

```ts
/* @plugin 输出文本
@string message
@default ""
*/
export default class LogText implements Script<Command> {
  message!: string
  call(): void {
    console.log(this.message)
  }
}
```

call 返回 void 是合法的，compileScript 会按 true 处理。需要挂起用传入事件 pause/wait，并捕获事件及参数值；不要直接 async call 并期待引擎等待 Promise。

```ts
/* @plugin 示例计分 */
export default class ScoreExample implements Script<Plugin> {
  score = 0
  onBeforeSave(_data: GameSaveData, define: PluginSaveDefine): void {
    define('score', this.score)
  }
  onBeforeLoad(data: GameSaveData): void {
    const guid = (this.constructor as typeof ScoreExample & { guid: string }).guid
    const value = data.plugins?.[guid]?.score
    this.score = typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
}
```

正确类型名是 GameSaveData 与 PluginSaveDefine，不是旧模板的未定义 SaveData。以上两段示例已用现有原生 TypeScript 编译器对当前 Script 源码/声明执行 --noEmit 类型检查并通过，不代表已注册或游戏内运行。示例不扩展全局插件类型映射；具体调用者自行按现有工程方式声明入口。

旧真实案例只作结构参考，不能无审查复制：获取角色id 指令的 caster 分支当前读取 CurrentEvent.triggerActor，而非 casterActor；若任务要求施法者 ID，应先验证并修复该实际功能，本次文档任务不修改它。当前伤害数字插件源码没有旧文档描述的 setDirection/onBeforeSave/onBeforeLoad 链路，所以不能继续称该历史功能为现行模板。

## K306 资源 JSON、ID 域与跨文件引用
类型：FACT
验证：SOURCE
证据：`E:Project/Script/file/folder-item.ts`；`E:Project/Script/file/file-item.ts`；`E:Project/Script/data/metadata.ts`；`G:Script/yami/yami.data.d.ts`；`G:Script/variable.ts`；`G:Script/ui.ts`

`.event/.scene/.ui/.actor/.skill/.trigger/.state/.item/.equip/.tile/.anim/.particle` 的磁盘内容是 UTF-8 JSON，场景压缩字段仍是 JSON 内的字符串，不是“整个文件不是 JSON”。不要用正则改整个 JSON，使用标准 JSON 解析/序列化，并仅修改目标字段。

文件 GUID 从 `<名称>.<16hex>.<扩展名>` 提取，编辑器对缺 GUID 的资源会生成并重命名。同 GUID 重复可能报冲突，不要靠删另一个文件消除提示而不查用途。

几种不同标识必须区分：资源 GUID、节点 presetId、运行实体 ID、全局变量 ID、事件本地字符串 key、属性定义 ID 与运行时属性 key、枚举 ID 与运行时 value。`attributes[].key` 在静态数据为属性定义 ID；Attribute.loadEntries 会映射到运行 key；枚举属性会映射成 enum value。

不是所有字符串字段都填 GUID，例如对象 class/name、local key、文本、option、运行属性 key 等。跨文件资源引用通常是 GUID，但 motion/easing/属性/枚举等也要查具体 schema，不能一律按资源文件 GUID 生成。

节点中的文件夹与实体字段不同，不是所有节点都带 presetId/enabled/events/scripts。新增时复制同 class 的当前模板，再保留必要字段；不要凭一份“通用节点字段”补齐所有类别。

## K307 事件、场景与 UI 的磁盘结构
类型：FACT
验证：SOURCE
证据：`G:Script/yami/yami.data.d.ts`；`G:Script/yami/yami.ui.d.ts`；`G:Script/yami/yami.scene.d.ts`；`G:Script/command.ts`；`G:Script/ui.ts`；`G:Assets/! 事件/@0 预加载事件.16c9ebfdbc16119c.event`；`G:Assets/UI/Boss生命条/Boss生命条.a8ebdfc3e5b314e4.ui`；`G:Assets/场景/世界.42bb866ffdc04284.scene`

独立 `.event` 顶层包含 type、enabled、priority、namespace、returnType、description、parameters、commands；和对象中的 `events:[{type,enabled,commands}]` 不同。脚本条目为 `{id,enabled,parameters}`，指令为 `{id,params}`，不要混用 parameters 与 params。

`.scene` 根包含 width/height、tileWidth/tileHeight、ambient、terrains、events、scripts、objects。objects 中有 folder/tilemap/actor/region/light/animation/particle/parallax 等。tilemap 的 tilesetMap、code 与几何尺寸必须一致，RLE 交给 Codec。场景对象未必使用 UI transform。

`.ui` 根为 `{width,height,nodes}`；实际元素类有 image/text/textbox/dialogbox/progressbar/button/animation/video/window/container；编辑器的 reference 节点会在预处理转为引用对象，不要把它直接当可 new 的普通元素类。UI 节点 transform 为 16 字段，详见 K209。

创建 UI 可用内置 `createElement` 的 append-all-to-root 与 uiId；删除使用 deleteElement 的 delete-element 与 element getter。具体 selector/operation 要参照当前 Command 方法，尤其重复实例、reference 与 by-ancestor-and-id 作用域，不能仅靠 presetId 假定选中了目标。

类型声明注有 `//+` 的 id/path/parent 等通常是加载后附加字段，`//*` 标记可能是预编译变换后的类型；不要将内存 HashMap 形态错误写回磁盘 events 数组。

## K308 角色、技能、触发器与素材结构
类型：FACT
验证：SOURCE
证据：`G:Script/yami/yami.actor.d.ts`；`G:Script/yami/yami.trigger.d.ts`；`G:Script/yami/yami.animation.d.ts`；`G:Script/yami/yami.data.d.ts`；`G:Script/data.ts`；`G:Script/actor.ts`；`G:Script/trigger.ts`

角色 `.actor` 含动画/运动、passage/speed、碰撞 shape/size/weight、inherit、attributes、skills/equipments/inventory、events/scripts 等。静态 inherit 指向父资源，预编译建立 parent 并合并对应字段。原型/继承不是任意字段自动深合并。

技能/状态/物品/装备根常见 icon、clip、inherit、attributes、events、scripts；冷却、耗蓝、被动等可能在 attributes 配置，不要臆造固定顶层 cooldown 字段。业务语义由事件和属性定义共同决定。

触发器关键配置是 selector、onHitWalls/onHitActors、hitCount、shape、speed、hitMode/hitInterval、initialDelay/effectiveTime/duration、inherit、animationId/motion、priority/offsetY/rotatable、events/scripts。shape 为 rectangle/circle/sector；具体字段查 TriggerShape。角色侧受击事件为 hittrigger，触发器侧命中事件为 hitactor。

图块 `.tile` 有 normal/auto 分型与宽高、tileWidth/Height、优先级、地形等字段；动画 `.anim` 根为 sprites/motions，图层有 joint/sprite/particle/sound。粒子 `.particle` 使用 layers。新增素材数据按当前真实同型文件复制，不把一个分型的字段套到另一分型。

## K309 指令编排与禁用规则
类型：FACT
验证：SOURCE
证据：`E:Project/commands.json`；`G:Script/command.ts`；`G:Script/yami/yami.command.d.ts`；`G:Script/yami/yami.data.d.ts`

事件指令基本形态：

```json
{"id":"wait","params":{"duration":100}}
```

这里 wait 的 duration=100 是毫秒；这是最小单条指令，不是完整 .event 文件模板。内置 id 是 showText/setNumber/callEvent/wait 等名字；自定义 id 是已注册脚本 GUID；`!callEvent` 等前缀禁用。

嵌套结构依具体指令：if/switch 的 branches、loop 的 commands、showChoices 的 choices 等各有 schema。常量和变量值有时可直接是 number/string，有时是 getter/operand 对象，**不是任何常量都包装 `{type:'constant',value}`**；必须读当前编译方法及编辑器定义。

局部变量访问 `{type:'local',key:'name'}` 与全局 `{type:'global',key:'16hex'}` 也不是每个指令字段通用支持的 schema。不能自行加不存在的 operation、条件 type、参数名；TS 声明与实际方法共同核对。

编辑器表单定义在 `E:Project/Script/module/command/<id>.ts`，运行时在 `G:Script/command.ts`。若给模型单独提供代码示例，必须同时给对应 API 和项目版本，避免将另一个引擎的指令 JSON 混入。

## K310 最小安全修改与验收约定
类型：POLICY
验证：POLICY_SOURCE
证据：`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/03-Yami引擎编写规则.md`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

1. 先追踪实际触发入口、调用者、注册表、源文件及补丁，确认已有能力是否足够。
2. 优先现有内置指令/插件/平台 API；不为描述中的两层分类增加新框架或依赖。
3. 仅改目标源码/JSON 字段，不改 Dist，不顺带清理未知用户文件。
4. 新 GUID 避免冲突；新参数稳定 key、合法默认值、正确运行时类型；信任边界校验输入。
5. 外部修改前处理编辑器未保存状态，修改后确认重读和编译，详见 K403。
6. 非平凡逻辑留一个可运行的最小检查，并在游戏里验证真正受影响路径；资料核验脚本不能替代游戏功能测试。
7. 存档/升级前独立备份真实玩家数据；涉及 Git 提交等待明确授权。

RLE 不手拼；需要改时复用 Codec 编解码并留往返检查，不使用旧“手改必坏”作为算法禁令。框架变更优先已有原框架函数迭代插件，但存档实现已在框架中，授权底层升级时必须先分析，不能因为一句“严禁改框架”而掩盖真实所有权。
