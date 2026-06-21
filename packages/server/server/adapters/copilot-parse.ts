import type { SessionMeta } from '@agentistics/core'

/** Pure: parse a Copilot events.jsonl string into a normalized SessionMeta.
 *  Returns null when the content has no usable lines. */
export function parseCopilotEvents(content: string, fallbackId: string): SessionMeta | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  let sessionId = ''
  let cwd = ''
  let startTime = ''
  let endTime = ''
  let userMessages = 0
  let assistantTurns = 0
  let toolErrors = 0
  let usesMcp = false
  const userMessageTimestamps: string[] = []
  const messageHours: number[] = []

  for (const raw of lines) {
    let e: any
    try { e = JSON.parse(raw) } catch { continue }

    const type = e.type as string | undefined
    const data = (e.data && typeof e.data === 'object') ? e.data : {}
    const ts: string | undefined = typeof e.timestamp === 'string' ? e.timestamp : undefined

    if (ts) {
      if (!startTime) startTime = ts
      endTime = ts
    }

    if (type === 'session.start') {
      sessionId = data.sessionId ?? sessionId
      // prefer startTime from data if present (more accurate)
      if (typeof data.startTime === 'string') startTime = data.startTime
      const ctx = data.context
      if (ctx && typeof ctx === 'object') {
        cwd = ctx.cwd ?? cwd
      }
    } else if (type === 'user.message') {
      userMessages++
      if (ts) {
        userMessageTimestamps.push(ts)
        messageHours.push(new Date(ts).getUTCHours())
      }
    } else if (type === 'assistant.turn_start') {
      assistantTurns++
    } else if (type === 'session.info') {
      if (data.infoType === 'mcp') usesMcp = true
    } else if (type === 'session.error') {
      toolErrors++
    }
  }

  const durationMinutes = startTime && endTime
    ? Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000)
    : 0

  return {
    session_id: sessionId || fallbackId,
    project_path: cwd,
    start_time: startTime || endTime || '',
    end_time: endTime || undefined,
    duration_minutes: durationMinutes,
    user_message_count: userMessages,
    assistant_message_count: assistantTurns,
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
    tool_errors: toolErrors,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: usesMcp,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: messageHours,
    user_message_timestamps: userMessageTimestamps,
    model: undefined,
    harness: 'copilot',
    _source: 'jsonl',
  }
}
