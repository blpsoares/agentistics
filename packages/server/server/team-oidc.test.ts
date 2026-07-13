import { test, expect } from 'bun:test'
import { pickCiClaims, looksLikeJwt, ciMemberId } from './team-oidc'

test('ciMemberId is stable and repo-scoped', () => {
  expect(ciMemberId('github.com/org/repo')).toBe('repo:github.com/org/repo')
})

test('looksLikeJwt accepts three non-empty segments, rejects hex tokens', () => {
  expect(looksLikeJwt('aaa.bbb.ccc')).toBe(true)
  expect(looksLikeJwt('a1b2c3d4e5f6'.repeat(8))).toBe(false) // static hex token
  expect(looksLikeJwt('aaa.bbb')).toBe(false)
  expect(looksLikeJwt('aaa..ccc')).toBe(false)
  expect(looksLikeJwt('')).toBe(false)
  expect(looksLikeJwt(null)).toBe(false)
  expect(looksLikeJwt(undefined)).toBe(false)
})

test('pickCiClaims requires a well-formed owner/repo repository claim', () => {
  expect(pickCiClaims({ repository: 'org/repo' })?.repository).toBe('org/repo')
  expect(pickCiClaims({})).toBeNull()
  expect(pickCiClaims({ repository: '' })).toBeNull()
  expect(pickCiClaims({ repository: 'noslash' })).toBeNull()
  expect(pickCiClaims({ repository: 'too/many/slashes' })).toBeNull()
  expect(pickCiClaims({ repository: 'org/ repo' })).toBeNull() // whitespace
  expect(pickCiClaims({ repository: 123 as unknown })).toBeNull()
})

test('pickCiClaims carries the useful optional claims', () => {
  const c = pickCiClaims({
    repository: 'acme/api', repository_owner: 'acme', ref: 'refs/heads/main',
    sha: 'deadbeef', workflow: 'CI', run_id: '42', actor: 'octocat',
  })
  expect(c).toEqual({
    repository: 'acme/api', repositoryOwner: 'acme', ref: 'refs/heads/main',
    sha: 'deadbeef', workflow: 'CI', runId: '42', actor: 'octocat',
  })
})
