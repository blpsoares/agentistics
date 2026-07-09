import { readdir, readlink, readFile } from 'fs/promises'
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

/** Read the working directories of every running `claude` process (Linux /proc only).
 *  One entry per process, so a project with two open sessions appears twice.
 *  Returns [] on non-Linux hosts or when /proc is unreadable. */
export async function claudeProcessCwds(): Promise<string[]> {
  if (process.platform !== 'linux') return []
  let pids: string[]
  try { pids = await readdir('/proc') } catch { return [] }
  const cwds: string[] = []
  await Promise.all(pids.filter(p => /^\d+$/.test(p)).map(async pid => {
    try {
      const comm = (await readFile(`/proc/${pid}/comm`, 'utf-8')).trim()
      if (comm !== 'claude') return
      const cwd = await readlink(`/proc/${pid}/cwd`)
      if (cwd) cwds.push(cwd)
    } catch { /* process exited or not ours — ignore */ }
  }))
  return cwds
}

/** Map open-process cwds to the session_ids that are currently open. For each cwd holding
 *  K live `claude` processes, the K most-recently-active sessions whose project_path === cwd
 *  are considered open. Pure — the process list is the only external input. */
export function resolveOpenSessionIds(cwds: string[], sessions: SessionMeta[]): Set<string> {
  const perCwd = new Map<string, number>()
  for (const c of cwds) perCwd.set(c, (perCwd.get(c) ?? 0) + 1)

  const open = new Set<string>()
  for (const [cwd, k] of perCwd) {
    const inProject = sessions
      .filter(s => s.project_path === cwd)
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a))
      .slice(0, k)
    for (const s of inProject) open.add(s.session_id)
  }
  return open
}

/** Convenience: read live processes and resolve to open session_ids in one call. */
export async function getLiveSessionIds(sessions: SessionMeta[]): Promise<string[]> {
  const cwds = await claudeProcessCwds()
  return [...resolveOpenSessionIds(cwds, sessions)]
}
