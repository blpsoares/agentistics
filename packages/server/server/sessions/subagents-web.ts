/**
 * subagents-web.ts — the SUBAGENTS one conversation ran, for the workspace's aside.
 *
 * The rules are the pure `subagents.ts`; this is the read. Three decisions live here.
 *
 * 1. THE CAPABILITY DECIDES, and a harness that cannot report subagents is told apart from a
 *    session that ran none. `HARNESS_CAPABILITIES[...].agents` is `true` for claude alone, and
 *    answering "0 subagents" for the other five would be the confident zero this whole area keeps
 *    being asked not to give.
 * 2. AN AGENT ID FROM A CLIENT NEVER REACHES A PATH UNCHECKED. It names a file, so it is matched
 *    against a closed shape first — the same discipline `artifact-file.ts` applies to a path.
 * 3. THE OUTCOMES COST A FULL READ OF THE PARENT, and that is why the browser polls this only while
 *    something is actually running. `<task-notification>` lines are anywhere in the file, so a tail
 *    would report a long-finished agent as running on a live session — a wrong answer to buy a read
 *    nobody is waiting on. It is ONE session's transcript while ONE tab is open, not the every-poll
 *    every-session read `chat-tail.ts` documents as a disk-burner.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { HARNESS_CAPABILITIES, totalTokens, type HarnessId, type TokenBreakdown } from '@agentistics/core'
import type { StartHost } from '../cli-start'
import type { CliLang } from '../cli-lang'
import { readChatTurns, resolveChatTranscriptPath, type ChatTurn } from './chat-tail'
import { conversationOfRow } from './row-conversation'
import {
  agentIdFromFile, parseSubagentMeta, parseTaskOutcomes, subagentCost, subagentStatus,
  summarizeSubagent, type SubagentMeta, type SubagentStatus, type SubagentUsage,
} from './subagents'

/** The shape an id from a client must have before it is allowed to name a file. */
const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/

export interface SubagentRow {
  agentId: string
  agentType?: string
  description?: string
  /** The alias the call asked for (`haiku`); `modelId` is what actually answered and gets priced. */
  model?: string
  modelId?: string
  status: SubagentStatus
  /** The parent's `tool_use` id — the same `ref` the Live feed's row carries. */
  toolUseId?: string
  spawnDepth?: number
  /** The four counters, or `null` when the agent has not answered yet. NEVER a zeroed breakdown. */
  tokens: TokenBreakdown | null
  /** Every counter summed — the number the word "tokens" means here. `null` with `tokens`. */
  totalTokens: number | null
  /** `null` when there are no tokens, or no model the pricing table can resolve. */
  costUSD: number | null
  toolCalls: number
  turns: number
  startedAt?: string
  lastAt?: string
}

export type SubagentsPayload =
  | { ok: true; supported: true; rows: SubagentRow[] }
  /** This harness cannot report subagents at all — already localized, and NOT an empty list. */
  | { ok: true; supported: false; message: string }
  | { ok: false; message: string }

/**
 * A subagent transcript's summary, memoized on the file's own mtime + size.
 *
 * Without it this route re-read every transcript on every poll. Measured on one conversation: 57
 * agents, ~32 MB of transcript, 2,9 s per request — and the browser polls it while an agent runs.
 * A FINISHED agent's transcript never changes, so it is summarised once; only the ones still
 * writing are read again. The key is mtime AND size because either can move alone under an append.
 */
const summaryMemo = new Map<string, { mtimeMs: number; size: number; usage: SubagentUsage }>()

/** Reset the memo. Tests only. */
export function forgetSubagentSummaries(): void {
  summaryMemo.clear()
}

async function summarize(path: string): Promise<SubagentUsage> {
  const unmeasured: SubagentUsage = { tokens: null, model: null, toolCalls: 0, turns: 0 }
  let mtimeMs: number
  let size: number
  try {
    const st = await stat(path)
    mtimeMs = st.mtimeMs
    size = st.size
  } catch {
    // An unreadable transcript is an UNMEASURED agent, not one that spent nothing.
    return unmeasured
  }
  const hit = summaryMemo.get(path)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.usage
  const usage = await readFile(path, 'utf-8').then(summarizeSubagent).catch(() => unmeasured)
  summaryMemo.set(path, { mtimeMs, size, usage })
  return usage
}

/** `<conversation>.jsonl` → the directory the harness writes that conversation's subagents into. */
function subagentsDirFor(transcriptPath: string): string {
  return `${transcriptPath.replace(/\.jsonl$/, '')}/subagents`
}

interface Resolved {
  row: { harness?: string; cwd?: string; state?: string; conversationBlind?: string }
  transcript: string
  live: boolean
}

async function resolve(
  host: StartHost, lang: CliLang, id: string,
): Promise<Resolved | { error: string }> {
  const pt = lang === 'pt'
  const fleet = await host.sessions!()
  const row = fleet.sessions.find(r => r.id === id || r.conversationId === id)
  if (!row) {
    return {
      error: pt
        ? 'Esta sessão não está mais na lista desta máquina.'
        : 'This session is no longer in this machine’s list.',
    }
  }
  const conversationId = conversationOfRow(row)
  if (!conversationId) {
    return {
      error: row.conversationBlind ?? (pt
        ? 'Esta sessão não tem uma conversa vinculada, então não há subagentes para listar.'
        : 'This session has no linked conversation, so there are no subagents to list.'),
    }
  }
  const transcript = await resolveChatTranscriptPath(row.cwd, conversationId).catch(() => null)
  if (!transcript) {
    return {
      error: pt
        ? 'A transcrição desta conversa não está mais no disco.'
        : 'This conversation’s transcript is no longer on disk.',
    }
  }
  const live = row.state === 'working' || row.state === 'waiting' || row.state === 'waiting-approval'
  return { row, transcript, live }
}

/** The capability sentence — said in words, never as an empty list. */
function unsupported(harness: string | undefined, lang: CliLang): string {
  const name = harness ?? '?'
  return lang === 'pt'
    ? `${name} não registra os subagentes que uma sessão executa, então não há nada para listar aqui — isto é uma ausência de dados, não uma sessão sem subagentes.`
    : `${name} does not record the subagents a session runs, so there is nothing to list here — that is missing data, not a session that ran none.`
}

export async function readSessionSubagents(
  host: StartHost, lang: CliLang, id: string,
): Promise<SubagentsPayload> {
  if (!host.sessions) return { ok: false, message: 'no session host' }
  const r = await resolve(host, lang, id)
  if ('error' in r) return { ok: false, message: r.error }

  const harness = r.row.harness as HarnessId | undefined
  const caps = harness ? HARNESS_CAPABILITIES[harness] : undefined
  if (!caps?.agents) return { ok: true, supported: false, message: unsupported(harness, lang) }

  const dir = subagentsDirFor(r.transcript)
  let names: string[]
  // A conversation that ran no subagents has no directory at all — a real empty list, and a
  // different fact from the harness not recording them.
  try { names = await readdir(dir) } catch { return { ok: true, supported: true, rows: [] } }

  const outcomes = await readFile(r.transcript, 'utf-8')
    .then(parseTaskOutcomes)
    .catch(() => new Map<string, string>())

  const rows: SubagentRow[] = []
  for (const name of names) {
    const agentId = agentIdFromFile(name)
    if (!agentId) continue
    const meta = await readFile(`${dir}/agent-${agentId}.meta.json`, 'utf-8')
      .then(raw => parseSubagentMeta(agentId, raw))
      .catch((): SubagentMeta => ({ agentId }))
    const usage = await summarize(`${dir}/${name}`)
    const tokens = usage.tokens
    rows.push({
      agentId,
      ...(meta.agentType ? { agentType: meta.agentType } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.model ? { model: meta.model } : {}),
      ...(usage.model ? { modelId: usage.model } : {}),
      ...(meta.toolUseId ? { toolUseId: meta.toolUseId } : {}),
      ...(meta.spawnDepth !== undefined ? { spawnDepth: meta.spawnDepth } : {}),
      status: subagentStatus(outcomes.get(agentId), r.live),
      tokens,
      totalTokens: tokens ? totalTokens(tokens) : null,
      costUSD: subagentCost(tokens, usage.model),
      toolCalls: usage.toolCalls,
      turns: usage.turns,
      ...(usage.startedAt ? { startedAt: usage.startedAt } : {}),
      ...(usage.lastAt ? { lastAt: usage.lastAt } : {}),
    })
  }

  // Newest first: the one you are watching is the one that just started.
  rows.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  return { ok: true, supported: true, rows }
}

export type SubagentActivityPayload =
  | { ok: true; turns: ChatTurn[]; status: SubagentStatus }
  | { ok: false; message: string }

/**
 * ONE subagent's own conversation — what it is doing, or what it did.
 *
 * It is read with `readChatTurns`, the very reader the chat view uses, so a subagent's activity is
 * parsed by one implementation rather than a second one that would drift from it.
 */
export async function readSubagentActivity(
  host: StartHost, lang: CliLang, id: string, agentId: string,
): Promise<SubagentActivityPayload> {
  const pt = lang === 'pt'
  if (!host.sessions) return { ok: false, message: 'no session host' }
  // Rule 2: it names a file, so it is checked before it can.
  if (!AGENT_ID.test(agentId)) {
    return { ok: false, message: pt ? 'Identificador de subagente inválido.' : 'Invalid subagent identifier.' }
  }
  const r = await resolve(host, lang, id)
  if ('error' in r) return { ok: false, message: r.error }

  const path = `${subagentsDirFor(r.transcript)}/agent-${agentId}.jsonl`
  let turns: ChatTurn[]
  try { turns = await readChatTurns(path) } catch { turns = [] }
  if (turns.length === 0) {
    // Launched and silent so far, or a transcript that is gone. Both are said rather than drawn as
    // an empty pane, which reads as "it did nothing".
    const outcomes = await readFile(r.transcript, 'utf-8').then(parseTaskOutcomes).catch(() => new Map<string, string>())
    const status = subagentStatus(outcomes.get(agentId), r.live)
    return status === 'running'
      ? { ok: true, turns: [], status }
      : {
        ok: false,
        message: pt
          ? 'Não há transcrição para este subagente — ele não escreveu nada, ou o arquivo não está mais no disco.'
          : 'There is no transcript for this subagent — it wrote nothing, or the file is no longer on disk.',
      }
  }
  const outcomes = await readFile(r.transcript, 'utf-8').then(parseTaskOutcomes).catch(() => new Map<string, string>())
  return { ok: true, turns, status: subagentStatus(outcomes.get(agentId), r.live) }
}
