import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

// Starts mote with its own settings dir, so tests never touch the real one. The DeepSeek key
// in your shell never reaches a test; one that needs a key passes it in extra.
export function launch(
  settings: string,
  extra: Record<string, string> = {}
): Promise<ElectronApplication> {
  const env = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  if (!extra.DEEPSEEK_API_KEY) delete env.DEEPSEEK_API_KEY
  return electron.launch({ args: ['.', `--user-data-dir=${settings}`], env })
}

// Answers the native folder dialog with dir, then opens the vault from the window.
export async function openVault(
  app: ElectronApplication,
  window: Page,
  dir: string
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, dir)
  await window.getByRole('button', { name: '打开笔记库' }).click()
}

// Waits ms and checks nothing. Use it only to copy a person's timing, such as a key pressed a
// set time after the last one. To wait for mote, wait for a locator, a state or an event.
export function typingPause(window: Page, ms: number): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- the one sleep tests/e2e may use
  return window.waitForTimeout(ms)
}
