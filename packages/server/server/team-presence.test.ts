import { test, expect } from 'bun:test'
import { foldPresence } from './team-presence'

type Sig = { online: boolean; latencyMs: number | null; everHadSocket: boolean; inDropGrace: boolean }
const sig = (over: Partial<Sig> = {}): Sig =>
  ({ online: false, latencyMs: null, everHadSocket: false, inDropGrace: false, ...over })

const NOW = Date.parse('2026-07-29T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const STALE = 75_000

test('a member on a live socket is online', () => {
  const out = foldPresence(
    [{ user: 'Bryan', lastSeenAt: ago(10_000) }],
    new Map([['Bryan', sig({ online: true, latencyMs: 42, everHadSocket: true })]]),
    STALE, NOW,
  )
  expect(out.Bryan).toEqual({ online: true, lastSeenAt: ago(10_000), latencyMs: 42 })
})

test('a pure-HTTP pusher falls back to the heartbeat window', () => {
  const fresh = foldPresence([{ user: 'Ana', lastSeenAt: ago(20_000) }], new Map(), STALE, NOW)
  expect(fresh.Ana!.online).toBe(true)
  const stale = foldPresence([{ user: 'Ana', lastSeenAt: ago(200_000) }], new Map(), STALE, NOW)
  expect(stale.Ana!.online).toBe(false)
})

test('a dropped socket past the grace is offline even with a recent heartbeat', () => {
  const out = foldPresence(
    [{ user: 'Bryan', lastSeenAt: ago(1_000) }],
    new Map([['Bryan', sig({ everHadSocket: true, inDropGrace: false })]]),
    STALE, NOW,
  )
  expect(out.Bryan!.online).toBe(false)
})

// The regression: presence is keyed by display name, but listMembers() yields one row PER MACHINE
// TOKEN, sorted by createdAt. Assigning out[user] in a loop let the newest row overwrite the rest,
// so a member on a live WebSocket read OFFLINE because a second, idle token of theirs sorted later.
// The signal map is keyed by display name, so the WS path is order-independent by construction —
// the overwrite bit on the HEARTBEAT path, where liveness is read per row from that machine's own
// lastSeenAt. A member pushing fine over HTTP (WS blocked by a proxy that won't upgrade) read
// OFFLINE whenever a second, idle token of theirs sorted later.
test('a member with several machines is online when ANY of them is (order-independent)', () => {
  const rows = [
    { user: 'Bryan', lastSeenAt: ago(5_000) },      // pushing right now
    { user: 'Bryan', lastSeenAt: ago(900_000) },    // idle/stale token, sorts last
  ]
  expect(foldPresence(rows, new Map(), STALE, NOW).Bryan!.online).toBe(true)
  expect(foldPresence([...rows].reverse(), new Map(), STALE, NOW).Bryan!.online).toBe(true)
})

test('folding several machines keeps the most recent lastSeenAt and the best latency', () => {
  const out = foldPresence(
    [{ user: 'Bryan', lastSeenAt: ago(900_000) }, { user: 'Bryan', lastSeenAt: ago(5_000) }],
    new Map([['Bryan', sig({ online: true, latencyMs: 30, everHadSocket: true })]]),
    STALE, NOW,
  )
  expect(out.Bryan!.lastSeenAt).toBe(ago(5_000))
  expect(out.Bryan!.latencyMs).toBe(30)
})

test('an all-offline member stays offline, and a null lastSeenAt never wins', () => {
  const out = foldPresence(
    [{ user: 'Ana', lastSeenAt: ago(900_000) }, { user: 'Ana', lastSeenAt: null }],
    new Map(), STALE, NOW,
  )
  expect(out.Ana).toEqual({ online: false, lastSeenAt: ago(900_000), latencyMs: null })
})
