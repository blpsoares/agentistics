import type { SessionMeta } from '@agentistics/core'

/** Pure: parse a Codex rollout JSONL string into a normalized SessionMeta.
 *  Returns null when the content has no usable lines. */
export function parseCodexRollout(content: string, fallbackId: string): SessionMeta | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  let sessionId = ''
  let cwd = ''
  let startTime = ''
  let endTime = ''
  let model: string | undefined
  let inputTokens = 0
  let outputTokens = 0
  let cacheRead = 0
  let userMessages = 0
  let assistantMessages = 0
  let usesWebSearch = false
  const toolCounts: Record<string, number> = {}

  for (const raw of lines) {
    let e: any
    try { e = JSON.parse(raw) } catch { continue }
    const outer = e.type as string | undefined
    const data = (e.payload && typeof e.payload === 'object') ? e.payload : e
    const wrapped = outer === 'event_msg' || outer === 'response_item'
    const type = wrapped ? (data.type as string | undefined) : outer

    if (type === 'session_meta') {
      sessionId = data.id ?? sessionId
      cwd = data.cwd ?? cwd
      startTime = data.timestamp ?? startTime
    } else if (type === 'turn_context') {
      if (typeof data.model === 'string') model = data.model
    } else if (type === 'token_count') {
      const u = data.info?.total_token_usage ?? data.total_token_usage
      if (u) {
        const cached = u.cached_input_tokens ?? 0
        const totalInput = u.input_tokens ?? 0
        inputTokens = Math.max(0, totalInput - cached)
        cacheRead = cached
        outputTokens = u.output_tokens ?? outputTokens
      }
    } else if (type === 'user_message') {
      userMessages++
    } else if (type === 'agent_message') {
      assistantMessages++
    }

    if (type && type.endsWith('_call')) {
      toolCounts[type] = (toolCounts[type] ?? 0) + 1
      if (type === 'web_search_call') usesWebSearch = true
    }
    if (typeof e.timestamp === 'string') endTime = e.timestamp
  }

  if (!startTime && lines[0] !== undefined) {
    const firstTs = (JSON.parse(lines[0]) as Record<string, unknown>).timestamp
    if (typeof firstTs === 'string') startTime = firstTs
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
    first_prompt: '',
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: usesWebSearch,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: [],
    user_message_timestamps: [],
    model,
    harness: 'codex',
    _source: 'jsonl',
  }
}
