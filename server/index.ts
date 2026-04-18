// embeddedDist is loaded inside server/sse.ts (conditional on SERVE_STATIC=1)

import { PORT } from './config'
import { getRates } from './rates'
import { getVersionInfo } from './version'
import { buildApiResponse, buildApiResponseStream } from './data'
import { readPreferences, writePreferences, type Preferences } from './preferences'
import { streamViaClaude, execCommand, ensureNayChat, ensureClaudeChat, CLAUDE_CHAT_DIR, type ChatMessage, type ChatModelId, type ChatAttachment } from './chat-tty'
import { listMcpServers } from './mcp-list'
import { listNaySessions, getNaySessionMessages } from './nay-sessions'
import { listClaudeSessions, getClaudeSessionMessages, type ClaudeSessionSummary, type ClaudeSessionMessage } from './claude-sessions'
import { PROJECTS_DIR } from './config'
import { safeReadDir } from './utils'
import { decodeProjectDir } from './git'
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
} from './sse'

// ---------------------------------------------------------------------------
// Start file watching and optionally spawn the OTel watcher daemon
// ---------------------------------------------------------------------------

setupFileWatcher()
maybeSpawnWatcher()
ensureNayChat(PORT).catch(err => console.error('[nay-chat] failed to initialize:', err))
ensureClaudeChat().catch(err => console.error('[claude-chat] failed to initialize:', err))


// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// ---------------------------------------------------------------------------
// Bun HTTP server
// ---------------------------------------------------------------------------

try {
Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
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
        for (const dir of dirs) {
          const projectPath = decodeProjectDir(dir)
          const files = await safeReadDir(`${PROJECTS_DIR}/${dir}`)
          const sessionCount = files.filter(f => f.endsWith('.jsonl')).length
          if (sessionCount === 0) continue
          const name = projectPath.split('/').filter(Boolean).pop() ?? dir
          entries.push({ name, path: projectPath, encodedDir: dir, sessionCount })
        }
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

    if (url.pathname === '/api/mcp-list' && req.method === 'GET') {
      const projectPath = url.searchParams.get('projectPath') ?? null
      const servers = await listMcpServers(projectPath)
      return new Response(JSON.stringify(servers), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/chat-tty' && req.method === 'POST') {
      try {
        const body = await req.json() as { message: string; history?: ChatMessage[]; model?: ChatModelId; sessionId?: string | null; attachments?: ChatAttachment[] }
        const { message, history = [], model = 'claude-sonnet-4-6', sessionId = null, attachments } = body
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
              { attachments },
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
              { cwd: projectPath ?? CLAUDE_CHAT_DIR, thinkingBudget, attachments },
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
        return new Response(JSON.stringify(data), {
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
  },
})

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
const _UI_URL  = SERVE_STATIC ? `http://localhost:${PORT}` : `http://localhost:${_UI_PORT}`
const _UI_TAG  = SERVE_STATIC ? ` ${_D}embedded${_R}` : ''

process.stdout.write(
  `\n${_SEP}\n` +
  `  ${_B}${_AM}agentistics${_R}\n` +
  `${_SEP}\n` +
  `  ${_WH}api${_R}  ${_DOT}  ${_URL(`http://localhost:${PORT}`)}\n` +
  `  ${_WH} ui${_R}  ${_DOT}  ${_URL(_UI_URL)}${_UI_TAG}\n` +
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
