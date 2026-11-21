#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  formatKeymap,
  insertCodeBlock,
  insertQuote,
  toggleBold,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleStrikethrough
} from '../src/renderer/src/editor/formatting.ts'
import { channels } from '../src/core/ipc.ts'

console.log('=== 第 7 步：Markdown 快捷键与应用菜单 自动化验收走查 ===\n')

let failures = 0
function assert(desc, condition, details = '') {
  if (condition) {
    console.log(`✓ ${desc}`)
  } else {
    console.error(`✗ ${desc}`)
    if (details) console.error(`  ${details}`)
    failures++
  }
}

function createTarget(doc, selection, editable = true) {
  const state = EditorState.create({
    doc,
    selection: selection
      ? EditorSelection.single(selection.from, selection.to ?? selection.from)
      : undefined,
    extensions: [EditorView.editable.of(editable)]
  })
  const target = {
    state,
    dispatch(spec) {
      target.state = target.state.update(spec).state
    }
  }
  return target
}

// 1. 结构与文件完整性检查
console.log('--- 1. 结构与文件完整性检查 ---')
assert('formatting.ts 核心模块存在', existsSync(resolve('src/renderer/src/editor/formatting.ts')))
assert(
  'formatting.test.ts 单元测试存在',
  existsSync(resolve('src/renderer/src/editor/formatting.test.ts'))
)
assert('src/main/menu.ts 应用菜单模块存在', existsSync(resolve('src/main/menu.ts')))
assert('docs/plans/step-7.md 实现计划存在', existsSync(resolve('docs/plans/step-7.md')))
assert(
  'docs/adr/0015-native-application-menu-and-markdown-shortcuts.md ADR 存在',
  existsSync(resolve('docs/adr/0015-native-application-menu-and-markdown-shortcuts.md'))
)
assert('tests/e2e/menu.spec.ts E2E 测试用例存在', existsSync(resolve('tests/e2e/menu.spec.ts')))

// 2. IPC 与协议检查
console.log('\n--- 2. IPC 与通信契约检查 ---')
assert('channels.menuAction 已注册', channels.menuAction === 'mote:menu-action')

const ipcCode = readFileSync(resolve('src/core/ipc.ts'), 'utf8')
assert('ipc.ts 声明了 MenuAction 类型', ipcCode.includes('export type MenuAction ='))
assert(
  'MoteApi 包含 onMenuAction 订阅接口',
  ipcCode.includes('onMenuAction(callback: (action: MenuAction) => void): () => void')
)

const preloadCode = readFileSync(resolve('src/preload/index.ts'), 'utf8')
assert('preload 实现了 onMenuAction', preloadCode.includes('onMenuAction: (callback) => {'))

const appCode = readFileSync(resolve('src/renderer/src/App.tsx'), 'utf8')
assert('App.tsx 监听了 onMenuAction', appCode.includes('window.mote.onMenuAction((action) => {'))
assert(
  'App.tsx 支持 Cmd+\\ 切换侧边栏',
  appCode.includes("event.key === '\\\\'") || appCode.includes("event.key === '\\'")
)

// 3. 原生应用菜单检查
console.log('\n--- 3. macOS 原生应用菜单检查 ---')
const menuCode = readFileSync(resolve('src/main/menu.ts'), 'utf8')
assert(
  '包含“文件”菜单且含有新建、快速打开、保存',
  menuCode.includes("'文件'") &&
    menuCode.includes('CmdOrCtrl+N') &&
    menuCode.includes('CmdOrCtrl+S')
)
assert(
  '包含“编辑”菜单且含有搜索',
  menuCode.includes("'编辑'") && menuCode.includes('CmdOrCtrl+Shift+F')
)
assert(
  '包含“格式”菜单且含有全部 8 类格式化命令',
  menuCode.includes("'格式'") &&
    menuCode.includes('format-bold') &&
    menuCode.includes('format-italic') &&
    menuCode.includes('format-strike') &&
    menuCode.includes('format-highlight') &&
    menuCode.includes('format-code') &&
    menuCode.includes('format-link')
)
assert(
  '包含“查看”菜单且含有模式切换、字体与主题切换',
  menuCode.includes("'查看'") &&
    menuCode.includes('toggle-mode') &&
    menuCode.includes('toggle-font') &&
    menuCode.includes('toggle-theme')
)
assert('包含“窗口”和“帮助”菜单', menuCode.includes("'窗口'") && menuCode.includes("'帮助'"))

// 4. CodeMirror 快捷键注册检查
console.log('\n--- 4. CodeMirror 快捷键与编辑器集成检查 ---')
const noteEditorCode = readFileSync(resolve('src/renderer/src/NoteEditor.tsx'), 'utf8')
assert('NoteEditor 引入了 formatKeymap', noteEditorCode.includes('formatKeymap'))
assert(
  'formatKeymap 包含 Mod-b, Mod-i, Mod-k, Mod-Shift-x, Mod-Shift-h, Mod-` 等',
  formatKeymap.some((k) => k.key === 'Mod-b') &&
    formatKeymap.some((k) => k.key === 'Mod-i') &&
    formatKeymap.some((k) => k.key === 'Mod-k') &&
    formatKeymap.some((k) => k.key === 'Mod-Shift-x') &&
    formatKeymap.some((k) => k.key === 'Mod-Shift-h') &&
    formatKeymap.some((k) => k.key === 'Mod-`')
)

// 5. 格式化逻辑直接功能走查
console.log('\n--- 5. 格式化逻辑核心功能走查 ---')

// 5.1 粗体测试
{
  const t = createTarget('abc def ghi', { from: 4, to: 7 })
  toggleBold(t)
  assert('选中文本加粗为 **def**', t.state.doc.toString() === 'abc **def** ghi')
  toggleBold(t)
  assert('再次按下反选取消加粗还原为 def', t.state.doc.toString() === 'abc def ghi')

  const tEmpty = createTarget('abc ', { from: 4 })
  toggleBold(tEmpty)
  assert(
    '无选区时插入 **** 且光标居中',
    tEmpty.state.doc.toString() === 'abc ****' && tEmpty.state.selection.main.from === 6
  )
  toggleBold(tEmpty)
  assert('光标在 **** 中央再次按下取消反选直接删除', tEmpty.state.doc.toString() === 'abc ')
}

// 5.2 斜体测试
{
  const t = createTarget('text italic', { from: 5, to: 11 })
  toggleItalic(t)
  assert('选中文本变为 *italic*', t.state.doc.toString() === 'text *italic*')
  toggleItalic(t)
  assert('反选取消斜体', t.state.doc.toString() === 'text italic')
}

// 5.3 删除线与高亮测试
{
  const tStrike = createTarget('strike task', { from: 0, to: 6 })
  toggleStrikethrough(tStrike)
  assert('删除线变为 ~~strike~~', tStrike.state.doc.toString() === '~~strike~~ task')
  toggleStrikethrough(tStrike)
  assert('反选取消删除线', tStrike.state.doc.toString() === 'strike task')

  const tHigh = createTarget('mark highlight', { from: 5, to: 14 })
  toggleHighlight(tHigh)
  assert('高亮变为 ==highlight==', tHigh.state.doc.toString() === 'mark ==highlight==')
  toggleHighlight(tHigh)
  assert('反选取消高亮', tHigh.state.doc.toString() === 'mark highlight')
}

// 5.4 行内代码与代码块测试
{
  const tCode = createTarget('let x = 10', { from: 4, to: 5 })
  toggleInlineCode(tCode)
  assert('行内代码包裹为 `x`', tCode.state.doc.toString() === 'let `x` = 10')
  toggleInlineCode(tCode)
  assert('反选取消行内代码', tCode.state.doc.toString() === 'let x = 10')

  const tBlock = createTarget('return true', { from: 0, to: 11 })
  insertCodeBlock(tBlock)
  assert(
    '代码块包裹为 ```\\nreturn true\\n```',
    tBlock.state.doc.toString() === '```\nreturn true\n```'
  )
}

// 5.5 链接测试
{
  const tLink = createTarget('click here for docs', { from: 6, to: 10 })
  toggleLink(tLink)
  assert(
    '选中文本转换为 [here]()',
    tLink.state.doc.toString() === 'click [here]() for docs' &&
      tLink.state.selection.main.from === 13
  )

  const tUrl = createTarget('visit https://mote.app today', { from: 6, to: 23 })
  toggleLink(tUrl)
  assert(
    '选中网址转换为 [](https://mote.app) 且光标居于中括号',
    tUrl.state.doc.toString() === 'visit [](https://mote.app) today' &&
      tUrl.state.selection.main.from === 7
  )

  const tEmptyLink = createTarget('new ', { from: 4 })
  toggleLink(tEmptyLink)
  assert(
    '无选区时插入 []() 且光标居于中括号内',
    tEmptyLink.state.doc.toString() === 'new []()' && tEmptyLink.state.selection.main.from === 5
  )
  toggleLink(tEmptyLink)
  assert('光标在 []() 中央再次按下直接删除取消', tEmptyLink.state.doc.toString() === 'new ')
}

// 5.6 引用测试
{
  const tQuote = createTarget('quoted sentence', { from: 3 })
  insertQuote(tQuote)
  assert('在行首插入 > ', tQuote.state.doc.toString() === '> quoted sentence')
  insertQuote(tQuote)
  assert('再次按下取消行首引用', tQuote.state.doc.toString() === 'quoted sentence')
}

console.log('\n=============================================')
if (failures === 0) {
  console.log('🎉 第 7 步验收全项通过！(0 失败)')
  process.exit(0)
} else {
  console.error(`❌ 走查发现 ${failures} 处问题，请修复后重试。`)
  process.exit(1)
}
