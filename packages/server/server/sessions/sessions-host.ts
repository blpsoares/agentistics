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
import { attentionOf, digestFrame, frameTail } from './attention'
import { loadConversations, type Conversation } from './conversations'
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

export interface SessionSnapshot {
  sessions: SessionView[]
  /** How many are waiting on a person. Drives the header counter. */
  attention: number
  /** Ids that JUST started waiting — the caller rings the bell for these. */
  rang: string[]
  polledAtMs: number
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
  now?: () => number
  captureLines?: number
}): SessionsPoller {
  const now = o.now ?? (() => Date.now())
  const lines = o.captureLines ?? CAPTURE_LINES
  const limit = createLimiter(CAPTURE_CONCURRENCY)

  // Carried between polls: what each session's screen looked like, and what state it was in. The
  // first is how movement is detected; the second is what makes the bell a transition.
  let prevDigest = new Map<string, string>()
  let prevActivity = new Map<string, SessionActivity>()
  let last: SessionSnapshot | null = null

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
      const [registry, backendSessions, processes, conversations] = await Promise.all([
        o.readRegistry(),
        o.backend.list(),
        o.scanProcesses().then(r => r.procs).catch(() => [] as HarnessProcess[]),
        // History is an enrichment, never a prerequisite: a store that cannot be read costs the
        // closed rows, not the running ones.
        o.loadConversations ? o.loadConversations().catch(() => [] as Conversation[]) : Promise.resolve([]),
      ])

      const reconciled = reconcileSessions(registry, backendSessions)
      const harnessOf = new Map(registry.map(r => [r.id, r.harness]))

      const nextDigest = new Map<string, string>()
      const activity = new Map<string, SessionActivity>()
      const tails = new Map<string, string[]>()

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
        activity.set(r.id, attentionOf({
          alive: true,
          lastActivityMs: b.lastActivityMs,
          nowMs,
          frame,
          frameDigest,
          ...(before !== undefined ? { prevDigest: before } : {}),
          ...(rules ? { rules } : {}),
        }))
      })))

      const sessions = buildSessionViews({ reconciled, activity, tails, processes, conversations })
      const rang = bellTransitions(prevActivity, sessions)

      prevDigest = nextDigest
      prevActivity = new Map(
        sessions
          .filter((s): s is SessionView & { activity: SessionActivity } => s.activity !== undefined)
          .map(s => [s.id, s.activity]),
      )

      const snap: SessionSnapshot = {
        sessions, attention: attentionCount(sessions), rang, polledAtMs: nowMs,
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
        unavailable: `could not refresh sessions: ${message}`,
      }
    }
  }

  return { poll }
}
