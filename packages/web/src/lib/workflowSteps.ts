import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'

export interface StepSubtotal {
  count: number
  tokensIn: number
  tokensOut: number
  costUSD: number
}

export interface WorkflowStep {
  /** 1-based display number for the timeline node. */
  index: number
  title: string
  /** Declared count from run.phases (may differ from agents.length if some skipped). */
  declaredCount: number
  agents: WorkflowAgent[]
  subtotal: StepSubtotal
}

function subtotal(agents: WorkflowAgent[]): StepSubtotal {
  return agents.reduce<StepSubtotal>((t, a) => ({
    count: t.count + 1,
    tokensIn: t.tokensIn + a.tokensIn,
    tokensOut: t.tokensOut + a.tokensOut,
    costUSD: t.costUSD + a.costUSD,
  }), { count: 0, tokensIn: 0, tokensOut: 0, costUSD: 0 })
}

/** Group a run's agents under its declared phases (in declared order), then append
 *  any undeclared phases and the no-phase bucket. Declared phases with no agents
 *  render as empty steps. */
export function buildWorkflowSteps(run: WorkflowRun, noPhaseLabel = '(no phase)'): WorkflowStep[] {
  const byPhase = new Map<string, WorkflowAgent[]>()
  for (const a of run.agents) {
    const key = a.phase || noPhaseLabel
    const arr = byPhase.get(key) ?? []
    arr.push(a)
    byPhase.set(key, arr)
  }

  const out: Omit<WorkflowStep, 'index'>[] = []
  const seen = new Set<string>()
  for (const p of run.phases) {
    seen.add(p.title)
    const agents = byPhase.get(p.title) ?? []
    out.push({ title: p.title, declaredCount: p.agentCount, agents, subtotal: subtotal(agents) })
  }
  for (const [key, agents] of byPhase) {
    if (seen.has(key)) continue
    out.push({ title: key, declaredCount: agents.length, agents, subtotal: subtotal(agents) })
  }
  return out.map((s, i) => ({ ...s, index: i + 1 }))
}
