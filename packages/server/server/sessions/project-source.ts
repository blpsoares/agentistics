/**
 * project-source.ts — where the wizard's candidates come from.
 *
 * The LOCAL consolidate store, read directly rather than through the API. That is the whole point:
 * the control center has to work with the server stopped, which is precisely the state a user is
 * most likely to be in when they open it to start something.
 *
 * Cached in process with a TTL because the wizard opening is the only thing that reads this — never
 * the five-second poll — and a user who opens it twice in a minute should not pay for the walk
 * twice.
 */

import { stat } from 'node:fs/promises'
import { loadConsolidated } from '../consolidate'
import {
  buildCandidates, searchCandidates, withFixedCandidates, type ProjectCandidate,
} from './project-search'

/** Long enough that reopening the wizard is instant, short enough that a repo used five minutes ago
 *  shows up without restarting the control center. */
const CACHE_TTL_MS = 60_000

let cache: { at: number; candidates: ProjectCandidate[] } | null = null

async function historyCandidates(): Promise<ProjectCandidate[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.candidates
  let candidates: ProjectCandidate[]
  try {
    candidates = buildCandidates([...(await loadConsolidated()).values()])
  } catch {
    // A store that cannot be read is a wizard with no history, never a wizard that fails to open:
    // the current directory alone is enough to start a session, which is the common case anyway.
    candidates = []
  }
  cache = { at: now, candidates }
  return candidates
}

/** Is this a directory that exists? The escape hatch for a repository cloned five minutes ago. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The places worth offering for `query`, best first.
 *
 * `cwd` is always a candidate, with or without history — starting where you already are is the
 * single most common thing anyone wants, and routing that through a search would bury it.
 */
export async function findProjects(query: string, cwd: string, limit = 20): Promise<ProjectCandidate[]> {
  const history = await historyCandidates()

  const fixed: ProjectCandidate[] = [{
    path: cwd,
    name: baseName(cwd),
    remote: '',
    lastSeenMs: 0,
    sessions: 0,
    source: 'cwd',
  }]

  // A typed absolute path that exists but has never been used. Checked only when it LOOKS like a
  // path, so an ordinary word never costs a stat.
  const typed = query.trim()
  if (typed.startsWith('/') || typed.startsWith('~')) {
    const path = typed.startsWith('~')
      ? typed.replace(/^~/, process.env.HOME ?? '~')
      : typed
    if (!history.some(c => c.path === path) && await isDirectory(path)) {
      fixed.push({ path, name: baseName(path), remote: '', lastSeenMs: 0, sessions: 0, source: 'typed' })
    }
  }

  return searchCandidates(withFixedCandidates(history, fixed), query, limit)
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? path
}
