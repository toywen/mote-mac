import { inlineRenderers } from './inline'
import type { Renderer } from './preview'

// Syntax node name to the renderer that draws it. A new element adds a file and one line here.
export const renderers: Record<string, Renderer> = {
  ...inlineRenderers
}
