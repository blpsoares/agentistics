import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, EyeOff, Loader2, Check } from 'lucide-react'
import type { SessionMeta, TeamConnection, ModelUsage, ShareSource } from '@agentistics/core'
import type { ArchiveMode } from '../ArchiveConsentModal'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'
import type { ShareMode } from './sharePanelState'
import { hostOf, plural } from '../../lib/shareRepos'
import { StatusDot, ConfirmModal } from '../../pages/settings/primitives'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY, PLURAL_COPY, interpolate } from './copy'
import { ConnectionIdentity, type ProbedIdentity } from './ConnectionIdentity'
import type { ConnectionStatusEntry } from './statusTypes'
import {
  isBrokenEndpoint, resolveCardState, resolveRulePill, showsApplyQueuedBanner, resolveWritesDisabled,
  showsElsewhereWarning, elsewhereLine, DOT,
} from './cardState'
import { resolveCardActionsHidden, type ApplyPhase } from './repoPanelState'
import {
  DisconnectButton, mobileBtn, StatusLine, ResyncStrip, RepoPanelSlot,
} from './ConnectionCardParts'
import { ProposalsSection, type ProposalView, type KeyWarningView } from './ProposalsSection'

export interface ConnectionCardProps {
  conn: TeamConnection
  status: ConnectionStatusEntry | undefined
  archiveMode: ArchiveMode | null
  /** Computed once in ConnectionsPanel from the unfiltered session/project lists — the repository
   *  picker (Task 11) consumes this same array instead of recomputing it per card. */
  shareTargets: ShareTarget[]
  /** The project projection (Plan 4 Task 5), computed once from the same unfiltered lists. */
  projectTargets: ProjectTarget[]
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
  onDisconnect: (id: string) => Promise<void>
  onSyncNow: (id: string) => Promise<void>
  onApplyRules: (id: string, mode: ShareMode, sources: ShareSource[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
  /** Sealed-envelope proposals received from this account's other machines, and the alarm raised
   *  when a peer's published key stopped matching the pinned one. Both default to empty, so a
   *  central too old for the mailbox simply renders nothing. */
  proposals?: ProposalView[]
  keyWarnings?: KeyWarningView[]
  onDismissProposal?: (connId: string, body: { proposalId?: string; keyWarningMachineId?: string }) => Promise<void>
}

export function ConnectionCard({
  conn, status, archiveMode, shareTargets, projectTargets, sessions, modelUsage, otelEnabled, duplicateHost, lang,
  onDisconnect, onSyncNow, onApplyRules,
  proposals = [], keyWarnings = [], onDismissProposal,
}: ConnectionCardProps) {
  const isMobile = useIsMobile()
  const [expanded, setExpanded] = useState(false)
  const [identity, setIdentity] = useState<ProbedIdentity | null>(null)
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
  // Fix 6 (Plan 4 Task 1): whether the repo panel's edit view is open, lifted here for the same
  // reason `applyPhase` is — the panel unmounts on collapse, so the card (which stays mounted)
  // owns it, and hides Disconnect / Sync now for as long as it is true.
  const [repoEditing, setRepoEditing] = useState(false)
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

  // Fix 6 (Plan 4 Task 1): the title used to prefer `identity.org` — a fixed org constant, not
  // machine-specific — over the machine's own name. `identity.machineName` (forwarded from the
  // probe route) IS "the name the central gave the machine", so it now wins over `org`.
  const displayLabel = conn.label
    ?? (duplicateHost ? `${host} · ${identity?.machineName ?? conn.user ?? '—'}` : (identity?.machineName ?? identity?.org ?? host))

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

  // Polarity follows the connection's MODE — see `resolveRulePill`. Same shared-positive
  // discipline the expanded read view already follows.
  const rulePill = resolveRulePill(status)
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
          {/* Fix (save-and-rename): the machine cannot name itself — no pencil, no rename
             control. `displayLabel` is the name the CENTRAL gave this machine
             (`identity.machineName`, from the probe), falling back to a stored `label` (an
             older config, or one the CLI's `--label` flag set) and then the endpoint host. */}
          <span style={{
            display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayLabel}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            <span>{COPY.appearsAs[lang]} <strong style={{ color: 'var(--text-secondary)' }}>{conn.user || '—'}</strong></span>
          </div>
        </div>
        {rulePill && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
            background: rulePill.tone === 'allow'
              ? 'color-mix(in srgb, var(--accent-green) 15%, transparent)'
              : 'color-mix(in srgb, var(--anthropic-orange) 15%, transparent)',
            color: rulePill.tone === 'allow' ? 'var(--accent-green)' : 'var(--anthropic-orange)',
            fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>
            {rulePill.tone === 'allow' ? <Check size={11} /> : <EyeOff size={11} />}
            {interpolate(
              plural(rulePill.tone === 'allow' ? PLURAL_COPY.allowedPill[lang] : PLURAL_COPY.blockedPill[lang], rulePill.count),
              { n: rulePill.count },
            )}
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

          {showsElsewhereWarning(status?.elsewhere) && (
            <div
              role="status"
              style={{
                padding: '10px 12px', borderRadius: 7, fontSize: 11.5, lineHeight: 1.5,
                color: 'var(--anthropic-orange)',
                background: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <strong style={{ fontSize: 12 }}>{COPY.elsewhereTitle[lang]}</strong>
              <span style={{ color: 'var(--text-secondary)' }}>{COPY.elsewhereBody[lang]}</span>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {(status?.elsewhere ?? []).map(e => (
                  // `overflowWrap` and not `nowrap`: a repo key plus two machine names overflows a
                  // 390px card, and the page body must never scroll horizontally.
                  <li key={e.repo} style={{ overflowWrap: 'anywhere' }}>
                    {elsewhereLine(e, COPY.elsewhereNoRepo[lang])}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {onDismissProposal && (
            <ProposalsSection
              connId={conn.id}
              proposals={proposals}
              keyWarnings={keyWarnings}
              lang={lang}
              disabled={disableWrites}
              onApply={onApplyRules}
              onDismiss={onDismissProposal}
            />
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
            sources={conn.sources}
            shareMode={conn.shareMode}
            state={state}
            status={status}
            archiveMode={archiveMode}
            shareTargets={shareTargets}
            projectTargets={projectTargets}
            sessions={sessions}
            modelUsage={modelUsage}
            otelEnabled={otelEnabled}
            lang={lang}
            onApplyRules={onApplyRules}
            phase={applyPhase}
            onPhase={setApplyPhase}
            editing={repoEditing}
            onEditingChange={setRepoEditing}
          />

          {/* Fix 6 (Plan 4 Task 1): hidden — not merely disabled — for the whole time the repo
             panel's edit view is open. Both are unrelated to the edit in progress, and Disconnect
             is destructive: it must not sit next to an in-progress, unsaved rules edit. */}
          {!resolveCardActionsHidden(repoEditing) && (
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
          )}
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
