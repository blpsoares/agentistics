import { test, expect } from 'bun:test'
import { NO_REPO_KEY } from '@agentistics/core'
import {
  resolveCardState, resolveRepoPanelMode, showsApplyQueuedBanner, isBrokenEndpoint,
  resolveWritesDisabled, resolveRulePill, showsElsewhereWarning, elsewhereLine,
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
