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

- [ ] 依赖：PR A。
- [ ] 改动文件：`package.json`、`src/renderer/src/NoteEditor.tsx`、`src/renderer/src/editor/`（新）、`workspace.ts`、`App.tsx`、`main.css`、`src/main/index.ts`、`tests/fixtures/vaults/preview/`（新）、`tests/e2e/preview.spec.ts`（新）、`verify-mote.mjs`、`features/live-preview.md`、`features/dark-mode.md`、`CONTEXT.md`、`ARCHITECTURE.md`、`docs/features.md`。
- [ ] 做的一件事：编辑器按语法树渲染行内元素。`Cmd+E` 切换编辑器模式。颜色跟随 macOS。
- [ ] 你会看到：标题变大。`**粗体**` 两边的星号消失，光标移进去时星号出现。`[[笔记|别名]]` 只显示别名，目标不存在的双链是另一种颜色。属性显示为一个 YAML 代码块。按 `Cmd+E` 后不能输入，再按一次恢复。

渲染的元素：标题、粗体、斜体、删除线、高亮、行内代码、标签、双链、Markdown 链接、列表、引用、分隔线、代码块、属性块。链接在这个 PR 里只有样式，点击在 PR C。

列表项换行后和文字对齐。在列表里按回车，下一行接着是列表项。

验证：

- [ ] 单元：e2e 测试 `live preview hides syntax away from the selection and shows it at the selection`、`Cmd+E switches to reading mode and back`、`the window follows the system color scheme`。
- [ ] 真实窗口，`preview`：打开 `行内.md`，编辑器的可见文字里没有 `**` 和 `[[`。点击粗体所在的词，可见文字里出现 `**`。按 `Cmd+E`，输入一个字，文档不变。
- [ ] 真实窗口，输入法：在含粗体和链接的行尾用 `ime` 输入“测试”。上屏后 `vault-diff` 只列出这篇笔记，文件只多出这两个字。
- [ ] 真实窗口，配色：`verify-mote` 加 `theme --scheme dark|light` 命令。两种配色下各截一张图，各读一次编辑器背景和文字的计算颜色。两组颜色不同，对比度都不低于 4.5。
- [ ] 真实窗口，5 个副本：两种编辑器模式下各跑一次 `walk-notes`，`errorCount` 是 0，`vault-diff` 输出 `unchanged`。
- [ ] 性能，输入：在最大的笔记（`Pesemic-copy`，63.4 KB）中间连续输入 200 个字符，量每个字符从按键到画面更新的时间。先在 main 上量基线。中位数超过 16 毫秒算失败。
- [ ] 性能，打开：`workspace-copy` 上 `walk-notes` 的总耗时。先在 main 上量基线。超过基线的 1.5 倍算失败。

## PR C：点击链接、新建笔记、后退和前进

- [ ] 依赖：PR B。
- [ ] 改动文件：`src/core/linkDest.ts`（新）、`src/core/subpath.ts`（新）、`src/core/markdown.ts`、`src/renderer/src/editor/follow.ts`（新）、`workspace.ts`、`App.tsx`、`src/main/vault.ts`、`src/main/index.ts`、`tools/obsidian-export.mjs`、`tools/compare-links.mjs`、`verify-mote.mjs`、`tests/e2e/links.spec.ts`（新）、`features/follow-links.md`、`ARCHITECTURE.md`、`docs/features.md`。
- [ ] 做的一件事：点击链接跳到链接去向。`Cmd+Option+←` 后退，`Cmd+Option+→` 前进。
- [ ] 你会看到：点 `[[项目/计划]]` 打开 `计划`。点 `[[计划#目标]]` 打开后，`目标` 这个标题在窗口顶部。点一个不存在的双链，文件树里多出这篇笔记，编辑器打开它。点 PDF 链接，macOS 用默认程序打开。按 `Cmd+Option+←` 回到上一篇，光标在离开时的位置。

点击规则：元素没有显示源码时，单击就跳。任何时候 `Cmd+单击` 都跳，属性块里的链接也是。

跳到标题的规则照搬 Obsidian 1.15.1 的 `resolveSubpath`。`tools/obsidian-export.mjs` 多导出一项：每个带 `#` 的链接在 Obsidian 里落在哪一行。对照工具比较这一项。

新建笔记时，主进程只在笔记库内创建缺少的文件夹，并拒绝穿过符号链接。外部网址只放行 `http`、`https` 和 `mailto`。

验证：

- [ ] 单元：Vitest 测 `linkDest` 的 4 种去向，测新建路径在 3 种新笔记位置配置下的结果，测 `subpath` 的标题和块引用。e2e 测试 `clicking a link opens its target and Cmd+Option+Left goes back`、`clicking a missing link creates the note where the vault config says`。
- [ ] 对照：带 `#` 的链接落在的行，`links` 副本和 5 个副本都和 Obsidian 一致。
- [ ] 真实窗口，逐个点击：`verify-mote` 加 `walk-links --obsidian <导出文件>`。它在每篇笔记里点击每个已渲染的链接，记下打开的路径，再后退。每篇笔记按目标汇总次数，和导出文件比较。这个 PR 先在 `links` 副本和 `life-os-copy` 上跑到 0 处不一致，5 个副本的完整结果在 PR H。
- [ ] 真实窗口，新建：点不存在的双链后，`vault-diff` 只多出这一个空文件。
- [ ] 真实窗口，默认程序：点附件链接后，用 `main-eval` 读到 `shell.openPath` 收到的路径在副本内。测试里把 `shell.openPath` 换成记录函数，不真的打开程序。
- [ ] 性能：点击到目标笔记可以编辑的时间，`workspace-copy` 上 50 次的中位数。和从文件树打开同一篇笔记比较，超过它的 1.5 倍算失败。

## PR D：图片

- [ ] 依赖：PR B。
- [ ] 改动文件：`src/main/index.ts`、`src/main/vault.ts`、`src/renderer/index.html`、`src/renderer/src/editor/images.ts`（新）、`tests/e2e/images.spec.ts`（新）、`features/images.md`、`docs/adr/0007-mote-file-protocol.md`（只改状态行）、`ARCHITECTURE.md`、`docs/features.md`。
- [ ] 做的一件事：`![](路径)` 和 `![[图片名]]` 在两种编辑器模式下显示图片。
- [ ] 你会看到：`欢迎.md` 里 `![[图片.png]]` 的位置出现图片。光标移到那一行时，图片上方显示源码。

主进程注册 `mote-file://`，只读当前笔记库里的文件，用 `parseVaultPath` 拒绝 `..` 和以 `.` 开头的部分。内容安全策略的 `img-src` 加上 `mote-file:` 和 `https:`。`![[图片.png|300]]` 按 300 像素宽显示。不是图片的嵌入显示为链接。

验证：

- [ ] 单元：e2e 测试 `images load from the vault and nothing outside it`。它检查图片的 `naturalWidth` 大于 0。它再请求 `mote-file://` 下的 `../` 路径、`.obsidian/app.json` 和笔记库外的绝对路径，全部失败。
- [ ] 真实窗口，`knowledge-base-copy`：打开一篇有本地图片的笔记，页面里每个本地图片的 `naturalWidth` 都大于 0。
- [ ] 真实窗口，`workspace-copy`：打开一篇有 `https` 图片的笔记，至少一张加载成功。断网时这一条记为未证明。
- [ ] `vault-diff --expect-unchanged` 输出 `unchanged`。
- [ ] 性能：`workspace-copy` 上 `walk-notes` 的总耗时，和 PR B 合并后的 main 比较，超过 1.5 倍算失败。

## PR E：callout、表格和任务复选框

- [ ] 依赖：PR B。
- [ ] 改动文件：`src/core/markdown.ts`（callout 识别函数）、`src/renderer/src/editor/callouts.ts`、`tables.ts`、`tasks.ts`（均为新）、`tests/fixtures/vaults/preview/`、`tests/e2e/blocks.spec.ts`（新）、`features/blocks.md`、`docs/adr/0002-one-parser.md`（只改状态行）、`docs/features.md`。
- [ ] 做的一件事：callout 显示为带颜色和标题的块。表格渲染成表格。任务前面是可以点的复选框。
- [ ] 你会看到：`> [!warning] 注意` 变成橙色的块，标题是“注意”。表格有边框和对齐，光标移进去时变回 Markdown 源码。点复选框，`- [ ]` 变成 `- [x]`。

callout 的类型和颜色放在一张表里，别名也在表里，例如 `tip`、`hint`、`important` 是同一种。表格单元格里的行内元素用 PR B 的 `inlineStyles` 渲染，链接可以点。点复选框只改方括号里的 1 个字符，在阅读模式下也能点。

验证：

- [ ] 单元：Vitest 测 callout 识别函数。e2e 测试 `callouts, tables and task checkboxes render, and a checkbox click changes one byte`。
- [ ] 真实窗口，`preview`：8 种 callout 类型各一个，读到的边框颜色有 8 组不同的值。表格的 `th` 和 `td` 数量和源码一致。光标移进表格后，可见文字里有 `|`。
- [ ] 真实窗口，任务：点一个复选框，等自动保存。`vault-diff` 只列出这篇笔记，`cmp -l` 显示只差 1 个字节。
- [ ] 真实窗口，`workspace-copy`：打开 callout 最多和表格最多的两篇笔记，没有页面错误，截图。
- [ ] 真实窗口，输入法：在表格下面一行用 `ime` 输入中文，上屏后只多出这几个字。
- [ ] 性能：重跑 PR B 的输入检查，笔记换成表格最多的那篇。中位数超过 16 毫秒算失败。

## PR F：Mermaid 图和笔记嵌入

- [ ] 依赖：PR C、D、E。
- [ ] 改动文件：`package.json`（加 `mermaid`）、`src/renderer/src/editor/mermaid.ts`、`embeds.ts`（均为新）、`src/renderer/index.html`、`tests/fixtures/vaults/preview/`、`tests/e2e/reading.spec.ts`（新）、`features/reading-mode.md`、`docs/features.md`。
- [ ] 做的一件事：Mermaid 代码块显示为图。`![[笔记名]]` 显示被嵌入笔记的内容。
- [ ] 你会看到：阅读模式下，`mermaid` 代码块是一张流程图。`![[计划]]` 的位置是 `计划` 的正文，带一条左边线。`![[计划#目标]]` 只显示这一节。

嵌入是一个只读的 CodeMirror 视图，用同一套预览扩展，不是第二个渲染器。嵌入最多套 3 层。被嵌入的笔记改动后，嵌入的内容跟着更新。Mermaid 出错时显示代码和错误信息。

验证：

- [ ] 单元：e2e 测试 `reading mode renders mermaid diagrams and embedded notes`。
- [ ] 真实窗口，`preview`：阅读模式下，Mermaid 块里有 `svg`。嵌入里有 `计划` 的文字。用 shell 改 `计划.md`，1 秒内嵌入里出现新文字。
- [ ] 真实窗口，`life-os-copy`：打开有 Mermaid 的那篇笔记，图渲染出来，截图。
- [ ] 真实窗口，循环嵌入：`A` 嵌入 `B`，`B` 嵌入 `A`，窗口不卡死，没有页面错误。
- [ ] `vault-diff --expect-unchanged` 输出 `unchanged`。
- [ ] 性能：没有 Mermaid 的笔记不加载 Mermaid 库，用 `eval` 读已加载的脚本确认。启动到可以编辑的时间和 PR E 合并后的 main 比较，超过 1.2 倍算失败。

## PR G：双链补全

- [ ] 依赖：PR B。
- [ ] 改动文件：`package.json`（加 `@codemirror/autocomplete`）、`src/core/linkText.ts`（新）、`src/renderer/src/editor/complete.ts`（新）、`NoteEditor.tsx`、`tools/obsidian-export.mjs`、`tools/compare-links.mjs`、`tests/e2e/complete.spec.ts`（新）、`features/link-complete.md`、`docs/features.md`。
- [ ] 做的一件事：输入 `[[` 后弹出笔记名列表。选中后按笔记库配置的格式插入链接。
- [ ] 你会看到：输入 `[[计`，列表第一项是 `计划`。按回车，插入 `[[计划]]`。笔记库配置要求 Markdown 链接时，插入 `[计划](项目/计划.md)`。

候选的匹配和排序用快速打开的 `quickOpenMatch.ts`，不写第二套。链接文字的规则照搬 Obsidian 1.15.1 的 `generateMarkdownLink` 和 `fileToLinktext`，覆盖最短、相对、绝对 3 种格式。

验证：

- [ ] 单元：Vitest 测 `linkText` 的 3 种格式和重名笔记。再测一条性质：5 个副本里任取源笔记和目标，`linkText` 生成的文字用 `resolveLink` 解析后回到同一个目标。
- [ ] 对照：`obsidian-export.mjs` 导出 `links` 副本里每对笔记的 `fileToLinktext`，和 `linkText` 完全相同。
- [ ] 单元：e2e 测试 `typing [[ completes note names in the vault's link format`。
- [ ] 真实窗口，输入法：输入 `[[` 后用 `ime` 输入“计划”，选字期间按回车不插入链接。上屏后列表第一项是 `计划`。
- [ ] 真实窗口：选中后等自动保存，`vault-diff` 只列出这篇笔记，新增的字节就是这个链接。
- [ ] 性能：`workspace-copy` 的路径复制成 1 万条，补全每次按键的匹配时间用 `tools/bench-quick-open.mjs` 量。中位数超过 16 毫秒算失败。

## PR H：5 个副本验收

- [ ] 依赖：全部。
- [ ] 改动文件：`docs/features.md`、`docs/plans/step-3.md`（填结果）、`verify-mote` 的功能文件。发现问题时改对应的源码。
- [ ] 做的一件事：证明第 3 步的两条完成标准。
- [ ] 你会看到：5 个副本的逐个点击结果表，以及一个截图页。

验证：

- [ ] 逐个点击：5 个副本上 `walk-links --obsidian`，每个副本 0 处不一致。
- [ ] 逐篇打开：5 个副本在两种编辑器模式下 `walk-notes`，`errorCount` 是 0，`vault-diff` 输出 `unchanged`。
- [ ] 截图页：每个副本挑 6 篇元素最多的笔记，在实时预览、阅读模式、深色、浅色下各截一张，汇总成 `verify-artifacts/step-3-gallery/index.html`。你看这一页。
- [ ] 性能：重跑 PR B 的两项性能检查，和 PR A 之前的 main 比较。
- [ ] 性能：在没有其他任务的机器上重跑 PR A 的 `--bench 9`。中位数超过 560 毫秒算失败。

## 还证明不了的

- “看起来对不对”要你看截图页。我能证明没有报错、字节不变、链接去向一致，证明不了排版好看。
- 真实的 macOS 外观切换。`theme` 命令用 Electron 的 `nativeTheme` 模拟，不改你的系统设置。
- 默认程序真的打开了附件。测试只证明 mote 把副本内的正确路径交给了 macOS。
- 改名后链接是否更新属于第 4 步。1 万篇笔记的性能属于第 5 步。
- 5 个副本里没有的写法，例如嵌套 callout，只有测试笔记库 `preview` 覆盖。
