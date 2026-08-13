/**
 * conversations.ts — every conversation this machine knows about, running or not.
 *
 * The session manager alone can only see what it started. But a conversation you closed an hour ago
 * is exactly the thing you want back, and an assistant someone opened by hand is exactly the one
 * that gets lost — so the fleet screen has to be able to name both, and reopening either is the same
 * act: `<harness> --resume <id>` in the directory it belongs to.
 *
 * Read from the LOCAL consolidate store, cached, for the same reason `project-source.ts` is: the
 * control center must work with the server stopped.
 */

import type { HarnessId, SessionMeta } from '@agentistics/core'
import { sessionLabel } from '@agentistics/core'
import { loadConsolidated } from '../consolidate'
import { sessionAtCwd } from '../live-sessions'
import { SPAWN_SPECS } from './spawn-spec'

/** One conversation, as the fleet screen needs it. */
export interface Conversation {
  /** The HARNESS's own id — what a resume takes. */
  sessionId: string
  harness: HarnessId
  cwd: string
  /** `sessionLabel()`: the user's own name, else the harness title, else the opening prompt. */
  title: string
  lastActivityMs: number
  /**
   * Whether this harness can reopen a conversation by id AT ALL.
   *
   * False for gemini, whose `--resume` takes "latest" or an index rather than an id. A row that
   * cannot be resumed still LISTS — it is part of the history — it just offers no verb.
   */
  resumable: boolean
  /** The opening prompt, kept for search. Never rendered as a title — `sessionLabel` does that. */
  firstPrompt: string
}

const CACHE_TTL_MS = 30_000
let cache: { at: number; list: Conversation[] } | null = null

/** Epoch ms of the last thing that happened in a conversation. */
function lastActivityOf(s: SessionMeta): number {
  for (const candidate of [s.end_time, s.user_message_timestamps?.at(-1), s.start_time]) {
    if (!candidate) continue
    const t = Date.parse(candidate)
    if (Number.isFinite(t)) return t
  }
  return 0
}

export function toConversation(s: SessionMeta): Conversation {
  const harness = (s.harness ?? 'claude') as HarnessId
  return {
    sessionId: s.session_id,
    harness,
    // Where the session IS: a worktree session records it as `current_cwd` while `project_path`
    // stays at the root, and reopening it should land where the work was happening.
    cwd: s.current_cwd || s.project_path || '',
    title: sessionLabel(s),
    lastActivityMs: lastActivityOf(s),
    resumable: SPAWN_SPECS[harness]?.resume !== undefined,
    firstPrompt: s.first_prompt ?? '',
  }
}

/** Every conversation on this machine, newest first. Never throws — a store that cannot be read is
 *  a screen with no history, not a screen that fails to open. */
export async function loadConversations(): Promise<Conversation[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.list
  let list: Conversation[]
  try {
    list = [...(await loadConsolidated()).values()]
      .map(toConversation)
      .filter(c => c.sessionId && c.cwd)
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
  } catch {
    list = []
  }
  cache = { at: now, list }
  return list
}

/** Drop the cache, so a session started seconds ago is findable without waiting out the TTL. */
export function forgetConversations(): void {
  cache = null
}

/**
 * The conversation an EXTERNAL process appears to be driving — PURE.
 *
 * A running assistant we did not start rarely names its conversation on the command line, so this
 * is an inference: the most recently active conversation of that harness in that directory. It is
 * offered rather than acted on, and the UI shows the conversation's own TITLE in the confirmation —
 * which is what lets the person, who knows what they were doing, judge whether it is the right one.
 * That is a better guarantee than any heuristic here could give.
 *
 * `namedId` short-circuits it: when the process DID state its conversation (an fd into the session
 * file, or `--resume <id>` in argv), that is proof and no inference happens.
 */
export function conversationForProcess(
  conversations: readonly Conversation[],
  proc: { harness: HarnessId; cwd: string; namedId?: string },
): Conversation | undefined {
  if (proc.namedId) {
    const exact = conversations.find(c => c.sessionId === proc.namedId)
    if (exact) return exact
    // The process named a conversation the store has never seen. Inferring a DIFFERENT one would be
    // worse than offering nothing: it would reopen something the user did not ask for.
    return undefined
  }
  return conversations.find(c =>
    c.harness === proc.harness
    && sessionAtCwd({ current_cwd: c.cwd, project_path: c.cwd }, proc.cwd))
}

/**
 * Does this conversation match what was typed? — PURE.
 *
 * Searches the NAME, the opening prompt, the directory and the harness. The opening prompt is in
 * there because it is what a person actually remembers about a conversation they closed ("the one
 * where I asked about the migration"), and it is the only conversation text available without
 * reading every transcript off disk — which the search field cannot afford to do per keystroke.
 */
export function conversationMatches(c: Conversation, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return c.title.toLowerCase().includes(q)
    || c.firstPrompt.toLowerCase().includes(q)
    || c.cwd.toLowerCase().includes(q)
    || c.harness.toLowerCase().includes(q)
}
