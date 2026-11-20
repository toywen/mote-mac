# Link completion

The user types `[[` in the editor. A list of note names opens. Enter inserts a link to the selected note, in the format the vault's `.obsidian/app.json` asks for. The link text is what Obsidian 1.15.1 inserts from its own `[[` list. The rules and their sources are in `docs/plans/step-3.md`, section PR G.

## Sub-features

- `complete-open`: the list opens when the text before the cursor on its line is `[[` plus a query with no `]`, `|`, `#` or `^`. It stays closed inside code blocks and inline code.
- `complete-match`: rows come from quick open's matcher, in its order, at most 20. An empty query lists up to 10 recently opened notes. Each row shows the note name and, after it, its folder.
- `complete-insert`: Enter or a click replaces the `[[` and the query with the link, and puts the cursor after it. The list has no opening delay and no accept guard, so Enter right behind the last key picks the row instead of breaking the line. A `]]` after the cursor, with any text before it, is replaced too, as Obsidian does.
- `complete-format`: wiki links or Markdown links, and the shortest, relative or absolute path, follow `useMarkdownLinks` and `newLinkFormat`. A wiki link whose path holds a `/` gets the note name as its alias, as Obsidian does.
- `complete-ime`: while an input method composes, Enter commits the composition and picks no row. After the commit the list shows matches for the committed text.

## How to get to it (user POV)

- Open a note, put the cursor where the link goes, and type `[[` and part of a note name.
- Move with the arrow keys, press Enter. Escape closes the list.

## Driving it with verify-mote

Preconditions:

- A fresh `$V launch` on the fixture vault, then `$V dialog-answer --path {vault}` and `$V click --role button --name 打开笔记库`. `$V doctor` exits 0.
- `$V click --role treeitem --name 欢迎 --exact`, `$V click --text "这是 mote 的验证笔记库。"`, `$V press --key End`.

Steps:

- **Match.** `$V type --text " [[计"`. `$V eval --js "[...document.querySelectorAll('[role=listbox] [role=option] .cm-completionLabel')].map(o => o.textContent)"` prints `["计划"]`. `$V screenshot --out list` shows `计划` with `项目` after it.
- **Insert.** `$V press --key Enter`. After 2 s, `$V vault-diff` lists only `欢迎.md`, and the only added bytes are ` [[计划]]` at the end of that line.
- **Input method, Enter inside the composition.** `$V type --text " [["`, then `$V ime --text 计划 --commit 计划 --hold 400 --probe-js "<read rows and the text before the cursor>"`. The output shows the Enter keydown with `isComposing: true`. The probe shows the row `计划` and the line ending in `[[计划`, with no link inserted. CDP's Enter has key code 13, so Chromium adds line breaks after the cursor (see Gotchas).
- **Input method, commit only.** In a fresh launch, type ` [[` as above, then `$V ime --text 计划 --commit 计划 --no-enter --hold 400`. The line ends in `[[计划`, and the first row is `计划`. `$V press --key Enter` turns it into `[[计划]]`. `vault-diff` shows only ` [[计划]]` added.
- **Other formats.** Write `{"useMarkdownLinks": true, "newLinkFormat": "relative"}` to the copy's `.obsidian/app.json` before `打开笔记库`. The same steps insert `[计划](项目/计划.md)`.
- **No writes on open.** In a fresh launch, `$V walk-notes` has `errorCount` 0 and `$V vault-diff --expect-unchanged` prints `unchanged`.
- **Proof.** Keep the screenshot, the probe output and the diffs, then `$V stop`.

## Checks outside the window

- `node tools/obsidian-export.mjs --linktext <temp copy>` records Obsidian's link text for every pair of note and file in all six formats. Run it on a copy under the system temp dir, because it changes the copy's `.obsidian/app.json`. `npm test` compares `linkText` with the committed export of the `links` vault.
- `node tools/check-linktext.mjs ~/mote-link-check/*-copy` resolves every link the completion can insert back to its target.
- `node tools/bench-quick-open.mjs <copy> --bench 10000 <query>` times the matcher call the completion makes on each key.

## Gotchas

- A real macOS input method confirms with an Enter that has key code 229, and Chromium adds no line break. CDP's composing Enter has key code 13, and Chromium adds line breaks after the cursor, on main too. The e2e test `typing [[ completes note names in the vault's link format` sends key code 229 and checks the exact line.
- The list lives in a CodeMirror tooltip, not in the ARIA tree that `snapshot` prints from the editor. Read rows with `eval` on `[role=listbox] [role=option]`.
- The list closes when the editor loses focus. A `click` elsewhere closes it.
