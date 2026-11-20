# 0001 技术选型

- 状态：已实现
- 日期：2026-11-20

## 背景

mote 要在 Mac 上替换 Obsidian，日常读写任何一个 Obsidian 笔记库。只打开、不修改的笔记，字节必须不变。

## 决定

版本号是 2026-11-20 运行 `npm view <包名> version` 查到的最新版本。现在用的版本以 `package.json` 为准。

| 部分 | 选择 | 版本 | 理由 |
| --- | --- | --- | --- |
| 外壳 | Electron | 44.11 | Obsidian 用的也是它。版本跟 electron-vite 模板走，45.x 以后再升 |
| 构建 | electron-vite | 6.0.0 | 一套配置同时构建主进程、preload 和渲染进程 |
| 打包 | electron-builder | 26.18.0 | 只打本机自用的 `.app`，不签名 |
| 语言 | TypeScript，严格模式 | 5.9 | electron-vite 模板用的版本。7.x 等工具链跟上再升级 |
| 界面 | React | 19.3.1 | 编辑器以外的部分：文件树、面板、弹窗 |
| 编辑器 | CodeMirror 6 + `@lezer/markdown` | 6.43.15 / 1.8.1 | 直接编辑原文，不重写文件。Obsidian 用的也是它 |
| 文件监听 | Node `fs.watch`，`recursive: true` | Node 内置 | 实测通知延迟 11 毫秒，不需要原生模块 |
| 日期格式 | moment | 2.31.0 | `daily-notes.json` 的格式串就是 moment 格式，用同一个库才能完全一致 |
| Mermaid | mermaid，用到时才加载 | 12.3.0 | 体积大，只有 1 篇笔记用到 |
| 单元测试 | Vitest | 5.1.1 | 测 `src/core` 里的纯函数 |
| 端到端测试 | Playwright 的 Electron 模式 | 1.65.1 | 跑验收清单 |

不用的东西：

- **不用 ProseMirror 系的所见即所得编辑器**，比如 Milkdown、TipTap。它们把 Markdown 解析成文档树，保存时再重新生成文本。这样一打开就可能改动字节。
- **不用数据库。** 每次打开笔记库时重建索引，mote 的设置存成 JSON 文件。

## 后果

- 索引每次打开笔记库都重建。如果 1 万篇笔记的笔记库打开超过 2 秒，就把索引移到 Electron 的 `utilityProcess`。`src/core` 不引用 Electron，所以只需要移动调用的地方。
