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
import { getOnlineLatency } from './team-agent'
import { listMembers } from './team-tokens'
import { getCentralConfig } from './central-config'
import { CENTRAL_USER } from './config'

/** Minimum staleness window before a heartbeat is considered offline. */
const MIN_STALE_MS = 90_000

export async function computePresence(): Promise<Record<string, MemberPresence>> {
  const online = getOnlineLatency()
  const [members, cfg] = await Promise.all([
    listMembers().catch(() => []),
    getCentralConfig().catch(() => ({ pushIntervalSec: PUSH_INTERVAL.DEFAULT_SEC, includeOfflineData: true })),
  ])

  // A member is heartbeat-online if its last push is within ~3 push cycles (min 90s).
  const staleMs = Math.max(MIN_STALE_MS, cfg.pushIntervalSec * 1000 * 3)
  const now = Date.now()

  const out: Record<string, MemberPresence> = {}
  for (const m of members) {
    const socketOnline = online.has(m.user)
    const seenMs = m.lastSeenAt ? Date.parse(m.lastSeenAt) : NaN
    const heartbeatOnline = !Number.isNaN(seenMs) && now - seenMs < staleMs
    out[m.user] = {
      online: socketOnline || heartbeatOnline,
      lastSeenAt: m.lastSeenAt,
      latencyMs: online.get(m.user) ?? null,
    }
  }

  // The central machine itself, when self-contributing, is always online (it is serving).
  if (CENTRAL_USER && !out[CENTRAL_USER]) {
    out[CENTRAL_USER] = { online: true, lastSeenAt: new Date(now).toISOString(), latencyMs: 0 }
  }

  return out
}
