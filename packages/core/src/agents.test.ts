import { describe, expect, it } from 'bun:test'
import { migrateAgentMetrics, rollupAgentMetrics } from './agents'
import type { AgentInvocation, SessionAgentMetrics } from './types'

const inv = (over: Partial<AgentInvocation> = {}): AgentInvocation => ({
  toolUseId: 't1', agentType: 'general-purpose', description: 'Task 1',
  status: 'completed', measured: 'harness',
  totalTokens: 100, totalDurationMs: 1000, totalToolUseCount: 2,
  inputTokens: 10, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10,
  costUSD: 0.5, ...over,
})

/** A record as the build BEFORE `measured` wrote it — no such field anywhere. */
const legacy = (over: Record<string, unknown>): AgentInvocation => {
  const { measured: _drop, ...rest } = inv()
  return { ...rest, ...over } as AgentInvocation
}

describe('rollupAgentMetrics — a partial sum says it is partial', () => {
  it('sums the measured and counts the rest', () => {
    const m = rollupAgentMetrics([
      inv(),
      inv({ measured: 'transcript', totalTokens: 50, totalDurationMs: 500, costUSD: 0.25 }),
      inv({ measured: 'none', totalTokens: null, totalDurationMs: null, costUSD: null }),
    ])
    expect(m.totalInvocations).toBe(3)
    expect(m.unmeasuredInvocations).toBe(1)
    expect(m.totalTokens).toBe(150)
    expect(m.totalDurationMs).toBe(1500)
    expect(m.totalCostUSD).toBe(0.75)
  })
})

describe('migrateAgentMetrics — reading a record written before `measured` existed', () => {
  it('recovers the zero-filled async launch, and corrects the status it claimed', () => {
    // The signature: tokens, cost and duration ALL zero. A real agent that read no tokens, cost
    // nothing and took no time does not exist — that row is the launch ack, and it said `completed`
    // because the ack said the agent had STARTED.
    const before: SessionAgentMetrics = {
      invocations: [legacy({ totalTokens: 0, totalDurationMs: 0, costUSD: 0, status: 'completed' })],
      totalInvocations: 1, totalTokens: 0, totalDurationMs: 0, totalCostUSD: 0,
    } as SessionAgentMetrics
    const after = migrateAgentMetrics(before)
    const i = after.invocations[0]!
    expect(i.measured).toBe('none')
    expect(i.status).toBe('unknown')
    expect(i.totalTokens).toBe(null)
    expect(i.costUSD).toBe(null)
    expect(after.unmeasuredInvocations).toBe(1)
  })

  it('leaves a genuinely measured old record exactly as written', () => {
    const before: SessionAgentMetrics = {
      invocations: [legacy({})], totalInvocations: 1, totalTokens: 100, totalDurationMs: 1000, totalCostUSD: 0.5,
    } as SessionAgentMetrics
    const after = migrateAgentMetrics(before)
    expect(after.invocations[0]!.measured).toBe('harness')
    expect(after.invocations[0]!.totalTokens).toBe(100)
    expect(after.totalTokens).toBe(100)
    expect(after.unmeasuredInvocations).toBe(0)
  })

  it('does not mistake an ordinary zero for the signature', () => {
    // Zero tool calls, zero lines and zero cache are ordinary measurements; only ALL THREE of
    // tokens, cost and duration being zero is the launch ack.
    const before: SessionAgentMetrics = {
      invocations: [legacy({ totalTokens: 0, totalDurationMs: 800, costUSD: 0, totalToolUseCount: 0 })],
      totalInvocations: 1, totalTokens: 0, totalDurationMs: 800, totalCostUSD: 0,
    } as SessionAgentMetrics
    expect(migrateAgentMetrics(before).invocations[0]!.measured).toBe('harness')
  })

  it('recomputes the stored totals rather than trusting them', () => {
    // The stored totals were summed over figures this migration has just withdrawn.
    const before: SessionAgentMetrics = {
      invocations: [
        legacy({ totalTokens: 0, totalDurationMs: 0, costUSD: 0 }),
        legacy({ toolUseId: 't2' }),
      ],
      totalInvocations: 2, totalTokens: 100, totalDurationMs: 1000, totalCostUSD: 0.5,
    } as SessionAgentMetrics
    const after = migrateAgentMetrics(before)
    expect(after.totalTokens).toBe(100)
    expect(after.unmeasuredInvocations).toBe(1)
  })

  it('is idempotent, and returns a current record untouched', () => {
    const current = rollupAgentMetrics([inv()])
    expect(migrateAgentMetrics(current)).toBe(current)
    expect(migrateAgentMetrics(migrateAgentMetrics(current))).toEqual(current)
  })

  it('never throws on a record whose invocations are not an array', () => {
    const junk = { invocations: null } as unknown as SessionAgentMetrics
    expect(migrateAgentMetrics(junk)).toBe(junk)
  })
})
