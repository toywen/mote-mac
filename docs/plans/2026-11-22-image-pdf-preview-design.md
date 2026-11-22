# 图片与 PDF 应用内预览功能设计方案

- 日期：2026-11-22
- 状态：已批准并执行

## 1. 目标与范围

在 mote 中为知识库内的图片文件（png, jpg, jpeg, gif, svg, webp, bmp, avif）以及 PDF 文件（pdf）提供应用内独立标签页预览能力，免去跳转外部浏览器的打扰，与现有 Markdown 笔记和 HTML 页面保持完全一致的工作流。

## 2. 核心架构与数据结构

### 2.1 MIME 协议与格式判定 (`src/core/fileUrl.ts`)

- `pdfType(path: string): string | null`：识别 `.pdf` 文件扩展名，返回 `application/pdf`。
- `isPdfPath(path: string): boolean`：判断是否为 PDF 文件。
- `isImagePath(path: string): boolean`：判断是否为图片格式。
- `isViewableFilePath(path: string): boolean`：判断是否为应用内支持查看的格式（Markdown, HTML, 图片, PDF）。

### 2.2 工作区文档模型 (`src/renderer/src/workspace.ts`)

扩充 `Doc` 联合类型：
```ts
export type ImageDoc = { kind: 'image'; path: VaultPath }
export type PdfDoc = { kind: 'pdf'; path: VaultPath }

export type Doc =
  | (Draft & { kind: 'clean' | 'saving'; baseHash: ContentHash })
  | (Draft & { kind: 'missing' })
  | DirtyDoc
  | ConflictDoc
  | HtmlDoc
  | ImageDoc
  | PdfDoc
```

### 2.3 交互与视图组件

1. **`ImageViewer.tsx`**：
   - 使用 `mote-file://` 协议加载图片。
   - 居中展示，柔和暗色/宣纸色相衬托。
   - 交互栏提供：自适应窗口 / 100% 原始大小切换、分辨率显示、在外部默认应用中打开。
2. **`PdfViewer.tsx`**：
   - 挂载包含 Chromium 原生 PDF Reader 的 iframe 容器。
   - 原生享受目录跳转、全书搜索、平滑翻页与连续滚动能力。
3. **`FileTree.tsx` & `QuickOpen.tsx`**：
   - 文件树中为图片分配 `FileImage` 图标，为 PDF 分配文档图标。
   - 点击文件直接调用 `workspace.open(node.path)` 在主视口打开标签页。
   - ⌘O 快速打开中包含图片和 PDF 检索结果。
