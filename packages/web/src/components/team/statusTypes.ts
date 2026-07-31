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
  /** 'denylist' (share everything except the sources below) | 'allowlist' (share only them).
   *  Never absent on the wire — the server's `ruleCountsOf` defaults absent/junk to 'denylist'. */
  shareMode: 'denylist' | 'allowlist'
  /** Denylist-mode counts (repo+none sources, project sources). Always 0 in allowlist mode — see
   *  `allowedCount` there instead. NEVER the values themselves — those only ever come from
   *  `GET /api/preferences`, same-origin. */
  deniedRepos: number
  deniedProjects: number
  /** Allowlist-mode count of everything listed. Always 0 in denylist mode. */
  allowedCount: number
  /** LEGACY, kept for older UI paths: `deniedRepos + deniedProjects` in denylist mode,
   *  `allowedCount` in allowlist mode. */
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
  /** Machine-wide, never per-connection — OTel export (`OTEL_EXPORTER_OTLP_ENDPOINT`) sends this
   *  machine's unfiltered totals regardless of which central a session belongs to. Mirrors
   *  `otelExportEnabled()` in `team-connections.ts`. */
  otelExportEnabled: boolean
  connections: ConnectionStatusEntry[]
}
