import { test, expect } from 'bun:test'
import { planOrgTeam } from './org-team'

test('a named org with no teams yet gets one team, named after it', () => {
  expect(planOrgTeam({ org: 'acme', existingTeams: 0 })).toEqual({ create: true, name: 'acme' })
})

test('the org name is trimmed — an env file often carries the stray space', () => {
  expect(planOrgTeam({ org: '  acme  ', existingTeams: 0 })).toEqual({ create: true, name: 'acme' })
})

test('the literal placeholder org creates NOTHING — "default" names no organisation', () => {
  expect(planOrgTeam({ org: 'default', existingTeams: 0 })).toEqual({ create: false, reason: 'unnamed-org' })
  expect(planOrgTeam({ org: 'DEFAULT', existingTeams: 0 })).toEqual({ create: false, reason: 'unnamed-org' })
  expect(planOrgTeam({ org: ' default ', existingTeams: 0 })).toEqual({ create: false, reason: 'unnamed-org' })
})

test('an absent or blank org creates nothing either', () => {
  expect(planOrgTeam({ org: undefined, existingTeams: 0 })).toEqual({ create: false, reason: 'unnamed-org' })
  expect(planOrgTeam({ org: '   ', existingTeams: 0 })).toEqual({ create: false, reason: 'unnamed-org' })
})

test('a central that already has ANY team creates nothing — this is a convenience, not a fixture', () => {
  expect(planOrgTeam({ org: 'acme', existingTeams: 1 })).toEqual({ create: false, reason: 'teams-exist' })
  expect(planOrgTeam({ org: 'acme', existingTeams: 7 })).toEqual({ create: false, reason: 'teams-exist' })
})

test('idempotent: running the plan again once its team exists yields no second team', () => {
  const first = planOrgTeam({ org: 'acme', existingTeams: 0 })
  expect(first).toEqual({ create: true, name: 'acme' })
  // The team the first run created is now one of the existing teams.
  expect(planOrgTeam({ org: 'acme', existingTeams: 1 })).toEqual({ create: false, reason: 'teams-exist' })
})

test('a later org change does NOT rename or re-create — the guard is "any team exists", not "a team by this name"', () => {
  // The team was created as "acme"; someone edits AGENTISTICS_TEAM_ORG to "acme-corp" and reboots.
  // Nothing happens: the team keeps the name it was given and is an ordinary team from then on.
  expect(planOrgTeam({ org: 'acme-corp', existingTeams: 1 })).toEqual({ create: false, reason: 'teams-exist' })
})

test('the placeholder check wins over the team count — it is about the NAME, not the state', () => {
  expect(planOrgTeam({ org: 'default', existingTeams: 3 })).toEqual({ create: false, reason: 'unnamed-org' })
})
