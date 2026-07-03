// team-agent-client.ts — member-side WebSocket client for the reverse channel (Phase 7)
//
// Opens a persistent WebSocket from the member to the central's /api/team/agent
// endpoint. On receiving a 'fetch-chat' request from the central, reads local
// session messages using the matching get<Harness>SessionMessages reader and
// replies with a 'chat-result' message.
//
// Reconnects with exponential backoff on close/error.
// startAgentClient() is idempotent — safe to call multiple times.
// Never throws; all errors are swallowed internally.

import path from 'node:path'
import type { AgentRequest, AgentResponse, HarnessId } from '@agentistics/core'
import { readPreferences } from './preferences'
import { getClaudeSessionMessages } from './claude-sessions'
import { getCodexSessionMessages } from './codex-sessions'
import { getGeminiSessionMessages } from './gemini-sessions'
import { getCopilotSessionMessages } from './copilot-sessions'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reconnect backoff delays in milliseconds. */
const BACKOFF_MS: number[] = [1_000, 2_000, 5_000, 10_000, 30_000]

const VALID_HARNESSES: readonly string[] = ['claude', 'codex', 'gemini', 'copilot']

// ---------------------------------------------------------------------------
// Local message reader — dispatches to the correct harness reader
// ---------------------------------------------------------------------------

async function fetchLocalMessages(request: AgentRequest): Promise<unknown[]> {
  const { harness, sessionId, encodedDir } = request
  try {
    if (harness === 'claude') {
      if (!encodedDir || encodedDir.includes('..') || path.isAbsolute(encodedDir)) return []
      return (await getClaudeSessionMessages(encodedDir, sessionId)) as unknown[]
    }
    if (harness === 'codex') {
      return (await getCodexSessionMessages(sessionId)) as unknown[]
    }
    if (harness === 'gemini') {
      return (await getGeminiSessionMessages(sessionId)) as unknown[]
    }
    if (harness === 'copilot') {
      return (await getCopilotSessionMessages(sessionId)) as unknown[]
    }
  } catch {
    // ignore — return empty array
  }
  return []
}

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

  socket.addEventListener('message', (event: MessageEvent) => {
    void (async () => {
      let req: unknown
      try {
        const raw =
          typeof event.data === 'string' ? event.data : String(event.data)
        req = JSON.parse(raw)
      } catch {
        return
      }
      if (typeof req !== 'object' || req === null) return
      const r = req as Record<string, unknown>
      if (r['type'] !== 'fetch-chat' || typeof r['id'] !== 'string') return

      const agentReq: AgentRequest = {
        type: 'fetch-chat',
        id: r['id'],
        sessionId: typeof r['sessionId'] === 'string' ? r['sessionId'] : '',
        harness: (VALID_HARNESSES.includes(r['harness'] as string)
          ? r['harness']
          : 'claude') as HarnessId,
        encodedDir:
          typeof r['encodedDir'] === 'string' ? r['encodedDir'] : undefined,
      }

      const messages = await fetchLocalMessages(agentReq)

      const response: AgentResponse = {
        type: 'chat-result',
        id: agentReq.id,
        ok: true,
        messages,
      }

      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(response))
        }
      } catch {
        // socket closed mid-send — ignore
      }
    })()
  })

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

/**
 * Start the member-side agent client. Idempotent — subsequent calls are no-ops.
 * Reads team preferences; skips if mode !== 'member' or endpoint/token missing.
 * Never throws.
 */
export function startAgentClient(): void {
  if (started) return
  started = true

  void (async () => {
    try {
      const prefs = await readPreferences()
      const team = prefs.team
      if (
        !team ||
        team.mode !== 'member' ||
        !team.endpoint ||
        !team.user ||
        !team.token
      ) {
        return
      }
      openConnection(team.endpoint, team.token)
    } catch {
      // Silently ignore — not in member mode or preferences unavailable
    }
  })()
}
