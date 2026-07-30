/**
 * team-connections.test.ts — unit tests for the PURE decisions in team-connections.ts: body
 * validation for POST/PATCH, and the two uniqueness rules folded into `decideConnectionUpsert`
 * (a known endpoint updates in place; a token owned by a different connection is refused).
 *
 * The whoami-over-the-network / central-`/api/team/leave` parts of the impure handlers are
 * exercised manually against a mock central — see task-4-report.md — not here, per the project's
 * "do not mock the filesystem" testing convention. `leaveConnectionById`'s OWN DI seam
 * (`readPreferences`/`removeConnection`/`log`) is a different case: it never touches the
 * filesystem or the network when all three are injected, so it IS unit-tested below (review
 * finding N3) — specifically the previously-uncovered half of I1, where a lock-timeout write
 * failure inside `removeConnection` must surface as `{ok: false}`, never asserted success.
 */
import { describe, it, expect } from 'bun:test'
import {
  validateConnectionBody, validatePatchBody, decideConnectionUpsert,
  aggregateConnectionStatuses, leaveConnectionById, type ConnectionStatusEntry,
} from './team-connections'
import type { TeamConnection } from '@agentistics/core'
import type { Preferences } from './preferences'

function conn(id: string, extra?: Partial<TeamConnection>): TeamConnection {
  return {
    id,
    endpoint: `https://central-${id}.example.com`,
    org: 'default',
    user: 'alice',
    token: `token-${id}`,
    deniedRepos: [],
    ...extra,
  }
}

describe('validateConnectionBody', () => {
  it('accepts a minimal valid body and trims a trailing slash off the endpoint', () => {
    const out = validateConnectionBody({ endpoint: 'https://central.example.com/', token: 'sekrit' })
    expect(out).toEqual({ endpoint: 'https://central.example.com', token: 'sekrit', org: undefined, label: undefined })
  })

  it('accepts an empty token — a token-less member against an open/legacy central is a live shape', () => {
    const out = validateConnectionBody({ endpoint: 'https://central.example.com', token: '' })
    expect('error' in out).toBe(false)
    if (!('error' in out)) expect(out.token).toBe('')
  })

  it('carries org and label through when present and non-blank', () => {
    const out = validateConnectionBody({ endpoint: 'https://c.example.com', token: 't', org: ' acme ', label: ' Prod ' })
    expect('error' in out).toBe(false)
    if (!('error' in out)) {
      expect(out.org).toBe('acme')
      expect(out.label).toBe('Prod')
    }
  })

  it('treats a blank org/label as absent, not as an empty string', () => {
    const out = validateConnectionBody({ endpoint: 'https://c.example.com', token: 't', org: '   ', label: '' })
    expect('error' in out).toBe(false)
    if (!('error' in out)) {
      expect(out.org).toBeUndefined()
      expect(out.label).toBeUndefined()
    }
  })

  it('rejects a missing/blank endpoint', () => {
    expect('error' in validateConnectionBody({ token: 't' })).toBe(true)
    expect('error' in validateConnectionBody({ endpoint: '   ', token: 't' })).toBe(true)
  })

  it('rejects a non-URL endpoint', () => {
    expect('error' in validateConnectionBody({ endpoint: 'not a url', token: 't' })).toBe(true)
  })

  it('rejects a non-http(s) endpoint scheme', () => {
    expect('error' in validateConnectionBody({ endpoint: 'file:///etc/passwd', token: 't' })).toBe(true)
    expect('error' in validateConnectionBody({ endpoint: 'javascript:alert(1)', token: 't' })).toBe(true)
  })

  it('rejects junk shapes without throwing', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      expect('error' in validateConnectionBody(junk)).toBe(true)
    }
  })

  it('does not trim a token — accidental whitespace padding must not be silently normalized', () => {
    const out = validateConnectionBody({ endpoint: 'https://central.example.com', token: ' sekrit ' })
    expect('error' in out).toBe(false)
    if (!('error' in out)) expect(out.token).toBe(' sekrit ')
  })
})

describe('validatePatchBody', () => {
  it('accepts and trims a label', () => {
    expect(validatePatchBody({ label: '  Prod East  ' })).toEqual({ label: 'Prod East' })
  })

  it('accepts an empty string — a legitimate "clear the label"', () => {
    expect(validatePatchBody({ label: '' })).toEqual({ label: '' })
  })

  it('rejects a missing or non-string label', () => {
    expect('error' in validatePatchBody({})).toBe(true)
    expect('error' in validatePatchBody({ label: 42 })).toBe(true)
    expect('error' in validatePatchBody({ label: null })).toBe(true)
  })

  it('rejects junk shapes without throwing', () => {
    for (const junk of [null, undefined, 'nope', [], 7]) {
      expect('error' in validatePatchBody(junk)).toBe(true)
    }
  })
})

describe('decideConnectionUpsert — the two uniqueness rules', () => {
  it('an unknown endpoint with an unused token inserts', () => {
    const decision = decideConnectionUpsert([], 'https://new.example.com', 'fresh-token')
    expect(decision.action).toBe('insert')
  })

  it('a known normalized endpoint updates in place, EVEN WITH A NEW token (token rotation)', () => {
    const existing = conn('c_a')
    const decision = decideConnectionUpsert([existing], existing.endpoint, 'rotated-token-not-seen-before')
    expect(decision.action).toBe('update')
    if (decision.action === 'update') expect(decision.existing.id).toBe('c_a')
  })

  it('endpoint matching ignores a trailing slash and re-adding the SAME token still updates', () => {
    const existing = conn('c_a', { endpoint: 'https://central.example.com' })
    const decision = decideConnectionUpsert([existing], 'https://central.example.com/', existing.token)
    expect(decision.action).toBe('update')
  })

  it('endpoint matching is case-insensitive on the HOST — a different host case still updates in place', () => {
    // The exact double-count-under-two-memberIds failure endpoint-uniqueness exists to prevent:
    // without host normalization this would insert a SECOND connection for the same central.
    const existing = conn('c_a', { endpoint: 'https://central.example.com' })
    const decision = decideConnectionUpsert([existing], 'https://Central.EXAMPLE.com', 'new-token')
    expect(decision.action).toBe('update')
    if (decision.action === 'update') expect(decision.existing.id).toBe('c_a')
  })

  it('endpoint matching folds the scheme default port — :443 compares equal to no port on https', () => {
    const existing = conn('c_a', { endpoint: 'https://central.example.com' })
    const decision = decideConnectionUpsert([existing], 'https://central.example.com:443', 'new-token')
    expect(decision.action).toBe('update')
  })

  it('a token is compared EXACTLY — whitespace padding never collides with the stored bare token', () => {
    // Documents intentional behavior: tokens are opaque secrets and are never trimmed/normalized
    // for comparison, unlike an endpoint. A padded token reads as a genuinely different token.
    const existing = conn('c_a', { token: 'abc123' })
    const decision = decideConnectionUpsert([existing], 'https://different-endpoint.example.com', ' abc123 ')
    expect(decision.action).toBe('insert')
  })

  it('a token already owned by a DIFFERENT connection is refused, even for a brand-new endpoint', () => {
    const other = conn('c_other', { token: 'shared-token' })
    const decision = decideConnectionUpsert([other], 'https://different-endpoint.example.com', 'shared-token')
    expect(decision.action).toBe('conflict')
    if (decision.action === 'conflict') expect(decision.existing.id).toBe('c_other')
  })

  it('re-adding the SAME endpoint with a token owned by a DIFFERENT connection is still refused, not update', () => {
    // The endpoint match alone must not win over a genuine token collision: after the update the
    // two connections would share one token, and the central keys members by sha256(token) — a
    // shared token collapses both onto the same memberId and would alternately replaceOne the
    // same stats document.
    const target = conn('c_target', { endpoint: 'https://target.example.com', token: 'target-token' })
    const other = conn('c_other', { endpoint: 'https://other.example.com', token: 'other-token' })
    const decision = decideConnectionUpsert([target, other], target.endpoint, other.token)
    expect(decision.action).toBe('conflict')
    if (decision.action === 'conflict') expect(decision.existing.id).toBe('c_other')
  })

  it('an empty token never triggers a conflict — several token-less members may coexist', () => {
    const a = conn('c_a', { endpoint: 'https://a.example.com', token: '' })
    const decision = decideConnectionUpsert([a], 'https://b.example.com', '')
    expect(decision.action).toBe('insert')
  })
})

function statusEntry(id: string, extra?: Partial<ConnectionStatusEntry>): ConnectionStatusEntry {
  return {
    id, endpoint: `https://${id}.example.com`, org: 'default', user: 'alice',
    lastSuccessAt: null, errKind: null, latencyMs: null,
    ...extra,
  }
}

describe('aggregateConnectionStatuses — the top-level status the pill reads', () => {
  it('no connections aggregates to a fresh/unknown status', () => {
    expect(aggregateConnectionStatuses([])).toEqual({ lastSuccessAt: null, errKind: null, latencyMs: null })
  })

  it('lastSuccessAt is the MOST RECENT across connections', () => {
    const out = aggregateConnectionStatuses([
      statusEntry('a', { lastSuccessAt: 1000 }),
      statusEntry('b', { lastSuccessAt: 3000 }),
      statusEntry('c', { lastSuccessAt: 2000 }),
    ])
    expect(out.lastSuccessAt).toBe(3000)
  })

  it('errKind is the WORST currently in force: auth outranks net outranks null', () => {
    expect(aggregateConnectionStatuses([statusEntry('a', { errKind: 'net' }), statusEntry('b', { errKind: 'auth' })]).errKind).toBe('auth')
    expect(aggregateConnectionStatuses([statusEntry('a', { errKind: null }), statusEntry('b', { errKind: 'net' })]).errKind).toBe('net')
    expect(aggregateConnectionStatuses([statusEntry('a', { errKind: null }), statusEntry('b', { errKind: null })]).errKind).toBeNull()
  })

  it('latencyMs is taken from the connection that produced the chosen lastSuccessAt', () => {
    const out = aggregateConnectionStatuses([
      statusEntry('a', { lastSuccessAt: 1000, latencyMs: 5 }),
      statusEntry('b', { lastSuccessAt: 3000, latencyMs: 42 }),
    ])
    expect(out.lastSuccessAt).toBe(3000)
    expect(out.latencyMs).toBe(42)
  })

  it('a connection that has never succeeded does not contribute a lastSuccessAt/latencyMs', () => {
    const out = aggregateConnectionStatuses([statusEntry('a', { lastSuccessAt: null, latencyMs: null, errKind: 'net' })])
    expect(out.lastSuccessAt).toBeNull()
    expect(out.latencyMs).toBeNull()
    expect(out.errKind).toBe('net')
  })
})

// ---------------------------------------------------------------------------
// leaveConnectionById — DI-tested (review finding N3): with readPreferences/removeConnection/log
// all injected, this never touches the filesystem or a real central. The endpoint used below
// (127.0.0.1:1, a privileged port nothing listens on) makes the best-effort POST to the central's
// /api/team/leave fail fast and be swallowed, same as it would be for a genuinely offline
// central — irrelevant to what these tests assert.
// ---------------------------------------------------------------------------

function fakePrefsWith(connections: TeamConnection[]): () => Promise<Preferences> {
  return async () => ({ team: { schema: 2, mode: 'member', connections } }) as Preferences
}

describe('leaveConnectionById', () => {
  it('a removeConnection write failure (e.g. a lock timeout) surfaces as ok:false, never asserted success', async () => {
    const target = conn('c_aaaaaaaaaaaa', { endpoint: 'http://127.0.0.1:1' })
    const result = await leaveConnectionById(target.id, {
      readPreferences: fakePrefsWith([target]),
      removeConnection: async () => ({ removed: false, error: 'preferences write lock timed out' }),
    })
    expect(result).toEqual({ ok: false, error: 'preferences write lock timed out' })
  })

  it('a successful removeConnection reports ok:true with the removed connection\'s endpoint', async () => {
    const target = conn('c_bbbbbbbbbbbb', { endpoint: 'http://127.0.0.1:1' })
    const result = await leaveConnectionById(target.id, {
      readPreferences: fakePrefsWith([target]),
      removeConnection: async () => ({ removed: true }),
    })
    expect(result).toEqual({ ok: true, endpoint: target.endpoint })
  })

  it('an unknown connection id is refused before removeConnection is ever called', async () => {
    let called = false
    const result = await leaveConnectionById('c_ffffffffffff', {
      readPreferences: fakePrefsWith([]), // empty — the id below matches nothing
      removeConnection: async () => { called = true; return { removed: true } },
    })
    expect(result).toEqual({ ok: false, error: 'unknown connection' })
    expect(called).toBe(false)
  })

  it('deps.log is forwarded to removeConnection verbatim (review finding N5) — the seam actually reaches its consumer', async () => {
    const target = conn('c_cccccccccccc', { endpoint: 'http://127.0.0.1:1' })
    let receivedLog: unknown = null
    const fakeRemoveConnection = (async (
      _id: string,
      _reason: 'revoked' | 'manual',
      innerDeps?: { log?: unknown },
    ) => {
      receivedLog = innerDeps?.log
      return { removed: true } as const
    }) as unknown as typeof import('./team-uploader').removeConnection
    const myLog = { info: () => {}, warn: () => {} }
    await leaveConnectionById(target.id, {
      readPreferences: fakePrefsWith([target]),
      removeConnection: fakeRemoveConnection,
      log: myLog,
    })
    expect(receivedLog).toBe(myLog)
  })
})
