/**
 * authz-gate.test.ts — locks the authorization surface.
 *
 * The gate is deny-by-default, so the risk is not a wrong `if` but a route quietly added to
 * AUTH_PUBLIC. Asserting the exact contents of that Set turns "made a route public" into a
 * failing test that a reviewer has to look at on purpose.
 */
import { describe, expect, it } from 'bun:test'
import { AUTH_PUBLIC, ADMIN_PATHS, isAdminPath, MFA_EXEMPT } from './index-routes'
import { can } from './iam-caps'
import { requiresStepUp } from './stepup'
import { scopeAppDataToTeams } from './team-scope'
import type { Principal } from './iam-types'
import type { SessionMeta, StatsCache } from '@agentistics/core'

const user: Principal = { accountId: 'u1', role: 'member', memberships: [{ teamId: 't1', role: 'user' }] }
const manager: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 't1', role: 'manager' }] }
const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }

describe('public route allowlist', () => {
  it('is exactly the routes that must work before authentication', () => {
    expect([...AUTH_PUBLIC].sort()).toEqual([
      '/api/health',
      '/api/iam/bootstrap',
      '/api/iam/login',
      '/api/iam/login/mfa',
      '/api/iam/logout',
      '/api/iam/me',
      // Owner password recovery. Public by necessity — the caller is locked out, so there is no
      // session to present — and safe to be public only because it proves the account's SECOND
      // FACTOR before it changes anything, rate-limits per account, and answers identically for
      // an unknown e-mail, a non-owner and a wrong code.
      '/api/iam/recover',
      // Asking to be reset: writes a row for an admin to look at, and nothing else.
      '/api/iam/reset-request',
      '/api/iam/status',
      '/api/team/account-repos',
      '/api/team/agent',
      '/api/team/forget',
      '/api/team/ingest',
      '/api/team/leave',
      '/api/team/login',
      '/api/team/logout',
      '/api/team/policy',
      '/api/team/session',
      '/api/team/whoami',
    ].sort())
  })

  it('exposes no data-bearing route', () => {
    for (const p of AUTH_PUBLIC) {
      expect(p).not.toBe('/api/data')
      expect(p.startsWith('/api/tags')).toBe(false)
      expect(p.startsWith('/api/iam/accounts')).toBe(false)
      expect(p.startsWith('/api/iam/teams')).toBe(false)
      expect(p.startsWith('/api/iam/machines')).toBe(false)
    }
  })

  it('does not expose the MFA enrolment routes, which act on a live account', () => {
    expect(AUTH_PUBLIC.has('/api/iam/mfa')).toBe(false)
    expect(AUTH_PUBLIC.has('/api/iam/mfa/start')).toBe(false)
    expect(AUTH_PUBLIC.has('/api/iam/mfa/enable')).toBe(false)
  })
})

describe('admin path matching', () => {
  it('covers nested detail routes', () => {
    for (const p of ADMIN_PATHS) {
      expect(isAdminPath(p)).toBe(true)
      expect(isAdminPath(`${p}/some-id`)).toBe(true)
    }
  })

  it('does not swallow a sibling route with a shared prefix', () => {
    expect(isAdminPath('/api/team/membersearch')).toBe(false)
    expect(isAdminPath('/api/team/configuration')).toBe(false)
  })

  it('includes the audit reader', () => {
    expect(isAdminPath('/api/iam/audit')).toBe(true)
  })

  it('leaves ordinary data routes alone', () => {
    expect(isAdminPath('/api/data')).toBe(false)
    expect(isAdminPath('/api/tags/abc')).toBe(false)
  })
})

describe('mfa enrolment exemptions', () => {
  it('lets an un-enrolled owner finish enrolling or sign out, and nothing else', () => {
    expect(MFA_EXEMPT.has('/api/iam/mfa/enable')).toBe(true)
    expect(MFA_EXEMPT.has('/api/iam/logout')).toBe(true)
    expect(MFA_EXEMPT.has('/api/data')).toBe(false)
    expect(MFA_EXEMPT.has('/api/team/members')).toBe(false)
    expect(MFA_EXEMPT.has('/api/tags')).toBe(false)
  })
})

describe('capability matrix', () => {
  it('denies a plain user every administrative write action', () => {
    expect(can(user, 'teams:write')).toBe(false)
    expect(can(user, 'central:config')).toBe(false)
    expect(can(user, 'tokens:write', { teamId: 't1' })).toBe(false)
    expect(can(user, 'members:write', { teamId: 't1' })).toBe(false)
  })

  it('lets anyone signed in create a tag — reach, not permission, is what differs', () => {
    // Deliberate: `tags:write` only answers "may create tags at all". What a tag may point at
    // is decided per source by canWriteTagSources (see tags-authority.test.ts), so a plain user
    // creating a tag can still only reach what their own account already owns.
    expect(can(user, 'tags:write')).toBe(true)
  })

  it('scopes a manager to their own team', () => {
    expect(can(manager, 'tokens:write', { teamId: 't1' })).toBe(true)
    expect(can(manager, 'tokens:write', { teamId: 't2' })).toBe(false)
    expect(can(manager, 'members:write', { teamId: 't2' })).toBe(false)
  })

  it('never lets a manager create an owner or another manager', () => {
    expect(can(manager, 'accounts:manage', { teamId: 't1', targetRole: 'owner' })).toBe(false)
    expect(can(manager, 'accounts:manage', { teamId: 't1', targetRole: 'manager' })).toBe(false)
    expect(can(manager, 'accounts:manage', { teamId: 't1', targetRole: 'user' })).toBe(true)
  })

  it('never lets a manager edit teams or central config', () => {
    expect(can(manager, 'teams:write')).toBe(false)
    expect(can(manager, 'central:config')).toBe(false)
  })

  it('grants the owner everything', () => {
    expect(can(owner, 'teams:write')).toBe(true)
    expect(can(owner, 'central:config')).toBe(true)
    expect(can(owner, 'tokens:write', { teamId: 'any' })).toBe(true)
  })
})

describe('data scoping (BOLA)', () => {
  it('drops sessions from teams the principal does not belong to', () => {
    const data = {
      sessions: [
        { session_id: 's1', teamIds: ['t1'], user: 'a', memberId: 'm-a' },
        { session_id: 's2', teamIds: ['t2'], user: 'b', memberId: 'm-b' },
      ] as unknown as SessionMeta[],
      projects: [],
      workflows: [],
      userStatsCaches: {},
    }
    const scoped = scopeAppDataToTeams(data, new Set(['t1']), new Set())
    expect(scoped.sessions.map(s => s.session_id)).toEqual(['s1'])
    expect(Object.keys(scoped.userStatsCaches ?? {})).not.toContain('b')
  })

  it('returns an empty statsCache when nothing is visible, never the central total', () => {
    const data = {
      sessions: [{ session_id: 's2', teamIds: ['t2'], user: 'b', memberId: 'm-b' }] as unknown as SessionMeta[],
      projects: [],
      workflows: [],
      statsCache: { totalCostUSD: 9999 } as unknown as StatsCache,
      userStatsCaches: { b: { totalCostUSD: 9999 } as unknown as StatsCache },
    }
    const scoped = scopeAppDataToTeams(data, new Set(['t1']), new Set())
    expect(scoped.sessions).toHaveLength(0)
    expect(JSON.stringify(scoped.statsCache)).not.toContain('9999')
  })

  it('still shows a principal the loose machine they own', () => {
    const data = {
      sessions: [{ session_id: 's3', teamIds: [], user: 'c', memberId: 'mine' }] as unknown as SessionMeta[],
      projects: [],
      workflows: [],
      userStatsCaches: {},
    }
    const scoped = scopeAppDataToTeams(data, new Set(['t1']), new Set(['mine']))
    expect(scoped.sessions.map(s => s.session_id)).toEqual(['s3'])
  })
})

describe('step-up ("sudo mode") coverage', () => {
  it('protects every operation that destroys data or mints a credential', () => {
    for (const [method, path] of [
      ['DELETE', '/api/iam/accounts/abc'],
      ['PATCH', '/api/iam/accounts/abc'],
      ['DELETE', '/api/iam/teams/t1'],
      ['POST', '/api/team/tokens'],
      ['POST', '/api/team/tokens/rotate'],
      ['DELETE', '/api/team/tokens'],
      ['POST', '/api/team/repos'],
      ['DELETE', '/api/team/repos/x'],
    ] as const) {
      expect(requiresStepUp(method, path)).toBe(true)
    }
  })

  it('leaves reads and ordinary traffic alone, so the dashboard is not tiresome', () => {
    for (const [method, path] of [
      ['GET', '/api/iam/accounts'],
      ['GET', '/api/team/tokens'],
      ['GET', '/api/data'],
      ['POST', '/api/tags'],
      ['PUT', '/api/preferences'],
    ] as const) {
      expect(requiresStepUp(method, path)).toBe(false)
    }
  })

  it('lets an un-enrolled owner reach the step-up endpoint, or they could never re-auth', () => {
    expect(MFA_EXEMPT.has('/api/iam/stepup')).toBe(true)
  })
})
