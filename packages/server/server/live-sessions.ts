import { readdir, readlink, readFile } from 'fs/promises'
import type { HarnessId, SessionMeta } from '@agentistics/core'

/** Backstop for a process that is alive, was used, and then abandoned for a very long time without
 *  ever exiting. The primary rule below (activity must post-date the process) does the real work;
 *  this only bounds the pathological tail. Override with AGENTISTICS_LIVE_WINDOW_MIN. */
export const LIVE_ACTIVITY_WINDOW_MIN = Number(process.env.AGENTISTICS_LIVE_WINDOW_MIN) > 0
  ? Number(process.env.AGENTISTICS_LIVE_WINDOW_MIN)
  : 8 * 60

/** How long a just-launched assistant may show as live before it has written any conversation.
 *  agy persists nothing until a turn completes, so without this an open agy is invisible; past the
 *  grace period an empty process is idle or leaked rather than starting up. */
export const LIVE_STARTUP_GRACE_MIN = Number(process.env.AGENTISTICS_LIVE_STARTUP_MIN) > 0
  ? Number(process.env.AGENTISTICS_LIVE_STARTUP_MIN)
  : 30

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

/** Where a session IS, which is not always the project it belongs to: a session that moved into a
 *  git worktree keeps `project_path` at the directory it was opened in (so the worktree's work
 *  still counts as the same project) while its process runs in the worktree. The process cwd is
 *  matched against this, and against this alone — a moved session is in one place, not two. */
export function sessionCwd(s: SessionMeta): string {
  return s.current_cwd || s.project_path
}

/** Process name (`/proc/<pid>/comm`) → the harness it belongs to. `comm` is truncated to 15 chars
 *  by the kernel, which none of these reach. A session is only ever matched to a process of its own
 *  harness, so a `gemini` process can never mark an `antigravity` session open (they share a home
 *  directory but are separate harnesses). */
const PROCESS_HARNESS: Record<string, HarnessId> = {
  claude: 'claude',
  agy: 'antigravity',
  antigravity: 'antigravity',
  codex: 'codex',
  gemini: 'gemini',
  copilot: 'copilot',
  kimi: 'kimi',
}

/** `comm` is not always the tool's name: `gh copilot` runs its binary with the thread name
 *  `MainThread`, so matching on comm alone missed Copilot entirely. The executable's own basename
 *  is the reliable identity, with comm kept as the cheap first guess. */
export function harnessOf(comm: string, exePath: string | undefined): HarnessId | undefined {
  const byComm = PROCESS_HARNESS[comm]
  if (byComm) return byComm
  if (!exePath) return undefined
  const base = exePath.slice(exePath.lastIndexOf('/') + 1)
  return PROCESS_HARNESS[base]
}

/** Where each harness keeps a session file open while it is running. An fd pointing into that path
 *  names the live session outright — the strongest identity available, since it comes from the
 *  kernel rather than from argv or a guess. Copilot holds `session-state/<id>/session.db` open. */
const FD_SESSION_PATTERNS: Partial<Record<HarnessId, RegExp>> = {
  copilot: /\/\.copilot\/session-state\/([0-9a-f-]{36})\//i,
  codex: /\/rollout-[^/]*?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
}

/** Boot time in epoch seconds, read once — it cannot change while the process runs. */
let _btime: number | null = null
async function bootTimeSec(): Promise<number> {
  if (_btime !== null) return _btime
  const stat = await readFile('/proc/stat', 'utf-8').catch(() => '')
  const line = stat.split('\n').find(l => l.startsWith('btime '))
  _btime = line ? Number(line.slice(6).trim()) : 0
  return _btime
}

/**
 * Real process start time, in epoch ms.
 *
 * NOT the mtime of /proc/<pid>: that timestamp moves while the process runs (it tracked ~3 minutes
 * forward across two samples of one live process here), which silently broke every rule comparing
 * a session's activity against when its process launched. Field 22 of /proc/<pid>/stat is the
 * kernel's own start time in clock ticks since boot and never moves.
 */
async function processStartMs(pid: string, btimeSec: number, hz: number): Promise<number | undefined> {
  const raw = await readFile(`/proc/${pid}/stat`, 'utf-8').catch(() => '')
  // comm sits in parentheses and may itself contain spaces/parens, so split after the LAST ')'.
  const close = raw.lastIndexOf(')')
  if (close < 0) return undefined
  const fields = raw.slice(close + 2).split(' ')
  const ticks = Number(fields[19]) // field 22 overall = index 19 of the post-comm fields
  if (!Number.isFinite(ticks) || !btimeSec) return undefined
  return (btimeSec + ticks / hz) * 1000
}

/** Pure: pick the session id out of a process's open file paths. */
export function sessionIdFromFdPaths(paths: string[], harness: HarnessId): string | undefined {
  const pattern = FD_SESSION_PATTERNS[harness]
  if (!pattern) return undefined
  for (const target of paths) {
    const m = pattern.exec(target)
    if (m && m[1]) return m[1]
  }
  return undefined
}

/** Session id from an open file descriptor, when the harness keeps its session file open. */
async function sessionIdFromFds(pid: string, harness: HarnessId): Promise<string | undefined> {
  if (!FD_SESSION_PATTERNS[harness]) return undefined
  const fds = await readdir(`/proc/${pid}/fd`).catch(() => [] as string[])
  const paths = await Promise.all(fds.map(fd => readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')))
  return sessionIdFromFdPaths(paths.filter(Boolean), harness)
}

/** A running harness process. `sessionId` is set only when the process states which session it is
 *  driving, which is the one identity signal that needs no inference. */
export interface HarnessProcess {
  harness: HarnessId
  cwd: string
  /** Exact session the process resumed, when argv says so. */
  sessionId?: string
  /** Process start time (epoch ms). Bounds which sessions an anonymous process could be driving. */
  startedMs?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Flags that carry a session/conversation id, across every harness we read. `--continue` is
 *  deliberately absent: it names no id, so it tells us nothing we can attribute. */
const ID_FLAGS = new Set([
  '--resume', '--session-id', '-r', '--conversation', '--conversation-id',
  '--session', '-S', // Kimi Code: `kimi -S <id>` resumes that session
])

/** Pull the session id out of a harness argv, in both `--flag=value` and `--flag value` form.
 *  Returns undefined for a fresh session (no id on the command line yet), for a bare `--resume`
 *  (that opens the interactive picker), or for anything that is not a session id. */
export function sessionIdFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.indexOf('=')
    if (eq > 0) {
      if (ID_FLAGS.has(arg.slice(0, eq))) {
        const v = arg.slice(eq + 1)
        if (UUID_RE.test(v)) return v
      }
      continue
    }
    if (ID_FLAGS.has(arg)) {
      const v = argv[i + 1]
      if (v && UUID_RE.test(v)) return v
    }
  }
  return undefined
}

/** Read every running harness process (Linux /proc only): which harness it is, its cwd, the session
 *  it resumed when argv says so, and when it started. [] on non-Linux hosts or unreadable /proc. */
export async function harnessProcesses(): Promise<HarnessProcess[]> {
  if (process.platform !== 'linux') return []
  let pids: string[]
  try { pids = await readdir('/proc') } catch { return [] }
  const btimeSec = await bootTimeSec()
  const hz = 100 // USER_HZ is 100 on every Linux this runs on; only used to scale start ticks.
  const procs: HarnessProcess[] = []
  await Promise.all(pids.filter(p => /^\d+$/.test(p)).map(async pid => {
    try {
      const comm = (await readFile(`/proc/${pid}/comm`, 'utf-8')).trim()
      const exePath = await readlink(`/proc/${pid}/exe`).catch(() => undefined)
      const harness = harnessOf(comm, exePath)
      if (!harness) return
      const cwd = await readlink(`/proc/${pid}/cwd`)
      if (!cwd) return
      // argv is NUL-separated; a trailing NUL yields an empty last element.
      const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => ''))
        .split('\0').filter(Boolean)
      const startedMs = await processStartMs(pid, btimeSec, hz)
      // An open session file beats argv: it is what the process is writing to right now.
      const sessionId = (await sessionIdFromFds(pid, harness)) ?? sessionIdFromArgv(argv)
      procs.push({ harness, cwd, sessionId, startedMs })
    } catch { /* process exited or not ours — ignore */ }
  }))
  return procs
}

/** Back-compat: the cwds of running `claude` processes only. Prefer `harnessProcesses()`. */
export async function claudeProcessCwds(): Promise<string[]> {
  return (await harnessProcesses()).filter(p => p.harness === 'claude').map(p => p.cwd)
}

/**
 * Map running processes to the sessions that are actually open.
 *
 * Two signals must agree, because each one alone produces wrong answers:
 *
 *   1. A running process of the session's own harness. Identity comes from the process itself
 *      whenever possible — the IDE extension launches `claude --resume=<id>`, and agy takes
 *      `--conversation <id>`. Ranking a project's sessions by recency instead (what this used to do)
 *      marked the wrong ones live: a session last touched days earlier was reported open while a
 *      genuinely resumed older session was only right by luck.
 *   2. Activity that POST-DATES the process. A live process is not proof on its own, not even when
 *      it names the session outright: reopening an editor restores its panels, so a `--resume`
 *      process routinely exists for a conversation nobody has touched in days. If the session has
 *      not been used once since its process started, that process is holding a restored-but-unused
 *      panel, not an open session. This bound is what a plain "active in the last N minutes" window
 *      cannot express — the window also throws away a session you really do have open and simply
 *      have not typed into for a while, which is why `windowMin` is only a far-out backstop.
 *
 * A process that never named a session (a fresh session, a bare `claude`, `agy` with no flags) is
 * still matched by harness + project. That fallback cannot claim a session already taken by an
 * exact id, and cannot claim one that went quiet before the process started.
 *
 * Pure — the process list and `nowMs` are the only external inputs.
 */
export function resolveOpenSessionIds(
  procs: Array<HarnessProcess | string>,
  sessions: SessionMeta[],
  nowMs: number = Date.now(),
  windowMin: number = LIVE_ACTIVITY_WINDOW_MIN,
): Set<string> {
  // A bare string is a legacy claude cwd.
  const normalised: HarnessProcess[] = procs.map(p =>
    (typeof p === 'string' ? { harness: 'claude' as HarnessId, cwd: p } : p))

  const floor = nowMs - windowMin * 60_000
  const isFresh = (s: SessionMeta): boolean => lastActivityMs(s) >= floor

  const byId = new Map(sessions.map(s => [s.session_id, s]))
  const open = new Set<string>()

  // Pass 1 — exact identity. The id must name a session of that process's own harness, and the
  // session must have been touched since the process launched; a resumed id we have no session for
  // is dropped, never guessed at.
  const anonymous: HarnessProcess[] = []
  for (const p of normalised) {
    if (!p.sessionId) { anonymous.push(p); continue }
    const s = byId.get(p.sessionId)
    if (s && s.harness === p.harness && isFresh(s) && lastActivityMs(s) >= (p.startedMs ?? 0)) {
      open.add(s.session_id)
    }
  }

  // Pass 2 — harness + project fallback for processes that never named a session.
  const groups = new Map<string, HarnessProcess[]>()
  for (const p of anonymous) {
    const key = `${p.harness} ${p.cwd}`
    const list = groups.get(key)
    if (list) list.push(p)
    else groups.set(key, [p])
  }
  for (const group of groups.values()) {
    const { harness, cwd } = group[0]!
    const candidates = sessions
      .filter(s => s.harness === harness && sessionCwd(s) === cwd && !open.has(s.session_id))
      .filter(isFresh)
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a))
    // Strictest bound first, so the newest process claims the newest session it could be driving
    // and the looser ones fill from what remains.
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
  const procs = await harnessProcesses()
  return [...resolveOpenSessionIds(procs, sessions)]
}

/** A running assistant with no session to point at yet. An assistant does not necessarily persist a
 *  conversation the moment it starts — agy creates nothing on disk until a turn completes — so
 *  reporting only matched sessions makes a freshly-opened one invisible. These are surfaced
 *  separately, with no metrics, because there is genuinely nothing to measure yet. */
export interface UnmatchedProcess {
  harness: HarnessId
  cwd: string
  startedMs?: number
  /** Set when the process named a session we have no record of (deleted or not yet written). */
  sessionId?: string
}

export interface LiveSnapshot {
  /** session_ids of persisted sessions that are open right now. */
  liveSessionIds: string[]
  /** Running assistants that could not be matched to any persisted session. */
  liveProcesses: UnmatchedProcess[]
}

/** Split the running processes into "drives a known session" and "running but nothing on disk yet".
 *  Pure, so the attribution stays testable. */
export function resolveLiveSnapshot(
  procs: HarnessProcess[],
  sessions: SessionMeta[],
  nowMs: number = Date.now(),
  windowMin: number = LIVE_ACTIVITY_WINDOW_MIN,
): LiveSnapshot {
  const open = resolveOpenSessionIds(procs, sessions, nowMs, windowMin)

  // A process is "accounted for" when one of the open sessions could plausibly be the one it drives:
  // its own id, or — for an anonymous process — an open session of the same harness and project.
  // Counting per group keeps three panels in one project from being covered by a single session.
  const remaining = new Map<string, number>()
  for (const id of open) {
    const s = sessions.find(x => x.session_id === id)
    if (s) {
      const key = `${s.harness} ${sessionCwd(s)}`
      remaining.set(key, (remaining.get(key) ?? 0) + 1)
    }
  }

  const known = new Set(sessions.map(s => s.session_id))
  const graceFloor = nowMs - LIVE_STARTUP_GRACE_MIN * 60_000

  const unmatched: UnmatchedProcess[] = []
  for (const p of procs) {
    // The process named a session we already know about. Whether it ended up open or not, that call
    // was made above with better evidence than "a process exists" — re-surfacing it here would put
    // the restored-but-unused panels straight back into the list.
    if (p.sessionId && known.has(p.sessionId)) continue
    const key = `${p.harness} ${p.cwd}`
    const left = remaining.get(key) ?? 0
    if (!p.sessionId && left > 0) { remaining.set(key, left - 1); continue }
    // Nothing on disk to attribute. That is only believable while the assistant is still starting
    // up; a process running for hours with no conversation to show is idle or leaked, not warming up.
    if ((p.startedMs ?? 0) < graceFloor) continue
    unmatched.push({
      harness: p.harness,
      cwd: p.cwd,
      ...(p.startedMs !== undefined ? { startedMs: p.startedMs } : {}),
      ...(p.sessionId ? { sessionId: p.sessionId } : {}),
    })
  }
  return { liveSessionIds: [...open], liveProcesses: unmatched }
}

/** Read the processes and produce the full snapshot in one call. */
export async function getLiveSnapshot(sessions: SessionMeta[]): Promise<LiveSnapshot> {
  return resolveLiveSnapshot(await harnessProcesses(), sessions)
}
