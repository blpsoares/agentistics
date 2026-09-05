/**
 * harness-transcript.ts — WHICH harnesses can have their conversation read, and how.
 *
 * `Record<HarnessId, HarnessTranscript | null>`, so the compiler asks about a new harness on the
 * day it is added and a reader that does not exist is ABSENT rather than a call that fails. The
 * caller turns a `null` into a sentence; it never turns it into an empty conversation, which is the
 * defect this module was written to remove. Measured 2026-09-05 on a live antigravity session:
 * `GET /api/fleet/chat` answered `{"turns":[],"live":true}` and `SessionChat.tsx` drew a completely
 * blank pane with nothing on it explaining why — no reader, no refusal, no words.
 *
 * A READER IS ONLY EVER OFFERED A CONVERSATION ID THAT IS EXACT. `SessionView.conversationId` is
 * filled solely from `ManagedSession.conversationId`, which exists only because agentop handed that
 * id to the CLI (`SpawnSpec.assignId`, or `resume`) — verified on the live agy session, whose
 * `/proc/<pid>/cmdline` reads `agy --conversation 01d0814f-…` for exactly the id the registry
 * holds. The harness-and-directory INFERENCE behind `resume` never reaches here: it is good enough
 * to offer a reopen a person confirms by title, and putting SOME OTHER conversation from the same
 * folder on screen under this session's name is a confident wrong answer the reader cannot detect.
 *
 * Two budgets, deliberately. `read` is the CHAT VIEW's and reads the conversation; `readRecent` is
 * the 5 s fleet poll's and reads only the end of the file through `transcript-window.ts`. A poll
 * that reads whole transcripts is what made `/api/fleet` answer in 36 s cold — see that module's
 * header for the measurement.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HarnessId } from '@agentistics/core'
import { ANTIGRAVITY_BRAIN_DIR, CODEX_SESSIONS_DIR } from '../config'
import { UUID_RE } from '../git'
import { parseAntigravityChat } from './antigravity-chat'
import { parseCodexChat } from './codex-chat'
import type { ChatTurn } from './chat-turn'
import { readChatTurns, readRecentChatTurns, resolveChatTranscriptPath } from './chat-tail'
import { readTailWindow } from './transcript-window'

/** Everything a reader is told about the session whose conversation is wanted. */
export interface TranscriptRef {
  /** The harness's own conversation id, known EXACTLY — never inferred. See the header. */
  conversationId: string
  /** The session's working directory. Some harnesses key their store on it; agy does not. */
  cwd?: string
}

export interface HarnessTranscript {
  /** The absolute path to this conversation's transcript here, or `null` when there is none. */
  resolve(ref: TranscriptRef): Promise<string | null>
  /** The conversation, oldest first, capped at `max` turns from the end. */
  read(path: string, max: number): Promise<ChatTurn[]>
  /** The last `max` turns only, read from the END of the file. The fleet poll's budget. */
  readRecent(path: string, max: number): Promise<ChatTurn[]>
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

/**
 * agy writes one directory per conversation under `brain/`, and the transcript inside it.
 *
 * `transcript_full.jsonl` is the whole thing and `transcript.jsonl` is a truncated copy of it —
 * the same pair, and the same preference, `antigravity-parse.ts` records. Measured on the live
 * conversation: 5.598.537 bytes against 3.669.964, both being appended to as it ran.
 */
export async function resolveAntigravityTranscript(
  ref: TranscriptRef,
  // Overridable only so a test can point at a fixture tree without a subprocess — `config.ts`'s
  // constants are fixed at import time and shared across a whole `bun test` run. Same escape hatch,
  // for the same reason, as `resolveChatTranscriptPath`'s `projectsDir`.
  brainDir: string = ANTIGRAVITY_BRAIN_DIR,
): Promise<string | null> {
  if (!UUID_RE.test(ref.conversationId)) return null
  const dir = join(brainDir, ref.conversationId, '.system_generated', 'logs')
  for (const name of ['transcript_full.jsonl', 'transcript.jsonl']) {
    const p = join(dir, name)
    if (await exists(p)) return p
  }
  return null
}

const ANTIGRAVITY: HarnessTranscript = {
  resolve: resolveAntigravityTranscript,
  async read(path, max) {
    // No cache and no window: a chat view re-reads a file that is being appended to, and a cache
    // keyed on mtime would miss every time by construction while holding whole transcripts in
    // memory. Same call `chat-tail.ts`'s `readChatTurns` makes, for the same reason.
    let content: string
    try { content = await readFile(path, 'utf-8') } catch { return [] }
    return parseAntigravityChat(content.split('\n'), 'antigravity', max)
  },
  async readRecent(path, max) {
    return readTailWindow(path, max, lines => parseAntigravityChat(lines, 'antigravity', max))
  },
}


/**
 * Codex files its rollouts by DAY — `sessions/YYYY/MM/DD/rollout-<time>-<conversation-id>.jsonl` —
 * and the conversation id is both the filename suffix and `session_meta.id` inside (verified: the
 * file `rollout-2026-07-07T19-02-05-019f3e9a-…` carries `id: 019f3e9a-…`). It is the id
 * `codex-parse.ts` keys a session by, so it is the id the registry recorded and the one
 * `codex resume <id>` takes.
 *
 * The scan is three shallow `readdir`s rather than one deep walk, and both the hit and the MISS are
 * memoized — a machine keeps a directory per day forever, so an unresolvable id must cost one scan
 * and not one per poll. Same rule, same reason, as `resolveChatTranscriptPath`'s own cache.
 */
const codexPathCache = new Map<string, string | null>()

/** Reset the memo. Tests only. */
export function forgetCodexTranscriptPaths(): void {
  codexPathCache.clear()
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch { return [] }
}

async function scanCodexRollout(id: string, root: string): Promise<string | null> {
  const suffix = `-${id}.jsonl`
  for (const year of await subdirs(root)) {
    for (const month of await subdirs(join(root, year))) {
      for (const day of await subdirs(join(root, year, month))) {
        const dir = join(root, year, month, day)
        let names: string[]
        try { names = await readdir(dir) } catch { continue }
        const hit = names.find(n => n.startsWith('rollout-') && n.endsWith(suffix))
        if (hit) return join(dir, hit)
      }
    }
  }
  return null
}

export async function resolveCodexTranscript(
  ref: TranscriptRef,
  // Overridable for tests only — see `resolveAntigravityTranscript`'s note.
  sessionsDir: string = CODEX_SESSIONS_DIR,
): Promise<string | null> {
  // Codex's ids are UUIDv7; `UUID_RE` is version-agnostic, so this rejects a path fragment without
  // rejecting the real thing.
  if (!UUID_RE.test(ref.conversationId)) return null
  const cached = codexPathCache.get(ref.conversationId)
  if (cached !== undefined) return cached
  const found = await scanCodexRollout(ref.conversationId, sessionsDir)
  codexPathCache.set(ref.conversationId, found)
  return found
}

const CODEX: HarnessTranscript = {
  resolve: ref => resolveCodexTranscript(ref),
  async read(path, max) {
    let content: string
    try { content = await readFile(path, 'utf-8') } catch { return [] }
    return parseCodexChat(content.split('\n'), 'codex', max)
  },
  async readRecent(path, max) {
    return readTailWindow(path, max, lines => parseCodexChat(lines, 'codex', max))
  },
}

const CLAUDE: HarnessTranscript = {
  resolve: ref => (ref.cwd === undefined
    ? Promise.resolve(null)
    : resolveChatTranscriptPath(ref.cwd, ref.conversationId)),
  read: (path, max) => readChatTurns(path, max),
  readRecent: (path, max) => readRecentChatTurns(path, max),
}

/**
 * The reader for each harness, or `null` where nobody has written one.
 *
 * `null` is a statement about THIS PRODUCT, not about the harness — kimi, copilot and gemini all
 * keep a readable transcript on disk (`adapters/*-parse.ts` already read every one of them for
 * metrics) and each is a reader waiting to be written. It is spelled out here rather than left to
 * a lookup miss so that adding one is a line in this table, and so the caller has something to say.
 */
export const HARNESS_TRANSCRIPTS: Record<HarnessId, HarnessTranscript | null> = {
  claude: CLAUDE,
  antigravity: ANTIGRAVITY,
  codex: CODEX,
  gemini: null,
  copilot: null,
  kimi: null,
}

/**
 * The reader for a harness named as a plain string.
 *
 * `ControlSession.harness` is a `string` — a `HarnessId`, or `''` when the registry has forgotten
 * which harness a row is. Both of those, and an id from a newer build, resolve to `null` here
 * rather than to a throw: a row nobody can name is a row whose conversation nobody can read.
 */
export function transcriptReaderFor(harness: string | undefined): HarnessTranscript | null {
  if (!harness) return null
  return HARNESS_TRANSCRIPTS[harness as HarnessId] ?? null
}
