# new-game 项目架构知识库

最后核验：2026-10-13
范围：当前 `D:/new-game` 源码与配置；不是所有引擎发行版的架构保证。
来源根：`G:` = `D:/new-game/`；`E:` = `D:/Documents/GitHub/2/`。
入口：`00-文档总索引（AI 阅读入口）.md`。每个 K 编号可独立检索。

## K101 工程身份、入口与配置
类型：FACT
验证：SOURCE
证据：`G:Data/config.json`；`G:index.html`；`G:tsconfig.json`；`E:package.json`

工程目录名是 `new-game`，当前窗口标题为 `My Project`，`gameId` 为 `749b8b6ff88ac94c`。不能由默认标题推出正式游戏名。项目使用 Yami 的 TypeScript 运行时；编辑器源码仓库的 package.json 标注 `yami-rpg-editor`，仓库地址为 `yami-pro/yami-rpg-editor`。

当前配置：`deployed:false`、`script.autoCompile:true`、画布 1920×1080、`sceneScale:3`、`uiScale:1`、语言 `zh-CN/en`、默认语言 `auto`、存档位置 `local`。默认场景为 `ac6c056e3a2df259`，坐标 `(8.5,11.5)`；它是配置默认值，不是引擎无条件自动进入场景的证据。

`index.html` 先载入 `Module/axios.min.js`、`Module/exceljs.min.js`，再按固定顺序加载 `Dist/Script/*.js`，最后 `main.js` 执行 `Game.initialize()`。插件编译产物通过运行时动态 `import()` 加载。TS 配置是带注释的 JSONC：`target/module:ESNext`、`rootDirs:["./Script","./Assets"]`、`outDir:"./Dist"`、`sourceMap:true`、`strict:true`。

玩法定位由 06 档案记录为挂机游戏；是否完成某玩法不是本条验证范围。不要把现有 RPG 素材、职业或历史 Demo 描述当作最终产品需求。

## K102 工程目录与所有权边界
类型：FACT
验证：SOURCE_AND_SCAN
证据：`G:index.html`；`G:tsconfig.json`；`G:.gitignore`；`G:Script/data.ts`；`G:Data/manifest.json`

```text
D:/new-game/
  game.yamirpg        编辑器工程与工作区状态
  index.html         运行入口
  tsconfig.json      脚本编译配置
  Script/*.ts        项目运行时框架拷贝及全局变量枚举
  Script/yami/       项目 API 类型声明
  Script/node.js/    第三方 Node 类型声明
  Script/electron/   第三方 Electron 类型声明
  Assets/            事件、场景、界面、角色、技能、素材与脚本
  Data/              全局配置、注册表、属性、枚举、本地化及资源清单
  Module/            已有 axios / exceljs 运行库
  Dist/              自动编译结果
  Save/              Electron 玩家存档，非可再生源码产物
  DANJUAN TOOLS/     文档、工具、归档与本知识库
```

`.gitignore` 忽略 `Dist/`、`Save/`、`Data/manifest.json`、`game.yamirpg` 等，不表示这些内容都可删除。已跟踪文件仍可能出现在 Git 变更中。manifest 可由匹配版本的编辑器扫描维护，但包含脚本参数等运行所需信息，不应当直接删后马上试玩。

JSON 数据与源码是修改入口；`Dist/` 是构建输出。`Script/yami.ts` 中的 `VAR` 是变量 ID 枚举，不是插件。引擎编辑器自身不在游戏根运行；其源码和项目运行时模板见 K201。

## K103 当前工程统计与扫描口径
类型：FACT
验证：SOURCE_AND_SCAN
证据：`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`；`G:Data/plugins.json`；`G:Data/manifest.json`；`G:Data/localization.json`；`G:Assets/UI/滚动条组件/垂直滚动条_脚本.04b2af9e637269cc.ts`

统计日期为 2026-10-13；不是未来版本的固定常量。行数按逻辑行统计，文件末尾换行不额外计空行，和旧文档统计口径可能不同。

| 范围 | 文件/条目数 | 逻辑行数 |
|---|---:|---:|
| `Script/*.ts`，包含 `yami.ts` | 24 | 46,803 |
| `Assets/插件/**/*.ts` | 66 | 13,050 |
| 插件目录外的 TS：垂直滚动条脚本 | 1 | 192 |
| 全部 `Assets/**/*.ts` | 67 | 13,242 |
| 框架 + 全部 Assets TS | 91 | 60,045 |
| 全部 `Assets/**/*.event` | 90 | 不作为代码行数统计 |
| 全部 `Assets/**/*.ui` | 16 | 同上 |
| 全部 `Assets/**/*.skill` | 77 | 不代表已完成功能数 |
| `Data/localization.json` 叶子 | 296 | 不代表已完成翻译数 |

插件目录分布：全局插件 19、自定义指令 34、场景对象脚本 11、界面元素脚本 2。**源码文件数不是启用插件数**：`Data/plugins.json` 当前登记 17 项，各项有自身 enabled；对象/UI 脚本在其载体挂载，不能从目录数推导生效数。

manifest 当前有 18 个数组资源分组，磁盘顶层另有 `guidMap/pathMap/changed` 字段，不能写成“顶层恰好 18 个键”。当前 `Assets/` 下 `.js` 文件为 0；这只是扫描结果，不是禁止所有项目使用原生 JS 脚本的引擎规范。

## K104 运行时模块职责与寻址
类型：FACT
验证：SOURCE
证据：`G:Script/main.ts`；`G:Script/util.ts`；`G:Script/data.ts`；`G:Script/command.ts`；`G:Script/event.ts`；`G:Script/actor.ts`；`G:Script/scene.ts`；`G:Script/ui.ts`

运行时使用同页面顶层词法绑定及类，不是统一的 `window.Yami` 命名空间。顶层 `let Data` 可在同一全局词法环境读取，不等于存在 `window.Data` 属性。不要把编辑器 ESM 导入方式照搬到游戏脚本。

| 文件 | 职责/主要符号 |
|---|---|
| `util.ts` | Stats、颜色、原型工具、更新/渲染列表、缓存 |
| `loader.ts` / `codec.ts` | Loader、资源路径/加载；图块/地形/阵营编码与属性差量 |
| `webgl.ts` / `filter.ts` | GL/WebGL、纹理/矩阵；离屏渲染和滤镜 |
| `audio.ts` / `printer.ts` | 音频四通道；文本打印和富文本 |
| `variable.ts` / `local.ts` | Variable/SelfVariable/Attribute/Enum；本地化 |
| `animation.ts` | AnimationPlayer、粒子 |
| `data.ts` | Data、加载/预编译、自研存档与 IDB |
| `stage.ts` / `camera.ts` | 舞台分辨率、缩放；摄像机/震动 |
| `scene.ts` | Scene/SceneContext、实体、分区、寻路、场景绘制 |
| `actor.ts` / `trigger.ts` | 队伍、角色、技能、状态、装备、背包；触发器 |
| `input.ts` / `ui.ts` | 输入、鼠标/手柄/虚拟轴；UI 元素树 |
| `time.ts` | Time、Timer、Easing |
| `event.ts` / `command.ts` | EventHandler/ScriptManager；指令编译执行 |
| `flow.ts` / `main.ts` | 脚本流程辅助；Game 启动、主循环、暂停/重置 |
| `yami.ts` | 生成的 VAR 枚举 |

查机制优先按符号搜索，位置表见 K216。行数只用于规模估计，不作为 API 契约。

## K105 脚本类别与框架补丁
类型：FACT
验证：SOURCE
证据：`G:Script/event.ts`；`G:Script/command.ts`；`G:Data/plugins.json`；`G:Data/commands.json`；`G:Assets/插件/全局插件/原框架函数迭代.0cd01cb93819c943.ts`；`G:Assets/UI/滚动条组件/垂直滚动条_脚本.04b2af9e637269cc.ts`

四类是项目组织方式，不是运行时根据目录名识别类型：全局插件在 `Data/plugins.json` 注册，以类名挂到 `PluginManager`；自定义指令在 `Data/commands.json` 注册，以脚本 GUID 查找实例并执行 `call()`；场景对象脚本和 UI 脚本挂在各自 `scripts[]`。

`原框架函数迭代.0cd01cb93819c943.ts` 当前已登记且 enabled=true，类名为 `FrameworkIteration`。源码在模块顶层立即执行 `applyPatches()`，另在 onStartup/onStart 调用并通过 static patched 避免重复。

它覆盖或包装：

- `Trigger.prototype.updateCollision`：角色 hittrigger 优先查 `registeredEvents` 再回退静态 events。
- `ActorCollider.handleCollisionBetweenTwoActors`：碰撞事件优先查动态注册。
- `ScenePartitionManager.prototype.get`：存在临时搜索中心时按分区中心距离排序。

最后一项是**分区排序**，不是所有目标角色按精确距离全排序。代码存在不等于试玩窗口中已生效，仍需确认 manifest、编译产物和运行实例。模块顶层补丁也意味着仅将该注册项设为 disabled 不一定阻止动态导入的副作用。

## K106 项目特有存档、地图与 Excel 链路
类型：FACT
验证：SOURCE
证据：`G:Script/codec.ts`；`G:Script/actor.ts`；`G:Script/data.ts`；`G:Assets/UI/地图/前往目的地.da147d10958b9c03.event`；`G:Assets/UI/地图/地图格.34eee41059f43f30.xlsx`；`G:Assets/UI/地图/地图格.a844f43cb6d37d6f.json`；`E:main/main.ts`

本游戏框架包含 `version:2` 的稀疏属性存档，区别于原生模板；具体差量范围、平台差异及失败边界见 K211-K213。不能简化成“所有游戏状态只存脏数据”或“工业级不会丢档”。

地图相关 Excel 和配套 JSON 的真实文件名带 GUID；`地图格.xlsx` 只是人类简称。`前往目的地` 事件包含路径队列处理、当前地图变量更新、依据 icon 分支加载场景，支撑选图/前往链路。地图等级和玩法决策先参考 06，再核对现行数据；不要由文件存在推导数据导入已成功或完整挂机验收已通过。

编辑器 `main/main.ts` 的 `to-excel/from-excel` 处理本地化表：sheet 名 `open-yami`，列为 `ID/Name/语言列/parentID/isDir`；叶子保留词条 ID，文件夹导出重新生成 ID，子行先于父文件夹行；导入通过节点表重组树。导入处理器返回新树，不是逐字段补丁；界面应用后可能覆盖原本未包含的词条，操作前备份。外部本地化工具“完全互导”的旧说法不在本次认证范围。

## K107 编译、运行与未认证环境
类型：LIMITATION
验证：SCOPED
证据：`G:tsconfig.json`；`G:index.html`；`G:Data/config.json`；`E:main/main.ts`；`E:Project/Script/data/project-settings-window.ts`

源码编辑器的 `Project.startTSC` 经 `start-tsc` IPC 启动平台对应的原生 `tsc` 可执行文件，参数为 `--watch`，cwd 为游戏工程。当前 tsconfig 指定输出到 Dist；编译问题先查看编辑器 TSC 日志。不能由 autoCompile=true 推断编译进程此刻正在运行。

Electron 试玩创建独立玩家窗口加载项目 index.html；浏览器运行需要能提供项目资源和动态模块的本地 HTTP 服务，不能保证双击 HTML 即运行。编辑器预览服务器服务 `.preview` 部署副本，和工程磁盘内容可能不同步。

本次只核验文档、源码与隔离探针，没有启动游戏、修改编译产物、测试完整战斗，也没有确认安装编辑器版本。安装版路径、Electron 版本、画面/音频/WebGL 支持和自动重载开关不可由当前源码包推导为实机现状。
