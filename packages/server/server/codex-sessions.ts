// packages/server/server/codex-sessions.ts
// Transcript viewer endpoints for Codex sessions — mirrors claude-sessions.ts API shape.
import { join } from 'path'
import { readFile } from 'fs/promises'
import { CODEX_SESSIONS_DIR } from './config'
import { safeReadDir } from './utils'

export type CodexSessionSummary = {
  id: string
  title: string
  project: string
  startTime: string
  messageCount: number
}

export type CodexSessionMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

/** Recursively collect rollout-*.jsonl paths under the given directory. */
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

/** Derive the session id from a rollout file the same way codex-parse.ts does:
 *  prefer session_meta.payload.id; fallback to filename stem. */
function deriveSessionId(lines: string[], fallbackId: string): string {
  for (const raw of lines) {
    let e: any
    try { e = JSON.parse(raw) } catch { continue }
    if (e.type === 'session_meta' && e.payload?.id) return e.payload.id
    // also handle unwrapped session_meta
    if (e.type === 'session_meta' && e.id) return e.id
  }
  return fallbackId
}

export async function listCodexSessions(): Promise<CodexSessionSummary[]> {
  const files = await collectRolloutFiles(CODEX_SESSIONS_DIR)
  const sessions: CodexSessionSummary[] = []

  await Promise.all(files.map(async filePath => {
    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length === 0) return

      const filenameStem = filePath.split('/').pop()?.replace(/\.jsonl$/, '') ?? filePath
      const sessionId = deriveSessionId(lines, filenameStem)

      let title = ''
      let project = ''
      let startTime = ''
      let userMessages = 0

      for (const raw of lines) {
        let e: any
        try { e = JSON.parse(raw) } catch { continue }
        const outer = e.type as string | undefined
        const data = (e.payload && typeof e.payload === 'object') ? e.payload : e
        const wrapped = outer === 'event_msg' || outer === 'response_item'
        const type = wrapped ? (data.type as string | undefined) : outer

        if (type === 'session_meta') {
          if (data.cwd) project = data.cwd
          if (data.timestamp) startTime = data.timestamp
        } else if (type === 'user_message') {
          userMessages++
          const msg = typeof data.message === 'string' ? data.message : ''
          if (!title && msg.trim()) title = msg.slice(0, 120)
          if (!startTime && e.timestamp) startTime = e.timestamp
        }
      }

      if (!title) return // skip sessions with no user message
      sessions.push({ id: sessionId, title, project, startTime, messageCount: userMessages })
    } catch { /* skip unreadable files */ }
  }))

  return sessions.sort((a, b) => b.startTime.localeCompare(a.startTime))
}

/** Build an index of session id → file path for efficient lookup. */
async function buildSessionIndex(): Promise<Map<string, string>> {
  const files = await collectRolloutFiles(CODEX_SESSIONS_DIR)
  const index = new Map<string, string>()

  await Promise.all(files.map(async filePath => {
    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
      const filenameStem = filePath.split('/').pop()?.replace(/\.jsonl$/, '') ?? filePath
      const sessionId = deriveSessionId(lines, filenameStem)
      index.set(sessionId, filePath)
    } catch { /* skip */ }
  }))

  return index
}

export async function getCodexSessionMessages(id: string): Promise<CodexSessionMessage[]> {
  const index = await buildSessionIndex()
  const filePath = index.get(id)
  if (!filePath) return []

  let content: string
  try { content = await readFile(filePath, 'utf-8') }
  catch { return [] }

  const messages: CodexSessionMessage[] = []

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    let e: any
    try { e = JSON.parse(line) } catch { continue }

    const outer = e.type as string | undefined
    if (outer !== 'event_msg') continue

    const data = e.payload
    if (!data || typeof data !== 'object') continue
    const type = data.type as string | undefined
    const lineTs: string | undefined = typeof e.timestamp === 'string' ? e.timestamp : undefined

    if (type === 'user_message') {
      const msg = typeof data.message === 'string' ? data.message.trim() : ''
      if (!msg) continue
      messages.push({ role: 'user', content: msg, timestamp: lineTs })
    } else if (type === 'agent_message') {
      // prefer final_answer phase; include all agent messages in order
      const phase = data.phase as string | undefined
      if (phase && phase !== 'final_answer') continue
      const msg = typeof data.message === 'string' ? data.message.trim() : ''
      if (!msg) continue
      messages.push({ role: 'assistant', content: msg, timestamp: lineTs })
    }
  }

  return messages
}
