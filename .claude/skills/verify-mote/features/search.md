# Full-text search

`Cmd+Shift+F` switches the left sidebar to search. mote finds notes where every term appears in the body or the file name, ignoring case. Results are grouped by note and sorted by file name like Obsidian. Clicking a row opens the note and selects the match. Rules: `docs/plans/step-2.md` PR D.

## Sub-features

- `search-match` splits on spaces, keeps quoted phrases, and needs every term in the same note.
- `search-jump` opens the note and selects the matched text.
- `search-prefill` fills the box with the editor selection, quoted when it has a space.
- `search-ime` does not search while an input method is composing.
- `search-live` searches again when notes change on disk or mote saves.

## Handles

- Sidebar views: buttons `文件` and `搜索` (`aria-pressed`) in `--role group --name 侧栏视图`.
- Box: `--role searchbox --name 搜索`.
- Count: `--role status --name 搜索结果数`, text `N 篇笔记，M 处`.
- Results for query Q are inside `[data-query="Q"]`. It appears only after that query returns, so wait on it before reading.
- Groups: `.hit-group[data-path]`, rows `button.hit`, and `.search-more` when more than 50 notes match.

## Driving it

Steps:

- **Search and jump.** On `basic`: `$V press --key Meta+Shift+F`, then `$V ime --text 验证 --commit 验证笔记库 --hold 500 --probe-js "document.querySelector('[aria-label=搜索结果数]')?.textContent ?? null"`. The probe is `null`, because no search runs while composing. Wait for `[data-query="验证笔记库"]`; the count is `1 篇笔记，1 处`. Click `button.hit`; `$V eval --js "getSelection().toString()"` prints `验证笔记库`.
- **Prefill.** Open `CRLF笔记`, click the editor, press `Meta+ArrowUp`, then `Shift+End`, then `Meta+Shift+F`. The box holds `"# CRLF 笔记"`.
- **Against grep.** On `workspace-copy`, search a common word. The total equals `grep -rFo --include='*.md' --exclude-dir='.*' <word> . | wc -l`. The note count equals the union of `grep -rlF` files and files whose name contains the word. Use `grep -i` for Latin words.
- **External change.** Search `外部新增搜索词` (0 notes). Write a note containing it under the vault copy; the count becomes `1 篇笔记，1 处`. Delete it; the count goes back to 0.
- **No writes.** `$V vault-diff --expect-unchanged` prints `unchanged`.

## Gotchas

- `grep -o` and mote both count non-overlapping matches. A term that matches the frontmatter counts too.
- Only the first 50 groups carry rows. The count always covers every match.
- Notes that are not valid UTF-8 are skipped by mote but counted by grep.
