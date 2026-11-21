# 第 4 步实现计划

本计划实现 [功能列表](../features.md#第-4-步新建改名移动和删除) 里的第 4 步：新建、改名、移动和删除。

完成标准有两条：

- [验收清单](../features.md#验收清单) 第 3 条：在 `~/life-os` 和 `~/workspace/Pesemic` 副本里，各改名或移动一篇有链接进出的笔记。用 `diff -r` 对比操作前的副本，只有这次移动和相关链接有变化。
- 文件树支持新建笔记/文件夹、行内内联重命名、删除到废纸篓；进程意外中止后，journal 能够保证重命名/移动断点自愈。

本文用到的词：

- **副本**：`~/mote-link-check/` 下 5 个笔记库的冻结拷贝。
- **Journal**：存放在 `~/Library/Application Support/mote/journal.json` 的改名/移动事务日志，见 [ADR 0006](../adr/0006-rename-journal.md)。
- **真实窗口**：用 `verify-mote` 启动并驱动的 mote 窗口。
- **内联改名**：文件树节点在原位转为文本输入框进行命名编辑。

## 4 个 PR

按合并顺序排列：

| PR | 内容 | 功能编号 | 依赖 | 证明 |
| --- | --- | --- | --- | --- |
| A | 主进程文件操作（新建笔记/目录、删除到废纸篓、在访达中显示）及 IPC | 文件树-3、文件树-5 | 无 | Vitest、真实窗口新建与删除 |
| B | Journal 事务引擎与链接幂等改写算法 | 文件树-4、ADR 0006 | A | 单元测试（双链/Markdown相对链接改写、断点重放幂等性） |
| C | 文件树前端交互：顶部操作按钮、右键菜单、行内重命名、删除确认弹窗 | 文件树-3、4、5 交互 | A、B | 真实窗口右键菜单、行内编辑、弹窗与断链提示 |
| D | 副本验收（验收-3）与全流程走查 | 验收-3 | 全部 | life-os 与 Pesemic 副本实测，`diff -r` 对比仅移动及链接变更 |

```
main ── A 基础文件操作 ── B Journal与改写 ── C 文件树交互 ── D 副本验收
```

---

## PR A：主进程文件基础操作及 IPC

- 目标：提供健壮的新建笔记/文件夹、移入废纸篓和访达显示能力。
- 新增 IPC 接口（定义于 `src/core/ipc.ts`）：
  - `createNote(dir: string, folder?: VaultPath, name?: string): Promise<VaultPath>`
  - `createFolder(dir: string, parentFolder?: VaultPath, name?: string): Promise<VaultPath>`
  - `deleteEntry(dir: string, path: VaultPath): Promise<void>`（移入 macOS 废纸篓）
  - `showInFolder(dir: string, path: VaultPath): Promise<void>`（在访达中高亮）
- 逻辑：
  - 新建笔记位置遵循 `vault.config.newFileLocation`（`root` / `current` / `folder`）；
  - 自动递增防重名（如 `未命名.md` -> `未命名 1.md`）；
  - 删除调用 Electron `shell.trashItem`；
  - 在当前打开的笔记被删除时，协调编辑器安全关闭。

---

## PR B：Journal 事务引擎与链接幂等改写算法

- 目标：按照 [ADR 0006](../adr/0006-rename-journal.md) 实现改名/移动的事务保障与全库链接更新。
- 核心文件：`src/main/journal.ts`，主进程启动集成。
- 逻辑：
  1. 写入 `~/Library/Application Support/mote/journal.json`；
  2. 物理移动文件或文件夹（`fs.rename`）；
  3. 链接改写（当 `updateLinks: true`）：
     - 入链改写：通过 `NoteIndex` 找到所有引用旧路径（或旧文件夹下所有笔记）的文件。利用 `linkText.ts` 与相对路径规则重算链接文字，保持原有的 `#subpath` 和 `|alias`；
     - 出链相对路径改写：被移动笔记内部原有的 Markdown 相对出链重新计算，确保仍然指向原文件；
     - 基于 AST 从后向前替换文本，带基准哈希安全写入磁盘；
  4. 清理 `journal.json`；
  5. 启动自愈：`Vault.open()` 时若发现 journal，幂等重放步骤 2 和 3。

---

## PR C：文件树前端交互

- 目标：在 `FileTree.tsx` 中补全所有用户交互。
- 交互特性：
  - 文件树顶部工具栏：【新建笔记】与【新建文件夹】图标按钮；
  - 树节点右键菜单（ContextMenu）：新建笔记、新建文件夹、重命名、在访达中显示、移到废纸篓；
  - 原位内联编辑（Inline Renaming）：双击/右键/快捷键进入编辑，`Enter` 保存，`Esc` 取消；非法文件名校验；
  - 链接更新提示：当笔记库配置 `alwaysUpdateLinks === false` 且存在入链时，弹窗询问用户“是否更新引用该笔记的 X 处链接？”；
  - 删除确认提示：删除单篇笔记静默移入废纸篓；删除非空文件夹弹窗二次确认。

---

## PR D：副本验收（验收-3）

- 目标：严格证明 [验收清单 验收-3](../features.md#验收清单)。
- 检查项：
  - 在 `~/mote-link-check/life-os-copy` 中挑选一篇有入链和出链的笔记进行改名/移动；
  - 在 `~/mote-link-check/Pesemic-copy` 中挑选一篇有入链和出链的笔记进行改名/移动；
  - 执行 `diff -r` 对比移动前后的副本，证明除了该文件的物理移动与引用该文件的链接文本变更外，**全库其余文件字节 100% 不变**；
  - 重放崩溃测试：写入模拟 journal 并启动应用，验证自愈机制正确完成链接更新；
  - 更新 `docs/features.md` 第 4 步状态为已完成。
