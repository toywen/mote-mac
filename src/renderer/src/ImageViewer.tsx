import React, { useState } from 'react'
import { Maximize2, ZoomIn } from 'lucide-react'
import type { VaultPath } from '../../core/ipc'
import { fileUrl } from '../../core/fileUrl'

export function ImageViewer({
  path,
  revision
}: {
  path: VaultPath
  revision?: number
}): React.JSX.Element {
  const [fit, setFit] = useState<boolean>(true)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>): void {
    const img = e.currentTarget
    setDimensions({ width: img.naturalWidth, height: img.naturalHeight })
  }

  return (
    <div className="image-viewer-container" data-image-path={path}>
      <div className="image-viewer-toolbar">
        {dimensions && (
          <span className="image-dimensions-badge" aria-label="图片分辨率">
            {dimensions.width} × {dimensions.height}
          </span>
        )}
        <button
          type="button"
          className="image-viewer-btn"
          onClick={() => setFit((f) => !f)}
          title={fit ? '查看原始尺寸（1:1）' : '适应窗口大小'}
          aria-label={fit ? '查看原始尺寸' : '适应窗口大小'}
        >
          {fit ? <ZoomIn size={13} strokeWidth={1.6} /> : <Maximize2 size={13} strokeWidth={1.6} />}
          <span>{fit ? '1:1 原图' : '适应窗口'}</span>
        </button>
      </div>
      <div
        className="image-viewer-canvas"
        onClick={() => setFit((f) => !f)}
        title={fit ? '点击查看 1:1 原图' : '点击自适应窗口'}
      >
        <img
          key={`${path}:${revision ?? 0}`}
          src={fileUrl(path)}
          alt={path}
          className={`image-viewer-img ${fit ? 'is-fit' : 'is-natural'}`}
          onLoad={handleImageLoad}
        />
      </div>
    </div>
  )
}
