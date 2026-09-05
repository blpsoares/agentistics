import { describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rollupAgentMetrics } from '@agentistics/core'
import { extractAgentMetrics, withSubagentMetrics } from './agent-metrics'

const line = (o: unknown) => JSON.stringify(o)

const launch = (toolUseId: string, description: string) => line({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { description, subagent_type: 'general-purpose' } }] },
})

/** The ACK Claude Code writes for an async launch: an id, and no numbers whatsoever. */
const asyncAck = (toolUseId: string, agentId: string) => line({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'launched' }] },
  toolUseResult: { isAsync: true, status: 'async_launched', agentId, description: 'x' },
})

/** The older SYNCHRONOUS result, which carried the numbers itself. */
const syncResult = (toolUseId: string) => line({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'done' }] },
  toolUseResult: {
    status: 'completed', agentType: 'general-purpose', totalTokens: 1234, totalDurationMs: 5000,
    totalToolUseCount: 7,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 204 },
    toolStats: { readCount: 1, searchCount: 2, bashCount: 3, editFileCount: 4, linesAdded: 5, linesRemoved: 6, otherToolCount: 7 },
  },
})

const notification = (agentId: string, toolUseId: string, status: string) => line({
  type: 'user',
  message: { role: 'user', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n</task-notification>` },
})

describe('extractAgentMetrics — an async launch carries no numbers, and must not invent them', () => {
  it('reports an async launch as UNMEASURED, never as a completed zero', () => {
    // The production bug: `{isAsync: true, status: "async_launched", agentId}` has no `usage` and no
    // `totalTokens`, and `?? 0` filled the gap. Measured on one machine: 74 sessions of them, all
    // reading `status: "completed", totalTokens: 0, costUSD: 0`.
    const m = extractAgentMetrics([launch('t1', 'Task 1'), asyncAck('t1', 'a1')], 'claude-sonnet-5')
    const inv = m.invocations[0]!
    expect(inv.measured).toBe('none')
    expect(inv.totalTokens).toBe(null)
    expect(inv.costUSD).toBe(null)
    expect(inv.status).not.toBe('completed')
    expect(inv.agentId).toBe('a1')
  })

  it('leaves a SYNCHRONOUS result exactly as the harness reported it', () => {
    const m = extractAgentMetrics([launch('t1', 'Task 1'), syncResult('t1')], 'claude-sonnet-5')
    const inv = m.invocations[0]!
    expect(inv.measured).toBe('harness')
    expect(inv.totalTokens).toBe(1234)
    expect(inv.totalToolUseCount).toBe(7)
    expect(inv.toolStats?.linesAdded).toBe(5)
    expect(inv.costUSD).toBeGreaterThan(0)
  })

  it('reads the outcome the parent RECORDED, wherever the notification sits in the file', () => {
    const m = extractAgentMetrics(
      [launch('t1', 'a'), asyncAck('t1', 'a1'), launch('t2', 'b'), asyncAck('t2', 'a2'),
        notification('a1', 't1', 'completed'), notification('a2', 't2', 'failed')],
      'claude-sonnet-5',
    )
    const byId = new Map(m.invocations.map(i => [i.agentId, i]))
    expect(byId.get('a1')!.status).toBe('completed')
    expect(byId.get('a2')!.status).toBe('failed')
    // …and knowing the outcome is NOT knowing the numbers.
    expect(byId.get('a1')!.totalTokens).toBe(null)
  })

  it('says UNKNOWN for an agent with no notification, never "running"', () => {
    // This is a transcript read after the fact: nothing here can tell "still working" from "the
    // session ended without saying". The live answer is the workspace's Subagents tab.
    const m = extractAgentMetrics([launch('t1', 'a'), asyncAck('t1', 'a1')], 'claude-sonnet-5')
    expect(m.invocations[0]!.status).toBe('unknown')
  })

  it('counts an agent that was launched and never answered AT ALL', () => {
    // These were dropped — an invocation only existed once a result matched — so a session with
    // three agents in flight reported having run none, and the count went UP when they finished.
    const m = extractAgentMetrics([launch('t1', 'in flight')], 'claude-sonnet-5')
    expect(m.totalInvocations).toBe(1)
    expect(m.invocations[0]!.measured).toBe('none')
    expect(m.invocations[0]!.description).toBe('in flight')
  })
})

describe('rollupAgentMetrics — a partial sum says it is partial', () => {
  it('sums only what was measured, and counts what was not', () => {
    const m = extractAgentMetrics(
      [launch('t1', 'a'), syncResult('t1'), launch('t2', 'b'), asyncAck('t2', 'a2')],
      'claude-sonnet-5',
    )
    expect(m.totalInvocations).toBe(2)
    expect(m.unmeasuredInvocations).toBe(1)
    expect(m.totalTokens).toBe(1234)
    expect(m.totalDurationMs).toBe(5000)
  })

  it('is a pure re-roll of whatever list it is given', () => {
    expect(rollupAgentMetrics([])).toEqual({
      invocations: [], totalInvocations: 0, totalTokens: 0, totalDurationMs: 0, totalCostUSD: 0,
      unmeasuredInvocations: 0,
    })
  })
})

describe('withSubagentMetrics — the numbers come from the agent’s OWN transcript', () => {
  const usage = (o: Record<string, number>, at: string) => line({
    type: 'assistant', timestamp: at,
    message: { model: 'claude-haiku-4-5-20251001', usage: o, content: [{ type: 'tool_use', id: 'x', name: 'Bash' }] },
  })

  async function fixture(): Promise<{ dir: string; transcript: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'agentistics-agents-'))
    const transcript = join(dir, 'conv.jsonl')
    await writeFile(transcript, [launch('t1', 'Task 1'), asyncAck('t1', 'a1'), notification('a1', 't1', 'completed')].join('\n'))
    await mkdir(join(dir, 'conv', 'subagents'), { recursive: true })
    await writeFile(join(dir, 'conv', 'subagents', 'agent-a1.jsonl'), [
      usage({ input_tokens: 8, output_tokens: 12, cache_read_input_tokens: 97_781, cache_creation_input_tokens: 261 }, '2026-09-04T14:00:00.000Z'),
      usage({ input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, '2026-09-04T14:00:30.000Z'),
    ].join('\n'))
    return { dir, transcript }
  }

  it('fills an unmeasured invocation with the FOUR counters and prices them', async () => {
    const { dir, transcript } = await fixture()
    try {
      const filled = await withSubagentMetrics(
        extractAgentMetrics([launch('t1', 'Task 1'), asyncAck('t1', 'a1')], 'claude-sonnet-5'),
        transcript,
      )
      const inv = filled.invocations[0]!
      expect(inv.measured).toBe('transcript')
      expect(inv.inputTokens).toBe(10)
      expect(inv.outputTokens).toBe(15)
      expect(inv.cacheReadTokens).toBe(97_881)
      expect(inv.cacheWriteTokens).toBe(261)
      // Every counter — an in+out reading of this row is 0,03 % of the volume.
      expect(inv.totalTokens).toBe(98_167)
      expect(inv.costUSD).toBeGreaterThan(0)
      expect(inv.totalToolUseCount).toBe(2)
      expect(inv.totalDurationMs).toBe(30_000)
      // The counts are reconstructable from the transcript; the LINE deltas are not, so no
      // half-filled record is invented.
      expect(inv.toolStats).toBeUndefined()
      expect(filled.unmeasuredInvocations).toBe(0)
      expect(filled.totalTokens).toBe(98_167)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('prices against the AGENT’s model, not the conversation’s', async () => {
    // An agent is routinely launched on a cheaper model than the conversation it belongs to, and
    // pricing its cache reads at the parent's rate is a wrong number that looks plausible.
    const { dir, transcript } = await fixture()
    try {
      const asSonnet = await withSubagentMetrics(
        extractAgentMetrics([launch('t1', 'x'), asyncAck('t1', 'a1')], 'claude-sonnet-5'), transcript)
      const asOpus = await withSubagentMetrics(
        extractAgentMetrics([launch('t1', 'x'), asyncAck('t1', 'a1')], 'claude-opus-5'), transcript)
      expect(asSonnet.invocations[0]!.costUSD).toBe(asOpus.invocations[0]!.costUSD)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('leaves an invocation the HARNESS measured exactly as reported', async () => {
    const { dir, transcript } = await fixture()
    try {
      const before = extractAgentMetrics([launch('t1', 'x'), syncResult('t1')], 'claude-sonnet-5')
      const after = await withSubagentMetrics(before, transcript)
      expect(after.invocations[0]!.measured).toBe('harness')
      expect(after.invocations[0]!.totalTokens).toBe(1234)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('leaves an agent with no transcript UNMEASURED rather than zeroing it', async () => {
    const { dir, transcript } = await fixture()
    try {
      const filled = await withSubagentMetrics(
        extractAgentMetrics([launch('t9', 'x'), asyncAck('t9', 'nosuchagent')], 'claude-sonnet-5'),
        transcript,
      )
      expect(filled.invocations[0]!.measured).toBe('none')
      expect(filled.invocations[0]!.totalTokens).toBe(null)
      expect(filled.unmeasuredInvocations).toBe(1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('never looks up a file for an invocation with no recorded agent id', async () => {
    // Inventing a file name from a description is how one agent's tokens get attributed to another.
    const { dir, transcript } = await fixture()
    try {
      const filled = await withSubagentMetrics(
        extractAgentMetrics([launch('t1', 'no id anywhere')], 'claude-sonnet-5'), transcript)
      expect(filled.invocations[0]!.measured).toBe('none')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
