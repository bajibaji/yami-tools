// 工具清单：legacy 旧工具以静态页面形式保留在 public/tools/ 下,
// asset-manager 为 React 新工具路由。
const BASE = import.meta.env.BASE_URL || '/'

export const TOOLS = [
  {
    id: 'character-editor',
    title: '角色编辑器',
    icon: '✦',
    iconClass: 'icon-role',
    desc: '可视化编排角色掉落表、事件掉落指令与人物属性。自动扫描角色、物品与装备，保存前自动备份。',
    tags: ['需要选择工程目录'],
    action: '启动工具',
    version: 'v0.7.0',
    href: 'tools/character-editor/'
  },
  {
    id: 'map-editor',
    title: '地图编辑器',
    icon: '◆',
    iconClass: 'icon-map',
    desc: '支持导入 Excel / JSON 格式，提供 10×10 矩阵可视化快速编辑，一键导出 Yami 标准地图 JSON 数据。',
    tags: ['支持 Excel / JSON 导入'],
    action: '启动工具',
    version: 'v0.7.0',
    href: 'tools/map-editor/'
  },
  {
    id: 'idle-lab',
    title: '挂机验证台',
    icon: '◫',
    iconClass: 'icon-lab',
    desc: '读取真实工程与地图，批量模拟每个关卡的战斗、生存、经验和金币产出，并用热力图、流程推演与 A/B 对比定位数值瓶颈。',
    tags: ['可调参数 · 不写回工程'],
    action: '启动工具',
    version: 'v0.9.0',
    href: 'tools/idle-lab/'
  },
  {
    id: 'localization-lab',
    title: '快速本地化',
    icon: '🌐',
    iconClass: 'icon-local',
    desc: '扫描硬编码文本、缺翻译、孤儿引用与疑似占位翻译，导出多语言 Excel 翻译后导入回工程，支持一键修复孤儿引用。',
    tags: ['Excel 导入导出 · 自动备份'],
    action: '启动工具',
    version: 'v0.4.0',
    href: 'tools/localization-lab/'
  },
  {
    id: 'save-lab',
    title: '存档台',
    icon: '🕹',
    iconClass: 'icon-save',
    desc: '查看游戏存档的格式化 JSON 与 meta 截图，把 GUID 和键名注解成游戏内的中文名称与图片；支持编辑写回，保存前自动备份。',
    tags: ['工程联动 · 中文/GUID 映射 · 自动备份'],
    action: '启动工具',
    version: 'v0.4.0',
    href: 'tools/save-lab/'
  },
  {
    id: 'perf-lab',
    title: '性能分析台',
    icon: '⏱',
    iconClass: 'icon-perf',
    desc: '分析 Electron 真机游玩时采集的 DevTools Performance 与 Spector.js 报告，定位 CPU、GC、长帧和 WebGL 瓶颈。',
    tags: ['Electron 真机 · DevTools · Spector.js'],
    action: '启动工具',
    version: 'v0.4.0',
    href: 'tools/perf-lab/'
  },
  {
    id: 'script-converter',
    title: '脚本转换',
    icon: '⚡',
    iconClass: 'icon-script',
    desc: '将老旧的 Yami RPG JS 插件与指令代码一键转换为现代 TypeScript 规范脚本，自动推导泛型、生成接口属性、升级 CurrentEvent API。',
    tags: ['JS 转 TS · 自动推断泛型 · 批量转换'],
    action: '启动工具',
    version: 'v0.1.0',
    href: 'tools/script-converter/'
  },
  {
    id: 'asset-manager',
    title: '素材管理器',
    icon: '🖼',
    iconClass: 'icon-asset',
    desc: '本地像素素材库：单帧连播、spritesheet 动画预览；快速搜索定位与拖拽/按钮导出 PNG、GIF。',
    tags: ['beta', 'PNG / GIF'],
    version: 'v0.1.0',
    beta: true,
    route: '/asset-manager'
  }
].map(t => ({ ...t, fullHref: t.route ? undefined : BASE + t.href }))

export const HUB_VERSION = 'v0.9.0'
