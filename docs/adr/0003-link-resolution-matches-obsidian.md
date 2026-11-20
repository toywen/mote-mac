# 0003 链接解析以 Obsidian 的结果为准

- 状态：已接受
- 日期：2026-11-20

## 背景

mote 要替换 Obsidian，同一个链接在两边必须跳到同一个目标。Obsidian 的解析规则没有完整文档，重名文件、相对路径和编码路径都有特例。

## 决定

- `src/core/resolve.ts` 是纯函数，输入是索引和一个链接，输出目标路径或 `null`。编辑器标颜色、点击跳转、反向链接和改名都调用它。
- 规则不靠猜。`tools/compare-links.mjs` 拿 Obsidian 自己的解析结果做对照。导出方法是在 Obsidian 里按 `Cmd+Option+I` 打开控制台，运行：

```js
copy(JSON.stringify({ resolved: app.metadataCache.resolvedLinks, unresolved: app.metadataCache.unresolvedLinks }))
```

具体的导出和对照流程见 [step-2.md](../plans/step-2.md)。

## 后果

- 每条解析规则都要有对照结果支持。测试笔记库 `links` 的导出文件提交进仓库，作为回归测试。
