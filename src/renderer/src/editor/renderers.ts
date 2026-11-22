import { calloutRenderers } from './callouts'
import { codeRenderers } from './code'
import { embedRenderers } from './embeds'
import { headingRenderers } from './headings'
import { imageRenderers } from './images'
import { inlineRenderers } from './inline'
import { linkRenderers } from './links'
import { listRenderers } from './lists'
import { mathRenderers } from './math'
import { mermaidRenderers } from './mermaid'
import type { Renderer } from './preview'
import { quoteRenderers } from './quotes'
import { tableRenderers } from './tables'
import { taskRenderers } from './tasks'
import { videoRenderers } from './videos'

// Syntax node name to the renderer that draws it. A new element adds a file and one line here.
export const renderers: Record<string, Renderer> = {
  ...inlineRenderers,
  ...headingRenderers,
  ...linkRenderers,
  ...listRenderers,
  ...quoteRenderers,
  ...codeRenderers,
  ...imageRenderers,
  ...mathRenderers,
  // Takes Blockquote from quoteRenderers and hands it plain quotes.
  ...calloutRenderers,
  ...tableRenderers,
  ...taskRenderers,
  // Takes FencedCode from codeRenderers and hands it every block that is not a diagram.
  ...mermaidRenderers,
  // Takes Image, HTMLBlock, HTMLTag from imageRenderers/defaults, hands non-videos to imageRenderers
  ...videoRenderers,
  // Takes WikiEmbed from videoRenderers and hands it every embed that is not a note.
  ...embedRenderers
}
