/**
 * memberPillState.ts — the pure aggregate reducer behind `MemberConnectionStatus.tsx` (Task 13).
 *
 * With one central this machine's connection status was always a single object; with several
 * centrals connected (multi-central, Task 8+) that same pill has to summarize N of them without
 * ever hiding the worst one — a central sitting unauthorized behind a green dot is a week of
 * unnoticed drift. `computeMemberPillState` is the whole testable substance; the component stays a
 * fetch (GET /api/team/status) plus a render.
 *
 * Copy comes from `components/team/copy.ts` (`COPY`/`PLURAL_COPY`) — the same table Tasks 9-12
 * already built (`centralsN`, `nReconnecting`, `nUnauthorized`, `nResyncing`, `connected`,
 * `connecting`, `reconnecting`, `unauthorized`, `lastSync` were all already there). Nothing here
 * duplicates a string that table already has.
 */
import { COPY, interpolate } from './team/copy'

/** The minimal per-connection shape this reducer needs — a structural subset of
 *  `ConnectionStatusEntry` (`components/team/statusTypes.ts`) so tests don't have to construct a
 *  full wire object. */
export interface PillConnection {
  lastSuccessAt: number | null
  errKind: 'auth' | 'net' | null
  latencyMs?: number | null
  /** Present (non-null) while a retroactive-removal resync is in flight for this connection. */
  resync?: { phase: 'forget' | 'push'; done: number; total: number } | null
}

export type ConnStatus = 'auth' | 'net' | 'resync' | 'connecting' | 'ok'

/** One connection's own status, worst-detail-first: an auth rejection and a network error are
 *  mutually exclusive by construction (the server sets at most one `errKind`); a connection that
 *  has never completed a first push is `connecting`, distinct from `ok` — it has not proven
 *  anything yet, so it must never render as if it had. */
export function statusOf(c: PillConnection): ConnStatus {
  if (c.errKind === 'auth') return 'auth'
  if (c.errKind === 'net') return 'net'
  if (c.resync) return 'resync'
  if (!c.lastSuccessAt) return 'connecting'
  return 'ok'
}

/** Worst-status-wins precedence: an auth rejection is the one the user must act on (a bad/revoked
 *  token fixes nothing on its own); a network error is next because it is still failing right now;
 *  a resync is self-resolving so it ranks below both; `connecting` (never yet synced) is worse than
 *  `ok` but better than an active failure — grouped with `net` for AGGREGATE display since neither
 *  has proven a successful push. */
const RANK: Record<ConnStatus, number> = { auth: 4, net: 3, resync: 2, connecting: 1, ok: 0 }

function relTime(ts: number, lang: 'pt' | 'en', now: number): string {
  const s = Math.floor((now - ts) / 1000)
  if (s < 5) return lang === 'pt' ? 'agora' : 'now'
  if (s < 60) return lang === 'pt' ? `há ${s}s` : `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return lang === 'pt' ? `há ${m}min` : `${m}min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return lang === 'pt' ? `há ${h}h` : `${h}h ago`
  return lang === 'pt' ? `há ${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d ago`
}

export interface PillState {
  /** A CSS color — the dot background (and, for the single-connection case, the label color too,
   *  exactly as the pre-multi-central pill rendered it). */
  dot: string
  label: string
  sub: string
}

const RED = '#ef4444'
const AMBER = '#f59e0b'
const GREEN = '#22c55e'
const GRAY = 'var(--text-tertiary)'

/** The single-connection case, reproduced byte-for-byte from the pre-multi-central component —
 *  this is "today's exact string" the brief requires never regress. */
function singleConnectionState(c: PillConnection, lang: 'pt' | 'en', now: number): PillState {
  const pt = lang === 'pt'
  const status = statusOf(c)
  if (status === 'auth') {
    return {
      dot: RED,
      label: COPY.unauthorized[lang],
      sub: pt ? 'a central rejeitou o token desta máquina' : 'the central rejected this machine’s token',
    }
  }
  if (status === 'net') {
    return {
      dot: AMBER,
      label: COPY.reconnecting[lang],
      sub: c.lastSuccessAt
        ? (pt ? `sem contato — último envio ${relTime(c.lastSuccessAt, lang, now)}` : `no contact — last sync ${relTime(c.lastSuccessAt, lang, now)}`)
        : (pt ? 'ainda não conectou à central' : 'not connected to the central yet'),
    }
  }
  if (status === 'resync') {
    return {
      dot: AMBER,
      label: pt ? 'Ressincronizando…' : 'Resyncing…',
      sub: pt ? 'aplicando novas regras de repositório' : 'applying new repository rules',
    }
  }
  if (status === 'ok') {
    let sub = interpolate(COPY.lastSync[lang], { t: relTime(c.lastSuccessAt!, lang, now) })
    if (c.latencyMs != null) sub += ` · ${c.latencyMs}ms`
    return { dot: GREEN, label: COPY.connected[lang], sub }
  }
  return { dot: GRAY, label: COPY.connecting[lang], sub: pt ? 'primeiro envio em instantes' : 'first sync shortly' }
}

/**
 * `(connections, lang) → { dot, label, sub }` — the aggregate over every connected central.
 *
 * - Zero connections → `null` (the component renders nothing; this instance is not a member, or
 *   its connections haven't loaded yet).
 * - One connection → exactly `singleConnectionState` (see above): the common case must not regress.
 * - N connections → worst-status-wins (`RANK` above). All ok renders `centralsN`; otherwise the
 *   count is of connections AT the worst rank (an amber dot, per the design: the pill's job is to
 *   say "something needs you," not to grade severity further at a glance — the per-connection
 *   detail lives on `/settings/connection`, which the pill links to).
 */
export function computeMemberPillState(
  connections: readonly PillConnection[],
  lang: 'pt' | 'en',
  now: number = Date.now(),
): PillState | null {
  if (connections.length === 0) return null
  if (connections.length === 1) return singleConnectionState(connections[0]!, lang, now)

  const statuses = connections.map(c => statusOf(c))
  const worstRank = Math.max(...statuses.map(s => RANK[s]))

  if (worstRank === RANK.ok) {
    const latest = Math.max(...connections.map(c => c.lastSuccessAt ?? 0))
    const sub = latest > 0 ? interpolate(COPY.lastSync[lang], { t: relTime(latest, lang, now) }) : ''
    return { dot: GREEN, label: interpolate(COPY.centralsN[lang], { n: connections.length }), sub }
  }

  if (worstRank === RANK.auth) {
    const n = statuses.filter(s => s === 'auth').length
    return { dot: AMBER, label: interpolate(COPY.nUnauthorized[lang], { n }), sub: '' }
  }
  if (worstRank === RANK.resync) {
    const n = statuses.filter(s => s === 'resync').length
    return { dot: AMBER, label: interpolate(COPY.nResyncing[lang], { n }), sub: '' }
  }
  // worstRank is RANK.net or RANK.connecting — both fold into "reconnecting": neither has a
  // successful push in flight right now, and there is no dedicated copy for "connecting" at scale.
  const n = statuses.filter(s => s === 'net' || s === 'connecting').length
  return { dot: AMBER, label: interpolate(COPY.nReconnecting[lang], { n }), sub: '' }
}
