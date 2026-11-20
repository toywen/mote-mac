# Images

`![](path)` and `![[image]]` show the image in live preview and in reading mode. Away from the selection only the image shows. While the selection touches it, its Markdown source shows with the image under it. The window loads vault images through `mote-file://vault/<path>`, which serves only image files of the open vault (ADR 0007), and `https` images as they are.

## Sub-features

- `image-local`: `![[图片.png]]` and `![alt](附件/图片.png)` resolve like any link and load from the vault.
- `image-https`: `![](https://...)` loads from the network. `http:` images are blocked by the window's content security policy.
- `image-size`: `![[图片.png|300]]` and `![alt|300](path)` are 300 pixels wide. `|300x200` sets both. No image grows wider than the editor.
- `image-missing`: an image that does not resolve or does not load shows a small box with its name, not a broken-image icon.
- `embed-link`: an embed that is not an image, such as `![[笔记]]` or `![[文件.pdf]]`, shows its target as a link. A missing target has the missing-link color.
- `image-protocol`: `mote-file://` refuses `..`, dot paths such as `.obsidian`, symlinks, notes, other hosts and anything outside the vault.

## How to get to it (user POV)

- Open a note with images from the file tree.
- Click an image to see its source above it. Press `Cmd+E` for reading mode.

## Driving it with verify-mote

Preconditions:

- `$V launch --vault tests/fixtures/vaults/preview`, then `$V dialog-answer --path {vault}` and `$V click --role button --name 打开笔记库`. Its note `图片.md` holds every case above.
- For a real vault, launch with `--vault ~/mote-link-check/workspace-copy`. Its local images are under `02_Projects/content/wechat/`. `~/mote-link-check/knowledge-base-copy` has 125 `https` images and no image files.

Steps:

- **Local images load.** Open the note, then `$V eval --js "[...document.querySelectorAll('.mote-image img')].map(i => [i.src, i.naturalWidth])"`. Every `mote-file:` image has `naturalWidth` above 0. An image still loading reads 0, so read again after a second.
- **Sizes.** `$V eval --js "[...document.querySelectorAll('.mote-image img')].map(i => Math.round(i.getBoundingClientRect().width))"`. `|300` reads 300.
- **https images.** In a note with `https` images, the same `eval` shows at least one `https:` image with `naturalWidth` above 0. With no network, record this step as not proven.
- **Source at the selection.** `$V click --selector ".mote-image img >> nth=0"`, then `$V read --selector ".cm-line:has(.mote-image) >> nth=0"` prints the source, such as `![[图片.png]]`. `$V screenshot --out image-source` shows the image under it.
- **Reading mode.** `$V press --key Meta+E`, run the same `eval` and `screenshot`. The images are there and no source shows.
- **Input method.** Click the line after an image, `$V press --key End`, then `$V ime --text 测试 --commit 测试 --no-enter`. `$V vault-diff` lists only that note, and it gained only `测试`.
- **Protocol.** `$V main-eval --js "electron.net.fetch('mote-file://vault/.obsidian/app.json').then(r => r.status)"` prints 400. A vault image URL from the `eval` above prints 200.
- **Proof.** Keep the `eval` output, the screenshots and `$V vault-diff --expect-unchanged` (`unchanged` unless you typed), then `$V stop`.

## Gotchas

- The `basic` vault's `附件/图片.png` is 1 by 1 pixel. It is there, but small.
- An image resolves with the link rules, so `![[图片.png]]` finds `附件/图片.png` by name. A Markdown image path is decoded first, so `%20` is a space.
- The `.mote-image` box stays in the DOM while the source shows; read the line's text, not the box, to see the source.
