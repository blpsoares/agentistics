import { test, expect } from 'bun:test'
import {
  resolveCardState, resolveRepoPanelMode, showsApplyQueuedBanner, isBrokenEndpoint,
} from './cardState'
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
