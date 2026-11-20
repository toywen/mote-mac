# Callouts, tables and task checkboxes

Live preview draws three kinds of blocks. Reading mode draws them the same way and never shows their source.

## Sub-features

- `callout`: a quote whose first line is `> [!type] title` shows as a tinted block with a colored left border, the kind's icon and the title. With no title it shows the type name, capitalized. Kinds, aliases, colors and icons follow Obsidian 1.15.1: `tip`, `hint` and `important` are one kind, `note`, `info` and `todo` share one blue, and an unknown type looks like `note`. The `[!type]` marks show while the selection is on the first line. The body is ordinary text.
- `table`: a table is a real table with a header row, body rows and the delimiter row's alignment. Cells show bold, italic, strikethrough, highlight, inline code, tags and links. The table shows its Markdown source while the selection is in it. A click on a cell puts the cursor in that cell.
- `task`: `[ ]` and `[x]` become a checkbox in the bullet's place. A click changes the one character between the brackets, in both editor modes. A checked task's text is struck through and muted.

## How to get to it (user POV)

- Open a note with callouts, tables or tasks from the file tree.
- Click a table cell to edit the table. Click a checkbox to check or uncheck the task.

## Driving it with verify-mote

Preconditions:

- `$V launch --vault tests/fixtures/vaults/preview`, then `$V dialog-answer --path {vault}` and `$V click --role button --name 打开笔记库`.
- `VAULT=$($V paths | node -pe 'JSON.parse(require("fs").readFileSync(0)).vault')`.

Steps:

- **Callout colors.** `$V click --role treeitem --name callout --exact`. For each scheme, run `$V theme --scheme dark` or `light`, then read the title lines' border colors:

  ```sh
  $V eval --js "[...document.querySelectorAll('.cm-line.mote-callout-title')].map(l => l.textContent + ' ' + getComputedStyle(l).borderLeftColor)"
  ```

  The 8 types `笔记 信息 提示 重要 注意 危险 示例 引言` give 6 colors: 提示 and 重要 match, 笔记 and 信息 match. Dark and light give different values. Take `$V screenshot --out callouts-<scheme>`.
- **Callout source.** `$V click --text 注意 --exact`. `$V read --selector ".cm-line.mote-callout-title >> nth=4"` prints `> [!warning] 注意`.
- **Table cells.** `$V click --role treeitem --name 表格 --exact`. Count the first table's cells against the source:

  ```sh
  $V eval --js "(t => [t.querySelectorAll('th').length, t.querySelectorAll('td').length])(document.querySelector('.cm-content table'))"
  ```

  The source has 4 header cells and 3 rows of 4, so it prints `[4, 12]`.
- **Table source.** `$V click --text 斜体 --exact`. `$V read --role textbox --name 编辑器` contains `| :--- |`. `$V click --text 表格下面一行。 --exact`, and the same `read` has no `| :--- |`.
- **Task click.** `$V click --role treeitem --name 任务 --exact`, then `$V click --role checkbox --name 待办任务`. After 2 s, `$V vault-diff` lists only `任务.md`, and `cmp -l tests/fixtures/vaults/preview/任务.md "$VAULT/任务.md"` prints one line: a space (`40`) became `x` (`170`).
- **Input method.** Click the line below a table or the body line of a callout, press `End`, and run `$V ime --text 测试 --commit 测试 --no-enter`. After 2 s, `diff` against the fixture shows only `测试` added on that line.
- **Proof.** Keep the `eval` output, the screenshots and the diffs in the evidence dir, then `$V stop`.

For a real vault, open the note with the most callouts and the note with the most tables in both editor modes, take a screenshot of each, and run `walk-notes` with `errorCount` 0 and `vault-diff --expect-unchanged`.

## Gotchas

- Source shows only while the editor has focus. A note opened from the file tree shows no source until you click into it.
- A table inside a quote or a list item's first line stays in its line, after the line's marks. A table that starts its own line is drawn between lines.
- The `•` of a task line is still in the DOM, hidden, to keep the bullet's width. `innerText` skips it and `textContent` does not.
- The checkbox's accessible name is the task's source text after the marker.
