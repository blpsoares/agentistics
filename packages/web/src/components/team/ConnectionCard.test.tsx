import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_REPO_KEY } from '@agentistics/core'
import {
  resolveCardState, resolveRepoPanelMode, showsApplyQueuedBanner, isBrokenEndpoint,
  resolveWritesDisabled, resolveRulePill, showsElsewhereWarning, elsewhereLine,
  resolveCardStatusStyle, TONE, type CardState,
} from './cardState'
import { canEditRepos, type ApplyPhase } from './repoPanelState'
import { resolvePanelBranch } from './ConnectionsPanel'
import type { ConnectionStatusEntry } from './statusTypes'

/**
 * The per-card state table (design doc §9.5) — asserted directly against the pure decision
 * functions rather than through rendered DOM. This project has no React-rendering test
 * infrastructure installed (every existing `*.test.ts` in the repo exercises a pure function —
 * see `packages/web/src/lib/shareRepos.test.ts`, `useData.test.ts`, etc. — and `bun test` has no
 * `@testing-library/react`/jsdom dependency configured), so `resolveCardState`,
 * `resolveRepoPanelMode`, `showsApplyQueuedBanner` and `isBrokenEndpoint` were pulled out of
 * `ConnectionCard.tsx` specifically so every row of the table has something pure and unit-testable
 * to assert against — matching how `shareRepos.ts` and `share-rules.ts` are tested elsewhere in
 * this codebase. Each test below asserts the ONE distinguishing fact the table row names.
 */

function status(over: Partial<ConnectionStatusEntry> = {}): ConnectionStatusEntry {
  return {
    id: 'c_1', endpoint: 'https://central.example', org: 'default', user: 'alice',
    lastSuccessAt: null, errKind: null, latencyMs: null,
    shareMode: 'denylist', deniedRepos: 0, deniedProjects: 0, allowedCount: 0,
    deniedCount: 0, restricted: false, boundary: null, prehistorySessions: null,
    canForget: true, centralTooOld: false, resync: null, pendingRules: false,
    ...over,
  }
}

// --- header/connectivity state ------------------------------------------------------------------

test('checking: status === undefined', () => {
  expect(resolveCardState(undefined)).toBe('checking')
})

test('connecting: no lastSuccessAt, no error', () => {
  expect(resolveCardState(status({ lastSuccessAt: null, errKind: null }))).toBe('connecting')
})

test('no identity: user === "" (whoami has not resolved a name yet)', () => {
  expect(resolveCardState(status({ user: '', lastSuccessAt: Date.now() }))).toBe('noIdentity')
})

test('connected: errKind === null && lastSuccessAt', () => {
  expect(resolveCardState(status({ errKind: null, lastSuccessAt: Date.now() }))).toBe('connected')
})

test('offline: errKind === "net"', () => {
  expect(resolveCardState(status({ errKind: 'net', lastSuccessAt: Date.now() }))).toBe('offline')
})

test('unauthorized: errKind === "auth"', () => {
  expect(resolveCardState(status({ errKind: 'auth' }))).toBe('unauthorized')
})

test('resyncing: status.resync != null', () => {
  expect(resolveCardState(status({ resync: { phase: 'forget', done: 1, total: 4 }, lastSuccessAt: Date.now() }))).toBe('resyncing')
})

// --- overlays that are NOT part of the header state, but still distinct table rows --------------

test('apply-queued: pendingRules renders the banner, and never while a resync is actively running', () => {
  expect(showsApplyQueuedBanner('connected', true)).toBe(true)
  expect(showsApplyQueuedBanner('offline', true)).toBe(true)
  // never a success, and never double-messaged against the live progress strip
  expect(showsApplyQueuedBanner('resyncing', true)).toBe(false)
  expect(showsApplyQueuedBanner('connected', false)).toBe(false)
  expect(showsApplyQueuedBanner('connected', undefined)).toBe(false)
})

// --- the repo panel: the two rules that matter most ----------------------------------------------

test('unauthorized HIDES the repo panel — nothing can be removed until the token works', () => {
  expect(resolveRepoPanelMode('unauthorized', false, 'consolidate')).toBe('hidden')
  // even if centralTooOld/archiveOff would also apply, unauthorized wins — the token must be
  // fixed before any of those questions are even reachable.
  expect(resolveRepoPanelMode('unauthorized', true, 'off')).toBe('hidden')
})

test('offline keeps the repo panel EDITABLE — rules are local and must stay changeable', () => {
  expect(resolveRepoPanelMode('offline', false, 'consolidate')).toBe('editable')
})

test('central too old: canForget === false replaces the repo panel', () => {
  expect(resolveRepoPanelMode('connected', true, 'consolidate')).toBe('centralTooOld')
})

test('archive off: prefs.archiveMode === "off" replaces the repo panel', () => {
  expect(resolveRepoPanelMode('connected', false, 'off')).toBe('archiveOff')
})

test('connected with no blockers: repo panel is the editable slot', () => {
  expect(resolveRepoPanelMode('connected', false, 'consolidate')).toBe('editable')
  expect(resolveRepoPanelMode('connected', false, null)).toBe('editable')
})

// --- broken endpoint -------------------------------------------------------------------------

test('broken endpoint: an unparsable endpoint is detected, never throws', () => {
  expect(isBrokenEndpoint('not a url')).toBe(true)
  expect(isBrokenEndpoint('')).toBe(true)
  expect(isBrokenEndpoint('https://central.example:48080')).toBe(false)
})

// --- the two panel-level rows (not per-card) ------------------------------------------------

test('prefs load error: the error branch wins even if connections had already loaded', () => {
  expect(resolvePanelBranch('HTTP 500', [])).toBe('error')
  expect(resolvePanelBranch('HTTP 500', null)).toBe('error')
})

test('empty list: connections.length === 0 (and not still loading)', () => {
  expect(resolvePanelBranch(null, [])).toBe('empty')
})

test('still loading: connections === null, distinct from a genuinely empty list', () => {
  expect(resolvePanelBranch(null, null)).toBe('loading')
})

// --- review fix (Important 2): the apply write-guard survives collapsing the card ---------------

/**
 * The panel used to OWN the apply phase and report it upward through `onBusyChange`, whose unmount
 * cleanup fired `onBusyChange(false)`. Collapsing the card unmounts the panel, so the guard fell
 * open and Edit / Sync now / Disconnect all became live again during the very window the guard
 * exists to cover — and re-expanding remounted the panel at `phase: 'idle'`.
 *
 * The fix makes the CARD (which stays mounted while collapsed) own the phase, so
 * `resolveWritesDisabled` takes the phase and nothing about whether the panel is mounted: there is
 * no input a collapse could change, which is the property asserted below.
 */
test('collapsing and re-expanding the card mid-apply leaves the writes disabled', () => {
  // An apply is in flight (PATCH returned, resync not yet visible on a poll).
  const phase: ApplyPhase = 'waiting'
  expect(resolveWritesDisabled('connected', false, false, phase)).toBe(true)
  // Collapse: the panel unmounts. The guard's inputs are unchanged, so it stays closed…
  expect(resolveWritesDisabled('connected', false, false, phase)).toBe(true)
  // …and re-expanding renders the panel from that same phase — Edit is still locked, not 'idle'.
  expect(canEditRepos('connected', phase)).toBe(false)
  // Sanity: the guard really does open again once the apply finishes.
  expect(resolveWritesDisabled('connected', false, false, 'idle')).toBe(false)
  expect(canEditRepos('connected', 'idle')).toBe(true)
})

test('resolveWritesDisabled closes for every write-blocking reason, and only those', () => {
  expect(resolveWritesDisabled('resyncing', false, false, 'idle')).toBe(true)
  expect(resolveWritesDisabled('connected', true, false, 'idle')).toBe(true)  // sync now in flight
  expect(resolveWritesDisabled('connected', false, true, 'idle')).toBe(true)  // disconnecting
  expect(resolveWritesDisabled('connected', false, false, 'submitting')).toBe(true)
  expect(resolveWritesDisabled('offline', false, false, 'idle')).toBe(false)
  expect(resolveWritesDisabled('connected', false, false, 'error')).toBe(false)
})

// --- the card's status signalling: one severity behind the dot, the border and the "i" ----------

/**
 * The whole set, listed once. Three states of different severity used to get three unrelated
 * treatments: `offline` alone painted an orange border, `unauthorized` (strictly worse) painted
 * none, and `resyncing` shared offline's tone while painting nothing either. The rule now is
 * severity-derived, so these assertions are about the RULE, not about one state's name.
 */
const ALL_STATES: CardState[] = [
  'checking', 'connecting', 'noIdentity', 'connected', 'offline', 'unauthorized', 'resyncing',
]

test('the state table and the tone table cover exactly the same states', () => {
  // A state added without a tone would fall through to `undefined` and render an uncoloured dot.
  expect(Object.keys(TONE).sort()).toEqual([...ALL_STATES].sort())
})

test('an unreachable central gets the RED dot, a border in that same tone, and the "i"', () => {
  expect(resolveCardStatusStyle('offline')).toEqual({ tone: 'error', dot: 'error', border: 'error', info: true })
})

test('a rejected token is at least as severe as an unreachable one — the same treatment, not a quieter one', () => {
  expect(resolveCardStatusStyle('unauthorized')).toEqual({ tone: 'error', dot: 'error', border: 'error', info: true })
})

test('the ordinary case is quiet: the dot carries the status and the card draws no status border', () => {
  for (const state of ['connected', 'checking', 'connecting', 'noIdentity'] as const) {
    const style = resolveCardStatusStyle(state)
    expect(style.border).toBeNull()
    expect(style.info).toBe(false)
  }
  expect(resolveCardStatusStyle('connected').dot).toBe('ok')
  expect(resolveCardStatusStyle('checking').dot).toBe('unknown')
})

test('work in progress is not a fault: a running resync stays quiet, however long it takes', () => {
  const style = resolveCardStatusStyle('resyncing')
  expect(style.tone).toBe('warn')
  expect(style.border).toBeNull()
  expect(style.info).toBe(false)
})

test('the border tone is never a colour the dot does not have, and only a fault earns one', () => {
  let bordered = 0
  for (const state of ALL_STATES) {
    const style = resolveCardStatusStyle(state)
    expect(style.dot).toBe(style.tone)
    if (style.border !== null) {
      expect(style.border).toBe(style.tone)
      expect(style.tone).toBe('error')
      bordered++
    }
  }
  // Exactly the two fault states, so a future state cannot quietly join them unnoticed.
  expect(bordered).toBe(2)
})

test('the "i" appears exactly where a border does — it is the answer to "why is this card red"', () => {
  let asserted = 0
  for (const state of ALL_STATES) {
    const style = resolveCardStatusStyle(state)
    expect(style.info).toBe(style.border !== null)
    asserted++
  }
  expect(asserted).toBe(ALL_STATES.length)
})

// --- the collapsed card's rules pill (review Important 3) ---------------------------------------

test('denylist: the pill counts what is HIDDEN', () => {
  expect(resolveRulePill(status({ shareMode: 'denylist', deniedRepos: 2, deniedProjects: 1, deniedCount: 3 })))
    .toEqual({ tone: 'deny', count: 3 })
})

test('allowlist: the same count is what is SHARED, never "hidden"', () => {
  // `ruleCountsOf` puts the allowlist total in BOTH `allowedCount` and the legacy `deniedCount` —
  // reading the legacy field as "blocked" reported "3 hidden" for a connection sharing only 3
  // repositories out of 40.
  expect(resolveRulePill(status({ shareMode: 'allowlist', allowedCount: 3, deniedCount: 3 })))
    .toEqual({ tone: 'allow', count: 3 })
})

test('no rules at all, and a never-polled connection, show no pill', () => {
  expect(resolveRulePill(status({ shareMode: 'denylist', deniedCount: 0 }))).toBeNull()
  expect(resolveRulePill(undefined)).toBeNull()
})

// --- the "another machine of yours still shares this" warning -----------------------------------

test('the elsewhere warning is hidden when the list is empty, absent, or from an older server', () => {
  expect(showsElsewhereWarning([])).toBe(false)
  expect(showsElsewhereWarning(undefined)).toBe(false)
})

test('the elsewhere warning shows as soon as one sibling machine still sends a hidden repo', () => {
  expect(showsElsewhereWarning([{ repo: 'github.com/acme/api', machines: ['laptop-b'] }])).toBe(true)
})

test('the elsewhere warning survives a running resync — finishing this machine\'s removal changes nothing about a sibling', () => {
  // Deliberately independent of state/pendingRules, unlike showsApplyQueuedBanner.
  expect(showsApplyQueuedBanner('resyncing', true)).toBe(false)
  expect(showsElsewhereWarning([{ repo: 'r', machines: ['m'] }])).toBe(true)
})

test('a warning line names the short repo and every machine still sending it', () => {
  expect(elsewhereLine({ repo: 'github.com/acme/api', machines: ['laptop-b', 'desktop'] }, 'none'))
    .toBe('acme/api — laptop-b, desktop')
})

test('the no-repo bucket uses its label, never a bare sentinel key', () => {
  const line = elsewhereLine({ repo: NO_REPO_KEY, machines: ['laptop-b'] }, 'no linked repository')
  expect(line).toBe('no linked repository — laptop-b')
  expect(line).not.toContain(NO_REPO_KEY)
})

// --- the disclosure caret ------------------------------------------------------------------------

test('the accordion caret carries a theme token — an uncoloured icon renders black on the dark card', () => {
  const src = readFileSync(join(import.meta.dir, 'ConnectionCard.tsx'), 'utf8')
  const at = src.indexOf('? <ChevronDown')
  expect(at).toBeGreaterThan(-1)
  const caret = src.slice(at, src.indexOf('/>}', src.indexOf('ChevronRight', at)) + 3)
  expect(caret).toContain('ChevronDown')
  expect(caret).toContain('ChevronRight')
  // The wrapping button is `background: transparent` and sets no `color`, so the icon inherited
  // nothing and fell through to the browser default — black, invisible on the dark ground. This is
  // a MISSING token, which is why it read as broken rather than merely off-palette.
  expect(caret).toContain("color: 'var(--text-primary)'")
  // Both states, or the card changes colour when you open it.
  expect(caret.match(/var\(--text-primary\)/g)?.length).toBe(2)
  // Structure, not a call to action: the accent is already spent on the notices button, "Add
  // central" and the active-state cues on this same card.
  expect(caret).not.toContain('anthropic-orange')
  // Never a literal — the token is what makes it resolve under light as well as dark.
  expect(caret).not.toContain('#fff')
  expect(caret).not.toContain('white')
})

test('every disclosure caret on these surfaces resolves to a token, none to the browser default', () => {
  // A caret that is one colour in one block and another two blocks down is the same inconsistency
  // the row dividers were added to fix. The siblings inherit from a button that sets `color`;
  // this asserts that inheritance still exists rather than assuming it.
  const sites = [
    ['./PeersSection.tsx', 'var(--text-secondary)'],
    ['./SharedReposPanel.tsx', 'var(--text-tertiary)'],
    ['./SharedReposEditView.tsx', 'var(--text-tertiary)'],
  ] as const
  let checked = 0
  for (const [file, token] of sites) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    // The caret sits inside a button whose style names a colour; find that button's declaration.
    const idx = src.search(/\{(open|showStale) \? <ChevronDown/)
    expect(idx).toBeGreaterThan(-1)
    const before = src.slice(Math.max(0, idx - 420), idx)
    expect(before).toContain(`color: '${token}'`)
    checked++
  }
  expect(checked).toBe(sites.length)
  expect(checked).toBe(3)
})
