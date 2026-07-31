import type { SessionMeta } from '@agentistics/core'
import { NO_REPO_KEY, normalizeGitRemote, repoShortName } from '@agentistics/core'
import { canonicalRepoKey, type ShareTarget } from '../../lib/shareRepos'
import type { ConnectionStatusEntry } from './statusTypes'
import type { CardState } from './cardState'

/**
 * repoPanelState.ts — the pure decisions behind `SharedReposPanel.tsx` (Task 11, design doc §9.8).
 *
 * Same seam as `cardState.ts` (Task 10): every decision that is substantive rather than
 * presentational lives here, unit-tested directly, so the component reads as layout over these
 * functions. Nothing here touches the network or React.
 */

// --- the stored denylist -> a canonical Set --------------------------------------------------

/** Mirrors `lib/shareRepos.ts`'s private `normalizeDeniedKeys` (itself a mirror of the server's
 *  `normalizeDenied`) — duplicated rather than imported because it is not part of that module's
 *  public surface. A raw entry that folds to `''` is dropped, never treated as "block everything". */
export function normalizeDenied(raw: readonly string[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const entry of raw ?? []) {
    if (typeof entry !== 'string') continue
    if (entry === NO_REPO_KEY || entry === '') { out.add(NO_REPO_KEY); continue }
    const key = canonicalRepoKey(normalizeGitRemote(entry))
    if (key) out.add(key)
  }
  return out
}

/** A folder that resolves to more than one repository can never be split by the push path — the
 *  server already fails closed on it, so the UI must never offer to "share" it. */
export function isLocked(t: Pick<ShareTarget, 'conflictPaths'>): boolean {
  return t.conflictPaths.length > 0
}

// --- draft construction and mutation ----------------------------------------------------------

/** The edit draft starts from the stored denylist, with every locked key forced in regardless of
 *  whether it was ever explicitly chosen — a folder only becomes ambiguous once two repositories
 *  are seen under it, which can happen after the rule was first saved. */
export function buildInitialDraft(targets: readonly ShareTarget[], deniedRepos: readonly string[]): Set<string> {
  const draft = normalizeDenied(deniedRepos)
  for (const t of targets) if (isLocked(t)) draft.add(t.key)
  return draft
}

/** Toggles one row. A no-op for a locked row — its switch renders disabled, but a stray call
 *  (e.g. a race with `blockAll`) must not silently unlock it either. */
export function toggleTarget(draft: ReadonlySet<string>, target: ShareTarget, nextShared: boolean): Set<string> {
  if (isLocked(target)) return new Set(draft)
  const next = new Set(draft)
  if (nextShared) next.delete(target.key)
  else next.add(target.key)
  return next
}

/** Shares every unlocked repository, including `NO_REPO_KEY` — locked rows stay blocked. */
export function shareAllDraft(targets: readonly ShareTarget[]): Set<string> {
  return new Set(targets.filter(isLocked).map(t => t.key))
}

/** Blocks every repository AND `NO_REPO_KEY` — "block all" is the one action that also hides the
 *  no-repository bucket, so locking the machine down does not leave an unlabeled catch-all open. */
export function blockAllDraft(targets: readonly ShareTarget[]): Set<string> {
  const next = new Set(targets.map(t => t.key))
  next.add(NO_REPO_KEY)
  return next
}

// --- rows that exist only because they are denied, not because they have sessions -------------

/** `targets` (from `buildShareTargets`) only has a row for a denied repository that also has
 *  sessions — a repository denied on THIS connection that currently produces none would simply be
 *  absent. Synthesizes the missing rows so the stale/orphan group can show them. */
export function synthesizeMissingDenied(
  targets: readonly ShareTarget[],
  deniedRepos: readonly string[],
  noRepoLabel: string,
): ShareTarget[] {
  const present = new Set(targets.map(t => t.key))
  const out = [...targets]
  for (const key of normalizeDenied(deniedRepos)) {
    if (present.has(key)) continue
    const isNone = key === NO_REPO_KEY
    out.push({
      key,
      kind: isNone ? 'none' : 'repo',
      name: isNone ? noRepoLabel : repoShortName(key),
      host: isNone ? '' : (key.split('/')[0] ?? key),
      sessions: 0,
      lastActive: '',
      orphan: true,
      conflictPaths: [],
    })
  }
  return out
}

// --- grouping (blocked / shared / stale) -------------------------------------------------------

export interface EffectiveRow {
  target: ShareTarget
  /** Whether the DRAFT denies this row — never the stored list, so an in-progress edit is what
   *  the grouping and counters reflect. */
  denied: boolean
  locked: boolean
}

export function buildRows(targets: readonly ShareTarget[], draftDenied: ReadonlySet<string>): EffectiveRow[] {
  return targets.map(target => ({ target, denied: draftDenied.has(target.key) || isLocked(target), locked: isLocked(target) }))
}

function matchesSearch(t: ShareTarget, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return t.name.toLowerCase().includes(needle) || t.host.toLowerCase().includes(needle)
}

function bySessionsDesc(a: EffectiveRow, b: EffectiveRow): number {
  return b.target.sessions - a.target.sessions || a.target.name.localeCompare(b.target.name)
}

export interface GroupedRows {
  blocked: EffectiveRow[]
  shared: EffectiveRow[]
  stale: EffectiveRow[]
}

/**
 * A row with zero current sessions has nothing to show unless it is denied (then it is a stale
 * rule, never one of the two live groups). A live row is hidden by `search` UNLESS its key is in
 * `keepVisible` — the set of keys the draft currently differs on from the stored list, so a row
 * the user just toggled never vanishes out from under them on the next keystroke.
 */
export function groupRows(rows: readonly EffectiveRow[], search: string, keepVisible: ReadonlySet<string>): GroupedRows {
  const blocked: EffectiveRow[] = []
  const shared: EffectiveRow[] = []
  const stale: EffectiveRow[] = []
  for (const row of rows) {
    if (row.target.sessions === 0) {
      if (row.denied) stale.push(row)
      continue
    }
    if (!matchesSearch(row.target, search) && !keepVisible.has(row.target.key)) continue
    ;(row.denied ? blocked : shared).push(row)
  }
  blocked.sort(bySessionsDesc)
  shared.sort(bySessionsDesc)
  stale.sort(bySessionsDesc)
  return { blocked, shared, stale }
}

// --- the draft diff against the stored list -----------------------------------------------------

export interface DraftDiff {
  /** Keys newly denied by the draft (not in the stored list). */
  added: string[]
  /** Keys newly shared by the draft (were denied in the stored list, no longer are). */
  removed: string[]
}

export function diffDraft(draft: ReadonlySet<string>, stored: ReadonlySet<string>): DraftDiff {
  const added: string[] = []
  const removed: string[] = []
  for (const k of draft) if (!stored.has(k)) added.push(k)
  for (const k of stored) if (!draft.has(k)) removed.push(k)
  return { added, removed }
}

export function isDirty(diff: DraftDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0
}

/** The set a search must never hide a row from — every key the draft disagrees with the stored
 *  list on, in either direction. */
export function keepVisibleKeys(diff: DraftDiff): Set<string> {
  return new Set([...diff.added, ...diff.removed])
}

// --- impact ("Removes {sessions} sessions (~{cost}) from this central.") -----------------------

export interface BlendedRate {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface ApplyImpact {
  sessions: number
  costUSD: number
}

/** The minimal per-session shape `computeApplyImpact` needs — a structural subset of `SessionMeta`
 *  so the test file does not have to construct a full one. */
export type SessionTokens = Pick<
  SessionMeta,
  'git_remote' | 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'
>

/**
 * Counts only sessions in repositories being NEWLY blocked (`diff.added`) — a repository that was
 * already blocked before this edit contributes nothing, it is not being removed by THIS save. The
 * session COUNT comes from `targets` (exact — it already resolves the project-path fallback), but
 * the token sum backing the cost estimate matches sessions by their OWN `git_remote` only, the
 * same conservative rule `hasProvenPrehistory` uses — which is why the copy states the result with
 * a leading `~`: a remote-less session whose repo is known only via its project's remote
 * contributes to the session count but not to the cost estimate.
 */
export function computeApplyImpact(
  sessions: readonly SessionTokens[],
  targets: readonly ShareTarget[],
  diff: DraftDiff,
  rate: BlendedRate,
): ApplyImpact {
  const addedKeys = new Set(diff.added)
  const sessionCount = targets.filter(t => addedKeys.has(t.key)).reduce((sum, t) => sum + t.sessions, 0)
  if (sessionCount <= 0) return { sessions: 0, costUSD: 0 }
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0
  for (const s of sessions) {
    const key = canonicalRepoKey(normalizeGitRemote(s.git_remote ?? ''))
    if (!key || !addedKeys.has(key)) continue
    input += s.input_tokens
    output += s.output_tokens
    cacheRead += s.cache_read_input_tokens ?? 0
    cacheWrite += s.cache_creation_input_tokens ?? 0
  }
  const costUSD =
    (input / 1_000_000) * rate.input +
    (output / 1_000_000) * rate.output +
    (cacheRead / 1_000_000) * rate.cacheRead +
    (cacheWrite / 1_000_000) * rate.cacheWrite
  return { sessions: sessionCount, costUSD }
}

// --- the confirm variant (proven vs generic) ----------------------------------------------------

/**
 * True only when the browser can PROVE a repository being newly blocked has a session before the
 * attribution boundary — a direct `git_remote` match with an earlier `start_time`. This
 * deliberately does not chase the path-fallback resolution `buildShareTargets` uses internally
 * (a remote-less session inferred via its project's remote): the brief's rule is "if you cannot
 * determine it from what the browser has, do not guess", and a direct match is the only case this
 * function can stand behind. A `null`/empty boundary always reports false — "unknowable" can never
 * be treated as "proven".
 */
export function hasProvenPrehistory(
  sessions: readonly Pick<SessionMeta, 'git_remote' | 'start_time'>[],
  diff: DraftDiff,
  boundary: string | null,
): boolean {
  if (!boundary || diff.added.length === 0) return false
  const addedKeys = new Set(diff.added)
  for (const s of sessions) {
    if (!s.start_time || s.start_time >= boundary) continue
    const key = canonicalRepoKey(normalizeGitRemote(s.git_remote ?? ''))
    if (key && addedKeys.has(key)) return true
  }
  return false
}

export type ConfirmVariant = 'generic' | 'proven'

/** `boundary === null` ("unknowable") never selects `'proven'` — proven is a positive claim about
 *  a real gap, and unknowable is not evidence of one. */
export function resolveConfirmVariant(hasProven: boolean, boundary: string | null): ConfirmVariant {
  return boundary !== null && hasProven ? 'proven' : 'generic'
}

// --- the honesty rule: null boundary / null prehistorySessions state no number -------------------

export interface StatsCopyVars {
  boundary: string
  n: number
}

/**
 * `null` means UNKNOWABLE, a different fact from a real `0`/`''`. Returns `null` — meaning "omit
 * the clause" — whenever either input is unknowable, so the caller never interpolates an invented
 * number into `statsNote`/`applyConfirmStats`.
 */
export function statsCopyVars(boundary: string | null, prehistorySessions: number | null): StatsCopyVars | null {
  if (boundary === null || prehistorySessions === null) return null
  return { boundary, n: prehistorySessions }
}

// --- the post-save banner (progress / done / error / queued) -----------------------------------

export type ApplyPhase = 'idle' | 'submitting' | 'waiting' | 'done' | 'error'
export type ApplyBanner = 'progress' | 'done' | 'error' | 'queued' | null

/**
 * While `waiting` (the PATCH itself succeeded, the server's forget/push sequence may still be
 * running), a live `resync` always wins — the progress strip. An unreachable central
 * (`pendingRules`) reports `queued`, NEVER `done`: reporting success on an apply that has not
 * actually reached the central is the worst outcome this feature can produce.
 *
 * Review fix (Important 1): the fall-through is `'progress'`, never `'done'`. `phase` becomes
 * `'waiting'` the instant the PATCH resolves, while `status` is still the PREVIOUS poll's entry —
 * taken BEFORE the PATCH, so `resync === null` and `pendingRules === false` even for an offline
 * central. Returning `'done'` there rendered the green "Rules applied" banner for up to a full
 * poll interval before the truth arrived (and contradicted the card, which renders the orange
 * queued banner from the same stale `status.pendingRules`). Only `SharedReposPanel`'s two effects
 * promote to `'done'`, and both check `pendingRules` first.
 */
export function resolveApplyBanner(phase: ApplyPhase, status: ConnectionStatusEntry | undefined): ApplyBanner {
  if (phase === 'error') return 'error'
  if (phase === 'done') return 'done'
  if (phase !== 'waiting') return null
  if (status?.resync != null) return 'progress'
  if (status?.pendingRules) return 'queued'
  return 'progress'
}

// --- the write guard: the FULL duration of an apply, not just the server-reported half ----------

/**
 * True for the WHOLE apply — the PATCH round-trip (`'submitting'`) AND the gap between the PATCH
 * returning and the server's resync first becoming visible on the next poll (`'waiting'`). Review
 * fix (Important 2): `state === 'resyncing'` alone is a SERVER-reported fact the client only
 * learns about on its next poll tick — it misses both windows above, during which a second write
 * (a re-opened Edit, a Disconnect, a Sync now that races the server's own forget/push sequence) is
 * exactly the double-apply this feature exists to prevent.
 */
export function isApplyBusy(phase: ApplyPhase): boolean {
  return phase === 'submitting' || phase === 'waiting'
}

/** Whether the panel's own Edit may open — excludes a live server resync (`cardState ===
 *  'resyncing'`) AND the full apply window above. A card-level write guard (Disconnect/Sync now)
 *  must derive from `isApplyBusy` too — see `SharedReposPanel.tsx`'s `onBusyChange`. */
export function canEditRepos(cardState: CardState, phase: ApplyPhase): boolean {
  return cardState !== 'resyncing' && !isApplyBusy(phase)
}
