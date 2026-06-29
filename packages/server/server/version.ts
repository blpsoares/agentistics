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

/** Strict semver pattern (major.minor.patch). Non-matching tags (e.g. the
 *  rolling "latest" release tag) are ignored when resolving the newest version. */
const SEMVER_RE = /^\d+\.\d+\.\d+$/

/** Normalizes a tag to a bare semver string, or null if it isn't semver. */
function toSemver(tag: string): string | null {
  const v = tag.replace(/^v/, '').trim()
  return SEMVER_RE.test(v) ? v : null
}

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
    // List releases and pick the highest *semver* tag. We can't use
    // /releases/latest because this repo also publishes a rolling "latest"
    // tagged release, which /releases/latest returns (tag_name "latest" is not
    // semver and would never compare as an update).
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': `agentistics/${CURRENT_VERSION}`,
        },
        signal: AbortSignal.timeout(6000),
      },
    )
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)
    const releases = await resp.json() as Array<{ tag_name: string; draft?: boolean; prerelease?: boolean }>
    const latest = releases
      .filter(r => !r.draft && !r.prerelease)
      .map(r => toSemver(r.tag_name))
      .filter((v): v is string => v !== null)
      .sort((a, b) => compareVersions(b, a))[0]
      ?? CURRENT_VERSION
    const hasUpdate = compareVersions(latest, CURRENT_VERSION) > 0
    _cache = { latest, hasUpdate, fetchedAt: now }
    return { current: CURRENT_VERSION, latest, hasUpdate }
  } catch {
    // Network unavailable or rate-limited — silently skip
    return { current: CURRENT_VERSION, latest: CURRENT_VERSION, hasUpdate: false }
  }
}
