# App shell

mote opens one window with three panes: the file tree, the editor, and backlinks. Launching mote does not change a byte of the vault.

## Sub-features

- `shell-launch` opens a usable window titled `mote`.
- `shell-panes` shows the three panes, labeled `侧栏`, `编辑器`, and `反向链接`. The sidebar shows the file tree or search.
- `shell-no-writes` leaves the vault byte-identical after launch and quit.

## How to get to it (user POV)

- Start mote.

## Driving it with verify-mote

Preconditions:

- A fresh `$V launch`, and `$V doctor` exits 0.

- **Launch.** Start mote. Run `$V launch`. It prints a run ID, and `doctor` reports `window usable`. Then `$V eval --js document.title` prints `mote`.
- **Panes.** Look at the window. Run `$V snapshot --out shell-panes`. The tree has, in order, `complementary: 侧栏`, `main: 编辑器`, and `complementary: 反向链接`.
- **No writes.** Leave mote alone. Run `$V vault-diff --out shell-after --expect-unchanged`. It prints `unchanged` and exits 0.
- **Proof.** Run `$V screenshot --out shell-panes`, then `$V stop`. `verify-artifacts/<run>/` keeps `shell-panes.aria.txt`, `shell-panes.png`, `shell-after.diff.txt`, and `actions.jsonl`.

## Gotchas

- The shell labels also name the three accessible regions. The interactive file tree appears after opening a vault.
