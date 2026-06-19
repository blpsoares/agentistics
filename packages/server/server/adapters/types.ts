import type { HarnessId, SessionMeta } from '@agentistics/core'
import type { ServerProject } from '../data'

export interface HarnessAdapter {
  id: HarnessId
  /** True when this harness's data directory exists on disk. */
  isAvailable(): boolean
  /** Normalized sessions with `harness` already set. Missing fields stay 0/undefined. */
  loadSessions(): Promise<SessionMeta[]>
  /** Optional harness-specific project discovery when not derivable from sessions. */
  loadProjects?(): Promise<ServerProject[]>
}

/** Env override: AGENTISTICS_HARNESS_<ID>=0 disables an adapter even if available. */
export function harnessEnabled(id: HarnessId): boolean {
  return process.env[`AGENTISTICS_HARNESS_${id.toUpperCase()}`] !== '0'
}
