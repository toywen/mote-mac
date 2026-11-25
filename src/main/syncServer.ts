/** The deployed sync service. `syncServerUrl` in settings.json replaces it. */
export const DEFAULT_SYNC_SERVER = 'http://8.154.28.245:8443'

/**
 * Reads and checks a server address. Returns the normalized address, or a message for the
 * window.
 */
export function checkServerUrl(
  text: string
): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return { ok: false, error: '服务器地址要像 http://1.2.3.4:8443' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: '服务器地址要以 http:// 或 https:// 开头' }
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, error: '服务器地址只写到主机和端口' }
  }
  return { ok: true, url: url.origin }
}

/** The address sync uses: the one settings.json names, or the deployed service. */
export function syncServerOf(
  configured: unknown
): { ok: true; url: string } | { ok: false; error: string } {
  if (configured === undefined) return { ok: true, url: DEFAULT_SYNC_SERVER }
  const checked = checkServerUrl(typeof configured === 'string' ? configured : '')
  if (checked.ok) return checked
  return { ok: false, error: `settings.json 里的 syncServerUrl 不对：${checked.error}` }
}
