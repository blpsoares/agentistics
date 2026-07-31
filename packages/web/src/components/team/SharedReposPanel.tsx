import { useState } from 'react'
import { Loader2, EyeOff } from 'lucide-react'
import type { SessionMeta, ModelUsage } from '@agentistics/core'
import { NO_REPO_KEY, fmtCost } from '@agentistics/core'
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
  buildInitialDraft, canEditRepos, computeApplyImpact, diffDraft, hasProvenPrehistory,
  isDirty, normalizeDenied, resolveApplyBanner, resolveConfirmVariant, resolveReadViewSummary,
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
  /** Machine-wide — whether OTel metrics export is currently configured (mirrors the top-level
   *  `otelExportEnabled` on `GET /api/team/status`, computed from `OTEL_EXPORTER_OTLP_ENDPOINT`). */
  otelEnabled: boolean
  lang: 'pt' | 'en'
  /** The ONE write this panel performs. Resolves to whether the server queued a resync (something
   *  actually changed) so the panel knows whether to wait for `status.resync` at all. Throws (or
   *  resolves false) on failure — the caller decides what "failed" means for its own transport. */
  onApply: (connId: string, deniedRepos: string[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
  /** The apply phase is a CONTROLLED prop, owned by `ConnectionCard` — see `resolveWritesDisabled`
   *  (Important 2). This panel lives inside the card's `{expanded && …}`, so anything it owns dies
   *  when the card is collapsed; the write guard that covers the whole apply (the PATCH round-trip
   *  AND the wait for the server's resync to first become visible on a poll) must outlive that. */
  phase: ApplyPhase
  onPhase: (phase: ApplyPhase) => void
  /** Fix 6 (Plan 4 Task 1): whether this panel's edit view is open, CONTROLLED by `ConnectionCard`
   *  — same reasoning as `phase`/`onPhase` above. The card stays mounted while collapsed and needs
   *  this to hide its Disconnect / Sync now actions for the whole time an edit is in progress. */
  editing: boolean
  onEditingChange: (editing: boolean) => void
}

export function SharedReposPanel({
  connId, deniedRepos, cardState, status, shareTargets, sessions, modelUsage, otelEnabled, lang,
  onApply, phase, onPhase, editing, onEditingChange,
}: SharedReposPanelProps) {
  const isMobile = useIsMobile()
  const noRepoLabel = COPY.noRepoTitle[lang]
  const targets = synthesizeMissingDenied(shareTargets, deniedRepos, noRepoLabel)
  const storedDenied = normalizeDenied(deniedRepos)

  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [search, setSearch] = useState('')
  const [showStale, setShowStale] = useState(false)
  const [showAllMobile, setShowAllMobile] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  function startEdit() {
    setDraft(buildInitialDraft(targets, deniedRepos))
    setSearch('')
    onEditingChange(true)
  }
  function cancelEdit() {
    setDraft(null)
    onEditingChange(false)
  }

  const draftDenied = draft ?? storedDenied
  const diff = diffDraft(draftDenied, storedDenied)
  const rate = blendedCostPerToken(modelUsage)
  const impact = computeApplyImpact(sessions, targets, diff, rate)
  const hasProven = hasProvenPrehistory(sessions, diff, status?.boundary ?? null)
  const variant = resolveConfirmVariant(hasProven, status?.boundary ?? null)
  const stats = statsCopyVars(status?.boundary ?? null, status?.prehistorySessions ?? null, lang)

  async function confirmApply() {
    setConfirmOpen(false)
    const outcome = await onApply(connId, [...draftDenied]).catch(() => ({ ok: false as const }))
    if (!outcome.ok) { onPhase('error'); return }
    onEditingChange(false)
    setDraft(null)
    onPhase(outcome.queued ? 'waiting' : 'done')
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
        canEdit={canEditRepos(cardState, phase)}
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
        <ReadView targets={targets} storedDenied={storedDenied} status={status} lang={lang} otelEnabled={otelEnabled} />
      </Section>

      {banner && <ApplyBanner banner={banner} status={status} lang={lang} />}

      <ConfirmModal
        open={confirmOpen}
        title={COPY.applyConfirmTitle[lang]}
        message={buildConfirmMessage(variant, stats, impact, lang)}
        confirmLabel={COPY.applyConfirmBtn[lang]}
        cancelLabel={COPY.cancel[lang]}
        onConfirm={() => { onPhase('submitting'); void confirmApply() }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

/**
 * The confirm message MUST state the impact — "the only number the user actually cares about"
 * (the brief) — because the edit view's own `applyImpact` line sits behind the modal's blur the
 * moment it opens; a user confirming without it would be committing a hard-to-reverse action
 * (Important 1 review fix) blind to what it removes. `ConfirmModal.message` is a plain string
 * (not JSX), so every applicable sentence is joined into one paragraph.
 */
export function buildConfirmMessage(
  variant: 'generic' | 'proven',
  stats: { boundary: string; n: number } | null,
  impact: { sessions: number; costUSD: number },
  lang: 'pt' | 'en',
): string {
  const parts = [COPY.applyConfirmBody[lang]]
  if (stats) {
    parts.push(interpolate(COPY.applyConfirmStats[lang], { boundary: stats.boundary, n: stats.n }))
    if (variant === 'proven') parts.push(interpolate(COPY.applyConfirmStatsProven[lang], { boundary: stats.boundary }))
  }
  if (impact.sessions > 0) {
    parts.push(interpolate(COPY.applyImpact[lang], { sessions: impact.sessions, cost: fmtCost(impact.costUSD) }))
  }
  return parts.join(' ')
}

/**
 * Fix 1 (Plan 4 Task 1): the read view used to put the HIDDEN chips directly under
 * `COPY.sharedRepos` — two polarities stacked in one box ("Shared repositories" heading, an amber
 * chip block of the ones that are NOT shared, right underneath it). The hidden block now carries
 * its own explicit label with a count (`hiddenBlockTitle`), and the shared count is separate plain
 * text below it — never inside the same visual block.
 */
function ReadView({ targets, storedDenied, status, lang, otelEnabled }: {
  targets: ShareTarget[]
  storedDenied: Set<string>
  status: ConnectionStatusEntry | undefined
  lang: 'pt' | 'en'
  otelEnabled: boolean
}) {
  const stats = statsCopyVars(status?.boundary ?? null, status?.prehistorySessions ?? null, lang)
  const summary = resolveReadViewSummary(targets, storedDenied)
  const chips = [...storedDenied].map(key => {
    const t = targets.find(x => x.key === key)
    const label = key === NO_REPO_KEY ? COPY.noRepoTitle[lang] : (t ? t.name : key)
    // The "no repository" chip's tooltip states what it actually covers (fix 4) instead of just
    // repeating its own label — a hover on the chip is the only place this fact reaches the read
    // view, since the fuller explanation otherwise lives only in the edit view's row.
    return { key, label, title: key === NO_REPO_KEY ? COPY.noRepoSub[lang] : key }
  }).sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--anthropic-orange)', letterSpacing: '0.02em' }}>
            {interpolate(COPY.hiddenBlockTitle[lang], { n: summary.hiddenCount })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {chips.map(c => (
              <span key={c.key} title={c.title} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', padding: '2px 8px', borderRadius: 999,
                background: 'color-mix(in srgb, var(--anthropic-orange) 15%, transparent)',
                color: 'var(--anthropic-orange)', fontSize: 11, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}><EyeOff size={10} style={{ flexShrink: 0 }} />{c.label}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
        {storedDenied.size === 0
          ? COPY.sharingAll[lang]
          : interpolate(plural(PLURAL_COPY.nShared[lang], summary.sharedCount), { n: summary.sharedCount, total: summary.totalLive })}
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
  if (banner === 'progress') {
    // No resync visible yet means the first post-apply poll has not landed — a neutral "applying"
    // sentence, never the green success one (Important 1).
    const text = !status?.resync
      ? COPY.applyingWait[lang]
      : status.resync.phase === 'forget'
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
    return <div style={{ fontSize: 11.5, color: 'var(--accent-green)' }}>{COPY.applyOk[lang]}</div>
  }
  if (banner === 'error') {
    return <div style={{ fontSize: 11.5, color: 'var(--accent-red)' }}>{COPY.applyErr[lang]}</div>
  }
  return <div style={{ fontSize: 11.5, color: 'var(--anthropic-orange)' }}>{COPY.applyQueued[lang]}</div>
}

