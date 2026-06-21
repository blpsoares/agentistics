import type { SessionMeta } from '@agentistics/core'

/** Pure: parse a Gemini CLI chat file (JSONL streaming format or legacy JSON) into a
 *  normalized SessionMeta. Returns null when the content has no usable data.
 *
 *  Gemini JSONL format:
 *  - Line 0 is a header: {sessionId, projectHash, startTime, lastUpdated, kind}
 *  - Subsequent lines alternate between header state updates and MongoDB-style ops:
 *    {"$set":{"messages":[{id, timestamp, type:"user"|"model"|"gemini"|..., content:[{text}]}]}}
 *  - The messages array is a snapshot; we accumulate all unique messages across all $set lines.
 *
 *  Gemini legacy JSON format:
 *  - Top-level object: {sessionId, startTime, lastUpdated, messages:[...]}
 *
 *  Token/cost/model data is not present in Gemini files — those fields stay 0/undefined.
 */
export function parseGeminiChat(
  content: string,
  fallbackId: string,
  projectPath: string,
): SessionMeta | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  // Attempt to detect format: JSONL (multiple lines) vs single JSON object
  const firstChar = trimmed[0]
  if (firstChar === '{') {
    // Could be single-object JSON (legacy) or JSONL with first line only
    const firstNewline = trimmed.indexOf('\n')
    if (firstNewline === -1) {
      // Single-line: try legacy JSON
      return parseLegacyJson(trimmed, fallbackId, projectPath)
    }

    // Multi-line: JSONL streaming format
    return parseJsonl(trimmed, fallbackId, projectPath)
  }

  return null
}

// ---------------------------------------------------------------------------
// JSONL streaming format
// ---------------------------------------------------------------------------

function parseJsonl(content: string, fallbackId: string, projectPath: string): SessionMeta | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  let sessionId = ''
  let startTime = ''
  let lastUpdated = ''

  // Accumulate unique messages by id across all $set snapshots
  const seenIds = new Set<string>()
  const allMessages: Array<{ type: string; timestamp?: string }> = []

  for (const raw of lines) {
    let parsed: any
    try { parsed = JSON.parse(raw) } catch { continue }

    // Header line: {sessionId, projectHash, startTime, lastUpdated, kind}
    if (parsed.sessionId !== undefined) {
      if (!sessionId && parsed.sessionId) sessionId = parsed.sessionId as string
      if (parsed.startTime) {
        if (!startTime || parsed.startTime < startTime) startTime = parsed.startTime as string
      }
      if (parsed.lastUpdated) {
        if (!lastUpdated || parsed.lastUpdated > lastUpdated) lastUpdated = parsed.lastUpdated as string
      }
      continue
    }

    // MongoDB-style state op: {"$set": {"messages": [...]}}
    const messages = parsed['$set']?.messages
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const id = msg.id as string | undefined
        if (id) {
          if (!seenIds.has(id)) {
            seenIds.add(id)
            allMessages.push({ type: msg.type as string, timestamp: msg.timestamp as string | undefined })
          }
        } else {
          // No id: always include (rare case)
          allMessages.push({ type: msg.type as string, timestamp: msg.timestamp as string | undefined })
        }
      }
    }
  }

  return buildSessionMeta({
    sessionId: sessionId || fallbackId,
    projectPath,
    startTime,
    endTime: lastUpdated,
    messages: allMessages,
    fallbackId,
  })
}

// ---------------------------------------------------------------------------
// Legacy JSON format: {sessionId, startTime, lastUpdated, messages:[...]}
// ---------------------------------------------------------------------------

function parseLegacyJson(content: string, fallbackId: string, projectPath: string): SessionMeta | null {
  let parsed: any
  try { parsed = JSON.parse(content) } catch { return null }

  const sessionId = (parsed.sessionId as string | undefined) || fallbackId
  const startTime = (parsed.startTime as string | undefined) ?? ''
  const lastUpdated = (parsed.lastUpdated as string | undefined) ?? ''
  const messages: Array<{ type: string; timestamp?: string }> = []

  if (Array.isArray(parsed.messages)) {
    for (const msg of parsed.messages) {
      messages.push({ type: msg.type as string, timestamp: msg.timestamp as string | undefined })
    }
  }

  return buildSessionMeta({
    sessionId,
    projectPath,
    startTime,
    endTime: lastUpdated,
    messages,
    fallbackId,
  })
}

// ---------------------------------------------------------------------------
// Shared builder
// ---------------------------------------------------------------------------

interface ParsedData {
  sessionId: string
  projectPath: string
  startTime: string
  endTime: string
  messages: Array<{ type: string; timestamp?: string }>
  fallbackId: string
}

function buildSessionMeta(data: ParsedData): SessionMeta | null {
  const { sessionId, projectPath, startTime, endTime, messages } = data

  let userMessages = 0
  let assistantMessages = 0
  const messageHours: number[] = []
  const userMessageTimestamps: string[] = []

  for (const msg of messages) {
    const isUser = msg.type === 'user'
    const isAssistant = msg.type === 'model' || msg.type === 'gemini'

    if (isUser) {
      userMessages++
      if (msg.timestamp) userMessageTimestamps.push(msg.timestamp)
    } else if (isAssistant) {
      assistantMessages++
    }

    if (msg.timestamp) {
      const h = new Date(msg.timestamp).getUTCHours()
      if (!isNaN(h)) messageHours.push(h)
    }
  }

  const durationMinutes = startTime && endTime
    ? Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000)
    : 0

  return {
    session_id: sessionId,
    project_path: projectPath,
    start_time: startTime || endTime || '',
    end_time: endTime || undefined,
    duration_minutes: durationMinutes,
    user_message_count: userMessages,
    assistant_message_count: assistantMessages,
    tool_counts: {},
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    first_prompt: '',
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: messageHours,
    user_message_timestamps: userMessageTimestamps,
    model: undefined,
    harness: 'gemini',
    _source: 'jsonl',
  }
}
