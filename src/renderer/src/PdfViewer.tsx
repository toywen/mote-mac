import React from 'react'
import type { VaultPath } from '../../core/ipc'
import { fileUrl } from '../../core/fileUrl'

export function PdfViewer({
  path,
  revision
}: {
  path: VaultPath
  revision?: number
}): React.JSX.Element {
  return (
    <div className="pdf-viewer-container" data-pdf-path={path}>
      <iframe
        key={`${path}:${revision ?? 0}`}
        src={fileUrl(path)}
        className="pdf-viewer-frame"
        title={path}
      />
    </div>
  )
}
