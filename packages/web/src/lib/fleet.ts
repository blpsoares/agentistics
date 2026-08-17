/**
 * fleet.ts — the browser's half of `/api/fleet`.
 *
 * It holds NO rule about what a session may take. Every `enabled` flag, every refusal sentence and
 * every verb label arrives already decided from the server, which resolves them through the same
 * `sessionActions` the terminal cockpit resolves every keypress against. A second implementation
 * here would be a second set of rules — the bug `task-reopen.ts` exists to have fixed once — and it
 * would go wrong in the expensive direction: offering "answer its question" on a numbered dialog
 * belonging to a harness with no verified way to pick, where the keystroke takes whichever option
 * happens to be highlighted.
 *
 * What this module owns is the transport, the poll, and the mapping from a stored `SessionMeta` row
 * to the live fleet row that is driving it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

/** Mirrors `SessionAction` in `@agentistics/tui/control/sessions`, minus the verbs a page cannot do. */
export type FleetActionId =
  | 'resume' | 'approve' | 'prompt' | 'rename' | 'note' | 'task' | 'kill'
  | 'openTask' | 'finishTask'

/** The verbs this page can PERFORM. The rest are shown, dimmed, with their reason. */
export const PERFORMABLE: ReadonlySet<FleetActionId> = new Set<FleetActionId>([
  'resume', 'approve', 'prompt', 'rename', 'note', 'task', 'kill', 'openTask', 'finishTask',
])

/** The verbs that take a line of text before they can run. */
export const TEXT_VERBS: ReadonlySet<FleetActionId> = new Set<FleetActionId>([
  'prompt', 'rename', 'note', 'task',
])

export interface FleetVerb {
  action: FleetActionId
  /** Already localized by the server, from the very map the terminal cockpit prints. */
  label: string
  enabled: boolean
  /** Why it is off, when the row can say. Already localized. */
  reason?: string
}

export interface FleetRow {
  id: string
  title: string
  harness: string
  cwd: string
  project: string
  state: 'working' | 'waiting' | 'waiting-approval' | 'exited' | 'lost' | 'unknown' | 'closed'
  stateLabel: string
  actionable: boolean
  task?: string
  note?: string
  model?: string
  conversationId?: string
  approvalLines?: string[]
  dialogOptions?: { number: number; label: string; selected?: boolean }[]
  approvalBlind?: string
  approveBlind?: string
  chooseBlind?: string
  conversationBlind?: string
  attachCommand: string
  verbs: FleetVerb[]
}

export interface FleetPayload {
  sessions: FleetRow[]
  attention: number
  unavailable?: string
  tasks: string[]
}

const EMPTY: FleetPayload = { sessions: [], attention: 0, tasks: [] }

/** How often the page re-reads the fleet. The cockpit polls at 5s; matching it keeps the two in step. */
const FLEET_POLL_MS = 5000

export interface FleetState {
  fleet: FleetPayload
  /** True until the first answer arrives — an empty list before then is "not asked yet". */
  loading: boolean
  /**
   * The route is absent or refused (a central, or an exposure profile with no host power).
   *
   * Distinct from an empty fleet on purpose: "there are no managed sessions" and "this page cannot
   * ask" are different facts, and rendering the second as the first is a confident zero from a
   * machine that was never allowed to look.
   */
  unsupported: boolean
  refresh: () => void
  act: (req: {
    id: string
    action: FleetActionId
    text?: string
    choice?: number
  }) => Promise<{ ok: boolean; message: string }>
}

export function useFleet(lang: 'pt' | 'en', enabled = true): FleetState {
  const [fleet, setFleet] = useState<FleetPayload>(EMPTY)
  const [loading, setLoading] = useState(enabled)
  const [unsupported, setUnsupported] = useState(false)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch(`/api/fleet?lang=${lang}`)
        if (!alive) return
        // 403 (capability off) / 404 (a central) are ANSWERS, not failures — the page says so
        // rather than showing an empty fleet it never got to read.
        if (res.status === 403 || res.status === 404) { setUnsupported(true); setLoading(false); return }
        if (!res.ok) return
        const json = await res.json() as FleetPayload
        if (!alive) return
        setUnsupported(false)
        setFleet(json)
      } catch {
        /* transient — keep the last known fleet, exactly as the cockpit's poller does */
      } finally {
        if (alive) setLoading(false)
      }
    }
    void poll()
    const id = setInterval(poll, FLEET_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [lang, enabled, tick])

  const act = useCallback<FleetState['act']>(async req => {
    try {
      const res = await fetch(`/api/fleet/act?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      const json = await res.json().catch(() => null) as { ok?: boolean; message?: string } | null
      const out = {
        ok: Boolean(json?.ok),
        message: json?.message
          ?? (lang === 'pt' ? 'A ação não pôde ser executada.' : 'The action could not be run.'),
      }
      refresh()
      return out
    } catch {
      return {
        ok: false,
        message: lang === 'pt' ? 'Erro de rede ao falar com esta máquina.' : 'Network error talking to this machine.',
      }
    }
  }, [lang, refresh])

  return { fleet, loading, unsupported, refresh, act }
}

/**
 * A stored session id → the live fleet row driving it.
 *
 * Keyed on BOTH `conversationId` and `id`: the first is the exact link a managed row records (the
 * uuid handed to `claude --session-id`), the second is what a `closed` row — one read straight out
 * of the conversation store — is already named by. A managed row's own id is a tmux session name
 * and can never collide with a conversation id, so one map answers both without ambiguity.
 */
export function fleetIndex(rows: readonly FleetRow[]): Map<string, FleetRow> {
  const map = new Map<string, FleetRow>()
  for (const r of rows) {
    map.set(r.id, r)
    if (r.conversationId) map.set(r.conversationId, r)
  }
  return map
}

export function useFleetIndex(rows: readonly FleetRow[]): Map<string, FleetRow> {
  return useMemo(() => fleetIndex(rows), [rows])
}
