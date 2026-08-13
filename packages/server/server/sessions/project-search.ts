/**
 * project-search.ts — PURE. Where a new session should start.
 *
 * Built from the sessions this machine has already recorded, because that list is both instant and
 * already ranked by what the user actually works on. A directory the machine has never seen is
 * handled by the caller accepting a typed path — this module answers "what have I used", not
 * "what exists on disk", and a filesystem crawl would be slower and noisier for the same answer.
 *
 * Repositories are keyed by `normalizeGitRemote`, the only legal repo key in this codebase.
 */

import { normalizeGitRemote, repoShortName, type SessionMeta } from '@agentistics/core'

export interface ProjectChoice {
  path: string
  /** `org/repo`, or '' when the directory has no recorded remote. Never invented. */
  repo: string
  lastActiveMs: number
  sessions: number
}

export function buildProjectChoices(sessions: SessionMeta[]): ProjectChoice[] {
  const byPath = new Map<string, ProjectChoice>()
  for (const s of sessions) {
    const path = s.project_path
    if (!path) continue
    const when = Date.parse(s.start_time ?? '')
    const at = Number.isNaN(when) ? 0 : when
    const remote = normalizeGitRemote(s.git_remote ?? '')
    const found = byPath.get(path)
    if (!found) {
      byPath.set(path, { path, repo: remote ? repoShortName(remote) : '', lastActiveMs: at, sessions: 1 })
      continue
    }
    found.sessions++
    if (at > found.lastActiveMs) found.lastActiveMs = at
    // A remote learned on any visit describes the directory, so keep the first one we see rather
    // than letting a later remote-less session erase it.
    if (!found.repo && remote) found.repo = repoShortName(remote)
  }
  return [...byPath.values()].sort((a, b) => b.lastActiveMs - a.lastActiveMs)
}

/** Where the query hit, lower is better. `null` when it did not hit at all. */
function score(choice: ProjectChoice, needle: string): number | null {
  const base = choice.path.slice(choice.path.lastIndexOf('/') + 1).toLowerCase()
  if (base.startsWith(needle)) return 0
  if (base.includes(needle)) return 1
  if (choice.repo.toLowerCase().includes(needle)) return 2
  if (choice.path.toLowerCase().includes(needle)) return 3
  return null
}

export function searchProjects(choices: ProjectChoice[], query: string, limit: number): ProjectChoice[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return choices.slice(0, limit)
  const hits: Array<{ choice: ProjectChoice; score: number }> = []
  for (const choice of choices) {
    const s = score(choice, needle)
    if (s !== null) hits.push({ choice, score: s })
  }
  // Recency breaks a scoring tie: the already-sorted input makes that stable without a second key.
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map(h => h.choice)
}
