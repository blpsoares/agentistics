/**
 * registry.ts — the product's own record of the sessions it started.
 *
 * The BACKEND is authoritative about what exists; this file is authoritative about what those
 * sessions MEAN (which harness, which model, the user's label and note). `reconcileSessions` puts
 * the two together, and neither is allowed to delete the other's facts.
 *
 * Reads never throw: a corrupt or absent file yields an empty registry, because a control center
 * that cannot start because of a bad JSON file is worse than one that has forgotten some labels.
 *
 * The store is bound to a path by `createSessionRegistry`, the same shape `createLocalTagStore`
 * uses — so a test points it at a temp directory and exercises the real filesystem.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MANAGED_SESSIONS_FILE } from '../config'
import { safeReadJson } from '../utils'
import type { ManagedSession } from './types'

/**
 * A short, lowercase id that is safe as a tmux session name.
 *
 * tmux parses `.` and `:` as target separators (`session:window.pane`), so an id containing either
 * would make `-t agentop-<id>` address something else — hex from a UUID contains neither.
 */
export function newSessionId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10)
}

export interface SessionRegistry {
  read(): Promise<ManagedSession[]>
  add(session: ManagedSession): Promise<void>
  remove(id: string): Promise<void>
  /** False when no session carries that id — never a silent success. */
  patch(id: string, patch: { label?: string; note?: string }): Promise<boolean>
}

export function createSessionRegistry(file: string): SessionRegistry {
  async function read(): Promise<ManagedSession[]> {
    const raw = await safeReadJson<ManagedSession[]>(file)
    return Array.isArray(raw) ? raw : []
  }

  async function write(list: ManagedSession[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(list, null, 2)}\n`, 'utf-8')
  }

  return {
    read,
    async add(session) {
      const list = await read()
      await write([...list.filter(s => s.id !== session.id), session])
    },
    async remove(id) {
      const list = await read()
      await write(list.filter(s => s.id !== id))
    },
    async patch(id, patch) {
      const list = await read()
      const idx = list.findIndex(s => s.id === id)
      if (idx === -1) return false
      list[idx] = { ...list[idx]!, ...patch }
      await write(list)
      return true
    },
  }
}

/** The registry this machine actually uses. */
const defaultRegistry = createSessionRegistry(MANAGED_SESSIONS_FILE)

export const readRegistry = (): Promise<ManagedSession[]> => defaultRegistry.read()
export const addSession = (s: ManagedSession): Promise<void> => defaultRegistry.add(s)
export const removeSession = (id: string): Promise<void> => defaultRegistry.remove(id)
export const patchSession = (
  id: string,
  patch: { label?: string; note?: string },
): Promise<boolean> => defaultRegistry.patch(id, patch)
