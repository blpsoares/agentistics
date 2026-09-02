import { describe, expect, it } from 'bun:test'
import { buildView, matches } from './view-model'
import type { FleetRow, SessionState } from './protocol'

function row(id: string, state: SessionState, project: string, extra: Partial<FleetRow> = {}): FleetRow {
  return {
    id,
    title: id,
    harness: 'claude',
    cwd: `/w/${project}/${id}`,
    project,
    state,
    stateLabel: state,
    actionable: true,
    attachCommand: `agentop session attach ${id}`,
    verbs: [],
    ...extra,
  }
}

const OPTS = { query: '', onlyActive: false }

describe('buildView', () => {
  it('puts the project holding the most urgent session first', () => {
    // The point of the screen is that what is blocked on you is at the top; alphabetical order
    // buries it under whatever project starts with an `a`.
    const view = buildView([
      row('a1', 'working', 'alpha'),
      row('z1', 'waiting-approval', 'zulu'),
      row('m1', 'lost', 'mike'),
    ], OPTS)
    expect(view.groups.map(g => g.project)).toEqual(['zulu', 'alpha', 'mike'])
  })

  it('orders within a project by urgency, then by name for a stable list', () => {
    // A list that reshuffles every five seconds cannot be clicked.
    const view = buildView([
      row('b', 'working', 'p'),
      row('a', 'working', 'p'),
      row('c', 'waiting-approval', 'p'),
      row('d', 'lost', 'p'),
    ], OPTS)
    expect(view.groups[0]!.rows.map(r => r.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('breaks a tie between equally urgent projects by name', () => {
    const view = buildView([row('x', 'working', 'zed'), row('y', 'working', 'abe')], OPTS)
    expect(view.groups.map(g => g.project)).toEqual(['abe', 'zed'])
  })

  it('counts what is shown against what exists', () => {
    const view = buildView([
      row('a', 'working', 'p'),
      row('b', 'lost', 'p'),
    ], { query: '', onlyActive: true })
    expect(view.shown).toBe(1)
    expect(view.total).toBe(2)
  })

  it('keeps the three empty states apart', () => {
    // Blaming the filter while a search emptied the list sends someone to the wrong switch.
    expect(buildView([], OPTS).empty).toBe('none')
    expect(buildView([row('a', 'lost', 'p')], { query: '', onlyActive: true }).empty).toBe('onlyActive')
    expect(buildView([row('a', 'working', 'p')], { query: 'nothing', onlyActive: false }).empty).toBe('filtered')
    expect(buildView([row('a', 'working', 'p')], OPTS).empty).toBeNull()
  })

  it('blames the search first when both would have emptied the list', () => {
    // It is the thing the user just typed, and the thing one keystroke undoes.
    const view = buildView([row('a', 'working', 'p'), row('b', 'lost', 'p')], { query: 'zzz', onlyActive: true })
    expect(view.empty).toBe('filtered')
  })

  it('groups rows with no project under one bucket rather than dropping them', () => {
    const view = buildView([row('a', 'working', '')], OPTS)
    expect(view.groups).toHaveLength(1)
    expect(view.groups[0]!.rows.map(r => r.id)).toEqual(['a'])
  })
})

describe('matches', () => {
  const r = row('deploy-fix', 'working', 'agentistics', { task: 'release', note: 'waiting on CI' })

  it('looks in every field a person would search by', () => {
    expect(matches(r, 'deploy')).toBe(true)
    expect(matches(r, 'agentistics')).toBe(true)
    expect(matches(r, 'release')).toBe(true)
    expect(matches(r, 'CI')).toBe(true)
    expect(matches(r, 'claude')).toBe(true)
  })

  it('takes every term, in any order', () => {
    // The fields are separate values, not a sentence: an adjacency test would fail on all of them.
    expect(matches(r, 'release deploy')).toBe(true)
    expect(matches(r, 'release nothing')).toBe(false)
  })

  it('an empty query keeps everything', () => {
    expect(matches(r, '   ')).toBe(true)
  })
})
