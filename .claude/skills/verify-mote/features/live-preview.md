# Live preview and reading mode

The editor draws Markdown as you write. An element shows its Markdown marks only while the selection touches it. `Cmd+E` switches the whole window between live preview and reading mode. Reading mode is the same editor with editing off, and nothing shows source there.

## Sub-features

- `preview-hide`: away from the selection, headings, bold, italic, strikethrough, highlight, inline code, tags, wiki links, Markdown links, bare URLs, lists, quotes, rules, code blocks and properties hide their marks.
- `preview-reveal`: the element the selection touches shows its marks. Other elements on the same line stay hidden. Heading, quote and list marks show with their line; code blocks and properties show their fences for the whole block.
- `preview-links`: a wiki link shows its alias, or its target when it has none. A Markdown link shows its label. A link whose target does not resolve has its own color.
- `preview-lists`: wrapped lines of a list item start under its text. Enter continues the list.
- `reading-mode`: `Cmd+E` or the header button switches modes. Typing changes nothing. The mode stays when another note opens.
- `preview-ime`: composing next to an element adds only the committed characters, and the element keeps its marks until the composition ends.

Callouts, tables and task checkboxes have their own recipe, [blocks.md](./blocks.md). Images are in [images.md](./images.md). Mermaid and note embeds still show as source. A later PR of step 3 adds them.

## How to get to it (user POV)

- Open a note from the file tree. Click into an element to see its marks.
- Press `Cmd+E`, or click the book icon in the editor header. Its name says what it does: `切换到阅读模式` or `切换到实时预览`.

## Driving it with verify-mote

Preconditions:

- `$V launch --vault tests/fixtures/vaults/preview`, then `$V dialog-answer --path {vault}` and `$V click --role button --name 打开笔记库`.
- `VAULT=$($V paths | node -pe 'JSON.parse(require("fs").readFileSync(0)).vault')`.

Steps:

- **Hidden away from the selection.** `$V click --role treeitem --name 行内 --exact`, then `$V read --role textbox --name 编辑器`. The text has no `**`, `==`, `[[` or `](`. The links line reads `双链 目标，带别名的 别名，不存在的 不存在的笔记。`
- **Shown at the selection.** `$V click --text 粗体 --exact`, then `$V read --selector ".cm-line >> nth=2"` prints `这一行有 **粗体**、斜体、删除线、高亮 和 行内代码。` Only the bold shows its marks.
- **Reading mode.** `$V press --key Meta+E`. `$V snapshot` shows the button `切换到实时预览`. `$V type --text 字`, then the same `read` prints the line without `**`. `$V vault-diff --expect-unchanged` prints `unchanged`. `$V press --key Meta+E` switches back.
- **Input method.** `$V click --selector ".cm-line >> nth=-2"` and `$V press --key End`. The line shows `[[目标]]`, because the caret touches the link. Run `$V ime --text 测试 --commit 测试 --no-enter --hold 400 --probe-js "document.querySelectorAll('.cm-line')[document.querySelectorAll('.cm-line').length - 2].textContent"`. The probe shows `[[目标]]测试` while composing. After 2 s, `$V vault-diff` lists only `行内.md`, and `diff` against the fixture shows only `测试` added at the end of the last line.
- **Lists.** Open `列表` and `$V screenshot --out lists`. The second item wraps, and its second line starts under `第二项`, not under the bullet.
- **Properties.** Open `属性`. The first line is empty, and the YAML is a monospace block. Click `title: 属性示例`; the first line shows `---`.
- **Proof.** Keep the screenshots, the `read` output and the diffs in the evidence dir, then `$V stop`.

For every note of a real vault in both modes, run `walk-notes` after the vault opens, once as is and once after `$V press --key Meta+E`. Each run needs `errorCount` 0 and `vault-diff --expect-unchanged`.

## Gotchas

- Source shows only while the editor has focus. A note opened from the file tree has no focus, so it shows no marks until you click into it.
- `ime` without `--no-enter` presses a raw Enter with key code 13 during the composition. CodeMirror turns that into new lines, on main before live preview too. A real macOS input method confirms with a key that CodeMirror sees as composing, so use `--no-enter` for editor text.
- The editor's visible text skips hidden marks. Read the file, not the editor, when you check bytes.
