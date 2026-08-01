/**
 * envelope-inbox.ts — decrypted, NOT-YET-APPLIED restriction proposals, per connection.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE: a message from another machine NEVER changes this
 * machine's rules. It lands here, raises a notification, and waits. Applying it is an explicit
 * local action the user takes in the UI, which goes through the ordinary
 * `PATCH /api/team/connections/:id` route — the same validated, audited path a hand-edited rule
 * takes. There is deliberately NO `applyProposal()` in this module or anywhere else on the server:
 * a machine that silently reconfigures another machine because a message arrived is a
 * remote-control channel, and this is not one. `envelope-inbox.test.ts` asserts that the module's
 * exported surface contains no such function, so adding one is a failing test, not a code review
 * someone might wave through.
 *
 * The store also carries KEY WARNINGS: a peer whose published key no longer matches the pinned one
 * (`envelope-keys.ts`). Those envelopes are never decrypted and are surfaced as an explicit alarm —
 * a reinstall and a central substituting a key are indistinguishable from here.
 */
import type { ShareSource, SiblingRuleFact } from '@agentistics/core'
import { envelopeInboxFile } from './config'
import { safeReadJson } from './utils'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Bounded so a peer (or a central replaying deposits) cannot grow this file without limit. */
export const MAX_PROPOSALS = 20

/**
 * How many opened-envelope digests to remember. This is the ANTI-REPLAY memory, and it is the
 * reason it must be bigger than the proposal list by an order of magnitude: a digest has to
 * outlive the proposal it produced, and outlive that proposal's DISMISSAL, or a central could
 * resurrect a dismissed message simply by serving the same bytes again.
 */
export const MAX_OPENED_DIGESTS = 500

/**
 * How many sibling machines' announced rules to remember. Keyed by machine id (a later
 * announcement replaces that machine's previous one), so this bounds the number of MACHINES an
 * account can have, not the number of messages they send.
 */
export const MAX_SIBLING_RULES = 50

export interface Proposal {
  /** The central's envelope id — the dedup key, so a re-delivered envelope is not a second card. */
  id: string
  fromMachineId: string
  fromMachineName: string
  shareMode: 'denylist' | 'allowlist'
  sources: ShareSource[]
  /** When the sender applied it, per the sender's clock. Display only. */
  at: string
  /** When this machine decrypted it. */
  receivedAt: string
}

export interface KeyWarning {
  machineId: string
  machineName: string
  at: string
}

export interface InboxState {
  proposals: Proposal[]
  keyWarnings: KeyWarning[]
  /**
   * What each sibling machine last ANNOUNCED about its own rules — the same envelope's payload,
   * stored as a standing fact rather than as an offer.
   *
   * This is deliberately NOT the proposal list. A proposal says "apply this here too" and dies the
   * moment the user dismisses it; the fact says "that machine withholds this repository" and must
   * survive, because it is the only evidence the reverse warning can be built from. The central
   * cannot supply it — a sibling that hides a repo simply leaves the central without it, and
   * absence is ambiguous between "restricted" and "never cloned". So: `dismissProposal` touches
   * `proposals` and nothing else, and `envelope-client.test.ts` asserts exactly that.
   *
   * Superseded per machine by `mergeSiblingFacts`, because each announcement is a full snapshot of
   * that machine's rules — which is also how a sibling that LIFTS a restriction retracts the fact.
   */
  siblingRules: SiblingRuleFact[]
  /**
   * `envelopeDigest` of every envelope this machine has already opened, newest first.
   *
   * Keyed on the SEALED BYTES, not on the central's envelope id: the central mints that id and can
   * vary it, so deduplicating on it would let the same message be re-delivered as new forever.
   * Deliberately NOT cleared by `dismissProposal` — the whole point is that a decision to ignore a
   * proposal survives the sender (or the central) sending it again.
   */
  openedDigests: string[]
}

export function emptyInbox(): InboxState {
  return { proposals: [], keyWarnings: [], openedDigests: [], siblingRules: [] }
}

/** PURE. Whether these sealed bytes have been opened before on this connection. */
export function hasOpened(state: Pick<InboxState, 'openedDigests'>, digest: string): boolean {
  return state.openedDigests.includes(digest)
}

/** PURE. Remember freshly opened envelopes, newest first, bounded. */
export function recordOpened(existing: readonly string[], digests: readonly string[]): string[] {
  const fresh = digests.filter(d => !existing.includes(d))
  return [...fresh, ...existing].slice(0, MAX_OPENED_DIGESTS)
}

/**
 * PURE. Merge freshly decrypted proposals into the stored ones: newest first, deduplicated by
 * envelope id, capped. A repeat of an id already present is DROPPED rather than refreshed — the
 * user's decision not to act on a proposal must not be undone by the sender re-sending it.
 */
export function mergeProposals(existing: readonly Proposal[], incoming: readonly Proposal[]): Proposal[] {
  const seen = new Set(existing.map(p => p.id))
  const fresh = incoming.filter(p => !seen.has(p.id))
  return [...fresh, ...existing].slice(0, MAX_PROPOSALS)
}

/** PURE. One warning per peer machine — a poll every few minutes must not become a warning list. */
export function mergeKeyWarnings(existing: readonly KeyWarning[], incoming: readonly KeyWarning[]): KeyWarning[] {
  const byId = new Map(existing.map(w => [w.machineId, w]))
  for (const w of incoming) if (!byId.has(w.machineId)) byId.set(w.machineId, w)
  return [...byId.values()].sort((a, b) => a.machineId.localeCompare(b.machineId))
}

function sanitize(raw: unknown): InboxState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyInbox()
  const r = raw as Record<string, unknown>
  const proposals = Array.isArray(r.proposals) ? (r.proposals as Proposal[]).filter(isProposal) : []
  const keyWarnings = Array.isArray(r.keyWarnings) ? (r.keyWarnings as KeyWarning[]).filter(isWarning) : []
  const openedDigests = Array.isArray(r.openedDigests)
    ? (r.openedDigests as unknown[]).filter((d): d is string => typeof d === 'string' && d !== '').slice(0, MAX_OPENED_DIGESTS)
    : []
  // Absent on every inbox written before this field existed — reads as "no facts", which is the
  // correct starting point anyway: this machine only knows what siblings announced to IT.
  const siblingRules = Array.isArray(r.siblingRules)
    ? (r.siblingRules as SiblingRuleFact[]).filter(isSiblingFact).slice(0, MAX_SIBLING_RULES)
    : []
  return { proposals: proposals.slice(0, MAX_PROPOSALS), keyWarnings, openedDigests, siblingRules }
}

function isSiblingFact(f: unknown): f is SiblingRuleFact {
  if (!f || typeof f !== 'object') return false
  const o = f as Record<string, unknown>
  return typeof o.machineId === 'string' && o.machineId !== ''
    && (o.shareMode === 'denylist' || o.shareMode === 'allowlist') && Array.isArray(o.sources)
}

function isProposal(p: unknown): p is Proposal {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.fromMachineId === 'string'
    && (o.shareMode === 'denylist' || o.shareMode === 'allowlist') && Array.isArray(o.sources)
}

function isWarning(w: unknown): w is KeyWarning {
  if (!w || typeof w !== 'object') return false
  const o = w as Record<string, unknown>
  return typeof o.machineId === 'string' && o.machineId !== ''
}

export async function readInbox(connId: string): Promise<InboxState> {
  return sanitize(await safeReadJson<unknown>(envelopeInboxFile(connId)))
}

export async function writeInbox(connId: string, state: InboxState): Promise<void> {
  const path = envelopeInboxFile(connId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8')
}

/** Remove one proposal — the user acted on it, or dismissed it. Idempotent.
 *
 *  It removes the OFFER only. `siblingRules` is untouched on purpose: deciding not to apply a
 *  sibling's rules here says nothing about whether that sibling still applies them there, and
 *  erasing the fact would silently switch off the reverse warning for that repository. */
export async function dismissProposal(connId: string, id: string): Promise<boolean> {
  const state = await readInbox(connId)
  const next = state.proposals.filter(p => p.id !== id)
  if (next.length === state.proposals.length) return false
  await writeInbox(connId, { ...state, proposals: next })
  return true
}

/** Clear one peer's key warning — the user has resolved it (or accepted the reinstall). */
export async function dismissKeyWarning(connId: string, machineId: string): Promise<boolean> {
  const state = await readInbox(connId)
  const next = state.keyWarnings.filter(w => w.machineId !== machineId)
  if (next.length === state.keyWarnings.length) return false
  await writeInbox(connId, { ...state, keyWarnings: next })
  return true
}
