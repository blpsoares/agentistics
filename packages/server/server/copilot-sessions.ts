// packages/server/server/copilot-sessions.ts
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { COPILOT_DIR } from './config'
import { safeReadDir } from './utils'

const COPILOT_SESSION_STATE_DIR = join(COPILOT_DIR, 'session-state')

export type CopilotSessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  model: string
}

export type CopilotSessionMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/** List all Copilot sessions that have an events.jsonl file. */
export async function listCopilotSessions(): Promise<CopilotSessionSummary[]> {
  if (!existsSync(COPILOT_SESSION_STATE_DIR)) return []

  const dirNames = await safeReadDir(COPILOT_SESSION_STATE_DIR)
  const sessions: CopilotSessionSummary[] = []

  for (const dirName of dirNames) {
    const eventsFile = join(COPILOT_SESSION_STATE_DIR, dirName, 'events.jsonl')
    if (!existsSync(eventsFile)) continue

    let content: string
    try { content = await readFile(eventsFile, 'utf-8') }
    catch { continue }

    let sessionId = ''
    let firstTs = ''
    let lastTs = ''
    let title = ''
    let userMessages = 0
    let model = ''

    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      let e: any
      try { e = JSON.parse(line) } catch { continue }

      const type = e.type as string | undefined
      const data = (e.data && typeof e.data === 'object') ? e.data : {}
      const ts: string | undefined = typeof e.timestamp === 'string' ? e.timestamp : undefined

      if (ts) { if (!firstTs) firstTs = ts; lastTs = ts }

      if (type === 'session.start') {
        // session_id derivation mirrors copilot-parse.ts: data.sessionId, fallback to dir name
        sessionId = (typeof data.sessionId === 'string' ? data.sessionId : '') || dirName
        if (typeof data.startTime === 'string' && !firstTs) firstTs = data.startTime
      } else if (type === 'user.message') {
        userMessages++
        if (!title && typeof data.content === 'string') {
          title = data.content.trim().slice(0, 120)
        }
      } else if (type === 'session.model_change' || type === 'session.shutdown') {
        if (!model && typeof data.currentModel === 'string') {
          model = data.currentModel
        }
      }
    }

    if (!sessionId) sessionId = dirName
    if (!title) continue

    sessions.push({
      id: sessionId,
      title,
      createdAt: firstTs,
      updatedAt: lastTs || firstTs,
      messageCount: userMessages,
      model,
    })
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Return ordered messages for the given Copilot session id.
 *
 * The id is the same value produced by copilot-parse.ts:
 *   session.start data.sessionId, falling back to the directory name (UUID).
 * We first try to find a dir whose session.start.sessionId matches, then fall
 * back to treating the id as the dir name directly.
 */
export async function getCopilotSessionMessages(id: string): Promise<CopilotSessionMessage[]> {
  if (!existsSync(COPILOT_SESSION_STATE_DIR)) return []

  // Resolve which directory contains the session
  const eventsFile = await resolveEventsFile(id)
  if (!eventsFile) return []

  let content: string
  try { content = await readFile(eventsFile, 'utf-8') }
  catch { return [] }

  const messages: CopilotSessionMessage[] = []

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }

    const type = e.type as string | undefined
    const data = (e.data && typeof e.data === 'object') ? e.data : {}
    const tsRaw: string | undefined = typeof e.timestamp === 'string' ? e.timestamp : undefined
    const ts: number = tsRaw ? (new Date(tsRaw).getTime() || Date.now()) : Date.now()

    if (type === 'user.message') {
      const content = typeof data.content === 'string' ? data.content.trim() : ''
      if (content) {
        messages.push({ role: 'user', content, timestamp: ts })
      }
    } else if (type === 'assistant.message') {
      // data.content is the plain text reply from the assistant
      const content = typeof data.content === 'string' ? data.content.trim() : ''
      if (content) {
        messages.push({ role: 'assistant', content, timestamp: ts })
      }
    }
  }

  return messages
}

/** Find the events.jsonl path for a given session id. */
async function resolveEventsFile(id: string): Promise<string | null> {
  // Fast path: id is the directory name itself
  const directPath = join(COPILOT_SESSION_STATE_DIR, id, 'events.jsonl')
  if (existsSync(directPath)) return directPath

  // Slow path: scan dirs and match session.start.data.sessionId
  const dirNames = await safeReadDir(COPILOT_SESSION_STATE_DIR)
  for (const dirName of dirNames) {
    const eventsFile = join(COPILOT_SESSION_STATE_DIR, dirName, 'events.jsonl')
    if (!existsSync(eventsFile)) continue
    let content: string
    try { content = await readFile(eventsFile, 'utf-8') }
    catch { continue }
    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      let e: any
      try { e = JSON.parse(line) } catch { continue }
      if (e.type === 'session.start') {
        const sessionId = e.data?.sessionId
        if (sessionId === id) return eventsFile
        break
      }
    }
  }

  return null
}
