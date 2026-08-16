/**
 * shareRepos.ts — pure projection behind the per-central repository-sharing picker.
 *
 * MUST STAY IN SYNC WITH `packages/server/server/share-rules.ts` (`canonicalRepoKey`,
 * `normalizeDenied`). The web bundle may never import from `packages/server/*` (Vite would try
 * to bundle Bun/Node APIs), which is exactly why this tiny pure key function is duplicated here
 * instead of shared. Any change to the server rule must be reflected here and in
 * `shareRepos.test.ts`, which cross-checks this file's `canonicalRepoKey` against the server's
 * by importing it directly (a test-only import — tests run under Bun, not through Vite).
 *
 * The server denies a repository by `canonicalRepoKey(normalizeGitRemote(remote))`. If this
 * picker grouped its rows by a different key, the user could block the row they recognize while
 * another spelling of the same repository (a different protocol, a different SSH host alias)
 * keeps sharing — a silent privacy failure with a confident-looking UI.
 */
import type { SessionMeta } from '@agentistics/core'
import { NO_REPO_KEY, normalizeGitRemote, repoShortName, formatProjectName } from '@agentistics/core'

/** Minimal shape needed from the server's project list — just enough to resolve a remote-less
 *  session's repository via its project's `gitRemote`. Structurally compatible with both
 *  `@agentistics/core`'s `Project` and the server's `ServerProject`. */
export interface ServerProject {
  path: string
  gitRemote?: string
}

export interface ShareTarget {
  key: string                  // canonical remote, or NO_REPO_KEY
  kind: 'repo' | 'none'
  name: string                 // repoShortName(remote), or the localized "No repository"
  host: string                 // 'github.com'; '' for the none bucket
  sessions: number
  lastActive: string           // ISO, '' when unknown
  orphan: boolean              // denied but no longer produces sessions
  conflictPaths: string[]      // project paths under this key that also contain another repo
}

/**
 * Case- and alias-folded comparison key — hand mirror of `share-rules.ts`'s `canonicalRepoKey`.
 * `normalizeGitRemote` lowercases only the host and preserves path case, and does not alias SSH
 * front doors, so the same repo cloned as `git@github.com:Acme/API.git` and as
 * `https://github.com/acme/api` would otherwise produce two keys — two picker rows, two
 * independent rules, and blocking the one the user recognizes leaves the other shared.
 */
function canonicalRepoKey(key: string): string {
  const lower = (key ?? '').toLowerCase()
  if (!lower) return ''
  const slash = lower.indexOf('/')
  if (slash <= 0) return lower
  const host = lower.slice(0, slash).replace(/^(ssh|altssh)\./, '')
  return host + lower.slice(slash)
}

/** Exported for the cross-check test only — not part of the public interface used by the UI. */
export { canonicalRepoKey }

function repoKeyOfRemote(remote: string | undefined): string {
  return canonicalRepoKey(normalizeGitRemote(remote))
}

/** The stored denylist → a canonical lookup set. Mirrors `share-rules.ts`'s `normalizeDenied`. */
function normalizeDeniedKeys(denied: readonly string[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const raw of denied ?? []) {
    if (typeof raw !== 'string') continue
    if (raw === NO_REPO_KEY || raw === '') { out.add(NO_REPO_KEY); continue }
    const key = canonicalRepoKey(normalizeGitRemote(raw))
    if (key) out.add(key)
  }
  return out
}

interface PathIndex {
  /** project_path → the remote key it resolves to (first one observed). */
  resolved: Map<string, string>
  /** project_path → every distinct remote key ever seen under it, when more than one. */
  conflicts: Map<string, Set<string>>
}

/** Learn path → remote from sessions that carry one AND from each project's `gitRemote`, exactly
 *  as the server's `buildPathRepoIndex` does — a remote-less session falls back to its project's
 *  remote, and a path seen under more than one remote is a conflict neither side can split. */
function buildPathIndex(
  sessions: readonly SessionMeta[],
  projects: readonly ServerProject[],
): PathIndex {
  const resolved = new Map<string, string>()
  const seen = new Map<string, Set<string>>()

  const observe = (path: string | undefined, remote: string | undefined) => {
    if (!path) return
    const key = repoKeyOfRemote(remote)
    if (!key) return
    if (!resolved.has(path)) resolved.set(path, key)
    const set = seen.get(path) ?? new Set<string>()
    set.add(key)
    seen.set(path, set)
  }

  for (const s of sessions) observe(s.project_path, s.git_remote)
  for (const p of projects) observe(p.path, p.gitRemote)

  const conflicts = new Map<string, Set<string>>()
  for (const [path, set] of seen) if (set.size > 1) conflicts.set(path, set)
  return { resolved, conflicts }
}

/** The repo bucket a session belongs to. Never returns ''. */
function keyOf(s: SessionMeta, index: PathIndex): string {
  const own = repoKeyOfRemote(s.git_remote)
  if (own) return own
  const viaPath = index.resolved.get(s.project_path)
  if (viaPath) return viaPath
  return NO_REPO_KEY
}

/** `host/org/repo` → `host`. Canonical repo keys always carry a slash; a malformed one (should
 *  not occur — every key here came through `canonicalRepoKey`/`normalizeGitRemote`) degrades to
 *  the whole key rather than throwing. */
function hostOfKey(key: string): string {
  const slash = key.indexOf('/')
  return slash > 0 ? key.slice(0, slash) : key
}

interface Bucket {
  key: string
  kind: 'repo' | 'none'
  sessions: number
  lastActive: string
  paths: Set<string>
}

/**
 * Turns the app's raw (UNFILTERED) session list into one row per blockable repository.
 * Callers MUST pass `ctx.data.sessions` / `ctx.data.projects` — never a filtered derivative —
 * or an active date/project filter would silently shrink the list of things the user can block.
 */
export function buildShareTargets(
  sessions: SessionMeta[],
  projects: ServerProject[],
  deniedKeys: string[],
  labels?: { noRepo?: string },
): ShareTarget[] {
  const index = buildPathIndex(sessions, projects)
  const denied = normalizeDeniedKeys(deniedKeys)
  const noRepoLabel = labels?.noRepo ?? 'No repository'

  const buckets = new Map<string, Bucket>()
  const bucketFor = (key: string): Bucket => {
    let b = buckets.get(key)
    if (!b) {
      b = { key, kind: key === NO_REPO_KEY ? 'none' : 'repo', sessions: 0, lastActive: '', paths: new Set() }
      buckets.set(key, b)
    }
    return b
  }

  for (const s of sessions) {
    const key = keyOf(s, index)
    const b = bucketFor(key)
    b.sessions++
    if (s.start_time && (!b.lastActive || s.start_time > b.lastActive)) b.lastActive = s.start_time
    if (s.project_path) b.paths.add(s.project_path)
  }

  // A denied key that no longer produces sessions still needs a row — the rule still applies if
  // the repository comes back.
  for (const key of denied) bucketFor(key)

  const targets: ShareTarget[] = []
  for (const b of buckets.values()) {
    // A `none` bucket with nothing in it and no standing rule is not a thing to show.
    if (b.kind === 'none' && b.sessions === 0 && !denied.has(b.key)) continue

    const conflictPaths = [...b.paths].filter(p => index.conflicts.has(p))
    targets.push({
      key: b.key,
      kind: b.kind,
      name: b.kind === 'none' ? noRepoLabel : repoShortName(b.key),
      host: b.kind === 'none' ? '' : hostOfKey(b.key),
      sessions: b.sessions,
      lastActive: b.lastActive,
      orphan: b.sessions === 0 && denied.has(b.key),
      conflictPaths,
    })
  }

  targets.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
  return targets
}

export interface ProjectTarget {
  key: string                  // project_path — the identity a project-level rule is keyed on
  kind: 'project'
  name: string                 // formatProjectName(path) — the SAME helper "Filtrar por projeto" uses
  path: string
  /** Canonical repo key this project resolves to (its own `gitRemote`, or via a session that
   *  carries one) — '' when the project has no known git remote at all. NEVER `NO_REPO_KEY`: that
   *  sentinel names the repo tab's own "no repository" bucket, a different dimension. */
  repoKey: string
  sessions: number
  lastActive: string
  /** True when `repoKey` is non-empty AND currently denied — "repo + project are the same thing"
   *  (the user's own words): blocking the repo must show as blocked here too, never as an
   *  independently-toggleable row that silently contradicts the repo tab. */
  locked: boolean
}

/**
 * Turns the app's raw (UNFILTERED) project list into one row per project — the SAME list
 * "Filtrar por projeto" shows (same paths, same `formatProjectName` display names), so a user
 * never sees two different project lists in the same app. A project's repository, when it has
 * one, is resolved through the exact same path→repo index the repo tab uses (`buildPathIndex`),
 * so the two tabs can never disagree about which repo governs a given project.
 *
 * Callers MUST pass `ctx.data.projects` / `ctx.data.sessions` — never a filtered derivative — for
 * the same reason `buildShareTargets` documents.
 */
export function buildProjectTargets(
  sessions: SessionMeta[],
  projects: ServerProject[],
  deniedRepoKeys: string[],
): ProjectTarget[] {
  const index = buildPathIndex(sessions, projects)
  const denied = normalizeDeniedKeys(deniedRepoKeys)

  const bySessions = new Map<string, { sessions: number; lastActive: string }>()
  for (const s of sessions) {
    if (!s.project_path) continue
    const agg = bySessions.get(s.project_path) ?? { sessions: 0, lastActive: '' }
    agg.sessions++
    if (s.start_time && (!agg.lastActive || s.start_time > agg.lastActive)) agg.lastActive = s.start_time
    bySessions.set(s.project_path, agg)
  }

  // Every project the filter knows about gets a row, even with zero sessions in THIS list — the
  // filter itself lists every known project, not just ones with currently-matching sessions.
  const paths = new Set<string>(projects.map(p => p.path))
  for (const path of bySessions.keys()) paths.add(path)

  const targets: ProjectTarget[] = []
  for (const path of paths) {
    if (!path) continue
    const agg = bySessions.get(path) ?? { sessions: 0, lastActive: '' }
    const repoKey = index.resolved.get(path) ?? ''
    targets.push({
      key: path,
      kind: 'project',
      name: formatProjectName(path),
      path,
      repoKey,
      sessions: agg.sessions,
      lastActive: agg.lastActive,
      locked: repoKey !== '' && denied.has(repoKey),
    })
  }

  targets.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
  return targets
}

/** Number of `targets` currently under a denylist rule. */
export function countDenied(targets: ShareTarget[], denied: string[]): number {
  const set = normalizeDeniedKeys(denied)
  return targets.filter(t => set.has(t.key)).length
}

/** Just enough of a connection to build the hidden-repo reverse index below — structurally
 *  compatible with `@agentistics/core`'s `TeamConnection`. */
export interface DeniedRepoSource {
  deniedRepos: string[]
  label?: string
  endpoint: string
}

/**
 * Reverse index for Task 13's hidden-repo badge: canonical repo key (or `NO_REPO_KEY`) → the
 * labels of every connection currently hiding it. `deniedRepos` never reaches a central, but this
 * machine's own browser may read it freely (same-origin) — that's what lets a repository blocked
 * weeks ago stay visible outside the Settings page that set the rule.
 *
 * Keyed by the SAME `canonicalRepoKey` the denylist and the picker use — keying by the raw
 * `deniedRepos` entry as stored would still be correct here (rules are already written as
 * canonical keys by `handleApplyRules`), but re-canonicalizing defends against a rule written by an
 * older client that stored a differently-cased or aliased spelling.
 */
export function buildDeniedRepoLabels(connections: readonly DeniedRepoSource[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const conn of connections) {
    if (!conn.deniedRepos || conn.deniedRepos.length === 0) continue
    const label = conn.label?.trim() || hostOf(conn.endpoint)
    for (const raw of conn.deniedRepos) {
      if (typeof raw !== 'string') continue
      const key = raw === NO_REPO_KEY ? NO_REPO_KEY : canonicalRepoKey(normalizeGitRemote(raw))
      if (!key) continue
      const labels = map.get(key)
      if (labels) labels.push(label)
      else map.set(key, [label])
    }
  }
  return map
}

/**
 * The host of a connection endpoint, for display. Called inside a `.map` during render, so it
 * must NEVER throw — one hand-edited endpoint that fails to parse would otherwise take down the
 * whole Connection page, including the Disconnect button that would fix it.
 */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint || '—'
  }
}

/** Picks `one` at n === 1, `other` otherwise — avoids "1 sessões" / "1 bloqueados" in the
 *  Portuguese copy that a naive `{n}` template would produce. */
export function plural(entry: { one: string; other: string }, n: number): string {
  return n === 1 ? entry.one : entry.other
}
