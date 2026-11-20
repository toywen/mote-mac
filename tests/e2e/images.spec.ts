import { test, expect, type Locator, type Page } from '@playwright/test'
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileUrl } from '../../src/core/fileUrl'
import { parseVaultPath } from '../../src/core/ipc'
import { launch, openVault } from './app'

const fixture = 'tests/fixtures/vaults/preview'
const wide = '附图/宽图.png'

const lineOf = (editor: Locator, text: string): Locator =>
  editor.locator('.cm-line').filter({ hasText: text })

// Loads url into a new <img> in the window, as a renderer that tries other paths would.
function loadInWindow(window: Page, url: string): Promise<{ loaded: boolean; width: number }> {
  return window.evaluate(
    (src) =>
      new Promise<{ loaded: boolean; width: number }>((done) => {
        const img = new Image()
        img.onload = () => done({ loaded: true, width: img.naturalWidth })
        img.onerror = () => done({ loaded: false, width: 0 })
        img.src = src
      }),
    url
  )
}

test('images load from the vault and nothing outside it', async () => {
  const info = test.info()
  const vault = info.outputPath('vault')
  const outside = info.outputPath('outside')
  await cp(fixture, vault, { recursive: true })
  // A real image outside the vault, and three ways a vault could point at it.
  const image = await readFile(join(vault, wide))
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'secret.png'), image)
  await symlink(join(outside, 'secret.png'), join(vault, '逃逸.png'))
  await symlink(outside, join(vault, '逃逸目录'))
  await mkdir(join(vault, '.obsidian'))
  await writeFile(join(vault, '.obsidian', 'app.json'), '{}')
  await writeFile(join(vault, '.obsidian', 'secret.png'), image)

  const app = await launch(info.outputPath('settings'))
  try {
    const window = await app.firstWindow()
    await openVault(app, window, vault)
    const note = join(vault, '图片.md')
    const original = await readFile(note, 'utf8')
    await window.getByRole('treeitem', { name: '图片', exact: true }).click()
    const editor = window.getByRole('textbox', { name: '编辑器' })
    await expect(editor).toHaveAttribute('data-note-path', '图片.md')

    // Images in document order: plain, |300, |300x200, ![说明|120](...), SVG, |5000.
    const images = editor.locator('.mote-image img')
    await expect(images).toHaveCount(6)
    await expect
      .poll(() =>
        images.evaluateAll((all) => all.map((img) => (img as HTMLImageElement).naturalWidth))
      )
      .toEqual([40, 40, 40, 40, 24, 40])
    const boxes = await images.evaluateAll((all) =>
      all.map((img) => {
        const { width, height } = img.getBoundingClientRect()
        return { width: Math.round(width), height: Math.round(height) }
      })
    )
    const editorWidth = await editor.evaluate((content) => content.clientWidth)
    expect(boxes.slice(0, 4)).toEqual([
      { width: 40, height: 30 },
      { width: 300, height: 225 },
      { width: 300, height: 200 },
      { width: 120, height: 90 }
    ])
    expect(boxes[5].width).toBeGreaterThan(300)
    expect(boxes[5].width).toBeLessThanOrEqual(editorWidth)
    await expect(images.nth(3)).toHaveAttribute('alt', '说明')

    // No source shows away from the selection. A missing image, an image that does not load and
    // an http image show their names instead.
    const text = await editor.innerText()
    for (const mark of ['![[', '](', ']]'])
      expect(text, `visible text has no ${mark}`).not.toContain(mark)
    await expect(editor.locator('.mote-image-missing')).toHaveText([
      '不存在.png',
      '坏图.png',
      'http://example.com/a.png'
    ])

    // An embed that is not an image is a link to its target, marked where its node starts.
    const found = editor.locator('.mote-link', { hasText: '嵌入目标' })
    const missing = editor.locator('.mote-link', { hasText: '缺失的嵌入' })
    await expect(lineOf(editor, '嵌入目标')).toHaveText('嵌入目标')
    await expect(found).toHaveAttribute('data-link-from', String(original.indexOf('![[嵌入目标]]')))
    await expect(found).not.toHaveClass(/mote-link-missing/)
    await expect(missing).toHaveClass(/mote-link-missing/)

    // A click on the image shows its source with the image under it. Typing elsewhere keeps the
    // same <img>, so it does not load again.
    const first = images.first()
    const kept = await first.elementHandle()
    await first.click()
    // The note's third line holds ![[宽图.png]].
    const source = editor.locator('.cm-line').nth(2)
    await expect(source).toHaveText('![[宽图.png]]')
    const [textBottom, imageTop] = await source.evaluate((line) => {
      const range = document.createRange()
      range.selectNodeContents(line.firstChild!)
      return [
        range.getBoundingClientRect().bottom,
        line.querySelector('.mote-image img')!.getBoundingClientRect().top
      ]
    })
    expect(imageTop).toBeGreaterThanOrEqual(textBottom)
    await lineOf(editor, '最后一行').click()
    await window.keyboard.press('End')
    await window.keyboard.insertText('续')
    await expect(source).toHaveText('')
    expect(await kept!.evaluate((img) => img.isConnected)).toBe(true)
    await expect
      .poll(() => readFile(note, 'utf8'))
      .toBe(original.replace('最后一行。', '最后一行。续'))

    // Reading mode shows the same images and never the source.
    await first.click()
    await expect(source).toHaveText('![[宽图.png]]')
    await window.keyboard.press('Meta+E')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(source).toHaveText('')
    await expect(images).toHaveCount(6)
    expect(await kept!.evaluate((img) => img.isConnected)).toBe(true)
    await window.screenshot({ path: info.outputPath('images.png') })

    // The window loads a vault image and nothing else through mote-file://.
    const good = fileUrl(parseVaultPath(wide))
    expect(await loadInWindow(window, good)).toEqual({ loaded: true, width: 40 })
    const refused = [
      'mote-file://vault/../outside/secret.png',
      'mote-file://vault/%2e%2e/outside/secret.png',
      'mote-file://vault/..%2Foutside%2Fsecret.png',
      'mote-file://vault/.obsidian/app.json',
      'mote-file://vault/.obsidian/secret.png',
      'mote-file://vault/' + encodeURI(join(outside, 'secret.png')),
      'mote-file://' + encodeURI(join(outside, 'secret.png')),
      fileUrl(parseVaultPath('逃逸.png')),
      fileUrl(parseVaultPath('逃逸目录/secret.png')),
      fileUrl(parseVaultPath('图片.md')),
      'mote-file://other/' + encodeURI(wide)
    ]
    for (const url of refused)
      expect(await loadInWindow(window, url), url).toEqual({ loaded: false, width: 0 })

    // The handler answers each of them with an error status and no bytes.
    const fetchAll = (urls: string[], method: string): Promise<[number, number][]> =>
      app.evaluate(
        async ({ net }, { urls, method }) =>
          Promise.all(
            urls.map(async (url) => {
              const response = await net.fetch(url, { method })
              return [response.status, (await response.arrayBuffer()).byteLength] as [
                number,
                number
              ]
            })
          ),
        { urls, method }
      )
    expect(await fetchAll([good], 'GET')).toEqual([[200, image.length]])
    for (const [i, [status, bytes]] of (await fetchAll(refused, 'GET')).entries()) {
      expect(status, refused[i]).toBeGreaterThanOrEqual(400)
      expect(bytes, refused[i]).toBe(0)
    }
    expect(await fetchAll([good], 'POST')).toEqual([[405, 0]])
  } finally {
    await app.close()
  }
})
