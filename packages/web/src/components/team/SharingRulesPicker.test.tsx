import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diffDraft } from './repoPanelState'
import { EditView, ModeSelector, PickerTabs, ProjectEditView } from './SharedReposEditView'
import { SharingRulesPicker, type SharingRulesPickerProps } from './SharingRulesPicker'

/**
 * SharingRulesPicker.test.tsx — this project has no DOM-rendering test infrastructure (see
 * `ConnectionCard.test.tsx`'s docstring), but `SharingRulesPicker` holds no hooks of its own — it
 * is a plain function of its props — so it can be called directly like any other function. React
 * elements are plain `{ type, props }` objects even without a renderer, so the returned tree can be
 * inspected exactly like a shallow render: this is the "prop-level test that both surfaces pass the
 * same shape" the plan asks for, not a test that merely imports the module.
 *
 * The second half proves BOTH real surfaces actually mount this component (not merely import it,
 * which would prove nothing) by asserting the JSX invocation is present in their source — the two
 * previously drifted specifically because each re-assembled its own `<ModeSelector>`/`<PickerTabs>`
 * JSX instead of sharing one tree.
 */

function baseProps(overrides: Partial<SharingRulesPickerProps> = {}): SharingRulesPickerProps {
  const emptyDiff = diffDraft(new Set(), new Set())
  return {
    mode: 'denylist',
    onModeChange: () => {},
    tab: 'repos',
    onTabChange: () => {},
    lang: 'en',
    isMobile: false,
    targets: [],
    projectTargets: [],
    draftDenied: new Set(),
    projectDraftDenied: new Set(),
    diff: emptyDiff,
    projectDiff: emptyDiff,
    partialRepoKeys: new Set(),
    search: '',
    onSearch: () => {},
    showStale: false,
    onToggleStale: () => {},
    showAllMobile: false,
    onShowAllMobile: () => {},
    showEmptyAllowlistWarning: false,
    onToggleRow: () => {},
    onShareAll: () => {},
    onBlockAll: () => {},
    onToggleProjectRow: () => {},
    onShareAllProjects: () => {},
    onBlockAllProjects: () => {},
    ...overrides,
  }
}

function childrenOf(el: ReturnType<typeof SharingRulesPicker>): unknown[] {
  const kids = (el as unknown as { props: { children: unknown } }).props.children
  return Array.isArray(kids) ? kids : [kids]
}

function findByType(kids: unknown[], type: unknown): { props: Record<string, unknown> } | undefined {
  return kids.find(k => (k as { type?: unknown } | null)?.type === type) as { props: Record<string, unknown> } | undefined
}

describe('SharingRulesPicker — the one body both surfaces render', () => {
  test('repos tab renders EditView, never ProjectEditView, and threads the caller-supplied impact numbers through', () => {
    const el = SharingRulesPicker(baseProps({ tab: 'repos', impactSessions: 5, impactCost: 1.5 }))
    const kids = childrenOf(el)
    const editViewEl = findByType(kids, EditView)
    expect(editViewEl).toBeDefined()
    expect(editViewEl!.props.impactSessions).toBe(5)
    expect(editViewEl!.props.impactCost).toBe(1.5)
    expect(findByType(kids, ProjectEditView)).toBeUndefined()
  })

  test('projects tab renders ProjectEditView, never EditView', () => {
    const el = SharingRulesPicker(baseProps({ tab: 'projects' }))
    const kids = childrenOf(el)
    expect(findByType(kids, ProjectEditView)).toBeDefined()
    expect(findByType(kids, EditView)).toBeUndefined()
  })

  test('a caller with nothing to estimate (the wizard, before any connection exists) omits impact numbers, and EditView receives 0 rather than undefined — never a printed "0 sessions" line, per EditView\'s own impactSessions > 0 gate', () => {
    const el = SharingRulesPicker(baseProps({ tab: 'repos' })) // impactSessions/impactCost omitted
    const editViewEl = findByType(childrenOf(el), EditView)
    expect(editViewEl!.props.impactSessions).toBe(0)
    expect(editViewEl!.props.impactCost).toBe(0)
  })

  test('ModeSelector and PickerTabs are always present and wired to the caller\'s own state', () => {
    const el = SharingRulesPicker(baseProps({ mode: 'allowlist', tab: 'projects' }))
    const kids = childrenOf(el)
    const modeEl = findByType(kids, ModeSelector)
    const tabsEl = findByType(kids, PickerTabs)
    expect(modeEl!.props.mode).toBe('allowlist')
    expect(tabsEl!.props.tab).toBe('projects')
  })

  test('the empty-allowlist warning is present only when the caller says so — the same flag both surfaces set from isEmptyAllowlist', () => {
    const shownKids = childrenOf(SharingRulesPicker(baseProps({ showEmptyAllowlistWarning: true })))
    const hiddenKids = childrenOf(SharingRulesPicker(baseProps({ showEmptyAllowlistWarning: false })))
    // `cond && <div/>` renders the literal `false` when cond is false — React treats it as nothing.
    expect(shownKids.some(k => k === false)).toBe(false)
    expect(hiddenKids.some(k => k === false)).toBe(true)
  })
})

describe('both real surfaces actually mount SharingRulesPicker (not two re-assembled JSX trees)', () => {
  const panelSrc = readFileSync(join(import.meta.dir, 'SharedReposPanel.tsx'), 'utf8')
  const drawerSrc = readFileSync(join(import.meta.dir, 'AddCentralDrawer.tsx'), 'utf8')

  test('SharedReposPanel imports AND invokes <SharingRulesPicker — importing alone would prove nothing', () => {
    expect(panelSrc).toContain("from './SharingRulesPicker'")
    expect(panelSrc).toMatch(/<SharingRulesPicker\b/)
  })

  test('AddCentralDrawer imports AND invokes <SharingRulesPicker', () => {
    expect(drawerSrc).toContain("from './SharingRulesPicker'")
    expect(drawerSrc).toMatch(/<SharingRulesPicker\b/)
  })

  test('neither surface re-assembles its own mode selector / tab bar JSX any more — that drift is exactly what produced two different pickers', () => {
    expect(panelSrc).not.toMatch(/<ModeSelector\b/)
    expect(drawerSrc).not.toMatch(/<ModeSelector\b/)
    expect(panelSrc).not.toMatch(/<PickerTabs\b/)
    expect(drawerSrc).not.toMatch(/<PickerTabs\b/)
  })

  test('both surfaces still gate the warning through isEmptyAllowlist before showing it — the shared component only renders what it is told', () => {
    expect(panelSrc).toMatch(/isEmptyAllowlist\(/)
    expect(drawerSrc).toMatch(/isEmptyAllowlist\(/)
  })
})
