/**
 * subscriptions.ts — PURE. Who wants to hear about what, and how a stored one is matched.
 *
 * ## Why a subscription is persisted rather than a running process
 *
 * The obvious shape for "tell me when a session needs me" is a foreground command that watches and
 * prints. That shape has one fatal property: it is a process the user has to remember to start, and
 * it will be dead at the moment it matters. So a subscription is a ROW in a file. Whatever producer
 * is up — the daemon `agentop server` already runs, or a foreground `agentop events run` — reads
 * the file and delivers. Registering and producing are separated for exactly that reason.
 *
 * ## A subscription narrows; it never widens
 *
 * `task` and `session` are filters, `kinds` is a filter. A subscription with none of them hears
 * about every transition of the default kinds, which is the useful default for someone who just
 * fanned five sessions out. There is no field that makes a subscription hear about something the
 * producer did not observe.
 *
 * ## What it can ask for is DELIVERY, never ACTION
 *
 * `notify` names a Claude session to inform and `desktop` asks for a toast. Both carry an event
 * that states a fact. There is deliberately no field naming a command to run, a key to press or an
 * answer to give: a subscription that could run something would make this channel the thing that
 * answers a permission prompt on the user's behalf, which is the one thing it must never be able to
 * do. `events-frontier.test.ts` asserts the shape has no such field.
 */

import { DEFAULT_EVENT_KINDS, type EventKind, type SessionEvent } from './event-types'

export interface Subscription {
  /** Short, stable, and what `agentop events unwatch <id>` takes. */
  id: string
  /** ISO — this is a local JSON store, where ISO is the correct representation. */
  createdAt: string
  /** Only sessions whose task is exactly this. Absent means every task. */
  task?: string
  /** Only this session: agentop's session id, or its label. Absent means every session. */
  session?: string
  /** Which transitions. Never empty — a subscription that wants nothing is not a subscription. */
  kinds: EventKind[]
  /** A Claude session to inform, by the name or pid it registered under. Absent means nobody. */
  notify?: string
  /** Ask for a desktop notification. */
  desktop: boolean
  /** What created it, for `status` to show. Free text, never acted on. */
  note?: string
}

/** A short id from a counter plus what already exists — no clock, no randomness, so it is pure. */
export function newSubscriptionId(existing: readonly Subscription[]): string {
  let n = 1
  const taken = new Set(existing.map(s => s.id))
  while (taken.has(`s${n}`)) n++
  return `s${n}`
}

/**
 * Does this subscription want to hear about this event?
 *
 * The session filter matches either the id or the label, and matches the id by PREFIX so a person
 * can type the first few characters of one — the same courtesy `resolveSessionRef` extends. The
 * task filter is EXACT: a task is a name the user chose, and prefix-matching names is how "api"
 * quietly starts selecting "api-migration" too.
 */
export function subscriptionWants(sub: Subscription, e: SessionEvent): boolean {
  if (!sub.kinds.includes(e.kind)) return false
  if (sub.task !== undefined && e.task !== sub.task) return false
  if (sub.session !== undefined) {
    const ref = sub.session.toLowerCase()
    const byId = e.id.toLowerCase().startsWith(ref)
    const byLabel = (e.label ?? '').toLowerCase() === ref
    if (!byId && !byLabel) return false
  }
  return true
}

/** The subscriptions that want this event, in the order they were registered. */
export function subscribersOf(subs: readonly Subscription[], e: SessionEvent): Subscription[] {
  return subs.filter(s => subscriptionWants(s, e))
}

/**
 * Every kind any subscription asks for.
 *
 * The producer uses this to decide what to WRITE. It is a union, never a narrowing: two
 * subscriptions asking for different things must both be served, and a producer with no
 * subscriptions at all still records the default kinds, because the inbox is read by people and by
 * `agentop events tail` as well as by subscribers.
 */
export function kindsToRecord(subs: readonly Subscription[]): EventKind[] {
  const out = new Set<EventKind>(DEFAULT_EVENT_KINDS)
  for (const s of subs) for (const k of s.kinds) out.add(k)
  return [...out]
}

export interface SubscriptionStore {
  subscriptions: Subscription[]
}

export const EMPTY_STORE: SubscriptionStore = { subscriptions: [] }

/**
 * Read a store written by anyone, including a version that wrote fields this one has no name for.
 *
 * Total: a file that is not a store reads as an EMPTY store rather than throwing. A malformed
 * subscriptions file must not be able to stop the producer — silence about a filter is recoverable,
 * a daemon that will not start is not.
 */
export function parseStore(raw: unknown): SubscriptionStore {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { subscriptions: [] }
  const list = (raw as { subscriptions?: unknown }).subscriptions
  if (!Array.isArray(list)) return { subscriptions: [] }
  const out: Subscription[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || o.id === '') continue
    const kinds = Array.isArray(o.kinds)
      ? (o.kinds as unknown[]).filter((k): k is EventKind => typeof k === 'string' && (DEFAULT_EVENT_KINDS as readonly string[]).concat('working', 'turn-end').includes(k))
      : []
    // A subscription that survives the read with no kinds left would silently hear nothing. It is
    // given the defaults rather than dropped: the user asked for something, and the honest recovery
    // is the documented default, not silence.
    out.push({
      ...o,
      id: o.id,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      kinds: kinds.length > 0 ? kinds : [...DEFAULT_EVENT_KINDS],
      desktop: o.desktop === true,
    } as Subscription)
  }
  return { subscriptions: out }
}

export function addSubscription(store: SubscriptionStore, sub: Subscription): SubscriptionStore {
  return { ...store, subscriptions: [...store.subscriptions, sub] }
}

/** Removal reports whether anything was there, so the caller can say "no such subscription"
 *  instead of a cheerful "removed" that removed nothing. */
export function removeSubscription(
  store: SubscriptionStore,
  id: string,
): { store: SubscriptionStore; removed: Subscription[] } {
  const removed = store.subscriptions.filter(s => s.id === id)
  return { store: { ...store, subscriptions: store.subscriptions.filter(s => s.id !== id) }, removed }
}

export function clearSubscriptions(store: SubscriptionStore): { store: SubscriptionStore; removed: Subscription[] } {
  return { store: { ...store, subscriptions: [] }, removed: [...store.subscriptions] }
}
