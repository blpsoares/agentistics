/**
 * statusTypes.ts — the web-side shape of `GET /api/team/status`'s per-connection entry.
 *
 * Hand-mirrors `ConnectionStatusEntry` / the `resync` shape in `packages/server/server/
 * team-connections.ts` / `team-forget-client.ts`. The web bundle may never import from
 * `packages/server/*` (Vite would try to bundle Bun/Node APIs), so this tiny wire-shape type is
 * duplicated here rather than shared — the same pattern `lib/shareRepos.ts` documents for
 * `canonicalRepoKey`.
 */

export interface ResyncProgress {
  phase: 'forget' | 'push'
  done: number
  total: number
}

export interface ConnectionStatusEntry {
  id: string
  endpoint: string
  org: string
  user: string
  label?: string
  lastSuccessAt: number | null
  errKind: 'auth' | 'net' | null
  latencyMs: number | null
  /** Size of the stored denylist. NEVER the list itself — that only ever comes from
   *  `GET /api/preferences`, same-origin. */
  deniedCount: number
  restricted: boolean
  /** `null` = unknowable this cycle, distinct from the real `''` ("nothing rolled up yet"). */
  boundary: string | null
  /** `null` = unknowable, distinct from a real `0`. Never coerce one into the other. */
  prehistorySessions: number | null
  canForget: boolean
  centralTooOld: boolean
  resync: ResyncProgress | null
  pendingRules: boolean
}

export interface TeamStatusResponse {
  mode: 'solo' | 'member'
  lastSuccessAt: number | null
  errKind: 'auth' | 'net' | null
  latencyMs: number | null
  connections: ConnectionStatusEntry[]
}
