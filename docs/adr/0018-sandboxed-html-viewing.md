# 0018 在应用内沙箱安全阅读 HTML 文件

- 状态：已实现
- 日期：2026-11-22

## 背景

知识库中经常包含本地导出的 HTML 报告、网页存档、可视化仪表盘或文档片段。在第 8 步之前，mote 仅能在主视口编辑与阅读 Markdown 笔记，若点击 HTML 文件则直接调用 macOS 默认外部应用（如 Safari 或 Chrome）打开。频繁跳转外部浏览器打断了连续记笔记的心流，也无法利用多标签页在笔记与相关参考材料之间快速切换。

## 决定

1. **`mote-file://` 协议支持 HTML 类型**：
   - 在主进程 `fileProtocol.ts` 中允许提供 `text/html; charset=utf-8` 服务，并设置防止主应用环境污染的安全响应头。
   - 渲染进程通过 CSP `frame-src` 放行 `mote-file:` 来源。
2. **沙箱 iframe 隔离渲染**：
   - 使用独立的 `HtmlViewer.tsx` 组件，在主视口挂载 `<iframe sandbox="allow-scripts allow-same-origin allow-forms">`。
   - 保留 HTML 自身的排版样式与离线脚本交互能力，同时依靠跨源隔离（`file://` 主窗口与 `mote-file://` 页面源隔离）与禁止顶层导航防止安全逃逸。
3. **工作区多标签页无缝集成**：
   - `workspace.ts` 状态机支持 `Doc` 的 `html` 状态，统一由多标签页（TabBar）管理。
   - 文件树点击 `.html` 文件或在 Markdown 笔记中点击指向 `.html` 的内部链接时，直接在主视口激活对应标签页。
   - 提供快捷操作按钮，允许用户随时一键在访达中定位或在系统默认浏览器中打开该文件。

## 理由

- 使用沙箱 iframe 能够在不损害渲染质量的前提下完全隔离应用主进程与渲染进程运行环境。
- 将 HTML 文件纳入标签页和历史导航管理，保持了与 Markdown 笔记一致的读写体验。
