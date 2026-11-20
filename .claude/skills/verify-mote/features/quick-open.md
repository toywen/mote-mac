# Quick open

The user presses `Cmd+O`, types part of a note name, and opens a note with `Enter`. Matching and ranking follow Obsidian 1.15.1. The rules and their sources are in `docs/plans/step-2.md`, section PR A.

## Sub-features

- `quick-open-show` opens the dialog with `Cmd+O` and closes it with `Escape`.
- `quick-open-match` lists notes whose name or path holds the query's words in order, best score first, at most 20.
- `quick-open-recent` lists up to 10 recently opened notes when the query is empty.
- `quick-open-choose` opens the selected note with `Enter` or a click, then focuses the editor.
- `quick-open-ime` ignores the `Enter` that commits an input-method candidate.

## How to get to it (user POV)

- Press `Cmd+O` with a vault open.
- Type a query, move with the arrow keys, press `Enter`.

## Driving it with verify-mote

Preconditions:

- A fresh `$V launch` on the fixture vault, then `$V dialog-answer --path {vault}` and `$V click --role button --name 打开笔记库`. `$V doctor` exits 0.

Steps on the fixture vault:

- **Show.** Run `$V press --key Meta+O`, then `$V wait --role dialog --name 快速打开`. It reads `没有最近打开的笔记`.
- **Match.** Run `$V type --text 计划`. `$V read --role listbox --name 快速打开结果` prints `项目/计划`.
- **Choose.** Run `$V press --key Enter`. The dialog hides. `$V eval --js "document.querySelector('.cm-content').dataset.notePath"` prints `项目/计划.md`.
- **Recent.** Press `Meta+O` again. The listbox prints `项目/计划`. Press `Escape`.
- **Input method.** With `项目/计划` open, press `Meta+O` and run `$V ime --text 欢迎 --commit 欢迎`. The composition already matches `欢迎`, so a leaked Enter would open it. The output shows the Enter keydown with `isComposing: true`. The dialog stays open, and the editor path is still `项目/计划.md`. Press `Enter` again; now `欢迎.md` opens.
- **No writes.** Run `$V vault-diff --expect-unchanged`. It prints `unchanged`.

Steps on a real vault copy, for example `$V launch --vault ~/mote-link-check/workspace-copy`. It reopens no vault, so answer the dialog as above.

- **Match a Chinese query.** Run `node tools/bench-quick-open.mjs <vault copy> 学习` to get the expected labels. Use the copy from `$V paths`, so both sides scan the same files. Press `Meta+O`, type `学习`, and read the listbox. The window's list equals the tool's list, in order.
- **No writes.** Run `$V vault-diff --expect-unchanged`.

## Gotchas

- `Cmd+O` is a renderer key listener, not a menu accelerator, so `press` reaches it.
- Ties keep the scan order of `Vault.scan`. The bench tool walks the folder the same way. Compare against the vault copy, not the original, because `readdir` order can differ between folders.
- CDP's composing Enter has `keyCode` 13. A real macOS input method sends 229. mote checks both, but this recipe only exercises `isComposing`.
- The window and the bench tool share one matcher. Their agreement proves the window uses it. It does not prove the matcher agrees with Obsidian.
