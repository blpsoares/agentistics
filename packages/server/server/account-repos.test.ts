import { describe, it, expect } from 'bun:test'
import { NO_REPO_KEY } from '@agentistics/core'
import { buildAccountRepoList, findStillShared, parseAccountRepos } from './account-repos'
import { shareRulesOf } from './share-rules'

describe('buildAccountRepoList', () => {
  it('groups machines per repository and names them', () => {
    const out = buildAccountRepoList(
      [
        { remote: 'github.com/acme/api', memberId: 'm1' },
        { remote: 'github.com/acme/api', memberId: 'm2' },
        { remote: 'github.com/acme/web', memberId: 'm1' },
      ],
      { m1: 'laptop-a', m2: 'laptop-b' },
    )
    expect(out).toEqual([
      { remote: 'github.com/acme/api', machines: [{ id: 'm1', name: 'laptop-a' }, { id: 'm2', name: 'laptop-b' }] },
      { remote: 'github.com/acme/web', machines: [{ id: 'm1', name: 'laptop-a' }] },
    ])
  })

  it('folds SSH and HTTPS clones of the same repo into one row', () => {
    const out = buildAccountRepoList([
      { remote: 'github.com/Acme/API', memberId: 'm1' },
      { remote: 'ssh.github.com/acme/api', memberId: 'm2' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.remote).toBe('github.com/acme/api')
    expect(out[0]!.machines.map(m => m.id).sort()).toEqual(['m1', 'm2'])
  })

  it('buckets a missing remote under the no-repo sentinel', () => {
    const out = buildAccountRepoList([{ remote: '', memberId: 'm1' }, { memberId: 'm1' }])
    expect(out).toEqual([{ remote: NO_REPO_KEY, machines: [{ id: 'm1', name: 'm1' }] }])
  })

  it('drops rows with no machine id', () => {
    expect(buildAccountRepoList([{ remote: 'github.com/a/b', memberId: '' }])).toEqual([])
  })
})

describe('findStillShared', () => {
  const entries = [
    { remote: 'github.com/acme/api', machines: [{ id: 'self', name: 'laptop-a' }, { id: 'other', name: 'laptop-b' }] },
    { remote: 'github.com/acme/web', machines: [{ id: 'self', name: 'laptop-a' }] },
  ]

  it('reports a denied repo another machine still sends', () => {
    const rules = shareRulesOf('denylist', [{ type: 'repo', value: 'github.com/acme/api' }])
    expect(findStillShared(entries, rules, 'self')).toEqual([
      { repo: 'github.com/acme/api', machines: ['laptop-b'] },
    ])
  })

  it('never reports this machine against itself', () => {
    const rules = shareRulesOf('denylist', [{ type: 'repo', value: 'github.com/acme/web' }])
    expect(findStillShared(entries, rules, 'self')).toEqual([])
  })

  it('reports nothing when the repo is still shared here', () => {
    const rules = shareRulesOf('denylist', [])
    expect(findStillShared(entries, rules, 'self')).toEqual([])
  })

  it('reports everything outside an allowlist', () => {
    const rules = shareRulesOf('allowlist', [{ type: 'repo', value: 'github.com/acme/web' }])
    expect(findStillShared(entries, rules, 'self')).toEqual([
      { repo: 'github.com/acme/api', machines: ['laptop-b'] },
    ])
  })

  it('handles the no-repo bucket', () => {
    const noRepo = [{ remote: NO_REPO_KEY, machines: [{ id: 'other', name: 'laptop-b' }] }]
    const rules = shareRulesOf('denylist', [{ type: 'none', value: '' }])
    expect(findStillShared(noRepo, rules, 'self')).toEqual([{ repo: NO_REPO_KEY, machines: ['laptop-b'] }])
  })
})

describe('parseAccountRepos', () => {
  it('accepts a well-formed response', () => {
    expect(parseAccountRepos({ repos: [{ remote: 'github.com/a/b', machines: [{ id: 'm1', name: 'x' }] }] }))
      .toEqual([{ remote: 'github.com/a/b', machines: [{ id: 'm1', name: 'x' }] }])
  })

  it('falls back to the id when a machine has no name', () => {
    expect(parseAccountRepos({ repos: [{ remote: 'r', machines: [{ id: 'm1' }] }] }))
      .toEqual([{ remote: 'r', machines: [{ id: 'm1', name: 'm1' }] }])
  })

  it('returns an empty list for junk rather than throwing', () => {
    for (const junk of [null, undefined, 'nope', 42, {}, { repos: 'x' }, { repos: [null, {}, { remote: 'r' }] }]) {
      expect(parseAccountRepos(junk)).toEqual([])
    }
  })
})
