import type { SessionMeta, TurnEvent } from '@agentistics/core'
import { activeMinutesOf } from '@agentistics/core'

/**
 * Pure parser for Kimi Code CLI sessions.
 *
 * Layout (verified on disk):
 *   ~/.kimi-code/session_index.jsonl          → {sessionId, sessionDir, workDir} per session
 *   ~/.kimi-code/sessions/<workspace>/session_<uuid>/
 *       state.json                            → {title, workDir, createdAt, updatedAt, agents{}}
 *       agents/<agentId>/wire.jsonl           → the event stream
 *
 * The event stream is flat JSONL. Only two shapes matter:
 *   - `usage.record`             → {model, usage:{inputOther, output, inputCacheRead,
 *                                   inputCacheCreation}, usageScope:'turn', time}
 *   - `context.append_loop_event` → wraps the loop's own events at `.event.type`:
 *                                   step.begin / step.end / content.part / tool.call / tool.result
 *
 * DOUBLE-COUNTING TRAP: the nested `step.end` events carry a `usage` object that is byte-identical
 * to the matching top-level `usage.record` (verified pairwise on real data — summing both doubled
 * every figure). Only `usage.record` is counted here.
 */

export interface KimiState {
  title?: string
  workDir?: string
  createdAt?: string
  updatedAt?: string
  /** agentId → {parentAgentId}. `main` has a null parent; subagents point at their parent. */
  agents?: Record<string, { parentAgentId?: string | null } | undefined>
}

/** Names of the agent directories to read, main first. A subagent's tokens belong to the session
 *  that spawned it, so every agent under one session folds into that single SessionMeta. */
export function kimiAgentIds(state: KimiState | null): string[] {
  const agents = state?.agents
  if (!agents) return ['main']
  const ids = Object.keys(agents)
  return ids.length ? ids : ['main']
}

export function parseKimiState(text: string): KimiState | null {
  try {
    const d = JSON.parse(text) as KimiState
    return d && typeof d === 'object' ? d : null
  } catch { return null }
}

/** `google/gemini-3.5-flash-lite` → `gemini-3.5-flash-lite`. Kimi routes to other providers and
 *  prefixes the alias; the bare id is what the pricing table is keyed by. */
export function stripProvider(model: string): string {
  const slash = model.indexOf('/')
  return slash > 0 ? model.slice(slash + 1) : model
}

export interface KimiWireTotals {
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheCreation: number
  /** Model of the last usage record — the session's dominant label. */
  model?: string
  userPrompts: number
  assistantTurns: number
  toolCounts: Record<string, number>
  toolErrors: number
  usesMcp: boolean
  firstPrompt: string
  hours: number[]
  userTimestamps: string[]
  firstTimeMs: number
  lastTimeMs: number
  /** Per-turn timeline for computeActiveTime() (docs/harness-contract.md). Kimi records no
   *  duration of its own, so turns are reconstructed: a `turn.prompt` of origin `user` opens one,
   *  every later event advances the clock. A session's SUBAGENT wires are accumulated into this
   *  same list and run DURING the parent's turn, so the list is sorted by time before it is
   *  consumed — appending one agent's stream after another's would otherwise invent turns. */
  turnEvents: TurnEvent[]
}

/** A factory, not a shared constant: spreading a constant copies its array REFERENCES, so every
 *  call would append into the same `hours`/`userTimestamps` and totals would bleed between
 *  sessions. */
export function emptyKimiTotals(): KimiWireTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0,
    userPrompts: 0, assistantTurns: 0, toolCounts: {}, toolErrors: 0, usesMcp: false,
    firstPrompt: '', hours: [], userTimestamps: [], firstTimeMs: 0, lastTimeMs: 0, turnEvents: [],
  }
}

/** Accumulate one agent's wire.jsonl into `acc`. Malformed lines are skipped, never thrown on. */
export function accumulateKimiWire(text: string, acc: KimiWireTotals = emptyKimiTotals()): KimiWireTotals {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let d: Record<string, unknown>
    try { d = JSON.parse(line) as Record<string, unknown> } catch { continue }

    const time = typeof d.time === 'number' ? d.time : 0
    let turnEvent: TurnEvent | null = null
    if (time > 0) {
      if (!acc.firstTimeMs || time < acc.firstTimeMs) acc.firstTimeMs = time
      if (time > acc.lastTimeMs) acc.lastTimeMs = time
      turnEvent = { ts: time }
      acc.turnEvents.push(turnEvent)
    }

    switch (d.type) {
      case 'usage.record': {
        const u = d.usage as Record<string, number> | undefined
        if (u) {
          acc.inputTokens += num(u.inputOther)
          acc.outputTokens += num(u.output)
          acc.cacheRead += num(u.inputCacheRead)
          acc.cacheCreation += num(u.inputCacheCreation)
        }
        if (typeof d.model === 'string' && d.model) acc.model = stripProvider(d.model)
        break
      }
      case 'turn.prompt': {
        // Only a real user turn counts; the CLI also replays prompts with other origins.
        const origin = d.origin as { kind?: string } | undefined
        if (origin?.kind && origin.kind !== 'user') break
        acc.userPrompts++
        if (turnEvent) turnEvent.userPrompt = true
        if (time > 0) {
          const dt = new Date(time)
          acc.hours.push(dt.getHours()) // local clock, same convention as every other adapter
          acc.userTimestamps.push(dt.toISOString())
        }
        if (!acc.firstPrompt) acc.firstPrompt = textOfPrompt(d.input)
        break
      }
      case 'context.append_loop_event': {
        const ev = d.event as Record<string, unknown> | undefined
        if (!ev) break
        // NOTE: ev.usage on a step.end duplicates the usage.record above — deliberately ignored.
        if (ev.type === 'step.end') acc.assistantTurns++
        else if (ev.type === 'tool.call') {
          const name = typeof ev.name === 'string' ? ev.name : ''
          if (name) {
            acc.toolCounts[name] = (acc.toolCounts[name] ?? 0) + 1
            if (name.startsWith('mcp__')) acc.usesMcp = true
          }
        } else if (ev.type === 'tool.result') {
          if (isToolError(ev)) acc.toolErrors++
        }
        break
      }
      default: break
    }
  }
  return acc
}

function num(v: unknown): number { return typeof v === 'number' && Number.isFinite(v) ? v : 0 }

function isToolError(ev: Record<string, unknown>): boolean {
  if (ev.isError === true || ev.error) return true
  const status = typeof ev.status === 'string' ? ev.status.toLowerCase() : ''
  if (status === 'error' || status === 'failed') return true
  const exit = ev.exitCode
  return typeof exit === 'number' && exit !== 0
}

/** `input` is a list of content parts; the text ones make the prompt. */
function textOfPrompt(input: unknown): string {
  if (!Array.isArray(input)) return ''
  return input
    .filter((p): p is { type?: string; text?: string } => !!p && typeof p === 'object')
    .map(p => (typeof p.text === 'string' ? p.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Build the SessionMeta. Returns null when nothing usable was recorded (no user turn at all),
 *  the same rule the Gemini adapter uses to drop bootstrap stubs. */
export function buildKimiSession(
  sessionId: string,
  state: KimiState | null,
  totals: KimiWireTotals,
  workDirFallback = '',
): SessionMeta | null {
  if (totals.userPrompts === 0) return null

  const start = state?.createdAt || (totals.firstTimeMs ? new Date(totals.firstTimeMs).toISOString() : '')
  const end = state?.updatedAt || (totals.lastTimeMs ? new Date(totals.lastTimeMs).toISOString() : '')
  if (!start) return null

  const startMs = Date.parse(start)
  const endMs = Date.parse(end || start)
  const duration = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? Math.round((endMs - startMs) / 60000)
    : 0

  const toolCalls = Object.values(totals.toolCounts).reduce((a, b) => a + b, 0)
  // Sorted: the events arrive one agent's wire at a time, but a subagent runs inside the parent's
  // turn — merging them chronologically is what keeps that from reading as extra turns.
  const activeMinutes = activeMinutesOf([...totals.turnEvents].sort((a, b) => a.ts - b.ts))

  return {
    session_id: sessionId,
    project_path: state?.workDir || workDirFallback,
    start_time: start,
    end_time: end || undefined,
    duration_minutes: duration,
    active_minutes: activeMinutes,
    user_message_count: totals.userPrompts,
    assistant_message_count: totals.assistantTurns,
    tool_counts: totals.toolCounts,
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cache_read_input_tokens: totals.cacheRead,
    cache_creation_input_tokens: totals.cacheCreation,
    first_prompt: totals.firstPrompt,
    ...(state?.title ? { title: state.title } : {}),
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: totals.toolErrors,
    tool_error_categories: totals.toolErrors ? { tool_result: totals.toolErrors } : {},
    uses_task_agent: !!totals.toolCounts['Agent'] || !!totals.toolCounts['AgentSwarm'],
    uses_mcp: totals.usesMcp,
    uses_web_search: !!totals.toolCounts['WebSearch'],
    uses_web_fetch: !!totals.toolCounts['WebFetch'],
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: totals.hours,
    user_message_timestamps: totals.userTimestamps,
    ...(totals.model ? { model: totals.model } : {}),
    harness: 'kimi',
    _source: 'jsonl',
    ...(toolCalls === 0 ? {} : {}),
  } as SessionMeta
}
