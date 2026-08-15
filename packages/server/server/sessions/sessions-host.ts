/**
 * sessions-host.ts — the poller. The only impure module of the monitor: it reads the registry, asks
 * the backend what exists, captures a frame per live session, reads the host's processes, and hands
 * the pure functions everything they need.
 *
 * Bound to its dependencies at construction (the `createSessionRegistry(file)` pattern), so a test
 * exercises the real logic with no tmux server and no `/proc`.
 *
 * Two states it must never confuse, and the reason this file has an `unavailable` field at all:
 * "nothing is running" and "this machine cannot tell". An empty list rendered as a confident zero is
 * the same defect `liveEmptyNotice` exists to prevent on the dashboard.
 */

import { createLimiter } from '../utils'
import type { HarnessProcess } from '../live-sessions'
import { rulesFor } from './attention-rules'
import { approvalTail, attentionOf, digestFrame, frameTail } from './attention'
import { parseDialogOptions, type DialogOption } from './dialog-choice'
// Taking a running session back when its registry record is gone. See `session-adopt.ts`.
import { planAdoptions } from './session-adopt'
import { loadConversations, type Conversation } from './conversations'
import { HEARTBEAT_MS, planCrashGroup, type CrashGroup } from './crash-group'
import { emptyHarnessSessionIndex, type HarnessSessionIndex } from './harness-sessions'
import { reconcileSessions } from './session-ref'
import {
  attentionCount, bellTransitions, buildSessionViews, type SessionView,
} from './session-view'
import type { ManagedSession, SessionActivity, SessionBackend } from './types'

/** How often the cockpit refreshes. Five seconds is the interval the feature was specified at. */
export const SESSION_POLL_MS = Number(process.env.AGENTISTICS_SESSION_POLL_MS) > 0
  ? Number(process.env.AGENTISTICS_SESSION_POLL_MS)
  : 5_000

/** How much of the pane to read. Enough to hold a dialog and a footer, not the whole scrollback. */
const CAPTURE_LINES = 60

/** Frames are captured one per live session; four at a time keeps a large fleet from forking a
 *  process per session all at once. */
const CAPTURE_CONCURRENCY = 4

/** How much of what a session is saying to carry. Enough that a tall pane has something to fill it
 *  with; the pane cuts from the bottom to whatever it can actually draw. */
const TAIL_LINES = 8

/**
 * How much of a blocked session's screen to carry as the dialog.
 *
 * Ten lines holds a permission prompt with three options, its question and its footer — measured
 * against the frames `attention-rules.ts` was probed from. More would start carrying the
 * conversation above the dialog into a pane whose whole job is to show only what is being answered.
 */
const APPROVAL_LINES = 10

export interface SessionSnapshot {
  sessions: SessionView[]
  /** How many are waiting on a person. Drives the header counter. */
  attention: number
  /** Ids that JUST started waiting — the caller rings the bell for these. */
  rang: string[]
  polledAtMs: number
  /**
   * The sessions the machine took all at once, when there are any — see `crash-group.ts`.
   *
   * On the snapshot rather than derived from `sessions`, because it is a statement about a SET: a row
   * is in it because of when every other row was last alive, which no per-row rule can answer.
   */
  fell?: CrashGroup
  /**
   * Why this list may not be the whole truth, already a sentence.
   *
   * Set when the backend cannot run here at all, or when a poll failed and the sessions above are
   * the PREVIOUS snapshot rather than a fresh one.
   */
  unavailable?: string
}

export interface SessionsPoller {
  poll(): Promise<SessionSnapshot>
}

export function createSessionsPoller(o: {
  backend: SessionBackend
  readRegistry: () => Promise<ManagedSession[]>
  scanProcesses: () => Promise<{ procs: HarnessProcess[] }>
  /**
   * Every conversation this machine knows about — what names an external session and what fills the
   * "closed, reopenable" rows. Injected and OPTIONAL: it is a filesystem read, and the tests that
   * exercise the poller's real logic must not need one.
   */
  loadConversations?: () => Promise<Conversation[]>
  /**
   * What each harness records about its OWN live sessions — the name typed inside a session, and
   * the conversation it is driving, both keyed EXACTLY. Injected and optional, like
   * `loadConversations`: it is a filesystem read, and a harness with no such file simply has none.
   */
  loadHarnessSessions?: () => Promise<HarnessSessionIndex>
  /**
   * Stamp `lastSeenMs` on the sessions that are alive right now — the HEARTBEAT.
   *
   * Injected and optional for the same reason `loadConversations` is: it writes to disk, and the
   * tests that exercise the poller's real logic must not need a filesystem. It is what makes "these
   * fell together" answerable at all — see `crash-group.ts`.
   */
  touchSessions?: (ids: readonly string[], atMs: number) => Promise<unknown>
  /**
   * Record the conversation a managed row is EXACTLY known to be driving.
   *
   * Called only when the harness's own record says so and the registry does not already agree, so it
   * writes once per session rather than once per poll. It is what carries the exact id past the
   * session's own lifetime: the harness deletes its file when the process goes, and a `lost` row
   * with nothing recorded falls back to the harness-and-directory guess that cannot tell two
   * sessions of one repository apart — the guess that once reopened three rows onto one
   * conversation.
   */
  recordConversation?: (id: string, conversationId: string) => Promise<unknown>
  /**
   * Write registry records for sessions the backend is running and the registry has lost.
   *
   * Injected and optional for the same reason the two above are: it writes to disk. Called only with
   * a non-empty list, so a fleet with nothing to adopt — the ordinary case — never touches the file.
   * What may be adopted at all is the pure `planAdoptions`.
   */
  adoptSessions?: (records: readonly ManagedSession[]) => Promise<unknown>
  now?: () => number
  captureLines?: number
  /** Overridable so a test can drive several heartbeats without waiting a minute for each. */
  heartbeatMs?: number
}): SessionsPoller {
  const now = o.now ?? (() => Date.now())
  const lines = o.captureLines ?? CAPTURE_LINES
  const heartbeatMs = o.heartbeatMs ?? HEARTBEAT_MS
  const limit = createLimiter(CAPTURE_CONCURRENCY)

  // Carried between polls: what each session's screen looked like, and what state it was in. The
  // first is how movement is detected; the second is what makes the bell a transition.
  let prevDigest = new Map<string, string>()
  let prevActivity = new Map<string, SessionActivity>()
  let last: SessionSnapshot | null = null
  /**
   * When the heartbeat last wrote. `-Infinity` so the FIRST poll always stamps.
   *
   * Stamping immediately matters: a machine that comes up, has three sessions reopened into it and
   * then falls again inside the first minute would otherwise have three rows carrying only their
   * creation stamps — which is fine — but a fleet that was already running when this process started
   * would carry nothing at all, and would sit out the next crash entirely.
   */
  let lastHeartbeatMs = -Infinity

  async function poll(): Promise<SessionSnapshot> {
    const nowMs = now()

    const blocked = await o.backend.unavailable().catch(() => undefined)
    if (blocked) {
      // The backend cannot run here. That is a sentence, not an empty fleet.
      const snap: SessionSnapshot = {
        sessions: [], attention: 0, rang: [], polledAtMs: nowMs, unavailable: blocked,
      }
      last = snap
      return snap
    }

    try {
      const [registry, backendSessions, processes, conversations, harnessSessions] = await Promise.all([
        o.readRegistry(),
        o.backend.list(),
        o.scanProcesses().then(r => r.procs).catch(() => [] as HarnessProcess[]),
        // History is an enrichment, never a prerequisite: a store that cannot be read costs the
        // closed rows, not the running ones.
        o.loadConversations ? o.loadConversations().catch(() => [] as Conversation[]) : Promise.resolve([]),
        // Same rule: unreadable costs the harness's own names and its exact conversation ids, and
        // every row falls back to behaving exactly as it did before this existed.
        o.loadHarnessSessions
          ? o.loadHarnessSessions().catch(() => emptyHarnessSessionIndex())
          : Promise.resolve(emptyHarnessSessionIndex()),
      ])

      const reconciled = reconcileSessions(registry, backendSessions)
      const harnessOf = new Map(registry.map(r => [r.id, r.harness]))

      // Take back any session the backend is running that the registry has lost. It is not a
      // theoretical case: the registry's write queue is per PROCESS, several agentop processes write
      // the same file, and a record added by a short-lived one has been observed erased by a
      // longer-lived one — leaving the user sitting in a session the cockpit could no longer name,
      // attach to, rename or kill. Adoption never invents anything: see `session-adopt.ts`. It is
      // idempotent by construction (an adopted row stops being `unregistered`), so it writes once.
      if (o.adoptSessions) {
        const adopt = planAdoptions({
          rows: reconciled,
          byManagedId: harnessSessions.byManagedId,
          harness: 'claude',
          nowIso: new Date(nowMs).toISOString(),
        })
        // Best effort, exactly like the heartbeat: a registry that cannot be written costs the
        // adoption, never the fleet on screen.
        if (adopt.length > 0) await o.adoptSessions(adopt).catch(() => undefined)
      }

      const nextDigest = new Map<string, string>()
      const activity = new Map<string, SessionActivity>()
      const tails = new Map<string, string[]>()
      const approvals = new Map<string, string[]>()
      const dialogOptions = new Map<string, DialogOption[]>()

      await Promise.all(reconciled.map(r => limit(async () => {
        const b = r.backend
        if (!b) return // `lost`: the backend has nothing to capture and nothing to report.
        if (!b.alive) { activity.set(r.id, 'exited'); return }

        const frame = await o.backend.capture(r.id, lines).catch(() => [] as string[])
        const frameDigest = digestFrame(frame)
        nextDigest.set(r.id, frameDigest)
        tails.set(r.id, frameTail(frame, TAIL_LINES))

        const harness = harnessOf.get(r.id)
        const rules = harness ? rulesFor(harness) : undefined
        const before = prevDigest.get(r.id)
        const state = attentionOf({
          alive: true,
          lastActivityMs: b.lastActivityMs,
          nowMs,
          frame,
          frameDigest,
          ...(before !== undefined ? { prevDigest: before } : {}),
          ...(rules ? { rules } : {}),
        })
        activity.set(r.id, state)
        // The dialog is kept from the frame that DECIDED the state, so the two can never describe
        // different moments — and it costs nothing extra, the frame is already here.
        if (state === 'waiting-approval') {
          approvals.set(r.id, approvalTail(frame, APPROVAL_LINES))
          // Read from the SAME frame that decided the state, so what is offered and what the state
          // says can never describe different moments. Empty when the screen cannot be parsed with
          // confidence, which the UI reports rather than papering over.
          const options = parseDialogOptions(frame)
          if (options.length > 0) dialogOptions.set(r.id, options)
        }
      })))

      // The heartbeat: one write, one timestamp, every session the backend reports as ALIVE. See
      // `crash-group.ts` for why one shared timestamp is what makes the grouping exact.
      const aliveIds = backendSessions.filter(b => b.alive).map(b => b.id)
      if (o.touchSessions && nowMs - lastHeartbeatMs >= heartbeatMs) {
        lastHeartbeatMs = nowMs
        // Best effort, and never awaited into the poll's own failure path: a registry that cannot be
        // written costs the crash group, not the fleet on screen.
        await o.touchSessions(aliveIds, nowMs).catch(() => undefined)
      }

      // The exact conversation, written down while there is still a harness to ask. Only where it
      // would CHANGE the registry, so this is one write per session and not one per poll.
      if (o.recordConversation) {
        for (const m of registry) {
          const exact = harnessSessions.byManagedId.get(m.id)?.sessionId
          if (!exact || m.conversationId === exact) continue
          await o.recordConversation(m.id, exact).catch(() => undefined)
        }
      }

      // Decided against the BACKEND's own list rather than the reconciled statuses, because that is
      // the question: a row the backend has never heard of is one the machine took.
      const backendIds = new Set(backendSessions.map(b => b.id))
      const fell = planCrashGroup({ entries: registry, backendIds })

      const sessions = buildSessionViews({
        reconciled,
        activity,
        tails,
        approvals,
        dialogOptions,
        processes,
        conversations,
        harnessSessions,
        ...(fell ? { fell: new Set(fell.entries.map(e => e.id)) } : {}),
      })
      const rang = bellTransitions(prevActivity, sessions)

      prevDigest = nextDigest
      prevActivity = new Map(
        sessions
          .filter((s): s is SessionView & { activity: SessionActivity } => s.activity !== undefined)
          .map(s => [s.id, s.activity]),
      )

      const snap: SessionSnapshot = {
        sessions, attention: attentionCount(sessions), rang, polledAtMs: nowMs,
        ...(fell ? { fell } : {}),
      }
      last = snap
      return snap
    } catch (e) {
      // A failed poll keeps the previous answer and SAYS the refresh failed. Returning an empty
      // list would report every running session as gone the moment tmux hiccups.
      const message = e instanceof Error ? e.message : String(e)
      return {
        sessions: last?.sessions ?? [],
        attention: last?.attention ?? 0,
        rang: [],
        polledAtMs: nowMs,
        // Carried with the rest of the previous answer: the crash group is a fact about the same
        // sessions this snapshot is still showing, and dropping it would make the offer to reopen
        // them blink out on exactly the tick that already told the user something went wrong.
        ...(last?.fell ? { fell: last.fell } : {}),
        unavailable: `could not refresh sessions: ${message}`,
      }
    }
  }

  return { poll }
}
