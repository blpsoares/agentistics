import { getTeamCollection } from './mongo'
import { triggerSseNotification } from './sse'

let started = false
let pollingStarted = false

/** Watch the team collection and push SSE updates to connected dashboards.
 *  Prefers a Mongo change stream (requires a replica set); falls back to a
 *  5s count-poll when change streams are unavailable. Idempotent. */
export function startTeamWatch(): void {
  if (started) return
  started = true
  void run()
}

async function run(): Promise<void> {
  try {
    const col = await getTeamCollection()
    const stream = col.watch([], { fullDocument: 'updateLookup' })
    stream.on('change', () => triggerSseNotification())
    stream.on('error', (err: unknown) => {
      console.warn('[team-watch] change stream error, falling back to polling:', err instanceof Error ? err.message : err)
      try { void stream.close() } catch { /* already closed */ }
      void poll()
    })
    console.log('[team-watch] watching team collection via change stream')
  } catch (err) {
    console.warn('[team-watch] change stream unavailable, falling back to polling:', err instanceof Error ? err.message : err)
    void poll()
  }
}

async function poll(): Promise<void> {
  if (pollingStarted) return
  pollingStarted = true
  let last = -1
  // Simple count-based poll: any insert/replace changes the count or leaves it
  // equal on idempotent re-push (no spurious SSE). Good enough for a fallback.
  for (;;) {
    try {
      const col = await getTeamCollection()
      const n = await col.estimatedDocumentCount()
      if (last !== -1 && n !== last) triggerSseNotification()
      last = n
    } catch {
      // transient DB error — keep polling
    }
    await Bun.sleep(5000)
  }
}
