/**
 * dragReorder.ts — the ONE pure "drag item A onto item B" arithmetic, shared by every list in the
 * app that can be dragged into a new order: the panel rail, the bottom band's tab strip, the
 * pinned-sessions band, and the sessions aside's own group-order picker.
 *
 * WHY THIS EXISTS. `SessionsGroupMenu.tsx` already had this exact shape, correct, keyed by the
 * group's own string key. The pinned-sessions band did NOT: it tracked drag state as the position
 * WITHIN THE RENDERED (filtered) list and fed that position straight into `planPinMove`, which
 * splices the RAW, UNFILTERED pinned-id array. Those two arrays only have the same shape when
 * every pinned id still resolves to a live row — the moment even one pinned session no longer
 * resolves (ended and since dropped off the fleet, or a stale id from an old machine), the two
 * index spaces diverge and a drag silently reorders the WRONG pair of raw entries. Reported as "I
 * drag a pinned row and the order reverts" — it had not reverted; index N of the six VISIBLE rows
 * had been spliced against index N of the eight-item RAW array, which is a different pair of ids,
 * and the reorder that actually happened was invisible whenever the two ids it moved were among the
 * unresolvable ones (exactly the case that made it LOOK like nothing happened at all).
 *
 * THE FIX, AS A RULE: never drag by INDEX into a list that can contain entries the screen does not
 * render. Drag by KEY, and resolve the key's real position inside whichever array is actually being
 * spliced, at the moment of the splice. `reorderByDrag` is that resolution, done once.
 */

/**
 * PURE: given the order a list is CURRENTLY in, and the keys of the item being dragged and the item
 * it was dropped on, return the new order.
 *
 * Total: dropping a key onto itself is a no-op (a new array, same order); a `dropKey` not actually
 * present in `order` is refused unchanged — the drop landed on something this list does not
 * recognize, and inventing a position for it is worse than leaving the order alone. `dragKey`
 * missing from `order` is likewise a no-op: there is nothing to move.
 */
export function reorderByDrag<K>(order: readonly K[], dragKey: K, dropKey: K): K[] {
  if (dragKey === dropKey) return [...order]
  if (!order.includes(dragKey)) return [...order]
  const without = order.filter(k => k !== dragKey)
  const at = without.indexOf(dropKey)
  if (at === -1) return [...order]
  without.splice(at, 0, dragKey)
  return without
}

/**
 * PURE: step one key one place earlier/later in `order` — the keyboard/click equivalent of a drag,
 * used by an up/down pair of buttons. Total: a key not in `order`, or a step that would leave the
 * list, is a no-op.
 */
export function stepOrder<K>(order: readonly K[], key: K, by: 1 | -1): K[] {
  const from = order.indexOf(key)
  const to = from + by
  if (from === -1 || to < 0 || to >= order.length) return [...order]
  const next = [...order]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** The one MIME type every draggable list in this app uses to carry its item's key across
 *  components — native HTML5 drag-and-drop, so a rail icon can be dropped on the bottom band's
 *  own tab strip (a different React subtree entirely) without either side holding shared state. */
export const DRAG_KEY_TYPE = 'application/x-agentistics-drag-key'

export function setDragPayload(e: React.DragEvent, key: string): void {
  e.dataTransfer.setData(DRAG_KEY_TYPE, key)
  e.dataTransfer.setData('text/plain', key)
  e.dataTransfer.effectAllowed = 'move'
}

export function readDragPayload(e: React.DragEvent): string | null {
  const v = e.dataTransfer.getData(DRAG_KEY_TYPE) || e.dataTransfer.getData('text/plain')
  return v || null
}
