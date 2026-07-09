// team-agent-client.ts — member-side WebSocket client for the reverse channel (Phase 7)
//
// Opens a persistent WebSocket from the member to the central's /api/team/agent
// endpoint. On-demand chat retrieval (the former 'fetch-chat' request /
// 'chat-result' reply) has been removed — the member never sends chat content
// to the central over this channel.
//
// Reconnects with exponential backoff on close/error.
// startAgentClient() is idempotent — safe to call multiple times.
// Never throws; all errors are swallowed internally.

import { readPreferences } from './preferences'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reconnect backoff delays in milliseconds. */
const BACKOFF_MS: number[] = [1_000, 2_000, 5_000, 10_000, 30_000]

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

let activeWs: WebSocket | null = null
let backoffIdx = 0

function scheduleReconnect(): void {
  const delay = BACKOFF_MS[Math.min(backoffIdx, BACKOFF_MS.length - 1)] ?? 30_000
  backoffIdx++
  setTimeout(() => {
    void (async () => {
      try {
        const prefs = await readPreferences()
        const team = prefs.team
        // Stop reconnecting if mode changed or credentials were cleared
        if (!team || team.mode !== 'member' || !team.endpoint || !team.user || !team.token) return
        openConnection(team.endpoint, team.token)
      } catch {
        // Preferences unavailable — stop reconnecting silently
      }
    })()
  }, delay)
}

function openConnection(endpoint: string, token: string): void {
  // Skip if there is already an open or connecting socket
  if (activeWs && activeWs.readyState <= WebSocket.OPEN) return

  // Convert http(s) → ws(s) and append the agent endpoint. Trim any trailing slash first —
  // otherwise `http://host/` yields `ws://host//api/team/agent`, whose double slash misses
  // the server's exact-match upgrade route and the WS never connects.
  const wsUrl =
    endpoint.replace(/\/+$/, '').replace(/^https/, 'wss').replace(/^http/, 'ws') + '/api/team/agent'

  let socket: WebSocket
  try {
    // Bun extends the standard WebSocket constructor to accept a headers option
    // object as the second argument. The DOM lib type only allows string | string[],
    // so we cast through unknown to satisfy the compiler while using Bun's extension.
    socket = new WebSocket(
      wsUrl,
      { headers: { Authorization: `Bearer ${token}` } } as unknown as string,
    )
  } catch {
    scheduleReconnect()
    return
  }
  activeWs = socket

  socket.addEventListener('open', () => {
    backoffIdx = 0 // successful open — reset backoff
  })

  // No inbound message types are currently handled — the central no longer
  // requests chat over this channel, and liveness is carried entirely by the
  // WebSocket ping/pong protocol frames (handled by the runtime, not here).

  socket.addEventListener('close', () => {
    if (activeWs === socket) activeWs = null
    scheduleReconnect()
  })

  socket.addEventListener('error', () => {
    // 'close' fires immediately after 'error'; reconnect is handled there.
    if (activeWs === socket) activeWs = null
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let started = false

/** How often the runtime poll re-checks preferences for member-mode changes. */
const POLL_INTERVAL_MS = 5_000

/**
 * Periodic reconciliation between current preferences and the socket state.
 * Runs every POLL_INTERVAL_MS so switching to member mode at runtime (adding a
 * central in Settings) (re)establishes the reverse-channel socket promptly,
 * instead of waiting for the next uploader push + dashboard poll (~30s).
 *
 * - member mode with full credentials AND no active OPEN/CONNECTING socket → open one
 *   (openConnection self-guards against duplicates via activeWs.readyState).
 * - switched back to solo (mode !== 'member') with an active socket → close it.
 *
 * Complements the close/error reconnect-with-backoff path, which only fires once
 * a connection has already been attempted.
 */
async function reconcileConnection(): Promise<void> {
  try {
    const prefs = await readPreferences()
    const team = prefs.team
    const isMember = Boolean(
      team &&
        team.mode === 'member' &&
        team.endpoint &&
        team.user &&
        team.token,
    )

    if (isMember) {
      // Open only when nothing is already open or in-flight.
      const hasLiveSocket = activeWs != null && activeWs.readyState <= WebSocket.OPEN
      if (!hasLiveSocket) {
        openConnection(team!.endpoint, team!.token)
      }
    } else if (activeWs) {
      // Switched back to solo (or credentials cleared) — tear down the socket.
      const socket = activeWs
      activeWs = null
      try {
        socket.close()
      } catch {
        // already closed — ignore
      }
    }
  } catch {
    // Preferences unavailable — leave current state untouched.
  }
}

/**
 * Start the member-side agent client. Idempotent — subsequent calls are no-ops.
 * Reads team preferences; skips connecting if mode !== 'member' or endpoint/token
 * missing, but always starts a lightweight periodic reconciliation poll so a
 * central added at runtime connects promptly. Never throws.
 */
export function startAgentClient(): void {
  if (started) return
  started = true

  // Initial attempt + ongoing reconciliation. reconcileConnection covers both
  // the "connect now if already in member mode" and "connect later once a central
  // is added" cases, so a single poll handles startup and runtime changes.
  void reconcileConnection()
  const timer = setInterval(() => {
    void reconcileConnection()
  }, POLL_INTERVAL_MS)
  // Do not keep the process alive solely for this poll.
  timer.unref?.()
}

/**
 * Reconcile the reverse-channel socket against current preferences RIGHT NOW, instead of
 * waiting up to POLL_INTERVAL_MS. Call this the moment the team config changes at runtime
 * (e.g. the PUT /api/preferences handler when a member connects via the web) so the member
 * shows up as online on the central within ~a second rather than after the next poll. Never
 * throws. No-op if the client hasn't been started yet (startup already reconciles).
 */
export function reconcileNow(): void {
  if (!started) return
  void reconcileConnection()
}
