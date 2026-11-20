# Open a vault and browse the tree

The user opens any folder as a vault. The file tree shows its folders and files and hides dot entries. Clicking a note opens it in the editor. mote reopens the last vault on the next launch. Status: step 1, not built.

## Sub-features

- `vault-open` opens a folder chosen in the native dialog.
- `vault-reopen` reopens the last vault on the next launch.
- `tree-list` shows folders and files and hides entries that start with `.`.
- `tree-collapse` folds and unfolds a folder.
- `tree-open-note` opens a clicked note in the editor.
- `vault-readonly-config` reads `.obsidian` and never writes it.

## How to get to it (user POV)

- Click `打开笔记库` when no vault is open, then pick a folder.
- Launch mote again; the last vault opens.
- Click a folder or note in the file tree.

## Driving it with verify-mote

Preconditions:

- A fresh `$V launch` on the fixture vault, and `$V doctor` exits 0.

- **Open.** Answer the dialog, then click the button. Run `$V dialog-answer --path {vault}` and `$V click --role button --name 打开笔记库`. Then `$V wait --role tree --name 文件树` succeeds.
- **List.** Read the tree. Run `$V snapshot --out tree-list`. It shows `欢迎`, `CRLF笔记`, `带BOM`, `无结尾换行`, folders `项目` and `附件`, and `图片.png`. It does not show `.隐藏` or `.obsidian`.
- **Collapse.** Click the folder. Run `$V click --role treeitem --name 项目 --exact`. `计划` disappears from the snapshot. Click again and it returns.
- **Open note.** Click a note. Run `$V click --role treeitem --name 欢迎 --exact`. Then `$V read --role textbox --name 编辑器` contains `这是 mote 的验证笔记库。`.
- **Reopen.** Quit and relaunch with the same settings dir. This needs a `launch --reuse-settings` option the helper does not have yet; add it with this feature.
- **No writes.** Run `$V vault-diff --out open-after --expect-unchanged`. It prints `unchanged`. That covers `.obsidian` too.
- **Proof.** Run `$V screenshot --out tree-open-note`, then `$V stop`.

## Gotchas

- The native dialog cannot be driven over CDP. Run `dialog-answer` before the click, or the dialog blocks.
- Obsidian shows notes without `.md`. If mote shows the extension, change the names here in the same PR.
- A treeitem name like `计划` also matches `计划书` unless you pass `--exact`.
