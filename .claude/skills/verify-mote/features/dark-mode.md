# Light and dark color schemes

mote follows the macOS appearance. Every color in the window, the live preview included, comes from the variables in `src/renderer/src/assets/main.css`, which switch on `prefers-color-scheme`. The main process sets the window background from `nativeTheme`, so a dark window does not flash white while it loads or switches.

## Sub-features

- `scheme-follow`: the window changes colors when the appearance changes.
- `scheme-contrast`: body text has a contrast of at least 4.5 against the background in both schemes.
- `scheme-window`: the native window background matches the page background.

## How to get to it (user POV)

- Switch macOS between light and dark in System Settings, Appearance.

## Driving it with verify-mote

Preconditions:

- `$V launch --vault tests/fixtures/vaults/preview`, open the vault, and open `行内`.

Steps:

- **Dark.** `$V theme --scheme dark`, then `$V screenshot --out dark`. Read the colors with `$V eval --js "(() => { const c = document.querySelector('.cm-content'); let n = c; while (getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)') n = n.parentElement; return { background: getComputedStyle(n).backgroundColor, text: getComputedStyle(c).color } })()"`. Read the window with `$V main-eval --js "electron.BrowserWindow.getAllWindows()[0].getBackgroundColor()"`. It matches the page background.
- **Light.** Repeat with `--scheme light`. Both colors differ from dark.
- **Contrast.** Compute the WCAG contrast of text against background for each scheme. Both are at least 4.5.
- **Restore.** `$V theme --scheme system`, then `$V stop`.

## Gotchas

- `theme` sets Electron's `nativeTheme.themeSource`. It never changes the macOS setting, so the real System Settings switch is not covered.
- Playwright's own tests emulate a light scheme by default. `tests/e2e/preview.spec.ts` turns that off with `emulateMedia({ colorScheme: null })` before it switches.
