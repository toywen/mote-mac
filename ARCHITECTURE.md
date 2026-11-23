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
   mote 同步模块：src/main/sync.ts，还没接进窗口，见同步-1、step-10.md
         ▼
   mote 同步服务（独立仓库 mote-sync）  ◀── 以后的 iOS 版也连这里
```

## 模块地图

| 目录或文件                                                                                         | 负责什么                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`                                                                                        | 纯 TypeScript，主进程和渲染进程共用。不能引用 Electron                                                                                                                                                  |
| `src/core/ipc.ts`                                                                                  | 库内路径、笔记库配置、`MoteApi` 接口和 IPC 通道名。IPC 的唯一定义                                                                                                                                       |
| `src/core/text.ts`                                                                                 | 规范化文本：去掉 BOM，换行统一成 `\n`。链接位置都指向规范化文本                                                                                                                                         |
| `src/core/markdown.ts`                                                                             | 唯一的解析器配置（`@lezer/markdown` 加双链、嵌入、属性块），从笔记里提取链接。`calloutHeader` 判断一个引用是不是 callout，读出类型和标题                                                                |
| `src/core/resolve.ts`                                                                              | 链接解析，照搬 Obsidian 的 `getLinkpathDest`                                                                                                                                                            |
| `src/core/linkText.ts`                                                                             | 新链接的文字，照搬 Obsidian 的 `fileToLinktext` 和它 `[[` 列表插入的文字。按笔记库配置选双链或 Markdown 链接，以及最短、相对、绝对路径                                                                  |
| `src/core/linkDest.ts`                                                                             | 链接去向：一个链接点击后去哪里。上色和点击都读它。不存在的笔记的新建路径照搬 Obsidian 的 `openLinkText`。外部网址的白名单也在这里                                                                       |
| `src/core/subpath.ts`                                                                              | `#标题`、`#上级#下级` 和 `#^块` 落在目标笔记的哪一处，照搬 Obsidian 的 `resolveSubpath`                                                                                                                 |
| `src/core/model.ts`                                                                                | 链接和解析结果的类型                                                                                                                                                                                    |
| `src/core/fileUrl.ts`                                                                              | `mote-file://` 地址的唯一定义：库内路径和地址互转，哪些扩展名算图片                                                                                                                                     |
| `src/core/search.ts`                                                                               | 全文搜索：分词、引号短语、不分大小写的子串匹配、按文件名排序                                                                                                                                            |
| `src/core/updaterTypes.ts`                                                                         | 语义化版本解析、对比与更新状态机类型                                                                                                                                                                    |
| `src/core/hits.ts`                                                                                 | 命中位置的预览行和按笔记分组                                                                                                                                                                            |
| `src/core/noteIndex.ts`                                                                            | 笔记索引：每篇笔记的规范化文本和链接，反向链接查询。不缓存反向链接，每次查询重新解析                                                                                                                    |
| `src/core/autosave.ts`                                                                             | 自动保存的两个时间常量。渲染进程和 verify-mote 的脚本都从这里读                                                                                                                                         |
| `src/main/index.ts`                                                                                | 窗口、IPC 处理                                                                                                                                                                                          |
| `src/main/updater.ts`                                                                              | GitHub Releases 检查、流式下载、平滑更新替换脚本生成与 IPC 处理                                                                                                                                         |
| `src/main/vault.ts`                                                                                | 打开笔记库、读取笔记库配置、监听外部修改、按哈希读写笔记。给同步模块列出文件、按字节读写、转发文件监听                                                                                                  |
| `src/main/vaultFs.ts`                                                                              | 改动笔记库文件的唯一模块。`locate` 和 `ensureFolder` 给出 `InVault` 路径，路上的文件夹是符号链接就拒绝。新建、覆盖、移动都只收 `InVault`。lint 禁止别的文件引入会写盘的 `fs` 函数                       |
| `src/main/appData.ts`                                                                              | mote 自己的文件：机器级设置和改名 journal，都在 `~/Library/Application Support/mote`                                                                                                                    |
| `src/main/fileProtocol.ts`                                                                         | `mote-file://` 的处理函数。只返回当前笔记库里的图片文件                                                                                                                                                 |
| `src/main/notes.ts`                                                                                | 扫描文件和读取笔记。不引用 Electron，`tools/` 里的脚本也直接用它                                                                                                                                        |
| `src/main/sync.ts`                                                                                 | 同步模块：上传、下载、合并、冲突文件、删除保护、断线重连。只经 `Vault` 读写笔记库。不引用 Electron，`tools/sync-sim.mjs` 直接跑它                                                                       |
| `src/main/syncRemote.ts`                                                                           | 同步服务的客户端：HTTPS 请求和 WebSocket，两处都做证书固定。`Remote` 接口让测试换成假的同步服务                                                                                                         |
| `src/main/syncState.ts`                                                                            | 同步状态表的读写。先写临时文件再改名，读不出或属于别的服务器时当作空表                                                                                                                                  |
| `src/preload/`                                                                                     | 用 `contextBridge` 暴露 `window.mote`                                                                                                                                                                   |
| `src/renderer/src/workspace.ts`                                                                    | 渲染进程的状态：当前笔记库、多标签页列表、打开的笔记和它的状态机                                                                                                                                        |
| `src/renderer/src/NoteEditor.tsx`                                                                  | CodeMirror 编辑器，把规范化文本还原成原始字节                                                                                                                                                           |
| `src/renderer/src/editor/markdown.ts`                                                              | 编辑器用的语言。用共享的解析器，只加两个编辑器才读的节点属性。回车接着写列表和引用                                                                                                                      |
| `src/renderer/src/editor/livePreview.ts`                                                           | 实时预览的唯一字段：每次改动遍历一次语法树，再按显示源码的规则画装饰。编辑器模式和链接解析的输入也在这里                                                                                                |
| `src/renderer/src/editor/preview.ts`                                                               | 实时预览的数据结构：一个元素的显示源码范围、一直生效的装饰、隐藏源码时才生效的装饰                                                                                                                      |
| `src/renderer/src/editor/renderers.ts`                                                             | 语法节点名到渲染函数的注册表。加一种元素，就加一个文件，在这里注册一行                                                                                                                                  |
| `src/renderer/src/editor/inline.ts`、`headings.ts`、`links.ts`、`lists.ts`、`quotes.ts`、`code.ts` | 各种元素的渲染函数。`inline.ts` 的 `inlineStyles` 是行内样式表，表格单元格也读它                                                                                                                        |
| `src/renderer/src/editor/images.ts`                                                                | 图片和嵌入的渲染函数。图片放在源码下面，既不是图片也不是笔记的嵌入显示为链接。样式在旁边的 `images.css`                                                                                                 |
| `src/renderer/src/editor/preview.css`                                                              | 实时预览的样式。颜色只用 `main.css` 里的变量                                                                                                                                                            |
| `src/renderer/src/editor/complete.ts`、`complete.css`                                              | 双链补全：输入 `[[` 后列出笔记，候选用快速打开的 `quickOpenMatch.ts` 排序，插入 `linkText.ts` 生成的链接。笔记列表、最近打开和笔记库配置从 `completeContext` 读                                         |
| `src/renderer/src/editor/follow.ts`、`follow.css`                                                  | 点击链接：在编辑器的元素上先于 CodeMirror 接住鼠标，按链接去向交给 `workspace.follow`。部件里画的链接也接得到                                                                                           |
| `src/renderer/src/editor/callouts.ts`、`callouts.css`                                              | callout 的渲染函数。占 `Blockquote` 的位置，不是 callout 的引用交给 `quotes.ts`。callout 的种类、别名、颜色和图标是一张表，照搬 Obsidian 1.15.1 的 `app.css`。颜色变量的浅色值和深色值在 `callouts.css` |
| `src/renderer/src/editor/tables.ts`、`tables.css`                                                  | 表格画成一个块级组件。单元格按语法节点画，行内样式读 `inlineStyles`，链接读 `linkTarget`                                                                                                                |
| `src/renderer/src/editor/tasks.ts`、`tasks.css`                                                    | 任务的复选框。点击只改方括号里的 1 个字符。`editorLocked` 是 mote 忙时锁住编辑器的输入                                                                                                                  |
| `src/renderer/src/editor/noteView.ts`                                                              | `noteView()`：一篇笔记的每个视图都用的扩展，即语言、实时预览、点击链接和折行。主编辑器和嵌入都调用它。主编辑器再加编辑、保存和补全                                                                      |
| `src/renderer/src/editor/mermaid.ts`、`mermaid.css`                                                | Mermaid 图的渲染函数。占 `FencedCode` 的位置，不是 `mermaid` 的代码块交给 `code.ts`。Mermaid 库第一次画图时才加载。画好的图按代码和配色缓存                                                             |
| `src/renderer/src/editor/embeds.ts`、`embeds.css`                                                  | 笔记嵌入的渲染函数。占 `WikiEmbed` 的位置，图片、附件和找不到的目标交给 `images.ts`。被嵌入的笔记画在一个只读的嵌套视图里，最多套 3 层                                                                  |
| `src/renderer/src/FileTree.tsx`                                                                    | 文件树                                                                                                                                                                                                  |
| `src/renderer/src/QuickOpen.tsx`、`quickOpenMatch.ts`                                              | 快速打开窗口和照搬 Obsidian 的匹配打分                                                                                                                                                                  |
| `src/renderer/src/HitList.tsx`                                                                     | 按笔记分组列出命中位置，点一处打开笔记并选中。反向链接面板和搜索共用                                                                                                                                    |
| `src/renderer/src/SearchPanel.tsx`                                                                 | 左侧栏的搜索视图                                                                                                                                                                                        |
| `src/renderer/src/UpdateNotification.tsx`                                                          | 应用更新提示横幅与下载/重启更新交互组件                                                                                                                                                                 |
| `tools/`                                                                                           | 审计笔记库、哈希对比、性能测量等命令行工具                                                                                                                                                              |
| `tests/e2e/`                                                                                       | Playwright 的 Electron 测试                                                                                                                                                                             |
| `tests/fixtures/vaults/`                                                                           | 测试笔记库                                                                                                                                                                                              |

以后会加的模块写在对应步骤的计划里，例如 [step-2.md](docs/plans/step-2.md)。

## 状态的持有者

每份状态只有一个持有者。不要加第二份两边都写的副本。

- 磁盘和索引归主进程。主进程先更新索引，再通知渲染进程，mote 自己保存的笔记也一样。
- 渲染进程里的反向链接列表是向主进程查询的结果，只读。切换笔记、收到笔记库变化、保存成功后重新查询。
- 渲染进程里的搜索结果也是查询结果，只读。查询词改变、收到笔记库变化、保存成功后重新查询。
- 嵌入里显示的笔记文字也是查询结果，只读。`workspace.noteText` 不打开笔记，经 `window.mote.readNote` 读磁盘。被嵌入的是正在编辑的笔记时，读编辑器里的文字。`workspace` 的 `revision` 变大时重新读。
- 正在编辑的文字归渲染进程。
- 打开的标签页列表（tabs）归渲染进程的 workspace。
- 渲染进程里的笔记路径列表是主进程推过来的副本，只读。
- 最近打开的笔记列表归渲染进程，按笔记库存在 `localStorage`。
- 编辑器模式归渲染进程的 `workspace`。整个窗口一个值，切换笔记时不变。编辑器只读它。
- 导航历史归渲染进程的 `workspace`。整个窗口一个列表和一个位置。用任何方式打开另一篇笔记都加一项。编辑器只报告光标，后退和前进时 `workspace` 把光标放回去。
- 渲染进程用笔记路径列表的副本建链接解析用的索引。它是算出来的结果，不是新的状态。

## 一篇打开的笔记的状态

渲染进程用一个状态机管理打开的笔记，不用多个布尔值。定义在 `src/renderer/src/workspace.ts`。`src/renderer/src/workspace.check.ts` 穷举事件顺序检查它，用法见 `.claude/skills/verify-open-note/SKILL.md`。

| 当前状态 | 事件                                   | 下一个状态                                        |
| -------- | -------------------------------------- | ------------------------------------------------- |
| clean    | 你输入                                 | dirty                                             |
| clean    | 外部修改                               | 重新读取，仍是 clean                              |
| dirty    | 停止输入，或切换笔记、退出             | saving                                            |
| saving   | 写入成功                               | clean，基准哈希换成新哈希。期间又输入了就是 dirty |
| saving   | 主进程报告磁盘哈希和基准哈希不同       | conflict                                          |
| saving   | 写盘出错                               | dirty，显示错误和「重试保存」                     |
| dirty    | 外部修改                               | conflict                                          |
| conflict | 你选了保留哪份                         | saving                                            |
| 任意     | 主进程改名或移动了这篇笔记（任何窗口） | 状态、文字和打开会话不变，只换路径                |
| saving   | 写入在改名前发出，旧路径上找不到文件   | 按新路径重发，仍是 saving                         |
| 任意     | 磁盘上的文件被删除                     | missing                                           |

保存的回复只交给发起它的打开会话。改名经主进程的笔记库变化（`VaultChange.renamed`）通知每个窗口，不由文件树直接改路径。保存进行中又要保存时，排在它后面，不丢弃。

## 不变式

下面的规则任何改动都不能破坏。

**笔记库**

- 遵循 mote 独立笔记库规范，使用库内 `.mote/` 专属目录组织配置与资源。见 ADR 0017。
- 粘贴、拖拽或插入的新附件，集中保存到 `.mote/attachments/`，保证笔记库根目录与用户目录整洁。
- 库级配置保存在 `.mote/settings.json`，工作区状态保存在 `.mote/workspace.json`。从不写 `.obsidian`。
- mote 机器级全局设置和 journal 存在 `~/Library/Application Support/mote`。
- 只在这些情况下改动笔记库：保存你编辑过的笔记，改名或移动，新建笔记或文件夹，存入新附件，把文件移到废纸篓，同步模块写入或删除同步来的文件。同步模块的写入用 `Vault.writeFile`，删除用 `Vault.trash`，两者都先比较基准哈希。每一种都经过 `src/main/vaultFs.ts`，它不穿过符号链接。`src/main/vault.test.ts` 对 `Vault` 的每个公开方法检查这一条。
- 新建笔记只建空的 `.md` 文件，路径要通过 `parseVaultPath`。缺的文件夹从笔记库根目录起逐级新建，已有的必须是真的文件夹，不穿过符号链接。文件用 `O_CREAT | O_EXCL` 新建，已经存在就直接打开，不覆盖。主进程先更新条目和索引，再通知渲染进程。
- 除 `.mote/attachments/` 外，忽略所有以 `.` 开头的文件和文件夹。`parseVaultPath` 拒绝其他以 `.` 开头的路径。文件树对用户自动隐藏 `.mote/`。

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
- 阅读模式是关掉编辑的同一个 CodeMirror 视图，不是第二个渲染器。它不能输入，但能拿焦点，所以从搜索或反向链接跳过去时会显示选中的文字。
- 嵌入的笔记画在嵌套的 CodeMirror 视图里，扩展来自同一个 `noteView()`，编辑器模式固定为阅读模式。它不拿焦点，没有历史，不保存。
- 编辑器的语言用 `markdownParser.configure` 加节点属性，不加语法。所以编辑器和索引得到的语法树相同。
- 实时预览只有一个字段画装饰。显示源码的规则只写在 `livePreview.ts`：实时预览下、编辑器有焦点、选区碰到元素的范围。阅读模式下从不显示源码。
- 链接解析以 Obsidian 的 `app.metadataCache.resolvedLinks` 为准，不靠猜。见 ADR 0003。
- 全文搜索在内存里做子串匹配。见 ADR 0004。

**安全**

- `contextIsolation: true`，`nodeIntegration: false`，`sandbox: true`。
- 渲染进程只能通过 `window.mote` 和 `mote-file://` 访问磁盘。`mote-file://` 只读图片，笔记只走 `window.mote`。
- `mote-file://vault/<库内路径>` 只返回当前笔记库里的图片文件。它拒绝 `..` 和除 `.mote/attachments/` 外以 `.` 开头的部分、符号链接、笔记、别的主机和非 GET 请求，拒绝时不返回任何字节。见 ADR 0007、0017。
- 内容安全策略只放开图片：`img-src` 允许 `mote-file:` 和 `https:`，不允许 `http:`。
- `mote-file://` 的每个响应都带 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` 和 `nosniff`。SVG 是文档，这样它即使被当成页面打开，里面的脚本也不运行。
- 窗口只显示 mote 自己的页面。主进程拦下所有去别的地址的跳转，因为跳到的页面会拿到 `window.mote`。`window.open` 也只把白名单里的网址交给系统。
- 点击链接时，主进程只把 `http`、`https` 和 `mailto` 网址交给系统。主进程是边界，所以它自己再查一遍白名单。
- Mermaid 的 `securityLevel` 是 `strict`，图里的文字过一遍 DOMPurify，点击回调不生效。Mermaid 不需要放宽内容安全策略。
