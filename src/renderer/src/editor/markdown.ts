import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { indentNodeProp, Language, languageDataProp } from '@codemirror/language'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { markdownParser } from '../../../core/markdown'

// The shared parser plus two node props that only the editor reads; the tree is the same.
// lang-markdown's Enter and Backspace act only where the top node carries markdownLanguage.data.
// Without an indent rule on Document, Enter would drop a line's indentation.
const parser = markdownParser.configure({
  props: [
    languageDataProp.add({ Document: markdownLanguage.data }),
    indentNodeProp.add({ Document: () => null })
  ]
})

// Enter continues a list or quote, and Backspace removes its markup.
export const markdown: Extension = [
  new Language(markdownLanguage.data, parser, [], 'markdown').extension,
  Prec.high(keymap.of(markdownKeymap))
]
