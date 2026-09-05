/**
 * agents.ts — the arithmetic and the READ MIGRATION for `SessionAgentMetrics`.
 *
 * It lives in core rather than in the server's `agent-metrics.ts` because two different readers
 * need it: the machine's own consolidate store and a central's session documents both hold records
 * written by an EARLIER build, and "reads must tolerate both shapes" is the rule for every stored
 * thing in this product.
 */

import type { AgentInvocation, SessionAgentMetrics } from './types'

/**
 * The totals, over the invocations that could actually be measured.
 *
 * `unmeasuredInvocations` is reported beside them rather than folded in, so a surface can say "3 of
 * 55 could not be measured" instead of presenting a partial sum as a complete one. A `null` adds
 * nothing — which is right — but a total that silently omits rows is a total nobody can check.
 */
export function rollupAgentMetrics(invocations: AgentInvocation[]): SessionAgentMetrics {
  let totalTokens = 0
  let totalDurationMs = 0
  let totalCostUSD = 0
  let unmeasuredInvocations = 0
  for (const i of invocations) {
    if (i.measured === 'none') { unmeasuredInvocations++; continue }
    totalTokens += i.totalTokens ?? 0
    totalDurationMs += i.totalDurationMs ?? 0
    totalCostUSD += i.costUSD ?? 0
  }
  return {
    invocations,
    totalInvocations: invocations.length,
    totalTokens,
    totalDurationMs,
    totalCostUSD,
    unmeasuredInvocations,
  }
}

/**
 * A stored record from before `measured` existed, read honestly.
 *
 * Those records cannot say whether a figure was measured, because the build that wrote them could
 * not tell either: an async launch carried no numbers and `?? 0` filled every field. So the shape is
 * recovered from the CONTENT, and there is exactly one signature to look for — an invocation whose
 * tokens, cost and duration are ALL zero. A real agent that read no tokens, cost nothing and took no
 * time does not exist; that row is the zero-filled launch, and it also carried a false
 * `status: 'completed'`, which is corrected with it.
 *
 * Anything else was genuinely reported by the harness and is left exactly as written — including a
 * row that happens to have zero LINES or zero tool calls, which are ordinary measurements.
 *
 * Idempotent: a record that already carries `measured` is returned untouched, so this can sit on a
 * read path that sees both shapes for as long as old rows survive.
 */
export function migrateAgentMetrics(m: SessionAgentMetrics): SessionAgentMetrics {
  if (!Array.isArray(m.invocations)) return m
  let changed = false
  const invocations = m.invocations.map(inv => {
    if (inv.measured !== undefined) return inv
    changed = true
    const zeroed = (inv.totalTokens ?? 0) === 0
      && (inv.costUSD ?? 0) === 0
      && (inv.totalDurationMs ?? 0) === 0
    if (!zeroed) return { ...inv, measured: 'harness' as const }
    return {
      ...inv,
      measured: 'none' as const,
      // The old record said `completed` because the launch ack said so. It was an acknowledgement
      // that the agent had STARTED.
      status: 'unknown' as const,
      totalTokens: null,
      totalDurationMs: null,
      totalToolUseCount: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costUSD: null,
    }
  })
  // The rollup is recomputed rather than trusted: the stored totals were summed over figures this
  // migration has just withdrawn.
  return changed ? rollupAgentMetrics(invocations) : m
}
