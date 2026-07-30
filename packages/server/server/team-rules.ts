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
  type PathRepoIndex, type DeniedLedger, type RepoKey,
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

/**
 * The seal ledger half of the reconcile, on its own and PURE — no disk, no persistence decision.
 *
 * Extracted so the periodic cycle (`planRulesReconcile`, which persists the result) and the
 * manual push (`guardedManualPush` in team-uploader.ts, which does NOT) derive the seal through
 * the SAME arithmetic. Two callers computing seals two different ways is precisely the class of
 * drift this branch spent its review cycles fixing; the difference between them must be only
 * whether the result is written down.
 *
 * The seal ledger's ONLY consumer is `buildSplitStatsCache`'s subtraction against `real`'s rollup
 * rows, and `real` is supplemented from `liveSessions` — never from `storedSessions`
 * (`pushOnceDetailed`, team-uploader.ts). The two arrays are NOT interchangeable: on a real
 * machine the store can lag or lead the live array (buildSplitStatsCache's own precondition
 * comment cites 5 stored sessions against 12 in the cache for one day), so measuring the delta
 * over the store and subtracting it from a row built from the live array under- or
 * over-subtracts. Under-subtraction lets a denied repo's volume ride out in the aggregate — the
 * exact fail-open the split refuses everywhere else. Hence `liveSessions` here, matching the
 * array `real`/`boundary` are actually about.
 */
export function computeLedger(input: {
  liveSessions: readonly SessionMeta[]
  denied: ReadonlySet<RepoKey>
  index?: PathRepoIndex
  real: StatsCache | null
  prev: { sealed: DeniedLedger; pending: DeniedLedger }
}): { sealed: DeniedLedger; pending: DeniedLedger; boundary: string | null } {
  const { liveSessions, denied, index, real, prev } = input
  const boundary = real ? attributionBoundary(real) : null
  if (real === null) {
    // No real StatsCache this cycle means no watermark to test against — `boundary` is `null`,
    // under which `deniedDeltaByDay`'s day filter never fires, so EVERY day (including a day that
    // is genuine prehistory once a real cache later appears) would be measured into `pending`.
    // That is a permanently wrong seal waiting to happen the first time a real cache shows up
    // (a Codex/Gemini-only machine that later installs Claude). Carry the ledger forward
    // untouched instead of measuring anything this cycle.
    return { sealed: prev.sealed, pending: prev.pending, boundary }
  }
  const sharedLive = filterShared(liveSessions, denied, index)
  const fresh = deniedDeltaByDay(liveSessions, sharedLive, boundary)
  return { ...advanceSeal(prev, fresh, boundary), boundary }
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

  const denied = normalizeDenied(deniedRepos)
  // The ledger half, shared verbatim with the manual-push path — see `computeLedger`.
  const { sealed, pending, boundary } = computeLedger({ liveSessions, denied, index, real, prev })

  // R4 / the second belt: an empty store proves nothing about the denylist. Never derive a
  // FORGET PLAN from it — that is rule 1's data-loss hazard, and it stays gated here.
  //
  // The LEDGER is not gated: it is measured from `liveSessions` and needs neither the store nor
  // `forgetIds`. `archiveMode: 'off'` is a supported, documented mode in which
  // `loadConsolidated()` is permanently empty while the live array is complete, so gating the
  // ledger on the store meant that on such a machine `pending` never filled and `sealed` never
  // advanced — every denied day then ships verbatim inside the rollup the moment it crosses the
  // watermark, permanently, and no cycle can ever recover it (`advanceSeal`'s caller contract).
  if (storedSessions.length === 0) {
    // The rules hash may advance ONLY when nothing could be stranded. An empty sent-state proves
    // this connection holds no session document on the central that a later, non-empty store read
    // could reveal as denied — which is exactly the archiveMode: 'off' machine (it pushes the
    // store, so it pushes no session documents at all), and without advancing the hash there the
    // status route reports `pendingRules: true` forever on a machine whose rules ARE enforced.
    // With a NON-empty sent-state the hash must stay as it was: advancing it would suppress
    // re-detection while the central still holds data this cycle could not classify — rule 1's
    // hazard in reverse.
    const nothingStranded = Object.keys(sentHashes).length === 0
    return {
      forgetIds: [],
      forgetRuns: [],
      next: {
        rulesHash: nothingStranded ? rulesHash : prev.rulesHash,
        sharedIds: nothingStranded ? [] : prev.sharedIds,
        boundary, sealed, pending,
      },
      rulesChanged: false,
    }
  }

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

  const next: RulesState = { rulesHash, sharedIds, boundary, sealed, pending }

  return { forgetIds, forgetRuns, next, rulesChanged }
}
