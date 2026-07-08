// embeddedDist is loaded inside server/sse.ts (conditional on SERVE_STATIC=1)

import { readFile } from 'node:fs/promises'
import { PORT, WEB_PORT, TEAM_CENTRAL, TEAM_PASSWORD, TEAM_ORG } from './config'
import type { Server, ServerWebSocket } from 'bun'
import { getRates } from './rates'
import { getVersionInfo, startVersionRecheck } from './version'
import { buildApiResponse, buildApiResponseStream, invalidateCache } from './data'
import { readPreferences, writePreferences, type Preferences } from './preferences'
import { streamViaClaude, execCommand, ensureNayChat, ensureClaudeChat, CLAUDE_CHAT_DIR, type ChatMessage, type ChatModelId, type ChatAttachment } from './chat-tty'
import { getChatDriver, chatHarnessStatus } from './chat-drivers/index'
import { listMcpServers, removeMcpServer } from './mcp-list'
import { listNaySessions, getNaySessionMessages } from './nay-sessions'
import { listClaudeSessions, getClaudeSessionMessages, type ClaudeSessionSummary, type ClaudeSessionMessage } from './claude-sessions'
import { listCodexSessions, getCodexSessionMessages, type CodexSessionSummary, type CodexSessionMessage } from './codex-sessions'
import { listGeminiSessions, getGeminiSessionMessages, type GeminiSessionSummary, type GeminiSessionMessage } from './gemini-sessions'
import { listCopilotSessions, getCopilotSessionMessages, type CopilotSessionSummary, type CopilotSessionMessage } from './copilot-sessions'
import { PROJECTS_DIR } from './config'
import { safeReadDir } from './utils'
import { decodeProjectDir } from './git'
import { getEnabledAdapters } from './adapters/types'
import { handleLogin, handleLogout, handleSession, isAuthed, hasValidSession } from './auth'
import {
  readEnvConfig,
  writeEnvConfig,
  readEnvConfigBackup,
  restoreEnvConfig,
  CONFIG_FIELDS,
} from './env-config'
import {
  sseClients,
  sseEncoder,
  setupFileWatcher,
  maybeSpawnWatcher,
  serveStatic,
  SERVE_STATIC,
  triggerSseNotification,
  notifySseClients,
} from './sse'
import { fullSync } from './archive'
import { getArchiveMode } from './preferences'
import { registerAgent, unregisterAgent, onAgentMessage, onAgentPong, setPresenceChangeHook } from './team-agent'
import { startAgentClient, reconcileNow } from './team-agent-client'
import { validateIngestToken } from './team-tokens'

// ---------------------------------------------------------------------------
// Reads the first `cwd` field found in a JSONL session file.
// Used by /api/projects-list to get the real project path without ambiguous decoding.
// ---------------------------------------------------------------------------
async function readCwdFromJsonl(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    for (const raw of content.split('\n').slice(0, 100)) {
      const line = raw.trim()
      if (!line) continue
      try {
        const e = JSON.parse(line)
        if (typeof e.cwd === 'string' && e.cwd) return e.cwd
      } catch { /* skip */ }
    }
  } catch { /* file unreadable */ }
  return null
}

// ---------------------------------------------------------------------------
// Start file watching and optionally spawn the OTel watcher daemon
// ---------------------------------------------------------------------------

// Preserve history before Claude's next cleanup (transcripts > cleanupPeriodDays,
// default 30 days). 'full' mirrors raw files; both modes warm a build that persists
// the consolidated per-session metrics store.
void (async () => {
  const mode = await getArchiveMode()
  if (mode === 'full') {
    fullSync().catch(err => console.warn('[archive] startup sync failed:', String(err)))
  }
  if (mode && mode !== 'off') {
    buildApiResponse().catch(err => console.warn('[archive] startup consolidation failed:', String(err)))
  }
})()

void setupFileWatcher()
if (TEAM_CENTRAL) {
  import('./team-watch').then(m => m.startTeamWatch()).catch(err => console.error('[team-watch] failed to start:', err))
  // Push an IMMEDIATE SSE update when a member connects/disconnects so the dashboard's
  // online/offline dots and the members panel refresh instantly. Presence is computed fresh
  // per request (not cached), so this needs no cache invalidation and no debounce.
  setPresenceChangeHook(() => notifySseClients())
}
import('./team-uploader').then(m => m.startUploader()).catch(err => console.error('[team-uploader] failed to start:', err))
startAgentClient()
maybeSpawnWatcher()
// Periodic best-effort re-check so a long-running daemon surfaces new releases
// without a page reload (broadcasts an SSE notification when an update appears).
try { startVersionRecheck() } catch (err) { console.warn('[version] recheck failed to start:', String(err)) }
ensureNayChat(PORT).catch(err => console.error('[nay-chat] failed to initialize:', err))
ensureClaudeChat().catch(err => console.error('[claude-chat] failed to initialize:', err))


// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Routes that are always public (no auth gate applied)
const AUTH_PUBLIC = new Set([
  '/api/team/login',
  '/api/team/logout',
  '/api/team/session',
  '/api/team/ingest',
  '/api/team/leave',
  '/api/team/policy',
  // WebSocket upgrade for the member→central reverse channel; auth is via
  // validateIngestToken (Bearer token in the Upgrade request headers).
  '/api/team/whoami',
  '/api/team/agent',
])

// Admin routes that require a real session cookie even on a passwordless central
const ADMIN_PATHS = new Set([
  '/api/team/members',
  '/api/team/tokens',
  '/api/team/tokens/rotate',
  '/api/team/config',
])

// ---------------------------------------------------------------------------
// Bun HTTP server
// ---------------------------------------------------------------------------

type WSData = { user: string; isAgent?: boolean }

// Shared WS + request handlers, so the binary can bind the SAME logic to two ports below:
// PORT (47291 = api + mcp) and WEB_PORT (47292 = the web dashboard you open).
const _wsHandlers = {
  open(ws: ServerWebSocket<WSData>) { if (!ws.data.isAgent) return; registerAgent(ws) },
  message(ws: ServerWebSocket<WSData>, msg: string | Buffer) { if (!ws.data.isAgent) return; onAgentMessage(ws, msg) },
  pong(ws: ServerWebSocket<WSData>) { if (!ws.data.isAgent) return; onAgentPong(ws) },
  close(ws: ServerWebSocket<WSData>) { if (!ws.data.isAgent) return; unregisterAgent(ws) },
}

async function handleRequest(req: Request, server: Server<WSData>): Promise<Response | undefined> {
    const url = new URL(req.url)
    // Collapse repeated slashes in the path. A member whose endpoint has a trailing slash
    // builds URLs like `//api/team/ingest` / `//api/team/agent`; without this they'd miss the
    // exact-match API routes and silently fall through to the static handler (200, no ingest)
    // or fail the WS upgrade — making pushes/presence look fine while nothing lands.
    if (url.pathname.includes('//')) url.pathname = url.pathname.replace(/\/{2,}/g, '/')

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ---------------------------------------------------------------------------
    // Auth gate (Phase 3): when central + password set, all /api/* routes require
    // a valid session cookie except the public allowlist below.
    // Static assets are always served (the SPA + login UI must load without auth).
    // ---------------------------------------------------------------------------
    if (
      TEAM_CENTRAL &&
      TEAM_PASSWORD &&
      url.pathname.startsWith('/api/') &&
      !AUTH_PUBLIC.has(url.pathname) &&
      !isAuthed(req)
    ) {
      return new Response(JSON.stringify({ error: 'auth required' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Admin gate: admin routes require a real session even on a passwordless central.
    if (TEAM_CENTRAL && ADMIN_PATHS.has(url.pathname) && !hasValidSession(req)) {
      return new Response(JSON.stringify({ error: 'auth required' }), { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseClients.add(controller)
          controller.enqueue(sseEncoder.encode('event: connected\ndata: {}\n\n'))

          req.signal.addEventListener('abort', () => {
            sseClients.delete(controller)
            try { controller.close() } catch { /* already closed */ }
          })
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    if (url.pathname === '/api/health' && req.method === 'GET') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/version' && req.method === 'GET') {
      try {
        const info = await getVersionInfo()
        return new Response(JSON.stringify(info), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/rates' && req.method === 'GET') {
      try {
        const rates = await getRates()
        return new Response(JSON.stringify({
          brlRate: rates.brlRate,
          pricing: rates.pricing,
          pricingSource: rates.pricingSource,
          fetchedAt: rates.fetchedAt,
        }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/data-stream' && req.method === 'GET') {
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (eventName: string, data: unknown) => {
            try {
              controller.enqueue(enc.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`))
            } catch { /* client disconnected */ }
          }
          try {
            await buildApiResponseStream((stage, progress, detail) => {
              send('progress', { stage, progress, detail })
            })
            send('done', {})
          } catch (err) {
            send('error', { message: err instanceof Error ? err.message : String(err) })
          } finally {
            try { controller.close() } catch { /* already closed */ }
          }
        },
      })
      return new Response(stream, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    if (url.pathname === '/api/preferences' && req.method === 'GET') {
      try {
        const prefs = await readPreferences()
        return new Response(JSON.stringify(prefs), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/preferences' && req.method === 'PUT') {
      try {
        const body = await req.json() as Preferences
        await writePreferences(body)
        // On an archive-mode change, refresh the cache and immediately persist:
        // 'full' also mirrors raw files; any non-off mode warms a build that
        // writes the consolidated metrics store.
        if (body.archiveMode !== undefined) {
          invalidateCache()
          if (body.archiveMode === 'full') {
            fullSync().catch(err => console.warn('[archive] post-consent sync failed:', String(err)))
          }
          if (body.archiveMode !== 'off') {
            buildApiResponse().catch(err => console.warn('[archive] post-consent consolidation failed:', String(err)))
          }
        }
        // When the team config changes (e.g. connecting to a central from the web), don't wait
        // for the next poll/timer: open the reverse-channel WebSocket now so the member shows
        // up online on the central within ~a second, and kick an immediate push so its metrics
        // land right away instead of ~5 s later.
        if (body.team !== undefined) {
          reconcileNow()
          import('./team-uploader').then(m => m.pushNow()).catch(() => {})
        }
        const updated = await readPreferences()
        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/projects-list' && req.method === 'GET') {
      try {
        const dirs = await safeReadDir(PROJECTS_DIR)
        const entries: { name: string; path: string; encodedDir: string; sessionCount: number }[] = []
        await Promise.all(dirs.map(async dir => {
          const dirPath = `${PROJECTS_DIR}/${dir}`
          const files = await safeReadDir(dirPath)
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
          if (jsonlFiles.length === 0) return
          const fallbackPath = decodeProjectDir(dir)
          let projectPath = fallbackPath
          for (const f of jsonlFiles) {
            const cwd = await readCwdFromJsonl(`${dirPath}/${f}`)
            if (cwd) { projectPath = cwd; break }
          }
          const name = projectPath.split('/').filter(Boolean).pop() ?? dir
          entries.push({ name, path: projectPath, encodedDir: dir, sessionCount: jsonlFiles.length })
        }))
        // Collect project paths from all non-Claude harness adapters via their sessions.
        // Avoids touching statsCache (Claude-only) and reuses the already-loaded session data.
        const seenPaths = new Set(entries.map(e => e.path))
        const adapters = await getEnabledAdapters()
        await Promise.all(
          adapters
            .filter(a => a.id !== 'claude')
            .map(async a => {
              const sessions = await a.loadSessions()
              const byPath = new Map<string, number>()
              for (const s of sessions) {
                if (s.project_path) {
                  byPath.set(s.project_path, (byPath.get(s.project_path) ?? 0) + 1)
                }
              }
              for (const [projectPath, sessionCount] of byPath) {
                if (seenPaths.has(projectPath)) continue
                seenPaths.add(projectPath)
                const name = projectPath.split('/').filter(Boolean).pop() ?? projectPath
                entries.push({ name, path: projectPath, encodedDir: '', sessionCount })
              }
            })
        )

        entries.sort((a, b) => b.sessionCount - a.sessionCount)
        return new Response(JSON.stringify(entries), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/nay-sessions' && req.method === 'GET') {
      const sessions = await listNaySessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/nay-sessions/') && req.method === 'GET') {
      const id = url.pathname.slice('/api/nay-sessions/'.length)
      const messages = await getNaySessionMessages(id)
      return new Response(JSON.stringify(messages), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/claude-sessions?projectPath=...  → list sessions for a project
    // GET /api/claude-sessions/:id?projectPath=... → messages for a session
    if (url.pathname === '/api/claude-sessions' && req.method === 'GET') {
      const encodedDir = url.searchParams.get('encodedDir') ?? ''
      if (!encodedDir) {
        return new Response(JSON.stringify({ error: 'encodedDir required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const sessions: ClaudeSessionSummary[] = await listClaudeSessions(encodedDir)
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/claude-sessions/') && req.method === 'GET') {
      const id = url.pathname.slice('/api/claude-sessions/'.length)
      const encodedDir = url.searchParams.get('encodedDir') ?? ''
      if (!encodedDir || !id) {
        return new Response(JSON.stringify({ error: 'encodedDir and id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: ClaudeSessionMessage[] = await getClaudeSessionMessages(encodedDir, id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/codex-sessions → list all Codex sessions
    // GET /api/codex-sessions/:id → messages for a Codex session
    if (url.pathname === '/api/codex-sessions' && req.method === 'GET') {
      const sessions: CodexSessionSummary[] = await listCodexSessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/codex-sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/codex-sessions/'.length))
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: CodexSessionMessage[] = await getCodexSessionMessages(id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/gemini-sessions → list all Gemini sessions
    // GET /api/gemini-sessions/:id → messages for a Gemini session
    if (url.pathname === '/api/gemini-sessions' && req.method === 'GET') {
      const sessions: GeminiSessionSummary[] = await listGeminiSessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/gemini-sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/gemini-sessions/'.length))
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: GeminiSessionMessage[] = await getGeminiSessionMessages(id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/copilot-sessions → list all Copilot sessions
    // GET /api/copilot-sessions/:id → messages for a Copilot session
    if (url.pathname === '/api/copilot-sessions' && req.method === 'GET') {
      const sessions: CopilotSessionSummary[] = await listCopilotSessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/copilot-sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/copilot-sessions/'.length))
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: CopilotSessionMessage[] = await getCopilotSessionMessages(id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/mcp-list' && req.method === 'GET') {
      const projectPath = url.searchParams.get('projectPath') ?? null
      const result = await listMcpServers(projectPath)
      return new Response(JSON.stringify(result), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/mcp-action' && req.method === 'POST') {
      try {
        const body = await req.json() as { action: 'remove'; name: string }
        if (body.action === 'remove') {
          const result = await removeMcpServer(body.name)
          return new Response(JSON.stringify(result), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ ok: false, error: 'unknown action' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/chat-harnesses' && req.method === 'GET') {
      return new Response(JSON.stringify(chatHarnessStatus()), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/chat-tty' && req.method === 'POST') {
      try {
        const body = await req.json() as { message: string; history?: ChatMessage[]; model?: string; sessionId?: string | null; thinkingBudget?: number; attachments?: ChatAttachment[]; harness?: string }
        const { message, history = [], model: requestedModel, sessionId = null, thinkingBudget, attachments, harness } = body

        // Resolve the requested driver.
        // - If harness explicitly provided but not installed → stream an error (no silent Claude fallback)
        // - If harness not provided → default to claude
        // - Installed-but-not-authed harnesses still route to their driver
        const requestedDriver = harness ? getChatDriver(harness as import('@agentistics/core').HarnessId) : undefined
        if (harness && requestedDriver && !requestedDriver.isAvailable()) {
          const label = requestedDriver.label
          const errBody = new TextEncoder().encode(`data: ${JSON.stringify({ error: `${label} is not installed. Install it to use it as a Nay backend.` })}

`)
          return new Response(new ReadableStream({
            start(ctrl) { ctrl.enqueue(errBody); ctrl.close() },
          }), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'X-Accel-Buffering': 'no',
            },
          })
        }
        const driver = (requestedDriver?.isAvailable() ? requestedDriver : undefined) ?? getChatDriver('claude')!

        // The model MUST belong to the resolved driver — a model from another
        // harness (or none) would be rejected by that CLI. Fall back to the
        // driver's defaultModel when the requested model isn't one of its own.
        const model = (requestedModel && driver.models.some(m => m.id === requestedModel))
          ? requestedModel
          : driver.defaultModel

        // Ensure MCP is registered for the selected driver
        await driver.ensureMcp(PORT)

        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            void driver.stream(
              message,
              history,
              model,
              {
                onChunk(text) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`))
                },
                onTool(tool) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ tool })}\n\n`))
                },
                onDone() {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
                  ctrl.close()
                },
                onError(err) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: err })}\n\n`))
                  ctrl.close()
                },
                onSessionId(id) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ sessionId: id })}\n\n`))
                },
              },
              sessionId,
              { thinkingBudget, attachments, signal: req.signal },
            )
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/claude-chat' && req.method === 'POST') {
      try {
        const body = await req.json() as { message: string; history?: ChatMessage[]; model?: ChatModelId; sessionId?: string | null; thinkingBudget?: number; projectPath?: string; attachments?: ChatAttachment[] }
        const { message, history = [], model = 'claude-sonnet-4-6', sessionId = null, thinkingBudget, projectPath, attachments } = body
        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            streamViaClaude(
              message,
              history,
              model,
              (text) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`))
              },
              (tool) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ tool })}\n\n`))
              },
              () => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
                ctrl.close()
              },
              (err) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: err })}\n\n`))
                ctrl.close()
              },
              (id) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ sessionId: id })}\n\n`))
              },
              sessionId,
              { cwd: projectPath ?? CLAUDE_CHAT_DIR, thinkingBudget, attachments, signal: req.signal },
            )
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/exec' && req.method === 'POST') {
      try {
        const body = await req.json() as { command: string }
        if (!body.command?.trim()) {
          return new Response(JSON.stringify({ error: 'command required' }), {
            status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            execCommand(
              body.command.trim(),
              (text, isStderr) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text, stderr: isStderr })}\n\n`))
              },
              (exitCode) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ exitCode, done: true })}\n\n`))
                ctrl.close()
              },
              (err) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: err })}\n\n`))
                ctrl.close()
              },
            )
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      try {
        const config = readEnvConfig()
        const backup = readEnvConfigBackup()
        const active: Record<string, string> = {}
        for (const field of CONFIG_FIELDS) {
          active[field.key] = process.env[field.key] ?? field.default
        }
        return new Response(JSON.stringify({ config, backup, active }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/config' && req.method === 'PUT') {
      try {
        const body = await req.json() as { values: Record<string, string> }
        writeEnvConfig(body.values)
        const config = readEnvConfig()
        return new Response(JSON.stringify({ ok: true, config }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/config/restore' && req.method === 'POST') {
      try {
        const ok = restoreEnvConfig()
        const config = readEnvConfig()
        return new Response(JSON.stringify({ ok, config }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/data' && req.method === 'GET') {
      try {
        const data = await buildApiResponse()
        // Presence is live (in-memory sockets + heartbeat) — merge it in AFTER the cached
        // build so online/offline + latency stay fresh without recomputing the whole response.
        let extra: { presence?: unknown; includeOfflineData?: boolean } = {}
        if (TEAM_CENTRAL) {
          const [{ computePresence }, { getCentralConfig }] = await Promise.all([
            import('./team-presence'),
            import('./central-config'),
          ])
          const [presence, cfg] = await Promise.all([
            computePresence().catch(() => ({})),
            getCentralConfig().catch(() => null),
          ])
          extra = { presence, includeOfflineData: cfg?.includeOfflineData ?? true }
        }
        return new Response(JSON.stringify({ ...data, ...extra }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[/api/data error]', message)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // ---------------------------------------------------------------------------
    // Auth routes (public — NOT behind the gate)
    // ---------------------------------------------------------------------------

    if (url.pathname === '/api/team/login' && req.method === 'POST') {
      const res = await handleLogin(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/logout' && req.method === 'POST') {
      const res = handleLogout(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/session' && req.method === 'GET') {
      const res = handleSession(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // GET /api/team/status — member-side live connection status for the status pill.
    // Reports this machine's last successful contact with the central + current error state.
    if (url.pathname === '/api/team/status' && req.method === 'GET') {
      const [{ readPreferences }, { getUploaderStatus }] = await Promise.all([
        import('./preferences'),
        import('./team-uploader'),
      ])
      const team = (await readPreferences()).team
      const st = getUploaderStatus()
      return new Response(JSON.stringify({
        mode: team?.mode ?? 'solo',
        user: team?.user ?? '',
        endpoint: team?.endpoint ?? '',
        lastSuccessAt: st.lastSuccessAt,
        errKind: st.errKind,
      }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    // ---------------------------------------------------------------------------
    // Admin routes (behind the gate — index.ts gate already enforces isAuthed)
    // ---------------------------------------------------------------------------

    if (url.pathname === '/api/team/members' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleMembers } = await import('./team-admin')
      const res = await handleMembers(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // PUT /api/team/members — rename a member (update the token doc's user field).
    // Body: { id: string, user: string }  →  Response: { ok: boolean }
    // ADMIN-gated (already in ADMIN_PATHS). The new name is reflected at next read via
    // getMemberNameMap() without requiring any re-ingest of existing session docs.
    if (url.pathname === '/api/team/members' && req.method === 'PUT') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const b = body as Record<string, unknown>
      if (typeof b.id !== 'string' || !b.id || typeof b.user !== 'string' || !b.user.trim()) {
        return new Response(JSON.stringify({ error: 'id and user are required strings' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const { setMemberName } = await import('./team-tokens')
      const ok = await setMemberName(b.id, b.user.trim())
      if (ok) {
        // Rename re-labels all of the member's history (resolved at read time), so the
        // cached dashboard must be invalidated + connected dashboards notified to refresh.
        const { triggerSseNotification } = await import('./sse')
        triggerSseNotification()
      }
      return new Response(JSON.stringify({ ok }), {
        status: ok ? 200 : 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/team/tokens' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleMintToken } = await import('./team-admin')
      const res = await handleMintToken(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/tokens' && req.method === 'DELETE') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleRevokeToken } = await import('./team-admin')
      const res = await handleRevokeToken(req)
      // Revoke cascades to the member's sessions — refresh the dashboard immediately.
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/tokens/rotate' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleRotateToken } = await import('./team-admin')
      const res = await handleRotateToken(req)
      // Rotation migrates the member's history to the new identity key — refresh the dashboard.
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/test-connection' && req.method === 'POST') {
      const { handleTeamTestConnection } = await import('./team-uploader')
      const res = await handleTeamTestConnection(req)
      // Re-wrap to attach CORS headers (handler sets only Content-Type)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/push-now' && req.method === 'POST') {
      const { handlePushNow } = await import('./team-uploader')
      const res = await handlePushNow(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/ingest' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleTeamIngest } = await import('./team-ingest')
      const res = await handleTeamIngest(req)
      // Re-wrap to attach CORS headers (handler sets only Content-Type)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // POST /api/team/leave — central: a member removes ITS OWN data (token-gated).
    if (url.pathname === '/api/team/leave' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleTeamLeave } = await import('./team-ingest')
      const res = await handleTeamLeave(req)
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // POST /api/team/leave-central — member proxy: tells the central to drop this member's
    // data, then the web resets the local config to solo. Keeps the token server-side.
    if (url.pathname === '/api/team/leave-central' && req.method === 'POST') {
      const { handleLeaveCentral } = await import('./team-uploader')
      const res = await handleLeaveCentral(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/deploy — generate a ready-to-use .env + docker compose command.
    // Only available in central mode. Protected by auth gate when a password is set.
    // Generates fresh random password + session secret on each call (shown once).
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/deploy' && req.method === 'GET') {
      if (!TEAM_CENTRAL) {
        return new Response(JSON.stringify({ error: 'central mode only' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      try {
        const { randomBytes } = await import('node:crypto')
        const { generateEnvFile } = await import('./deploy')

        const password = randomBytes(24).toString('hex')
        const sessionSecret = randomBytes(32).toString('hex')
        const mongoUrl = 'mongodb://mongo:27017/?replicaSet=rs0'

        const env = generateEnvFile({
          password,
          sessionSecret,
          mongoUrl,
          mongoDb: 'agentistics',
          // Read org and port from query params; the client-side counterpart is
          // AUTOSTART_SNIPPETS in packages/web/src/components/DeployCentral.tsx
          teamOrg: url.searchParams.get('org') || 'default',
          appPort: parseInt(url.searchParams.get('port') || '47291', 10),
        })

        return new Response(JSON.stringify({
          env,
          command: 'docker compose --env-file central.env up -d',
          password,
          sessionSecret,
        }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/policy — PUBLIC: returns the central push interval.
    // Members poll this before each push cycle to get the current cadence.
    // Non-central instances return the default so members degrade gracefully.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/policy' && req.method === 'GET') {
      const { getCentralConfig, getInstanceId } = await import('./central-config')
      const [config, instanceId] = await Promise.all([getCentralConfig(), getInstanceId()])
      return new Response(JSON.stringify({ pushIntervalSec: config.pushIntervalSec, instanceId }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/config — ADMIN (TEAM_CENTRAL + hasValidSession): read config.
    // PUT /api/team/config — ADMIN: update pushIntervalSec.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/config' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { getCentralConfig } = await import('./central-config')
      const config = await getCentralConfig()
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/team/config' && req.method === 'PUT') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      let body: { pushIntervalSec?: unknown; includeOfflineData?: unknown }
      try {
        body = await req.json() as { pushIntervalSec?: unknown; includeOfflineData?: unknown }
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      if (body.pushIntervalSec !== undefined && typeof body.pushIntervalSec !== 'number') {
        return new Response(JSON.stringify({ error: 'pushIntervalSec must be a number' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      if (body.includeOfflineData !== undefined && typeof body.includeOfflineData !== 'boolean') {
        return new Response(JSON.stringify({ error: 'includeOfflineData must be a boolean' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const { setPushInterval, setIncludeOfflineData, getCentralConfig } = await import('./central-config')
      if (typeof body.pushIntervalSec === 'number') await setPushInterval(body.pushIntervalSec)
      if (typeof body.includeOfflineData === 'boolean') await setIncludeOfflineData(body.includeOfflineData)
      const config = await getCentralConfig()
      // A policy change (offline-data default) affects every viewer → nudge them to refetch.
      if (typeof body.includeOfflineData === 'boolean') triggerSseNotification()
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ---------------------------------------------------------------------------
    // WebSocket upgrade — member ↔ central reverse channel (Phase 7)
    // POST/GET /api/team/agent — upgrade to WebSocket for connected members.
    // Auth: validateIngestToken (Bearer in Authorization header), NOT session cookie.
    // This path is in AUTH_PUBLIC so the cookie gate above does not block it.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/agent') {
      if (!TEAM_CENTRAL) {
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const authHeader = req.headers.get('authorization') ?? ''
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const tokenResult = await validateIngestToken(bearer)
      if (!tokenResult.ok || !tokenResult.user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const upgraded = server.upgrade(req, { data: { user: tokenResult.user, isAgent: true as const } })
      if (upgraded) return // WebSocket handshake handed off to the websocket: {} handler
      return new Response(JSON.stringify({ error: 'upgrade failed' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/session-chat — REMOVED. Central no longer views member chat;
    // always returns 410 Gone regardless of TEAM_CENTRAL.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/session-chat' && req.method === 'GET') {
      return new Response(JSON.stringify({ ok: false, error: 'chat_disabled' }), {
        status: 410,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }


    // ---------------------------------------------------------------------------
    // GET /api/team/whoami — PUBLIC (token-gated): resolves identity from bearer.
    // Members call this after a test-connection to learn their user + org.
    // The token is validated server-side; the plaintext is never logged.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/whoami' && req.method === 'GET') {
      const authHeader = req.headers.get('authorization') ?? ''
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const tokenResult = await validateIngestToken(bearer)
      if (tokenResult.ok) {
        return new Response(JSON.stringify({ ok: true, user: tokenResult.user, org: TEAM_ORG }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Serve embedded frontend assets (binary mode only)
    if (!url.pathname.startsWith('/api')) {
      const asset = serveStatic(url.pathname)
      if (asset) return asset
      // SPA fallback — any unknown path gets index.html
      const fallback = serveStatic('/index.html')
      if (fallback) return fallback
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
}

try {
// PORT (47291) is always the api + mcp endpoint.
Bun.serve<WSData>({ port: PORT, idleTimeout: 60, websocket: _wsHandlers, fetch: handleRequest })
// Binary mode also serves the web dashboard on WEB_PORT (47292) — that's the URL you open.
// Same handler → the SPA's same-origin `/api/*` calls resolve against 47292 and just work,
// while 47291 stays the dedicated api + mcp port.
if (SERVE_STATIC) {
  Bun.serve<WSData>({ port: WEB_PORT, idleTimeout: 60, websocket: _wsHandlers, fetch: handleRequest })
}

const _ESC = '\x1b'
const _R   = `${_ESC}[0m`
const _B   = `${_ESC}[1m`
const _D   = `${_ESC}[2m`
const _AM  = `${_ESC}[38;5;208m`
const _EM  = `${_ESC}[92m`
const _CY  = `${_ESC}[96m`
const _WH  = `${_ESC}[97m`

const _SEP = `${_D}${'─'.repeat(44)}${_R}`
const _DOT = `${_EM}●${_R}`
const _URL = (u: string) => `${_CY}${_B}${u}${_R}`

const _UI_PORT = process.env.VITE_PORT ?? '47292'
// Binary mode: the web dashboard has its own port (WEB_PORT, 47292). Dev: Vite's port.
const _WEB_URL = SERVE_STATIC ? `http://localhost:${WEB_PORT}` : `http://localhost:${_UI_PORT}`

process.stdout.write(
  `\n${_SEP}\n` +
  `  ${_B}${_AM}agentistics${_R}\n` +
  `${_SEP}\n` +
  `  ${_WH}web${_R}  ${_DOT}  ${_URL(_WEB_URL)}\n` +
  `  ${_WH}api${_R}  ${_DOT}  ${_URL(`http://localhost:${PORT}`)}\n` +
  `  ${_WH}mcp${_R}  ${_DOT}  ${_D}agentistics (stdio → http://localhost:${PORT})${_R}\n` +
  `${_SEP}\n\n`
)
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('EADDRINUSE') || msg.includes('already in use')) {
    console.log(`[server] Port ${PORT} already in use — reusing existing instance.`)
    process.exit(0)
  }
  throw err
}
