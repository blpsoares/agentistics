/**
 * share-rules.ts — PURE. Decides what a single central connection may receive.
 *
 * Contract: no I/O, no Mongo, no `preferences`, no `config`. Only @agentistics/core types
 * and helpers. Everything here is unit-tested against fixtures, because a mistake in this
 * file leaks a repository the user believes is hidden.
 *
 * Fail-closed is the rule everywhere: when attribution is uncertain, the session is NOT
 * shared. A privacy control that guesses in the permissive direction is not a control.
 */

import { createHash } from 'node:crypto'
import { NO_REPO_KEY, normalizeGitRemote, emptyStatsCache } from '@agentistics/core'
import type { SessionMeta, WorkflowRun, StatsCache } from '@agentistics/core'

export type RepoKey = string

/**
 * Case- and alias-folded comparison key. `normalizeGitRemote` lowercases the host but
 * PRESERVES path case and does not alias SSH front doors, so the same repo cloned as
 * `git@github.com:Acme/API.git` and as `https://github.com/acme/api` would otherwise produce
 * two keys — two picker rows, two independent rules, and blocking the one the user
 * recognizes leaves the other shared.
 *
 * This folding lives HERE and not in `normalizeGitRemote`, which also keys the Repositories
 * page and tags: changing it there has a blast radius this feature does not need.
 */
export function canonicalRepoKey(key: string): RepoKey {
  const lower = (key ?? '').toLowerCase()
  if (!lower) return ''
  const slash = lower.indexOf('/')
  if (slash <= 0) return lower
  const host = lower.slice(0, slash).replace(/^(ssh|altssh)\./, '')
  return host + lower.slice(slash)
}

/** The stored denylist → a canonical lookup set. Junk is dropped; '' folds to the sentinel
 *  for backward compatibility, but only '__no_repo__' is ever persisted. */
export function normalizeDenied(denied: readonly string[] | null | undefined): Set<RepoKey> {
  const out = new Set<RepoKey>()
  for (const raw of denied ?? []) {
    if (typeof raw !== 'string') continue
    if (raw === NO_REPO_KEY || raw === '') { out.add(NO_REPO_KEY); continue }
    const key = canonicalRepoKey(normalizeGitRemote(raw))
    if (key) out.add(key)
  }
  return out
}

export function hasRestrictions(denied: readonly string[] | null | undefined): boolean {
  return normalizeDenied(denied).size > 0
}

export interface PathRepoIndex {
  /** project_path → the remote it resolves to (canonical). */
  resolved: Map<string, RepoKey>
  /** project_path → every distinct remote ever seen under it, when more than one. */
  conflicts: Map<string, Set<RepoKey>>
}

type ProjectLike = { path: string; gitRemote?: string }

/**
 * Learn path → remote from sessions that carry one AND from ServerProject.gitRemote.
 *
 * The project seed is load-bearing: only the Copilot adapter sets `git_remote` among the
 * non-Claude adapters, and data.ts runs its persisted backfill against the Claude-only
 * session array before the harness merge — so the consolidate store carries every Codex /
 * Gemini / Kimi / agy session with no remote, permanently. A directory used exclusively by a
 * non-Claude harness has no session to learn from; the project record does.
 */
export function buildPathRepoIndex(
  sessions: readonly SessionMeta[],
  projects?: readonly ProjectLike[],
): PathRepoIndex {
  const resolved = new Map<string, RepoKey>()
  const seen = new Map<string, Set<RepoKey>>()

  const observe = (path: string, remote: string | undefined) => {
    if (!path) return
    const key = canonicalRepoKey(normalizeGitRemote(remote))
    if (!key) return
    if (!resolved.has(path)) resolved.set(path, key)
    const set = seen.get(path) ?? new Set<RepoKey>()
    set.add(key)
    seen.set(path, set)
  }

  for (const s of sessions) observe(s.project_path, s.git_remote)
  for (const p of projects ?? []) observe(p.path, p.gitRemote)

  const conflicts = new Map<string, Set<RepoKey>>()
  for (const [path, set] of seen) if (set.size > 1) conflicts.set(path, set)
  return { resolved, conflicts }
}

/** The repo bucket a session belongs to. Never returns ''. */
export function repoKeyOf(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  index?: PathRepoIndex,
): RepoKey {
  // Re-normalizing is idempotent and cheap insurance against a legacy consolidate-store
  // entry written before remotes were normalized.
  const own = canonicalRepoKey(normalizeGitRemote(s.git_remote))
  if (own) return own
  const viaPath = index?.resolved.get(s.project_path)
  if (viaPath) return viaPath
  return NO_REPO_KEY
}

/**
 * A session is shared when its own key is not denied AND — when its directory is known to
 * hold more than one repo — no remote under that directory is denied.
 *
 * `scanProjectDir` stamps one remote on every session of a directory and `getProjectGitStats`
 * even scans one level of subdirectories for workspace folders, so a workspace holding a
 * shared and a blocked repo would otherwise ship the blocked repo's `first_prompt` and
 * `title` under the shared key. Annotating the ambiguity and sharing anyway is a fail-open.
 */
export function sessionShared(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): boolean {
  if (denied.size === 0) return true
  if (denied.has(repoKeyOf(s, index))) return false
  const conflict = index?.conflicts.get(s.project_path)
  if (conflict) for (const key of conflict) if (denied.has(key)) return false
  return true
}

export function filterShared<T extends Pick<SessionMeta, 'git_remote' | 'project_path'>>(
  sessions: readonly T[],
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): T[] {
  if (denied.size === 0) return [...sessions]
  return sessions.filter(s => sessionShared(s, denied, index))
}

/**
 * Sessions the denylist ACTIVELY excludes — the only legitimate removal trigger.
 *
 * Never define this as "in the sent-state but absent from the store": `loadConsolidated()`
 * swallows every error and returns empty, `writeConsolidated` writes non-atomically from the
 * same process, and a container can start before its bind mount is ready. Any of those makes
 * a cycle read short, and an absence-based trigger would then ask the central to delete
 * perfectly valid sessions and drop them from the sent-state — silent, permanent loss.
 */
export function deniedSessionIds(
  sessions: readonly SessionMeta[],
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): Set<string> {
  const out = new Set<string>()
  if (denied.size === 0) return out
  for (const s of sessions) {
    if (s.session_id && !sessionShared(s, denied, index)) out.add(s.session_id)
  }
  return out
}

export function sharedSessionIds(sessions: readonly Pick<SessionMeta, 'session_id'>[]): Set<string> {
  const out = new Set<string>()
  for (const s of sessions) if (s.session_id) out.add(s.session_id)
  return out
}

/**
 * A workflow run has no repo of its own — it is shared iff its owning session is, and a run
 * whose session is unknown is DROPPED. `WorkflowRun` carries `name`, `phases`,
 * `agents[].label` and `totals`, which leak task descriptions and cost.
 */
export function filterSharedWorkflows(
  runs: readonly WorkflowRun[],
  sharedIds: ReadonlySet<string>,
): WorkflowRun[] {
  return runs.filter(r => !!r.sessionId && sharedIds.has(r.sessionId))
}

/**
 * The fail-closed default applied the moment a connection acquires its FIRST restriction.
 *
 * Unresolved is not the same fact as new. The sentinel covers remote-less folders, every
 * non-Claude session whose adapter never sets a remote, and store entries written before
 * remote stamping — all of which carry `project_path`, `first_prompt`, `title` and cost.
 * It is written into the PERSISTED list (never applied as a hidden runtime rule) so the
 * picker can show it pre-blocked and the user can deliberately un-block it.
 */
export function withUnresolvedDenied(denied: readonly string[]): string[] {
  if (denied.length === 0) return []
  return denied.includes(NO_REPO_KEY) ? [...denied] : [...denied, NO_REPO_KEY]
}

/** Stable fingerprint of a denylist — order-, case- and normalization-independent. */
export function denialSignature(denied: readonly string[] | null | undefined): string {
  const keys = [...normalizeDenied(denied)].sort()
  return createHash('sha256').update(keys.join('\n')).digest('hex')
}

export interface ClaudeAccumulator {
  dailyActivity: Map<string, { messageCount: number; sessionCount: number; toolCallCount: number }>
  dailyModel: Map<string, Map<string, number>>
  modelTotals: Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  /** Session START hour (0-23) → count. NOT message hours — see buildSharedStatsCache. */
  hourCounts: Map<number, number>
  totalSessions: number
  totalMessages: number
  /** Earliest ISO start_time seen, '' when none. */
  firstStart: string
}

/**
 * The accumulation core, extracted from data.ts's supplementStatsCache so the supplement path
 * and the connection-scoped build cannot drift apart.
 *
 * @param opts.after      skip days `<= after` (the caller's lastComputedDate watermark)
 * @param opts.claudeOnly drop non-Claude sessions entirely. FALSE for data.ts, which is called
 *                        before the harness merge and therefore only ever sees Claude sessions;
 *                        TRUE for buildSharedStatsCache, which is handed the whole store.
 */
export function accumulateClaudeSessions(
  sessions: readonly SessionMeta[],
  opts?: { after?: string; claudeOnly?: boolean },
): ClaudeAccumulator {
  const after = opts?.after ?? ''
  const claudeOnly = opts?.claudeOnly ?? false

  const acc: ClaudeAccumulator = {
    dailyActivity: new Map(), dailyModel: new Map(), modelTotals: new Map(),
    hourCounts: new Map(), totalSessions: 0, totalMessages: 0, firstStart: '',
  }

  for (const s of sessions) {
    if (!s.start_time) continue
    if (claudeOnly && (s.harness ?? 'claude') !== 'claude') continue
    const day = s.start_time.slice(0, 10)
    if (after && day <= after) continue

    const messages = (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    const da = acc.dailyActivity.get(day) ?? { messageCount: 0, sessionCount: 0, toolCallCount: 0 }
    da.messageCount += messages
    da.sessionCount += 1
    da.toolCallCount += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    acc.dailyActivity.set(day, da)

    acc.totalSessions += 1
    acc.totalMessages += messages
    if (!acc.firstStart || s.start_time < acc.firstStart) acc.firstStart = s.start_time

    // Local clock, like every adapter. Reading a UTC timestamp as local put the peak-usage
    // chart hours off for four harnesses once already.
    const hour = new Date(s.start_time).getHours()
    if (Number.isFinite(hour)) acc.hourCounts.set(hour, (acc.hourCounts.get(hour) ?? 0) + 1)

    const model = s.model
    if (!model || !model.startsWith('claude-')) continue
    const inp = s.input_tokens ?? 0
    const out = s.output_tokens ?? 0
    const cr = s.cache_read_input_tokens ?? 0
    const cw = s.cache_creation_input_tokens ?? 0
    const total = inp + out + cr + cw
    if (total === 0) continue

    const byModel = acc.dailyModel.get(day) ?? new Map<string, number>()
    byModel.set(model, (byModel.get(model) ?? 0) + total)
    acc.dailyModel.set(day, byModel)

    const mt = acc.modelTotals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    mt.input += inp; mt.output += out; mt.cacheRead += cr; mt.cacheWrite += cw
    acc.modelTotals.set(model, mt)
  }

  return acc
}

/**
 * A Claude StatsCache derived ONLY from the sessions passed in. Supplies the from-boundary
 * half of the attribution split (Task 6) and stands alone in tests.
 *
 * Field decisions verified against a real ~/.claude/stats-cache.json, not assumed:
 * - `lastComputedDate: ''` — the field asserts "Claude has already rolled up every day to
 *   here". Claiming a watermark this cache cannot back makes any consumer running the
 *   `day <= lastComputed → skip` guard drop legitimate gap-fill.
 * - `hourCounts` counts SESSIONS BY START HOUR (Σ hourCounts === totalSessions on the real
 *   file), not messages.
 * - `modelUsage[].costUSD` and `.webSearchRequests` stay 0 — the real file stores 0 too, and
 *   every consumer prices via calcCost(). A real number here would make this cache behave
 *   DIFFERENTLY from a real one.
 * - `longestSession` is zeroed: the real field is wall-clock ms including idle, while
 *   `duration_minutes` is active time. Synthesizing it puts incompatible units into
 *   mergeStatsCaches's max. Nothing in web/ reads it.
 */
export function buildSharedStatsCache(
  sessions: readonly SessionMeta[],
  opts?: { version?: number },
): StatsCache {
  const acc = accumulateClaudeSessions(sessions, { claudeOnly: true })
  const out = emptyStatsCache()
  if (opts?.version !== undefined) out.version = opts.version

  out.dailyActivity = [...acc.dailyActivity.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  out.dailyModelTokens = [...acc.dailyModel.entries()]
    .map(([date, byModel]) => ({ date, tokensByModel: Object.fromEntries(byModel) }))
    .sort((a, b) => a.date.localeCompare(b.date))

  for (const [model, t] of acc.modelTotals) {
    out.modelUsage[model] = {
      inputTokens: t.input,
      outputTokens: t.output,
      cacheReadInputTokens: t.cacheRead,
      cacheCreationInputTokens: t.cacheWrite,
      webSearchRequests: 0,
      costUSD: 0,
    }
  }

  out.totalSessions = acc.totalSessions
  out.totalMessages = acc.totalMessages
  out.firstSessionDate = acc.firstStart
  out.hourCounts = Object.fromEntries([...acc.hourCounts.entries()].map(([h, c]) => [String(h), c]))
  return out
}

/**
 * First local day from which the consolidate store is the authority on what happened — the
 * earliest start_time day across ALL stored Claude sessions, shared and denied alike. Days
 * before it cannot be attributed to any repository by anyone, including this machine.
 *
 * '' when the store holds no Claude session: nothing is attributable, and buildSplitStatsCache
 * then refuses rather than shipping an unfiltered cache.
 */
export function attributionBoundary(allStored: readonly SessionMeta[]): string {
  let min = ''
  for (const s of allStored) {
    if (!s.start_time) continue
    if ((s.harness ?? 'claude') !== 'claude') continue
    const day = s.start_time.slice(0, 10)
    if (!min || day < min) min = day
  }
  return min
}

/** Stored sessions strictly before the boundary — the size of the block no rule can filter. */
export function prehistoryCount(allStored: readonly SessionMeta[], boundary: string): number {
  if (!boundary) return 0
  let n = 0
  for (const s of allStored) {
    if (s.start_time && s.start_time.slice(0, 10) < boundary) n++
  }
  return n
}

/** Does any DENIED repo have a stored session before the boundary? Drives the specific
 *  variant of the confirm copy. A false answer is not a proof of absence — it only means the
 *  store holds no such session — which is why the generic copy is always shown too. */
export function deniedTouchesPrehistory(
  allStored: readonly SessionMeta[],
  denied: ReadonlySet<RepoKey>,
  boundary: string,
  index?: PathRepoIndex,
): boolean {
  if (!boundary || denied.size === 0) return false
  for (const s of allStored) {
    if (!s.start_time || s.start_time.slice(0, 10) >= boundary) continue
    if (!sessionShared(s, denied, index)) return true
  }
  return false
}

function sumUsage(sessions: readonly SessionMeta[], from: string) {
  const totals = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>()
  const hours = new Map<number, number>()
  for (const s of sessions) {
    if (!s.start_time || s.start_time.slice(0, 10) < from) continue
    if ((s.harness ?? 'claude') !== 'claude') continue
    const hour = new Date(s.start_time).getHours()
    if (Number.isFinite(hour)) hours.set(hour, (hours.get(hour) ?? 0) + 1)
    const model = s.model
    if (!model || !model.startsWith('claude-')) continue
    const t = totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    t.input += s.input_tokens ?? 0
    t.output += s.output_tokens ?? 0
    t.cacheRead += s.cache_read_input_tokens ?? 0
    t.cacheWrite += s.cache_creation_input_tokens ?? 0
    totals.set(model, t)
  }
  return { totals, hours }
}

/**
 * The cache a RESTRICTED connection pushes.
 *
 * Days `< boundary` are copied verbatim from `real` — the prehistory, which no rule can reach
 * because the transcripts behind it are gone. Days `>= boundary` are rebuilt from `shared`.
 * Date-less fields (modelUsage, hourCounts) have no day dimension in the cache, so their
 * prehistory term is recovered as `real − attributable`, a difference of two exactly-known
 * quantities — never a proration.
 *
 * Returns null when the split cannot be made faithfully; the caller must then push NO
 * statsCache at all. A missing cache is recoverable; a leaked one is not.
 */
export function buildSplitStatsCache(input: {
  real: StatsCache
  allStored: readonly SessionMeta[]
  shared: readonly SessionMeta[]
  boundary: string
}): StatsCache | null {
  const { real, allStored, shared, boundary } = input
  if (!real || !boundary) return null

  const fromShared = buildSharedStatsCache(shared, { version: real.version })
  const out = emptyStatsCache()
  out.version = real.version
  out.lastComputedDate = ''
  out.totalSpeculationTimeSavedMs = real.totalSpeculationTimeSavedMs
  out.firstSessionDate = real.firstSessionDate

  // --- date-dimensioned: copy before, rebuild from ---
  out.dailyActivity = [
    ...real.dailyActivity.filter(d => d.date < boundary),
    ...fromShared.dailyActivity.filter(d => d.date >= boundary),
  ].sort((a, b) => a.date.localeCompare(b.date))

  out.dailyModelTokens = [
    ...real.dailyModelTokens.filter(d => d.date < boundary),
    ...fromShared.dailyModelTokens.filter(d => d.date >= boundary),
  ].sort((a, b) => a.date.localeCompare(b.date))

  // --- totals: derived from the result's own dailyActivity, preserving the real file's
  //     invariant totalSessions === Σ dailyActivity.sessionCount ---
  out.totalSessions = out.dailyActivity.reduce((a, d) => a + d.sessionCount, 0)
  out.totalMessages = out.dailyActivity.reduce((a, d) => a + d.messageCount, 0)

  // --- date-less: real − attributable + shared, clamped at 0 ---
  const attributable = sumUsage(allStored, boundary)
  const kept = sumUsage(shared, boundary)

  const models = new Set([
    ...Object.keys(real.modelUsage),
    ...attributable.totals.keys(),
    ...kept.totals.keys(),
  ])
  for (const model of models) {
    const r = real.modelUsage[model]
    const a = attributable.totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const k = kept.totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const usage = {
      inputTokens: Math.max(0, (r?.inputTokens ?? 0) - a.input) + k.input,
      outputTokens: Math.max(0, (r?.outputTokens ?? 0) - a.output) + k.output,
      cacheReadInputTokens: Math.max(0, (r?.cacheReadInputTokens ?? 0) - a.cacheRead) + k.cacheRead,
      cacheCreationInputTokens: Math.max(0, (r?.cacheCreationInputTokens ?? 0) - a.cacheWrite) + k.cacheWrite,
      webSearchRequests: 0,
      costUSD: 0,
    }
    const any = usage.inputTokens || usage.outputTokens || usage.cacheReadInputTokens || usage.cacheCreationInputTokens
    if (any) out.modelUsage[model] = usage
  }

  const hourKeys = new Set([
    ...Object.keys(real.hourCounts),
    ...[...attributable.hours.keys()].map(String),
    ...[...kept.hours.keys()].map(String),
  ])
  for (const key of hourKeys) {
    const h = Number(key)
    const value = Math.max(0, (real.hourCounts[key] ?? 0) - (attributable.hours.get(h) ?? 0)) + (kept.hours.get(h) ?? 0)
    if (value > 0) out.hourCounts[key] = value
  }

  // --- longestSession names a session; zero it when that session is one we withhold ---
  const sharedIds = sharedSessionIds(shared)
  const storedIds = sharedSessionIds(allStored)
  const named = real.longestSession?.sessionId ?? ''
  out.longestSession = (named && storedIds.has(named) && !sharedIds.has(named))
    ? { sessionId: '', duration: 0, messageCount: 0, timestamp: '' }
    : { ...real.longestSession }

  return out
}
