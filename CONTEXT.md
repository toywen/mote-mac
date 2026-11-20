# mote 术语

文档、代码和对话都用这里的词。一个概念只用一个词。新概念第一次出现在文档里之前，先加到这里。

英文名是代码里的命名。还没有代码的概念，英文名是计划用的名字。

## 笔记库

| 术语 | 英文名 | 定义 |
| --- | --- | --- |
| 笔记库 | vault | 一个装 Markdown 文件的文件夹，Obsidian 里也叫 vault |
| 笔记 | note | 笔记库里的一个 `.md` 文件 |
| 附件 | file | 笔记库里不是笔记的文件，例如图片和 PDF。用 macOS 的默认程序打开 |
| 库内路径 | `VaultPath` | 笔记库内的相对路径，用 `/` 分隔，不含以 `.` 开头的部分。只由 `parseVaultPath` 创建 |
| 笔记库配置 | `VaultConfig` | 笔记库里 `.obsidian` 文件夹中的 JSON 配置。mote 只读，从不修改 |
| 日记 | daily note | 按日期命名、每天一篇的笔记 |

## 链接

| 术语 | 英文名 | 定义 |
| --- | --- | --- |
| 双链 | wiki link | `[[笔记名]]` 形式的链接 |
| Markdown 链接 | markdown link | `[文字](路径.md)` 形式的链接 |
| 嵌入 | embed | 前面带 `!` 的链接，例如 `![[图片名]]` 和 `![](路径)` |
| 反向链接 | backlink | 链接到当前笔记的其他笔记 |
| 链接解析 | resolve | 从链接原文找到目标文件。规则以 Obsidian 的 `resolvedLinks` 为准 |

## 编辑

| 术语 | 英文名 | 定义 |
| --- | --- | --- |
| 实时预览 | live preview | 边写边渲染。光标所在的行显示 Markdown 源码，其他行隐藏符号 |
| 阅读模式 | reading mode | 只读，完整渲染整篇笔记。它是关掉编辑的同一个 CodeMirror 视图 |
| 属性 | properties | 笔记开头 `---` 之间的 YAML，也叫 frontmatter |
| 规范化文本 | normalized text | 编辑器里的文本。去掉 BOM，所有换行统一成 `\n`。保存时还原原来的 BOM 和换行符 |
| 基准哈希 | `baseHash` | 打开或上次保存笔记时磁盘内容的哈希。保存前和磁盘哈希比较 |
| 冲突 | conflict | 保存时磁盘哈希和基准哈希不同。mote 不覆盖，让你选保留哪一份 |
| 外部修改 | external change | Obsidian、git 或其他程序对笔记库文件的修改 |

## 开发

| 术语 | 英文名 | 定义 |
| --- | --- | --- |
| 步骤 | step | 开发顺序里的一步，编号 0 到 7，见 [features.md](docs/features.md#开发顺序) |
| 验收清单 | acceptance checklist | 判断第一版能否替换 Obsidian 的 7 条检查，见 [features.md](docs/features.md#验收清单) |
| 副本 | copy | 笔记库的冻结拷贝，用来测试。原始笔记库从不用来测试 |
| 真实窗口 | real window | 用 `verify-mote` skill 启动并驱动的 mote 窗口 |
