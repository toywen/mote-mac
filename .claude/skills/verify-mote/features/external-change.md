# External changes

When Obsidian, git, or another program changes an open note, mote shows the new text within 100 ms. If the user has unsaved edits, mote keeps both versions and asks which to keep. Status: step 1, not built.

## Sub-features

- `external-reload` shows new disk content in a clean open note.
- `external-atomic` handles an editor that writes a temp file and renames it over the note.
- `external-conflict` enters the conflict state when the open note has unsaved edits.

## How to get to it (user POV)

- Keep a note open in mote, and change it in Obsidian or with git.

## Driving it with verify-mote

Preconditions:

- The fixture vault is open, and `欢迎` is open in the editor, per [open-vault](./open-vault.md).
- `VAULT=$($V paths | node -pe 'JSON.parse(require("fs").readFileSync(0)).vault')`.

- **In-place write.** Append a line from outside. Run `printf '外部追加\n' >> "$VAULT/欢迎.md"`. Then `$V wait --text 外部追加 --timeout 1000` succeeds.
- **Atomic write.** Replace the file by rename. Run `printf '# 欢迎\n\n整篇替换\n' > "$VAULT/.tmp" && mv "$VAULT/.tmp" "$VAULT/欢迎.md"`. Then `$V wait --text 整篇替换 --timeout 1000` succeeds.
- **Conflict.** Type in the editor without waiting for autosave, then write from outside. Run `$V type --text 本地未保存` and `printf '外部改动\n' >> "$VAULT/欢迎.md"`. mote shows the conflict prompt; `$V snapshot --out conflict` has an alert or dialog naming both versions. The file on disk still ends with `外部改动`.
- **No lost text.** Pick each version in the prompt. The kept text is complete, and `vault-diff` shows only `欢迎.md` changed.
- **Proof.** Keep the snapshots and diffs, then `$V stop`.

## Gotchas

- Acceptance item 4 says Obsidian. A shell write is the stand-in; also test once with real Obsidian on the vault copy before calling item 4 done.
- File events can arrive in bursts or twice. One reload per change is the goal; check that the editor does not flicker or lose the cursor.
- The `--timeout 1000` is slack over the 100 ms target. Measure the real latency separately.
