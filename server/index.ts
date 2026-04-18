// embeddedDist is loaded inside server/sse.ts (conditional on SERVE_STATIC=1)

import { PORT } from './config'
import { getRates } from './rates'
import { buildApiResponse, buildApiResponseStream } from './data'
import { readPreferences, writePreferences, type Preferences } from './preferences'
import { streamViaClaude, execCommand, type ChatMessage, type ChatModelId } from './chat-tty'
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


// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

    if (url.pathname === '/api/chat-tty' && req.method === 'POST') {
      try {
        const body = await req.json() as { message: string; history?: ChatMessage[]; model?: ChatModelId }
        const { message, history = [], model = 'claude-sonnet-4-6' } = body
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

const _UI_PORT = process.env.VITE_PORT ?? '5173'
const _UI_URL  = SERVE_STATIC ? `http://localhost:${PORT}` : `http://localhost:${_UI_PORT}`
const _UI_TAG  = SERVE_STATIC ? ` ${_D}embedded${_R}` : ''

process.stdout.write(
  `\n${_SEP}\n` +
  `  ${_B}${_AM}agentistics${_R}\n` +
  `${_SEP}\n` +
  `  ${_WH}api${_R}  ${_DOT}  ${_URL(`http://localhost:${PORT}`)}\n` +
  `  ${_WH} ui${_R}  ${_DOT}  ${_URL(_UI_URL)}${_UI_TAG}\n` +
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
