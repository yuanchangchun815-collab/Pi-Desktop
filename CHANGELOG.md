# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- 聊天式界面：流式回复、思维链显示、工具调用可视化（含参数摘要、streaming partial 结果、diff/patch 展示）
- 会话管理：新建 / 列出 / 切换 / 恢复会话
- 模型控制与切换、思考等级调整
- 中止 / 排队（steer / followUp）
- 工作目录与文件浏览器：文件树、右键重命名/删除/复制路径、路径安全校验
- 常驻可编辑文件面板（CodeMirror 6 语法高亮）、未保存提示、二进制只读检测、大文件截断提示
- @ 文件补全、拖拽文件引用
- Git 面板：分支 / 变更状态 / diff
- native 打包发布（macOS dmg/zip、Windows nsis/portable、Linux AppImage）
- 基础工程化：CI 三平台构建、单元测试、ESLint + Prettier、Dependabot 依赖更新

### 修复

- README 中未闭合的代码块与孤立反引号导致的内容渲染错误
- `mention.ts` 中 `row.addEventListener` 回调缩进错乱

### 工程化

- 新增 `npm test`（workspace 单元测试，`node:test` 零依赖）
- 新增 `npm run lint` / `npm run format` / `npm run format:check`
- 移除多处未使用变量（isDev、PEEK_LINES、originalContent、isPreviewableFile 等）
- `package.json` 指向真实仓库地址（yuanchangchun815-collab/Pi-Desktop）

## [0.1.0] - 开源首版

> 首个公开版本，基础桌面应用骨架与 pi SDK 集成已可用。

### 新增

- 基于 Electron + `@earendil-works/pi-coding-agent` 的桌面端完整封装
- 与 `pi` CLI 共用 `~/.pi/agent/` 认证、模型、扩展配置
- 复用 `pi` 的扩展、技能、提示模板、AGENTS.md 上下文、context 压缩等能力

[Unreleased]: https://github.com/yuanchangchun815-collab/Pi-Desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yuanchangchun815-collab/Pi-Desktop/releases/tag/v0.1.0
