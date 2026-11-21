import { Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { VaultPath } from '../../../core/ipc'
import { imageType } from '../../../core/fileUrl'
import { formatPastedImageName } from '../../../core/attachments'

export type AttachmentContext = {
  dir: string
  notePath: VaultPath
}

export const attachmentContext = Facet.define<AttachmentContext, AttachmentContext | null>({
  combine: (values) => values[0] ?? null
})

export const imagePasteAndDrop = EditorView.domEventHandlers({
  paste(event, view) {
    const ctx = view.state.facet(attachmentContext)
    if (!ctx || view.state.readOnly || view.state.facet(EditorView.editable) === false) {
      return false
    }

    const clipboardData = event.clipboardData
    if (!clipboardData) return false

    const files: File[] = []
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i]
        if (file.type.startsWith('image/') || imageType(file.name)) {
          files.push(file)
        }
      }
    } else if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
    }

    if (files.length === 0) return false

    event.preventDefault()
    event.stopPropagation()

    void (async () => {
      try {
        const embedTexts: string[] = []
        for (const file of files) {
          const isGeneric = !file.name || file.name === 'image.png'
          const ext =
            file.name && file.name.includes('.')
              ? file.name.slice(file.name.lastIndexOf('.') + 1)
              : 'png'
          const fileName = isGeneric ? formatPastedImageName(new Date(), ext) : file.name
          const buffer = await file.arrayBuffer()
          const saved = await window.mote.saveAttachment(
            ctx.dir,
            ctx.notePath,
            fileName,
            new Uint8Array(buffer)
          )
          embedTexts.push(saved.embedText)
        }
        if (embedTexts.length > 0) {
          const insert = embedTexts.join('\n')
          const { from, to } = view.state.selection.main
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
            scrollIntoView: true
          })
        }
      } catch (err) {
        console.error('Failed to save attachment:', err)
      }
    })()

    return true
  },

  dragover(event, view) {
    const ctx = view.state.facet(attachmentContext)
    if (!ctx || view.state.readOnly || view.state.facet(EditorView.editable) === false) {
      return false
    }
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      return true
    }
    return false
  },

  drop(event, view) {
    const ctx = view.state.facet(attachmentContext)
    if (!ctx || view.state.readOnly || view.state.facet(EditorView.editable) === false) {
      return false
    }

    const dt = event.dataTransfer
    if (!dt?.files || dt.files.length === 0) return false

    const files: File[] = []
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i]
      if (file.type.startsWith('image/') || imageType(file.name)) {
        files.push(file)
      }
    }

    if (files.length === 0) return false

    event.preventDefault()
    event.stopPropagation()

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    const insertPos = pos !== null ? pos : view.state.selection.main.from

    void (async () => {
      try {
        const embedTexts: string[] = []
        for (const file of files) {
          const isGeneric = !file.name || file.name === 'image.png'
          const ext =
            file.name && file.name.includes('.')
              ? file.name.slice(file.name.lastIndexOf('.') + 1)
              : 'png'
          const fileName = isGeneric ? formatPastedImageName(new Date(), ext) : file.name
          const buffer = await file.arrayBuffer()
          const saved = await window.mote.saveAttachment(
            ctx.dir,
            ctx.notePath,
            fileName,
            new Uint8Array(buffer)
          )
          embedTexts.push(saved.embedText)
        }
        if (embedTexts.length > 0) {
          const insert = embedTexts.join('\n')
          view.dispatch({
            changes: { from: insertPos, to: insertPos, insert },
            selection: { anchor: insertPos + insert.length },
            scrollIntoView: true
          })
        }
      } catch (err) {
        console.error('Failed to save dropped attachment:', err)
      }
    })()

    return true
  }
})
