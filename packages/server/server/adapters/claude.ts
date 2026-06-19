import { existsSync } from 'fs'
import type { SessionMeta } from '@agentistics/core'
import type { HarnessAdapter } from './types'
import { harnessEnabled } from './types'
import { CLAUDE_DIR } from '../config'
import { loadSessionMetas, scanProjects } from '../data'

export const claudeAdapter: HarnessAdapter = {
  id: 'claude',
  isAvailable() {
    return harnessEnabled('claude') && existsSync(CLAUDE_DIR)
  },
  async loadSessions(): Promise<SessionMeta[]> {
    const metaMap = await loadSessionMetas()
    const knownIds = new Set(metaMap.keys())
    const { extraSessions } = await scanProjects(knownIds, metaMap)
    const all = [...metaMap.values(), ...extraSessions]
    return all.map(s => (s.harness ? s : { ...s, harness: 'claude' as const }))
  },
}
