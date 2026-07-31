import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, EyeOff, Pencil, Loader2, Check, X } from 'lucide-react'
import type { SessionMeta, TeamConnection, ModelUsage } from '@agentistics/core'
import type { ArchiveMode } from '../ArchiveConsentModal'
import type { ShareTarget } from '../../lib/shareRepos'
import { hostOf, plural } from '../../lib/shareRepos'
import { StatusDot, ConfirmModal } from '../../pages/settings/primitives'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY, PLURAL_COPY, interpolate } from './copy'
import { ConnectionIdentity, type ProbedIdentity } from './ConnectionIdentity'
import type { ConnectionStatusEntry } from './statusTypes'
import { isBrokenEndpoint, resolveCardState, showsApplyQueuedBanner, resolveWritesDisabled, DOT } from './cardState'
import type { ApplyPhase } from './repoPanelState'
import {
  IconBtn, DisconnectButton, mobileBtn, StatusLine, ResyncStrip, RepoPanelSlot,
} from './ConnectionCardParts'

export interface ConnectionCardProps {
  conn: TeamConnection
  status: ConnectionStatusEntry | undefined
  archiveMode: ArchiveMode | null
  /** Computed once in ConnectionsPanel from the unfiltered session/project lists — the repository
   *  picker (Task 11) consumes this same array instead of recomputing it per card. */
  shareTargets: ShareTarget[]
  /** Unfiltered — threaded through to the repository picker for its impact estimate and its
   *  "proven prehistory" check. */
  sessions: SessionMeta[]
  modelUsage: Record<string, ModelUsage>
  /** Machine-wide (never per-connection) — whether OTel metrics export is currently configured,
   *  from the top-level `otelExportEnabled` on `GET /api/team/status`. */
  otelEnabled: boolean
  /** True when another connection on this panel resolves to the same host — promotes the user
   *  name into the primary label (`acme:48080 · lucas`), the only thing that tells them apart. */
  duplicateHost: boolean
  lang: 'pt' | 'en'
  onRename: (id: string, label: string) => void
  onDisconnect: (id: string) => Promise<void>
  onSyncNow: (id: string) => Promise<void>
  onApplyRules: (id: string, deniedRepos: string[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
}

export function ConnectionCard({
  conn, status, archiveMode, shareTargets, sessions, modelUsage, otelEnabled, duplicateHost, lang,
  onRename, onDisconnect, onSyncNow, onApplyRules,
}: ConnectionCardProps) {
  const isMobile = useIsMobile()
  const [expanded, setExpanded] = useState(false)
  const [identity, setIdentity] = useState<ProbedIdentity | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [labelDraft, setLabelDraft] = useState(conn.label ?? '')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  // The repository picker's apply phase lives HERE, not in the picker (Important 2): the picker
  // renders inside `{expanded && …}`, so collapsing the card unmounted it and reset the guard to
  // "not busy" — fail-open — in the middle of the very apply it protects. Disconnect and Sync now
  // must stay disabled for the WHOLE apply, not just the PATCH round-trip: the gap between the
  // PATCH returning and the server's resync first becoming visible to this card's poll is exactly
  // when a second write would race the server's own forget/push sequence. The phase-advancing
  // effects below live here for the same reason — the card polls status whether it is expanded or
  // not, so an apply started and then collapsed still resolves.
  const [applyPhase, setApplyPhase] = useState<ApplyPhase>('idle')
  const resyncSeenRef = useRef(false)
  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  // Watches every poll tick while waiting: a live resync always wins, and once one has been SEEN
  // its later clearing is what promotes the banner to 'done' — never the mere absence of one.
  useEffect(() => {
    if (applyPhase !== 'waiting') return
    if (status?.resync != null) { resyncSeenRef.current = true; return }
    if (resyncSeenRef.current) setApplyPhase('done')
  }, [status, applyPhase])

  // A grace window for the case nothing ever needed reconciling (no resync ever appears) — an
  // unreachable central (`pendingRules`) is NOT that case, and must keep showing `queued`, never a
  // false `done`. Runs ONCE per entering 'waiting', independent of the poll cadence.
  useEffect(() => {
    if (applyPhase !== 'waiting') return
    resyncSeenRef.current = false
    const t = setTimeout(() => {
      if (resyncSeenRef.current) return
      if (statusRef.current?.pendingRules) return
      setApplyPhase('done')
    }, 6000)
    return () => clearTimeout(t)
  }, [applyPhase])

  useEffect(() => {
    if (applyPhase !== 'done') return
    const t = setTimeout(() => setApplyPhase('idle'), 6000)
    return () => clearTimeout(t)
  }, [applyPhase])

  const state = resolveCardState(status)
  const brokenEndpoint = isBrokenEndpoint(conn.endpoint)
  const host = hostOf(conn.endpoint)
  const centralLabel = conn.label ?? host

  const displayLabel = conn.label
    ?? (duplicateHost ? `${host} · ${conn.user || '—'}` : (identity?.org ?? host))

  function commitRename() {
    onRename(conn.id, labelDraft.trim())
    setRenaming(false)
  }

  async function handleSyncNow() {
    if (syncing) return
    setSyncing(true)
    try { await onSyncNow(conn.id) } finally { setSyncing(false) }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try { await onDisconnect(conn.id) } finally { setDisconnecting(false); setConfirmOpen(false) }
  }

  // A connection whose endpoint cannot be parsed offers Disconnect only — nothing else here may
  // ever call `new URL()` on it. `hostOf` already guarantees this never throws.
  if (brokenEndpoint) {
    return (
      <div style={{
        border: '1px solid var(--accent-red)', borderRadius: 10, padding: 14,
        display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-card)',
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{centralLabel}</div>
        <div style={{ fontSize: 12, color: 'var(--accent-red)' }}>{COPY.brokenConn[lang]}</div>
        <DisconnectButton lang={lang} onClick={() => setConfirmOpen(true)} disabled={disconnecting} isMobile={isMobile} />
        <ConfirmModal
          open={confirmOpen}
          title={interpolate(COPY.disconnectTitle[lang], { central: centralLabel })}
          message={COPY.disconnectBody[lang]}
          confirmLabel={COPY.disconnectBtn[lang]}
          cancelLabel={COPY.cancel[lang]}
          onConfirm={() => { void handleDisconnect() }}
          onCancel={() => setConfirmOpen(false)}
          requireText={centralLabel}
          requireTextHint={interpolate(COPY.disconnectHint[lang], { central: centralLabel })}
        />
      </div>
    )
  }

  const deniedCount = status?.deniedCount ?? 0
  const disableWrites = resolveWritesDisabled(state, syncing, disconnecting, applyPhase)

  return (
    <div style={{
      border: `1px solid ${state === 'offline' ? 'var(--anthropic-orange)' : 'var(--border)'}`,
      borderRadius: 10, background: 'var(--bg-card)', overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 56,
          padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit', flexWrap: 'wrap',
        }}
      >
        {state === 'resyncing'
          ? <Loader2 size={10} style={{ color: 'var(--anthropic-orange)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          : <StatusDot state={DOT[state]} />}
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          {renaming ? (
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                autoFocus
                value={labelDraft}
                onChange={e => setLabelDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
                style={{
                  padding: '4px 8px', borderRadius: 6, border: '1px solid var(--anthropic-orange)',
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit',
                }}
              />
              <IconBtn onClick={commitRename}><Check size={13} /></IconBtn>
              <IconBtn onClick={() => setRenaming(false)}><X size={13} /></IconBtn>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayLabel}
              </span>
              <span
                role="button"
                aria-label={COPY.rename[lang]}
                onClick={e => { e.stopPropagation(); setLabelDraft(conn.label ?? ''); setRenaming(true) }}
                style={{ display: 'inline-flex', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4 }}
              >
                <Pencil size={12} />
              </span>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            {COPY.appearsAs[lang]} <strong style={{ color: 'var(--text-secondary)' }}>{conn.user || '—'}</strong>
          </div>
        </div>
        {deniedCount > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
            background: 'color-mix(in srgb, var(--anthropic-orange) 15%, transparent)',
            color: 'var(--anthropic-orange)', fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>
            <EyeOff size={11} />
            {interpolate(plural(PLURAL_COPY.blockedPill[lang], deniedCount), { n: deniedCount })}
          </span>
        )}
        {expanded ? <ChevronDown size={20} style={{ flexShrink: 0 }} /> : <ChevronRight size={20} style={{ flexShrink: 0 }} />}
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StatusLine state={state} status={status} lang={lang} />

          {showsApplyQueuedBanner(state, status?.pendingRules) && (
            <div style={{
              padding: '8px 12px', borderRadius: 7, fontSize: 11.5, color: 'var(--anthropic-orange)',
              background: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)',
            }}>
              {COPY.applyQueued[lang]}
            </div>
          )}

          {state === 'resyncing' && status?.resync && <ResyncStrip resync={status.resync} lang={lang} />}

          <ConnectionIdentity
            connId={conn.id}
            endpoint={conn.endpoint}
            expanded={expanded}
            lang={lang}
            onResolved={setIdentity}
          />

          <RepoPanelSlot
            connId={conn.id}
            deniedRepos={conn.deniedRepos}
            state={state}
            status={status}
            archiveMode={archiveMode}
            shareTargets={shareTargets}
            sessions={sessions}
            modelUsage={modelUsage}
            otelEnabled={otelEnabled}
            lang={lang}
            onApplyRules={onApplyRules}
            phase={applyPhase}
            onPhase={setApplyPhase}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
            <button
              type="button"
              onClick={() => { void handleSyncNow() }}
              disabled={disableWrites}
              style={mobileBtn(disableWrites, false, isMobile)}
            >
              {syncing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              {COPY.syncNow[lang]}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={disableWrites}
              style={mobileBtn(disableWrites, true, isMobile)}
            >
              {COPY.disconnect[lang]}
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title={interpolate(COPY.disconnectTitle[lang], { central: centralLabel })}
        message={COPY.disconnectBody[lang]}
        confirmLabel={COPY.disconnectBtn[lang]}
        cancelLabel={COPY.cancel[lang]}
        onConfirm={() => { void handleDisconnect() }}
        onCancel={() => setConfirmOpen(false)}
        requireText={centralLabel}
        requireTextHint={interpolate(COPY.disconnectHint[lang], { central: centralLabel })}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
