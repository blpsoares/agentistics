/**
 * AttentionDot — "something in here is waiting on you", on a group header that hides its rows.
 *
 * A folded group shows only a name and a count, so a session inside it that has stopped to ask
 * something is invisible: every group header looks the same, and somebody seeing the list for the
 * first time reads an orange row as decoration. The dot exists to be UNMISTAKABLY a signal, and it
 * does that with motion rather than colour alone — a slow ring pulses out of it, which no static
 * design element does — plus the words (`title` and `aria-label`) naming how many.
 *
 * It sits in a FIXED slot at the left edge of the header, whether or not there is a dot, so it lines
 * up vertically from one group to the next whatever the length of the names, and the chevron and
 * the folder never shift when a dot appears.
 *
 * Clicking it DISMISSES it. What counts is exactly what the rest of the product marks with the
 * orange dot: a session that is WAITING on a person (a finished turn, or a permission dialog), and
 * never one that is working.
 */

import type { ControlSession } from '@agentistics/tui/control/session-fleet'

/** True for a session that wants a person: a turn that ended, or a dialog that is open. */
export function needsAttention(s: Pick<ControlSession, 'state'>): boolean {
  return s.state === 'waiting' || s.state === 'waiting-approval'
}

/**
 * How many of these rows want a person and have NOT been dismissed.
 *
 * `dismissed` holds session ids. It is cleared per session the moment that session stops waiting
 * (see `pruneDismissed`), so the NEXT time it waits it counts again — a dismissal answers "I saw
 * this turn", never "never tell me about this session".
 */
export function attentionCount(
  rows: readonly Pick<ControlSession, 'id' | 'state'>[],
  dismissed?: ReadonlySet<string>,
): number {
  let n = 0
  for (const r of rows) if (needsAttention(r) && !(dismissed?.has(r.id))) n++
  return n
}

/** The ids of `rows` that count right now — what a dismiss writes down. */
export function attentionIds(
  rows: readonly Pick<ControlSession, 'id' | 'state'>[],
  dismissed?: ReadonlySet<string>,
): string[] {
  return rows.filter(r => needsAttention(r) && !(dismissed?.has(r.id))).map(r => r.id)
}

/**
 * Forget every dismissal whose session is not waiting any more. Returns the same set when nothing
 * changed, so a caller can skip a state update.
 */
export function pruneDismissed(
  dismissed: ReadonlySet<string>,
  rows: readonly Pick<ControlSession, 'id' | 'state'>[],
): ReadonlySet<string> {
  if (dismissed.size === 0) return dismissed
  const waiting = new Set(rows.filter(needsAttention).map(r => r.id))
  let changed = false
  const next = new Set<string>()
  for (const id of dismissed) {
    if (waiting.has(id)) next.add(id)
    else changed = true
  }
  return changed ? next : dismissed
}

export function AttentionSlot({ count, pt, onDismiss }: { count: number; pt: boolean; onDismiss: () => void }) {
  const words = count <= 0 ? '' : (pt
    ? (count === 1 ? '1 sessão precisa de você' : `${count} sessões precisam de você`)
    : (count === 1 ? '1 session needs you' : `${count} sessions need you`))
  const hint = words && (pt ? `${words}. Clique para dispensar.` : `${words}. Click to dismiss.`)
  return (
    <span style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {count > 0 && (
        <span
          role="button"
          tabIndex={0}
          aria-label={hint}
          title={hint}
          // The header this sits in is itself a button that folds the group: a click here must
          // dismiss and nothing else.
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDismiss() }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onDismiss() }
          }}
          style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 8 }}
        >
          <span className="ag-attn-dot" />
        </span>
      )}
    </span>
  )
}
