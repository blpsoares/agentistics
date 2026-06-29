// packages/server/server/adapters/copilot.ts
import { join } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { SessionMeta } from '@agentistics/core'
import type { HarnessAdapter } from './types'
import { harnessEnabled } from './types'
import { COPILOT_DIR } from '../config'
import { safeReadDir } from '../utils'
import { createLimiter } from '../utils'

const COPILOT_SESSION_STATE_DIR = join(COPILOT_DIR, 'session-state')

export const copilotAdapter: HarnessAdapter = {
  id: 'copilot',
  dataRoot: COPILOT_DIR,
  isAvailable() {
    return harnessEnabled('copilot') && existsSync(COPILOT_SESSION_STATE_DIR)
  },
  async loadSessions(): Promise<SessionMeta[]> {
    const { parseCopilotEvents } = await import('./copilot-parse')
    const sessionDirs = await safeReadDir(COPILOT_SESSION_STATE_DIR)
    const limit = createLimiter(20)
    const sessions = await Promise.all(sessionDirs.map(dirName => limit(async () => {
      const eventsFile = join(COPILOT_SESSION_STATE_DIR, dirName, 'events.jsonl')
      if (!existsSync(eventsFile)) return null
      const content = await readFile(eventsFile, 'utf-8').catch(() => '')
      return parseCopilotEvents(content, dirName)
    })))
    return sessions.filter((s): s is SessionMeta => s !== null && !!s.start_time)
  },
}
