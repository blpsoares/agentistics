import type { SessionMeta } from '@agentistics/core'
import type { HarnessAdapter } from './types'
import { harnessEnabled } from './types'
import { CLAUDE_DIR } from '../config'
import { loadSessionMetas, scanProjects } from '../data'

export const claudeAdapter: HarnessAdapter = {
  id: 'claude',
  dataRoot: CLAUDE_DIR,
  // Claude is the baseline harness: always present unless explicitly disabled,
  // with no directory requirement (legacy/missing sessions default to claude,
  // and stats-cache totals are claude). loadSessions() returns [] when ~/.claude
  // is absent, so an empty environment (e.g. CI) is handled gracefully.
  isAvailable() {
    return harnessEnabled('claude')
  },
  async loadSessions(): Promise<SessionMeta[]> {
    const metaMap = await loadSessionMetas()
    const knownIds = new Set(metaMap.keys())
    const { extraSessions } = await scanProjects(knownIds, metaMap)
    const all = [...metaMap.values(), ...extraSessions]
    return all.map(s => (s.harness ? s : { ...s, harness: 'claude' as const }))
  },
}
