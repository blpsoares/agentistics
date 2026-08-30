/**
 * openModalSession.ts — which session's card modal is open, as an external store.
 *
 * The modal used to be a card's own `useState`, which reset every time the card remounted — and on
 * a busy fleet the list re-renders every few seconds, so a maximized terminal closed under the user.
 * Holding the open id OUTSIDE the component (one at a time, page-wide) means a remount re-reads it
 * and the modal survives. It is NOT persisted: a modal should not reappear across a reload.
 */

let openId: string | null = null
const subscribers = new Set<() => void>()

export function getOpenModalSession(): string | null {
  return openId
}

export function setOpenModalSession(id: string | null): void {
  if (id === openId) return
  openId = id
  for (const fn of subscribers) fn()
}

export function subscribeOpenModalSession(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
