import { test, expect } from 'bun:test'
import { foldMachinePresence, foldPresenceByUser } from './team-presence'

type Sig = { online: boolean; latencyMs: number | null; everHadSocket: boolean; inDropGrace: boolean }
const sig = (over: Partial<Sig> = {}): Sig =>
  ({ online: false, latencyMs: null, everHadSocket: false, inDropGrace: false, ...over })

const NOW = Date.parse('2026-07-29T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const STALE = 75_000

// ---------------------------------------------------------------------------
// foldMachinePresence — per-machine, keyed by `id` (memberId)
// ---------------------------------------------------------------------------

test('a machine on a live socket is online', () => {
  const out = foldMachinePresence(
    [{ id: 'm1', user: 'Bryan', lastSeenAt: ago(10_000) }],
    new Map([['m1', sig({ online: true, latencyMs: 42, everHadSocket: true })]]),
    STALE, NOW,
  )
  expect(out.m1).toEqual({ online: true, lastSeenAt: ago(10_000), latencyMs: 42 })
})

test('a pure-HTTP pusher falls back to the heartbeat window', () => {
  const fresh = foldMachinePresence([{ id: 'm1', user: 'Ana', lastSeenAt: ago(20_000) }], new Map(), STALE, NOW)
  expect(fresh.m1!.online).toBe(true)
  const stale = foldMachinePresence([{ id: 'm1', user: 'Ana', lastSeenAt: ago(200_000) }], new Map(), STALE, NOW)
  expect(stale.m1!.online).toBe(false)
})

test('a dropped socket past the grace is offline even with a recent heartbeat', () => {
  const out = foldMachinePresence(
    [{ id: 'm1', user: 'Bryan', lastSeenAt: ago(1_000) }],
    new Map([['m1', sig({ everHadSocket: true, inDropGrace: false })]]),
    STALE, NOW,
  )
  expect(out.m1!.online).toBe(false)
})

// The regression this whole change fixes: presence used to be keyed by resolved `user`, and two
// ownerless machines both carry `user: ''` (see `machineUserFor` in team-tokens.ts). Keying by
// `id` (memberId) instead means each machine's row is looked up and stored under its OWN key —
// two machines can never collide just because they share (or both lack) a `user`.
test('two ownerless machines never share a presence signal — one online does not make the other online', () => {
  const members = [
    { id: 'machine-a', user: '', lastSeenAt: ago(900_000) }, // stale heartbeat, no WS
    { id: 'machine-b', user: '', lastSeenAt: ago(5_000) },   // fresh heartbeat + live socket
  ]
  const signals = new Map([
    ['machine-a', sig({ online: false, everHadSocket: false })],
    ['machine-b', sig({ online: true, latencyMs: 12, everHadSocket: true })],
  ])
  const out = foldMachinePresence(members, signals, STALE, NOW)
  expect(out['machine-a']!.online).toBe(false)
  expect(out['machine-b']!.online).toBe(true)
})

test('two DIFFERENT rows that happen to carry the same `user` string still keep separate machine rows', () => {
  // Not the realistic case (users are unique display names) but proves the key really is `id`,
  // not `user`: an accidental duplicate `user` must not fold two machine rows together at this
  // layer (that fold, when intentional, happens in foldPresenceByUser, never here).
  const members = [
    { id: 'm1', user: 'shared-name', lastSeenAt: ago(900_000) },
    { id: 'm2', user: 'shared-name', lastSeenAt: ago(5_000) },
  ]
  const signals = new Map([['m2', sig({ online: true, everHadSocket: true })]])
  const out = foldMachinePresence(members, signals, STALE, NOW)
  expect(out.m1!.online).toBe(false)
  expect(out.m2!.online).toBe(true)
})

// ---------------------------------------------------------------------------
// foldPresenceByUser — folds machine-level presence up into per-person presence
// ---------------------------------------------------------------------------

test('a person with several machines is online when ANY of them is (order-independent)', () => {
  const rows = [
    { id: 'm1', user: 'Bryan', lastSeenAt: ago(5_000) },   // pushing right now
    { id: 'm2', user: 'Bryan', lastSeenAt: ago(900_000) }, // idle/stale token
  ]
  const machinePresence = {
    m1: { online: true, lastSeenAt: ago(5_000), latencyMs: 30 },
    m2: { online: false, lastSeenAt: ago(900_000), latencyMs: null },
  }
  expect(foldPresenceByUser(rows, machinePresence).Bryan!.online).toBe(true)
  expect(foldPresenceByUser([...rows].reverse(), machinePresence).Bryan!.online).toBe(true)
})

test('folding several machines keeps the most recent lastSeenAt and the best latency', () => {
  const rows = [
    { id: 'm1', user: 'Bryan', lastSeenAt: ago(900_000) },
    { id: 'm2', user: 'Bryan', lastSeenAt: ago(5_000) },
  ]
  const machinePresence = {
    m1: { online: true, lastSeenAt: ago(900_000), latencyMs: 30 },
    m2: { online: true, lastSeenAt: ago(5_000), latencyMs: 80 },
  }
  const out = foldPresenceByUser(rows, machinePresence)
  expect(out.Bryan!.lastSeenAt).toBe(ago(5_000))
  expect(out.Bryan!.latencyMs).toBe(30)
})

test('an all-offline person stays offline, and a null lastSeenAt never wins', () => {
  const rows = [
    { id: 'm1', user: 'Ana', lastSeenAt: ago(900_000) },
    { id: 'm2', user: 'Ana', lastSeenAt: null },
  ]
  const machinePresence = {
    m1: { online: false, lastSeenAt: ago(900_000), latencyMs: null },
    m2: { online: false, lastSeenAt: null, latencyMs: null },
  }
  expect(foldPresenceByUser(rows, machinePresence)).toEqual({
    Ana: { online: false, lastSeenAt: ago(900_000), latencyMs: null },
  })
})

// An ownerless machine (`user: ''`) must never surface in the per-person view, and must never be
// folded together with another ownerless machine under a shared blank key — that IS the "machine
// displayed as a member" bug: at this layer it would resurrect as a fake "member" named ''.
test('an ownerless machine (user: "") is excluded from the per-person fold entirely', () => {
  const rows = [
    { id: 'm1', user: '', lastSeenAt: ago(5_000) },
    { id: 'm2', user: 'Bryan', lastSeenAt: ago(5_000) },
  ]
  const machinePresence = {
    m1: { online: true, lastSeenAt: ago(5_000), latencyMs: 10 },
    m2: { online: true, lastSeenAt: ago(5_000), latencyMs: 20 },
  }
  const out = foldPresenceByUser(rows, machinePresence)
  expect(Object.keys(out)).toEqual(['Bryan'])
  expect(out['']).toBeUndefined()
})
