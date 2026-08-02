import { test, expect, describe, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildConfirmMessage, hiddenChipStyle, ReadView } from './SharedReposPanel'
import { COPY } from './copy'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'

/**
 * SharedReposPanel.test.ts — covers the one piece of `SharedReposPanel.tsx` worth testing outside
 * a DOM runner: `buildConfirmMessage`, the plain-string builder fed to `ConfirmModal.message`.
 *
 * Review fix (Important 1): the confirm modal must state the impact — the edit view's own
 * `applyImpact` line sits behind the modal's blur the moment it opens, so the number the user is
 * actually confirming has to be IN the modal, not merely visible somewhere behind it.
 */

test('the confirm message states the impact (session count and cost) when something is newly blocked', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 4, costUSD: 1.2345 }, 'none', 'en')
  expect(msg).toContain('4 sessions')
  expect(msg).toContain('1.23') // fmtCost's formatted amount — exact currency prefix not asserted
  expect(msg).toContain('Removes')
})

test('the confirm message omits the impact sentence entirely when nothing is newly blocked (sessions === 0)', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(msg).not.toContain('Removes')
})

test('the confirm message includes the stats clause when boundary/prehistorySessions are known, and the proven clause only in the proven variant', () => {
  const stats = { boundary: '2026-06-01', n: 12 }
  const generic = buildConfirmMessage('generic', stats, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(generic).toContain('2026-06-01')
  expect(generic).toContain('12')

  const proven = buildConfirmMessage('proven', stats, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(proven).toContain('2026-06-01')
  // The proven sentence is strictly additional — the generic clause's own boundary mention plus
  // the proven clause's own boundary mention.
  expect(proven.length).toBeGreaterThan(generic.length)
})

test('the confirm message omits the stats clause entirely when boundary is unknowable (null)', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'none', 'en')
  // No stray, invented numbers from a stats clause that was never built.
  expect(msg).not.toContain('undefined')
  expect(msg).not.toContain('null')
})

test('works in Portuguese too — the body text is language-specific, the numbers are not', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 7, costUSD: 0.5 }, 'none', 'pt')
  expect(msg).toContain('7')
  expect(msg.toLowerCase()).toContain('apaga')
})

// --- Plan 4 Task 7: the mode-switch sentence, appended only when the mode actually changed -------

test('modeVariant "none" appends no mode sentence at all', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(msg).not.toContain(COPY.modeConfirmToAllowlist.en)
  expect(msg).not.toContain(COPY.modeConfirmToDenylist.en)
})

test('modeVariant "toAllowlist" appends the allowlist-switch consequence, never the denylist one', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'toAllowlist', 'en')
  expect(msg).toContain(COPY.modeConfirmToAllowlist.en)
  expect(msg).not.toContain(COPY.modeConfirmToDenylist.en)
})

test('modeVariant "toDenylist" appends the denylist-switch consequence, never the allowlist one', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'toDenylist', 'en')
  expect(msg).toContain(COPY.modeConfirmToDenylist.en)
  expect(msg).not.toContain(COPY.modeConfirmToAllowlist.en)
})

// --- product owner live test: hidden entries read RED (outlined), not amber ----------------------

test('hiddenChipStyle is an outlined (transparent-fill, red-bordered) chip using the app\'s existing danger variable, not a new hex value', () => {
  const style = hiddenChipStyle()
  expect(style.background).toBe('transparent')
  expect(style.border).toContain('var(--accent-red)')
  expect(style.color).toBe('var(--accent-red)')
  // never the old amber treatment
  expect(style.border).not.toContain('anthropic-orange')
  expect(style.color).not.toContain('anthropic-orange')
})

/** `ReadView` holds no hooks — a plain function of its props — so it can be called directly and
 *  its returned element tree walked like a shallow render, the same technique
 *  `SharingRulesPicker.test.tsx` uses. */
function collectSpans(el: unknown, out: { props: Record<string, unknown> }[] = []): { props: Record<string, unknown> }[] {
  if (!el || typeof el !== 'object') return out
  const node = el as { type?: unknown; props?: { children?: unknown } }
  if (node.type === 'span') out.push(node as { props: Record<string, unknown> })
  const kids = node.props?.children
  const list = Array.isArray(kids) ? kids : kids !== undefined ? [kids] : []
  for (const k of list) collectSpans(k, out)
  return out
}

const repoTarget: ShareTarget = {
  key: 'github.com/acme/api', kind: 'repo', name: 'acme/api', host: 'github.com',
  sessions: 3, lastActive: '', orphan: false, conflictPaths: [],
}
const projectTarget: ProjectTarget = {
  key: '/home/acme/api', kind: 'project', name: 'api', path: '/home/acme/api',
  repoKey: 'github.com/acme/api', sessions: 3, lastActive: '', locked: false,
}

test('denylist read view marks a hidden repo with the red/outlined chip style, not the old amber fill', () => {
  const el = ReadView({
    targets: [repoTarget], projectTargets: [], storedDenied: new Set([repoTarget.key]),
    storedProjectPaths: new Set(), mode: 'denylist', sessions: [], status: undefined, lang: 'en', otelEnabled: false,
  })
  const spans = collectSpans(el)
  expect(spans.length).toBeGreaterThan(0)
  for (const span of spans) {
    expect(span.props.style).toEqual(hiddenChipStyle())
  }
})

test('allowlist read view never applies the hidden/red treatment to its allowed entries — those chips mean the opposite', () => {
  const el = ReadView({
    targets: [repoTarget], projectTargets: [], storedDenied: new Set([repoTarget.key]),
    storedProjectPaths: new Set(), mode: 'allowlist', sessions: [], status: undefined, lang: 'en', otelEnabled: false,
  })
  const spans = collectSpans(el)
  expect(spans.length).toBeGreaterThan(0)
  for (const span of spans) {
    expect(span.props.style).not.toEqual(hiddenChipStyle())
    const style = span.props.style as Record<string, unknown>
    expect(String(style.color)).toContain('accent-green')
    expect(String(style.color)).not.toContain('accent-red')
  }
})

test('a project-dimension hidden entry gets the same red/outlined treatment as a hidden repo', () => {
  const el = ReadView({
    targets: [], projectTargets: [projectTarget], storedDenied: new Set(),
    storedProjectPaths: new Set([projectTarget.key]), mode: 'denylist', sessions: [], status: undefined, lang: 'en', otelEnabled: false,
  })
  const spans = collectSpans(el)
  expect(spans.length).toBeGreaterThan(0)
  for (const span of spans) {
    expect(span.props.style).toEqual(hiddenChipStyle())
  }
})

describe('the rules editor is the drawer, not a bespoke inline panel', () => {
  const src = readFileSync(join(import.meta.dir, 'SharedReposPanel.tsx'), 'utf8')

  it('renders the picker inside the same right-side Drawer the add-central wizard uses', () => {
    expect(src).toContain("import Drawer from '../../pages/settings/Drawer'")
    expect(src).toMatch(/<Drawer[\s\S]*<SharingRulesPicker/)
  })

  it('has no inline edit mode left — Section never renders an editor of its own here', () => {
    // The duplicate is deleted, not merely bypassed: `editing` may not reach Section, or the panel
    // would have two editors again the first time someone "restores" the prop.
    expect(src).toContain('editing={false}')
    expect(src).toContain('editChildren={null}')
  })

  it('the drawer guards unsaved rules on close, like every other drawer', () => {
    expect(src).toMatch(/dirty=\{dirty\}/)
  })
})
