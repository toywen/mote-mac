import { test, expect } from '@playwright/test'
import { cp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/basic'

// 1x1 transparent PNG base64
const samplePngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('pasting and dropping images saves to attachment folder and renders in editor', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })

  // Configure attachment folder to "attachments"
  const appJsonPath = join(vault, '.obsidian', 'app.json')
  await writeFile(
    appJsonPath,
    JSON.stringify({
      alwaysUpdateLinks: true,
      attachmentFolderPath: 'attachments'
    })
  )

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    // Open note
    await window.getByRole('treeitem', { name: '欢迎', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '欢迎.md')

    const pasteImage = (fileName: string): Promise<void> =>
      window.evaluate(
        ({ base64, name }) => {
          const binary = atob(base64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          const blob = new Blob([bytes], { type: 'image/png' })
          const file = new File([blob], name, { type: 'image/png' })
          const dt = new DataTransfer()
          dt.items.add(file)
          const event = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          })
          document.querySelector('.cm-content')?.dispatchEvent(event)
        },
        { base64: samplePngBase64, name: fileName }
      )

    // 1. Paste named image
    await pasteImage('my-diagram.png')

    // Wait for the image file to exist on disk in the configured attachment folder
    const savedPath = join(vault, 'attachments', 'my-diagram.png')
    await expect
      .poll(async () => {
        try {
          const s = await stat(savedPath)
          return s.isFile()
        } catch {
          return false
        }
      })
      .toBe(true)

    // Image widget should render in editor
    const img = editor.locator('.mote-image img[src*="my-diagram.png"]')
    await expect(img).toBeVisible()
    await expect
      .poll(async () => {
        return img.evaluate((el) => (el as HTMLImageElement).naturalWidth)
      })
      .toBe(1)

    // Save and verify disk file contains the link
    const noteFile = join(vault, '欢迎.md')
    await window.keyboard.press('Meta+s')
    await expect.poll(() => readFile(noteFile, 'utf8')).toContain('![[my-diagram.png]]')

    // 2. Paste duplicate image name -> should resolve collision with "my-diagram 1.png"
    await pasteImage('my-diagram.png')

    const savedDupPath = join(vault, 'attachments', 'my-diagram 1.png')
    await expect
      .poll(async () => {
        try {
          const s = await stat(savedDupPath)
          return s.isFile()
        } catch {
          return false
        }
      })
      .toBe(true)

    await window.keyboard.press('Meta+s')
    await expect.poll(() => readFile(noteFile, 'utf8')).toContain('![[my-diagram 1.png]]')

    // 3. Paste generic "image.png" -> should format as "Pasted image YYYYMMDD...png"
    await pasteImage('image.png')

    await expect
      .poll(async () => {
        const files = await readdir(join(vault, 'attachments')).catch(() => [])
        return files.some((f) => f.startsWith('Pasted image ') && f.endsWith('.png'))
      })
      .toBe(true)

    // 4. Drop image file onto editor
    await window.evaluate(
      ({ base64, name }) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'image/png' })
        const file = new File([blob], name, { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const event = new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true
        })
        document.querySelector('.cm-content')?.dispatchEvent(event)
      },
      { base64: samplePngBase64, name: 'dropped-photo.png' }
    )

    const droppedPath = join(vault, 'attachments', 'dropped-photo.png')
    await expect
      .poll(async () => {
        try {
          const s = await stat(droppedPath)
          return s.isFile()
        } catch {
          return false
        }
      })
      .toBe(true)

    await window.keyboard.press('Meta+s')
    await expect.poll(() => readFile(noteFile, 'utf8')).toContain('![[dropped-photo.png]]')

    // 5. Plain text paste still works as expected without being hijacked
    await window.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', '普通文本粘贴')
      const event = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      })
      document.querySelector('.cm-content')?.dispatchEvent(event)
    })
    await window.keyboard.press('Meta+s')
    await expect.poll(() => readFile(noteFile, 'utf8')).toContain('普通文本粘贴')
  } finally {
    await app.close()
  }
})

test('relative attachment folder saves into subfolder of active note', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })

  // Configure attachment folder to "./assets" (subfolder of note's folder)
  const appJsonPath = join(vault, '.obsidian', 'app.json')
  await writeFile(
    appJsonPath,
    JSON.stringify({
      alwaysUpdateLinks: true,
      attachmentFolderPath: './assets'
    })
  )

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    // Open nested note "项目/计划.md"
    await window.getByRole('treeitem', { name: '项目', exact: true }).click()
    await window.getByRole('treeitem', { name: '计划', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '项目/计划.md')

    await window.evaluate(
      ({ base64, name }) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'image/png' })
        const file = new File([blob], name, { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const event = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        })
        document.querySelector('.cm-content')?.dispatchEvent(event)
      },
      { base64: samplePngBase64, name: 'plan-sketch.png' }
    )

    // Target should be inside "项目/assets/plan-sketch.png"
    const savedPath = join(vault, '项目', 'assets', 'plan-sketch.png')
    await expect
      .poll(async () => {
        try {
          const s = await stat(savedPath)
          return s.isFile()
        } catch {
          return false
        }
      })
      .toBe(true)

    const planNote = join(vault, '项目/计划.md')
    await window.keyboard.press('Meta+s')
    await expect.poll(() => readFile(planNote, 'utf8')).toContain('![[plan-sketch.png]]')
  } finally {
    await app.close()
  }
})

test('saves to .mote/attachments by default without polluting file tree or vault root', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  await cp(fixture, vault, { recursive: true })

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)

    await window.getByRole('treeitem', { name: '欢迎', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '欢迎.md')

    await window.evaluate(
      ({ base64, name }) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'image/png' })
        const file = new File([blob], name, { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const event = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        })
        document.querySelector('.cm-content')?.dispatchEvent(event)
      },
      { base64: samplePngBase64, name: 'default-spec.png' }
    )

    // Saved in .mote/attachments/default-spec.png
    const savedPath = join(vault, '.mote', 'attachments', 'default-spec.png')
    await expect
      .poll(async () => {
        try {
          const s = await stat(savedPath)
          return s.isFile()
        } catch {
          return false
        }
      })
      .toBe(true)

    // Editor renders image
    const img = editor.locator('.mote-image img[src*="default-spec.png"]')
    await expect(img).toBeVisible()

    // File tree should NOT show .mote
    await expect(window.getByRole('treeitem', { name: '.mote' })).toHaveCount(0)

    // Note contains clean wikilink
    const noteFile = join(vault, '欢迎.md')
    await window.keyboard.press('Meta+s')
    await expect.poll(() => readFile(noteFile, 'utf8')).toContain('![[default-spec.png]]')
  } finally {
    await app.close()
  }
})
