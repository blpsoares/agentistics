/**
 * team-forget-client.ts — the MEMBER side of retroactive removal: the journalled, batched
 * `POST /api/team/forget` sequence that actually deletes, from one central, the sessions this
 * connection's denylist no longer allows it to share.
 *
 * `share-rules.ts` (Task 3) stops a denied repository leaving the machine from now on and
 * `team-rules.ts` (Task 4) computes WHICH already-pushed sessions a central must be asked to
 * forget. This module is the part that removes data on a remote machine — the riskiest piece of
 * the feature, because getting the ordering wrong loses data in a way nothing else will notice.
 *
 * ---------------------------------------------------------------------------
 * The five steps (§6.1). The ORDER is the design; do not reorder it.
 * ---------------------------------------------------------------------------
 *
 *   0. capability + identity: `connectionCanForget(conn.id)` AND `GET /api/team/whoami` == ok
 *   1. ids from the plan (already computed by Task 4 as `deniedSessionIds ∩ sent`)
 *   2. write the journal FIRST
 *   3. POST /api/team/forget in batches of 500, Bearer <token>
 *      → require 200 AND body.ok === true; drop each ACKED batch from the sent-state
 *   4. push the rebuilt split statsCache in the SAME cycle
 *   5. delete the journal; the caller then writes the sync + rules files
 *
 * - **whoami BEFORE the forget.** The sibling `handleTeamLeave` on the central has two branches —
 *   one deletes by `memberId`, the other by `{org, user}` — and BOTH return `{ok:true,deleted:N}`,
 *   so a member cannot tell from the response which identity the central acted on. On a central
 *   whose DB was wiped or restored, one machine's rules change could delete every machine
 *   belonging to the same person. `GET /api/team/whoami` is minted-token-only, so an `ok`
 *   immediately before the call is the member-side proof of which identity will act. Anything
 *   else aborts with `pendingRules: true` — and writes no journal, because nothing was promised.
 * - **Assert on the BODY, not on `res.ok`.** `/api/*` is excluded from the SPA fallback so a
 *   central without the route returns a JSON 404 — but a reverse proxy in front of a central can
 *   turn that into a 200 HTML page, which the journal would happily record as a successful delete.
 * - **Journal BEFORE the first batch.** A process dying mid-sequence leaves some ids deleted and
 *   some not, and nothing else would ever notice: the sync signature did not change, so no
 *   re-push is triggered. `startUploader()` replays the journal at boot.
 * - **Advance the sent-state per ACK, never up front.** An id dropped from the sent-state before
 *   the central confirmed its deletion would be re-pushed by the next delta pass and silently
 *   restored. Advancing only on the ack makes an interrupted sequence resumable instead of
 *   self-defeating.
 * - **The per-connection push lock is held across the whole sequence** — that is the CALLER's
 *   job and it is why this function is only ever invoked from inside `runConnectionPushCycle`,
 *   under `runConnectionCycle`'s `_running` guard with `pendingTrigger` deferral. Without it, a
 *   `notifyDataChanged`-debounced push already in flight can land AFTER the delete and re-insert
 *   exactly the documents just removed — and since they are no longer in the sent-state, nothing
 *   would ever remove them again (R27, the worst race in the design).
 * - **401/403 → mark the connection auth-failed (`markAuthFailed`), never widen the delete, and
 *   never remove the connection.** The sequence stops WHERE IT IS — the remaining ids stay in the
 *   sent-state and the journal stays open — and the caller (`runConnectionPushCycle`) must not
 *   attempt any further request against this connection for the rest of THIS cycle either
 *   (`ForgetOutcome.authRejected`). A single rejected request used to remove the connection and
 *   its `deniedRepos` outright — worse than the sibling incident in the plain push cycle, because
 *   this path fires exactly when the user just changed their privacy rules, destroying them at the
 *   moment they matter most. The sequence is already journal-resumable and idempotent, so aborting
 *   and retrying on a later cycle (once the central accepts the token again) is exactly the
 *   behavior it is designed for — nothing here needs to become durable beyond the mark itself.
 *
 * Nothing about the denylist goes on the wire: the only outbound body is `{ sessionIds }`.
 * Workflow runs are NOT named separately — the central deletes a session's runs along with the
 * session (`deleteMemberWorkflowsBySession`, team-forget.ts), so `forgetRuns` is bookkeeping:
 * those run ids leave the sent-state once every batch has been acked.
 */

import { writeFile, unlink } from 'node:fs/promises'
import type { TeamConnection } from '@agentistics/core'
import { teamForgetFile, teamSentFile } from './config'
import { safeReadJson } from './utils'
import { convertSentStateV1, type SentStateV2 } from './team-migrate'

/** The on-disk journal. `state` is a literal so a future second state cannot be replayed as this
 *  one by accident — `decideJournalResume` refuses anything it does not know. */
export interface ForgetJournal {
  state: 'forgetting'
  ids: string[]
  runIds: string[]
  rulesHash: string
  startedAt: string
}

/** The central's own per-request cap (`MAX_FORGET_IDS`, team-forget.ts). A bigger body is
 *  rejected with a 400 there, which would make the sequence stall rather than truncate — the
 *  member is the side that batches. */
export const FORGET_BATCH_SIZE = 500

/** Every forget/whoami request carries a timeout, for the same reason the ingest fetch does: a
 *  wedged proxy can accept the connection and never answer, and this sequence holds the
 *  per-connection push lock while it runs. */
const FORGET_TIMEOUT_MS = 15_000

export interface ForgetProgress {
  phase: 'forget' | 'push'
  done: number
  total: number
}

/** Narrower than `typeof fetch` on purpose: the extra statics Bun hangs off the global (e.g.
 *  `preconnect`) are irrelevant here and would force every test stub to be cast. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface ForgetDeps {
  /** Injected so the whole sequence is testable without a central. */
  fetch?: FetchLike
  /** The raw (v2) sent-state document for a connection. Read-modify-write, same as
   *  team-uploader.ts's own `saveSentState` — the two never run concurrently for one connection
   *  because both sit under that connection's `_running` lock. */
  loadSentState?: (connId: string) => Promise<SentStateV2>
  saveSentState?: (connId: string, state: SentStateV2) => Promise<void>
  /** The journal path, injectable so a test never writes into the real state directory. */
  journalFile?: (connId: string) => string
  /** Whether this connection's central advertised `forget.sessions`. Defaults to the uploader's
   *  learned capability map (dynamic import — team-uploader.ts imports THIS module). */
  canForget?: (connId: string) => boolean | Promise<boolean>
  /** What a 401/403 means: the central is (currently) rejecting this token. Defaults to marking
   *  the connection auth-failed (`markAuthFailed` in team-uploader.ts) — never to removing it. The
   *  name is kept ("revoked") for the event this represents, not the action taken. */
  onRevoked?: (connId: string, reason: 'revoked') => Promise<void>
  /** Step 4 — pushing the rebuilt split statsCache in the SAME cycle. Resolves `true` when the
   *  push landed; the journal is deleted only then (§6.3: "the journal stays open until a cache
   *  push succeeds"). Omitted means the caller takes no responsibility for the push, and the
   *  journal closes as soon as every batch is acked. */
  pushRebuiltCache?: () => Promise<boolean>
  onProgress?: (p: ForgetProgress) => void
  timeoutMs?: number
  now?: () => number
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
}

export interface ForgetPlan {
  forgetIds: string[]
  forgetRuns: string[]
  rulesHash: string
}

export interface ForgetOutcome {
  ok: boolean
  /** How many documents the central acknowledged deleting (its own `deleted` counts, summed).
   *  Replaying an already-deleted id legitimately reports 0 — that is what makes the journal
   *  safely replayable, not a sign the removal failed. */
  deleted: number
  error?: string
  /** The connection's rules are declared but NOT yet enforced on this central — Task 6's status
   *  route reports this so the UI can never show success while the central still holds the data.
   *  Also true on the revoke path now: the connection is kept (only marked auth-failed), so its
   *  rules genuinely remain unenforced until a later cycle's retry succeeds. */
  pendingRules?: boolean
  /** True when the sequence stopped because the central rejected the token (401/403) — the
   *  caller (`runConnectionPushCycle`) must not attempt any further request for this connection
   *  this cycle (no fallback push either), since the token is currently no good. */
  authRejected?: boolean
}

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

/** Pure: split into ≤`size`-id batches, order preserved. */
export function planForgetBatches(ids: readonly string[], size: number = FORGET_BATCH_SIZE): string[][] {
  const step = Math.max(1, Math.floor(size))
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += step) out.push(ids.slice(i, i + step))
  return out
}

/**
 * Pure: what a journal found at boot means. Total — any shape this module did not write reads as
 * "do not resume", never as an empty delete and never as a throw. An unknown `state` is refused
 * on purpose: a later version adding a second state must not have its journals replayed as
 * deletes by an older build.
 */
export function decideJournalResume(raw: unknown): { resume: true; journal: ForgetJournal } | { resume: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { resume: false }
  const j = raw as Partial<ForgetJournal>
  if (j.state !== 'forgetting') return { resume: false }
  if (!Array.isArray(j.ids) || !Array.isArray(j.runIds)) return { resume: false }
  const ids = j.ids.filter((v): v is string => typeof v === 'string' && v !== '')
  const runIds = j.runIds.filter((v): v is string => typeof v === 'string' && v !== '')
  if (ids.length === 0 && runIds.length === 0) return { resume: false }
  return {
    resume: true,
    journal: {
      state: 'forgetting',
      ids,
      runIds,
      rulesHash: typeof j.rulesHash === 'string' ? j.rulesHash : '',
      startedAt: typeof j.startedAt === 'string' ? j.startedAt : '',
    },
  }
}

/** Order-preserving dedupe — the central rejects nothing for duplicates, but a duplicate id
 *  inflates the batch count and the progress total for no reason. */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

async function defaultLoadSentState(connId: string): Promise<SentStateV2> {
  const raw = await safeReadJson<unknown>(teamSentFile(connId))
  return convertSentStateV1(raw) ?? { version: 2, hashes: {}, runIds: [] }
}

async function defaultSaveSentState(connId: string, state: SentStateV2): Promise<void> {
  await writeFile(teamSentFile(connId), JSON.stringify(state, null, 2), 'utf-8')
}

/** Read this connection's open journal, if any. `null` for absent, corrupt or unresumable —
 *  used by the boot replay and (Task 6) by the status route's `pendingRules`. */
export async function loadForgetJournal(
  connId: string,
  deps: { journalFile?: (connId: string) => string } = {},
): Promise<ForgetJournal | null> {
  const raw = await safeReadJson<unknown>((deps.journalFile ?? teamForgetFile)(connId))
  const decision = decideJournalResume(raw)
  return decision.resume ? decision.journal : null
}

/** Parse a response body without ever throwing — an HTML page from a proxy is `null`, which the
 *  caller treats as "not acknowledged". */
async function readJsonBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await res.json() as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * The sequence. Returns how many ids the central acknowledged deleting.
 *
 * MUST be called with this connection's push lock held (see the module doc). Never throws: every
 * failure is a `{ ok: false, error }` with the journal left open for the next cycle to resume.
 */
export async function runForgetSequence(
  conn: TeamConnection,
  plan: ForgetPlan,
  deps: ForgetDeps = {},
): Promise<ForgetOutcome> {
  const ids = dedupe(plan.forgetIds)
  const runIds = dedupe(plan.forgetRuns)
  if (ids.length === 0 && runIds.length === 0) return { ok: true, deleted: 0 }

  // A plan naming ONLY workflow runs cannot be carried out, and must never look as if it was. The
  // wire carries `sessionIds` and the central deletes runs BY SESSION, so with no session id there
  // is no request that withdraws anything. Reporting `ok` here would drop those run ids from the
  // sent-state — the machine's only record of what it pushed — leaving denied runs on the central
  // with nothing left able to name them, while the caller persisted the rules hash and stopped
  // asking: exactly the outcome this feature exists to prevent. So: keep them named, make no
  // request, and stay `pendingRules` so the UI says the rules are not enforced yet.
  if (ids.length === 0) {
    return {
      ok: false,
      deleted: 0,
      pendingRules: true,
      error: 'workflow runs can only be withdrawn together with their session, and none was named',
    }
  }

  const _fetch = deps.fetch ?? fetch
  const _load = deps.loadSentState ?? defaultLoadSentState
  const _save = deps.saveSentState ?? defaultSaveSentState
  const journalPath = (deps.journalFile ?? teamForgetFile)(conn.id)
  const timeoutMs = deps.timeoutMs ?? FORGET_TIMEOUT_MS
  const log = deps.log ?? console
  const endpoint = conn.endpoint.replace(/\/+$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (conn.token) headers['Authorization'] = `Bearer ${conn.token}`

  const revoke = async (): Promise<void> => {
    const onRevoked = deps.onRevoked ?? (async (_id: string) => {
      // Mark, never remove — see the class docstring above. `markAuthFailed` is idempotent and
      // safe to call with no sustained-failure history: a rejection seen mid-forget-sequence is
      // already a real, confirmed rejection (not a guess extrapolated from push-cycle timing), so
      // there is nothing to wait out here.
      const { markAuthFailed } = await import('./team-uploader')
      await markAuthFailed(conn)
    })
    try {
      await onRevoked(conn.id, 'revoked')
    } catch (err) {
      log.warn(`[team-forget-client] ${conn.id} revoke handling failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ---- Step 0a: capability. No fallback to a broader primitive — emptying a machine's history
  // to withdraw a handful of sessions is not an acceptable substitute for a delete the central
  // cannot perform (§6.3).
  const _canForget = deps.canForget ?? (async (id: string) => {
    const { connectionCanForget } = await import('./team-uploader')
    return connectionCanForget(id)
  })
  if (!(await _canForget(conn.id))) {
    return { ok: false, deleted: 0, pendingRules: true, error: 'central does not advertise forget.sessions' }
  }

  // ---- Step 0b: identity. Nothing is written and nothing is deleted until the central has
  // proven WHICH identity it would act on.
  try {
    const res = await _fetch(`${endpoint}/api/team/whoami`, {
      method: 'GET',
      headers: conn.token ? { Authorization: `Bearer ${conn.token}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 401 || res.status === 403) {
      await revoke()
      return { ok: false, deleted: 0, pendingRules: true, authRejected: true, error: `whoami rejected (${res.status})` }
    }
    const body = res.ok ? await readJsonBody(res) : null
    if (!body || body.ok !== true || typeof body.user !== 'string' || body.user === '') {
      return { ok: false, deleted: 0, pendingRules: true, error: 'whoami did not prove the acting identity' }
    }
  } catch (err) {
    return { ok: false, deleted: 0, pendingRules: true, error: err instanceof Error ? err.message : String(err) }
  }

  // ---- Step 2: the journal, BEFORE the first batch. A failed write aborts the sequence: without
  // the journal a crash mid-removal is unrecoverable, so deleting anyway would trade a retryable
  // failure for a silent, permanent inconsistency.
  const journal: ForgetJournal = {
    state: 'forgetting',
    ids,
    runIds,
    rulesHash: plan.rulesHash,
    startedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
  }
  try {
    await writeFile(journalPath, JSON.stringify(journal, null, 2), 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn(`[team-forget-client] ${conn.id} could not write the removal journal — nothing deleted: ${msg}`)
    return { ok: false, deleted: 0, pendingRules: true, error: `journal write failed: ${msg}` }
  }

  // ---- Step 3: the batches.
  let deleted = 0
  let done = 0
  deps.onProgress?.({ phase: 'forget', done, total: ids.length })
  for (const batch of planForgetBatches(ids)) {
    let res: Response
    try {
      res = await _fetch(`${endpoint}/api/team/forget`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionIds: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`[team-forget-client] ${conn.id} forget batch failed (${done}/${ids.length} removed so far): ${msg}`)
      return { ok: false, deleted, pendingRules: true, error: msg }
    }
    if (res.status === 401 || res.status === 403) {
      await revoke()
      return { ok: false, deleted, pendingRules: true, authRejected: true, error: `forget rejected (${res.status})` }
    }
    const body = res.ok ? await readJsonBody(res) : null
    // The body, never `res.ok`: a proxy answering the route's JSON 404 with a 200 HTML page must
    // not be recorded as a successful delete.
    if (!body || body.ok !== true) {
      const msg = res.ok ? 'central did not acknowledge the forget' : `forget returned ${res.status}`
      log.warn(`[team-forget-client] ${conn.id} ${msg}; stopping (journal kept open)`)
      return { ok: false, deleted, pendingRules: true, error: msg }
    }
    deleted += typeof body.deleted === 'number' ? body.deleted : 0

    // Per ACK, never up front.
    const sent = await _load(conn.id)
    for (const id of batch) delete sent.hashes[id]
    await _save(conn.id, sent)

    done += batch.length
    deps.onProgress?.({ phase: 'forget', done, total: ids.length })
  }

  // Every batch acked → the central deleted those sessions AND their workflow runs, so the run
  // ids may finally leave the sent-state. Done only here: a partial sequence must leave them
  // named, or the next cycle's plan could no longer ask for them. (Task 4's `forgetRuns` is
  // already denial-scoped, and the runs-only case is refused above; what remains is a run whose
  // owning session was denied but never itself pushed, which no request can name — it rides on
  // the sessions that WERE named, or waits for its session to be pushed and denied.)
  if (runIds.length > 0) {
    const sent = await _load(conn.id)
    const drop = new Set(runIds)
    const remaining = sent.runIds.filter(id => !drop.has(id))
    if (remaining.length !== sent.runIds.length) await _save(conn.id, { ...sent, runIds: remaining })
  }

  // ---- Step 4: the rebuilt cache, in the SAME cycle.
  if (deps.pushRebuiltCache) {
    deps.onProgress?.({ phase: 'push', done: ids.length, total: ids.length })
    let pushed = false
    try {
      pushed = await deps.pushRebuiltCache()
    } catch (err) {
      log.warn(`[team-forget-client] ${conn.id} follow-up push threw: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!pushed) {
      // The sessions are already gone, so the central under-reports this machine until a push
      // lands — the safe direction. The journal stays open so the UI keeps saying `pendingRules`.
      return { ok: false, deleted, pendingRules: true, error: 'the follow-up statsCache push did not complete' }
    }
  }

  // ---- Step 5: the journal is finally closed. The caller writes the sync + rules files.
  try {
    await unlink(journalPath)
  } catch { /* already gone — the sequence still completed */ }
  log.info(`[team-forget-client] ${conn.id} removal complete — ${ids.length} session(s) named, ${deleted} deleted by the central`)
  return { ok: true, deleted }
}
