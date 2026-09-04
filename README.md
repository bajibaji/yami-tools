# DanJuan妙妙插件 (Open Yami 开发者非侵入式辅助套件)

> **版本**：`v0.4.0`  
> **分支**：`extension`（母仓库单一真实源 SSOT）  
> **定位**：面向 Open Yami RPG Editor 编辑器的非侵入式辅助套件，包含**性能排查大盘（Profiler）**、**控制台报错白话分析（Error Debugger）**以及微内核页面契约架构。

---

## 🌟 核心特性

1. **零工程侵入与零构建依赖**：
   - 纯原生 JS 开发，以 Electron MV3 扩展形式注入主线程（`world: "MAIN"`）；
   - 0 外部 npm 依赖、0 外部 CDN 字体/网络请求，单机局域网或断网环境下 0 依赖秒开。
2. **正统 Remix Icon 离线免联网标准**：
   - 100% 采用官方开源 **Remix Icon（Line 风格）** 纯矢量 Path 内联呈现；
   - 全局界面恪守**绝对零 Emoji 规范**，深度契合 Yami 原生暗黑工业质感。
3. **全量控制台未捕获报错黑匣子**：
   - 全局拦截 `window.onerror` 与 `console.error`；
   - 智能匹配白话归因规则库（空指针排查、资源缺失定位等），支持一键复制调用栈。
4. **双重硬核物理级鼠标穿透**：
   - 采用高特异性复合选择器（`.yami-perf-dock.show.through`）与 JS 行内样式最高优先级控制；
   - 穿透时侧栏变半透明，鼠标直通底层游戏画面，顶栏保持交互可随时退出。
5. **微内核页面契约化体系（Microkernel Page Contract）**：
   - 页面统一遵循 `Views.register(id, { mount, refresh, destroy })` 标准契约；
   - 彻底消除巨型单文件的闭包耦合，后续扩展新模块（场景实体、变量开关）如同“即插即用”填空题。
6. **自动化版本管理与一键热更新**：
   - 依托 GitHub + jsDelivr 全球加速生态，在游戏内即可一键拉取最新发布版本并原子覆盖更新。

---

## 📦 文件目录结构

```text
.
├── manifest.json       # Chrome MV3 扩展清单 (声明 world: "MAIN" 与 document_start)
├── probe-core.js       # 探针内核 (WebGL DrawCall 拦截 / 原型链排查 / 报错捕获 / 5966 微服务)
├── hud-overlay.js      # 核心视图层 (微内核 Views 契约 / 胶囊与侧栏 / 穿透控制 / 路由调度)
├── src/
│   └── style.css       # 纯 CSS 样式源文件 (支持 IDE 语法高亮与 Emmet 补全)
├── build.cjs           # 原生零依赖自检构建脚本 (样式注入 / 17项断言自检 / --deploy 镜像同步)
├── HANDOFF.md          # 唯一权威交接文档与血泪避坑实战档案 (SSOT)
└── README.md           # 本说明文件
```

---

## 🛠️ 安装与加载方式

1. 打开 **Open Yami RPG Editor**；
2. 将本分支下的文件放置于：
   `[Open Yami 安装目录]/extension/yami-perf-extension/`
3. 启动编辑器并进入游戏试玩：
   - 右上角常驻迷你帧数胶囊（FPS / 耗时 / DrawCall）；
   - 按 **`Home`** 键或点击胶囊随时呼出/收起主控大盘；
   - 点击右上角【穿透】胶囊按钮，随时边玩边调。

---

## 💻 开发者工作流

- **本地修改与自检**：
  ```bash
  node build.cjs          # 执行语法校验、样式注入与 17 项核心锚点严苛自检
  node build.cjs --deploy # 自检 + 自动单向安全镜像至编辑器目录 + 输出 MD5 对齐报告
  ```
- **唯一发布铁律**：平时严禁擅自 Git 提交，仅在明确下达发布指令时触发智能版本号自增并推送到 GitHub `extension` 分支。

---

## 📖 核心档案与交接指引
所有历史演进时间线、**13 项血泪避坑实战档案**以及未来功能演进规划，严格以 **[HANDOFF.md](./HANDOFF.md)** 为唯一权威事实源。
