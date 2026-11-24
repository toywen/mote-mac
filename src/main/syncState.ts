import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ContentHash, Seq } from 'mote-sync-protocol'

/**
 * One file as this device last synced it: the bytes it had (null once deleted) and the vault seq
 * that change got. `hash` is the sync base for a merge.
 */
export type FileState = { hash: ContentHash | null; seq: Seq }

/**
 * The sync state table of one vault. `seq` is the cursor for `GET changes?since=`: every change
 * up to it is applied here. A table for another server counts as no table.
 */
export type SyncState = { serverUrl: string; seq: Seq; files: Record<string, FileState> }

export function emptyState(serverUrl: string): SyncState {
  return { serverUrl, seq: 0 as Seq, files: {} }
}

export function stateFile(stateDir: string, vaultId: string): string {
  return join(stateDir, `${vaultId}.json`)
}

/** Reads the table. A missing, unreadable or foreign one gives an empty table: a first sync. */
export async function loadState(file: string, serverUrl: string): Promise<SyncState> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return emptyState(serverUrl)
  }
  const state = value as Partial<SyncState> | null
  if (
    !state ||
    state.serverUrl !== serverUrl ||
    !Number.isSafeInteger(state.seq) ||
    typeof state.files !== 'object' ||
    state.files === null
  ) {
    return emptyState(serverUrl)
  }
  return { serverUrl, seq: state.seq as Seq, files: state.files }
}

/** Writes a temporary file and renames it over the table, so a crash leaves the old table or the new one. */
export async function saveState(file: string, state: SyncState): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(state))
  await rename(tmp, file)
}
