import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'

export interface SessionGroup {
  sessionId: string
  runs: WorkflowRun[]
  totals: { runs: number; agents: number; tokensIn: number; tokensOut: number; costUSD: number }
}

/** Group workflow runs by their owning session, summing per-session totals. Sessions are
 *  ordered by total cost descending (ties keep first-seen order). Used by the repo-detail
 *  "Dynamic Workflows" tab's per-session view. */
export function groupRunsBySession(workflows: WorkflowRun[]): SessionGroup[] {
  const order: string[] = []
  const map = new Map<string, SessionGroup>()
  for (const run of workflows) {
    let g = map.get(run.sessionId)
    if (!g) {
      g = { sessionId: run.sessionId, runs: [], totals: { runs: 0, agents: 0, tokensIn: 0, tokensOut: 0, costUSD: 0 } }
      map.set(run.sessionId, g)
      order.push(run.sessionId)
    }
    g.runs.push(run)
    g.totals.runs += 1
    g.totals.agents += run.totals.agentCount
    g.totals.tokensIn += run.totals.tokensIn
    g.totals.tokensOut += run.totals.tokensOut
    g.totals.costUSD += run.totals.costUSD
  }
  return order
    .map((id) => map.get(id)!)
    .sort((a, b) => b.totals.costUSD - a.totals.costUSD)
}

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
