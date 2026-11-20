import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { workspace } from '../workspace'
import { followLinks } from './follow'
import { livePreview } from './livePreview'
import { markdown } from './markdown'

// What every view of a note uses: the main editor and each embedded note. The main editor adds
// editing, saving and completion. A function, not a constant, because the embed renderer calls
// it and the preview imports that renderer.
export function noteView(): Extension {
  return [
    markdown,
    livePreview,
    followLinks((dest) => void workspace.follow(dest)),
    EditorView.lineWrapping
  ]
}
