import { expect, test, describe } from 'bun:test'
import type { Filters } from '@agentistics/core'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import { filterFleet } from './fleetFilter'

const BASE: Filters = {
  dateRange: '7d' as Filters['dateRange'],
  customStart: '', customEnd: '', projects: [], models: [],
}

function row(o: Partial<ControlSession> & { id: string }): ControlSession {
  return {
    title: o.id, harness: 'claude', cwd: '/w', project: 'w',
    searchFields: {} as ControlSession['searchFields'],
    state: 'working', stateLabel: 'working', actionable: true, attached: false,
    ...o,
  } as ControlSession
}

describe('filterFleet', () => {
  test('nothing set keeps everything, and reports itself as not narrowed', () => {
    const out = filterFleet({
      rows: [row({ id: 'a' }), row({ id: 'b', state: 'exited' })],
      filters: BASE, activeOnly: false,
    })
    expect(out.rows).toHaveLength(2)
    expect(out.withheld).toBe(0)
    expect(out.narrowed).toBe(false)
  })

  test('activeOnly keeps what is running and counts what it withheld', () => {
    const out = filterFleet({
      rows: [
        row({ id: 'a', state: 'working' }),
        row({ id: 'b', state: 'waiting' }),
        row({ id: 'c', state: 'exited' }),
        row({ id: 'd', state: 'lost' }),
      ],
      filters: BASE, activeOnly: true,
    })
    expect(out.rows.map(r => r.id)).toEqual(['a', 'b'])
    expect(out.withheld).toBe(2)
    expect(out.narrowed).toBe(true)
  })

  test('harness filter, from either shape the Filters type allows', () => {
    const rows = [row({ id: 'a', harness: 'claude' }), row({ id: 'b', harness: 'codex' })]
    expect(filterFleet({ rows, filters: { ...BASE, harnesses: ['codex'] }, activeOnly: false }).rows.map(r => r.id))
      .toEqual(['b'])
    expect(filterFleet({ rows, filters: { ...BASE, harness: 'claude' }, activeOnly: false }).rows.map(r => r.id))
      .toEqual(['a'])
  })

  test('project matches the name, the group, or the exact cwd', () => {
    const rows = [
      row({ id: 'byName', project: 'agentistics' }),
      row({ id: 'byGroup', project: 'wt-1', projectGroup: 'agentistics' }),
      row({ id: 'byCwd', project: 'x', cwd: '/home/me/agentistics' }),
      row({ id: 'other', project: 'unrelated' }),
    ]
    const out = filterFleet({
      rows, filters: { ...BASE, projects: ['agentistics', '/home/me/agentistics'] }, activeOnly: false,
    })
    expect(out.rows.map(r => r.id).sort()).toEqual(['byCwd', 'byGroup', 'byName'])
  })

  test('a project filter never matches by PREFIX', () => {
    // A prefix test on `$HOME` would match every session on the machine.
    const out = filterFleet({
      rows: [row({ id: 'a', cwd: '/home/me/deep/project', project: 'project' })],
      filters: { ...BASE, projects: ['/home/me'] }, activeOnly: false,
    })
    expect(out.rows).toHaveLength(0)
  })

  test('a row with no model is withheld by a model filter rather than assumed to match', () => {
    // Unknown is not "some other model", but a filter cannot say anything about it either way, and
    // letting it through would put rows in a list the filter says is only one model.
    const out = filterFleet({
      rows: [row({ id: 'known', model: 'claude-opus-5' }), row({ id: 'unknown' })],
      filters: { ...BASE, models: ['claude-opus-5'] }, activeOnly: false,
    })
    expect(out.rows.map(r => r.id)).toEqual(['known'])
  })

  test('repo filter matches the row own repo', () => {
    const rows = [row({ id: 'a', repo: 'org/one' }), row({ id: 'b', repo: 'org/two' }), row({ id: 'c' })]
    const out = filterFleet({ rows, filters: { ...BASE, repos: ['org/one'] }, activeOnly: false })
    expect(out.rows.map(r => r.id)).toEqual(['a'])
  })

  test('the metric-only dimensions are IGNORED — see the module header', () => {
    // A date range would hide a session that started eight days ago and is still working; a tag
    // resolves against stored sessions a live row is not in yet.
    const rows = [row({ id: 'a' })]
    const out = filterFleet({
      rows,
      filters: {
        ...BASE, dateRange: '24h' as Filters['dateRange'],
        tags: ['t1'], users: ['u'], machines: ['m'], teams: ['x'], presence: 'offline',
      },
      activeOnly: false,
    })
    expect(out.rows).toHaveLength(1)
    expect(out.narrowed).toBe(false)
  })
})
