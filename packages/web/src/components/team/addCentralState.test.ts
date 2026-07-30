import { test, expect } from 'bun:test'
import { NO_REPO_KEY, packConnectToken, type TeamConnection } from '@agentistics/core'
import type { ShareTarget } from '../../lib/shareRepos'
import { toggleTarget } from './repoPanelState'
import {
  unpackToken, canOpenRules, canConnect, resolveDupeState, computeDirty, buildSubmitBody,
  buildDefaultDraft, type TestOutcome, type DupeState,
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

test('the submit body carries exactly endpoint/token/org/deniedRepos, trailing-slash-trimmed, label omitted when blank', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com/', token: 'sekrit', org: 'acme', label: '',
    deniedKeys: new Set(),
  })
  expect(body).toEqual({ endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme', deniedRepos: [] })
})

test('the submit body includes label when non-blank', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme', label: '  Prod  ',
    deniedKeys: new Set(),
  })
  expect(body.label).toBe('Prod')
})

test('deniedRepos includes NO_REPO_KEY the moment anything is blocked, even if it was never explicitly chosen', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme', label: '',
    deniedKeys: new Set(['github.com/org/repo']),
  })
  expect(new Set(body.deniedRepos)).toEqual(new Set(['github.com/org/repo', NO_REPO_KEY]))
})

test('deniedRepos stays [] when nothing is blocked', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme', label: '',
    deniedKeys: new Set(),
  })
  expect(body.deniedRepos).toEqual([])
})

test('deniedRepos does not duplicate NO_REPO_KEY when it was already explicitly chosen', () => {
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com', token: 'sekrit', org: 'acme', label: '',
    deniedKeys: new Set(['github.com/org/repo', NO_REPO_KEY]),
  })
  expect(body.deniedRepos.filter(k => k === NO_REPO_KEY).length).toBe(1)
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
