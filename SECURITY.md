# 安全说明

## 报告漏洞

如发现安全漏洞，请 **不要** 公开提交 issue，而是：

- 直接联系维护者（GitHub 主页可见邮箱）
- 或创建 issue 但使用 `[Security]` 前缀，并避免在正文中泄露可利用细节

## 已知安全边界

- 应用信任 `~/.pi/agent/`（auth.json 等）中的凭据，仅在本机使用
- `ws:*` IPC 接口做了路径安全校验，防止越出工作目录读写
- 渲染进程通过 preload 的 `contextBridge` 暴露受限 API，未开放 `nodeIntegration`
- 编辑器内打开的文件内容在渲染进程用 DOMPurify 处理，防 XSS
