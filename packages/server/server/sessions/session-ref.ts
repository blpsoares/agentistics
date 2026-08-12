/**
 * session-ref.ts — PURE. Naming a session, and agreeing on which sessions exist.
 *
 * Both answers are ambiguity-averse on purpose. `resolveSessionRef` refuses rather than picking
 * when two sessions could be meant, because the verbs it feeds (`attach`, `kill`) are not the place
 * to be lucky. `reconcileSessions` never DROPS anything either side reported: a registry entry with
 * no backend is `lost` (the tmux server was restarted) and a backend session with no registry entry
 * is `unregistered` (this build's registry was cleared, or another one started it) — both are facts
 * the user needs, and silently omitting one is how a session becomes unkillable.
 */

import type { BackendSession, ManagedSession } from './types'

export type RefResult =
  | { ok: true; session: ManagedSession }
  | { ok: false; reason: 'not-found' | 'ambiguous'; matches: string[] }

export interface ReconciledSession {
  id: string
  managed?: ManagedSession
  backend?: BackendSession
  /**
   * `running`  — the backend hosts it and its command is alive.
   * `exited`   — the backend still holds it, but the command finished. Its output is readable.
   * `lost`     — the registry knows it, the backend does not.
   * `unregistered` — the backend hosts it, the registry does not know it.
   */
  status: 'running' | 'exited' | 'lost' | 'unregistered'
}

/** Resolve a user-typed reference: exact id, then exact label (case-insensitive), then id prefix. */
export function resolveSessionRef(list: ManagedSession[], ref: string): RefResult {
  const exact = list.find(s => s.id === ref)
  if (exact) return { ok: true, session: exact }

  const needle = ref.trim().toLowerCase()

  const byLabel = list.filter(s => (s.label ?? '').trim().toLowerCase() === needle && needle !== '')
  if (byLabel.length === 1) return { ok: true, session: byLabel[0]! }
  if (byLabel.length > 1) return { ok: false, reason: 'ambiguous', matches: byLabel.map(s => s.id) }

  const byPrefix = list.filter(s => s.id.startsWith(ref) && ref !== '')
  if (byPrefix.length === 1) return { ok: true, session: byPrefix[0]! }
  if (byPrefix.length > 1) return { ok: false, reason: 'ambiguous', matches: byPrefix.map(s => s.id) }

  return { ok: false, reason: 'not-found', matches: [] }
}

/** Merge what the registry believes with what the backend reports. Neither side is dropped. */
export function reconcileSessions(
  registry: ManagedSession[],
  backend: BackendSession[],
): ReconciledSession[] {
  const byId = new Map(backend.map(b => [b.id, b]))
  const out: ReconciledSession[] = []
  const seen = new Set<string>()

  for (const managed of registry) {
    seen.add(managed.id)
    const found = byId.get(managed.id)
    if (!found) { out.push({ id: managed.id, managed, status: 'lost' }); continue }
    out.push({ id: managed.id, managed, backend: found, status: found.alive ? 'running' : 'exited' })
  }

  for (const b of backend) {
    if (seen.has(b.id)) continue
    out.push({ id: b.id, backend: b, status: 'unregistered' })
  }

  return out
}
