import { calcCost } from '@agentistics/core'

/** Aggregate one workflow subagent transcript (agent-<id>.jsonl lines) into token/cost totals. */
export function aggregateWorkflowAgent(lines: string[]): {
  model: string; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; costUSD: number
} {
  let model = ''
  let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'assistant') continue
    const msg = e.message as Record<string, unknown> | undefined
    if (!msg) continue
    if (!model && typeof msg.model === 'string') model = msg.model
    const u = (msg.usage ?? {}) as Record<string, number>
    tokensIn += u.input_tokens ?? 0
    tokensOut += u.output_tokens ?? 0
    cacheRead += u.cache_read_input_tokens ?? 0
    cacheWrite += u.cache_creation_input_tokens ?? 0
  }
  const costUSD = (tokensIn + tokensOut + cacheRead + cacheWrite) === 0 ? 0 : calcCost(
    { inputTokens: tokensIn, outputTokens: tokensOut, cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheWrite, webSearchRequests: 0, costUSD: 0 },
    model,
  )
  return { model, tokensIn, tokensOut, cacheRead, cacheWrite, costUSD }
}
