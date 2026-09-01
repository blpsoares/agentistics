/**
 * api.ts — the extension host's half of the local `agentop server`.
 *
 * The ONE process that talks HTTP. It runs beside the fleet (or, under Remote-SSH, on the machine
 * the fleet is on), which is the whole reason the webview does not fetch for itself: a webview's
 * `localhost` is the BROWSER's, and in a remote window that is not the machine the sessions run on.
 *
 * Every method is TOTAL. A server that is not running, a central that refuses, a profile with no
 * host power and a socket that died mid-request are four different answers and are kept apart —
 * `LinkStatus` is what carries the difference to the screen. Nothing here throws at the caller, and
 * nothing here invents a value: a failed read of the fleet keeps the PREVIOUS one, exactly as the
 * cockpit's poller does, because the last known truth beats a confident empty list.
 */

import type { SessionMeta } from '@agentistics/core'
import type {
  FleetActionId, FleetPayload, LinkStatus, NewOptions, SpawnRequest,
} from './protocol'
import { todayTotals, type TodayTotals } from './today'

export interface AttachTicket {
  argv: string[]
  detachHint: string
  label: string
}

export interface ActionResult {
  ok: boolean
  message: string
}

/** How long any one call may take. The fleet poll is every 5s; a slower answer is a dead one. */
const TIMEOUT_MS = 8_000
/** The metrics payload is megabytes on a well-used machine — it gets its own, longer, ceiling. */
const DATA_TIMEOUT_MS = 30_000

export class AgentopClient {
  constructor(
    private readonly api: string,
    private readonly lang: 'en' | 'pt',
  ) {}

  private url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(this.api + path)
    u.searchParams.set('lang', this.lang)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return u.toString()
  }

  /**
   * The fleet, plus how this window is doing at asking for it.
   *
   * 403 and 404 are ANSWERS, not failures: the first is an exposure profile with no host power, the
   * second a central, which aggregates many machines and hosts none of their sessions. Rendering
   * either as an empty fleet would be a confident "nothing is running" from a machine that was
   * never allowed to look.
   */
  async fleet(): Promise<{ link: LinkStatus; payload?: FleetPayload }> {
    try {
      const res = await fetch(this.url('/api/fleet'), { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.status === 403 || res.status === 404) {
        return { link: { state: 'refused', url: this.api } }
      }
      if (!res.ok) return { link: { state: 'down', url: this.api } }
      return { link: { state: 'ok', url: this.api }, payload: await res.json() as FleetPayload }
    } catch {
      return { link: { state: 'down', url: this.api } }
    }
  }

  /**
   * One verb, on one row.
   *
   * The refusal sentence comes from the server — it is the cockpit's own wording, decided where the
   * decision was made. The only message this module composes is the one for a request that never
   * arrived, which the server by definition could not have worded.
   */
  async act(req: { id: string; action: FleetActionId; text?: string; choice?: number }): Promise<ActionResult> {
    return await this.post('/api/fleet/act', req)
  }

  /** Start a session. Same shape, same rule about whose words the answer is in. */
  async spawn(req: SpawnRequest): Promise<ActionResult & { id?: string }> {
    return await this.post('/api/fleet/new', req)
  }

  private async post(path: string, body: unknown): Promise<ActionResult & { id?: string }> {
    try {
      const res = await fetch(this.url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const json = await res.json().catch(() => null) as (ActionResult & { id?: string }) | null
      if (json && typeof json.message === 'string') return { ...json, ok: Boolean(json.ok) }
      return { ok: false, message: this.networkError() }
    } catch {
      return { ok: false, message: this.networkError() }
    }
  }

  /**
   * What it takes to attach, or `null` when this machine cannot attach to that row.
   *
   * Null rather than an empty ticket: a caller handed an empty argv would open a terminal that sits
   * there doing nothing, which is the least debuggable outcome available.
   */
  async attach(id: string): Promise<AttachTicket | null> {
    try {
      const res = await fetch(this.url('/api/fleet/attach', { id }), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) return null
      const ticket = await res.json() as AttachTicket
      return Array.isArray(ticket.argv) && ticket.argv.length > 0 ? ticket : null
    } catch {
      return null
    }
  }

  /** The wizard's data. A machine that cannot answer says so in `unavailable`, never with silence. */
  async newOptions(query: string): Promise<NewOptions> {
    try {
      const res = await fetch(this.url('/api/fleet/new', { q: query }), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) return { harnesses: [], projects: [], tasks: [], unavailable: this.networkError() }
      return await res.json() as NewOptions
    } catch {
      return { harnesses: [], projects: [], tasks: [], unavailable: this.networkError() }
    }
  }

  /**
   * Today's totals, or `null` when the machine did not answer.
   *
   * `null` and `{cost: 0}` are kept apart all the way to the status bar: a day with no work is a
   * real zero, and a server that is not running is not a day with no work.
   */
  async today(now: Date): Promise<TodayTotals | null> {
    try {
      const res = await fetch(this.url('/api/data'), { signal: AbortSignal.timeout(DATA_TIMEOUT_MS) })
      if (!res.ok) return null
      const data = await res.json() as { sessions?: SessionMeta[] }
      return todayTotals(data.sessions ?? [], now)
    } catch {
      return null
    }
  }

  private networkError(): string {
    return this.lang === 'pt'
      ? 'Não foi possível falar com o agentop server desta máquina.'
      : 'Could not reach the agentop server on this machine.'
  }
}
