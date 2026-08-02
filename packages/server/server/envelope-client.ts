/**
 * envelope-client.ts — MEMBER side of the sealed-envelope channel: publish this machine's public
 * key, pin its peers' keys, seal a restriction proposal to each peer, and collect + decrypt the
 * ones addressed here.
 *
 * The impure shell. Every decision it makes is delegated: the cryptography to `envelope-crypto.ts`,
 * the payload validation to `envelope-message.ts`, the pin to `envelope-keys.ts`, and the
 * "propose, never apply" storage to `envelope-inbox.ts`. Nothing here changes a rule.
 *
 * All network failures are swallowed: an unreachable or older central means the channel is simply
 * unavailable this cycle, which must never break a push or surface as an error the user cannot act
 * on. The local warning (Part 1, `team-elsewhere.ts`) works without any of this.
 */
import type { TeamConnection, ShareSource, SiblingRuleFact } from '@agentistics/core'
import { mergeSiblingFacts, proposalAddsNothing } from '@agentistics/core'
import { seal, open, peekEnvelope, envelopeDigest } from './envelope-crypto'
import { encodeRestrictionMessage, decodeRestrictionMessage, type RestrictionMessage } from './envelope-message'
import { loadOrCreateKeypair, pinPeerKey, pinnedKeyFor } from './envelope-keys'
import {
  readInbox, writeInbox, mergeProposals, mergeKeyWarnings, hasOpened, recordOpened,
  MAX_SIBLING_RULES, type Proposal, type KeyWarning,
} from './envelope-inbox'
import { selfMachineId } from './team-elsewhere'

const TIMEOUT_MS = 8_000

export type EnvelopeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<Response>

export interface EnvelopeDeps {
  fetch?: EnvelopeFetch
  now?: () => Date
  notify?: (n: { type: 'error' | 'warning' | 'info' | 'success'; code: string; meta?: Record<string, unknown> }) => void
}

interface PeerKey {
  machineId: string
  machineName: string
  publicKey: string
}

function headersFor(conn: TeamConnection, json: boolean): Record<string, string> {
  const h: Record<string, string> = {}
  if (conn.token) h['Authorization'] = `Bearer ${conn.token}`
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function call(
  conn: TeamConnection,
  path: string,
  init: { method: string; body?: unknown },
  deps: EnvelopeDeps,
): Promise<unknown | null> {
  const _fetch = deps.fetch ?? (fetch as unknown as EnvelopeFetch)
  try {
    const res = await _fetch(`${conn.endpoint}${path}`, {
      method: init.method,
      headers: headersFor(conn, init.body !== undefined),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Publish this machine's public key and read back its peers'. The PRIVATE key never leaves
 *  `envelope-keys.ts`; only the public half is ever put on the wire. */
export async function publishAndFetchPeers(conn: TeamConnection, deps: EnvelopeDeps = {}): Promise<PeerKey[]> {
  const kp = await loadOrCreateKeypair()
  await call(conn, '/api/team/keys', { method: 'POST', body: { publicKey: kp.publicKey } }, deps)
  const raw = await call(conn, '/api/team/keys', { method: 'GET' }, deps)
  return parsePeers(raw)
}

/** Total: an older central (404 → `null`) or a junk payload yields no peers, never a throw. */
export function parsePeers(raw: unknown): PeerKey[] {
  if (!raw || typeof raw !== 'object') return []
  const peers = (raw as { peers?: unknown }).peers
  if (!Array.isArray(peers)) return []
  const out: PeerKey[] = []
  for (const p of peers) {
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    if (typeof o.machineId !== 'string' || o.machineId === '') continue
    if (typeof o.publicKey !== 'string' || o.publicKey === '') continue
    out.push({
      machineId: o.machineId,
      machineName: typeof o.machineName === 'string' && o.machineName ? o.machineName : o.machineId,
      publicKey: o.publicKey,
    })
  }
  return out
}

/**
 * Seal this connection's current rules to every peer whose key this machine trusts, and deposit
 * them. A peer whose key CHANGED is skipped: sealing to a substituted key would hand the plaintext
 * to whoever substituted it, which is the exact failure the pin exists to prevent.
 *
 * Returns how many envelopes the central accepted.
 */
export interface SendResult {
  /** Envelopes the central accepted. */
  stored: number
  /** Peers skipped because their published key changed, or because it could not be used at all. */
  skipped: number
  /** Peers pinned for the FIRST time by this call — every one of them will now receive this
   *  machine's rules, so each is announced (see `announceNewPeers`). */
  newPeers: { machineId: string; machineName: string }[]
}

export async function sendRestriction(
  conn: TeamConnection,
  instanceId: string,
  deps: EnvelopeDeps = {},
): Promise<SendResult> {
  const empty: SendResult = { stored: 0, skipped: 0, newPeers: [] }
  if (!conn.token || !instanceId) return empty
  const kp = await loadOrCreateKeypair()
  const me = selfMachineId(conn.token)
  const peers = await publishAndFetchPeers(conn, deps)
  const now = (deps.now ?? (() => new Date()))()

  const message: RestrictionMessage = {
    kind: 'restriction',
    instanceId,
    shareMode: conn.shareMode === 'allowlist' ? 'allowlist' : 'denylist',
    sources: (conn.sources ?? []) as ShareSource[],
    at: now.toISOString(),
  }
  const plaintext = encodeRestrictionMessage(message)

  const envelopes: { recipientMachineId: string; envelope: unknown }[] = []
  const newPeers: { machineId: string; machineName: string }[] = []
  let skipped = 0
  for (const peer of peers) {
    if (peer.machineId === me) continue
    const decision = await pinPeerKey(conn.id, peer.machineId, peer.publicKey, peer.machineName)
    if (decision === 'changed') { skipped++; continue }
    if (decision === 'new') newPeers.push({ machineId: peer.machineId, machineName: peer.machineName })
    try {
      envelopes.push({
        recipientMachineId: peer.machineId,
        envelope: seal({
          plaintext,
          senderMachineId: me,
          senderPrivateKey: kp.privateKey,
          senderPublicKey: kp.publicKey,
          recipientMachineId: peer.machineId,
          recipientPublicKey: peer.publicKey,
          instanceId,
          createdAt: now.toISOString(),
        }),
      })
    } catch {
      // ONE unusable directory entry must not stop every OTHER sibling from being told. `seal`
      // throws on a key it cannot decode, and this loop used to be unguarded inside a
      // fire-and-forget caller — so a central publishing a single junk `publicKey` silently
      // disabled the whole channel, with no error and nothing different in the UI. That is a free,
      // undetectable off-switch handed to the party this feature defends against.
      skipped++
    }
  }
  announceNewPeers(conn, newPeers, deps)
  if (envelopes.length === 0) return { stored: 0, skipped, newPeers }
  const res = await call(conn, '/api/team/envelopes', { method: 'POST', body: { envelopes } }, deps)
  const storedCount = (res as { stored?: unknown } | null)?.stored
  return { stored: typeof storedCount === 'number' ? storedCount : 0, skipped, newPeers }
}

/**
 * Announce every peer pinned for the FIRST time.
 *
 * This is the control for the attack the pin alone does not cover: a central does not need to
 * SUBSTITUTE a key at a racy first sight, it can simply INVENT a machine under a key it holds, at
 * any time. A fabricated peer has no prior key to contradict, so trust-on-first-use accepts it —
 * and from then on every restriction message is encrypted to the central as well as to the real
 * siblings. Nothing can stop the pin being taken automatically (that is the product requirement),
 * so the mitigation is that it can never be taken SILENTLY: each new peer is named, with its
 * fingerprint, in the same alarm class as a changed key.
 */
function announceNewPeers(
  conn: TeamConnection,
  newPeers: readonly { machineId: string; machineName: string }[],
  deps: EnvelopeDeps,
): void {
  if (newPeers.length === 0) return
  const notify = deps.notify ?? realNotify
  notify({
    type: 'warning',
    code: 'member.peer_pinned',
    meta: {
      connectionId: conn.id,
      central: conn.label || conn.endpoint,
      count: newPeers.length,
      name: newPeers.map(p => p.machineName).join(', '),
    },
  })
}

interface WireEnvelope {
  id: string
  senderMachineId: string
  envelope: unknown
}

function parseInbound(raw: unknown): WireEnvelope[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { envelopes?: unknown }).envelopes
  if (!Array.isArray(list)) return []
  const out: WireEnvelope[] = []
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.senderMachineId !== 'string') continue
    out.push({ id: o.id, senderMachineId: o.senderMachineId, envelope: o.envelope })
  }
  return out
}

export interface ReceiveResult {
  proposals: number
  keyWarnings: number
  /** Peers pinned for the first time by this call — announced, never silent. */
  newPeers: number
  /** Envelopes refused because the transport's routing did not match the sealed header, the
   *  envelope was for another central, it was outside the freshness window, or it had already been
   *  opened. Reported so a central quietly poisoning the channel is visible in a log. */
  refused: number
}

/**
 * Collect, decrypt and STORE the envelopes addressed to this machine. Nothing is applied — see
 * `envelope-inbox.ts`.
 *
 * Acknowledgement policy: an envelope is acked once it has been dealt with — decrypted and stored,
 * or found undecryptable/malformed (a message this build cannot read will not become readable by
 * being left there). An envelope from a peer whose key CHANGED is deliberately NOT acked: it stays
 * on the central so that resolving the key situation does not cost the user the message.
 */
export async function receiveEnvelopes(
  conn: TeamConnection,
  instanceId: string,
  deps: EnvelopeDeps = {},
): Promise<ReceiveResult> {
  const empty: ReceiveResult = { proposals: 0, keyWarnings: 0, newPeers: 0, refused: 0 }
  if (!conn.token || !instanceId) return empty
  const kp = await loadOrCreateKeypair()
  const me = selfMachineId(conn.token)
  const peers = await publishAndFetchPeers(conn, deps)
  const names = new Map(peers.map(p => [p.machineId, p.machineName]))
  // Pin every peer we can see BEFORE opening anything: the pin must be established from the key
  // directory, not from whatever key an envelope happens to carry.
  const changed = new Set<string>()
  const newPeers: { machineId: string; machineName: string }[] = []
  for (const peer of peers) {
    const decision = await pinPeerKey(conn.id, peer.machineId, peer.publicKey, peer.machineName)
    if (decision === 'changed') changed.add(peer.machineId)
    if (decision === 'new') newPeers.push({ machineId: peer.machineId, machineName: peer.machineName })
  }
  announceNewPeers(conn, newPeers, deps)

  const inbound = parseInbound(await call(conn, '/api/team/envelopes', { method: 'GET' }, deps))
  const now = (deps.now ?? (() => new Date()))()
  const state = await readInbox(conn.id)
  const fresh: Proposal[] = []
  // The same payloads, kept as standing FACTS rather than as offers — see `InboxState.siblingRules`.
  // In arrival order: `mergeSiblingFacts` lets the later entry win, never the sender's clock.
  const facts: SiblingRuleFact[] = []
  const warnings: KeyWarning[] = []
  const ack: string[] = []
  const openedNow: string[] = []
  let refused = 0

  for (const item of inbound) {
    const header = peekEnvelope(item.envelope)
    if (!header) { ack.push(item.id); refused++; continue }

    // REPLAY. Keyed on the sealed bytes, never on `item.id` — the central mints that and can vary
    // it, so an id-keyed check would let the same message be re-delivered as new forever. Checked
    // against a memory that DISMISSAL DOES NOT CLEAR, so ignoring a proposal is permanent: without
    // this, a pre-restriction envelope ("shares everything") could be replayed after the sender
    // tightened up, offering the user a one-click downgrade.
    const digest = envelopeDigest(header)
    if (hasOpened(state, digest) || openedNow.includes(digest)) { ack.push(item.id); refused++; continue }

    // The pin is looked up by the id INSIDE the seal, not by the one the transport supplied
    // beside it — otherwise a central could aim a genuine envelope at whichever pin it liked by
    // choosing the wrapper's id. `open` then holds the two to being equal.
    const pinned = await pinnedKeyFor(conn.id, header.senderMachineId)

    // MEMBERSHIP. An unpinned sender is only acceptable if the directory just listed it — and a
    // pin is only ever taken from that directory, which is what makes every fabricated peer
    // ANNOUNCED (`member.peer_pinned`). Without this check the cheaper attack is to OMIT the
    // machine instead of publishing it: no directory entry means no pin, `open` then skips the pin
    // comparison entirely, and an invented sender is filed as an apply-ready proposal with no
    // notification at all. There is no legitimate race — `publishAndFetchPeers` publishes the
    // sender's key BEFORE it deposits, so a genuine sender is always in the directory the
    // receiver has just read.
    if (pinned === null && !names.has(header.senderMachineId)) {
      ack.push(item.id)
      refused++
      continue
    }
    const opened = open({
      envelope: item.envelope,
      recipientPrivateKey: kp.privateKey,
      pinnedSenderPublicKey: pinned,
      expectedSenderMachineId: item.senderMachineId,
      expectedRecipientMachineId: me,
      expectedInstanceId: instanceId,
      now,
    })
    if (!opened.ok) {
      if (opened.reason === 'sender_key_changed') {
        changed.add(header.senderMachineId)
        continue // deliberately NOT acked — see the docblock
      }
      ack.push(item.id)
      refused++
      continue
    }
    openedNow.push(digest)
    const message = decodeRestrictionMessage(opened.plaintext)
    ack.push(item.id)
    if (!message) { refused++; continue }
    // Belt and braces on top of the AAD binding: the payload names the central it is about, and a
    // payload that disagrees with the connection it arrived on is not a message for this central.
    if (message.instanceId !== instanceId) { refused++; continue }
    const machineName = names.get(header.senderMachineId) ?? header.senderMachineId
    // AN ANNOUNCEMENT THAT WOULD ADD NOTHING HERE IS NOT A PROPOSAL. Applying one changes this
    // machine's rules, which announces them back — so a sibling that applied this machine's
    // proposal immediately offers it straight back, and each click starts the round trip again.
    // The announcement is correct and must keep happening (a snapshot is how a lifted restriction
    // is retracted); what is wrong is turning it into a DECISION when there is nothing to decide.
    // `planProposalApply` answers exactly that, with the same arithmetic the apply itself uses.
    //
    // The FACT below is stored either way: "that machine withholds this" stays true whether or not
    // there is anything left to apply here, and it is the reverse warning's only evidence.
    if (!proposalAddsNothing(
      { shareMode: conn.shareMode === 'allowlist' ? 'allowlist' : 'denylist', sources: conn.sources ?? [] },
      { shareMode: message.shareMode, sources: message.sources },
    )) {
      fresh.push({
        id: item.id,
        fromMachineId: header.senderMachineId,
        fromMachineName: machineName,
        shareMode: message.shareMode,
        sources: message.sources,
        at: message.at,
        receivedAt: now.toISOString(),
      })
    }
    // Only envelopes that got this far — opened, decoded, and naming THIS central — become facts.
    // Everything refused above is testimony this machine could not verify, and unverified
    // testimony is not knowledge.
    facts.push({
      machineId: header.senderMachineId,
      machineName,
      shareMode: message.shareMode,
      sources: message.sources,
      at: message.at,
      receivedAt: now.toISOString(),
    })
  }

  for (const machineId of changed) {
    warnings.push({ machineId, machineName: names.get(machineId) ?? machineId, at: now.toISOString() })
  }

  const nextProposals = mergeProposals(state.proposals, fresh)
  const nextWarnings = mergeKeyWarnings(state.keyWarnings, warnings)
  const nextDigests = recordOpened(state.openedDigests, openedNow)
  const nextFacts = mergeSiblingFacts(state.siblingRules, facts).slice(0, MAX_SIBLING_RULES)
  const addedProposals = nextProposals.length - state.proposals.length
  const addedWarnings = nextWarnings.length - state.keyWarnings.length
  if (addedProposals !== 0 || addedWarnings !== 0 || openedNow.length > 0) {
    await writeInbox(conn.id, {
      proposals: nextProposals, keyWarnings: nextWarnings, openedDigests: nextDigests,
      siblingRules: nextFacts,
    })
  }
  if (ack.length > 0) await call(conn, '/api/team/envelopes', { method: 'DELETE', body: { ids: ack } }, deps)

  const notify = deps.notify ?? realNotify
  if (addedProposals > 0) {
    notify({
      type: 'info',
      code: 'member.rules_proposed',
      meta: { connectionId: conn.id, central: conn.label || conn.endpoint, count: addedProposals, name: fresh[0]?.fromMachineName ?? '' },
    })
  }
  if (addedWarnings > 0) {
    notify({
      type: 'error',
      code: 'member.peer_key_changed',
      meta: { connectionId: conn.id, central: conn.label || conn.endpoint, name: warnings[0]?.machineName ?? '' },
    })
  }
  return { proposals: addedProposals, keyWarnings: addedWarnings, newPeers: newPeers.length, refused }
}

/**
 * The central's data identity (`GET /api/team/policy`'s `instanceId`) — what a proposal is ABOUT.
 * Not the endpoint URL: two machines routinely reach the same central under different names (LAN
 * address, hostname, tunnel), and a proposal must be matched to the CENTRAL, not to a spelling.
 * Unauthenticated, like the policy route itself; `null` on any failure.
 */
export async function resolveInstanceId(conn: TeamConnection, deps: EnvelopeDeps = {}): Promise<string | null> {
  const raw = await call(conn, '/api/team/policy', { method: 'GET' }, deps)
  const id = (raw as { instanceId?: unknown } | null)?.instanceId
  return typeof id === 'string' && id ? id : null
}

/** How often a machine collects its mail. Slow on purpose: a rule change is a human-speed event,
 *  and the local warning (Part 1) already covers the case this channel is late for. */
export const ENVELOPE_POLL_MS = 5 * 60_000

const _lastSync = new Map<string, number>()

/** Test-only: forget the poll throttle. */
export function __resetEnvelopeScheduleForTests(): void {
  _lastSync.clear()
}

/** Collect mail in the background if it has been long enough. Never awaited by its caller. */
export function scheduleEnvelopeSync(conn: TeamConnection, deps: EnvelopeDeps = {}): void {
  if (!conn.token) return
  const now = Date.now()
  const last = _lastSync.get(conn.id) ?? 0
  if (now - last < ENVELOPE_POLL_MS) return
  _lastSync.set(conn.id, now)
  void (async () => {
    // The instanceId identifies the central an envelope must have been sealed FOR. Without one
    // there is nothing to check a message against, so nothing is opened.
    const instanceId = await resolveInstanceId(conn, deps)
    if (!instanceId) return
    await receiveEnvelopes(conn, instanceId, deps)
  })().catch(() => { /* best-effort */ })
}

/**
 * Announce this connection's current rules to the account's other machines. Fire-and-forget, called
 * right after a local rules change. Resolving the connection from preferences here (rather than
 * taking it as an argument) keeps the caller — `handlePatchConnection` — free of any knowledge of
 * this channel beyond "tell the siblings".
 */
export function announceRestrictionNow(connId: string): void {
  void (async () => {
    const { readPreferences } = await import('./preferences')
    const prefs = await readPreferences().catch(() => null)
    const conn = prefs?.team?.connections?.find(c => c.id === connId)
    if (!conn || !conn.token) return
    const instanceId = await resolveInstanceId(conn)
    if (!instanceId) return
    await sendRestriction(conn, instanceId)
  })().catch(() => { /* best-effort */ })
}

function realNotify(n: { type: 'error' | 'warning' | 'info' | 'success'; code: string; meta?: Record<string, unknown> }): void {
  void import('./sse').then(m => m.broadcastNotification(n)).catch(() => { /* best-effort */ })
}
