# Edit and save a note

The user edits a note. mote saves it after typing stops, and before switching notes or quitting. A note opened but not edited keeps every byte, including its line separator, BOM, and final newline. Status: step 1, not built.

## Sub-features

- `save-untouched` leaves an opened note byte-identical.
- `save-autosave` writes the edit after typing stops.
- `save-on-switch` saves before another note opens.
- `save-keeps-format` keeps CRLF, the BOM, and a missing final newline when saving an edit.

## How to get to it (user POV)

- Open a note from the file tree and type in the editor.

## Driving it with verify-mote

Preconditions:

- The fixture vault is open, per [open-vault](./open-vault.md) steps Open and List.
- `VAULT=$($V paths | node -pe 'JSON.parse(require("fs").readFileSync(0)).vault')`.

- **Open untouched.** Open each fixture note in turn. Run `$V click --role treeitem --name <note> --exact` for `欢迎`, `计划`, `CRLF笔记`, `带BOM`, and `无结尾换行`. Then `$V vault-diff --out untouched --expect-unchanged` prints `unchanged`.
- **Edit CRLF note.** Open `CRLF笔记` and type at the end. Run `$V click --role textbox --name 编辑器`, `$V press --key Meta+ArrowDown`, and `$V type --text 新增一行`. Wait 2 s for autosave.
- **Check the save.** Run `$V vault-diff --out crlf-edit`. It prints only `changed file CRLF笔记.md`. Then `xxd "$VAULT/CRLF笔记.md" | tail -2` shows `0d0a` endings, and no bare `0a`.
- **Edit BOM note and no-final-newline note.** Repeat the edit for `带BOM` and `无结尾换行`. The file still starts with `efbbbf`, and the second still has no final newline unless you typed one.
- **Switch saves.** Type in `欢迎`, then click `计划` within 1 s. `vault-diff` shows `欢迎.md` changed.
- **Proof.** Keep each diff and `xxd` output in the evidence dir, then `$V stop`.

## Gotchas

- CodeMirror joins lines with `\n`. Byte checks with `xxd` catch a lost CRLF; a text snapshot does not.
- Autosave runs after a delay. Wait for the file to change on disk, not for a fixed time, when the delay is known.
- A save must never touch `.obsidian`. `vault-diff` catches that.
