---
description: Yami 编辑器扩展插件开发（yami-perf-extension / DevSuite）的完整背景知识入口
---

# Yami 插件开发 Skill

开发或修改 Open Yami 编辑器扩展（`yami-perf-extension`）时，必须先加载 skill：`.agents/skills/yami-plugin-dev/SKILL.md`（Claude Code 会自动发现；其他 agent 直接读该文件）。

该 skill 涵盖：核心工程路径映射（生产扩展目录 / yami-tools 源码基线 / 引擎源码 / 游戏工程）、扩展加载与 `world: MAIN` 注入机制、输入防穿透金规（`Scene.preventInput()` + 仅 mousedown 阶段 stopPropagation）、引擎真实数据结构（`Scene.actor.list` 等）、UI 污染防御（弃用原生 button / Tab 隔离）、热重载流程（F5 生效 / manifest 改动需重启）与工程规范（不自动提交、node --check）。