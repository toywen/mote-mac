import { X509Certificate } from 'node:crypto'
import * as http from 'node:http'
import * as https from 'node:https'
import type { PeerCertificate } from 'node:tls'
import {
  isErrorCode,
  parseChangesPage,
  parseCommitResult,
  parseServerMessage,
  parseVaultList,
  type ChangesPage,
  type CommitItem,
  type CommitResult,
  type ContentHash,
  type ErrorCode,
  type Seq,
  type ServerMessage,
  type VaultList
} from 'mote-sync-protocol'
import WebSocket from 'ws'

/** What the sync module needs from the sync service, one method per request of the protocol. */
export interface Remote {
  listVaults(): Promise<VaultList>
  changes(since: Seq): Promise<ChangesPage>
  /** A 409 resolves to `{ ok: false, conflict }`, like the protocol's body. */
  commit(item: CommitItem): Promise<CommitResult>
  /** Whether this vault may commit the content without uploading it. */
  head(hash: ContentHash): Promise<boolean>
  putBlob(hash: ContentHash, bytes: Buffer): Promise<void>
  /** Null when the service no longer keeps the content, or never had it. */
  getBlob(hash: ContentHash): Promise<Buffer | null>
  /** Resolves once the socket is open. `onClose` runs once, after a drop or `close()`. */
  openSocket(events: SocketEvents): Promise<RemoteSocket>
}

export interface SocketEvents {
  onMessage(message: ServerMessage): void
  onClose(): void
}

export interface RemoteSocket {
  close(): void
}

export type RemoteConfig = {
  serverUrl: string
  /** Pins https to this one certificate. Without it https trusts the system's authorities. */
  certPem?: string
  token: string
  vaultId: string
}

/**
 * A failed request. `status` is null when no HTTP answer came: the network, TLS or a certificate
 * that is not the pinned one. The sync module goes offline for those and for 5xx, and shows an
 * error for 4xx.
 */
export class RemoteError extends Error {
  readonly status: number | null
  readonly code: ErrorCode | null

  constructor(status: number | null, message: string, code: ErrorCode | null = null) {
    super(message)
    this.name = 'RemoteError'
    this.status = status
    this.code = code
  }
}

export const HEARTBEAT_MS = 30_000
const IDLE_TIMEOUT_MS = 60_000

/** The sync service over HTTP or HTTPS and a WebSocket. https is pinned to `certPem` when one is given. */
export function createRemote(config: RemoteConfig, heartbeatMs = HEARTBEAT_MS): Remote {
  const base = new URL(config.serverUrl)
  const secure = base.protocol === 'https:'
  if (!secure && base.protocol !== 'http:') {
    throw new Error('同步服务地址要以 http:// 或 https:// 开头')
  }
  const tls = secure && config.certPem ? pinned(config.certPem) : {}
  const agent = secure
    ? new https.Agent({ keepAlive: true, ...tls })
    : new http.Agent({ keepAlive: true })
  const vault = `/v1/vaults/${encodeURIComponent(config.vaultId)}`
  const auth = { authorization: `Bearer ${config.token}` }

  function request(
    method: string,
    path: string,
    body?: Buffer,
    type = 'application/json'
  ): Promise<{ status: number; body: Buffer }> {
    const url = new URL(path, base)
    const headers: http.OutgoingHttpHeaders = { ...auth }
    if (body) Object.assign(headers, { 'content-type': type, 'content-length': body.length })
    return new Promise((resolve, reject) => {
      const req = (secure ? https : http).request(
        url,
        { method, headers, agent, ...tls },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
          res.on('error', (error) => reject(new RemoteError(null, error.message)))
        }
      )
      req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error('同步服务没有回应')))
      req.on('error', (error) => reject(new RemoteError(null, error.message)))
      req.end(body)
    })
  }

  async function json(method: string, path: string, value?: unknown, ok = [200]): Promise<unknown> {
    const body = value === undefined ? undefined : Buffer.from(JSON.stringify(value))
    const res = await request(method, path, body)
    if (!ok.includes(res.status)) throw failure(res)
    return JSON.parse(res.body.toString('utf8'))
  }

  return {
    async listVaults() {
      return parseVaultList(await json('GET', '/v1/vaults'))
    },
    async changes(since) {
      return parseChangesPage(await json('GET', `${vault}/changes?since=${since}`))
    },
    async commit(item) {
      return parseCommitResult(await json('POST', `${vault}/changes`, item, [200, 409]))
    },
    async head(hash) {
      const res = await request('HEAD', `${vault}/blobs/${hash}`)
      if (res.status === 200 || res.status === 404) return res.status === 200
      throw failure(res)
    },
    async putBlob(hash, bytes) {
      const res = await request('PUT', `${vault}/blobs/${hash}`, bytes, 'application/octet-stream')
      if (res.status !== 204) throw failure(res)
    },
    async getBlob(hash) {
      const res = await request('GET', `${vault}/blobs/${hash}`)
      if (res.status === 404) return null
      if (res.status !== 200) throw failure(res)
      return res.body
    },
    openSocket(events) {
      const url = new URL('/v1/ws', base)
      url.protocol = secure ? 'wss:' : 'ws:'
      const ws = new WebSocket(url, { headers: auth, ...tls, handshakeTimeout: IDLE_TIMEOUT_MS })
      return new Promise((resolve, reject) => {
        let open = false
        let missed = 0
        let timer: NodeJS.Timeout | undefined
        ws.on('unexpected-response', (_req, res) => {
          reject(new RemoteError(res.statusCode ?? null, `WebSocket 被拒绝：${res.statusCode}`))
          ws.terminate()
        })
        ws.on('error', (error) => {
          if (!open) reject(new RemoteError(null, error.message))
        })
        ws.on('open', () => {
          open = true
          // Two pings without a pong in a row mean the connection is dead.
          timer = setInterval(() => {
            if (missed >= 2) return ws.terminate()
            missed++
            ws.ping()
          }, heartbeatMs)
          resolve({ close: () => ws.terminate() })
        })
        ws.on('pong', () => (missed = 0))
        ws.on('message', (data) => {
          let message: ServerMessage | null
          try {
            message = parseServerMessage(JSON.parse(String(data)))
          } catch {
            return
          }
          if (message) events.onMessage(message)
        })
        ws.on('close', () => {
          clearInterval(timer)
          if (open) events.onClose()
        })
      })
    }
  }
}

/** Trusts only this certificate, and checks its fingerprint instead of the host name, which is an IP. */
export function pinned(certPem: string): Pick<https.AgentOptions, 'ca' | 'checkServerIdentity'> {
  const fingerprint = new X509Certificate(certPem).fingerprint256
  return {
    ca: [certPem],
    checkServerIdentity: (_host: string, cert: PeerCertificate) =>
      cert.fingerprint256 === fingerprint ? undefined : new Error('同步服务的证书指纹不符')
  }
}

function failure(res: { status: number; body: Buffer }): RemoteError {
  let code: ErrorCode | null = null
  let message = `HTTP ${res.status}`
  try {
    const error = (
      JSON.parse(res.body.toString('utf8')) as { error?: { code?: unknown; message?: unknown } }
    ).error
    if (isErrorCode(error?.code)) code = error.code
    if (typeof error?.message === 'string') message = `${message}: ${error.message}`
  } catch {
    // The status is enough.
  }
  return new RemoteError(res.status, message, code)
}
