import { test, expect } from 'bun:test'
import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'
import { buildWorkflowSteps, groupRunsBySession } from './workflowSteps'

function agent(p: Partial<WorkflowAgent>): WorkflowAgent {
  return {
    label: 'a', phase: '', model: 'claude-sonnet-5', status: 'completed',
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, ...p,
  }
}

function run(p: Partial<WorkflowRun>): WorkflowRun {
  return {
    runId: 'r', name: 'wf', sessionId: 's', status: 'completed', startedAt: '',
    durationMs: 0, phases: [], agents: [],
    totals: { agentCount: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, durationMs: 0, toolUses: 0 },
    ...p,
  }
}

test('orders steps by declared phases, then appends undeclared/no-phase', () => {
  const r = run({
    phases: [{ title: 'Scan', agentCount: 2 }, { title: 'Fix', agentCount: 1 }, { title: 'Deploy', agentCount: 0 }],
    agents: [
      agent({ phase: 'Scan', tokensIn: 10, tokensOut: 2, costUSD: 0.10 }),
      agent({ phase: 'Scan', tokensIn: 5, tokensOut: 1, costUSD: 0.05 }),
      agent({ phase: 'Fix', tokensIn: 20, tokensOut: 4, costUSD: 0.20 }),
      agent({ phase: '', tokensIn: 1, tokensOut: 1, costUSD: 0.01 }),
    ],
  })
  const steps = buildWorkflowSteps(r)
  expect(steps.map(s => s.title)).toEqual(['Scan', 'Fix', 'Deploy', '(no phase)'])
  expect(steps.map(s => s.index)).toEqual([1, 2, 3, 4])
  expect(steps[0]!.subtotal.count).toBe(2)
  expect(steps[0]!.subtotal.tokensIn).toBe(15)
  expect(steps[0]!.subtotal.tokensOut).toBe(3)
  expect(steps[0]!.subtotal.costUSD).toBeCloseTo(0.15, 10) // 0.10 + 0.05 is not exact in FP arithmetic
  expect(steps[2]!.agents.length).toBe(0)        // declared phase with no agents renders empty
  expect(steps[2]!.subtotal.count).toBe(0)
  expect(steps[3]!.title).toBe('(no phase)')
})

function totals(p: Partial<WorkflowRun['totals']>): WorkflowRun['totals'] {
  return { agentCount: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, durationMs: 0, toolUses: 0, ...p }
}

test('groupRunsBySession groups by sessionId, sums, and orders by cost desc', () => {
  const runs = [
    run({ runId: 'a', sessionId: 's1', totals: totals({ agentCount: 2, costUSD: 0.5, tokensIn: 10, tokensOut: 2 }) }),
    run({ runId: 'b', sessionId: 's2', totals: totals({ agentCount: 1, costUSD: 2.0 }) }),
    run({ runId: 'c', sessionId: 's1', totals: totals({ agentCount: 3, costUSD: 0.5, tokensIn: 4, tokensOut: 1 }) }),
  ]
  const groups = groupRunsBySession(runs)
  expect(groups.map(g => g.sessionId)).toEqual(['s2', 's1']) // s2 cost 2.0 > s1 cost 1.0
  const s1 = groups.find(g => g.sessionId === 's1')!
  expect(s1.totals.runs).toBe(2)
  expect(s1.totals.agents).toBe(5)
  expect(s1.totals.tokensIn).toBe(14)
  expect(s1.totals.costUSD).toBeCloseTo(1.0, 10)
  expect(s1.runs.map(r => r.runId)).toEqual(['a', 'c']) // first-seen order within a session
})

test('groupRunsBySession returns empty for no runs', () => {
  expect(groupRunsBySession([])).toEqual([])
})
