import type { SiblingRuleFact } from '@agentistics/core'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'
import { COPY, interpolate } from './copy'
import {
  siblingWarningsFor, withholdMap, hasSiblingWarnings, repoBucket, projectBucket,
} from './siblingWarnings'
import type { diffDraft } from './repoPanelState'
import { EditView, ModeSelector, PickerTabs, ProjectEditView } from './SharedReposEditView'
import type { PickerTab, ShareMode } from './sharePanelState'

/**
 * SharingRulesPicker.tsx — the ONE body shared by `SharedReposPanel`'s edit view and
 * `AddCentralDrawer`'s step 2. Both surfaces used to re-assemble the mode selector, the tab bar,
 * the two edit views and the empty-allowlist warning themselves, and drifted: the wizard passed no
 * impact numbers and rendered its own (differently-styled) warning. This component is the single
 * place that layout lives now; everything that genuinely differs between the two callers — the
 * wizard's step title/intro, the panel's `Section` chrome, and whether there is an impact estimate
 * at all — stays with the caller.
 *
 * `impactSessions`/`impactCost` are omitted (left at their default of 0) by a caller with nothing
 * to estimate against yet (the wizard has no connection until step 2 is submitted) — `EditView`
 * already renders no impact line at all when `impactSessions` is 0, so passing 0/undefined here
 * reads as "no estimate", never a printed "0 sessions".
 */
export interface SharingRulesPickerProps {
  mode: ShareMode
  onModeChange: (mode: ShareMode) => void
  tab: PickerTab
  onTabChange: (tab: PickerTab) => void
  lang: 'pt' | 'en'
  isMobile: boolean

  targets: ShareTarget[]
  projectTargets: ProjectTarget[]
  draftDenied: Set<string>
  projectDraftDenied: Set<string>
  diff: ReturnType<typeof diffDraft>
  projectDiff: ReturnType<typeof diffDraft>
  partialRepoKeys: ReadonlySet<string>

  search: string
  onSearch: (v: string) => void
  showStale: boolean
  onToggleStale: () => void
  showAllMobile: boolean
  onShowAllMobile: () => void

  /** Absent (or 0) means "no impact to state" — see the file doc comment above. */
  impactSessions?: number
  impactCost?: number

  showEmptyAllowlistWarning: boolean

  /**
   * What each sibling machine of this account last announced about its OWN sharing rules — the
   * reverse warning's only evidence. Optional: a machine that has never received a sealed envelope
   * (or one talking to an older server) has none, and that reads as "nothing announced".
   */
  siblingRules?: SiblingRuleFact[]

  onToggleRow: (target: ShareTarget, nextShared: boolean) => void
  onShareAll: () => void
  onBlockAll: () => void
  onToggleProjectRow: (target: ProjectTarget, nextShared: boolean) => void
  onShareAllProjects: () => void
  onBlockAllProjects: () => void
}

export function SharingRulesPicker({
  mode, onModeChange, tab, onTabChange, lang, isMobile,
  targets, projectTargets, draftDenied, projectDraftDenied, diff, projectDiff, partialRepoKeys,
  search, onSearch, showStale, onToggleStale, showAllMobile, onShowAllMobile,
  impactSessions, impactCost, showEmptyAllowlistWarning, siblingRules,
  onToggleRow, onShareAll, onBlockAll, onToggleProjectRow, onShareAllProjects, onBlockAllProjects,
}: SharingRulesPickerProps) {
  // The draft's `removed` set is exactly "was switched off, is switched on now" — i.e. the edits
  // whose EFFECT is that something starts being shared. That, and not the whole row list, is what
  // the summary block is about; the per-row badges below cover the before-you-decide half.
  const projectWarnings = siblingWarningsFor(siblingRules, projectTargets, projectBucket, new Set(projectDiff.removed))
  const repoWarnings = siblingWarningsFor(siblingRules, targets, repoBucket, new Set(diff.removed))
  const onProjects = tab === 'projects'
  const warnings = onProjects ? projectWarnings : repoWarnings
  const repoWithheldBy = withholdMap(siblingRules, targets, repoBucket)
  const projectWithheldBy = withholdMap(siblingRules, projectTargets, projectBucket)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ModeSelector mode={mode} onChange={onModeChange} lang={lang} isMobile={isMobile} />
      <PickerTabs tab={tab} onChange={onTabChange} lang={lang} isMobile={isMobile} />
      {tab === 'projects' ? (
        <ProjectEditView
          targets={projectTargets}
          draftDenied={projectDraftDenied}
          draftRepoKeys={draftDenied}
          diff={projectDiff}
          search={search}
          onSearch={onSearch}
          showStale={showStale}
          onToggleStale={onToggleStale}
          showAllMobile={showAllMobile}
          onShowAllMobile={onShowAllMobile}
          isMobile={isMobile}
          lang={lang}
          withheldBy={projectWithheldBy}
          onToggleRow={onToggleProjectRow}
          onShareAll={onShareAllProjects}
          onBlockAll={onBlockAllProjects}
        />
      ) : (
        <EditView
          targets={targets}
          draftDenied={draftDenied}
          diff={diff}
          search={search}
          onSearch={onSearch}
          showStale={showStale}
          onToggleStale={onToggleStale}
          showAllMobile={showAllMobile}
          onShowAllMobile={onShowAllMobile}
          isMobile={isMobile}
          lang={lang}
          mode={mode}
          partialRepoKeys={partialRepoKeys}
          impactSessions={impactSessions ?? 0}
          impactCost={impactCost ?? 0}
          withheldBy={repoWithheldBy}
          onToggleRow={onToggleRow}
          onShareAll={onShareAll}
          onBlockAll={onBlockAll}
        />
      )}
      {hasSiblingWarnings(warnings) && (
        // `role="status"`, not `alert`: this warns, it never blocks — same posture as the forward
        // warning on the connection card. Amber, and it wraps rather than scrolling, so a 390px
        // card never gains a horizontal scrollbar (`overflowWrap` on each row).
        <div role="status" style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: '8px 12px', borderRadius: 7, fontSize: 11.5,
          background: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)',
        }}>
          <strong style={{ fontSize: 12, color: 'var(--anthropic-orange)' }}>
            {(onProjects ? COPY.siblingWithholdTitleProject : COPY.siblingWithholdTitle)[lang]}
          </strong>
          <span style={{ color: 'var(--text-secondary)' }}>{COPY.siblingWithholdBody[lang]}</span>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {warnings.map(w => (
              <li key={w.key} style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                {/* The sibling's OWN path is shown when the announcement carried one: seeing
                    `/home/user/projFicticio` beside your `/home/user/xpto/abc/projFicticio` is what
                    settles the folder-name ambiguity in one glance. Never fabricated — a machine
                    that withholds by omission simply has no path here. */}
                {w.name} — {w.machines.map(m => m.paths.length > 0 ? `${m.name} (${m.paths.join(', ')})` : m.name).join(', ')}
              </li>
            ))}
          </ul>
          {onProjects && (
            <span style={{ color: 'var(--text-tertiary)' }}>{COPY.siblingWithholdProjectNote[lang]}</span>
          )}
          {/* The load-bearing sentence: an absent warning is not a guarantee. Dropping it would
              turn a best-effort signal into an implied audit, which is the whole risk here. */}
          <span style={{ color: 'var(--text-tertiary)' }}>{COPY.siblingWithholdBestEffort[lang]}</span>
        </div>
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
  )
}
