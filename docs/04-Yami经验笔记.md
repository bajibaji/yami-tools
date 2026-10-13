# Yami 安全开发与排错知识库

最后核验：2026-10-13
范围：现行源码可证的排查流程与项目约定；旧实战故事保留在原文备份，不冒充当前状态。
来源根：`G:` = `D:/new-game/`；`E:` = `D:/Documents/GitHub/2/`。
入口：`00-文档总索引（AI 阅读入口）.md`。先保护数据，再定位根因。

## K401 接手与修改流程
类型：POLICY
验证：POLICY_SOURCE
证据：`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/04-Yami经验笔记.md`；`G:.gitignore`；`G:Data/plugins.json`

先检查工作区状态和相关文件，保留用户已有改动。游戏工程、引擎源码、外部工具仓库有不同所有权，不因查到问题就跨仓库修改。

真实流程是输入/事件 → Command → 宿主/插件 → 属性/状态 → UI/存档等；搜目标函数全部调用者，再找共享根因。不要只修报告提到的某个调用者，也不要把“同类示例”直接当无错模板。

优先 Assets 内容与已有框架迭代插件；不得手改 Dist。需要框架升级或底层存档修复时先单独评估；引擎仓库当前约定只读，未明确授权不改。

玩家 Save 必须保护；忽略文件不等于无价值。禁止无依据删 Save、自动批量清理 Assets JS、直接重置用户工作区，或未获用户明确指令提交/推送。

验证和汇报要分清：源码检查、局部探针、编译、实际试玩、平台测试各自完成了什么；未运行不说已通过。

## K402 症状到根因的排错表
类型：FACT
验证：SOURCE
证据：`G:Script/command.ts`；`G:Script/event.ts`；`G:Script/time.ts`；`G:Script/variable.ts`；`G:Script/data.ts`；`E:Project/Script/plugin/plugin.ts`；`E:Project/Script/file/file-item.ts`

表中是可能原因和排查方向，不是见到症状就保证命中该原因：

| 症状 | 优先检查 | 处理方向 |
|---|---|---|
| GUID already exists | 所有同 GUID 资源、meta/version、源与产物位置 | 先定位冲突文件与引用，保留有用文件，见 K404 |
| 脚本修改没效果 | 改动是否在源、编译日志、Dist 时间/内容、manifest、试玩窗口 | 确认真正运行的编译产物，不只看 autoCompile |
| 参数面板空白 | @plugin 块、标签拼写、parseMeta、manifest parameters、版本 | 用当前支持标签，见 K302-K303 |
| xxx is not a function | getter/实体已求值，或错误 API | 注入值不调用；setter 才 get/set，见 K203 |
| 自定义指令不调用 | commands 注册、enabled、GUID、默认导出、call 方法 | 泛型不是运行时注册器，见 K301 |
| 指令挂起/后续提前执行 | 返回 false 与索引、pause/wait、直接 async call | 按 K204 保留 event 引用并处理成功/失败恢复 |
| 事件不触发 | enabled、emit/registerEvent、宿主、事件 type、priority | 别把初始 26 类型当严格白名单 |
| 全局变量不变 | ID 是否正确、typeof、对象变量规则 | 类型匹配且有限值；NaN 可能已经写入 |
| 血量修改无效 | 属性定义 ID 到 key 的映射、写的是否 actor.hp | 操作 actor.attributes 正确 key |
| 倍速行为不稳定 | Time.timeScale、大步长、碰撞/触发器/Timer | 35ms 是未缩放钳制，不是最高倍速上限 |
| passage=-1 仍被挡 | 场景边界、角色间碰撞、寻路 | 此值仅豁免地形碰撞部分，见 K210 |
| 外部 JSON 改了编辑器没变 | 安装版、AutoReload 开关、未保存/占用状态 | 不先保存旧内存；见 K403 |
| UI 标签显示原文 | 标签语法、入口处理层、缺词条/非法 ID | Local/Command/Printer 分开查，见 K208-K209 |
| 插件存档字段丢失 | 钩子、define、GUID、字段类型、旧档 | 查实际写盘内容，不只 await 结果 |
| 坏主档没“自愈” | readSaveJSON 是否读到备份、主档结构是否合法 | 回退仅读取，不修复主档，见 K212 |
| 浏览器读不到磁盘 Save | Stats.shell、IDB gameId/store/key | 浏览器走 IndexedDB，不是 localStorage 或项目文件 |

任何症状还可能来自当前框架迭代插件。触发器动态 hittrigger/collision 调度和近分区顺序须检查 K105，不把原生函数解释直接套到已补丁游戏。

## K403 外部修改、数据重载与编译验收
类型：POLICY
验证：POLICY_SOURCE
证据：`E:Project/Script/module/autoreload.ts`；`E:Project/Script/module/settingconfig/schema.ts`；`E:Project/Script/data/metadata.ts`；`G:tsconfig.json`

外部改文件前先确认编辑器是否有未保存改动及当前打开的目标；同一资源同时由外部和编辑器写入有覆盖风险。用户未保存内容不能被自动丢弃。

当前源码 AutoReload 默认关闭；安装版和开关未确认时采用保守流程：处理未保存内容，关闭项目，外部修改，重开项目。已确认 AutoReload 可用时检查它的重载日志、跳过原因和当前 UI 内容，仍不假定场景占用文件热更新成功。

改 TS 要确认编译完成且无错误，再重新试玩；改 .event/.ui/.scene 要确认编辑器真正重读。聚焦扫描、数据重载、脚本 metadata 更新、TS 编译、试玩新加载是不同阶段。

网页预览还要更新并核对 `.preview`。不要把打开了旧试玩窗口、按了一次保存或源文件修改时间改变作为新逻辑已运行的证据。

## K404 重复 GUID 排查与安全清理
类型：POLICY
验证：POLICY_SOURCE
证据：`E:Project/Script/file/file-item.ts`；`E:Project/Script/file/folder-item.ts`；`G:tsconfig.json`；`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/04-Yami经验笔记.md`

旧案例中同 GUID 的 TS 与错误落在 Assets 的 JS 导致重复；这是一个根因，不是所有 GUID 冲突的唯一原因。引擎支持加载 JS 脚本，不可用“Assets 下出现 JS 就删除”的规则。

在 PowerShell 只读定位：

```powershell
rg --files "D:\new-game\Assets" | Select-String 'ad08a4def6200207'
rg -n --fixed-strings 'ad08a4def6200207' "D:\new-game\Data" "D:\new-game\Assets"
git -C "D:\new-game" status --short
```

先确认同 GUID 文件是源、编译产物、版本副本还是不同有效资源；当前 outDir 指定 Dist，源旁同 GUID JS 可能是错误产物，但删除前必须有证据/备份。修改或删除引用资源需要用户明确授权范围。

manifest 问题先备份、确认编辑器可以重建并观察日志，再考虑重扫；不要把删 manifest 当第一步，也不要把未跟踪文件直接等同于可丢弃文件。

## K405 存档与引擎升级检查
类型：POLICY
验证：POLICY_SOURCE
证据：`G:Script/data.ts`；`G:Script/codec.ts`；`G:Script/actor.ts`；`G:.gitignore`；`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/04-Yami经验笔记.md`

升级前独立复制项目源码、Data 配置和真实存档到备份位置；确认 save.location 的实际路由，浏览器数据另行导出。Git 默认忽略 Save，即使授权 commit，也不能替代玩家存档备份。

不要从新模板无差别覆盖 Script：本工程包含 v2 属性差量、JSON 恢复、插件保存钩子/GUID、碰撞等自研逻辑；比较差异与调用点后再迁移。现行框架补丁需验证目标函数签名和启动顺序仍适用。

最小兼容检查应覆盖：新档/真实旧档、资源默认值变化、属性删除、插件字段缺失、JSON 非有限数、主档坏/备份坏、存档路径变化。跨文件/退出/断电的安全边界详见 K213，未测就保留风险说明。

保存成功不能只看 Promise resolve：Electron 槽位写入有吞错分支，核对实际文件/槽位元数据和重新读档；测试在独立副本中进行，不覆盖用户 Save。

## K406 Git 状态、隐藏标记与协作
类型：POLICY
验证：POLICY_SOURCE
证据：`G:.gitignore`；`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/04-Yami经验笔记.md`

没有明确提交/推送授权不执行 commit/push；授权一次操作不自动延伸到其它仓库和后续任务。

`game.yamirpg` 包含工程/编辑器工作区数据，可能已被跟踪；gitignore 不影响已跟踪文件。skip-worktree 可能隐藏磁盘改动，检查 `git ls-files -v -- game.yamirpg` 与文件内容。取消标记可能揭示用户改动，不可紧接默认 git restore。

pull 提示本地修改将被覆盖时，先查看差异并保留用户数据，按授权决定备份、暂存或合并。禁止把旧“restore 后 pull”案例当自动操作配方。

non-fast-forward 先检查本地/远端提交和分叉，按仓库策略选择 merge/rebase；不是一律先 pull，更不是默认强推。源码、文档、生成物与玩家数据要分别审查，不只凭文件名或 ignore 决定是否提交。

## K407 本地化排查与 Excel 导入风险
类型：FACT
验证：SOURCE
证据：`G:Script/local.ts`；`G:Script/ui.ts`；`G:Script/command.ts`；`E:main/main.ts`；`E:Project/Script/local/local-window.ts`

追踪实际显示字符串：文本可能先经过事件 compileTextContent，再进入 UI content 的 Local.replace，再由 Printer 处理格式。只搜索汉字无法判断一段内容是否显示；比较条件、资源名和注释与可见文字是不同用途。

setText 覆盖的 UI content 可能只是编辑器模板，需继续找运行时写入值。`<ref:ID>` 不是任意字段自动解析，双冒号动态变量是引擎更新器比较值，不是直接 Local 标签。

本地化 Excel 的 `open-yami` 表必须保留真实叶子 ID、语言列、parentID/isDir 关系；导入是构建新树并由本地化窗口应用 list，不是“只补缺翻译”。未出现在新树的词条可能消失，先备份 localization.json 并检查孤儿引用。

导入处理器读取失败/取消会返回空列表，当前 Localization.fromExcel 对空列表直接 return，不替换现有树；其它调用者要复核相同保护，不把空结果直接当有效空语言包。外部工具的导入导出兼容度需另验，旧工程的候选数、缺译数和疑似占位统计不是当前工程结论。

## K408 自动化检查与实机回归边界
类型：LIMITATION
验证：SCOPED
证据：`G:DANJUAN TOOLS/工具/verify-knowledge-base.mjs`；`G:DANJUAN TOOLS/temp/verify-save-fs.mjs`

本知识库提供一个 Node 可运行检查；本目录 temp 也有专题验证资产，不能再笼统写“无自动化测试”。这些并不等于覆盖完整游戏的统一测试套件。

知识库检查包括结构/来源/快照、当前数量、时间缩放、变量类型/NaN、指令返回与暂停恢复、GUID/define、属性差量往返、临时文件写备份及回退。脚本直接变换当前 TS 在隔离 VM 中执行，未加载 Game 主循环、真实 UI/GPU/音频。

本次另在临时副本验证了“源码哈希变化会失败”和“JSONL 与 Markdown 不一致会失败”，并用现有原生 TypeScript 编译器对 K305 两段示例执行 --noEmit 检查通过。这些是本次补充验收，不是上述日常脚本每次自动执行的全部步骤。

游戏功能变更仍应以独立副本验证涉及路径，按风险选最小集合：启动、场景创建、输入与 UI、技能/战斗、存档/读档、语言切换及目标平台。不因有知识库检查就省略实际功能验收，也不在没有启动应用时声称画面/玩法已经验收。

## K409 本次纠错记录与保留项
类型：FACT
验证：SOURCE
证据：`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/02-Yami引擎机制.md`；`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/03-Yami引擎编写规则.md`；`G:DANJUAN TOOLS/归档 功能文档/00-04原文备份-20261013/04-Yami经验笔记.md`；`G:Script/time.ts`；`G:Script/command.ts`；`G:Script/variable.ts`；`G:Script/yami/yami.ui.d.ts`；`G:Script/data.ts`；`E:Project/Script/module/autoreload.ts`

| 原文问题 | 现行结论 |
|---|---|
| undefined 会挂起自定义指令 | compileScript 用 ?? true，void 可继续 |
| return false 下一帧自动重试同指令 | 索引先递增，通常下一次到后续指令 |
| 35ms 限制最高倍速，必须循环 update | 先钳制未缩放时间，随后乘 timeScale |
| Variable.set 自动拒绝 NaN | NaN 是 number，可写入；边界需校验有限性 |
| file 等参数都注入实体 | file 等保留 ID；实体/getter 才查值 |
| TS implements 泛型决定注册类型 | 泛型编译擦除，数据注册决定调用 |
| UI transform 15 字段 | 实际 16 字段 |
| passage=-1 是完整 NoClip | 不覆盖角色间碰撞与场景边界 |
| 存档 .bak 无缝自愈且完全原子 | 回退读取不修复，存在平台/跨文件/异常边界 |
| Save 与 Dist 一样可删除重建 | Save 是玩家数据，不得默认清理 |
| 引擎绝无 watch，刷新方案未实现 | 当前源码已有 AutoReload，默认关闭，安装版未认证 |
| 66 个 Assets TS、85 个事件、195 本地化叶子 | 当前 67 个 Assets TS、90 个事件、296 叶子，见 K103 |
| 历史伤害数字方向链路是现行模板 | 当前源码未包含这些方法；历史记录只供追溯 |

失效 §7.4/§7.5/§9.4 等章节指引改为唯一 K 编号；旧精确行数/安装包大小/版本进度移出事实层。原文全部备份保留，05-08 及既有归档不改写、不继承本次验证标签。

本次不修游戏源码中另行发现的问题，例如获取角色id 的 caster 分支；这些在 K305 标为已知案例风险，避免 AI 无审查复用。没有运行完整游戏，不把源码审核写成实机成功。
