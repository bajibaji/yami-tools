// 工具清单：legacy 旧工具以静态页面形式保留在 public/tools/ 下,
// asset-manager 为 React 新工具路由。
export const BASE = import.meta.env.BASE_URL || '/'

export const CATEGORIES = [
  { id: 'all', name: '全部工具' },
  { id: 'editor', name: '数据编辑' },
  { id: 'simulation', name: '数值模拟' },
  { id: 'code', name: '代码与语言' },
  { id: 'perf', name: '性能调优' },
  { id: 'asset', name: '素材资源' }
]

export const TOOLS = [
  {
    id: 'character-editor',
    title: '角色编辑器',
    category: 'editor',
    icon: '✦',
    iconClass: 'icon-role',
    desc: '可视化编排角色掉落表、事件掉落指令与人物属性。自动扫描角色、物品与装备，保存前自动备份。',
    tags: ['需要选择工程目录'],
    action: '启动工具',
    version: 'v0.7.2',
    shortcut: '1',
    href: 'tools/character-editor/index.html'
  },
  {
    id: 'map-editor',
    title: '地图编辑器',
    category: 'editor',
    icon: '◆',
    iconClass: 'icon-map',
    desc: '支持导入 Excel / JSON 格式，提供 10×10 矩阵可视化快速编辑，一键导出 Yami 标准地图 JSON 数据。',
    tags: ['支持 Excel / JSON 导入'],
    action: '启动工具',
    version: 'v0.7.0',
    shortcut: '2',
    href: 'tools/map-editor/index.html'
  },
  {
    id: 'idle-lab',
    title: '挂机验证台',
    category: 'simulation',
    icon: '◫',
    iconClass: 'icon-lab',
    desc: '读取真实工程与地图，批量模拟每个关卡的战斗、生存、经验和金币产出，并用热力图、流程推演与 A/B 对比定位数值瓶颈。',
    tags: ['可调参数 · 不写回工程'],
    action: '启动工具',
    version: 'v0.1.0 beta',
    shortcut: '3',
    href: 'tools/idle-lab/index.html'
  },
  {
    id: 'localization-lab',
    title: '快速本地化',
    category: 'code',
    icon: '🌐',
    iconClass: 'icon-local',
    desc: '扫描硬编码文本、缺翻译、孤儿引用与疑似占位翻译，导出多语言 Excel 翻译后导入回工程，支持一键修复孤儿引用。',
    tags: ['Excel 导入导出 · 自动备份'],
    action: '启动工具',
    version: 'v0.2.1 beta',
    shortcut: '4',
    href: 'tools/localization-lab/index.html'
  },
  {
    id: 'save-lab',
    title: '存档台',
    category: 'editor',
    icon: '🕹',
    iconClass: 'icon-save',
    desc: '查看游戏存档的格式化 JSON 与 meta 截图，把 GUID 和键名注解成游戏内的中文名称与图片；支持编辑写回，保存前自动备份。',
    tags: ['工程联动 · 中文/GUID 映射 · 自动备份'],
    action: '启动工具',
    version: 'v0.1.1',
    shortcut: '5',
    href: 'tools/save-lab/index.html'
  },
  {
    id: 'perf-lab',
    title: '性能分析台',
    category: 'perf',
    icon: '⏱',
    iconClass: 'icon-perf',
    desc: '分析 Electron 真机游玩时采集的 DevTools Performance 与 Spector.js 报告，定位 CPU、GC、长帧和 WebGL 瓶颈。',
    tags: ['Electron 真机 · DevTools · Spector.js'],
    action: '启动工具',
    version: 'v0.4.1',
    shortcut: '6',
    href: 'tools/perf-lab/index.html'
  },
  {
    id: 'script-converter',
    title: '脚本转换',
    category: 'code',
    icon: '⚡',
    iconClass: 'icon-script',
    desc: '将老旧的 Yami RPG JS 插件与指令代码一键转换为现代 TypeScript 规范脚本，自动推导泛型、生成接口属性、升级 CurrentEvent API。',
    tags: ['JS 转 TS · 自动推断泛型 · 批量转换'],
    action: '启动工具',
    version: 'v0.1.0',
    shortcut: '7',
    href: 'tools/script-converter/index.html'
  },
  {
    id: 'asset-manager',
    title: '素材管理器',
    category: 'asset',
    icon: '🖼',
    iconClass: 'icon-asset',
    desc: '十万级本地像素素材库：支持 100K+ 流式索引、Spritesheet 智能切片、胶片时间轴、多层级折叠树与批量 ZIP 打包。',
    tags: ['100K+ 流式索引', 'PNG / GIF / Aseprite / ZIP'],
    version: 'v1.3.0',
    shortcut: '8',
    beta: false,
    route: '/asset-manager'
  }
].map(t => ({ ...t, fullHref: t.route ? undefined : BASE + t.href }))

// 构建时由 GitHub Actions 注入 VITE_APP_VERSION（如 v0.0.0）；本地开发回退到默认值
export const HUB_VERSION = import.meta.env.VITE_APP_VERSION || 'v1.3.0'
