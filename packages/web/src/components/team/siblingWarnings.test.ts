import { test, expect } from 'bun:test'
import { NO_REPO_KEY, type ShareSource, type SiblingRuleFact } from '@agentistics/core'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'
import {
  machinesWithholding, siblingWarningsFor, repoBucket, projectBucket, hasSiblingWarnings,
  withholdMap,
} from './siblingWarnings'
import { WithheldBadge } from './SiblingWithheldBadge'
import { COPY } from './copy'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = (value: string): ShareSource => ({ type: 'repo', value })
const m = (name: string, paths: string[] = []) => ({ name, paths })

function fact(over: Partial<SiblingRuleFact> = {}): SiblingRuleFact {
  return {
    machineId: 'm1',
    machineName: 'laptop-b',
    shareMode: 'denylist',
    sources: [],
    at: '2026-07-31T10:00:00.000Z',
    receivedAt: '2026-07-31T10:00:05.000Z',
    ...over,
  }
}

function target(over: Partial<ShareTarget> = {}): ShareTarget {
  return {
    key: 'github.com/acme/api', kind: 'repo', name: 'acme/api', host: 'github.com',
    sessions: 3, lastActive: '', orphan: false, conflictPaths: [], ...over,
  }
}

function project(over: Partial<ProjectTarget> = {}): ProjectTarget {
  return {
    key: '/home/a/api', kind: 'project', name: 'api', path: '/home/a/api',
    repoKey: 'github.com/acme/api', sessions: 3, lastActive: '', locked: false, ...over,
  }
}

// --- buckets -----------------------------------------------------------------------------------

test('a repo row names one dimension; a project row names both, so a denied repo covers its project', () => {
  expect(repoBucket(target())).toEqual({ repoKey: 'github.com/acme/api' })
  expect(repoBucket(target({ key: NO_REPO_KEY, kind: 'none' }))).toEqual({ repoKey: NO_REPO_KEY })
  expect(projectBucket(project())).toEqual({ repoKey: 'github.com/acme/api', projectPath: '/home/a/api' })
})

test('a project with no known remote names only its path — never the no-repo sentinel', () => {
  // `ProjectTarget.repoKey` is '' when unresolved, and '' is NOT the unattributed bucket: that
  // sentinel is the repo tab's own row, a different dimension. Passing it here would warn about
  // the wrong thing.
  expect(projectBucket(project({ repoKey: '' }))).toEqual({ projectPath: '/home/a/api' })
})

// --- machinesWithholding -----------------------------------------------------------------------

test('names every sibling whose announced rules withhold the row, deduped and sorted', () => {
  const facts = [
    fact({ machineId: 'b', machineName: 'desktop', sources: [repo('github.com/acme/api')] }),
    fact({ machineId: 'a', machineName: 'air', shareMode: 'allowlist', sources: [repo('github.com/acme/other')] }),
    fact({ machineId: 'c', machineName: 'nuc', sources: [repo('github.com/acme/other')] }),
  ]
  expect(machinesWithholding(facts, repoBucket(target())).map(m => m.name)).toEqual(['air', 'desktop'])
})

test('no announcements means no names — silence is not evidence that nobody restricts it', () => {
  expect(machinesWithholding([], repoBucket(target()))).toEqual([])
  expect(machinesWithholding(undefined, repoBucket(target()))).toEqual([])
})

test('a sibling that shares the row is never named', () => {
  const facts = [fact({ sources: [repo('github.com/acme/other')] })]
  expect(machinesWithholding(facts, repoBucket(target()))).toEqual([])
})

test('a machine announcing twice is one name, not two', () => {
  const facts = [
    fact({ machineId: 'a', machineName: 'laptop', sources: [repo('github.com/acme/api')] }),
    fact({ machineId: 'b', machineName: 'laptop', sources: [repo('github.com/acme/api')] }),
  ]
  expect(machinesWithholding(facts, repoBucket(target())).map(m => m.name)).toEqual(['laptop'])
})

// --- siblingWarningsFor ------------------------------------------------------------------------

const WITHHELD = [fact({ machineName: 'laptop-b', sources: [repo('github.com/acme/api')] })]

test('only rows this edit STARTS SHARING are warned about', () => {
  const rows = [target(), target({ key: 'github.com/acme/web', name: 'acme/web' })]
  // Nothing changed yet — a row a sibling withholds but which this edit does not touch is silent.
  expect(siblingWarningsFor(WITHHELD, rows, repoBucket, new Set())).toEqual([])
  // Now the user turns it on.
  expect(siblingWarningsFor(WITHHELD, rows, repoBucket, new Set(['github.com/acme/api'])))
    .toEqual([{ key: 'github.com/acme/api', name: 'acme/api', machines: [{ name: 'laptop-b', paths: [] }] }])
})

test('a row this edit starts sharing that NO sibling withholds produces no warning', () => {
  const rows = [target({ key: 'github.com/acme/web', name: 'acme/web' })]
  expect(siblingWarningsFor(WITHHELD, rows, repoBucket, new Set(['github.com/acme/web']))).toEqual([])
})

test('a key in the change set with no matching row is dropped, never rendered nameless', () => {
  expect(siblingWarningsFor(WITHHELD, [target()], repoBucket, new Set(['github.com/ghost/gone']))).toEqual([])
})

test('warnings are ordered by row name so the list does not reshuffle between renders', () => {
  const facts = [fact({ shareMode: 'allowlist', sources: [] })]
  const rows = [
    target({ key: 'github.com/acme/zeta', name: 'acme/zeta' }),
    target({ key: 'github.com/acme/alpha', name: 'acme/alpha' }),
  ]
  const out = siblingWarningsFor(facts, rows, repoBucket, new Set(['github.com/acme/zeta', 'github.com/acme/alpha']))
  expect(out.map(w => w.name)).toEqual(['acme/alpha', 'acme/zeta'])
})

test('the project dimension is warned about too, through its own bucket', () => {
  const rows = [project()]
  expect(siblingWarningsFor(WITHHELD, rows, projectBucket, new Set(['/home/a/api'])))
    .toEqual([{ key: '/home/a/api', name: 'api', machines: [{ name: 'laptop-b', paths: [] }] }])
})

// --- hasSiblingWarnings ------------------------------------------------------------------------

test('the block shows only when there is something to say', () => {
  expect(hasSiblingWarnings([])).toBe(false)
  expect(hasSiblingWarnings([{ key: 'k', name: 'n', machines: [{ name: 'a', paths: [] }] }])).toBe(true)
})

// --- withholdMap (the per-row badge, shown BEFORE the user touches the switch) -------------------

test('the per-row map covers every row a sibling withholds, whether or not the draft touches it', () => {
  const rows = [target(), target({ key: 'github.com/acme/web', name: 'acme/web' })]
  const map = withholdMap(WITHHELD, rows, repoBucket)
  // The point of the badge is that it is visible BEFORE the decision, so it is not scoped to the
  // draft the way `siblingWarningsFor` is.
  expect(map.get('github.com/acme/api')).toEqual([{ name: 'laptop-b', paths: [] }])
  expect(map.has('github.com/acme/web')).toBe(false)
  expect(map.size).toBe(1)
})

test('an empty inbox produces an empty map — no row is ever badged on a guess', () => {
  expect(withholdMap([], [target()], repoBucket).size).toBe(0)
  expect(withholdMap(undefined, [target()], repoBucket).size).toBe(0)
})

// --- the row badge: renders nothing on silence, and never widens the row -------------------------

test('the badge renders NOTHING when no machine was heard from — silence must be unrenderable', () => {
  expect(WithheldBadge({ machines: undefined, lang: 'en', dimension: 'repo' })).toBeNull()
  expect(WithheldBadge({ machines: [], lang: 'en', dimension: 'repo' })).toBeNull()
})

/** The badge is now an icon plus a disclosed body; flatten it so the assertions read the text. */
function badgeText(el: unknown): string {
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (n === null || n === undefined || n === false) return
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    const props = (n as { props?: { children?: unknown } }).props
    if (props) walk(props.children)
  }
  walk(el)
  return out.join(' ')
}

/** Depth-first search for the first descendant matching a predicate. */
function findNode(el: unknown, pred: (n: { props: Record<string, unknown> }) => boolean): { props: Record<string, unknown> } | null {
  if (el === null || el === undefined || typeof el !== 'object') return null
  if (Array.isArray(el)) {
    for (const c of el) { const hit = findNode(c, pred); if (hit) return hit }
    return null
  }
  const node = el as { props?: Record<string, unknown> }
  if (node.props) {
    if (pred(node as { props: Record<string, unknown> })) return node as { props: Record<string, unknown> }
    return findNode(node.props.children, pred)
  }
  return null
}

test('the badge names the machines, in the caller\'s language', () => {
  expect(badgeText(WithheldBadge({ machines: [m('laptop-b'), m('desktop')], lang: 'en', dimension: 'repo' })))
    .toContain('not shared on laptop-b, desktop')
  expect(badgeText(WithheldBadge({ machines: [m('laptop-b')], lang: 'pt', dimension: 'repo' })))
    .toContain('não compartilhado em laptop-b')
})

test('the sentence is an ICON\'s disclosure, not a pill that reads like the row\'s own tag', () => {
  // It sat inches from the repository host tag as a same-shaped orange pill, so a caution about
  // what the switch WILL DO read as a label describing what the row IS.
  const el = WithheldBadge({ machines: [m('laptop-b')], lang: 'en', dimension: 'repo' })
  expect((el as { props: { className?: string } }).props.className).toBe('ag-hint')
  // The standing signal is a focusable control, so the sentence is reachable without a pointer.
  const btn = findNode(el, n => n.props.className === 'ag-hint-btn')
  expect(btn).not.toBeNull()
  expect(btn!.props.type).toBe('button')
  // …and it must not depend on the visual disclosure at all.
  expect(String(btn!.props['aria-label'])).toContain('not shared on laptop-b')
})

test('the best-effort caveat travels WITH the sentence, wherever the sentence goes', () => {
  // An absent warning is never proof that no machine restricts a row. Moving the sentence into a
  // smaller container must not be a reason to drop the clause that says so.
  for (const lang of ['en', 'pt'] as const) {
    const el = WithheldBadge({ machines: [m('laptop-b')], lang, dimension: 'repo' })
    expect(badgeText(el)).toContain(COPY.siblingWithholdBestEffort[lang])
    const btn = findNode(el, n => n.props.className === 'ag-hint-btn')
    // Also on the accessible label — a screen reader gets the caveat too, not just the claim.
    expect(String(btn!.props['aria-label'])).toContain(COPY.siblingWithholdBestEffort[lang])
  }
})

test('the badge cannot widen its row — a long machine list must not scroll a 390px card', () => {
  // The row is `flexWrap: 'wrap'` and `#root` is `overflow-x: clip`, so text that refused to break
  // would not produce a scrollbar — it would silently vanish off the right edge, which is worse.
  // The disclosure is now positioned out of flow (`.ag-hint-body`, index.css), so the row only
  // ever contains the icon; the body still has to wrap inside its own box.
  const el = WithheldBadge({
    machines: [m('a-very-long-machine-name-from-somebody-elses-desk'), m('another-extremely-long-one')],
    lang: 'en', dimension: 'project',
  })
  const body = findNode(el, n => n.props.className === 'ag-hint-body')
  expect(body).not.toBeNull()
  const style = body!.props.style as Record<string, unknown>
  expect(style.overflowWrap).toBe('anywhere')
  expect(style.maxWidth).toBe('100%')
  expect(Object.keys(style).some(k => k === 'width' || k === 'minWidth')).toBe(false)

  const css = readFileSync(join(import.meta.dir, '../../index.css'), 'utf8')
  // Out of flow, or it is still a row-widening block of text.
  expect(css).toContain('.ag-hint-body')
  expect(/\.ag-hint-body\s*\{[^}]*position:\s*absolute/.test(css)).toBe(true)
  // Reachable by keyboard and by touch, not hover alone.
  expect(css).toContain('.ag-hint:focus-within > .ag-hint-body')
  // 44px touch target, and only on mobile.
  expect(/@media \(max-width: 767px\)\s*\{[^@]*min-height:\s*44px/.test(css)).toBe(true)
})

// --- the project dimension across machines -------------------------------------------------------
//
// The same project sits at a different path on every machine, so these rows correlate by FOLDER
// NAME. That is a heuristic — `api`, `web` and `docs` collide constantly — so the evidence has to
// travel with the claim.

const HIDES_BY_OTHER_PATH: SiblingRuleFact[] = [
  fact({ machineName: 'laptop-b', sources: [{ type: 'project', value: '/home/user/projFicticio' }] }),
]

test('a sibling hiding the same project under a DIFFERENT path is found, and names its own path', () => {
  const row = project({ key: '/home/me/xpto/abc/projFicticio', path: '/home/me/xpto/abc/projFicticio', name: 'projFicticio', repoKey: '' })
  expect(machinesWithholding(HIDES_BY_OTHER_PATH, projectBucket(row)))
    .toEqual([{ name: 'laptop-b', paths: ['/home/user/projFicticio'] }])
})

test('the sibling path is what a human needs to resolve the ambiguity, so it reaches the warning list', () => {
  const row = project({ key: '/home/me/xpto/abc/projFicticio', path: '/home/me/xpto/abc/projFicticio', name: 'projFicticio', repoKey: '' })
  expect(siblingWarningsFor(HIDES_BY_OTHER_PATH, [row], projectBucket, new Set([row.key])))
    .toEqual([{
      key: '/home/me/xpto/abc/projFicticio', name: 'projFicticio',
      machines: [{ name: 'laptop-b', paths: ['/home/user/projFicticio'] }],
    }])
})

test('a different folder name is still not a match', () => {
  const row = project({ key: '/home/me/other', path: '/home/me/other', name: 'other', repoKey: '' })
  expect(machinesWithholding(HIDES_BY_OTHER_PATH, projectBucket(row))).toEqual([])
})

test('Windows and case differences correlate — WSL and Windows machines share these accounts', () => {
  const facts = [fact({ machineName: 'win-box', sources: [{ type: 'project', value: 'C:\\Users\\me\\ProjFicticio\\' }] })]
  const row = project({ key: '/home/me/projficticio', path: '/home/me/projficticio', name: 'projficticio', repoKey: '' })
  expect(machinesWithholding(facts, projectBucket(row)).map(x => x.name)).toEqual(['win-box'])
})
