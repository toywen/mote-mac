# Link resolution

mote extracts every wikilink, embed, Markdown link and property link from a note, and resolves each one the way Obsidian 1.15.1 does. Nothing in the window shows the result yet. Backlinks (step 2, PR C) and clicking links (step 3) will. Rules and sources: `docs/plans/step-2.md` PR B, ADR 0003, 0008, 0009.

## Sub-features

- `links-extract` finds wikilinks, embeds, Markdown links, and property values that are a whole link. It skips code.
- `links-resolve` picks the same target as Obsidian, or the same unresolved key.
- `links-normalize` reports link offsets in the normalized text, so CRLF and BOM notes line up with the editor.

## Driving it

This PR has no UI, so the proof runs outside the window, and the window only gets a regression walk.

Preconditions:

- Each copy under `~/mote-link-check/` has a fresh `<copy>.obsidian-links.json`. Make one with `node tools/obsidian-export.mjs <copy>`. Never point it at an original vault; the script refuses paths outside `~/mote-link-check` and the temp dir.

Steps:

- **Regression suite.** Run `npm test`. Vitest passes, and `compare-links` on `tests/fixtures/vaults/links` prints `mismatches 0`.
- **Real vaults.** Run `node tools/compare-links.mjs ~/mote-link-check/*-copy`. Every copy prints `files: same` and `mismatches 0`, and the exit code is 0.
- **Window regression.** For `basic` and each copy, run `$V launch --vault <dir>`, `$V dialog-answer --path '{vault}'`, click `打开笔记库`, then `$V walk-notes --out walk-notes`. `opened` equals `expected` and `errorCount` is 0.
- **No writes.** Run `$V vault-diff --expect-unchanged` after each walk. It prints `unchanged`.
- **Timing.** Run `node tools/compare-links.mjs --bench 5 ~/mote-link-check/workspace-copy`. Close other heavy work first; a parallel Electron run doubles the number.

## Gotchas

- Quote `'{vault}'` in zsh. Unquoted, it gets eaten and the dialog receives `true`.
- After an Obsidian upgrade, export again with `OBSIDIAN_VERSION` set to the new version before trusting a mismatch.
- A mismatch whose lines start with `~` is a guess: mote found no link to that target, so the tool shows lines that mention its name.
