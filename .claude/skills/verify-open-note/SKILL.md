---
name: verify-open-note
description: Check the open note's save state machine in mote against every order of events (typing, autosave timers, IPC replies, main's queue, the file watcher, rename, external change, tab switch, close). Use before and after any change to src/renderer/src/workspace.ts, NoteEditor's keying or save calls, the rename callers in FileTree.tsx, or writeNote, renameOrMove, ownWrites, the run queue or the watcher in src/main/vault.ts.
---

# Verify the open note

`npm test` runs this check. It drives the real `Workspace` class from `src/renderer/src/workspace.ts`. A small fake `window.mote` copies main's `Vault`. A breadth-first search tries every order of events in each scenario. A pass covers those scenarios and nothing else.

## The three properties

1. **No stuck note.** When nothing is left to happen, the note is clean, conflict or missing. It never stays `saving`, or `dirty` without a timer or an error. The window is never left busy. Harm: the note never saves again, and the window can neither switch notes nor close.
2. **No lost typing.** The last text you typed reaches the disk. Otherwise it stays in the editor, either as a conflict or as dirty with an error and 重试保存. The editor always shows the doc's text. Harm: you lose what you typed.
3. **No blind overwrite.** Main overwrites a file only with a base hash the editor has seen for that file. Harm: mote destroys another program's edit.

A fourth check guards 6508f41: opening a note again without a place never reuses an old selection.

## Run it

```sh
npm test                                                # everything, about 20 s
npx vitest run src/renderer/src/workspace.check         # just this check
SURVEY=1 npx vitest run src/renderer/src/workspace.check   # every kind of violation, not just the first
SURVEY=rename npx vitest run src/renderer/src/workspace.check   # scenarios whose name contains "rename"
SETTLE=macrotask npx vitest run src/renderer/src/workspace.check   # slower, certain settling
```

## Files

| File                                                               | What it is                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/renderer/src/workspace.check.ts`                              | The fake main, the editor-view stand-in, the properties, the search, the scenarios |
| `src/renderer/src/workspace.check.{rename,external,other}.test.ts` | One group of scenarios each, so Vitest runs them in parallel                       |
| `tests/e2e/rename.spec.ts`                                         | The same rename bugs in real Electron                                              |

## Coverage

Synced at commit `90bcc67`. After that commit, any change to these files needs a fresh look at the check.

| Code                                                                                                                                                                                              | How the check models it                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Workspace` in `workspace.ts`: `edit`, `scheduleSave`, `save`, `flush`, `write`, `refresh`, `onChange`, `move`, `load`, `show`, `useDisk`, `receiveConflict`, `rename`, `connect`'s close handler | Runs as is                                                                                                     |
| The two autosave timers (150 ms, 800 ms)                                                                                                                                                          | `window.setTimeout` records them. Either one may fire at any step                                              |
| `Vault.run` in `vault.ts`                                                                                                                                                                         | One FIFO queue that takes `writeNote`, `renameOrMove` and the watcher's `refresh`                              |
| `Vault.writeNote`                                                                                                                                                                                 | Hash compare, `ownWrites`, `{ok:false, disk:null}` for a missing file. Its stat-race branch is left out        |
| `Vault.renameOrMove`                                                                                                                                                                              | Moves files and `ownWrites` and sends `renamed`. Folders are covered. Link rewriting is left out               |
| `Vault.refresh` and `schedule`                                                                                                                                                                    | The watcher may queue a refresh at any step. The refresh filters mote's own writes by hash                     |
| `Vault.readNote`                                                                                                                                                                                  | Runs outside the queue and may answer in any order                                                             |
| IPC                                                                                                                                                                                               | One ordered channel from main to the renderer. Replies and vault changes keep their order                      |
| `NoteEditor` and `App`                                                                                                                                                                            | `key={doc.session}` makes a new view. The `[source]` effect copies text in. Listeners read the path from a ref |

Bounds: 1 or 2 notes, 2 or 3 keystrokes, 1 external write, 1 rename, at most 1 failed write. The largest scenario has about 27,000 states.

Left out: two Workspace windows on one note, images, PDF and HTML docs, `chooseVault`, back and forward, `closeTab`, `createNote`, trash, link rewriting by rename, and main crashing mid-write.

## Read a failure

A failure prints a property and the shortest path that breaks it. Each step names one event in the code's words, then shows the doc after it as `[kind path "text"]`.

This is the real counterexample from before commit `e29070e`:

```
the note stays in saving with no write in flight
1. you type "1"   [dirty A.md "a1"]
2. you rename A.md to B.md in the file tree   [dirty A.md "a1"]
3. main runs renameOrMove(A.md -> B.md) and sends vault-changed   [dirty A.md "a1"]
4. main's watcher queues a refresh of A.md,B.md   [dirty A.md "a1"]
5. main's watcher sends vault-changed (changed B.md, removed )   [dirty A.md "a1"]
6. the 150 ms autosave timer fires   [saving A.md "a1"]
7. renderer receives vault-changed (changed B.md, removed A.md)   [saving A.md "a1"]
8. renderer receives the reply to renameOrMove(A.md -> B.md)   [saving B.md "a1"]
9. renderer receives vault-changed (changed B.md, removed )   [saving B.md "a1"]
10. main runs writeNote(A.md, "a1", base #a) -> conflict, disk deleted   [saving B.md "a1"]
11. renderer receives the reply to writeNote(A.md, "a1", base #a)   [saving B.md "a1"]
```

The stuck-note property is checked only once nothing is left to happen, which is why the watcher steps appear.

Find the step where the doc's kind or path first goes wrong, then open the method that ran it. The trace names it. Ask whether a real user could produce that order of events. If yes, it is a bug in the code. If no, the fake main or the view stand-in drifted from the code. Compare it with `vault.ts` or `NoteEditor.tsx`, and fix the check, not the property.

The error `the check cannot tell which Workspace method called main` is a fault in the check. It means `caller()` lost V8's call sites.

## Breaks it has caught

| Break                                                                | Scenario that failed                                           | Property                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| The code at `cc06283`, before the fix                                | Rename scenarios, external write, switch and close, disk error | Stuck note, lost typing, editor shows old text |
| 6508f41 reverted: `load` keeps `this.state.selection`                | open a note again after a link put the cursor in it            | Old selection reused                           |
| `write` ties the reply to the path again, no resend                  | All three rename scenarios                                     | Stuck in saving                                |
| `refresh` takes the disk hash for a dirty note instead of a conflict | another program writes the note while you type                 | Blind overwrite                                |

The e2e test `tests/e2e/rename.spec.ts` failed on the `cc06283` build in real Electron. The renamed note kept `原文`, and the text typed during the rename never reached the disk. Both tests pass after `e29070e`.

## Change the code on purpose

- New event or IPC call: model it in `World` and add an action or system event. Add a scenario that uses it, then put the scenario in a group file.
- New doc kind or new rule: add it to `observe()` as a property, in one plain sentence.
- Changed main behavior: change the matching `run*` method in `World` so it does what `vault.ts` does.
- Then run `SURVEY=1`, read every violation, and fix the code or the model.
- Prove the check can still fail: break the change on purpose and confirm one scenario fails, then drop the break.
- Keep `npm test` near 20 s. Split a slow scenario into its own group file before you cut its events.
- Move the sync commit above forward only after you confirm the check describes the code at the new commit.
