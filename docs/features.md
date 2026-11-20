# mote 功能列表

这是 mote 目标、范围、功能和进度的唯一来源。术语见 [CONTEXT.md](../CONTEXT.md)，技术决策见 [adr/](adr/)。

## 目标

mote 第一版在 Mac 上替换 Obsidian。它能打开任何一个 Obsidian 笔记库，用来日常读写。

`~/life-os` 是主要的测试笔记库，另外 4 个本机笔记库做补充测试。

验收标准是你连续一周记笔记，不需要打开 Obsidian，见验收-7。

## 进度一览

✅ 已实现　🟡 部分　⬜ 未实现　💤 未排期　🚫 不做

优先级：P0 是第一版必须有的，按步骤号从小到大做。P1 等第一版完成后再排。每一步的检查通过，才做下一步。

| 优先级 | 步骤 | 内容 | 状态 | 完成检查 |
| --- | --- | --- | --- | --- |
| P0 | 0 | 骨架、`tools/hash-vault.mjs` | ✅ 已完成 | 空窗口能启动 |
| P0 | 1 | 打开笔记库、文件树、纯文本编辑、保存、外部修改 | ✅ 已完成，验收-4 未测 | 验收-1、验收-4 |
| P0 | 2 | 解析器、索引、链接解析、反向链接、快速打开、全文搜索 | ✅ 已完成（2026-11-20） | 验收-2 的解析部分 |
| P0 | 3 | 实时预览、阅读模式、深色模式、点击链接 | 🟡 进行中（2026-11-20 开始），计划见 [step-3.md](plans/step-3.md) | 用 5 个笔记库人工检查；验收-2 的点击部分 |
| P0 | 4 | 新建、改名、移动、删除 | ⬜ 未开始 | 验收-3 |
| P0 | 5 | 日记、性能 | ⬜ 未开始 | 验收-5、验收-6 |
| P0 | 6 | 试用一周 | ⬜ 未开始 | 验收-7。试用期间让 Obsidian 在后台开着，obsidian-git 才会继续备份 `~/life-os` |
| P0 | 7 | 同步 | ⬜ 未开始 | 见同步-1 |
| P1 | — | 标签页、表格编辑、属性面板等 9 项 | 💤 未排期 | — |

已完成的步骤里还有 🟡 项，见下面各步的表。每一步的实现计划在 [plans/](plans/)，例如 [step-3.md](plans/step-3.md)。

## 第 1 步：打开笔记库和纯文本编辑

| 状态 | 编号 | 功能 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| ✅ 已实现 | 界面-1 | 三栏布局：左边文件树，中间编辑器，右边反向链接 | 测试：the main window shows the three panes；verify：app-shell | 反向链接栏内容见链接-7 |
| ✅ 已实现 | 界面-3 | 收起和展开文件树 | 测试：long file trees preserve the vault name and can be collapsed | |
| ✅ 已实现 | 笔记库-1 | 打开任意一个文件夹作为笔记库 | verify：open-vault | |
| 🟡 部分 | 笔记库-2 | 记住最近打开的笔记库，可以在它们之间切换。下次启动时打开上次的笔记库 | 测试：edits preserve source bytes, save on navigation and quit, and the vault reopens | 只记住上次的笔记库。没有最近列表，切换要重新选文件夹 |
| ✅ 已实现 | 笔记库-3 | 忽略所有以 `.` 开头的文件和文件夹，和 Obsidian 一致 | 测试：edits preserve source bytes…；verify：open-vault | |
| 🟡 部分 | 笔记库-4 | 读取笔记库配置，从不修改。用到链接格式、改名时是否更新链接、新笔记位置和日记设置。没有配置时用 Obsidian 的默认值 | verify：open-vault（vault-readonly-config） | 已读取和填默认值，还没有功能用到这些配置 |
| ✅ 已实现 | 笔记库-5 | mote 不在笔记库里写自己的文件。设置存在 `~/Library/Application Support/mote` | verify：open-vault、app-shell（vault-diff） | |
| 🟡 部分 | 笔记库-6 | 外部修改后立即显示新内容，目标 100 毫秒以内 | 测试：external saves refresh clean notes and keep both sides of a conflict；verify：external-change | 功能已实现，100 毫秒的延迟没测过 |
| ✅ 已实现 | 笔记库-7 | 正在编辑的笔记被外部修改时，不覆盖，提示你选择保留哪一份 | 测试：external saves refresh clean notes and keep both sides of a conflict；verify：external-change | |
| ✅ 已实现 | 文件树-1 | 显示文件夹和全部文件，文件夹可以折叠 | 测试：long file trees preserve the vault name and can be collapsed；verify：open-vault | |
| 🟡 部分 | 文件树-2 | 点击笔记，在编辑器里打开。点击附件，用 macOS 的默认程序打开 | verify：open-vault | 打开笔记已验证。打开附件有代码，没有测试 |
| ✅ 已实现 | 编辑器-7 | 停止输入后自动保存。切换笔记和退出时也先保存 | 测试：edits preserve source bytes…；verify：edit-and-save | |
| ✅ 已实现 | 编辑器-8 | 只打开、不修改的笔记，字节不变 | 测试：edits preserve source bytes…；verify：edit-and-save | 覆盖 CRLF、BOM 和无结尾换行 |

## 第 2 步：链接解析、反向链接和查找

| 状态 | 编号 | 功能 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| ✅ 已实现 | 链接-5 | 支持 `[[笔记\|别名]]` | Vitest：splits wikilinks into target, subpath and alias；测试：live preview hides syntax away from the selection and shows it at the selection；verify：live-preview | 2026-11-20 第 3 步 PR B。实时预览只显示别名，选区碰到时显示整个链接 |
| ✅ 已实现 | 链接-6 | 链接解析和 Obsidian 一致 | `npm test`（links 测试笔记库对照）；`node tools/compare-links.mjs ~/mote-link-check/*-copy`，5 个副本 2171 处 0 不一致，输出在 `docs/plans/compare-log/` | 2026-11-20。规则照搬 Obsidian 1.15.1，见 ADR 0003、0008、0009。反向链接面板用到解析结果 |
| ✅ 已实现 | 链接-7 | 右侧面板列出当前笔记的反向链接，两种链接都算 | 测试：the backlinks pane lists links to the open note and jumps to them；verify：backlinks（5 个副本 810 篇笔记逐篇对照 Obsidian，1923 处 0 不一致） | 2026-11-20。嵌入和属性里的链接也算，和 Obsidian 的 resolvedLinks 一致。来源按路径排序，Obsidian 按文件名 |
| ✅ 已实现 | 查找-1 | `Cmd+O` 按文件名快速打开笔记 | 测试：quick open ranks notes like Obsidian and lists recent notes for an empty query；verify：quick-open | 2026-11-20。规则照搬 Obsidian 1.15.1，见 step-2.md PR A。结果顺序还没和 Obsidian 的快速打开并排对照过，要你在 Obsidian 里看一次 |
| ✅ 已实现 | 查找-2 | `Cmd+Shift+F` 全文搜索。点击结果，跳到匹配的位置 | 测试：search finds notes by body and file name, jumps to matches, and follows changes；verify：search（`workspace-copy` 4 个查询和 grep 计数一致） | 2026-11-20。规则见 step-2.md PR D，做法见 ADR 0004。不做 `path:`、`tag:`、正则、`OR`、`-`。结果顺序还没和 Obsidian 的搜索面板对照过 |
| ✅ 已实现 | 查找-3 | 快速打开和全文搜索都支持中文 | 测试：quick open ranks notes like Obsidian…；search finds notes by body and file name… | 2026-11-20。全文搜索用子串匹配，输入法选字期间不搜索 |

## 第 3 步：实时预览、阅读模式和点击链接

| 状态 | 编号 | 功能 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| ✅ 已实现 | 界面-2 | 跟随 macOS 的浅色和深色模式 | 测试：the window follows the system color scheme；verify：dark-mode | 2026-11-20 第 3 步 PR B。窗口底色由主进程按 `nativeTheme` 设置，打开时不闪白。正文对比度：深色 12.26，浅色 15.91。切换用 `nativeTheme` 模拟，没在 macOS 的系统设置里切过 |
| 🟡 部分 | 编辑器-1 | 实时预览渲染标题、粗体、斜体、`==高亮==`、行内代码、标签、双链、Markdown 链接、任务和图片 | 测试：live preview hides syntax away from the selection and shows it at the selection；images load from the vault and nothing outside it；verify：live-preview、images | 2026-11-20 第 3 步 PR B 做了标题、粗体、斜体、删除线、高亮、行内代码、标签、双链、Markdown 链接、网址、列表、引用、分隔线和代码块。PR D 做了图片，见编辑器-2。任务复选框在 PR E，现在显示源码 |
| ✅ 已实现 | 编辑器-2 | 图片支持 `![](路径)` 和 `![[图片名]]` | 测试：images load from the vault and nothing outside it；Vitest：fileUrl and parseFileUrl；verify：images | 2026-11-20 第 3 步 PR D。两种编辑器模式都显示图片。选区碰到时，源码在上，图片在下。`\|300` 和 `\|300x200` 设宽高，规则照搬 Obsidian 1.15.0。图片不比编辑器宽。找不到或加载失败的图片显示文件名。本地图片走 `mote-file://`，见 ADR 0007。`https` 图片直接加载，`http` 图片被内容安全策略拦下。不是图片的嵌入暂时显示为链接，笔记嵌入在 PR F |
| ⬜ 未实现 | 编辑器-3 | 实时预览里的 callout 显示为带颜色和标题的块 | | |
| ⬜ 未实现 | 编辑器-4 | 实时预览把表格渲染成表格。光标移进表格时显示 Markdown 源码 | | |
| ⬜ 未实现 | 编辑器-5 | 点击任务复选框，切换完成状态 | | |
| ✅ 已实现 | 编辑器-6 | 属性显示为 YAML 代码块，可以直接编辑 | 测试：live preview hides syntax away from the selection and shows it at the selection；verify：live-preview | 2026-11-20 第 3 步 PR B。等宽字体加底色。选区碰到属性块时显示 `---` |
| 🟡 部分 | 编辑器-9 | `Cmd+E` 切到阅读模式。完整渲染表格、callout、Mermaid 图和 `![[笔记名]]` 嵌入 | 测试：Cmd+E switches to reading mode and back；verify：live-preview | 2026-11-20 第 3 步 PR B 做了 `Cmd+E` 和标题栏按钮。整个窗口一个编辑器模式，切换笔记时不变。表格和 callout 在 PR E，Mermaid 和嵌入在 PR F，现在显示源码 |
| 🟡 部分 | 链接-1 | 点击双链或 Markdown 链接，跳到目标。带 `#标题` 时跳到这个标题 | 测试：clicking a link opens its target and Cmd+Option+Left goes back；verify：follow-links | 2026-11-20 第 3 步 PR C。没有显示源码的链接单击就跳，`Cmd+单击` 任何时候都跳。标题和块的位置照搬 Obsidian 的 `resolveSubpath`，6 个副本 233 处 0 不一致。真实窗口逐个点击在 `links-copy` 和 `life-os-copy` 上 0 不一致，另外 4 个副本在 PR H |
| ✅ 已实现 | 链接-2 | 目标不存在的双链用不同颜色显示。点击它，新建这篇笔记 | 测试：clicking a missing link creates the note where the vault config says；verify：follow-links | 2026-11-20 第 3 步 PR B 做了颜色，PR C 做了新建。新笔记的路径照搬 Obsidian 的 `openLinkText`，按笔记库配置的新笔记位置。新建的是空文件，`vault-diff` 只多出这一个文件 |
| 🟡 部分 | 链接-3 | 链接目标不是笔记时，用 macOS 的默认程序打开 | 测试：clicking a link opens its target and Cmd+Option+Left goes back；verify：follow-links | 2026-11-20 第 3 步 PR C。测试证明 mote 把笔记库内的正确路径交给了 macOS，没有真的打开程序。网址只放行 `http`、`https` 和 `mailto` |
| ✅ 已实现 | 链接-4 | 输入 `[[` 后弹出笔记名补全。插入的链接格式按笔记库配置决定 | 测试：typing [[ completes note names in the vault's link format；verify：link-complete；`npm test` 对照 Obsidian 导出的 `links.obsidian-linktext.json` | 2026-11-20。链接文字照搬 Obsidian 1.15.1 的 `fileToLinktext` 和 `[[` 列表插入的文字（`PR`），`links` 测试笔记库 540 对、2700 次插入和 Obsidian 完全相同。5 个副本 2,924,850 个链接用 `check-linktext.mjs` 解析回目标，5427 个不回。不回的是 3 篇文件名特殊的笔记，Obsidian 插入同样的文字，自己也解析不回，见 PR G 的结果。不补全标题、别名和附件 |
| ✅ 已实现 | 链接-8 | `Cmd+Option+←` 后退，`Cmd+Option+→` 前进 | 测试：clicking a link opens its target and Cmd+Option+Left goes back；verify：follow-links | 2026-11-20 第 3 步 PR C。回到一篇笔记时，光标在离开时的位置。已删除的笔记会跳过 |

## 第 4 步：新建、改名、移动和删除

| 状态 | 编号 | 功能 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| ⬜ 未实现 | 文件树-3 | 新建笔记和文件夹。新笔记的位置按笔记库配置决定 | | |
| ⬜ 未实现 | 文件树-4 | 改名和移动笔记或文件夹。笔记库配置要求时，更新指向它的链接和它里面的 Markdown 相对链接 | | 设计见 ADR 0006 |
| ⬜ 未实现 | 文件树-5 | 删除笔记时，移到 macOS 废纸篓 | | |

## 第 5 步：日记和性能

| 状态 | 编号 | 功能 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| ⬜ 未实现 | 日记-1 | `Cmd+Shift+D` 打开今天的日记 | | |
| 🟡 部分 | 日记-2 | 文件夹和文件名格式来自 `daily-notes.json`。没有时放在根目录，文件名 `YYYY-MM-DD.md` | | 已读取配置和默认值，还没用上 |
| ⬜ 未实现 | 日记-3 | 今天的日记不存在时新建 | | |
| ⬜ 未实现 | 规模-1 | 1 万篇笔记的笔记库，打开、搜索和改名都不卡顿 | | 指标见[性能目标](#性能目标) |

## 第 7 步：同步

| 状态 | 编号 | 功能 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| ⬜ 未实现 | 同步-1 | mote 自己的同步服务和 Mac 端同步模块。两台 Mac 或模拟客户端同时改同一篇笔记，合并后不丢字。上线后关掉 obsidian-git | | 不用 git，见 ADR 0005。在这之前，`~/life-os` 靠 Obsidian 的 obsidian-git 插件每分钟 commit 并 push，插件只在 Obsidian 开着时运行 |

## P1：第一版之后

| 状态 | 编号 | 功能 | 备注 |
| --- | --- | --- | --- |
| 💤 未排期 | P1-1 | 标签页，同时打开多篇笔记 | |
| 💤 未排期 | P1-2 | 在渲染后的表格里直接编辑单元格 | |
| 💤 未排期 | P1-3 | 属性面板，按 `.obsidian/types.json` 的类型显示日期、标签和多值字段 | |
| 💤 未排期 | P1-4 | 从模板文件夹插入模板 | |
| 💤 未排期 | P1-5 | 粘贴图片时，按笔记库配置保存到附件文件夹 | |
| 💤 未排期 | P1-6 | 阅读模式渲染数学公式 | 本机有 3 篇笔记用到 |
| 💤 未排期 | P1-7 | 在笔记里嵌入视频和其他附件 | |
| 💤 未排期 | P1-8 | 大纲、书签、出链和标签面板 | |
| 💤 未排期 | P1-9 | 同时打开多个笔记库窗口 | |

## 第一版不做

| 状态 | 功能 | 原因 |
| --- | --- | --- |
| 🚫 不做 | 图谱 | 不影响日常读写 |
| 🚫 不做 | Canvas | 本机笔记库里没有 `.canvas` 文件 |
| 🚫 不做 | Bases | 本机笔记库里只有 1 个 `.base` 文件 |
| 🚫 不做 | Dataview | 只有 1 个笔记库的 9 篇笔记用到。查询块显示为代码块 |
| 🚫 不做 | 插件系统和主题 | 第一版只服务你一个人 |
| 🚫 不做 | Claudian 侧栏 | 2026-11-20 决定暂不处理 |
| 🚫 不做 | 英语复习流程 | 2026-11-20 决定暂不处理，复习时继续用 Obsidian |
| 💤 未排期 | 手机端、AI 和语音 | 放到第二阶段 |

## 性能目标

数字都是估计值。用 `tools/gen-vault.mjs`（还没写）生成的 1 万篇笔记库来测。生成的笔记按 `Downloads/workspace` 的统计分布放双链、表格和 callout。

| 状态 | 操作 | 目标 | 结果 |
| --- | --- | --- | --- |
| 🟡 部分，推断超标 | 打开笔记库到可以编辑 | 2 秒以内 | 未测 1 万篇。真实窗口打开 `workspace-copy`（603 篇，含读入笔记索引）：`chooseVault` 中位数 402 毫秒（5 次，2026-11-20 实测）。读取并解析 `workspace-copy` 的 603 篇笔记：中位数 483 毫秒（`compare-links.mjs --bench 9`，2026-11-20 实测），其中 lezer 解析约 310 毫秒。按字符数线性外推，1 万篇约 8 秒（推断），第 5 步要处理 |
| 🟡 部分 | 全文搜索 | 200 毫秒以内 | `workspace-copy` 复制成 1 万篇（3140 万字符），node 里查询“的”中位数 76 毫秒、最慢 117 毫秒（2026-11-20 实测，不含 IPC）。用 gen-vault 生成的笔记库还没测 |
| 🟡 部分 | 快速打开，每次按键 | 16 毫秒以内 | `workspace-copy` 的路径复制成 1 万条，node 里 4 个查询的中位数 6.4 到 6.8 毫秒（`tools/bench-quick-open.mjs`，100 次，2026-11-20 实测，不含窗口渲染）。PR G 加了英文查询：改成边扫描边保留前 20 条后，`d` 到 `daily` 等 9 个查询的中位数最高 14.8 毫秒（3 轮，改前最高 20.3 毫秒） |
| ⬜ 未测 | 改名一篇有 100 个反向链接的笔记 | 1 秒以内 | |
| ⬜ 未测 | 外部修改到编辑器显示 | 100 毫秒以内 | |

## 验收清单

第 1 到 6 条都在笔记库的副本上测试，不碰原始笔记库。

| 状态 | 编号 | 检查 | 步骤 | 结果 |
| --- | --- | --- | --- | --- |
| ✅ 通过 | 验收-1 | 打开 5 个本机笔记库的每篇笔记，没有报错。打开前后用脚本对比全部文件的哈希值，全部不变 | 1 | 2026-11-20：`verify-mote walk-notes` 在 5 个副本上逐篇打开全部 810 篇笔记，没有页面错误和提示框，`vault-diff` 输出 `unchanged`。见 verify：backlinks |
| 🟡 部分通过 | 验收-2 | 5 个笔记库里的每个双链和 Markdown 链接，在 mote 里跳到的目标和在 Obsidian 里相同 | 2、3 | 解析目标在 5 个副本上和 Obsidian 完全一致（2026-11-20）。逐个点击：`life-os-copy` 113 篇笔记点了 101 个链接，0 不一致（2026-11-20，第 3 步 PR C）。另外 4 个副本在 PR H |
| ⬜ 未测 | 验收-3 | 在 `~/life-os` 和 `~/workspace/Pesemic` 里，各改名或移动一篇有链接进出的笔记。用 `diff -r` 对比操作前的副本，只有这次移动和相关链接有变化 | 4 | |
| ⬜ 未测 | 验收-4 | mote 开着一篇笔记时，在 Obsidian 里修改这篇笔记。mote 立即显示新内容，两边都不丢字 | 1 | 功能已在第 1 步做完，还没在副本上跑 |
| ⬜ 未测 | 验收-5 | 在 `~/life-os` 里按 `Cmd+Shift+D`，日记路径符合 `daily-notes.json`。在没有日记配置的笔记库里，日记是根目录下的 `YYYY-MM-DD.md` | 5 | |
| ⬜ 未测 | 验收-6 | 生成 1 万篇笔记的笔记库，打开、搜索和改名达到性能目标 | 5 | |
| ⬜ 未测 | 验收-7 | 你连续一周只用 mote 记笔记 | 6 | |

## 范围依据

P0 和"不做"按 2026-11-20 的数据划定。数据来自 5 个本机笔记库的笔记库配置，以及这条命令的统计：

```sh
node tools/vault-audit.mjs ~/life-os ~/wiki ~/workspace/Pesemic ~/Downloads/workspace ~/Downloads/workspace/knowledge-base
```

| 事实 | 对范围的影响 |
| --- | --- |
| 双链约 1300 处，指向笔记的 Markdown 链接约 40 处，例如 `life-os` 有 23 处、`Pesemic` 有 11 处 | 两种链接都进 P0。Markdown 链接虽少，点不开或改名后失效都会丢数据 |
| `Downloads/workspace` 有 317 篇笔记用了 callout | 实时预览里的 callout 样式进 P0 |
| 图片引用超过 200 处 | 图片渲染进 P0 |
| 任务、表格和属性在 5 个笔记库里都常见，例如 `life-os` 有 300 个任务 | 三者都进 P0 |
| `life-os` 的编辑器处在实时预览，`workspace.json` 里是 `"source": false` | 实时预览进 P0 |
| 3 个笔记库的 `app.json` 开了 `"alwaysUpdateLinks": true` | 改名时更新链接进 P0 |
| 只有 `life-os` 有 `daily-notes.json` | 有配置按配置，没配置按 Obsidian 默认值 |
| macOS 和 Obsidian 都在用深色模式 | 深色模式进 P0 |
| 最大的笔记库有 604 篇笔记，2.67 MB | 性能目标留出余量，见[性能目标](#性能目标) |
| Dataview 查询只出现在 1 个笔记库的 9 篇笔记里 | Dataview 不做 |
| 没有 `.canvas` 文件，只有 1 个 `.base` 文件 | Canvas 和 Bases 不做 |

## 怎么维护

- 新增或改动功能时，在同一个改动里更新本文。
- 功能按步骤分节。把功能挪到别的步骤时，把这一行移到那一节，在备注里写原因和日期。当初划范围的依据见[范围依据](#范围依据)。
- 状态写成图标加文字，放在每张表的第一列：
  - **✅ 已实现**：有证据证明它能用。
  - **🟡 部分**：做了一部分，或者做了但缺证据。备注写缺什么。
  - **⬜ 未实现**：在排期里，还没做。
  - **💤 未排期**：以后做，还没定在哪一步。
  - **🚫 不做**：明确不做，备注写原因。
- 一步开始、完成或卡住时，同时改[进度一览](#进度一览)里那一步的状态。
- 证据是 e2e 测试名，或 `verify-mote` 的功能文件（`.claude/skills/verify-mote/features/` 下）。没有证据不能标"已实现"。"测试：xxx"指 `tests/e2e/` 下的同名测试，"verify：xxx"指 verify-mote 的功能文件。
- 条目编号固定。删掉的条目留下编号，状态改成"🚫 不做"。
