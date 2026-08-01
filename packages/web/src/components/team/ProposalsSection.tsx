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

export interface ProposalsSectionProps {
  connId: string
  proposals: ProposalView[]
  keyWarnings: KeyWarningView[]
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

export function ProposalsSection({ connId, proposals, keyWarnings, lang, disabled, onApply, onDismiss }: ProposalsSectionProps) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = useState<string | null>(null)

  if (proposals.length === 0 && keyWarnings.length === 0) return null

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
    </div>
  )
}
