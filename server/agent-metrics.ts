import { readFile } from 'fs/promises'
import { calcCost } from '../src/lib/types'
import type { AgentInvocation, SessionAgentMetrics } from '../src/lib/types'

interface ToolUseRecord {
  id: string
  input: {
    description?: string
    subagent_type?: string
    prompt?: string
  }
}

interface ToolUseResult {
  status?: string
  agentType?: string
  agentId?: string
  totalDurationMs?: number
  totalTokens?: number
  totalToolUseCount?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  toolStats?: {
    readCount?: number
    searchCount?: number
    bashCount?: number
    editFileCount?: number
    linesAdded?: number
    linesRemoved?: number
    otherToolCount?: number
  }
}

/**
 * Parse JSONL lines from a session file and extract Agent tool invocation metrics.
 *
 * Key JSONL structure:
 * - Assistant messages have `content` items with `type: "tool_use"` and `name: "Agent"`
 * - The input has: `{ description, subagent_type, prompt }`
 * - Correlating user messages have `toolUseResult` at the message level with usage/timing info
 * - Correlation: match by `tool_use_id` in the tool_result content array
 */
export function extractAgentMetrics(lines: string[], modelId: string): SessionAgentMetrics {
  // Map of tool_use_id → ToolUseRecord for pending Agent invocations
  const pendingAgents = new Map<string, ToolUseRecord>()
  const invocations: AgentInvocation[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }

    // Scan assistant messages for Agent tool_use items
    if (e.type === 'assistant') {
      const msg = e.message as Record<string, unknown> | undefined
      if (!Array.isArray(msg?.content)) continue

      for (const item of msg!.content as Record<string, unknown>[]) {
        if (
          item.type === 'tool_use' &&
          item.name === 'Agent' &&
          typeof item.id === 'string'
        ) {
          const input = (item.input ?? {}) as ToolUseRecord['input']
          pendingAgents.set(item.id as string, {
            id: item.id as string,
            input,
          })
        }
      }
      continue
    }

    // Scan user messages for toolUseResult + tool_result content correlation
    if (e.type === 'user') {
      // The toolUseResult is at message envelope level (not inside content)
      const toolUseResult = e.toolUseResult as ToolUseResult | undefined
      if (!toolUseResult) continue

      const msg = e.message as Record<string, unknown> | undefined
      const contentArr = Array.isArray(msg?.content)
        ? (msg!.content as Record<string, unknown>[])
        : []

      // Find the tool_result item(s) in this message content — they carry the tool_use_id
      for (const item of contentArr) {
        if (item.type !== 'tool_result') continue
        const toolUseId = item.tool_use_id as string | undefined
        if (!toolUseId) continue

        const pending = pendingAgents.get(toolUseId)
        if (!pending) continue

        // We have a match — build the AgentInvocation
        pendingAgents.delete(toolUseId)

        const usage = toolUseResult.usage ?? {}
        const toolStats = toolUseResult.toolStats ?? {}

        const inputTokens = usage.input_tokens ?? 0
        const outputTokens = usage.output_tokens ?? 0
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0
        const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0

        const costUSD = calcCost(
          {
            inputTokens,
            outputTokens,
            cacheReadInputTokens: cacheReadTokens,
            cacheCreationInputTokens: cacheWriteTokens,
            webSearchRequests: 0,
            costUSD: 0,
          },
          modelId
        )

        invocations.push({
          toolUseId,
          agentType: toolUseResult.agentType ?? pending.input.subagent_type ?? 'unknown',
          description: pending.input.description ?? '',
          status: (toolUseResult.status === 'failed') ? 'failed' : 'completed',
          totalTokens: toolUseResult.totalTokens ?? (inputTokens + outputTokens),
          totalDurationMs: toolUseResult.totalDurationMs ?? 0,
          totalToolUseCount: toolUseResult.totalToolUseCount ?? 0,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          toolStats: {
            readCount: toolStats.readCount ?? 0,
            searchCount: toolStats.searchCount ?? 0,
            bashCount: toolStats.bashCount ?? 0,
            editFileCount: toolStats.editFileCount ?? 0,
            linesAdded: toolStats.linesAdded ?? 0,
            linesRemoved: toolStats.linesRemoved ?? 0,
            otherToolCount: toolStats.otherToolCount ?? 0,
          },
          costUSD,
        })
      }
    }
  }

  const totalInvocations = invocations.length
  const totalTokens = invocations.reduce((s, i) => s + i.totalTokens, 0)
  const totalDurationMs = invocations.reduce((s, i) => s + i.totalDurationMs, 0)
  const totalCostUSD = invocations.reduce((s, i) => s + i.costUSD, 0)

  return {
    invocations,
    totalInvocations,
    totalTokens,
    totalDurationMs,
    totalCostUSD,
  }
}

/**
 * Read a JSONL file and extract agent metrics from it.
 * Used for meta-sourced sessions that have agent tool usage.
 */
export async function extractAgentMetricsFromFile(filePath: string): Promise<SessionAgentMetrics> {
  const empty: SessionAgentMetrics = { invocations: [], totalInvocations: 0, totalTokens: 0, totalDurationMs: 0, totalCostUSD: 0 }
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return empty
  }

  const lines = content.split('\n')

  // Extract model ID from first assistant message
  let modelId = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    try {
      const e = JSON.parse(line) as Record<string, unknown>
      if (e.type === 'assistant') {
        const msg = e.message as Record<string, unknown> | undefined
        if (typeof msg?.model === 'string') { modelId = msg.model; break }
      }
    } catch { continue }
  }

  return extractAgentMetrics(lines, modelId)
}
