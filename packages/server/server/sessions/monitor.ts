/**
 * monitor.ts — PURE. The whole fleet as one list.
 *
 * Two populations, deliberately in one place: the sessions agentop hosts, and the assistants the
 * user started by hand in some other terminal. Showing only the first restates the problem this
 * feature exists to solve — open a `claude` yourself and it vanishes from the cockpit.
 *
 * They are NOT equal, and the row says so. An external process has no PTY we can read, so it has
 * no attention state (`external`, never `idle-unknown` — we did not look and could not have) and
 * is not attachable. Claiming otherwise would be the confident-zero the dashboard forbids.
 *
 * The double-count trap is the same one `resolveLiveSnapshot` documents in `live-sessions.ts`: a
 * tmux-hosted `claude` IS a process in `/proc`, so it appears in BOTH inputs. Matching is by
 * harness AND directory (the same key `resolveOpenSessionIds`'s harness+cwd fallback pass uses),
 * and a process accounted for by a managed session is dropped — once per managed row, so three
 * panels open in the same project cannot all be swallowed by one session.
 */

import type { HarnessId } from '@agentistics/core'
import type { HarnessProcess } from '../live-sessions'
import type { ReconciledSession } from './session-ref'
import type { CaptureResult } from './types'
import { classifyAttention, needsAttention, type SessionState } from './attention'

export interface SessionView {
  id: string
  harness: HarnessId
  cwd: string
  /** The user's label, or '' when they never gave one. */
  label: string
  note: string
  state: SessionState
  /** True for a session agentop hosts (whether or not the registry still knows it); false for a
   *  bare process this monitor only observed in /proc. */
  managed: boolean
  attached: boolean
  createdMs?: number
  lastActivityMs?: number
  attachable: boolean
  killable: boolean
  /** Set for an external row so the UI can say WHY it offers nothing. */
  externalReason?: 'not-hosted-by-agentop'
}

export interface MonitorInput {
  nowMs: number
  reconciled: ReconciledSession[]
  /** Last frame per session id. A session with no entry simply was not captured this tick. */
  captures: Record<string, CaptureResult>
  processes: HarnessProcess[]
}

/** Rank for the sort: what is waiting on the user first, then what is running, then the rest. */
function rank(v: SessionView): number {
  if (v.state === 'waiting-approval') return 0
  if (v.state === 'waiting-input') return 1
  if (v.state === 'working') return 2
  if (v.state === 'idle-unknown' || v.state === 'unreadable') return 3
  if (v.state === 'external') return 4
  return 5 // exited
}

export function buildSessionViews(input: MonitorInput): SessionView[] {
  const views: SessionView[] = []

  for (const r of input.reconciled) {
    const harness = r.managed?.harness ?? 'claude'
    // `alive` comes from the BACKEND, not from `ReconciledSession.status` — `status` distinguishes
    // WHERE the session is known (registry vs backend vs both) but only `running`/`exited` say
    // anything about liveness for a registered session; an `unregistered` row (backend hosts it,
    // the registry lost track) still carries a real `backend.alive` and must be classified exactly
    // like a running one, not silently downgraded to `exited` for a bookkeeping gap.
    const alive = r.backend?.alive ?? false
    const capture = input.captures[r.id] ?? { ok: true as const, lines: [] }
    const state: SessionState = alive
      ? classifyAttention({
          harness,
          alive: true,
          nowMs: input.nowMs,
          lastActivityMs: r.backend!.lastActivityMs,
          capture,
        })
      : 'exited'
    views.push({
      id: r.id,
      harness,
      cwd: r.managed?.cwd ?? '',
      label: r.managed?.label ?? '',
      note: r.managed?.note ?? '',
      state,
      managed: true,
      attached: r.backend?.attached ?? false,
      ...(r.backend?.createdMs !== undefined ? { createdMs: r.backend.createdMs } : {}),
      ...(r.backend?.lastActivityMs !== undefined ? { lastActivityMs: r.backend.lastActivityMs } : {}),
      attachable: alive,
      // Killable even when it is not alive: an exited or lost session still occupies a registry
      // entry (and, if exited, a backend slot) that only a kill/clear clears.
      killable: true,
    })
  }

  // A managed session's own process is in /proc as well. Account for it by harness AND directory,
  // and only once per managed row, so three panels in one project cannot be covered by one session.
  const claimed = new Set<string>()
  for (const p of input.processes) {
    const covered = views.find(v =>
      v.managed && !claimed.has(v.id) && v.harness === p.harness && v.cwd === p.cwd)
    if (covered) { claimed.add(covered.id); continue }
    views.push({
      id: `ext:${p.harness}:${p.cwd}:${p.startedMs ?? 0}`,
      harness: p.harness,
      cwd: p.cwd,
      label: '',
      note: '',
      state: 'external',
      managed: false,
      attached: false,
      ...(p.startedMs !== undefined ? { createdMs: p.startedMs } : {}),
      attachable: false,
      killable: false,
      externalReason: 'not-hosted-by-agentop',
    })
  }

  return views.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
}

export function attentionCount(views: SessionView[]): number {
  return views.filter(v => needsAttention(v.state)).length
}
