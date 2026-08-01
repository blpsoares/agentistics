import { test, expect } from 'bun:test'
import { NO_REPO_KEY } from './team'
import type { ShareSource } from './team'
import {
  bucketSharedBy, siblingsRestricting, mergeSiblingFacts, shareBucketKeys,
  type SiblingRuleFact,
} from './siblingRules'

const repo = (value: string): ShareSource => ({ type: 'repo', value })
const project = (value: string): ShareSource => ({ type: 'project', value })
const none = (): ShareSource => ({ type: 'none', value: '' })

function fact(over: Partial<SiblingRuleFact> = {}): SiblingRuleFact {
  return {
    machineId: 'm1',
    machineName: 'laptop-b',
    shareMode: 'denylist',
    sources: [],
    at: '2026-07-01T10:00:00.000Z',
    receivedAt: '2026-07-01T10:00:05.000Z',
    ...over,
  }
}

// --- shareBucketKeys ---------------------------------------------------------------------------

test('a bucket keys on both dimensions, and the unattributed repo folds to the fixed none bucket', () => {
  expect(shareBucketKeys({ repoKey: 'github.com/acme/api', projectPath: '/home/a/api' }))
    .toEqual(['repo:github.com/acme/api', 'project:/home/a/api'])
  expect(shareBucketKeys({ repoKey: NO_REPO_KEY })).toEqual(['none:'])
  expect(shareBucketKeys({ projectPath: '/home/a/loose' })).toEqual(['project:/home/a/loose'])
  expect(shareBucketKeys({})).toEqual([])
})

test('a repo key is alias- and case-folded, so one repository is one bucket however it was cloned', () => {
  expect(shareBucketKeys({ repoKey: 'GitHub.com/Acme/API' })).toEqual(['repo:github.com/acme/api'])
  expect(shareBucketKeys({ repoKey: 'ssh.github.com/acme/api' })).toEqual(['repo:github.com/acme/api'])
})

// --- bucketSharedBy ----------------------------------------------------------------------------

test('denylist: a bucket is shared until the rules name it', () => {
  const bucket = { repoKey: 'github.com/acme/api' }
  expect(bucketSharedBy(bucket, { shareMode: 'denylist', sources: [] })).toBe(true)
  expect(bucketSharedBy(bucket, { shareMode: 'denylist', sources: [repo('github.com/other/x')] })).toBe(true)
  expect(bucketSharedBy(bucket, { shareMode: 'denylist', sources: [repo('git@github.com:Acme/API.git')] })).toBe(false)
})

test('denylist: deny wins across dimensions — a denied repo hides its project too', () => {
  const bucket = { repoKey: 'github.com/acme/api', projectPath: '/home/a/api' }
  expect(bucketSharedBy(bucket, { shareMode: 'denylist', sources: [repo('https://github.com/acme/api')] })).toBe(false)
  expect(bucketSharedBy(bucket, { shareMode: 'denylist', sources: [project('/home/a/api')] })).toBe(false)
})

test('allowlist: a bucket is shared only when the rules name it, and an empty allowlist shares nothing', () => {
  const bucket = { repoKey: 'github.com/acme/api', projectPath: '/home/a/api' }
  expect(bucketSharedBy(bucket, { shareMode: 'allowlist', sources: [] })).toBe(false)
  expect(bucketSharedBy(bucket, { shareMode: 'allowlist', sources: [repo('https://github.com/acme/api')] })).toBe(true)
  expect(bucketSharedBy(bucket, { shareMode: 'allowlist', sources: [project('/home/a/api')] })).toBe(true)
  expect(bucketSharedBy(bucket, { shareMode: 'allowlist', sources: [repo('github.com/other/x')] })).toBe(false)
})

test('the unattributed bucket is restrictable in both modes', () => {
  expect(bucketSharedBy({ repoKey: NO_REPO_KEY }, { shareMode: 'denylist', sources: [none()] })).toBe(false)
  expect(bucketSharedBy({ repoKey: NO_REPO_KEY }, { shareMode: 'allowlist', sources: [none()] })).toBe(true)
})

test('a bucket that names nothing is never reported as restricted — silence, never an invented warning', () => {
  // An unkeyable bucket cannot be compared against anything, and the only safe reading of "I
  // cannot tell" here is "say nothing": a warning the user cannot act on is worse than none.
  expect(bucketSharedBy({}, { shareMode: 'denylist', sources: [repo('github.com/acme/api')] })).toBe(true)
  expect(bucketSharedBy({}, { shareMode: 'allowlist', sources: [repo('github.com/acme/api')] })).toBe(true)
})

// --- siblingsRestricting -----------------------------------------------------------------------

test('only the siblings whose own announced rules withhold the bucket are reported', () => {
  const facts = [
    fact({ machineId: 'a', machineName: 'laptop', shareMode: 'denylist', sources: [repo('github.com/acme/api')] }),
    fact({ machineId: 'b', machineName: 'desktop', shareMode: 'denylist', sources: [repo('github.com/acme/web')] }),
    fact({ machineId: 'c', machineName: 'nuc', shareMode: 'allowlist', sources: [repo('github.com/acme/web')] }),
  ]
  const hit = siblingsRestricting(facts, { repoKey: 'github.com/acme/api' })
  expect(hit.map(f => f.machineName)).toEqual(['laptop', 'nuc'])
})

test('no facts means no warning — an empty inbox is not evidence that nobody restricts anything', () => {
  expect(siblingsRestricting([], { repoKey: 'github.com/acme/api' })).toEqual([])
})

test('the report is sorted by machine name so two machines never swap places between polls', () => {
  const facts = [
    fact({ machineId: 'z', machineName: 'zeta', shareMode: 'allowlist', sources: [] }),
    fact({ machineId: 'a', machineName: 'alpha', shareMode: 'allowlist', sources: [] }),
  ]
  expect(siblingsRestricting(facts, { repoKey: 'github.com/acme/api' }).map(f => f.machineName))
    .toEqual(['alpha', 'zeta'])
})

// --- mergeSiblingFacts -------------------------------------------------------------------------

test('a later announcement SUPERSEDES the earlier one from the same machine instead of accumulating', () => {
  const before = [fact({ machineId: 'a', sources: [repo('github.com/acme/api')], receivedAt: '2026-07-01T10:00:00.000Z' })]
  const after = mergeSiblingFacts(before, [
    fact({ machineId: 'a', sources: [repo('github.com/acme/web')], receivedAt: '2026-07-02T10:00:00.000Z' }),
  ])
  expect(after).toHaveLength(1)
  expect(after[0]!.sources).toEqual([repo('github.com/acme/web')])
})

test('a sibling that LIFTS a restriction retracts the fact, because the message is a full snapshot', () => {
  const before = [fact({ machineId: 'a', shareMode: 'denylist', sources: [repo('github.com/acme/api')] })]
  expect(siblingsRestricting(before, { repoKey: 'github.com/acme/api' })).toHaveLength(1)
  const after = mergeSiblingFacts(before, [fact({ machineId: 'a', shareMode: 'denylist', sources: [] })])
  expect(siblingsRestricting(after, { repoKey: 'github.com/acme/api' })).toEqual([])
})

test('two machines are two facts — superseding is per machine, never a global replace', () => {
  const before = [fact({ machineId: 'a', sources: [repo('github.com/acme/api')] })]
  const after = mergeSiblingFacts(before, [fact({ machineId: 'b', sources: [repo('github.com/acme/web')] })])
  expect(after.map(f => f.machineId).sort()).toEqual(['a', 'b'])
})

test('within one batch the LAST announcement from a machine wins — arrival order, never the peer clock', () => {
  // `at` is the sender's clock and is display-only everywhere else in this channel; a peer whose
  // clock runs backwards must not be able to make its stale rules outrank its current ones.
  const after = mergeSiblingFacts([], [
    fact({ machineId: 'a', sources: [repo('github.com/acme/first')], at: '2030-01-01T00:00:00.000Z' }),
    fact({ machineId: 'a', sources: [repo('github.com/acme/second')], at: '1999-01-01T00:00:00.000Z' }),
  ])
  expect(after).toHaveLength(1)
  expect(after[0]!.sources).toEqual([repo('github.com/acme/second')])
})
