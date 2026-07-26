import { version as CURRENT_VERSION } from '../../../package.json'

export { CURRENT_VERSION }

const GITHUB_REPO = 'blpsoares/agentistics'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface VersionCache {
  latest: string
  hasUpdate: boolean
  critical: boolean
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
  /** True when at least one release newer than `current` is flagged critical
   *  (see isCriticalRelease). Critical updates are installed without consent. */
  critical: boolean
}

/** The shape we read from the GitHub releases API (only the fields we use). */
export interface ReleaseLike {
  tag_name: string
  body?: string | null
  draft?: boolean
  prerelease?: boolean
}

/**
 * A release is CRITICAL when its body contains a `[critical]` marker on a line of
 * its own (case-insensitive, surrounding whitespace allowed).
 *
 * The marker deliberately lives in the release BODY, never in the tag: the tag must
 * stay pure semver or the highest-semver selection above would stop recognizing it.
 * Requiring the marker to own its line keeps prose such as "fixes a critical bug"
 * or "[critical] only when X" from triggering an unattended upgrade.
 */
export function isCriticalRelease(body: string | null | undefined): boolean {
  if (!body) return false
  return body.split(/\r?\n/).some(line => /^[ \t]*\[critical\][ \t]*$/i.test(line))
}

/**
 * Pure resolution of a GitHub release list against the installed version.
 *
 * Drafts and prereleases are ignored, as are non-semver tags (the repo also publishes a
 * rolling "latest" release). `critical` looks at EVERY release newer than the installed
 * one — not just the newest — so a critical fix released before a later optional one is
 * still installed automatically.
 */
export function resolveLatestRelease(
  releases: ReleaseLike[],
  current: string,
): { latest: string; hasUpdate: boolean; critical: boolean } {
  const published = releases
    .filter(r => !r.draft && !r.prerelease)
    .map(r => ({ version: toSemver(r.tag_name), body: r.body ?? null }))
    .filter((r): r is { version: string; body: string | null } => r.version !== null)

  const latest = published
    .map(r => r.version)
    .sort((a, b) => compareVersions(b, a))[0]
    ?? current
  const hasUpdate = compareVersions(latest, current) > 0
  const critical = hasUpdate && published.some(
    r => compareVersions(r.version, current) > 0 && isCriticalRelease(r.body),
  )
  return { latest, hasUpdate, critical }
}

/**
 * Fetches the latest GitHub release and compares with the current version.
 * Results are cached for 1 hour. On network failure, returns hasUpdate: false.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  const now = Date.now()
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return {
      current: CURRENT_VERSION,
      latest: _cache.latest,
      hasUpdate: _cache.hasUpdate,
      critical: _cache.critical,
    }
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
    const releases = await resp.json() as ReleaseLike[]
    const { latest, hasUpdate, critical } = resolveLatestRelease(releases, CURRENT_VERSION)
    _cache = { latest, hasUpdate, critical, fetchedAt: now }
    return { current: CURRENT_VERSION, latest, hasUpdate, critical }
  } catch {
    // Network unavailable or rate-limited — silently skip
    return { current: CURRENT_VERSION, latest: CURRENT_VERSION, hasUpdate: false, critical: false }
  }
}

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
let _recheckTimer: ReturnType<typeof setInterval> | null = null
/** Latest version we've already broadcast, so we don't re-notify every tick. */
let _lastBroadcastVersion: string | null = null

/**
 * Starts a best-effort periodic re-check (default every 6h) so a long-running
 * daemon surfaces new releases without a page reload. Each tick refreshes the
 * cache via getVersionInfo and, when an update is newly available (a version we
 * haven't broadcast yet), pushes an SSE `app.update_available` notification to
 * connected dashboards. Idempotent — calling twice is a no-op. Never throws.
 */
export function startVersionRecheck(intervalMs: number = RECHECK_INTERVAL_MS): void {
  if (_recheckTimer) return
  const tick = async () => {
    try {
      const info = await getVersionInfo()
      if (info.hasUpdate && info.latest !== _lastBroadcastVersion) {
        _lastBroadcastVersion = info.latest
        const { broadcastNotification } = await import('./sse')
        broadcastNotification({ type: 'info', code: 'app.update_available', meta: { version: info.latest } })
      }
    } catch { /* best-effort — never crash the daemon */ }
  }
  _recheckTimer = setInterval(() => { void tick() }, intervalMs)
  // Don't keep the process alive solely for this timer.
  if (typeof _recheckTimer === 'object' && _recheckTimer && 'unref' in _recheckTimer) {
    ;(_recheckTimer as { unref: () => void }).unref()
  }
  // Kick off an initial check shortly after boot (deferred so startup isn't blocked).
  setTimeout(() => { void tick() }, 30_000)
}
