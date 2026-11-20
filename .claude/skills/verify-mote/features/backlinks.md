# Backlinks

The right pane lists every link to the open note: wikilinks, Markdown links, embeds and property links. Each row is the line around the link, with the link highlighted. Clicking a row opens the source note and selects the link. Rules and sources: `docs/plans/step-2.md` PR C.

## Sub-features

- `backlinks-list` shows, for each note, the same sources and counts as Obsidian's `resolvedLinks` read backwards.
- `backlinks-jump` opens the source note and selects the link text.
- `backlinks-live` follows external adds, deletes and edits, and mote's own saves.

## Handles

- Pane: `--role complementary --name 反向链接`.
- Count: `--role status --name 反向链接数`.
- The list for note P is `[data-note-path="P"]` inside the pane. It appears only after the query for P returns, so wait on it before reading.
- Rows: `button.hit` with `data-path` (source note) and `data-from` (offset in normalized text). Groups: `.hit-group[data-path]`.

## Driving it

Preconditions:

- Each copy under `~/mote-link-check/` has a fresh `<copy>.obsidian-links.json` from `node tools/obsidian-export.mjs <copy>`.

Steps:

- **Node check.** Run `node tools/compare-links.mjs ~/mote-link-check/*-copy`. Each copy prints `backlinks: ... mismatches 0`. This checks the main process's query code on every note, without the window.
- **Every note in the window.** For each copy, run `$V launch --vault ~/mote-link-check/<copy>`, `$V dialog-answer --path '{vault}'`, click `打开笔记库`, then `$V walk-notes --out walk-backlinks --obsidian ~/mote-link-check/<copy>.obsidian-links.json`. It waits for each note's list and counts rows per source. `backlinkMismatches` is `[]`.
- **Jump.** On `basic`, open `欢迎`, click the row `回到 [[欢迎]]。`. The editor's `data-note-path` is `项目/计划.md`, and `$V eval --js "getSelection().toString()"` prints `[[欢迎]]`.
- **External add and delete.** With `欢迎` open, write `外部.md` containing `[[欢迎]]` under the vault copy. `.hit-group[data-path="外部.md"]` appears. Delete the file; it goes away.
- **Own save.** Type `[[欢迎]]` into `欢迎`. After autosave, the count goes up by one and `欢迎` lists itself.
- **No writes.** `$V vault-diff --expect-unchanged` prints `unchanged` after a walk without edits.

## Gotchas

- Rows count links, not notes. A note that links twice shows two rows.
- Links to attachments have no pane, because only notes open in the editor.
- The pane sorts sources by path, not by Obsidian's file name order. Counts are what the check compares.
