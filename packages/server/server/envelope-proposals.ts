/**
 * envelope-proposals.ts — GET/DELETE /api/team/proposals, LOCAL and same-origin.
 *
 * Reads the restriction proposals this machine has received from its siblings, and dismisses one.
 * That is the whole surface. There is NO apply route here on purpose: applying a proposal is the
 * ordinary `PATCH /api/team/connections/:id` the user's click performs, through the same validated
 * and audited path a hand-edited rule takes. A dedicated "apply this message" endpoint would be
 * the remote-control channel this feature is specifically not (see `envelope-inbox.ts`).
 *
 * Same-origin only: these are this machine's own decrypted messages and its own fingerprints, no
 * different in kind from `GET /api/team/status`. On a central the generic auth gate covers it;
 * this route is not in `AUTH_PUBLIC`.
 */
import { readPreferences } from './preferences'
import { safeConnId } from './config'
import { readJsonLimited, LIMITS } from './limits'
import { safeError } from './errors'
import { PROFILE } from './exposure'
import { readInbox, dismissProposal, dismissKeyWarning } from './envelope-inbox'
import { publicKeyOnly, pinnedPeers } from './envelope-keys'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export interface DismissBody {
  connId: string
  /** Exactly one of these: a proposal id, or the machine id whose key warning is being cleared. */
  proposalId?: string
  keyWarningMachineId?: string
}

/** PURE. Validates a dismissal request. */
export function parseDismissBody(raw: unknown): { ok: true; body: DismissBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid body' }
  const r = raw as Record<string, unknown>
  if (typeof r.connId !== 'string' || r.connId === '') return { ok: false, error: 'connId is required' }
  const proposalId = typeof r.proposalId === 'string' && r.proposalId ? r.proposalId : undefined
  const keyWarningMachineId = typeof r.keyWarningMachineId === 'string' && r.keyWarningMachineId ? r.keyWarningMachineId : undefined
  if (!proposalId && !keyWarningMachineId) return { ok: false, error: 'proposalId or keyWarningMachineId is required' }
  if (proposalId && keyWarningMachineId) return { ok: false, error: 'name exactly one of proposalId / keyWarningMachineId' }
  return { ok: true, body: { connId: r.connId, proposalId, keyWarningMachineId } }
}

export async function handleProposals(
  req: Request,
  deps: { readPreferences?: typeof readPreferences } = {},
): Promise<Response> {
  try {
    if (req.method === 'GET') {
      const prefs = await (deps.readPreferences ?? readPreferences)()
      const connections = prefs.team?.connections ?? []
      const byConnection = await Promise.all(connections.map(async c => {
        // Named fields, never a spread of the whole inbox: `openedDigests` is up to 500 hex
        // strings per connection and the panel polls this every 30s. It is not secret, but a route
        // must ship what its consumer needs, not whatever the store happens to hold — a spread
        // silently exports every field a future revision adds to `InboxState`.
        const inbox = await readInbox(c.id)
        return {
          connId: c.id,
          proposals: inbox.proposals,
          keyWarnings: inbox.keyWarnings,
          // Public keys only — the fingerprint affordance for a user who wants to compare two
          // machines they own. Never the pinned key itself, and never this machine's private half.
          peers: await pinnedPeers(c.id),
        }
      }))
      return json({ ok: true, me: await publicKeyOnly(), connections: byConnection })
    }

    const raw = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
    if (!raw.ok) return json({ error: 'invalid body' }, raw.error === 'too_large' ? 413 : 400)
    const parsed = parseDismissBody(raw.value)
    if (!parsed.ok) return json({ error: parsed.error }, 400)
    let connId: string
    try {
      connId = safeConnId(parsed.body.connId)
    } catch {
      return json({ error: 'invalid connection id' }, 400)
    }
    const removed = parsed.body.proposalId
      ? await dismissProposal(connId, parsed.body.proposalId)
      : await dismissKeyWarning(connId, parsed.body.keyWarningMachineId!)
    return json({ ok: true, removed })
  } catch (err) {
    const safe = safeError(err, { verbose: PROFILE === 'local' })
    console.warn('[envelope-proposals]', safe.logLine)
    return json(safe.body, 500)
  }
}
