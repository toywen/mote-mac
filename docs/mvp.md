# mote MVP 范围

> 2026-11-20 定稿，不再更新。它记录第一版的目标和当初为什么这样划范围。功能和进度见 [features.md](features.md)，术语见 [CONTEXT.md](../CONTEXT.md)，技术决策见 [adr/](adr/)。

## 目标

mote 第一版在 Mac 上替换 Obsidian。它能打开任何一个 Obsidian 笔记库，用来日常读写。

`~/life-os` 是主要的测试笔记库，另外 4 个本机笔记库做补充测试。

验收标准是你连续一周记笔记，不需要打开 Obsidian。

## 范围依据

范围按 2026-11-20 的数据定。数据来自 5 个本机笔记库的笔记库配置，以及下面这条命令的统计：

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
| 最大的笔记库有 604 篇笔记，2.67 MB | 性能目标留出余量，见 [features.md](features.md#性能目标) |
| Dataview 查询只出现在 1 个笔记库的 9 篇笔记里 | Dataview 不做 |
| 没有 `.canvas` 文件，只有 1 个 `.base` 文件 | Canvas 和 Bases 不做 |

## 界面

```
┌────────────┬──────────────────────────────┬────────────┐
│ 文件树      │ 编辑器                        │ 反向链接    │
│            │ 实时预览，Cmd+E 切到阅读模式    │            │
│            │                              │            │
└────────────┴──────────────────────────────┴────────────┘
  Cmd+O 快速打开   Cmd+Shift+F 全文搜索   Cmd+Shift+D 今天的日记
```

界面跟随 macOS 的浅色和深色模式。

## 功能

P0、P1、不做的功能和验收清单已移到 [features.md](features.md)。

## 备份

mote 不负责同步和备份。

`~/life-os` 现在靠 Obsidian 的 obsidian-git 插件每分钟 commit 并 push。这个插件只在 Obsidian 开着时运行。试用 mote 的那一周，让 Obsidian 在后台开着，备份就不会停。mote 自己的同步上线后，再关掉 obsidian-git。同步方案见 [ADR 0005](adr/0005-own-sync-service.md)。
