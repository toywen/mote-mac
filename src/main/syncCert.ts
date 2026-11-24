import { createHash, X509Certificate } from 'node:crypto'

/** SHA-256 of the certificate's DER bytes, lowercase hex, the same value `openssl x509` prints. */
export function fingerprintOf(pem: string): string {
  return createHash('sha256').update(new X509Certificate(pem).raw).digest('hex')
}

/** `AA:BB:…`, the colon form the CLI prints, for the window to compare by eye. */
export function colonFingerprint(hex: string): string {
  return hex
    .toUpperCase()
    .match(/../g)!
    .join(':')
}

/**
 * Reads and checks a server address. Returns the normalized address, or a message for the
 * window. https needs a certificate; http is only for a local server and needs none.
 */
export function checkServerUrl(text: string): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return { ok: false, error: '服务器地址要像 https://1.2.3.4:8443' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: '服务器地址要以 https:// 开头' }
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, error: '服务器地址只写到主机和端口' }
  }
  return { ok: true, url: url.origin }
}

/** Reads a PEM certificate, or a message for the window. */
export function parseCert(pem: string): { ok: true; fingerprint: string } | { ok: false; error: string } {
  try {
    return { ok: true, fingerprint: fingerprintOf(pem) }
  } catch {
    return { ok: false, error: '证书不是有效的 PEM' }
  }
}
