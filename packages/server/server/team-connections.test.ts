/**
 * team-connections.test.ts — unit tests for the PURE decisions in team-connections.ts: body
 * validation for POST/PATCH, and the two uniqueness rules folded into `decideConnectionUpsert`
 * (a known endpoint updates in place; a token owned by a different connection is refused).
 *
 * The impure handlers (whoami over the network, the preferences write chain, the central
 * /api/team/leave call) are exercised manually against a mock central — see task-4-report.md —
 * not here, per the project's "do not mock the filesystem" testing convention.
 */
import { describe, it, expect } from 'bun:test'
import {
  validateConnectionBody, validatePatchBody, decideConnectionUpsert,
} from './team-connections'
import type { TeamConnection } from '@agentistics/core'

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
    for (const junk of [null, undefined, 42, 'nope', [], []]) {
      expect('error' in validateConnectionBody(junk)).toBe(true)
    }
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

  it('updating a connection with the token it ALREADY holds is not a conflict with itself', () => {
    const existing = conn('c_a', { token: 'same-token' })
    const decision = decideConnectionUpsert([existing], existing.endpoint, 'same-token')
    expect(decision.action).toBe('update')
  })

  it('two existing connections with distinct endpoints and tokens: a third insert is unaffected', () => {
    const a = conn('c_a')
    const b = conn('c_b')
    const decision = decideConnectionUpsert([a, b], 'https://c.example.com', 'token-c')
    expect(decision.action).toBe('insert')
  })
})
