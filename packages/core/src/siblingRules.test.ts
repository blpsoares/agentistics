import { test, expect } from 'bun:test'
import { NO_REPO_KEY } from './team'
import type { ShareSource } from './team'
import {
  bucketSharedBy, siblingsWithholding, mergeSiblingFacts, shareBucketKeys, projectNameKey,
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
  const hit = siblingsWithholding(facts, { repoKey: 'github.com/acme/api' })
  expect(hit.map(f => f.machineName)).toEqual(['laptop', 'nuc'])
})

test('no facts means no warning — an empty inbox is not evidence that nobody restricts anything', () => {
  expect(siblingsWithholding([], { repoKey: 'github.com/acme/api' })).toEqual([])
})

test('the report is sorted by machine name so two machines never swap places between polls', () => {
  const facts = [
    fact({ machineId: 'z', machineName: 'zeta', shareMode: 'allowlist', sources: [] }),
    fact({ machineId: 'a', machineName: 'alpha', shareMode: 'allowlist', sources: [] }),
  ]
  expect(siblingsWithholding(facts, { repoKey: 'github.com/acme/api' }).map(f => f.machineName))
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
  expect(siblingsWithholding(before, { repoKey: 'github.com/acme/api' })).toHaveLength(1)
  const after = mergeSiblingFacts(before, [fact({ machineId: 'a', shareMode: 'denylist', sources: [] })])
  expect(siblingsWithholding(after, { repoKey: 'github.com/acme/api' })).toEqual([])
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

// --- projectNameKey: the CROSS-MACHINE correlation key -------------------------------------------
//
// The same project lives at a different path on every machine — `/home/user/xpto/abc/proj` here,
// `/home/user/proj` there — so correlating by full path correlates almost nothing. The final
// folder name is the only thing the two have in common.

test('the correlation key is the final folder name, whatever sits above it', () => {
  expect(projectNameKey('/home/user/xpto/abc/projFicticio')).toBe('projficticio')
  expect(projectNameKey('/home/user/projFicticio')).toBe('projficticio')
  expect(projectNameKey('projFicticio')).toBe('projficticio')
})

test('Windows separators and trailing slashes normalize to the same key — WSL and Windows share accounts', () => {
  expect(projectNameKey('C:\\Users\\me\\Projeto')).toBe('projeto')
  expect(projectNameKey('/home/me/projeto/')).toBe('projeto')
  expect(projectNameKey('/home/me/projeto///')).toBe('projeto')
  expect(projectNameKey('C:\\Users\\me\\Projeto\\')).toBe('projeto')
})

test('case is folded — Projeto on Windows and projeto on Linux are one key', () => {
  expect(projectNameKey('/home/me/Projeto')).toBe(projectNameKey('/mnt/c/dev/projeto'))
})

test('a path with no folder name yields no key, and no key correlates with anything', () => {
  for (const junk of ['', '   ', '/', '//', '\\', 'C:\\', '   /   ']) {
    expect(projectNameKey(junk)).toBe('')
  }
})

// --- cross-machine matching ---------------------------------------------------------------------

const OTHER_PATH: ShareSource = { type: 'project', value: '/home/user/projFicticio' }

test('a sibling withholding the same project under a DIFFERENT path is found', () => {
  const facts = [fact({ shareMode: 'denylist', sources: [OTHER_PATH] })]
  const hit = siblingsWithholding(facts, { projectPath: '/home/user/xpto/abc/projFicticio' })
  expect(hit).toHaveLength(1)
  // And it reports the sibling's OWN path, which is what lets a human resolve the ambiguity.
  expect(hit[0]!.paths).toEqual(['/home/user/projFicticio'])
})

test('a different folder name is not a match, however similar the path above it', () => {
  const facts = [fact({ shareMode: 'denylist', sources: [{ type: 'project', value: '/home/user/other' }] })]
  expect(siblingsWithholding(facts, { projectPath: '/home/user/projFicticio' })).toEqual([])
})

test('an allowlist sibling naming the project under its own path SHARES it — the fix cuts both ways', () => {
  // Before basename correlation this was a false POSITIVE: the exact path was absent from the
  // allowlist, so the sibling looked like it was withholding a project it actually shares.
  const facts = [fact({ shareMode: 'allowlist', sources: [OTHER_PATH] })]
  expect(siblingsWithholding(facts, { projectPath: '/home/user/xpto/abc/projFicticio' })).toEqual([])
})

test('a sibling withholding by OMISSION names no path — an allowlist has none to give, and none is invented', () => {
  const facts = [fact({ shareMode: 'allowlist', sources: [{ type: 'project', value: '/home/user/something-else' }] })]
  const hit = siblingsWithholding(facts, { projectPath: '/home/user/projFicticio' })
  expect(hit).toHaveLength(1)
  expect(hit[0]!.paths).toEqual([])
})

test('the repo dimension is untouched — normalizeGitRemote is already path-independent', () => {
  const facts = [fact({ shareMode: 'denylist', sources: [repo('git@github.com:Acme/API.git')] })]
  const hit = siblingsWithholding(facts, { repoKey: 'github.com/acme/api' })
  expect(hit).toHaveLength(1)
  // A repo match is not a folder-name guess, so there is no project path to show.
  expect(hit[0]!.paths).toEqual([])
})

test('THE LINE: bucketSharedBy stays EXACT — a local rule never widens to every project of that name', () => {
  // `sessionShared` and the stored rules keep matching the exact project_path they always did.
  // If denying /home/a/x/proj started meaning "every project named proj", a live privacy rule
  // would silently cover paths the user never named. Basename is a CORRELATION key between
  // machines, never a rule semantic — so the exact predicate must NOT see these as equal.
  const rules = { shareMode: 'denylist' as const, sources: [OTHER_PATH] }
  expect(bucketSharedBy({ projectPath: '/home/user/xpto/abc/projFicticio' }, rules)).toBe(true)
  expect(bucketSharedBy({ projectPath: '/home/user/projFicticio' }, rules)).toBe(false)
})
