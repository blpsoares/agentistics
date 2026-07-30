/**
 * team-rules.ts — per-connection rules state, the denial-based shrink detector, and the seal
 * ledger. A repository blocked TODAY may already have been pushed YESTERDAY: `share-rules.ts`
 * (Task 3) stops a denied repo's data leaving the machine from now on, but it cannot by itself
 * notice that a central still holds sessions this connection is no longer allowed to share.
 * `planRulesReconcile` is that detector — PURE, and the whole decision. Task 5 performs the
 * actual removal (the journal, the batched `POST /api/team/forget`, the crash replay); this
 * module only computes the plan and persists the seal that makes the computation exact once the
 * denied sessions have crossed into Claude's rollup.
 *
 * Two rules cost real data if inverted, both encoded in `planRulesReconcile`:
 *
 * 1. The trigger is DENIAL, never ABSENCE. `forgetIds` is exactly
 *    `keys(sentHashes) ∩ deniedSessionIds(...)`. An earlier draft read "a sent key no longer in
 *    the shared set" as "the session became denied" — but `loadConsolidated()` swallows every
 *    error and returns empty, the store is written non-atomically from the same process, and a
 *    container can start before its bind mount is ready. That version asks the central to delete
 *    perfectly valid sessions and drops them from the sent-state, so they are never pushed again:
 *    silent, permanent, one-directional data loss, invisible on both ends. As a second belt,
 *    `planRulesReconcile` returns an empty plan whenever `storedSessions.length === 0`.
 * 2. A missing `rulesHash` counts as `denialSignature([])`, never as "changed". Treating
 *    `undefined !== denialSignature([])` as a change would make the entire fleet run a removal
 *    against its central on upgrade day, simultaneously.
 *
 * Why this file's state is its own file, not part of the sent-state or the sync signature: the
 * sync-signature path (`reconcileSyncState` in team-uploader.ts) CLEARS the sent-state on a
 * token rotation or a wiped central. If `rulesHash` and the last shared-id set lived in either of
 * those files, a rotation coinciding with a rules change would erase the evidence of the change:
 * the detector would evaluate against an empty set, the removal would never run, and
 * previously-pushed denied sessions would stay on a central that was never wiped. Keeping this
 * state in its own file means a sync-signature reset and a rules change are independent facts,
 * exactly as they are in reality.
 */

import type { SessionMeta, WorkflowRun, StatsCache } from '@agentistics/core'
import {
  deniedSessionIds, denialSignature, deniedDeltaByDay, advanceSeal, attributionBoundary,
  sharedSessionIds, normalizeDenied, filterShared,
  type PathRepoIndex, type DeniedLedger,
} from './share-rules'
import { teamRulesFile } from './config'
import { safeReadJson } from './utils'
import { writeFile } from 'node:fs/promises'

export interface RulesState {
  rulesHash: string
  sharedIds: string[]
  boundary: string | null
  sealed: DeniedLedger
  pending: DeniedLedger
}

/** The state before any rules have ever been evaluated for a connection. `rulesHash: ''` is the
 *  "missing" sentinel — `planRulesReconcile` treats it as `denialSignature([])`, never as a
 *  change (rule 2 above). `boundary: ''` mirrors `attributionBoundary`'s "nothing rolled up yet"
 *  reading, which is the correct default before a real StatsCache has ever been seen. */
export function emptyRulesState(): RulesState {
  return { rulesHash: '', sharedIds: [], boundary: '', sealed: {}, pending: {} }
}

/** Load this connection's rules state. Anything unreadable (missing file, corrupt JSON, a shape
 *  that doesn't parse) reads as `emptyRulesState()` — never a thrown error, and never a partial
 *  state that could contain fields from an unrelated shape. */
export async function loadRulesState(connId: string): Promise<RulesState> {
  const raw = await safeReadJson<Partial<RulesState>>(teamRulesFile(connId))
  if (!raw || typeof raw !== 'object') return emptyRulesState()
  const empty = emptyRulesState()
  return {
    rulesHash: typeof raw.rulesHash === 'string' ? raw.rulesHash : empty.rulesHash,
    sharedIds: Array.isArray(raw.sharedIds) ? raw.sharedIds.filter((v): v is string => typeof v === 'string') : empty.sharedIds,
    boundary: raw.boundary === null || typeof raw.boundary === 'string' ? raw.boundary : empty.boundary,
    sealed: raw.sealed && typeof raw.sealed === 'object' ? raw.sealed as DeniedLedger : empty.sealed,
    pending: raw.pending && typeof raw.pending === 'object' ? raw.pending as DeniedLedger : empty.pending,
  }
}

/** Persist this connection's rules state. Best-effort, like every sibling per-connection writer
 *  in this codebase (team-uploader.ts's `saveSentState`, `reconcileSyncState`'s sync-file write):
 *  the write is wrapped so an ENOENT/EACCES/ENOSPC on `TEAM_CONN_DIR` (only `migrateTeamStateOnce`
 *  creates it, and ITS failure is already caught-and-warned) never propagates out of this
 *  function. `reconcileRulesFor` in team-uploader.ts awaits this BEFORE `reconcileSyncState` and
 *  `pushOnceDetailed` — an unguarded throw here would take the whole push down with it, turning a
 *  bookkeeping failure into "this connection pushes nothing, every cycle, forever". A failed
 *  write just means the NEXT cycle re-derives the same plan from the same inputs, never a
 *  corrupted or half-written file read back as something else. */
export async function saveRulesState(connId: string, state: RulesState): Promise<void> {
  try {
    await writeFile(teamRulesFile(connId), JSON.stringify(state, null, 2), 'utf-8')
  } catch (err) {
    console.warn(`[team-rules] failed to persist rules state for ${connId}:`, err instanceof Error ? err.message : String(err))
  }
}

export interface RulesPlan {
  /** ids the central holds and may no longer have — the forget payload. Never "absent" ids. */
  forgetIds: string[]
  /** run ids the central holds and may no longer have. NOT `sentRunIds ∖ sharedRunIds` (design
   *  §5.5) — a run whose owning session is merely absent from `storedSessions` this cycle cannot
   *  be known to be denied, so treating its absence as a trigger would repeat rule 1's exact
   *  data-loss hazard for runs. This is a deliberate divergence from the spec text: the cost is
   *  that a run whose owning session has fallen out of the store (not denied, just gone) is
   *  never withdrawn by this mechanism. See the `forgetRuns` computation below. */
  forgetRuns: string[]
  /** what to persist once the plan's removal has been carried out by the caller. */
  next: RulesState
  /** true when the denylist changed since the last persisted state. */
  rulesChanged: boolean
}

/**
 * The whole decision, pure. Computes:
 * - `forgetIds`: sessions this connection previously sent (`sentHashes`) that the CURRENT
 *   denylist now excludes. Never sessions merely absent from `storedSessions`.
 * - `forgetRuns`: workflow runs previously sent (`sentRunIds`) whose owning session is now
 *   denied.
 * - `next`: the rules state to persist once the plan's removal (Task 5) has been carried out —
 *   the fresh rules hash, the current shared-id set, the attribution boundary, and the seal
 *   ledger advanced past whatever day just crossed it.
 * - `rulesChanged`: whether the denylist differs from what was last persisted (rule 2: a missing
 *   `prev.rulesHash` reads as `denialSignature([])`, never as a change).
 */
export function planRulesReconcile(input: {
  deniedRepos: readonly string[] | undefined
  sentHashes: Readonly<Record<string, string>>
  sentRunIds: readonly string[]
  storedSessions: readonly SessionMeta[]
  liveSessions: readonly SessionMeta[]
  workflows: readonly WorkflowRun[]
  index?: PathRepoIndex
  real: StatsCache | null
  prev: RulesState
}): RulesPlan {
  const { deniedRepos, sentHashes, sentRunIds, storedSessions, liveSessions, index, real, prev } = input

  const rulesHash = denialSignature(deniedRepos)
  const prevHash = prev.rulesHash ? prev.rulesHash : denialSignature([])
  const rulesChanged = rulesHash !== prevHash

  // R4 / the second belt: an empty store proves nothing about the denylist. Never derive a
  // forget plan from it, and never advance the seal from data that may simply not have loaded.
  if (storedSessions.length === 0) {
    return { forgetIds: [], forgetRuns: [], next: prev, rulesChanged: false }
  }

  const denied = normalizeDenied(deniedRepos)
  const deniedIds = deniedSessionIds(storedSessions, denied, index)

  // The trigger is DENIAL, never absence (rule 1): intersect what was actually sent with what is
  // actually denied. A sent id that simply isn't in storedSessions this cycle is untouched.
  const forgetIds = Object.keys(sentHashes).filter(id => deniedIds.has(id))

  // Same rule, applied to runs (see the divergence note on `RulesPlan.forgetRuns` above): a run
  // is only forgotten when its OWNING SESSION is actively denied, never merely absent.
  const sentRunSet = new Set(sentRunIds)
  const forgetRuns = input.workflows
    .filter(r => sentRunSet.has(r.runId) && deniedIds.has(r.sessionId))
    .map(r => r.runId)

  // sharedIds (persisted in `next`) describes what THIS CONNECTION currently pushes as session
  // documents, which is the store — `pushOnceDetailed` filters `ctx.storedSessions`, never
  // `liveSessions`, for the session-document half of a push.
  const sharedStored = filterShared(storedSessions, denied, index)
  const sharedIds = [...sharedSessionIds(sharedStored)].sort()

  const boundary = real ? attributionBoundary(real) : null

  // The seal ledger's ONLY consumer is `buildSplitStatsCache`'s subtraction against `real`'s
  // rollup rows, and `real` is supplemented from `liveSessions` — never from `storedSessions`
  // (`pushOnceDetailed`, team-uploader.ts). The two arrays are NOT interchangeable: on a real
  // machine the store can lag or lead the live array (buildSplitStatsCache's own precondition
  // comment cites 5 stored sessions against 12 in the cache for one day), so measuring the delta
  // over the store and subtracting it from a row built from the live array under- or
  // over-subtracts. Under-subtraction lets a denied repo's volume ride out in the aggregate —
  // the exact fail-open the split refuses everywhere else. Hence `liveSessions` here, matching
  // the array `real`/`boundary` are actually about.
  let sealed: DeniedLedger
  let pending: DeniedLedger
  if (real === null) {
    // No real StatsCache this cycle means no watermark to test against — `boundary` is `null`,
    // under which `deniedDeltaByDay`'s day filter never fires, so EVERY day (including a day that
    // is genuine prehistory once a real cache later appears) would be measured into `pending`.
    // That is a permanently wrong seal waiting to happen the first time a real cache shows up
    // (a Codex/Gemini-only machine that later installs Claude). Carry the ledger forward
    // untouched instead of measuring anything this cycle.
    sealed = prev.sealed
    pending = prev.pending
  } else {
    const sharedLive = filterShared(liveSessions, denied, index)
    const fresh = deniedDeltaByDay(liveSessions, sharedLive, boundary)
    ;({ sealed, pending } = advanceSeal(prev, fresh, boundary))
  }

  const next: RulesState = { rulesHash, sharedIds, boundary, sealed, pending }

  return { forgetIds, forgetRuns, next, rulesChanged }
}
