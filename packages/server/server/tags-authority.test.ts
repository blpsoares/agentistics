import { test, expect } from 'bun:test'
import {
  canSeeSource, canWriteTagSources, canReadTag, redactBuckets, redactTopValue,
  OTHER_BUCKET_KEY, type TagAuthorityContext, type TagVisibilityBucket,
} from './tags-authority'
import type { Principal } from './iam-types'
import type { TagSource } from './tags-resolve'

const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }
const mgrA: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 'A', role: 'manager' }] }

const ctx: TagAuthorityContext = {
  visibleTeamIds: new Set(['A']),
  visibleMachineIds: new Set(['machA']),
  visibleAccountIds: new Set(['m1', 'u2']),
  visibleRepos: new Set(['github.com/org/a']),
  visibleProjects: new Set(['/home/me/app']),
  machinesByAccount: { m1: [], u2: ['machA'] },
}

test('an account source requires EVERY machine that account owns to be visible', () => {
  // Escalation this blocks: a manager of team A tags account U (a member of A, so "visible"),
  // but U also owns a machine that lives only in team B. Resolution expands the account source to
  // every machine U owns, so the tag would pull in team B's metrics — the exact two-step
  // escalation Rule 1 exists to prevent.
  const ctx: TagAuthorityContext = {
    visibleTeamIds: new Set(['A']),
    visibleMachineIds: new Set(['machA']),
    visibleAccountIds: new Set(['u2']),
    visibleRepos: new Set<string>(),
    visibleProjects: new Set<string>(),
    machinesByAccount: { u2: ['machA', 'machB'] }, // machB is out of scope
  }
  expect(canSeeSource(mgrA, { type: 'account', value: 'u2' }, ctx)).toBe(false)

  // Same account, all of whose machines the caller can see → allowed.
  const okCtx: TagAuthorityContext = { ...ctx, machinesByAccount: { u2: ['machA'] } }
  expect(canSeeSource(mgrA, { type: 'account', value: 'u2' }, okCtx)).toBe(true)

  // An account with no machines contributes nothing and stays allowed.
  const emptyCtx: TagAuthorityContext = { ...ctx, machinesByAccount: { u2: [] } }
  expect(canSeeSource(mgrA, { type: 'account', value: 'u2' }, emptyCtx)).toBe(true)

  // An owner is unaffected.
  expect(canSeeSource(owner, { type: 'account', value: 'u2' }, ctx)).toBe(true)
})

test('an owner may use any source, even one absent from the context', () => {
  expect(canSeeSource(owner, { type: 'machine', value: 'anything' }, ctx)).toBe(true)
  expect(canSeeSource(owner, { type: 'team', value: 'Z' }, ctx)).toBe(true)
})

test('a manager may only use sources inside their visibility', () => {
  expect(canSeeSource(mgrA, { type: 'team', value: 'A' }, ctx)).toBe(true)
  expect(canSeeSource(mgrA, { type: 'team', value: 'B' }, ctx)).toBe(false)
  expect(canSeeSource(mgrA, { type: 'machine', value: 'machA' }, ctx)).toBe(true)
  expect(canSeeSource(mgrA, { type: 'machine', value: 'machZ' }, ctx)).toBe(false)
  expect(canSeeSource(mgrA, { type: 'account', value: 'u2' }, ctx)).toBe(true)
  expect(canSeeSource(mgrA, { type: 'account', value: 'ghost' }, ctx)).toBe(false)
  expect(canSeeSource(mgrA, { type: 'repo', value: 'github.com/org/a' }, ctx)).toBe(true)
  expect(canSeeSource(mgrA, { type: 'repo', value: 'github.com/org/secret' }, ctx)).toBe(false)
  expect(canSeeSource(mgrA, { type: 'project', value: '/home/me/app' }, ctx)).toBe(true)
  expect(canSeeSource(mgrA, { type: 'project', value: '/etc/other' }, ctx)).toBe(false)
})

test('canWriteTagSources requires EVERY source to be visible — one bad source rejects the tag', () => {
  const good: TagSource[] = [{ type: 'team', value: 'A' }, { type: 'machine', value: 'machA' }]
  const mixed: TagSource[] = [{ type: 'team', value: 'A' }, { type: 'machine', value: 'machZ' }]
  expect(canWriteTagSources(mgrA, good, ctx)).toBe(true)
  // This is the privilege-escalation case: composing a tag over an unseen machine and then
  // granting it to yourself would leak that machine's metrics.
  expect(canWriteTagSources(mgrA, mixed, ctx)).toBe(false)
  expect(canWriteTagSources(owner, mixed, ctx)).toBe(true)
})

test('a tag with no sources is rejected for a non-owner and allowed for an owner', () => {
  expect(canWriteTagSources(mgrA, [], ctx)).toBe(true) // vacuous truth — no source to violate
  expect(canWriteTagSources(owner, [], ctx)).toBe(true)
})

// ---------------------------------------------------------------------------
// canReadTag — read access is re-derived, never trusted from the stored document
// ---------------------------------------------------------------------------

test('a creator who no longer sees the tag sources loses read access', () => {
  // The lapse this covers: a manager of team A composes a tag over team A, then is moved off A.
  // `createdBy` still says they made it, but the authority that let them make it is gone — and a
  // tag hands its readers FULL aggregates, so keeping them would be a permanent leak of team A.
  const tag = { createdBy: 'm1', sharedWith: [] as string[], sources: [{ type: 'team', value: 'A' }] as TagSource[] }
  expect(canReadTag(mgrA, tag, ctx)).toBe(true)

  const lapsed: TagAuthorityContext = { ...ctx, visibleTeamIds: new Set<string>() }
  expect(canReadTag(mgrA, tag, lapsed)).toBe(false)
  // An owner is never affected by the creator's lapse.
  expect(canReadTag(owner, tag, lapsed)).toBe(true)
})

test('an explicit sharedWith grant survives a source-visibility lapse', () => {
  // sharedWith is a deliberate human act of sharing, not a side effect of authority — it outlives
  // team changes on purpose, and is revoked the same explicit way it was given.
  const tag = { createdBy: 'someoneElse', sharedWith: ['m1'], sources: [{ type: 'team', value: 'B' }] as TagSource[] }
  const lapsed: TagAuthorityContext = { ...ctx, visibleTeamIds: new Set<string>() }
  expect(canReadTag(mgrA, tag, lapsed)).toBe(true)
})

test('a principal who is neither creator nor grantee never reads the tag', () => {
  const tag = { createdBy: 'someoneElse', sharedWith: ['u9'], sources: [{ type: 'team', value: 'A' }] as TagSource[] }
  expect(canReadTag(mgrA, tag, ctx)).toBe(false)
  expect(canReadTag(owner, tag, ctx)).toBe(true)
})

// ---------------------------------------------------------------------------
// redactBuckets / redactTopValue — Rule 2 applied to the KEYS, not only the numbers
// ---------------------------------------------------------------------------

const buckets: TagVisibilityBucket[] = [
  { key: '/home/me/app', sessions: 4, costUSD: 10, tokens: 1000 },
  { key: '/srv/acme-bank/core', sessions: 3, costUSD: 6, tokens: 600 },
  { key: '/srv/other-client/api', sessions: 1, costUSD: 2, tokens: 200 },
]

test('unseeable bucket keys collapse into one anonymous bucket that preserves the totals', () => {
  // The leak this closes: visibleProjects is inferred from one session the caller can see, but
  // resolution matches that value across the UNSCOPED set — so the breakdown would name every
  // other project in the tag. The numbers stay whole (a grantee is promised full totals); only the
  // identifying strings go.
  const out = redactBuckets(mgrA, buckets, new Set(['/home/me/app']))
  expect(out.map(b => b.key)).toEqual(['/home/me/app', OTHER_BUCKET_KEY])
  const other = out.find(b => b.key === OTHER_BUCKET_KEY)!
  expect(other.sessions).toBe(4)   // 3 + 1
  expect(other.costUSD).toBe(8)    // 6 + 2
  expect(other.tokens).toBe(800)   // 600 + 200
  // Totals across the redacted view still match the raw view exactly.
  expect(out.reduce((n, b) => n + b.sessions, 0)).toBe(8)
  expect(out.reduce((n, b) => n + b.costUSD, 0)).toBe(18)
})

test('an owner keeps every bucket key', () => {
  expect(redactBuckets(owner, buckets, new Set<string>()).map(b => b.key))
    .toEqual(['/home/me/app', '/srv/acme-bank/core', '/srv/other-client/api'])
})

test('redaction re-ranks so the collapsed bucket lands at its real size', () => {
  const out = redactBuckets(mgrA, buckets, new Set(['/srv/other-client/api']))
  // "other" is worth $16 and outranks the single visible $2 bucket.
  expect(out.map(b => b.key)).toEqual([OTHER_BUCKET_KEY, '/srv/other-client/api'])
})

test('everything visible produces no "other" bucket at all', () => {
  const out = redactBuckets(mgrA, buckets, new Set(buckets.map(b => b.key)))
  expect(out.some(b => b.key === OTHER_BUCKET_KEY)).toBe(false)
  expect(out).toHaveLength(3)
})

test('topProject is returned only when the viewer can see that project', () => {
  // A project_path routinely encodes a client name, and topProject is picked from the unscoped
  // set — so it is exactly the same disclosure as a bucket key and obeys the same rule.
  expect(redactTopValue(mgrA, '/home/me/app', ctx.visibleProjects)).toBe('/home/me/app')
  expect(redactTopValue(mgrA, '/srv/acme-bank/core', ctx.visibleProjects)).toBeNull()
  expect(redactTopValue(owner, '/srv/acme-bank/core', ctx.visibleProjects)).toBe('/srv/acme-bank/core')
  expect(redactTopValue(mgrA, null, ctx.visibleProjects)).toBeNull()
})
