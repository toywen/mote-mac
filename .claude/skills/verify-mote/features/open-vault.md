# Open a vault and browse the tree

The user opens a folder as a vault. The file tree shows its folders and files and hides dot entries. Clicking a note opens it in the editor. mote reopens the last vault on the next launch.

## Sub-features

- `vault-open` opens a folder chosen in the native dialog.
- `vault-reopen` reopens the last vault on the next launch.
- `tree-list` shows folders and files and hides entries that start with `.`.
- `tree-collapse` folds and unfolds a folder.
- `tree-sidebar` hides and restores the left sidebar.
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
- **List.** Read the tree. Run `$V snapshot --out tree-list`. It shows `欢迎`, `CRLF笔记`, `带BOM`, `无结尾换行` and the collapsed folders `项目` and `附件`. Expand `附件` to see `图片.png`. The tree skips `.隐藏` and `.obsidian`.
- **Fold and unfold.** Run `$V click --role treeitem --name 项目 --exact`. `计划` appears. Click `项目` again to fold it.
- **Toggle the sidebar.** Click the `收起文件树` button in the editor header, then wait for the tree to be hidden. Click `展开文件树` to restore the sidebar and its open folders.
- **Open note.** Click a note. Run `$V click --role treeitem --name 欢迎 --exact`. Then `$V read --role textbox --name 编辑器` contains `这是 mote 的验证笔记库。`.
- **Open every note.** Run `$V walk-notes --out opened-notes`. It expands folders containing notes, compares visible note paths with the copied vault, and waits for the matching editor after each click.
- **Reopen.** Run the Electron test named `edits preserve source bytes, save on navigation and quit, and the vault reopens`. It quits and launches again with the same isolated settings directory.
- **No writes.** Run `$V vault-diff --out open-after --expect-unchanged`. It prints `unchanged`. That covers `.obsidian` too.
- **Proof.** Run `$V screenshot --out tree-open-note`, then `$V stop`.

## Gotchas

- The native dialog cannot be driven over CDP. Run `dialog-answer` before the click, or the dialog blocks.
- Obsidian shows notes without `.md`. If mote shows the extension, change the names here in the same PR.
- A treeitem name like `计划` also matches `计划书` unless you pass `--exact`.
