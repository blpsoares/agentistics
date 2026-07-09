// team-agent.ts — central-side WebSocket agent registry (Phase 7)
//
// Maintains a live map of member → connected ServerWebSocket sockets, and
// tracks presence/liveness (ping/pong RTT) for the team dashboard. On-demand
// chat retrieval over this channel has been removed — the central never
// requests or views member chat (see GET /api/team/session-chat, which is
// now a 410 in index.ts).

import type { ServerWebSocket } from 'bun'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data attached to each server-side WebSocket via server.upgrade(req, { data }) */
export interface AgentSocketData {
  user: string
  isAgent?: boolean
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** user → set of connected member sockets */
const agentSockets = new Map<string, Set<ServerWebSocket<AgentSocketData>>>()

/** Users that have EVER held a live socket this run — so once a member's WS drops we can
 *  trust that signal (offline after a short grace) instead of waiting out the heartbeat. */
const everHadSocket = new Set<string>()
/** user → ms epoch when their LAST socket dropped (cleared on reconnect). */
const lastDropAt = new Map<string, number>()
/** user → ms epoch of the last "member connected" notification, to suppress reconnect spam. */
const lastConnectNotifyAt = new Map<string, number>()
/** Don't re-announce the same member connecting more than once per this window. */
const CONNECT_NOTIFY_THROTTLE_MS = 5 * 60_000

/** Grace after a socket drops before the member counts as offline — absorbs the brief WS
 *  reconnect gap (backoff starts at 1s) without flickering, while still flipping fast on a kill. */
const SOCKET_GRACE_MS = 8_000

// ---------------------------------------------------------------------------
// Liveness + latency — ping each socket periodically; a socket that misses
// MAX_MISSED_PONGS consecutive pings is considered dead and force-closed, so a
// hard-killed machine (no TCP FIN) still transitions to offline promptly.
// ---------------------------------------------------------------------------

const PING_INTERVAL_MS = 10_000
const MAX_MISSED_PONGS = 2

interface SockState {
  latencyMs: number | null
  awaitingPong: boolean
  pingSentAt: number
  missed: number
}

const sockState = new Map<ServerWebSocket<AgentSocketData>, SockState>()
let pingTimer: ReturnType<typeof setInterval> | null = null
/** Optional hook (wired by index.ts) fired when the online set changes, for live UI updates. */
let onPresenceChange: (() => void) | null = null

export function setPresenceChangeHook(fn: () => void): void {
  onPresenceChange = fn
}

function ensurePingLoop(): void {
  if (pingTimer) return
  pingTimer = setInterval(() => {
    for (const [ws, st] of sockState) {
      if (st.awaitingPong) {
        st.missed += 1
        if (st.missed >= MAX_MISSED_PONGS) {
          try { ws.close() } catch { /* close() triggers the close handler → unregisterAgent */ }
          continue
        }
      }
      st.awaitingPong = true
      st.pingSentAt = Date.now()
      try { ws.ping() } catch { /* dead socket; next tick escalates via missed count */ }
    }
  }, PING_INTERVAL_MS)
}

function stopPingLoop(): void {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle hooks (called from index.ts websocket: {} handler)
// ---------------------------------------------------------------------------

export function registerAgent(ws: ServerWebSocket<AgentSocketData>): void {
  const { user } = ws.data
  // Was this member offline (no live socket) before this connection?
  const wasOffline = !agentSockets.has(user) || agentSockets.get(user)!.size === 0
  if (!agentSockets.has(user)) agentSockets.set(user, new Set())
  agentSockets.get(user)!.add(ws)
  sockState.set(ws, { latencyMs: null, awaitingPong: false, pingSentAt: 0, missed: 0 })
  everHadSocket.add(user)
  lastDropAt.delete(user) // reconnected → clear the drop marker
  ensurePingLoop()
  onPresenceChange?.()

  // Announce a genuine connect on the central (throttled so a flapping reconnect never spams).
  if (wasOffline) {
    const now = Date.now()
    if (now - (lastConnectNotifyAt.get(user) ?? 0) > CONNECT_NOTIFY_THROTTLE_MS) {
      lastConnectNotifyAt.set(user, now)
      void import('./sse').then(m => m.broadcastNotification({
        type: 'info', code: 'central.member_connected', meta: { user },
      })).catch(() => { /* best-effort */ })
    }
  }
}

export function unregisterAgent(ws: ServerWebSocket<AgentSocketData>): void {
  const { user } = ws.data
  sockState.delete(ws)
  const sockets = agentSockets.get(user)
  if (!sockets) { if (sockState.size === 0) stopPingLoop(); return }
  sockets.delete(ws)
  if (sockets.size === 0) {
    agentSockets.delete(user)
    // Record the drop; after the grace, the member counts as offline. Fire a presence update
    // AT grace-expiry so the dashboard flips without waiting for its next poll.
    lastDropAt.set(user, Date.now())
    setTimeout(() => { if (!agentSockets.has(user)) onPresenceChange?.() }, SOCKET_GRACE_MS + 250)
  }
  if (sockState.size === 0) stopPingLoop()
  onPresenceChange?.()
}

/** Called from the websocket `pong` handler when a member answers our ping. */
export function onAgentPong(ws: ServerWebSocket<AgentSocketData>): void {
  const st = sockState.get(ws)
  if (!st) return
  if (st.awaitingPong) st.latencyMs = Date.now() - st.pingSentAt
  st.awaitingPong = false
  st.missed = 0
}

export interface PresenceSignal {
  /** true when the member has ≥1 live socket right now. */
  online: boolean
  /** best (lowest) observed WS latency in ms, or null if no live socket / no ping yet. */
  latencyMs: number | null
  /** true when the member has held a live socket this run (its WS is the authoritative signal). */
  everHadSocket: boolean
  /** whether the member is within the reconnect grace after its last socket dropped. */
  inDropGrace: boolean
}

/**
 * Per-member socket presence signals, keyed by resolved user. Includes members that are
 * connected now AND those that have disconnected (so team-presence can decide offline vs
 * a heartbeat fallback). `now` lets the caller share one clock across the snapshot.
 */
export function getPresenceSignals(now = Date.now()): Map<string, PresenceSignal> {
  const out = new Map<string, PresenceSignal>()
  const users = new Set<string>([...agentSockets.keys(), ...everHadSocket])
  for (const user of users) {
    const socks = agentSockets.get(user)
    const online = !!socks && socks.size > 0
    let latency: number | null = null
    if (online) {
      for (const ws of socks!) {
        const st = sockState.get(ws)
        if (st?.latencyMs != null) latency = latency == null ? st.latencyMs : Math.min(latency, st.latencyMs)
      }
    }
    const dropAt = lastDropAt.get(user)
    out.set(user, {
      online,
      latencyMs: latency,
      everHadSocket: everHadSocket.has(user),
      inDropGrace: !online && dropAt != null && now - dropAt <= SOCKET_GRACE_MS,
    })
  }
  return out
}

/**
 * Called when a member sends a WebSocket message to the central. On-demand
 * chat retrieval (the former 'chat-result' message) has been removed — the
 * central no longer requests or accepts chat content over this channel.
 * Reserved for future non-chat reverse-channel message types; currently a
 * no-op since members send no messages other than protocol-level pong frames
 * (handled separately by Bun's WebSocket `pong` event → onAgentPong).
 */
export function onAgentMessage(
  _ws: ServerWebSocket<AgentSocketData>,
  _raw: string | Buffer,
): void {
  // No message types are currently handled.
}
