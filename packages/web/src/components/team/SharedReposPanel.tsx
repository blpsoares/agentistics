import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { SessionMeta, ModelUsage } from '@agentistics/core'
import { NO_REPO_KEY } from '@agentistics/core'
import type { ShareTarget } from '../../lib/shareRepos'
import { plural } from '../../lib/shareRepos'
import { blendedCostPerToken } from '../../hooks/useData'
import { Section, ConfirmModal } from '../../pages/settings/primitives'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY, PLURAL_COPY, interpolate } from './copy'
import type { CardState } from './cardState'
import type { ConnectionStatusEntry } from './statusTypes'
import { EditView } from './SharedReposEditView'
import {
  buildInitialDraft, computeApplyImpact, diffDraft, hasProvenPrehistory,
  isDirty, normalizeDenied, resolveApplyBanner, resolveConfirmVariant,
  shareAllDraft, blockAllDraft, statsCopyVars, synthesizeMissingDenied, toggleTarget,
  type ApplyPhase,
} from './repoPanelState'

/**
 * SharedReposPanel.tsx — the per-central repository denylist editor (Task 11, design doc §9.8).
 * A layout over `repoPanelState.ts`'s pure decisions: this file owns rendering, local edit-mode
 * state and the ONE `PATCH /api/team/connections/:id` round-trip; every substantive decision
 * (grouping, search, the draft diff, the impact numbers, the confirm variant, row locking) lives
 * in `repoPanelState.ts` and is unit-tested there.
 */

export interface SharedReposPanelProps {
  connId: string
  deniedRepos: string[]
  cardState: CardState
  status: ConnectionStatusEntry | undefined
  shareTargets: ShareTarget[]
  /** Unfiltered — needed both for the impact estimate's token sums and for the confirm modal's
   *  "proven prehistory" check. */
  sessions: SessionMeta[]
  modelUsage: Record<string, ModelUsage>
  /** Absent/false when this machine cannot tell whether OTel export is currently active — there is
   *  no signal for it today, so `otelWarn` simply never renders rather than guessing. */
  otelEnabled?: boolean
  lang: 'pt' | 'en'
  /** The ONE write this panel performs. Resolves to whether the server queued a resync (something
   *  actually changed) so the panel knows whether to wait for `status.resync` at all. Throws (or
   *  resolves false) on failure — the caller decides what "failed" means for its own transport. */
  onApply: (connId: string, deniedRepos: string[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
}

export function SharedReposPanel({
  connId, deniedRepos, cardState, status, shareTargets, sessions, modelUsage, otelEnabled, lang, onApply,
}: SharedReposPanelProps) {
  const isMobile = useIsMobile()
  const noRepoLabel = COPY.noRepoTitle[lang]
  const targets = synthesizeMissingDenied(shareTargets, deniedRepos, noRepoLabel)
  const storedDenied = normalizeDenied(deniedRepos)
  const liveTargets = targets.filter(t => t.sessions > 0)
  const sharedCount = liveTargets.filter(t => !storedDenied.has(t.key)).length

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [search, setSearch] = useState('')
  const [showStale, setShowStale] = useState(false)
  const [showAllMobile, setShowAllMobile] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [phase, setPhase] = useState<ApplyPhase>('idle')

  const resyncSeenRef = useRef(false)
  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  // Watches every poll tick while waiting: a live resync always wins, and once one has been SEEN
  // its later clearing is what promotes the banner to 'done' — never the mere absence of one.
  useEffect(() => {
    if (phase !== 'waiting') return
    if (status?.resync != null) { resyncSeenRef.current = true; return }
    if (resyncSeenRef.current) setPhase('done')
  }, [status, phase])

  // A grace window for the case nothing ever needed reconciling (no resync ever appears) — an
  // unreachable central (`pendingRules`) is NOT that case, and must keep showing `queued`, never a
  // false `done`. Runs ONCE per entering 'waiting', independent of the poll cadence.
  useEffect(() => {
    if (phase !== 'waiting') return
    resyncSeenRef.current = false
    const t = setTimeout(() => {
      if (resyncSeenRef.current) return
      if (statusRef.current?.pendingRules) return
      setPhase('done')
    }, 6000)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setPhase('idle'), 6000)
    return () => clearTimeout(t)
  }, [phase])

  function startEdit() {
    setDraft(buildInitialDraft(targets, deniedRepos))
    setSearch('')
    setEditing(true)
  }
  function cancelEdit() {
    setDraft(null)
    setEditing(false)
  }

  const draftDenied = draft ?? storedDenied
  const diff = diffDraft(draftDenied, storedDenied)
  const rate = blendedCostPerToken(modelUsage)
  const impact = computeApplyImpact(sessions, targets, diff, rate)
  const hasProven = hasProvenPrehistory(sessions, diff, status?.boundary ?? null)
  const variant = resolveConfirmVariant(hasProven, status?.boundary ?? null)
  const stats = statsCopyVars(status?.boundary ?? null, status?.prehistorySessions ?? null)

  async function confirmApply() {
    setConfirmOpen(false)
    const outcome = await onApply(connId, [...draftDenied]).catch(() => ({ ok: false as const }))
    if (!outcome.ok) { setPhase('error'); return }
    setEditing(false)
    setDraft(null)
    setPhase(outcome.queued ? 'waiting' : 'done')
  }

  const banner = resolveApplyBanner(phase, status)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Section
        title={COPY.sharedRepos[lang]}
        editing={editing}
        onEdit={startEdit}
        onCancel={cancelEdit}
        onSave={() => { if (isDirty(diff)) setConfirmOpen(true) }}
        canEdit={cardState !== 'resyncing' && phase !== 'submitting'}
        labels={{ edit: COPY.editRules[lang], save: COPY.saveRules[lang], cancel: COPY.cancel[lang] }}
        editChildren={
          <EditView
            targets={targets}
            draftDenied={draftDenied}
            diff={diff}
            search={search}
            onSearch={setSearch}
            showStale={showStale}
            onToggleStale={() => setShowStale(v => !v)}
            showAllMobile={showAllMobile}
            onShowAllMobile={() => setShowAllMobile(true)}
            isMobile={isMobile}
            lang={lang}
            impactSessions={impact.sessions}
            impactCost={impact.costUSD}
            onToggleRow={(target, nextShared) => setDraft(toggleTarget(draftDenied, target, nextShared))}
            onShareAll={() => setDraft(shareAllDraft(targets))}
            onBlockAll={() => setDraft(blockAllDraft(targets))}
          />
        }
      >
        <ReadView targets={targets} storedDenied={storedDenied} sharedCount={sharedCount} total={liveTargets.length}
          status={status} lang={lang} otelEnabled={otelEnabled} />
      </Section>

      {banner && <ApplyBanner banner={banner} status={status} lang={lang} />}

      <ConfirmModal
        open={confirmOpen}
        title={COPY.applyConfirmTitle[lang]}
        message={buildConfirmMessage(variant, stats, lang)}
        confirmLabel={COPY.applyConfirmBtn[lang]}
        cancelLabel={COPY.cancel[lang]}
        onConfirm={() => { setPhase('submitting'); void confirmApply() }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

function buildConfirmMessage(variant: 'generic' | 'proven', stats: { boundary: string; n: number } | null, lang: 'pt' | 'en'): string {
  const parts = [COPY.applyConfirmBody[lang]]
  if (stats) {
    parts.push(interpolate(COPY.applyConfirmStats[lang], { boundary: stats.boundary, n: stats.n }))
    if (variant === 'proven') parts.push(interpolate(COPY.applyConfirmStatsProven[lang], { boundary: stats.boundary }))
  }
  return parts.join(' ')
}

function ReadView({ targets, storedDenied, sharedCount, total, status, lang, otelEnabled }: {
  targets: ShareTarget[]
  storedDenied: Set<string>
  sharedCount: number
  total: number
  status: ConnectionStatusEntry | undefined
  lang: 'pt' | 'en'
  otelEnabled?: boolean
}) {
  const stats = statsCopyVars(status?.boundary ?? null, status?.prehistorySessions ?? null)
  const chips = [...storedDenied].map(key => {
    const t = targets.find(x => x.key === key)
    const label = key === NO_REPO_KEY ? COPY.noRepoTitle[lang] : (t ? t.name : key)
    return { key, label, title: key === NO_REPO_KEY ? label : key }
  }).sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(c => (
            <span key={c.key} title={c.title} style={{
              display: 'inline-block', maxWidth: '100%', padding: '2px 8px', borderRadius: 999,
              background: 'color-mix(in srgb, var(--anthropic-orange) 15%, transparent)',
              color: 'var(--anthropic-orange)', fontSize: 11, fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{c.label}</span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
        {storedDenied.size === 0
          ? COPY.sharingAll[lang]
          : interpolate(plural(PLURAL_COPY.nShared[lang], sharedCount), { n: sharedCount, total })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{COPY.newRepoNote[lang]}</div>
      {storedDenied.size > 0 && stats && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {interpolate(COPY.statsNote[lang], { boundary: stats.boundary, n: stats.n })}
        </div>
      )}
      {storedDenied.size > 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{COPY.ciNote[lang]}</div>}
      {storedDenied.size > 0 && otelEnabled && (
        <div style={{ fontSize: 11, color: 'var(--anthropic-orange)' }}>{COPY.otelWarn[lang]}</div>
      )}
    </div>
  )
}

function ApplyBanner({ banner, status, lang }: { banner: 'progress' | 'done' | 'error' | 'queued'; status: ConnectionStatusEntry | undefined; lang: 'pt' | 'en' }) {
  if (banner === 'progress' && status?.resync) {
    const text = status.resync.phase === 'forget'
      ? interpolate(COPY.applyingForget[lang], { done: status.resync.done, total: status.resync.total })
      : COPY.applyingPush[lang]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
        <span><Loader2 size={11} style={{ verticalAlign: '-1px', animation: 'spin 1s linear infinite', marginRight: 4 }} />{text}</span>
        <span>{COPY.applyingSafeToLeave[lang]}</span>
      </div>
    )
  }
  if (banner === 'done') {
    return <div style={{ fontSize: 11.5, color: 'var(--accent-green)' }}>{plural(PLURAL_COPY.applyOk[lang], 1)}</div>
  }
  if (banner === 'error') {
    return <div style={{ fontSize: 11.5, color: 'var(--accent-red)' }}>{COPY.applyErr[lang]}</div>
  }
  return <div style={{ fontSize: 11.5, color: 'var(--anthropic-orange)' }}>{COPY.applyQueued[lang]}</div>
}

