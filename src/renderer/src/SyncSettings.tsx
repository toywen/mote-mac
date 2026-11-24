import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { SyncSettingsView, SyncStatusView } from '../../core/ipc'
import { syncStatusDetail, syncStatusText } from './syncText'

type Props = {
  dir: string
  onClose: () => void
}

/**
 * The sync settings. The device token never comes back from main, so an empty field keeps the
 * saved one. The fingerprint is shown after a save, to compare with the server's own print.
 */
export function SyncSettings({ dir, onClose }: Props): React.JSX.Element {
  const [view, setView] = useState<SyncSettingsView | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [certPem, setCertPem] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SyncStatusView>({ state: 'unset', pending: 0 })

  useEffect(() => {
    let live = true
    void window.mote?.getSyncSettings().then((settings) => {
      if (!live) return
      setView(settings)
      setServerUrl(settings.serverUrl)
      setCertPem(settings.certPem ?? '')
    })
    void window.mote?.getSyncStatus(dir).then((next) => {
      if (live) setStatus(next)
    })
    const off = window.mote?.onSyncStatus((next) => {
      if (next.dir === dir) setStatus(next)
    })
    return () => {
      live = false
      off?.()
    }
  }, [dir])

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await window.mote.saveSyncSettings({
        serverUrl,
        certPem: certPem.trim() || undefined,
        token: token.trim() || undefined
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setView(result.settings)
      setToken('')
      setStatus(await window.mote.getSyncStatus(dir))
    } finally {
      setBusy(false)
    }
  }

  async function clear(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const next = await window.mote.clearSyncSettings()
      setView(next)
      setServerUrl('')
      setCertPem('')
      setToken('')
      setStatus(await window.mote.getSyncStatus(dir))
    } finally {
      setBusy(false)
    }
  }

  async function pickCert(): Promise<void> {
    const pem = await window.mote.chooseSyncCert()
    if (pem) setCertPem(pem)
  }

  const detail = syncStatusDetail(status)
  return (
    <div
      className="sync-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="sync-panel" role="dialog" aria-modal="true" aria-label="同步设置">
        <header className="sync-panel-header">
          <h2>同步</h2>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </header>
        <div className="sync-body">
          <label className="sync-field">
            <span>服务器地址</span>
            <input
              value={serverUrl}
              placeholder="https://1.2.3.4:8443"
              autoFocus
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </label>
          <label className="sync-field">
            <span>证书（PEM）</span>
            <textarea
              value={certPem}
              rows={4}
              spellCheck={false}
              placeholder="-----BEGIN CERTIFICATE-----"
              onChange={(event) => setCertPem(event.target.value)}
            />
          </label>
          <div className="sync-row">
            <button type="button" className="sync-button" onClick={() => void pickCert()}>
              从文件选择证书
            </button>
            {view?.fingerprint && (
              <code className="sync-fingerprint" title="证书的 SHA-256 指纹">
                {view.fingerprint}
              </code>
            )}
          </div>
          <label className="sync-field">
            <span>设备令牌</span>
            <input
              type="password"
              value={token}
              placeholder={
                view?.hasToken ? '已保存，留空则不修改' : '服务器上 device create 打印的令牌'
              }
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          {error && (
            <p className="sync-error" role="alert">
              {error}
            </p>
          )}
          <p className="sync-state" role="status">
            {syncStatusText(status)}
            {detail ? `，${detail}` : ''}
          </p>
        </div>
        <footer className="sync-actions">
          <button
            type="button"
            className="sync-button"
            onClick={() => void clear()}
            disabled={busy || !view?.hasToken}
          >
            断开同步
          </button>
          <button
            type="button"
            className="sync-button is-primary"
            onClick={() => void save()}
            disabled={busy}
          >
            保存并连接
          </button>
        </footer>
      </div>
    </div>
  )
}
