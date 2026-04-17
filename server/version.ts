import { version as currentVersion } from '../package.json'

export interface VersionInfo {
  current: string
  latest: string | null
  hasUpdate: boolean
  updateCheckedAt: number | null
}

const GITHUB_REPO = 'blpsoares/agentistics'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

let cachedInfo: VersionInfo | null = null
let cacheTimestamp = 0

export async function getVersionInfo(): Promise<VersionInfo> {
  const now = Date.now()
  if (cachedInfo && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedInfo
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { 'User-Agent': 'agentistics-version-check' },
        signal: AbortSignal.timeout(5000),
      }
    )

    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)

    const data = await res.json() as { tag_name?: string }
    const latest = data.tag_name?.replace(/^v/, '') ?? null

    const info: VersionInfo = {
      current: currentVersion,
      latest,
      hasUpdate: latest !== null && latest !== currentVersion,
      updateCheckedAt: now,
    }

    cachedInfo = info
    cacheTimestamp = now
    return info
  } catch {
    const info: VersionInfo = {
      current: currentVersion,
      latest: null,
      hasUpdate: false,
      updateCheckedAt: now,
    }
    cachedInfo = info
    cacheTimestamp = now
    return info
  }
}

export function clearVersionCache() {
  cachedInfo = null
  cacheTimestamp = 0
}
