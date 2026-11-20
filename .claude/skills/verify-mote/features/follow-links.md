# Follow links

Clicking a link in the editor goes where the same click goes in Obsidian 1.15.1. A note opens. A `#heading` or `#^block` puts that line at the top of the editor with the cursor on it. A file opens in the macOS default app, and an `http`, `https` or `mailto` address opens in the browser. A link to a missing note creates an empty note where the vault config says, then opens it. `Cmd+Option+Left` and `Cmd+Option+Right` go back and forward through the notes this window opened. Rules and sources: `docs/plans/step-3.md` PR C.

## Sub-features

- `follow-click`: a plain click on a link that is not showing its source follows it, without first moving the cursor into it. `Cmd+click` always follows, also while the link shows source and for links in the properties block. Reading mode follows on a plain click.
- `follow-dest`: the click lands where Obsidian's `resolvedLinks` says. Link color and the click read the same `LinkDest`.
- `follow-subpath`: `#heading`, `#parent#child` and `#^block` land on the line Obsidian's `resolveSubpath` gives.
- `follow-create`: a missing note is created empty, with any folders it needs, at the path Obsidian's `openLinkText` would use. Nothing else in the vault changes.
- `follow-history`: back and forward restore the cursor where it was when you left the note. A note that no longer exists is skipped. The keys do not also move the cursor.

## Handles

- A drawn link is an element with class `mote-link` and `data-link-from`, the offset where its link node starts. `mote-link-missing` marks a link to a missing note, `mote-link-external` an address outside the vault. A link with neither goes to a note or a file.
- The open note is the editor's `data-note-path`: `--role textbox --name 编辑器`.

## Driving it with verify-mote

Preconditions:

- `~/mote-link-check/<copy>.obsidian-links.json` exists and has `subpaths`. Make it with `node tools/obsidian-export.mjs <copy>`, never on an original vault.
- `$V launch --vault <dir>`, then `$V dialog-answer --path '{vault}'` and `$V click --role button --name 打开笔记库`.

Steps:

- **Node check.** `node tools/compare-links.mjs ~/mote-link-check/*-copy` prints `subpaths: ... mismatches 0` for every copy, besides the link and backlink lines.
- **Every link in the window.** `$V walk-links --obsidian ~/mote-link-check/<copy>.obsidian-links.json --out walk-links`. In every note it clicks each drawn link that is neither missing nor external, records where the click went, and presses `Cmd+Option+Left` after a click that opened another note. A link to the open note itself goes nowhere visible and counts as that note. `mismatches` is `[]` and `errorCount` is 0. `subtracted` is how many links it left out because the editor does not draw them as links: property links, which only `Cmd+click` follows, embeds drawn as images, and `![[note]]` embeds drawn as the note's content. Links inside an embedded note are not clicked; they belong to that note.
- **Speed.** `$V walk-links --obsidian <export> --limit 50 --bench 50` stops after 50 clicks that opened another note, then opens the same 50 notes from the file tree. `bench.ratio` is the median click time over the median tree time, both timed inside the page from the click event to the editor of the new note.
- **Back restores the cursor.** On `basic`, open `欢迎`, click `这是 mote 的验证笔记库。` and press `End`. Click `项目/计划`: the editor's `data-note-path` is `项目/计划.md`. Press `Meta+Alt+ArrowLeft`. The editor shows `欢迎.md`, and `$V eval --js "document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head"` prints the same offset as before the click.
- **Heading at the top.** Click a `#heading` link to a note longer than the window. The heading line shows its `#` marks, and its top is within a few pixels of the top of `.cm-scroller`.
- **Missing note and file.** Run `$V record-shell`. Append ` [[新想法]] [[图片.png]]` to `项目/计划.md` from the shell. Click `新想法`: the editor opens `新想法.md`. Press `Meta+Alt+ArrowLeft` and click `图片.png`. Restore `项目/计划.md` from the fixture. `$V vault-diff` lists only `added file 新想法.md`, and the file has 0 bytes. `$V main-eval --js "globalThis.__moteShell"` lists the attachment's path inside the vault copy.
- **Proof.** Keep the JSON, the screenshots and the diffs in the evidence dir, then `$V stop`.

## Gotchas

- `walk-links` replaces `shell.openPath` and `shell.openExternal` in the main process with recorders for the rest of the run, so no program opens. `main-eval --js "globalThis.__moteShell"` reads what they recorded.
- A plain click on a link follows it. To put the cursor next to a link, click the text after it or move there with the keyboard.
- The walk scrolls with the mouse wheel, because the editor draws only the lines near the screen.
