# 0009 属性用 yaml 包解析，和 Obsidian 同一个库

- 状态：已实现
- 日期：2026-11-20

## 背景

Obsidian 把属性里的链接也计入 `resolvedLinks`。用正则从属性里找 `[[...]]`，在 `workspace-copy` 和 `life-os-copy` 上多算了 18 处：

- 没加引号的 `- [[X]]` 在 YAML 里是嵌套列表，不是字符串，Obsidian 不算。
- 有 11 篇笔记的属性不是合法 YAML，Obsidian 丢掉整个属性。

Obsidian 1.15.1 先用自己的快速解析器，处理不了时交给 npm 的 `yaml` 包。它的错误码（`BLOCK_AS_IMPLICIT_KEY` 等）出现在 `app.js` 里。

## 决定

- `src/core/markdown.ts` 用 `yaml` 包的 `parse` 解析属性。解析失败或结果不是对象时，这篇笔记没有属性链接。
- 照搬 Obsidian 的 `QK`：遍历所有字符串值，整串是 `[[...]]` 或 `[文字](路径)` 才算链接。

## 后果

- 5 个副本的 18 处属性差异都消失了。
- Obsidian 的快速解析器和 `yaml` 包可能对少数输入的判断不同。对照工具在 5 个副本上没有发现这种情况，但没有证明它不存在。
- 第 3 步的属性显示也用这个库。
