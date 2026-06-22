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
  let firstPrompt = ''

  // Enriched fields from session.shutdown (clean-exit only)
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let model: string | undefined = undefined
  let linesAdded = 0
  let linesRemoved = 0
  let filesModified = 0

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
      // Capture first user prompt
      if (!firstPrompt && typeof data.content === 'string') {
        firstPrompt = data.content.trim().slice(0, 500)
      }
    } else if (type === 'assistant.turn_start') {
      assistantTurns++
    } else if (type === 'session.info') {
      if (data.infoType === 'mcp') usesMcp = true
    } else if (type === 'session.error') {
      toolErrors++
    } else if (type === 'session.shutdown') {
      // Extract per-model token metrics — sum across all models present
      const modelMetrics = data.modelMetrics
      if (modelMetrics && typeof modelMetrics === 'object') {
        for (const [, metrics] of Object.entries(modelMetrics) as [string, any][]) {
          const usage = metrics?.usage
          if (usage && typeof usage === 'object') {
            inputTokens += (usage.inputTokens as number | undefined) ?? 0
            outputTokens += (usage.outputTokens as number | undefined) ?? 0
            cacheReadTokens += (usage.cacheReadTokens as number | undefined) ?? 0
            cacheWriteTokens += (usage.cacheWriteTokens as number | undefined) ?? 0
          }
        }
      }
      // Current model at shutdown
      if (typeof data.currentModel === 'string') {
        model = data.currentModel
      }
      // Code changes
      const cc = data.codeChanges
      if (cc && typeof cc === 'object') {
        linesAdded = (cc.linesAdded as number | undefined) ?? 0
        linesRemoved = (cc.linesRemoved as number | undefined) ?? 0
        const fm = cc.filesModified
        filesModified = Array.isArray(fm) ? fm.length : ((fm as number | undefined) ?? 0)
      }
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
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheWriteTokens,
    first_prompt: firstPrompt,
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: toolErrors,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: usesMcp,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: linesAdded,
    lines_removed: linesRemoved,
    files_modified: filesModified,
    message_hours: messageHours,
    user_message_timestamps: userMessageTimestamps,
    model,
    harness: 'copilot',
    _source: 'jsonl',
  }
}
