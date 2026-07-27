import { readdir, readlink, readFile, stat } from 'fs/promises'
import type { SessionMeta } from '@agentistics/core'

/** Epoch ms of a session's last activity: end_time → last user timestamp → start_time. 0 if none. */
function lastActivityMs(s: SessionMeta): number {
  const candidates: string[] = []
  if (s.end_time) candidates.push(s.end_time)
  const ts = s.user_message_timestamps
  if (ts && ts.length > 0) candidates.push(ts[ts.length - 1]!)
  if (s.start_time) candidates.push(s.start_time)
  for (const c of candidates) {
    const t = Date.parse(c)
    if (!Number.isNaN(t)) return t
  }
  return 0
}

/** A running `claude` process. `sessionId` is set only when the process states which session it is
 *  driving (the IDE extension passes `--resume=<id>`); it is the ONLY trustworthy identity we get. */
export interface ClaudeProcess {
  cwd: string
  /** Exact session the process resumed, when argv says so. */
  sessionId?: string
  /** Process start time (epoch ms). Bounds which sessions an anonymous process could be driving. */
  startedMs?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pull the session id out of a `claude` argv. Recognises the flags the CLI and the IDE extension
 *  actually use, in both `--flag=value` and `--flag value` form. Returns undefined for a fresh
 *  session (no id on the command line yet) or an unrecognised value. */
export function sessionIdFromArgv(argv: string[]): string | undefined {
  const FLAGS = new Set(['--resume', '--session-id', '-r'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.indexOf('=')
    if (eq > 0) {
      if (FLAGS.has(arg.slice(0, eq))) {
        const v = arg.slice(eq + 1)
        if (UUID_RE.test(v)) return v
      }
      continue
    }
    // `--resume` with no value is the interactive picker, not an id — only take a UUID.
    if (FLAGS.has(arg)) {
      const v = argv[i + 1]
      if (v && UUID_RE.test(v)) return v
    }
  }
  return undefined
}

/** Read every running `claude` process (Linux /proc only): its cwd, the session it resumed when
 *  argv says so, and when it started. Returns [] on non-Linux hosts or when /proc is unreadable. */
export async function claudeProcesses(): Promise<ClaudeProcess[]> {
  if (process.platform !== 'linux') return []
  let pids: string[]
  try { pids = await readdir('/proc') } catch { return [] }
  const procs: ClaudeProcess[] = []
  await Promise.all(pids.filter(p => /^\d+$/.test(p)).map(async pid => {
    try {
      const comm = (await readFile(`/proc/${pid}/comm`, 'utf-8')).trim()
      if (comm !== 'claude') return
      const cwd = await readlink(`/proc/${pid}/cwd`)
      if (!cwd) return
      // argv is NUL-separated; a trailing NUL yields an empty last element.
      const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => ''))
        .split('\0').filter(Boolean)
      const startedMs = await stat(`/proc/${pid}`).then(st => st.mtimeMs).catch(() => undefined)
      procs.push({ cwd, sessionId: sessionIdFromArgv(argv), startedMs })
    } catch { /* process exited or not ours — ignore */ }
  }))
  return procs
}

/** Back-compat: just the cwds. Prefer `claudeProcesses()` — the cwd alone cannot identify a session. */
export async function claudeProcessCwds(): Promise<string[]> {
  return (await claudeProcesses()).map(p => p.cwd)
}

/**
 * Map running processes to the sessions that are actually open.
 *
 * Identity comes from the process itself whenever it is available: the IDE extension launches
 * `claude --resume=<session-id>`, so that id IS the open session — no inference needed. Ranking
 * sessions by recency instead used to mark the wrong ones live: with three extension processes in
 * one project the three most-recently-active sessions were flagged, which reported a session last
 * touched the previous day as open while a genuinely resumed older session was only right by luck.
 *
 * A process with no id on its command line (a fresh session, or a bare `claude`) still has to be
 * matched by project. Two rules keep that fallback from over-claiming:
 *   - sessions already claimed by an exact id are off the table, and
 *   - a candidate must have been active at or after the process started. A process cannot be driving
 *     a session that went quiet before it launched, and that single bound is what rules out the
 *     stale "most recent" session the old code kept picking.
 * Pure — the process list is the only external input.
 */
export function resolveOpenSessionIds(
  procs: Array<ClaudeProcess | string>,
  sessions: SessionMeta[],
): Set<string> {
  const normalised: ClaudeProcess[] = procs.map(p => (typeof p === 'string' ? { cwd: p } : p))
  const byId = new Map(sessions.map(s => [s.session_id, s]))
  const open = new Set<string>()

  // Pass 1 — exact identity. A resumed id we have no session for is dropped rather than guessed at.
  const anonymous: ClaudeProcess[] = []
  for (const p of normalised) {
    if (p.sessionId && byId.has(p.sessionId)) open.add(p.sessionId)
    else if (!p.sessionId) anonymous.push(p)
  }

  // Pass 2 — project fallback for processes that never named a session.
  const perCwd = new Map<string, ClaudeProcess[]>()
  for (const p of anonymous) {
    const list = perCwd.get(p.cwd)
    if (list) list.push(p)
    else perCwd.set(p.cwd, [p])
  }
  for (const [cwd, group] of perCwd) {
    const candidates = sessions
      .filter(s => s.project_path === cwd && !open.has(s.session_id))
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a))
    // Strictest bound first, so the newest process claims the newest session it could be driving
    // and the looser ones are left to fill from what remains.
    const starts = group.map(p => p.startedMs ?? 0).sort((a, b) => b - a)
    const taken = new Set<string>()
    for (const start of starts) {
      const match = candidates.find(s => !taken.has(s.session_id) && lastActivityMs(s) >= start)
      if (!match) continue
      taken.add(match.session_id)
      open.add(match.session_id)
    }
  }
  return open
}

/** Convenience: read live processes and resolve to open session_ids in one call. */
export async function getLiveSessionIds(sessions: SessionMeta[]): Promise<string[]> {
  const procs = await claudeProcesses()
  return [...resolveOpenSessionIds(procs, sessions)]
}
