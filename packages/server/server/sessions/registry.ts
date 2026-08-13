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
 * uses — so a test points it at a temp directory and exercises the real filesystem. It follows the
 * same durability rules that file established (`tags-local-store.ts`):
 *  - writes go to `<file>.tmp` and are then renamed over the target, so a crash mid-write leaves
 *    either the old file or the new one — never a truncated one, which `read()` would otherwise
 *    parse-fail on. That matters more here than it sounds: `read()` is deliberately NOT serialized
 *    against writes (see `enqueue` below), so a concurrent reader can observe a file mid-write —
 *    a truncated read that falls back to `[]` is exactly how a corrupt-looking registry made every
 *    running session `unregistered` at once (session-ref.ts's docstring);
 *  - a corrupt file is never overwritten in place: its bytes are moved aside to `<file>.corrupt-*`
 *    before the next write, so a parse failure degrades to "no sessions" instead of erasing them;
 *  - a mutation that changes nothing (`remove` of an id that was never there) does not write at all.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MANAGED_SESSIONS_FILE } from '../config'
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
  patch(id: string, patch: { label?: string; note?: string; task?: string; endedAt?: string }): Promise<boolean>
}

/**
 * Keep only entries shaped enough to be used safely downstream. `resolveSessionRef` calls
 * `s.id.startsWith(...)` and reads `s.label` on every candidate — a hand-edited file holding, say,
 * `[{"foo":1}]` would otherwise throw a `TypeError` deep in a pure function and take the whole CLI
 * down with it, defeating the "reads never throw" guarantee above. The optional fields are trusted
 * once the three load-bearing ones check out; a malformed one of THOSE drops the whole entry rather
 * than inventing a fake id, cwd or harness for it.
 */
function sanitize(raw: unknown): ManagedSession | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.id !== 'string' || !s.id) return null
  if (typeof s.harness !== 'string' || !s.harness) return null
  if (typeof s.cwd !== 'string' || !s.cwd) return null
  return {
    id: s.id,
    harness: s.harness as ManagedSession['harness'],
    cwd: s.cwd,
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
    ...(typeof s.model === 'string' ? { model: s.model } : {}),
    ...(typeof s.effort === 'string' ? { effort: s.effort } : {}),
    ...(typeof s.label === 'string' ? { label: s.label } : {}),
    ...(typeof s.note === 'string' ? { note: s.note } : {}),
    ...(typeof s.task === 'string' ? { task: s.task } : {}),
    ...(typeof s.endedAt === 'string' ? { endedAt: s.endedAt } : {}),
  }
}

export function createSessionRegistry(file: string): SessionRegistry {
  // One in-process writer. Each write appends to this chain, so read-modify-write sequences run
  // strictly one after another even when several requests land at once.
  let queue: Promise<unknown> = Promise.resolve()
  // Set when a read failed to parse. The bad bytes are still on disk at that point; the NEXT write
  // moves them aside instead of walking straight over them — see `quarantineCorrupt`.
  let corrupt = false

  async function read(): Promise<ManagedSession[]> {
    let text: string
    try {
      text = await readFile(file, 'utf-8')
    } catch {
      corrupt = false
      return [] // absent (first run, or never written to) — an empty registry, not an error
    }
    if (!text.trim()) { corrupt = false; return [] }
    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('managed-sessions.json is not an array')
      corrupt = false
      return parsed.map(sanitize).filter((s): s is ManagedSession => s !== null)
    } catch {
      // Corrupt or hand-mangled JSON. Reading it empty keeps every caller working; the flag makes
      // sure the write that follows quarantines these bytes instead of erasing them.
      corrupt = true
      console.error('[session] ignoring unreadable session registry at', file)
      return []
    }
  }

  /** Move a file that failed to parse out of the way before the write that follows would otherwise
   *  overwrite it. If the rename itself fails, ABORT the write and throw — the bytes we could not
   *  back up are the only record of whatever labels/notes were in there, so failing the request is
   *  strictly better than silently erasing them. `corrupt` stays set, so the next write retries the
   *  quarantine rather than walking over the file. */
  async function quarantineCorrupt(): Promise<void> {
    if (!corrupt) return
    const backup = `${file}.corrupt-${Date.now()}`
    try {
      await rename(file, backup)
    } catch (err) {
      console.error('[session] unreadable registry at', file, 'could not be backed up — write aborted')
      throw new Error(`refusing to overwrite an unreadable session registry at ${file}: ${String(err)}`)
    }
    corrupt = false
    console.error('[session] unreadable registry moved aside; previous contents kept at', backup)
  }

  async function write(list: ManagedSession[]): Promise<void> {
    await quarantineCorrupt()
    await mkdir(dirname(file), { recursive: true })
    // tmp-then-rename: a crash or a concurrent reader mid-write sees either the old file or the
    // complete new one, never a truncated one `read()` would parse-fail on.
    const tmp = `${file}.tmp`
    await writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf-8')
    await rename(tmp, file)
  }

  // Chains `fn` behind whatever is already queued, so its read and write run as one atomic step
  // relative to every other call made through this same function. Kept alive across a rejection —
  // otherwise one failed mutation would wedge every mutation queued after it.
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    read,
    add(session) {
      return enqueue(async () => {
        const list = await read()
        await write([...list.filter(s => s.id !== session.id), session])
      })
    },
    remove(id) {
      return enqueue(async () => {
        const list = await read()
        // Nothing to remove: writing anyway would touch the file (and pointlessly clear a pending
        // corrupt-quarantine) for a no-op.
        if (!list.some(s => s.id === id)) return
        await write(list.filter(s => s.id !== id))
      })
    },
    patch(id, patch) {
      return enqueue(async () => {
        const list = await read()
        const idx = list.findIndex(s => s.id === id)
        if (idx === -1) return false
        list[idx] = { ...list[idx]!, ...patch }
        await write(list)
        return true
      })
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
  patch: { label?: string; note?: string; task?: string; endedAt?: string },
): Promise<boolean> => defaultRegistry.patch(id, patch)
