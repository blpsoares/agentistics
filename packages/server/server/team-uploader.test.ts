/**
 * team-uploader.test.ts — unit tests for pure functions (sessionHash, selectDeltas) PLUS
 * integration tests for the per-connection IO paths (status, sent-state, removal, the shared
 * push-cycle context, and the concurrency cap) using real localhost mock servers and a tmp
 * connection-state directory. The latter never touch the developer's real ~/.agentistics or
 * ~/.claude — see the `beforeAll`/`afterAll` below and the DI seams each impure function accepts
 * (`deps`), added specifically so these tests do not have to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import {
  sessionHash, selectDeltas, emptyStatusFor, getUploaderStatus,
  pushOnceDetailed, removeConnection, runConnectionCycle,
  buildPushContext, getPushContext, invalidatePushContext,
  __setNotifierForTests, saveSentState,
  type PushCycleContext,
} from './team-uploader'
import { __setTeamConnDirForTests, teamSentFile } from './config'
import type { SessionMeta, TeamConnection, StatsCache } from '@agentistics/core'

// Minimal SessionMeta factory — only the fields needed for hashing/keying
function makeSession(id: string, extra?: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: id,
    project_path: `/projects/${id}`,
    start_time: '2026-01-01T00:00:00.000Z',
    duration_minutes: 60,
    user_message_count: 10,
    assistant_message_count: 8,
    tool_counts: {},
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: 600,
    output_tokens: 400,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    first_prompt: 'hello',
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: 5,
    lines_removed: 2,
    files_modified: 1,
    message_hours: [],
    user_message_timestamps: [],
    model: 'claude-sonnet-4-6',
    harness: 'claude',
    ...extra,
  } as SessionMeta
}

describe('sessionHash', () => {
  it('returns the JSON.stringify of the session', () => {
    const s = makeSession('abc')
    expect(sessionHash(s)).toBe(JSON.stringify(s))
  })

  it('differs when content differs', () => {
    const s1 = makeSession('x', { input_tokens: 100 })
    const s2 = makeSession('x', { input_tokens: 200 })
    expect(sessionHash(s1)).not.toBe(sessionHash(s2))
  })

  it('is stable for the same content', () => {
    const s = makeSession('stable')
    expect(sessionHash(s)).toBe(sessionHash({ ...s }))
  })
})

describe('selectDeltas — credential scrubbing before the wire', () => {
  it('a secret pasted into first_prompt never reaches the outgoing payload', () => {
    const s = { ...makeSession('s1'), first_prompt: 'MONGO_URL=mongodb+srv://appuser:s3cr3tP4ssw0rd@cluster.mongodb.net/db' }
    const { toSend } = selectDeltas([s], {})
    expect(toSend).toHaveLength(1)
    expect(toSend[0]!.first_prompt).not.toContain('s3cr3tP4ssw0rd')
    expect(toSend[0]!.first_prompt).toContain('[REDACTED]')
  })

  it('the input session is not mutated — the local store keeps the original text', () => {
    const s = { ...makeSession('s1'), first_prompt: 'PASSWORD=sup3rS3cretValue' }
    selectDeltas([s], {})
    expect(s.first_prompt).toBe('PASSWORD=sup3rS3cretValue')
  })

  it('redaction does NOT cause an endless re-send loop', () => {
    // The hash is taken over the redacted session, so a second run with the same input sees the
    // same hash and sends nothing. Hashing the raw session instead would re-send it forever.
    const s = { ...makeSession('s1'), first_prompt: 'MONGO_URL=mongodb+srv://u:pw12345678@h/db' }
    const first = selectDeltas([s], {})
    expect(first.toSend).toHaveLength(1)
    expect(selectDeltas([s], first.nextSent).toSend).toHaveLength(0)
  })
})

describe('selectDeltas', () => {
  it('sends all sessions when sent state is empty', () => {
    const sessions = [makeSession('a'), makeSession('b')]
    const { toSend, nextSent } = selectDeltas(sessions, {})
    expect(toSend).toHaveLength(2)
    expect(nextSent).toHaveProperty('a', sessionHash(sessions[0]!))
    expect(nextSent).toHaveProperty('b', sessionHash(sessions[1]!))
  })

  it('does not resend a session whose hash is unchanged', () => {
    const s = makeSession('already')
    const sent = { already: sessionHash(s) }
    const { toSend, nextSent } = selectDeltas([s], sent)
    expect(toSend).toHaveLength(0)
    // The unchanged session's hash must still be preserved in nextSent
    expect(nextSent['already']).toBe(sessionHash(s))
  })

  it('resends a session whose hash changed and updates nextSent', () => {
    const old = makeSession('changed', { input_tokens: 100 })
    const updated = makeSession('changed', { input_tokens: 200 })
    const sent = { changed: sessionHash(old) }
    const { toSend, nextSent } = selectDeltas([updated], sent)
    expect(toSend).toHaveLength(1)
    expect(toSend[0]!.session_id).toBe('changed')
    expect(nextSent['changed']).toBe(sessionHash(updated))
  })

  it('sends new sessions while preserving unchanged sessions in nextSent', () => {
    const existing = makeSession('existing', { input_tokens: 42 })
    const brand_new = makeSession('new_session')
    const sent = { existing: sessionHash(existing) }

    const { toSend, nextSent } = selectDeltas([existing, brand_new], sent)
    // Only the new session should be sent
    expect(toSend).toHaveLength(1)
    expect(toSend[0]!.session_id).toBe('new_session')
    // Both sessions should be present in nextSent
    expect(nextSent).toHaveProperty('existing', sessionHash(existing))
    expect(nextSent).toHaveProperty('new_session', sessionHash(brand_new))
  })

  it('skips sessions with no session_id', () => {
    const noId = { ...makeSession('dummy'), session_id: '' } as unknown as SessionMeta
    const { toSend, nextSent } = selectDeltas([noId], {})
    expect(toSend).toHaveLength(0)
    expect(Object.keys(nextSent)).toHaveLength(0)
  })
})

describe('selectDeltas — per-connection sent-state isolation', () => {
  it('sent-state is per connection — one central advancing never marks another as sent', () => {
    const s = (id: string) => ({ session_id: id }) as unknown as SessionMeta
    const sessions = [s('a'), s('b')]
    const a = selectDeltas(sessions, {})
    expect(a.toSend).toHaveLength(2)
    // A second connection starts from ITS OWN empty state, not from the first one's result.
    const b = selectDeltas(sessions, {})
    expect(b.toSend).toHaveLength(2)
    // And a connection that already has one of them sends only the other.
    const c = selectDeltas(sessions, { a: sessionHash(s('a')) })
    expect(c.toSend.map(x => x.session_id)).toEqual(['b'])
  })
})

describe('emptyStatusFor', () => {
  it('a fresh connection reports no success and no error', () => {
    const st = emptyStatusFor('c_0123456789ab')
    expect(st.lastSuccessAt).toBeNull()
    expect(st.errKind).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Integration tests — real localhost mock servers, real (tmp-dir) sent-state files, no mocking
// of the filesystem or of team-uploader's own modules. `TEAM_CONN_DIR` is redirected for the
// WHOLE process (see the note on `__setTeamConnDirForTests`) to a tmp dir before any of these
// run, and restored after, so a real developer's ~/.agentistics/connections is never touched.
// ---------------------------------------------------------------------------

function randomConnId(): string {
  return 'c_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function fakeConn(id: string, port: number, extra?: Partial<TeamConnection>): TeamConnection {
  return {
    id,
    endpoint: `http://127.0.0.1:${port}`,
    org: 'default',
    user: 'test-user',
    token: 'test-token',
    deniedRepos: [],
    ...extra,
  }
}

function makeCtx(overrides?: Partial<PushCycleContext>): PushCycleContext {
  return {
    realStatsCache: null,
    liveSessions: [],
    storedSessions: [],
    projects: [],
    workflows: [],
    builtAt: Date.now(),
    ...overrides,
  }
}

let _origConnDir: string

beforeAll(async () => {
  // Redirect TEAM_CONN_DIR (a live `let` binding, see config.ts) at the module level, for the
  // whole rest of this bun test process. Nothing else in the suite writes through it, and it is
  // restored in afterAll regardless.
  _origConnDir = join(tmpdir(), 'agentistics-team-conn-orig-noop')
  const dir = join(tmpdir(), `agentistics-team-conn-${crypto.randomUUID()}`)
  await mkdir(dir, { recursive: true })
  __setTeamConnDirForTests(dir)
  // Every error/recovery/removal notification in these tests goes through this no-op instead of
  // sse.ts's real broadcastNotification, which would otherwise append a real entry to the
  // developer's ~/.agentistics/notifications.json.
  __setNotifierForTests(() => {})
})

afterAll(async () => {
  __setNotifierForTests(null)
  try { await rm(_origConnDir, { recursive: true, force: true }) } catch { /* never created */ }
})

describe('getUploaderStatus — per-connection divergence', () => {
  it('two connections pushed independently end up with independent status entries', async () => {
    const idOk = randomConnId()
    const idBad = randomConnId()
    await using serverOk = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) })
    await using serverBad = Bun.serve({ port: 0, fetch: () => new Response('nope', { status: 401 }) })

    const connOk = fakeConn(idOk, serverOk.port!)
    const connBad = fakeConn(idBad, serverBad.port!)
    // A non-null statsCache forces pushOnceDetailed to actually contact the central even with an
    // empty storedSessions — otherwise the "nothing to push" branch never calls fetch at all.
    const ctx = makeCtx({ realStatsCache: { totalCostUSD: 0 } as unknown as StatsCache })

    await pushOnceDetailed(connOk, ctx)
    await pushOnceDetailed(connBad, ctx)

    const status = getUploaderStatus()
    expect(status[idOk]?.errKind).toBeNull()
    expect(status[idOk]?.lastSuccessAt).not.toBeNull()
    expect(status[idBad]?.errKind).toBe('auth')
    // The failing connection's status must not leak onto (or be shared with) the healthy one —
    // this is exactly what the pre-decomposition singletons could not express.
    expect(status[idOk]?.errKind).not.toBe(status[idBad]?.errKind)
  })
})

describe('B-1 — a central that accepts the connection and never responds', () => {
  it('the ingest fetch does not hang forever — it times out and returns an error result', async () => {
    const id = randomConnId()
    // Accepts the TCP connection (Bun.serve always does) and never resolves the handler —
    // exactly the "wedged reverse proxy" scenario named in the review. Before the fix, the
    // ingest fetch carried no AbortSignal at all and this would have hung the test until Bun's
    // own default test timeout killed it, holding a concurrency-cap slot the whole time.
    await using hung = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => { /* never resolves */ }) })
    const conn = fakeConn(id, hung.port!)
    // A short injected timeout (see PushCycleContext.ingestTimeoutMs) proves the SAME mechanism
    // production uses (DEFAULT_INGEST_TIMEOUT_MS) without this test waiting out the real 15s.
    const ctx = makeCtx({
      storedSessions: [makeSession('mid-flight')],
      ingestTimeoutMs: 200,
    })

    const start = Date.now()
    const result = await pushOnceDetailed(conn, ctx)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(2_000) // resolved by the injected timeout, not by hanging
    expect(result.error).toBeDefined() // the abort surfaces as a push error, not a silent success
    expect(getUploaderStatus()[id]?.errKind).toBe('net')
  }, 10_000)

  it('a hung connection does not stall a second connection pushed afterward', async () => {
    const idHung = randomConnId()
    const idOk = randomConnId()
    await using hung = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
    await using ok = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) })

    const ctx = makeCtx({ storedSessions: [makeSession('s1')], ingestTimeoutMs: 200 })
    await pushOnceDetailed(fakeConn(idHung, hung.port!), ctx)

    // The slot the hung push held is released once its fetch aborts (see acquireSlot/releaseSlot
    // in team-uploader.ts) — a second, otherwise-independent connection pushed afterward must
    // complete promptly rather than inheriting a permanently-exhausted cap.
    const start = Date.now()
    const okResult = await pushOnceDetailed(fakeConn(idOk, ok.port!), ctx)
    expect(Date.now() - start).toBeLessThan(2_000)
    expect(okResult.error).toBeUndefined()
    expect(getUploaderStatus()[idOk]?.errKind).toBeNull()
  }, 10_000)
})

describe('buildPushContext — ordering and pairing', () => {
  it('calls buildApiResponse before loadConsolidated (the store must be written before it is read)', async () => {
    const order: string[] = []
    const ctx = await buildPushContext({
      buildApiResponse: async () => {
        order.push('buildApiResponse')
        return { sessions: [makeSession('live-1')], statsCache: null, projects: [], workflows: [] }
      },
      loadConsolidated: async () => {
        order.push('loadConsolidated')
        return new Map([['stored-1', makeSession('stored-1')]])
      },
    })
    expect(order).toEqual(['buildApiResponse', 'loadConsolidated'])
    // And the two arrays it returns are the DIFFERENT ones the brief requires — never conflated.
    expect(ctx.liveSessions.map(s => s.session_id)).toEqual(['live-1'])
    expect(ctx.storedSessions.map(s => s.session_id)).toEqual(['stored-1'])
  })

  it('a failed buildApiResponse yields an empty liveSessions/null statsCache pair, never a raw-cache/empty-array mismatch', async () => {
    const ctx = await buildPushContext({
      buildApiResponse: async () => { throw new Error('boom') },
      loadConsolidated: async () => new Map(),
    })
    expect(ctx.liveSessions).toEqual([])
    expect(ctx.realStatsCache).toBeNull() // never a raw-file fallback paired with an empty array
  })
})

describe('getPushContext cache — invalidation (B-3)', () => {
  it('serves a cached snapshot within the TTL, and notifyDataChanged\'s invalidation forces a rebuild that sees a mid-window change', async () => {
    let call = 0
    const deps = {
      buildApiResponse: async () => ({ sessions: [], statsCache: null, projects: [], workflows: [] }),
      loadConsolidated: async () => {
        call++
        const sessions = call === 1 ? [makeSession('s1')] : [makeSession('s1'), makeSession('s2')]
        return new Map(sessions.map(s => [s.session_id, s]))
      },
    }

    const ctx1 = await getPushContext(deps)
    expect(ctx1.storedSessions.map(s => s.session_id)).toEqual(['s1'])

    // Within the TTL window, a second call reuses the cached snapshot — s2 (which "landed" in
    // the store between the two calls) is NOT yet visible. This is the bug: without invalidation
    // a deferred retry reusing this snapshot would find no delta and silently wait a full
    // interval anyway.
    const stale = await getPushContext(deps)
    expect(stale.storedSessions.map(s => s.session_id)).toEqual(['s1'])
    expect(call).toBe(1) // loadConsolidated was NOT called again — proves the cache is real

    // The fix: the same invalidation notifyDataChanged() performs.
    invalidatePushContext()
    const fresh = await getPushContext(deps)
    expect(call).toBe(2)
    expect(fresh.storedSessions.map(s => s.session_id).sort()).toEqual(['s1', 's2'])

    // And selectDeltas against the FRESH context (not the stale one) actually surfaces s2 as a
    // delta — this is what lets a deferred push carry the mid-cycle change instead of no-op'ing.
    const { nextSent } = selectDeltas(ctx1.storedSessions, {})
    const { toSend } = selectDeltas(fresh.storedSessions, nextSent)
    expect(toSend.map(s => s.session_id)).toEqual(['s2'])
  })
})

describe('runConnectionCycle — pendingTrigger deferral', () => {
  it('a second trigger arriving while the first is running is deferred, not dropped, and the connection pushes again on the next call', async () => {
    const connId = randomConnId()
    let ingestCalls = 0
    let policyCalls = 0
    await using server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/api/team/ingest') { ingestCalls++; return Response.json({ ok: true }) }
        policyCalls++
        return Response.json({ pushIntervalSec: 30, instanceId: null }) // /api/team/policy
      },
    })
    const conn = fakeConn(connId, server.port!)
    const fakePrefs = { team: { schema: 2 as const, mode: 'member' as const, connections: [conn] } }
    const deps = {
      readPreferences: async () => fakePrefs as never,
      migrateTeamStateOnce: async () => {},
    }

    // `runConnectionCycle` runs synchronously up to its first `await`, setting `_running` before
    // yielding — so calling it twice back-to-back deterministically reproduces "a trigger arrives
    // while the connection is already mid-cycle": the second call sees `_running` already set and
    // defers instead of racing the first for the same connId.
    const first = runConnectionCycle(connId, deps)
    const second = runConnectionCycle(connId, deps)
    await Promise.all([first, second])

    // The deferred trigger did NOT cause a second, concurrent CYCLE — only one policy fetch (one
    // full cycle) ran, proving `second` truly deferred instead of racing `first` for the same
    // connId (which would have raced two `saveSentState` calls for the same sent-state file).
    expect(policyCalls).toBe(1)

    // The guard was properly released (not left stuck "running" forever) and the deferred flag
    // was consumed — a further call runs the cycle again for real rather than being silently
    // swallowed. (No NEW ingest call is expected here: the shared push context this connection's
    // cycle reads from hasn't changed between calls, so there is genuinely nothing new to send —
    // that idempotency is `selectDeltas`'s job, not this guard's; this assertion is specifically
    // about the guard letting the cycle run again, not about push content.)
    await runConnectionCycle(connId, deps)
    expect(policyCalls).toBe(2)
    expect(ingestCalls).toBeLessThanOrEqual(1)
  })
})

describe('removeConnection — splices one entry, GCs only its own files (B-2)', () => {
  it('removes only the target connection; the OTHER connection\'s state files are untouched', async () => {
    const idA = randomConnId()
    const idB = randomConnId()
    const connA = fakeConn(idA, 1) // port is irrelevant — no network call in this test
    const connB = fakeConn(idB, 2)

    // Real files, under the tmp TEAM_CONN_DIR set in beforeAll.
    await saveSentState(idA, { s1: 'hash-a' })
    await saveSentState(idB, { s1: 'hash-b' })
    expect(await Bun.file(teamSentFile(idA)).exists()).toBe(true)
    expect(await Bun.file(teamSentFile(idB)).exists()).toBe(true)

    let store = { schema: 2 as const, mode: 'member' as const, connections: [connA, connB] }
    let writes = 0
    const fakeUpdateTeamConfig = async (mutate: (c: typeof store) => typeof store | undefined) => {
      const next = mutate(store)
      if (next === undefined) return store
      writes++
      store = next as typeof store
      return store
    }

    await removeConnection(idA, 'manual', { updateTeamConfig: fakeUpdateTeamConfig as never })

    expect(writes).toBe(1)
    expect(store.connections.map(c => c.id)).toEqual([idB])
    expect(await Bun.file(teamSentFile(idA)).exists()).toBe(false) // GC'd
    expect(await Bun.file(teamSentFile(idB)).exists()).toBe(true) // untouched

    // Idempotent — a second removal of the same (now-gone) connection does not re-write.
    await removeConnection(idA, 'manual', { updateTeamConfig: fakeUpdateTeamConfig as never })
    expect(writes).toBe(1)
  })

  it('two concurrent removals for DIFFERENT connections both survive when routed through an atomic mutator', async () => {
    const idA = randomConnId()
    const idB = randomConnId()
    const idC = randomConnId()
    const connA = fakeConn(idA, 1)
    const connB = fakeConn(idB, 2)
    const connC = fakeConn(idC, 3)
    await saveSentState(idA, {})
    await saveSentState(idB, {})
    await saveSentState(idC, {})

    // A minimal stand-in for preferences.ts's real `updateTeamConfig`: a single in-memory value
    // plus a queue that serializes mutators exactly the way `enqueueWrite` does — each mutator
    // reads the CURRENT value at ITS turn, not a value captured before either call started. This
    // is the exact property the review's B-2 finding says a plain read-then-write does not have.
    let store = { schema: 2 as const, mode: 'member' as const, connections: [connA, connB, connC] }
    let chain: Promise<unknown> = Promise.resolve()
    const serializedUpdateTeamConfig = (mutate: (c: typeof store) => typeof store | undefined) => {
      const next = chain.then(() => {
        const result = mutate(store)
        if (result !== undefined) store = result as typeof store
        return store
      })
      chain = next.catch(() => {})
      return next
    }

    // Fire both removals "concurrently" (before either's internal await resolves).
    await Promise.all([
      removeConnection(idA, 'manual', { updateTeamConfig: serializedUpdateTeamConfig as never }),
      removeConnection(idB, 'manual', { updateTeamConfig: serializedUpdateTeamConfig as never }),
    ])

    // Neither removal was lost, and neither resurrected the other's already-removed entry.
    expect(store.connections.map(c => c.id).sort()).toEqual([idC])
  })
})
