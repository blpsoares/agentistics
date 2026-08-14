/**
 * event-store.test.ts — the inbox against a real filesystem, in a temp directory.
 *
 * The pure rules are tested in `event-core.test.ts`; what is checked here is that this file wires
 * them to disk correctly — that a cursor really does survive a rotation, that a reader picks up
 * exactly what it has not seen, and that the producer's "first poll writes nothing" holds against a
 * real store rather than only in the planner.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEventStore } from './event-store'
import { EMPTY_CURSOR } from './event-rotate'
import { EVENT_VERSION, type SessionEvent } from './event-types'
import { createProducer } from './producer'
import type { SessionSnapshot } from '../sessions/sessions-host'

const dirs: string[] = []
const tmpFile = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'agentop-events-'))
  dirs.push(d)
  return join(d, 'events.jsonl')
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const ev = (o: Partial<SessionEvent>): SessionEvent => ({
  v: EVENT_VERSION, seq: 0, at: new Date().toISOString(), source: 'poll', kind: 'waiting',
  id: 's1', cwd: '/w', ...o,
})

describe('the inbox on disk', () => {
  test('appends are numbered from 1 and read back in order', async () => {
    const store = createEventStore(tmpFile())
    await store.append([ev({ id: 'a' }), ev({ id: 'b' })])
    await store.append([ev({ id: 'c' })])
    const r = await store.recent(10)
    expect(r.events.map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(r.events.map(e => e.seq)).toEqual([1, 2, 3])
  })

  test('a new store continues the numbering of a file it did not write', async () => {
    const file = tmpFile()
    await createEventStore(file).append([ev({ id: 'a' }), ev({ id: 'b' })])
    await createEventStore(file).append([ev({ id: 'c' })])
    expect((await createEventStore(file).recent(10)).events.map(e => e.seq)).toEqual([1, 2, 3])
  })

  test('the file is created 0600 — it holds the user\'s own screen text', async () => {
    const file = tmpFile()
    await createEventStore(file).append([ev({})])
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  test('`since` returns exactly what has not been read', async () => {
    const store = createEventStore(tmpFile())
    await store.append([ev({ id: 'a' })])
    const first = await store.recent(10)
    await store.append([ev({ id: 'b' }), ev({ id: 'c' })])
    const next = await store.since(first.cursor)
    expect(next.events.map(e => e.id)).toEqual(['b', 'c'])
    expect(next.rotated).toBe(false)
    // …and reading again from the new cursor yields nothing.
    expect((await store.since(next.cursor)).events).toEqual([])
  })

  test('the REAL rotation restarts the numbering, keeps one generation, and invalidates the cursor', async () => {
    const file = tmpFile()
    // A cap small enough that the third event rolls the file over.
    const store = createEventStore(file, 300)
    await store.append([ev({ id: 'a' })])
    await store.append([ev({ id: 'b' })])
    const stale = (await store.recent(10)).cursor
    expect(stale.seq).toBe(2)

    await store.append([ev({ id: 'fresh' })])
    const after = await store.recent(10)
    expect(after.events.map(e => e.id)).toEqual(['fresh'])
    expect(after.events[0]?.seq).toBe(1)
    // The previous generation is kept, not deleted.
    expect(statSync(`${file}.1`).size).toBeGreaterThan(0)

    const r = await store.since(stale)
    expect(r.rotated).toBe(true)
    expect(r.events.map(e => e.id)).toEqual(['fresh'])
  })

  test('a garbage line costs that line and is COUNTED, not hidden', async () => {
    const file = tmpFile()
    const store = createEventStore(file)
    await store.append([ev({ id: 'a' })])
    writeFileSync(file, `${'{"broken":'}\n`, { flag: 'a' })
    await store.append([ev({ id: 'b' })])
    const r = await store.recent(10)
    expect(r.events.map(e => e.id)).toEqual(['a', 'b'])
    expect(r.unreadable).toBe(1)
  })

  test('the empty cursor reads everything, and an empty inbox reads as empty', async () => {
    const store = createEventStore(tmpFile())
    expect((await store.since(EMPTY_CURSOR)).events).toEqual([])
    expect((await store.info()).bytes).toBe(0)
  })
})

describe('the producer against a real store', () => {
  const snapshot = (sessions: SessionSnapshot['sessions']): SessionSnapshot =>
    ({ sessions, attention: 0, rang: [], polledAtMs: 0 })

  const view = (o: Record<string, unknown>) => ({
    id: 's1', cwd: '/w', status: 'running' as const, attached: false,
    approvalDetection: true, searchText: '', ...o,
  }) as SessionSnapshot['sessions'][number]

  const producerOver = (snaps: SessionSnapshot[], file: string) => {
    let i = 0
    return createProducer({
      poller: { poll: async () => snaps[Math.min(i++, snaps.length - 1)]! },
      readSubscriptions: async () => [],
      store: createEventStore(file),
      intervalMs: 1,
    })
  }

  test('the FIRST tick writes nothing — a daemon restart must not replay the fleet', async () => {
    const file = tmpFile()
    const p = producerOver([snapshot([view({ activity: 'waiting' })])], file)
    expect((await p.tick()).written).toEqual([])
    expect((await createEventStore(file).recent(10)).events).toEqual([])
  })

  test('a change CONFIRMED over two polls is written, and only for the session that changed', async () => {
    const file = tmpFile()
    const p = producerOver([
      snapshot([view({ activity: 'working' }), view({ id: 's2', activity: 'working' })]),
      snapshot([view({ activity: 'waiting-approval' }), view({ id: 's2', activity: 'working' })]),
      snapshot([view({ activity: 'waiting-approval' }), view({ id: 's2', activity: 'working' })]),
    ], file)
    await p.tick() // seeds
    expect((await p.tick()).written).toEqual([]) // one frame is not yet a state
    const third = await p.tick()
    expect(third.written.map(e => e.id)).toEqual(['s1'])
    expect(third.written[0]).toMatchObject({ kind: 'waiting-approval', from: 'working' })
  })

  test('a one-frame blip between two polls of the same state writes nothing at all', async () => {
    const file = tmpFile()
    const p = producerOver([
      snapshot([view({ activity: 'waiting' })]),
      snapshot([view({ activity: 'working' })]), // the repaint
      snapshot([view({ activity: 'waiting' })]),
      snapshot([view({ activity: 'waiting' })]),
      snapshot([view({ activity: 'waiting' })]),
    ], file)
    for (let i = 0; i < 5; i++) await p.tick()
    expect((await createEventStore(file).recent(10)).events).toEqual([])
  })

  test('a poll that could not read the fleet writes nothing and reports the reason', async () => {
    const file = tmpFile()
    const p = producerOver([
      snapshot([view({ activity: 'working' })]),
      { ...snapshot([view({ activity: 'working' })]), unavailable: 'tmux went away' },
    ], file)
    await p.tick()
    const t = await p.tick()
    expect(t.written).toEqual([])
    expect(t.unavailable).toBe('tmux went away')
  })

  test('a hook event already in the inbox suppresses the poller\'s duplicate of it', async () => {
    const file = tmpFile()
    const store = createEventStore(file)
    await store.append([ev({
      source: 'hook', kind: 'turn-end', harness: 'claude', cwd: '/repo', conversationId: 'c1',
      at: new Date().toISOString(),
    })])
    let i = 0
    const snaps = [
      snapshot([view({ activity: 'working', harness: 'claude', cwd: '/repo', conversationId: 'c1' })]),
      snapshot([view({ activity: 'waiting', harness: 'claude', cwd: '/repo', conversationId: 'c1' })]),
      snapshot([view({ activity: 'waiting', harness: 'claude', cwd: '/repo', conversationId: 'c1' })]),
    ]
    const p = createProducer({
      poller: { poll: async () => snaps[Math.min(i++, 2)]! },
      readSubscriptions: async () => [],
      store,
      intervalMs: 1,
    })
    await p.tick()
    await p.tick()
    expect((await p.tick()).written).toEqual([])
  })
})
