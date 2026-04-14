import { join } from 'path'
import { spawn } from 'child_process'
import chokidar from 'chokidar'
import { SESSION_META_DIR, PROJECTS_DIR, PORT } from './config'

export type SseController = ReadableStreamDefaultController<Uint8Array>

export const sseClients = new Set<SseController>()
export const sseEncoder = new TextEncoder()

export function notifySseClients() {
  const payload = sseEncoder.encode('event: change\ndata: {}\n\n')
  for (const ctrl of [...sseClients]) {
    try {
      ctrl.enqueue(payload)
    } catch {
      sseClients.delete(ctrl)
    }
  }
}

let sseDebounce: ReturnType<typeof setTimeout> | null = null

export function triggerSseNotification() {
  if (sseDebounce) clearTimeout(sseDebounce)
  sseDebounce = setTimeout(notifySseClients, 2000)
}

export function setupFileWatcher() {
  const watch = (dir: string) => {
    const watcher = chokidar.watch(dir, {
      persistent: true,
      ignoreInitial: true,
    })
    watcher.on('all', triggerSseNotification)
    watcher.on('error', (err: unknown) => {
      console.warn(`[watcher] Could not watch ${dir}:`, String(err))
    })
    console.log(`[watcher] Watching ${dir}`)
  }
  watch(SESSION_META_DIR)
  watch(PROJECTS_DIR)
}

export function maybeSpawnWatcher() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return

  const watcherPath = join(import.meta.dir, '..', 'watcher.ts')
  console.log('[server] OTEL_EXPORTER_OTLP_ENDPOINT is set — spawning watcher daemon...')

  const child = spawn('bun', ['run', watcherPath], {
    stdio: 'inherit',
    env: process.env,
  })

  child.on('error', (err) => {
    console.error('[watcher] Failed to spawn:', err.message)
  })

  child.on('exit', (code, signal) => {
    const expectedSignal = signal === 'SIGTERM' || signal === 'SIGINT'
    if (code !== 0 || (signal !== null && !expectedSignal)) {
      console.warn(`[watcher] OTel watcher daemon exited unexpectedly (code=${code} signal=${signal}). OTel metrics export has stopped.`)
    }
  })

  const killChild = () => {
    process.removeListener('exit', killChild)
    process.removeListener('SIGINT', killChild)
    process.removeListener('SIGTERM', killChild)
    if (!child.killed) child.kill()
  }
  process.once('exit', killChild)
  process.once('SIGINT', killChild)
  process.once('SIGTERM', killChild)

  // If the child exits naturally, clean up the process-level handlers too
  child.on('exit', () => {
    process.removeListener('exit', killChild)
    process.removeListener('SIGINT', killChild)
    process.removeListener('SIGTERM', killChild)
  })
}

const SERVE_STATIC = process.env.SERVE_STATIC === '1'

// embeddedDist is only available after `bun run build:assets` (binary mode).
// In dev mode (SERVE_STATIC is never set), this import is skipped entirely.
const embeddedDist: Record<string, { content: string; encoding: string; contentType: string }> =
  SERVE_STATIC
    ? (await import('../src/embedded-dist.generated.ts')).embeddedDist
    : {}

export { SERVE_STATIC }

export function serveStatic(pathname: string): Response | null {
  if (!SERVE_STATIC) return null
  const asset = embeddedDist[pathname]
  if (!asset) return null
  const body =
    asset.encoding === 'base64'
      ? Buffer.from(asset.content, 'base64')
      : asset.content
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'public, max-age=31536000' },
  })
}
