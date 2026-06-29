import type { SessionMeta } from '@agentistics/core'

/** Pure: parse a Gemini CLI chat file (rich JSON format or JSONL streaming format) into a
 *  normalized SessionMeta. Returns null when the content has no usable data.
 *
 *  Rich JSON format (the real format used by Gemini CLI >= 0.1.x):
 *  - Top-level object: {sessionId, projectHash, startTime, lastUpdated, messages:[...]}
 *  - Each message has: id, timestamp, type ('user'|'gemini'|'info'), content (string or [{text}])
 *  - 'gemini' messages carry: tokens{input,output,cached,thoughts,tool,total}, model, toolCalls[{id,name,...}]
 *
 *  JSONL streaming format (older format, now primarily used for automation stubs):
 *  - Line 0 is a header: {sessionId, projectHash, startTime, lastUpdated, kind}
 *  - Subsequent lines alternate between header state updates and MongoDB-style ops:
 *    {"$set":{"messages":[{id, timestamp, type:"user"|"model"|"gemini"|..., content:[{text}]}]}}
 *  - The messages array is a snapshot; we accumulate all unique messages across all $set lines.
 */
export function parseGeminiChat(
  content: string,
  fallbackId: string,
  projectPath: string,
): SessionMeta | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  const firstChar = trimmed[0]
  if (firstChar !== '{') return null

  const firstNewline = trimmed.indexOf('\n')
  if (firstNewline === -1) {
    // Single-line JSON — rare edge case
    return parseRichJson(trimmed, fallbackId, projectPath)
  }

  // Multi-line: check if it's a rich JSON object (has multiple lines but is still a JSON object)
  // vs a JSONL file (each line is a separate JSON object).
  // Heuristic: try to parse the whole thing as a single JSON object first.
  // If it parses successfully and has a `messages` array → rich JSON.
  // Otherwise fall back to JSONL streaming format.
  let parsed: any
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    parsed = null
  }

  if (parsed !== null && Array.isArray(parsed.messages)) {
    return parseRichJson(trimmed, fallbackId, projectPath)
  }

  // JSONL streaming format
  return parseJsonl(trimmed, fallbackId, projectPath)
}

// ---------------------------------------------------------------------------
// Rich JSON format: {sessionId, startTime, lastUpdated, messages:[...]}
// Each 'gemini' message may carry tokens{input,output,cached,...} and model.
// ---------------------------------------------------------------------------

function parseRichJson(content: string, fallbackId: string, projectPath: string): SessionMeta | null {
  let parsed: any
  try { parsed = JSON.parse(content) } catch { return null }

  const startTime = (parsed.startTime as string | undefined) ?? ''
  const lastUpdated = (parsed.lastUpdated as string | undefined) ?? ''

  let userMessages = 0
  let assistantMessages = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheRead = 0
  let model: string | undefined
  let firstPrompt = ''
  const messageHours: number[] = []
  const userMessageTimestamps: string[] = []
  const toolCounts: Record<string, number> = {}
  let hasGenuineContent = false

  if (Array.isArray(parsed.messages)) {
    for (const msg of parsed.messages) {
      const msgType = msg.type as string | undefined
      const timestamp = msg.timestamp as string | undefined

      if (msgType === 'gemini') {
        // Extract token data from the rich format
        const tokens = msg.tokens
        if (tokens && typeof tokens === 'object') {
          inputTokens += (tokens.input as number | undefined) ?? 0
          outputTokens += (tokens.output as number | undefined) ?? 0
          cacheRead += (tokens.cached as number | undefined) ?? 0
        }

        // Track model (last seen wins, all should be the same)
        if (typeof msg.model === 'string' && msg.model) {
          model = msg.model
        }

        // Extract tool call names
        if (Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            const name = tc.name as string | undefined
            if (name) {
              toolCounts[name] = (toolCounts[name] ?? 0) + 1
            }
          }
        }

        hasGenuineContent = true
        assistantMessages++

        if (timestamp) {
          const h = new Date(timestamp).getUTCHours()
          if (!isNaN(h)) messageHours.push(h)
        }
      } else if (msgType === 'user') {
        const text = extractMessageText(msg)
        if (isGenuineUserMessage(text)) {
          hasGenuineContent = true
          userMessages++

          if (!firstPrompt && text) {
            // Use displayContent if available (stripped of injected file contents)
            const displayText = extractDisplayText(msg)
            firstPrompt = (displayText || text).slice(0, 200)
          }

          if (timestamp) {
            userMessageTimestamps.push(timestamp)
            const h = new Date(timestamp).getUTCHours()
            if (!isNaN(h)) messageHours.push(h)
          }
        }
      }
      // 'info' messages are skipped entirely
    }
  }

  if (!hasGenuineContent) return null

  const durationMinutes = startTime && lastUpdated
    ? Math.max(0, (new Date(lastUpdated).getTime() - new Date(startTime).getTime()) / 60000)
    : 0

  return {
    session_id: fallbackId,
    project_path: projectPath,
    start_time: startTime || lastUpdated || '',
    end_time: lastUpdated || undefined,
    duration_minutes: durationMinutes,
    user_message_count: userMessages,
    assistant_message_count: assistantMessages,
    tool_counts: toolCounts,
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 0,
    first_prompt: firstPrompt,
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
    model,
    harness: 'gemini',
    _source: 'jsonl',
  }
}

// ---------------------------------------------------------------------------
// JSONL streaming format (automation stubs / bootstrap files)
// ---------------------------------------------------------------------------

function parseJsonl(content: string, fallbackId: string, projectPath: string): SessionMeta | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  let startTime = ''
  let lastUpdated = ''

  // Accumulate unique messages by id across all $set snapshots
  const seenIds = new Set<string>()
  const allMessages: Array<{ type: string; timestamp?: string; text?: string }> = []

  for (const raw of lines) {
    let parsed: any
    try { parsed = JSON.parse(raw) } catch { continue }

    // Header line: {sessionId, projectHash, startTime, lastUpdated, kind}
    if (parsed.sessionId !== undefined || parsed.startTime !== undefined) {
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
        const text = extractMessageText(msg)
        if (id) {
          if (!seenIds.has(id)) {
            seenIds.add(id)
            allMessages.push({ type: msg.type as string, timestamp: msg.timestamp as string | undefined, text })
          }
        } else {
          // No id: always include (rare case)
          allMessages.push({ type: msg.type as string, timestamp: msg.timestamp as string | undefined, text })
        }
      }
    }
  }

  return buildJsonlSessionMeta({
    projectPath,
    startTime,
    endTime: lastUpdated,
    messages: allMessages,
    fallbackId,
  })
}

// ---------------------------------------------------------------------------
// Shared builder for JSONL streaming format
// ---------------------------------------------------------------------------

interface JsonlParsedData {
  projectPath: string
  startTime: string
  endTime: string
  messages: Array<{ type: string; timestamp?: string; text?: string }>
  fallbackId: string
}

function buildJsonlSessionMeta(data: JsonlParsedData): SessionMeta | null {
  const { projectPath, startTime, endTime, messages } = data

  let userMessages = 0
  let assistantMessages = 0
  const messageHours: number[] = []
  const userMessageTimestamps: string[] = []
  let hasGenuineContent = false

  for (const msg of messages) {
    const isUser = msg.type === 'user'
    const isAssistant = msg.type === 'model' || msg.type === 'gemini'

    let counted = false
    if (isAssistant) {
      hasGenuineContent = true
      assistantMessages++
      counted = true
    } else if (isUser && isGenuineUserMessage(msg.text ?? '')) {
      hasGenuineContent = true
      userMessages++
      if (msg.timestamp) userMessageTimestamps.push(msg.timestamp)
      counted = true
    }

    if (counted && msg.timestamp) {
      const h = new Date(msg.timestamp).getUTCHours()
      if (!isNaN(h)) messageHours.push(h)
    }
  }

  if (!hasGenuineContent) return null

  const durationMinutes = startTime && endTime
    ? Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000)
    : 0

  return {
    session_id: data.fallbackId,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the text content from a message object (handles both array and string forms). */
function extractMessageText(msg: any): string {
  const content = msg.content
  if (Array.isArray(content)) {
    return content.map((c: any) => (typeof c === 'object' && c !== null ? c.text ?? '' : '')).join('')
  }
  if (typeof content === 'string') return content
  return ''
}

/** Extract the display text from a message (user-visible portion only, skipping injected context). */
function extractDisplayText(msg: any): string {
  const display = msg.displayContent
  if (Array.isArray(display)) {
    return display.map((c: any) => (typeof c === 'object' && c !== null ? c.text ?? '' : '')).join('')
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
