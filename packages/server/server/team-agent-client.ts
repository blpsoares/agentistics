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

/**
 * How often the member reports its open assistants to the central. Must stay comfortably below
 * `LIVE_REPORT_TTL_MS` in team-live.ts, so one dropped frame never blinks the central's panel.
 */
const LIVE_REPORT_INTERVAL_MS = 8_000

let liveTimer: ReturnType<typeof setInterval> | null = null

/**
 * Report this machine's live sessions to the central over the reverse channel.
 *
 * The central detects open assistants by reading /proc, which only ever sees its OWN machine — so
 * without this a team dashboard could never show what members are working on right now. Metrics
 * only: session ids plus the cwd of a process too new to have written a transcript. Never chat,
 * matching the rule that members push computed data only.
 *
 * Best-effort throughout: a failed snapshot or a dead socket skips a beat rather than throwing
 * into the connection's event handlers.
 */
function startLiveReporting(socket: WebSocket): void {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null }

  const send = async (): Promise<void> => {
    if (socket.readyState !== WebSocket.OPEN) return
    try {
      const [{ buildApiResponse }, { getLiveSnapshot }] = await Promise.all([
        import('./data'),
        import('./live-sessions'),
      ])
      const data = await buildApiResponse()
      const snap = await getLiveSnapshot(data.sessions)
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({
        type: 'live-sessions',
        sessionIds: snap.liveSessionIds,
        processes: snap.liveProcesses,
      }))
    } catch { /* transient — the next tick retries */ }
  }

  void send()
  liveTimer = setInterval(() => { void send() }, LIVE_REPORT_INTERVAL_MS)
  liveTimer.unref?.()
}

function stopLiveReporting(): void {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null }
}

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
    startLiveReporting(socket)
  })

  // Inbound admin actions from the central: 'renamed' (the central renamed this machine) and
  // 'reassigned' (its owner account changed). Both surface a local notification naming the actor,
  // and 'reassigned' also nudges the dashboard to re-resolve its identity so the "Connected as"
  // panel stops showing the previous account until the next handshake.
  socket.addEventListener('message', (ev: MessageEvent) => {
    try {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      if (!raw) return
      const data = JSON.parse(raw) as { type?: string; name?: string; actor?: string; account?: string | null }
      if (data?.type === 'renamed') {
        void import('./sse').then(m => m.broadcastNotification({
          type: 'info', code: 'machine.renamed', meta: { name: data.name ?? '', actor: data.actor ?? '' },
        })).catch(() => { /* best-effort */ })
      }
      if (data?.type === 'reassigned') {
        void import('./sse').then(m => {
          m.broadcastNotification({
            type: 'info', code: 'machine.reassigned',
            meta: { account: data.account ?? '', actor: data.actor ?? '' },
          })
          // Push a refresh to any open dashboard so the whoami-backed connection panel
          // re-resolves instead of showing the previous account.
          m.notifySseClients()
        }).catch(() => { /* best-effort */ })
      }
    } catch { /* ignore malformed frames */ }
  })

  socket.addEventListener('close', () => {
    if (activeWs === socket) activeWs = null
    stopLiveReporting()
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
        openConnection(team!.endpoint ?? '', team!.token ?? '')
      }
    } else if (activeWs) {
      // Switched back to solo (or credentials cleared) — tear down the socket.
      const socket = activeWs
      activeWs = null
      stopLiveReporting()
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
