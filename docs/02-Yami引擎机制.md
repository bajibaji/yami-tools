# Yami 引擎机制知识库

最后核验：2026-10-13
范围：游戏当前框架、当前框架补丁，以及本机引擎源码仓库。安装版行为另行验证。
来源根：`G:` = `D:/new-game/`；`E:` = `D:/Documents/GitHub/2/`。
入口：`00-文档总索引（AI 阅读入口）.md`。源码是依据，本文件是摘要。

## K201 编辑器、模板、游戏运行时是三种来源
类型：FACT
验证：SOURCE
证据：`E:package.json`；`E:main/main.ts`；`E:Project/Script/main/initialize.ts`；`E:Project/Templates/arpg-ts-chinese/Script/data.ts`；`G:Script/data.ts`；`G:index.html`

| 层面 | 位置 | 责任 |
|---|---|---|
| 编辑器主进程 | `E:main/main.ts` | Electron 窗口、IPC、文件写入、预览、编译进程、Excel |
| 编辑器渲染进程 | `E:Project/Script/` | 资源、场景/UI/事件编辑、元数据解析与保存 |
| 中文运行时模板 | `E:Project/Templates/arpg-ts-chinese/Script/` | 新工程的模板版本，不一定等于已有游戏 |
| 本游戏运行时 | `G:Script/` + `G:Assets/` 插件 | 本游戏执行行为及自研扩展 |

当前源码仓库采用 Vite + Electron，package main 为 `dist-electron/main.js`；主窗口开发模式载入 Vite URL，生产模式载入构建页面。渲染初始化按 singleton 的 `dependsOn` 排序，随后发出 `editor_loaded`。这不能用旧安装目录 JS 行号或“编译产物与 TS 1:1”来替代版本核对。

编辑器源码使用 ESM import；运行时框架在 index.html 中作为普通 script 加载，插件作为动态模块导入。不要臆造 `Editor.util`、`Editor.data` 或统一 `window.Yami` API。需要某能力时先查实际导入和符号定义。

游戏框架已存在自研 v2 存档和项目补丁，不能默认与模板逻辑相同；被插件替换的函数应继续读插件执行链。

## K202 启动、数据加载与脚本路径映射
类型：FACT
验证：SOURCE
证据：`G:index.html`；`G:Script/main.ts`；`G:Script/data.ts`；`G:Script/loader.ts`；`G:tsconfig.json`；`G:Data/config.json`

当前启动链：

```text
index.html 依次载入模块库与 Dist/Script/*.js
  -> Game.initialize()
  -> 注册退出事件
  -> await Data.initialize()
       -> loadConfig
       -> loadTSConfig + loadSaveDirPath
       -> manifest + attribute/enumeration/localization/easings/teams/
          autotiles/variables/plugins/commands
       -> loadScripts + loadObjects + loadGlobalData
       -> createAutotileMap + createEasingMap
  -> 初始化 Command、EventManager、PluginManager 以及各子系统
  -> 装配 updaters/renderers
  -> Game.loop(0)
  -> await Printer.initialize()、await Loader.preload()
  -> Game.emit('ready')
  -> Command.custom.emit('autorun')
  -> EventManager.emit('startup')、EventManager.emit('autorun')
```

字体与预载是在 Game 主循环启动后 await 的，不在 Data.initialize 内；旧文档把这两个阶段放错了位置。Game 的启动函数不主动 `Scene.load`，起始场景由项目启动事件/指令负责；`config.startPosition` 是指令默认配置来源。

`Data.loadTSConfig` 从工程 tsconfig 文本提取 outDir；非部署模式 `remapScripts` 将 manifest 中 `.ts` 路径改为 `outDir + 原路径替换.js`，本工程即 `Dist/Assets/...js`，不是默认在源码旁生成 JS。随后从 `Dist/Script/data.js` 动态 `import('../../' + meta.path)`。

`module.default` 是函数时才注册为构造函数；加载阶段先赋 `constructor.guid=meta.guid`，实例创建阶段再锁定 GUID。`Data.scripts[guid]` 保存 constructor 与 parameters。loadScripts 遍历 manifest.script，不由插件 enabled 过滤动态导入，所以模块顶层代码可能先执行。

loadObjects 为资源附加 id/path 并预编译继承、属性、事件等；id/path 描述符设 `writable:true`，不能称为只读。运行期某些原始数据随后被初始化方法删除，例如 EventManager 初始化后删除 `Data.events`，变量与属性初始化后删除原始配置字段。

## K203 参数注入与脚本注册
类型：FACT
验证：SOURCE_AND_PROBE
证据：`G:Script/event.ts`；`G:Script/command.ts`；`G:Script/data.ts`；`G:Script/yami/yami.script.d.ts`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

`ScriptManager.create(owner, data)` 对 enabled=false 条目跳过实例化；为启用条目编译参数、`new constructor(owner)`、注入属性，再 `manager.add(instance)`。**constructor 运行早于元数据参数赋值**，不要在构造函数依赖 this.speed 等编辑器参数已就绪。

编译参数保存为 `[key,value,...]`。主要区别：

| 元数据类型 | 注入后的值 |
|---|---|
| number/string/boolean/option/数组 | 对应常量或经过默认值处理的值 |
| file / variable / easing / team / element-id | 字符串 ID，不是已加载资源对象 |
| attribute / enum | Attribute/Enum 查找结果 |
| attribute-key / enum-value | 实际属性 key / 枚举 value |
| actor/region/light/animation/particle/parallax/tilemap | 场景实体查询结果，可能 undefined |
| element | UI 实体查询结果，可能 undefined |
| variable-getter / actor-getter 等 | getter 求值后的变量值/实体，不是函数 |
| variable-setter | 合法时 `{get,set}` 访问器对象，非法时可能 undefined |
| position-getter | 求值后的 `{x,y}` 副本或 undefined |

自定义指令每次执行时求值并重新赋参数到共享脚本实例。插件/对象/UI 的函数型参数在注入时求值，deferredLoading 窗口期先排队，`loadDeferredParameters` 后才写入；在 `onScriptAdd` 或构造阶段可能尚未齐全。不是每一帧自动重新查询 getter。

`ScriptManager.add` 以实例类名在 manager 上登记，若有 `update()` 则加入宿主 updaters，并调 `onScriptAdd(parent)`；回调名是 `update`，不是 `onUpdate`。全局插件另外以类名挂 PluginManager，自定义指令以 GUID 入 Command.scriptMap；两者注册依据不是 TS 的 implements 泛型。

create 将 constructor.guid 和 instance.guid 设为 writable=false、configurable=false。源码探针验证 GUID 锁定；源代码应避免自己覆写 guid。类名冲突会覆盖同名访问入口，因此全局插件类名应保持唯一。

## K204 指令返回值、事件索引、异步挂起
类型：FACT
验证：SOURCE_AND_PROBE
证据：`G:Script/command.ts`；`G:Script/event.ts`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

自定义指令由 `compileScript` 包装成执行函数，实际表达式是：

```ts
return script.call(CurrentEvent) ?? true
```

因此 `call()` 返回 undefined 或 null 会继续；true 继续；false 中断当前执行循环。0/空字符串等非标准 falsy 值也会中断，但不要把它们当标准返回协议。直接 async call 返回 Promise，不会被事件执行器 await；Promise 为 truthy，下一条可能立即执行。

`EventHandler.update` 的关键循环：

```ts
while (CommandList[CommandIndex++]?.()) {}
```

**指令被调用前索引已经递增**。仅 return false 通常只是结束本次同步执行，后续 update 从下一条继续，不会自动重试同一条。需要重复当前指令时必须有显式索引/指令重设逻辑。旧文档“保留当前指针、下一帧重试”不是一般规律。

- `event.wait(ms)`：设 EventTimer，到期恢复从后续指令继续，返回 false。
- `event.pause()`：替换 update 为等待函数，需 `event.continue()` 恢复，返回 false。
- `event.finish()`：标记 complete，执行结束回调，后续更新按完成处理。
- `CurrentEvent` 是可变全局上下文，不是异步回调永久绑定的事件。异步启动时保存传入的 `event` 引用，在成功/失败/取消路径处理恢复，避免误唤醒另一个事件。

自定义指令实例会被不同事件复用，异步回调不应读取可能已被下次调用覆盖的 this 参数；在调用开始捕获必要值。不承诺引擎为每次 call 创建独立实例。

当前源码探针覆盖 return 值归一化、false 后索引前进和 pause/continue；探针不替代网络异常、销毁对象、场景切换等实机验证。

## K205 生命周期、全局事件与保存钩子
类型：FACT
验证：SOURCE_AND_PROBE
证据：`G:Script/event.ts`；`G:Script/data.ts`；`G:Script/yami/yami.script.d.ts`；`G:Script/yami/yami.event.d.ts`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

以 `ScriptManager.eventTypeMap` 为运行时回调字典：

| 事件类型 | 回调 |
|---|---|
| update / create / load / autorun | update / onCreate / onLoad / onStart |
| startup / createscene / loadscene | onStartup / onSceneCreate / onSceneLoad |
| collision / hittrigger / hitactor | onCollision / onHitTrigger / onHitActor |
| destroy / skillcast / skilladd / skillremove | onDestroy / onSkillCast / onSkillAdd / onSkillRemove |
| stateadd / stateremove / equipmentadd / equipmentremove | onStateAdd / onStateRemove / onEquipmentAdd / onEquipmentRemove |
| beforeload / beforesave / loadsave / preload | onBeforeLoad / onBeforeSave / onSaveLoad / onPreload |

鼠标、键盘、触摸、手柄、UI select/input/focus 等在同一 map 中；必须核对宿主是否发出该事件，map 中有名字不等于所有宿主都支持。

EventManager.typeMap 初始有 26 类全局事件，但 initialize 遇到未列出的 type 会建立数组，所以不是严格 26 项拒绝白名单。实际触发仍需要 emit/registerEvent/宿主链路；文件命名 `@0/@1/...` 是本项目组织方式，不是引擎按文件名前缀自动执行。

`beforesave/beforeload` 会将 argument.plugins 暂时包装成深层只读 Proxy；保存数据用传入的 `define(key,value)` 写进原容器 `plugins[constructor.guid][key]`。直接向 data.plugins 赋值/删除不可靠。读档从 data.plugins[guid] 读取，旧档缺项需兜底。

这两个钩子支持返回替换后的数据对象；当前 emit 对钩子异常会捕获并恢复前一 argument，不能把“没报错”解释成钩子成功。源码探针验证了 define 写入路径，不覆盖所有插件序列化类型。

## K206 时间缩放、跳帧钳制与暂停
类型：FACT
验证：SOURCE_AND_PROBE
证据：`G:Script/time.ts`；`G:Script/main.ts`；`G:Script/command.ts`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

Time.update 的顺序是先限制未缩放帧间隔，再乘 timeScale：

```ts
deltaTime = Math.min(deltaTime, this.tpf + 1, this.maxDeltaTime)
this.deltaTime = this.timeScale * deltaTime
this.rawDeltaTime = deltaTime
this.elapsed += this.deltaTime
this.playTime += deltaTime
```

maxDeltaTime 当前为 35ms，但不是缩放后的 deltaTime 上限。源码探针设置 timeScale=10、tpf=Infinity、输入 100ms，得到 rawDeltaTime=35、deltaTime=350。旧结论“最多 2x”“5x/10x 必须循环 Game.update”已废弃。

事件 `setGameSpeed` 调 `Time.setTimeScale`，支持 easing/duration 过渡；通常倍速先用此现成功能。高倍速导致大步长，仍需验证碰撞、触发次数、计时和 AI；不要把支持乘法缩放解释成任意倍率都稳定。

固定步长子步进可能是某些仿真需要的另一个设计，但不是当前项目必需实现，更不能只循环 Game.update 而忽略 Input、Timer/rawDeltaTime、elapsed/playTime、Callback 与异步队列。

Game.loop 每帧更新时间、更新、渲染、清理输入；Game.update 调完整 updaters。Game.pause 设置计数/paused，由子系统决定跳过哪些更新，并非停止 RAF、全部时钟和 UI。Timer 区分 scaled/raw，playTime 使用钳制后的未缩放时间，不是精确墙钟时长。

## K207 变量类型、属性键与 NaN
类型：FACT
验证：SOURCE_AND_PROBE
证据：`G:Script/variable.ts`；`G:Script/actor.ts`；`G:Script/yami.ts`；`G:Data/attribute.json`；`G:Data/plugins.json`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

Variable.groups：0 为普通存档变量，1 为跨存档共享变量，2 为临时变量。group 0 保存到槽位，group 1 到 global.save，group 2 不通过这两个变量存档入口保存。Variable.reset 默认重置 0 和 2。

`Variable.set(key,value)` 主要检查 `typeof value === typeof map[key]`；还有已存在的 object 变量与 undefined 之间切换的专门分支。不是“任何类型不一致都拒绝”的绝对规则。未知键不会因此自动变为合法变量定义。

数值变量写字符串会静默不修改；**NaN 的 typeof 是 number，会被接受**，Infinity 同理没有此处的有限数校验。外部输入与计算结果应在写入边界用 `Number.isFinite` 校验，否则 JSON 序列化会把 NaN/Infinity 转为 null，破坏数值恢复。

Actor 的战斗属性在 `actor.attributes`，原生 Actor 无独立 hp 业务字段。当前生命条配置引用 health 属性 ID `a5fd5e9f229abb2d`、maxHealth ID `a8451228fe0c120a`；调用前需用 Attribute.getKey 对照配置 ID 和运行时真实 key，不能认为所有属性 ID 永远就是字典 key。

全局变量按 ID 寻址，事件本地变量按字符串 key 在 CurrentEvent.attributes 存取；“事件里全局变量按名字引用”不正确。Script/yami.ts 的 VAR 提供名字到 ID 的枚举便利。

## K208 文本插值与本地化边界
类型：FACT
验证：SOURCE
证据：`G:Script/command.ts`；`G:Script/ui.ts`；`G:Script/local.ts`；`G:Script/printer.ts`

四层处理不能混为同一个标签系统：

| 层 | 输入 | 行为 |
|---|---|---|
| Command.compileTextContent | `<local:key>`、`<global:16hex>` | 求值时取事件局部值/全局变量，适用于调用此编译器的指令字段 |
| TextElement | `<global:16hex>`、`<global::16hex>` | 初始化文本可解析单冒号；双冒号建立 dynamic-var 更新器 |
| Local.replace | `<ref:16hex>` | 查当前语言词条；本地化词条内部单冒号 global 会编译为取值函数 |
| Printer | color/font/size/bold/image 等 | 排版与图形渲染，不直接替代上面三层 |

当前默认的 Local.replace 调用点在 TextElement 与 DialogBoxElement 的 content setter；普通属性、注释和任意 JSON value 不会自动本地化。脚本显式调用 Local.replace 是另一种使用方式，因此不能说任何非 UI 路径绝对不可能本地化。

双冒号动态全局文本**在引擎更新器中每次读取并比较变量**，无需用户另写轮询脚本，但不是订阅式零轮询。不要把单冒号静态替换说成自动跟踪变化，尤其不同赋值入口处理阶段不同。

切换语言调 updateAllTexts 遍历 UI 并尝试 updateTextContent；UI 存储的原始 `<ref:ID>` 可重新解析，事先在脚本中替换成纯文本的字符串不一定保留语言切换能力。Local.replace 本次只做一轮字符串 replace，不保证递归展开嵌套 ref，也不是任意语言 fallback 系统；缺词条时保留原标签。

## K209 富文本与 UI transform
类型：FACT
验证：SOURCE
证据：`G:Script/printer.ts`；`G:Script/yami/yami.ui.d.ts`；`G:Script/ui.ts`

Printer.regexps 当前有 19 个正则键，包含恢复标签，不等于 19 种独立业务类型。支持：

- `<color:0>` 到 `<color:15>` 调色板索引；`<color:RRGGBB>` 或 `<color:RRGGBBAA>` 字面十六进制颜色；`</color>` 恢复。
- `<font:字体>`、`<size:10..400>`、`<italic>`、`<bold>` 及其恢复标签。
- `<x:N>/<y:N>` 与 `<x:add,N>/<y:add,N>`，范围 -1000..1000。
- `<shadow:X,Y,RRGGBB[AA]>`：偏移 -9..9；`<stroke:宽度,RRGGBB[AA]>`：宽度 1..20；`<outline:RRGGBB[AA]>`，均有恢复标签。
- `<image:16hex[,x,y][,w,h][,显示宽,显示高]>` 按正则允许的成对参数解释；参数范围 0..10000。

不要添加 `#`、随意空格、单个宽高参数或非法 hex 并期待渲染器容错。标签适用范围是 Printer 解析的文本，不是任意编辑器输入框。

UI TransformData 是 **16 字段**：anchorX、anchorY、x、x2、y、y2、width、width2、height、height2、rotation、scaleX、scaleY、skewX、skewY、opacity。旧文档“15 字段”是计数错误。带 2 后缀的值是父尺寸相关系数，通常 0..1，但并非类型层硬性限定该区间。

节点 presetId 与资源文件 GUID 是不同 ID 域。新建节点应避免与其他预设重复，但运行时可多次实例化同一 UI，不能把 presetId 当作每个运行实例的永久唯一编号。by-id 寻址与作用域/参考节点需按实际 UI 树核查。

## K210 触发器事件与穿墙范围
类型：FACT
验证：SOURCE
证据：`G:Script/trigger.ts`；`G:Script/actor.ts`；`G:Script/event.ts`；`G:Assets/插件/全局插件/原框架函数迭代.0cd01cb93819c943.ts`；`G:Script/yami/yami.trigger.d.ts`

Trigger 承载投射物/区域判定，含位置、速度、duration、elapsed、hitCount、hitInterval、initialDelay、timeout 等；过滤受 selector、命中模式和墙壁配置控制。

命中角色时角色侧触发 `hittrigger/onHitTrigger`，触发器侧触发 `hitactor/onHitActor`。**hittrigger 是角色侧事件，不是“触发器被角色命中”事件**。上下文根据载体设置 triggerActor、triggerObject、casterActor、triggerSkill、targetActor；并不是每一事件都必有全部字段。

脚本包装 `ScriptTriggerHitEvent` 提供 actor、trigger、caster，和 EventHandler 上下文是不同对象。命中次数耗尽返回 false，由触发器更新流程决定销毁。当前项目补丁优先读取角色动态注册 hittrigger，见 K105；分析本游戏伤害链不能只读原生 trigger.ts。

`ActorCollider.handleSceneCollisions` 中 passage=-1 跳过地形碰撞，但在这个检查前已将坐标钳制到场景边界。角色间碰撞是独立分支；所以 passage=-1 不等于无视角色碰撞、场景边界、寻路和所有障碍的完整 NoClip。

## K211 v2 稀疏存档的确切范围
类型：FACT
验证：SOURCE_AND_PROBE
证据：`G:Script/codec.ts`；`G:Script/actor.ts`；`G:Script/data.ts`；`G:Script/yami/yami.data.d.ts`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

当前 saveGameData 经 enqueue 串行写，快照包括 playTime、actors、party、team、scene、camera、variables、selfVariables、plugins，并设 version=2。beforesave 之后先 JSON.stringify 游戏数据，再 await 元数据截图处理，减少跨帧快照变化。

稀疏化是属性层差量：Actor、SkillManager、StateManager、EquipmentManager、Inventory 等保存路径将属性与资源默认属性用 `Codec.diffAttributes` 比较；不是所有场景、队伍和插件字段都只保存脏值，也不是追踪脏标记才能存。

- 差量比较用 `Object.is`；相同默认值省略，变化值保存。
- 默认存在而运行时删除的 key，用 null 作为删除哨兵。
- `Codec.mergeAttributes` 从当前资源默认值构建完整表，应用差量，遇 null 删除。
- `Data.expandSaveData` 仅对 version===2 还原属性，再执行 beforeload 和各模块 loadData。
- 旧档不是 version 2 时不走这一展开逻辑；“旧档能读”仍需真正旧档回归。

**兼容边界**：默认模板升级会改变旧稀疏档中未保存的属性；真实 null 与删除哨兵冲突；undefined 和非 JSON 值会被序列化改写/丢弃；对象值是引用级比较，不是深比较。资源被删除/继承变化/语义迁移需要专门处理，不能宣称参数或属性追加永远无损。

源码探针验证相同值省略、变化值与删除后的往返；没有把全部技能/装备/场景存档完成度当作已通过。

## K212 Electron 与浏览器存档写读机制
类型：FACT
验证：SOURCE_AND_PROBE
证据：`G:Script/data.ts`；`G:Script/loader.ts`；`G:Data/config.json`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

Electron 使用 `Loader.routeSave('Save/...')` 定位；当前 save.location=local，以项目 __dirname 为基准。其它配置可能放系统目录，不应把所有环境都硬编码到 `G:Save/`。槽位编号通过 `padStart(2,'0')` 生成名字；编号输入与 UI 展示范围另行验证。

writeFileAtomic 当前步骤：

```text
写 file.tmp (UTF-8)
  -> open + handle.sync() + close
  -> 尝试 rename 现有 file 为 file.bak（异常被忽略）
  -> rename file.tmp 为 file
  -> rename 失败时尝试 unlink file 后再 rename
```

readSaveJSON 依次读取主档与 `.bak`，以 JSON.parse 成功作为本阶段成功条件；若两者失败则抛出。**回退不会重新写好主档，也不保证发出回退警告**。语法合法但结构错误的 JSON 不一定回退。loadSaveMeta 的读取路径不统一使用此回退函数，不能承诺元数据也自动自愈。

槽位保存先写 `.save`，成功后再写 `.meta`，不是二者事务。Electron 槽位写入链末尾 catch 只 console.warn，saveGameData Promise 可能在写入失败后仍 resolve；不能仅 await 后宣称落盘成功。global.save 写入错误处理与槽位并不完全相同。

浏览器走 IDB：数据库名 `yami-rpg:<gameId>`，store 为 game-data，键为 saveNN.save/saveNN.meta/global.save，当前写入值为 JSON 字符串，读取兼容字符串/对象。浏览器没有文件 `.tmp/.bak/fsync`。IDB.setItem 在单个 request success 时 resolve，不是两项联合事务提交的证明。

隔离临时目录的探针验证首次写入、二次备份、坏主档读取备份、主档不被修复以及主/备同时坏时抛错。不触碰玩家 Save。

## K213 存档安全声明与未验证边界
类型：LIMITATION
验证：SCOPED
证据：`G:Script/data.ts`；`G:Script/main.ts`；`G:Script/codec.ts`；`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`

当前实现有临时文件、sync、备份和串行写保护，不能据此称为所有失败情形下完全原子、绝不丢档：

- 备份 rename 所有异常被忽略，不只“首次保存不存在旧档”；权限/占用/磁盘错误仍可能发生。
- Windows 回退路径 unlink 后 rename 存在目标暂时缺失窗口；目录没有显式 sync。
- `.save` 与 `.meta`、global.save 是不同写操作，不构成跨文件事务。
- enqueue 串行化此 Data 实例的写入，不锁读档，也不锁另一个进程/试玩窗口。
- `Game.emit('quit')` 和窗口退出通知不是 await-save 协议，不能保证退出前异步存档写完。
- `.bak` 只做 JSON 解析回退，没有完整业务 schema、校验和或自动修复主档流程。

强制断电、磁盘写满、Windows 文件占用、跨进程、同时读写、关闭窗口、中断恢复和真实旧档兼容未在本次测试。后续涉及存档安全，先隔离备份和故障注入，再决定最小修复；本文不自动修改游戏实现。

## K214 渲染、音频与输入坐标
类型：FACT
验证：SOURCE
证据：`G:Script/main.ts`；`G:Script/filter.ts`；`G:Script/scene.ts`；`G:Script/audio.ts`；`G:Script/input.ts`；`G:Script/event.ts`

默认渲染链是 Camera → OffscreenStart → Scene → OffscreenEnd → UI。OffscreenStart 开启离屏缓冲；Scene 内部渲染 filters，ScreenTinter 在 Scene.filters 中执行；OffscreenEnd 主要将离屏结果复制到主画布；UI 最后绘制。不是 OffscreenEnd 才应用所有滤镜，也不是所有自定义滤镜永远不会影响 UI 的保证。

AudioManager 创建 bgm/bgs/cv 三个 SingleAudioPlayer（bgm/bgs 默认循环、cv 不循环）和 se 的 MultipleAudioPlayer；SE 衰减配置来自 soundAttenuation。游戏为 2D 场景，不能笼统称三维空间声学。浏览器自动播放限制可能暂停 AudioContext，源码注册用户输入后的 resume；源码支持不等于真机声音已测。

坐标转换使用原生已有方法：Mouse.convertClientToScreenCoords 考虑画布位置、比例和旋转；convertScreenToSceneCoords 根据 Camera.scrollLeft/Top、zoom、tileWidth/Height 得到图块坐标。两者返回复用的 sharedPoint，保留结果需复制或立即读取，不能把两个返回引用当独立对象长期缓存。

Controller 支持摇杆与按键状态，VirtualAxis 处理配置按键与斜向归一化；Input.bubbles.stop 影响本次事件传递。事件回调包装对象包括 ScriptKeyboardEvent、ScriptMouseEvent、ScriptWheelEvent、ScriptTouchEvent、ScriptGamepadEvent、ScriptInputEvent、ScriptCollisionEvent、ScriptTriggerHitEvent、ScriptRegionEvent；TouchPoint 是触摸点数据。参数字段请看实际包装类，不能用浏览器 event 字段替代全部脚本事件属性。

## K215 编辑器保存、预览与外部文件重载
类型：FACT
验证：SOURCE
证据：`E:main/main.ts`；`E:Project/Script/file/file-system-core.ts`；`E:Project/Script/file/directory-object.ts`；`E:Project/Script/file/folder-item.ts`；`E:Project/Script/file/file-item.ts`；`E:Project/Script/data/metadata.ts`；`E:Project/Script/module/autoreload.ts`；`E:Project/Script/module/settingconfig/schema.ts`；`E:Project/html/head.html`

File.save 调 Data.saveManifest，再处理 manifest.changes 待保存资源；主进程 write-file IPC 用 protectPromise 追踪其写操作。它不是所有运行时 Node fs 存档写入的统一追踪器。

Directory 传统路径在 focus 后更新目录、比较 mtime、更新 meta 和 script。已存在的普通数据经 Meta.redirect 不一定重读 JSON；“聚焦一次就读到全部外部修改”不成立。

**当前引擎源码已有 AutoReload 模块**，head.html/module-init 注册了它；配置 autoReload.enabled 默认 false，pollInterval 默认 5 秒、0 禁用轮询。开启时 watch Assets，300ms 防抖，轮询兜底，针对已有数据 meta 重新 File.get，替换对应 Data map，后处理 event/scene/ui 并刷新相关编辑器。

重载跳过 manifest.changes 中未保存资源及当前 Scene.meta；事件窗口 item.changed 时跳过窗口刷新，已有 meta、支持扩展名等限制仍在。不能把此机制描述为所有文件的无条件热更新，也不能说“引擎没有 fs.watch/轮询”。

本机安装版/当前开关未认证。没有确认重载生效时，外部修改前先处理编辑器未保存数据，改完关闭并重开项目；不要先保存旧内存覆盖新磁盘。脚本编译与数据重载是两条流程。

试玩窗口读取项目 index.html，Koa 预览读取 `.preview`；默认端口由 setting schema 给出 5959，但用户配置可变。更新预览需核对部署副本，不由“工程已保存”自动推断副本已同步。

## K216 指令、GUID、编码与源码索引
类型：FACT
验证：SOURCE_AND_SCAN
证据：`E:Project/commands.json`；`E:Project/Script/file/guid.ts`；`E:Project/Script/file/file-system-core.ts`；`E:Project/Script/plugin/plugin.ts`；`G:Script/command.ts`；`G:Script/codec.ts`；`G:Script/event.ts`；`G:Script/data.ts`；`G:Script/ui.ts`；`G:Script/time.ts`

当前 commands.json 有 153 个内置指令叶子：message 3、variable 8、flow 17、ui 21、object 6、audio 8、actor 40、skill 7、inventory 5、scene 15、network 7、system 16。内置 id 是方法名，自定义 id 是 GUID，`!` 前缀表示禁用。不是任意字符串都能正确编译；字段由对应编辑器表单与运行时方法决定。

GUID.generate64bit 组合两个 32 位随机 hex，并要求至少含 a-f；不是密码学安全 ID，唯一性仍靠清单冲突检查。资源约定名 `<名称>.<16位小写hex>.<扩展名>`，File.parseGUID/filterGUID 和运行时 Data.parseGUID 的正则各自不同。旧“所有纯数字 16 位键都变 V8 整数索引”的解释超出了源码可证范围，不采纳。

资源 JSON 中场景 terrains 和 tilemap code 使用 RLE 字符串；Codec 提供 encode/decodeTiles、encode/decodeTerrains、encode/decodeTeamData。修改应使用现有编解码并验证尺寸/往返，不手拼压缩串。

快速源码定位（行号仅为本次辅助，更新后以符号为准）：

| 主题 | 当前文件与符号 |
|---|---|
| 启动 | `G:Script/main.ts` Game.initialize / loop / start |
| 脚本导入/路径 | `G:Script/data.ts` loadScripts（591）/ remapScripts（621） |
| 自定义指令 | `G:Script/command.ts` compileScript（200） |
| 事件与参数 | `G:Script/event.ts` EventHandler.update（654）/ create（1200）/ compileParamList（1299） |
| 类型映射 | `G:Script/event.ts` eventTypeMap（1530） |
| 时间 | `G:Script/time.ts` Time.update（48） |
| 变量 | `G:Script/variable.ts` Variable.set（117） |
| 文本 | `G:Script/command.ts` compileTextContent（1569）；`G:Script/ui.ts` compileDynamicTextContent（2179） |
| 存档 | `G:Script/data.ts` writeFileAtomic（669）/ readSaveJSON（699）/ expandSaveData（807）/ saveGameData（931） |
| 元数据 | `E:Project/Script/plugin/plugin.ts` parseMeta（359）/ reconstruct（1250） |
| 编译器进程 | `E:main/main.ts` getTsgoExePath（552）/ startTSC（627） |

编辑器指令定义在 `E:Project/Script/module/command/<id>.ts`，运行时执行在 `G:Script/command.ts`；不能仅从表单支持推断游戏框架已经实现相同能力。
