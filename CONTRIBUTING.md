# 贡献指南

感谢你愿意为 Pi Desktop 贡献代码！

## 环境准备

- Node.js ≥ 20
- 安装依赖：`npm install`
- 开发运行：`npm start`（构建并启动，或 `npm run start:dev` 开启开发模式）

## 代码规范

- 全程 TypeScript，严格模式（`strict: true`）
- 主进程代码在 `electron/`，渲染进程在 `renderer/`，构建产物在 `dist/`
- 提交前请确保 `npm run build` 通过

## 分支与 PR

- 从 `main` 切出功能分支：`git checkout -b feat/xxx`
- 提交信息建议使用 Conventional Commits 风格（`feat:` / `fix:` / `docs:` / `refactor:` 等）
- 提交 PR 前请对照 `.github/PULL_REQUEST_TEMPLATE.md` 检查清单

## 安全须知

- **严禁**在代码、日志、测试文件中提交任何 API key / token / 密钥
- 不要提交本地绝对路径（如 `/Users/xxx/`）
- 如发现泄露，请立即联系维护者并轮换密钥

## 测试

- 无头冒烟测试：`node scripts/smoke-pi.mjs`（验证 pi SDK 集成，无需 GUI）
- 手动测试重点：聊天流式输出、文件树、编辑器保存、Git 面板、打包（`npm run pack`）
