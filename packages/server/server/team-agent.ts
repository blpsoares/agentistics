// team-agent.ts — central-side WebSocket agent registry (Phase 7)
//
// Maintains a live map of member → connected ServerWebSocket sockets.
// Provides requestChat() to send a 'fetch-chat' request to a member and wait
// (max 10 s) for the 'chat-result' reply.
// handleSessionChat() serves GET /api/team/session-chat: tries the local FS
// first, then falls back to requesting from the member over the reverse channel.

import path from 'node:path'
import type { ServerWebSocket } from 'bun'
import type { AgentRequest, AgentResponse, HarnessId } from '@agentistics/core'
import { getClaudeSessionMessages } from './claude-sessions'
import { getCodexSessionMessages } from './codex-sessions'
import { getGeminiSessionMessages } from './gemini-sessions'
import { getCopilotSessionMessages } from './copilot-sessions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data attached to each server-side WebSocket via server.upgrade(req, { data }) */
export interface AgentSocketData {
  user: string
  isAgent?: boolean
}

const VALID_HARNESSES: readonly string[] = ['claude', 'codex', 'gemini', 'copilot']

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** user → set of connected member sockets */
const agentSockets = new Map<string, Set<ServerWebSocket<AgentSocketData>>>()

/** pending request id → resolve callback */
const pending = new Map<string, (response: AgentResponse) => void>()

// ---------------------------------------------------------------------------
// Liveness + latency — ping each socket periodically; a socket that misses
// MAX_MISSED_PONGS consecutive pings is considered dead and force-closed, so a
// hard-killed machine (no TCP FIN) still transitions to offline promptly.
// ---------------------------------------------------------------------------

const PING_INTERVAL_MS = 15_000
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
  if (!agentSockets.has(user)) agentSockets.set(user, new Set())
  agentSockets.get(user)!.add(ws)
  sockState.set(ws, { latencyMs: null, awaitingPong: false, pingSentAt: 0, missed: 0 })
  ensurePingLoop()
  onPresenceChange?.()
}

export function unregisterAgent(ws: ServerWebSocket<AgentSocketData>): void {
  const { user } = ws.data
  sockState.delete(ws)
  const sockets = agentSockets.get(user)
  if (!sockets) { if (sockState.size === 0) stopPingLoop(); return }
  sockets.delete(ws)
  if (sockets.size === 0) agentSockets.delete(user)
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

/**
 * Snapshot of currently-connected members → best (lowest) observed latency in ms,
 * or null when no ping has completed yet. A member absent from the map has no live socket.
 */
export function getOnlineLatency(): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const [user, socks] of agentSockets) {
    if (socks.size === 0) continue
    let best: number | null = null
    for (const ws of socks) {
      const st = sockState.get(ws)
      if (st?.latencyMs != null) best = best == null ? st.latencyMs : Math.min(best, st.latencyMs)
    }
    out.set(user, best)
  }
  return out
}

/**
 * Called when a member sends a WebSocket message to the central.
 * Expects AgentResponse (type: 'chat-result') and resolves the matching
 * pending requestChat() call by id. Unknown message types are silently dropped.
 */
export function onAgentMessage(
  _ws: ServerWebSocket<AgentSocketData>,
  raw: string | Buffer,
): void {
  let msg: unknown
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'))
  } catch {
    return
  }
  if (typeof msg !== 'object' || msg === null) return
  const m = msg as Record<string, unknown>
  if (m['type'] !== 'chat-result' || typeof m['id'] !== 'string') return

  const id = m['id']
  const response: AgentResponse = {
    type: 'chat-result',
    id,
    ok: m['ok'] === true,
    messages: Array.isArray(m['messages']) ? (m['messages'] as unknown[]) : undefined,
    error: typeof m['error'] === 'string' ? m['error'] : undefined,
  }

  const resolve = pending.get(id)
  if (resolve) {
    pending.delete(id)
    resolve(response)
  }
}

// ---------------------------------------------------------------------------
// requestChat — send fetch-chat to a member, await reply (max 10 s)
// ---------------------------------------------------------------------------

/**
 * Ask a connected member to fetch chat messages for a session.
 * Returns { ok: false, error: 'member offline' } if no socket is registered.
 * Times out after 10 s with { ok: false, error: 'timeout' }.
 * Never throws.
 */
export async function requestChat(
  user: string,
  sessionId: string,
  harness: HarnessId,
  encodedDir?: string,
): Promise<AgentResponse> {
  const sockets = agentSockets.get(user)
  if (!sockets || sockets.size === 0) {
    return { type: 'chat-result', id: '', ok: false, error: 'member offline' }
  }

  // Pick the first available socket
  const iter = sockets.values().next()
  if (iter.done || !iter.value) {
    return { type: 'chat-result', id: '', ok: false, error: 'member offline' }
  }
  const ws = iter.value
  const id = crypto.randomUUID()
  const request: AgentRequest = { type: 'fetch-chat', id, sessionId, harness, encodedDir }

  return new Promise<AgentResponse>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const done = (response: AgentResponse): void => {
      if (timer !== undefined) clearTimeout(timer)
      resolve(response)
    }

    pending.set(id, done)

    timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve({ type: 'chat-result', id, ok: false, error: 'timeout' })
      }
    }, 10_000)

    try {
      ws.send(JSON.stringify(request))
    } catch {
      clearTimeout(timer)
      pending.delete(id)
      resolve({ type: 'chat-result', id, ok: false, error: 'send failed' })
    }
  })
}

// ---------------------------------------------------------------------------
// Local session readers (attempt before asking the member)
// ---------------------------------------------------------------------------

async function readLocalMessages(
  harness: HarnessId,
  sessionId: string,
  encodedDir?: string,
): Promise<unknown[] | null> {
  try {
    if (harness === 'claude') {
      if (!encodedDir) return null
      const msgs = await getClaudeSessionMessages(encodedDir, sessionId)
      return msgs.length > 0 ? (msgs as unknown[]) : null
    }
    if (harness === 'codex') {
      const msgs = await getCodexSessionMessages(sessionId)
      return msgs.length > 0 ? (msgs as unknown[]) : null
    }
    if (harness === 'gemini') {
      const msgs = await getGeminiSessionMessages(sessionId)
      return msgs.length > 0 ? (msgs as unknown[]) : null
    }
    if (harness === 'copilot') {
      const msgs = await getCopilotSessionMessages(sessionId)
      return msgs.length > 0 ? (msgs as unknown[]) : null
    }
  } catch {
    // Local read failed — fall through to remote
  }
  return null
}

// ---------------------------------------------------------------------------
// handleSessionChat — GET /api/team/session-chat
// ---------------------------------------------------------------------------

const JSON_CT = { 'Content-Type': 'application/json' }

/**
 * Handler for GET /api/team/session-chat (ADMIN-gated in index.ts).
 *
 * Query params:
 *   user       — member username to proxy to when local read misses (required)
 *   sessionId  — session ID to retrieve (required)
 *   harness    — 'claude' | 'codex' | 'gemini' | 'copilot' (default: 'claude')
 *   encodedDir — Claude-only: encoded project directory (e.g. "-home-user-proj")
 *
 * Response:
 *   200  { ok: true,  messages: unknown[] }   — local hit or member replied
 *   404  { ok: false, error: 'member offline' }
 *   502  { ok: false, error: string }          — timeout or send failure
 *   400  { error: string }                     — missing required params
 *
 * Try order:
 *   1. getClaudeSessionMessages / getCodexSessionMessages / etc. (local FS)
 *   2. requestChat() over the member's live reverse-channel WebSocket
 */
export async function handleSessionChat(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const user = url.searchParams.get('user') ?? ''
  const sessionId = url.searchParams.get('sessionId') ?? ''
  const harnessRaw = url.searchParams.get('harness') ?? 'claude'
  const harness = (VALID_HARNESSES.includes(harnessRaw) ? harnessRaw : 'claude') as HarnessId
  const encodedDir = url.searchParams.get('encodedDir') ?? undefined

  // Reject traversal attempts in the encoded directory segment
  if (encodedDir !== undefined && (encodedDir.includes('..') || path.isAbsolute(encodedDir))) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid dir' }), {
      status: 400,
      headers: JSON_CT,
    })
  }

  if (!user || !sessionId) {
    return new Response(JSON.stringify({ error: 'user and sessionId required' }), {
      status: 400,
      headers: JSON_CT,
    })
  }

  // 1. Try local read first (works on a self-contributing central)
  const local = await readLocalMessages(harness, sessionId, encodedDir)
  if (local !== null) {
    return new Response(JSON.stringify({ ok: true, messages: local }), {
      status: 200,
      headers: JSON_CT,
    })
  }

  // 2. Fall back to the member's reverse-channel WebSocket
  const result = await requestChat(user, sessionId, harness, encodedDir)
  if (!result.ok) {
    const status = result.error === 'member offline' ? 404 : 502
    return new Response(JSON.stringify({ ok: false, error: result.error ?? 'failed' }), {
      status,
      headers: JSON_CT,
    })
  }

  return new Response(JSON.stringify({ ok: true, messages: result.messages ?? [] }), {
    status: 200,
    headers: JSON_CT,
  })
}
