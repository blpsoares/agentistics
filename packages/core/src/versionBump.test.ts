import { describe, expect, test } from 'bun:test'
import { bumpFromCommits, classifyCommit, nextVersion } from './versionBump'

const s = (subject: string) => ({ subject })

describe('classifyCommit — a single commit', () => {
  test('feat: → minor', () => expect(classifyCommit(s('feat: add panel'))).toBe('minor'))
  test('feat(scope): → minor', () => expect(classifyCommit(s('feat(web): add panel'))).toBe('minor'))
  test('feat!: → major', () => expect(classifyCommit(s('feat!: drop legacy api'))).toBe('major'))
  test('feat(scope)!: → major', () => expect(classifyCommit(s('feat(web)!: drop legacy api'))).toBe('major'))
  test('fix: → patch', () => expect(classifyCommit(s('fix: correct off-by-one'))).toBe('patch'))
  test('chore: → patch', () => expect(classifyCommit(s('chore: bump deps'))).toBe('patch'))
  test('chore(scope)!: → major', () => expect(classifyCommit(s('chore(build)!: change output'))).toBe('major'))
  test('docs: → patch', () => expect(classifyCommit(s('docs: update readme'))).toBe('patch'))

  test('a non-conventional subject (merge commit) → null', () =>
    expect(classifyCommit(s('Merge pull request #247 from blpsoares/dev'))).toBeNull())
  test('an empty subject → null', () => expect(classifyCommit(s(''))).toBeNull())

  test('BREAKING CHANGE in the body of a feat → major', () =>
    expect(classifyCommit({ subject: 'feat: x', body: 'why\n\nBREAKING CHANGE: removes old flag' })).toBe('major'))
  test('BREAKING CHANGE in the body of a fix → major', () =>
    expect(classifyCommit({ subject: 'fix: x', body: 'BREAKING CHANGE: incompatible' })).toBe('major'))
  test('BREAKING-CHANGE (hyphen) is also breaking', () =>
    expect(classifyCommit({ subject: 'fix: x', body: 'BREAKING-CHANGE: incompatible' })).toBe('major'))
})

describe('bumpFromCommits — the defect that shipped v1.23.1', () => {
  test('a range whose ONLY commit is a feat → minor (the exact failing scenario)', () => {
    expect(bumpFromCommits([s('feat(web): live terminal panel (#246)')])).toBe('minor')
  })

  // The bug dropped the OLDEST commit in the range, so the position of the feat mattered.
  test('feat in the FIRST position → minor', () =>
    expect(bumpFromCommits([s('feat: a'), s('fix: b'), s('chore: c')])).toBe('minor'))
  test('feat in the MIDDLE position → minor', () =>
    expect(bumpFromCommits([s('fix: a'), s('feat: b'), s('chore: c')])).toBe('minor'))
  test('feat in the LAST position → minor (the dropped-line case)', () =>
    expect(bumpFromCommits([s('fix: a'), s('chore: b'), s('feat: c')])).toBe('minor'))

  test('feat! anywhere → major', () =>
    expect(bumpFromCommits([s('fix: a'), s('feat!: b'), s('chore: c')])).toBe('major'))
  test('feat(x)! anywhere → major', () =>
    expect(bumpFromCommits([s('chore: a'), s('feat(api)!: b')])).toBe('major'))
  test('a BREAKING CHANGE body anywhere → major', () =>
    expect(bumpFromCommits([s('fix: a'), { subject: 'feat: b', body: 'BREAKING CHANGE: x' }])).toBe('major'))

  test('only fix/chore/docs → patch', () =>
    expect(bumpFromCommits([s('fix: a'), s('chore: b'), s('docs: c')])).toBe('patch'))
  test('major outranks a later feat', () =>
    expect(bumpFromCommits([s('feat!: a'), s('feat: b')])).toBe('major'))
})

describe('bumpFromCommits — noisy failure instead of a silent patch (item 4)', () => {
  test('an EMPTY commit list THROWS — zero subjects read is a reading defect, not a patch', () => {
    expect(() => bumpFromCommits([])).toThrow()
  })
  test('real commits that are all non-conventional → patch (the read worked; nothing to bump)', () => {
    expect(bumpFromCommits([s('Merge pull request #1'), s('Revert "feat: x"')])).toBe('patch')
  })
  test('a single non-conventional commit → patch (a record was read; it is just not a feature)', () => {
    expect(bumpFromCommits([s('Merge branch dev')])).toBe('patch')
  })
})

describe('nextVersion — pure semver arithmetic', () => {
  test('minor', () => expect(nextVersion('1.23.0', 'minor')).toBe('1.24.0'))
  test('major', () => expect(nextVersion('1.23.0', 'major')).toBe('2.0.0'))
  test('patch', () => expect(nextVersion('1.23.0', 'patch')).toBe('1.23.1'))

  test('the v1.23.1 range should have produced 1.24.0', () => {
    expect(nextVersion('1.23.0', bumpFromCommits([s('feat(web): panel (#246)')]))).toBe('1.24.0')
  })
  test('a leading v and trailing junk are tolerated on parse', () =>
    expect(nextVersion('v2.5.9-rc1', 'patch')).toBe('2.5.10'))
  test('throws on an unparseable version', () => expect(() => nextVersion('nope', 'patch')).toThrow())
})
