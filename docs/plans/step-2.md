# 第 2 步实现计划

本计划实现 [功能列表](../features.md#开发顺序) 开发顺序第 2 步。完成标准是 [验收清单](../features.md#验收清单) 第 2 条：在 5 个笔记库副本里，mote 解析出的每个链接目标都和 Obsidian 的 `resolvedLinks` 一致。

本文用到的词：

- **副本**：`~/mote-link-check/` 下 5 个笔记库的冻结拷贝。原始笔记库从不打开。
- **导出文件**：Obsidian 在副本上导出的解析结果，放在副本旁边，名为 `<副本>.obsidian-links.json`。
- **对照工具**：`tools/compare-links.mjs`。它用 mote 的代码解析副本，再和导出文件比较。
- **规范化文本**：编辑器里的文本。去掉 BOM，所有换行统一成 `\n`。
- **真实窗口**：用 `verify-mote` 启动并驱动的 mote 窗口。

## 4 个 PR

按合并顺序排列：

| PR | 内容 | 依赖 | 证明 |
| --- | --- | --- | --- |
| A | 快速打开（`Cmd+O`），照 Obsidian 的匹配和打分 | 无 | 真实窗口，中文关键词 |
| B | 解析器、链接解析、对照工具 | 无 | 对照工具在 5 个副本上 0 处不一致 |
| C | 主进程索引、反向链接面板 | B | 真实窗口逐篇对照 Obsidian |
| D | 全文搜索（`Cmd+Shift+F`） | C | 真实窗口，中文关键词，grep 计数对照 |

```
main ──┬── A 快速打开
       └── B 解析和对照 ── C 反向链接 ── D 全文搜索
```

A 和 B 改的文件不重叠，可以同时做。B 等你跑完导出就能开工，A 不需要导出。每个 PR 结束时都跑 `vault-diff --expect-unchanged`，输出必须是 `unchanged`。

## 先做：在副本上导出 Obsidian 的解析结果

副本已经建好。拷贝时跳过了 `.git`，关掉了全部社区插件和 Sync 核心插件。笔记字节和原始笔记库一致，已用 `tools/hash-vault.mjs` 对比过。

| 副本 | 原始笔记库 | 笔记数 |
| --- | --- | --- |
| `~/mote-link-check/life-os-copy` | `~/life-os` | 113 |
| `~/mote-link-check/wiki-copy` | `~/wiki` | 11 |
| `~/mote-link-check/Pesemic-copy` | `~/workspace/Pesemic` | 15 |
| `~/mote-link-check/workspace-copy` | `~/Downloads/workspace` | 603 |
| `~/mote-link-check/knowledge-base-copy` | `~/Downloads/workspace/knowledge-base` | 68 |

导出用 `tools/obsidian-export.mjs`，不用手动操作 Obsidian。做法见 ADR 0008。

```sh
node tools/obsidian-export.mjs ~/mote-link-check/*-copy
```

它把 `{ obsidian, files, resolved, unresolved }` 写到副本旁边，例如 `~/mote-link-check/life-os-copy.obsidian-links.json`。`obsidian` 是实际加载的 Obsidian 版本。导出前后用 `tools/hash-vault.mjs` 哈希副本，笔记字节不变（2026-11-20 实测，5 个副本）。

## 数据结构

这些类型放在 `src/core/model.ts`。

```ts
type LinkRef = {
	syntax: 'wiki' | 'markdown'
	embed: boolean                     // ![[x]] 或 ![](x)
	target: string                     // 链接路径。Markdown 链接已解码，不含 #子路径 和 |别名
	subpath: string | null             // #标题 或 #^块
	alias: string | null
	range: { from: number; to: number } // 在规范化文本里的位置
}

// 一处可以跳转的位置。反向链接和搜索结果都用它
type Hit = {
	path: VaultPath
	from: number                       // 在规范化文本里的位置，编辑器直接用
	to: number
	preview: { text: string; from: number; to: number } // 所在行的片段和高亮范围
}

// 和 Obsidian 的 resolvedLinks、unresolvedLinks 同形，对照工具直接比较
type ResolvedLinks = {
	resolved: Record<VaultPath, Record<VaultPath, number>>
	unresolved: Record<VaultPath, Record<string, number>>
}
```

三个决定：

- `kind: 'embed'` 拆成 `syntax` 和 `embed`。改名时要知道嵌入用的是哪种写法。
- 反向链接不缓存。每次查询都遍历全部链接再解析。604 篇笔记约 2000 个链接，查询一次在毫秒级（推断，PR C 实测）。这样就没有要同步失效的缓存。
- `LinkRef.range` 和 `Hit` 用规范化文本的位置。主进程和编辑器用同一个函数做规范化，位置直接对得上，CRLF 和 BOM 笔记也一样。

`resolvedLinks` 不只统计双链和 Markdown 链接。它还统计 `![[x]]`、`![](x)` 和属性里的双链（推断，第一次对照时确认）。5 个副本的属性里有 354 行含双链，所以 mote 也要提取这三类，否则总数对不上。

## 对照工具怎么计数

`node tools/compare-links.mjs ~/mote-link-check/*-copy` 对每个副本输出三部分：

1. **文件集合**：mote 扫描到的文件和导出文件的 `files` 是否相同。不同时先列出差异，因为文件集合不同，解析结果必然不同。
2. **总数和一致数**：总数是 Obsidian 统计的链接出现次数，即 `resolved` 和 `unresolved` 的计数之和。按（源笔记，目标）分组，两边计数取较小值再求和，得到一致数。
3. **每一处不一致**：两边计数不同的每个（源笔记，目标）。每处列出两边的计数，以及 mote 那边对应链接的行号和原文。

有任何不一致时，退出码为 1。对照工具和主进程用同一个读取函数，所以它测的就是 mote 的代码路径。

## PR A：快速打开

- [ ] 依赖：无，从 main 开分支。
- [ ] 改动文件：`src/renderer/src/QuickOpen.tsx`（新）、`src/renderer/src/quickOpenMatch.ts`（新，匹配函数）、`workspace.ts`（记录最近打开）、`App.tsx`、`main.css`、`tests/e2e/`、`tools/bench-quick-open.mjs`（新）、`verify-mote` 的 `features/quick-open.md` 和 `features/README.md`。
- [ ] 做的一件事：按 `Cmd+O` 弹出快速打开窗口，按 Obsidian 的规则筛选笔记，回车打开。
- [ ] 你会看到：窗口顶部弹出输入框，列出最近打开的笔记。输入“计划”，第一项是 `项目/计划`。上下键选择，回车打开，`Esc` 关闭。

匹配规则读自 Obsidian 1.15.1 的 `app.js`（`~/Library/Application Support/obsidian/obsidian-1.15.1.asar`）。函数名是压缩后的，下面括号里注明出处。

- **候选**：每篇笔记一个候选串，是去掉 `.md` 的完整路径（`_V`）。
- **分词**（`Gi`）：查询去掉首尾空格，转小写，按空白分词。每个中文字和每个标点单独算一个词。中文字指 `lT` 里的范围，标点指 `Pb` 里的字符。
- **按词匹配**（`bX`）：各个词在目标里按顺序出现就算命中，中间可以隔着别的字。每个词从上一个词的结尾往后找第一次出现的位置。
- **按字回退**（`Ki`）：按词不命中时，把查询去掉空格后拆成单个字符，再按顺序匹配一次。例如 `abc` 能命中 `a-b-c`。
- **先文件名后路径**（`FR`）：先拿文件名匹配，即候选串最后一个 `/` 之后的部分。不命中时再拿完整候选串匹配，命中的分数减 1。
- **打分**（`Ep`）：命中区间按相邻合并。分数 = −(区间数 − 1) − 词边界扣分/10 − (首末区间跨度 − 查询长度)/100 − 首个区间起点/1000 − 目标长度/10000。连在一起的命中区间少，所以排在零散命中前面。词边界扣分是 `bX` 里的大小写和分隔符规则，照搬。
- **排序**：按分数从高到低，分数相同时保持路径列表的顺序，最多显示 20 条（`Aa` 的 `limit = 20`）。
- **空查询**：列出最近打开的笔记，最多 10 条（`getRecentFiles` 的 `maxCount`）。
- **这一步不做**：别名、未解析的链接、新建笔记、书签、附件，以及重音折叠（`Il`，把 é 当作 e）。重音折叠对中文没有影响。

最近打开的列表由渲染进程持有，按笔记库存进 `localStorage`。`localStorage` 在 `~/Library/Application Support/mote` 下，不写笔记库。列表只有渲染进程写，没有第二个持有者。显示时去掉已删除的笔记。

数据来自渲染进程已有的路径列表，不需要新 IPC。快捷键在渲染进程里监听，不做菜单项。原因是 `verify-mote press` 触发不了菜单快捷键。中文输入法选字时按的回车不打开笔记。

验证：

- [ ] 单元：e2e 测试在 `basic` 测试笔记库上输入“计划”“笔记”，检查列表和打开的笔记；再检查空查询列出刚打开的笔记。
- [ ] 真实窗口，`basic`：`press --key Meta+O`，`type --text 计划`，第一项是 `计划`；按回车后编辑器的 `data-note-path` 是 `项目/计划.md`。再按 `Meta+O`，空查询的第一项是 `项目/计划`。
- [ ] 真实窗口，`workspace-copy`：选一个中文关键词。用 `tools/bench-quick-open.mjs` 在 node 里对同一份路径列表跑同一个匹配函数，列出前 20 条，作为对照。窗口里的列表和它完全相同。这证明窗口用的是这个函数，不证明函数和 Obsidian 一致。
- [ ] 和 Obsidian 对照：同一个关键词，你在 Obsidian 里打开 `workspace-copy` 按 `Cmd+O` 看前几条，和 mote 比较。这一步需要你做，结果记进 PR。
- [ ] 输入法：用 CDP 的 `Input.imeSetComposition` 模拟选字回车，笔记不打开。模拟不了就如实报告，列为未证明。
- [ ] `vault-diff --expect-unchanged` 输出 `unchanged`。
- [ ] 性能：用 node 计时匹配函数。输入是 `workspace-copy` 的路径复制成 1 万条，查询 1 个和 2 个中文字，取 100 次的中位数。超过 16 毫秒算失败。main 上没有这个功能，没有基线。

## PR B：解析器、链接解析和对照工具

- [x] 依赖：无，从 main 开分支。需要 5 个导出文件。
- [x] 改动文件：`src/core/model.ts`、`text.ts`、`markdown.ts`、`resolve.ts`（均为新）、`src/main/notes.ts`（新，从 `vault.ts` 抽出扫描和读取）、`vault.ts`、`NoteEditor.tsx`（规范化函数移到 `src/core/text.ts`）、`tools/compare-links.mjs`（新）、`tests/fixtures/vaults/links/`（新）、`package.json`、`tsconfig*.json`、`docs/features.md`、`ARCHITECTURE.md`、`verify-mote` 的 `features/links.md`。
- [x] 做的一件事：mote 能从笔记里提取链接，并按 Obsidian 的规则解析目标。
- [x] 你会看到：对照工具在 5 个副本上的输出：总数、一致数、不一致 0 处。

解析器用 `@lezer/markdown`，加上双链、嵌入和属性块三个扩展。代码块和行内代码里的链接不算。第 3 步的编辑器也用这份配置。

链接解析的规则从对照结果里得出，不靠猜。先写最直接的规则，跑对照工具，再逐类修正不一致。每修一类，PR 描述里记一次对照输出，你能看到不一致数怎么降到 0。

我用正则扫了 5 个副本，下面这些写法都出现了，对照工具会逐一检验。数字是 5 个副本分别统计再相加，`workspace-copy` 包含 `knowledge-base`，所以有重复。

| 写法 | 次数 |
| --- | --- |
| 代码块里的 `[[` | 29 |
| 行内代码里的 `[[` | 15 |
| 重名的笔记文件名 | 47 |
| `[[../x]]` 相对双链 | 10 |
| `%20` 编码的 Markdown 链接 | 11 |
| `](../` 和 `](./` 相对路径 | 37 |
| `![](本地图片)` | 74 |
| 属性里含双链的行 | 354 |

收敛后，把每条规则写成测试笔记库 `tests/fixtures/vaults/links/` 里的一个例子。你在它的副本上再导出一次，导出文件提交进仓库。之后 `npm test` 跑对照工具，用 Obsidian 的结果做回归测试，不依赖你的私人笔记库。

`src/core` 和 `src/main/notes.ts` 只用 Node 能直接去掉的类型语法，相对导入写 `.ts` 后缀。这样 `node tools/compare-links.mjs` 能直接导入它们。已在 Node 22.22 上试过。

验证：

- [x] 单元：Vitest 测 `extractLinks` 的位置、别名、子路径、代码块和属性块。`npm test` 跑 Vitest，再在 `links` 测试笔记库上跑对照工具。
- [x] 对照：`node tools/compare-links.mjs ~/mote-link-check/*-copy`，5 个副本都是 0 处不一致。完整输出贴在 PR 里。
- [x] 真实窗口：这个 PR 不改界面，所以窗口只做回归检查。在 5 个副本上分别 `launch --vault`，跑 `walk-notes`。在 `basic` 上重跑编辑保存的步骤，用 `xxd` 确认 CRLF、BOM、无结尾换行三篇笔记的字节不变，因为规范化函数换了位置。链接解析在真实窗口里的证明放在 PR C。
- [x] `vault-diff --expect-unchanged` 输出 `unchanged`。
- [x] 性能：用 node 计时读取并解析 `workspace-copy` 的全部笔记，取 5 次中位数。超过 500 毫秒算失败。这是我定的数，用来给打开笔记库的 2 秒目标留余量。
  结果（实测）：逐篇顺序读取时中位数 608 毫秒，失败。改成 32 路并发读取后，9 次中位数 483 毫秒，通过，但余量只有 17 毫秒。其中 lezer 解析约 310 毫秒，是单一解析器的成本。

### 结果

规则从对照结果收敛，每一轮的完整输出在 `docs/plans/compare-log/`：

| 轮次 | 改了什么 | 不一致 |
| --- | --- | --- |
| [01](compare-log/01-direct-rules.txt) | 最直接的规则：完整路径，再按文件名取第一个 | 428 |
| [02](compare-log/02-obsidian-lookup.txt) | 照搬 Obsidian 的 `getLinkpathDest`：自链接、相对路径、后缀匹配、同文件夹优先、按路径长度排序；未解析的键去掉 `.md` | 18 |
| [03](compare-log/03-frontmatter-yaml.txt) | 属性用 `yaml` 包解析，只认整串是链接的字符串值（ADR 0009） | 0 |

查找顺序和计数规则读自 Obsidian 1.15.1 的 `app.js`：`getLinkpathDest`、`aJ`、`pi`、`wR`、`Ps`、`QK`。源码只用来解释对照里的不一致，每条规则都由对照结果确认。

测试笔记库 `tests/fixtures/vaults/links/` 每条规则一个例子。它的导出文件是 `tests/fixtures/vaults/links.obsidian-links.json`，由 `obsidian-export.mjs` 生成。


## PR C：反向链接

- [ ] 依赖：PR B。
- [ ] 改动文件：`src/main/vault.ts`、`src/main/index.ts`、`src/core/ipc.ts`、`src/preload/index.ts`、`workspace.ts`、`NoteEditor.tsx`、`App.tsx`、`src/renderer/src/HitList.tsx`（新）、`main.css`、`tests/e2e/`、`verify-mote.mjs`、`features/backlinks.md`。
- [ ] 做的一件事：主进程在内存里保存全部笔记的文本和链接，右侧面板显示当前笔记的反向链接。
- [ ] 你会看到：打开 `欢迎`，右侧列出 `计划` 和链接所在的那一行。点这一行，打开 `计划`，光标选中那个链接。

主进程打开笔记库时读入全部笔记，文件变化时更新。新增 IPC `backlinks(dir, path): Promise<Hit[]>`。渲染进程在三种时候重新获取：切换笔记、收到 `onVaultChanged`、保存成功。新增 `workspace.open(path, at?)`，打开笔记后选中 `at` 指定的范围。PR D 复用它和 `HitList`。

容易出错的两处：

- 主进程现在会过滤自己保存触发的文件通知。索引仍然要更新，只是不通知渲染进程。
- 索引必须先更新，再通知渲染进程。否则渲染进程会拿到旧的反向链接。

验证：

- [ ] 单元：e2e 测试在 `basic` 上检查 `欢迎` 的反向链接，并点击跳转。
- [ ] 真实窗口，逐篇对照：给 `walk-notes` 加 `--obsidian <导出文件>` 选项。它点开每篇笔记，读出反向链接面板，和导出文件反推的结果比较。比较内容是每篇来源笔记和它的链接数。5 个副本都要 0 处差异。
- [ ] 真实窗口，外部修改：用 shell 新建一篇链接到 `欢迎` 的笔记，1 秒内出现在面板里；删掉它，它从面板消失。
- [ ] 真实窗口，自己保存：在 `计划` 里输入 `[[带BOM]]`，等自动保存，打开 `带BOM`，面板里有 `计划`。再撤销这次输入并等自动保存，`计划.md` 回到原来的字节。
- [ ] 最后一步 `vault-diff --expect-unchanged` 输出 `unchanged`。
- [ ] 性能：在 `workspace-copy` 上分别计时 main 和这个分支的打开笔记库耗时。main 是基线，要先测。超过 2 秒算失败。再用 node 计时被链接最多的笔记的反向链接查询，超过 50 毫秒算失败。50 毫秒是我定的数，文档里没有。

## PR D：全文搜索

- [ ] 依赖：PR C。
- [ ] 改动文件：`src/core/search.ts`（新）、`src/core/ipc.ts`、`src/main/index.ts`、`src/preload/index.ts`、`App.tsx`、`src/renderer/src/SearchPanel.tsx`（新）、`main.css`、`tests/e2e/`、`features/search.md`。
- [ ] 做的一件事：按 `Cmd+Shift+F`，左侧栏切到搜索，在全部笔记里找子串。
- [ ] 你会看到：左侧栏顶部有“文件”和“搜索”两个按钮。输入“验证笔记库”，结果里有 `欢迎` 和匹配的那一行，关键词高亮。点它，编辑器跳到那里并选中这几个字。

规则照 Obsidian 的搜索：

- **入口**：搜索放在左侧栏，按 `Cmd+Shift+F` 打开。先在编辑器里选中文字再按，选中的文字填进搜索框。文字里有空格时加上引号。
- **分词**：按空格分词。引号里的部分算一个词，按短语匹配。
- **命中**：每个词独立匹配，同一篇笔记里所有词都出现才算命中。每个词同时匹配文件名和正文，文件名包含扩展名。
- **大小写**：默认不分大小写。
- **结果**：按笔记分组，默认按文件名 A 到 Z 排序。每组列出正文里每一处匹配。点一处结果，编辑器跳到那里并选中匹配的文字。
- **这一步不做**：`path:`、`tag:`、正则、`OR` 和 `-`。

新增 IPC `search(dir, query): Promise<{ groups: { path: VaultPath; hits: Hit[] }[]; total: number }>`。匹配用转义后的词构造带 `iu` 标志的正则，这样不分大小写，位置也不会偏。停止输入 150 毫秒后开始搜索，输入法选字期间不搜索。

验证：

- [ ] 单元：Vitest 测 `search` 的分词、引号短语、多词同篇、文件名命中、大小写和位置。e2e 测试在 `basic` 上搜索并点击跳转。
- [ ] 真实窗口，`basic`：`press --key Meta+Shift+F`，`type --text 验证笔记库`，结果只有 `欢迎` 一处。点它后，`eval` 读出的选中文本是 `验证笔记库`。
- [ ] 真实窗口，选中文字：在编辑器里选中一段含空格的文字，按 `Meta+Shift+F`，搜索框里是加了引号的这段文字。
- [ ] 真实窗口，`workspace-copy`：搜索一个常见中文词，例如“笔记”。显示的匹配总数等于 `grep -rFo --include='*.md' --exclude-dir='.*' 笔记 . | wc -l` 的结果，命中的笔记数等于 `grep -rlF` 的行数加上只有文件名命中的笔记数。
- [ ] 真实窗口，外部修改：用 shell 新建一篇含“外部新增搜索词”的笔记，搜索结果出现它；删掉后结果消失。
- [ ] `vault-diff --expect-unchanged` 输出 `unchanged`。
- [ ] 性能：用 node 计时 `search`，输入是 `workspace-copy` 的笔记复制成 1 万篇，查询“的”和一个 4 字词。超过 200 毫秒算失败，这是 features.md 性能目标里的数。main 上没有这个功能，没有基线。

## 还证明不了的

- 点击编辑器里的链接跳转属于第 3 步。本步证明的是解析结果和 Obsidian 一致，不是点击行为。
- 1 万篇笔记的性能属于第 5 步。本步用复制出的数据近似。
- 6 个笔记库里都没有的写法，例如 `%%注释%%` 里的链接，对照工具测不到。
- 导出的前提是 Obsidian 已经索引完。对照工具会比较文件集合，但索引没跑完的导出可能漏掉链接。不一致时先重新导出一次。
