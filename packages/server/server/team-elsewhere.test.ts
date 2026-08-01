import { describe, it, expect, beforeEach } from 'bun:test'
import type { TeamConnection } from '@agentistics/core'
import { hashToken } from './team-tokens'
import {
  selfMachineId,
  refreshElsewhere,
  getElsewhere,
  scheduleElsewhereCheck,
  ELSEWHERE_TTL_MS,
  __resetElsewhereForTests,
  __seedElsewhereForTests,
} from './team-elsewhere'

function conn(over: Partial<TeamConnection> = {}): TeamConnection {
  return {
    id: 'c1',
    endpoint: 'https://central.example',
    org: 'default',
    user: 'me',
    token: 'plain-token',
    deniedRepos: [],
    shareMode: 'denylist',
    sources: [{ type: 'repo', value: 'github.com/acme/api' }],
    ...over,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const OTHER = { id: 'other-machine', name: 'laptop-b' }

beforeEach(() => { __resetElsewhereForTests() })

describe('selfMachineId', () => {
  it('matches the central rule for deriving a machine id from a token', () => {
    expect(selfMachineId('plain-token')).toBe(hashToken('plain-token'))
  })

  it('is empty for a token-less connection', () => {
    expect(selfMachineId('')).toBe('')
  })
})

describe('refreshElsewhere', () => {
  it('reports a restricted repo another machine still sends', async () => {
    const repos = await refreshElsewhere(conn(), {
      fetch: async () => jsonResponse({ repos: [{ remote: 'github.com/acme/api', machines: [OTHER] }] }),
    })
    expect(repos).toEqual([{ repo: 'github.com/acme/api', machines: ['laptop-b'] }])
    expect(getElsewhere('c1')).toEqual(repos)
  })

  it('sends the token and asks a question that names no repository', async () => {
    let seen: { url: string; auth: string | undefined } | null = null
    await refreshElsewhere(conn(), {
      fetch: async (url, init) => {
        seen = { url, auth: init.headers['Authorization'] }
        return jsonResponse({ repos: [] })
      },
    })
    expect(seen!.url).toBe('https://central.example/api/team/account-repos')
    expect(seen!.auth).toBe('Bearer plain-token')
    // The whole privacy argument: no rule, no repo key, no query string.
    expect(seen!.url).not.toContain('acme')
    expect(seen!.url).not.toContain('?')
  })

  it('never reports this machine against itself', async () => {
    const self = { id: hashToken('plain-token'), name: 'laptop-a' }
    const repos = await refreshElsewhere(conn(), {
      fetch: async () => jsonResponse({ repos: [{ remote: 'github.com/acme/api', machines: [self] }] }),
    })
    expect(repos).toEqual([])
  })

  it('treats an older central (404) as no warning', async () => {
    const repos = await refreshElsewhere(conn(), { fetch: async () => new Response('Not found', { status: 404 }) })
    expect(repos).toEqual([])
  })

  it('keeps a previously computed warning when the central is unreachable', async () => {
    __seedElsewhereForTests('c1', [{ repo: 'github.com/acme/api', machines: ['laptop-b'] }])
    const repos = await refreshElsewhere(conn(), { fetch: async () => { throw new Error('ECONNREFUSED') } })
    expect(repos).toEqual([{ repo: 'github.com/acme/api', machines: ['laptop-b'] }])
  })

  it('reports nothing when the repo is not restricted here', async () => {
    const repos = await refreshElsewhere(conn({ sources: [] }), {
      fetch: async () => jsonResponse({ repos: [{ remote: 'github.com/acme/api', machines: [OTHER] }] }),
    })
    expect(repos).toEqual([])
  })
})

describe('scheduleElsewhereCheck', () => {
  it('does not refetch inside the TTL', async () => {
    let calls = 0
    __seedElsewhereForTests('c1', [], Date.now())
    scheduleElsewhereCheck(conn(), { fetch: async () => { calls++; return jsonResponse({ repos: [] }) } })
    await Promise.resolve()
    expect(calls).toBe(0)
  })

  it('refetches once the cached answer is older than the TTL', async () => {
    let calls = 0
    __seedElsewhereForTests('c1', [], Date.now() - ELSEWHERE_TTL_MS - 1)
    scheduleElsewhereCheck(conn(), { fetch: async () => { calls++; return jsonResponse({ repos: [] }) } })
    await new Promise(r => setTimeout(r, 10))
    expect(calls).toBe(1)
  })
})
