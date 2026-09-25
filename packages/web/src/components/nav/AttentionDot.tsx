/**
 * AttentionDot — "something in here is waiting on you", on a group header that hides its rows.
 *
 * A folded group shows only a name and a count, so a session inside it that has stopped to ask
 * something is invisible: every group header looks the same, and somebody seeing the list for the
 * first time reads an orange row as decoration. The dot exists to be UNMISTAKABLY a signal, and it
 * does that with motion rather than colour alone — a slow ring pulses out of it, which no static
 * design element does — plus the words (`title` and `aria-label`) naming how many.
 *
 * What counts is exactly what the rest of the product marks with the orange dot: a session that is
 * WAITING on a person (a finished turn, or a permission dialog), and never one that is working.
 */

import type { ControlSession } from '@agentistics/tui/control/session-fleet'

/** True for a session that wants a person: a turn that ended, or a dialog that is open. */
export function needsAttention(s: Pick<ControlSession, 'state'>): boolean {
  return s.state === 'waiting' || s.state === 'waiting-approval'
}

export function attentionCount(rows: readonly Pick<ControlSession, 'state'>[]): number {
  let n = 0
  for (const r of rows) if (needsAttention(r)) n++
  return n
}

export function AttentionDot({ count, pt }: { count: number; pt: boolean }) {
  if (count <= 0) return null
  const words = pt
    ? (count === 1 ? '1 sessão precisa de você' : `${count} sessões precisam de você`)
    : (count === 1 ? '1 session needs you' : `${count} sessions need you`)
  return <span className="ag-attn-dot" role="img" aria-label={words} title={words} />
}
