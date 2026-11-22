# 第 8 步实现计划

本计划实现 [功能列表](../features.md#第-8-步html-格式可读) 里的第 8 步：HTML 格式可读。

完成标准有两条：

- HTML-1：支持 `.html` / `.htm` 格式文件在应用内直接打开与沙箱安全阅读，无需跳转外部浏览器。
- 验收-13：在文件树中点击 `.html` 文件或在 Markdown 笔记中点击指向 `.html` 文件的链接，均能在主视口以标签页形式通过沙箱 iframe 完整渲染，排版样式正确且安全受控。

本文用到的词：

- **HTML 阅读器**：`HtmlViewer` 组件。在主视口渲染沙箱 iframe 阅读 HTML 文件。
- **沙箱 iframe**：带 `sandbox="allow-scripts allow-same-origin allow-forms"` 的 `<iframe>`，隔离主应用上下文与未信任内容。
- **mote-file 协议**：安全服务笔记库内文件的私有协议，支持 HTML MIME 类型和字符集。

## 4 个可验证单元

按实现与验证顺序排列：

| 单元 | 内容                                                                      | 功能编号 | 依赖 | 证明                                            |
| ---- | ------------------------------------------------------------------------- | -------- | ---- | ----------------------------------------------- |
| A    | `mote-file://` 协议服务 HTML 文件与核心路径工具（`fileUrl.ts`、CSP）      | HTML-1   | 无   | 单元测试 `fileUrl.test.ts`                      |
| B    | 工作区状态机与文件树打开支持（`workspace.ts`、`FileTree.tsx`）            | HTML-1   | A    | 状态机单元测试与逻辑检查                        |
| C    | `HtmlViewer.tsx` 沙箱阅读器组件实现与主视口渲染（`App.tsx`、`main.css`）  | HTML-1   | A、B | 页面加载与工具栏交互                            |
| D    | 全流程端到端验收与验证脚本归档（`verify-step8.mjs`、`html.spec.ts`）      | 验收-13  | 全部 | `tools/verify-step8.mjs` 实测，features.md 归档 |

```
main ── A 协议与类型 ── B 状态机与导航 ── C HtmlViewer组件 ── D 验收与归档
```

---

## 单元 A：`mote-file://` 协议服务 HTML 文件与核心路径工具

- 目标：
  - 在 `src/core/fileUrl.ts` 增加 `htmlType(path)` 与 `isHtmlPath(path)`。
  - 在 `src/main/fileProtocol.ts` 放行 `text/html` 类型服务。
  - 在 `src/renderer/index.html` 的 CSP `frame-src` 放行 `mote-file:`。
- 验证：编写/补充 `src/core/fileUrl.test.ts`。

---

## 单元 B：工作区状态机与文件树打开支持

- 目标：
  - 在 `src/renderer/src/workspace.ts` 将 `Doc` 联合类型扩充 `{ kind: 'html'; path: VaultPath }`。
  - `workspace.open(path)` 识别 HTML 路径并切换到 HTML 文档状态，记录到标签页与访问历史。
  - `workspace.follow(dest)` 针对目标为 HTML 的内部文件链接，调用应用内打开。
  - `src/renderer/src/FileTree.tsx` 点击 HTML 节点直接调用 `workspace.open(node.path)`。
- 验证：`npm run typecheck`。

---

## 单元 C：`HtmlViewer.tsx` 沙箱阅读器组件实现与主视口渲染

- 目标：
  - 创建 `src/renderer/src/HtmlViewer.tsx`，使用沙箱 `<iframe>` 渲染 `mote-file://vault/<path>`。
  - 顶部显示文件信息栏、在访达中显示与在系统默认应用中打开按钮。
  - 监听外部文件更新（`revision` 变更时自动重载 iframe）。
  - 在 `src/renderer/src/App.tsx` 中当 `doc.kind === 'html'` 时挂载 `HtmlViewer`。
  - 在 `src/renderer/src/TabBar.tsx` 中正确展示 `.html` 文件标签。
- 验证：`npm run build` 无告警，组件样式正常。

---

## 单元 D：全流程端到端验收与验证脚本归档

- 目标：
  - 编写 `tools/verify-step8.mjs` 脚本覆盖 HTML 文件解析、服务与沙箱属性。
  - 编写 Playwright E2E 测试 `tests/e2e/html.spec.ts` 覆盖文件树点击打开 HTML、iframe 渲染、外部打开按钮与链接跳转。
  - 更新 `docs/features.md` 状态与证据。
