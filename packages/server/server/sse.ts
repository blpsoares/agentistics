import { join } from 'path'
import { spawn } from 'child_process'
import { stat } from 'fs/promises'
import chokidar from 'chokidar'
import { SESSION_META_DIR, PROJECTS_DIR, STATS_CACHE_FILE, PORT, CODEX_SESSIONS_DIR, GEMINI_DIR, COPILOT_DIR } from './config'
import { invalidateCache } from './data'
import { mirrorFile } from './archive'
import { getEnabledAdapters } from './adapters/types'

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
  invalidateCache()
  if (sseDebounce) clearTimeout(sseDebounce)
  sseDebounce = setTimeout(notifySseClients, 2000)
}

export async function setupFileWatcher() {
  const watch = (dir: string) => {
    const watcher = chokidar.watch(dir, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      // Depth cap + ignore noisy trees. Harness roots like ~/.claude and ~/.codex
      // contain huge plugin caches, temp git clones, sqlite logs and snapshots that
      // would saturate the watcher (and throw EINVAL) if traversed.
      depth: 6,
      ignored: /(^|[/\\])(\.git|node_modules|plugins|cache|\.tmp|shell_snapshots|skills|memories|log|logs|bin|antigravity|history|ide|pkg)([/\\]|$)|\.sqlite/,
    })
    watcher.on('all', (event: string, path: string) => {
      // Mirror new/changed source files into the archive before notifying clients,
      // so deleted-by-cleanup history is preserved as it is written.
      if (typeof path === 'string' && (event === 'add' || event === 'change')) {
        void mirrorFile(path)
      }
      triggerSseNotification()
    })
    watcher.on('error', (err: unknown) => {
      console.warn(`[watcher] Could not watch ${dir}:`, String(err))
    })
    console.log(`[watcher] Watching ${dir}`)
  }

  // Claude core paths
  watch(SESSION_META_DIR)
  watch(PROJECTS_DIR)
  watch(STATS_CACHE_FILE)

  // Additional harnesses: watch ONLY each harness's session directory — NOT its
  // whole data root (adapter.dataRoot). Roots like ~/.codex contain .tmp plugin
  // clones, an 18MB sqlite log, caches, etc.; watching them recursively saturates
  // chokidar and starves the request handler. Claude is already covered above.
  const HARNESS_SESSION_DIRS: Partial<Record<string, string>> = {
    codex: CODEX_SESSIONS_DIR,
    gemini: join(GEMINI_DIR, 'tmp'),
    copilot: join(COPILOT_DIR, 'session-state'),
  }
  try {
    const adapters = await getEnabledAdapters()
    const seen = new Set<string>([SESSION_META_DIR, PROJECTS_DIR, STATS_CACHE_FILE])
    for (const adapter of adapters) {
      const dir = HARNESS_SESSION_DIRS[adapter.id]
      if (!dir || seen.has(dir)) continue
      seen.add(dir)
      try {
        await stat(dir)
        watch(dir)
      } catch {
        // Directory doesn't exist yet — skip; data.ts re-scans on every request.
        console.log(`[watcher] Skipping ${dir} (not found)`)
      }
    }
  } catch (err) {
    console.warn('[watcher] Could not resolve harness adapters:', String(err))
  }
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
    ? (await import('./embedded-dist.generated.ts')).embeddedDist
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
  // Service worker and manifest must not be cached aggressively
  const isSwOrManifest = pathname === '/sw.js' || pathname === '/manifest.webmanifest' || pathname === '/registerSW.js'
  const cacheControl = isSwOrManifest ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000'
  const extraHeaders: Record<string, string> = pathname === '/sw.js'
    ? { 'Service-Worker-Allowed': '/' }
    : {}
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': asset.contentType, 'Cache-Control': cacheControl, ...extraHeaders },
  })
}
