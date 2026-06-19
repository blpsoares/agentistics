// packages/server/server/adapters/codex.ts
import { join } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { SessionMeta } from '@agentistics/core'
import type { HarnessAdapter } from './types'
import { harnessEnabled } from './types'
import { CODEX_SESSIONS_DIR } from '../config'
import { createLimiter, safeReadDir } from '../utils'

/** Recursively collect rollout-*.jsonl paths under ~/.codex/sessions/YYYY/MM/DD/. */
async function collectRolloutFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await safeReadDir(dir)
  await Promise.all(entries.map(async name => {
    const full = join(dir, name)
    if (name.endsWith('.jsonl') && name.startsWith('rollout-')) {
      out.push(full)
    } else if (!name.includes('.')) {
      // year/month/day directories have no extension
      out.push(...await collectRolloutFiles(full))
    }
  }))
  return out
}

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  isAvailable() {
    return harnessEnabled('codex') && existsSync(CODEX_SESSIONS_DIR)
  },
  async loadSessions(): Promise<SessionMeta[]> {
    const { parseCodexRollout } = await import('./codex-parse')
    const files = await collectRolloutFiles(CODEX_SESSIONS_DIR)
    const limit = createLimiter(20)
    const sessions = await Promise.all(files.map(f => limit(async () => {
      const content = await readFile(f, 'utf-8').catch(() => '')
      const fallbackId = f.split('/').pop()?.replace(/\.jsonl$/, '') ?? f
      return parseCodexRollout(content, fallbackId)
    })))
    return sessions.filter((s): s is SessionMeta => s !== null && !!s.start_time)
  },
}
