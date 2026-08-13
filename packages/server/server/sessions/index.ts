/**
 * index.ts — the only place that branches on platform.
 *
 * Phase 4 adds `backend-pty.ts` for Windows here. Until then Windows resolves to the tmux backend,
 * whose `unavailable()` says so plainly — a verb that cannot work is absent, and the reason is
 * stated, rather than a crash at spawn time.
 */

import { tmuxBackend } from './backend-tmux'
import type { SessionBackend } from './types'

export async function resolveBackend(): Promise<SessionBackend> {
  return tmuxBackend
}

export * from './types'
export { SPAWN_SPECS, planSpawn } from './spawn-spec'
export { reconcileSessions, resolveSessionRef } from './session-ref'
export { addSession, newSessionId, patchSession, readRegistry, removeSession } from './registry'
export { SESSION_POLL_MS, createSessionsPoller, type SessionSnapshot } from './sessions-host'
export {
  attentionCount, bellTransitions, buildSessionViews, groupSessions, needsAttention,
  type SessionGroup, type SessionGrouping, type SessionView,
} from './session-view'
export { ATTENTION_RULES, rulesFor } from './attention-rules'
export { QUIET_MS, attentionOf, digestFrame } from './attention'
