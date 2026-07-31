import { test, expect } from 'bun:test'
import { NO_REPO_KEY, packConnectToken, type TeamConnection } from '@agentistics/core'
import type { ShareTarget } from '../../lib/shareRepos'
import { toggleTarget } from './repoPanelState'
import {
  unpackToken, canOpenRules, canConnect, canAttemptTest, resolveDupeState, computeDirty,
  buildSubmitBody, buildDefaultDraft, type TestOutcome, type DupeState,
} from './addCentralState'

function conn(over: Partial<TeamConnection>): TeamConnection {
  return {
    id: 'c_existing', endpoint: 'https://central.example.com', org: 'default',
    user: 'lucas', token: 'existing-token', deniedRepos: [],
    ...over,
  }
}

function target(over: Partial<ShareTarget>): ShareTarget {
  return {
    key: 'github.com/org/repo', kind: 'repo', name: 'org/repo', host: 'github.com',
    sessions: 3, lastActive: '', orphan: false, conflictPaths: [],
    ...over,
  }
}

const OK: TestOutcome = { ok: true, user: 'lucas', org: 'acme' }
const ERR: TestOutcome = { ok: false, error: 'network error' }
const NONE_DUPE: DupeState = { kind: 'none' }

// --- 1. token unpacking ------------------------------------------------------------------------

test('an act1_ token yields the embedded endpoint and the bare secret', () => {
  const packed = packConnectToken('sekrit-value', 'https://central.example.com')
  const out = unpackToken(packed)
  expect(out).toEqual({ endpoint: 'https://central.example.com', token: 'sekrit-value' })
})

test('a plain token yields no endpoint and the token unchanged', () => {
  const out = unpackToken('plain-secret-123')
  expect(out).toEqual({ endpoint: '', token: 'plain-secret-123' })
})

test('junk starting with act1_ that does not decode does not throw and does not fabricate an endpoint', () => {
  const out = unpackToken('act1_%%%not-base64%%%.rest-of-it')
  expect(() => unpackToken('act1_%%%not-base64%%%.rest-of-it')).not.toThrow()
  // Falls back to treating the WHOLE input as the raw secret — no endpoint is invented.
  expect(out.endpoint).toBe('')
  expect(out.token).toBe('act1_%%%not-base64%%%.rest-of-it')
})

// --- 2. the step machine -----------------------------------------------------------------------

test('step 2 (rules) is unreachable until a successful test', () => {
  expect(canOpenRules(null, NONE_DUPE)).toBe(false)
  expect(canOpenRules(ERR, NONE_DUPE)).toBe(false)
  expect(canOpenRules(OK, NONE_DUPE)).toBe(true)
})

test('a token-in-use pairing blocks step 2 even after an otherwise-successful test', () => {
  const dupe: DupeState = { kind: 'tokenInUse', existing: conn({}) }
  expect(canOpenRules(OK, dupe)).toBe(false)
})

test('Connect is unreachable from step 1, even with a passing test', () => {
  expect(canConnect('identity', OK, NONE_DUPE)).toBe(false)
})

test('Connect is reachable from step 2 only once the same gate that unlocked it is satisfied', () => {
  expect(canConnect('rules', OK, NONE_DUPE)).toBe(true)
  expect(canConnect('rules', ERR, NONE_DUPE)).toBe(false)
  expect(canConnect('rules', OK, { kind: 'tokenInUse', existing: conn({}) })).toBe(false)
})

// --- 2b. the merged "Save tests, then continues" action — one primary button, no separate ------
//        required "Test connection" click; a tokenInUse pairing still fires NO request at all.

test('the primary action may attempt a test once an endpoint is typed and the token is not claimed elsewhere', () => {
  expect(canAttemptTest('https://central.example.com', NONE_DUPE)).toBe(true)
})

test('an empty endpoint blocks the attempt — nothing to test yet', () => {
  expect(canAttemptTest('', NONE_DUPE)).toBe(false)
  expect(canAttemptTest('   ', NONE_DUPE)).toBe(false)
})

test('a token already in use blocks the attempt outright — no request may fire for this pairing', () => {
  const dupe: DupeState = { kind: 'tokenInUse', existing: conn({}) }
  expect(canAttemptTest('https://central.example.com', dupe)).toBe(false)
})

test('a plain duplicate endpoint (token rotation) does not block the attempt', () => {
  const dupe: DupeState = { kind: 'duplicate', existing: conn({}) }
  expect(canAttemptTest('https://central.example.com', dupe)).toBe(true)
})

test('a successful test through the merged action still unlocks step 2 via the same gate', () => {
  // The merged action runs the test, then re-checks the SAME canOpenRules gate used by the old
  // separate "Continue" button — success advances, failure (or a since-changed dupe) does not.
  expect(canOpenRules(OK, NONE_DUPE)).toBe(true)
  expect(canOpenRules(ERR, NONE_DUPE)).toBe(false)
})

// --- 3. duplicate endpoint detected by the SAME normalized-endpoint rule ------------------------

test('a duplicate endpoint is detected case- and trailing-slash-insensitively', () => {
  const existing = conn({ id: 'c_a', endpoint: 'https://central.example.com', token: 'tok-a' })
  const stored = [existing]
  expect(resolveDupeState(stored, 'https://Central.example.com', 'brand-new-token'))
    .toEqual({ kind: 'duplicate', existing })
  expect(resolveDupeState(stored, 'https://central.example.com/', 'brand-new-token'))
    .toEqual({ kind: 'duplicate', existing })
})

test('an unknown endpoint with an unused token is neither a duplicate nor a conflict', () => {
  const stored = [conn({ id: 'c_a', endpoint: 'https://central.example.com', token: 'tok-a' })]
  expect(resolveDupeState(stored, 'https://different.example.com', 'brand-new-token')).toEqual({ kind: 'none' })
})

test('an empty endpoint never resolves to a dupe, however the connections look', () => {
  const stored = [conn({ id: 'c_a', endpoint: 'https://central.example.com', token: 'tok-a' })]
  expect(resolveDupeState(stored, '', 'tok-a')).toEqual({ kind: 'none' })
})

// --- 4. a token belonging to another connection blocks submission ------------------------------

test('a token already owned by a different connection is tokenInUse, even for a brand-new endpoint', () => {
  const other = conn({ id: 'c_other', endpoint: 'https://other.example.com', token: 'shared-token' })
  const out = resolveDupeState([other], 'https://new-endpoint.example.com', 'shared-token')
  expect(out).toEqual({ kind: 'tokenInUse', existing: other })
})

test('re-adding the SAME endpoint with a token owned by a DIFFERENT connection is still tokenInUse, not duplicate', () => {
  const existing = conn({ id: 'c_a', endpoint: 'https://central.example.com', token: 'tok-a' })
  const other = conn({ id: 'c_b', endpoint: 'https://other.example.com', token: 'shared-token' })
  const out = resolveDupeState([existing, other], 'https://central.example.com', 'shared-token')
  expect(out).toEqual({ kind: 'tokenInUse', existing: other })
})

test('re-adding the SAME endpoint with the SAME token it already owns is a duplicate, not a conflict with itself', () => {
  const existing = conn({ id: 'c_a', endpoint: 'https://central.example.com', token: 'tok-a' })
  const out = resolveDupeState([existing], 'https://central.example.com', 'tok-a')
  expect(out).toEqual({ kind: 'duplicate', existing })
})

// --- 5. the submit body --------------------------------------------------------------------------

test('the submit body carries exactly endpoint/token/org/shareMode/sources, trailing-slash-trimmed — no label field, ever', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com/', token: 'sekrit', org: 'acme',
    mode: 'denylist', submitted: { projectRows: [], repoKeys: new Set(), projectPaths: new Set() },
  })
  expect(body).toEqual({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme',
    shareMode: 'denylist', sources: [],
  })
  expect('label' in body).toBe(false)
})

test('denylist sources widen in NO_REPO_KEY the moment anything is blocked, even if it was never explicitly chosen', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme',
    mode: 'denylist', submitted: { projectRows: [], repoKeys: new Set(['github.com/org/repo']), projectPaths: new Set() },
  })
  const values = new Set(body.sources.map(s => s.type === 'none' ? NO_REPO_KEY : s.value))
  expect(values).toEqual(new Set(['github.com/org/repo', NO_REPO_KEY]))
})

test('sources stays [] when nothing is blocked', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme',
    mode: 'denylist', submitted: { projectRows: [], repoKeys: new Set(), projectPaths: new Set() },
  })
  expect(body.sources).toEqual([])
})

test('the none source is never duplicated when NO_REPO_KEY was already explicitly chosen', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme',
    mode: 'denylist', submitted: { projectRows: [], repoKeys: new Set(['github.com/org/repo', NO_REPO_KEY]), projectPaths: new Set() },
  })
  expect(body.sources.filter(s => s.type === 'none').length).toBe(1)
})

test('allowlist mode never widens in NO_REPO_KEY — an empty allowlist must stay empty, not silently share nothing extra', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme',
    mode: 'allowlist', submitted: { projectRows: [], repoKeys: new Set(['github.com/org/repo']), projectPaths: new Set() },
  })
  expect(body.sources.some(s => s.type === 'none')).toBe(false)
  expect(body.shareMode).toBe('allowlist')
})

test('project sources round-trip into the submit body alongside repo sources', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme',
    mode: 'denylist', submitted: { projectRows: [], repoKeys: new Set(), projectPaths: new Set(['/home/user/app']) },
  })
  expect(body.sources).toContainEqual({ type: 'project', value: '/home/user/app' })
})

// --- 6. dirty ------------------------------------------------------------------------------------

test('dirty is false on a pristine drawer', () => {
  expect(computeDirty('', '', false)).toBe(false)
})

test('dirty is true after a token is typed', () => {
  expect(computeDirty('some-token', '', false)).toBe(true)
})

test('dirty is true after an endpoint is typed', () => {
  expect(computeDirty('', 'https://central.example.com', false)).toBe(true)
})

test('dirty is true after a step-2 rule is toggled', () => {
  expect(computeDirty('', '', true)).toBe(true)
})

// --- 7. a locked (conflictPaths) row cannot be shared from this wizard either -------------------

test('the default draft blocks a locked row even though step 2 defaults to share-everything', () => {
  const locked = target({ key: 'mixed/folder', conflictPaths: ['/home/user/mixed'] })
  const open = target({ key: 'github.com/org/open', conflictPaths: [] })
  const draft = buildDefaultDraft([locked, open])
  expect(draft.has(locked.key)).toBe(true)
  expect(draft.has(open.key)).toBe(false)
})

test('toggling a locked row from the wizard is a no-op — it stays blocked', () => {
  const locked = target({ key: 'mixed/folder', conflictPaths: ['/home/user/mixed'] })
  const draft = buildDefaultDraft([locked])
  const next = toggleTarget(draft, locked, /* nextShared */ true)
  expect(next.has(locked.key)).toBe(true)
})
