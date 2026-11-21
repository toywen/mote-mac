# 第 7 步实现计划

本计划实现 [功能列表](../features.md#第-7-步markdown-快捷键与应用菜单) 里的第 7 步：Markdown 快捷键与应用菜单。

完成标准有三条：

- 快捷键-1：Markdown 编辑格式化快捷键：支持粗体 `Cmd+B`、斜体 `Cmd+I`、链接 `Cmd+K`、删除线 `Cmd+Shift+X`、高亮 `Cmd+Shift+H`、代码等快捷键。选中文本时光标智能包裹符号对，无选区时光标插入并居中；支持反选/取消格式化。
- 菜单-1：原生 macOS 应用菜单（文件、编辑、格式、查看、窗口、帮助）。规范化 macOS 顶部菜单栏结构，绑定常用快捷键与操作（新建/保存/模式切换/格式化/缩放等），与渲染进程事件双向联动。
- 验收-12：在编辑器中使用 Markdown 格式化快捷键（Cmd+B、Cmd+I、Cmd+K 等），以及通过顶部应用菜单触发文件、编辑、查看与格式化操作均正常响应。

本文用到的词：

- **包裹符号对**：在所选文本前后添加定界符（如 `**`、`*`、`~~`、`==`、反引号、`[]()`）。
- **居中光标**：无选区时插入定界符并将光标置于定界符正中间。
- **反选/取消格式化**：当选中文本已包含定界符，或选区/光标处于定界符内时，触发快捷键将剥除定界符还原为纯文本。
- **原生应用菜单**：macOS 顶栏 Application Menu，包含应用、文件、编辑、格式、查看、窗口与帮助 7 个一级菜单项。

## 4 个可验证单元

按实现与验证顺序排列：

| 单元 | 内容                                                                     | 功能编号 | 依赖 | 证明                                            |
| ---- | ------------------------------------------------------------------------ | -------- | ---- | ----------------------------------------------- |
| A    | Markdown 格式化核心逻辑与单元测试（选区包裹、光标居中、反选/取消格式化） | 快捷键-1 | 无   | 单元测试 `formatting.test.ts`                   |
| B    | CodeMirror 快捷键映射与编辑器集成（`formatKeymap`、`NoteEditor.tsx`）    | 快捷键-1 | A    | 单元测试与编辑器按键响应验证                    |
| C    | 原生 macOS 应用菜单构建与 IPC 事件联动（`src/main/menu.ts`、`ipc.ts`）   | 菜单-1   | A、B | 主进程菜单结构校验与双向通信测试                |
| D    | 全流程端到端验收与验证脚本归档（`verify-step7.mjs`、`menu.spec.ts`）     | 验收-12  | 全部 | `tools/verify-step7.mjs` 实测，features.md 归档 |

```
main ── A 格式化核心 ── B 编辑器快捷键 ── C 应用菜单与IPC ── D 验收与归档
```

---

## 单元 A：Markdown 格式化核心逻辑与单元测试

- 目标：在 `src/renderer/src/editor/formatting.ts` 实现纯函数与 CodeMirror 命令，支持：
  - 粗体（`**`）：`toggleBold`
  - 斜体（`*`）：`toggleItalic`
  - 删除线（`~~`）：`toggleStrikethrough`
  - 高亮（`==`）：`toggleHighlight`
  - 行内代码（反引号）：`toggleInlineCode`
  - 链接（`[text](url)`）：`toggleLink`
  - 代码块（` ``` `）：`insertCodeBlock`
  - 引用（`> `）：`insertQuote`
- 智能包裹与取消逻辑：
  - 有选区：
    - 若选区文本已以定界符开头结尾，或选区两端紧邻定界符，则消除定界符还原为纯文本。
    - 否则包裹定界符；若为链接且选中文本为网址，自动生成 `[](url)` 并将光标置于中括号内。
  - 无选区：
    - 若光标恰处于成对定界符中央（如 `**|**`），再次按下快捷键直接删除定界符。
    - 若光标位于已格式化单词内部，反选取消外层定界符。
    - 否则插入成对定界符并将光标置于正中央。
- 验证：编写 `src/renderer/src/editor/formatting.test.ts` 覆盖全部 8 类格式化命令的有选区包裹、无选区居中及反选消除。

---

## 单元 B：CodeMirror 快捷键映射与编辑器集成

- 目标：定义 `formatKeymap` 并集成至 `NoteEditor.tsx` 与全局菜单调度器。
- 快捷键映射：
  - `Mod-b`：粗体
  - `Mod-i`：斜体
  - `Mod-k`：插入链接
  - `Mod-Shift-x` / `Mod-Shift-s`：删除线
  - `Mod-Shift-h`：高亮
  - `Mod-` `/`Mod-Shift-c`：行内代码
  - `Mod-Alt-c`：代码块
  - `Mod-Shift-.`：引用
- 验证：`npm run typecheck` 与 `npm test` 全绿。

---

## 单元 C：原生 macOS 应用菜单构建与 IPC 事件联动

- 目标：在 `src/main/menu.ts` 独立实现完整的 macOS 应用菜单规范，通过 IPC 与渲染进程双向联动。
- 菜单结构：
  - `mote`（应用级）：关于、检查更新、设置、隐藏、退出。
  - 文件：新建笔记（`Cmd+N`）、快速打开（`Cmd+O` / `Cmd+P`）、保存（`Cmd+S`）、在访达中显示、关闭笔记（`Cmd+W`）。
  - 编辑：撤销、重做、剪切、复制、粘贴、全选、笔记库全局搜索（`Cmd+Shift+F`）。
  - 格式：粗体（`Cmd+B`）、斜体（`Cmd+I`）、删除线（`Cmd+Shift+X`）、高亮（`Cmd+Shift+H`）、行内代码（`` Cmd+` ``）、插入链接（`Cmd+K`）、代码块（`Cmd+Alt+C`）、引用（`Cmd+Shift+.`）。
  - 查看：切换编辑/阅读模式（`Cmd+E`）、切换侧边栏（`Cmd+\`）、切换字体（`Cmd+Shift+K`）、切换主题（`Cmd+Shift+D`）、缩放控制。
  - 窗口：最小化、缩放、前置全部。
  - 帮助：快捷键指南、GitHub 仓库、汇报问题。
- IPC 联动：
  - `src/core/ipc.ts` 补充 `MenuAction` 联合类型与 `channels.menuAction` 通道。
  - `src/preload/index.ts` 暴露 `onMenuAction`。
  - `src/renderer/src/App.tsx` 监听菜单动作并派发至当前聚焦编辑器或全局视图。

---

## 单元 D：全流程端到端验收与验证脚本归档

- 目标：编写 `tools/verify-step7.mjs` 验证脚本与 E2E 测试 `tests/e2e/menu.spec.ts`。
- 验证项：
  - 快捷键触发粗体、斜体、链接、删除线、高亮、代码包裹与反向取消。
  - 菜单项触发文件新建、保存、搜索、格式化及视图切换。
  - 更新 `docs/features.md` 状态与证据。
