import type { SessionMeta } from '@agentistics/core'

export const LIVE_THRESHOLD_MIN = 10

/** Epoch ms of the session's last activity: end_time → last user timestamp → start_time. 0 if none. */
export function lastActivityMs(s: SessionMeta): number {
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

export function isLive(s: SessionMeta, nowMs: number, thresholdMin: number = LIVE_THRESHOLD_MIN): boolean {
  const last = lastActivityMs(s)
  if (last <= 0) return false
  return nowMs - last <= thresholdMin * 60_000
}
