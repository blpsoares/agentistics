/**
 * control-session.ts — PURE. One server-side `SessionView`, mapped to the `ControlSession` every
 * surface that DRAWS the fleet consumes.
 *
 * It lived inside `cli-start.ts` while the control center was the only thing drawing a session row.
 * `agentop session ls` draws the same table into a plain terminal, and the alternative was a second
 * mapping — which is how the same session ends up wearing one state word in the cockpit and another
 * on the command line, and how a row named by the user keeps its name in one place and loses it in
 * the other. The repo has already paid for that once (`task-reopen.ts`), so the decision is extracted
 * and both sides execute it.
 *
 * Pure and stringless in the sense that matters: every word it emits arrives as an already-localized
 * `CliStrings`, so this module owns no copy of any sentence.
 */

import { fmt, fmtCost } from '@agentistics/core'
import type { ControlSession, SessionState } from '@agentistics/tui/control'
import type { CliStrings } from '../cli-i18n'
import type { RepoFacts } from './repo-facts'
import type { SessionView } from './session-view'

/** The state word each session wears, and the machine-readable state beside it. */
export function sessionState(v: SessionView): SessionState {
  if (v.status === 'closed') return 'closed'
  if (v.status === 'external') return 'unknown'
  if (v.status === 'lost') return 'lost'
  switch (v.activity) {
    case 'waiting-approval': return 'waiting-approval'
    case 'waiting': return 'waiting'
    case 'working': return 'working'
    case 'exited': return 'exited'
    // A row with no activity that is not external is one the poller could not read this time round.
    // `lost` is the honest word for it: something is known to exist and nothing can be said about it.
    default: return 'lost'
  }
}

export function stateLabel(state: SessionState, s: CliStrings): string {
  switch (state) {
    case 'working': return s.sessState.working
    case 'waiting-approval': return s.sessState.waitingApproval
    case 'waiting': return s.sessState.waiting
    case 'exited': return s.sessState.exited
    case 'lost': return s.sessState.lost
    case 'unknown': return s.sessState.external
    case 'closed': return s.sessState.closed
  }
}

/** The last path segment — the "by project" grouping key, decided here so the TUI never parses a
 *  path of its own. Backslashes normalised first, because a WSL machine sees both separators. */
export function projectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? cwd
}

/** One server-side view, mapped to what the control center renders — every word already localized. */
export function toControlSession(
  v: SessionView,
  s: CliStrings,
  /** What repository this session's directory belongs to, already resolved and memoized. */
  facts: RepoFacts = { worktree: false },
): ControlSession {
  const state = sessionState(v)
  const project = projectName(v.cwd)
  const harness = v.harness ?? ''
  return {
    id: v.id,
    // The user's own label wins over anything derived: naming a session is the whole point of
    // being able to name one.
    title: v.label ?? s.sessUntitled(harness || '?', project),
    harness,
    cwd: v.cwd,
    project,
    ...(v.model ? { model: v.model } : {}),
    ...(v.note ? { note: v.note } : {}),
    state,
    stateLabel: stateLabel(state, s),
    actionable: v.status !== 'external' && v.status !== 'closed',
    // Stated only where it is TRUE and only for a session we actually HOST. A row that is closed or
    // running outside agentop has no screen to read at all, so "approval detection is unavailable
    // for this harness" is not merely noise there — it is false, and it said so about claude, which
    // is probed.
    ...(v.status !== 'external' && v.status !== 'closed' && !v.approvalDetection && harness
      ? { approvalBlind: s.sessApprovalBlind(harness) }
      : {}),
    ...(v.createdMs !== undefined ? { startedAt: v.createdMs } : {}),
    ...(v.task ? { task: v.task } : {}),
    // Marked BY THE USER — a label, a note or a task. `title` cannot answer this: it always has a
    // value, because the host derives one whenever there is no label.
    ...(v.label || v.note || v.task ? { named: true } : {}),
    ...(facts.repo ? { repo: facts.repo } : {}),
    // Only when it differs: a session in the main checkout groups under its own folder already, and
    // a field repeating what is beside it is one more thing that can disagree.
    ...(facts.root && facts.root !== project ? { projectGroup: facts.root } : {}),
    ...(facts.worktree ? { worktree: true } : {}),
    ...(v.resume ? { resume: v.resume } : {}),
    ...(v.lastLines?.length ? { lastLines: v.lastLines } : {}),
    // Already formatted, because formatting is a presentation concern the host owns for everything
    // else it hands over — and `fmt`/`fmtCost` are the shared helpers the dashboard uses.
    ...(v.tokens !== undefined ? { tokens: fmt(v.tokens) } : {}),
    ...(v.costUSD !== undefined ? { cost: fmtCost(v.costUSD) } : {}),
    searchText: v.searchText,
    attached: v.attached,
  }
}
