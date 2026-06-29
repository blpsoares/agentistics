// packages/server/server/gemini-sessions.ts
//
// Gemini CLI transcript reader — lists sessions and returns messages from the rich JSON chat
// files stored in ~/.gemini/tmp/<projectDirName>/chats/*.json.
//
// Contract: shapes match claude-sessions.ts so a generalized frontend viewer can consume
// all harnesses uniformly.
//   Session list entry: { id, title, project, startTime, messageCount }
//   Message: { role: 'user' | 'assistant', content: string, timestamp?: string }
//
// Session id derivation mirrors gemini-parse.ts's fallbackId: '<dirName>/<fileBase>'
// (e.g. 'prontuario/session-2026-02-22T23-58-6fa861f9').

import { join, basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { GEMINI_DIR } from './config'
import { createLimiter, safeReadDir, safeReadJson } from './utils'

const GEMINI_TMP_DIR = join(GEMINI_DIR, 'tmp')
const GEMINI_PROJECTS_FILE = join(GEMINI_DIR, 'projects.json')

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GeminiSessionSummary = {
  id: string       // '<dirName>/<fileBase>' — same as SessionMeta.session_id
  title: string    // first genuine user message (truncated to 120 chars)
  project: string  // absolute project path resolved from projects.json, or ''
  startTime: string
  messageCount: number  // genuine user message count
}

export type GeminiSessionMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrored from gemini-parse.ts to stay in sync)
// ---------------------------------------------------------------------------

/** Build a map from Gemini short name → absolute project path by reading projects.json.
 *  projects.json structure: { "projects": { "/abs/path": "shortname", ... } } */
async function buildProjectMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const data = await safeReadJson<{ projects?: Record<string, string> }>(GEMINI_PROJECTS_FILE)
  if (data?.projects) {
    for (const [absPath, shortName] of Object.entries(data.projects)) {
      map.set(shortName, absPath)
    }
  }
  return map
}

/** Extract text content from a message object (handles array-of-{text} or plain string). */
function extractMessageText(msg: Record<string, unknown>): string {
  const content = msg.content
  if (Array.isArray(content)) {
    return (content as Record<string, unknown>[])
      .map(c => (typeof c === 'object' && c !== null ? (c.text as string | undefined) ?? '' : ''))
      .join('')
  }
  if (typeof content === 'string') return content
  return ''
}

/** Extract display text from a message (user-visible portion, skipping injected context). */
function extractDisplayText(msg: Record<string, unknown>): string {
  const display = msg.displayContent
  if (Array.isArray(display)) {
    return (display as Record<string, unknown>[])
      .map(c => (typeof c === 'object' && c !== null ? (c.text as string | undefined) ?? '' : ''))
      .join('')
  }
  return ''
}

/** Returns true when a user message is a genuine user message (not a bootstrap injection). */
function isGenuineUserMessage(text: string): boolean {
  if (!text || text.trim() === '') return false
  if (text.includes('<session_context>')) return false
  if (text.includes('<environment_context>')) return false
  return true
}

// ---------------------------------------------------------------------------
// File-walk helpers (mirrored from gemini adapter to keep id derivation in sync)
// ---------------------------------------------------------------------------

interface ChatFileEntry {
  file: string
  dirName: string
  projectPath: string
}

async function collectAllChatFiles(): Promise<ChatFileEntry[]> {
  const projectMap = await buildProjectMap()
  const topDirs = await safeReadDir(GEMINI_TMP_DIR)
  const out: ChatFileEntry[] = []

  await Promise.all(topDirs.map(async dirName => {
    if (dirName === 'bin') return
    const dirPath = join(GEMINI_TMP_DIR, dirName)
    const projectPath = projectMap.get(dirName) ?? ''

    const chatsDir = join(dirPath, 'chats')
    const entries = await safeReadDir(chatsDir)
    for (const name of entries) {
      if (name.endsWith('.jsonl') || name.endsWith('.json')) {
        out.push({ file: join(chatsDir, name), dirName, projectPath })
      }
    }
  }))

  return out
}

/** Derive the fallbackId exactly as gemini-parse.ts / gemini adapter do. */
function deriveFallbackId(file: string, dirName: string): string {
  const fileBase = basename(file).replace(/\.(jsonl|json)$/, '')
  return `${dirName}/${fileBase}`
}

// ---------------------------------------------------------------------------
// Rich-JSON parser for list (summary only)
// ---------------------------------------------------------------------------

interface RichParsed {
  startTime: string
  firstPrompt: string
  userMessageCount: number
  hasGenuineContent: boolean
}

function parseRichJsonForSummary(parsed: Record<string, unknown>): RichParsed {
  const startTime = (parsed.startTime as string | undefined) ?? ''
  let firstPrompt = ''
  let userMessageCount = 0
  let hasGenuineContent = false

  if (Array.isArray(parsed.messages)) {
    for (const msg of parsed.messages as Record<string, unknown>[]) {
      const msgType = msg.type as string | undefined

      if (msgType === 'gemini') {
        hasGenuineContent = true
      } else if (msgType === 'user') {
        const text = extractMessageText(msg)
        if (isGenuineUserMessage(text)) {
          hasGenuineContent = true
          userMessageCount++
          if (!firstPrompt) {
            const displayText = extractDisplayText(msg)
            firstPrompt = (displayText || text).slice(0, 120)
          }
        }
      }
      // 'info' messages are skipped
    }
  }

  return { startTime, firstPrompt, userMessageCount, hasGenuineContent }
}

// ---------------------------------------------------------------------------
// JSONL-streaming summary parser (a2a stubs — used only to filter them out)
// ---------------------------------------------------------------------------

function parseJsonlForSummary(content: string): RichParsed {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  let startTime = ''
  let hasGenuineContent = false

  for (const raw of lines) {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { continue }

    if (parsed.startTime) startTime = parsed.startTime as string

    const messages = (parsed['$set'] as Record<string, unknown> | undefined)?.messages
    if (Array.isArray(messages)) {
      for (const msg of messages as Record<string, unknown>[]) {
        const isAssistant = msg.type === 'model' || msg.type === 'gemini'
        const isUser = msg.type === 'user'
        if (isAssistant) { hasGenuineContent = true }
        else if (isUser && isGenuineUserMessage(extractMessageText(msg))) { hasGenuineContent = true }
      }
    }
  }

  return { startTime, firstPrompt: '', userMessageCount: 0, hasGenuineContent }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all Gemini sessions that have genuine content (excludes a2a stubs / info-only). */
export async function listGeminiSessions(): Promise<GeminiSessionSummary[]> {
  const files = await collectAllChatFiles()
  const limit = createLimiter(20)

  const results = await Promise.all(files.map(({ file, dirName, projectPath }) =>
    limit(async () => {
      const content = await readFile(file, 'utf-8').catch(() => '')
      if (!content.trim()) return null

      const id = deriveFallbackId(file, dirName)

      let summary: RichParsed
      let parsed: Record<string, unknown> | null = null
      try { parsed = JSON.parse(content.trim()) as Record<string, unknown> } catch { parsed = null }

      if (parsed !== null && Array.isArray(parsed.messages)) {
        // Rich JSON format
        summary = parseRichJsonForSummary(parsed)
      } else {
        // JSONL streaming (a2a stubs) — almost always no genuine content
        summary = parseJsonlForSummary(content)
      }

      if (!summary.hasGenuineContent) return null

      return {
        id,
        title: summary.firstPrompt || id,
        project: projectPath,
        startTime: summary.startTime,
        messageCount: summary.userMessageCount,
      } satisfies GeminiSessionSummary
    })
  ))

  return (results.filter(Boolean) as GeminiSessionSummary[])
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
}

/** Return the messages for a Gemini session by its id ('<dirName>/<fileBase>'). */
export async function getGeminiSessionMessages(id: string): Promise<GeminiSessionMessage[]> {
  // Parse the id back into dirName + fileBase
  const slashIdx = id.indexOf('/')
  if (slashIdx === -1) return []

  const dirName = id.slice(0, slashIdx)
  const fileBase = id.slice(slashIdx + 1)

  // Try both extensions
  let content = ''
  for (const ext of ['.json', '.jsonl']) {
    const candidate = join(GEMINI_TMP_DIR, dirName, 'chats', fileBase + ext)
    content = await readFile(candidate, 'utf-8').catch(() => '')
    if (content) break
  }

  if (!content.trim()) return []

  let parsed: Record<string, unknown> | null = null
  try { parsed = JSON.parse(content.trim()) as Record<string, unknown> } catch { parsed = null }

  if (parsed !== null && Array.isArray(parsed.messages)) {
    return extractRichJsonMessages(parsed.messages as Record<string, unknown>[])
  }

  // JSONL streaming format — gather messages from $set snapshots
  return extractJsonlMessages(content)
}

// ---------------------------------------------------------------------------
// Message extraction helpers
// ---------------------------------------------------------------------------

function extractRichJsonMessages(messages: Record<string, unknown>[]): GeminiSessionMessage[] {
  const out: GeminiSessionMessage[] = []

  for (const msg of messages) {
    const msgType = msg.type as string | undefined
    const tsRaw = msg.timestamp as string | undefined
    const timestamp: number = tsRaw ? (new Date(tsRaw).getTime() || Date.now()) : Date.now()

    if (msgType === 'user') {
      const text = extractMessageText(msg)
      if (!isGenuineUserMessage(text)) continue  // skip injected context messages

      // Prefer displayContent (injected file context stripped out)
      const displayText = extractDisplayText(msg)
      const content = displayText || text
      out.push({ role: 'user', content, timestamp })

    } else if (msgType === 'gemini') {
      const text = extractMessageText(msg)
      if (!text && !msg.toolCalls) continue  // skip empty assistant messages
      if (text) {
        out.push({ role: 'assistant', content: text, timestamp })
      }
    }
    // 'info' messages are skipped
  }

  return out
}

function extractJsonlMessages(content: string): GeminiSessionMessage[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const seenIds = new Set<string>()
  const out: GeminiSessionMessage[] = []

  for (const raw of lines) {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { continue }

    const messages = (parsed['$set'] as Record<string, unknown> | undefined)?.messages
    if (!Array.isArray(messages)) continue

    for (const msg of messages as Record<string, unknown>[]) {
      const id = msg.id as string | undefined
      if (id) {
        if (seenIds.has(id)) continue
        seenIds.add(id)
      }

      const msgType = msg.type as string | undefined
      const tsRaw = msg.timestamp as string | undefined
      const timestamp: number = tsRaw ? (new Date(tsRaw).getTime() || Date.now()) : Date.now()
      const text = extractMessageText(msg)

      if (msgType === 'user') {
        if (!isGenuineUserMessage(text)) continue
        out.push({ role: 'user', content: text, timestamp })
      } else if (msgType === 'model' || msgType === 'gemini') {
        if (!text) continue
        out.push({ role: 'assistant', content: text, timestamp })
      }
    }
  }

  return out
}
