/**
 * selection.ts — the table's SELECT MODE, pure.
 *
 * Batch delete and batch status live on a set of ticked rows, and a checkbox that is always on
 * screen makes ticking one an accident waiting to happen. So the checkboxes are behind a mode, and
 * the mode has three rules, each because the alternative arms a destructive act without the person
 * knowing:
 *
 *  - **It is EPHEMERAL and starts OFF.** Nothing here is persisted (the same reason the terminal
 *    cockpit refuses to store its kill-selection: a set of rows armed for deletion must not be
 *    findable still armed the next morning).
 *  - **Leaving the mode CLEARS the selection.** A selection kept while the checkboxes are hidden is a
 *    selection nobody can see, and "Delete 3 tasks" would then act on rows the reader cannot point at.
 *  - **The selection that ACTS is the one on screen.** A row hidden by the search box, or deleted
 *    since, is not part of what a batch verb reaches (`selectedVisible`): the count in the bar and
 *    the rows the verb touches are the same set by construction.
 */

export interface Selection {
  /** Are the checkboxes shown? Everything below is meaningless while this is false. */
  on: boolean
  ids: ReadonlySet<string>
}

export const NO_SELECTION: Selection = { on: false, ids: new Set() }

/** The Select button: off → on with nothing ticked; on → off and cleared. */
export function toggleMode(s: Selection): Selection {
  return s.on ? NO_SELECTION : { on: true, ids: new Set() }
}

/** Leave the mode (Escape, the "done" verb) — always clears. */
export function leaveMode(): Selection {
  return NO_SELECTION
}

/** Tick or untick one row. A row cannot be ticked while the checkboxes are hidden. */
export function toggleRow(s: Selection, id: string): Selection {
  if (!s.on) return s
  const ids = new Set(s.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { on: true, ids }
}

/** Tick or untick a whole group at once (the header checkbox). */
export function setRows(s: Selection, ids: readonly string[], checked: boolean): Selection {
  if (!s.on) return s
  const next = new Set(s.ids)
  for (const id of ids) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  return { on: true, ids: next }
}

/** Untick everything but stay in the mode — what a completed batch verb does. */
export function clearTicks(s: Selection): Selection {
  return s.on ? { on: true, ids: new Set() } : NO_SELECTION
}

/** The ticked rows that are still on screen. Empty whenever the mode is off. */
export function selectedVisible(s: Selection, visibleIds: Iterable<string>): string[] {
  if (!s.on) return []
  const visible = new Set(visibleIds)
  return [...s.ids].filter(id => visible.has(id))
}

/** Is a group's header checkbox ticked, half-ticked or clear? */
export function groupCheck(
  s: Selection, groupIds: readonly string[],
): 'all' | 'some' | 'none' {
  if (!s.on || groupIds.length === 0) return 'none'
  const n = groupIds.filter(id => s.ids.has(id)).length
  return n === 0 ? 'none' : n === groupIds.length ? 'all' : 'some'
}

/**
 * Should this Escape leave the mode? Not when it was meant for something else: a text field handles
 * its own Escape (the "+ Add" row cancels itself), and a key another handler already answered is not
 * ours to also act on.
 */
export function escapeLeavesMode(
  s: Selection,
  ev: {
    key: string
    defaultPrevented: boolean
    targetTag?: string
    /** An `<input>`'s `type`. A CHECKBOX is an input too, and it is where focus sits right after a
     *  row is ticked — treating it as a text field made Escape do nothing at the one moment it is
     *  pressed, which is measured, not imagined. */
    targetType?: string
    targetEditable?: boolean
  },
): boolean {
  if (!s.on || ev.key !== 'Escape' || ev.defaultPrevented) return false
  const tag = (ev.targetTag ?? '').toUpperCase()
  const type = (ev.targetType ?? 'text').toLowerCase()
  const nonText = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']
  const textInput = tag === 'INPUT' && !nonText.includes(type)
  if (ev.targetEditable || textInput || tag === 'TEXTAREA' || tag === 'SELECT') return false
  return true
}
