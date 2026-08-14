/**
 * peer-client.ts — delivering an event into another Claude Code session, over the socket that
 * session already listens on.
 *
 * ## What this speaks, and how it was established
 *
 * Claude Code registers every session as `~/.claude/sessions/<pid>.json`, carrying its `sessionId`,
 * its `cwd`, the `name` it registered under and a `messagingSocketPath`. Beside it sits
 * `<pid>.<hash>.key` holding a `peerToken`. The socket is a newline-delimited JSON stream: the
 * first line authenticates, and subsequent lines are messages. That is the mechanism Claude Code's
 * own cross-session messaging uses, read out of the shipped binary (2.1.232) rather than guessed —
 * the same standard the session manager holds itself to when it reads a harness's `--help`.
 *
 * Two consequences of it being someone else's protocol:
 *
 *  - **`session_id` is sent with every message.** The receiver drops a message whose `session_id`
 *    does not match its own. Pid files outlive their processes and pids are reused, so this is what
 *    turns "the socket answered" into "the session I meant received it". Without it a stale record
 *    could deliver a fleet event into an unrelated conversation.
 *  - **It can stop working.** It is not a published API. Every failure is reported as a failure —
 *    the event is already in the inbox, so a broken socket costs latency, not the event.
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { HOME_DIR } from '../config'
import { livePeers, selectPeerTarget, type PeerRecord, type PeerSelection } from './peer-target'

/**
 * Deliberately HOME_DIR, not CLAUDE_DIR — the same distinction `cli-hooks.ts` makes. CLAUDE_DIR can
 * be a container's read-only mount of someone else's `~/.claude`; the sessions we can message are
 * the ones running as this user on this machine.
 */
const sessionsDir = (): string => join(HOME_DIR, '.claude', 'sessions')

/** How long to wait for a connect + write. A notification that blocks a poll is a broken poll. */
const SEND_TIMEOUT_MS = 2_000

/** Every `<pid>.json` this machine holds, readable ones only. Never throws. */
export async function readPeerRecords(dir = sessionsDir()): Promise<PeerRecord[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: PeerRecord[] = []
  await Promise.all(names.filter(n => /^\d+\.json$/.test(n)).map(async n => {
    try {
      const raw = JSON.parse(await readFile(join(dir, n), 'utf8')) as Record<string, unknown>
      if (typeof raw.pid !== 'number') return
      out.push({
        pid: raw.pid,
        ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {}),
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        ...(typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {}),
        ...(typeof raw.messagingSocketPath === 'string' ? { messagingSocketPath: raw.messagingSocketPath } : {}),
        ...(typeof raw.startedAt === 'number' ? { startedAt: raw.startedAt } : {}),
      })
    } catch { /* a record we cannot read is a record we do not have */ }
  }))
  return out
}

/**
 * The socket paths that exist right now.
 *
 * Existence of the socket FILE, not a connect: probing by connecting would wake every session on
 * the machine on every poll. A socket file left behind by a crash is the residual error, and it is
 * caught one step later — the send fails and is reported as a failed send.
 */
export function liveSocketPaths(records: readonly PeerRecord[]): Set<string> {
  const out = new Set<string>()
  for (const r of records) {
    if (r.messagingSocketPath && existsSync(r.messagingSocketPath)) out.add(r.messagingSocketPath)
  }
  return out
}

/** The token a session authenticates its peers with, from `<pid>.<hash>.key`. */
async function peerToken(pid: number, dir = sessionsDir()): Promise<string | null> {
  try {
    const names = await readdir(dir)
    const key = names.find(n => n.startsWith(`${pid}.`) && n.endsWith('.key'))
    if (!key) return null
    const raw = JSON.parse(await readFile(join(dir, key), 'utf8')) as { peerToken?: unknown }
    return typeof raw.peerToken === 'string' ? raw.peerToken : null
  } catch {
    return null
  }
}

export type PeerSendResult =
  | { ok: true; pid: number; name?: string }
  | { ok: false; message: string }

/** Resolve a `--notify` reference against what is on disk right now. */
export async function resolvePeer(ref: string): Promise<PeerSelection> {
  const records = await readPeerRecords()
  return selectPeerTarget(records, ref, liveSocketPaths(records))
}

/** The live sessions, for `agentop events status` to list. */
export async function listLivePeers(): Promise<PeerRecord[]> {
  const records = await readPeerRecords()
  return livePeers(records, liveSocketPaths(records))
}

/**
 * Send one message to one session.
 *
 * `priority: 'next'` rather than `'now'`: the receiving session picks it up at its next turn
 * boundary instead of interrupting the middle of one. This channel reports what other sessions are
 * doing — that is worth a session's attention, not worth cutting into its current work.
 */
export async function sendToPeer(ref: string, body: string): Promise<PeerSendResult> {
  const found = await resolvePeer(ref)
  if (!found.ok) return { ok: false, message: found.message }

  const token = await peerToken(found.target.pid)
  if (!token) {
    return {
      ok: false,
      message: `Claude Code session "${ref}" is running but its messaging key is unreadable, so agentop cannot authenticate to it. The event is in the inbox.`,
    }
  }

  const { socketPath, sessionId, pid, name } = found.target
  return new Promise<PeerSendResult>(resolve => {
    let settled = false
    const done = (r: PeerSendResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.destroy() } catch { /* already gone */ }
      resolve(r)
    }

    const timer = setTimeout(() => done({
      ok: false,
      message: `Claude Code session "${ref}" did not accept the message within ${SEND_TIMEOUT_MS}ms. The event is in the inbox.`,
    }), SEND_TIMEOUT_MS)

    const socket = connect({ path: socketPath })
    socket.on('error', e => done({
      ok: false,
      message: `Could not reach Claude Code session "${ref}" on ${socketPath}: ${e.message}. The event is in the inbox.`,
    }))
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ type: 'auth', token })}\n`)
      socket.write(`${JSON.stringify({
        type: 'user',
        // The receiver refuses a mismatch, which is what makes a stale pid file safe.
        ...(sessionId ? { session_id: sessionId } : {}),
        priority: 'next',
        message: { content: body },
      })}\n`)
      // `end` flushes what was written and closes; the receiver processes the final buffer.
      socket.end(() => done({ ok: true, pid, ...(name !== undefined ? { name } : {}) }))
    })
  })
}
