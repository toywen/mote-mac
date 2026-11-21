import { Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../core/updaterTypes'
import './UpdateNotification.css'

export function UpdateNotification(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    const off = window.mote?.onUpdateStatus?.((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.state === 'available') {
        setDismissed(false)
      }
    })
    return () => off?.()
  }, [])

  if (!status || dismissed) return null

  const { state, release, progress } = status

  // 静默更新策略：仅在检测到可用更新、下载中或准备就绪时提示用户，
  // 检查中、最新版本、错误状态（如无发布Release）均不侵扰用户界面
  if (state === 'idle' || state === 'not-available' || state === 'checking' || state === 'error') {
    return null
  }

  const handleDownload = (): void => {
    void window.mote?.downloadUpdate?.()
  }

  const handleInstall = (): void => {
    void window.mote?.installUpdate?.()
  }

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner-header">
        <div className="update-banner-title">
          <Sparkles size={15} strokeWidth={1.5} className="update-sparkle-icon" />
          {state === 'available' && (
            <span>
              发现新版本 <span className="update-banner-badge">v{release?.version}</span>
            </span>
          )}
          {state === 'downloading' && <span>正在下载更新...</span>}
          {state === 'downloaded' && <span>新版本已就绪</span>}
          {state === 'installing' && <span>正在重启应用更新...</span>}
        </div>

        <div className="update-banner-actions">
          {state === 'available' && (
            <>
              {release?.body && (
                <button
                  type="button"
                  className="update-btn-link"
                  onClick={() => setShowNotes(!showNotes)}
                >
                  {showNotes ? '收起说明' : '更新说明'}
                </button>
              )}
              <button type="button" className="update-btn-primary" onClick={handleDownload}>
                下载更新
              </button>
            </>
          )}

          {state === 'downloaded' && (
            <button type="button" className="update-btn-primary" onClick={handleInstall}>
              立即重启更新
            </button>
          )}

          <button
            type="button"
            className="update-close-btn"
            title="稍后提醒"
            aria-label="关闭提示"
            onClick={() => setDismissed(true)}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {state === 'downloading' && progress && (
        <div className="update-progress-container">
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="update-progress-text">
            <span>
              {(progress.bytesDownloaded / (1024 * 1024)).toFixed(1)} MB /{' '}
              {(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB
            </span>
            <span>{progress.percent}%</span>
          </div>
        </div>
      )}

      {showNotes && release?.body && <div className="update-release-body">{release.body}</div>}
    </div>
  )
}
