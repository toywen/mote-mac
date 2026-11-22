# 0015. 原生应用菜单与 Markdown 格式化快捷键

- 状态：已实现
- 日期：2026-11-21

## 背景

mote 作为 Mac 原生笔记应用，在 Markdown 日常编辑时，需要满足高频文本格式化快捷键操作（粗体、斜体、链接、删除线、高亮、代码等）。同时，符合 macOS 人机交互指南（HIG）的顶栏应用菜单是原生应用的基本要求，用户不仅可以通过快捷键操作，还可以通过顶部菜单栏浏览、发现并触发各项功能。

## 决定

1. **Markdown 格式化核心与快捷键**：
   - 在渲染进程编辑器层实现纯函数与 CodeMirror 命令（`toggleBold`, `toggleItalic`, `toggleLink`, `toggleStrikethrough`, `toggleHighlight`, `toggleInlineCode`, `insertCodeBlock`, `insertQuote`）。
   - 智能包裹：有选区时包裹定界符；若已包含定界符或两端紧邻定界符，反选取消格式化还原纯文本；若选区为网址，生成 `[](url)` 且光标居于中括号。
   - 智能光标：无选区时插入定界符并将光标置于正中央；若光标处于成对定界符中央，再次按下直接删除定界符。
   - 绑定标准快捷键：`Cmd+B`（粗体）、`Cmd+I`（斜体）、`Cmd+K`（链接）、`Cmd+Shift+X`/`Cmd+Shift+S`（删除线）、`Cmd+Shift+H`（高亮）、`` Cmd+` ``/`Cmd+Shift+C`（行内代码）、`Cmd+Alt+C`（代码块）、`Cmd+Shift+.`（引用）。
2. **原生 macOS 应用菜单**：
   - 在主进程规范化构建完整的 macOS 7 项一级应用菜单（`mote` 应用菜单、文件、编辑、格式、查看、窗口、帮助）。
   - 区分原生角色与自定义动作：剪切/复制/粘贴/撤销/缩放/全屏使用 Electron 内建原生 role；新建/保存/搜索/模式切换/主题与字体切换/格式化命令通过 `mote:menu-action` IPC 通道向渲染进程广播。
   - 渲染进程统一监听 `mote:menu-action`，通过 `EditorView.findFromDOM` 定位活跃编辑器并派发对应格式化命令，实现双向无缝联动。
3. **笔记内容区右键菜单与列表格式扩展**：
   - 在编辑器与阅读模式集成上下文菜单（`contextmenu`），支持剪切、复制、粘贴、全选、格式化与模式切换。根据选区及只读状态动态禁用不可用项。
   - 扩充行级列表格式化能力，支持 `toggleBulletList`（无序列表）与 `toggleTaskList`（待办任务），绑定 `Cmd+Enter` 触发待办三态循环（未完成、已完成、取消）。并在顶栏「格式」菜单中同步提供对应入口。

## 理由

- 格式化逻辑作为纯 CodeMirror 命令独立封装，可纯测试脱离 Electron 窗口在 Node/Vitest 中快速验证，保证逻辑鲁棒。
- 原生菜单与 CodeMirror 快捷键复用同一套格式化逻辑，避免重复逻辑与状态分叉。
- 遵循 macOS HIG 规范，保证快捷键与顶部菜单体验与 Obsidian 及 Mac 原生应用一致。
