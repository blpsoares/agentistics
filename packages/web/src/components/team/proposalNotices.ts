/**
 * proposalNotices.ts — PURE. Everything the connection card's NOTICES affordance decides: how many
 * notices a connection has, what applying a proposal would actually change ON THIS MACHINE, and the
 * small display helpers that go with it.
 *
 * The card used to render a proposal inline, as a block of prose with an Apply button whose only
 * description was the SIBLING's rules. That is the wrong sentence: the useful one is the diff
 * against YOUR rules — which rows stop being shared here, and whether the sibling's snapshot is in
 * any part more permissive than what you already chose. `planProposalApply` (`@agentistics/core`)
 * answers both; nothing here re-derives the sharing semantics.
 */
import { NO_REPO_KEY, repoShortName, planProposalApply } from '@agentistics/core'
import type { ShareSource, ProposalApplyPlan } from '@agentistics/core'
import { COPY, interpolate } from './copy'
import type { ShareMode } from './sharePanelState'

export interface ProposalView {
  id: string
  fromMachineName: string
  shareMode: ShareMode
  sources: ShareSource[]
  at: string
}

export interface KeyWarningView {
  machineId: string
  machineName: string
}

export interface PeerFingerprint {
  machineId: string
  /** As named by the central. Empty for a pin taken before names were stored. */
  machineName: string
  fingerprint: string
}

/**
 * PURE. What to call a peer in the fingerprint list.
 *
 * NEVER the machine id. That value is `sha256(token)` — derived from a credential, meaningless to
 * a person, and another machine's internals rendered on this machine's card. An unnamed machine is
 * a fact and is said in words; the fingerprint beside it is what actually identifies it for the one
 * purpose this list serves.
 */
export function peerLabel(peer: PeerFingerprint, lang: 'pt' | 'en'): string {
  return peer.machineName || COPY.peerUnnamed[lang]
}

/** Anything older than this is called out on the card. A rules change is a human-speed event, so a
 *  proposal that has been in flight for a day is worth a second look before applying — the one
 *  cue the user has against a central that withheld an envelope and delivered it late. */
export const PROPOSAL_STALE_MS = 24 * 60 * 60_000

/** PURE. A proposal's age as a short phrase, plus whether it is old enough to warn about. */
export function proposalAge(at: string, now: number, lang: 'pt' | 'en'): { text: string; stale: boolean } {
  const ts = Date.parse(at)
  // An unreadable timestamp is treated as stale: it is one fewer thing the user can rely on, and
  // reading it as "just now" would be the reassuring answer rather than the true one.
  if (Number.isNaN(ts)) return { text: '', stale: true }
  const elapsed = Math.max(0, now - ts)
  const hours = Math.floor(elapsed / 3_600_000)
  const stale = elapsed >= PROPOSAL_STALE_MS
  if (hours < 1) return { text: COPY.ageJustNow[lang], stale }
  if (hours < 24) return { text: interpolate(COPY.ageHours[lang], { n: hours }), stale }
  return { text: interpolate(COPY.ageDays[lang], { n: Math.floor(hours / 24) }), stale }
}

/** PURE. A rule list as a short human sentence — never a raw sentinel key. */
export function describeSources(sources: readonly ShareSource[], lang: 'pt' | 'en'): string {
  if (sources.length === 0) return COPY.proposalNoSources[lang]
  return sources
    .map(s => {
      if (s.type === 'none') return COPY.elsewhereNoRepo[lang]
      if (s.type === 'project') return s.value
      return s.value === NO_REPO_KEY ? COPY.elsewhereNoRepo[lang] : (repoShortName(s.value) || s.value)
    })
    .join(', ')
}

/** How many notices a connection is holding, and whether any of them is an ALARM (a changed key)
 *  rather than a decision. The count is what the card's button shows; the tone is its colour. */
export interface NoticeSummary {
  total: number
  proposals: number
  keyWarnings: number
  tone: 'alarm' | 'decision' | 'none'
}

export function noticeSummary(
  proposals: readonly unknown[] | undefined,
  keyWarnings: readonly unknown[] | undefined,
): NoticeSummary {
  const p = proposals?.length ?? 0
  const k = keyWarnings?.length ?? 0
  return { total: p + k, proposals: p, keyWarnings: k, tone: k > 0 ? 'alarm' : p > 0 ? 'decision' : 'none' }
}

/**
 * What "Apply here" would do to THIS connection — the narrowing-only merge plus everything the
 * modal has to state. The connection's own stored rules are the baseline; `shareMode` absent reads
 * as `'denylist'`, like every other reader in this codebase.
 */
export function proposalPlan(
  conn: { shareMode?: ShareMode; sources?: ShareSource[] },
  proposal: { shareMode: ShareMode; sources: ShareSource[] },
): ProposalApplyPlan {
  return planProposalApply(
    { shareMode: conn.shareMode === 'allowlist' ? 'allowlist' : 'denylist', sources: conn.sources ?? [] },
    { shareMode: proposal.shareMode, sources: proposal.sources },
  )
}
