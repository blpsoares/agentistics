import type { SessionMeta } from './types'

/** Tag a session with its owning user (team mode). Pure — returns a new object. */
export function tagUser(session: SessionMeta, user: string): SessionMeta {
  return { ...session, user }
}

/** Distinct, sorted list of users present in a session list. Skips undefined. Pure. */
export function distinctUsers(sessions: SessionMeta[]): string[] {
  const set = new Set<string>()
  for (const s of sessions) if (s.user) set.add(s.user)
  return Array.from(set).sort()
}

/** Multi-select user predicate. Empty/undefined selection = all sessions pass.
 *  Sessions with no `user` are excluded when a selection is active. Pure. */
export function filterByUsers<T extends { user?: string }>(sessions: T[], users: string[]): T[] {
  if (!users || users.length === 0) return sessions
  const set = new Set(users)
  return sessions.filter(s => !!s.user && set.has(s.user))
}
