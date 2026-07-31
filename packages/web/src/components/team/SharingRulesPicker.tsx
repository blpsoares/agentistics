import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'
import { COPY } from './copy'
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
  impactSessions, impactCost, showEmptyAllowlistWarning,
  onToggleRow, onShareAll, onBlockAll, onToggleProjectRow, onShareAllProjects, onBlockAllProjects,
}: SharingRulesPickerProps) {
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
          onToggleRow={onToggleRow}
          onShareAll={onShareAll}
          onBlockAll={onBlockAll}
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
  )
}
