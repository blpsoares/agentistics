/**
 * team-presence.ts — computes live per-member presence for a central.
 *
 * A member is ONLINE when it has a live reverse-channel WebSocket (real-time,
 * source of truth) OR its last heartbeat push is recent (covers brief socket
 * reconnects). Killing a machine drops the socket and stops pushes, so it falls
 * to OFFLINE on its own. Latency comes from the WebSocket ping/pong RTT.
 *
 * Presence is keyed by resolved display name (token doc `user`), matching how
 * data.ts keys sessions and userStatsCaches — so the frontend can line them up.
 */

import { PUSH_INTERVAL } from '@agentistics/core'
import type { MemberPresence } from '@agentistics/core'
import { getPresenceSignals } from './team-agent'
import { listMembers } from './team-tokens'
import { getCentralConfig } from './central-config'
import { CENTRAL_USER } from './config'

/** Heartbeat staleness window for members that have NEVER held a WS (pure HTTP pushers). */
const HEARTBEAT_MIN_MS = 45_000

/** The per-machine facts `foldPresence` needs. `listMembers()` returns ONE ROW PER MACHINE TOKEN. */
export interface PresenceMemberRow {
  user: string
  lastSeenAt: string | null
}

/**
 * Fold per-MACHINE rows into per-MEMBER presence, keyed by display name.
 *
 * Presence is keyed by display name but `listMembers()` yields one row per machine token, so a
 * member with two machines — or with one stale token left over from a re-connect — produces
 * several rows under the same key. This used to assign `out[m.user]` in a loop, which let the
 * LAST row (newest by createdAt) overwrite the others: a member sitting on a live WebSocket was
 * reported OFFLINE because an unrelated idle token of theirs happened to sort later.
 *
 * A member is online when ANY of their machines is. Latency is the best (lowest) live reading,
 * and `lastSeenAt` the most recent across their machines. Pure.
 */
export function foldPresence(
  members: PresenceMemberRow[],
  signals: Map<string, { online: boolean; latencyMs: number | null; everHadSocket: boolean; inDropGrace: boolean }>,
  staleMs: number,
  now: number,
): Record<string, MemberPresence> {
  const out: Record<string, MemberPresence> = {}
  for (const m of members) {
    const sig = signals.get(m.user)
    let online: boolean
    if (sig?.online) {
      // Live WS — authoritative online.
      online = true
    } else if (sig?.everHadSocket) {
      // The member's WS is the truth: once it drops (kill / disconnect), it's offline after a
      // short grace that absorbs reconnects — NOT kept alive by a lingering heartbeat.
      online = sig.inDropGrace
    } else {
      // Never had a WS (pure HTTP pusher) → fall back to the heartbeat window.
      const seenMs = m.lastSeenAt ? Date.parse(m.lastSeenAt) : NaN
      online = !Number.isNaN(seenMs) && now - seenMs < staleMs
    }
    const prev = out[m.user]
    const latency = sig?.latencyMs ?? null
    if (!prev) {
      out[m.user] = { online, lastSeenAt: m.lastSeenAt, latencyMs: latency }
      continue
    }
    const prevSeen = prev.lastSeenAt ? Date.parse(prev.lastSeenAt) : NaN
    const thisSeen = m.lastSeenAt ? Date.parse(m.lastSeenAt) : NaN
    const newer = Number.isNaN(thisSeen) ? false : Number.isNaN(prevSeen) || thisSeen > prevSeen
    out[m.user] = {
      online: prev.online || online,
      lastSeenAt: newer ? m.lastSeenAt : prev.lastSeenAt,
      latencyMs: prev.latencyMs == null ? latency : latency == null ? prev.latencyMs : Math.min(prev.latencyMs, latency),
    }
  }
  return out
}

export async function computePresence(): Promise<Record<string, MemberPresence>> {
  const now = Date.now()
  const signals = getPresenceSignals(now)
  const [members, cfg] = await Promise.all([
    listMembers().catch(() => []),
    getCentralConfig().catch(() => ({ pushIntervalSec: PUSH_INTERVAL.DEFAULT_SEC, includeOfflineData: true })),
  ])

  // Heartbeat window only applies to members that never established a WS.
  const staleMs = Math.max(HEARTBEAT_MIN_MS, cfg.pushIntervalSec * 1000 * 2.5)

  const out = foldPresence(members, signals, staleMs, now)

  // The central machine itself, when self-contributing, is always online (it is serving).
  if (CENTRAL_USER && !out[CENTRAL_USER]) {
    out[CENTRAL_USER] = { online: true, lastSeenAt: new Date(now).toISOString(), latencyMs: 0 }
  }

  return out
}
