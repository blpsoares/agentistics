import { useSyncExternalStore } from 'react'

export type NotificationType = 'error' | 'warning' | 'info' | 'success'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message?: string
  ts: number
  read: boolean
}

const MAX_ITEMS = 50

// External store — a single immutable array reference that changes on every mutation,
// so useSyncExternalStore re-renders subscribers without extra bookkeeping.
let items: AppNotification[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

let seq = 0
function nextId(): string {
  seq += 1
  return `n${Date.now().toString(36)}-${seq}`
}

/** Add a notification (newest first). De-dupes an identical title+message that is still
 *  unread, so a repeating error doesn't stack — it just refreshes the timestamp. */
export function pushNotification(n: {
  type: NotificationType
  title: string
  message?: string
}): void {
  const now = Date.now()
  const dupe = items.find(
    x => !x.read && x.title === n.title && (x.message ?? '') === (n.message ?? ''),
  )
  if (dupe) {
    items = [{ ...dupe, ts: now }, ...items.filter(x => x.id !== dupe.id)]
  } else {
    items = [{ id: nextId(), ts: now, read: false, ...n }, ...items].slice(0, MAX_ITEMS)
  }
  emit()
}

export function markAllRead(): void {
  if (!items.some(x => !x.read)) return
  items = items.map(x => (x.read ? x : { ...x, read: true }))
  emit()
}

export function dismissNotification(id: string): void {
  const next = items.filter(x => x.id !== id)
  if (next.length !== items.length) { items = next; emit() }
}

export function clearNotifications(): void {
  if (items.length === 0) return
  items = []
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive list of notifications (newest first). */
export function useNotifications(): AppNotification[] {
  return useSyncExternalStore(subscribe, () => items, () => items)
}
