/**
 * sessionUserGroups.ts — user-defined session groups ("Saved to later", …) — PURE + persisted.
 *
 * Distinct from `fleetGroups.ts`'s AUTOMATIC grouping (project/task/status), which recomputes on
 * every render from what a session IS. A user group is a NAMED, manually curated set of sessions
 * that stays exactly where the person put it — "eu crio um grupo 'Saved to later' … elas ficam
 * salvas nesse grupo e o grupo só some se eu deletar ele" — regardless of the session's own state.
 * It reflects a decision the person made, not a fact about the work the automatic groupings expose.
 *
 * IDENTITY: keyed by `sessionIdentityKey` (see `sessionIdentity.ts`) — the same key `pinnedSessions.ts`
 * uses, and for the same reason: a reopen mints a new managed id for the same conversation, and a
 * group a person built must survive that exactly as a pin does (with the same known gap for
 * `conversationBlind` harnesses — see that module's header).
 *
 * PERSISTENCE: the server, through `sharedPref.ts` — a group is a fact about the WORK ("I started
 * this, I'm not doing it now, I don't want to have to go find it again"), not about the screen it
 * was made on. Same shape and same reasoning as `pinnedSessions.ts`.
 *
 * A SESSION BELONGS TO AT MOST ONE USER GROUP. Dropping it into a second group MOVES it out of the
 * first — two "queues" both claiming one session would each read as authoritative, which is worse
 * than the product picking one.
 *
 * DUPLICATE NAMES ARE ALLOWED. Refusing them needs a global lock the person has no reason to expect
 * ("group name already exists" for a name they picked because it was obvious), and nothing else in
 * this feature depends on uniqueness — groups are addressed by id everywhere, never by name.
 */

import { reorderByDrag } from './dragReorder'
import { createSharedPref } from './sharedPref'

const KEY = 'agentistics-session-groups'

export interface SessionUserGroup {
  id: string
  name: string
  /** Member session identity keys, in this group's own display order. */
  sessionKeys: string[]
}

export interface SessionUserGroupsValue {
  /** Display order of the groups themselves — creation order; there is no reorder-the-groups
   *  gesture (only reordering the SESSIONS within one), so this is simply append-only. */
  groups: SessionUserGroup[]
}

export const EMPTY_SESSION_GROUPS: SessionUserGroupsValue = { groups: [] }

/** `crypto.randomUUID` is available in every browser this app targets; the fallback only guards a
 *  non-secure context (plain http, not https/localhost) where it is undefined. */
function makeGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * PURE: create a new, empty group named `name`, appended last.
 *
 * A blank (after trim) name is refused — an unnamed group is a button with nothing to click — and
 * the value comes back unchanged with `id: null` so the caller knows nothing happened.
 */
export function planCreateGroup(
  current: SessionUserGroupsValue,
  name: string,
): { next: SessionUserGroupsValue; id: string | null } {
  const trimmed = name.trim()
  if (trimmed === '') return { next: current, id: null }
  const id = makeGroupId()
  return { next: { groups: [...current.groups, { id, name: trimmed, sessionKeys: [] }] }, id }
}

/** PURE: rename a group. A blank name is refused (unchanged); a missing id is a no-op. */
export function planRenameGroup(
  current: SessionUserGroupsValue,
  id: string,
  name: string,
): SessionUserGroupsValue {
  const trimmed = name.trim()
  if (trimmed === '') return current
  return { groups: current.groups.map(g => (g.id === id ? { ...g, name: trimmed } : g)) }
}

/**
 * PURE: delete a group. NEVER touches a session — the group stops existing, its sessions are
 * untouched and simply fall back into the automatic sections, exactly the guarantee the owner
 * asked for ("as sessões não são apagadas, só saem do grupo").
 */
export function planDeleteGroup(current: SessionUserGroupsValue, id: string): SessionUserGroupsValue {
  return { groups: current.groups.filter(g => g.id !== id) }
}

/** PURE: which group (if any) currently holds this session key. */
export function groupOfSession(
  current: SessionUserGroupsValue,
  key: string,
): SessionUserGroup | undefined {
  return current.groups.find(g => g.sessionKeys.includes(key))
}

/**
 * PURE: put `key` into group `id`, at the end of its list — removing it from every OTHER group
 * first, so membership stays exclusive. Dropping a key already in `id` is a no-op that leaves its
 * position unchanged (see `planReorderInGroup` to actually reposition it). An unknown `id` is a
 * no-op: there is nothing to add it to.
 */
export function planAddToGroup(
  current: SessionUserGroupsValue,
  id: string,
  key: string,
): SessionUserGroupsValue {
  if (!current.groups.some(g => g.id === id)) return current
  return {
    groups: current.groups.map(g => {
      if (g.id === id) return g.sessionKeys.includes(key) ? g : { ...g, sessionKeys: [...g.sessionKeys, key] }
      return g.sessionKeys.includes(key) ? { ...g, sessionKeys: g.sessionKeys.filter(k => k !== key) } : g
    }),
  }
}

/** PURE: take `key` out of whichever group holds it. A no-op when it is in none. */
export function planRemoveFromGroup(current: SessionUserGroupsValue, key: string): SessionUserGroupsValue {
  return { groups: current.groups.map(g => (g.sessionKeys.includes(key)
    ? { ...g, sessionKeys: g.sessionKeys.filter(k => k !== key) }
    : g)) }
}

/** PURE: reorder the sessions WITHIN one group — by key, never index (see `dragReorder.ts`'s own
 *  header for why an index into a list that can hold unresolvable entries is unsafe). */
export function planReorderInGroup(
  current: SessionUserGroupsValue,
  id: string,
  dragKey: string,
  dropKey: string,
): SessionUserGroupsValue {
  return {
    groups: current.groups.map(g => (g.id === id
      ? { ...g, sessionKeys: reorderByDrag(g.sessionKeys, dragKey, dropKey) }
      : g)),
  }
}

/**
 * PURE: which of a group's keys resolve to a row right now, in the group's own order.
 *
 * Same rule as `resolvePinnedRows`, deliberately: an unresolvable key (the row is not merely
 * ended — it is fully gone from the fleet list this call was given) is HIDDEN from view, never
 * invented, but its key is left untouched in storage. The group is the person's own record of
 * intent ("I'm getting to this"), and a stale poll or a machine that has not reported that session
 * in a while must not silently drop it from the list they built — the same guarantee pinning makes.
 */
export function resolveGroupRows<T>(
  group: SessionUserGroup,
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  return group.sessionKeys
    .map(k => rows.find(r => keyOf(r) === k))
    .filter((r): r is T => r !== undefined)
}

function isSessionUserGroup(v: unknown): v is SessionUserGroup {
  if (!v || typeof v !== 'object') return false
  const g = v as Record<string, unknown>
  return typeof g.id === 'string' && typeof g.name === 'string'
    && Array.isArray(g.sessionKeys) && g.sessionKeys.every(k => typeof k === 'string')
}

const store = createSharedPref<SessionUserGroupsValue>({
  key: KEY,
  prefKey: 'sessionGroups',
  fallback: EMPTY_SESSION_GROUPS,
  parse: raw => {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { groups?: unknown }).groups)) return null
    return { groups: (raw as { groups: unknown[] }).groups.filter(isSessionUserGroup) }
  },
})

export function getSessionGroups(): SessionUserGroupsValue {
  return store.get()
}

export function subscribeSessionGroups(fn: () => void): () => void {
  return store.subscribe(fn)
}

/** Stable reference for `useSyncExternalStore`'s server snapshot (a fresh object each call loops). */
export function sessionGroupsServerSnapshot(): SessionUserGroupsValue {
  return store.serverSnapshot()
}

/** Create a group and persist it. Returns its id, or `null` when the name was blank. */
export function createSessionGroup(name: string): string | null {
  const { next, id } = planCreateGroup(store.get(), name)
  if (id) store.set(next)
  return id
}

export function renameSessionGroup(id: string, name: string): void {
  store.set(planRenameGroup(store.get(), id, name))
}

export function deleteSessionGroup(id: string): void {
  store.set(planDeleteGroup(store.get(), id))
}

export function addSessionToGroup(id: string, key: string): void {
  store.set(planAddToGroup(store.get(), id, key))
}

export function removeSessionFromGroup(key: string): void {
  store.set(planRemoveFromGroup(store.get(), key))
}

export function reorderSessionInGroup(id: string, dragKey: string, dropKey: string): void {
  store.set(planReorderInGroup(store.get(), id, dragKey, dropKey))
}
