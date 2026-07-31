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
import { describe, it, expect, afterEach } from 'bun:test'
import {
  validateConnectionBody, validatePatchBody, decideConnectionUpsert,
  aggregateConnectionStatuses, leaveConnectionById, resolveShareRules, ruleCountsOf,
  buildConnectionStatusEntry, otelExportEnabled, addOrUpdateConnection, type ConnectionStatusEntry,
} from './team-connections'
import type { TeamConnection, TeamConfig, ShareSource } from '@agentistics/core'
import { NO_REPO_KEY } from '@agentistics/core'
import type { Preferences, TeamConfigMutator } from './preferences'
import type { UploaderStatus } from './team-uploader'
import { rulesSignature } from './share-rules'

function conn(id: string, extra?: Partial<TeamConnection>): TeamConnection {
  return {
    id,
    endpoint: `https://central-${id}.example.com`,
    org: 'default',
    user: 'alice',
    token: `token-${id}`,
    deniedRepos: [],
    shareMode: 'denylist',
    sources: [],
    ...extra,
  }
}

const repoSrc = (value: string): ShareSource => ({ type: 'repo', value })
const projectSrc = (value: string): ShareSource => ({ type: 'project', value })
const noneSrc = (): ShareSource => ({ type: 'none', value: '' })

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

  it('accepts an omitted sources/shareMode as absent', () => {
    const out = validateConnectionBody({ endpoint: 'https://central.example.com', token: 't' })
    expect('error' in out).toBe(false)
    if (!('error' in out)) {
      expect(out.sources).toBeUndefined()
      expect(out.shareMode).toBeUndefined()
    }
  })

  it('accepts a typed sources array plus a shareMode', () => {
    const out = validateConnectionBody({
      endpoint: 'https://central.example.com', token: 't',
      shareMode: 'allowlist', sources: [repoSrc('github.com/o/r'), projectSrc('/p/a')],
    })
    expect('error' in out).toBe(false)
    if (!('error' in out)) {
      expect(out.shareMode).toBe('allowlist')
      expect(out.sources).toEqual([repoSrc('github.com/o/r'), projectSrc('/p/a')])
    }
  })

  it('rejects an unknown source type, a non-string value, or a non-object entry as 400', () => {
    for (const junk of [
      [{ type: 'bogus', value: 'x' }], [{ type: 'repo', value: 42 }], ['not-an-object'], [null], [{}],
    ]) {
      expect('error' in validateConnectionBody({ endpoint: 'https://central.example.com', token: 't', sources: junk })).toBe(true)
    }
  })

  it('rejects a non-array sources as 400', () => {
    expect('error' in validateConnectionBody({ endpoint: 'https://central.example.com', token: 't', sources: 'nope' })).toBe(true)
  })

  it('rejects an unknown shareMode as 400', () => {
    expect('error' in validateConnectionBody({ endpoint: 'https://central.example.com', token: 't', shareMode: 'bogus' })).toBe(true)
  })

  it('accepts the legacy deniedRepos shape and converts it to typed repo/none sources', () => {
    const out = validateConnectionBody({ endpoint: 'https://central.example.com', token: 't', deniedRepos: ['github.com/o/r', NO_REPO_KEY] })
    expect('error' in out).toBe(false)
    if (!('error' in out)) {
      expect(out.sources).toEqual([repoSrc('github.com/o/r'), noneSrc()])
      expect((out as unknown as Record<string, unknown>).deniedRepos).toBeUndefined()
    }
  })

  it('rejects a non-array or mixed-type legacy deniedRepos as 400, without throwing', () => {
    for (const junk of ['github.com/o/r', 42, { repo: 'x' }, ['ok', 42], [null], [{}]]) {
      expect('error' in validateConnectionBody({ endpoint: 'https://central.example.com', token: 't', deniedRepos: junk })).toBe(true)
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

  it('rejects a body with neither label, shareMode nor sources — nothing to update', () => {
    expect('error' in validatePatchBody({})).toBe(true)
  })

  it('accepts a sources-only body, with no label', () => {
    const out = validatePatchBody({ sources: [repoSrc('github.com/o/r')] })
    expect(out).toEqual({ sources: [repoSrc('github.com/o/r')] })
  })

  it('accepts an empty sources array — the explicit "clear all rules" shape', () => {
    expect(validatePatchBody({ sources: [] })).toEqual({ sources: [] })
  })

  it('accepts a shareMode-only body — a pure mode switch that keeps the existing sources', () => {
    expect(validatePatchBody({ shareMode: 'allowlist' })).toEqual({ shareMode: 'allowlist' })
  })

  it('accepts label and sources together', () => {
    const out = validatePatchBody({ label: 'Prod', sources: [noneSrc()] })
    expect(out).toEqual({ label: 'Prod', sources: [noneSrc()] })
  })

  it('rejects a non-array or mixed-type sources as 400, without throwing', () => {
    for (const junk of ['x', 42, { repo: 'x' }, ['ok', 42], [null], [{ type: 'bogus', value: 'x' }]]) {
      expect('error' in validatePatchBody({ sources: junk })).toBe(true)
    }
  })

  it('rejects an unknown shareMode as 400', () => {
    expect('error' in validatePatchBody({ shareMode: 'bogus' })).toBe(true)
  })

  it('rejects an oversized sources list as 400', () => {
    const huge = Array.from({ length: 2001 }, (_, i) => repoSrc(`github.com/o/r${i}`))
    expect('error' in validatePatchBody({ sources: huge })).toBe(true)
  })

  it('accepts the legacy deniedRepos shape and converts it to typed sources', () => {
    const out = validatePatchBody({ deniedRepos: ['github.com/o/r'] })
    expect(out).toEqual({ sources: [repoSrc('github.com/o/r')] })
  })

  it('rejects a non-array or mixed-type legacy deniedRepos as 400, without throwing', () => {
    for (const junk of ['x', 42, { repo: 'x' }, ['ok', 42], [null]]) {
      expect('error' in validatePatchBody({ deniedRepos: junk })).toBe(true)
    }
  })
})

describe('resolveShareRules — the zero→non-zero transition rule (§4.2), denylist mode', () => {
  it('a brand-new (undefined) previous gaining its first entries gets the none bucket appended', () => {
    const out = resolveShareRules(undefined, { sources: [repoSrc('github.com/o/r')] })
    expect(out).toEqual({ mode: 'denylist', sources: [repoSrc('github.com/o/r'), noneSrc()] })
  })

  it('an empty previous gaining its first entries gets the none bucket appended', () => {
    const out = resolveShareRules({ mode: 'denylist', sources: [] }, { sources: [repoSrc('github.com/o/r')] })
    expect(out.sources).toEqual([repoSrc('github.com/o/r'), noneSrc()])
  })

  it('an empty→empty edit stays empty — no restriction is ever created from nothing', () => {
    expect(resolveShareRules(undefined, { sources: [] })).toEqual({ mode: 'denylist', sources: [] })
    expect(resolveShareRules({ mode: 'denylist', sources: [] }, { sources: [] })).toEqual({ mode: 'denylist', sources: [] })
  })

  it('applying the transition twice from the same starting point is idempotent', () => {
    const first = resolveShareRules({ mode: 'denylist', sources: [] }, { sources: [repoSrc('github.com/o/r')] })
    const second = resolveShareRules({ mode: 'denylist', sources: [] }, { sources: [repoSrc('github.com/o/r')] })
    expect(first).toEqual(second)
  })

  it('an already-restricted connection editing its list WITHOUT the none bucket is honoured as-is — no forced re-add', () => {
    const out = resolveShareRules({ mode: 'denylist', sources: [repoSrc('github.com/o/old'), noneSrc()] }, { sources: [repoSrc('github.com/o/new')] })
    expect(out.sources).toEqual([repoSrc('github.com/o/new')])
  })

  it('an already-restricted connection keeping the none bucket explicitly is honoured as-is, not duplicated', () => {
    const sources = [repoSrc('github.com/o/r'), noneSrc()]
    const out = resolveShareRules({ mode: 'denylist', sources }, { sources })
    expect(out.sources).toEqual(sources)
  })

  it('an already-restricted connection un-blocking everything is honoured as-is (no re-add of the none bucket)', () => {
    const out = resolveShareRules({ mode: 'denylist', sources: [repoSrc('github.com/o/r'), noneSrc()] }, { sources: [] })
    expect(out.sources).toEqual([])
  })

  it('an omitted mode/sources in the request keeps whatever the connection already has', () => {
    const out = resolveShareRules({ mode: 'allowlist', sources: [repoSrc('github.com/o/r')] }, {})
    expect(out).toEqual({ mode: 'allowlist', sources: [repoSrc('github.com/o/r')] })
  })
})

describe('resolveShareRules — allowlist mode: never auto-adds the none bucket', () => {
  it('switching to allowlist with sources does not gain the none bucket', () => {
    const out = resolveShareRules({ mode: 'denylist', sources: [] }, { mode: 'allowlist', sources: [repoSrc('github.com/o/r')] })
    expect(out).toEqual({ mode: 'allowlist', sources: [repoSrc('github.com/o/r')] })
  })

  it('switching to allowlist with an EMPTY source list is honoured as-is — the explicit "share nothing" shape', () => {
    const out = resolveShareRules({ mode: 'denylist', sources: [] }, { mode: 'allowlist', sources: [] })
    expect(out).toEqual({ mode: 'allowlist', sources: [] })
  })

  it('a bigger shrink: denylist→allowlist with the SAME source list changes what is shared, and the sources are honoured as-is', () => {
    const sources = [repoSrc('github.com/o/r')]
    const out = resolveShareRules({ mode: 'denylist', sources }, { mode: 'allowlist' })
    expect(out).toEqual({ mode: 'allowlist', sources })
  })
})

describe('ruleCountsOf — status route per-dimension counts, never the values', () => {
  it('denylist mode splits repo(+none) and project counts, and reports allowedCount:0', () => {
    const out = ruleCountsOf('denylist', [repoSrc('github.com/o/r'), noneSrc(), projectSrc('/p/a'), projectSrc('/p/b')])
    expect(out).toEqual({ shareMode: 'denylist', deniedRepos: 2, deniedProjects: 2, allowedCount: 0 })
  })

  it('allowlist mode reports one combined allowedCount, and zero for the denylist fields', () => {
    const out = ruleCountsOf('allowlist', [repoSrc('github.com/o/r'), projectSrc('/p/a')])
    expect(out).toEqual({ shareMode: 'allowlist', deniedRepos: 0, deniedProjects: 0, allowedCount: 2 })
  })

  it('mode absent/junk reads as denylist, the same default as shareRulesOf', () => {
    expect(ruleCountsOf(undefined, [repoSrc('github.com/o/r')]).shareMode).toBe('denylist')
  })

  it('counts are of the NORMALIZED set — duplicate/case-variant repo entries collapse to one', () => {
    const out = ruleCountsOf('denylist', [repoSrc('github.com/o/r'), repoSrc('GitHub.com/O/R')])
    expect(out.deniedRepos).toBe(1)
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

// ---------------------------------------------------------------------------
// addOrUpdateConnection — DI-tested (review follow-up, Important 2): reconnecting with a
// whoami-VERIFIED token must clear a connection's `authFailedAt` mark. `whoamiVerify` and
// `updateTeamConfig` are both injected — the defaults hit the real network and the developer's
// real ~/.agentistics/preferences.json, which a test must never do.
// ---------------------------------------------------------------------------

describe('addOrUpdateConnection — clears authFailedAt on a whoami-verified reconnect (review Important 2)', () => {
  it('an update against a connection currently marked auth-failed leaves authFailedAt undefined', async () => {
    const existing = conn('c_a', { authFailedAt: '2026-07-20T10:00:00.000Z', deniedRepos: ['github.com/o/secret'] })
    let store: TeamConfig = { schema: 2, mode: 'member', connections: [existing] }
    const fakeUpdateTeamConfig = async (mutate: TeamConfigMutator): Promise<TeamConfig> => {
      const next = mutate(store)
      if (next !== undefined) store = next
      return store
    }
    const fakeWhoamiVerify = async () => ({ ok: true as const, user: 'alice', org: 'default' })

    const result = await addOrUpdateConnection(
      { endpoint: existing.endpoint, token: 'rotated-good-token' },
      { updateTeamConfig: fakeUpdateTeamConfig, whoamiVerify: fakeWhoamiVerify },
    )

    expect(result).toEqual({ ok: true, action: 'update', connId: 'c_a' })
    const updated = store.connections.find(c => c.id === 'c_a')!
    // The token demonstrably works (whoami just proved it) — the mark must not survive.
    expect(updated.authFailedAt).toBeUndefined()
    expect(updated.token).toBe('rotated-good-token')
    // Nothing else about the connection's identity or rules was disturbed by clearing the mark.
    expect(updated.deniedRepos).toEqual(['github.com/o/secret'])
    expect(updated.id).toBe('c_a')
  })

  it('a rejected whoami leaves an existing mark untouched (verify-failed, no store write at all)', async () => {
    const existing = conn('c_a', { authFailedAt: '2026-07-20T10:00:00.000Z' })
    let store: TeamConfig = { schema: 2, mode: 'member', connections: [existing] }
    const fakeUpdateTeamConfig = async (mutate: TeamConfigMutator): Promise<TeamConfig> => {
      const next = mutate(store)
      if (next !== undefined) store = next
      return store
    }
    const fakeWhoamiVerify = async () => ({ ok: false as const, error: 'the central rejected this token' })

    const result = await addOrUpdateConnection(
      { endpoint: existing.endpoint, token: 'still-bad-token' },
      { updateTeamConfig: fakeUpdateTeamConfig, whoamiVerify: fakeWhoamiVerify },
    )

    expect(result).toEqual({ ok: false, reason: 'verify-failed', error: 'the central rejected this token' })
    expect(store.connections.find(c => c.id === 'c_a')!.authFailedAt).toBe('2026-07-20T10:00:00.000Z')
  })
})

function statusEntry(id: string, extra?: Partial<ConnectionStatusEntry>): ConnectionStatusEntry {
  return {
    id, endpoint: `https://${id}.example.com`, org: 'default', user: 'alice',
    lastSuccessAt: null, errKind: null, latencyMs: null,
    shareMode: 'denylist', deniedRepos: 0, deniedProjects: 0, allowedCount: 0,
    deniedCount: 0, restricted: false, boundary: null, prehistorySessions: null,
    canForget: false, centralTooOld: true, resync: null, pendingRules: false,
    ...extra,
  }
}

const NEVER_RAN: UploaderStatus = { lastSuccessAt: null, errKind: null, latencyMs: null }

describe('buildConnectionStatusEntry — the per-connection status shape (§5.9, Task 4)', () => {
  it('restricted comes from the STORED sources, never from uploader state — a connection with no cycle yet is still restricted', () => {
    const c = conn('c_a', { sources: [repoSrc('github.com/o/r'), noneSrc()] })
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: false, resync: null, rulesHash: '',
    })
    expect(entry.restricted).toBe(true)
    expect(entry.deniedCount).toBe(2)
    expect(entry.shareMode).toBe('denylist')
    expect(entry.deniedRepos).toBe(2) // repo + none both count toward the repo dimension
    expect(entry.deniedProjects).toBe(0)
    expect(entry.allowedCount).toBe(0)
  })

  it('an unrestricted connection reports restricted:false and deniedCount:0', () => {
    const c = conn('c_a', { sources: [] })
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '',
    })
    expect(entry.restricted).toBe(false)
    expect(entry.deniedCount).toBe(0)
  })

  it('allowlist mode reports allowedCount and is ALWAYS restricted, even with an empty list', () => {
    const c = conn('c_a', { shareMode: 'allowlist', sources: [repoSrc('github.com/o/r'), projectSrc('/p/a')] })
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '',
    })
    expect(entry.shareMode).toBe('allowlist')
    expect(entry.allowedCount).toBe(2)
    expect(entry.deniedRepos).toBe(0)
    expect(entry.deniedProjects).toBe(0)
    expect(entry.deniedCount).toBe(2) // legacy field mirrors allowedCount in this mode
    expect(entry.restricted).toBe(true)

    const empty = conn('c_b', { shareMode: 'allowlist', sources: [] })
    expect(buildConnectionStatusEntry(empty, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '',
    }).restricted).toBe(true)
  })

  it('denylist mode splits deniedRepos and deniedProjects separately', () => {
    const c = conn('c_a', { sources: [repoSrc('github.com/o/r'), projectSrc('/p/a'), projectSrc('/p/b')] })
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '',
    })
    expect(entry.deniedRepos).toBe(1)
    expect(entry.deniedProjects).toBe(2)
  })

  it('never leaks the sources themselves — only the counts', () => {
    const c = conn('c_a', { sources: [repoSrc('github.com/secret/repo'), noneSrc()] })
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '',
    })
    expect(JSON.stringify(entry)).not.toContain('secret')
    expect((entry as unknown as Record<string, unknown>).sources).toBeUndefined()
    expect((entry as unknown as Record<string, unknown>).deniedRepos).toBe(2)
  })

  it('never leaks the token', () => {
    const c = conn('c_a', { token: 'super-secret-token' })
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '',
    })
    expect(JSON.stringify(entry)).not.toContain('super-secret-token')
  })

  it('centralTooOld is the complement of canForget, and a network flap cannot flip it — it is passed in verbatim', () => {
    const c = conn('c_a')
    expect(buildConnectionStatusEntry(c, NEVER_RAN, { boundary: null, prehistorySessions: null, canForget: false, resync: null, rulesHash: '' }).centralTooOld).toBe(true)
    expect(buildConnectionStatusEntry(c, NEVER_RAN, { boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '' }).centralTooOld).toBe(false)
  })

  it('boundary and prehistorySessions pass through the local honesty markers verbatim, including null (unknowable) vs 0', () => {
    const c = conn('c_a')
    const withUnknown = buildConnectionStatusEntry(c, NEVER_RAN, { boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '' })
    expect(withUnknown.boundary).toBeNull()
    expect(withUnknown.prehistorySessions).toBeNull()
    const withZero = buildConnectionStatusEntry(c, NEVER_RAN, { boundary: '', prehistorySessions: 0, canForget: true, resync: null, rulesHash: '' })
    expect(withZero.boundary).toBe('')
    expect(withZero.prehistorySessions).toBe(0)
  })

  it('resync passes through the live progress verbatim', () => {
    const c = conn('c_a')
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, {
      boundary: null, prehistorySessions: null, canForget: true,
      resync: { phase: 'forget', done: 40, total: 120 }, rulesHash: '',
    })
    expect(entry.resync).toEqual({ phase: 'forget', done: 40, total: 120 })
  })

  it('pendingRules is true when the sources changed since the last persisted rulesHash', () => {
    const c = conn('c_a', { sources: [repoSrc('github.com/o/r'), noneSrc()] })
    // rulesHash '' reads as emptyRulesSignature() (team-rules.ts rule 2) — the persisted state has
    // never seen ANY rules, so the current one (non-empty) is a pending change.
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, { boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '' })
    expect(entry.pendingRules).toBe(true)
  })

  it('pendingRules is false once the persisted rulesHash matches the current sources', () => {
    const c = conn('c_a', { sources: [] })
    // Empty sources in denylist mode match the '' sentinel (both read as emptyRulesSignature()) —
    // nothing pending for a connection that was never restricted.
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, { boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: '' })
    expect(entry.pendingRules).toBe(false)
  })

  it('pendingRules is true when ONLY the mode changed, sources identical — a mode switch is a rules change too', () => {
    const sources = [repoSrc('github.com/o/r')]
    const c = conn('c_a', { shareMode: 'allowlist', sources })
    const prevHash = rulesSignature('denylist', sources)
    const entry = buildConnectionStatusEntry(c, NEVER_RAN, { boundary: null, prehistorySessions: null, canForget: true, resync: null, rulesHash: prevHash })
    expect(entry.pendingRules).toBe(true)
  })
})

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

describe('otelExportEnabled — the machine-wide OTel export signal (§ otelWarn)', () => {
  const KEY = 'OTEL_EXPORTER_OTLP_ENDPOINT'
  const original = process.env[KEY]

  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('is false when the env var is unset', () => {
    delete process.env[KEY]
    expect(otelExportEnabled()).toBe(false)
  })

  it('is false when the env var is set but empty or whitespace-only', () => {
    process.env[KEY] = ''
    expect(otelExportEnabled()).toBe(false)
    process.env[KEY] = '   '
    expect(otelExportEnabled()).toBe(false)
  })

  it('is true when the env var names a real endpoint', () => {
    process.env[KEY] = 'http://localhost:4318'
    expect(otelExportEnabled()).toBe(true)
  })
})
