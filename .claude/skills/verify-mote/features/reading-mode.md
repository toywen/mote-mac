# Mermaid diagrams and note embeds

Reading mode draws everything as rendered. Two elements need more than styled text: a `mermaid` code block shows as a diagram, and `![[note]]` shows the embedded note's content. Both are widgets of the same CodeMirror view, and they draw the same way in live preview while the selection is away from them.

## Sub-features

- `mermaid-diagram`: a ```` ```mermaid ```` block that starts its line shows as an `svg`. The Mermaid library loads the first time a note with a diagram opens. A note without one never loads it.
- `mermaid-error`: a diagram that fails to parse shows its code and Mermaid's error message.
- `mermaid-scheme`: the diagram uses Mermaid's dark theme in the dark color scheme, and redraws when the scheme changes.
- `mermaid-source`: in live preview the block shows its source while the selection touches it.
- `embed-note`: `![[note]]` shows the note's text under the note's name, with a line on its left. Links inside it resolve from the embedded note's folder, and a click follows them. A click on the name opens the note.
- `embed-section`: `![[note#heading]]` shows from that heading to the next heading of the same or a higher level. `![[note#^id]]` shows that block. A heading or block that does not exist shows as a missing link.
- `embed-live`: the embed reads the note again after every vault change and save, so a change from outside shows within a second.
- `embed-nesting`: an embed inside an embedded note draws too, down to 3 levels. A note already in the chain above, or a fourth level, shows as a link. `A` embedding `B` embedding `A` does not hang.

## How to get to it (user POV)

- Open a note with a diagram or an embed from the file tree, then press `Cmd+E` for reading mode.
- In live preview, move the cursor onto the block or the embed's line to see its source.

## Driving it with verify-mote

Preconditions:

- `$V launch --vault tests/fixtures/vaults/preview`, then `$V dialog-answer --path {vault}` and `$V click --role button --name 打开笔记库`. `图表.md` holds a diagram, a broken diagram and a plain code block. `嵌入.md` embeds `项目/计划.md` whole, by heading, by block and by a missing heading, the cycle `循环甲` and `循环乙`, and the chain `深一` to `深四`. `自身.md` embeds its own section.
- `VAULT=$($V paths | node -pe 'JSON.parse(require("fs").readFileSync(0)).vault')`.

Steps:

- **Diagram.** `$V click --role treeitem --name 图表 --exact`, `$V press --key Meta+E`. `$V eval --js "[...document.querySelectorAll('.mote-mermaid')].map(d => [!!d.querySelector('svg'), d.textContent.slice(0, 60)])"` shows an `svg` for the first block and the error text for the second. `$V screenshot --out mermaid-dark`.
- **Color scheme.** `$V theme --scheme light`, then `$V screenshot --out mermaid-light`. The diagram redraws with light colors. `$V theme --scheme dark` switches back.
- **No library without a diagram.** On a fresh launch, open notes without a diagram, then `$V eval --js "performance.getEntriesByType('resource').map(r => r.name).filter(n => /mermaid/i.test(n))"` prints `[]`.
- **Embed.** Open `嵌入`. `$V read --selector ".mote-embed >> nth=0"` prints `计划` and its text. The second embed has `只属于目标这一节` and `目标下面的细节`, and no `风险`.
- **External change.** `printf '\n外部写入的一行。\n' >> "$VAULT/项目/计划.md"`. Within a second the first embed's text ends with `外部写入的一行。`
- **Nesting and cycles.** In `嵌入`, `深三的正文` shows and `深四` is a link. `循环乙` shows inside `循环甲`, and the `循环甲` inside it is a link. `$V eval --js "document.querySelectorAll('.mote-embed').length"` stays the same after a second.
- **Input method.** Click the line under the diagram, `$V press --key End`, then `$V ime --text 测试 --commit 测试 --no-enter`. Do the same on the line under the first embed. `$V vault-diff` lists only the edited notes, each with only `测试` added.
- **Proof.** Keep the `eval` output and screenshots, run `$V vault-diff --expect-unchanged` on a fresh launch after `walk-notes`, then `$V stop`.

## Gotchas

- A diagram draws asynchronously. Read the `svg` after a moment, or `$V wait --selector ".mote-mermaid svg"`.
- The embed's nested editor has its own `.cm-line` elements inside the main editor. Scope a selector to `.mote-embed` when you mean the embed.
- The diagram cache holds drawings by code text and color scheme, so a second note with the same diagram draws at once.
