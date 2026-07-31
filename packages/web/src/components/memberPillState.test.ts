import { describe, expect, test } from 'bun:test'
import { computeMemberPillState, statusOf, type PillConnection } from './memberPillState'

const NOW = 1_700_000_000_000

const ok = (over: Partial<PillConnection> = {}): PillConnection => ({
  lastSuccessAt: NOW - 12_000, errKind: null, latencyMs: 40, ...over,
})
const auth = (over: Partial<PillConnection> = {}): PillConnection => ({
  lastSuccessAt: NOW - 60_000, errKind: 'auth', ...over,
})
const net = (over: Partial<PillConnection> = {}): PillConnection => ({
  lastSuccessAt: NOW - 60_000, errKind: 'net', ...over,
})
const resync = (over: Partial<PillConnection> = {}): PillConnection => ({
  lastSuccessAt: NOW - 60_000, errKind: null, resync: { phase: 'forget', done: 1, total: 3 }, ...over,
})
const connecting = (): PillConnection => ({ lastSuccessAt: null, errKind: null })

describe('statusOf — per-connection classification', () => {
  test('a connection with no lastSuccessAt and no error is "connecting", not "ok"', () => {
    expect(statusOf(connecting())).toBe('connecting')
  })
  test('auth beats everything', () => {
    expect(statusOf(auth())).toBe('auth')
  })
  test('net error with no auth error', () => {
    expect(statusOf(net())).toBe('net')
  })
  test('an in-flight resync with no error', () => {
    expect(statusOf(resync())).toBe('resync')
  })
  test('a real success with no error and no resync is "ok"', () => {
    expect(statusOf(ok())).toBe('ok')
  })
})

describe('computeMemberPillState — zero and one connection', () => {
  test('zero connections renders nothing', () => {
    expect(computeMemberPillState([], 'en', NOW)).toBeNull()
  })

  test('one connection, ok — today’s exact EN string, unchanged', () => {
    const st = computeMemberPillState([ok()], 'en', NOW)
    expect(st).toEqual({ dot: '#22c55e', label: 'Connected', sub: 'last sync 12s ago · 40ms' })
  })

  test('one connection, ok — today’s exact PT string, unchanged', () => {
    const st = computeMemberPillState([ok()], 'pt', NOW)
    expect(st).toEqual({ dot: '#22c55e', label: 'Conectado', sub: 'último envio há 12s · 40ms' })
  })

  test('one connection, auth — today’s exact EN string', () => {
    const st = computeMemberPillState([auth()], 'en', NOW)
    expect(st).toEqual({
      dot: '#ef4444', label: 'Unauthorized',
      sub: 'the central rejected this machine’s token',
    })
  })

  test('one connection, net error with a prior success — today’s exact EN string', () => {
    const st = computeMemberPillState([net()], 'en', NOW)
    expect(st).toEqual({
      dot: '#f59e0b', label: 'Reconnecting…',
      sub: 'no contact — last sync 1min ago',
    })
  })

  test('one connection, net error, never synced — today’s exact EN string', () => {
    const st = computeMemberPillState([net({ lastSuccessAt: null })], 'en', NOW)
    expect(st).toEqual({
      dot: '#f59e0b', label: 'Reconnecting…',
      sub: 'not connected to the central yet',
    })
  })

  test('one connection, connecting (never synced, no error) — today’s exact EN string', () => {
    const st = computeMemberPillState([connecting()], 'en', NOW)
    expect(st).toEqual({ dot: 'var(--text-tertiary)', label: 'Connecting…', sub: 'first sync shortly' })
  })
})

describe('computeMemberPillState — N connections, all ok', () => {
  test('produces centralsN with the correct count', () => {
    const st = computeMemberPillState([ok(), ok(), ok()], 'en', NOW)
    expect(st!.label).toBe('3 centrals')
    expect(st!.dot).toBe('#22c55e')
  })

  test('centralsN in Portuguese', () => {
    const st = computeMemberPillState([ok(), ok()], 'pt', NOW)
    expect(st!.label).toBe('2 centrais')
  })
})

describe('computeMemberPillState — precedence, asserted pairwise', () => {
  test('auth beats net', () => {
    const st = computeMemberPillState([auth(), net()], 'en', NOW)
    expect(st!.label).toBe('1 unauthorized')
  })
  test('net beats resync', () => {
    const st = computeMemberPillState([net(), resync()], 'en', NOW)
    expect(st!.label).toBe('1 reconnecting')
  })
  test('resync beats ok', () => {
    const st = computeMemberPillState([resync(), ok()], 'en', NOW)
    expect(st!.label).toBe('1 re-syncing')
  })
  test('auth beats resync directly', () => {
    const st = computeMemberPillState([auth(), resync()], 'en', NOW)
    expect(st!.label).toBe('1 unauthorized')
  })
  test('auth beats ok directly', () => {
    const st = computeMemberPillState([auth(), ok()], 'en', NOW)
    expect(st!.label).toBe('1 unauthorized')
  })
  test('net beats ok directly', () => {
    const st = computeMemberPillState([net(), ok()], 'en', NOW)
    expect(st!.label).toBe('1 reconnecting')
  })
  test('a three-way mix still resolves to the single worst category (auth)', () => {
    const st = computeMemberPillState([auth(), net(), resync(), ok()], 'en', NOW)
    expect(st!.label).toBe('1 unauthorized')
  })
  test('the count reflects only connections AT the worst rank, not the total', () => {
    const st = computeMemberPillState([auth(), auth(), net(), ok()], 'en', NOW)
    expect(st!.label).toBe('2 unauthorized')
  })
  test('every mixed bucket renders an amber dot, including the auth (worst) case', () => {
    expect(computeMemberPillState([auth(), ok()], 'en', NOW)!.dot).toBe('#f59e0b')
    expect(computeMemberPillState([net(), ok()], 'en', NOW)!.dot).toBe('#f59e0b')
    expect(computeMemberPillState([resync(), ok()], 'en', NOW)!.dot).toBe('#f59e0b')
  })
})
