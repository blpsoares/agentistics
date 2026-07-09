/** Parse the <usage> block embedded in a workflow <task-notification> text. */
export function parseWorkflowUsage(text: string): {
  agentCount: number; agentsDone: number; agentsError: number; agentsSkipped: number
  subagentTokens: number; toolUses: number; durationMs: number
} | null {
  const block = text.match(/<usage>([\s\S]*?)<\/usage>/)
  if (!block) return null
  const b = block[1]!
  const num = (tag: string) => {
    const m = b.match(new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`))
    return m ? parseInt(m[1]!, 10) : 0
  }
  return {
    agentCount: num('agent_count'),
    agentsDone: num('agents_done'),
    agentsError: num('agents_error'),
    agentsSkipped: num('agents_skipped'),
    subagentTokens: num('subagent_tokens'),
    toolUses: num('tool_uses'),
    durationMs: num('duration_ms'),
  }
}
