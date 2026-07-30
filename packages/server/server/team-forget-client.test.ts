/**
 * team-forget-client.test.ts — the pure halves (`planForgetBatches`, `decideJournalResume`) plus
 * the ordering-sensitive integration tests for `runForgetSequence`, driven entirely through its
 * injectable deps (`fetch`, the journal path, the capability gate, the revoke hook) and a tmp
 * `TEAM_CONN_DIR` — no central, no `~/.claude`, no `~/.agentistics`.
 *
 * The ordering assertions are REAL: the fetch stub reads the journal file off disk at the moment
 * the POST is issued and records what it found, so "journal before the first batch" fails if the
 * write is moved after the request rather than merely producing the same end state.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import type { TeamConnection } from '@agentistics/core'
import {
  planForgetBatches, decideJournalResume, runForgetSequence, loadForgetJournal,
  FORGET_BATCH_SIZE, type ForgetDeps,
} from './team-forget-client'
import { __setTeamConnDirForTests, TEAM_CONN_DIR, teamSentFile, teamForgetFile } from './config'

const _origConnDir = TEAM_CONN_DIR
let _tmpConnDir: string

beforeAll(async () => {
  _tmpConnDir = join(tmpdir(), `agentistics-team-forget-${crypto.randomUUID()}`)
  await mkdir(_tmpConnDir, { recursive: true })
  __setTeamConnDirForTests(_tmpConnDir)
})

afterAll(async () => {
  __setTeamConnDirForTests(_origConnDir)
  try { await rm(_tmpConnDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

function randomConnId(): string {
  return 'c_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function fakeConn(id: string): TeamConnection {
  return { id, endpoint: 'http://central.invalid', org: 'default', user: 'test-user', token: 'test-token', deniedRepos: [] }
}

/** Seed this connection's sent-state file with the given ids (any hash value) + run ids. */
async function seedSentState(connId: string, ids: string[], runIds: string[] = []): Promise<void> {
  const hashes: Record<string, string> = {}
  for (const id of ids) hashes[id] = `hash-of-${id}`
  await writeFile(teamSentFile(connId), JSON.stringify({ version: 2, hashes, runIds }), 'utf-8')
}

async function readSentState(connId: string): Promise<{ hashes: Record<string, string>; runIds: string[] }> {
  const raw = JSON.parse(await readFile(teamSentFile(connId), 'utf-8')) as { hashes: Record<string, string>; runIds: string[] }
  return raw
}

/** Every test's deps default to "capable central, never revoked" so each test only states the
 *  thing it is actually about. */
function baseDeps(over: ForgetDeps): ForgetDeps {
  return { canForget: () => true, onRevoked: async () => {}, ...over }
}

const okWhoami = () => new Response(JSON.stringify({ ok: true, user: 'test-user' }), { status: 200 })

describe('planForgetBatches', () => {
  it('splits into batches of at most 500 and preserves order', () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `s${i}`)
    const batches = planForgetBatches(ids)
    expect(batches.map(b => b.length)).toEqual([500, 500, 200])
    // Order preserved, and every id present exactly once.
    expect(batches.flat()).toEqual(ids)
    expect(FORGET_BATCH_SIZE).toBe(500)
  })

  it('returns [] for no ids', () => {
    expect(planForgetBatches([])).toEqual([])
  })
})

describe('decideJournalResume', () => {
  it('resumes a well-formed forgetting journal', () => {
    const decision = decideJournalResume({
      state: 'forgetting', ids: ['a', 'b'], runIds: ['r1'],
      rulesHash: 'deadbeef', startedAt: '2026-07-30T10:00:00.000Z',
    })
    expect(decision.resume).toBe(true)
    if (!decision.resume) throw new Error('unreachable — asserted above')
    expect(decision.journal.ids).toEqual(['a', 'b'])
    expect(decision.journal.runIds).toEqual(['r1'])
    expect(decision.journal.rulesHash).toBe('deadbeef')
    expect(decision.journal.startedAt).toBe('2026-07-30T10:00:00.000Z')
  })

  it('refuses junk, a wrong state and a non-array ids field', () => {
    // Junk of every shape a corrupt/absent file can produce.
    expect(decideJournalResume(null).resume).toBe(false)
    expect(decideJournalResume(undefined).resume).toBe(false)
    expect(decideJournalResume('forgetting').resume).toBe(false)
    expect(decideJournalResume(42).resume).toBe(false)
    expect(decideJournalResume([{ state: 'forgetting', ids: ['a'], runIds: [] }]).resume).toBe(false)
    // A state this module does not know must never be replayed as a delete.
    expect(decideJournalResume({ state: 'done', ids: ['a'], runIds: [] }).resume).toBe(false)
    expect(decideJournalResume({ ids: ['a'], runIds: [] }).resume).toBe(false)
    // A non-array ids field.
    expect(decideJournalResume({ state: 'forgetting', ids: 'a', runIds: [] }).resume).toBe(false)
    expect(decideJournalResume({ state: 'forgetting', ids: ['a'], runIds: 'r1' }).resume).toBe(false)
    // Well-formed but empty: nothing to replay, so it is not a resume either.
    expect(decideJournalResume({ state: 'forgetting', ids: [], runIds: [] }).resume).toBe(false)
    // Non-string entries are dropped, and an all-junk array collapses to "nothing to resume".
    expect(decideJournalResume({ state: 'forgetting', ids: [1, null], runIds: [] }).resume).toBe(false)
  })
})

describe('runForgetSequence', () => {
  it('writes the journal BEFORE the first POST', async () => {
    const connId = randomConnId()
    await seedSentState(connId, ['a', 'b'])
    const events: string[] = []

    const deps = baseDeps({
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/team/whoami')) {
          // The journal must NOT exist yet at whoami time either — nothing is written before the
          // identity is proven.
          events.push(`whoami(journal=${existsSync(teamForgetFile(connId))})`)
          return okWhoami()
        }
        // Reading the journal HERE is what makes this a real ordering assertion: if the write
        // were moved after the POST, this read would throw/report absent instead of quietly
        // producing the same end state.
        const journal = JSON.parse(readFileSync(teamForgetFile(connId), 'utf-8')) as { state: string; ids: string[] }
        events.push(`forget(journal=${journal.state}:${journal.ids.join(',')})`)
        return new Response(JSON.stringify({ ok: true, deleted: 2, deletedRuns: 0 }), { status: 200 })
      }),
    })

    const out = await runForgetSequence(fakeConn(connId), { forgetIds: ['a', 'b'], forgetRuns: [], rulesHash: 'h1' }, deps)

    expect(out.ok).toBe(true)
    expect(out.deleted).toBe(2)
    expect(events).toEqual(['whoami(journal=false)', 'forget(journal=forgetting:a,b)'])
  })

  it('drops only ACKED batches from the sent-state', async () => {
    const connId = randomConnId()
    const ids = Array.from({ length: 600 }, (_, i) => `s${i}`)
    await seedSentState(connId, [...ids, 'untouched'])

    let batch = 0
    const deps = baseDeps({
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/team/whoami')) return okWhoami()
        batch++
        if (batch === 1) return new Response(JSON.stringify({ ok: true, deleted: 500, deletedRuns: 0 }), { status: 200 })
        throw new Error('connection reset') // batch 2 → network error
      }),
    })

    const out = await runForgetSequence(fakeConn(connId), { forgetIds: ids, forgetRuns: [], rulesHash: 'h1' }, deps)

    expect(out.ok).toBe(false)
    expect(out.deleted).toBe(500)
    const sent = await readSentState(connId)
    // Batch 1's ids are gone…
    expect(sent.hashes['s0']).toBeUndefined()
    expect(sent.hashes['s499']).toBeUndefined()
    // …and batch 2's are STILL there — an id dropped before the central confirmed would be
    // re-pushed by the next delta pass and silently restored.
    expect(sent.hashes['s500']).toBe('hash-of-s500')
    expect(sent.hashes['s599']).toBe('hash-of-s599')
    expect(sent.hashes['untouched']).toBe('hash-of-untouched')
    expect(Object.keys(sent.hashes)).toHaveLength(101) // 100 unacked + 'untouched'
    // The journal is still open, so the next cycle (or the boot replay) resumes.
    expect(existsSync(teamForgetFile(connId))).toBe(true)
  })

  it('treats a 200 whose body is not {ok:true} as a failure', async () => {
    const connId = randomConnId()
    await seedSentState(connId, ['a'])
    let posts = 0
    const deps = baseDeps({
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/team/whoami')) return okWhoami()
        posts++
        // A reverse proxy in front of a central answering the JSON 404 with an HTML page.
        return new Response('<!doctype html><html><body>Not found</body></html>', {
          status: 200, headers: { 'Content-Type': 'text/html' },
        })
      }),
    })

    const out = await runForgetSequence(fakeConn(connId), { forgetIds: ['a'], forgetRuns: [], rulesHash: 'h1' }, deps)

    expect(posts).toBe(1)
    expect(out.ok).toBe(false)
    expect(out.deleted).toBe(0)
    // Nothing was acknowledged, so nothing left the sent-state and the journal stays open.
    expect((await readSentState(connId)).hashes['a']).toBe('hash-of-a')
    expect(existsSync(teamForgetFile(connId))).toBe(true)
  })

  it('aborts without deleting anything when whoami fails', async () => {
    const connId = randomConnId()
    await seedSentState(connId, ['a'])
    const calls: string[] = []
    const deps = baseDeps({
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input))
        // 200 with ok:false — the shape a central answers when it cannot prove the identity.
        return new Response(JSON.stringify({ ok: false }), { status: 200 })
      }),
    })

    const out = await runForgetSequence(fakeConn(connId), { forgetIds: ['a'], forgetRuns: [], rulesHash: 'h1' }, deps)

    expect(out.ok).toBe(false)
    expect(out.pendingRules).toBe(true)
    expect(calls.filter(u => u.endsWith('/api/team/forget'))).toEqual([]) // ZERO forget POSTs
    expect((await readSentState(connId)).hashes['a']).toBe('hash-of-a')
    // No journal either: nothing was promised, so there is nothing to replay.
    expect(existsSync(teamForgetFile(connId))).toBe(false)
  })

  it('removes the connection on 401 and does not widen the delete', async () => {
    const connId = randomConnId()
    const ids = Array.from({ length: 600 }, (_, i) => `s${i}`)
    await seedSentState(connId, ids)
    const revoked: Array<{ connId: string; reason: string }> = []
    const bodies: string[][] = []

    let batch = 0
    const deps = baseDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/team/whoami')) return okWhoami()
        bodies.push((JSON.parse(String(init?.body)) as { sessionIds: string[] }).sessionIds)
        batch++
        if (batch === 1) return new Response(JSON.stringify({ ok: true, deleted: 500 }), { status: 200 })
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      }),
      onRevoked: async (id, reason) => { revoked.push({ connId: id, reason }) },
    })

    const out = await runForgetSequence(fakeConn(connId), { forgetIds: ids, forgetRuns: [], rulesHash: 'h1' }, deps)

    expect(out.ok).toBe(false)
    expect(revoked).toEqual([{ connId, reason: 'revoked' }])
    // The delete was never widened: exactly the planned ids were named, in two bounded batches,
    // and the sequence STOPPED at the 401 rather than retrying or falling back to a broader call.
    expect(batch).toBe(2)
    expect(bodies).toHaveLength(2)
    expect(bodies.flat()).toEqual(ids)
    expect(bodies.every(b => b.length <= FORGET_BATCH_SIZE)).toBe(true)
  })

  it('deletes the journal only after the sequence completes', async () => {
    const connId = randomConnId()
    await seedSentState(connId, ['a'], ['r1'])
    const events: string[] = []
    let pushOk = false

    const deps = (): ForgetDeps => baseDeps({
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/team/whoami')) return okWhoami()
        events.push('forget')
        return new Response(JSON.stringify({ ok: true, deleted: 1, deletedRuns: 1 }), { status: 200 })
      }),
      pushRebuiltCache: async () => {
        // The rebuilt cache is pushed AFTER the delete, in the same sequence, and the journal is
        // still open while it runs.
        events.push(`push(journal=${existsSync(teamForgetFile(connId))})`)
        return pushOk
      },
    })

    // 1) The delete succeeded but the follow-up cache push did not: the sessions are already gone
    //    from the central, so the journal MUST stay open (the machine now under-reports until a
    //    push lands — the safe direction, and §6.3 keeps `pendingRules` true meanwhile).
    const failed = await runForgetSequence(fakeConn(connId), { forgetIds: ['a'], forgetRuns: ['r1'], rulesHash: 'h1' }, deps())
    expect(failed.ok).toBe(false)
    expect(existsSync(teamForgetFile(connId))).toBe(true)
    expect(events).toEqual(['forget', 'push(journal=true)'])

    // 2) Same sequence, this time with a successful push → the journal is finally removed.
    pushOk = true
    const done = await runForgetSequence(fakeConn(connId), { forgetIds: ['a'], forgetRuns: ['r1'], rulesHash: 'h1' }, deps())
    expect(done.ok).toBe(true)
    expect(existsSync(teamForgetFile(connId))).toBe(false)
    expect(events).toEqual(['forget', 'push(journal=true)', 'forget', 'push(journal=true)'])
    // The acked ids AND the run ids are out of the sent-state once the whole sequence completed.
    const sent = await readSentState(connId)
    expect(sent.hashes['a']).toBeUndefined()
    expect(sent.runIds).toEqual([])
  })

  it('never contacts the central when the central cannot forget', async () => {
    const connId = randomConnId()
    await seedSentState(connId, ['a'])
    let calls = 0
    const out = await runForgetSequence(
      fakeConn(connId),
      { forgetIds: ['a'], forgetRuns: [], rulesHash: 'h1' },
      baseDeps({ canForget: () => false, fetch: (async () => { calls++; return new Response('{}') }) }),
    )
    expect(calls).toBe(0)
    expect(out.ok).toBe(false)
    expect(out.pendingRules).toBe(true)
    expect(existsSync(teamForgetFile(connId))).toBe(false)
    expect((await readSentState(connId)).hashes['a']).toBe('hash-of-a')
  })

  it('is a no-op with no ids and no run ids — no whoami, no journal, no POST', async () => {
    const connId = randomConnId()
    let calls = 0
    const out = await runForgetSequence(
      fakeConn(connId),
      { forgetIds: [], forgetRuns: [], rulesHash: 'h1' },
      baseDeps({ fetch: (async () => { calls++; return new Response('{}') }) }),
    )
    expect(out).toEqual({ ok: true, deleted: 0 })
    expect(calls).toBe(0)
    expect(existsSync(teamForgetFile(connId))).toBe(false)
  })

  it('reports progress per acked batch, never up front', async () => {
    const connId = randomConnId()
    const ids = Array.from({ length: 600 }, (_, i) => `s${i}`)
    await seedSentState(connId, ids)
    const seen: string[] = []
    const deps = baseDeps({
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/team/whoami')) return okWhoami()
        return new Response(JSON.stringify({ ok: true, deleted: 1 }), { status: 200 })
      }),
      onProgress: p => { seen.push(`${p.phase} ${p.done}/${p.total}`) },
      pushRebuiltCache: async () => true,
    })
    await runForgetSequence(fakeConn(connId), { forgetIds: ids, forgetRuns: [], rulesHash: 'h1' }, deps)
    expect(seen).toEqual(['forget 0/600', 'forget 500/600', 'forget 600/600', 'push 600/600'])
  })
})

describe('loadForgetJournal', () => {
  it('reads back the journal a running sequence left open', async () => {
    const connId = randomConnId()
    await seedSentState(connId, ['a'])
    await runForgetSequence(
      fakeConn(connId),
      { forgetIds: ['a'], forgetRuns: ['r1'], rulesHash: 'h9' },
      baseDeps({
        fetch: (async (input: RequestInfo | URL) => {
          if (String(input).endsWith('/api/team/whoami')) return okWhoami()
          throw new Error('central down')
        }),
      }),
    )
    const journal = await loadForgetJournal(connId)
    expect(journal?.ids).toEqual(['a'])
    expect(journal?.runIds).toEqual(['r1'])
    expect(journal?.rulesHash).toBe('h9')
  })

  it('returns null when there is no journal, and for a corrupt one', async () => {
    expect(await loadForgetJournal(randomConnId())).toBeNull()
    const corrupt = randomConnId()
    await writeFile(teamForgetFile(corrupt), 'not json{{', 'utf-8')
    expect(await loadForgetJournal(corrupt)).toBeNull()
  })
})
