# Open Yami 复合型开发者套件 (Yami DevSuite Extension)

> **分支说明**：本分支（`extension`）为独立的 Open Yami RPG Editor 编辑器原生扩展插件源码仓库，无历史父提交，保持最纯净的轻量结构。

---

## 📦 插件文件结构

```
.
├── manifest.json       # Chrome MV3 扩展清单 (声明 world: "MAIN" 与 document_start 注入)
├── probe-core.js       # 探针内核 (WebGL DrawCall 拦截 / 逐帧耗时计算 / 本地 5966 HTTP & SSE 微服务)
├── hud-overlay.js      # 原生暗黑大盘 (完全非阻塞停靠侧栏 / Home 快捷键 / 4 维硬核指标)
├── HANDOFF.md          # 核心架构交接、引擎底层踩坑防踩档案与未来复合插件演进蓝图
└── README.md           # 本说明文件
```

---

## 🚀 安装与加载方式

1. 打开 **Open Yami RPG Editor**；
2. 将本分支下的文件放置于：
   `[Open Yami 安装目录]/extension/yami-perf-extension/`
3. 启动编辑器并进入游戏试玩：
   - 画面右上角将自动呈现迷你性能胶囊（FPS / 耗时 / DrawCall）；
   - 按 **`Home`** 键随时呼出/收起右侧原生性能与状态大盘；
   - 游戏画面**零阻断交互**，支持随时边玩边调。

---

## 📖 架构与开发指引

详细的技术架构设计、引擎源码 API 对接规范以及未来复合插件（作弊器/变量监视器/碰撞盒可视化）规划，请查阅 [HANDOFF.md](./HANDOFF.md)。
