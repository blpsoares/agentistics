/**
 * agent-metrics.ts — what each Agent invocation of a session cost.
 *
 * ## The zero this file used to report
 *
 * It reads a SYNCHRONOUS Agent call: a `tool_use`, and a `tool_result` beside it carrying
 * `totalTokens`, `usage` and `toolStats`. Claude Code launches agents ASYNCHRONOUSLY now, and the
 * result that comes back at launch carries `{isAsync: true, status: "async_launched", agentId,
 * outputFile}` and nothing else. Nothing threw, nothing failed to parse — the fields were simply
 * absent and `?? 0` filled them in. Measured on this machine: 74 sessions holding agent metrics,
 * every async invocation reading `status: "completed", totalTokens: 0, costUSD: 0`, while one of
 * those agents had in fact read 123,6 million cached tokens.
 *
 * That is the misleading-zero `HARNESS_CAPABILITIES` exists to prevent, produced from the inside by
 * a reader that still parsed cleanly. When a format changes under a reader, the reader does not
 * break; it starts lying quietly.
 *
 * ## Two halves, and why they are separate
 *
 * **What the PARENT transcript knows** — that a call happened, its description, its agent type, the
 * agent id an async launch recorded, and the `<task-notification>` that later reported its outcome.
 * That is `extractAgentMetrics`, which stays PURE over lines and is cached against the parent
 * file's own stamp.
 *
 * **What the AGENT'S OWN transcript knows** — every token it spent. That lives in a different file
 * (`<conversation>/subagents/agent-<id>.jsonl`) which changes independently of the parent, so it is
 * read separately and cached against ITS OWN stamp. Folding it into the parent's cache entry would
 * be a cache key that does not name its source: a running agent's numbers would freeze until the
 * parent happened to be written to.
 *
 * The reading itself is `sessions/subagents.ts`, shared verbatim with the workspace's Subagents
 * tab — one implementation of "what did this agent spend", not two that drift.
 *
 * ## The rule
 *
 * A figure that cannot be measured is `null`, and `measured` says why. Nothing here returns a zero
 * it did not count.
 */
import { readFile } from 'fs/promises'
import { calcCost, rollupAgentMetrics, type AgentInvocation, type SessionAgentMetrics } from '@agentistics/core'
import { stampOf } from './parse-cache-jsonl'
import { NOOP_PARSE_CACHE, type ParseCache } from './parse-cache'
import {
  parseTaskOutcomes, subagentCost, subagentStatus, summarizeSubagent,
  type SubagentStatus, type SubagentUsage,
} from './sessions/subagents'

interface ToolUseRecord {
  id: string
  input: {
    description?: string
    subagent_type?: string
    prompt?: string
  }
}

interface ToolUseResult {
  status?: string
  /** The launch ack of an ASYNCHRONOUS agent: it carries an id and no numbers whatsoever. */
  isAsync?: boolean
  agentType?: string
  agentId?: string
  totalDurationMs?: number
  totalTokens?: number
  totalToolUseCount?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  toolStats?: {
    readCount?: number
    searchCount?: number
    bashCount?: number
    editFileCount?: number
    linesAdded?: number
    linesRemoved?: number
    otherToolCount?: number
  }
}

/**
 * Parse JSONL lines from a session file and extract Agent tool invocation metrics.
 *
 * Key JSONL structure:
 * - Assistant messages have `content` items with `type: "tool_use"` and `name: "Agent"`
 * - The input has: `{ description, subagent_type, prompt }`
 * - Correlating user messages have `toolUseResult` at the message level with usage/timing info
 * - Correlation: match by `tool_use_id` in the tool_result content array
 */
export function extractAgentMetrics(lines: Iterable<string>, modelId: string): SessionAgentMetrics {
  // Map of tool_use_id → ToolUseRecord for pending Agent invocations
  const pendingAgents = new Map<string, ToolUseRecord>()
  const invocations: AgentInvocation[] = []
  /**
   * What the parent later recorded about each agent's OUTCOME.
   *
   * Collected in this same pass rather than in a second read: the `<task-notification>` entries are
   * in this very file, and the read plus the `split('\n')` are what cost anything here.
   */
  const outcomeLines: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.includes('<task-notification>')) outcomeLines.push(line)

    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }

    // Scan assistant messages for Agent tool_use items
    if (e.type === 'assistant') {
      const msg = e.message as Record<string, unknown> | undefined
      if (!Array.isArray(msg?.content)) continue

      for (const item of msg!.content as Record<string, unknown>[]) {
        if (
          item.type === 'tool_use' &&
          item.name === 'Agent' &&
          typeof item.id === 'string'
        ) {
          const input = (item.input ?? {}) as ToolUseRecord['input']
          pendingAgents.set(item.id as string, {
            id: item.id as string,
            input,
          })
        }
      }
      continue
    }

    // Scan user messages for toolUseResult + tool_result content correlation
    if (e.type === 'user') {
      // The toolUseResult is at message envelope level (not inside content)
      const toolUseResult = e.toolUseResult as ToolUseResult | undefined
      if (!toolUseResult) continue

      const msg = e.message as Record<string, unknown> | undefined
      const contentArr = Array.isArray(msg?.content)
        ? (msg!.content as Record<string, unknown>[])
        : []

      // Find the tool_result item(s) in this message content — they carry the tool_use_id
      for (const item of contentArr) {
        if (item.type !== 'tool_result') continue
        const toolUseId = item.tool_use_id as string | undefined
        if (!toolUseId) continue

        const pending = pendingAgents.get(toolUseId)
        if (!pending) continue

        // We have a match — build the AgentInvocation
        pendingAgents.delete(toolUseId)

        const common = {
          toolUseId,
          agentType: toolUseResult.agentType ?? pending.input.subagent_type ?? 'unknown',
          description: pending.input.description ?? '',
          ...(toolUseResult.agentId ? { agentId: toolUseResult.agentId } : {}),
        }

        /**
         * AN ASYNC LAUNCH CARRIES NO NUMBERS AT ALL — it is an acknowledgement that an agent was
         * started, and the agent is still running when it is written. So the invocation is emitted
         * UNMEASURED, and `fillFromSubagents` fills it in from the agent's own transcript.
         *
         * The discriminator is the absence of a usage record, not the `isAsync` flag alone: a
         * launch ack under a future flag name still has nothing to read, and a sync result that
         * happens to be marked async still does.
         */
        if (!toolUseResult.usage && toolUseResult.totalTokens === undefined) {
          invocations.push({
            ...common,
            // The outcome is settled below, once the whole file has been read: the notification
            // that reports it comes LATER in the transcript than this launch does.
            status: 'unknown',
            measured: 'none',
            totalTokens: null,
            totalDurationMs: null,
            totalToolUseCount: null,
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            costUSD: null,
          })
          continue
        }

        const usage = toolUseResult.usage ?? {}
        const toolStats = toolUseResult.toolStats ?? {}

        const inputTokens = usage.input_tokens ?? 0
        const outputTokens = usage.output_tokens ?? 0
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0
        const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0

        const costUSD = calcCost(
          {
            inputTokens,
            outputTokens,
            cacheReadInputTokens: cacheReadTokens,
            cacheCreationInputTokens: cacheWriteTokens,
            webSearchRequests: 0,
            costUSD: 0,
          },
          modelId
        )

        invocations.push({
          ...common,
          status: (toolUseResult.status === 'failed') ? 'failed' : 'completed',
          measured: 'harness',
          totalTokens: toolUseResult.totalTokens ?? (inputTokens + outputTokens),
          totalDurationMs: toolUseResult.totalDurationMs ?? 0,
          totalToolUseCount: toolUseResult.totalToolUseCount ?? 0,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          toolStats: {
            readCount: toolStats.readCount ?? 0,
            searchCount: toolStats.searchCount ?? 0,
            bashCount: toolStats.bashCount ?? 0,
            editFileCount: toolStats.editFileCount ?? 0,
            linesAdded: toolStats.linesAdded ?? 0,
            linesRemoved: toolStats.linesRemoved ?? 0,
            otherToolCount: toolStats.otherToolCount ?? 0,
          },
          costUSD,
        })
      }
    }
  }

  /**
   * AN AGENT THAT WAS LAUNCHED AND NEVER ANSWERED IS STILL AN INVOCATION.
   *
   * These used to be dropped — the loop only emitted an invocation once a `tool_result` matched —
   * so a session with three agents in flight reported having run none of them, and the count went
   * UP when they finished. That is a different confident answer from the zero above, out of the
   * same reader.
   */
  for (const [toolUseId, pending] of pendingAgents) {
    invocations.push({
      toolUseId,
      agentType: pending.input.subagent_type ?? 'unknown',
      description: pending.input.description ?? '',
      status: 'unknown',
      measured: 'none',
      totalTokens: null,
      totalDurationMs: null,
      totalToolUseCount: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costUSD: null,
    })
  }

  /**
   * The outcome each agent's own notification reported, applied now that the whole file is read.
   *
   * An agent with NO notification is `unknown`, never `running`: this is a transcript being read
   * after the fact, and nothing here can tell "still working" from "the session ended without
   * saying". The live answer is the workspace's Subagents tab, which knows whether the session is
   * up; see `subagentStatus`.
   */
  const outcomes = parseTaskOutcomes(outcomeLines.join('\n'))
  for (const inv of invocations) {
    if (inv.measured !== 'none' || !inv.agentId) continue
    const recorded = outcomes.get(inv.agentId)
    if (recorded !== undefined) inv.status = invocationStatus(subagentStatus(recorded, false))
  }

  return rollupAgentMetrics(invocations)
}

/**
 * `SubagentStatus` → `AgentInvocation['status']`.
 *
 * The two vocabularies differ by one word — the session view calls it `finished`, this record calls
 * it `completed` — and the mapping is written out rather than cast, so a word added on either side
 * has to be answered here instead of silently becoming something else.
 */
function invocationStatus(s: SubagentStatus): AgentInvocation['status'] {
  switch (s) {
    case 'finished': return 'completed'
    case 'failed': return 'failed'
    case 'stopped': return 'stopped'
    case 'running': return 'running'
    case 'unknown': return 'unknown'
  }
}


// ---- the half the parent transcript does not hold ------------------------------------------------

/**
 * `<conversation>.jsonl` → the directory the harness writes that conversation's agents into.
 *
 * The same derivation `subagents-web.ts` makes, and the only shape knowledge in this file.
 */
function subagentsDirFor(transcriptPath: string): string {
  return `${transcriptPath.replace(/\.jsonl$/, '')}/subagents`
}

/** The `subagent` cache stores exactly this. */
interface CachedSubagent {
  usage: SubagentUsage
}

/**
 * One agent's own transcript, summarised — through the parse cache, keyed on THAT FILE's stamp.
 *
 * The stamp is what makes this affordable. Measured on this machine: 532 agent transcripts across
 * 45 conversations, 201,6 MB. A finished agent's transcript never changes again, so it is read once
 * ever and the row survives a restart; only an agent still writing is re-read. Keying this on the
 * PARENT's stamp instead — which is what folding it into `cachedEnrich` would do — would be a cache
 * key that does not name its source: a running agent's numbers would freeze until something
 * happened to write to the parent.
 */
async function summarizeCached(cache: ParseCache, path: string): Promise<SubagentUsage | null> {
  const stamp = await stampOf(path)
  if (!stamp) return null
  const hit = cache.get<CachedSubagent>('subagent', stamp)
  if (hit) return hit.usage
  const content = await readFile(path, 'utf-8').catch(() => null)
  if (content === null) return null
  const usage = summarizeSubagent(content)
  cache.set('subagent', stamp, { usage } satisfies CachedSubagent)
  return usage
}

/**
 * Fill the UNMEASURED invocations from the agents' own transcripts, and re-roll the totals.
 *
 * Only `measured: 'none'` rows are touched, and only ones carrying an `agentId`: an invocation the
 * harness already measured is left exactly as the harness reported it, and one with no id has
 * nothing to look up — inventing a file name from a description is how a reader starts attributing
 * one agent's tokens to another.
 *
 * A row whose transcript is missing stays UNMEASURED. That is the answer for an agent launched a
 * second ago, and for one whose transcript has been cleaned up: both are "we cannot say", and
 * neither is a spend of nothing.
 */
export async function withSubagentMetrics(
  metrics: SessionAgentMetrics,
  transcriptPath: string,
  cache: ParseCache = NOOP_PARSE_CACHE,
): Promise<SessionAgentMetrics> {
  const pending = metrics.invocations.filter(i => i.measured === 'none' && i.agentId)
  if (pending.length === 0) return metrics

  const dir = subagentsDirFor(transcriptPath)
  const filled = await Promise.all(pending.map(async inv => {
    const usage = await summarizeCached(cache, `${dir}/agent-${inv.agentId}.jsonl`)
    return { inv, usage }
  }))

  for (const { inv, usage } of filled) {
    if (!usage || !usage.tokens) continue
    const t = usage.tokens
    inv.measured = 'transcript'
    inv.inputTokens = t.input
    inv.outputTokens = t.output
    inv.cacheReadTokens = t.cacheRead
    inv.cacheWriteTokens = t.cacheWrite
    // THE FOUR COUNTERS. `input + output` is 0,03 % of the volume on a real subagent.
    inv.totalTokens = t.input + t.output + t.cacheRead + t.cacheWrite
    inv.totalToolUseCount = usage.toolCalls
    // PRICED AGAINST THE AGENT'S OWN MODEL, not the parent's: an agent is routinely launched on a
    // cheaper one (`model: "haiku"` under a Sonnet conversation), and pricing its cache reads at the
    // parent's rate is a wrong number that looks entirely plausible.
    inv.costUSD = subagentCost(t, usage.model)
    inv.totalDurationMs = spanMs(usage.startedAt, usage.lastAt)
    // `toolStats` is deliberately NOT synthesised here — see `AgentInvocation.toolStats`.
  }
  return rollupAgentMetrics(metrics.invocations)
}

/** First to last recorded timestamp, or null when the transcript carries no usable pair. */
function spanMs(from: string | undefined, to: string | undefined): number | null {
  if (!from || !to) return null
  const a = Date.parse(from)
  const b = Date.parse(to)
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null
}
