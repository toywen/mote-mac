# mote verification map

This directory is the maintained source for verifying mote's user-facing behavior. Read this index first, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `$V launch`, where `V=.claude/skills/verify-mote/scripts/verify-mote.mjs`.
- The default vault is a copy of `tests/fixtures/vaults/basic`. It holds these files:
  - `欢迎.md`: LF, frontmatter, tasks, a wikilink, a Markdown link, and an image embed
  - `项目/计划.md`: links back to `欢迎`
  - `CRLF笔记.md`: CRLF line endings
  - `带BOM.md`: starts with a UTF-8 BOM
  - `无结尾换行.md`: no final newline
  - `.隐藏.md`: a dot file the tree must hide
  - `附件/图片.png`: a non-note file
  - `.obsidian/app.json`: `alwaysUpdateLinks: true`
- `$V doctor` exits 0.

## Driving conventions

- Start each recipe from a fresh launch unless its preconditions say otherwise.
- Prefer `--role` and `--name`. UI text is Chinese.
- Treat commands as literal.
- Simulate Obsidian, git, or another editor by writing into the vault copy from the shell.
- End every recipe that touches notes with `$V vault-diff`.

## Proof and skip reporting

- UI proof is an ARIA snapshot plus a screenshot, both taken after the action.
- Disk proof is the `vault-diff` output. Opening without editing must print `unchanged`.
- Name the feature ID and entry point with every artifact.
- A journey for a feature that has not shipped fails. Report it as not built. Never weaken it to pass.

## Status and handle contract

Which features are implemented, and which recipe proves each, is tracked in `docs/features.md`. The roles and names in these recipes match the desktop window.

## Features

- [App shell](./app-shell.md): launch, three panes, no vault writes. Shipped.
- [Open a vault and browse the tree](./open-vault.md): step 1.
- [Edit and save a note](./edit-and-save.md): step 1, acceptance item 1.
- [External changes](./external-change.md): step 1, acceptance item 4.
- [Quick open](./quick-open.md): step 2, `Cmd+O`.
- [Link resolution](./links.md): step 2, acceptance item 2.
- [Backlinks](./backlinks.md): step 2, right pane.
- [Full-text search](./search.md): step 2, `Cmd+Shift+F`.
- [Live preview and reading mode](./live-preview.md): step 3, `Cmd+E`. Uses the `tests/fixtures/vaults/preview` vault.
- [Light and dark color schemes](./dark-mode.md): step 3, the `theme` command.
