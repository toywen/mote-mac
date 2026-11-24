import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { SyncAuthInput, SyncSettingsView, SyncStatusView } from '../../core/ipc'
import { syncStatusDetail, syncStatusText } from './syncText'

type Props = {
  dir: string
  onClose: () => void
}

type Mode = 'login' | 'register' | 'recover'

/**
 * The sync panel. A user types a username and a password, and that is the whole job: the device
 * token, the vault id and the certificate never come back to the window. The server address and
 * the certificate live under 高级, for the self-signed service that runs before the public one.
 */
export function SyncSettings({ dir, onClose }: Props): React.JSX.Element {
  const [view, setView] = useState<SyncSettingsView | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [certPem, setCertPem] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [mode, setMode] = useState<Mode>('login')
  const [advanced, setAdvanced] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
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
      setUsername(settings.account ?? '')
      // Without an address there is nowhere to sign in, so show where it goes straight away.
      setAdvanced(!settings.serverUrl)
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

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const input: SyncAuthInput = {
        serverUrl,
        certPem: certPem.trim() || undefined,
        username,
        password,
        recoveryCode: mode === 'recover' ? recoveryCode : undefined
      }
      const call =
        mode === 'register'
          ? window.mote!.syncRegister(input)
          : mode === 'recover'
            ? window.mote!.syncRecover(input)
            : window.mote!.syncLogin(input)
      const result = await call
      if (!result.ok) {
        setError(result.error)
        return
      }
      setView(result.settings)
      setPassword('')
      setRecoveryCode('')
      setStatus(await window.mote!.getSyncStatus(dir))
      if (result.recoveryCode) setIssued(result.recoveryCode)
    } finally {
      setBusy(false)
    }
  }

  async function signOut(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const next = await window.mote!.clearSyncSettings()
      setView(next)
      setPassword('')
      setMode('login')
      setStatus(await window.mote!.getSyncStatus(dir))
    } finally {
      setBusy(false)
    }
  }

  async function pickCert(): Promise<void> {
    const pem = await window.mote!.chooseSyncCert()
    if (pem) setCertPem(pem)
  }

  const detail = syncStatusDetail(status)
  const signedIn = view?.hasToken === true

  const advancedFields = (
    <details
      className="sync-advanced"
      open={advanced}
      onToggle={(event) => setAdvanced(event.currentTarget.open)}
    >
      <summary>高级</summary>
      <label className="sync-field">
        <span>服务器地址</span>
        <input
          value={serverUrl}
          placeholder="https://1.2.3.4:8443"
          onChange={(event) => setServerUrl(event.target.value)}
        />
      </label>
      <label className="sync-field">
        <span>证书（PEM）</span>
        <textarea
          value={certPem}
          rows={4}
          spellCheck={false}
          placeholder="公共证书不用填，自签证书填在这里"
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
    </details>
  )

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

        {issued ? (
          <div className="sync-body">
            <p className="sync-note">把找回码抄下来。它只显示这一次，忘了密码时靠它找回账户。</p>
            <code className="sync-code">{issued}</code>
            <p className="sync-note">已经登录，笔记开始同步。找回码丢了就再也找不回来。</p>
          </div>
        ) : signedIn ? (
          <div className="sync-body">
            <p className="sync-account">
              已登录：<strong>{view?.account ?? '本账户'}</strong>
            </p>
            {advancedFields}
            <p className="sync-state" role="status">
              {syncStatusText(status)}
              {detail ? `，${detail}` : ''}
            </p>
          </div>
        ) : (
          <div className="sync-body">
            <label className="sync-field">
              <span>用户名</span>
              <input
                value={username}
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="3 到 32 个字母、数字、下划线或短横线"
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            {mode === 'recover' && (
              <label className="sync-field">
                <span>找回码</span>
                <input
                  value={recoveryCode}
                  spellCheck={false}
                  placeholder="注册时抄下的那一串"
                  onChange={(event) => setRecoveryCode(event.target.value)}
                />
              </label>
            )}
            <label className="sync-field">
              <span>{mode === 'recover' ? '新密码' : '密码'}</span>
              <input
                type="password"
                value={password}
                placeholder="至少 8 位"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit()
                }}
              />
            </label>
            {advancedFields}
            {error && (
              <p className="sync-error" role="alert">
                {error}
              </p>
            )}
            <p className="sync-state" role="status">
              {syncStatusText(status)}
              {detail ? `，${detail}` : ''}
            </p>
            <p className="sync-links">
              {mode === 'login' ? (
                <>
                  <button type="button" className="sync-link" onClick={() => setMode('recover')}>
                    忘记密码
                  </button>
                </>
              ) : (
                <button type="button" className="sync-link" onClick={() => setMode('login')}>
                  返回登录
                </button>
              )}
            </p>
          </div>
        )}

        <footer className="sync-actions">
          {issued ? (
            <button
              type="button"
              className="sync-button is-primary"
              onClick={() => {
                setIssued(null)
                onClose()
              }}
            >
              我记下了
            </button>
          ) : signedIn ? (
            <button
              type="button"
              className="sync-button is-danger"
              onClick={() => void signOut()}
              disabled={busy}
            >
              退出登录
            </button>
          ) : (
            <>
              {mode === 'login' && (
                <button
                  type="button"
                  className="sync-button"
                  onClick={() => {
                    setMode('register')
                    setError(null)
                  }}
                  disabled={busy}
                >
                  注册
                </button>
              )}
              <button
                type="button"
                className="sync-button is-primary"
                onClick={() => void submit()}
                disabled={busy}
              >
                {mode === 'register' ? '创建账户' : mode === 'recover' ? '重置密码' : '登录'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
