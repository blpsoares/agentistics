import { test, expect, describe, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildConfirmMessage, ReadView } from './SharedReposPanel'
import { COPY } from './copy'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'
import { NO_REPO_KEY, type SiblingRuleFact } from '@agentistics/core'

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

// --- the hidden block is a TABLE of what is not shared, and where else it is restricted --------

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

/** Every string the tree would print, flattened — what the user can actually read. */
function texts(el: unknown, out: string[] = []): string[] {
  if (typeof el === 'string') { out.push(el); return out }
  if (typeof el === 'number') { out.push(String(el)); return out }
  if (!el || typeof el !== 'object') return out
  const kids = (el as { props?: { children?: unknown } }).props?.children
  const list = Array.isArray(kids) ? kids : kids !== undefined ? [kids] : []
  for (const k of list) texts(k, out)
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

const sibling = (over: Partial<SiblingRuleFact> & { machineId: string }): SiblingRuleFact => ({
  machineName: over.machineId,
  shareMode: 'denylist',
  sources: [],
  at: '2026-07-31T10:00:00.000Z',
  receivedAt: '2026-07-31T10:00:05.000Z',
  ...over,
})

function denylistView(over: Partial<Parameters<typeof ReadView>[0]> = {}) {
  return ReadView({
    targets: [repoTarget], projectTargets: [projectTarget],
    sources: [{ type: 'repo', value: repoTarget.key }],
    storedDenied: new Set([repoTarget.key]), storedProjectPaths: new Set(),
    mode: 'denylist', sessions: [], status: undefined, lang: 'en', otelEnabled: false,
    siblingRules: [],
    ...over,
  })
}

test('a hidden entry states WHAT it is: the name and its dimension, never one undifferentiated blob', () => {
  const printed = texts(denylistView({
    sources: [{ type: 'repo', value: repoTarget.key }, { type: 'project', value: projectTarget.path }],
    storedDenied: new Set([repoTarget.key]), storedProjectPaths: new Set([projectTarget.path]),
  }))
  expect(printed).toContain('acme/api')
  expect(printed).toContain(COPY.rowTagRepo.en)
  expect(printed).toContain(COPY.rowTagProject.en)
})

test('a hidden entry names the OTHER machines the same restriction is applied on', () => {
  const printed = texts(denylistView({
    siblingRules: [
      sibling({ machineId: 'm1', machineName: 'Alienware', sources: [{ type: 'repo', value: repoTarget.key }] }),
      sibling({ machineId: 'm2', machineName: 'Laptop B', sources: [] }),
    ],
  }))
  const line = printed.join(' | ')
  expect(line).toContain(COPY.colRestrictedOn.en)
  expect(line).toContain('Alienware')
  // …and never a machine that does NOT restrict it: that would be the opposite claim.
  expect(line).not.toContain('Laptop B')
})

test('a row with no sibling information SAYS so — an empty cell would read as "nowhere else"', () => {
  const printed = texts(denylistView({ siblingRules: [] }))
  expect(printed).toContain(COPY.rowNoOtherMachine.en)
})

test('nothing in the block is alarm-coloured: every entry is there because the user chose it', () => {
  const spans = collectSpans(denylistView({
    siblingRules: [sibling({ machineId: 'm1', machineName: 'Alienware', sources: [{ type: 'repo', value: repoTarget.key }] })],
  }))
  expect(spans.length).toBeGreaterThan(0)
  let checked = 0
  for (const span of spans) {
    const style = JSON.stringify(span.props.style ?? {})
    expect(style).not.toContain('accent-red')
    expect(style).not.toContain('anthropic-orange')
    checked++
  }
  expect(checked).toBe(spans.length)
})

test('the unattributed bucket reads as its label, never a raw sentinel key', () => {
  const printed = texts(denylistView({
    sources: [{ type: 'none', value: '' }],
    storedDenied: new Set([NO_REPO_KEY]), storedProjectPaths: new Set(),
  })).join(' | ')
  expect(printed).toContain(COPY.noRepoTitle.en)
  expect(printed).not.toContain(NO_REPO_KEY)
})

test('the allowlist read view keeps its own positive polarity — no "hidden" framing is forced on it', () => {
  const el = ReadView({
    targets: [repoTarget], projectTargets: [],
    sources: [{ type: 'repo', value: repoTarget.key }],
    storedDenied: new Set([repoTarget.key]), storedProjectPaths: new Set(),
    mode: 'allowlist', sessions: [], status: undefined, lang: 'en', otelEnabled: false, siblingRules: [],
  })
  const printed = texts(el)
  expect(printed.join(' ')).toContain('Shared with this central')
  expect(printed.join(' ')).not.toContain('Hidden from this central')
  const spans = collectSpans(el)
  expect(spans.length).toBeGreaterThan(0)
  for (const span of spans) {
    expect(String((span.props.style as Record<string, unknown>)?.color ?? '')).not.toContain('accent-red')
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

  it('the hidden block reuses the notices modal\'s builder — one implementation, two surfaces', () => {
    expect(src).toContain('buildRestrictionTable')
    expect(src).toContain("scope: 'selfRestricted'")
    // The chips, and the alarm colour that carried their whole meaning, are gone for good.
    expect(src).not.toContain('hiddenChipStyle')
    expect(src).not.toContain('EyeOff')
    // The honesty guard the sibling column needs, stated where it qualifies something.
    expect(src).toContain('COPY.siblingWithholdBestEffort[lang]')
  })
})
