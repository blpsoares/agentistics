import { useState } from 'react'
import { Loader2, EyeOff, Check } from 'lucide-react'
import type { SessionMeta, ModelUsage, ShareSource } from '@agentistics/core'
import { NO_REPO_KEY, fmtCost } from '@agentistics/core'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'
import { plural } from '../../lib/shareRepos'
import { blendedCostPerToken } from '../../hooks/useData'
import { Section, ConfirmModal } from '../../pages/settings/primitives'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY, PLURAL_COPY, interpolate } from './copy'
import type { CardState } from './cardState'
import type { ConnectionStatusEntry } from './statusTypes'
import { EditView, ProjectEditView, ModeSelector, PickerTabs } from './SharedReposEditView'
import {
  buildInitialDraft, canEditRepos, computeApplyImpact, diffDraft, hasProvenPrehistory,
  isDirty, normalizeDenied, resolveApplyBanner, resolveConfirmVariant,
  shareAllDraft, blockAllDraft, statsCopyVars, synthesizeMissingDenied, toggleTarget,
  type ApplyPhase,
} from './repoPanelState'
import {
  resolveInitialTab, sourcesToRepoKeys, sourcesToProjectPaths, buildSourcesFromDraft,
  computeSharedSummary, isEmptyAllowlist, modeChanged, resolveModeConfirmVariant,
  toggleProjectTarget, shareAllProjectsDraft, blockAllProjectsDraft,
  type PickerTab, type ShareMode, type ModeConfirmVariant,
} from './sharePanelState'

/**
 * SharedReposPanel.tsx — the per-central sharing-rules editor (Task 11, extended by Plan 4 Tasks
 * 6–7 into the two-tab Projects/Repositories picker plus the denylist/allowlist mode selector).
 * A layout over `repoPanelState.ts` / `sharePanelState.ts`'s pure decisions: this file owns
 * rendering, local edit-mode state and the ONE `PATCH /api/team/connections/:id` round-trip;
 * every substantive decision (grouping, search, the draft diff, the impact numbers, the confirm
 * variant, row/project locking, the shared summary, the mode switch) lives in those two modules
 * and is unit-tested there.
 */

export interface SharedReposPanelProps {
  connId: string
  /** The connection's stored typed rules — `sources`/`shareMode` REPLACE the legacy `deniedRepos`
   *  this panel used to read directly (Plan 4). `shareMode` absent reads as `'denylist'`, same as
   *  every other reader in this codebase. */
  sources: ShareSource[] | undefined
  shareMode: ShareMode | undefined
  cardState: CardState
  status: ConnectionStatusEntry | undefined
  shareTargets: ShareTarget[]
  /** The project projection (Task 5), fed by the SAME unfiltered project list the repo tab's
   *  `shareTargets` comes from — see `ConnectionsPanel`'s shared memo. */
  projectTargets: ProjectTarget[]
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
  onApply: (connId: string, mode: ShareMode, sources: ShareSource[]) => Promise<{ ok: true; queued: boolean } | { ok: false }>
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
  connId, sources, shareMode, cardState, status, shareTargets, projectTargets, sessions, modelUsage,
  otelEnabled, lang, onApply, phase, onPhase, editing, onEditingChange,
}: SharedReposPanelProps) {
  const isMobile = useIsMobile()
  const noRepoLabel = COPY.noRepoTitle[lang]

  const storedMode: ShareMode = shareMode === 'allowlist' ? 'allowlist' : 'denylist'
  const storedRepoKeysArr = sourcesToRepoKeys(sources)
  const storedProjectPathsArr = sourcesToProjectPaths(sources)
  const targets = synthesizeMissingDenied(shareTargets, storedRepoKeysArr, noRepoLabel)
  const storedRepoKeys = normalizeDenied(storedRepoKeysArr)
  const storedProjectPaths = new Set(storedProjectPathsArr)

  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [projectDraft, setProjectDraft] = useState<Set<string> | null>(null)
  const [modeDraft, setModeDraft] = useState<ShareMode | null>(null)
  const [tab, setTab] = useState<PickerTab>(resolveInitialTab())
  const [search, setSearch] = useState('')
  const [showStale, setShowStale] = useState(false)
  const [showAllMobile, setShowAllMobile] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showEmptyAllowlistWarning, setShowEmptyAllowlistWarning] = useState(false)

  function startEdit() {
    setDraft(buildInitialDraft(targets, storedRepoKeysArr))
    setProjectDraft(new Set(storedProjectPathsArr))
    setModeDraft(storedMode)
    setSearch('')
    setShowEmptyAllowlistWarning(false)
    onEditingChange(true)
  }
  function cancelEdit() {
    setDraft(null)
    setProjectDraft(null)
    setModeDraft(null)
    setShowEmptyAllowlistWarning(false)
    onEditingChange(false)
  }

  const draftDenied = draft ?? storedRepoKeys
  const projectDraftDenied = projectDraft ?? storedProjectPaths
  const effectiveMode = modeDraft ?? storedMode

  const diff = diffDraft(draftDenied, storedRepoKeys)
  const projectDiff = diffDraft(projectDraftDenied, storedProjectPaths)
  const modeHasChanged = modeChanged(storedMode, effectiveMode)
  const dirty = isDirty(diff) || isDirty(projectDiff) || modeHasChanged

  const rate = blendedCostPerToken(modelUsage)
  // Repo-dimension only — a project-only rule (no matching repo rule) is not reflected in this
  // estimate. Documented simplification: the number is already presented with a leading "~".
  const impact = computeApplyImpact(sessions, targets, diff, rate)
  const hasProven = hasProvenPrehistory(sessions, diff, status?.boundary ?? null)
  const variant = resolveConfirmVariant(hasProven, status?.boundary ?? null)
  const stats = statsCopyVars(status?.boundary ?? null, status?.prehistorySessions ?? null, lang)
  const modeVariant = resolveModeConfirmVariant(storedMode, effectiveMode)

  async function confirmApply() {
    setConfirmOpen(false)
    const newSources = buildSourcesFromDraft(draftDenied, projectDraftDenied)
    const outcome = await onApply(connId, effectiveMode, newSources).catch(() => ({ ok: false as const }))
    if (!outcome.ok) { onPhase('error'); return }
    onEditingChange(false)
    setDraft(null)
    setProjectDraft(null)
    setModeDraft(null)
    onPhase(outcome.queued ? 'waiting' : 'done')
  }

  function attemptSave() {
    if (isEmptyAllowlist(effectiveMode, draftDenied, projectDraftDenied)) {
      setShowEmptyAllowlistWarning(true)
      return
    }
    setShowEmptyAllowlistWarning(false)
    if (dirty) setConfirmOpen(true)
  }

  const banner = resolveApplyBanner(phase, status)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Section
        title={COPY.sharedRepos[lang]}
        editing={editing}
        onEdit={startEdit}
        onCancel={cancelEdit}
        onSave={attemptSave}
        canEdit={canEditRepos(cardState, phase)}
        labels={{ edit: COPY.editRules[lang], save: COPY.saveRules[lang], cancel: COPY.cancel[lang] }}
        editChildren={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ModeSelector mode={effectiveMode} onChange={setModeDraft} lang={lang} isMobile={isMobile} />
            <PickerTabs tab={tab} onChange={setTab} lang={lang} isMobile={isMobile} />
            {tab === 'projects' ? (
              <ProjectEditView
                targets={projectTargets}
                draftDenied={projectDraftDenied}
                draftRepoKeys={draftDenied}
                diff={projectDiff}
                search={search}
                onSearch={setSearch}
                showStale={showStale}
                onToggleStale={() => setShowStale(v => !v)}
                showAllMobile={showAllMobile}
                onShowAllMobile={() => setShowAllMobile(true)}
                isMobile={isMobile}
                lang={lang}
                onToggleRow={(target, nextShared) => {
                  const locked = target.repoKey !== '' && draftDenied.has(target.repoKey)
                  setProjectDraft(toggleProjectTarget(projectDraftDenied, target, nextShared, locked))
                }}
                onShareAll={() => setProjectDraft(shareAllProjectsDraft(projectTargets))}
                onBlockAll={() => setProjectDraft(blockAllProjectsDraft(projectTargets))}
              />
            ) : (
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
            )}
            {showEmptyAllowlistWarning && (
              <div style={{
                padding: '8px 12px', borderRadius: 7, fontSize: 11.5, color: 'var(--anthropic-orange)',
                background: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)',
              }}>
                {COPY.emptyAllowlistWarning[lang]}
              </div>
            )}
          </div>
        }
      >
        <ReadView
          targets={targets}
          projectTargets={projectTargets}
          storedDenied={storedRepoKeys}
          storedProjectPaths={storedProjectPaths}
          mode={storedMode}
          sessions={sessions}
          status={status}
          lang={lang}
          otelEnabled={otelEnabled}
        />
      </Section>

      {banner && <ApplyBanner banner={banner} status={status} lang={lang} />}

      <ConfirmModal
        open={confirmOpen}
        title={COPY.applyConfirmTitle[lang]}
        message={buildConfirmMessage(variant, stats, impact, modeVariant, lang)}
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
 *
 * Plan 4 Task 7: a mode switch gets its OWN sentence, stating the consequence in the DIRECTION
 * being chosen — appended last, since it is the biggest single change this confirm can ever
 * describe.
 */
export function buildConfirmMessage(
  variant: 'generic' | 'proven',
  stats: { boundary: string; n: number } | null,
  impact: { sessions: number; costUSD: number },
  modeVariant: ModeConfirmVariant,
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
  if (modeVariant === 'toAllowlist') parts.push(COPY.modeConfirmToAllowlist[lang])
  if (modeVariant === 'toDenylist') parts.push(COPY.modeConfirmToDenylist[lang])
  return parts.join(' ')
}

/**
 * Fix 1 (Plan 4 Task 1): the read view used to put the HIDDEN chips directly under
 * `COPY.sharedRepos` — two polarities stacked in one box. The hidden block carries its own
 * explicit label with a count (`hiddenBlockTitle`), and the shared count is separate plain text
 * below it — never inside the same visual block.
 *
 * Plan 4 Task 6/7: the summary line now comes from `computeSharedSummary` (session-level, both
 * dimensions, both modes) so it is the exact number both tabs agree on. In allowlist mode the
 * chips invert to what IS listed — shared-positive, never a "hidden" chip for an allowlist, which
 * would read backwards (everything not listed is what's hidden, and that set is usually huge).
 */
function ReadView({ targets, projectTargets, storedDenied, storedProjectPaths, mode, sessions, status, lang, otelEnabled }: {
  targets: ShareTarget[]
  projectTargets: ProjectTarget[]
  storedDenied: Set<string>
  storedProjectPaths: Set<string>
  mode: ShareMode
  sessions: SessionMeta[]
  status: ConnectionStatusEntry | undefined
  lang: 'pt' | 'en'
  otelEnabled: boolean
}) {
  const stats = statsCopyVars(status?.boundary ?? null, status?.prehistorySessions ?? null, lang)
  const summary = computeSharedSummary(sessions, projectTargets, mode, storedDenied, storedProjectPaths)
  const hasAnyRule = storedDenied.size > 0 || storedProjectPaths.size > 0

  const repoChips = [...storedDenied].map(key => {
    const t = targets.find(x => x.key === key)
    const label = key === NO_REPO_KEY ? COPY.noRepoTitle[lang] : (t ? t.name : key)
    return { key, label, title: key === NO_REPO_KEY ? COPY.noRepoSub[lang] : key }
  })
  const projectChips = [...storedProjectPaths].map(path => {
    const t = projectTargets.find(x => x.key === path)
    return { key: path, label: t ? t.name : path, title: path }
  })
  const chips = [...repoChips, ...projectChips].sort((a, b) => a.label.localeCompare(b.label))

  if (mode === 'allowlist') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {chips.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-green)', letterSpacing: '0.02em' }}>
              {interpolate(COPY.allowedBlockTitle[lang], { n: chips.length })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chips.map(c => (
                <span key={c.key} title={c.title} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', padding: '2px 8px', borderRadius: 999,
                  background: 'color-mix(in srgb, var(--accent-green) 15%, transparent)',
                  color: 'var(--accent-green)', fontSize: 11, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}><Check size={10} style={{ flexShrink: 0 }} />{c.label}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
          {interpolate(plural(PLURAL_COPY.nShared[lang], summary.sharedCount), { n: summary.sharedCount, total: summary.totalLive })}
        </div>
        {chips.length === 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--anthropic-orange)' }}>{COPY.emptyAllowlistWarning[lang]}</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--anthropic-orange)', letterSpacing: '0.02em' }}>
            {interpolate(COPY.hiddenBlockTitle[lang], { n: chips.length })}
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
        {!hasAnyRule
          ? COPY.sharingAll[lang]
          : interpolate(plural(PLURAL_COPY.nShared[lang], summary.sharedCount), { n: summary.sharedCount, total: summary.totalLive })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{COPY.newRepoNote[lang]}</div>
      {hasAnyRule && stats && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {interpolate(COPY.statsNote[lang], { boundary: stats.boundary, n: stats.n })}
        </div>
      )}
      {hasAnyRule && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{COPY.ciNote[lang]}</div>}
      {hasAnyRule && otelEnabled && (
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
