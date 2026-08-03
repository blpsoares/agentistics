import type { ArchiveMode } from '../ArchiveConsentModal'
import { NO_REPO_KEY, repoShortName } from '@agentistics/core'
import type { ConnectionStatusEntry, ElsewhereRepo } from './statusTypes'
import { isApplyBusy, type ApplyPhase } from './repoPanelState'

/**
 * cardState.ts — the pure decisions behind `ConnectionCard.tsx`'s state table (design doc §9.5).
 *
 * Split out of the component (Task 10 follow-up) alongside `statusTypes.ts` and next to
 * `lib/shareRepos.ts` — the same shape of module (pure, no React, unit-tested directly) doing the
 * substantive work behind a UI surface. Kept here rather than inline so Tasks 11–13, which all add
 * to `ConnectionCard`, don't have to grow this logic back out of the component again.
 */

/** Whether this endpoint can be parsed as a URL at all — never throws (same guarantee `hostOf`
 *  makes internally). A connection whose stored endpoint fails this renders the `brokenConn` card
 *  (Disconnect only) instead of trying to derive a host, a status line, or anything else from it. */
export function isBrokenEndpoint(endpoint: string): boolean {
  try {
    new URL(endpoint)
    return false
  } catch {
    return true
  }
}

/** The per-card state table (design doc §9.5) — exported so it can be unit-tested as a pure
 *  function instead of only through rendered DOM assertions. Order encodes priority: a hard
 *  connectivity failure (auth/net) always wins over a softer signal, an active resync is worth
 *  surfacing over a stale "not yet identified", and only once none of those apply does "connected
 *  vs still connecting" get decided from `lastSuccessAt`. */
export type CardState = 'checking' | 'connecting' | 'noIdentity' | 'connected' | 'offline' | 'unauthorized' | 'resyncing'

export function resolveCardState(status: ConnectionStatusEntry | undefined): CardState {
  if (!status) return 'checking'
  if (status.errKind === 'auth') return 'unauthorized'
  if (status.errKind === 'net') return 'offline'
  if (status.resync != null) return 'resyncing'
  if (status.user === '') return 'noIdentity'
  if (status.lastSuccessAt != null) return 'connected'
  return 'connecting'
}

/** The four severities the card can be in — the same vocabulary `StatusDot` already speaks. */
export type CardTone = 'ok' | 'warn' | 'error' | 'unknown'

/**
 * The ONE severity per state. The dot, the border and the informational "i" are all read off it,
 * which is the point: the card used to paint an orange border for `offline` alone, nothing at all
 * for `unauthorized` (a strictly worse state) and nothing for `resyncing` despite it sharing
 * `offline`'s tone — three severities, three unrelated treatments, no rule.
 *
 * `offline` is an `error`, not a `warn`: a central this machine cannot reach is a fault, and the
 * product decision is that a fault shows a RED dot. `resyncing` keeps `warn` because work in
 * progress is not a fault — and the header renders a spinner in its place anyway.
 */
export const TONE: Record<CardState, CardTone> = {
  checking: 'unknown', connecting: 'unknown', noIdentity: 'unknown',
  connected: 'ok', resyncing: 'warn', offline: 'error', unauthorized: 'error',
}

export interface CardStatusStyle {
  tone: CardTone
  /** The dot beside the name — the channel the status travels on. */
  dot: CardTone
  /** The tone of the card's status border, or `null` for none at all. Never a colour the dot does
   *  not also have: the border is a quieter second reading of the SAME severity, never its own
   *  signal. Quiet is the default — only a fault earns one. */
  border: CardTone | null
  /** Whether the card offers the informational affordance that says WHICH central, WHAT state and
   *  what can be done about it. Shown exactly where a border is: it is the answer to "why is this
   *  card red", which the card had no way of giving. */
  info: boolean
}

export function resolveCardStatusStyle(state: CardState): CardStatusStyle {
  const tone = TONE[state]
  const fault = tone === 'error'
  return { tone, dot: tone, border: fault ? tone : null, info: fault }
}

/** What occupies the repo-panel slot for a given card state. Pure and exported so the two rules
 *  that matter most — unauthorized HIDES it, offline keeps it EDITABLE (rules are local) — are
 *  asserted directly rather than only through rendered DOM. */
export type RepoPanelMode = 'hidden' | 'centralTooOld' | 'archiveOff' | 'editable'

export function resolveRepoPanelMode(
  state: CardState,
  centralTooOld: boolean,
  archiveMode: ArchiveMode | null,
): RepoPanelMode {
  if (state === 'unauthorized') return 'hidden'
  if (centralTooOld) return 'centralTooOld'
  if (archiveMode === 'off') return 'archiveOff'
  return 'editable'
}

/** The apply-queued banner ("rules saved, not yet enforced") is never rendered while a resync is
 *  actively running — that state has its own progress strip and would otherwise show two
 *  contradictory messages ("queued" and "in progress") at once. */
export function showsApplyQueuedBanner(state: CardState, pendingRules: boolean | undefined): boolean {
  return Boolean(pendingRules) && state !== 'resyncing'
}

/**
 * The "another machine of yours still sends this" warning. Rendered whenever the machine's own
 * local intersection found something (`server/account-repos.ts`), independently of `pendingRules`
 * and of a running resync: those describe THIS machine's own removal, which finishing changes
 * nothing about a sibling that was never told. Suppressing it during a resync would hide the
 * warning for exactly as long as the user is watching the card.
 */
export function showsElsewhereWarning(elsewhere: ElsewhereRepo[] | undefined): boolean {
  return Array.isArray(elsewhere) && elsewhere.length > 0
}

/** How one still-shared repository reads on the card: a short repo name and the machines still
 *  sending it. `NO_REPO_KEY` is not a remote and has no short name — it gets the caller's supplied
 *  label for the "no linked repository" bucket instead. */
export function elsewhereLine(entry: ElsewhereRepo, noRepoLabel: string): string {
  const name = entry.repo === NO_REPO_KEY ? noRepoLabel : (repoShortName(entry.repo) || entry.repo)
  return `${name} — ${entry.machines.join(', ')}`
}

/**
 * The card's write guard (`Sync now` / `Disconnect`, and via `canEditRepos` the panel's own Edit).
 *
 * Review fix (Important 2): the apply phase is owned by the CARD, which stays mounted while
 * collapsed — it used to live inside the repository panel and be reported upward through an
 * `onBusyChange` effect whose UNMOUNT cleanup fired `onBusyChange(false)`. Collapsing the card
 * unmounts that panel, so the guard fell OPEN during the exact window it exists to cover, and
 * re-expanding remounted the panel at `phase: 'idle'`. That is a fail-open reset of a fail-closed
 * guard: a stuck-busy card is recoverable with a reload, a second apply racing the server's own
 * forget/push sequence is not. Note the signature takes no "panel mounted" input — there is
 * nothing a collapse can change here.
 */
export function resolveWritesDisabled(
  state: CardState,
  syncing: boolean,
  disconnecting: boolean,
  phase: ApplyPhase,
): boolean {
  return state === 'resyncing' || syncing || disconnecting || isApplyBusy(phase)
}

/** The collapsed card's rules pill: how many sources the connection names, and WHICH WAY to read
 *  them. `null` = no pill (no rules at all). */
export interface RulePill {
  /** 'allow' = the count is what IS shared; 'deny' = what is hidden. */
  tone: 'allow' | 'deny'
  count: number
}

/**
 * The pill's polarity comes from `status.shareMode`, never from the field name. `deniedCount` is
 * the LEGACY combined count and carries `allowedCount` in allowlist mode (see the server's
 * `ruleCountsOf`), so reading it as "blocked" unconditionally reported a connection sharing only
 * 3 of 40 repositories as "3 hidden" — the exact inverse of the truth, on the one surface that is
 * visible without expanding the card. `status` absent (never polled) shows no pill: unknown is not
 * "nothing is restricted".
 */
export function resolveRulePill(status: ConnectionStatusEntry | undefined): RulePill | null {
  if (!status) return null
  const allowlist = status.shareMode === 'allowlist'
  const count = allowlist ? (status.allowedCount || status.deniedCount) : status.deniedCount
  if (!count || count <= 0) return null
  return { tone: allowlist ? 'allow' : 'deny', count }
}

export function relTime(iso: string | number, pt: boolean): string {
  const ts = typeof iso === 'number' ? iso : Date.parse(iso)
  const s = Math.floor((Date.now() - ts) / 1000)
  if (!Number.isFinite(s) || s < 5) return pt ? 'agora' : 'now'
  if (s < 60) return pt ? `há ${s}s` : `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return pt ? `há ${m}min` : `${m}min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return pt ? `há ${h}h` : `${h}h ago`
  return pt ? `há ${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d ago`
}
