/**
 * peer-target.ts — PURE. Which Claude Code session a `--notify` names, and whether it is alive.
 *
 * ## The registry says who EXISTS; the socket says who is UP
 *
 * Claude Code writes `~/.claude/sessions/<pid>.json` for every session and does not always remove
 * it when that session ends. Measured on this machine: 79 records, five live sockets. Several
 * records share one `sessionId` — a session that was resumed leaves the old record behind, holding
 * the same conversation id and a pid that is now somebody else's or nobody's.
 *
 * So the record alone answers nothing. The pair does: a record is DELIVERABLE only when the socket
 * it names is present. That is the whole of the liveness rule, and it is the reason this module
 * takes the set of live socket paths as an argument rather than deriving anything from the record.
 *
 * ## A target that is not up is reported, never assumed
 *
 * `selectPeerTarget` returns a discriminated result. There is no "probably fine" branch: the event
 * stays in the inbox, the command SAYS it was not delivered, and the session reads it the next time
 * it looks. Pretending otherwise is how a channel becomes something people trust and shouldn't.
 */

/** One `~/.claude/sessions/<pid>.json`, as far as this module cares. */
export interface PeerRecord {
  pid: number
  /** Claude's own conversation id. Sent with the message so a stale pid cannot misdeliver it. */
  sessionId?: string
  /** The name the session registered under, when it has one. */
  name?: string
  cwd?: string
  messagingSocketPath?: string
  /** Epoch ms. Newest wins when two live records answer to one name. */
  startedAt?: number
}

export interface PeerTarget {
  pid: number
  socketPath: string
  sessionId?: string
  name?: string
  cwd?: string
}

export type PeerSelection =
  | { ok: true; target: PeerTarget }
  | { ok: false; code: 'no-match'; message: string }
  | { ok: false; code: 'not-live'; message: string }
  | { ok: false; code: 'ambiguous'; message: string; candidates: string[] }

const label = (r: PeerRecord): string => `${r.name ?? '(unnamed)'} (pid ${r.pid})`

/**
 * Resolve a `--notify` reference against the records.
 *
 * A reference matches a record's NAME (case-insensitively, whole) or its PID (exactly). Not a
 * prefix: session names here are chosen by people and are frequently prefixes of each other
 * ("cockpit", "cockpit-2"), and delivering a message to the wrong assistant is not a mistake that
 * announces itself.
 *
 * `liveSockets` is the set of socket paths that exist right now.
 */
export function selectPeerTarget(
  records: readonly PeerRecord[],
  ref: string,
  liveSockets: ReadonlySet<string>,
): PeerSelection {
  const want = ref.trim().toLowerCase()
  if (want === '') return { ok: false, code: 'no-match', message: 'No session was named.' }

  const matched = records.filter(r =>
    String(r.pid) === want || (r.name !== undefined && r.name.toLowerCase() === want))

  if (matched.length === 0) {
    return {
      ok: false,
      code: 'no-match',
      message: `No Claude Code session is registered as "${ref}". \`agentop events status\` lists the ones that are.`,
    }
  }

  const live = matched.filter(r =>
    r.messagingSocketPath !== undefined && liveSockets.has(r.messagingSocketPath))

  if (live.length === 0) {
    return {
      ok: false,
      code: 'not-live',
      message: `Claude Code session "${ref}" is registered but not running (no messaging socket) — `
        + `${matched.map(label).join(', ')}. The event is in the inbox; that session reads it with `
        + '`agentop events tail` when it next runs.',
    }
  }

  if (live.length > 1) {
    // Two LIVE sessions answering to one name is genuinely ambiguous, and picking the newest would
    // be a coin flip dressed as a rule. The caller is told which ones, so it can name a pid.
    const sorted = [...live].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    return {
      ok: false,
      code: 'ambiguous',
      message: `"${ref}" names ${live.length} running Claude Code sessions — pass a pid instead.`,
      candidates: sorted.map(label),
    }
  }

  const r = live[0]!
  return {
    ok: true,
    target: {
      pid: r.pid,
      socketPath: r.messagingSocketPath!,
      ...(r.sessionId !== undefined ? { sessionId: r.sessionId } : {}),
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.cwd !== undefined ? { cwd: r.cwd } : {}),
    },
  }
}

/** The live sessions, newest first — what `agentop events status` lists so a `--notify` can be
 *  typed without guessing. */
export function livePeers(
  records: readonly PeerRecord[],
  liveSockets: ReadonlySet<string>,
): PeerRecord[] {
  return records
    .filter(r => r.messagingSocketPath !== undefined && liveSockets.has(r.messagingSocketPath))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
}
