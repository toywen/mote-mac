# 0020 在应用内支持图片与 PDF 格式文件的独立标签页预览

- 状态：已实现
- 日期：2026-11-22

## 背景

知识库中除了 Markdown 笔记与 HTML 导出文档外，还大量存储了设计图纸、架构白板截图、照片、图表（PNG, JPG, SVG, WebP 等）以及技术书籍、学术论文、产品规格书（PDF）。在此之前，mote 遇到图片与 PDF 文件仅能调用外部应用打开，这中断了连续的知识查阅与双链追溯体验。

## 决定

1. **协议层与 MIME 支持扩展**：
   - 在 `fileUrl.ts` 中新增 `pdfType`（`application/pdf`），并在 `mediaType` 中纳管图片、视频、HTML 与 PDF。
   - 提供 `isPdfPath`、`isImagePath` 与 `isViewableFilePath` 工具函数统一界定可在应用内打开的媒体格式。
   - 主进程 `fileProtocol.ts` 针对 `application/pdf` 供给完整的 MIME 响应头与内联展示安全头（`Content-Disposition: inline` 与 `nosniff`）。
2. **工作区状态机（Workspace）多类型 Doc 纳管**：
   - 扩充 `Doc` 类型，新增 `ImageDoc`（`kind: 'image'`）与 `PdfDoc`（`kind: 'pdf'`）。
   - 文件树点击、快速打开（⌘O）以及双链跳转（如 `[[photo.png]]`、`[[paper.pdf]]`）时，直接在主工作区创建并切换至对应的独立标签页。
   - 保留与 Markdown、HTML 标签页一致的关闭、定位与历史导航（前进/后退）。
3. **渲染器架构与视觉呈现**：
   - **图片查看器（`ImageViewer.tsx`）**：采用 React 轻量组件，居中布局展示高清晰度图片，支持“适应窗口”与“1:1 原始尺寸”自由缩放切换，显示原图分辨率，背景适配宣纸与暗墨主题。
   - **PDF 阅读器（`PdfViewer.tsx`）**：基于 Electron / Chromium 原生 PDF 引擎加载，拥有出色的内存开销控制与平滑滚动、目录跳转、关键词搜索能力。
   - 顶部动作栏为非 Markdown 媒体文件统一提供“在系统默认应用中打开”的快捷按钮。

## 理由

- 原生 PDF 引擎与轻量 React 图片渲染器不依赖庞大的第三方臃肿库，保持应用体积精简与启动极速。
- 遵循单一职责与统一工作区模型，所有知识资源统一汇聚于标签页系统。
