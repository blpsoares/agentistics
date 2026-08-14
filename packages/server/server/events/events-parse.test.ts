import { describe, expect, test } from 'bun:test'
import { parseCursorRef, parseEventsArgs, parseKinds } from './events-parse'
import { DEFAULT_EVENT_KINDS } from './event-types'
import {
  addSubscription, clearSubscriptions, kindsToRecord, newSubscriptionId, parseStore,
  removeSubscription, subscribersOf, type Subscription,
} from './subscriptions'
import { livePeers, selectPeerTarget, type PeerRecord } from './peer-target'
import { planDesktopChannel } from './notify-plan'

describe('parseEventsArgs', () => {
  test('bare and --help ask for help', () => {
    expect(parseEventsArgs([])).toEqual({ kind: 'help' })
    expect(parseEventsArgs(['--help'])).toEqual({ kind: 'help' })
  })

  test('watch defaults to the states that mean "something needs you"', () => {
    const c = parseEventsArgs(['watch'])
    expect(c).toMatchObject({ kind: 'watch' })
    expect((c as { options: { kinds: string[] } }).options.kinds).toEqual([...DEFAULT_EVENT_KINDS])
  })

  test('watch takes both --flag value and --flag=value', () => {
    const a = parseEventsArgs(['watch', '--task', 'canal', '--notify', 'cockpit', '--desktop'])
    const b = parseEventsArgs(['watch', '--task=canal', '--notify=cockpit', '--desktop'])
    expect((a as { options: unknown }).options).toEqual((b as { options: unknown }).options)
    expect(a).toMatchObject({ options: { task: 'canal', notify: 'cockpit', desktop: true } })
  })

  test('a misspelled state is refused, and the message names the closed set', () => {
    const c = parseEventsArgs(['watch', '--on', 'waitin'])
    expect(c.kind).toBe('error')
    expect((c as { message: string }).message).toContain('waiting-approval')
  })

  test('--on takes several and dedupes them', () => {
    expect(parseKinds('waiting,exited,waiting')).toEqual({ kinds: ['waiting', 'exited'] })
  })

  test('a flag with a missing value is an error, not a silently swallowed next flag', () => {
    expect(parseEventsArgs(['watch', '--task', '--desktop']).kind).toBe('error')
  })

  test('unwatch needs an id or --all, and refuses both', () => {
    expect(parseEventsArgs(['unwatch'])).toMatchObject({ kind: 'error' })
    expect(parseEventsArgs(['unwatch', 's1'])).toEqual({ kind: 'unwatch', id: 's1', all: false })
    expect(parseEventsArgs(['unwatch', '--all'])).toEqual({ kind: 'unwatch', all: true })
    expect(parseEventsArgs(['unwatch', 's1', '--all']).kind).toBe('error')
  })

  test('tail takes a count, a cursor and filters', () => {
    expect(parseEventsArgs(['tail', '-n', '5', '--since', '120:7', '--task', 'canal', '--json']))
      .toEqual({ kind: 'tail', options: { count: 5, since: 120, sinceSeq: 7, task: 'canal', json: true, follow: false } })
  })

  test('a cursor must carry BOTH halves — a bare offset cannot survive a rotation', () => {
    expect(parseCursorRef('120')).toMatchObject({ error: expect.any(String) })
    expect(parseCursorRef('120:7')).toEqual({ offset: 120, seq: 7 })
  })

  test('a bare `test` exercises the desktop channel rather than doing nothing', () => {
    expect(parseEventsArgs(['test'])).toEqual({ kind: 'test', desktop: true })
    expect(parseEventsArgs(['test', '--notify', 'cockpit'])).toEqual({ kind: 'test', notify: 'cockpit', desktop: false })
  })

  test('an unknown verb and an unknown option are both refused', () => {
    expect(parseEventsArgs(['frobnicate']).kind).toBe('error')
    expect(parseEventsArgs(['run', '--twice']).kind).toBe('error')
  })
})

describe('subscriptions', () => {
  const sub = (o: Partial<Subscription>): Subscription => ({
    id: 's1', createdAt: '2026-08-14T00:00:00.000Z', kinds: ['waiting'], desktop: false, ...o,
  })
  const event = (o: Record<string, unknown>) => ({
    v: 1, seq: 1, at: '2026-08-14T00:00:00.000Z', source: 'poll' as const, kind: 'waiting' as const,
    id: 'abc123', cwd: '/w', ...o,
  })

  test('no filters means every session of the wanted kinds', () => {
    expect(subscribersOf([sub({})], event({}))).toHaveLength(1)
    expect(subscribersOf([sub({})], event({ kind: 'exited' }))).toHaveLength(0)
  })

  test('the task filter is exact — "api" must not select "api-migration"', () => {
    expect(subscribersOf([sub({ task: 'api' })], event({ task: 'api' }))).toHaveLength(1)
    expect(subscribersOf([sub({ task: 'api' })], event({ task: 'api-migration' }))).toHaveLength(0)
  })

  test('the session filter matches an id PREFIX or a whole label', () => {
    expect(subscribersOf([sub({ session: 'abc' })], event({}))).toHaveLength(1)
    expect(subscribersOf([sub({ session: 'Backend' })], event({ label: 'backend' }))).toHaveLength(1)
    expect(subscribersOf([sub({ session: 'zzz' })], event({}))).toHaveLength(0)
  })

  test('kindsToRecord is a UNION and always holds the defaults', () => {
    const k = kindsToRecord([sub({ kinds: ['working'] })])
    expect(k).toContain('working')
    for (const d of DEFAULT_EVENT_KINDS) expect(k).toContain(d)
  })

  test('ids do not collide with what is already there', () => {
    expect(newSubscriptionId([])).toBe('s1')
    expect(newSubscriptionId([sub({ id: 's1' }), sub({ id: 's2' })])).toBe('s3')
  })

  test('a malformed store reads as empty rather than throwing', () => {
    expect(parseStore(null)).toEqual({ subscriptions: [] })
    expect(parseStore('nope')).toEqual({ subscriptions: [] })
    expect(parseStore({ subscriptions: 'nope' })).toEqual({ subscriptions: [] })
    expect(parseStore({ subscriptions: [{ nope: 1 }] })).toEqual({ subscriptions: [] })
  })

  test('a stored subscription whose kinds are all unreadable falls back to the defaults, not silence', () => {
    const r = parseStore({ subscriptions: [{ id: 's1', kinds: ['nonsense'], desktop: true }] })
    expect(r.subscriptions[0]?.kinds).toEqual([...DEFAULT_EVENT_KINDS])
  })

  test('removal reports what it removed, so "no such subscription" can be said', () => {
    const store = addSubscription({ subscriptions: [] }, sub({}))
    expect(removeSubscription(store, 'nope').removed).toEqual([])
    expect(removeSubscription(store, 's1').removed).toHaveLength(1)
    expect(clearSubscriptions(store).store.subscriptions).toEqual([])
  })
})

describe('selectPeerTarget', () => {
  const rec = (o: Partial<PeerRecord>): PeerRecord => ({
    pid: 1, name: 'cockpit', messagingSocketPath: '/run/1.sock', sessionId: 'c1', ...o,
  })
  const live = new Set(['/run/1.sock'])

  test('a name resolves to the session holding a live socket', () => {
    const r = selectPeerTarget([rec({})], 'cockpit', live)
    expect(r).toMatchObject({ ok: true, target: { pid: 1, socketPath: '/run/1.sock', sessionId: 'c1' } })
  })

  test('a pid resolves too', () => {
    expect(selectPeerTarget([rec({})], '1', live).ok).toBe(true)
  })

  test('a stale record with no live socket is NOT delivered to, and says so', () => {
    const r = selectPeerTarget([rec({ messagingSocketPath: '/run/9.sock' })], 'cockpit', live)
    expect(r).toMatchObject({ ok: false, code: 'not-live' })
    expect((r as { message: string }).message).toContain('inbox')
  })

  test('a name nobody registered is a no-match, not a silent drop', () => {
    expect(selectPeerTarget([rec({})], 'nobody', live)).toMatchObject({ ok: false, code: 'no-match' })
  })

  test('the match is whole, never a prefix — "cockpit" must not reach "cockpit-2"', () => {
    expect(selectPeerTarget([rec({ name: 'cockpit-2' })], 'cockpit', live))
      .toMatchObject({ ok: false, code: 'no-match' })
  })

  test('two live sessions under one name are ambiguous rather than a coin flip', () => {
    const r = selectPeerTarget(
      [rec({ pid: 1, startedAt: 1 }), rec({ pid: 2, messagingSocketPath: '/run/2.sock', startedAt: 2 })],
      'cockpit',
      new Set(['/run/1.sock', '/run/2.sock']),
    )
    expect(r).toMatchObject({ ok: false, code: 'ambiguous' })
    expect((r as { candidates: string[] }).candidates).toHaveLength(2)
  })

  test('livePeers keeps only the ones with a socket, newest first', () => {
    const out = livePeers(
      [rec({ pid: 1, startedAt: 1 }), rec({ pid: 9, messagingSocketPath: '/run/9.sock', startedAt: 9 }),
        rec({ pid: 2, messagingSocketPath: '/run/2.sock', startedAt: 2 })],
      new Set(['/run/1.sock', '/run/2.sock']),
    )
    expect(out.map(r => r.pid)).toEqual([2, 1])
  })
})

describe('planDesktopChannel', () => {
  test('ccn wins when it can actually run', () => {
    const d = planDesktopChannel({ ccnScript: '/p/notify.sh', hasJq: true, hasPowershell: true, hasNotifySend: true })
    expect(d.channel).toBe('ccn')
    expect(d.reason).toContain('/p/notify.sh')
  })

  test('ccn installed but missing its own requirements steps aside AND says why', () => {
    const d = planDesktopChannel({ ccnScript: '/p/notify.sh', hasJq: false, hasNotifySend: true })
    expect(d.channel).toBe('notify-send')
    expect(d.reason).toContain('jq')
  })

  test('WSL without ccn falls to a plain powershell toast', () => {
    expect(planDesktopChannel({ hasPowershell: true }).channel).toBe('powershell')
  })

  test('nothing but a terminal rings the bell', () => {
    expect(planDesktopChannel({ hasTty: true }).channel).toBe('bell')
  })

  test('no channel at all is a SENTENCE, never a silent false', () => {
    const d = planDesktopChannel({})
    expect(d.channel).toBe('none')
    expect(d.reason).toContain('notify-send')
    expect(d.reason).toContain('inbox')
  })

  test('switched off is its own reason, not confused with unavailable', () => {
    const d = planDesktopChannel({ disabled: true, hasNotifySend: true })
    expect(d.channel).toBe('none')
    expect(d.reason).toContain('switched off')
  })
})
