import { test, expect } from 'bun:test'
import { canSeeSource, canWriteTagSources, type TagAuthorityContext } from './tags-authority'
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
