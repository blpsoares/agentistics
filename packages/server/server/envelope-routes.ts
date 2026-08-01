/**
 * envelope-routes.ts — CENTRAL side handlers for the sealed-envelope channel.
 *
 *   GET    /api/team/keys       — the published public keys of MY account's machines
 *   POST   /api/team/keys       — publish MY public key
 *   GET    /api/team/envelopes  — the sealed envelopes addressed to me
 *   POST   /api/team/envelopes  — deposit sealed envelopes for my account's other machines
 *   DELETE /api/team/envelopes  — acknowledge (delete) envelopes addressed to me
 *
 * Every one is minted-token-only, authenticated inside the handler (hence the `AUTH_PUBLIC` entry)
 * and scoped to the token's OWNER ACCOUNTS via `listSiblingMachines`. Two rules the routes enforce
 * that the client cannot be trusted with:
 *
 *   - The SENDER of a deposited envelope is stamped from the token, never read from the body.
 *   - The RECIPIENT must be a machine of the caller's own account. A machine cannot deposit into a
 *     stranger's mailbox, which would otherwise be an unauthenticated write primitive against
 *     every other user of the central.
 *
 * Bodies go through `readJsonLimited` (these routes are reached before any cookie check) and
 * errors through `safeError` — the client gets a code and a ref, never internal text.
 */
import { validateIngestToken, listSiblingMachines } from './team-tokens'
import { readJsonLimited, LIMITS } from './limits'
import { safeError } from './errors'
import { PROFILE } from './exposure'
import {
  publishMachineKey, peerKeysFor, depositEnvelope, fetchEnvelopesFor, ackEnvelopes,
} from './envelope-store'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** A base64 SPKI DER X25519 public key is 44 bytes → 60 base64 characters. The bound is generous
 *  rather than exact so a future key type is not locked out, but it is a bound: the directory must
 *  not become a place to park arbitrary blobs. */
export const MAX_PUBLIC_KEY_CHARS = 512
/** One deposit round. A machine addresses its siblings, of which there are a handful. */
export const MAX_ENVELOPES_PER_DEPOSIT = 50
/** Ceiling on one sealed envelope, serialized. A restriction message is a few hundred bytes; this
 *  leaves room for a large allowlist without leaving room for abuse. */
export const MAX_ENVELOPE_CHARS = 256 * 1024
export const MAX_ACK_IDS = 500

export function parsePublishKeyBody(raw: unknown): { ok: true; publicKey: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid body' }
  const publicKey = (raw as { publicKey?: unknown }).publicKey
  if (typeof publicKey !== 'string' || publicKey === '') return { ok: false, error: 'publicKey must be a non-empty string' }
  if (publicKey.length > MAX_PUBLIC_KEY_CHARS) return { ok: false, error: 'publicKey too long' }
  return { ok: true, publicKey }
}

export interface DepositItem {
  recipientMachineId: string
  envelope: unknown
}

export function parseDepositBody(raw: unknown): { ok: true; items: DepositItem[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid body' }
  const list = (raw as { envelopes?: unknown }).envelopes
  if (!Array.isArray(list)) return { ok: false, error: 'envelopes must be an array' }
  if (list.length > MAX_ENVELOPES_PER_DEPOSIT) return { ok: false, error: `at most ${MAX_ENVELOPES_PER_DEPOSIT} envelopes per request` }
  const items: DepositItem[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: 'each envelope entry must be an object' }
    const e = entry as Record<string, unknown>
    if (typeof e.recipientMachineId !== 'string' || e.recipientMachineId === '') {
      return { ok: false, error: 'recipientMachineId must be a non-empty string' }
    }
    if (!e.envelope || typeof e.envelope !== 'object') return { ok: false, error: 'envelope must be an object' }
    if (JSON.stringify(e.envelope).length > MAX_ENVELOPE_CHARS) return { ok: false, error: 'envelope too large' }
    items.push({ recipientMachineId: e.recipientMachineId, envelope: e.envelope })
  }
  return { ok: true, items }
}

export function parseAckBody(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid body' }
  const ids = (raw as { ids?: unknown }).ids
  if (!Array.isArray(ids)) return { ok: false, error: 'ids must be an array' }
  if (ids.length > MAX_ACK_IDS) return { ok: false, error: `at most ${MAX_ACK_IDS} ids per request` }
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id === '') return { ok: false, error: 'ids must be non-empty strings' }
    out.push(id)
  }
  return { ok: true, ids: out }
}

/**
 * Which of the requested recipients the caller is actually allowed to write to. PURE, so the
 * central's one non-negotiable authorization rule is unit-testable without Mongo: a recipient must
 * be a machine of the caller's own account, and never the caller itself (a machine posting to its
 * own mailbox is a client bug, and storing it would make the sender read its own proposal back as
 * if a sibling had sent it).
 */
export function allowedRecipients(
  requested: readonly string[],
  siblings: readonly { id: string }[],
  selfMachineId: string,
): string[] {
  const allowed = new Set(siblings.map(s => s.id))
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of requested) {
    if (id === selfMachineId || !allowed.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

async function authed(req: Request): Promise<{ memberId: string } | null> {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const minted = await validateIngestToken(bearer)
  return minted.ok ? { memberId: minted.memberId } : null
}

function fail(scope: string, err: unknown): Response {
  const safe = safeError(err, { verbose: PROFILE === 'local' })
  console.warn(`[${scope}]`, safe.logLine)
  return json(safe.body, 500)
}

export async function handleEnvelopeKeys(req: Request): Promise<Response> {
  const who = await authed(req)
  if (!who) return json({ error: 'unauthorized' }, 401)
  try {
    if (req.method === 'POST') {
      const raw = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
      if (!raw.ok) return json({ error: 'invalid body' }, raw.error === 'too_large' ? 413 : 400)
      const parsed = parsePublishKeyBody(raw.value)
      if (!parsed.ok) return json({ error: parsed.error }, 400)
      // The id comes from the TOKEN: a machine can only ever publish its own key.
      await publishMachineKey(who.memberId, parsed.publicKey)
      return json({ ok: true })
    }
    const siblings = await listSiblingMachines(who.memberId)
    const peers = (await peerKeysFor(siblings)).filter(p => p.machineId !== who.memberId)
    return json({ ok: true, machineId: who.memberId, peers })
  } catch (err) {
    return fail('envelope-keys', err)
  }
}

export async function handleEnvelopes(req: Request): Promise<Response> {
  const who = await authed(req)
  if (!who) return json({ error: 'unauthorized' }, 401)
  try {
    if (req.method === 'GET') {
      return json({ ok: true, envelopes: await fetchEnvelopesFor(who.memberId) })
    }

    const raw = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
    if (!raw.ok) return json({ error: 'invalid body' }, raw.error === 'too_large' ? 413 : 400)

    if (req.method === 'POST') {
      const parsed = parseDepositBody(raw.value)
      if (!parsed.ok) return json({ error: parsed.error }, 400)
      const siblings = await listSiblingMachines(who.memberId)
      const allowed = new Set(allowedRecipients(parsed.items.map(i => i.recipientMachineId), siblings, who.memberId))
      let stored = 0
      for (const item of parsed.items) {
        if (!allowed.has(item.recipientMachineId)) continue
        // Sender stamped server-side, never from the body.
        await depositEnvelope({
          senderMachineId: who.memberId,
          recipientMachineId: item.recipientMachineId,
          envelope: item.envelope,
        })
        stored++
      }
      // `stored` counts only what was accepted. A rejected recipient is not an error the caller
      // needs a reason for — telling it WHICH ids were refused would answer "does this machine
      // belong to my account", which is exactly the question a stranger's machine must not get.
      return json({ ok: true, stored })
    }

    if (req.method === 'DELETE') {
      const parsed = parseAckBody(raw.value)
      if (!parsed.ok) return json({ error: parsed.error }, 400)
      return json({ ok: true, deleted: await ackEnvelopes(who.memberId, parsed.ids) })
    }

    return json({ error: 'method not allowed' }, 405)
  } catch (err) {
    return fail('envelopes', err)
  }
}
