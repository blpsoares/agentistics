import { describe, expect, test } from 'bun:test'
import {
  accountTeamsMap,
  resolveMachineTeams,
  resolveMachineTeamsMap,
} from './machineTeams'

const ACCOUNT_TEAMS = { accA: ['t1'], accB: ['t1', 't2'], accC: [] as string[] }

describe('resolveMachineTeams', () => {
  test('THE BUG: a machine inherits the teams of its owner account', () => {
    // Account A is in team t1 and owns this machine; nothing is attached to the machine itself.
    const r = resolveMachineTeams({ accountIds: ['accA'] }, ACCOUNT_TEAMS)
    expect(r.teams).toEqual(['t1'])
    expect(r.inherited).toEqual(['t1'])
    expect(r.explicit).toEqual([])
  })

  test('both of an account\'s machines inherit — filtering by the team catches both', () => {
    const map = resolveMachineTeamsMap(
      [{ id: 'm1', accountIds: ['accA'] }, { id: 'm2', accountIds: ['accA'] }],
      ACCOUNT_TEAMS,
    )
    expect(map).toEqual({ m1: ['t1'], m2: ['t1'] })
  })

  test('an inherited team can be excluded — and the exclusion is what makes unchecking stick', () => {
    const r = resolveMachineTeams(
      { accountIds: ['accA'], excludedTeamIds: ['t1'] },
      ACCOUNT_TEAMS,
    )
    expect(r.teams).toEqual([])
    expect(r.excluded).toEqual(['t1'])
    expect(r.inherited).toEqual([])
  })

  test('re-adding after an exclusion restores the team (exclusion cleared)', () => {
    const r = resolveMachineTeams({ accountIds: ['accA'], excludedTeamIds: [] }, ACCOUNT_TEAMS)
    expect(r.teams).toEqual(['t1'])
  })

  test('an explicit team survives on its own when the owner account leaves the team', () => {
    const r = resolveMachineTeams({ teamIds: ['t9'], accountIds: ['accC'] }, ACCOUNT_TEAMS)
    expect(r.teams).toEqual(['t9'])
    expect(r.explicit).toEqual(['t9'])
    expect(r.inherited).toEqual([])
  })

  test('explicit and inherited never double-count the same team', () => {
    const r = resolveMachineTeams({ teamIds: ['t1'], accountIds: ['accA'] }, ACCOUNT_TEAMS)
    expect(r.teams).toEqual(['t1'])
    expect(r.explicit).toEqual(['t1'])
    expect(r.inherited).toEqual([])
  })

  test('an explicit team can also be excluded (unchecking works either way)', () => {
    const r = resolveMachineTeams(
      { teamIds: ['t1'], accountIds: ['accA'], excludedTeamIds: ['t1'] },
      ACCOUNT_TEAMS,
    )
    expect(r.teams).toEqual([])
    expect(r.excluded).toEqual(['t1'])
  })

  test('several owner accounts union their teams', () => {
    const r = resolveMachineTeams({ accountIds: ['accA', 'accB'] }, ACCOUNT_TEAMS)
    expect(r.teams.sort()).toEqual(['t1', 't2'])
  })

  test('legacy single teamId / accountId fields still resolve', () => {
    expect(resolveMachineTeams({ teamId: 't5' }, ACCOUNT_TEAMS).teams).toEqual(['t5'])
    expect(resolveMachineTeams({ accountId: 'accB' }, ACCOUNT_TEAMS).teams.sort()).toEqual(['t1', 't2'])
  })

  test('a loose machine (no owner, no team) stays loose — inheritance invents nothing', () => {
    expect(resolveMachineTeams({}, ACCOUNT_TEAMS).teams).toEqual([])
  })

  test('a deleted / unknown owner account contributes nothing', () => {
    expect(resolveMachineTeams({ accountIds: ['ghost'] }, ACCOUNT_TEAMS).teams).toEqual([])
  })

  test('a stale exclusion for a team the machine is not in is not reported', () => {
    const r = resolveMachineTeams({ accountIds: ['accA'], excludedTeamIds: ['t7'] }, ACCOUNT_TEAMS)
    expect(r.teams).toEqual(['t1'])
    expect(r.excluded).toEqual([])
  })
})

describe('accountTeamsMap', () => {
  test('builds accountId → teams from memberships, deduped', () => {
    expect(accountTeamsMap([
      { _id: 'a1', memberships: [{ teamId: 't1' }, { teamId: 't1' }, { teamId: 't2' }] },
      { _id: 'a2' },
    ])).toEqual({ a1: ['t1', 't2'], a2: [] })
  })
})
