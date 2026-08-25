# Pi Desktop

[![CI](https://github.com/yuanchangchun815-collab/Pi-Desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/yuanchangchun815-collab/Pi-Desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/yuanchangchun815-collab/Pi-Desktop/blob/main/LICENSE)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-blue.svg)](https://github.com/yuanchangchun815-collab/Pi-Desktop/security/dependabot)

用 Electron 桌面端来使用和控制 **pi**（编码智能体）完整功能的桌面应用。

通过官方 SDK `@earendil-works/pi-coding-agent` 将 pi 的 agent 引擎直接嵌入 Electron 主进程，在图形界面里获得与终端相同的完整能力。

## 功能

- 💬 **聊天式界面**：给 pi 发送消息，流式显示回复
- 🧠 **思维链**：实时显示 pi 的思考过程
- 🛠 **工具调用**：可视化展示/折叠每次工具调用（read / write / edit / bash / grep 等）及流式输出
- 🆕 **会话管理**：新建会话、列出历史会话、切换/恢复会话、会话 ID 展示
- 🤖 **模型控制**：切换模型、调整思考等级（off / low / medium / high / xhigh / max）
- ⏹ **中止/排队**：中止当前任务；流式期间支持 steer / followUp 排队消息
- 🧩 **完整引擎**：基于 pi SDK，天然支持扩展、技能、提示模板、AGENTS.md 上下文、上下文压缩（compaction）等
- 📂 **工作目录 & 文件浏览器**：左侧文件树，展开/折叠目录，点击文件在右侧面板打开
- 🖥 **常驻可编辑文件面板**：右侧面板直接编辑文件并保存回磁盘（Ctrl/Cmd+S），带未保存提示、二进制只读检测、大文件截断提示
- ➕ **文件管理**：新建文件/目录（＋按钮）、右键重命名/删除/复制路径、路径安全校验（防越出工作目录）
- 🔀 **切换工作目录**：原生目录选择器，一键更改 agent 工作目录并重建会话；工具栏显示当前 cwd
- 🤖 **模型切换下拉框**：列出已认证可用的模型，一键切换
- 📐 **语法高亮编辑器**：右侧文件面板基于 CodeMirror 6，按扩展名自动匹配 JS/TS/JSON/MD/CSS/HTML 语法高亮，行号、折叠、括号匹配
- 🔍 **@ 文件补全**：在输入框打 `@` 自动弹出文件模糊搜索下拉，Enter/Tab 选择，插入 `@path`
- 🎯 **拖拽文件引用**：把文件树里的文件（或系统文件）拖进输入框，自动插入 `@path` 引用
- 🌿 **Git 面板**：工具栏 Git 按钮查看分支/变更状态（modified/added/deleted/untracked），点击文件看 diff
- 📦 **打包发布**：electron-builder 产出 `.app` / `.dmg` / NSIS 安装包 / AppImage
- 📋**右键复制路径**：在文件树上右键可复制文件绝对路径，方便在对话中引用

## 截图

> 截图稍后补充（占位）——发布前请替换为实际运行截图。建议图片存于 `docs/screenshots/` 目录并提交到仓库。

| | |
|---|---|
| <img src="docs/screenshots/chat.png" width="400" alt="主聊天界面" /> | <img src="docs/screenshots/editor.png" width="400" alt="编辑面板与 Git 面板" /> |

*预留：主窗口（左文件树 / 中聊天 / 右编辑器）；更多截图可参考 `docs/screenshots/`。*

## 技术栈

- **[Electron](https://www.electronjs.org/)** — 桌面壳（主进程 + 渲染进程 + preload 安全桥）
- **`@earendil-works/pi-coding-agent`** — pi 官方 SDK，运行 agent 引擎
- **TypeScript** — 全程类型安全

## 架构

```
renderer (HTML/CSS/TS 界面)   ◀── 左侧文件树 + 右侧聊天 + 文件预览弹窗
   ▲  window.pi.* (preload contextBridge)
   │  IPC
Electron main 进程
   ├─ registerIpcHandlers
   │    ├─ pi:*   → PiService（agent 会话 + 模型）
   │    ├─ ws:*   → workspace.ts（文件系统：列目录/读/写/搜索/路径安全）
   │    └─ git:*  → git.ts（分支/状态/diff）
   ├─ dialog       （原生目录选择器）
   ▼
PiService (包装 createAgentSessionRuntime / createAgentSession) + workspace.ts + git.ts
   │  session.prompt() / steer() / followUp() / abort()
   │  session.subscribe()  ← 事件流 → 转发给 renderer
   ▼
pi SDK (@earendil-works/pi-coding-agent)
   ▼
ModelRuntime / Providers (Anthropic, OpenAI, DeepSeek, Gemini, …)
```

## 快速开始

前置：已配置某家 provider 的 API key（例如 `ANTHROPIC_API_KEY`），与使用 pi CLI 一致。

```bash
npm install        # 安装依赖（含 Electron 和 pi SDK）
npm start          # 构建并启动桌面应用
```

配置的认证、模型、扩展等与 `pi` CLI 共用 `~/.pi/agent/`（auth.json、models.json、settings.json 等）。

### 环境变量（可选）

| 变量 | 说明 |
|------|------|
| `PI_DESKTOP_CWD` | agent 工作目录（默认：当前目录） |
| `PI_DESKTOP_MODEL` | 启动时选择的模型（如 `deepseek/deepseek-v4-pro`） |
| `PI_DESKTOP_THINKING` | 启动时思考等级（off/low/medium/high/xhigh/max） |
| `PI_DESKTOP_DEV=1` | 开发模式开关 |

## 开发

```bash
npm run build:ts     # 仅编译 TypeScript
npm run build:renderer # 仅打包渲染进程（esbuild）
npm run build:assets # 复制 renderer 静态资源
npm run build        # 全部构建
npm start            # 构建并运行
```

### 打包发布

```bash
npm run pack        # 生成未压缩的 .app（快速验证打包）
npm run dist        # 生成安装包（当前平台默认 target）
npm run dist:mac    # 生成 macOS dmg + zip
```

产物输出到 `release/`。

### 自动发布（GitHub Releases）

推送一个 `v*` 标签即可触发 `.github/workflows/release.yml`，在 Linux / macOS / Windows 三平台分别构建并上传到 [GitHub Releases](https://github.com/yuanchangchun815-collab/Pi-Desktop/releases)：

```bash
git tag v0.1.0
git push origin v0.1.0
```

> ⚠️ 当前产物**未做代码签名**（macOS / Windows），安装时系统会提示“未知开发者/可能有害”。如需消除提示，需配置对应的开发者证书——开源阶段通常不含签名，属正常现象。

### 关于精简包体积（研究与结论）

实测分析：包体大的主因是 pi SDK（`@earendil-works/pi-coding-agent`）为支持全部云 provider 绑定了多个云 SDK——`openai`(~16MB)、`@google/genai`(~14MB)、`@aws-sdk`+`@smithy`+`@aws-crypto`(~12MB)、`@anthropic-ai/sdk`(~6MB)，共约 50MB。

**能否安全精简？** 经核实，pi 对这些 provider SDK 全部使用**惰性加载**（`dist/api/*.lazy.js`，仅在选择该 provider 时才 `import()`，避免拖慢启动）。但 electron-builder 会**按依赖树自动把所有已声明依赖打包进 `app.asar`**，`files` 里的 `!` 排除对**嵌套**于 `pi-coding-agent/node_modules/` 下的这些包**不生效**（实测排除后 asar 体积不变）。要真正剔除，只能改 `node_modules` 或后处理 asar。

**结论：会受 pi 更新影响，因此不采用。** 无论是改 `node_modules` 还是后处理 asar，都会在 `npm install`/pi 升级时被还原，需要反复维护；且你会丧失对应的 provider 支持（例如 DeepSeek 依赖 `openai` 协议）。同时由于惰性加载，这 50MB 只增加磁盘占用、不拖慢启动。

> 若后续确需瘦身，最稳妥的思路是：改用裁剪过的 pi-ai 副本或将打包做成 CI 流水线中定制 asar；但这是一项持续维护成本量级的改造，当前不建议。

### 应用图标

图标已内置在 `build/` 目录（`npm run icons` 可重新生成）：
- `build/icon.png` — 1024×1024 源图（脚本生成：渐变圆角底 + 白色 π 标识）
- `build/icon.icns` — macOS 图标
- `build/icon.ico` — Windows 图标

生成脚本在 `scripts/build-icons/`（自包含，仅用 Node 内建模块 + 系统 `sips`/`iconutil`，无需额外依赖）。

> 注意：打包体积较大（约 400MB），因为 pi SDK 为支持全部 provider（含 AWS Bedrock 等）绑定了多个云 SDK。若要精简，可裁剪 pi-ai 的 provider。

### 无头冒烟测试

验证 pi SDK 集成（模型、提示、事件流）无需打开窗口：

```bash
node scripts/smoke-pi.mjs
```

## 目录结构

```
electron/
  main.ts        # Electron 主进程：创建窗口、启动 PiService
  preload.ts     # contextBridge 暴露 window.pi 给渲染进程
  piService.ts   # pi SDK 封装（会话、提示、事件、模型、会话管理、切换 cwd、列模型）
  workspace.ts   # 文件系统：列目录、读文件、写文件、创建/删除/重命名、搜索、路径安全
  git.ts         # Git：分支、状态、diff（child_process 调用 git）
  ipc.ts         # 主进程 IPC 处理（pi:* + ws:* + git:*）
renderer/
  index.html     # 界面骨架：左文件树 / 中聊天 / 右 CodeMirror 编辑器 / Git 面板
  styles.css     # 深色主题样式
  app.ts         # 渲染逻辑：消息、思维链、工具、文件树、文件编辑与保存
  editor.ts      # CodeMirror 6 封装（语法高亮、行号、可读写切换）
  mention.ts     # @ 文件补全下拉
scripts/
  copy-assets.mjs  # 构建时复制静态资源
  smoke-pi.mjs     # 无头 SDK 冒烟测试
```

## 说明 / 局限

- **模型需要已配置认证**：首次使用请先确保某 provider 已有 API key（可复用 CLI 的 `~/.pi/agent/auth.json`）。
- 桌面 GUI 目前未提供 provider 登录交互（`/login`），如需 OAuth 登录可用 `pi /login` 在终端完成，桌面端会复用其凭据。
- **切换工作目录会重建会话**（`ws:setCwd`），当前对话历史不保留；这是切换 agent cwd 的固有代价。
- 文件树按需懒加载（未展开的目录不读取子级），适合大项目。

## 开源 / 贡献

本项目以 **MIT** 协议开源（见 [LICENSE](LICENSE)）。

- 报告 bug / 提需求：请使用 [Issue 模板](.github/ISSUE_TEMPLATE/)
- 提交代码：请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 并遵循 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)
- 安全漏洞：请勿公开提交，见 [SECURITY.md](SECURITY.md)

> ⚠️ 开源注意事项：`demo/` 为本地演示数据、`release/` 为打包产物，均不入库；仓库中不包含任何 API key，凭据统一读取自 `~/.pi/agent/`。
