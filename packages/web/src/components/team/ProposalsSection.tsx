import { useState } from 'react'
import { NO_REPO_KEY, repoShortName } from '@agentistics/core'
import type { ShareSource } from '@agentistics/core'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY, interpolate } from './copy'
import { mobileBtn } from './ConnectionCardParts'
import type { ShareMode } from './sharePanelState'

/**
 * ProposalsSection — restriction proposals another machine of this account sealed and sent, plus
 * the alarm raised when a peer's key changed.
 *
 * PROPOSE, NEVER APPLY. A decrypted message renders as a card with an explicit **Apply** button
 * and nothing else happens until it is pressed; pressing it runs the ORDINARY rules PATCH
 * (`onApply` → `handleApplyRules`), the same path a hand-edited rule takes. There is no automatic
 * path from "an envelope arrived" to "this machine's rules changed" — that would make one of the
 * user's machines a remote control for the others.
 */

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

/** PURE. What to call a peer in the fingerprint list. Falls back to a short id only when there is
 *  genuinely no name — asking a user to "recognise" a token-hash prefix is asking nothing. */
export function peerLabel(peer: PeerFingerprint): string {
  return peer.machineName || peer.machineId.slice(0, 12)
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

export interface ProposalsSectionProps {
  connId: string
  proposals: ProposalView[]
  keyWarnings: KeyWarningView[]
  /** Every peer this machine has pinned on this connection, with its fingerprint, plus this
   *  machine's own — the out-of-band check against a central that published a key it controls. */
  peers: PeerFingerprint[]
  selfFingerprint: string
  lang: 'pt' | 'en'
  disabled: boolean
  onApply: (id: string, mode: ShareMode, sources: ShareSource[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
  onDismiss: (connId: string, body: { proposalId?: string; keyWarningMachineId?: string }) => Promise<void>
}

/** PURE. A proposal's rules, as a short human sentence — never a raw sentinel key. */
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

export function ProposalsSection({
  connId, proposals, keyWarnings, peers, selfFingerprint, lang, disabled, onApply, onDismiss,
}: ProposalsSectionProps) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = useState<string | null>(null)
  const now = Date.now()

  if (proposals.length === 0 && keyWarnings.length === 0 && peers.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {keyWarnings.map(w => (
        <div
          key={w.machineId}
          role="alert"
          style={{
            padding: '10px 12px', borderRadius: 7, fontSize: 11.5, lineHeight: 1.5,
            color: 'var(--accent-red)', background: 'color-mix(in srgb, var(--accent-red) 12%, transparent)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          <strong style={{ fontSize: 12 }}>{COPY.keyChangedTitle[lang]}</strong>
          <span style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
            {interpolate(COPY.keyChangedBody[lang], { name: w.machineName })}
          </span>
          <button
            type="button"
            disabled={busy === w.machineId}
            onClick={async () => {
              setBusy(w.machineId)
              try { await onDismiss(connId, { keyWarningMachineId: w.machineId }) } finally { setBusy(null) }
            }}
            style={{ ...mobileBtn(busy === w.machineId, false, isMobile), alignSelf: isMobile ? 'stretch' : 'flex-start' }}
          >
            {COPY.keyChangedDismiss[lang]}
          </button>
        </div>
      ))}

      {proposals.map(p => (
        <div
          key={p.id}
          style={{
            padding: '10px 12px', borderRadius: 7, fontSize: 11.5, lineHeight: 1.5,
            border: '1px solid var(--border)', background: 'var(--bg-secondary)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
            {interpolate(COPY.proposalTitle[lang], { name: p.fromMachineName })}
          </strong>
          <span style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
            {p.shareMode === 'allowlist' ? COPY.proposalAllowlist[lang] : COPY.proposalDenylist[lang]}
            {' '}
            {describeSources(p.sources, lang)}
          </span>
          {(() => {
            const age = proposalAge(p.at, now, lang)
            return (
              <span style={{ fontSize: 10.5, color: age.stale ? 'var(--anthropic-orange)' : 'var(--text-tertiary)' }}>
                {age.text ? interpolate(COPY.proposalAge[lang], { age: age.text }) : ''}
                {age.stale ? ` ${COPY.proposalStale[lang]}` : ''}
              </span>
            )
          })()}
          <span style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }}>{COPY.proposalNotApplied[lang]}</span>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
            <button
              type="button"
              disabled={disabled || busy === p.id}
              onClick={async () => {
                setBusy(p.id)
                try {
                  // The ordinary rules PATCH — the proposal is the SUGGESTION, this click is the
                  // decision. Dismissed only once the apply succeeded, so a failed PATCH leaves the
                  // card standing rather than silently losing the message.
                  const res = await onApply(connId, p.shareMode, p.sources)
                  if (res.ok) await onDismiss(connId, { proposalId: p.id })
                } finally { setBusy(null) }
              }}
              style={mobileBtn(disabled || busy === p.id, false, isMobile)}
            >
              {COPY.proposalApply[lang]}
            </button>
            <button
              type="button"
              disabled={busy === p.id}
              onClick={async () => {
                setBusy(p.id)
                try { await onDismiss(connId, { proposalId: p.id }) } finally { setBusy(null) }
              }}
              style={mobileBtn(busy === p.id, false, isMobile)}
            >
              {COPY.proposalDismiss[lang]}
            </button>
          </div>
        </div>
      ))}
      {peers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{COPY.peersTitle[lang]}</strong>
          <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{COPY.peersBody[lang]}</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selfFingerprint && (
              <li style={{ fontSize: 10.5, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{COPY.peersSelf[lang]}</span>
                {' — '}
                <code style={{ fontSize: 10.5 }}>{selfFingerprint}</code>
              </li>
            )}
            {peers.map(peer => (
              <li key={peer.machineId} style={{ fontSize: 10.5, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{peerLabel(peer)}</span>
                {' — '}
                <code style={{ fontSize: 10.5 }}>{peer.fingerprint}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
