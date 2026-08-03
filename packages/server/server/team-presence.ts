/**
 * team-presence.ts — computes live presence for a central, for both machines and people.
 *
 * A machine is ONLINE when it has a live reverse-channel WebSocket (real-time,
 * source of truth) OR its last heartbeat push is recent (covers brief socket
 * reconnects). Killing a machine drops the socket and stops pushes, so it falls
 * to OFFLINE on its own. Latency comes from the WebSocket ping/pong RTT.
 *
 * Presence is computed in two layers:
 *   1. `foldMachinePresence` / `computeMachinePresence` — keyed by `id` (memberId, the token
 *      hash), the machine's own stable identity. This is the source of truth: one row in, one
 *      entry out, so a machine's presence can never be confused with another's.
 *   2. `foldPresenceByUser` / `computePresence` — folds per-machine presence UP into per-person
 *      (`user`) presence for consumers keyed by display name (the members filter, MembersPage):
 *      a person is online while ANY of their machines is. An ownerless machine (`user: ''`, see
 *      `machineUserFor` in team-tokens.ts) has no person to fold into and is skipped.
 *
 * Keying the SOURCE (step 1, and the socket registry in team-agent.ts) by `user` instead of the
 * machine's own id was the bug this replaced: every ownerless machine shares `user: ''`, so
 * folding at the source — rather than only at this display layer — made one ownerless machine's
 * online socket read as every other ownerless machine's presence too. Machine-scoped consumers
 * (the IAM machines list, MachinesSettings) must read `computeMachinePresence()` directly, never
 * `computePresence()`.
 */

import { PUSH_INTERVAL } from '@agentistics/core'
import type { MemberPresence } from '@agentistics/core'
import { getPresenceSignals } from './team-agent'
import { listMembers } from './team-tokens'
import { getCentralConfig } from './central-config'
import { CENTRAL_USER } from './config'

/** Heartbeat staleness window for machines that have NEVER established a WS (pure HTTP pushers). */
const HEARTBEAT_MIN_MS = 45_000

/** The per-machine facts presence needs. `listMembers()` returns ONE ROW PER MACHINE TOKEN.
 *  `id` is the memberId (token hash) — the machine's stable identity. `user` is the resolved
 *  owner display name, or `''` for an ownerless machine. */
export interface PresenceMemberRow {
  id: string
  user: string
  lastSeenAt: string | null
}

export interface PresenceSignalLike {
  online: boolean
  latencyMs: number | null
  everHadSocket: boolean
  inDropGrace: boolean
}

/**
 * Per-MACHINE presence, keyed by `id` (memberId). Pure — one row in, one entry out, so distinct
 * machines can never share a signal regardless of what `user` they carry (or don't).
 */
export function foldMachinePresence(
  members: PresenceMemberRow[],
  signals: Map<string, PresenceSignalLike>,
  staleMs: number,
  now: number,
): Record<string, MemberPresence> {
  const out: Record<string, MemberPresence> = {}
  for (const m of members) {
    const sig = signals.get(m.id)
    let online: boolean
    if (sig?.online) {
      // Live WS — authoritative online.
      online = true
    } else if (sig?.everHadSocket) {
      // The machine's WS is the truth: once it drops (kill / disconnect), it's offline after a
      // short grace that absorbs reconnects — NOT kept alive by a lingering heartbeat.
      online = sig.inDropGrace
    } else {
      // Never had a WS (pure HTTP pusher) → fall back to the heartbeat window.
      const seenMs = m.lastSeenAt ? Date.parse(m.lastSeenAt) : NaN
      online = !Number.isNaN(seenMs) && now - seenMs < staleMs
    }
    out[m.id] = { online, lastSeenAt: m.lastSeenAt, latencyMs: sig?.latencyMs ?? null }
  }
  return out
}

/**
 * Fold per-MACHINE presence (keyed by `id`) into per-PERSON presence (keyed by `user`): a person
 * is online when ANY of their machines is. Latency is the best (lowest) live reading, and
 * `lastSeenAt` the most recent across their machines. An ownerless machine (`user: ''`) is
 * skipped — it has no person to fold into, and must never be counted under a shared blank key.
 * Pure.
 */
export function foldPresenceByUser(
  members: PresenceMemberRow[],
  machinePresence: Record<string, MemberPresence>,
): Record<string, MemberPresence> {
  const out: Record<string, MemberPresence> = {}
  for (const m of members) {
    if (!m.user) continue
    const p = machinePresence[m.id]
    if (!p) continue
    const prev = out[m.user]
    if (!prev) {
      out[m.user] = { ...p }
      continue
    }
    const prevSeen = prev.lastSeenAt ? Date.parse(prev.lastSeenAt) : NaN
    const thisSeen = p.lastSeenAt ? Date.parse(p.lastSeenAt) : NaN
    const newer = Number.isNaN(thisSeen) ? false : Number.isNaN(prevSeen) || thisSeen > prevSeen
    out[m.user] = {
      online: prev.online || p.online,
      lastSeenAt: newer ? p.lastSeenAt : prev.lastSeenAt,
      latencyMs: prev.latencyMs == null ? p.latencyMs : p.latencyMs == null ? prev.latencyMs : Math.min(prev.latencyMs, p.latencyMs),
    }
  }
  return out
}

/** Shared (impure) setup for both presence entry points below — one snapshot, one clock. */
async function gatherPresenceInputs(): Promise<{
  members: PresenceMemberRow[]
  signals: Map<string, PresenceSignalLike>
  staleMs: number
  now: number
}> {
  const now = Date.now()
  const signals = getPresenceSignals(now)
  const [members, cfg] = await Promise.all([
    listMembers().catch(() => []),
    getCentralConfig().catch(() => ({ pushIntervalSec: PUSH_INTERVAL.DEFAULT_SEC, includeOfflineData: true })),
  ])
  // Heartbeat window only applies to machines that never established a WS.
  const staleMs = Math.max(HEARTBEAT_MIN_MS, cfg.pushIntervalSec * 1000 * 2.5)
  return { members, signals, staleMs, now }
}

/** Per-MACHINE presence, keyed by `memberId`. Use this for any machine-scoped view (the IAM
 *  machines list, MachinesSettings) — never the per-user `computePresence()` below, which folds
 *  several machines together on purpose. */
export async function computeMachinePresence(): Promise<Record<string, MemberPresence>> {
  const { members, signals, staleMs, now } = await gatherPresenceInputs()
  return foldMachinePresence(members, signals, staleMs, now)
}

/** Per-PERSON presence, keyed by resolved `user` display name. A person is online while any of
 *  their machines is; an ownerless machine contributes no entry (see `foldPresenceByUser`). */
export async function computePresence(): Promise<Record<string, MemberPresence>> {
  const { members, signals, staleMs, now } = await gatherPresenceInputs()
  const machine = foldMachinePresence(members, signals, staleMs, now)
  const out = foldPresenceByUser(members, machine)

  // The central machine itself, when self-contributing, is always online (it is serving).
  if (CENTRAL_USER && !out[CENTRAL_USER]) {
    out[CENTRAL_USER] = { online: true, lastSeenAt: new Date(now).toISOString(), latencyMs: 0 }
  }

  return out
}
