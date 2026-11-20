import { calloutRenderers } from './callouts'
import { codeRenderers } from './code'
import { headingRenderers } from './headings'
import { imageRenderers } from './images'
import { inlineRenderers } from './inline'
import { linkRenderers } from './links'
import { listRenderers } from './lists'
import type { Renderer } from './preview'
import { quoteRenderers } from './quotes'
import { tableRenderers } from './tables'
import { taskRenderers } from './tasks'

// Syntax node name to the renderer that draws it. A new element adds a file and one line here.
export const renderers: Record<string, Renderer> = {
  ...inlineRenderers,
  ...headingRenderers,
  ...linkRenderers,
  ...listRenderers,
  ...quoteRenderers,
  ...codeRenderers,
  ...imageRenderers,
  // Takes Blockquote from quoteRenderers and hands it plain quotes.
  ...calloutRenderers,
  ...tableRenderers,
  ...taskRenderers
}
