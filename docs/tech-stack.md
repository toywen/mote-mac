# mote 技术栈和实现方案

本文回答 [MVP 功能定义](mvp.md) 里的功能怎么实现。版本号是 2026-11-20 运行 `npm view <包名> version` 查到的最新版本。搭骨架时以当天的最新版本为准。

## 总体结构

```
┌──────────────── mote（Electron）────────────────┐
│ 渲染进程：React 界面 + CodeMirror 6 编辑器        │
│   持有：打开的笔记的编辑状态、笔记路径列表的副本     │
│        │ IPC，类型定义在 src/core/ipc.ts          │
│        ▼                                         │
│ 主进程：Node                                      │
│   持有：磁盘读写、文件监听、笔记库索引               │
└────────┬─────────────────────────────────────────┘
         ▼
   笔记库文件夹  ◀── Obsidian、git、Claude 也会读写
         │
   mote 同步模块：按文件同步，MVP 之后做
         ▼
   mote 同步服务  ◀── 以后的 iOS 版和 Claude 连接器也连这里
```

每份状态只有一个持有者。磁盘和索引归主进程。正在编辑的文字归渲染进程。渲染进程里的笔记路径列表是主进程推过来的副本，只读。

## 技术选型

| 部分 | 选择 | 版本 | 理由 |
| --- | --- | --- | --- |
| 外壳 | Electron | 44.11 | 已定。Obsidian 用的也是它。版本跟 electron-vite 模板走，45.x 以后再升 |
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

不用的东西和原因：

- **不用 ProseMirror 系的所见即所得编辑器**，比如 Milkdown、TipTap。它们把 Markdown 解析成文档树，保存时再重新生成文本。这样一打开就可能改动字节，违反 MVP 编辑器第 8 条。
- **不用 markdown-it 这类第二个渲染器。** 阅读模式就是关掉编辑的 CodeMirror，所有元素都按实时预览的方式渲染。全程只有一个解析器和一套渲染组件。
- **不用搜索索引库**，比如 MiniSearch、FlexSearch。它们大多按空格分词，中文会搜不到。全文搜索直接在内存里做子串匹配。
- **不用数据库。** 每次打开笔记库时重建索引，mote 的设置存成 JSON 文件。

## 目录结构

```
src/
  core/       纯 TypeScript，不引用 Electron。主进程和渲染进程共用
  main/       主进程：窗口、IPC 处理、磁盘读写、文件监听
  preload/    用 contextBridge 暴露 window.mote
  renderer/   React 界面
    editor/   CodeMirror 扩展：语法、实时预览、组件
tools/        审计、生成测试笔记库、哈希对比、链接对照
tests/
```

## 核心数据结构

这些类型放在 `src/core/model.ts`。

```ts
// 笔记库内的相对路径，用 / 分隔。只在 parseVaultPath 里创建
type VaultPath = string & { readonly __brand: "VaultPath" };
type ContentHash = string & { readonly __brand: "ContentHash" };

type LinkRef = {
	from: VaultPath;
	kind: "wiki" | "markdown" | "embed";
	target: string;        // 原文里写的目标，不含 #标题 和 |别名
	heading: string | null;
	alias: string | null;
	range: { from: number; to: number }; // 在原文里的位置，改名时按它替换
};

type Note = {
	path: VaultPath;
	text: string;
	hash: ContentHash;
	lineSeparator: "\n" | "\r\n";
	links: LinkRef[];
};

type VaultIndex = {
	notes: Map<VaultPath, Note>;
	otherFiles: Set<VaultPath>;              // 图片、PDF 等非笔记文件
	byBasename: Map<string, VaultPath[]>;    // 小写文件名，用于解析双链
	backlinks: Map<VaultPath, LinkRef[]>;    // 由 links 推导，不单独修改
};

// 从 .obsidian 读出的配置，缺的字段填 Obsidian 默认值
type VaultConfig = {
	useMarkdownLinks: boolean;
	newLinkFormat: "shortest" | "relative" | "absolute";
	alwaysUpdateLinks: boolean;
	newFileLocation: "root" | "current" | "folder";
	newFileFolderPath: string;
	daily: { folder: string; format: string };
};
```

### 一篇打开的笔记的状态

渲染进程用一个状态机管理每篇打开的笔记，不用多个布尔值。

```ts
type DocState =
	| { kind: "clean"; baseHash: ContentHash }
	| { kind: "dirty"; baseHash: ContentHash }
	| { kind: "saving"; baseHash: ContentHash }
	| { kind: "conflict"; baseHash: ContentHash; diskText: string };
```

| 当前状态 | 事件 | 下一个状态 |
| --- | --- | --- |
| clean | 你输入 | dirty |
| clean | 磁盘上的文件变了 | 重新读取，仍是 clean |
| dirty | 停止输入，或切换笔记、退出 | saving |
| saving | 写入成功 | clean，baseHash 换成新哈希 |
| saving | 主进程报告磁盘内容已变 | conflict |
| dirty | 磁盘上的文件变了 | conflict |
| conflict | 你选了保留哪份 | saving |

### IPC 接口

渲染进程只能通过这些接口碰磁盘。

```ts
interface MoteApi {
	openVault(dir: string): Promise<{ config: VaultConfig; paths: VaultPath[] }>;
	readNote(path: VaultPath): Promise<{ text: string; hash: ContentHash }>;
	// 磁盘上的哈希等于 baseHash 才写入，否则返回磁盘上的内容
	writeNote(path: VaultPath, text: string, baseHash: ContentHash):
		Promise<{ ok: true; hash: ContentHash } | { ok: false; diskText: string; diskHash: ContentHash }>;
	createNote(path: VaultPath, text: string): Promise<ContentHash>;
	move(from: VaultPath, to: VaultPath): Promise<{ updated: VaultPath[] }>;
	trash(path: VaultPath): Promise<void>;
	backlinks(path: VaultPath): Promise<LinkRef[]>;
	search(query: string): Promise<{ path: VaultPath; line: number; preview: string }[]>;
	openWithDefaultApp(path: VaultPath): Promise<void>;
	onVaultChanged(cb: (e: { changed: VaultPath[]; removed: VaultPath[] }) => void): () => void;
}
```

## 关键实现

### 解析器只有一份

`src/core/markdown.ts` 定义 `@lezer/markdown` 的语法扩展：GFM 表格和任务、双链、嵌入、`==高亮==`、标签、callout、属性块。编辑器和主进程的索引用同一份配置。所以"什么算链接"只有一个定义，改名时替换的位置和编辑器里看到的链接一致。

### 链接解析

`src/core/resolve.ts` 是纯函数，输入是索引和一个 `LinkRef`，输出目标路径或 `null`。编辑器标颜色、点击跳转、反向链接和改名都调用它。

具体规则不靠猜。`tools/compare-links.mjs` 拿 Obsidian 自己的解析结果做对照。导出方法是在 Obsidian 里按 `Cmd+Option+I` 打开控制台，运行：

```js
copy(JSON.stringify({ resolved: app.metadataCache.resolvedLinks, unresolved: app.metadataCache.unresolvedLinks }))
```

### 不改动字节

- 只有 `DocState` 是 dirty 时才写盘。
- CodeMirror 默认用 `\n` 拼接行。打开笔记时检测换行符，设置 `EditorState.lineSeparator`，保存时原样保留 `\r\n`。
- 保存直接覆盖原文件，不用"写临时文件再改名"。改名会换掉文件的创建时间，Obsidian 按创建时间排序时会乱。

### 外部修改

主进程用 `fs.watch` 监听整个笔记库，忽略以 `.` 开头的路径。收到事件后重新读文件、算哈希。哈希等于 mote 自己刚写入的值，就当作自己的写入，忽略。否则更新索引，并推送 `onVaultChanged`。

### 改名和移动

`move` 分三步，每一步都从当前磁盘状态推导，重复运行结果相同：

1. 在 `~/Library/Application Support/mote/journal.json` 记下 `{ from, to }`。
2. 移动文件，然后按索引找出所有指向旧路径的链接，以及被移动笔记里的 Markdown 相对链接，逐个改写。每个文件都用 `writeNote` 的哈希检查写入。
3. 删除 journal。

mote 启动时如果发现 journal，就重新执行第 2 步。已经改好的链接再改一遍，结果不变。

### 图片

渲染进程开着 `sandbox`，不能直接读 `file://`。主进程注册 `mote-file://` 协议，只允许读当前笔记库里的文件。

### 安全设置

`contextIsolation: true`，`nodeIntegration: false`，`sandbox: true`。渲染进程只能用 preload 暴露的 `window.mote`。

## 同步方案

### 结论

mote 自己做同步，按单个文件同步，和 Obsidian Sync 的做法一样。git 不再用于同步。

同步不进第一版。第一版只有 Mac 在写，不需要同步。开发和试用期间，`~/life-os` 继续用现有的 obsidian-git 备份。这个插件只在 Obsidian 开着时运行，所以试用时让 Obsidian 在后台开着。mote 同步上线后再关掉它。

### 候选方案

| 方案 | 费用 | iOS 端 | Claude 连接器能写入吗 | 冲突处理 | 问题 |
| --- | --- | --- | --- | --- | --- |
| git + GitHub | 免费 | 弱 | 能 | 同步停下，要手动解决 | 已否决，不方便 |
| iCloud Drive | 免费 | 好，Obsidian iOS 直接可用 | 不能，云端服务写不进 iCloud | 生成"笔记 2.md"这样的重复文件 | Electron 用不了 Apple 的文件协调接口，同时写入有风险（推断） |
| Self-hosted LiveSync 协议 | 自建 CouchDB | Obsidian iOS 插件可用 | 要实现它的协议 | 自动合并 | 数据格式绑定这个插件，兼容成本高 |
| mote 自己的同步服务 | 云服务免费额度内，可能为 0（猜测） | 自己的 iOS 版接入 | 能，和客户端走同一个接口 | 自动合并，和 Obsidian Sync 一样 | 要写服务端 |

选 mote 自己的同步服务。理由是它是唯一同时满足三件事的方案：iOS 端是你自己的 app，Claude 连接器能写入，以后的 AI 和语音处理也能放在同一个服务上。

### 设计细节

暂不设计。做到开发顺序第 7 步时再定，包括数据结构、同步流程、合并规则和服务端部署。已经确定的方向只有两条：按单个文件同步，两边都改过的笔记自动合并。

### 和其他部分的关系

- Claude 连接器是同步服务的另一个客户端。它只新建文件，所以不会和已有笔记冲突。
- 手机端在 iOS 版做出来之前，没有客户端可用。这段时间手机上记录靠 Claude 连接器。

## 性能目标

下面的数字都是估计值，用 `tools/gen-vault.mjs` 生成的 1 万篇笔记库来测。生成的笔记按 `Downloads/workspace` 的统计分布放双链、表格和 callout。

| 操作 | 目标 |
| --- | --- |
| 打开笔记库到可以编辑 | 2 秒以内 |
| 全文搜索 | 200 毫秒以内 |
| 快速打开，每次按键 | 16 毫秒以内 |
| 改名一篇有 100 个反向链接的笔记 | 1 秒以内 |
| 外部修改到编辑器显示 | 100 毫秒以内 |

如果打开笔记库超过 2 秒，就把索引移到 Electron 的 `utilityProcess`。`src/core` 不引用 Electron，所以只需要移动调用的地方。

## 开发顺序

每一步结束时都有一个能运行的检查，检查通过再做下一步。

| 步骤 | 内容 | 检查 |
| --- | --- | --- |
| 0 | 骨架、`tools/hash-vault.mjs` | 空窗口能启动 |
| 1 | 打开笔记库、文件树、纯文本编辑、保存、外部修改 | 验收第 1 条和第 4 条 |
| 2 | 解析器、索引、链接解析、反向链接、快速打开、搜索 | 验收第 2 条 |
| 3 | 实时预览和阅读模式的全部组件、深色模式 | 用 5 个笔记库人工检查 |
| 4 | 改名和移动 | 验收第 3 条 |
| 5 | 日记、性能 | 验收第 5 条和第 6 条 |
| 6 | 试用一周 | 验收第 7 条 |
| 7 | 同步服务和 Mac 端同步模块，之后关掉 obsidian-git | 两台 Mac 或模拟客户端同时改同一篇笔记，合并后不丢字 |
