import { test, expect } from 'bun:test'
import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'
import { buildWorkflowSteps } from './workflowSteps'

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
