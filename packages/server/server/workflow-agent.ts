import { calcCost } from '@agentistics/core'

/** Aggregate one workflow subagent transcript (agent-<id>.jsonl lines) into token/cost totals.
 *  Also returns the agent's own PROMPT — the transcripts are named by an opaque hash, so the
 *  prompt is the only thing that ties one back to the `agent()` call that produced it
 *  (see workflow-match.ts). */
export function aggregateWorkflowAgent(lines: string[]): {
  model: string; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number
  costUSD: number; prompt: string; startedAt: string
} {
  let model = ''
  let prompt = '', startedAt = ''
  let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }
    if (!prompt && e.type === 'user') {
      const text = userText(e)
      if (text) { prompt = text; startedAt = typeof e.timestamp === 'string' ? e.timestamp : '' }
    }
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
  return { model, tokensIn, tokensOut, cacheRead, cacheWrite, costUSD, prompt, startedAt }
}

/** The text of a user envelope. A `tool_result` block is the transcript echoing a tool's OUTPUT
 *  back into the conversation, not something anyone prompted — it must never pass for the prompt. */
function userText(e: Record<string, unknown>): string {
  const content = (e.message as Record<string, unknown> | undefined)?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map(c => {
      const item = c as Record<string, unknown>
      return item.type === 'text' && typeof item.text === 'string' ? item.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}
