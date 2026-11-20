# mote 架构

本文写 mote 现在的结构和不能破坏的规则。术语见 [CONTEXT.md](CONTEXT.md)。为什么这样选，见 [docs/adr](docs/adr/)。功能和进度见 [docs/features.md](docs/features.md)。

本文只写不常变的东西。类型和接口以代码为准，这里只写它们在哪个文件。

## 总体结构

```
┌──────────────── mote（Electron）────────────────┐
│ 渲染进程：React 界面 + CodeMirror 6 编辑器        │
│   持有：打开的笔记的编辑状态、笔记路径列表的副本     │
│        │ IPC，接口定义在 src/core/ipc.ts          │
│        ▼                                         │
│ 主进程：Node                                      │
│   持有：磁盘读写、文件监听、笔记库索引               │
└────────┬─────────────────────────────────────────┘
         ▼
   笔记库文件夹  ◀── Obsidian、git、Claude 也会读写
         │
   mote 同步模块：第 7 步再做，见 ADR 0005
         ▼
   mote 同步服务  ◀── 以后的 iOS 版和 Claude 连接器也连这里
```

## 模块地图

| 目录或文件 | 负责什么 |
| --- | --- |
| `src/core/` | 纯 TypeScript，主进程和渲染进程共用。不能引用 Electron |
| `src/core/ipc.ts` | 库内路径、笔记库配置、`MoteApi` 接口和 IPC 通道名。IPC 的唯一定义 |
| `src/core/text.ts` | 规范化文本：去掉 BOM，换行统一成 `\n`。链接位置都指向规范化文本 |
| `src/core/markdown.ts` | 唯一的解析器配置（`@lezer/markdown` 加双链、嵌入、属性块），从笔记里提取链接 |
| `src/core/resolve.ts` | 链接解析，照搬 Obsidian 的 `getLinkpathDest` |
| `src/core/linkText.ts` | 新链接的文字，照搬 Obsidian 的 `fileToLinktext` 和它 `[[` 列表插入的文字。按笔记库配置选双链或 Markdown 链接，以及最短、相对、绝对路径 |
| `src/core/model.ts` | 链接和解析结果的类型 |
| `src/core/search.ts` | 全文搜索：分词、引号短语、不分大小写的子串匹配、按文件名排序 |
| `src/core/hits.ts` | 命中位置的预览行和按笔记分组 |
| `src/core/noteIndex.ts` | 笔记索引：每篇笔记的规范化文本和链接，反向链接查询。不缓存反向链接，每次查询重新解析 |
| `src/main/index.ts` | 窗口、IPC 处理、mote 自己的设置（`~/Library/Application Support/mote/settings.json`） |
| `src/main/vault.ts` | 打开笔记库、读取笔记库配置、监听外部修改、按哈希读写笔记 |
| `src/main/notes.ts` | 扫描文件和读取笔记。不引用 Electron，`tools/` 里的脚本也直接用它 |
| `src/preload/` | 用 `contextBridge` 暴露 `window.mote` |
| `src/renderer/src/workspace.ts` | 渲染进程的状态：当前笔记库、打开的笔记和它的状态机 |
| `src/renderer/src/NoteEditor.tsx` | CodeMirror 编辑器，把规范化文本还原成原始字节 |
| `src/renderer/src/editor/markdown.ts` | 编辑器用的语言。用共享的解析器，只加两个编辑器才读的节点属性。回车接着写列表和引用 |
| `src/renderer/src/editor/livePreview.ts` | 实时预览的唯一字段：每次改动遍历一次语法树，再按显示源码的规则画装饰。编辑器模式和链接解析的输入也在这里 |
| `src/renderer/src/editor/preview.ts` | 实时预览的数据结构：一个元素的显示源码范围、一直生效的装饰、隐藏源码时才生效的装饰 |
| `src/renderer/src/editor/renderers.ts` | 语法节点名到渲染函数的注册表。加一种元素，就加一个文件，在这里注册一行 |
| `src/renderer/src/editor/inline.ts`、`headings.ts`、`links.ts`、`lists.ts`、`quotes.ts`、`code.ts` | 各种元素的渲染函数。`inline.ts` 的 `inlineStyles` 是行内样式表，表格单元格以后也读它 |
| `src/renderer/src/editor/preview.css` | 实时预览的样式。颜色只用 `main.css` 里的变量 |
| `src/renderer/src/editor/complete.ts`、`complete.css` | 双链补全：输入 `[[` 后列出笔记，候选用快速打开的 `quickOpenMatch.ts` 排序，插入 `linkText.ts` 生成的链接。笔记列表、最近打开和笔记库配置从 `completeContext` 读 |
| `src/renderer/src/FileTree.tsx` | 文件树 |
| `src/renderer/src/QuickOpen.tsx`、`quickOpenMatch.ts` | 快速打开窗口和照搬 Obsidian 的匹配打分 |
| `src/renderer/src/HitList.tsx` | 按笔记分组列出命中位置，点一处打开笔记并选中。反向链接面板和搜索共用 |
| `src/renderer/src/SearchPanel.tsx` | 左侧栏的搜索视图 |
| `tools/` | 审计笔记库、哈希对比、性能测量等命令行工具 |
| `tests/e2e/` | Playwright 的 Electron 测试 |
| `tests/fixtures/vaults/` | 测试笔记库 |

以后会加的模块写在对应步骤的计划里，例如 [step-2.md](docs/plans/step-2.md)。

## 状态的持有者

每份状态只有一个持有者。不要加第二份两边都写的副本。

- 磁盘和索引归主进程。主进程先更新索引，再通知渲染进程，mote 自己保存的笔记也一样。
- 渲染进程里的反向链接列表是向主进程查询的结果，只读。切换笔记、收到笔记库变化、保存成功后重新查询。
- 渲染进程里的搜索结果也是查询结果，只读。查询词改变、收到笔记库变化、保存成功后重新查询。
- 正在编辑的文字归渲染进程。
- 渲染进程里的笔记路径列表是主进程推过来的副本，只读。
- 最近打开的笔记列表归渲染进程，按笔记库存在 `localStorage`。
- 编辑器模式归渲染进程的 `workspace`。整个窗口一个值，切换笔记时不变。编辑器只读它。
- 渲染进程用笔记路径列表的副本建链接解析用的索引。它是算出来的结果，不是新的状态。

## 一篇打开的笔记的状态

渲染进程用一个状态机管理打开的笔记，不用多个布尔值。定义在 `src/renderer/src/workspace.ts`。

| 当前状态 | 事件 | 下一个状态 |
| --- | --- | --- |
| clean | 你输入 | dirty |
| clean | 外部修改 | 重新读取，仍是 clean |
| dirty | 停止输入，或切换笔记、退出 | saving |
| saving | 写入成功 | clean，基准哈希换成新哈希 |
| saving | 主进程报告磁盘哈希和基准哈希不同 | conflict |
| dirty | 外部修改 | conflict |
| conflict | 你选了保留哪份 | saving |
| 任意 | 磁盘上的文件被删除 | missing |

## 不变式

下面的规则任何改动都不能破坏。

**笔记库**
- 只在两种情况下写笔记库：保存你编辑过的笔记，执行改名或移动。
- 从不写 `.obsidian`。只读笔记库配置，缺的字段用 Obsidian 的默认值。
- mote 自己的设置和 journal 存在 `~/Library/Application Support/mote`，不存在笔记库里。
- 忽略所有以 `.` 开头的文件和文件夹。`parseVaultPath` 拒绝这类路径。

**字节不变**
- 只打开、不修改的笔记，文件字节不变。
- 只有状态是 dirty 时才写盘。
- 编辑器里是规范化文本。保存时还原原始 BOM 和各行的换行符，新增的换行沿用文件首个换行的格式。
- 保存直接覆盖原文件，不写临时文件再改名。改名会换掉文件的创建时间，Obsidian 按创建时间排序时会乱。

**冲突**
- 每次保存都比较磁盘哈希和基准哈希。不同时进入冲突，不覆盖。

**外部修改**
- 主进程用 `fs.watch` 递归监听整个笔记库，忽略以 `.` 开头的路径。
- mote 自己刚保存的文件，比较磁盘哈希后过滤重复通知。

**解析和渲染**
- 编辑器、索引和改名用同一份 `@lezer/markdown` 配置。见 ADR 0002。
- 阅读模式是关掉编辑的同一个 CodeMirror 视图，不是第二个渲染器。
- 编辑器的语言用 `markdownParser.configure` 加节点属性，不加语法。所以编辑器和索引得到的语法树相同。
- 实时预览只有一个字段画装饰。显示源码的规则只写在 `livePreview.ts`：实时预览下、编辑器有焦点、选区碰到元素的范围。阅读模式下从不显示源码。
- 链接解析以 Obsidian 的 `app.metadataCache.resolvedLinks` 为准，不靠猜。见 ADR 0003。
- 全文搜索在内存里做子串匹配。见 ADR 0004。

**安全**
- `contextIsolation: true`，`nodeIntegration: false`，`sandbox: true`。
- 渲染进程只能通过 `window.mote` 访问磁盘。
