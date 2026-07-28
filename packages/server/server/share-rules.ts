/**
 * share-rules.ts — PURE. Decides what a single central connection may receive.
 *
 * Contract: no I/O, no Mongo, no `preferences`, no `config`. Only @agentistics/core types
 * and helpers. Everything here is unit-tested against fixtures, because a mistake in this
 * file leaks a repository the user believes is hidden.
 *
 * Fail-closed is the rule everywhere: when attribution is uncertain, the session is NOT
 * shared. A privacy control that guesses in the permissive direction is not a control.
 */

import { createHash } from 'node:crypto'
import { NO_REPO_KEY, normalizeGitRemote } from '@agentistics/core'
import type { SessionMeta, WorkflowRun } from '@agentistics/core'

export type RepoKey = string

/**
 * Case- and alias-folded comparison key. `normalizeGitRemote` lowercases the host but
 * PRESERVES path case and does not alias SSH front doors, so the same repo cloned as
 * `git@github.com:Acme/API.git` and as `https://github.com/acme/api` would otherwise produce
 * two keys — two picker rows, two independent rules, and blocking the one the user
 * recognizes leaves the other shared.
 *
 * This folding lives HERE and not in `normalizeGitRemote`, which also keys the Repositories
 * page and tags: changing it there has a blast radius this feature does not need.
 */
export function canonicalRepoKey(key: string): RepoKey {
  const lower = (key ?? '').toLowerCase()
  if (!lower) return ''
  const slash = lower.indexOf('/')
  if (slash <= 0) return lower
  const host = lower.slice(0, slash).replace(/^(ssh|altssh)\./, '')
  return host + lower.slice(slash)
}

/** The stored denylist → a canonical lookup set. Junk is dropped; '' folds to the sentinel
 *  for backward compatibility, but only '__no_repo__' is ever persisted. */
export function normalizeDenied(denied: readonly string[] | null | undefined): Set<RepoKey> {
  const out = new Set<RepoKey>()
  for (const raw of denied ?? []) {
    if (typeof raw !== 'string') continue
    if (raw === NO_REPO_KEY || raw === '') { out.add(NO_REPO_KEY); continue }
    const key = canonicalRepoKey(normalizeGitRemote(raw))
    if (key) out.add(key)
  }
  return out
}

export function hasRestrictions(denied: readonly string[] | null | undefined): boolean {
  return normalizeDenied(denied).size > 0
}

export interface PathRepoIndex {
  /** project_path → the remote it resolves to (canonical). */
  resolved: Map<string, RepoKey>
  /** project_path → every distinct remote ever seen under it, when more than one. */
  conflicts: Map<string, Set<RepoKey>>
}

type ProjectLike = { path: string; gitRemote?: string }

/**
 * Learn path → remote from sessions that carry one AND from ServerProject.gitRemote.
 *
 * The project seed is load-bearing: only the Copilot adapter sets `git_remote` among the
 * non-Claude adapters, and data.ts runs its persisted backfill against the Claude-only
 * session array before the harness merge — so the consolidate store carries every Codex /
 * Gemini / Kimi / agy session with no remote, permanently. A directory used exclusively by a
 * non-Claude harness has no session to learn from; the project record does.
 */
export function buildPathRepoIndex(
  sessions: readonly SessionMeta[],
  projects?: readonly ProjectLike[],
): PathRepoIndex {
  const resolved = new Map<string, RepoKey>()
  const seen = new Map<string, Set<RepoKey>>()

  const observe = (path: string, remote: string | undefined) => {
    if (!path) return
    const key = canonicalRepoKey(normalizeGitRemote(remote))
    if (!key) return
    if (!resolved.has(path)) resolved.set(path, key)
    const set = seen.get(path) ?? new Set<RepoKey>()
    set.add(key)
    seen.set(path, set)
  }

  for (const s of sessions) observe(s.project_path, s.git_remote)
  for (const p of projects ?? []) observe(p.path, p.gitRemote)

  const conflicts = new Map<string, Set<RepoKey>>()
  for (const [path, set] of seen) if (set.size > 1) conflicts.set(path, set)
  return { resolved, conflicts }
}

/** The repo bucket a session belongs to. Never returns ''. */
export function repoKeyOf(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  index?: PathRepoIndex,
): RepoKey {
  // Re-normalizing is idempotent and cheap insurance against a legacy consolidate-store
  // entry written before remotes were normalized.
  const own = canonicalRepoKey(normalizeGitRemote(s.git_remote))
  if (own) return own
  const viaPath = index?.resolved.get(s.project_path)
  if (viaPath) return viaPath
  return NO_REPO_KEY
}

/**
 * A session is shared when its own key is not denied AND — when its directory is known to
 * hold more than one repo — no remote under that directory is denied.
 *
 * `scanProjectDir` stamps one remote on every session of a directory and `getProjectGitStats`
 * even scans one level of subdirectories for workspace folders, so a workspace holding a
 * shared and a blocked repo would otherwise ship the blocked repo's `first_prompt` and
 * `title` under the shared key. Annotating the ambiguity and sharing anyway is a fail-open.
 */
export function sessionShared(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): boolean {
  if (denied.size === 0) return true
  if (denied.has(repoKeyOf(s, index))) return false
  const conflict = index?.conflicts.get(s.project_path)
  if (conflict) for (const key of conflict) if (denied.has(key)) return false
  return true
}

export function filterShared<T extends Pick<SessionMeta, 'git_remote' | 'project_path'>>(
  sessions: readonly T[],
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): T[] {
  if (denied.size === 0) return [...sessions]
  return sessions.filter(s => sessionShared(s, denied, index))
}

/**
 * Sessions the denylist ACTIVELY excludes — the only legitimate removal trigger.
 *
 * Never define this as "in the sent-state but absent from the store": `loadConsolidated()`
 * swallows every error and returns empty, `writeConsolidated` writes non-atomically from the
 * same process, and a container can start before its bind mount is ready. Any of those makes
 * a cycle read short, and an absence-based trigger would then ask the central to delete
 * perfectly valid sessions and drop them from the sent-state — silent, permanent loss.
 */
export function deniedSessionIds(
  sessions: readonly SessionMeta[],
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): Set<string> {
  const out = new Set<string>()
  if (denied.size === 0) return out
  for (const s of sessions) {
    if (s.session_id && !sessionShared(s, denied, index)) out.add(s.session_id)
  }
  return out
}

export function sharedSessionIds(sessions: readonly Pick<SessionMeta, 'session_id'>[]): Set<string> {
  const out = new Set<string>()
  for (const s of sessions) if (s.session_id) out.add(s.session_id)
  return out
}

/**
 * A workflow run has no repo of its own — it is shared iff its owning session is, and a run
 * whose session is unknown is DROPPED. `WorkflowRun` carries `name`, `phases`,
 * `agents[].label` and `totals`, which leak task descriptions and cost.
 */
export function filterSharedWorkflows(
  runs: readonly WorkflowRun[],
  sharedIds: ReadonlySet<string>,
): WorkflowRun[] {
  return runs.filter(r => !!r.sessionId && sharedIds.has(r.sessionId))
}

/**
 * The fail-closed default applied the moment a connection acquires its FIRST restriction.
 *
 * Unresolved is not the same fact as new. The sentinel covers remote-less folders, every
 * non-Claude session whose adapter never sets a remote, and store entries written before
 * remote stamping — all of which carry `project_path`, `first_prompt`, `title` and cost.
 * It is written into the PERSISTED list (never applied as a hidden runtime rule) so the
 * picker can show it pre-blocked and the user can deliberately un-block it.
 */
export function withUnresolvedDenied(denied: readonly string[]): string[] {
  if (denied.length === 0) return []
  return denied.includes(NO_REPO_KEY) ? [...denied] : [...denied, NO_REPO_KEY]
}

/** Stable fingerprint of a denylist — order-, case- and normalization-independent. */
export function denialSignature(denied: readonly string[] | null | undefined): string {
  const keys = [...normalizeDenied(denied)].sort()
  return createHash('sha256').update(keys.join('\n')).digest('hex')
}
