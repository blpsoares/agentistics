import { expect, test, describe } from 'bun:test'
import { formatUptime, summarizeFleet } from './fleetSummary'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'

const NOW = 1_700_000_000_000

function row(o: Partial<ControlSession> & { id: string }): ControlSession {
  return {
    title: o.id, harness: 'claude', cwd: '/w', project: 'w',
    searchFields: {} as ControlSession['searchFields'],
    state: 'working', stateLabel: 'working', actionable: true, attached: false,
    ...o,
  } as ControlSession
}

describe('summarizeFleet', () => {
  test('counts running, waiting and off', () => {
    const s = summarizeFleet([
      row({ id: 'a', state: 'working' }),
      row({ id: 'b', state: 'waiting' }),
      row({ id: 'c', state: 'waiting-approval' }),
      row({ id: 'd', state: 'exited' }),
      row({ id: 'e', state: 'lost' }),
    ], NOW)
    expect(s.total).toBe(5)
    expect(s.running).toBe(3)
    expect(s.waiting).toBe(2)
    expect(s.off).toBe(2)
  })

  test('slices by harness, busiest first, ties broken by name so polls do not shuffle it', () => {
    const s = summarizeFleet([
      row({ id: 'a', harness: 'codex', state: 'working' }),
      row({ id: 'b', harness: 'claude', state: 'working' }),
      row({ id: 'c', harness: 'claude', state: 'exited' }),
      row({ id: 'd', harness: 'agy', state: 'exited' }),
    ], NOW)
    expect(s.harnesses.map(h => h.harness)).toEqual(['claude', 'agy', 'codex'])
    expect(s.harnesses[0]).toEqual({ harness: 'claude', count: 2, running: 1 })
  })

  test('sums uptime over RUNNING sessions only', () => {
    const s = summarizeFleet([
      row({ id: 'a', state: 'working', startedAt: NOW - 60_000 }),
      row({ id: 'b', state: 'exited', startedAt: NOW - 999_000 }),
    ], NOW)
    expect(s.activeMs).toBe(60_000)
  })

  test('no running session with a start time yields NO figure, never a zero', () => {
    // The distinction the surface renders as a sentence: "nothing has been up for any time" and
    // "nothing here records when they started" are different statements.
    const s = summarizeFleet([row({ id: 'a', state: 'working' })], NOW)
    expect(s.activeMs).toBeUndefined()
    expect(s.activeUnknown).toBe(1)
  })

  test('a start time in the future contributes zero rather than subtracting', () => {
    // Clock skew: a fleet uptime that goes DOWN when a session starts is worse than a short one.
    const s = summarizeFleet([
      row({ id: 'a', state: 'working', startedAt: NOW + 500_000 }),
      row({ id: 'b', state: 'working', startedAt: NOW - 10_000 }),
    ], NOW)
    expect(s.activeMs).toBe(10_000)
  })

  test('counts distinct projects, folding a worktree into its main checkout', () => {
    const s = summarizeFleet([
      row({ id: 'a', project: 'wt-1', projectGroup: 'agentistics' }),
      row({ id: 'b', project: 'wt-2', projectGroup: 'agentistics' }),
      row({ id: 'c', project: 'other' }),
    ], NOW)
    expect(s.projects).toBe(2)
  })

  test('an empty fleet summarizes to zeros, and to no uptime figure at all', () => {
    const s = summarizeFleet([], NOW)
    expect(s.total).toBe(0)
    expect(s.harnesses).toEqual([])
    expect(s.activeMs).toBeUndefined()
  })
})

describe('formatUptime', () => {
  test('at most two units, so a long total stays readable', () => {
    expect(formatUptime(48_000)).toBe('48s')
    expect(formatUptime(12 * 60_000)).toBe('12m')
    expect(formatUptime((3 * 60 + 12) * 60_000)).toBe('3h 12m')
    expect(formatUptime((50 * 60 + 30) * 60_000)).toBe('2d 2h')
  })

  test('the second unit is what keeps 2h and 2h 59m apart', () => {
    expect(formatUptime(2 * 3600_000)).toBe('2h 0m')
    expect(formatUptime(2 * 3600_000 + 59 * 60_000)).toBe('2h 59m')
  })
})
