import type { SyncStatusView } from '../../core/ipc'

function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** One line for the sidebar. The state is the first thing to read, so it leads. */
export function syncStatusText(status: SyncStatusView | null): string {
  if (!status || status.state === 'unset') return '同步：未配置'
  switch (status.state) {
    case 'idle':
      return status.lastSyncAt ? `同步：已同步 ${clock(status.lastSyncAt)}` : '同步：已同步'
    case 'syncing':
      return status.pending > 0 ? `同步：${status.pending} 个文件` : '同步：同步中'
    case 'offline':
      return '同步：离线'
    case 'error':
      return '同步：出错'
    case 'blocked':
      return '同步：待确认删除'
  }
}

/** The sentence behind the status, for the tooltip and the panel. */
export function syncStatusDetail(status: SyncStatusView | null): string {
  if (!status) return ''
  if (status.state === 'blocked') {
    return status.lastError ?? '另一台设备删除了文件，确认后才会同步删除'
  }
  return status.lastError ?? ''
}
