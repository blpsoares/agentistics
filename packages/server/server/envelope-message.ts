/**
 * envelope-message.ts — PURE. What travels inside a sealed envelope, and the trust-on-first-use
 * pin decision.
 *
 * The only message kind this channel carries is a RESTRICTION PROPOSAL: "for the central with
 * instanceId X, these are now my sharing rules". Keeping the channel to one kind is deliberate —
 * a general-purpose machine-to-machine message bus between a user's laptops is a remote-control
 * feature, and this is not one (see `envelope-inbox.ts`: a received message never changes rules by
 * itself).
 *
 * `instanceId` and not the endpoint URL: two machines can reach the same central under different
 * names (LAN address vs. hostname vs. tunnel), and a proposal must be matched to the CENTRAL it is
 * about, not to a spelling of its URL.
 */
import type { ShareSource } from '@agentistics/core'

export const MAX_MESSAGE_SOURCES = 2000

export interface RestrictionMessage {
  kind: 'restriction'
  /** The central this proposal is about — `GET /api/team/policy`'s `instanceId`. */
  instanceId: string
  shareMode: 'denylist' | 'allowlist'
  sources: ShareSource[]
  /** When the sender applied it locally, ISO. Display only; never trusted for ordering decisions
   *  a peer's clock could skew. */
  at: string
}

export function encodeRestrictionMessage(m: RestrictionMessage): string {
  return JSON.stringify(m)
}

/**
 * Parse and VALIDATE a decrypted payload. Total: anything unexpected yields `null`, never a
 * partially-populated message. A decrypted-but-malformed payload means the peer runs a build this
 * one does not understand, which must read as "nothing to propose" rather than as a rule set with
 * half its entries silently dropped — the same fail-closed rule `validateShareSources` follows on
 * the HTTP boundary.
 */
export function decodeRestrictionMessage(raw: string): RestrictionMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const m = parsed as Record<string, unknown>
  if (m.kind !== 'restriction') return null
  if (typeof m.instanceId !== 'string' || m.instanceId === '') return null
  if (m.shareMode !== 'denylist' && m.shareMode !== 'allowlist') return null
  if (typeof m.at !== 'string' || m.at === '') return null
  if (!Array.isArray(m.sources) || m.sources.length > MAX_MESSAGE_SOURCES) return null
  const sources: ShareSource[] = []
  for (const s of m.sources) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null
    const e = s as Record<string, unknown>
    if (e.type !== 'repo' && e.type !== 'project' && e.type !== 'none') return null
    if (typeof e.value !== 'string') return null
    sources.push({ type: e.type, value: e.value })
  }
  return { kind: 'restriction', instanceId: m.instanceId, shareMode: m.shareMode, sources, at: m.at }
}

/** What a machine should do with a peer public key it just received from the central. */
export type PinDecision =
  /** Never seen this peer before — pin it (trust on first use) and proceed. */
  | 'new'
  /** Same key as pinned — proceed. */
  | 'same'
  /** DIFFERENT key than pinned — refuse, and say so loudly. A reinstall and a central substituting
   *  a key are indistinguishable from here, so the machine must not choose for the user. */
  | 'changed'

export function decidePin(stored: string | null | undefined, incoming: string): PinDecision {
  if (!stored) return 'new'
  return stored === incoming ? 'same' : 'changed'
}
