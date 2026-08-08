import type { SessionMeta, TurnEvent } from '@agentistics/core'
import { activeMinutesOf } from '@agentistics/core'
import { canonicalTool, countGitCommands } from '../harness-activity'

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
  let firstPrompt = ''
  const messageHours: number[] = []
  const userMessageTimestamps: string[] = []
  const toolCounts: Record<string, number> = {}
  let gitCommits = 0, gitPushes = 0
  // Per-turn timeline for computeActiveTime() (docs/harness-contract.md). Codex measures each
  // turn itself: `task_complete.duration_ms`, keyed by the same turn_id as `task_started`.
  const turnEvents: TurnEvent[] = []

  for (const raw of lines) {
    let e: any
    try { e = JSON.parse(raw) } catch { continue }
    const outer = e.type as string | undefined
    const data = (e.payload && typeof e.payload === 'object') ? e.payload : e
    const wrapped = outer === 'event_msg' || outer === 'response_item'
    const type = wrapped ? (data.type as string | undefined) : outer
    const lineTs: string | undefined = typeof e.timestamp === 'string' ? e.timestamp : undefined
    const lineMs = lineTs ? Date.parse(lineTs) : NaN
    let turnEvent: TurnEvent | null = null
    if (!Number.isNaN(lineMs)) {
      turnEvent = { ts: lineMs }
      turnEvents.push(turnEvent)
    }

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
      if (turnEvent) turnEvent.userPrompt = true
      const text = typeof data.message === 'string' ? data.message : ''
      if (!firstPrompt && text) {
        firstPrompt = text.slice(0, 200)
      }
      if (lineTs) {
        userMessageTimestamps.push(lineTs)
        messageHours.push(new Date(lineTs).getHours())
      }
    } else if (type === 'task_complete') {
      // Codex's own measurement of the turn that just ended — authoritative over reconstruction.
      // `completed_at` - `task_started.started_at` (epoch SECONDS) is the same value; duration_ms
      // is preferred because it survives a missing task_started line.
      if (turnEvent && typeof data.duration_ms === 'number') turnEvent.measuredMs = data.duration_ms
    } else if (type === 'agent_message') {
      assistantMessages++
      if (lineTs) {
        messageHours.push(new Date(lineTs).getHours())
      }
    }

    if (type && type.endsWith('_call')) {
      // The NAME is what a tool is; `function_call` is only the envelope it arrived in, and
      // counting that reported every Codex tool as one indistinguishable bucket. `canonicalTool`
      // then puts it in the same bucket as the other harnesses' equivalent.
      const rawName = typeof data.name === 'string' && data.name ? data.name : type
      const toolName = canonicalTool('codex', rawName)
      toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1
      if (type === 'web_search_call') usesWebSearch = true

      // The command it ran, when it ran one. `arguments` is a JSON STRING; a malformed one is
      // skipped rather than thrown on — one unreadable call must not lose the whole session.
      if (toolName === 'Bash' && typeof data.arguments === 'string') {
        let cmd = ''
        try {
          const args = JSON.parse(data.arguments) as Record<string, unknown>
          if (typeof args.cmd === 'string') cmd = args.cmd
          else if (Array.isArray(args.command)) cmd = args.command.join(' ')
          else if (typeof args.command === 'string') cmd = args.command
        } catch { /* not JSON — nothing to count */ }
        if (cmd) {
          const g = countGitCommands(cmd)
          gitCommits += g.commits
          gitPushes += g.pushes
        }
      }
    }
    if (lineTs) endTime = lineTs
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
    active_minutes: activeMinutesOf(turnEvents),
    user_message_count: userMessages,
    assistant_message_count: assistantMessages,
    tool_counts: toolCounts,
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: gitCommits,
    git_pushes: gitPushes,
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
    uses_web_search: usesWebSearch,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: messageHours,
    user_message_timestamps: userMessageTimestamps,
    model,
    harness: 'codex',
    _source: 'jsonl',
  }
}
