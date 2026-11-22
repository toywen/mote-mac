import React, { useRef } from 'react'
import type { VaultPath } from '../../core/ipc'
import { fileUrl } from '../../core/fileUrl'

export function HtmlViewer({
  path,
  revision
}: {
  path: VaultPath
  revision?: number
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function handleLoad(): void {
    try {
      const doc = iframeRef.current?.contentDocument
      if (!doc) return
      doc.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement | null)?.closest('a')
        if (!target) return
        const href = target.getAttribute('href')
        if (href && /^(https?|mailto):/i.test(href)) {
          e.preventDefault()
          void window.mote?.openExternal(href)
        }
      })
    } catch {
      // Cross-origin restriction fallback handled by will-frame-navigate
    }
  }

  return (
    <div className="html-viewer-container" data-html-path={path}>
      <iframe
        ref={iframeRef}
        key={`${path}:${revision ?? 0}`}
        src={fileUrl(path)}
        className="html-viewer-frame"
        title={path}
        sandbox="allow-scripts allow-same-origin allow-forms"
        onLoad={handleLoad}
      />
    </div>
  )
}
