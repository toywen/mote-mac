# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What mote is

mote is an Electron app that replaces Obsidian on the Mac for any existing Obsidian vault. `~/life-os` is the main test vault, not the target. The docs are written in Chinese. Each has one job:

- `CONTEXT.md` is the glossary. Use its terms in docs, code, and replies. Add a new term there before a doc uses it.
- `ARCHITECTURE.md` is the module map, the state owners, and the invariants.
- `docs/features.md` is the single source for the goal, the scope and the data behind it, the only list of features with status and evidence, the development order (its steps), performance targets, and the acceptance checklist. Plan work from it.
- `docs/adr/` holds architecture decision records. Never edit a decision; write a new ADR that replaces it.
- `docs/plans/step-N.md` is the implementation plan for one step.

Types and the IPC contract live only in code (`src/core/ipc.ts`). Do not copy them into docs.

Read `docs/features.md` and `ARCHITECTURE.md` before changing scope or architecture. If code and docs disagree, update the doc in the same change.


## 输出原则：让我最快看懂

1. 先选形式：有结构或流程就画图；有动态过程或需要探索就做单文件 HTML；其他情况用文字。拿不准时用文字。
2. 一个概念只用一个词，不换同义词。术语第一次出现时定义。
3. 用常见词，不用套话（用"用"不用"利用"，用 use 不用 utilize）。
4. 一句只说一件事。用主动语态，写清谁做什么。步骤用祈使句。
5. 句子要短：中文不超过 40 字，英文不超过 25 词。
6. 一段一个主题，第一句给结论。
7. 论证、细微比较和引用可以放宽句子规则，但仍然要一词一义。

## Keeping docs current

- When a change adds or changes a feature, update its row in `docs/features.md` in the same change: status, evidence, and notes.
- `npm test` runs `tools/check-docs.mjs`. It fails when a done row in `docs/features.md` cites no existing test or verify-mote feature, when a row id repeats, or when `ARCHITECTURE.md`'s module table repeats a row or names a missing path. Its error says the fix.
- When scope changes, edit `docs/features.md` and record the reason and date in the notes column.
- When a change makes a new architecture decision, add an ADR. When an ADR gets implemented, change its status line.

## Commands

```sh
npm run dev          # electron-vite dev server with HMR
npm run typecheck    # tsc for the node side (main, preload) and the web side (renderer)
npm run lint         # eslint + prettier
npm test             # Vitest, compare-links on the links fixture vault, then tools/check-docs.mjs
npm run test:e2e     # build, then run the Playwright Electron tests in tests/e2e
npx playwright test -g "three panes"   # one e2e test by name; run `npx electron-vite build` first
npm run build:mac    # unsigned local .app in dist/

node tools/vault-audit.mjs <vault> [...]   # count Obsidian features a vault uses; scope decisions come from this
node tools/hash-vault.mjs <vault> > a.txt  # hash every file; diff two runs to prove mote changed no bytes
node tools/bench-quick-open.mjs <vault> <query>   # quick-open results in Node; add --bench N to time N paths
node tools/obsidian-export.mjs <copy>       # Obsidian's resolvedLinks for a vault copy, via an isolated Obsidian
node tools/compare-links.mjs <copy>...      # mote's link resolution vs that export; --bench N times it
node tools/sync-sim.mjs                     # two simulated devices sync through a local mote-sync server (build ../mote-sync first)
node tools/update-sync-protocol.mjs         # rebuild ../mote-sync's protocol into vendor/, then npm install
```

## Architecture

Electron with three build targets from `electron.vite.config.ts`:

- `src/main` is the main process. It owns the disk, file watching, and the vault index.
- `src/preload` exposes one object, `window.mote`, through `contextBridge`. The renderer runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. It reaches the disk only through `window.mote`.
- `src/renderer` is React. It owns the text of open notes and a read-only copy of the note path list that main pushes.
- `src/core` holds pure TypeScript shared by main and renderer: the `@lezer/markdown` parser config, link resolution, and the core types. It must not import Electron. It and `src/main/notes.ts` use only type syntax Node can strip, and relative imports end in `.ts`, so `tools/*.mjs` import them directly.

Each piece of state has one owner. Do not add a second copy that both sides write.

## Rules that are easy to break

- Write into the vault only in the cases that `ARCHITECTURE.md` lists under 不变式, 笔记库. Never write `.obsidian`. Read vault config from `.obsidian` read only, and fall back to Obsidian defaults.
- Store mote's own settings and journals in `~/Library/Application Support/mote`, never in the vault.
- Opening a note without editing it must leave its bytes unchanged. Keep the file's line separator (CodeMirror joins lines with `\n` by default) and write only when the note is dirty.
- Every save compares the disk hash with the hash the note was opened at. On mismatch, enter the conflict state instead of overwriting.
- Editor, index, and rename all use one Markdown parser config. Reading mode is the same CodeMirror view with editing off, not a second renderer.
- Link resolution must match Obsidian. Check it against Obsidian's own `app.metadataCache.resolvedLinks`, not against assumed rules.
- Search does substring matching in memory, because notes are mostly Chinese and word-splitting search libraries miss CJK text.
- Sync is out of scope until its step in `docs/features.md`, and it will not use git. Do not add git-based sync.


## Current status

See `docs/features.md`. Use `verify-mote` to check an entire disposable vault in the real window.

