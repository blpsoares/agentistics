import { test, expect } from 'bun:test'
import { parseWorkflowUsage } from './workflow-usage'

const NOTE = `<task-notification><result>{}</result>
<usage><agent_count>5</agent_count><agents_done>4</agents_done><agents_error>1</agents_error><agents_skipped>0</agents_skipped><subagent_tokens>123456</subagent_tokens><tool_uses>42</tool_uses><duration_ms>98765</duration_ms></usage></task-notification>`

test('parses usage block', () => {
  expect(parseWorkflowUsage(NOTE)).toEqual({
    agentCount: 5, agentsDone: 4, agentsError: 1, agentsSkipped: 0,
    subagentTokens: 123456, toolUses: 42, durationMs: 98765,
  })
})

test('returns null without usage block', () => {
  expect(parseWorkflowUsage('no usage here')).toBeNull()
})
