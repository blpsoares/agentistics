/**
 * chat-tail.ts — the LIVE session detail pane's chat content, read from the harness's own JSONL
 * transcript instead of the terminal screen.
 *
 * Only Claude Code has an exact live-session -> conversation-id link
 * (`harness-sessions.ts`'s `byManagedId`), so this is Claude-only; every other harness keeps the
 * existing raw-tail behavior in `sessions-host.ts`. Absence here is never an error, only "not
 * available for this row" — the same rule every other enrichment in this file follows.
 *
 * Claude encodes a project's absolute path into its directory name by replacing `/` and `.` with
 * `-` (`nay-sessions.ts` uses the same encoding), but that encoding is documented as ambiguous for
 * directory names that already contain dashes (`data.ts`). Rather than trust it, the resolver
 * treats the conversation id (a UUID) as the reliable key: it tries the direct encoded path first
 * — cheap, and right the overwhelming majority of the time — and falls back to a one-time scan of
 * `PROJECTS_DIR` for a file literally named `<id>.jsonl`, exactly as `transcript-search.ts` does.
 * Both the hit and the miss are cached per conversation id, so a resolved (or unresolvable) session
 * is never re-scanned on a later poll.
 */

import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECTS_DIR } from '../config'
import { UUID_RE } from '../git'
import { isHumanUserEntry } from '../jsonl'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  /**
   * This is not something the assistant SAID — it is a synthesized note that a tool call has been
   * written to the transcript and no text has followed it yet, which is exactly the window where a
   * session is visibly busy and the pane would otherwise show nothing (or a stale turn from before
   * the tool call). Rendered dim, like every other status line in this pane, never in the role
   * colours — it is not a message either side wrote.
   */
  pending?: boolean
}

/** Resolved paths and one-time-scan misses, keyed by conversation id. Never re-scanned once known. */
const pathCache = new Map<string, string | null>()

/** Reset the memo. Tests only. */
export function forgetChatTailPaths(): void {
  pathCache.clear()
}

function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

/** Find `<sessionId>.jsonl` under `projectsDir`, scanning every project directory once. */
async function scanForTranscript(sessionId: string, projectsDir: string): Promise<string | null> {
  let dirs: string[]
  try { dirs = await readdir(projectsDir) } catch { return null }
  for (const dir of dirs) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`)
    if (await exists(candidate)) return candidate
  }
  return null
}

/**
 * The absolute path to a live Claude conversation's transcript, or `null` when it cannot be found.
 *
 * `null` is cached too — a session whose directory encoding is ambiguous costs one scan, not one
 * scan per poll for the rest of its life.
 *
 * `projectsDir` defaults to the real `PROJECTS_DIR` and is overridable only so tests can point it
 * at a fixture tree without needing a subprocess — `config.ts`'s constants are fixed at import
 * time and shared across a whole `bun test` run.
 */
export async function resolveChatTranscriptPath(
  cwd: string,
  sessionId: string,
  projectsDir: string = PROJECTS_DIR,
): Promise<string | null> {
  if (!UUID_RE.test(sessionId)) return null
  const cached = pathCache.get(sessionId)
  if (cached !== undefined) return cached

  const direct = join(projectsDir, encodeProjectDir(cwd), `${sessionId}.jsonl`)
  const resolved = (await exists(direct)) ? direct : await scanForTranscript(sessionId, projectsDir)
  pathCache.set(sessionId, resolved)
  return resolved
}

interface Cached {
  mtimeMs: number
  turns: ChatTurn[]
}

/** Parsed turns, keyed by transcript path — re-parsed only when the file's mtime has moved. */
const contentCache = new Map<string, Cached>()

/** Reset the memo. Tests only. */
export function forgetChatTailContent(): void {
  contentCache.clear()
}

function extractUserText(e: Record<string, unknown>): string | null {
  if (!isHumanUserEntry(e)) return null
  const msgContent = (e.message as Record<string, unknown> | undefined)?.content
  if (typeof msgContent === 'string') return msgContent.trim() || null
  if (Array.isArray(msgContent)) {
    const text = (msgContent as Record<string, unknown>[])
      .find(p => p.type === 'text' && typeof p.text === 'string')?.text as string | undefined
    return text?.trim() || null
  }
  return null
}

function extractAssistantText(e: Record<string, unknown>): string | null {
  if (e.type !== 'assistant') return null
  const msgContent = (e.message as Record<string, unknown> | undefined)?.content
  if (!Array.isArray(msgContent)) return null
  const text = (msgContent as Record<string, unknown>[])
    .find(p => p.type === 'text' && typeof p.text === 'string')?.text as string | undefined
  return text?.trim() || null
}

/** The tool names an assistant entry is calling, when it carries no text at all — see `ChatTurn.pending`. */
function extractToolActivity(e: Record<string, unknown>): string[] | null {
  if (e.type !== 'assistant') return null
  const msgContent = (e.message as Record<string, unknown> | undefined)?.content
  if (!Array.isArray(msgContent)) return null
  const names = (msgContent as Record<string, unknown>[])
    .filter(p => p.type === 'tool_use' && typeof p.name === 'string')
    .map(p => p.name as string)
  return names.length > 0 ? names : null
}

function toolActivityLabel(tools: string[]): string {
  return `Running ${tools.join(', ')}`
}

/**
 * How much of the END of a transcript is read to find the last few turns, and how far that window
 * is allowed to grow before the whole file is being read anyway.
 *
 * This used to read the WHOLE file. Parsing was already careful — from the end, stopping at `max` —
 * but the read and the `split('\n')` were not, and they ran on every poll of every live session:
 * the cache is keyed on mtime, and a session that is working changes its mtime every few seconds.
 * Measured on one machine: nine active transcripts totalling 31 MB, re-read and re-split every five
 * seconds, which is what made `/api/fleet` answer in 5-8 s warm and 36 s cold — long enough that the
 * VS Code extension's fetch gave up and reported the server as unreachable while it was answering
 * everything else instantly. It is the same disk-burner `searchTranscripts` is documented as
 * avoiding, in the one place that runs on a timer.
 *
 * The window GROWS rather than truncating the answer: a window that happened to cut through the
 * middle of the last six turns would silently show fewer of them, and a detail pane quietly missing
 * the newest message is worse than a slow one. Growth is bounded, and a file smaller than the window
 * is simply read whole — this is the same result as before, reached by reading far less.
 */
const TAIL_BYTES = 256 * 1024
const MAX_TAIL_BYTES = 16 * 1024 * 1024

/**
 * The last `bytes` of a file, as text, plus whether that reached the file's start.
 *
 * A window that starts mid-file almost always starts mid-LINE, and can also start mid-CHARACTER for
 * any multi-byte codepoint. Both are handled by the same rule: the caller drops everything before
 * the first newline, so the partial line — and any broken byte sequence inside it — never reaches
 * `JSON.parse`.
 */
async function readTailBytes(path: string, bytes: number): Promise<{ text: string; atStart: boolean } | null> {
  let fh
  try { fh = await open(path, 'r') } catch { return null }
  try {
    const size = (await fh.stat()).size
    const start = Math.max(0, size - bytes)
    const length = size - start
    if (length === 0) return { text: '', atStart: true }
    const buf = Buffer.alloc(length)
    await fh.read(buf, 0, length, start)
    return { text: buf.toString('utf-8'), atStart: start === 0 }
  } catch {
    return null
  } finally {
    await fh.close().catch(() => {})
  }
}

/**
 * The most recent chat turns in a Claude transcript, oldest first.
 *
 * Reads the END of the file and parses backwards from it, stopping as soon as `max` turns are
 * collected — so a long-running session's transcript is neither fully read nor fully `JSON.parse`d
 * to show the last few lines. See `TAIL_BYTES` for why the window grows instead of truncating.
 */
export async function readRecentChatTurns(path: string, max = 6): Promise<ChatTurn[]> {
  let mtimeMs: number
  try { mtimeMs = (await stat(path)).mtimeMs } catch { return [] }

  const hit = contentCache.get(path)
  if (hit && hit.mtimeMs === mtimeMs) return hit.turns

  let turns = await readTurnsFromTail(path, max, TAIL_BYTES)
  // Fewer turns than asked for, and the window did not reach the start of the file: the answer is
  // incomplete because of the WINDOW, not because the transcript is short. Widen and read again.
  let window = TAIL_BYTES
  while (turns !== null && turns.turns.length < max && !turns.atStart && window < MAX_TAIL_BYTES) {
    window = Math.min(window * 4, MAX_TAIL_BYTES)
    turns = await readTurnsFromTail(path, max, window)
  }
  const found = turns?.turns ?? []

  contentCache.set(path, { mtimeMs, turns: found })
  return found
}

/** One pass over the last `windowBytes` of the transcript. `null` when the file could not be read. */
async function readTurnsFromTail(
  path: string,
  max: number,
  windowBytes: number,
): Promise<{ turns: ChatTurn[]; atStart: boolean } | null> {
  const tail = await readTailBytes(path, windowBytes)
  if (!tail) return null

  // Everything before the first newline belongs to a line this window cut in half — it is already
  // present, whole, further up the file, and parsing the fragment would at best fail and at worst
  // succeed on a truncated object.
  const content = tail.atStart ? tail.text : tail.text.slice(tail.text.indexOf('\n') + 1)

  const lines = content.split('\n')
  const turns: ChatTurn[] = []
  // Set once, on the first substantive (non-blank, parseable) line the loop inspects — which is the
  // NEWEST event in the transcript. Only there does "no text yet" mean "busy right now"; the same
  // shape earlier in the file is just an ordinary tool call whose result and follow-up text already
  // exist further down and will be read on a later iteration.
  let newest = true
  for (let i = lines.length - 1; i >= 0 && turns.length < max; i--) {
    const line = (lines[i] ?? '').trim()
    if (!line) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }
    const isNewest = newest
    newest = false

    const userText = extractUserText(e)
    if (userText) { turns.push({ role: 'user', text: userText }); continue }
    const assistantText = extractAssistantText(e)
    if (assistantText) { turns.push({ role: 'assistant', text: assistantText }); continue }
    if (isNewest) {
      const tools = extractToolActivity(e)
      if (tools) turns.push({ role: 'assistant', text: toolActivityLabel(tools), pending: true })
    }
  }
  turns.reverse()

  return { turns, atStart: tail.atStart }
}
