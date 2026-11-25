import * as http from 'node:http'
import * as https from 'node:https'
import { parseLoginResponse, parseRegistration, type VaultId } from 'mote-sync-protocol'

/** Where the account lives. */
export type AuthTarget = { serverUrl: string }

export type AuthCall =
  | { kind: 'register'; username: string; password: string }
  | { kind: 'login'; username: string; password: string; deviceName: string }
  | { kind: 'recover'; username: string; recoveryCode: string; password: string }

/** What a successful sign-in gives the window. The token goes to the keychain, never to the window. */
export type AuthSession = {
  username: string
  token: string
  vaultId?: VaultId
  /** Registration and a password reset return one. It is shown once and stored nowhere. */
  recoveryCode?: string
}

const TIMEOUT_MS = 30_000

/**
 * Registers, signs in or resets the password, and returns the device token the service issued.
 * The window shows the message; the status code alone decides it, so the English text the
 * service sends never reaches the user.
 */
export async function authenticate(target: AuthTarget, call: AuthCall): Promise<AuthSession> {
  const path =
    call.kind === 'register' ? '/v1/register' : call.kind === 'login' ? '/v1/login' : '/v1/password'
  const body =
    call.kind === 'login'
      ? { username: call.username, password: call.password, deviceName: call.deviceName }
      : call.kind === 'recover'
        ? { username: call.username, recoveryCode: call.recoveryCode, password: call.password }
        : { username: call.username, password: call.password }
  const res = await post(target, path, body)
  if (res.status !== 200 && res.status !== 201) throw new Error(messageFor(call.kind, res.status))
  let value: unknown
  try {
    value = JSON.parse(res.body)
  } catch {
    throw new Error('同步服务回了看不懂的数据')
  }
  try {
    if (call.kind === 'login') {
      const parsed = parseLoginResponse(value)
      return { username: parsed.account.username, token: parsed.token }
    }
    const parsed = parseRegistration(value)
    return {
      username: parsed.account.username,
      token: parsed.token,
      vaultId: parsed.vaultId,
      recoveryCode: parsed.recoveryCode
    }
  } catch {
    throw new Error('同步服务回了看不懂的数据')
  }
}

/** What the window says for one failed sign-in. Keyed on the status, not the service's text. */
function messageFor(kind: AuthCall['kind'], status: number): string {
  if (status === 400 || status === 413) {
    if (kind === 'recover') return '新密码至少 8 位'
    return '用户名 3 到 32 个字母、数字、下划线或短横线，密码至少 8 位'
  }
  if (status === 401) {
    return kind === 'recover' ? '用户名或找回码不对' : '用户名或密码不对'
  }
  if (status === 409) {
    return kind === 'register' ? '这个用户名已经有人用了' : '设备数量已满，先在别的设备上退出登录'
  }
  if (status === 429) {
    return '试的次数太多了，过一会儿再试'
  }
  if (status === 0) return '连不上同步服务'
  return `同步服务回应 HTTP ${status}`
}

function post(
  target: AuthTarget,
  path: string,
  value: unknown
): Promise<{ status: number; body: string }> {
  const base = new URL(target.serverUrl)
  const secure = base.protocol === 'https:'
  if (!secure && base.protocol !== 'http:') {
    throw new Error('同步服务地址要以 http:// 或 https:// 开头')
  }
  const body = Buffer.from(JSON.stringify(value))
  const url = new URL(path, base)
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': body.length }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        )
        res.on('error', (error) => reject(new Error(`连不上同步服务：${error.message}`)))
      }
    )
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('同步服务没有回应')))
    req.on('error', (error) => reject(new Error(`连不上同步服务：${error.message}`)))
    req.end(body)
  })
}
