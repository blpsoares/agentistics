import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SiblingRuleFact } from '@agentistics/core'
import { COPY } from './copy'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'
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

/** Every string in the returned tree, concatenated — the shallow-render equivalent of reading the
 *  rendered text. Locating a block by the copy it prints is precise where counting `false` slots is
 *  not: two conditional blocks make a slot count ambiguous the moment a third is added. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const props = (node as { props?: { children?: unknown } }).props
  return props ? textOf(props.children) : ''
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
    const shown = textOf(SharingRulesPicker(baseProps({ showEmptyAllowlistWarning: true })))
    const hidden = textOf(SharingRulesPicker(baseProps({ showEmptyAllowlistWarning: false })))
    expect(shown).toContain(COPY.emptyAllowlistWarning.en)
    expect(hidden).not.toContain(COPY.emptyAllowlistWarning.en)
  })
})

// --- the REVERSE warning: a sibling withholds what this edit starts sharing ----------------------

const API: ShareTarget = {
  key: 'github.com/acme/api', kind: 'repo', name: 'acme/api', host: 'github.com',
  sessions: 4, lastActive: '', orphan: false, conflictPaths: [],
}
const API_PROJECT: ProjectTarget = {
  key: '/home/a/api', kind: 'project', name: 'api', path: '/home/a/api',
  repoKey: 'github.com/acme/api', sessions: 4, lastActive: '', locked: false,
}
const LAPTOP_HIDES_API: SiblingRuleFact[] = [{
  machineId: 'm1', machineName: 'laptop-b', shareMode: 'denylist',
  sources: [{ type: 'repo', value: 'github.com/acme/api' }],
  at: '2026-07-31T10:00:00.000Z', receivedAt: '2026-07-31T10:00:05.000Z',
}]

/** A draft that turns `key` back ON: stored had it denied, the draft no longer does. */
function startsSharing(key: string) {
  return diffDraft(new Set<string>(), new Set([key]))
}

describe('the reverse warning — a sibling withholds what this edit starts sharing', () => {
  test('warns, with the machine named, when the draft starts sharing a repo a sibling withholds', () => {
    const text = textOf(SharingRulesPicker(baseProps({
      tab: 'repos', targets: [API], siblingRules: LAPTOP_HIDES_API,
      diff: startsSharing('github.com/acme/api'),
    })))
    expect(text).toContain(COPY.siblingWithholdTitle.en)
    expect(text).toContain('acme/api')
    expect(text).toContain('laptop-b')
  })

  test('the best-effort caveat travels WITH the warning — an absent warning is never a guarantee', () => {
    const text = textOf(SharingRulesPicker(baseProps({
      tab: 'repos', targets: [API], siblingRules: LAPTOP_HIDES_API,
      diff: startsSharing('github.com/acme/api'),
    })))
    expect(text).toContain(COPY.siblingWithholdBestEffort.en)
  })

  test('it is a status, never an alert, and never disables the row — it warns, it does not block', () => {
    const el = SharingRulesPicker(baseProps({
      tab: 'repos', targets: [API], siblingRules: LAPTOP_HIDES_API,
      diff: startsSharing('github.com/acme/api'),
    }))
    const block = childrenOf(el).find(k => (k as { props?: { role?: string } })?.props?.role === 'status')
    expect(block).toBeDefined()
    const editView = findByType(childrenOf(el), EditView)
    expect(editView!.props.withheldBy).toBeDefined()
  })

  test('no warning when the sibling shares it too, or when nothing was announced at all', () => {
    const shares: SiblingRuleFact[] = [{ ...LAPTOP_HIDES_API[0]!, sources: [] }]
    for (const facts of [shares, [] as SiblingRuleFact[], undefined]) {
      const text = textOf(SharingRulesPicker(baseProps({
        tab: 'repos', targets: [API], siblingRules: facts, diff: startsSharing('github.com/acme/api'),
      })))
      expect(text).not.toContain(COPY.siblingWithholdTitle.en)
    }
  })

  test('no warning while the edit does not start sharing it — the badge covers the before-you-decide half', () => {
    const el = SharingRulesPicker(baseProps({
      tab: 'repos', targets: [API], siblingRules: LAPTOP_HIDES_API, // untouched draft
    }))
    expect(textOf(el)).not.toContain(COPY.siblingWithholdTitle.en)
    // …but the row still carries the machine name, which is what makes it a WARNING and not a report.
    expect(findByType(childrenOf(el), EditView)!.props.withheldBy)
      .toEqual(new Map([['github.com/acme/api', ['laptop-b']]]))
  })

  test('the projects tab is warned about too, and reads the PROJECT diff, not the repo one', () => {
    const text = textOf(SharingRulesPicker(baseProps({
      tab: 'projects', projectTargets: [API_PROJECT], siblingRules: LAPTOP_HIDES_API,
      projectDiff: startsSharing('/home/a/api'),
    })))
    expect(text).toContain(COPY.siblingWithholdTitle.en)
    expect(text).toContain('api')
    expect(text).toContain('laptop-b')
  })

  test('the copy is rendered in the caller\'s language', () => {
    const text = textOf(SharingRulesPicker(baseProps({
      lang: 'pt', tab: 'repos', targets: [API], siblingRules: LAPTOP_HIDES_API,
      diff: startsSharing('github.com/acme/api'),
    })))
    expect(text).toContain(COPY.siblingWithholdTitle.pt)
    expect(text).toContain(COPY.siblingWithholdBestEffort.pt)
    expect(text).not.toContain(COPY.siblingWithholdTitle.en)
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
