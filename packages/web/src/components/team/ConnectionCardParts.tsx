import React from 'react'
import { Link } from 'react-router-dom'
import type { SessionMeta, ModelUsage } from '@agentistics/core'
import type { ArchiveMode } from '../ArchiveConsentModal'
import type { ShareTarget } from '../../lib/shareRepos'
import { COPY, interpolate } from './copy'
import { relTime, resolveRepoPanelMode, type CardState } from './cardState'
import type { ApplyPhase } from './repoPanelState'
import type { ConnectionStatusEntry, ResyncProgress } from './statusTypes'
import { SharedReposPanel } from './SharedReposPanel'

/**
 * ConnectionCardParts.tsx — the small presentational helpers `ConnectionCard.tsx` composes.
 * Split out (Task 10 follow-up) to keep the component itself inside the ~250-line budget; Tasks
 * 11–13 all add to the card and this is where that growth has room to land.
 */

export function IconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24,
      border: '1px solid var(--border)', borderRadius: 6, background: 'transparent',
      color: 'var(--text-secondary)', cursor: 'pointer',
    }}>{children}</button>
  )
}

export function DisconnectButton({ lang, onClick, disabled, isMobile }: { lang: 'pt' | 'en'; onClick: () => void; disabled: boolean; isMobile: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={mobileBtn(disabled, true, isMobile)}>
      {COPY.disconnect[lang]}
    </button>
  )
}

/** `Sync now`/Disconnect go full-width + 44px tall on mobile ONLY — the same rule the brief states
 *  for `addCentral` on `ConnectionsPanel`. Desktop keeps the compact inline button. */
export function mobileBtn(disabled: boolean, danger: boolean, isMobile: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: isMobile ? '0 14px' : '7px 14px', minHeight: isMobile ? 44 : undefined,
    width: isMobile ? '100%' : undefined,
    borderRadius: 7, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
    border: danger ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--border)',
    background: danger ? 'transparent' : 'var(--bg-elevated)',
    color: danger ? '#ef4444' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  }
}

export function StatusLine({ state, status, lang }: { state: CardState; status: ConnectionStatusEntry | undefined; lang: 'pt' | 'en' }) {
  const pt = lang === 'pt'
  let text: React.ReactNode
  switch (state) {
    case 'checking': text = COPY.checking[lang]; break
    case 'connecting': text = COPY.connecting[lang]; break
    case 'noIdentity': text = COPY.noIdentity[lang]; break
    case 'unauthorized': text = <>{COPY.unauthorized[lang]} — {COPY.authHelp[lang]}</>; break
    case 'offline': text = COPY.reconnecting[lang]; break
    case 'resyncing': text = COPY.syncing[lang]; break
    case 'connected': {
      const t = status?.lastSuccessAt != null ? relTime(status.lastSuccessAt, pt) : ''
      text = <>{COPY.connected[lang]} · {interpolate(COPY.lastSync[lang], { t })}{status?.latencyMs != null ? ` · ${status.latencyMs}ms` : ''}</>
      break
    }
  }
  return <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{text}</div>
}

export function ResyncStrip({ resync, lang }: { resync: ResyncProgress; lang: 'pt' | 'en' }) {
  const text = resync.phase === 'forget'
    ? interpolate(COPY.applyingForget[lang], { done: resync.done, total: resync.total })
    : COPY.applyingPush[lang]
  const pct = resync.total > 0 ? Math.round((resync.done / resync.total) * 100) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{text}</div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--anthropic-orange)', transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{COPY.applyingSafeToLeave[lang]}</div>
    </div>
  )
}

/**
 * SLOT — decides WHICH surface occupies the repo-panel area: hidden (nothing can be un-shared
 * until the token works), the two "editing is impossible right now" notices, or the real
 * per-repository denylist editor (Task 11). `editable` covers BOTH `connected` and `offline` —
 * rules are local and must stay changeable while this central is unreachable.
 */
export function RepoPanelSlot({
  connId, deniedRepos, state, status, archiveMode, shareTargets, sessions, modelUsage, otelEnabled,
  lang, onApplyRules, phase, onPhase, editing, onEditingChange,
}: {
  connId: string
  deniedRepos: string[]
  state: CardState
  status: ConnectionStatusEntry | undefined
  archiveMode: ArchiveMode | null
  shareTargets: ShareTarget[]
  sessions: SessionMeta[]
  modelUsage: Record<string, ModelUsage>
  otelEnabled: boolean
  lang: 'pt' | 'en'
  onApplyRules: (connId: string, deniedRepos: string[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
  /** Owned by the CARD, which stays mounted while collapsed — the panel below only reports
   *  transitions into it (Important 2). */
  phase: ApplyPhase
  onPhase: (phase: ApplyPhase) => void
  /** Also owned by the CARD (fix 6, Plan 4 Task 1) — whether the panel's edit view is open, so
   *  Disconnect / Sync now can be hidden for the whole time an edit is in progress. */
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const mode = resolveRepoPanelMode(state, status?.centralTooOld ?? false, archiveMode)
  if (mode === 'hidden') return null // nothing can be removed until the token works
  if (mode === 'centralTooOld') return <Note text={COPY.centralTooOld[lang]} />
  if (mode === 'archiveOff') {
    return (
      <div style={{ padding: '8px 12px', borderRadius: 7, fontSize: 11.5, color: 'var(--text-tertiary)', background: 'var(--bg-secondary)' }}>
        <ArchiveOffNote lang={lang} />
      </div>
    )
  }
  return (
    <SharedReposPanel
      connId={connId}
      deniedRepos={deniedRepos}
      cardState={state}
      status={status}
      shareTargets={shareTargets}
      sessions={sessions}
      modelUsage={modelUsage}
      otelEnabled={otelEnabled}
      lang={lang}
      onApply={onApplyRules}
      phase={phase}
      onPhase={onPhase}
      editing={editing}
      onEditingChange={onEditingChange}
    />
  )
}

export function Note({ text }: { text: string }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 7, fontSize: 11.5, color: 'var(--text-tertiary)', background: 'var(--bg-secondary)' }}>
      {text}
    </div>
  )
}

/**
 * `COPY.archiveOffNote` is one plain sentence with the settings destination named INSIDE it (per
 * copy.ts's "do not soften/shorten/reword" rule), and the brief calls for that destination to be a
 * real `<Link>`. Splitting the approved string on its own already-approved substring embeds the
 * link without inlining any new English/Portuguese text of its own — if the copy ever changes and
 * the substring no longer matches, this falls back to the plain sentence rather than losing text.
 */
export function ArchiveOffNote({ lang }: { lang: 'pt' | 'en' }) {
  const linkText = lang === 'pt' ? 'Configurações → Sessões' : 'Settings → Sessions'
  const full = COPY.archiveOffNote[lang]
  const idx = full.indexOf(linkText)
  if (idx < 0) return <>{full}</>
  return (
    <>
      {full.slice(0, idx)}
      <Link to="/settings/sessions" style={{ color: 'var(--anthropic-orange)' }}>{linkText}</Link>
      {full.slice(idx + linkText.length)}
    </>
  )
}
