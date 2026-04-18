import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { PROJECTS_DIR } from './config'
import { safeReadDir } from './utils'
import { UUID_RE } from './git'

export type ClaudeSessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  model: string
}

export type ClaudeSessionMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tools?: string[]
}

export async function listClaudeSessions(encodedDir: string): Promise<ClaudeSessionSummary[]> {
  const dir = path.join(PROJECTS_DIR, encodedDir)
  const files = await safeReadDir(dir)
  const sessions: ClaudeSessionSummary[] = []

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    const id = file.slice(0, -6)
    if (!UUID_RE.test(id)) continue

    try {
      const content = await readFile(path.join(dir, file), 'utf-8')
      let title = ''
      let firstTs = ''
      let lastTs = ''
      let userMsgCount = 0
      let model = ''

      for (const raw of content.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        try {
          const e = JSON.parse(line) as Record<string, unknown>
          const ts = e.timestamp as string | undefined
          if (ts) { if (!firstTs) firstTs = ts; lastTs = ts }

          if (e.type === 'user') {
            const msgContent = (e.message as Record<string, unknown> | undefined)?.content
            if (typeof msgContent === 'string' && msgContent.trim()) {
              if (!title) title = msgContent.slice(0, 120)
              userMsgCount++
            } else if (Array.isArray(msgContent)) {
              const arr = msgContent as Record<string, unknown>[]
              const isPureToolResult = arr.every(p => p.type === 'tool_result')
              if (!isPureToolResult) {
                const text = arr.find(p => p.type === 'text' && typeof p.text === 'string')?.text as string | undefined
                if (!title && text) title = text.slice(0, 120)
                userMsgCount++
              }
            }
          }

          if (!model && e.type === 'assistant') {
            const m = (e.message as Record<string, unknown> | undefined)?.model
            if (typeof m === 'string' && m.startsWith('claude-')) model = m
          }
        } catch { /* skip malformed lines */ }
      }

      if (!title) continue
      sessions.push({
        id,
        title,
        createdAt: firstTs,
        updatedAt: lastTs || firstTs,
        messageCount: userMsgCount,
        model,
      })
    } catch { /* skip unreadable files */ }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getClaudeSessionMessages(encodedDir: string, sessionId: string): Promise<ClaudeSessionMessage[]> {
  if (!UUID_RE.test(sessionId)) return []
  const dir = path.join(PROJECTS_DIR, encodedDir)
  let content: string
  try { content = await readFile(path.join(dir, `${sessionId}.jsonl`), 'utf-8') }
  catch { return [] }

  const messages: ClaudeSessionMessage[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const e = JSON.parse(line) as Record<string, unknown>
      const ts = e.timestamp ? new Date(e.timestamp as string).getTime() : Date.now()

      if (e.type === 'user') {
        const msgContent = (e.message as Record<string, unknown> | undefined)?.content
        if (typeof msgContent === 'string' && msgContent.trim()) {
          messages.push({ role: 'user', content: msgContent, timestamp: ts })
        } else if (Array.isArray(msgContent)) {
          const arr = msgContent as Record<string, unknown>[]
          const isPureToolResult = arr.every(p => p.type === 'tool_result')
          if (!isPureToolResult) {
            const text = arr.find(p => p.type === 'text' && typeof p.text === 'string')?.text as string | undefined
            if (text) messages.push({ role: 'user', content: text, timestamp: ts })
          }
        }
      } else if (e.type === 'assistant') {
        const msgContent = (e.message as Record<string, unknown> | undefined)?.content
        if (Array.isArray(msgContent)) {
          const textBlock = msgContent.find((p: Record<string, unknown>) => p.type === 'text' && typeof p.text === 'string')
          if (textBlock) {
            const tools = (msgContent as Record<string, unknown>[])
              .filter(p => p.type === 'tool_use' && typeof p.name === 'string')
              .map(p => p.name as string)
            messages.push({
              role: 'assistant',
              content: textBlock.text as string,
              timestamp: ts,
              tools: tools.length > 0 ? tools : undefined,
            })
          }
        }
      }
    } catch { /* skip */ }
  }

  return messages
}
