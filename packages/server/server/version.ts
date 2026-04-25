import { version as CURRENT_VERSION } from '../../../package.json'

export { CURRENT_VERSION }

const GITHUB_REPO = 'blpsoares/agentistics'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface VersionCache {
  latest: string
  hasUpdate: boolean
  fetchedAt: number
}

let _cache: VersionCache | null = null

/** Compares two semver strings. Returns positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface VersionInfo {
  current: string
  latest: string
  hasUpdate: boolean
}

/**
 * Fetches the latest GitHub release and compares with the current version.
 * Results are cached for 1 hour. On network failure, returns hasUpdate: false.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  const now = Date.now()
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return { current: CURRENT_VERSION, latest: _cache.latest, hasUpdate: _cache.hasUpdate }
  }

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': `agentistics/${CURRENT_VERSION}`,
        },
        signal: AbortSignal.timeout(6000),
      },
    )
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)
    const data = await resp.json() as { tag_name: string }
    const latest = data.tag_name.replace(/^v/, '')
    const hasUpdate = compareVersions(latest, CURRENT_VERSION) > 0
    _cache = { latest, hasUpdate, fetchedAt: now }
    return { current: CURRENT_VERSION, latest, hasUpdate }
  } catch {
    // Network unavailable or rate-limited — silently skip
    return { current: CURRENT_VERSION, latest: CURRENT_VERSION, hasUpdate: false }
  }
}
