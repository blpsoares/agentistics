import { useEffect, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import type { ShareSource, TeamConnection } from '@agentistics/core'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY, interpolate } from './copy'
import { mobileBtn } from './ConnectionCardParts'
import type { ShareMode } from './sharePanelState'
import {
  describeSources, proposalAge, proposalPlan, type ProposalView, type KeyWarningView,
} from './proposalNotices'

/**
 * NoticesModal — everything another machine of this account is waiting on a decision about, in one
 * place: restriction proposals, and the alarm raised when a peer's published key changed.
 *
 * PROPOSE, NEVER APPLY, and now also NEVER WIDEN. The card no longer carries the proposal inline;
 * it carries a notices button with a count, and this modal states, concretely, what applying would
 * change ON THIS MACHINE — the rows it would stop sharing, and (in the semantic warning colour)
 * anything the sibling's snapshot would have opened here, which applying will NOT do. The Apply
 * button sends `plan.merged`, the narrowing-only merge, and never the sibling's raw snapshot; this
 * modal, showing that diff, IS the confirmation.
 */
export interface NoticesModalProps {
  open: boolean
  onClose: () => void
  conn: TeamConnection
  proposals: ProposalView[]
  keyWarnings: KeyWarningView[]
  lang: 'pt' | 'en'
  disabled: boolean
  onApply: (id: string, mode: ShareMode, sources: ShareSource[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
  onDismiss: (connId: string, body: { proposalId?: string; keyWarningMachineId?: string }) => Promise<void>
}

export function NoticesModal({
  open, onClose, conn, proposals, keyWarnings, lang, disabled, onApply, onDismiss,
}: NoticesModalProps) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = useState<string | null>(null)
  const now = Date.now()

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, display: 'flex',
        alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', padding: isMobile ? 0 : 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: isMobile ? '100%' : 560, height: isMobile ? '100%' : undefined,
          maxHeight: isMobile ? '100%' : '86vh', overflowY: 'auto',
          background: 'var(--bg-card)', border: isMobile ? 'none' : '1px solid var(--border)',
          borderRadius: isMobile ? 0 : 12, boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '14px 16px', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{COPY.noticesTitle[lang]}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={COPY.cancel[lang]}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: isMobile ? 44 : 30, height: isMobile ? 44 : 30, marginRight: isMobile ? -8 : 0,
              border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {proposals.length === 0 && keyWarnings.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{COPY.noticesEmpty[lang]}</div>
          )}

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
                  try { await onDismiss(conn.id, { keyWarningMachineId: w.machineId }) } finally { setBusy(null) }
                }}
                style={{ ...mobileBtn(busy === w.machineId, false, isMobile), alignSelf: isMobile ? 'stretch' : 'flex-start' }}
              >
                {COPY.keyChangedDismiss[lang]}
              </button>
            </div>
          ))}

          {proposals.map(p => {
            const plan = proposalPlan(conn, { shareMode: p.shareMode, sources: p.sources })
            const age = proposalAge(p.at, now, lang)
            return (
              <div
                key={p.id}
                style={{
                  padding: '12px 13px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}
              >
                <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
                  {interpolate(COPY.proposalTitle[lang], { name: p.fromMachineName })}
                </strong>

                {/* The diff against YOUR rules — the only thing that answers "what happens if I
                    press this". The sibling's own list is secondary and stays below it. */}
                {plan.changesNothing ? (
                  <span style={{ color: 'var(--text-secondary)' }}>{COPY.proposalNothingToApply[lang]}</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {plan.stopsSharing.length > 0 && (
                      <span style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                        {COPY.proposalWouldHide[lang]}{' '}
                        <strong style={{ color: 'var(--accent-red)' }}>{describeSources(plan.stopsSharing, lang)}</strong>
                      </span>
                    )}
                    {plan.partlyRestricts.length > 0 && (
                      <span style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                        {COPY.proposalPartlyRestricts[lang]}{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>{describeSources(plan.partlyRestricts, lang)}</strong>
                      </span>
                    )}
                    {plan.hidesEverythingUnlisted && (
                      <span style={{ color: 'var(--text-secondary)' }}>{COPY.proposalHidesUnlisted[lang]}</span>
                    )}
                  </div>
                )}

                {/* The cross-mode case, unmissable: what applying it VERBATIM would have opened —
                    and the promise that this button will not do it. */}
                {(plan.wouldStartSharing.length > 0 || plan.widensEverythingUnlisted) && (
                  <div
                    role="status"
                    style={{
                      display: 'flex', gap: 7, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 7,
                      color: 'var(--anthropic-orange)',
                      background: 'color-mix(in srgb, var(--anthropic-orange) 12%, transparent)',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                      {plan.wouldStartSharing.length > 0
                        ? interpolate(COPY.proposalWouldWiden[lang], { sources: describeSources(plan.wouldStartSharing, lang) })
                        : COPY.proposalWidensUnlisted[lang]}
                    </span>
                  </div>
                )}

                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                  {p.shareMode === 'allowlist' ? COPY.proposalAllowlist[lang] : COPY.proposalDenylist[lang]}
                  {' '}{describeSources(p.sources, lang)}
                  {age.text ? ` · ${interpolate(COPY.proposalAge[lang], { age: age.text })}` : ''}
                </span>
                {age.stale && (
                  <span style={{ fontSize: 11, color: 'var(--anthropic-orange)' }}>{COPY.proposalStale[lang]}</span>
                )}
                {/* Honesty guard — kept verbatim: nothing has changed here until this is pressed. */}
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{COPY.proposalNotApplied[lang]}</span>

                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
                  <button
                    type="button"
                    disabled={disabled || busy === p.id || plan.changesNothing}
                    onClick={async () => {
                      setBusy(p.id)
                      try {
                        // The ordinary rules PATCH, carrying the NARROWING-ONLY merge — never the
                        // sibling's raw snapshot, which would lift every restriction it does not
                        // itself hold. Dismissed only once the apply succeeded.
                        const res = await onApply(conn.id, plan.merged.shareMode, plan.merged.sources)
                        if (res.ok) await onDismiss(conn.id, { proposalId: p.id })
                      } finally { setBusy(null) }
                    }}
                    style={mobileBtn(disabled || busy === p.id || plan.changesNothing, false, isMobile)}
                  >
                    {COPY.proposalApply[lang]}
                  </button>
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={async () => {
                      setBusy(p.id)
                      try { await onDismiss(conn.id, { proposalId: p.id }) } finally { setBusy(null) }
                    }}
                    style={mobileBtn(busy === p.id, false, isMobile)}
                  >
                    {COPY.proposalDismiss[lang]}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
