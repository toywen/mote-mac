---
name: verify-mote
description: Launch a disposable mote (Electron desktop app) on a copy of a vault, drive its window like a user, and capture proof, including a byte-level diff of the vault. Use whenever you must prove a mote change works in the real app, reproduce a mote bug, or check an acceptance item from docs/features.md.
---

# Verify mote

mote is an Electron app. The user touches one surface: its desktop window. This skill drives that window over the Chrome DevTools Protocol (CDP), and reaches the main process through the Node inspector. One helper does everything:

```sh
V=.claude/skills/verify-mote/scripts/verify-mote.mjs   # run from the repo root
```

Every run gets its own vault copy, settings dir, debug ports, and evidence dir. Several runs can live side by side. Never drive a mote you did not launch with this helper. The user may have `npm run dev` open; it uses the real settings dir.

Read [features/README.md](features/README.md) before you prove a feature. It lists each feature's recipe.

## Launch

```sh
$V launch                       # build, copy tests/fixtures/vaults/basic, start mote
$V launch --vault ~/life-os     # copy a real vault instead; the original is never opened
$V launch --skip-build          # reuse out/ when src/ has not changed
$V launch -- {vault}            # pass extra args to the app; {vault} becomes the copy's path
```

`launch` does these steps:

1. Builds with `npx electron-vite build`.
2. Clones the vault to `$TMPDIR/mote-verify/<run>/vault`, skipping `.git`. A 1.5 GB vault takes about 4 s.
3. Hashes the copy into `verify-artifacts/<run>/vault-before.txt`.
4. Starts Electron with `--user-data-dir=<scratch>/user-data`, so mote never touches `~/Library/Application Support/mote`, and with `--disable-backgrounding-occluded-windows` (see Gotchas).
5. Waits until the window is usable: React has mounted and `window.mote` exists.

It prints `{"run", "vault", "evidence"}` and exits 0. On failure it kills what it started and prints the app log.

When mote gains a state that must load first, such as an open vault, extend `waitUntilUsable` in the helper.

## Doctor

```sh
$V doctor        # read only; exit 1 if any check fails
```

It checks these facts:

- The process is alive and was started by this run.
- The debug port belongs to that process.
- The window shows `out/renderer/index.html` from this checkout.
- `app.getPath('userData')` is the scratch dir.
- `src/` has not changed since the build.

Run it first whenever something looks off. A `build fresh` failure means you are proving old code. Stop, then launch again without `--skip-build`.

## Drive

With one live run, commands pick it. With several, pass `--run <id>` or set `MOTE_VERIFY_RUN`. `$V list` shows the runs of this checkout.

| Command                                          | Does                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `snapshot [--out name]`                          | Prints the window's ARIA tree. Read it to find handles.                 |
| `walk-notes [--out name] [--obsidian export]`    | Clicks every visible note and checks the full path and editor state. With `--obsidian`, also checks each note's backlinks pane against the export. Prints `durationMs` for the whole walk and `medianNoteMs`, the median time from click to editor ready. |
| `theme --scheme dark\|light\|system`             | Sets the app's color scheme, waits until the window follows, and prints the scheme in effect. |
| `bench-typing [--chars 200] [--gap 50] [--where end\|start]` | Types into the open note one key at a time and prints the main-thread work per key. See Measure. |
| `screenshot --out name`                          | Saves a PNG of the window to the evidence dir.                          |
| `click <locator>`                                | Clicks.                                                                 |
| `fill <locator> --value V`                       | Replaces an input's text.                                               |
| `press --key Meta+O`                             | Presses a key or chord in the window.                                   |
| `type --text T`                                  | Types into the focused element.                                         |
| `wait <locator> [--state hidden] [--timeout ms]` | Waits for an element. Default 5000 ms.                                  |
| `read <locator>`                                 | Prints an element's text.                                               |
| `ime --text T --commit C [--hold ms] [--probe-js EXPR]` | Composes T with the input method, presses Enter, then commits C. Prints the Enter keydown it saw. `--hold` keeps the composition open first; `--probe-js` reads renderer state while it is open. |
| `eval --js EXPR`                                 | Evaluates in the renderer. Read state only.                             |
| `main-eval --js EXPR`                            | Evaluates in the main process. `electron` is in scope. Read state only. |
| `dialog-answer --path {vault}`                   | Makes the next native open dialog return this path.                     |
| `vault-diff [--out name] [--expect-unchanged]`   | Diffs the vault copy against `vault-before.txt`.                        |
| `paths`                                          | Prints the run's state: vault, scratch, evidence, ports.                |

A locator is one of `--role R [--name N]`, `--text T`, `--label L`, or `--selector CSS`. Add `--exact` for an exact name match. Prefer `--role` with `--name`. Playwright is strict: a locator that matches two elements fails. Make the handle unique; do not fall back to position.

To act like Obsidian or git changing a note, write the file under the vault copy with the shell. Get the path from `$V paths`.

Each command appends what it did and what it got to `verify-artifacts/<run>/actions.jsonl`.

The helper connects with Playwright's `noDefaults`, so Playwright does not force a light color scheme or fake window focus. The window shows what the user sees.

## Color scheme

`theme` sets Electron's `nativeTheme.themeSource` in the main process. It stands in for the macOS appearance switch, which lives outside the app. It changes this app only, never the macOS setting. `system` hands the choice back to macOS. After `theme`, read colors with `eval` and take a `screenshot`.

## Measure

`bench-typing` needs an open note. It clicks the editor, presses `Cmd+Down` or `Cmd+Up` to move the caret to the end or the start, then types `--chars` letters as real key events. Before each key and again `--gap` ms after it, it reads Chrome's main-thread counters with the CDP call `Performance.getMetrics`. The difference is the work that one key caused: script, style, layout, and the rest of the task.

It prints JSON:

- `taskMs`: the median, p95 and max of the per-key `TaskDuration` difference.
- `meanMs`: the mean per-key `ScriptDuration`, `LayoutDuration` and `RecalcStyleDuration`.
- `idleTaskMs`: the same sampling for 20 gaps with no key. Subtract it before you blame mote.
- `docLength`: the editor's length before and after. The command fails unless it grew by exactly `--chars`.

The metric counts work, not time to the next frame, so the display refresh rate does not bound it. It misses work on the compositor and GPU threads and in the main process.

The gap must stay below mote's 750 ms autosave delay, so no save runs during the measurement. The run leaves the note edited. mote saves it after the run, and `vault-diff` will list that note.

Run every number at least twice in a row. If two medians differ by more than 30 percent, find out why before you record one.

## Evidence

Evidence goes to `verify-artifacts/<run>/`. It is gitignored and survives `stop`. Do not put it in `test-results/`; Playwright wipes that dir on every test run.

A proof meets these standards:

- Drive the real user path: clicks, keys, and files written from outside. Never call internal functions to set state. `eval` and `main-eval` only read. `dialog-answer` and `theme` are the exceptions, because the native dialog and the macOS appearance switch are outside the app.
- Capture the action and the result: the `actions.jsonl` lines, plus a snapshot or screenshot after the action.
- Check side effects on disk. Every proof that touches notes ends with `vault-diff`. Opening without editing must print `unchanged`. A save must change only the note you edited.
- `tools/hash-vault.mjs` skips dot entries, so it cannot prove `.obsidian` is untouched. `vault-diff` hashes dot entries and empty folders too.
- For a `hash-vault` comparison, hash the copied vault before opening it and again after `walk-notes`. Keep the output of `diff -u` with the two manifests.
- Report a journey that cannot run as a failure, with the command and the missing precondition.

## Cleanup

```sh
$V stop          # kills only this run's process group, deletes the scratch dir, keeps evidence
```

Run `stop` after every run, including failed ones. It never kills by process name. If a `launch` crashed before it wrote state, nothing is left to stop. `ls verify-artifacts/<run>/` after `stop` must still show your evidence.

## Gotchas

- The window appears on screen and may take focus. That is expected.
- `launch` passes `--disable-backgrounding-occluded-windows`. Without it, a window that other windows cover reports `document.visibilityState` as `hidden` and draws no frames. Then a click waits forever for the element to be stable, and `bench-typing` would leave out layout and paint. `bench-typing` fails when the window is hidden.
- Native dialogs and menus cannot be clicked over CDP. Use `dialog-answer` for open dialogs. A menu accelerator may not fire from `press`. If a shortcut does nothing, find out whether it is a menu accelerator before you call it a bug.
- If mote adds `app.requestSingleInstanceLock()`, runs still start side by side, because the lock lives in the settings dir.
- The fixture vault holds exact bytes on purpose: a CRLF note, a BOM note, and a note with no final newline. `.gitattributes` and `.editorconfig` protect them. Never reformat these files.
