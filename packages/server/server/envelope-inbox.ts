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
import type { ShareSource } from '@agentistics/core'
import { envelopeInboxFile } from './config'
import { safeReadJson } from './utils'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Bounded so a peer (or a central replaying deposits) cannot grow this file without limit. */
export const MAX_PROPOSALS = 20

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
}

export function emptyInbox(): InboxState {
  return { proposals: [], keyWarnings: [] }
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
  return { proposals: proposals.slice(0, MAX_PROPOSALS), keyWarnings }
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

/** Remove one proposal — the user acted on it, or dismissed it. Idempotent. */
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
