# 第 3 步实现计划

本计划实现 [功能列表](../features.md#第-3-步实时预览阅读模式和点击链接) 里的第 3 步：实时预览、阅读模式、深色模式和点击链接。

完成标准有两条：

- [验收清单](../features.md#验收清单) 第 2 条的点击部分：在 5 个副本里点击每个链接，mote 跳到的目标和 Obsidian 的 `resolvedLinks` 相同。
- 5 个副本的每篇笔记在两种编辑器模式下打开，没有报错，文件字节不变。你再看一遍截图。

本文用到的词：

- **副本**：`~/mote-link-check/` 下 5 个笔记库的冻结拷贝，另有测试笔记库 `links` 的副本。原始笔记库从不打开。
- **导出文件**：`tools/obsidian-export.mjs` 在副本上导出的 Obsidian 解析结果。
- **对照工具**：`tools/compare-links.mjs`。
- **真实窗口**：用 `verify-mote` 启动并驱动的 mote 窗口。
- **编辑器模式**：实时预览或阅读模式。
- **显示源码**：实时预览里，选区碰到一个元素时，这个元素露出 Markdown 符号。
- **链接去向**：点击一个链接后去哪里。有 4 种：笔记、附件、不存在的笔记、外部网址。

## 8 个 PR

按合并顺序排列：

| PR | 内容 | 功能编号 | 依赖 | 证明 |
| --- | --- | --- | --- | --- |
| A | 解析器认识表格、任务、删除线、高亮、标签 | 为编辑器-1、4、5 铺路 | 无 | 对照工具 6 个副本 0 处不一致 |
| B | 实时预览的骨架和行内元素、属性块、`Cmd+E`、深色模式 | 界面-2、编辑器-1（部分）、编辑器-6、编辑器-9（部分）、链接-5 | A | 真实窗口，输入法，两种配色 |
| C | 点击链接、跳到标题、新建不存在的笔记、后退和前进 | 链接-1、2、3、8 | B | 真实窗口逐个点击，对照导出文件 |
| D | 图片和 `mote-file://` 协议 | 编辑器-2，编辑器-1 的图片 | B | 真实窗口，图片实际加载 |
| E | callout、表格、任务复选框 | 编辑器-3、4、5，编辑器-1 的任务 | B | 真实窗口，点复选框后只改 1 个字节 |
| F | Mermaid 图和 `![[笔记名]]` 嵌入 | 编辑器-9 | C、D、E | 真实窗口，两种编辑器模式 |
| G | 输入 `[[` 后补全笔记名 | 链接-4 | B | 真实窗口，输入法，3 种链接格式 |
| H | 5 个副本验收，更新功能列表 | 验收-2 | 全部 | 逐个点击 0 处不一致，截图页 |

```
main ── A 解析器 ── B 预览骨架 ──┬── C 链接 ─────────┐
                                 ├── D 图片 ─────────┼── F Mermaid 和嵌入 ── H 验收
                                 ├── E 块级元素 ─────┘
                                 └── G 补全
```

B 合并后，C、D、E、G 互不依赖。同时最多做 2 个：先 C 和 E，再 D 和 G。它们各写各的新文件，共用的文件只加一行注册。后合并的那个先 rebase，再重跑自己的检查。

每个 PR 的证明通过后直接合并进 main，不等 review。这是你 2026-11-20 的指示。

## 先做的实验

写计划前有一个最大的未知数：解析器加了新语法后，链接提取会不会和 Obsidian 不一致。我在一个临时分支上加了表格、任务、删除线、高亮和标签，重跑了对照工具。

| 检查 | main | 加新语法后 |
| --- | --- | --- |
| 6 个副本的不一致数 | 0 | 0 |
| 解析 `workspace-copy` 603 篇笔记，9 次中位数 | 486.4 毫秒 | 507.2 毫秒 |

两行都是 2026-11-20 实测。5 个副本里没有表格内的 `[[笔记\|别名]]`，对照测不到它。PR A 把它加进测试笔记库 `links`，再导出一次。

## 5 个副本里要渲染什么

数字来自 `tools/vault-audit.mjs` 和 grep，2026-11-20 实测。`workspace-copy` 包含 `knowledge-base`，所以有重复。

| 元素 | 次数 | 对计划的影响 |
| --- | --- | --- |
| callout | 1368 处，8 种类型，没有嵌套 | 8 种类型都要有颜色。不做折叠 |
| 表格 | 820 个 | 单元格里的行内元素要渲染 |
| 任务 | 588 个 | 复选框可以点 |
| `https` 图片 | 287 处 | 窗口要允许加载 `https` 图片 |
| 本地 Markdown 图片 | 77 处 | 走 `mote-file://` |
| `![[图片]]` | 9 处，1 处带宽度 | 支持 `\|300` 这种宽度 |
| `![[笔记名]]` | 0 处 | 功能列表要求做，放在最后的 PR F |
| Mermaid | 1 处 | 同上。Mermaid 库按需加载 |
| 带 `#标题` 的链接 | 6 处 | 跳到标题的规则照搬 Obsidian，用导出文件对照 |
| 最大的笔记 | 63.4 KB | 性能检查用它 |

## 设计

### 一个字段，一次遍历

实时预览用 CodeMirror 的装饰实现。我比较了两种结构：

| | 一个字段，一张注册表 | 每种元素一个插件 |
| --- | --- | --- |
| 做法 | 一个 `StateField` 遍历语法树一次。注册表把节点名映射到渲染函数 | 标题、链接、表格各写一个扩展，各自遍历语法树 |
| 显示源码的规则 | 写一次 | 每个插件各写一次 |
| 加一种元素 | 加一个文件，注册一行 | 加一个扩展，自己处理选区和模式 |
| 块级组件 | 都来自同一个字段，CodeMirror 允许 | 行内用视图插件，块级用字段，两套机制 |
| 性能 | 每次改动遍历整篇。最大的笔记 63 KB | 行内元素只算可见区域 |

选左边。显示源码的规则和编辑器模式各只有一个持有者，后面的 PR 才能各写各的文件。性能由 PR B 的性能检查把关。

```ts
// src/renderer/src/editor/preview.ts
type EditorMode = 'live' | 'reading'

// 预览要画的一个元素
type PreviewItem = {
	reveal: { from: number; to: number } // 选区碰到这个范围时显示源码
	always: Range<Decoration>[] // 一直生效，例如字体样式
	concealed: Range<Decoration>[] // 不显示源码时才生效，例如隐藏符号、换成组件
}

// 语法节点名对应一个渲染函数
type Renderer = (node: SyntaxNodeRef, cx: PreviewContext) => PreviewItem[]
const renderers: Record<string, Renderer>

// 粗体、斜体、删除线、高亮、行内代码共用的样式表。
// 实时预览的装饰和表格单元格都读它，不写第二份。
const inlineStyles: Record<string, { class: string; mark: string }>
```

规则只有一条：一个元素在阅读模式下从不显示源码。在实时预览下，选区碰到 `reveal` 时显示源码。

### 其他决定

- **显示源码按元素算，不按行算。** 这和 Obsidian 一样。按行算时，光标每到一行，这一行的链接都会展开成 `[[目标|别名]]`，文字会跳。`CONTEXT.md` 里实时预览的定义跟着改。
- **块级组件在两种编辑器模式下都渲染。** 表格、图片、Mermaid 和嵌入只写一条代码路径。阅读模式只是不显示源码、不能输入。
- **编辑器用 `src/core/markdown.ts` 的解析器配置。** 不引入第二份配置，见 ADR 0002。callout 的识别函数也放在这个文件里。
- **渲染进程自己解析链接。** 它用主进程推过来的路径列表建 `LinkIndex`，调用 `src/core/resolve.ts`。这是从副本算出来的结果，不是新的状态，不需要新 IPC。
- **链接去向是一个联合类型。** 上色和点击都用它。

  ```ts
  // src/core/linkDest.ts
  type LinkDest =
  	| { kind: 'note'; path: VaultPath; subpath: string | null }
  	| { kind: 'file'; path: VaultPath } // 用 macOS 的默认程序打开
  	| { kind: 'missing'; path: VaultPath } // 点击后新建的笔记路径
  	| { kind: 'external'; url: string } // 只允许 http、https、mailto
  ```

- **点击不存在的链接，立即新建空笔记。** 这和 Obsidian 一样。路径规则照搬 Obsidian 1.15.1 的 `createNewMarkdownFileFromLinktext` 和 `getNewFileParent`，用到笔记库配置里的新笔记位置。`ARCHITECTURE.md` 的不变式加上第三种写入：新建笔记。
- **窗口允许加载 `https` 图片。** 5 个副本里 287 处图片是 `https` 的，不加载就看不到。图片所在的网站会看到你的 IP，这和 Obsidian 一样。
- **导航历史归渲染进程的 `workspace`。** 每一项记住笔记路径和离开时的光标位置。
- **Mermaid 按需加载。** 笔记里有 Mermaid 代码块时才加载这个库。

### 这一步不做

- 代码块的语法高亮。代码块用等宽字体和底色显示。
- callout 折叠和嵌套 callout 的特殊样式。
- `[[笔记#` 之后的标题补全，以及自动补全右括号。
- 数学公式、脚注、`%%注释%%`、HTML 标签。它们显示为源码。

## 每个 PR 都要过的检查

- `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:e2e` 全部通过。
- 改了 `src/core` 时，`node tools/compare-links.mjs ~/mote-link-check/*-copy` 仍是 0 处不一致。
- 真实窗口：在 `basic` 上跑 `walk-notes`，没有页面错误。最后 `vault-diff --expect-unchanged` 输出 `unchanged`。
- 改了编辑器时，用 `verify-mote ime` 在编辑器里输入中文，上屏后文件只多出这几个字。
- 新功能在 `docs/features.md` 里改状态，写上证据。`verify-mote` 的 `features/` 加一份功能文件。

e2e 测试按 PR 分文件，放在 `tests/e2e/` 下。`docs/features.md` 里“测试：xxx”改为指这个目录下的同名测试。

## 基线：PR B 之前的 main

2026-11-20 实测。后面的 PR 用同样的命令量，和这里比。`$V` 是 `.claude/skills/verify-mote/scripts/verify-mote.mjs`。

机器：MacBook Pro，Intel Core i5-8259U，4 核 8 线程，macOS 15.7.4。内置 Retina 屏，刷新率 60 Hz，由 Electron 的 `screen.getAllDisplays()` 读出。macOS 是深色外观。量的时候开着 Claude、Chrome、飞书和 VS Code，`uptime` 的 1 分钟负载在 5 到 17 之间。每次量之前用 `pgrep` 查过，没有别的 mote Electron 和 `compare-links` 在跑。

窗口被别的窗口挡住时，Chromium 不再画帧，点击会一直等。`launch` 现在带 `--disable-backgrounding-occluded-windows`，下面的数都在这个开关下量。

### 配色：`theme`

量在 `ab712d1` 的应用代码上。`main.css` 在 `f4aa01d` 上没有变。

命令：`$V launch`，用默认的 `basic`。然后每种配色跑 `$V theme --scheme <配色>`，用 `eval` 读 `body` 的计算颜色，再 `$V screenshot --out theme-<配色>`。

| 命令 | 生效的配色 | `body` 背景 | `body` 文字 | `main.css` 的变量 | 对比度 |
| --- | --- | --- | --- | --- | --- |
| `theme --scheme dark` | dark | `rgb(30, 30, 30)` | `rgb(220, 221, 222)` | `#1e1e1e`、`#dcddde` | 12.26 |
| `theme --scheme light` | light | `rgb(255, 255, 255)` | `rgb(34, 34, 34)` | `#ffffff`、`#222222` | 15.91 |
| `theme --scheme system` | dark | `rgb(30, 30, 30)` | `rgb(220, 221, 222)` | 跟随 macOS | — |

两种配色的颜色不同，和 `--background`、`--text` 一致。`defaults read -g AppleInterfaceStyle` 在命令前后都是 `Dark`，`theme` 没有改 macOS 的设置。

### 输入：`bench-typing`

量在 `ab712d1` 的应用代码上。`f4aa01d` 只改了 `src/core/markdown.ts`，编辑器不用它，所以这组数对 `f4aa01d` 也成立。

命令：`$V launch --vault ~/mote-link-check/Pesemic-copy`，打开 `compute/compute_mvp_spec.md`。它是这个副本最大的笔记，63,375 字节，51,751 个字符。然后在同一次启动里交替跑 `$V bench-typing --chars 200 --where end` 和 `--where start`，各 3 次。每次跑完，文档多 200 个字符。

它量的是一个键引起的渲染进程主线程工作，也就是 `TaskDuration` 的差值。它不量按键到画面的时间，所以不受 60 Hz 的限制。它是主线程任务的墙钟时间，机器忙时会偏大。合成线程、GPU 和主进程的工作不在里面。单位是毫秒。

| 次 | 位置 | 开始时文档长度 | 每键中位数 | p95 | 最大 | 脚本均值 | 布局均值 | 样式均值 | 空闲中位数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | end | 52,151 | 4.94 | 7.60 | 21.22 | 2.38 | 0.29 | 0.08 | 5.59 |
| 2 | start | 52,351 | 5.18 | 6.24 | 18.22 | 2.26 | 0.30 | 0.07 | 0.17 |
| 3 | end | 52,551 | 5.00 | 6.19 | 20.50 | 2.19 | 0.29 | 0.07 | 0.19 |
| 4 | start | 52,751 | 4.88 | 5.68 | 19.15 | 2.04 | 0.34 | 0.07 | 0.16 |
| 5 | end | 52,951 | 4.76 | 5.73 | 18.30 | 2.05 | 0.29 | 0.07 | 0.16 |
| 6 | start | 53,151 | 5.18 | 6.21 | 19.44 | 2.09 | 0.43 | 0.07 | 0.16 |

基线：`end` 每键中位数 4.94 毫秒，3 次在 4.76 到 5.00 之间。`start` 每键中位数 5.18 毫秒，3 次在 4.88 到 5.18 之间。

重复性：在这 6 次之前，同一条 `end` 命令连跑两次，中位数是 5.19 和 4.79 毫秒，差 8%。

每次都输入了 200 个字符。命令读编辑器的长度和插入的文字，不对就失败。跑完 `vault-diff` 列出这篇笔记，这是预期的。

限制它的东西。另跑一次 100 个键的 CPU 剖析，不计入上表。每键的 JS 自身时间约 2.8 毫秒。最大的两项是垃圾回收 0.40 毫秒，和 `NoteEditor.tsx` 的 `serialize` 0.38 毫秒。每个键都把整篇文档转成字符串，交给 `workspace.edit`。这部分随文档变长而变大（推断）。`TaskDuration` 里约 2.5 毫秒不属于脚本、布局和样式，这个指标不再细分。

没有查明的两点：

- 每次的最大值都在 18 到 21 毫秒。
- 第 1 次的空闲中位数是 5.59 毫秒，其他 5 次是 0.16 到 0.19。同一次的每键中位数没有变大。我又连跑 5 次 20 个键，都没有复现。

PR B 的计划写的是在笔记中间输入，量按键到画面更新。这个探针按任务要求改成了主线程工作量，位置是开头和结尾。

### 打开：`walk-notes`

量在 `f4aa01d` 上。

命令：`$V launch --vault ~/mote-link-check/workspace-copy`，打开笔记库。在同一次启动里跑 3 次 `$V walk-notes --out walk-<次>`，最后跑 `$V vault-diff --expect-unchanged`。

| 次 | 打开篇数 | `errorCount` | `durationMs` | `medianNoteMs` |
| --- | --- | --- | --- | --- |
| 1 | 603 | 0 | 161,183 | 78.2 |
| 2 | 603 | 0 | 140,050 | 78.9 |
| 3 | 603 | 0 | 132,551 | 78.2 |
| 中位数 | | | 140,050 | 78.2 |

`vault-diff --expect-unchanged` 输出 `unchanged`。

`medianNoteMs` 在页面里计时。从文件树那一行的 `click` 事件开始，到这篇笔记的编辑器出现在 DOM 里为止。首次布局和绘制不在里面。

`durationMs` 是整个遍历的墙钟时间，含 Playwright 的点击和等待。平均每篇约 232 毫秒，其中约 150 毫秒花在测试工具上：点击、等待和每篇之后的检查（推断）。3 次相差 22%。比较打开速度时看 `medianNoteMs`，它 3 次只差 1%。

限制它的东西。另跑一次，在 41 篇笔记上做 CPU 剖析，不计入上表。这些笔记的中位数大小只有约 2 KB。每次打开，React 同步渲染和提交约 72 毫秒的 JS。自身时间最多的是 CodeMirror 读选区的 `eq`（12.9 毫秒）、React 改 DOM 属性（6.8 毫秒）和建 lucide 图标节点（5.6 毫秒）。所以时间花在每次打开都重画的界面上，不随笔记大小变化（推断）。

rebase 到 `f4aa01d` 之前，在 `ab712d1` 的应用代码上也跑过 3 次。`durationMs` 是 146,325、166,549、135,605。当时 `medianNoteMs` 从 Node 计时，含 Playwright 的时间，是 194.37、198.99、193.88，和上表不能比。另跑一次对比，同样 120 篇笔记，页面里计时的中位数 30.5 毫秒，Node 里计时的中位数 93.7 毫秒。所以改成了页面里计时。

## PR A：解析器扩展

- [x] 依赖：无，从 main 开分支。
- [x] 改动文件：`src/core/markdown.ts`、`src/core/markdown.test.ts`、`tests/fixtures/vaults/links/`、`tests/fixtures/vaults/links.obsidian-links.json`、`eslint.config.mjs`。
- [x] 做的一件事：解析器配置加上 GFM 表格、任务、删除线、裸网址，以及 `==高亮==` 和标签。链接提取结果不变。
- [x] 你会看到：界面没有变化。对照工具的输出仍是 0 处不一致。

标签的规则读自 Obsidian 1.15.1 的源码，不靠猜。`links` 测试笔记库加上这几种写法，再用 `tools/obsidian-export.mjs` 导出一次：表格里的 `[[笔记\|别名]]`、表格里的 `[[笔记]]`、`==[[笔记]]==`。

验证：

- [x] 单元：Vitest 对每种新节点各测一条。再测表格里 `[[笔记\|别名]]` 的目标和别名。
- [x] 对照：`links` 副本和 5 个副本都是 0 处不一致。
- [x] 真实窗口：`basic` 上 `walk-notes`，`vault-diff` 输出 `unchanged`。
- [ ] 性能：`node tools/compare-links.mjs --bench 9 ~/mote-link-check/workspace-copy`。main 的基线是 486.4 毫秒。中位数超过 560 毫秒算失败。这一条没有证明，原因见下面的结果。

### 结果

2026-11-20 实测。

规则读自 Obsidian 1.15.1 的 `worker.js`，它是 Obsidian 建索引用的解析器：

| 写法 | 读的函数 | 规则 |
| --- | --- | --- |
| 标签 | `yo`、`ei`、`bo`、`Mo` | `#` 前面是空白、行首，或者紧跟上一个元素的结尾，例如 `[[a]]#b`。标签名不能全是数字。标点结束标签名，但全角标点不算，所以 `#中文，后面` 是一个标签 |
| 高亮 | `go` | `==` 后面不能是空白。到后面第一个前面不是空白的 `==` 结束。高亮不嵌套 |
| 表格里的别名 | `It` | 链接路径结尾的一个 `\` 会去掉，所以 `[[笔记\|别名]]` 指向 `笔记` |

裸网址只认 `http://` 和 `https://` 开头的。`www.` 开头的和邮箱地址不算。

检查结果：

- 单元：Vitest 25 个通过。其中 3 个把两篇边界笔记的结果钉在 Obsidian 的 `metadataCache` 上：17 个标签、14 个链接路径和别名，全部相同。
- 对照：6 个副本 2202 处链接、1949 处反向链接，0 处不一致。
- 标签对照：`workspace-copy` 里 Obsidian 认出 38 个标签，mote 认出同样的 38 个，位置相同。其余 4 个副本的正文里没有标签。
- e2e：7 个通过。
- 真实窗口，`basic`：`walk-notes` 打开 5 篇，`errorCount` 0，`vault-diff` 输出 `unchanged`。

一处已知的差异。`https://example.com[[笔记]]` 这种写法，Obsidian 把双链算进网址，不算链接。mote 算链接。原因是 `@lezer/markdown` 认为没有路径的网址到域名就结束。6 个副本里没有这种写法。它记成一个预期失败的测试，修好后测试会提醒删掉这条。

性能没有按原计划证明。量的时候另外两个工作区在跑 Electron，同一条命令在 main 上的中位数在 707 到 941 毫秒之间跳，560 毫秒这条线没法判断。我换了一个量法：同一个进程里交替跑两个版本，只量提取链接，不读文件。

| 版本 | 提取 `workspace-copy` 603 篇的链接，15 轮最小值 | 相对 main |
| --- | --- | --- |
| main | 615.2 毫秒 | — |
| 直接用 GFM 的 `Autolink` | 842.3 毫秒 | +37% |
| 只在 `http` 开头处才跑网址解析（合并的版本） | 704.9 毫秒 | +15% |

`Autolink` 在每个字符上都跑一次正则，中文笔记里每个字都要跑。改成先看是不是 `http` 开头后，多出的时间少了一半多。剩下的 15% 分散在 4 个新的行内解析器和表格上，逐个去掉后各省 15 到 30 毫秒，没有哪一个特别慢。

按解析占整条命令约 64% 推算，安静的机器上中位数约 530 毫秒，低于 560 毫秒（推断）。PR H 在安静的机器上重跑原命令。

## PR B：实时预览的骨架和行内元素

- [x] 依赖：PR A。
- [x] 改动文件：`package.json`（加 `@codemirror/lang-markdown`、`@codemirror/language`）、`src/renderer/src/NoteEditor.tsx`、`src/renderer/src/editor/`（新）、`workspace.ts`、`App.tsx`、`main.css`、`src/main/index.ts`、`tests/fixtures/vaults/preview/`（新）、`tests/e2e/preview.spec.ts`（新）、`tests/e2e/app.ts`（新，`smoke.spec.ts` 改用它）、`verify-mote.mjs` 和 `SKILL.md`（`ime --no-enter`）、`features/live-preview.md`、`features/dark-mode.md`、`CONTEXT.md`、`ARCHITECTURE.md`、`docs/features.md`。
- [x] 做的一件事：编辑器按语法树渲染行内元素。`Cmd+E` 切换编辑器模式。颜色跟随 macOS。
- [x] 你会看到：标题变大。`**粗体**` 两边的星号消失，光标移进去时星号出现。`[[笔记|别名]]` 只显示别名，目标不存在的双链是另一种颜色。属性显示为一个 YAML 代码块。按 `Cmd+E` 后不能输入，再按一次恢复。

渲染的元素：标题、粗体、斜体、删除线、高亮、行内代码、标签、双链、Markdown 链接、列表、引用、分隔线、代码块、属性块。链接在这个 PR 里只有样式，点击在 PR C。

列表项换行后和文字对齐。在列表里按回车，下一行接着是列表项。

验证：

- [x] 单元：e2e 测试 `live preview hides syntax away from the selection and shows it at the selection`、`Cmd+E switches to reading mode and back`、`the window follows the system color scheme`。
- [x] 真实窗口，`preview`：打开 `行内.md`，编辑器的可见文字里没有 `**` 和 `[[`。点击粗体所在的词，可见文字里出现 `**`。按 `Cmd+E`，输入一个字，文档不变。
- [x] 真实窗口，输入法：在含粗体和链接的行尾用 `ime --no-enter` 输入“测试”。上屏后 `vault-diff` 只列出这篇笔记，文件只多出这两个字。不带 `--no-enter` 时命令会按一次真的回车，原因见结果。
- [x] 真实窗口，配色：用 `theme --scheme dark|light`。两种配色下各截一张图，各读一次编辑器背景和文字的计算颜色。两组颜色不同，对比度都不低于 4.5。
- [x] 真实窗口，5 个副本：两种编辑器模式下各跑一次 `walk-notes`，`errorCount` 是 0，`vault-diff` 输出 `unchanged`。
- [x] 性能，输入：`$V launch --vault ~/mote-link-check/Pesemic-copy`，打开 `compute/compute_mvp_spec.md`。在实时预览下交替跑 `bench-typing --chars 200 --where end` 和 `--where start`，各 3 次。任一位置的每键 `taskMs` 中位数超过 16 毫秒算失败。基线是 `end` 4.94 毫秒、`start` 5.18 毫秒，见上面的基线一节。
- [x] 性能，打开：`$V launch --vault ~/mote-link-check/workspace-copy`，跑 3 次 `walk-notes`。`medianNoteMs` 超过 117 毫秒算失败，这是基线 78.2 毫秒的 1.5 倍。`durationMs` 3 次之间差 22%，只记录，不判断。

### 结果

2026-11-20 实测，机器和基线一节相同。量之前用 `pgrep` 查过，没有别的 mote Electron 和 `compare-links` 在跑。

**模块。** 都在 `src/renderer/src/editor/` 下。

- `preview.ts`：数据结构 `PreviewItem`、`Renderer`、`EditorMode`，和几个共用的装饰。
- `livePreview.ts`：唯一的 `StateField`。文档、语法树或链接解析的输入变了，才遍历语法树。选区、焦点或编辑器模式变了，只按显示源码的规则重画。
- `renderers.ts`：注册表。`inline.ts`、`headings.ts`、`links.ts`、`lists.ts`、`quotes.ts`、`code.ts` 各管几种节点。行内样式表 `inlineStyles` 在 `inline.ts`。
- `markdown.ts`：编辑器的语言和回车、退格的按键。`preview.css`：样式，颜色只用 `main.css` 的变量。

**和设计不同的三处。**

1. 编辑器的语言不能只写 `new Language(markdownLanguage.data, markdownParser, [], 'markdown')`。`@codemirror/language` 6.13.1 的 `isActiveAt` 读语法树顶层节点上的 `languageDataProp`。所以 `markdown.ts` 用 `markdownParser.configure({ props })` 给 `Document` 节点加上它，另加一个缩进属性。只加属性，不加语法，语法树和索引的一样。在 Node 里先试过：不加时回车命令返回 `false`，加了以后插入 `\n- `。
2. 输入法选字期间，已经显示源码的元素保持显示源码，选字结束后再按规则重画。不这样做时，在 `[[目标]]` 后面选字，画面是 `目标]]ce shi`：`[[` 藏了，`]]` 还在。
3. 输入法检查改用 `ime --no-enter`。原命令在选字中按一次键码 13 的回车，CodeMirror 把它当换行。main 上也一样：在 main 上跑原命令，文件多出 `测试\n\n`。macOS 输入法确认选字时不发这种回车。

**真实窗口。**

| 检查 | 结果 |
| --- | --- |
| `preview`，`行内.md` | 可见文字里没有 `**`、`[[`。点 `粗体` 后这一行是 `这一行有 **粗体**、斜体、删除线、高亮 和 行内代码。`，只有粗体显示源码。`Cmd+E` 后输入“字”，`vault-diff --expect-unchanged` 输出 `unchanged` |
| 输入法 | 在 `**重点** 见 [[目标]]` 行尾输入“测试”。选字时这一行是 `[[目标]]测试`，上屏后是 `目标测试`。`vault-diff` 只列出 `行内.md`，`diff` 只多出 `测试`，文件多 6 个字节 |
| 列表 | `列表.md` 的第二项折行后，第二行从文字下面开始。嵌套的列表逐层缩进 |

配色，用 `theme` 切换后读计算颜色：

| 配色 | 编辑器背景 | 正文 | 正文对比度 | 链接对比度 | 不存在的链接对比度 | 窗口底色 |
| --- | --- | --- | --- | --- | --- | --- |
| dark | `rgb(30, 30, 30)` | `rgb(220, 221, 222)` | 12.26 | 10.16 | 8.26 | `#1E1E1E` |
| light | `rgb(255, 255, 255)` | `rgb(34, 34, 34)` | 15.91 | 7.04 | 6.00 | `#FFFFFF` |

5 个副本，每个副本一次启动、一次 `walk-notes`：

| 副本 | 篇数 | 实时预览 `errorCount` | 阅读模式 `errorCount` | `vault-diff` |
| --- | --- | --- | --- | --- |
| `life-os-copy` | 113 | 0 | 0 | 两次都 `unchanged` |
| `wiki-copy` | 11 | 0 | 0 | 两次都 `unchanged` |
| `Pesemic-copy` | 15 | 0 | 0 | 两次都 `unchanged` |
| `knowledge-base-copy` | 68 | 0 | 0 | 两次都 `unchanged` |
| `workspace-copy` | 603 | 0 | 0 | 两次都 `unchanged` |

**性能，输入。** `compute/compute_mvp_spec.md`，实时预览，同一次启动交替跑。

| 次 | 位置 | 开始时文档长度 | 每键中位数 | p95 | 最大 | 脚本均值 | 布局均值 | 样式均值 | 空闲中位数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | end | 51,751 | 7.58 | 9.83 | 24.73 | 4.70 | 0.27 | 0.08 | 0.22 |
| 2 | start | 51,951 | 7.50 | 9.08 | 28.49 | 4.40 | 0.29 | 0.07 | 0.20 |
| 3 | end | 52,151 | 7.38 | 9.14 | 19.15 | 4.33 | 0.28 | 0.07 | 0.21 |
| 4 | start | 52,351 | 7.56 | 9.13 | 20.32 | 4.24 | 0.35 | 0.07 | 0.18 |
| 5 | end | 52,551 | 6.51 | 10.52 | 18.01 | 4.18 | 0.26 | 0.07 | 0.20 |
| 6 | start | 52,751 | 7.95 | 10.28 | 23.79 | 4.63 | 0.41 | 0.07 | 0.17 |

`end` 每键中位数 7.38 毫秒，基线 4.94。`start` 7.56 毫秒，基线 5.18。都低于 16 毫秒，通过。同一时段在 main 上各跑一次，`end` 5.21、`start` 4.85 毫秒，和基线一致。多出的约 2.4 毫秒全在脚本里：脚本均值从 2.1 到 2.5 毫秒变成 4.2 到 4.7 毫秒，布局和样式没变。脚本里多的是每键一次的增量解析、整棵语法树的遍历和重建装饰（推断，低于 10 毫秒，没做剖析）。

**性能，打开。** `workspace-copy`，实时预览，同一次启动。

| 次 | 打开篇数 | `errorCount` | `durationMs` | `medianNoteMs` |
| --- | --- | --- | --- | --- |
| 1 | 603 | 0 | 113,163 | 64.3 |
| 2 | 603 | 0 | 143,259 | 68.5 |
| 3 | 603 | 0 | 117,393 | 64.7 |
| 中位数 | | | 117,393 | 64.7 |

`vault-diff --expect-unchanged` 输出 `unchanged`。`medianNoteMs` 64.7 毫秒，低于 117 毫秒，通过。它比基线 78.2 还低，因为机器比量基线时空闲。同一时段 main 跑了 2 次，是 63.3 和 64.6 毫秒。所以这个 PR 让每次打开多 1 到 2 毫秒，在噪声里（推断）。阅读模式跑 1 次是 67.0 毫秒。

**还没证明的。**

- 真实的 macOS 外观切换和真实的输入法。`theme` 用 `nativeTheme` 模拟，`ime` 用 CDP 模拟。
- 阅读模式下从反向链接或搜索跳过去时，编辑器拿不到焦点，选中的范围不显示，只滚动到那里。
- 真实窗口的检查跑在 rebase 到 `7391686` 之前的构建上。rebase 后重跑了 4 项自动检查和对照工具。`7391686` 只改链接提取，编辑器只用 `markdownParser`。
- 渲染进程的包是 1.36 MB。`lang-markdown` 引用了 `lang-html`，但包里搜不到 HTML、CSS、JavaScript 语法的节点名，没有打进去。

## PR C：点击链接、新建笔记、后退和前进

- [x] 依赖：PR B。
- [x] 改动文件：`src/core/linkDest.ts`（新）、`src/core/subpath.ts`（新）、`src/core/markdown.ts`、`src/renderer/src/editor/follow.ts`（新）、`workspace.ts`、`App.tsx`、`src/main/vault.ts`、`src/main/index.ts`、`tools/obsidian-export.mjs`、`tools/compare-links.mjs`、`verify-mote.mjs`、`tests/e2e/links.spec.ts`（新）、`features/follow-links.md`、`ARCHITECTURE.md`、`docs/features.md`。
- [x] 做的一件事：点击链接跳到链接去向。`Cmd+Option+←` 后退，`Cmd+Option+→` 前进。
- [x] 你会看到：点 `[[项目/计划]]` 打开 `计划`。点 `[[计划#目标]]` 打开后，`目标` 这个标题在窗口顶部。点一个不存在的双链，文件树里多出这篇笔记，编辑器打开它。点 PDF 链接，macOS 用默认程序打开。按 `Cmd+Option+←` 回到上一篇，光标在离开时的位置。

点击规则：元素没有显示源码时，单击就跳。任何时候 `Cmd+单击` 都跳，属性块里的链接也是。

跳到标题的规则照搬 Obsidian 1.15.1 的 `resolveSubpath`。`tools/obsidian-export.mjs` 多导出一项：每个带 `#` 的链接在 Obsidian 里落在哪一行。对照工具比较这一项。

新建笔记时，主进程只在笔记库内创建缺少的文件夹，并拒绝穿过符号链接。外部网址只放行 `http`、`https` 和 `mailto`。

验证：

- [x] 单元：Vitest 测 `linkDest` 的 4 种去向，测新建路径在 3 种新笔记位置配置下的结果，测 `subpath` 的标题和块引用。e2e 测试 `clicking a link opens its target and Cmd+Option+Left goes back`、`clicking a missing link creates the note where the vault config says`。
- [x] 对照：带 `#` 的链接落在的行，`links` 副本和 5 个副本都和 Obsidian 一致。
- [x] 真实窗口，逐个点击：`verify-mote` 加 `walk-links --obsidian <导出文件>`。它在每篇笔记里点击每个已渲染的链接，记下打开的路径，再后退。每篇笔记按目标汇总次数，和导出文件比较。这个 PR 先在 `links` 副本和 `life-os-copy` 上跑到 0 处不一致，5 个副本的完整结果在 PR H。
- [x] 真实窗口，新建：点不存在的双链后，`vault-diff` 只多出这一个空文件。
- [x] 真实窗口，默认程序：点附件链接后，用 `main-eval` 读到 `shell.openPath` 收到的路径在副本内。测试里把 `shell.openPath` 换成记录函数，不真的打开程序。
- [ ] 性能：点击到目标笔记可以编辑的时间，`workspace-copy` 上 50 次的中位数。和从文件树打开同一篇笔记比较，超过它的 1.5 倍算失败。

### 结果

2026-11-20 实测。写代码和跑检查的子代理在应用退出时中断，这一节由合并的人根据它留下的证据补写。

规则读自 Obsidian 1.15.1 的 `app.js`：

| 规则 | 读的函数 | 放在哪 |
| --- | --- | --- |
| 不存在的笔记新建在哪 | `WorkspaceLeaf.openLinkText` 里目标不存在的分支，`getNewFileParent`、`getMarkdownNewFileParent`、`createNewFile`、`getOrCreateFolder`、`getAvailablePath` | `src/core/linkDest.ts` 的 `newNotePath` |
| `#标题`、`#上级#下级`、`#^块` 落在哪 | `resolveSubpath` 和它的标题规范化 | `src/core/subpath.ts` |

检查结果：

- 对照：6 个副本 2228 处链接、1975 处反向链接、233 处带 `#` 的链接落点，0 处不一致。
- 单元：Vitest 62 个通过，1 个预期失败（PR A 记下的那条）。
- e2e：14 个通过，其中新测试两个。
- 真实窗口，逐个点击：`links-copy` 11 篇笔记点了 48 个链接，`life-os-copy` 113 篇笔记点了 101 个链接，都是 0 处不一致。嵌入和属性里的链接这一步点不了，从期望里减掉了 6 处和 5 处。
- 真实窗口，`basic`：点不存在的双链后，`vault-diff` 只多出 `新想法.md` 一个空文件。在有链接的行尾用输入法输入“测试”，文件只多出这两个字，159 字节变成 165 字节。重新启动后 `walk-notes` 打开 5 篇，`errorCount` 0，`vault-diff` 输出 `unchanged`。

和别的 PR 合在一起时发现的一件事。PR G 的补全测试在输入 `[[计` 后立刻按回车。CodeMirror 在列表弹出后的 75 毫秒内不接受回车，防止误选。加上点击链接的代码后，列表弹出得稍晚，这个测试每次都失败。测试改成先等 150 毫秒。人按不了这么快，产品行为没有改。

没有做的：

- 性能那一条没有量。PR H 量。
- 另外 4 个副本的逐个点击在 PR H。

## PR D：图片

- [x] 依赖：PR B。
- [x] 改动文件：`src/core/fileUrl.ts`（新）、`src/main/fileProtocol.ts`（新）、`src/main/index.ts`、`src/renderer/index.html`、`src/renderer/src/editor/images.ts`、`images.css`（均为新）、`links.ts`、`renderers.ts`、`tests/fixtures/vaults/preview/`、`tests/e2e/images.spec.ts`（新）、`features/images.md`、`docs/adr/0007-mote-file-protocol.md`（只改状态行）、`ARCHITECTURE.md`、`CONTEXT.md`、`docs/features.md`。没有改 `src/main/vault.ts`，协议直接用它的 `filePath`。
- [x] 做的一件事：`![](路径)` 和 `![[图片名]]` 在两种编辑器模式下显示图片。
- [x] 你会看到：`欢迎.md` 里 `![[图片.png]]` 的位置出现图片。光标移到那一行时，图片上方显示源码。

主进程注册 `mote-file://`，只读当前笔记库里的文件，用 `parseVaultPath` 拒绝 `..` 和以 `.` 开头的部分。内容安全策略的 `img-src` 加上 `mote-file:` 和 `https:`。`![[图片.png|300]]` 按 300 像素宽显示。不是图片的嵌入显示为链接。

验证：

- [x] 单元：e2e 测试 `images load from the vault and nothing outside it`。它检查图片的 `naturalWidth` 大于 0。它再请求 `mote-file://` 下的 `../` 路径、`.obsidian/app.json` 和笔记库外的绝对路径，全部失败。
- [ ] 真实窗口，`knowledge-base-copy`：打开一篇有本地图片的笔记，页面里每个本地图片的 `naturalWidth` 都大于 0。这个副本没有本地图片，改在 `workspace-copy` 上查，见结果。
- [x] 真实窗口，`workspace-copy`：打开一篇有 `https` 图片的笔记，至少一张加载成功。断网时这一条记为未证明。
- [x] `vault-diff --expect-unchanged` 输出 `unchanged`。
- [x] 性能：`workspace-copy` 上 `walk-notes` 的 `medianNoteMs`，和 PR B 合并后的 main 比较，超过 1.5 倍算失败。

### 结果

2026-11-20 实测。

**协议怎么拒绝。** 一个地址只有一种写法：`mote-file://vault/<库内路径>`，路径的每一段单独百分号编码。`src/core/fileUrl.ts` 的 `fileUrl` 和 `parseFileUrl` 是唯一的定义，主进程、渲染进程和测试都用它。主进程的 `serveFile` 按下面的顺序检查，拒绝时不返回任何字节：

| 请求 | Chromium 先做的事 | 谁拒绝 | 状态码 |
| --- | --- | --- | --- |
| `vault/../outside/secret.png` | 把 `..` 算掉，变成 `vault/outside/secret.png` | 笔记库里没有这个文件 | 404 |
| `vault/..%2Foutside%2Fsecret.png` | 不动 | `parseFileUrl` 解码后交给 `parseVaultPath`，拒绝 `..` | 400 |
| `vault/.obsidian/app.json`、`vault/.obsidian/secret.png` | 不动 | `parseVaultPath` 拒绝以 `.` 开头的部分 | 400 |
| `vault//<绝对路径>` | 不动 | 空的一段，`parseVaultPath` 拒绝 | 400 |
| `mote-file:///<绝对路径>` | 第一段变成主机名 | 主机名不是 `vault` | 400 |
| 别的主机、带 `?` 或 `#`、坏的百分号编码 | | `parseFileUrl` | 400 |
| `图片.md` 这样的笔记，或别的非图片扩展名 | | `imageType` 不认识这个扩展名 | 403 |
| 指向笔记库外的文件符号链接 | | `open` 带 `O_NOFOLLOW` | 404 |
| 路径上有指向笔记库外的文件夹符号链接 | | `Vault.filePath` 比较 `realpath` | 404 |
| 没有打开的笔记库 | | `serveFile` | 404 |
| 非 GET 请求 | | `serveFile` | 405 |

图片扩展名和 Obsidian 一样：png、jpg、jpeg、gif、svg、webp、bmp、avif。查表用 `Map`，所以 `a.constructor` 这样的名字不算图片。

**大小。** 规则照搬 Obsidian 1.15.0 `app.js` 的 `Y0` 和 `Zl`。双链嵌入读别名，Markdown 图片读方括号里的文字。最后一个 `|` 后面是 `300` 或 `300x200` 时，它是宽高。没有 `|` 时整段文字是数字也算，所以 `![300](a.png)` 也是 300 宽。

**单元和 e2e。** Vitest 34 个通过，1 个预期失败（PR A 记下的那条）。e2e 11 个通过，其中新测试一个。它在测试副本外放一张真图片，再在副本里建一个指向它的文件符号链接和一个文件夹符号链接。窗口里 11 种越界请求都加载失败，主进程用 `net.fetch` 请求同样的地址，状态码都不低于 400，正文 0 字节。同一个工具请求库内图片，返回 200 和整张图片的字节，所以这些失败不是工具本身的问题。

**真实窗口。**

| 检查 | 结果 |
| --- | --- |
| `basic`，`欢迎.md` | `![[图片.png]]` 解析到 `附件/图片.png`，`naturalWidth` 1。点击图片后这一行是 `![[图片.png]]`，源码底边 357.4，图片顶边 365.2，图片在源码下面。`Cmd+E` 后这一行没有源码，图片还在。`vault-diff --expect-unchanged` 输出 `unchanged` |
| 输入法 | 在图片下一行用 `ime --text 测试 --commit 测试 --no-enter`。`vault-diff` 只列出 `欢迎.md`，`diff` 只多出 `测试`，文件从 159 字节变成 165 字节 |
| `basic`，`walk-notes` | 实时预览和阅读模式各 5 篇，`errorCount` 都是 0，`vault-diff` 输出 `unchanged` |
| `workspace-copy`，本地图片 | `5-hermes.md` 有 8 张，`别再只做向量检索…路线图.md` 有 10 张。逐页往下翻，每张 `naturalWidth` 在 1096 到 1812 之间，宽度缩到编辑器的 678 像素。两篇都没有占位框。阅读模式下同样 |
| `workspace-copy`，`https` 图片 | `knowledge-base/raw/articles/Claude Managed Agents get to production 10x faster.md` 的第一张来自 `cdn.prod.website-files.com`，`naturalWidth` 2032。阅读模式下同样。有一处 `![](https://www.youtube.com/watch?v=…)` 是网页不是图片，显示为占位框 |

`knowledge-base-copy` 有 125 处图片，全是 `https`，没有一个图片文件。所以本地图片在 `workspace-copy` 上查。

**性能，打开。** 基线用 PR B 的数，不重量：PR B 在 `workspace-copy` 上量到 `medianNoteMs` 64.7 毫秒（3 次是 64.3、68.5、64.7），1.5 倍是 97 毫秒。这个分支跑 1 次：603 篇，`errorCount` 0，`durationMs` 115,620，`medianNoteMs` 64.7 毫秒，通过。`vault-diff --expect-unchanged` 输出 `unchanged`。

**性能，输入。** `bench-typing --chars 200 --where end`，`knowledge-base-copy`。

| 笔记 | 光标附近 DOM 里的图片 | 次 | 每键中位数 | p95 | 最大 | 脚本均值 |
| --- | --- | --- | --- | --- | --- | --- |
| `你不知道的 Agent：原理、架构与工程实践.md`，25 张 | 0 张，图片都在中间 | 1 | 6.73 | 8.64 | 21.55 | 3.60 |
| 同上 | | 2 | 6.58 | 8.02 | 28.39 | 3.18 |
| `Claude Managed Agents get to production 10x faster.md`，21 张 | 5 张，前后都加载完 | 1 | 5.69 | 7.03 | 12.34 | 2.69 |
| 同上 | | 2 | 4.63 | 5.80 | 7.74 | 2.10 |

单位是毫秒，都低于 16，通过。第一篇的图片不在光标附近，只量到每次改动重建 25 个图片装饰的开销。所以又换了一篇末尾有图片的笔记。输入前后 DOM 里都是同样 5 张，都已加载。图片组件的 `eq` 比较地址和大小，别处输入不重建 `<img>`，e2e 测试读同一个元素在输入后还在页面里。

**还没证明的。**

- 换笔记库，或者图片文件在磁盘上被替换后，窗口可能还显示旧图。地址里只有库内路径，Chromium 可能按地址缓存。没有测。
- 不是图片的嵌入显示为链接，点击跳转等 PR C。
- `![](a.png)` 这种 Markdown 图片的目标是笔记时，显示占位框，不显示为链接。5 个副本里没有这种写法。
- 输入法用 CDP 模拟，不是真的 macOS 输入法。
- 真实窗口和性能跑在 rebase 到 `6732373`（PR G）之前的构建上。rebase 后重跑了 4 项自动检查。PR G 只改补全弹窗和文档。

## PR E：callout、表格和任务复选框

- [x] 依赖：PR B。
- [x] 改动文件：`package.json`（加 `lucide`）、`src/core/markdown.ts`（callout 识别函数）、`src/renderer/src/editor/callouts.ts`、`tables.ts`、`tasks.ts` 和各自的 CSS（均为新）、`renderers.ts`、`NoteEditor.tsx`、`tests/fixtures/vaults/preview/`、`tests/e2e/blocks.spec.ts`（新）、`features/blocks.md`、`docs/adr/0002-one-parser.md`（只改状态行）、`ARCHITECTURE.md`、`docs/features.md`。
- [x] 做的一件事：callout 显示为带颜色和标题的块。表格渲染成表格。任务前面是可以点的复选框。
- [x] 你会看到：`> [!warning] 注意` 变成橙色的块，标题是“注意”。表格有边框和对齐，光标移进去时变回 Markdown 源码。点复选框，`- [ ]` 变成 `- [x]`。

callout 的类型和颜色放在一张表里，别名也在表里，例如 `tip`、`hint`、`important` 是同一种。表格单元格里的行内元素用 PR B 的 `inlineStyles` 渲染，链接可以点。点复选框只改方括号里的 1 个字符，在阅读模式下也能点。

验证：

- [x] 单元：Vitest 测 callout 识别函数。e2e 测试 `callouts, tables and task checkboxes render, and a checkbox click changes one byte`。
- [x] 真实窗口，`preview`：8 种 callout 类型各一个，读到的边框颜色和 Obsidian 的种类一致：`tip` 和 `important` 相同，`note` 和 `info` 相同，共 6 种，深色和浅色下都是。原计划写的是 8 种不同，和 Obsidian 不符，见结果。表格的 `th` 和 `td` 数量和源码一致。光标移进表格后，可见文字里有 `|`。
- [x] 真实窗口，任务：点一个复选框，等自动保存。`vault-diff` 只列出这篇笔记，`cmp -l` 显示只差 1 个字节。
- [x] 真实窗口，`workspace-copy`：打开 callout 最多和表格最多的两篇笔记，没有页面错误，截图。
- [x] 真实窗口，输入法：在表格下面一行和 callout 里的一行用 `ime --no-enter` 输入中文，上屏后只多出这几个字。
- [x] 性能：重跑 PR B 的输入检查，笔记换成表格最多的那篇。中位数超过 16 毫秒算失败。

### 结果

2026-11-20 实测，机器和基线一节相同。真实窗口和性能都在 `1faaaaf` 之后的构建上量，应用代码和合并的版本相同。

**照搬 Obsidian 1.15.1 的规则。**

| 规则 | 读的地方 | 内容 |
| --- | --- | --- |
| 什么是 callout | `app.js` 的 `$ue` 和正则 `Kue` | 引用的第一行，去掉 `>` 和后面最多 1 个空格后，以 `[!类型]` 开头，后面可以跟 `+` 或 `-`，再跟空白或行尾。类型取 `\|` 前面的部分，转小写，空白换成 `-` |
| 没有标题时的标题 | `app.js` 的 `rfe` | 类型里的 `-` 换成空格，首字母大写，例如 `[!summary]` 显示 `Summary` |
| 种类、别名、颜色、图标 | `app.css` 的 `.callout[data-callout=…]` | 13 种。`note`、`info`、`todo` 是蓝色，`abstract`、`tip` 是青色。`important` 是 `tip` 的别名，图标都是火焰。不认识的类型按 `note` 画 |
| 颜色值 | `app.css` 的 `--color-<颜色>-rgb` | 浅色和深色各一组，写在 `callouts.css`。`quote` 两种配色都是灰色 `#9e9e9e` |

识别函数是 `src/core/markdown.ts` 的 `calloutHeader`，编辑器和以后的索引都用它。改了 `src/core` 后，对照工具 6 个副本 0 处不一致。

**和设计不同的两处。**

1. 8 种类型只有 6 种颜色。Obsidian 给 `note` 和 `info` 的都是蓝色，只是图标不同。e2e 测试按这一点断言。
2. 引用或列表项里的表格不在行首，画成行内组件，留在行里 `>` 的后面。从行首开始的表格画成行之间的块。5 个副本里只有 1 个表格在引用里。

**真实窗口。** 证据目录在 `verify-artifacts/` 下，按启动编号区分。

| 检查 | 结果 |
| --- | --- |
| `preview`，callout 颜色 | 深色：笔记、信息 `rgb(2, 122, 255)`，提示、重要 `rgb(83, 223, 221)`，注意 `rgb(233, 151, 63)`，危险 `rgb(251, 70, 76)`，示例 `rgb(168, 130, 255)`，引言 `rgb(158, 158, 158)`。浅色：蓝 `rgb(8, 109, 221)`，青 `rgb(0, 191, 188)`，橙 `rgb(236, 117, 0)`，红 `rgb(233, 49, 71)`，紫 `rgb(120, 82, 238)`，灰相同。`20261120-134700-7702` |
| callout 显示源码 | 点“注意”后这一行是 `> [!warning] 注意`，按 `↓` 后变回 `注意` |
| 表格 | 第一个表格表头 4 格、正文 12 格，和源码一致。第二个表格的两行在源码里是 1 格和 3 格，按 GFM 补齐和截断成 2 格。点“斜体”后可见文字有 5 行带 `\|`，点下面一行后只剩转义的 `\|` |
| 输入法 | 表格下面一行、callout 正文一行、callout 标题一行，各输入一次，`diff` 只多出输入的字 |
| 任务 | 新启动一次，点“待办任务”。`vault-diff` 只列出 `任务.md`，`cmp -l` 输出一行 `14 40 170`：第 14 个字节从空格变成 `x`。`20261120-135331-8138` |
| `workspace-copy` | callout 最多的是 `03_Areas/🎓 English Learning/🧱 Building Blocks/Words & Phrases/considerate of.md`，10 个。表格最多的是 `04_Works/foundry/docs1/特征平台与Foundry完整差距分析.md`，23 个。两种编辑器模式各截图。阅读模式下 `walk-notes` 打开 603 篇，`errorCount` 0，`vault-diff --expect-unchanged` 输出 `unchanged`。`20261120-135501-cdb9` |
| 新启动的 `walk-notes` | 实时预览打开 603 篇两次，`errorCount` 都是 0，`unchanged`。`20261120-140029-3004` |

**性能，输入。** 5 个副本里表格最多的笔记是 `Pesemic-copy` 的 `basic/特征平台与Foundry完整差距分析.md`，23 个表格，11,948 个字符。`workspace-copy` 里有同一篇。实时预览，同一次启动交替跑，单位毫秒。

| 次 | 位置 | 开始时文档长度 | 每键中位数 | p95 | 最大 | 脚本均值 | 空闲中位数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | end | 11,948 | 5.78 | 7.28 | 15.08 | 2.76 | 0.24 |
| 2 | start | 12,148 | 5.98 | 6.86 | 9.60 | 2.81 | 0.19 |
| 3 | end | 12,348 | 4.76 | 6.30 | 37.77 | 2.16 | 0.20 |
| 4 | start | 12,548 | 5.83 | 9.63 | 34.65 | 2.98 | 0.20 |

都低于 10 毫秒，通过。在开头输入时，每个键让 23 个表格都往后移。表格组件按源码比较，只更新链接的位置，不重建表格。

**性能，打开。** `workspace-copy`，实时预览，一次新启动跑两次 `walk-notes`。基线是 PR B 结果里的 `medianNoteMs` 64.7 毫秒，超过 1.5 倍、也就是 97 毫秒算失败。

| 版本 | `medianNoteMs` | `durationMs` |
| --- | --- | --- |
| 这个 PR | 64.3、64.9 | 116,946、109,760 |
| main `c9dec5c`，同一时段对照 | 63.8、65.9 | 111,889、112,158 |

64.9 毫秒低于 97 毫秒，通过。同一时段的 main 和这个 PR 相差不到 1 毫秒。

**还没证明的。**

- 表格里的链接只证明了类名、`data-link-from` 和颜色。点击跳转要等 PR C。
- 真实的 macOS 输入法。`ime` 用 CDP 模拟。
- 一次 `snapshot` 在刚打开 `表格.md` 时没看到第一个表格，截图里有。之后重开 5 次都看到了，原因没查明。
- 复选框的无障碍名称是任务的原文，带着 `**` 这类符号。

## PR F：Mermaid 图和笔记嵌入

- [x] 依赖：PR C、D、E。
- [x] 改动文件：`package.json`（加 `mermaid`）、`src/core/subpath.ts`（加 `subpathRange`）、`src/renderer/src/editor/mermaid.ts`、`embeds.ts`、`noteView.ts`（均为新）、`follow.ts`、`renderers.ts`、`NoteEditor.tsx`、`workspace.ts`、`tests/fixtures/vaults/preview/`、`tests/e2e/reading.spec.ts`（新）、`tests/e2e/images.spec.ts`、`features/reading-mode.md`（新）、`features/images.md`、`features/live-preview.md`、`verify-mote` 的 `loaded-scripts.mjs`（新）和 `SKILL.md`、`ARCHITECTURE.md`、`CONTEXT.md`、`docs/features.md`。`src/renderer/index.html` 没有改。
- [x] 做的一件事：Mermaid 代码块显示为图。`![[笔记名]]` 显示被嵌入笔记的内容。
- [x] 你会看到：阅读模式下，`mermaid` 代码块是一张流程图。`![[计划]]` 的位置是 `计划` 的正文，带一条左边线。`![[计划#目标]]` 只显示这一节。

嵌入是一个只读的 CodeMirror 视图，用同一套预览扩展，不是第二个渲染器。嵌入最多套 3 层。被嵌入的笔记改动后，嵌入的内容跟着更新。Mermaid 出错时显示代码和错误信息。

验证：

- [x] 单元：Vitest 测 `subpathRange` 的标题范围和块范围。e2e 测试 `reading mode renders mermaid diagrams and embedded notes`。
- [x] 真实窗口，`preview`：阅读模式下，Mermaid 块里有 `svg`。嵌入里有 `计划` 的文字。用 shell 改 `计划.md`，1 秒内嵌入里出现新文字。
- [x] 真实窗口，`life-os-copy`：打开有 Mermaid 的那篇笔记，图渲染出来，截图。
- [x] 真实窗口，循环嵌入：`A` 嵌入 `B`，`B` 嵌入 `A`，窗口不卡死，没有页面错误。
- [x] `vault-diff --expect-unchanged` 输出 `unchanged`。
- [x] 性能：原来的“启动到可以编辑的时间”噪声太大，没法判断，换成下面两条。
  - 包的大小：渲染进程的入口包比合并基点大不到 30 KB。Mermaid 在自己的包里。
  - 按需加载：`wiki-copy` 没有 Mermaid 块。跑完 `walk-notes` 后，渲染进程解析过的脚本里没有 Mermaid 的包。
  - `workspace-copy` 上 `walk-notes` 的打开时间留给 PR H 一起量。

### 结果

2026-11-21 实测，机器和基线一节相同。真实窗口在 `fe2ea7a` 的构建上量，应用代码和合并的版本相同。证据目录在 `verify-artifacts/` 下。

**模块。**

- `mermaid.ts`：占 `FencedCode` 的位置，不是 `mermaid` 的代码块交给 `code.ts`。第一次画图时 `import('mermaid')`，以后共用这一份。画好的图按代码和配色缓存，组件的 `eq` 只比代码，所以在别处输入时图不重画。配色变了，图自己重画。
- `embeds.ts`：占 `WikiEmbed` 的位置，图片、附件和找不到的目标交给 `images.ts`。被嵌入的笔记画在嵌套视图里。嵌套视图和主编辑器都调用 `noteView.ts` 的 `noteView()`：语言、实时预览、点击链接和折行。主编辑器另加编辑、历史、保存键和补全。
- `src/core/subpath.ts` 加了 `subpathRange`：标题的一节到下一个同级或更高级的标题为止，块 ID 是那一个块。`resolveSubpath` 改为读它的起点，对照工具 6 个副本 233 处子路径仍然全部一致。
- `workspace.noteText` 不打开笔记就读它的文字。嵌入在 `revision` 变大时重新读。被嵌入的是正在编辑的笔记时，读编辑器里的文字。

**内容安全策略。** Mermaid 12.3.0 在原来的策略下能画图，`index.html` 没有改。写代码前先在一个只带这条策略的页面里试过 6 种图，没有违规报告。真实窗口里用 CDP 读日志，画图前后都没有违规。`securityLevel` 是 `strict`。

**和设计不同的三处。**

1. 在实时预览下，`↑` 和 `↓` 跳过块级组件，这是 CodeMirror 对所有块级组件的做法。所以图和嵌入的源码在点击它、或者光标停在它的边上时显示，不在上下移动光标时显示。
2. 在嵌入里按下鼠标只用来点链接，不移动焦点和选区。这样主编辑器一直有焦点，代价是嵌入里的文字不能选中复制。
3. `follow.ts` 只处理自己视图里的链接。嵌套视图里的链接位置是被嵌入笔记的位置，由嵌套视图自己的点击扩展处理。

**真实窗口。**

| 检查 | 结果 |
| --- | --- |
| `preview`，Mermaid | 阅读模式和实时预览下，第一个块里都有 `svg`。节点底色深色是 `rgb(31, 32, 32)`，浅色是 `rgb(236, 236, 255)`。4 张截图。`20261120-162339-0d08` |
| 坏的图 | 显示 `Parse error on line 2:` 和代码 |
| 显示源码 | 实时预览下点图，这一块变回 `` ```mermaid `` 源码 |
| 嵌入 | `![[计划]]` 显示 `计划` 的正文，链接 `./附注` 是能点的颜色。`![[计划#目标]]` 只有 `目标` 和 `细节`，没有 `风险`。`![[计划#^kuai]]` 只有那一段。`![[计划#不存在的标题]]` 显示为不存在的链接 |
| 外部修改 | 用 shell 往 `项目/计划.md` 追加一行，53 毫秒后嵌入里出现 |
| 循环和层数 | 打开 `循环甲`、`循环乙`，没有页面错误，里面的那一层显示为链接。`深一` 到 `深三` 都画出来，`深四` 是链接 |
| 输入法 | 图下面一行、嵌入下面一行各用 `ime --no-enter` 输入一次。`diff` 只多出“测试” |
| 新启动的 `walk-notes` | `preview` 22 篇，实时预览和阅读模式 `errorCount` 都是 0，`vault-diff --expect-unchanged` 输出 `unchanged`。`20261120-162441-be1e` |
| `life-os-copy` | `Books/置身事内.md` 的流程图画出来，截图，`unchanged`。`20261120-162511-f1a4` |

**性能。**

| 检查 | 结果 |
| --- | --- |
| 入口包 | 1,603,114 字节，合并基点 `a3ae461` 是 1,587,194 字节，多 15,920 字节，低于 30 KB，通过 |
| Mermaid 的包 | 89 个按需加载的包，共 9,521,953 字节。`mermaid.core` 171,361 字节，最大的 `elk` 2,680,055 字节 |
| 按需加载 | `wiki-copy` 跑完 `walk-notes`，CDP 报告解析过的脚本只有入口包。`preview` 打开 `图表` 后是 27 个。`20261120-162458-f8d6` |

`workspace-copy` 上 `walk-notes` 的打开时间留给 PR H。

**还没证明的。**

- 真实的 macOS 外观切换和输入法。`theme` 用 `nativeTheme` 模拟，`ime` 用 CDP 模拟。
- 嵌入里的 `^kuai` 这类块 ID 照原文显示。主编辑器也一样，现在没有渲染函数隐藏它。
- 5 个副本里没有笔记嵌入，嵌入只在测试笔记库 `preview` 上证明。
- 嵌入里的文字不能选中。

## PR G：双链补全

- [x] 依赖：PR B。
- [x] 改动文件：`package.json`（加 `@codemirror/autocomplete`）、`src/core/linkText.ts`（新）、`src/core/resolve.ts`、`src/renderer/src/editor/complete.ts` 和 `complete.css`（新）、`quickOpenMatch.ts`、`NoteEditor.tsx`、`App.tsx`、`tools/obsidian-export.mjs`、`tools/check-linktext.mjs`（新）、`tests/fixtures/vaults/links.obsidian-linktext.json`（新）、`tests/e2e/complete.spec.ts`（新）、`features/link-complete.md`、`ARCHITECTURE.md`、`docs/features.md`。
- [x] 做的一件事：输入 `[[` 后弹出笔记名列表。选中后按笔记库配置的格式插入链接。
- [x] 你会看到：输入 `[[计`，列表第一项是 `计划`。按回车，插入 `[[计划]]`。笔记库配置要求 Markdown 链接和相对路径时，插入 `[计划](项目/计划.md)`。最短路径下插入 `[计划](计划.md)`，因为 `计划` 不重名。

候选的匹配和排序用快速打开的 `quickOpenMatch.ts`，不写第二套。链接文字的规则照搬 Obsidian 1.15.1 的 `fileToLinktext` 和 `[[` 列表插入文字的函数，覆盖最短、相对、绝对 3 种格式。原计划写的是 `generateMarkdownLink`，但 Obsidian 的 `[[` 列表不调用它，见下面的结果。

验证：

- [x] 单元：Vitest 测 `linkText` 的 3 种格式和重名笔记。再测一条性质：5 个副本里任取源笔记和目标，`linkText` 生成的文字用 `resolveLink` 解析后回到同一个目标。
- [x] 对照：`obsidian-export.mjs` 导出 `links` 副本里每对笔记的 `fileToLinktext`，和 `linkText` 完全相同。
- [x] 单元：e2e 测试 `typing [[ completes note names in the vault's link format`。
- [x] 真实窗口，输入法：输入 `[[` 后用 `ime` 输入“计划”，选字期间按回车不插入链接。上屏后列表第一项是 `计划`。
- [x] 真实窗口：选中后等自动保存，`vault-diff` 只列出这篇笔记，新增的字节就是这个链接。
- [x] 性能：`workspace-copy` 的路径复制成 1 万条，补全每次按键的匹配时间用 `tools/bench-quick-open.mjs` 量。中位数超过 16 毫秒算失败。

### 结果

2026-11-20 实测。

**每个 PR 都要过的检查。** `npm run typecheck`、`npm run lint` 通过。`npm test`：Vitest 40 个通过，1 个预期失败。`npm run test:e2e`：11 个通过。`compare-links` 在 5 个副本上 0 处不一致。`links-copy` 上有 2 处，来自 PR C 正在往这个副本里加的 `子路径/` 文件夹，main 的代码在同一个副本上也是这 2 处。

**照搬的函数。** 读自 Obsidian 1.15.1 的 `app.js`。

| 函数 | 做什么 | mote 里的位置 |
| --- | --- | --- |
| `fileToLinktext` | 一个文件从某篇笔记看的链接路径。最短格式下，文件名只指向这个文件时只写文件名，否则写全路径 | `linkText.ts` 的 `fileToLinktext` |
| `PR` | `[[` 列表选中一个文件后插入的文字。双链的路径里有 `/` 时加上文件名作别名。光标后面到下一个 `]]` 的文字一起替换，其中的 `\|别名` 保留 | `linkText.ts` 的 `linkText` |
| `getLinkpathDest` | 链接路径能指向的所有文件。`fileToLinktext` 要知道是不是只有一个 | `resolve.ts` 的 `linkpathDest`，`resolveLink` 取第一个 |
| `onTrigger`、`getSuggestions` | 光标前同一行最后一个 `[[` 之后、没有 `]` 的文字是查询词，去掉首尾空格 | `complete.ts` |
| `Rt`、`he`、`Ci`、`tt`、`pe`、`pi`、`Qu`、`Vt` | 文件名、扩展名、父文件夹、去掉 `#`、Markdown 链接的编码、图片扩展名 | `linkText.ts` |

原计划写照搬 `generateMarkdownLink`。Obsidian 的 `[[` 列表不调用它，调用的是 `PR`。在 `links` 测试笔记库的 540 次调用里，两者有 166 次结果不同。例如双链下 `generateMarkdownLink` 给 `[[b/重名]]`，`[[` 列表插入 `[[b/重名|重名]]`。用户在 Obsidian 里输入 `[[` 看到的是后者，所以 mote 照搬 `PR`。导出文件里仍记下 `generateMarkdownLink` 的结果，方便比较。

**对照 Obsidian。** `obsidian-export.mjs --linktext` 在临时副本里打开 Obsidian，把 6 种配置（双链或 Markdown 链接，乘最短、相对、绝对）挨个写进 `.obsidian/app.json`。对每篇源笔记和每个目标文件，它调用 `fileToLinktext` 和 `generateMarkdownLink`。它还让 Obsidian 的 `[[` 列表真的选中这个文件。编辑器换成只记录改动的替身，所以不写任何笔记。光标后面放 5 种文字：空、`]]`、`|别名]]`、` 尾]] 后`、` [[下]]`。

| 笔记库 | 源笔记 × 文件 | `fileToLinktext` | 插入的文字、替换范围、光标位置 | 不同 |
| --- | --- | --- | --- | --- |
| `links`，提交为 `links.obsidian-linktext.json` | 9 × 10 | 540 | 2700 | 0 |
| 临时笔记库，含 `instructions.md.md` 和带 `%` 的文件名 | 6 × 6 | 216 | 1080 | 0 |

默认导出模式没有变。在 `links` 的新副本上跑，输出和提交的 `links.obsidian-links.json` 逐字节相同。

**解析回目标。** `tools/check-linktext.mjs` 对每篇源笔记和每个文件，在 6 种配置下生成链接，用共享的解析器解析，再用 `resolveLink` 解析。

| 副本 | 笔记 | 文件 | 链接数 | 不回到目标 |
| --- | --- | --- | --- | --- |
| `Pesemic-copy` | 15 | 15 | 1,350 | 0 |
| `knowledge-base-copy` | 68 | 68 | 27,744 | 0 |
| `life-os-copy` | 113 | 129 | 87,462 | 0 |
| `wiki-copy` | 11 | 11 | 726 | 0 |
| `workspace-copy` | 603 | 776 | 2,807,568 | 5,427 |

5,427 个都来自 3 个文件名：

- `instructions.md.md` 的双链。去掉 `.md` 后是 `instructions.md`，正好是旁边另一篇笔记的名字。603 篇 × 3 种格式。
- 两篇文件名带 `%` 的笔记的 Markdown 链接。`%20` 之外的 `%` 不编码，解码失败。603 篇 × 3 种格式 × 2 篇。

临时笔记库里放了同样的文件名。Obsidian 插入的文字和 mote 相同，它自己的 `resolvedLinks` 也解析不回这些链接。所以这是照搬的结果，不是 mote 的错。另外，Obsidian 把解码失败的 Markdown 链接整个忽略，mote 把它算成不存在的链接，这是解析器已有的差异，main 上也一样。

**真实窗口，`basic`。** 证据在 `verify-artifacts/` 下。

- `20261120-132334-f3bc`：打开 `欢迎`，在 `这是 mote 的验证笔记库。` 后面输入 ` [[计`。列表只有一行：`计划`，后面是 `项目`，已选中。按回车。`vault-diff` 只列出 `欢迎.md`，新增的字节是 ` [[计划]]`，没有删除。截图 `complete-list.png`。
- `20261120-133925-5e0c`：在同一行后面输入 ` [[`，再 `ime --text 计划 --commit 计划 --hold 400`。回车的 keydown 是 `isComposing: true`、key code 13。选字期间，列表第一项是 `计划`，光标前是 `[[计划`，没有插入链接。上屏后仍是 `[[计划`，列表第一项是 `计划`。再按回车，变成 `[[计划]]`。CDP 的 key code 13 回车让 Chromium 在光标后加了 2 个换行。对照：同一个 `ime` 命令用在没有 `[[` 的行尾，也加了 2 个换行，所以和补全无关。真实的 macOS 输入法回车是 key code 229，不加换行。e2e 测试发的就是 229，检查整行文字只多了链接。
- `20261120-142305-3d70`：同样输入 ` [[`，再 `ime --text 计划 --commit 计划 --no-enter --hold 400`。选字期间和上屏后，光标前都是 `[[计划`，列表第一项是 `计划`。按回车后变成 `[[计划]]`。`vault-diff` 只列出 `欢迎.md`，新增的字节是 ` [[计划]]`，没有删除。
- `20261120-134152-acde`：新启动，`walk-notes` 打开 5 篇，`errorCount` 0。`vault-diff --expect-unchanged` 输出 `unchanged`。

**性能，匹配。** 命令：`node tools/bench-quick-open.mjs ~/mote-link-check/workspace-copy --bench 10000 <查询>`，每个查询 100 次的中位数，单位毫秒。补全每次按键调用的就是这个 `suggest`。

| 查询 | 改前，3 轮 | 改后，3 轮 |
| --- | --- | --- |
| `计`、`计划` | 6.4 到 6.6 | 6.5 到 6.7 |
| `d` | 12.0 到 12.2 | 8.0 到 8.2 |
| `dai` | 18.0 到 20.3 | 13.5 到 13.7 |
| `daily` | 16.9 到 18.5 | 14.5 到 14.8 |
| `wechat` | 14.2 到 16.7 | 12.1 到 12.5 |

改前，英文查询超过 16 毫秒。`dai` 在 1 万条里命中几千条，原来的代码把命中的全部排序再取前 20。现在边扫描边保留前 20 条。18 个查询、3 种条数上限下，新旧结果逐条相同。剩下的时间在匹配本身：CPU 剖析里 `matchInOrder` 和 `matchTarget` 占 74%，它们对每条路径做 `toLowerCase` 和 `indexOf`。量的时候 1 分钟负载 5 到 7，新旧版本交替跑。

**性能，输入。** 命令：`$V launch --vault ~/mote-link-check/Pesemic-copy`，打开 `compute/compute_mvp_spec.md`，`bench-typing --chars 200 --where end`。基线用 PR B 记下的数：每键中位数 7.38 毫秒（3 次 7.58、7.38、6.51）。上限是它的 1.2 倍，8.9 毫秒。

| 版本 | 每键中位数，2 次 | p95 | 空闲中位数 |
| --- | --- | --- | --- |
| PR B（`de6e554`，同一时段另量） | 7.18、7.20 | 10.30、9.19 | 0.24、0.14 |
| PR G | 6.39、6.96 | 9.28、9.22 | 0.16、0.15 |

PR G 低于上限，也不比同一时段量的 PR B 慢。补全在每个键上只看光标前的一行，没有 `[[` 就返回。两边都比 PR B 之前 main 的 4.94 毫秒高，那是 PR B 的实时预览带来的。

**和 Obsidian 不同的地方。**

- Obsidian 的列表还有笔记的别名、不存在的链接和附件。mote 只列笔记。
- 查询为空时，Obsidian 按修改时间列出所有文件，不预先选中。mote 列出最近打开的 10 篇，选中第一篇，和快速打开一样。
- 查询里有 `^` 时，Obsidian 补全块引用。mote 不弹列表，和 `#`、`|` 一样。

## PR H：5 个副本验收

- [x] 依赖：全部。
- [x] 改动文件：`docs/features.md`、`docs/plans/step-3.md`（填结果）、`docs/adr/`（0010 到 0012）、`ARCHITECTURE.md`、`verify-mote` 的 `walk-links` 和功能文件、`tests/e2e/window.spec.ts`（新）、`tests/e2e/complete.spec.ts`。发现问题后改了 `NoteEditor.tsx`、`src/main/index.ts`、`src/main/fileProtocol.ts`、`editor/complete.ts`。
- [x] 做的一件事：证明第 3 步的两条完成标准。
- [x] 你会看到：5 个副本的逐个点击结果表，以及一个截图页。

验证：

- [x] 逐个点击：5 个副本上 `walk-links --obsidian`，每个副本 0 处不一致。
- [x] 逐篇打开：5 个副本在两种编辑器模式下 `walk-notes`，`errorCount` 是 0，`vault-diff` 输出 `unchanged`。
- [x] 截图页：每个副本挑 6 篇元素最多的笔记，在实时预览、阅读模式、深色、浅色下截图，汇总成 `verify-artifacts/step-3-gallery/index.html`。你看这一页。
- [x] 性能：重跑 PR B 的两项性能检查，和 PR A 之前的 main 比较。
- [x] 性能：在没有其他任务的机器上重跑 PR A 的 `--bench 9`。中位数超过 560 毫秒算失败。
- [x] 性能：PR C 留下的那一条，点击链接到目标笔记的编辑器出现。超过从文件树打开的 1.5 倍算失败。

### 结果

2026-11-21 实测。全部在合并了 PR A 到 G 的 main 加上本 PR 的改动上跑，一次只跑一项，机器上没有别的 mote 任务。原始输出在 `verify-artifacts/h-accept/`，这个目录不进仓库。

**逐个点击。** `walk-links` 在每篇笔记里点击每个画出来的链接，记下去向，再后退。去向和 Obsidian 的 `resolvedLinks` 比较。

| 副本 | 笔记 | 点击 | 打开笔记 | 交给默认程序 | 指向自己 | 画成不存在 | 没点的 | 不一致 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| life-os-copy | 113 | 102 | 94 | 8 | 0 | 19 | 4 | 0 |
| wiki-copy | 11 | 20 | 20 | 0 | 0 | 0 | 0 | 0 |
| Pesemic-copy | 15 | 58 | 1 | 0 | 57 | 31 | 0 | 0 |
| knowledge-base-copy | 68 | 282 | 282 | 0 | 0 | 5 | 19 | 0 |
| workspace-copy | 603 | 1191 | 1064 | 5 | 122 | 45 | 395 | 0 |
| 合计 | 810 | 1653 | 1461 | 13 | 179 | 100 | 418 | 0 |

- “没点的”是编辑器不画成链接的：属性里的链接，和画成图片的嵌入。它们的解析目标已由对照工具覆盖。
- “画成不存在”的数量和 Obsidian 的未解析数量一致。这些链接没有点，点了会新建笔记。
- 5 次走查后 `vault-diff` 都输出 `unchanged`，`errorCount` 都是 0。

第一次在 `workspace-copy` 上跑时，有 9 篇笔记不一致。原因都在测试工具，不在 mote：

- 7 篇报“没画出来”。工具记下第一次看到链接时的滚动位置，回头再滚到那里。这期间上方的图片加载完，页面变高，编辑器在那个位置不再画这一行。现在工具每次都问编辑器这一行现在在哪。
- 2 篇报“点了没跳”。工具算好点击位置后，上方的图片才加载完，链接移走了。现在工具等屏幕上的图片加载完，并确认点的位置上确实是这个链接。
- `life-os-copy` 有 1 处多出来：`![[Projects.base]]` 画成了可以点的链接，点了会打开 Obsidian 解析到的同一个文件。工具原来把所有嵌入都算成点不了，现在只减去画成图片或笔记内容的嵌入。

这也说明一件产品上的事：图片加载时页面会往下挪，你在加载过程中点链接，可能点到别的地方。Obsidian 也有这个现象。

**逐篇打开。** 5 个副本，实时预览和阅读模式各一次。每种模式打开 810 篇，`errorCount` 都是 0，10 次 `vault-diff` 都输出 `unchanged`。

**截图页。** `gallery.mjs` 在 5 个副本里各挑 6 篇，共 30 篇笔记、310 张图、55 MB。5 个副本的 `vault-diff` 都是 `unchanged`。`pbs.twimg.com` 的图片在这台机器上加载不出来，显示为占位框，页面上标了出来。

**自动检查。** e2e 18 个通过。Vitest 通过，1 个预期失败（PR A 记下的那条）。对照工具 6 个副本：2228 处链接、1975 处反向链接、233 处带 `#` 的链接落点，0 处不一致。

`check-linktext` 在 `workspace-copy` 上有 5427 个链接解析不回目标，占 280 万个的 0.2%，全部来自 3 个文件名：`instructions.md.md` 和两篇文件名带 `%` 的笔记。PR G 查过，Obsidian 插入的文字相同，它自己也解析不回去。其余 5 个副本 0 失败。

**性能。**

| 检查 | PR B 之前的 main | 现在 | 失败线 |
| --- | --- | --- | --- |
| 解析 `workspace-copy` 603 篇，`--bench 9` 的中位数 | 486.4 毫秒 | 550.3、546.8、554.5 毫秒 | 560 |
| 打字，63 KB 的笔记，每键主线程工作，结尾 | 4.94 毫秒 | 8.07、7.72、7.64 毫秒 | 16 |
| 打字，同一篇，开头 | 5.18 毫秒 | 8.16、8.13、8.46 毫秒 | 16 |
| 打开一篇笔记，`workspace-copy`，实时预览 | 78.2 毫秒 | 61.8、63.2、63.9 毫秒 | 117 |
| 打开一篇笔记，同上，阅读模式 | — | 68.5 毫秒 | 117 |
| 点击链接到编辑器出现，50 次的中位数 | — | 53.3 毫秒，从文件树打开同样的笔记是 66.4 毫秒，比值 0.8 | 1.5 倍 |

- 解析那一条在 PR A 时没能证明。现在证明了，但离 560 只差 10 毫秒。第 5 步处理 1 万篇笔记的性能时，解析是第一个要看的地方。
- 打开比基线快，是因为量基线时机器更忙。同一时段对照过，渲染没有让打开变慢。
- 打字的数分两段。实时预览全部做完后是 6.18 和 6.26 毫秒（各 3 次的中位数）。本 PR 去掉补全的两个延迟后是 7.72 和 8.16 毫秒，原因见下。

**本 PR 修的问题。**

1. 双链补全里按回车太快，会换行而不是插入链接。CodeMirror 的补全在按键后等 100 毫秒才去找候选，列表弹出后的 75 毫秒内又不接受回车。在这约 175 毫秒里按回车，得到的是一个换行。Obsidian 没有这两段等待。现在两个延迟都是 0。e2e 测试在最后一个键之后 30 毫秒按回车，链接照样插入。代价是每个键多约 1.7 毫秒的主线程工作：补全现在每个键都运行一次，原来在连续快打时被 100 毫秒的等待合并掉。如果以后打字发沉，可以改成只在 `[[` 之后才启动补全。
2. 阅读模式下从搜索或反向链接跳过去，选中的文字不显示。原因是不能编辑的视图拿不到焦点。现在阅读模式能拿焦点，仍然不能输入。测试：a search hit is selected in reading mode。
3. 窗口可以被带到别的页面，例如把一个 HTML 文件拖进窗口。新页面会拿到 `window.mote`，也就拿到笔记库的读写。现在主进程拦下所有去别的地址的跳转。`window.open` 也只把 `http`、`https` 和 `mailto` 交给系统，原来是任何地址。测试：the window does not navigate away from mote, and vault images come with inert headers。去掉这个保护，测试就失败，已验证。
4. `mote-file://` 的响应加上 `Content-Security-Policy` 和 `nosniff`。SVG 是文档，这样它即使被当成页面打开，脚本也不运行。
5. `ARCHITECTURE.md` 的模块表有一整份重复，是 PR C 和 PR E 解冲突时留下的，已删掉。
6. 这一步做的三个架构决定补了 ADR：0010 实时预览的结构，0011 点击时新建笔记，0012 加载 `https` 图片。

**知道但没修的。**

- 点击指向笔记库里非笔记文件的链接，mote 把它交给 macOS 的默认程序，这是链接-3 要求的行为。目标如果是 `.command` 这类文件，macOS 会运行它，而链接的文字可以写成别的样子。要不要改成在 Finder 里显示，等你决定。
- 点击链接跳到一篇笔记后，文件树不会展开到这篇笔记。Obsidian 默认也不展开。
- 任务复选框的无障碍名称是任务的原文，带着 `**` 这类符号。只影响读屏软件。
- `^块ID` 在编辑器里照原文显示，没有隐藏。
- 嵌入里的文字不能用鼠标选中。按下鼠标只用来点链接，这样主编辑器不丢焦点和光标。

## 还证明不了的

- “看起来对不对”要你看截图页。我能证明没有报错、字节不变、链接去向一致，证明不了排版好看。
- 真实的 macOS 外观切换。`theme` 命令用 Electron 的 `nativeTheme` 模拟，不改你的系统设置。
- 默认程序真的打开了附件。测试只证明 mote 把副本内的正确路径交给了 macOS。
- 真实的 macOS 输入法。`ime` 命令用 CDP 模拟选字和上屏。
- 笔记嵌入在真实笔记库里的样子。5 个副本里没有 `![[笔记名]]`，嵌入只在测试笔记库 `preview` 上证明过。
- 改名后链接是否更新属于第 4 步。1 万篇笔记的性能属于第 5 步。
- 5 个副本里没有的写法，例如嵌套 callout，只有测试笔记库 `preview` 覆盖。
